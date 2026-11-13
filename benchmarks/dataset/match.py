"""Sugere correspondências entre legendas JSON3 de uma Fonte e de um Corte."""
import argparse
import collections
import json
import re
import unicodedata
from pathlib import Path


def tokens(data):
    result = []
    for event in data.get('events', []):
        for segment in event.get('segs', []):
            text = unicodedata.normalize('NFKD', segment.get('utf8', '').lower())
            text = ''.join(char for char in text if not unicodedata.combining(char))
            time = (event.get('tStartMs', 0) + segment.get('tOffsetMs', 0)) / 1000
            result.extend((word, time) for word in re.findall(r'[^\W_]+', text))
    return result


def find_matches(vod, clip, n=5):
    source = tokens(vod)
    excerpt = tokens(clip)
    index = collections.defaultdict(list)
    for i in range(len(source) - n + 1):
        index[tuple(word for word, _ in source[i:i+n])].append(i)
    votes = collections.Counter()
    evidence = collections.defaultdict(list)
    for j in range(len(excerpt) - n + 1):
        phrase = tuple(word for word, _ in excerpt[j:j+n])
        locations = index.get(phrase, [])
        if len(locations) != 1:
            continue
        source_time = source[locations[0]][1]
        clip_time = excerpt[j][1]
        offset = round((source_time - clip_time) / 2) * 2
        votes[offset] += 1
        if len(evidence[offset]) < 3:
            evidence[offset].append({'fonte_s': source_time, 'corte_s': clip_time, 'frase': ' '.join(phrase)})
    return [{'offset_seconds': offset, 'votes': count, 'evidence': evidence[offset]}
            for offset, count in votes.most_common()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fonte', type=Path, help='Legendas JSON3 da Fonte')
    parser.add_argument('corte', type=Path, help='Legendas JSON3 do Corte')
    args = parser.parse_args()
    source = json.loads(args.fonte.read_text(encoding='utf-8'))
    clip = json.loads(args.corte.read_text(encoding='utf-8'))
    print(json.dumps(find_matches(source, clip), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
