import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('match', Path(__file__).resolve().parents[1] / 'match.py')
match = importlib.util.module_from_spec(spec)
spec.loader.exec_module(match)


class MatchingTests(unittest.TestCase):
    def test_finds_offset_from_matching_timed_words(self):
        vod = {'events': [{'tStartMs': 120000, 'segs': [{'utf8': 'Olá mundo esta é uma frase bastante longa para testar', 'tOffsetMs': 0}]}]}
        clip = {'events': [{'tStartMs': 2000, 'segs': [{'utf8': 'ola mundo esta e uma frase bastante longa para testar', 'tOffsetMs': 0}]}]}
        results = match.find_matches(vod, clip)
        self.assertEqual(results[0]['offset_seconds'], 118)
        self.assertGreater(results[0]['votes'], 1)

    def test_does_not_claim_match_for_unrelated_words(self):
        vod = {'events': [{'tStartMs': 1000, 'segs': [{'utf8': 'palavras totalmente diferentes aqui para procurar'}]}]}
        clip = {'events': [{'tStartMs': 1000, 'segs': [{'utf8': 'nada deste texto corresponde ao video'}]}]}
        self.assertEqual(match.find_matches(vod, clip), [])


if __name__ == '__main__':
    unittest.main()
