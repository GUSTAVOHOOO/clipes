"""Monta referência MFA e registra exclusões de plausibilidade por amostra."""
import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from metrics import exclude_uncertain
from mfa_bordas import assess_chunk, normalize_word

DATA = Path(__file__).resolve().parents[1] / 'dataset'


def build_references(chunks, aligned, generated):
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf8'))
    grouped = defaultdict(list)
    for chunk in chunks:
        grouped[(chunk['source'], chunk['sample_start'])].append(chunk)
    results, issues, coverage = [], [], defaultdict(lambda: Counter())
    for item in manifest['items']:
        reviewed = [s for s in item['samples'] if s.get('review', {}).get('by')]
        if not reviewed:
            continue
        transcript = json.loads((DATA / item['transcricao']['file']).read_text(encoding='utf8'))
        for sample in reviewed:
            ref = next(s for s in transcript['samples'] if s['start'] == sample['start'] and s['end'] == sample['end'])
            original = exclude_uncertain(ref['words'], ref['incertos'])
            spans = list(ref['incertos'])
            ambiguous = [w for w in original if not normalize_word(w['word'], ref['language'])['words']]
            spans.extend({'start': w['start'], 'end': w['end']} for w in ambiguous)
            cov = coverage[item['id']]
            cov['antes'] += len(original)
            cov['ambiguos'] += len(ambiguous)
            words = []
            for chunk in grouped[(item['id'], sample['start'])]:
                path = aligned[chunk['language']] / (chunk['name'] + '.json')
                data = json.loads(path.read_text(encoding='utf8')) if path.exists() else None
                found, exclusions, reason = assess_chunk(chunk, data)
                if reason:
                    issues.append({'source': item['id'], 'sample_start': sample['start'],
                                   'chunk': chunk['name'], 'reason': reason, 'intervals': exclusions,
                                   'words_before': len(chunk['words'])})
                spans.extend({'start': start, 'end': end} for start, end in exclusions)
                mapping_by_original = chunk['mapping']
                if len(found) == len(mapping_by_original):
                    for word, mapping in zip(found, mapping_by_original):
                        word['g2p'] = any(token in generated[chunk['language']] for token in mapping['words'])
                else:
                    # Preserve one-to-one flags even if a long word was discarded.
                    for word in found:
                        word['g2p'] = any(token in generated[chunk['language']] for token in normalize_word(word['word'], chunk['language'])['words'])
                words.extend(found)
            words = exclude_uncertain(words, spans)
            cov['depois'] += len(words)
            results.append({'source': item['id'], 'start': sample['start'], 'end': sample['end'],
                            'words': words, 'incertos': spans})
    return {'references': results, 'coverage': dict(coverage), 'issues': issues}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--corpus', type=Path, required=True)
    p.add_argument('--aligned-pt', type=Path, required=True)
    p.add_argument('--aligned-en', type=Path, required=True)
    p.add_argument('--g2p-pt', type=Path, required=True)
    p.add_argument('--g2p-en', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    chunks = json.loads((a.corpus / 'manifest.json').read_text(encoding='utf8'))['chunks']
    generated = {lang: {line.split()[0] for line in path.read_text(encoding='utf8').splitlines() if line.strip()}
                 for lang, path in [('pt', a.g2p_pt), ('en', a.g2p_en)]}
    result = build_references(chunks, {'pt': a.aligned_pt, 'en': a.aligned_en}, generated)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'coverage': result['coverage'], 'issues': result['issues']}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
