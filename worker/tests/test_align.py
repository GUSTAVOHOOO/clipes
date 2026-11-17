"""Tarefa `align` com modelos falsos: validação, janelas <= 30 s, mapeamento e OOM."""

import io
import json

import pytest

from clipes_worker.align import (
    MAX_ALIGN_WINDOW_SAMPLES,
    Aligner,
    align_task,
    map_aligned_to_script_words,
    pack_windows,
    partition_script_words,
)
from clipes_worker.protocol import WorkerError
from clipes_worker.server import Server
from clipes_worker.transcribe import SAMPLE_RATE


class Ctx:
    def __init__(self):
        self.events = []

    def progress(self, stage, percentage, message):
        self.events.append((stage, percentage, message))

    def checkpoint(self):
        pass


MODEL = {"id": "m", "dir": "x", "device": "cpu", "compute_type": "int8"}


def run_align(params, tasks):
    out = io.StringIO()
    lines = [
        json.dumps({"v": 1, "type": "request", "id": "r1", "task": "align", "params": params})
        + "\n",
        '{"v":1,"type":"shutdown"}\n',
    ]
    Server(lines, out, tasks).serve()
    return [json.loads(line) for line in out.getvalue().splitlines()]


def test_align_returns_spoken_and_forced_script_words_with_offset():
    audio = [0.0] * (SAMPLE_RATE * 5)
    aligner = Aligner(
        lambda a: [{"start": SAMPLE_RATE, "end": SAMPLE_RATE * 4}],
        lambda chunk, lang, batch: [(" Olá", 0.2, 0.5), ("improviso", 0.6, 1.0), ("mundo.", 1.1, 1.5)],
        lambda chunk, text, lang: [
            {"word": " Olá", "start": 0.22, "end": 0.48, "probability": 0.96},
            {"word": " mundo.", "start": 1.12, "end": 1.48, "probability": 0.99},
        ],
    )
    result = aligner.align(audio, "Olá mundo.", "pt", 1, Ctx())
    assert result["silences"] == [
        {"start_us": 0, "end_us": 1_000_000},
        {"start_us": 4_000_000, "end_us": 5_000_000},
    ]
    assert [w["text"] for w in result["spoken_words"]] == ["Olá", "improviso", "mundo."]
    assert (result["spoken_words"][0]["start_us"], result["spoken_words"][0]["end_us"]) == (1_200_000, 1_500_000)
    assert [w["text"] for w in result["script_words"]] == ["Olá", "mundo."]
    assert (result["script_words"][0]["start_us"], result["script_words"][0]["end_us"]) == (1_220_000, 1_480_000)
    assert result["script_words"][0]["probability"] == 0.96


def test_pack_windows_splits_above_30s_and_partitions_script_words():
    # Dois trechos separados: 0..20s e 25..45s -> 2 janelas <= 30s
    spans = [
        {"start": 0, "end": 20 * SAMPLE_RATE},
        {"start": 25 * SAMPLE_RATE, "end": 45 * SAMPLE_RATE},
    ]
    windows = pack_windows(spans, 45 * SAMPLE_RATE)
    assert len(windows) == 2
    assert all(w["end"] - w["start"] <= MAX_ALIGN_WINDOW_SAMPLES for w in windows)

    ref_words = ["um", "dois", "tres", "quatro", "cinco"]
    spoken = [
        {"text": "um", "start_us": 1_000_000, "end_us": 2_000_000},
        {"text": "dois", "start_us": 3_000_000, "end_us": 4_000_000},
        {"text": "quatro", "start_us": 26_000_000, "end_us": 27_000_000},
        {"text": "cinco", "start_us": 28_000_000, "end_us": 29_000_000},
    ]
    parts = partition_script_words(ref_words, spoken, windows)
    assert parts == [["um", "dois", "tres"], ["quatro", "cinco"]]


def test_align_handles_long_audio_over_30s_window_by_window():
    audio = [0.0] * (SAMPLE_RATE * 46)
    spans = [
        {"start": 0, "end": 20 * SAMPLE_RATE},
        {"start": 26 * SAMPLE_RATE, "end": 46 * SAMPLE_RATE},
    ]
    seen_chunks = []

    def transcribe(chunk, lang, batch):
        if len(seen_chunks) == 0:
            seen_chunks.append("t1")
            return [(" um", 1.0, 2.0), ("dois", 2.5, 3.0)]
        seen_chunks.append("t2")
        return [(" tres", 1.0, 2.0), ("quatro", 2.5, 3.0)]

    aligned_calls = []

    def force_align(chunk, text, lang):
        assert len(chunk) <= MAX_ALIGN_WINDOW_SAMPLES
        aligned_calls.append(text)
        return [
            {"word": f" {w}", "start": 1.0 + i, "end": 1.5 + i, "probability": 0.9}
            for i, w in enumerate(text.split())
        ]

    result = Aligner(lambda a: spans, transcribe, force_align).align(
        audio, "um dois tres quatro", "pt", 1, Ctx()
    )
    assert aligned_calls == ["um dois", "tres quatro"]
    assert [(w["text"], w["start_us"]) for w in result["script_words"]] == [
        ("um", 1_000_000),
        ("dois", 2_000_000),
        ("tres", 27_000_000),
        ("quatro", 28_000_000),
    ]


