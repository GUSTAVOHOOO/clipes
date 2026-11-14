"""Confere fones G2P e prepara dicionário estendido para o MFA."""
import argparse
import json
import zipfile
from pathlib import Path


def incompatible_phones(lines, acoustic_phones):
    return {phone for line in lines if line.strip() for phone in line.split()[1:]} - set(acoustic_phones)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--acoustic', type=Path, required=True)
    p.add_argument('--dictionary', type=Path, required=True)
    p.add_argument('--g2p', type=Path, required=True)
    p.add_argument('--oov', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    with zipfile.ZipFile(a.acoustic) as archive:
        meta = json.loads(archive.read(next(name for name in archive.namelist() if name.endswith('meta.json'))))
    lines = a.g2p.read_text(encoding='utf8').splitlines()
    missing_phones = incompatible_phones(lines, meta['phones'])
    missing_words = set(a.oov.read_text(encoding='utf8').splitlines()) - {line.split()[0] for line in lines if line.strip()}
    if missing_phones or missing_words:
        raise ValueError(f'fones incompatíveis: {sorted(missing_phones)}; palavras sem pronúncia: {sorted(missing_words)}')
    base = a.dictionary.read_text(encoding='utf8').rstrip()
    a.output.write_text(base + '\n' + '\n'.join(lines) + '\n', encoding='utf8')
    print(f'{len(set(line.split()[0] for line in lines if line.strip()))} palavras G2P; fones compatíveis')


if __name__ == '__main__':
    main()
