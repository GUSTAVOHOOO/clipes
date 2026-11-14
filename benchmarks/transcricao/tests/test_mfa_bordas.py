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

class ReadMfaTests(unittest.TestCase):
    def test_reads_word_tier_with_offset_and_ignores_silence(self):
        from mfa_bordas import read_mfa_words
        data = {'tiers': {'words': {'entries': [[0, .2, ''], [.2, .5, 'oi'], [.5, .7, 'mundo']]},
                          'phones': {'entries': [[0, .1, 'x']]}}}
        self.assertEqual(read_mfa_words(data, 10), [{'word': 'oi', 'start': 10.2, 'end': 10.5},
                                                   {'word': 'mundo', 'start': 10.5, 'end': 10.7}])

    def test_rejects_invalid_interval(self):
        from mfa_bordas import read_mfa_words
        with self.assertRaises(ValueError):
            read_mfa_words({'tiers': {'words': {'entries': [[1, .5, 'erro']]}}}, 0)

class DiagnoseMfaTests(unittest.TestCase):
    def test_measure_uses_new_reference_and_excludes_uncertain_hypothesis(self):
        from diagnose import measure
        references = {('rtZyZL3FfH4', 0): {'words': [{'word': 'oi', 'start': 1, 'end': 2}],
                                               'incertos': [{'start': 3, 'end': 4}]}}
        rows = [{'source': 'rtZyZL3FfH4', 'start': 0,
                 'hypothesis': [{'word': 'oi', 'start': 1.04, 'end': 2.04},
                                {'word': 'omitida', 'start': 3.1, 'end': 3.5}]}]
        result = measure(rows, references=references)
        self.assertAlmostEqual(result['mediana_inicio_ms'], 40)
        self.assertAlmostEqual(result['mediana_fim_ms'], 40)
        self.assertEqual(result['f1']['50'], 1)

class PlausibilityTests(unittest.TestCase):
    def test_excludes_whole_chunk_if_output_missing_or_word_count_differs(self):
        from mfa_bordas import assess_chunk
        chunk = {'start': 10, 'end': 12, 'mapping': [
            {'original': 'oi', 'words': ['oi'], 'normalized': False}]}
        self.assertEqual(assess_chunk(chunk, None), ([], [(10, 12)], 'sem_saida'))
        data = {'tiers': {'words': {'entries': [[0, .2, 'oi'], [.2, .3, 'extra']]}}}
        self.assertEqual(assess_chunk(chunk, data), ([], [(10, 12)], 'divergencia'))

    def test_excludes_interval_of_word_over_two_seconds(self):
        from mfa_bordas import assess_chunk
        chunk = {'start': 10, 'end': 15, 'mapping': [
            {'original': 'lenta', 'words': ['lenta'], 'normalized': False},
            {'original': 'fim', 'words': ['fim'], 'normalized': False}]}
        data = {'tiers': {'words': {'entries': [[0, 2.1, 'lenta'], [3, 3.5, 'fim']]}}}
        words, exclusions, reason = assess_chunk(chunk, data)
        self.assertEqual(words, [{'word': 'fim', 'start': 13, 'end': 13.5, 'normalized': False}])
        self.assertEqual(exclusions, [(10, 12.1)])
        self.assertEqual(reason, 'duracao')

class ReferenceCoverageTests(unittest.TestCase):
    def test_missing_original_words_are_explicitly_excluded(self):
        from gerar_referencia_mfa import exclude_unmatched
        original = [{'word': 'oi', 'start': 1, 'end': 1.2},
                    {'word': 'faltou', 'start': 2, 'end': 2}]
        aligned = [{'word': 'oi', 'start': 1.1, 'end': 1.3}]
        words, spans, missing = exclude_unmatched(original, aligned, [])
        self.assertEqual(words, aligned)
        self.assertEqual(missing, 1)
        self.assertLess(spans[0]['start'], 2)
        self.assertGreater(spans[0]['end'], 2)

class PhoneCompatibilityTests(unittest.TestCase):
    def test_rejects_phones_not_in_acoustic_model(self):
        from preparar_dicionario_mfa import incompatible_phones
        self.assertEqual(incompatible_phones(['casa\tk a z a', 'sol\ts o l'], {'k', 'a', 'z', 's', 'o'}), {'l'})
        self.assertEqual(incompatible_phones(['casa\tk a z a'], {'k', 'a', 'z'}), set())
