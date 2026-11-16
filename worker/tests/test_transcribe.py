"""Tarefa `transcribe` com modelos falsos: costura entre blocos, silêncios, validação e VAD."""

import io
import json

import pytest

from clipes_worker.protocol import WorkerError
from clipes_worker.server import Server
from clipes_worker.transcribe import (
    VAD_MAX_SPEECH_S,
    VAD_MIN_SILENCE_MS,
    VAD_THRESHOLD,
    Transcriber,
    read_wav,
    transcribe_task,
)


class Ctx:
    def __init__(self):
        self.events = []

    def progress(self, stage, percentage, message):
        self.events.append(percentage)

    def checkpoint(self):
        pass


def make(spans, words=((" a", 0.0, 0.2),)):
    return Transcriber(
        lambda audio: spans, lambda chunk: "pt", lambda chunk, language, batch: list(words)
    )


def test_speech_touching_the_block_end_is_deferred_to_the_next_block():
    audio = [0.0] * 160000
    result = make([{"start": 16000, "end": 48000}, {"start": 100000, "end": 160000}]).block(
        audio, False, 1, Ctx()
    )
    assert result["covered_us"] == 6_250_000
    assert [w["text"] for w in result["words"]] == ["a"]
    assert result["silences"][-1] == {"start_us": 3_000_000, "end_us": 6_250_000}


def test_final_block_keeps_the_last_span_and_covers_everything():
    audio = [0.0] * 160000
    result = make([{"start": 16000, "end": 48000}, {"start": 100000, "end": 160000}]).block(
        audio, True, 1, Ctx()
    )
    assert result["covered_us"] == 10_000_000
    assert len(result["words"]) == 2


def test_a_single_span_starting_at_zero_is_not_deferred_to_avoid_a_loop():
    audio = [0.0] * 160000
    result = make([{"start": 0, "end": 160000}]).block(audio, False, 1, Ctx())
    assert result["covered_us"] == 10_000_000
    assert len(result["words"]) == 1


def test_silence_without_speech_is_one_explicit_segment():
    result = make([]).block([0.0] * 32000, True, 1, Ctx())
    assert result == {
        "covered_us": 2_000_000,
        "words": [],
        "silences": [{"start_us": 0, "end_us": 2_000_000}],
    }


def test_word_times_are_native_offsets_plus_span_start_without_correction():
    result = make([{"start": 16000, "end": 32000}], words=((" oi", 0.25, 0.5),)).block(
        [0.0] * 48000, True, 1, Ctx()
    )
    assert (result["words"][0]["start_us"], result["words"][0]["end_us"]) == (1_250_000, 1_500_000)


def test_blank_words_are_dropped():
    result = make([{"start": 0, "end": 16000}], words=((" ", 0, 0.1), ("x", 0.1, 0.2))).block(
        [0.0] * 16000, True, 1, Ctx()
    )
    assert [w["text"] for w in result["words"]] == ["x"]


def test_language_is_detected_per_vad_span():
    languages = iter(["pt", "en"])
    transcriber = Transcriber(
        lambda audio: [{"start": 0, "end": 16000}, {"start": 32000, "end": 48000}],
        lambda chunk: next(languages),
        lambda chunk, language, batch: [(language, 0, 0.1)],
    )
    words = transcriber.block([0.0] * 48000, True, 1, Ctx())["words"]
    assert [(w["text"], w["language"]) for w in words] == [("pt", "pt"), ("en", "en")]


def test_vad_constants_follow_the_benchmark_with_the_documented_cap():
    assert (VAD_THRESHOLD, VAD_MIN_SILENCE_MS, VAD_MAX_SPEECH_S) == (0.75, 200, 30)


def run(params, tasks):
    out = io.StringIO()
    lines = [
        json.dumps({"v": 1, "type": "request", "id": "r1", "task": "transcribe", "params": params})
        + "\n",
        '{"v":1,"type":"shutdown"}\n',
    ]
    Server(lines, out, tasks).serve()
    return [json.loads(line) for line in out.getvalue().splitlines()]


MODEL = {"id": "m", "dir": "x", "device": "cpu", "compute_type": "int8"}