def test_map_aligned_merges_hyphenated_words_and_handles_empty():
    merged = map_aligned_to_script_words(
        ["bem-vindo", "aqui."],
        [
            {"word": " bem", "start": 0.1, "end": 0.3, "probability": 0.8},
            {"word": "-vindo", "start": 0.3, "end": 0.6, "probability": 1.0},
            {"word": " aqui.", "start": 0.7, "end": 1.0, "probability": 0.9},
        ],
        0.0,
        2.0,
    )
    assert [(w["text"], round(w["start"], 2), round(w["end"], 2)) for w in merged] == [
        ("bem-vindo", 0.1, 0.6),
        ("aqui.", 0.7, 1.0),
    ]

    fallback = map_aligned_to_script_words(["um", "dois"], [], 0.0, 2.0)
    assert len(fallback) == 2
    assert fallback[0]["start"] == 0.0 and fallback[1]["end"] == 2.0


def test_align_fallback_when_vad_has_no_spans():
    audio = [0.0] * (SAMPLE_RATE * 2)
    aligner = Aligner(
        lambda a: [],
        lambda chunk, lang, batch: [(" oi", 0.1, 0.4)],
        lambda chunk, text, lang: [{"word": " oi", "start": 0.1, "end": 0.4, "probability": 0.9}],
    )
    result = aligner.align(audio, "oi", "pt", 1, Ctx())
    assert [w["text"] for w in result["script_words"]] == ["oi"]


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"audio": "a.wav", "text": "", "language": "pt", "model": MODEL},
        {"audio": "a.wav", "text": "   ", "language": "pt", "model": MODEL},
        {"audio": "a.wav", "text": "oi", "language": "xx", "model": MODEL},
        {"audio": "a.wav", "text": "oi", "model": MODEL},
        {"audio": "a.wav", "text": "oi", "language": "pt", "batch_size": 0, "model": MODEL},
        {"audio": "a.wav", "text": "oi", "language": "pt", "model": {**MODEL, "device": "tpu"}},
    ],
)
def test_align_invalid_parameters_get_typed_error(params):
    task = align_task(loader=lambda *a: Aligner(lambda _: [], None, None), reader=lambda p: [0.0])
    messages = run_align(params, {"align": task})
    assert messages[0]["code"] == "invalid_message"


def test_align_missing_model_directory_reports_model_missing_without_path(tmp_path):
    task = align_task(reader=lambda p: [0.0])
    messages = run_align(
        {
            "audio": "a.wav",
            "text": "Olá mundo.",
            "language": "pt",
            "model": {**MODEL, "dir": str(tmp_path / "ausente")},
        },
        {"align": task},
    )
    assert messages[0]["code"] == "model_missing"
    assert str(tmp_path) not in json.dumps(messages)


def test_align_out_of_memory_is_reported_as_typed_error():
    aligner = Aligner(
        lambda a: [{"start": 0, "end": SAMPLE_RATE}],
        lambda *_: (_ for _ in ()).throw(RuntimeError("CUDA out of memory")),
        lambda *_: [],
    )
    with pytest.raises(WorkerError) as info:
        aligner.align([0.0] * SAMPLE_RATE, "olá", "pt", 1, Ctx())
    assert info.value.code == "out_of_memory"


def test_refine_word_silences_strips_cross_pause_bleed():
    import numpy as np
    from clipes_worker.align import refine_word_silences

    audio = np.zeros(SAMPLE_RATE * 2, dtype="float32")
    # Palavra 1: 0.05..0.25s; silêncio 0.25..0.75s; palavra 2: 0.75..1.05s
    audio[int(0.05 * SAMPLE_RATE) : int(0.25 * SAMPLE_RATE)] = 0.08
    audio[int(0.75 * SAMPLE_RATE) : int(1.05 * SAMPLE_RATE)] = 0.08
    # DTW sangrou a primeira palavra até 0.55s e a segunda começou cedo em 0.20s (cobrindo silêncio)
    items = [
        {"text": "My", "start": 0.00, "end": 0.55, "probability": 0.9},
        {"text": "name", "start": 0.20, "end": 1.15, "probability": 0.9},
    ]
    refined = refine_word_silences(items, audio)
    assert abs(refined[0]["start"] - 0.05) <= 0.02
    assert abs(refined[0]["end"] - 0.25) <= 0.02
    assert abs(refined[1]["start"] - 0.75) <= 0.02
    assert abs(refined[1]["end"] - 1.05) <= 0.02
