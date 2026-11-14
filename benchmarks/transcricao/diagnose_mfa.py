"""Aplica o diagnóstico existente a uma referência MFA e resume a variação por Fonte."""
import argparse
import json
import statistics
from pathlib import Path

from diagnose import measure


def iqr(values):
    if len(values) < 2:
        return None
    quartiles = statistics.quantiles(values, n=4, method='inclusive')
    return quartiles[2] - quartiles[0]


def summarize(rows, references, ctc=False):
    output = {'agregado': measure(rows, ctc, references), 'fontes': {}}
    for source in sorted({row['source'] for row in rows}):
        subset = [row for row in rows if row['source'] == source]
        samples = [measure([row], ctc, references) for row in subset]
        summary = measure(subset, ctc, references)
        for edge in ('inicio', 'fim'):
            values = [s[f'mediana_{edge}_ms'] for s in samples if s[f'mediana_{edge}_ms'] is not None]
            summary[f'iqr_medianas_trechos_{edge}_ms'] = iqr(values)
            summary[f'medianas_trechos_{edge}_ms'] = values
        output['fontes'][source] = summary
    return output


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--results', type=Path, required=True)
    p.add_argument('--ctc', action='store_true')
    a = p.parse_args()
    data = json.loads(a.reference.read_text(encoding='utf8'))
    refs = {(r['source'], r['start']): r for r in data['references']}
    data = json.loads(a.results.read_text(encoding='utf8'))
    print(json.dumps(summarize(data if a.ctc else data['rows'], refs, a.ctc), indent=2))


if __name__ == '__main__':
    main()