def test_model_slot_distinguishes_device_and_precision():
    task = transcribe_task(loader=lambda *a: make([]), reader=lambda p: [0.0])
    params = {"audio": "a.wav", "final": True, "batch_size": 1, "model": MODEL}
    cpu, _ = task.resolve(params)
    cuda, _ = task.resolve({**params, "model": {**MODEL, "device": "cuda"}})
    half, _ = task.resolve({**params, "model": {**MODEL, "device": "cuda", "compute_type": "float16"}})
    assert len({cpu, cuda, half}) == 3


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"audio": "a.wav", "final": True, "batch_size": 1},
        {"audio": "a.wav", "final": "sim", "batch_size": 1, "model": MODEL},
        {"audio": "a.wav", "final": True, "batch_size": 0, "model": MODEL},
        {"audio": "a.wav", "final": True, "batch_size": 1, "model": {**MODEL, "device": "tpu"}},
        {"audio": "a.wav", "final": True, "batch_size": 1, "model": {**MODEL, "compute_type": "x"}},
    ],
)
def test_invalid_parameters_get_a_typed_error(params):
    task = transcribe_task(loader=lambda *a: make([]), reader=lambda p: [0.0])
    messages = run(params, {"transcribe": task})
    assert messages[0]["code"] == "invalid_message"


def test_missing_model_directory_reports_model_missing(tmp_path):
    task = transcribe_task(reader=lambda p: [0.0])
    messages = run(
        {"audio": "a.wav", "final": True, "batch_size": 1, "model": {**MODEL, "dir": str(tmp_path / "nao")}},
        {"transcribe": task},
    )
    assert messages[0]["code"] == "model_missing"
    assert str(tmp_path) not in json.dumps(messages)


def test_read_wav_requires_16khz_mono_16bit(tmp_path):
    import wave

    def write(name, rate, channels):
        path = tmp_path / name
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(b"\x00\x40" * 10 * channels)
        return path

    audio = read_wav(write("ok.wav", 16000, 1))
    assert len(audio) == 10 and audio[0] == pytest.approx(0.5)
    for bad in (write("r.wav", 8000, 1), write("c.wav", 16000, 2)):
        with pytest.raises(WorkerError):
            read_wav(bad)
    with pytest.raises(WorkerError):
        read_wav(tmp_path / "nao-existe.wav")


def test_native_libraries_are_imported_before_the_stdin_reader_starts(monkeypatch):
    # No Windows, importar numpy com outra thread bloqueada no stdin travava o worker.
    from clipes_worker import server

    imported = []
    monkeypatch.setattr(server.importlib, "import_module", imported.append)
    server.preload_native_libraries()
    assert imported == ["numpy", "faster_whisper", "cv2", "onnxruntime"]
    monkeypatch.setattr(
        server.importlib, "import_module", lambda name: (_ for _ in ()).throw(ImportError(name))
    )
    server.preload_native_libraries()  # ausente: segue, a tarefa responde o erro tipado


def test_vad_task_shares_boundaries_and_silences_with_transcription():
    from clipes_worker.transcribe import vad_task

    spans = [{"start": 16000, "end": 48000}, {"start": 100000, "end": 160000}]
    task = vad_task(spans=lambda audio: spans, reader=lambda path: [0.0] * 160000)
    result = task.run(None, {"audio": "a.wav", "final": False}, Ctx())
    transcript = make(spans).block([0.0] * 160000, False, 1, Ctx())
    assert result == {"covered_us": transcript["covered_us"], "silences": transcript["silences"],
                      "spans": [{"start_us": 1000000, "end_us": 3000000}]}


# ---- Agrupar trechos de VAD (#162) ----

SPANS = [{"start": 16000 * i * 2, "end": 16000 * i * 2 + 16000} for i in range(5)]  # 1 s a cada 2 s


def grouped(spans=SPANS, languages=None, calls=None, fail=None):
    languages = iter(languages or ["pt"] * len(spans))
    calls = calls if calls is not None else []

    def clips(audio, clip_list, language, batch):
        calls.append((clip_list, language, batch))
        if fail:
            raise fail
        for clip in clip_list:
            # tempos absolutos no bloco: início do trecho mais 0,25 s
            yield " x", clip["start"] + 0.25, clip["start"] + 0.5

    return Transcriber(
        lambda audio: spans,
        lambda chunk: next(languages),
        lambda chunk, language, batch: pytest.fail("o caminho agrupado não usa uma chamada por trecho"),
        transcribe_clips=clips,
    )


