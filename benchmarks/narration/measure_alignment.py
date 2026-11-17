"""Medição offline de precisão de bordas da Narração (#81) sobre amostra própria PT/EN."""

import argparse
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker" / "src"))

from clipes_worker.align import load_faster_whisper_aligner
from clipes_worker.transcribe import read_wav


class _DummyCtx:
    def progress(self, *args):
        pass

    def checkpoint(self):
        pass


def percentile(values, q):
    ordered = sorted(values)
    if not ordered:
        return 0.0
    pos = (len(ordered) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def evaluate(ref_path, model_dir, device="cpu", compute_type="int8"):
    data = json.loads(Path(ref_path).read_text(encoding="utf-8"))
    aligner = load_faster_whisper_aligner(model_dir, device, compute_type)
    errors_ms = []
    block_reports = []

    for block in data["blocks"]:
        audio_path = ROOT / block["audio"]
        audio = read_wav(audio_path)
        result = aligner.align(audio, block["script_text"], block["language"], 1, _DummyCtx())
        script_words = result["script_words"]
        expected_tokens = block["script_text"].strip().split()
        if len(script_words) != len(expected_tokens):
            raise AssertionError(
                f"Contagem divergente em {block['id']}: {len(script_words)} != {len(expected_tokens)}"
            )

        block_errs = []
        word_details = []
        for ref in block["reference_words"]:
            idx = int(ref["index"])
            hyp = script_words[idx]
            detail = {"index": idx, "word": ref["word"]}
            if ref.get("start_s") is not None:
                hyp_s = hyp["start_us"] / 1_000_000.0
                err_ms = abs(hyp_s - ref["start_s"]) * 1000.0
                errors_ms.append(err_ms)
                block_errs.append(err_ms)
                detail["start_err_ms"] = round(err_ms, 1)
            if ref.get("end_s") is not None:
                hyp_e = hyp["end_us"] / 1_000_000.0
                err_ms = abs(hyp_e - ref["end_s"]) * 1000.0
                errors_ms.append(err_ms)
                block_errs.append(err_ms)
                detail["end_err_ms"] = round(err_ms, 1)
            word_details.append(detail)

        block_reports.append(
            {
                "id": block["id"],
                "language": block["language"],
                "annotated_words": len(block["reference_words"]),
                "boundaries": len(block_errs),
                "median_ms": round(percentile(block_errs, 0.5), 1),
                "p90_ms": round(percentile(block_errs, 0.9), 1),
                "max_ms": round(max(block_errs), 1),
                "details": word_details,
            }
        )

    return {
        "total_words": sum(b["annotated_words"] for b in block_reports),
        "total_boundaries": len(errors_ms),
        "median_ms": round(percentile(errors_ms, 0.5), 1),
        "p90_ms": round(percentile(errors_ms, 0.9), 1),
        "max_ms": round(max(errors_ms), 1),
        "blocks": block_reports,
    }


def main():
    parser = argparse.ArgumentParser(description="Mede precisão de bordas da Narração (#81)")
    parser.add_argument(
        "--reference",
        default=str(Path(__file__).with_name("sample_reference.json")),
    )
    parser.add_argument(
        "--model-dir",
        default=os.environ.get("CLIPES_ALIGN_TEST_MODEL_DIR", ""),
    )
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    if not args.model_dir or not Path(args.model_dir).is_dir():
        raise SystemExit("Defina --model-dir ou CLIPES_ALIGN_TEST_MODEL_DIR com um modelo Whisper local.")

    summary = evaluate(args.reference, args.model_dir, args.device, args.compute_type)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    if summary["total_words"] < 20:
        raise SystemExit("Amostra precisa ter >= 20 palavras anotadas.")
    if summary["median_ms"] > 80.0 or summary["p90_ms"] > 200.0:
        raise SystemExit(
            f"Fora do alvo (mediana={summary['median_ms']} ms, p90={summary['p90_ms']} ms)."
        )


if __name__ == "__main__":
    main()
