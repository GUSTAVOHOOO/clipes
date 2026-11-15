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
    assert imported == ["numpy", "faster_whisper"]
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
