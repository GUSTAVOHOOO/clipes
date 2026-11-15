"""Manual offline YuNet RTF/RAM measurement; detailed results stay outside Git."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    import psutil
    from clipes_worker.reframe import Yunet, analyze
    class Context:
        def checkpoint(self):
            pass
        def progress(self, *args):
            pass
    class Detector:
        def __init__(self, detector):
            self.detector, self.faces = detector, 0
        @property
        def device(self):
            return self.detector.device
        def detect(self, frame):
            faces = self.detector.detect(frame)
            self.faces += bool(faces)
            return faces
    load = time.perf_counter()
    model = Detector(Yunet(args.checkpoint, args.device))
    load = time.perf_counter() - load
    results = []
    for source in sorted(args.directory.glob("*.mkv")):
        stop = threading.Event()
        peak = [0]
        proc = psutil.Process()
        def monitor():
            while not stop.wait(0.05):
                try:
                    peak[0] = max(peak[0], proc.memory_info().rss + sum(c.memory_info().rss for c in proc.children(recursive=True)))
                except psutil.Error:
                    pass
        thread = threading.Thread(target=monitor)
        thread.start()
        model.faces = 0
        started = time.perf_counter()
        try:
            data = analyze(model, {"source": str(source), "ffmpeg": "ffmpeg",
                                  "start_us": 0, "end_us": 40_000_000}, Context())
        finally:
            stop.set()
            thread.join()
        seconds = time.perf_counter() - started
        result = {"sample": source.stem, "seconds": seconds, "rtf": seconds / 40,
                  "peakMiB": round(peak[0] / 1024**2, 1), "faceFrames": model.faces,
                  "metrics": data["metrics"], "segments": len(data["segments"])}
        results.append(result)
        print(json.dumps(result), flush=True)
    args.output.write_text(json.dumps({"loadSeconds": load, "requestedDevice": args.device,
                                      "device": model.device, "results": results}, indent=2))


if __name__ == "__main__":
    main()
