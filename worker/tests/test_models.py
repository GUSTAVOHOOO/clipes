"""Regra de um modelo carregado por vez, com modelos falsos."""

import pytest

from clipes_worker.models import ModelSlot
from clipes_worker.protocol import WorkerError


class Tracker:
    def __init__(self):
        self.alive = 0
        self.peak = 0
        self.log = []

    def make(self, name):
        tracker = self

        class Model:
            def __init__(self):
                tracker.alive += 1
                tracker.peak = max(tracker.peak, tracker.alive)
                tracker.log.append(f"load {name}")

            def close(self):
                tracker.alive -= 1
                tracker.log.append(f"free {name}")

        return Model


def test_previous_model_is_released_before_next_loads():
    tracker = Tracker()
    events = []
    slot = ModelSlot(lambda event, name: events.append((event, name)))
    for name in ("whisper", "yunet", "kokoro"):
        slot.acquire(name, tracker.make(name))
    assert tracker.peak == 1
    assert tracker.log == [
        "load whisper",
        "free whisper",
        "load yunet",
        "free yunet",
        "load kokoro",
    ]
    assert events == [
        ("model_loaded", "whisper"),
        ("model_released", "whisper"),
        ("model_loaded", "yunet"),
        ("model_released", "yunet"),
        ("model_loaded", "kokoro"),
    ]
    assert slot.loaded == "kokoro"


def test_same_model_is_reused():
    tracker = Tracker()
    slot = ModelSlot(lambda *_: None)
    first = slot.acquire("whisper", tracker.make("whisper"))
    assert slot.acquire("whisper", tracker.make("whisper")) is first
    assert tracker.log == ["load whisper"]


def test_failed_load_leaves_slot_empty():
    tracker = Tracker()
    slot = ModelSlot(lambda *_: None)
    slot.acquire("whisper", tracker.make("whisper"))

    def fails():
        raise MemoryError

    with pytest.raises(WorkerError) as info:
        slot.acquire("yunet", fails)
    assert info.value.code == "out_of_memory"
    assert slot.loaded is None
    assert tracker.alive == 0
