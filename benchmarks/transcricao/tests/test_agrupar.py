import unittest

from agrupar import divergence


def word(text, start, end):
    return {"text": text, "start_us": start, "end_us": end}


class DivergenceTest(unittest.TestCase):
    def test_identical_runs_have_no_divergence(self):
        words = [word("a", 0, 100_000), word("b", 200_000, 300_000)]
        result = divergence(words, words)
        self.assertEqual((result["wer_pp"], result["start_median_ms"]), (0.0, 0))

    def test_edits_and_time_shifts_are_measured_against_the_baseline(self):
        base = [word("a", 0, 100_000), word("b", 200_000, 300_000), word("c", 400_000, 500_000)]
        other = [word("a", 4_000, 104_000), word("x", 200_000, 300_000), word("c", 410_000, 520_000)]
        result = divergence(base, other)
        self.assertAlmostEqual(result["wer_pp"], 100 / 3, places=2)
        self.assertEqual(result["paired"], 2)
        self.assertEqual(result["start_median_ms"], 7)


if __name__ == "__main__":
    unittest.main()
