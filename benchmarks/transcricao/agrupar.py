"""Benchmark do agrupamento de trechos de VAD (#162): atual (um trecho por chamada) × agrupado.

Usa o mesmo caminho do Motor local (`clipes_worker.transcribe`): VAD Silero, idioma por trecho,
`BatchedInferencePipeline`, beam 5, `word_timestamps`. A única diferença é o tamanho do grupo.

    py agrupar.py run --wav pt.wav --model-dir <dir> --device cuda --compute-type int8_float16 \
        --batch-size 1 --groups 1,2,4,8 --seconds 600 --output saida.json
    py agrupar.py compare saida-pt.json saida-en.json

Sem referência de texto, a qualidade é medida contra a execução atual: pela desigualdade
triangular, o WER de cada execução contra o texto verdadeiro difere do WER da outra em no máximo
(edições entre elas ÷ palavras da execução atual), e o erro de tempo de cada palavra difere em no
máximo a diferença entre os tempos das duas execuções.
"""
import argparse
import json
import statistics
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "worker" / "src"))

from metrics import alignment, tokens  # noqa: E402


class Ctx:
    def progress(self, *_):
        pass

    def checkpoint(self):
        pass


class VramPeak:
    """Pico de VRAM usada na GPU 0 (NVML), amostrado a cada 100 ms."""

    def __init__(self, enabled):
        self.peak, self._stop, self._thread = 0, threading.Event(), None
        if enabled:
            import pynvml

            pynvml.nvmlInit()
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._nvml = pynvml
            self._thread = threading.Thread(target=self._sample, daemon=True)
            self._thread.start()

    def _sample(self):
        while not self._stop.wait(0.1):
            self.peak = max(self.peak, self._nvml.nvmlDeviceGetMemoryInfo(self._handle).used)

    def stop(self):
        self._stop.set()
        return round(self.peak / 2**20)


def run(args):
    from clipes_worker.transcribe import SAMPLE_RATE, load_faster_whisper, read_wav

    audio = read_wav(args.wav)[: int(args.seconds * SAMPLE_RATE)]
    started = time.monotonic()
    transcriber = load_faster_whisper(args.model_dir, args.device, args.compute_type)
    load_s = time.monotonic() - started
    transcriber.block(audio[: 20 * SAMPLE_RATE], True, args.batch_size, Ctx())  # aquecimento
    runs = []
    for group in [int(g) for g in args.groups.split(",")]:
        for repeat in range(args.repeats):
            vram = VramPeak(args.device == "cuda")
            started = time.monotonic()
            try:
                result = transcriber.block(audio, True, args.batch_size, Ctx(), group_size=group)
                error = None
            except Exception as exc:  # a falta de memória é um resultado, não um erro do benchmark
                result, error = None, type(exc).__name__ + ": " + getattr(exc, "code", str(exc))[:80]
            elapsed = time.monotonic() - started
            peak = vram.stop()
            runs.append({
                "group": group, "repeat": repeat, "seconds": round(elapsed, 3), "error": error,
                "vram_peak_mib": peak, "words": result["words"] if result else None,
            })
            print(group, repeat, round(elapsed, 1), error or len(result["words"]), flush=True)
    out = {"wav": Path(args.wav).name, "audio_s": len(audio) / SAMPLE_RATE, "device": args.device,
           "compute_type": args.compute_type, "batch_size": args.batch_size, "load_s": round(load_s, 2),
           "runs": runs}
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


def percentile(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(q * len(values)))] if values else None


def divergence(reference, other):
    """Edições entre as duas execuções e diferenças de tempo (ms) das palavras pareadas."""
    ref = [" ".join(tokens(w["text"])) for w in reference]
    hyp = [" ".join(tokens(w["text"])) for w in other]
    edits, pairs = alignment(ref, hyp)
    starts, ends = [], []
    for i, j in pairs:
        if ref[i] == hyp[j]:
            starts.append(abs(reference[i]["start_us"] - other[j]["start_us"]) / 1000)
            ends.append(abs(reference[i]["end_us"] - other[j]["end_us"]) / 1000)
    return {
        "wer_pp": round(100 * edits / max(1, len(ref)), 3),
        "paired": len(starts),
        "start_median_ms": statistics.median(starts) if starts else None,
        "end_median_ms": statistics.median(ends) if ends else None,
        "start_p95_ms": percentile(starts, 0.95),
        "end_p95_ms": percentile(ends, 0.95),
        "start_max_ms": max(starts, default=None),
    }


def summarize(data):
    """Por grupo: tempo (mediana das repetições), RTF, VRAM e divergência contra o grupo 1."""
    baseline = next(r for r in data["runs"] if r["group"] == 1 and r["words"] is not None)
    rows = []
    for group in sorted({r["group"] for r in data["runs"]}):
        mine = [r for r in data["runs"] if r["group"] == group]
        ok = [r for r in mine if r["words"] is not None]
        if not ok:
            rows.append({"group": group, "error": mine[0]["error"], "vram_peak_mib": mine[0]["vram_peak_mib"]})
            continue
        seconds = statistics.median(r["seconds"] for r in ok)
        rows.append({
            "group": group, "seconds": round(seconds, 1), "rtf": round(seconds / data["audio_s"], 3),
            "words": len(ok[0]["words"]), "vram_peak_mib": max(r["vram_peak_mib"] for r in ok),
            "repeats": [r["seconds"] for r in ok],
            **({} if group == 1 else divergence(baseline["words"], ok[0]["words"])),
        })
    base = rows[0]["seconds"]
    for row in rows:
        if "seconds" in row:
            row["speedup"] = round(base / row["seconds"], 2)
    return rows


def compare(args):
    for path in args.results:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        print(f"## {data['wav']} {data['device']} {data['compute_type']} ({data['audio_s']:.0f} s)")
        print(json.dumps(summarize(data), indent=1, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--wav", required=True)
    r.add_argument("--model-dir", required=True)
    r.add_argument("--device", choices=["cpu", "cuda"], required=True)
    r.add_argument("--compute-type", required=True)
    r.add_argument("--batch-size", type=int, default=1)
    r.add_argument("--groups", default="1,2,4,8")
    r.add_argument("--seconds", type=float, default=600)
    r.add_argument("--repeats", type=int, default=1)
    r.add_argument("--output", required=True)
    c = sub.add_parser("compare")
    c.add_argument("results", nargs="+")
    args = parser.parse_args()
    run(args) if args.command == "run" else compare(args)


if __name__ == "__main__":
    main()
