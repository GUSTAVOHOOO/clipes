"""Detecção heurística de baixa confiança para webcam + jogo (#78).

O caminho principal continua sendo o retângulo manual no editor.
Usa apenas NumPy/OpenCV já presentes no worker, sem novas dependências.
"""
import math
from statistics import mean, pstdev

DEFAULT_GAMEPLAY_SPLIT = 0.30
MIN_GAMEPLAY_SPLIT = 0.20
MAX_GAMEPLAY_SPLIT = 0.50
WEBCAM_MAX_CONFIDENCE = 0.65
WEBCAM_MIN_PERSISTENCE = 0.15
CLUSTER_DISTANCE = 0.09
CLUSTER_IOU = 0.15


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


def temporal_edge_map(gray_frames):
    """Calcula mapa normalizado de gradiente da média temporal dos quadros."""
    if not gray_frames:
        return None
    import cv2
    import numpy as np

    stack = np.mean(np.stack(gray_frames, axis=0).astype(np.float32), axis=0)
    gx = cv2.Sobel(stack, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(stack, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    peak = float(np.percentile(mag, 99.0)) if mag.size else 0.0
    if peak <= 1e-6:
        return np.zeros_like(mag, dtype=np.float32)
    return np.clip(mag / peak, 0.0, 1.0)


def _edge_score(edge_map, x, y, w, h):
    if edge_map is None:
        return 0.0
    eh, ew = edge_map.shape[:2]
    if eh < 8 or ew < 8:
        return 0.0
    x0 = max(1, min(ew - 2, round(x * ew)))
    x1 = max(x0 + 1, min(ew - 2, round((x + w) * ew)))
    y0 = max(1, min(eh - 2, round(y * eh)))
    y1 = max(y0 + 1, min(eh - 2, round((y + h) * eh)))
    band = 2
    top_e = float(edge_map[max(0, y0 - band):min(eh, y0 + band + 1), x0:x1].mean())
    bot_e = float(edge_map[max(0, y1 - band):min(eh, y1 + band + 1), x0:x1].mean())
    left_e = float(edge_map[y0:y1, max(0, x0 - band):min(ew, x0 + band + 1)].mean())
    right_e = float(edge_map[y0:y1, max(0, x1 - band):min(ew, x1 + band + 1)].mean())
    inner = float(edge_map[y0 + 1:max(y0 + 2, y1), x0 + 1:max(x0 + 2, x1)].mean())
    border = (top_e + bot_e + left_e + right_e) / 4.0
    return max(0.0, border - inner * 0.5)


def cluster_faces(frame_detections, total_frames):
    """Agrupa detecções persistentes no espaço da Fonte e escolhe o melhor candidato a webcam."""
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
    if not clusters or total_frames <= 0:
        return None
    best = None
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
        size_factor = 1.0 if mw <= 0.30 else 0.4
        rank = persistence * (0.4 + 0.6 * stability) * corner_bonus * size_factor * mean(scores)
        cand = {
            "cx": cx,
            "cy": cy,
            "w": mw,
            "h": mh,
            "persistence": persistence,
            "stability": stability,
            "mean_score": mean(scores),
            "rank": rank,
        }
        if best is None or cand["rank"] > best["rank"]:
            best = cand
    return best


def refine_webcam_rect(cluster, edge_map, source_aspect, top_aspect):
    """Refina o retângulo da webcam em torno do rosto persistente (baixa confiança)."""
    norm_ratio = max(0.1, float(top_aspect)) / max(0.1, float(source_aspect))
    if cluster is None:
        w = clamp(0.30, 0.14, 0.55)
        h = clamp(w / norm_ratio, 0.05, 0.60)
        w = clamp(h * norm_ratio, 0.05, 1.0)
        return (0.02, 0.04, w, h), 0.10, False

    fcx, fcy, fw, fh = cluster["cx"], cluster["cy"], cluster["w"], cluster["h"]
    best_cand = None
    for scale in (2.2, 2.8, 3.4, 4.0):
        w = clamp(fw * scale, 0.16, 0.55)
        h = w / norm_ratio
        if h > 0.60:
            h = 0.60
            w = clamp(h * norm_ratio, 0.05, 1.0)
        x = clamp(fcx - w / 2.0, 0.0, 1.0 - w)
        y = clamp(fcy + 0.10 * fh - h / 2.0, 0.0, 1.0 - h)
        if x < 0.025:
            x = 0.0
        elif x + w > 0.975:
            x = 1.0 - w
        if y < 0.025:
            y = 0.0
        elif y + h > 0.975:
            y = 1.0 - h
        edge = _edge_score(edge_map, x, y, w, h)
        scale_pref = 1.0 - abs(scale - 2.8) * 0.05
        score = edge * 2.0 + scale_pref * 0.2
        if best_cand is None or score > best_cand[0]:
            best_cand = (score, edge, (x, y, w, h))

    _, edge_strength, rect = best_cand
    conf = 0.20 + 0.22 * cluster["persistence"] + 0.10 * cluster["stability"] + 0.13 * min(1.0, edge_strength * 2.5)
    conf = round(clamp(conf, 0.15, WEBCAM_MAX_CONFIDENCE), 3)
    return rect, conf, True


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


def gameplay_webcam_timelines(frame_detections, edge_map, start_us, end_us, source_aspect, split_ratio=DEFAULT_GAMEPLAY_SPLIT):
    top_h, bot_h = panel_heights(split_ratio, MIN_GAMEPLAY_SPLIT, MAX_GAMEPLAY_SPLIT)
    top_aspect = 1080.0 / top_h
    bot_aspect = 1080.0 / bot_h
    cluster = cluster_faces(frame_detections, len(frame_detections))
    wc_rect, wc_conf, detected = refine_webcam_rect(cluster, edge_map, source_aspect, top_aspect)
    game_rect = gameplay_rect(wc_rect, source_aspect, bot_aspect)
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
            "confidence": round(min(0.65, wc_conf + 0.1), 3) if detected else 0.25,
        }],
    }]
    return top_segments, bot_segments, detected, wc_conf
