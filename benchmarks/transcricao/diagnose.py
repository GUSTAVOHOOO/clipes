"""Diagnóstico da base de tempo: erros assinados e F1 por tolerância."""
import argparse
import json
import statistics
from pathlib import Path
from metrics import alignment, boundary_score, exclude_uncertain, tokens

DATA = Path(__file__).resolve().parents[1]/'dataset'


def measure(rows, ctc=False):
    manifest = json.loads((DATA/'manifest.json').read_text(encoding='utf8'))
    sources = {i['id']:i for i in manifest['items']}
    total = {t: [0,0,0] for t in (.05,.1,.2,.5)}
    errors = {'start': [], 'end': []}
    for row in rows:
        item = sources[row['source']]
        ref = next(s for s in json.loads((DATA/item['transcricao']['file']).read_text(encoding='utf8'))['samples'] if s['start'] == row['start'])
        indexed = [(i,w) for i,w in enumerate(ref['words']) if exclude_uncertain([w],ref['incertos'])]
        reference = [w for _,w in indexed]
        uncertain = {(j,b['edge']) for j,(i,_) in enumerate(indexed) for b in ref['bordas_incertas'] if b['word_index']==i}
        hypothesis = row['aligned'] if ctc else exclude_uncertain(row['hypothesis'],ref['incertos'])
        ref_tokens = [' '.join(tokens(w['word'])) for w in reference]
        hyp_tokens = [' '.join(tokens(w['word'])) for w in hypothesis]
        _, pairs = alignment(ref_tokens,hyp_tokens)
        for i,j in pairs:
            if ref_tokens[i] != hyp_tokens[j]: continue
            for edge in ('start','end'):
                if (i,edge) not in uncertain:
                    errors[edge].append(hypothesis[j][edge]-reference[i][edge])
        for t, counts in total.items():
            tp,nr,nh = boundary_score(reference,hypothesis,uncertain,t)
            if ctc: nh += 2*row['unaligned_words']
            for k,n in enumerate((tp,nr,nh)): counts[k] += n
    return {'amostras':len(rows), 'mediana_inicio_ms':1000*statistics.median(errors['start']) if errors['start'] else None,
            'mediana_fim_ms':1000*statistics.median(errors['end']) if errors['end'] else None,
            'bordas_inicio':len(errors['start']),'bordas_fim':len(errors['end']),
            'f1':{str(int(t*1000)):2*n[0]/(n[1]+n[2]) if n[1]+n[2] else None for t,n in total.items()}}


def main():
    p=argparse.ArgumentParser(); p.add_argument('file',type=Path); p.add_argument('--ctc',action='store_true'); p.add_argument('--pt',action='store_true'); a=p.parse_args()
    data=json.loads(a.file.read_text(encoding='utf8')); rows=data if a.ctc else data['rows']
    if a.pt: rows=[r for r in rows if r['source'] in ('rtZyZL3FfH4','QiwQ62ypdcI')]
    print(json.dumps(measure(rows,a.ctc),indent=2))
if __name__ == '__main__': main()
