"""Análise local de um Corte escolhido. Nunca acessa rede ou SQLite (#60)."""
import math
import re
import subprocess
import tempfile
import time
from pathlib import Path

from .protocol import WorkerError
from .reframe_camera import Detection, iou, timeline, two_people_timelines
from .reframe_webcam import DEFAULT_GAMEPLAY_SPLIT, gameplay_webcam_timelines, temporal_edge_map
from .tasks import Task

SUPPORTED_LAYOUTS = ("face", "gameplay_webcam", "two_people")

PROXY_HEIGHT = 480
ANALYSIS_FPS = 5
SCENE_THRESHOLD = 10.0
SCENE_MIN_GAP_FRAMES = 2  # 400 ms: evita dois disparos consecutivos na mesma transição.
YUNET_SIZE = 640
FACE_THRESHOLD = 0.7
NMS_THRESHOLD = 0.3
ORT_THREADS = 2


def scene_frames(log):
    result = []
    for frame in sorted({round(float(value) * ANALYSIS_FPS) for value in
                         re.findall(r"lavfi\.scd\.time=([0-9.]+)", log)}):
        if frame > 0 and (not result or frame - result[-1] >= SCENE_MIN_GAP_FRAMES):
            result.append(frame)
    return set(result)


class Yunet:
    """OpenCV Zoo 2023mar, BGR 0..255; outputs decoded at strides 8/16/32.

    CUDA is used only after a real session warmup succeeds. The same checkpoint
    is reopened on CPU if provider loading or inference fails. No remote Hub.
    """
    def __init__(self, path, device, session_factory=None):
        if not Path(path).is_file():
            raise WorkerError("model_missing")
        self.path = path
        if session_factory is None:
            import onnxruntime as ort
            def session_factory(providers):
                options = ort.SessionOptions()
                options.intra_op_num_threads = ORT_THREADS
                options.inter_op_num_threads = 1
                options.log_severity_level = 3
                return ort.InferenceSession(path, sess_options=options, providers=providers)
        self.factory = session_factory
        self.device = "cpu"
        if device == "cuda":
            try:
                self.session = self.factory(["CUDAExecutionProvider", "CPUExecutionProvider"])
                if "CUDAExecutionProvider" not in self.session.get_providers():
                    raise RuntimeError("provider unavailable")
                import numpy as np
                self.session.run(None, {"input": np.zeros((1, 3, YUNET_SIZE, YUNET_SIZE), np.float32)})
                self.device = "cuda"
                return
            except Exception:
                self.session = None
        self.session = self.factory(["CPUExecutionProvider"])

    def close(self):
        self.session = None

    def detect(self, frame):
        import cv2
        import numpy as np
        height, width = frame.shape[:2]
        scale = min(YUNET_SIZE / width, YUNET_SIZE / height)
        resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
        canvas = np.zeros((YUNET_SIZE, YUNET_SIZE, 3), np.uint8)
        canvas[:resized.shape[0], :resized.shape[1]] = resized
        inputs = {"input": canvas.transpose(2, 0, 1)[None].astype(np.float32)}
        try:
            values = self.session.run(None, inputs)
        except Exception:
            if self.device != "cuda":
                raise WorkerError("internal") from None
            self.session = None
            self.session = self.factory(["CPUExecutionProvider"])
            self.device = "cpu"
            values = self.session.run(None, inputs)
        outputs = dict(zip((o.name for o in self.session.get_outputs()), values))
        faces = []
        for stride in (8, 16, 32):
            scores = np.sqrt(np.clip(outputs[f"cls_{stride}"][0, :, 0], 0, 1) *
                             np.clip(outputs[f"obj_{stride}"][0, :, 0], 0, 1))
            boxes = outputs[f"bbox_{stride}"][0]
            columns = YUNET_SIZE // stride
            for index in np.flatnonzero(scores >= FACE_THRESHOLD):
                dx, dy, dw, dh = boxes[index]
                cx, cy = ((index % columns + dx) * stride, (index // columns + dy) * stride)
                w, h = math.exp(min(10, float(dw))) * stride, math.exp(min(10, float(dh))) * stride
                x1, y1 = max(0, (cx - w / 2) / scale), max(0, (cy - h / 2) / scale)
                x2, y2 = min(width, (cx + w / 2) / scale), min(height, (cy + h / 2) / scale)
                if x2 > x1 and y2 > y1:
                    faces.append(Detection(float(x1 / width), float(y1 / height),
                                           float((x2 - x1) / width), float((y2 - y1) / height), float(scores[index])))
        kept = []
        for face in sorted(faces, key=lambda f: f.score, reverse=True):
            if all(iou(face, other) <= NMS_THRESHOLD for other in kept):
                kept.append(face)
        return kept


def ffmpeg_run(arguments, ctx):
    """No shell; bounded-memory stderr, cancellation also terminates FFmpeg."""
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            while process.poll() is None:
                ctx.checkpoint()
                time.sleep(0.05)
            ctx.checkpoint()
            if process.returncode:
                raise WorkerError("internal")
            log.seek(0)
            return log.read().decode("utf-8", errors="replace")
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def analyze(detector, params, ctx):
    import cv2
    started = time.perf_counter()
    start, end = params["start_us"], params["end_us"]
    layout = params.get("layout", "face")
    split_ratio = params.get("split_ratio")
    duration = (end - start) / 1_000_000
    with tempfile.TemporaryDirectory(prefix="clipes-reframe-") as directory:
        proxy = str(Path(directory) / "proxy.mkv")
        ctx.progress("reframe_proxy", 1, "Preparando análise do Corte")
        ffmpeg_run([params["ffmpeg"], "-nostdin", "-y", "-v", "error", "-threads", "2",
                    "-ss", f"{start / 1e6:.6f}", "-i", params["source"], "-t", f"{duration:.6f}",
                    "-map", "0:v:0", "-an", "-sn", "-vf",
                    f"fps={ANALYSIS_FPS},scale=trunc(oh*dar/2)*2:{PROXY_HEIGHT},setsar=1", "-c:v", "ffv1", proxy], ctx)
        ctx.progress("reframe_scenes", 20, "Analisando cenas do Corte")
        log = ffmpeg_run([params["ffmpeg"], "-nostdin", "-v", "info", "-threads", "2", "-i", proxy,
                          "-vf", f"scdet=t={SCENE_THRESHOLD},metadata=print", "-an", "-f", "null", "-"], ctx)
        cuts = scene_frames(log)
        video = cv2.VideoCapture(proxy)
        if not video.isOpened():
            raise WorkerError("internal")
        width, height = video.get(cv2.CAP_PROP_FRAME_WIDTH), video.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not width or not height:
            video.release()
            raise WorkerError("internal")
        count = 0
        gray_samples = []
        frame_dets = []
        def frames():
            nonlocal count
            while True:
                ctx.checkpoint()
                ok, frame = video.read()
                if not ok:
                    break
                stamp = start + count * 1_000_000 // ANALYSIS_FPS
                if stamp >= end:
                    break
                detections = detector.detect(frame)
                if layout == "gameplay_webcam":
                    frame_dets.append(detections)
                    if len(gray_samples) < 24 and (count % max(1, round(duration * ANALYSIS_FPS / 24)) == 0):
                        gray = cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY)
                        gray_samples.append(gray)
                yield stamp, detections, count in cuts
                count += 1
                ctx.progress("reframe_faces", min(99, 25 + round(74 * count / max(1, duration * ANALYSIS_FPS))),
                             "Analisando enquadramento do Corte")
        extra_metrics = {}
        try:
            aspect = width / height
            if layout == "gameplay_webcam":
                for _ in frames():
                    pass
                edge_map = temporal_edge_map(gray_samples)
                ratio = DEFAULT_GAMEPLAY_SPLIT if split_ratio is None else split_ratio
                top_segs, bot_segs, wc_detected, wc_conf = gameplay_webcam_timelines(
                    frame_dets, edge_map, start, end, aspect, ratio
                )
                result = {
                    "schemaVersion": 1,
                    "revision": 1,
                    "status": "suggestion",
                    "segments": top_segs,
                    "secondarySegments": bot_segs,
                }
                extra_metrics = {"webcamDetected": wc_detected, "webcamConfidence": wc_conf}
            elif layout == "two_people":
                ratio = 0.50 if split_ratio is None else split_ratio
                top_segs, bot_segs = two_people_timelines(frames(), start, end, aspect, ratio)
                result = {
                    "schemaVersion": 1,
                    "revision": 1,
                    "status": "suggestion",
                    "segments": top_segs,
                    "secondarySegments": bot_segs,
                }
            else:
                result = timeline(frames(), start, end, aspect)
        finally:
            video.release()
        if not count:
            raise WorkerError("internal")
    ctx.checkpoint()
    result["metrics"] = {"device": detector.device, "frames": count,
                         "elapsedMs": round((time.perf_counter() - started) * 1000), **extra_metrics}
    return result


def reframe_task(loader=Yunet, runner=analyze):
    def resolve(params):
        model = params.get("model", {})
        start, end = params.get("start_us"), params.get("end_us")
        layout = params.get("layout", "face")
        split_ratio = params.get("split_ratio")
        if (not isinstance(model, dict) or not all(isinstance(params.get(k), str) and params[k] for k in ("source", "ffmpeg"))
                or type(start) is not int or type(end) is not int or not 0 <= start < end
                or layout not in SUPPORTED_LAYOUTS
                or (split_ratio is not None and (type(split_ratio) not in (int, float) or isinstance(split_ratio, bool) or not 0.1 <= float(split_ratio) <= 0.9))
                or not isinstance(model.get("path"), str) or not model["path"]
                or model.get("device") not in ("cpu", "cuda")):
            raise WorkerError("invalid_message")
        return "yunet:" + model["device"], lambda: loader(model["path"], model["device"])
    return Task("yunet", lambda: None, runner, resolve=resolve)
