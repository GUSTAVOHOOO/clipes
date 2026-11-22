"""Detecção da webcam do streamer no layout Jogo + Webcam.

A câmera do streamer é uma overlay: as bordas dela ficam paradas enquanto o jogo
se mexe. O algoritmo combina três pistas, só com NumPy/OpenCV:

1. rosto persistente (YuNet) como âncora, descartando rostos de personagens do jogo;
2. bordas persistentes no tempo (percentil baixo da força da borda em muitos quadros),
   que sobrevivem só nas bordas da overlay;
3. busca do retângulo (ou círculo) em volta do rosto cujas linhas têm maior cobertura
   de borda persistente; lados encostados na borda do quadro valem como lado.

Sem borda (câmera recortada/chroma key) cai para uma caixa de pessoa em volta do
rosto, com confiança baixa. Sem rosto persistente: `detected=False`.
Todos os retângulos são frações da Fonte (0..1), como o resto do worker.
"""
import math
import time
from dataclasses import dataclass
from statistics import mean, pstdev

DEFAULT_GAMEPLAY_SPLIT = 0.30
MIN_GAMEPLAY_SPLIT = 0.20
MAX_GAMEPLAY_SPLIT = 0.50
WEBCAM_MAX_CONFIDENCE = 0.95
WEBCAM_MIN_PERSISTENCE = 0.15
CLUSTER_DISTANCE = 0.09
CLUSTER_IOU = 0.15

# Bordas persistentes
EDGE_PERCENTILE = 0.25      # a borda precisa existir em ~75% das amostras
EDGE_MIN_STEP = 7.0         # degrau mínimo (níveis de cinza) para contar como borda
SIDE_TRIM = 0.08            # ignora os cantos (cantos arredondados) ao medir um lado
SIDE_MIN_COVERAGE = 0.40    # cobertura mínima para um lado ser candidato
MEAN_MIN_COVERAGE = 0.60    # cobertura média mínima dos lados com evidência própria
TYPICAL_WIDTH = 0.20        # largura típica da overlay (fração do quadro); só um prior suave
WIDTH_SIGMA = 0.6           # desvio do prior, em log
MAX_CANDIDATES = 7
FRAME_EDGE_PX = 2           # um lado a até 2 px da borda do quadro vale como lado
LARGE_WEBCAM_AREA = 0.30    # overlay maior que isso: o layout Rosto serve melhor
LARGE_WEBCAM_WIDTH = 0.50
INSET = 0.012               # recuo do painel dentro da overlay (evita a linha da borda)


def clamp(value, low, high):
    return max(low, min(high, value))


def panel_heights(split_ratio, min_ratio, max_ratio):
    ratio = clamp(float(split_ratio), min_ratio, max_ratio)
    top_h = int(clamp(round(1920.0 * ratio / 2.0) * 2, round(1920.0 * min_ratio), round(1920.0 * max_ratio)))
    return top_h, 1920 - top_h


def panel_crop_size(source_aspect, panel_aspect, zoom=1.0):
    ratio = max(0.1, float(panel_aspect)) / max(0.1, float(source_aspect))
    base_w = clamp(ratio, 0.05, 1.0)
    base_h = clamp(1.0 / ratio, 0.05, 1.0)
    z = max(1.0, float(zoom))
    w = clamp(base_w / z, 0.05, 1.0)
    h = clamp(base_h / z, 0.05, 1.0)
    return w, h


