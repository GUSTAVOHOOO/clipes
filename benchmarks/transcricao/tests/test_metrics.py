import unittest
from metrics import wer, exclude_uncertain, boundary_score, hallucination, subtract

class MetricsTests(unittest.TestCase):
    def test_wer_substitution_and_insertion(self):
        self.assertEqual(wer(['a', 'b', 'c'], ['a', 'x', 'c', 'd']), (2, 3))
        self.assertEqual(wer([], ['x']), (1, 0))

    def test_exclusion_uses_overlap_not_midpoint(self):
        words = [{'start': 0, 'end': 1}, {'start': 1, 'end': 2}, {'start': 2, 'end': 3}]
        self.assertEqual(exclude_uncertain(words, [{'start': .5, 'end': 1.5}]), words[2:])
        self.assertEqual(exclude_uncertain(words, [{'start': 1, 'end': 2}]), [words[0], words[2]])
        self.assertEqual(subtract(0, 4, [(1, 3), (2, 3.5)]), [(0, 1), (3.5, 4)])

    def test_boundary_tolerance_and_uncertainty(self):
        ref = [{'start': 1.0, 'end': 2.0, 'word': 'hello'}]
        hyp = [{'start': 1.05, 'end': 2.06, 'word': 'hello'}]
        self.assertEqual(boundary_score(ref, hyp, set()), (1, 2, 2))
        self.assertEqual(boundary_score(ref, hyp, {(0, 'end')}), (1, 1, 1))
        self.assertEqual(boundary_score(ref, [], set()), (0, 2, 0))
        self.assertEqual(boundary_score(ref, hyp + [{'start': 3, 'end': 4, 'word': 'extra'}], set()), (1, 2, 4))

    def test_hallucination_counts_midpoints_in_silence(self):
        hyp = [{'start': .1, 'end': .3}, {'start': 1.1, 'end': 1.3}]
        self.assertEqual(hallucination(hyp, [(0, 1)]), (1, 1))
        self.assertEqual(hallucination(hyp, []), (0, 0))

if __name__ == '__main__': unittest.main()
