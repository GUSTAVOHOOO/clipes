"""Alinhamento CTC PT sobre hipóteses salvas; requer ambiente CTC isolado."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import whisperx
import whisperx.alignment as alignment
from huggingface_hub import snapshot_download
from metrics import alignment as word_alignment, boundary_score, exclude_uncertain, tokens

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT/'benchmarks'/'dataset'

class WholeSegment:
    def span_tokenize(self, text):
        return [(0, len(text))]

# Os trechos já vêm segmentados; não baixar um tokenizador adicional.
alignment.nltk_load = lambda _: WholeSegment()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--results', type=Path, required=True)
    p.add_argument('--media', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    result = json.loads(a.results.read_text(encoding='utf8'))
    manifest = json.loads((DATA/'manifest.json').read_text(encoding='utf8'))
    items = {i['id']:i for i in manifest['items']}
    model_path = snapshot_download('jonatasgrosman/wav2vec2-large-xlsr-53-portuguese', revision='634ac655299bcdc46c83bc01da9bab52d2987e4f', allow_patterns=['config.json','pytorch_model.bin','preprocessor_config.json','tokenizer_config.json','special_tokens_map.json','vocab.json'])
    model, metadata = whisperx.load_align_model(language_code='pt', device='cpu', model_name=model_path)
    out = []
    for row in result['rows']:
        if row['source'] not in ('rtZyZL3FfH4', 'QiwQ62ypdcI'): continue
        item = items[row['source']]
        refs = json.loads((DATA/item['transcricao']['file']).read_text(encoding='utf8'))['samples']
        ref = next(s for s in refs if s['start'] == row['start'])
        audio = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-ss',str(row['start']),'-i',str(a.media/item['file']),'-t',str(row['duration']),'-f','f32le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout,dtype='<f4').copy()
        segments = []
        start = 0.0
        while start < row['duration']:
            end = min(start + 15, row['duration'])
            words = [w['word'] for w in row['hypothesis'] if start <= (w['start']+w['end'])/2-row['start'] < end]
            if words:
                segments.append({'start':start, 'end':end, 'text':' '.join(w.strip() for w in words)})
            start = end
        aligned = whisperx.align(segments, model, metadata, audio, 'cpu')['word_segments']
        original = row['hypothesis']
        _, pairs = word_alignment([' '.join(tokens(w['word'])) for w in original], [' '.join(tokens(w['word'])) for w in aligned])
        valid_matched = {i for i,j in pairs if 'start' in aligned[j] and 'end' in aligned[j]}
        missing = sum(i not in valid_matched for i,w in enumerate(original) if exclude_uncertain([w], ref['incertos']))
        hyp = [{'word':w['word'], 'start':row['start']+w['start'], 'end':row['start']+w['end']} for w in aligned if 'start' in w and 'end' in w]
        indexed = [(i,w) for i,w in enumerate(ref['words']) if exclude_uncertain([w],ref['incertos'])]
        good_ref = [w for _,w in indexed]
        hyp = exclude_uncertain(hyp,ref['incertos'])
        uncertain = {(j,b['edge']) for j,(i,_) in enumerate(indexed) for b in ref['bordas_incertas'] if b['word_index']==i}
        tp,nr,nh = boundary_score(good_ref,hyp,uncertain)
        nh += 2*missing
        out.append({'source':row['source'],'start':row['start'],'tp':tp,'ref_edges':nr,'hyp_edges':nh,'eligible_edges':2*len(good_ref),'unaligned_words':missing,'aligned':hyp})
        a.output.parent.mkdir(parents=True, exist_ok=True)
        a.output.write_text(json.dumps(out,indent=2),encoding='utf8')
        print(row['source'], row['start'], tp,nr,nh,flush=True)

if __name__ == '__main__': main()
