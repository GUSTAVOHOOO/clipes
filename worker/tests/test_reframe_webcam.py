"""Detecção de webcam com imagens sintéticas: jogo que muda a cada quadro + overlay parada."""
import json
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

from clipes_worker.reframe_camera import Detection
from clipes_worker.reframe_webcam import (
    detectar_webcam, escolher_amostras, fit_panel, gameplay_webcam_timelines, persistent_edges, rect_iou,
)

W, H = 480, 270
ASPECTO = 16 / 9


def jogo(rng):
    """Quadro de 'jogo': campo suave aleatório diferente a cada quadro (sem bordas persistentes)."""
    campo = rng.integers(20, 235, (H // 18, W // 18)).astype(np.uint8)
    return cv2.resize(campo, (W, H), interpolation=cv2.INTER_CUBIC)


def camera(w, h, seed=3):
    """Conteúdo estático da webcam: gradiente + uns blocos, sem moldura."""
    rng = np.random.default_rng(seed)
    x = np.linspace(40, 150, w, dtype=np.float32)[None, :].repeat(h, axis=0)
    img = x + rng.normal(0, 2, (h, w))
    img[h // 5:h // 2, w // 8:w // 4] = 200  # estante
    img[h // 2:, w // 3:2 * w // 3] = 25     # pessoa escura
    return np.clip(img, 0, 255).astype(np.uint8)


def cena(forma, rect, n=16, moldura=0, recorte=False):
    """Gera n quadros. rect = (x, y, w, h) em px. Devolve a lista de quadros em cinza."""
    rng = np.random.default_rng(11)
    x, y, w, h = rect
    cam = camera(w, h)
    mascara = np.ones((h, w), np.uint8)
    if forma == "arredondada":
        mascara[:] = 0
        cv2.rectangle(mascara, (0, 0), (w - 1, h - 1), 1, -1)
        r = min(w, h) // 6
        for cx, cy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            quad = np.zeros_like(mascara)
            cv2.rectangle(quad, (cx - r if cx else 0, cy - r if cy else 0),
                          (cx if cx else r, cy if cy else r), 1, -1)
            mascara[quad == 1] = 0
        cv2.rectangle(mascara, (r, 0), (w - 1 - r, h - 1), 1, -1)
        cv2.rectangle(mascara, (0, r), (w - 1, h - 1 - r), 1, -1)
        for cx, cy in ((r, r), (w - 1 - r, r), (r, h - 1 - r), (w - 1 - r, h - 1 - r)):
            cv2.circle(mascara, (cx, cy), r, 1, -1)
    elif forma == "circulo":
        mascara[:] = 0
        cv2.circle(mascara, (w // 2, h // 2), min(w, h) // 2 - 1, 1, -1)
    quadros = []
    for _ in range(n):
        img = jogo(rng)
        regiao = img[y:y + h, x:x + w]
        regiao[mascara == 1] = cam[mascara == 1]
        if moldura:
            cv2.rectangle(img, (x - moldura, y - moldura), (x + w - 1 + moldura, y + h - 1 + moldura), 250, moldura)
        quadros.append(img)
    return quadros


def rosto_em(rect, n=16, tamanho=0.28):
    x, y, w, h = rect
    fw = w * tamanho / W
    fh = fw * W / H * 1.15
    cx = (x + w / 2) / W
    cy = (y + h * 0.42) / H
    return [[Detection(cx - fw / 2, cy - fh / 2, fw, fh, 0.93)] for _ in range(n)]


def norm(rect):
    return rect[0] / W, rect[1] / H, rect[2] / W, rect[3] / H


def verificar_forma(forma, rect, moldura=0, minimo=0.85):
    quadros = cena(forma, rect, moldura=moldura)
    webcam = detectar_webcam(rosto_em(rect), quadros, ASPECTO)
    assert webcam.detected is True
    # A moldura faz parte da overlay: o retângulo verdadeiro a inclui.
    verdade = (rect[0] - moldura, rect[1] - moldura, rect[2] + 2 * moldura, rect[3] + 2 * moldura)
    assert rect_iou(webcam.rect, norm(verdade)) >= minimo
    return webcam


def test_retangulo_sem_moldura_no_canto():
    webcam = verificar_forma("retangulo", (330, 12, 140, 80))
    assert webcam.shape == "retangulo"
    assert webcam.confidence >= 0.6


def test_retangulo_com_moldura_no_meio_da_tela():
    webcam = verificar_forma("retangulo", (60, 150, 130, 90), moldura=3)
    assert webcam.shape == "retangulo"
    assert webcam.confidence >= 0.6


def test_cantos_arredondados():
    webcam = verificar_forma("arredondada", (20, 20, 120, 100), minimo=0.8)
    assert webcam.shape == "retangulo"


def test_retrato_vertical_colado_na_borda():
    webcam = verificar_forma("retangulo", (0, 10, 90, 120))
    assert webcam.sides[0] is None  # lado esquerdo é a borda do quadro


def test_camera_circular_vira_circulo_com_bbox():
    rect = (330, 150, 110, 110)
    quadros = cena("circulo", rect)
    webcam = detectar_webcam(rosto_em(rect, tamanho=0.4), quadros, ASPECTO)
    assert webcam.detected is True
    assert webcam.shape == "circulo"
    assert rect_iou(webcam.rect, norm(rect)) >= 0.7


def test_recorte_sem_borda_cai_para_pessoa_com_confianca_baixa():
    rng = np.random.default_rng(5)
    quadros = [jogo(rng) for _ in range(16)]  # nada de overlay: só o jogo mudando
    webcam = detectar_webcam(rosto_em((300, 100, 150, 150)), quadros, ASPECTO)
    assert webcam.detected is True
    assert webcam.shape == "recorte"
    assert webcam.confidence <= 0.35


def test_sem_rosto_persistente_nao_detecta_e_confianca_baixa():
    quadros = cena("retangulo", (330, 12, 140, 80))
    webcam = detectar_webcam([[] for _ in quadros], quadros, ASPECTO)
    assert webcam.detected is False
    assert webcam.rect is None
    assert webcam.confidence <= 0.15


def test_rosto_de_personagem_que_aparece_pouco_e_ignorado():
    quadros = cena("retangulo", (330, 12, 140, 80))
    deteccoes = [[] for _ in quadros]
    deteccoes[4] = [Detection(0.3, 0.5, 0.1, 0.15, 0.9)]
    assert detectar_webcam(deteccoes, quadros, ASPECTO).detected is False


def test_camera_grande_e_sinalizada_para_layout_rosto():
    rect = (40, 20, 330, 230)
    quadros = cena("retangulo", rect)
    webcam = detectar_webcam(rosto_em(rect), quadros, ASPECTO)
    assert webcam.detected is True
    assert webcam.large is True


def test_camera_pequena_nao_e_grande():
    assert verificar_forma("retangulo", (330, 12, 140, 80)).large is False


def test_painel_respeita_aspecto_do_painel_e_fica_dentro_da_camera():
    rect = (330, 12, 140, 80)
    quadros = cena("retangulo", rect)
    topo, base, detectada, conf = gameplay_webcam_timelines(
        rosto_em(rect), quadros, 0, 2_000_000, ASPECTO, 0.30)
    k = topo[0]["keyframes"][0]
    assert detectada is True and conf == k["confidence"]
    assert k["width"] / k["height"] * ASPECTO == pytest.approx(1080 / 576, rel=1e-2)
    painel = (k["x"], k["y"], k["width"], k["height"])
    verdade = norm(rect)
    # Todo o painel dentro da câmera verdadeira (sem jogo), com 1 px de folga do proxy.
    folga = 1.5 / W
    assert painel[0] >= verdade[0] - folga and painel[1] >= verdade[1] - folga
    assert painel[0] + painel[2] <= verdade[0] + verdade[2] + folga
    assert painel[1] + painel[3] <= verdade[1] + verdade[3] + folga


def test_painel_de_camera_larga_corta_laterais_e_mantem_rosto():
    # Câmera 3:1 num painel 1,875:1: precisa cortar as laterais, centrando no rosto.
    rect = (20, 20, 360, 100)
    quadros = cena("retangulo", rect)
    topo, _, _, _ = gameplay_webcam_timelines(rosto_em(rect, tamanho=0.12), quadros, 0, 2_000_000, ASPECTO, 0.30)
    k = topo[0]["keyframes"][0]
    assert k["width"] < norm(rect)[2]
    assert k["y"] >= norm(rect)[1] - 1.5 / H
    assert k["y"] + k["height"] <= norm(rect)[1] + norm(rect)[3] + 1.5 / H
    rosto_cx = (rect[0] + rect[2] / 2) / W
    assert k["x"] < rosto_cx < k["x"] + k["width"]


def test_painel_de_camera_alta_corta_topo_e_base():
    rect = (10, 10, 100, 200)
    quadros = cena("retangulo", rect)
    topo, _, _, _ = gameplay_webcam_timelines(rosto_em(rect), quadros, 0, 2_000_000, ASPECTO, 0.30)
    k = topo[0]["keyframes"][0]
    assert k["height"] < norm(rect)[3]
    assert k["width"] / k["height"] * ASPECTO == pytest.approx(1080 / 576, rel=1e-2)


def test_bordas_persistentes_ignoram_o_jogo_que_muda():
    quadros = cena("retangulo", (330, 12, 140, 80), moldura=3)
    pv, ph = persistent_edges(quadros)
    assert pv[40, 328:333].max() > 20          # borda esquerda da moldura
    assert pv[200, 100:300].max() < 8          # só jogo: sem borda persistente
    assert ph[10:15, 380:420].max() > 20       # borda do topo


def test_gabarito_bem_formado():
    caminho = Path(__file__).parent / "data" / "webcam_gabarito.json"
    gab = json.loads(caminho.read_text(encoding="utf-8"))
    assert gab["videos"]
    ids = set()
    for v in gab["videos"]:
        assert v["id"] not in ids
        ids.add(v["id"])
        assert v["tipo"] and v["trecho"]["duracao_s"] > 0
        if v["retangulo_px"] is None:
            assert v["retangulo_norm"] is None
            continue
        x, y, w, h = v["retangulo_px"]
        largura, altura = v["resolucao"]
        assert 0 <= x and 0 <= y and x + w <= largura and y + h <= altura
        assert v["retangulo_norm"] == pytest.approx([x / largura, y / altura, w / largura, h / altura], abs=1e-4)


def test_amostras_preferem_quadros_com_rosto_e_reduzem_uniformemente():
    pool = [(i, i % 2 == 0) for i in range(40)]  # só os pares têm rosto
    amostras = escolher_amostras(pool, 10)
    assert len(amostras) == 10
    assert all(a % 2 == 0 for a in amostras)
    assert amostras == sorted(amostras)


def test_amostras_sem_rosto_suficiente_usam_todos_os_quadros():
    pool = [(i, i == 3) for i in range(12)]
    assert escolher_amostras(pool, 32) == list(range(12))
