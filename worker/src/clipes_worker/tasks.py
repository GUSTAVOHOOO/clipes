"""Tarefas do worker, na ordem fixa do pipeline: transcrição, reenquadramento, TTS.

Os motores reais entram nos tickets de cada etapa; os modelos de ML são baixados
por outro fluxo. Enquanto o modelo não existir, a tarefa responde `model_missing`.
"""

from dataclasses import dataclass
from typing import Callable

from .protocol import WorkerError


@dataclass(frozen=True)
class Task:
    model: str
    load: Callable[[], object]
    run: Callable  # run(model, params, ctx) -> dict
    # Opcional: resolve(params) -> (nome do modelo, carregador), quando o modelo depende do pedido.
    resolve: Callable | None = None


def _model_missing():
    raise WorkerError("model_missing")


def default_tasks():
    from .hardware_probe import probe_task
    from .transcribe import transcribe_task, vad_task

    tasks = {
        name: Task(model=model, load=_model_missing, run=lambda *_: {})
        for name, model in (("reframe", "yunet"), ("tts", "kokoro"))
    }
    tasks["transcribe"] = transcribe_task()
    tasks["vad"] = vad_task()
    tasks["probe"] = probe_task()
    return tasks
