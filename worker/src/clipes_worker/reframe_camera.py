"""Associação e câmera determinísticas do #60. Unidades: fração da Fonte e segundos.

As constantes são ponto inicial conservador, não um detector de locutor.
One Euro só suaviza dentro de cada segmento; cena e troca de rosto reiniciam tudo.
"""
import math
from dataclasses import dataclass

DEAD_ZONE = 0.04
SPEED_LIMIT = 0.25
ACCELERATION_LIMIT = 0.5
EURO_MIN_CUTOFF = 1.0
EURO_BETA = 0.3
EURO_D_CUTOFF = 1.0
ASSOCIATION_IOU = 0.15
ASSOCIATION_DISTANCE = 0.18
MAX_MISSED_FRAMES = 5
SWITCH_MARGIN = 1.25
SWITCH_FRAMES = 12


@dataclass(frozen=True)
class Detection:
    x: float
    y: float
    width: float
    height: float
    score: float

    @property
    def center(self):
        return self.x + self.width / 2, self.y + self.height / 2

    @property
    def strength(self):
        return self.width * self.height * self.score


def iou(a, b):
    w = max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x))
    h = max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
    intersection = w * h
    return intersection / max(1e-12, a.width * a.height + b.width * b.height - intersection)


@dataclass
class Track:
    id: int
    detection: Detection
    missed: int = 0


class Tracker:
    def __init__(self):
        self.tracks = []
        self.current = None
        self.challenger = None
        self.streak = 0
        self.next_id = 1

    def update(self, detections):
        # Greedy global association: each track and detection used at most once.
        pairs = []
        for track in self.tracks:
            for j, detection in enumerate(detections):
                overlap = iou(track.detection, detection)
                distance = math.dist(track.detection.center, detection.center)
                if overlap >= ASSOCIATION_IOU or distance <= ASSOCIATION_DISTANCE:
                    pairs.append((1 - overlap + distance, track.id, j))
        used_tracks, used_detections = set(), set()
        for track in self.tracks:
            track.missed += 1
        for _, track_id, j in sorted(pairs):
            if track_id in used_tracks or j in used_detections:
                continue
            track = next(t for t in self.tracks if t.id == track_id)
            track.detection, track.missed = detections[j], 0
            used_tracks.add(track_id)
            used_detections.add(j)
        self.tracks = [t for t in self.tracks if t.missed <= MAX_MISSED_FRAMES]
        for j, detection in enumerate(detections):
            if j not in used_detections:
                self.tracks.append(Track(self.next_id, detection))
                self.next_id += 1
        visible = [t for t in self.tracks if t.missed == 0]
        current = next((t for t in self.tracks if t.id == self.current), None)
        best = max(visible, key=lambda t: t.detection.strength, default=None)
        switched = False
        if current is None:
            switched = self.current is not None and best is not None
            current = best
            self.current = best.id if best else None
            self.challenger, self.streak = None, 0
        elif best and best.id != current.id and (
            best.detection.strength > current.detection.strength * SWITCH_MARGIN
        ):
            self.streak = self.streak + 1 if self.challenger == best.id else 1
            self.challenger = best.id
            if self.streak >= SWITCH_FRAMES:
                self.current, current, switched = best.id, best, True
                self.challenger, self.streak = None, 0
        else:
            self.challenger, self.streak = None, 0
        return current, switched


def alpha(cutoff, dt):
    return 1 / (1 + 1 / (2 * math.pi * cutoff * dt))


class OneEuro:
    def __init__(self, value):
        self.raw = self.value = value
        self.derivative = 0.0

    def step(self, value, dt):
        derivative = (value - self.raw) / dt
        self.derivative += alpha(EURO_D_CUTOFF, dt) * (derivative - self.derivative)
        self.value += alpha(EURO_MIN_CUTOFF + EURO_BETA * abs(self.derivative), dt) * (value - self.value)
        self.raw = value
        return self.value


def limited(vector, limit):
    length = math.hypot(*vector)
    scale = min(1, limit / max(length, 1e-12))
    return tuple(v * scale for v in vector)


class Camera:
    def __init__(self, x, y):
        self.position = (x, y)
        self.velocity = (0.0, 0.0)
        self.filters = (OneEuro(x), OneEuro(y))

    def step(self, x, y, dt):
        target = tuple(f.step(v, dt) for f, v in zip(self.filters, (x, y)))
        delta = tuple(v - p for v, p in zip(target, self.position))
        desired = (0.0, 0.0) if math.hypot(*delta) <= DEAD_ZONE else limited(
            tuple(v / dt for v in delta), SPEED_LIMIT
        )
        change = limited(tuple(v - old for v, old in zip(desired, self.velocity)), ACCELERATION_LIMIT * dt)
        self.velocity = tuple(v + d for v, d in zip(self.velocity, change))
        self.position = tuple(p + v * dt for p, v in zip(self.position, self.velocity))
        return self.position


def timeline(frames, start_us, end_us, aspect):
    """frames yields (absolute source µs, normalized detections, scene boundary)."""
    tracker, camera, previous = Tracker(), None, start_us
    segments = []
    crop_width = min(1.0, 9 / 16 / aspect)
    crop_height = min(1.0, aspect / (9 / 16))
    for time_us, detections, scene in frames:
        if scene:
            tracker, camera = Tracker(), None
        track, switched = tracker.update(detections)
        target = track.detection.center if track else (0.5, 0.5)
        target = (max(crop_width / 2, min(1 - crop_width / 2, target[0])),
                  max(crop_height / 2, min(1 - crop_height / 2, target[1])))
        if camera is None or switched:
            camera = Camera(*target)
            if segments:
                segments[-1]["endUs"] = time_us
            segments.append({"startUs": time_us, "endUs": end_us,
                             "reason": "scene" if scene else "face_switch" if switched else "start",
                             "keyframes": []})
            point = target
        else:
            point = camera.step(*target, max(1, time_us - previous) / 1_000_000)
        previous = time_us
        segments[-1]["keyframes"].append({
            "timeUs": time_us,
            "x": max(0.0, min(1 - crop_width, point[0] - crop_width / 2)),
            "y": max(0.0, min(1 - crop_height, point[1] - crop_height / 2)),
            "width": crop_width, "height": crop_height,
            "confidence": track.detection.score if track and track.missed == 0 else 0.0,
        })
    return {"schemaVersion": 1, "revision": 1, "status": "suggestion", "segments": segments}
