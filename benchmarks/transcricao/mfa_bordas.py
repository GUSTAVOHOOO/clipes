"""Pareamento lexical entre referência revisada e bordas do MFA."""
from metrics import alignment, tokens


def pair_words(reference, aligned):
    rt = [' '.join(tokens(word['word'])) for word in reference]
    at = [' '.join(tokens(word['word'])) for word in aligned]
    distance, pairs = alignment(rt, at)
    if distance or len(pairs) != len(reference) or len(pairs) != len(aligned):
        raise ValueError('As palavras alinhadas divergem do texto revisado')
    return [{'word': reference[i]['word'], 'start': aligned[j]['start'],
             'end': aligned[j]['end']} for i, j in pairs]


def corpus_segments(sample):
    from metrics import exclude_uncertain, subtract
    intervals = subtract(sample['start'], sample['end'],
                         [(span['start'], span['end']) for span in sample['incertos']])
    eligible = exclude_uncertain(sample['words'], sample['incertos'])
    return [(start, end, words) for start, end in intervals
            if (words := [word for word in eligible
                          if word['start'] >= start and word['end'] <= end])]


EXPANSIONS = {
    'pt': {'4': ['quatro'], '100': ['cem'], 'rp': ['erre', 'pe'], 'f8': ['efe', 'oito']},
    'en': {'24': ['twenty', 'four'], '48': ['forty', 'eight'],
           '200': ['two', 'hundred'], '90s': ['nineties']},
}
AMBIGUOUS = {'pt': {'2x1'}, 'en': set()}


def normalize_word(original, language):
    word = original.strip().strip('.,!?;:"()[]{}').casefold()
    hyphen = word.startswith('-')
    if hyphen:
        word = word[1:]
    rule = 'hifen' if hyphen else None
    if word in AMBIGUOUS[language]:
        return {'original': original, 'words': [], 'normalized': True, 'rule': 'ambiguo'}
    if word in EXPANSIONS[language]:
        rule = 'sigla' if word in ('rp', 'f8') else 'numero'
        return {'original': original, 'words': EXPANSIONS[language][word],
                'normalized': True, 'rule': rule}
    return {'original': original, 'words': [word], 'normalized': hyphen, 'rule': rule}


def collapse_words(mapping, aligned):
    flattened = [{'word': word} for item in mapping for word in item['words']]
    paired = pair_words(flattened, aligned)
    result = []
    offset = 0
    for item in mapping:
        count = len(item['words'])
        if not count:
            continue
        result.append({'word': item['original'], 'start': paired[offset]['start'],
                       'end': paired[offset + count - 1]['end'], 'normalized': item['normalized']})
        offset += count
    return result


def read_mfa_words(data, offset):
    words = []
    for start, end, text in data['tiers']['words']['entries']:
        if not text.strip():
            continue
        if not 0 <= start < end:
            raise ValueError('Intervalo inválido na saída MFA')
        words.append({'word': text, 'start': round(offset + start, 6),
                      'end': round(offset + end, 6)})
    return words
