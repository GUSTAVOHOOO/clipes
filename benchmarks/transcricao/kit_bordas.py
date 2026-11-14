"""Importa rótulos de bordas ajustados no Audacity para tempos da Fonte."""
import argparse
import json
import math
from pathlib import Path


def import_labels(items, directory):
    result = []
    for item in items:
        path = directory / (item['id'] + '.txt')
        lines = path.read_text(encoding='utf-8-sig').splitlines()
        if len(lines) != 1:
            raise ValueError(f'{path}: esperado exatamente um rótulo')
        fields = lines[0].split('\t')
        if len(fields) != 3 or fields[2] != item['word']:
            raise ValueError(f'{path}: palavra ou formato divergente')
        start, end = map(float, fields[:2])
        if not (math.isfinite(start) and math.isfinite(end) and
                0 <= start < end <= item['clip_duration']):
            raise ValueError(f'{path}: tempos inválidos')
        result.append({'source': item['source'], 'sample_start': item['sample_start'],
                       'word': item['word'], 'start': round(item['clip_start'] + start, 6),
                       'end': round(item['clip_start'] + end, 6)})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kit', type=Path, help='diretório contendo manifest.json e os rótulos')
    parser.add_argument('output', type=Path, help='JSON de saída, fora do repositório')
    args = parser.parse_args()
    items = json.loads((args.kit / 'manifest.json').read_text(encoding='utf8'))['items']
    result = import_labels(items, args.kit)
    args.output.write_text(json.dumps({'words': result}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def candidates(words, segment_start, segment_end, generated):
    result = []
    for i, word in enumerate(words):
        text = word['word'].strip(' .,!?;:')
        left = word['start'] - (words[i - 1]['end'] if i else segment_start)
        right = (words[i + 1]['start'] if i + 1 < len(words) else segment_end) - word['end']
        if (len(text) >= 3 and .12 <= word['end'] - word['start'] <= 1 and
                max(left, right) >= .02 and not word['normalized'] and
                text.casefold() not in generated):
            result.append(word)
    return result


if __name__ == '__main__':
    main()
