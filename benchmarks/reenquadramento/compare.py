"""Offline comparison. Inputs and detailed output MUST stay outside the repository.

Install scenedetect==0.6.7.1, tensorflow-cpu==2.20.0, cv2 and psutil in a
temporary environment. --transnet-dir points to the official pinned inference
directory (see report); this script never downloads code, weights or media.
Input filenames: <type>-<number>.mkv, already 480px / 5fps proxies.
"""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def detect(method, video, transnet):
    import cv2
    import numpy as np
    cv2.setNumThreads(2)
    if method == "scdet":
        result = subprocess.run(["ffmpeg", "-nostdin", "-v", "info", "-threads", "2", "-i", str(video),
            "-vf", "scdet=t=10,metadata=print", "-an", "-f", "null", "-"], capture_output=True, check=True)
        cuts = []
        for stamp in re.findall(r"lavfi\.scd\.time=([0-9.]+)", result.stderr.decode(errors="replace")):
            frame = round(float(stamp) * 5)
            if frame > 0 and (not cuts or frame - cuts[-1] >= 2):
                cuts.append(frame)
        return cuts
    cap = cv2.VideoCapture(str(video))
    if method == "pyscene":
        from scenedetect.detectors import AdaptiveDetector
        detector = AdaptiveDetector(adaptive_threshold=3, min_scene_len=3, min_content_val=15)
        cuts, i = [], 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            cuts.extend(detector.process_frame(i, frame))
            i += 1
        cap.release()
        return cuts
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    import tensorflow as tf
    tf.config.threading.set_intra_op_parallelism_threads(2)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    sys.path.insert(0, str(transnet))
    from transnetv2 import TransNetV2
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(cv2.resize(frame, (48, 27)), cv2.COLOR_BGR2RGB))
    cap.release()
    with contextlib.redirect_stdout(io.StringIO()):
        model = TransNetV2(str(Path(transnet) / "transnetv2-weights"))
        predictions, _ = model.predict_frames(np.asarray(frames))
    # One boundary for each contiguous transition region, avoiding double counts.
    active = predictions > 0.5
    return [i for i in range(1, len(active)) if active[i] and not active[i-1]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--transnet-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--method", choices=["scdet", "pyscene", "transnet"])
    parser.add_argument("--video", type=Path)
    args = parser.parse_args()
    if args.method:
        started = time.perf_counter()
        cuts = detect(args.method, args.video, args.transnet_dir)
        print(json.dumps({"cuts": cuts, "seconds": time.perf_counter() - started}))
        return
    import psutil
    results = []
    for video in sorted(args.directory.glob("*.mkv")):
        for method in ("scdet", "pyscene", "transnet"):
            with __import__("tempfile").TemporaryFile() as log:
                child = subprocess.Popen([sys.executable, __file__, "--method", method, "--video", str(video),
                    "--transnet-dir", str(args.transnet_dir)], stdout=log, stderr=subprocess.DEVNULL)
                proc, peak = psutil.Process(child.pid), 0
                while child.poll() is None:
                    try:
                        peak = max(peak, proc.memory_info().rss + sum(p.memory_info().rss for p in proc.children(recursive=True)))
                    except psutil.Error:
                        pass
                    time.sleep(0.05)
                log.seek(0)
                raw = log.read().decode()
            result = json.loads(raw) if child.returncode == 0 else {"failed": True}
            result.update(method=method, sample=video.stem, peakMiB=round(peak / 1024**2, 1))
            results.append(result)
            print(video.stem, method, len(result.get("cuts", [])), result.get("seconds"), flush=True)
    args.output.write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