def test_grouping_sends_up_to_n_consecutive_spans_per_call_with_absolute_times():
    calls = []
    result = grouped(calls=calls).block([0.0] * 160000, True, 1, Ctx(), group_size=2)
    assert [(len(c[0]), c[2]) for c in calls] == [(2, 2), (2, 2), (1, 2)]
    assert [c[0][0] for c in calls][:2] == [{"start": 0.0, "end": 1.0}, {"start": 4.0, "end": 5.0}]
    starts = [w["start_us"] for w in result["words"]]
    assert starts == [250_000, 2_250_000, 4_250_000, 6_250_000, 8_250_000]
    assert result["silences"][0] == {"start_us": 1_000_000, "end_us": 2_000_000}


def test_a_language_change_ends_the_group_but_language_is_still_detected_per_span():
    calls = []
    result = grouped(languages=["pt", "pt", "en", "en", "pt"], calls=calls).block(
        [0.0] * 160000, True, 1, Ctx(), group_size=8
    )
    assert [(len(c[0]), c[1]) for c in calls] == [(2, "pt"), (2, "en"), (1, "pt")]
    assert [w["language"] for w in result["words"]] == ["pt", "pt", "en", "en", "pt"]


def test_group_of_one_keeps_the_one_call_per_span_path():
    result = make([{"start": 0, "end": 16000}]).block([0.0] * 16000, True, 1, Ctx(), group_size=1)
    assert len(result["words"]) == 1


def test_grouped_result_matches_the_current_path_word_for_word():
    audio = [0.0] * 160000

    def words(start, end):
        base = start / 16000
        return [(" a", base + 0.1, base + 0.3), (" b", base + 0.4, base + 0.6)]

    one = Transcriber(
        lambda a: SPANS,
        lambda chunk: "pt",
        lambda chunk, language, batch: [(t, b - 0.0, e - 0.0) for t, b, e in words(0, 0)],
    )
    many = Transcriber(
        lambda a: SPANS,
        lambda chunk: "pt",
        lambda chunk, language, batch: [],
        transcribe_clips=lambda a, clips, language, batch: [
            w for c in clips for w in words(round(c["start"] * 16000), 0)
        ],
    )
    current = one.block(audio, True, 1, Ctx())["words"]
    together = many.block(audio, True, 1, Ctx(), group_size=3)["words"]
    assert len(together) == 2 * len(SPANS) and len(current) == len(together)
    assert [w["text"] for w in together] == [w["text"] for w in current]


@pytest.mark.parametrize("error", [RuntimeError("CUDA failed with error out of memory"), MemoryError()])
def test_out_of_memory_in_a_group_is_the_typed_error(error):
    with pytest.raises(WorkerError) as info:
        grouped(fail=error).block([0.0] * 160000, True, 1, Ctx(), group_size=4)
    assert info.value.code == "out_of_memory"


def test_other_runtime_errors_are_not_reported_as_memory():
    with pytest.raises(RuntimeError):
        grouped(fail=RuntimeError("cuDNN failed")).block([0.0] * 160000, True, 1, Ctx(), group_size=4)


def test_group_size_is_forwarded_and_validated():
    seen = []

    class Fake(Transcriber):
        def block(self, audio, final, batch_size, ctx, group_size=1):
            seen.append(group_size)
            return {"covered_us": 0, "words": [], "silences": []}

    task = transcribe_task(loader=lambda *a: Fake(lambda a: [], lambda c: "pt", None), reader=lambda p: [0.0])
    base = {"audio": "a.wav", "final": True, "batch_size": 1, "model": MODEL}
    for group in (None, 4):
        params = base if group is None else {**base, "group_size": group}
        run(params, {"transcribe": task})
    assert seen == [1, 4]
    for bad in (0, 33, True, "2"):
        replies = run({**base, "group_size": bad}, {"transcribe": task})
        assert replies[-1]["code"] == "invalid_message"
