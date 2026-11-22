"""Harness de avaliação da detecção de webcam (layout Jogo + Webcam).

Roda o MESMO caminho do app (`clipes_worker.reframe.analyze`: proxy 480p/5 fps via
FFmpeg + YuNet do app + detecção de webcam) em cada vídeo do banco e compara com o
gabarito (`worker/tests/data/webcam_gabarito.json`).

Uso (a partir da raiz do repo; o Python é o do venv do worker):

    set PYTHONPATH=worker/src
    python worker/scripts/avaliar_webcam.py --rotulo depois
    python worker/scripts/avaliar_webcam.py --rotulo antes --src C:\\caminho\\base\\worker\\src
    python worker/scripts/avaliar_webcam.py --comparar antes depois

Métricas por vídeo
  - iou_camera: IoU entre a câmera estimada e o retângulo verdadeiro. Para o algoritmo
    novo é a overlay detectada; para o antigo (sem essa noção) é o próprio retângulo do painel.
  - jogo_no_painel: fração da área do painel de cima que cai FORA da câmera verdadeira.
  - aproveitamento: área do painel dentro da câmera / maior painel possível dentro dela.
  - acerto: iou_camera >= 0,70 (ou `iou_minimo` do gabarito, relaxado para recortes) e jogo_no_painel <= 0,10 (com câmera); sem câmera,
    acerto = webcamDetected falso.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
GABARITO = RAIZ / "worker" / "tests" / "data" / "webcam_gabarito.json"
BANCO = Path(os.environ.get("CLIPES_BANCO_WEBCAM", r"C:\Users\Windows 11\Videos\Clipes\banco-webcam"))
MODELO = Path(os.environ.get(
    "CLIPES_YUNET_MODEL",
    r"C:\Users\Windows 11\AppData\Local\io.github.gustavohooo.clipes\models\yunet\face_detection_yunet_2023mar.onnx"))
FFMPEG = os.environ.get(
    "CLIPES_FFMPEG", r"C:\Users\Windows 11\AppData\Local\io.github.gustavohooo.clipes\components\ffmpeg.exe")
SAIDA = Path(os.environ.get("CLIPES_AVALIACAO_SAIDA", r"C:\Users\WINDOW~1\AppData\Local\Temp\banco-webcam-eval"))

ACERTO_IOU = 0.70
ACERTO_JOGO = 0.10


def rect_inter(a, b):
    w = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return w * h


def iou(a, b):
    inter = rect_inter(a, b)
    return inter / max(1e-12, a[2] * a[3] + b[2] * b[3] - inter)


def maior_painel(verdade, aspecto_fonte, aspecto_painel):
    """Área do maior retângulo do painel que cabe dentro da câmera verdadeira (normalizada)."""
    razao = aspecto_painel / aspecto_fonte
    w, h = verdade[2], verdade[3]
    if w / h > razao:
        return h * razao * h
    return w * (w / razao)


class Contexto:
    def checkpoint(self):
        pass

    def progress(self, *args):
        pass


def avaliar_video(entrada, detector, split, rapido=False):
    import clipes_worker.reframe as reframe
    from clipes_worker import reframe_webcam

    arquivo = next(BANCO.glob(entrada["id"] + ".*"), None)
    if arquivo is None or arquivo.suffix == ".part":
        return {"id": entrada["id"], "erro": "arquivo ausente"}
    reframe_webcam.ULTIMA_DETECCAO = None
    fim_us = int(entrada["trecho"]["duracao_s"] * 1_000_000)
    cache = SAIDA / "cache" / f"{entrada['id']}.pkl"
    if rapido and cache.is_file():
        # Reaproveita proxy + YuNet de uma rodada completa: só mede o algoritmo de webcam.
        import pickle
        dets, grays, aspecto_proxy, tempo_analise = pickle.loads(cache.read_bytes())
        inicio = time.perf_counter()
        topo, _, detectada, confianca = reframe_webcam.gameplay_webcam_timelines(
            dets, grays, 0, fim_us, aspecto_proxy, split)
        tempo = tempo_analise + (time.perf_counter() - inicio)
        dados = {"segments": topo, "metrics": {"webcamDetected": detectada, "webcamConfidence": confianca}}
    else:
        inicio = time.perf_counter()
        dados = reframe.analyze(detector, {
            "source": str(arquivo), "ffmpeg": FFMPEG, "start_us": 0, "end_us": fim_us,
            "layout": "gameplay_webcam", "split_ratio": split}, Contexto())
        tempo = time.perf_counter() - inicio
        entrada_cache = getattr(reframe_webcam, "ULTIMA_ENTRADA", None)
        if entrada_cache is not None:
            import pickle
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(pickle.dumps((*entrada_cache, tempo - reframe_webcam.ULTIMO_TEMPO)))
    k = dados["segments"][0]["keyframes"][0]
    painel = (k["x"], k["y"], k["width"], k["height"])
    metricas = dados["metrics"]
    largura, altura = entrada["resolucao"]
    aspecto = largura / altura
    detalhe = getattr(reframe_webcam, "ULTIMA_DETECCAO", None)
    overlay, forma, grande = painel, None, None
    if detalhe is not None:
        webcam = detalhe["webcam"]
        overlay, forma, grande = webcam.rect, webcam.shape, webcam.large
    verdade = entrada.get("retangulo_norm")
    resultado = {
        "id": entrada["id"], "tipo": entrada["tipo"], "tempo_s": round(tempo, 1),
        "detectada": metricas.get("webcamDetected"), "confianca": metricas.get("webcamConfidence"),
        "forma": forma, "grande": grande, "painel": painel, "overlay": overlay,
    }
    if verdade is None:
        resultado["acerto"] = not metricas.get("webcamDetected")
        resultado["motivo"] = "sem webcam: " + ("não detectou" if resultado["acerto"] else "detectou câmera falsa")
        return resultado, arquivo
    resultado["iou_camera"] = round(iou(overlay, verdade), 3) if overlay else 0.0
    area_painel = painel[2] * painel[3]
    dentro = rect_inter(painel, verdade)
    resultado["jogo_no_painel"] = round(1 - dentro / area_painel, 3)
    top_h = round(1920 * split / 2) * 2
    ideal = maior_painel(verdade, aspecto, 1080 / top_h)
    resultado["aproveitamento"] = round(min(1.0, dentro / ideal), 3)
    minimo = entrada.get("iou_minimo", ACERTO_IOU)
    resultado["acerto"] = resultado["iou_camera"] >= minimo and resultado["jogo_no_painel"] <= ACERTO_JOGO
    if resultado["acerto"]:
        resultado["motivo"] = "ok"
    else:
        partes = []
        if resultado["jogo_no_painel"] > ACERTO_JOGO:
            partes.append(f"pegou jogo ({resultado['jogo_no_painel']:.0%} do painel)")
        if resultado["iou_camera"] < minimo:
            partes.append("cortou/errou a câmera" if resultado["aproveitamento"] < 0.7 else "câmera imprecisa")
        resultado["motivo"] = "; ".join(partes)
    return resultado, arquivo


def quadro_com_retangulos(arquivo, entrada, resultado):
    import cv2
    cap = cv2.VideoCapture(str(arquivo))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) * entrada.get("quadro_frac", 0.5)))
    ok, quadro = cap.read()
    cap.release()
    if not ok:
        return None
    h, w = quadro.shape[:2]

    def caixa(r, cor, espessura):
        cv2.rectangle(quadro, (round(r[0] * w), round(r[1] * h)),
                      (round((r[0] + r[2]) * w), round((r[1] + r[3]) * h)), cor, espessura)

    if entrada.get("retangulo_norm"):
        caixa(entrada["retangulo_norm"], (0, 255, 0), 3)        # verdade: verde
    if resultado.get("overlay"):
        caixa(resultado["overlay"], (0, 255, 255), 2)           # câmera estimada: amarelo
    caixa(resultado["painel"], (0, 0, 255), 2)                  # painel de cima: vermelho
    rotulo = f"{entrada['id']} {entrada['tipo']} IoU={resultado.get('iou_camera', '-')} conf={resultado['confianca']}"
    cv2.putText(quadro, rotulo, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 6)
    cv2.putText(quadro, rotulo, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)
    return quadro


def mosaico(quadros, caminho, colunas=3, largura=640, altura=360):
    """Grade de miniaturas de tamanho fixo (letterbox preto para quadros que não são 16:9)."""
    import cv2
    import numpy as np
    if not quadros:
        return
    miniaturas = []
    for q in quadros:
        escala = min(largura / q.shape[1], altura / q.shape[0])
        pequeno = cv2.resize(q, (round(q.shape[1] * escala), round(q.shape[0] * escala)))
        tile = np.zeros((altura, largura, 3), np.uint8)
        tile[:pequeno.shape[0], :pequeno.shape[1]] = pequeno
        miniaturas.append(tile)
    while len(miniaturas) % colunas:
        miniaturas.append(np.zeros_like(miniaturas[0]))
    linhas = [np.hstack(miniaturas[i:i + colunas]) for i in range(0, len(miniaturas), colunas)]
    cv2.imwrite(str(caminho), np.vstack(linhas), [cv2.IMWRITE_JPEG_QUALITY, 85])


def rodar(args):
    from clipes_worker.reframe import Yunet
    gabarito = json.loads(GABARITO.read_text(encoding="utf-8"))
    detector = Yunet(str(MODELO), "cpu")
    pasta = SAIDA / args.rotulo
    pasta.mkdir(parents=True, exist_ok=True)
    resultados, quadros = [], []
    for entrada in gabarito["videos"]:
        if args.videos and entrada["id"] not in args.videos:
            continue
        r = avaliar_video(entrada, detector, args.split, args.rapido)
        if isinstance(r, dict):
            print(f"{entrada['id']}: {r['erro']}")
            continue
        resultado, arquivo = r
        resultados.append(resultado)
        quadro = quadro_com_retangulos(arquivo, entrada, resultado)
        if quadro is not None:
            import cv2
            cv2.imwrite(str(pasta / f"{entrada['id']}.jpg"), quadro, [cv2.IMWRITE_JPEG_QUALITY, 88])
            quadros.append(quadro)
        print(f"{entrada['id']:<13} {entrada['tipo']:<14} iou={resultado.get('iou_camera', '-')!s:<6} "
              f"jogo={resultado.get('jogo_no_painel', '-')!s:<6} aprov={resultado.get('aproveitamento', '-')!s:<6} "
              f"conf={resultado['confianca']!s:<6} {resultado['tempo_s']}s  "
              f"{'OK ' if resultado['acerto'] else 'ERRO'} {resultado['motivo']}", flush=True)
    mosaico(quadros, SAIDA / f"mosaico-{args.rotulo}.jpg")
    (SAIDA / f"{args.rotulo}.json").write_text(json.dumps(resultados, indent=1, ensure_ascii=False), encoding="utf-8")
    com_camera = [r for r in resultados if "iou_camera" in r]
    if com_camera:
        print(f"\nIoU médio (com câmera): {sum(r['iou_camera'] for r in com_camera) / len(com_camera):.3f}  "
              f"acertos: {sum(r['acerto'] for r in resultados)}/{len(resultados)}  "
              f"tempo médio: {sum(r['tempo_s'] for r in resultados) / len(resultados):.1f}s")
    print(f"Mosaico: {SAIDA / ('mosaico-' + args.rotulo + '.jpg')}")


def comparar(args):
    antes = {r["id"]: r for r in json.loads((SAIDA / f"{args.comparar[0]}.json").read_text(encoding="utf-8"))}
    depois = {r["id"]: r for r in json.loads((SAIDA / f"{args.comparar[1]}.json").read_text(encoding="utf-8"))}
    print(f"{'vídeo':<13} {'tipo':<14} {'IoU antes':>9} {'IoU depois':>10}  {'antes':<5} {'depois':<6} {'tempo a→d':<11} motivo (depois)")
    for vid, d in depois.items():
        a = antes.get(vid, {})
        print(f"{vid:<13} {d['tipo']:<14} {a.get('iou_camera', '-')!s:>9} {d.get('iou_camera', '-')!s:>10}  "
              f"{'OK' if a.get('acerto') else 'ERRO':<5} {'OK' if d['acerto'] else 'ERRO':<6} "
              f"{a.get('tempo_s', '-')}→{d['tempo_s']:<5} {d['motivo']}")
    for nome, base in (("antes", antes), ("depois", depois)):
        c = [r for r in base.values() if "iou_camera" in r]
        if c:
            print(f"{nome}: IoU médio {sum(r['iou_camera'] for r in c) / len(c):.3f}, acertos "
                  f"{sum(r['acerto'] for r in base.values())}/{len(base)}, "
                  f"tempo médio {sum(r['tempo_s'] for r in base.values()) / len(base):.1f}s")


def main():
    global SAIDA
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # console do Windows (cp1252) não imprime acentos/setas
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rotulo", default="depois")
    p.add_argument("--src", help="PYTHONPATH alternativo (ex.: checkout do commit antigo)")
    p.add_argument("--videos", nargs="*")
    p.add_argument("--rapido", action="store_true",
                   help="reusa proxy+YuNet em cache (rodada completa anterior); só mede a detecção de webcam")
    p.add_argument("--split", type=float, default=0.30)
    p.add_argument("--saida", help="pasta de saída (padrão: Temp/banco-webcam-eval)")
    p.add_argument("--comparar", nargs=2, metavar=("ANTES", "DEPOIS"))
    args = p.parse_args()
    if args.saida:
        SAIDA = Path(args.saida)
    SAIDA.mkdir(parents=True, exist_ok=True)
    if args.src:
        sys.path.insert(0, args.src)
    else:
        sys.path.insert(0, str(RAIZ / "worker" / "src"))
    comparar(args) if args.comparar else rodar(args)


if __name__ == "__main__":
    main()
