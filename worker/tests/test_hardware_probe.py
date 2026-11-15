"""Tarefa `probe` com modelos falsos: nada de rede, modelo real ou GPU."""

import pytest

from clipes_worker.hardware_probe import (
    DATA,
    MAX_CLIP_BATCH,
    Prober,
    clip_parts,
    probe_task,
    run_clip,
)
from clipes_worker.protocol import WorkerError
from clipes_worker.transcribe import SAMPLE_RATE, Transcriber, read_wav

MODEL = {"id": "fake", "dir": "modelo", "device": "cpu", "compute_type": "int8"}


class Ctx:
    def checkpoint(self):
        pass

    def progress(self, *_):
        pass


class Words:
    def __init__(self, count):
        self.words = [object()] * count


class FakePipeline:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, **options):
        self.calls.append((len(audio), options))
        clips = options.get("clip_timestamps")
        return iter([Words(3 * (len(clips) if clips else 1))]), None


def test_embedded_clip_is_portuguese_then_english_16khz_mono():
    parts = clip_parts()
    assert [language for language, _ in parts] == ["pt", "en"]
    for _, audio in parts:
        assert 5 < len(audio) / SAMPLE_RATE < 30
    assert {path.name for path in DATA.glob("*.wav")} == {"probe-pt.wav", "probe-en.wav"}


def test_batch_one_runs_each_language_without_clip_timestamps():
    pipeline, parts = FakePipeline(), [("pt", [0.0] * 32000), ("en", [0.0] * 16000)]
    words, audio_s = run_clip(pipeline, parts, 1)
    assert words == {"pt": 3, "en": 3} and audio_s == 3.0
    assert [(c[1]["language"], c[1]["batch_size"], c[1]["word_timestamps"]) for c in pipeline.calls] == [
        ("pt", 1, True),
        ("en", 1, True),
    ]
    assert all("clip_timestamps" not in c[1] for c in pipeline.calls)


def test_larger_batch_sends_eight_copies_with_clip_timestamps_in_seconds():
    pipeline = FakePipeline()
    words, audio_s = run_clip(pipeline, [("pt", [0.0] * 32000), ("en", [0.0] * 16000)], 4)
    (size, options), = pipeline.calls
    assert size == 32000 * MAX_CLIP_BATCH and audio_s == 16.0
    assert options["batch_size"] == 4 and options["language"] == "pt"
    clips = options["clip_timestamps"]
    assert len(clips) == 8 and clips[1] == {"start": 2.0, "end": 4.0}
    assert words == {"pt": 24}


def test_probe_separates_load_time_from_run_time():
    ticks = iter([2.5, 3.0])
    loaded = Transcriber(None, None, None, clip=lambda batch: ({"pt": 1, "en": 1}, 18.0))
    task = probe_task(loader=lambda *_: loaded)
    name, load = task.resolve({"mode": "clip", "batch_size": 1, "model": MODEL})
    assert name == "probe:fake:cpu:int8"
    prober = Prober(loaded, 2.5, clock=lambda: next(ticks))
    result = task.run(prober, {"mode": "clip", "batch_size": 1}, Ctx())
    assert result == {"load_s": 2.5, "run_s": 0.5, "audio_s": 18.0, "words": {"pt": 1, "en": 1}}


def test_audio_mode_uses_the_local_engine_path_and_never_the_clip():
    class Fake(Transcriber):
        def block(self, audio, final, batch_size, ctx):
            assert final is True and batch_size == 1
            return {"words": [1, 2, 3], "covered_us": 0, "silences": []}

    ticks = iter([0.0, 10.0, 10.0])
    prober = Prober(Fake(None, None, None), 1.0, clock=lambda: next(ticks))
    task = probe_task(reader=lambda path: [0.0] * (SAMPLE_RATE * 30))
    result = task.run(prober, {"mode": "audio", "audio": "trecho.wav", "model": MODEL}, Ctx())
    assert result == {"load_s": 1.0, "run_s": 10.0, "audio_s": 30.0, "words": 3}


def test_info_mode_loads_no_model():
    task = probe_task(info=lambda: {"ct2_version": "4.9.0", "cuda_compute_types": ["float16"]})
    name, load = task.resolve({"mode": "info"})
    assert load() is None
    assert task.run(None, {"mode": "info"}, Ctx())["cuda_compute_types"] == ["float16"]


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"mode": "outro"},
        {"mode": "clip", "batch_size": 1},
        {"mode": "clip", "batch_size": 9, "model": MODEL},
        {"mode": "clip", "batch_size": True, "model": MODEL},
        {"mode": "clip", "batch_size": 1, "model": {**MODEL, "compute_type": "float32"}},
        {"mode": "audio", "model": MODEL},
    ],
)
def test_invalid_params_are_rejected_before_loading(params):
    with pytest.raises(WorkerError) as error:
        probe_task(loader=lambda *_: pytest.fail("não deve carregar")).resolve(params)
    assert error.value.code == "invalid_message"


def test_wav_files_are_readable_by_the_worker_reader():
    assert len(read_wav(DATA / "probe-pt.wav")) > 0
