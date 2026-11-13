import unittest
from pathlib import Path
import hashlib
import json


class DatasetIntegrityTests(unittest.TestCase):
    def test_audio_matches_have_bounds_scores_and_consistent_media(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        method = manifest['audio_matching']
        files = {}
        for item in manifest['items']:
            self.assertEqual(item['clips_status']['localizados'], len(item['clips']))
            if item['live']:
                self.assertGreaterEqual(len(item['clips']), 10)
            for clip in item['clips']:
                with self.subTest(source=item['id'], clip=clip['url'], start=clip['start']):
                    self.assertGreaterEqual(clip['clip_start'], 0)
                    self.assertGreaterEqual(clip['start'], 0)
                    self.assertLessEqual(clip['end'], item['duration_seconds'])
                    self.assertLessEqual(clip['clip_end'], clip['clip_duration_seconds']+.1)
                    self.assertGreaterEqual(clip['end']-clip['start'], method['minimum_segment_seconds'])
                    self.assertAlmostEqual(clip['end']-clip['start'],
                                           clip['clip_end']-clip['clip_start'], places=2)
                    self.assertGreaterEqual(clip['score'], method['waveform_min_correlation'])
                    self.assertLessEqual(clip['score'], 1)
                    self.assertGreaterEqual(clip['coarse_score'], method['coarse_min_correlation'])
                    self.assertGreaterEqual(clip['anchor_count'], method['min_anchors'])
                    self.assertEqual(len(clip['anchor_evidence']), 2)
                    self.assertEqual(len(clip['sha256']), 64)
                    identity = (clip['url'], clip['sha256'], clip['format'])
                    self.assertEqual(files.setdefault(clip['file'], identity), identity)
                    for anchor in clip['anchor_evidence']:
                        self.assertGreaterEqual(anchor['clip'], clip['clip_start']-.01)
                        self.assertLessEqual(anchor['clip']+method['window_seconds'], clip['clip_end']+.01)
                        self.assertAlmostEqual(anchor['offset'], clip['start']-clip['clip_start'], delta=.025)

    def test_reference_files_match_manifest_and_sample_bounds(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        for item in manifest['items']:
            with self.subTest(source=item['id']):
                reference = item['transcricao']
                path = root / reference['file']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), reference['sha256'])
                transcript = json.loads(path.read_text(encoding='utf-8'))
                self.assertEqual(transcript['source'], item['id'])
                self.assertEqual(len(transcript['samples']), 10)
                for sample, expected in zip(transcript['samples'], item['samples']):
                    self.assertEqual((sample['start'], sample['end']), (expected['start'], expected['end']))
                    self.assertTrue(sample['words'])
                    for word in sample['words']:
                        self.assertLessEqual(sample['start'] - 0.1, word['start'])
                        self.assertLessEqual(word['start'], word['end'])
                        self.assertLessEqual(word['end'], sample['end'] + 0.1)


if __name__ == '__main__':
    unittest.main()
