"""Resume contagens de bordas CTC e a cobertura do alinhador."""
import argparse
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('file', type=Path)
a = p.parse_args()
rows = json.loads(a.file.read_text(encoding='utf8'))
for source in sorted({r['source'] for r in rows}) + ['total']:
    selected = rows if source == 'total' else [r for r in rows if r['source'] == source]
    total = lambda key: sum(r[key] for r in selected)
    denominator = total('ref_edges') + total('hyp_edges')
    print(source, 'n=', len(selected), 'F1=', 2*total('tp')/denominator if denominator else None,
          'cobertura=', total('ref_edges')/total('eligible_edges') if total('eligible_edges') else None,
          'palavras_sem_alinhamento=', total('unaligned_words'))
