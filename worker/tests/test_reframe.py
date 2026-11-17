import io
import json

import numpy as np
import pytest

from clipes_worker.protocol import WorkerError
from clipes_worker.reframe import Yunet, reframe_task, analyze, scene_frames


def test_adjacent_exposure_signals_are_a_single_scene_boundary():
    assert scene_frames("lavfi.scd.time=0.0\nlavfi.scd.time=1.0\nlavfi.scd.time=1.2\nlavfi.scd.time=2.0") == {5, 10}
from clipes_worker.server import Server


def test_yunet_decodes_onnx_heads_and_suppresses_duplicate_boxes(tmp_path):
    checkpoint = tmp_path / "yunet.onnx"
    checkpoint.write_bytes(b"fake")
    class Session:
        def get_providers(self):
            return ["CPUExecutionProvider"]

        def get_outputs(self):
            return [type("Output", (), {"name": f"{head}_{s}"})()
                    for head in ("cls", "obj", "bbox", "kps") for s in (8, 16, 32)]

        def run(self, _, inputs):
            assert inputs["input"].shape == (1, 3, 640, 640)
            values = []
            for head in ("cls", "obj", "bbox", "kps"):
                for stride in (8, 16, 32):
                    n = (640 // stride) ** 2
                    value = np.zeros((1, n, 4 if head == "bbox" else 10 if head == "kps" else 1), np.float32)
                    if stride == 8 and head in ("cls", "obj"):
                        value[0, 20 * 80 + 20, 0] = 0.95
                    if stride == 8 and head == "bbox":
                        value[0, 20 * 80 + 20] = [0, 0, np.log(10), np.log(10)]
                    values.append(value)
            return values
    detector = Yunet(str(checkpoint), "cpu", session_factory=lambda providers: Session())
    faces = detector.detect(np.zeros((480, 640, 3), np.uint8))
    assert len(faces) == 1
    assert faces[0].x == pytest.approx(120 / 640)
    assert faces[0].y == pytest.approx(120 / 480)
    assert faces[0].width == pytest.approx(80 / 640)


def test_cuda_failure_uses_the_same_checkpoint_on_cpu(tmp_path):
    checkpoint = tmp_path / "yunet.onnx"
    checkpoint.write_bytes(b"fake")
    attempts = []
    class Session:
        def get_providers(self):
            return ["CPUExecutionProvider"]

    def factory(providers):
        attempts.append(providers)
        if providers[0] == "CUDAExecutionProvider":
            raise RuntimeError("private path must not escape")
        return Session()
    detector = Yunet(str(checkpoint), "cuda", session_factory=factory)
    assert detector.device == "cpu"
    assert len(attempts) == 2


@pytest.mark.parametrize("params", [
    {},
    {"source": "x", "start_us": -1},
    {"source": "x", "ffmpeg": "f", "start_us": True, "end_us": 10, "model": {"path": "m", "device": "cpu"}},
    {"source": "x", "ffmpeg": "f", "start_us": 0, "end_us": 10, "layout": "unknown", "model": {"path": "m", "device": "cpu"}},
    {"source": "x", "ffmpeg": "f", "start_us": 0, "end_us": 10, "layout": "gameplay_webcam", "split_ratio": 0.99, "model": {"path": "m", "device": "cpu"}},
])
def test_invalid_request_is_rejected_before_loading(params):
    task = reframe_task(loader=lambda *args: pytest.fail("must not load"))
    with pytest.raises(WorkerError, match="invalid_message"):
        task.resolve(params)


def test_task_uses_model_slot_and_returns_suggestion_without_paths():
    params = {"source": "local", "ffmpeg": "local-ffmpeg", "start_us": 1_000_000,
              "end_us": 2_000_000, "model": {"path": "local-model", "device": "cpu"}}
    task = reframe_task(loader=lambda *args: object(),
                        runner=lambda model, params, ctx: {"schemaVersion": 1, "status": "suggestion"})
    out = io.StringIO()
    Server([json.dumps({"v": 1, "type": "request", "id": "r1", "task": "reframe", "params": params}),
            '{"v":1,"type":"shutdown"}'], out, {"reframe": task}).serve()
    messages = [json.loads(s) for s in out.getvalue().splitlines()]
    assert messages[0]["event"] == "model_loaded"
    assert messages[-1]["data"]["status"] == "suggestion"
    assert "local-model" not in out.getvalue()


def test_real_ffmpeg_on_synthetic_video_with_fake_detections(tmp_path):
    """Exercises scene metadata, proxy and absolute µs; no fake face is sent to YuNet."""
    import shutil
    import subprocess
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg local indisponível")
    source = tmp_path / "synthetic.mkv"
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=black:s=640x360:r=25:d=1",
                    "-f", "lavfi", "-i", "color=white:s=640x360:r=25:d=1", "-filter_complex",
                    "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "ffv1", str(source)], check=True)
    class Context:
        def checkpoint(self):
            pass
        def progress(self, *args):
            pass
    class Detector:
        device = "cpu"
        def detect(self, frame):
            assert max(frame.shape[:2]) <= 854
            return []
    data = analyze(Detector(), {"source": str(source), "ffmpeg": ffmpeg,
                                "start_us": 200_000, "end_us": 1_800_000}, Context())
    assert len(data["segments"]) == 2
    assert data["segments"][0]["startUs"] == 200_000
    assert data["segments"][-1]["endUs"] == 1_800_000
    assert data["segments"][1]["reason"] == "scene"

    # Testa os layouts multi-painel (gameplay_webcam e two_people) sobre vídeo sintético
    from clipes_worker.reframe_camera import Detection
    class SyntheticWebcamDetector:
        device = "cpu"
        def detect(self, frame):
            return [Detection(0.08, 0.12, 0.08, 0.12, 0.91)]
    wc_data = analyze(SyntheticWebcamDetector(), {
        "source": str(source), "ffmpeg": ffmpeg, "start_us": 200_000, "end_us": 1_800_000,
        "layout": "gameplay_webcam", "split_ratio": 0.30,
    }, Context())
    assert wc_data["secondarySegments"]
    assert wc_data["metrics"]["webcamDetected"] is True
    assert wc_data["metrics"]["webcamConfidence"] <= 0.65

    tp_data = analyze(Detector(), {
        "source": str(source), "ffmpeg": ffmpeg, "start_us": 200_000, "end_us": 1_800_000,
        "layout": "two_people", "split_ratio": 0.50,
    }, Context())
    assert len(tp_data["segments"]) == 2
    assert len(tp_data["secondarySegments"]) == 2


@pytest.mark.skipif(not __import__("os").environ.get("CLIPES_YUNET_MANUAL_FACE"),
                    reason="manual: imagem CC0 e modelo locais, nunca baixados por teste")
def test_yunet_real_manual():
    import cv2
    import os
    detector = Yunet(os.environ["CLIPES_YUNET_MANUAL_MODEL"], "cpu")
    assert detector.detect(cv2.imread(os.environ["CLIPES_YUNET_MANUAL_FACE"]))
