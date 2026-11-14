"""Executa uma configuração sobre as amostras revisadas; resultados fora do Git."""
import argparse
import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel, BatchedInferencePipeline
from faster_whisper.vad import get_speech_timestamps, VadOptions
from metrics import alignment, boundary_score, exclude_uncertain, hallucination, subtract, tokens, wer

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'benchmarks' / 'dataset'


def audio_slice(path, start, end):
    command = ['ffmpeg', '-v', 'error', '-ss', str(start), '-i', str(path), '-t', str(end-start),
               '-f', 'f32le', '-ac', '1', '-ar', '16000', '-']
    raw = subprocess.run(command, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4').copy()


def loops(words):
    ts = [t for w in words for t in tokens(w['word'])]
    count, i = 0, 0
    while i < len(ts):
        for n in range(3, (len(ts)-i)//3 + 1):
            if ts[i:i+n] == ts[i+n:i+2*n] == ts[i+2*n:i+3*n]:
                count += 1; i += n*3
                while ts[i:i+n] == ts[i-n:i]: i += n
                break
        else: i += 1
    return count


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--media', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    p.add_argument('--compute-type', required=True)
    p.add_argument('--batch-size', type=int, default=1)
    p.add_argument('--model', required=True)
    a = p.parse_args()
    manifest = json.loads((DATA/'manifest.json').read_text(encoding='utf8'))
    stop = threading.Event()
    peak = [0, 0]
    if a.device == 'cuda':
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        def sample_vram():
            while not stop.wait(.1):
                used = pynvml.nvmlDeviceGetMemoryInfo(handle).used
                peak[0] = max(peak[0], used)
                peak[1] = max(peak[1], used)
        threading.Thread(target=sample_vram, daemon=True).start()
    started = time.perf_counter()
    revisions = {'turbo':'0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', 'small':'536b0662742c02347bc0e980a01041f333bce120'}
    model = WhisperModel(a.model, device=a.device, compute_type=a.compute_type, revision=revisions.get(a.model))
    pipeline = BatchedInferencePipeline(model=model)
    rows = []
    for item in manifest['items']:
        reviewed = [s for s in item['samples'] if s.get('review', {}).get('by')]
        if not reviewed: continue
        path = a.media/item['file']
        digest = hashlib.sha256()
        with path.open('rb') as f:
            for block in iter(lambda: f.read(1048576), b''): digest.update(block)
        if digest.hexdigest() != item['sha256']: raise ValueError(f'hash divergente: {path}')
        reference_path = DATA/item['transcricao']['file']
        reference_bytes = reference_path.read_bytes().replace(b'\r\n', b'\n')
        if hashlib.sha256(reference_bytes).hexdigest() != item['transcricao']['sha256']:
            raise ValueError(f'hash divergente: {reference_path}')
        reference = json.loads(reference_bytes)
        for sample in reviewed:
            ref = next(s for s in reference['samples'] if s['start'] == sample['start'] and s['end'] == sample['end'])
            audio = audio_slice(path, sample['start'], sample['end'])
            peak[0] = 0
            begin = time.perf_counter()
            vad = get_speech_timestamps(audio, VadOptions(threshold=.75, min_silence_duration_ms=200))
            predicted = []
            for span in vad:
                chunk = audio[span['start']:span['end']]
                language, _, _ = model.detect_language(audio=chunk)
                segments, _ = pipeline.transcribe(chunk, language=language, beam_size=5, word_timestamps=True,
                                                   vad_filter=False, batch_size=a.batch_size)
                offset = sample['start'] + span['start']/16000
                for segment in segments:
                    for word in segment.words or []:
                        predicted.append({'word': word.word, 'start': offset + word.start, 'end': offset + word.end})
            elapsed = time.perf_counter() - begin
            excluded = ref['incertos']
            indexed = [(i, w) for i, w in enumerate(ref['words']) if exclude_uncertain([w], excluded)]
            good_ref = [w for _, w in indexed]
            hyp = exclude_uncertain(predicted, excluded)
            uncertain = {(j, b['edge']) for j, (i, _) in enumerate(indexed) for b in ref['bordas_incertas'] if b['word_index'] == i}
            errors, total = wer([t for w in good_ref for t in tokens(w['word'])], [t for w in hyp for t in tokens(w['word'])])
            tp, nr, nh = boundary_score(good_ref, hyp, uncertain)
            exclusions = [(sample['start']+v['start']/16000, sample['start']+v['end']/16000) for v in vad]
            exclusions += [(w['start'], w['end']) for w in ref['words']] + [(s['start'], s['end']) for s in excluded]
            silent = subtract(sample['start'], sample['end'], exclusions)
            hallucinated, silent_seconds = hallucination(hyp, silent)
            excluded_seconds = sample['end']-sample['start'] - sum(b-a for a,b in subtract(sample['start'],sample['end'],[(s['start'],s['end']) for s in excluded]))
            rows.append(dict(source=item['id'], start=sample['start'], duration=sample['end']-sample['start'], elapsed=elapsed,
                             errors=errors, words=total, tp=tp, ref_edges=nr, hyp_edges=nh,
                             eligible_edges=2*len(good_ref), hallucinated=hallucinated, silent_seconds=silent_seconds,
                             excluded_seconds=excluded_seconds, loops=loops(hyp), peak_vram_bytes=peak[0] if a.device == 'cuda' else None, hypothesis=predicted))
            a.output.parent.mkdir(parents=True, exist_ok=True)
            a.output.write_text(json.dumps({'config': vars(a) | {'media': str(a.media), 'output': str(a.output)}, 'rows':rows}, indent=2),encoding='utf8')
            print(item['id'], sample['start'], 'WER', errors, '/', total, 'F1', tp, nr, nh, flush=True)
    stop.set()
    result = {'config': vars(a) | {'media':str(a.media),'output':str(a.output)}, 'effective_compute_type':model.model.compute_type, 'peak_vram_bytes':peak[1], 'wall_seconds':time.perf_counter()-started,'rows':rows}
    a.output.write_text(json.dumps(result, indent=2), encoding='utf8')


if __name__ == '__main__': main()