def _iou(a, b):
    w = max(0.0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x))
    h = max(0.0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
    inter = w * h
    return inter / max(1e-12, a.width * a.height + b.width * b.height - inter)


def rect_iou(a, b):
    """IoU entre dois retângulos (x, y, w, h)."""
    w = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = w * h
    return inter / max(1e-12, a[2] * a[3] + b[2] * b[3] - inter)


@dataclass
class Webcam:
    """Resultado da detecção. `rect` é a overlay inteira (x, y, w, h) normalizada."""
    rect: tuple | None
    shape: str            # "retangulo" | "circulo" | "recorte" | "nenhuma"
    confidence: float
    detected: bool
    large: bool = False
    sides: tuple = ()     # cobertura medida de cada lado (esq, dir, topo, base); None = quadro
    face: dict | None = None


# --------------------------------------------------------------------------- bordas

MIN_AMOSTRAS_COM_ROSTO = 8


def escolher_amostras(pool, limite):
    """Escolhe os quadros em cinza para as bordas persistentes.

    `pool` é uma lista de (quadro, teve_rosto). Streamers que alternam cena escondem a
    câmera por trechos: só os quadros com rosto mostram a overlay, então têm preferência
    (se houver pelo menos MIN_AMOSTRAS_COM_ROSTO). Depois reduz de forma uniforme.
    """
    com_rosto = [g for g, rosto in pool if rosto]
    todos = com_rosto if len(com_rosto) >= MIN_AMOSTRAS_COM_ROSTO else [g for g, _ in pool]
    if len(todos) <= limite:
        return todos
    passo = len(todos) / limite
    return [todos[int(i * passo)] for i in range(limite)]

def persistent_edges(gray_frames):
    """Mapas (vertical, horizontal) de borda persistente, em níveis de cinza.

    Para cada pixel pega o percentil baixo da força da borda ao longo das amostras:
    só sobra o que existe na maior parte do tempo (overlay), não o que o jogo desenha.
    Cada amostra é dilatada em 1 px para tolerar a reamostragem do proxy.
    """
    import cv2
    import numpy as np

    if not gray_frames:
        return None, None
    kh, kv = np.ones((1, 3), np.uint8), np.ones((3, 1), np.uint8)
    gxs, gys = [], []
    for gray in gray_frames:
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        gx = np.abs(cv2.Sobel(blur, cv2.CV_16S, 1, 0, ksize=3))
        gy = np.abs(cv2.Sobel(blur, cv2.CV_16S, 0, 1, ksize=3))
        gxs.append(cv2.dilate(gx, kh))
        gys.append(cv2.dilate(gy, kv))
    rank = int(clamp(round(EDGE_PERCENTILE * (len(gray_frames) - 1)), 0, len(gray_frames) - 1))
    pv = np.partition(np.stack(gxs), rank, axis=0)[rank].astype(np.float32) / 4.0
    ph = np.partition(np.stack(gys), rank, axis=0)[rank].astype(np.float32) / 4.0
    return pv, ph


class _Linhas:
    """Cobertura de linhas verticais/horizontais por somas acumuladas."""

    def __init__(self, pv, ph, min_step=EDGE_MIN_STEP):
        import numpy as np
        self.h, self.w = pv.shape
        bv = (pv >= min_step).astype(np.int32)
        bh = (ph >= min_step).astype(np.int32)
        self.cv = np.vstack([np.zeros((1, self.w), np.int32), np.cumsum(bv, axis=0)])
        self.ch = np.hstack([np.zeros((self.h, 1), np.int32), np.cumsum(bh, axis=1)])

    def vertical(self, x, y0, y1):
        y0, y1 = int(clamp(y0, 0, self.h)), int(clamp(y1, 0, self.h))
        if y1 - y0 < 2:
            return 0.0
        x = int(clamp(x, 0, self.w - 1))
        return float(self.cv[y1, x] - self.cv[y0, x]) / (y1 - y0)

    def horizontal(self, y, x0, x1):
        x0, x1 = int(clamp(x0, 0, self.w)), int(clamp(x1, 0, self.w))
        if x1 - x0 < 2:
            return 0.0
        y = int(clamp(y, 0, self.h - 1))
        return float(self.ch[y, x1] - self.ch[y, x0]) / (x1 - x0)

    def perfil_vertical(self, xs, y0, y1):
        import numpy as np
        y0, y1 = int(clamp(y0, 0, self.h)), int(clamp(y1, 0, self.h))
        xs = np.asarray(xs, dtype=int)
        if y1 - y0 < 2 or xs.size == 0:
            return np.zeros(xs.size)
        return (self.cv[y1, xs] - self.cv[y0, xs]) / float(y1 - y0)

    def perfil_horizontal(self, ys, x0, x1):
        import numpy as np
        x0, x1 = int(clamp(x0, 0, self.w)), int(clamp(x1, 0, self.w))
        ys = np.asarray(ys, dtype=int)
        if x1 - x0 < 2 or ys.size == 0:
            return np.zeros(ys.size)
        return (self.ch[ys, x1] - self.ch[ys, x0]) / float(x1 - x0)


def _picos(posicoes, cobertura, minimo, limite):
    """Máximos locais da cobertura (separados por >= 3 px), do melhor para o pior."""
    import numpy as np
    cobertura = np.asarray(cobertura)
    candidatos = []
    for i in range(len(posicoes)):
        v = cobertura[i]
        if v < minimo:
            continue
        lo, hi = max(0, i - 2), min(len(posicoes), i + 3)
        if v >= cobertura[lo:hi].max() and (i == 0 or v > cobertura[i - 1] or v >= cobertura[i - 1]):
            candidatos.append((float(v), int(posicoes[i])))
    candidatos.sort(reverse=True)
    escolhidos = []
    for v, p in candidatos:
        if all(abs(p - q) >= 4 for _, q in escolhidos):
            escolhidos.append((v, p))
        if len(escolhidos) >= limite:
            break
    return escolhidos


# --------------------------------------------------------------------------- rosto

def cluster_faces(frame_detections, total_frames, limit=1):
    """Agrupa detecções persistentes no espaço da Fonte. Devolve o melhor candidato
    (dict) ou, com `limit > 1`, a lista dos melhores."""
    clusters = []
    for frame_idx, dets in enumerate(frame_detections):
        for d in dets:
            dc = d.center
            matched = None
            for cl in clusters:
                rep = cl["rep"]
                if _iou(rep, d) >= CLUSTER_IOU or math.dist(rep.center, dc) <= CLUSTER_DISTANCE:
                    matched = cl
                    break
            if matched is None:
                clusters.append({"rep": d, "items": [(frame_idx, d)]})
            else:
                matched["items"].append((frame_idx, d))
                matched["rep"] = d
    ranked = []
    if not clusters or total_frames <= 0:
        return [] if limit > 1 else None
    for cl in clusters:
        frames_seen = {idx for idx, _ in cl["items"]}
        persistence = len(frames_seen) / total_frames
        if persistence < WEBCAM_MIN_PERSISTENCE:
            continue
        xs = [d.center[0] for _, d in cl["items"]]
        ys = [d.center[1] for _, d in cl["items"]]
        ws = [d.width for _, d in cl["items"]]
        hs = [d.height for _, d in cl["items"]]
        scores = [d.score for _, d in cl["items"]]
        std = (pstdev(xs) if len(xs) > 1 else 0.0) + (pstdev(ys) if len(ys) > 1 else 0.0)
        stability = max(0.0, 1.0 - std / 0.10)
        cx, cy = mean(xs), mean(ys)
        mw, mh = mean(ws), mean(hs)
        corner_bonus = 1.25 if (cx < 0.35 or cx > 0.65) and (cy < 0.45 or cy > 0.55) else 0.85
        size_factor = 1.0 if mw <= 0.30 else 0.7
        rank = persistence * (0.4 + 0.6 * stability) * corner_bonus * size_factor * mean(scores)
        ranked.append({
            "cx": cx, "cy": cy, "w": mw, "h": mh,
            "persistence": persistence, "stability": stability,
            "mean_score": mean(scores), "rank": rank,
        })
    ranked.sort(key=lambda c: c["rank"], reverse=True)
    if limit > 1:
        return ranked[:limit]
    return ranked[0] if ranked else None


# --------------------------------------------------------------------------- retângulo

def _buscar_retangulo(linhas, face_px):
    """Melhor retângulo em volta do rosto (em px do proxy). Devolve (rect, lados, score) ou None."""
    W, H = linhas.w, linhas.h
    fx0, fy0, fx1, fy1 = face_px
    fw, fh = fx1 - fx0, fy1 - fy0
    max_w, max_h = max(fw * 9, 0.6 * W), max(fh * 9, 0.7 * H)

    def candidatos_lado(posicoes, cobertura, borda_quadro):
        lista = _picos(posicoes, cobertura, SIDE_MIN_COVERAGE, MAX_CANDIDATES)
        if borda_quadro is not None:
            lista.append((None, borda_quadro))
        return lista

    # Faixa do rosto para gerar candidatos: a linha lateral precisa existir ali.
    ry0, ry1 = fy0 + 0.15 * fh, fy1 - 0.15 * fh
    rx0, rx1 = fx0 + 0.15 * fw, fx1 - 0.15 * fw

    import numpy as np
    xs_e = np.arange(int(max(0, fx0 - max_w)), int(max(1, fx0 - 0.08 * fw)))
    xs_d = np.arange(int(fx1 + 0.08 * fw), int(min(W, fx1 + max_w)))
    ys_t = np.arange(int(max(0, fy0 - max_h)), int(max(1, fy0 - 0.08 * fh)))
    ys_b = np.arange(int(fy1 + 0.25 * fh), int(min(H, fy1 + max_h)))
    if min(xs_e.size, xs_d.size, ys_t.size, ys_b.size) == 0:
        return None
    esq = candidatos_lado(xs_e, linhas.perfil_vertical(xs_e, ry0, ry1), 0 if fx0 <= max_w else None)
    dir_ = candidatos_lado(xs_d, linhas.perfil_vertical(xs_d, ry0, ry1), W if W - fx1 <= max_w else None)
    top = candidatos_lado(ys_t, linhas.perfil_horizontal(ys_t, rx0, rx1), 0 if fy0 <= max_h else None)
    bas = candidatos_lado(ys_b, linhas.perfil_horizontal(ys_b, rx0, rx1), H if H - fy1 <= max_h else None)

    melhor = None
    for ce, xe in esq:
        for cd, xd in dir_:
            rw = xd - xe
            if rw < fw * 1.5 or rw > max_w:
                continue
            for ct, yt in top:
                for cb, yb in bas:
                    rh = yb - yt
                    if rh < fh * 1.3 or rh > max_h:
                        continue
                    # Cobertura de verdade ao longo do lado inteiro (sem os cantos).
                    tr_y, tr_x = SIDE_TRIM * rh, SIDE_TRIM * rw
                    cov = (
                        None if ce is None else linhas.vertical(xe, yt + tr_y, yb - tr_y),
                        None if cd is None else linhas.vertical(xd - 1, yt + tr_y, yb - tr_y),
                        None if ct is None else linhas.horizontal(yt, xe + tr_x, xd - tr_x),
                        None if cb is None else linhas.horizontal(yb - 1, xe + tr_x, xd - tr_x),
                    )
                    reais = [c for c in cov if c is not None]
                    if len(reais) < 2 or min(reais) < SIDE_MIN_COVERAGE or mean(reais) < MEAN_MIN_COVERAGE:
                        continue
                    # Lados no quadro valem pouco: preferimos retângulo com evidência própria.
                    soma = sum(c if c is not None else 0.6 for c in cov)
                    # Estruturas dentro da câmera (janela, estante) também têm bordas fixas: o
                    # prior de largura derruba retângulos minúsculos sem proibir câmeras grandes.
                    prior = math.exp(-(math.log(max(rw, 1) / W / TYPICAL_WIDTH) ** 2) / (2 * WIDTH_SIGMA ** 2))
                    score = (soma / 4.0 + 0.03 * len(reais)) * (0.5 + 0.5 * prior)
                    if melhor is None or score > melhor[2]:
                        melhor = ((xe, yt, rw, rh), cov, score)
    return melhor


def _buscar_circulo(linhas, pm, face_px):
    """Círculo (cx, cy, r) em volta do rosto pela cobertura de borda persistente no anel."""
    import numpy as np
    W, H = linhas.w, linhas.h
    fx0, fy0, fx1, fy1 = face_px
    fw, fh = fx1 - fx0, fy1 - fy0
    fcx, fcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
    angulos = np.linspace(0, 2 * math.pi, 96, endpoint=False)
    cos, sin = np.cos(angulos), np.sin(angulos)
    melhor = None
    passo = max(1, int(round(fw / 20)))
    for r in np.arange(max(fw * 1.1, 14), min(max(fw, fh) * 4.5, min(W, H) * 0.5), max(2, passo)):
        for cy in np.arange(fcy - 0.8 * r, fcy + 0.8 * r + 1, passo * 2):
            for cx in np.arange(fcx - 0.8 * r, fcx + 0.8 * r + 1, passo * 2):
                px = np.rint(cx + r * cos).astype(int)
                py = np.rint(cy + r * sin).astype(int)
                dentro = (px >= 1) & (px < W - 1) & (py >= 1) & (py < H - 1)
                if dentro.sum() < 0.8 * len(angulos):
                    continue
                cob = float(pm[py[dentro], px[dentro]].mean())
                if melhor is None or cob > melhor[0]:
                    melhor = (cob, float(cx), float(cy), float(r))
    return melhor


def detectar_webcam(frame_detections, gray_frames, source_aspect):
    """Detecta a webcam. Devolve `Webcam` com retângulo normalizado da overlay inteira."""
    import numpy as np

    total = len(frame_detections)
    clusters = cluster_faces(frame_detections, total, limit=3)
    if not clusters:
        return Webcam(None, "nenhuma", 0.05, False)
    pv, ph = persistent_edges(gray_frames) if gray_frames else (None, None)
    if pv is None:
        c = clusters[0]
        return _recorte(c, 0.15)
    H, W = pv.shape
    linhas = _Linhas(pv, ph)

    melhor = None
    for c in clusters:
        face_px = ((c["cx"] - c["w"] / 2) * W, (c["cy"] - c["h"] / 2) * H,
                   (c["cx"] + c["w"] / 2) * W, (c["cy"] + c["h"] / 2) * H)
        achado = _buscar_retangulo(linhas, face_px)
        if achado is None:
            continue
        rect, cov, score = achado
        rank = score * (0.5 + 0.5 * c["persistence"])
        if melhor is None or rank > melhor[0]:
            melhor = (rank, c, rect, cov, score)

    if melhor is not None:
        _, c, (rx, ry, rw, rh), cov, score = melhor
        reais = [v for v in cov if v is not None]
        qualidade = 0.6 * mean(reais) + 0.4 * min(reais)
        confianca = 0.20 + 0.50 * qualidade + 0.07 * (len(reais) - 2) + 0.10 * c["persistence"] * c["stability"]
        confianca = round(clamp(confianca, 0.2, WEBCAM_MAX_CONFIDENCE), 3)
        rect = (rx / W, ry / H, rw / W, rh / H)
        area = rect[2] * rect[3]
        return Webcam(rect, "retangulo", confianca, True,
                      large=area > LARGE_WEBCAM_AREA or rect[2] > LARGE_WEBCAM_WIDTH,
                      sides=tuple(cov), face=c)

    # Sem retângulo: tenta círculo no rosto mais forte, depois cai para caixa de pessoa.
    c = clusters[0]
    pm = np.maximum(pv, ph)
    face_px = ((c["cx"] - c["w"] / 2) * W, (c["cy"] - c["h"] / 2) * H,
               (c["cx"] + c["w"] / 2) * W, (c["cy"] + c["h"] / 2) * H)
    circulo = _buscar_circulo(linhas, (pm >= EDGE_MIN_STEP).astype(np.float32), face_px)
    if circulo is not None and circulo[0] >= 0.7:
        cob, cx, cy, r = circulo
        x0, y0 = max(0.0, cx - r), max(0.0, cy - r)
        x1, y1 = min(float(W), cx + r), min(float(H), cy + r)
        rect = (x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H)
        confianca = round(clamp(0.25 + 0.5 * cob + 0.1 * c["persistence"] * c["stability"], 0.2, 0.85), 3)
        return Webcam(rect, "circulo", confianca, True, sides=(cob,), face=c)
    return _recorte(c, 0.15)


def _recorte(c, base):
    """Câmera sem borda detectável (chroma key/recorte): caixa de pessoa em volta do rosto."""
    fw, fh = c["w"], c["h"]
    w = clamp(fw * 3.2, 0.1, 0.9)
    h = clamp(fh * 4.2, 0.1, 0.9)
    x = clamp(c["cx"] - w / 2, 0.0, 1.0 - w)
    y = clamp(c["cy"] - fh * 1.0 - 0.0, 0.0, 1.0 - h)
    y = clamp(c["cy"] - 0.30 * h, 0.0, 1.0 - h)
    confianca = round(clamp(base + 0.15 * c["persistence"] * c["stability"], 0.1, 0.35), 3)
    return Webcam((x, y, w, h), "recorte", confianca, True, face=c)


# --------------------------------------------------------------------------- painel

def fit_panel(webcam, source_aspect, top_aspect):
    """Crop do painel de cima: cobre a câmera sem pegar jogo, no aspecto exato do painel.

    Se a proporção não bate, corta as laterais (ou o topo/base) da própria câmera,
    mantendo o rosto centrado.
    """
    ratio = max(0.1, float(top_aspect)) / max(0.1, float(source_aspect))  # w_norm / h_norm
    if webcam.rect is None:
        h = clamp(0.30 / ratio, 0.05, 0.60)
        w = clamp(h * ratio, 0.05, 1.0)
        return 0.02, 0.04, w, h
    x, y, w, h = webcam.rect
    face = webcam.face
    if webcam.shape == "circulo":
        # Maior retângulo do painel inscrito no círculo (em px do quadro).
        d_px_w, d_px_h = w * source_aspect, h  # unidades de altura da Fonte
        d = min(d_px_w, d_px_h)
        pw = d * top_aspect / math.sqrt(1 + top_aspect ** 2) * 0.98
        ph = d / math.sqrt(1 + top_aspect ** 2) * 0.98
        cw, ch = pw / source_aspect, ph
        ccx, ccy = x + w / 2, y + h / 2
        return clamp(ccx - cw / 2, 0, 1 - cw), clamp(ccy - ch / 2, 0, 1 - ch), cw, ch
    if webcam.shape == "retangulo":
        ix, iy = w * INSET, h * INSET
        x, y, w, h = x + ix, y + iy, w - 2 * ix, h - 2 * iy
    if w / h > ratio:
        ch = h
        cw = ch * ratio
    else:
        cw = w
        ch = cw / ratio
    fcx = face["cx"] if face else x + w / 2
    fcy = face["cy"] if face else y + h / 2
    cx = clamp(fcx - cw / 2, x, x + w - cw)
    cy = clamp(fcy - 0.45 * ch, y, y + h - ch)
    return clamp(cx, 0, 1 - cw), clamp(cy, 0, 1 - ch), cw, ch


def gameplay_rect(webcam_rect, source_aspect, bot_aspect):
    """Enquadra o jogo evitando duplicar a região da webcam quando possível."""
    crop_w, crop_h = panel_crop_size(source_aspect, bot_aspect, zoom=1.0)
    wx, wy, ww, wh = webcam_rect
    wcx = wx + ww / 2.0
    x = (1.0 - crop_w) / 2.0
    y = (1.0 - crop_h) / 2.0
    if crop_w < 0.90:
        if wcx < 0.35 and wx + ww > x:
            x = min(1.0 - crop_w, min(x + 0.20, wx + ww))
        elif wcx > 0.65 and wx < x + crop_w:
            x = max(0.0, max(x - 0.20, wx - crop_w))
    x = clamp(x, 0.0, max(0.0, 1.0 - crop_w))
    y = clamp(y, 0.0, max(0.0, 1.0 - crop_h))
    return x, y, crop_w, crop_h


# Diagnóstico para o harness de avaliação (scripts/avaliar_webcam.py); o app nunca lê.
ULTIMA_DETECCAO = None
ULTIMA_ENTRADA = None
ULTIMO_TEMPO = 0.0


def gameplay_webcam_timelines(frame_detections, gray_frames, start_us, end_us, source_aspect,
                              split_ratio=DEFAULT_GAMEPLAY_SPLIT):
    """Versão compacta: (segmentos do topo, segmentos da base, webcamDetected, webcamConfidence)."""
    top, bot, webcam = analisar_gameplay_webcam(
        frame_detections, gray_frames, start_us, end_us, source_aspect, split_ratio)
    return top, bot, webcam.detected, webcam.confidence


def analisar_gameplay_webcam(frame_detections, gray_frames, start_us, end_us, source_aspect,
                             split_ratio=DEFAULT_GAMEPLAY_SPLIT):
    """Detecta a webcam e monta os segmentos dos dois painéis. Devolve (topo, base, Webcam)."""
    global ULTIMA_DETECCAO, ULTIMA_ENTRADA, ULTIMO_TEMPO
    inicio = time.perf_counter()
    top_h, bot_h = panel_heights(split_ratio, MIN_GAMEPLAY_SPLIT, MAX_GAMEPLAY_SPLIT)
    top_aspect = 1080.0 / top_h
    bot_aspect = 1080.0 / bot_h
    webcam = detectar_webcam(frame_detections, gray_frames, source_aspect)
    wc_rect = fit_panel(webcam, source_aspect, top_aspect)
    wc_conf, detected = webcam.confidence, webcam.detected
    game_rect = gameplay_rect(webcam.rect or wc_rect, source_aspect, bot_aspect)
    ULTIMA_DETECCAO = {"webcam": webcam, "painel": wc_rect}
    ULTIMA_ENTRADA = (frame_detections, gray_frames, source_aspect)
    ULTIMO_TEMPO = time.perf_counter() - inicio
    wx, wy, ww, wh = wc_rect
    gx, gy, gw, gh = game_rect
    top_segments = [{
        "startUs": start_us,
        "endUs": end_us,
        "reason": "start",
        "keyframes": [{
            "timeUs": start_us,
            "x": wx,
            "y": wy,
            "width": ww,
            "height": wh,
            "confidence": wc_conf,
        }],
    }]
    bot_segments = [{
        "startUs": start_us,
        "endUs": end_us,
        "reason": "start",
        "keyframes": [{
            "timeUs": start_us,
            "x": gx,
            "y": gy,
            "width": gw,
            "height": gh,
            "confidence": round(min(0.9, wc_conf + 0.1), 3) if detected else 0.25,
        }],
    }]
    return top_segments, bot_segments, webcam
