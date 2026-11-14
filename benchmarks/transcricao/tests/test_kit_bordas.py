import tempfile
import unittest
from pathlib import Path
from kit_bordas import import_labels


class ImportLabelsTests(unittest.TestCase):
    def test_converts_relative_labels_to_absolute_source_time(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, 'item.txt').write_text('1.100\t1.450\tpalavra\n', encoding='utf8')
            items = [{'id': 'item', 'source': 'fonte', 'sample_start': 90.0,
                      'clip_start': 100.0, 'clip_duration': 3.0, 'word': 'palavra'}]
            self.assertEqual(import_labels(items, Path(temp)), [{'source': 'fonte',
                'sample_start': 90.0, 'word': 'palavra', 'start': 101.1, 'end': 101.45}])

    def test_rejects_modified_or_out_of_range_label(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, 'item.txt')
            item = {'id': 'item', 'source': 'fonte', 'sample_start': 0,
                    'clip_start': 2, 'clip_duration': 3, 'word': 'casa'}
            for label in ('0.1\t3.1\tcasa\n', '0.1\t0.2\toutra\n',
                          '0.1\t0.2\tcasa\n0.3\t0.4\tcasa\n'):
                path.write_text(label, encoding='utf8')
                with self.assertRaises(ValueError):
                    import_labels([item], Path(temp))

class SelectionTests(unittest.TestCase):
    def test_filters_normalized_g2p_short_and_adjacent_words(self):
        from kit_bordas import candidates
        words = [{'word': 'longo', 'start': 1, 'end': 1.3, 'normalized': False},
                 {'word': 'outro', 'start': 1.4, 'end': 1.7, 'normalized': True},
                 {'word': 'gerada', 'start': 1.8, 'end': 2.1, 'normalized': False},
                 {'word': 'a', 'start': 2.2, 'end': 2.3, 'normalized': False}]
        self.assertEqual([w['word'] for w in candidates(words, 0, 3, {'gerada'})], ['longo'])
