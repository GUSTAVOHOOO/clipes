"""Métricas puras para avaliação de transcrições com tempos em segundos."""
import re
import unicodedata


def tokens(text):
    return re.findall(r'\w+', unicodedata.normalize('NFKC', text).casefold(), re.UNICODE)


def alignment(ref, hyp):
    rows, cols = len(ref) + 1, len(hyp) + 1
    cost = [[0] * cols for _ in range(rows)]
    for i in range(rows): cost[i][0] = i
    for j in range(cols): cost[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            cost[i][j] = min(cost[i-1][j]+1, cost[i][j-1]+1,
                             cost[i-1][j-1]+(ref[i-1] != hyp[j-1]))
    pairs = []
    i, j = len(ref), len(hyp)
    while i or j:
        if i and j and cost[i][j] == cost[i-1][j-1] + (ref[i-1] != hyp[j-1]):
            pairs.append((i-1, j-1)); i -= 1; j -= 1
        elif i and cost[i][j] == cost[i-1][j]+1: i -= 1
        else: j -= 1
    return cost[-1][-1], list(reversed(pairs))


def wer(ref, hyp):
    return alignment(ref, hyp)[0], len(ref)


def exclude_uncertain(words, spans):
    return [w for w in words if not any(w['start'] < s['end'] and s['start'] < w['end'] for s in spans)]


def boundary_score(ref, hyp, uncertain, tolerance=0.05):
    # Alinhamento lexical: palavras erradas não recebem crédito temporal.
    rt = [' '.join(tokens(w['word'])) for w in ref]
    ht = [' '.join(tokens(w['word'])) for w in hyp]
    _, pairs = alignment(rt, ht)
    correct = 0
    paired_uncertain = 0
    for i, j in pairs:
        for edge in ('start', 'end'):
            if (i, edge) in uncertain:
                paired_uncertain += 1
            elif rt[i] == ht[j] and abs(ref[i][edge] - hyp[j][edge]) <= tolerance + 1e-9:
                correct += 1
    return correct, 2 * len(ref) - len(uncertain), 2 * len(hyp) - paired_uncertain


def hallucination(hyp, silent):
    # Palavras por minuto em silêncio VAD sem palavra de referência ou incerteza.
    count = sum(any(a <= (w['start'] + w['end']) / 2 < b for a, b in silent) for w in hyp)
    return count, sum(b-a for a, b in silent)


def subtract(start, end, exclusions):
    intervals = [(start, end)]
    for a, b in sorted(exclusions):
        new = []
        for x, y in intervals:
            if b <= x or a >= y: new.append((x, y)); continue
            if x < a: new.append((x, a))
            if b < y: new.append((b, y))
        intervals = new
    return intervals
