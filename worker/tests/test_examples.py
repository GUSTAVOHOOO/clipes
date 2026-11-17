"""Contrato do worker contra as mensagens de exemplo compartilhadas com o núcleo.

Cada arquivo em protocol/examples/*.jsonl é uma conversa: linhas `from: core` são
enviadas ao worker, linhas `from: worker` são o que ele deve responder, na ordem.
O texto "*" num valor esperado aceita qualquer valor.
"""

import io
import json
import queue
import threading
from pathlib import Path

import pytest

from clipes_worker.align import Aligner, align_task
from clipes_worker.protocol import WorkerError
from clipes_worker.server import Server
from clipes_worker.tasks import Task
from clipes_worker.transcribe import Transcriber, transcribe_task, vad_task

EXAMPLES = Path(__file__).resolve().parents[1] / "protocol" / "examples"
TIMEOUT = 10


class FakeModel:
    def __init__(self, name):
        self.name = name

    def close(self):
        pass


def fake_tasks():
    def transcribe(model, params, ctx):
        if params.get("wait_for_cancel"):
            ctx.progress("transcribing", 10, "Transcrevendo")
            ctx.wait_cancel(TIMEOUT)
            ctx.checkpoint()
        else:
            ctx.progress("transcribing", 50, "Transcrevendo")
        return {"text": "olá mundo"}

    def missing():
        raise WorkerError("model_missing")

    return {
        "transcribe": Task("fake-whisper", lambda: FakeModel("fake-whisper"), transcribe),
        "reframe": Task(
            "fake-yunet",
            lambda: FakeModel("fake-yunet"),
            lambda model, params, ctx: {"crop": [0, 0, 1080, 1920]},
        ),
        "tts": Task("fake-kokoro", missing, lambda *_: {}),
    }


def block_tasks():
    """A tarefa `transcribe` real, com VAD, idioma e modelo falsos (10 s de áudio)."""

    def spans(audio):
        return [{"start": 16000, "end": 48000}, {"start": 80000, "end": 160000}]

    def transcribe(chunk, language, batch_size):
        return [(" olá", 0.1, 0.4), ("mundo", 0.5, 0.9)]

    task = transcribe_task(
        loader=lambda directory, device, compute_type: Transcriber(
            spans, lambda chunk: "pt" if len(chunk) == 32000 else "en", transcribe
        ),
        reader=lambda path: [0.0] * 160000,
    )
    align = align_task(
        loader=lambda directory, device, compute_type: Aligner(
            lambda audio: [{"start": 16000, "end": 48000}],
            lambda chunk, language, batch: [(" Olá", 0.1, 0.4), ("mundo.", 0.5, 0.9)],
            lambda chunk, text, language: [
                {"word": " Olá", "start": 0.12, "end": 0.38, "probability": 0.95},
                {"word": " mundo.", "start": 0.48, "end": 0.88, "probability": 0.97},
            ],
        ),
        reader=lambda path: [0.0] * 48000,
    )
    return {"transcribe": task, "vad": vad_task(spans=spans, reader=lambda path: [0.0] * 160000), "align": align}


class Pipe:
    """Entrada linha a linha e saída coletada numa fila, para conduzir o worker em passos."""

    def __init__(self):
        self.inbox = queue.Queue()
        self.outbox = queue.Queue()

    def __iter__(self):
        while True:
            line = self.inbox.get()
            if line is None:
                return
            yield line

    def write(self, text):
        for line in text.splitlines():
            self.outbox.put(line)

    def flush(self):
        pass


def matches(expected, actual):
    if expected == "*":
        return True
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and expected.keys() == actual.keys()
            and all(matches(v, actual[k]) for k, v in expected.items())
        )
    return expected == actual


def load(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def scenarios():
    return sorted(EXAMPLES.glob("*.jsonl"))


@pytest.mark.parametrize("path", scenarios(), ids=lambda p: p.stem)
def test_worker_follows_example_conversation(path):
    pipe = Pipe()
    result = {}
    thread = threading.Thread(
        target=lambda: result.update(code=Server(pipe, pipe, block_tasks() if path.stem in ("transcribe-block", "vad-block", "align-block") else fake_tasks()).serve()), daemon=True
    )
    thread.start()
    for entry in load(path):
        message = entry["message"]
        if entry["from"] == "core":
            pipe.inbox.put(json.dumps(message) + "\n")
        else:
            actual = json.loads(pipe.outbox.get(timeout=TIMEOUT))
            assert matches(message, actual), f"{path.name}: esperado {message}, recebido {actual}"
    thread.join(TIMEOUT)
    assert not thread.is_alive(), "o worker deveria encerrar ao fim da conversa"
    assert pipe.outbox.empty(), "o worker enviou mensagens além das do exemplo"


def test_every_example_is_a_valid_alternating_conversation():
    assert {p.stem for p in scenarios()} >= {
        "handshake",
        "run-ok",
        "cancel",
        "error",
        "model-swap",
        "protocol-mismatch",
        "transcribe-block",
    }
    for path in scenarios():
        for entry in load(path):
            assert entry["from"] in ("core", "worker")
            assert entry["message"]["v"] == 1
            assert isinstance(entry["message"]["type"], str)


def test_invalid_line_gets_typed_error_and_worker_keeps_running():
    out = io.StringIO()
    lines = ["isto não é json\n", '{"v":1,"type":"shutdown"}\n']
    assert Server(lines, out, fake_tasks()).serve() == 0
    error = json.loads(out.getvalue())
    assert (error["type"], error["code"], error["id"]) == ("error", "invalid_message", None)


def test_unexpected_exception_is_reported_without_its_text():
    def boom(model, params, ctx):
        raise RuntimeError("C:/Users/segredo/arquivo.wav")

    tasks = {"transcribe": Task("m", lambda: FakeModel("m"), boom)}
    out = io.StringIO()
    lines = [
        '{"v":1,"type":"request","id":"r1","task":"transcribe","params":{}}\n',
        '{"v":1,"type":"shutdown"}\n',
    ]
    Server(lines, out, tasks).serve()
    assert "segredo" not in out.getvalue()
    assert '"code":"internal"' in out.getvalue()
