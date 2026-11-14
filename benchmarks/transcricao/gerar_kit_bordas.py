"""Gera kit local para revisão humana de bordas no Audacity."""
import argparse
import json
import random
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

from kit_bordas import candidates
from mfa_bordas import collapse_words, read_mfa_words

DATA = Path(__file__).resolve().parents[1] / 'dataset'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--corpus', type=Path, required=True)
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--aligned-pt', type=Path, required=True)
    p.add_argument('--aligned-en', type=Path, required=True)
    p.add_argument('--g2p-pt', type=Path, required=True)
    p.add_argument('--g2p-en', type=Path, required=True)
    p.add_argument('--media', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    chunks = json.loads((a.corpus / 'manifest.json').read_text(encoding='utf8'))['chunks']
    generated = {lang: {line.split()[0] for line in path.read_text(encoding='utf8').splitlines() if line.strip()}
                 for lang, path in [('pt', a.g2p_pt), ('en', a.g2p_en)]}
    reference = json.loads(a.reference.read_text(encoding='utf8'))['references']
    valid = {(r['source'], r['start'], w['word'], w['start'], w['end'])
             for r in reference for w in r['words']}
    pools = defaultdict(list)
    for chunk in chunks:
        path = getattr(a, 'aligned_' + chunk['language']) / (chunk['name'] + '.json')
        if not path.exists():
            continue
        try:
            words = collapse_words(chunk['mapping'], read_mfa_words(json.loads(path.read_text(encoding='utf8')), chunk['start']))
        except ValueError:
            continue
        for word in candidates(words, chunk['start'], chunk['end'], generated[chunk['language']]):
            if (chunk['source'], chunk['sample_start'], word['word'], word['start'], word['end']) in valid:
                pools[chunk['source']].append((chunk, word))
    rng = random.Random(102)
    selected = []
    for source, n in [('rtZyZL3FfH4', 25), ('QiwQ62ypdcI', 25), ('6LB7vibQ5q0', 50)]:
        if len(pools[source]) < n:
            raise ValueError(f'{source}: somente {len(pools[source])} candidatas para {n}')
        selected.extend(rng.sample(pools[source], n))
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf8'))
    sources = {item['id']: item['file'] for item in manifest['items']}
    a.output.mkdir(parents=True, exist_ok=True)
    items = []
    for index, (chunk, word) in enumerate(selected, 1):
        name = f'{chunk["language"]}_{index:03d}'
        begin = max(0, (word['start'] + word['end']) / 2 - 1.5)
        label = word['word'].strip()
        subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(begin), '-i', str(a.media / sources[chunk['source']]),
                        '-t', '3', '-ac', '1', '-ar', '16000', '-y', str(a.output / (name + '.wav'))], check=True)
        (a.output / (name + '.txt')).write_text(f"{word['start']-begin:.6f}\t{word['end']-begin:.6f}\t{label}\n", encoding='utf8')
        items.append({'id': name, 'source': chunk['source'], 'sample_start': chunk['sample_start'],
                      'clip_start': begin, 'clip_duration': 3, 'word': label})
    (a.output / 'manifest.json').write_text(json.dumps({'seed': 102, 'items': items}, ensure_ascii=False, indent=2), encoding='utf8')
    shutil.copyfile(Path(__file__).with_name('kit_bordas.py'), a.output / 'kit_bordas.py')
    (a.output / 'LEIA-ME.txt').write_text('''Revisão de 100 palavras — Audacity

Para cada par com o mesmo nome, abra o WAV no Audacity e importe o TXT como faixa de rótulos (Arquivo > Importar > Rótulos). Ouça o contexto, amplie o trecho e use forma de onda e espectrograma para ajustar o início e o fim do rótulo da palavra. Os tempos iniciais são sugestões automáticas do MFA: corrija-os sem consultar resultados de outros modelos. Mantenha o texto e apenas um rótulo por arquivo. Exporte os rótulos para o mesmo TXT (Arquivo > Exportar > Exportar rótulos), preservando o nome. Repita para todos os 100 pares (50 PT e 50 EN).

Depois, no PowerShell, nesta pasta, execute: py kit_bordas.py . gabarito-revisado.json
O JSON contém tempos absolutos na Fonte. Não mova ou renomeie o manifesto ou os TXT antes da importação. Não envie áudio nem rótulos ao repositório.
''', encoding='utf8')
    print(f'{len(items)} palavras em {a.output}')


if __name__ == '__main__':
    main()
