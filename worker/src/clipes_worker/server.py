"""Laço principal: JSON lines no stdin/stdout. O worker nunca abre o banco."""

import importlib
import platform
import queue
import sys
import threading
from importlib import metadata

from . import WORKER_VERSION
from .models import ModelSlot
from .protocol import (
    PROTOCOL_VERSION,
    WorkerError,
    decode,
    encode,
    error_message,
)
from .tasks import default_tasks

LIBS = ("faster-whisper", "onnxruntime", "numpy", "opencv-python-headless")


def installed_libs():
    versions = {}
    for name in LIBS:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return versions


class Context:
    """Entregue a cada tarefa: progresso e ponto de cancelamento."""

    def __init__(self, server, request_id, cancel):
        self._server, self._id, self._cancel = server, request_id, cancel

    def checkpoint(self):
        if self._cancel.is_set():
            raise WorkerError("cancelled")

    def wait_cancel(self, timeout):
        return self._cancel.wait(timeout)

    def progress(self, stage, percentage, message):
        self.checkpoint()
        self._server.send(
            {
                "v": PROTOCOL_VERSION,
                "type": "progress",
                "id": self._id,
                "stage": stage,
                "percentage": max(0, min(100, int(percentage))),
                "message": message,
            }
        )


class Server:
    def __init__(self, lines, out, tasks=None):
        self._lines, self._out = lines, out
        self._tasks = default_tasks() if tasks is None else tasks
        self._write_lock = threading.Lock()
        self._requests = queue.Queue()
        self._cancels = {}
        self._cancels_lock = threading.Lock()
        self._slot = ModelSlot(self._model_event)

    def send(self, message):
        with self._write_lock:
            self._out.write(encode(message) + "\n")
            self._out.flush()

    def _model_event(self, event, model):
        self.send({"v": PROTOCOL_VERSION, "type": "event", "event": event, "model": model})

    def _read(self):
        """Lê o stdin numa thread própria: `cancel` chega enquanto uma tarefa roda."""
        try:
            for line in self._lines:
                if not line.strip():
                    continue
                try:
                    message = decode(line)
                except WorkerError as error:
                    self.send(error_message(None, error.code))
                    continue
                kind = message["type"]
                if kind == "cancel":
                    with self._cancels_lock:
                        event = self._cancels.get(message.get("id"))
                    if event is not None:
                        event.set()
                    continue
                if kind == "request":
                    request_id = message.get("id")
                    if not isinstance(request_id, str):
                        self.send(error_message(None, "invalid_message"))
                        continue
                    with self._cancels_lock:
                        self._cancels[request_id] = threading.Event()
                self._requests.put(message)
        finally:
            self._requests.put(None)

    def serve(self):
        threading.Thread(target=self._read, daemon=True).start()
        try:
            while True:
                message = self._requests.get()
                if message is None or message["type"] == "shutdown":
                    return 0
                if message["type"] == "hello":
                    if message.get("protocol") != PROTOCOL_VERSION:
                        self.send(error_message(None, "protocol_mismatch"))
                        return 2
                    self.send(
                        {
                            "v": PROTOCOL_VERSION,
                            "type": "handshake",
                            "protocol": PROTOCOL_VERSION,
                            "worker": WORKER_VERSION,
                            "python": platform.python_version(),
                            "libs": installed_libs(),
                        }
                    )
                elif message["type"] == "request":
                    self._run(message)
                else:
                    self.send(error_message(message.get("id"), "invalid_message"))
        finally:
            self._slot.release(notify=False)

    def _run(self, message):
        request_id = message["id"]
        with self._cancels_lock:
            cancel = self._cancels[request_id]
        try:
            task = self._tasks.get(message.get("task"))
            if task is None:
                raise WorkerError("unknown_task")
            params = message.get("params", {})
            if not isinstance(params, dict):
                raise WorkerError("invalid_message")
            ctx = Context(self, request_id, cancel)
            ctx.checkpoint()
            name, loader = task.resolve(params) if task.resolve else (task.model, task.load)
            model = self._slot.acquire(name, loader)
            ctx.checkpoint()
            data = task.run(model, params, ctx)
            self.send({"v": PROTOCOL_VERSION, "type": "result", "id": request_id, "data": data})
        except WorkerError as error:
            self.send(error_message(request_id, error.code))
        except MemoryError:
            self.send(error_message(request_id, "out_of_memory"))
        except Exception:  # nunca vaza texto de exceção (pode ter caminhos)
            self.send(error_message(request_id, "internal"))
        finally:
            with self._cancels_lock:
                self._cancels.pop(request_id, None)


def preload_native_libraries():
    """Importa as bibliotecas nativas antes de a thread de leitura bloquear no stdin.

    No Windows, com o stdin do worker num pipe do núcleo, importar o numpy (ou carregar
    suas DLLs) enquanto outra thread já esperava no stdin travava o `LoadLibrary` para
    sempre: o primeiro pedido de `transcribe` nunca respondia (docs/agents/impedimentos.md).
    Importar tudo antes de `serve()` evita isso e tira o custo do primeiro pedido.
    """
    for name in ("numpy", "faster_whisper"):
        try:
            importlib.import_module(name)
        except Exception:  # ausente (testes) ou quebrada: a tarefa responde o erro tipado
            pass


def main():
    preload_native_libraries()
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    return Server(sys.stdin, sys.stdout).serve()
