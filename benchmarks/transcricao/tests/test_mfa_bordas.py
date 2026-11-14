import unittest
from mfa_bordas import pair_words


class PairWordsTests(unittest.TestCase):
    def test_matches_normalized_words_and_preserves_reference_spelling(self):
        reference = [{'word': ' Olá,'}, {'word': 'mundo!'}]
        aligned = [{'word': 'olá', 'start': 1.0, 'end': 1.2},
                   {'word': 'mundo', 'start': 1.2, 'end': 1.5}]
        self.assertEqual(pair_words(reference, aligned), [
            {'word': ' Olá,', 'start': 1.0, 'end': 1.2},
            {'word': 'mundo!', 'start': 1.2, 'end': 1.5}])

    def test_rejects_missing_or_extra_aligned_words(self):
        with self.assertRaises(ValueError):
            pair_words([{'word': 'um'}, {'word': 'dois'}],
                       [{'word': 'um', 'start': 1, 'end': 2}])

class CorpusTests(unittest.TestCase):
    def test_segments_exclude_uncertainty_and_keep_absolute_offsets(self):
        from mfa_bordas import corpus_segments
        sample = {'start': 10, 'end': 14, 'incertos': [{'start': 11, 'end': 12}],
                  'words': [{'word': 'um', 'start': 10.2, 'end': 10.8},
                            {'word': 'ruim', 'start': 10.9, 'end': 11.2},
                            {'word': 'dois', 'start': 12.1, 'end': 12.6}]}
        self.assertEqual(corpus_segments(sample), [
            (10, 11, [sample['words'][0]]), (12, 14, [sample['words'][2]])])

class NormalizeTests(unittest.TestCase):
    def test_expansions_and_hyphens_are_explicit_and_reversible(self):
        from mfa_bordas import normalize_word
        for language, original, expected in [
            ('pt', ' 4,', ['quatro']), ('pt', '100', ['cem']),
            ('en', '24', ['twenty', 'four']), ('en', '48', ['forty', 'eight']),
            ('en', '200', ['two', 'hundred']), ('en', '90s.', ['nineties']),
            ('pt', '-RP,', ['erre', 'pe']), ('pt', 'F8', ['efe', 'oito']),
            ('en', '-acting.', ['acting']), ('pt', '-se', ['se'])]:
            result = normalize_word(original, language)
            self.assertEqual(result['original'], original)
            self.assertEqual(result['words'], expected)
            self.assertTrue(result['normalized'])
        self.assertEqual(normalize_word(' 2x1', 'pt')['words'], [])

    def test_mapping_collapses_expansion_into_original_token(self):
        from mfa_bordas import collapse_words
        mapping = [{'original': ' 24', 'words': ['twenty', 'four'], 'normalized': True},
                   {'original': ' cats', 'words': ['cats'], 'normalized': False}]
        aligned = [{'word': 'twenty', 'start': .1, 'end': .2},
                   {'word': 'four', 'start': .2, 'end': .4},
                   {'word': 'cats', 'start': .5, 'end': .8}]
        self.assertEqual(collapse_words(mapping, aligned), [
            {'word': ' 24', 'start': .1, 'end': .4, 'normalized': True},
            {'word': ' cats', 'start': .5, 'end': .8, 'normalized': False}])
