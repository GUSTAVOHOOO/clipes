"""Um modelo carregado por vez, liberado antes do próximo (ADR-0004)."""

from .protocol import WorkerError


class ModelSlot:
    def __init__(self, on_event):
        self._on_event = on_event
        self._name = None
        self._model = None

    @property
    def loaded(self):
        return self._name

    def acquire(self, name, loader):
        """Devolve o modelo `name`; se outro estiver carregado, libera-o antes de carregar este."""
        if self._name == name:
            return self._model
        self.release()
        try:
            model = loader()
        except WorkerError:
            raise
        except MemoryError:
            raise WorkerError("out_of_memory") from None
        self._name, self._model = name, model
        self._on_event("model_loaded", name)
        return model

    def release(self, notify=True):
        if self._name is None:
            return
        name, model = self._name, self._model
        self._name = self._model = None
        close = getattr(model, "close", None)
        if callable(close):
            close()
        if notify:
            self._on_event("model_released", name)
