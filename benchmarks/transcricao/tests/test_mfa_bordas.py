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
