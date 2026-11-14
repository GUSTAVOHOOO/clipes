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
