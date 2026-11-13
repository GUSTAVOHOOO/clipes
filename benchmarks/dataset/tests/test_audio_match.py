"""Casamento real de áudio sintético, incluindo edição e falsos positivos."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio_match


class AudioMatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rate = 8000
        rng = np.random.default_rng(28)
        # Noise with a changing spectral envelope, unlike a stationary tone.
        cls.source = rng.normal(0, 0.1, 100 * cls.rate).astype(np.float32)

    def test_compilation_splits_on_offset_jump_and_ignores_short_piece(self):
        r = self.rate
        clip = np.concatenate([self.source[50*r:65*r], self.source[10*r:30*r],
                               self.source[80*r:85*r]]) * 0.6
        matches = audio_match.match_arrays(self.source, clip, r)
        self.assertEqual(len(matches), 2)
        for match, expected in zip(matches, [(0, 15, 50), (15, 35, 10)]):
            self.assertAlmostEqual(match['clip_start'], expected[0], delta=0.6)
            self.assertAlmostEqual(match['clip_end'], expected[1], delta=0.6)
            self.assertAlmostEqual(match['start'], expected[2], delta=0.6)
            self.assertGreater(match['score'], 0.9)
        self.assertLessEqual(matches[0]['clip_end'], matches[1]['clip_start'])

    def test_unrelated_audio_and_silence_are_rejected(self):
        rng = np.random.default_rng(29)
        for clip in [rng.normal(0, 0.1, 20*self.rate).astype(np.float32),
                     np.zeros(20*self.rate, dtype=np.float32)]:
            self.assertEqual(audio_match.match_arrays(self.source, clip, self.rate), [])

    def test_silent_source_regions_cannot_mask_a_real_match(self):
        source = np.concatenate([self.source, np.zeros(600*self.rate, dtype=np.float32)])
        matches = audio_match.match_arrays(source, self.source[20*self.rate:40*self.rate], self.rate)
        self.assertEqual(len(matches), 1)
        self.assertAlmostEqual(matches[0]['start'], 20., delta=.1)

    def test_repeated_audio_is_ambiguous_and_short_audio_is_not_a_cut(self):
        repeated = np.tile(self.source, 2)
        self.assertEqual(audio_match.match_arrays(repeated, self.source[:20*self.rate], self.rate), [])
        self.assertEqual(audio_match.match_arrays(self.source, self.source[:100], self.rate), [])

    def test_overlapping_detections_at_same_offset_are_one_cut(self):
        segments = [dict(clip_start=10., clip_end=30., start=110., end=130.,
                         score=.9, coarse_score=.7, anchors=[]),
                    dict(clip_start=28., clip_end=50., start=128., end=150.,
                         score=.8, coarse_score=.6, anchors=[])]
        merged = audio_match.merge_segments(segments)
        self.assertEqual(len(merged), 1)
        self.assertEqual((merged[0]['clip_start'], merged[0]['clip_end'],
                          merged[0]['start'], merged[0]['end']), (10., 50., 110., 150.))
        self.assertEqual(merged[0]['score'], .8)


if __name__ == '__main__':
    unittest.main()
