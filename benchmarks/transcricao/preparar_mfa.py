"""Prepara corpus MFA a partir de trechos revisados e sem incertezas."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from mfa_bordas import corpus_segments, normalize_word

DATA = Path(__file__).resolve().parents[1] / 'dataset'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--media', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf8'))
    chunks = []
    for item in manifest['items']:
        reviewed = [s for s in item['samples'] if s.get('review', {}).get('by')]
        if not reviewed:
            continue
        media = a.media / item['file']
        if digest(media) != item['sha256']:
            raise ValueError(f'hash de mídia divergente: {media}')
        transcript_bytes = (DATA / item['transcricao']['file']).read_bytes().replace(b'\r\n', b'\n')
        if hashlib.sha256(transcript_bytes).hexdigest() != item['transcricao']['sha256']:
            raise ValueError('hash de transcrição divergente')
        transcript = json.loads(transcript_bytes)
        for sample in reviewed:
            ref = next(x for x in transcript['samples'] if x['start'] == sample['start'] and x['end'] == sample['end'])
            language = ref['language']
            ambiguous = [w for w in ref['words'] if not normalize_word(w['word'], language)['words']]
            ref = dict(ref, incertos=ref['incertos'] + [{'start': w['start'], 'end': w['end']} for w in ambiguous])
            for begin, end, words in corpus_segments(ref):
                mapping = [normalize_word(w['word'], language) for w in words]
                name = f"{item['id']}_{len(chunks):05d}"
                directory = a.output / language
                directory.mkdir(parents=True, exist_ok=True)
                subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(begin), '-i', str(media), '-t', str(end-begin),
                                '-ac', '1', '-ar', '16000', '-y', str(directory / (name + '.wav'))], check=True)
                (directory / (name + '.lab')).write_text(' '.join(word for item in mapping for word in item['words']) + '\n', encoding='utf8')
                chunks.append({'name': name, 'source': item['id'], 'language': language,
                               'sample_start': sample['start'], 'start': begin, 'end': end, 'words': words, 'mapping': mapping})
    (a.output / 'manifest.json').write_text(json.dumps({'chunks': chunks}, ensure_ascii=False, indent=2), encoding='utf8')
    print(f'{len(chunks)} trechos preparados')


if __name__ == '__main__':
    main()
