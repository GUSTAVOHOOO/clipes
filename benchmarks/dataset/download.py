"""Baixa e verifica os arquivos fixados no manifesto do benchmark."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('manifest.json'))
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    for item in manifest['items']:
        filename = item['file']
        if Path(filename).name != filename:
            raise ValueError('Nome de arquivo inválido no manifesto')
        target = args.directory / filename
        if not target.exists():
            subprocess.run([sys.executable, '-m', 'yt_dlp', '--no-playlist', '-f', item['format'], '-o', str(target), item['url']], check=True)
        if sha256(target) != item['sha256']:
            raise ValueError(f'SHA-256 não confere: {filename}')
        print(f'SHA-256 OK: {filename}')


if __name__ == '__main__':
    main()
