import unittest
from pathlib import Path
import hashlib
import json


class DatasetIntegrityTests(unittest.TestCase):
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
