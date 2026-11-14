"""Resume resultados por Fonte e no agregado, ponderando contagens e duração."""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def summary(rows):
    total = lambda key: sum(row[key] for row in rows)
    div = lambda n, d: n/d if d else None
    return {'pico_vram_bytes': max((r.get('peak_vram_bytes') or 0 for r in rows), default=0), 'amostras': len(rows), 'wer': div(total('errors'), total('words')),
            'f1_50ms': div(2*total('tp'), total('ref_edges')+total('hyp_edges')),
            'cobertura_bordas': div(total('ref_edges'), total('eligible_edges')),
            'fracao_tempo_incertos': div(total('excluded_seconds'), total('duration')),
            'alucinacoes_por_minuto': div(60*total('hallucinated'), total('silent_seconds')),
            'silencio_segundos': total('silent_seconds'),
            'loops_por_hora': div(3600*total('loops'), total('duration')),
            'rtf': div(total('elapsed'), total('duration'))}


def main():
    p = argparse.ArgumentParser(); p.add_argument('file', type=Path); a = p.parse_args()
    data = json.loads(a.file.read_text(encoding='utf8'))
    groups = defaultdict(list)
    for row in data['rows']: groups[row['source']].append(row)
    print(json.dumps({'total':summary(data['rows']), 'fontes':{k:summary(v) for k,v in groups.items()},
                      'pico_vram_bytes':data.get('peak_vram_bytes')}, indent=2, ensure_ascii=False))

if __name__ == '__main__': main()
