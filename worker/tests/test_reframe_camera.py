"""Câmera pura com detecções falsas; nenhuma imagem ou rede."""
import math

import pytest

from clipes_worker.reframe_camera import (
    ACCELERATION_LIMIT, DEAD_ZONE, SPEED_LIMIT, SWITCH_FRAMES,
    Camera, Detection, Tracker, timeline, two_people_timelines,
)
from clipes_worker.reframe_webcam import (
    WEBCAM_MAX_CONFIDENCE, gameplay_webcam_timelines, temporal_edge_map,
)


def face(x, size=0.12, score=0.95):
    return Detection(x - size / 2, 0.3, size, size, score)


def test_camera_keeps_a_face_inside_the_dead_zone_still():
    camera = Camera(0.5, 0.5)
    for _ in range(20):
        assert camera.step(0.5 + DEAD_ZONE / 2, 0.5, 0.2) == (0.5, 0.5)


def test_camera_limits_speed_and_acceleration_for_a_moving_target():
    camera = Camera(0.25, 0.5)
    previous = (0.25, 0.5)
    velocity = (0.0, 0.0)
    for i in range(40):
        point = camera.step(0.8 if i < 20 else 0.2, 0.5, 0.2)
        current = tuple((b - a) / 0.2 for a, b in zip(previous, point))
        assert math.hypot(*current) <= SPEED_LIMIT + 1e-8
        assert math.dist(current, velocity) / 0.2 <= ACCELERATION_LIMIT + 1e-8
        previous, velocity = point, current


def test_camera_brakes_before_the_crop_boundary_without_an_output_clamp():
    camera = Camera(0.2, 0.5)
    positions = [camera.step(0.84, 0.5, 0.2)[0] for _ in range(60)]
    assert max(positions) <= 0.84


def test_association_is_stable_when_detection_order_changes():
    tracker = Tracker()
    first, _ = tracker.update([face(0.2), face(0.8, 0.08)])
    next_face, switched = tracker.update([face(0.79, 0.08), face(0.21)])
    assert first.id == next_face.id
    assert not switched


def test_challenger_requires_margin_for_consecutive_frames_and_switches_as_a_cut():
    tracker = Tracker()
    first, _ = tracker.update([face(0.2), face(0.8, 0.08)])
    for _ in range(SWITCH_FRAMES - 1):
        current, switched = tracker.update([face(0.2), face(0.8, 0.18)])
        assert current.id == first.id and not switched
    current, switched = tracker.update([face(0.2), face(0.8, 0.18)])
    assert current.id != first.id and switched


def test_scene_boundary_resets_the_camera_without_a_pan():
    frames = [(1_000_000, [face(0.2)], False),
              (1_200_000, [face(0.21)], False),
              (1_400_000, [face(0.8)], True)]
    result = timeline(frames, 1_000_000, 1_600_000, 16 / 9)
    assert result["schemaVersion"] == 1 and result["status"] == "suggestion"
    segments = result["segments"]
    assert len(segments) == 2
    assert segments[0]["endUs"] == segments[1]["startUs"] == 1_400_000
    assert segments[1]["reason"] == "scene"
    assert segments[1]["keyframes"][0]["x"] > 0.6
    assert segments[1]["keyframes"][0]["timeUs"] == 1_400_000


def test_no_faces_is_a_centered_low_confidence_suggestion():
    result = timeline([(0, [], False), (200_000, [], False)], 0, 400_000, 16 / 9)
    key = result["segments"][0]["keyframes"][0]
    assert key["x"] == pytest.approx((1 - key["width"]) / 2)
    assert key["confidence"] == 0
    assert key["width"] / key["height"] * (16 / 9) == pytest.approx(9 / 16)


def test_face_switch_starts_a_new_segment_without_smoothing_between_faces():
    frames = [(0, [face(0.2), face(0.8, 0.08)], False)]
    frames += [(i * 200_000, [face(0.2), face(0.8, 0.18)], False)
               for i in range(1, SWITCH_FRAMES + 1)]
    result = timeline(frames, 0, (SWITCH_FRAMES + 1) * 200_000, 16 / 9)
    assert result["segments"][-1]["reason"] == "face_switch"
    assert result["segments"][-1]["keyframes"][0]["x"] > 0.6


def test_two_people_timelines_frames_two_independent_panels():
    frames = [
        (i * 200_000, [face(0.22, 0.10, 0.92), face(0.78, 0.10, 0.91)], i == 4)
        for i in range(8)
    ]
    top, bot = two_people_timelines(frames, 0, 1_600_000, 16 / 9, 0.50)
    assert len(top) == 2 and len(bot) == 2
    assert top[1]["reason"] == "scene" and bot[1]["reason"] == "scene"
    top_k = top[0]["keyframes"][0]
    bot_k = bot[0]["keyframes"][0]
    assert top_k["x"] + top_k["width"] / 2 < 0.45
    assert bot_k["x"] + bot_k["width"] / 2 > 0.55
    assert top_k["width"] / top_k["height"] * (16 / 9) == pytest.approx(1080 / 960, rel=1e-3)


def test_gameplay_webcam_detects_persistent_corner_face_with_low_confidence():
    import numpy as np
    gray_frames = []
    dets = []
    rng = np.random.default_rng(7)
    for i in range(10):
        img = rng.integers(30, 180, (180, 320), dtype=np.uint8)
        # Webcam fixa no canto superior esquerdo (x: 10..90, y: 10..70) com borda nítida
        img[10:70, 10:90] = 60
        img[10:12, 10:90] = 240
        img[68:70, 10:90] = 240
        img[10:70, 10:12] = 240
        img[10:70, 88:90] = 240
        gray_frames.append(img)
        frame_faces = [Detection(40 / 320, 25 / 180, 22 / 320, 22 / 180, 0.92)]
        # Rosto transiente de personagem no jogo no centro/direita em 1 quadro
        if i == 3:
            frame_faces.append(Detection(0.65, 0.45, 0.08, 0.08, 0.85))
        dets.append(frame_faces)

    edge_map = temporal_edge_map(gray_frames)
    top, bot, detected, conf = gameplay_webcam_timelines(dets, edge_map, 0, 2_000_000, 16 / 9, 0.30)
    assert detected is True
    assert 0.15 <= conf <= WEBCAM_MAX_CONFIDENCE
    tk = top[0]["keyframes"][0]
    bk = bot[0]["keyframes"][0]
    # Webcam localizada no quadrante superior esquerdo, na proporção 1080x576
    assert tk["x"] < 0.25 and tk["y"] < 0.25
    assert tk["width"] / tk["height"] * (16 / 9) == pytest.approx(1080 / 576, rel=1e-2)
    # Jogo deslocado para evitar duplicar a webcam da esquerda, na proporção 1080x1344
    assert bk["x"] > 0.15
    assert bk["width"] / bk["height"] * (16 / 9) == pytest.approx(1080 / 1344, rel=1e-2)


def test_gameplay_webcam_without_faces_falls_back_to_very_low_confidence():
    top, bot, detected, conf = gameplay_webcam_timelines([[], [], []], None, 0, 1_000_000, 16 / 9, 0.30)
    assert detected is False
    assert conf <= 0.15
    assert len(top) == 1 and len(bot) == 1
