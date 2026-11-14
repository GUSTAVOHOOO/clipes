import unittest
from pathlib import Path
import hashlib
import json


class DatasetIntegrityTests(unittest.TestCase):
    def test_stage_one_review_provenance_and_uncertainty(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        sample_sources = {'rtZyZL3FfH4', 'QiwQ62ypdcI', '6LB7vibQ5q0'}
        clip_sources = {'rtZyZL3FfH4', '6LB7vibQ5q0', '6dhayer-a90'}
        for item in manifest['items']:
            transcript = json.loads((root / item['transcricao']['file']).read_text(encoding='utf-8'))
            for sample, reference in zip(item['samples'], transcript['samples']):
                if item['id'] not in sample_sources:
                    self.assertNotIn('review', sample)
                    continue
                review = sample.get('review', {})
                self.assertEqual(review.get('by'), 'agent')
                self.assertEqual(review.get('date'), '2026-11-14')
                self.assertIn('NVIDIA', review.get('method', ''))
                coverage = review['coverage']
                self.assertGreaterEqual(coverage['palavras_concordantes_pct'], 0)
                self.assertLessEqual(coverage['palavras_concordantes_pct'], 100)
                self.assertEqual(coverage['spans_incertos'], len(reference['incertos']))
                self.assertGreaterEqual(coverage['bordas_ajustadas'], 0)
                for span in reference['incertos']:
                    self.assertLessEqual(sample['start'], span['start'])
                    self.assertLess(span['start'], span['end'])
                    self.assertLessEqual(span['end'], sample['end'])
                    self.assertIn('whisper', span)
                    self.assertIn('parakeet', span)
                    self.assertGreaterEqual(span['vad_fala_pct'], 0)
                    self.assertLessEqual(span['vad_fala_pct'], 100)
                for edge in reference['bordas_incertas']:
                    self.assertIn(edge['edge'], ('start', 'end'))
                    self.assertIn(edge['word_index'], range(len(reference['words'])))
                    self.assertGreater(abs(edge['whisper'] - edge['parakeet']), .099)
            for clip in item['clips']:
                self.assertIn(item['id'], clip_sources)
                review = clip.get('review', {})
                self.assertEqual(review.get('by'), 'agent')
                self.assertEqual(review.get('date'), '2026-11-14')
                self.assertIn('NVIDIA', review.get('method', ''))
                coverage = review['coverage']
                self.assertEqual(coverage['spans_incertos'], len(review['incertos']))
                self.assertIn(coverage['bordas_ajustadas'], (0, 1, 2))
                adjusted = 0
                for edge in ('start', 'end'):
                    evidence = review['bordas'][edge]
                    self.assertEqual(evidence['novo'], clip[edge])
                    self.assertLessEqual(abs(evidence['novo'] - evidence['original']), 1.001)
                    if evidence['novo'] != evidence['original']:
                        adjusted += 1
                        lo, hi = evidence['vad_intervalo']
                        self.assertGreaterEqual(hi - lo, .149)
                        self.assertLessEqual(lo, evidence['novo'])
                        self.assertLessEqual(evidence['novo'], hi)
                        self.assertGreaterEqual(evidence['boundary_match_score'], .55)
                        self.assertLessEqual(abs(evidence['match_offset_error']), .025)
                    if evidence.get('status') == 'borda não ajustada':
                        self.assertEqual(evidence['novo'], evidence['original'])
                self.assertEqual(adjusted, coverage['bordas_ajustadas'])

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
