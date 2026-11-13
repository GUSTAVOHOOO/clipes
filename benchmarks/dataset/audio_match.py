"""Localiza áudio de Cortes/compilações sem legendas, tokens ou diarização.

Dependências: numpy, scipy e ffmpeg no PATH. Não baixa mídia nem altera manifesto.
Tempos publicados são limites conservadores do áudio confirmado, não da edição humana.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.fft import rfft, irfft, next_fast_len

RATE = 8000
HOP = 400
WINDOW = 6.0
STEP = 3.0
MIN_DURATION = 10.0
COARSE_THRESHOLD = 0.35
WAVE_THRESHOLD = 0.65
EDGE_THRESHOLD = 0.55


def merge_segments(segments):
    """An anchor gap must not count overlapping portions of one edit twice."""
    merged = []
    for segment in sorted(segments, key=lambda x: x['clip_start']):
        current = dict(segment)
        if merged:
            previous = merged[-1]
            offset = current['start']-current['clip_start']
            old_offset = previous['start']-previous['clip_start']
            if (abs(offset-old_offset) <= .025 and
                    current['clip_start'] <= previous['clip_end']):
                previous['clip_end'] = max(previous['clip_end'], current['clip_end'])
                previous['end'] = round(previous['clip_end']+old_offset, 3)
                previous['score'] = min(previous['score'], current['score'])
                previous['coarse_score'] = min(previous['coarse_score'], current['coarse_score'])
                previous['anchors'] = previous['anchors']+current['anchors']
                continue
        merged.append(current)
    return merged


def decode(path, cache):
    """Cache PCM mono 8 kHz, memmapped to keep 12-hour sources off the heap."""
    cache = Path(cache)
    if not cache.exists():
        partial = cache.with_suffix('.partial')
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path),
                        '-vn', '-ac', '1', '-ar', str(RATE), '-f', 'f32le',
                        '-y', str(partial)], check=True)
        partial.replace(cache)
    return np.memmap(cache, dtype='<f4', mode='r')


def features(audio, rate=RATE):
    """Temporal changes in 24 log-frequency energy bands, every 50 ms."""
    hop = round(rate * .05)
    rows = []
    block = 300 * rate
    edges = np.unique(np.geomspace(2, 256, 25).astype(int))
    for start in range(0, len(audio) - 512, block):
        data = np.asarray(audio[start:min(start + block + 512, len(audio))])
        _, _, spectrum = signal.stft(data, fs=rate, nperseg=512,
                                     noverlap=512-hop, boundary=None, padded=False)
        power = np.abs(spectrum)**2
        bands = np.stack([np.log(np.maximum(power[a:b].mean(axis=0), 1e-12))
                          for a, b in zip(edges[:-1], edges[1:])])
        # Derivatives suppress stationary music/noise and channel equalization.
        delta = np.diff(bands, axis=1)
        rows.append(delta[:, :block//hop])
    return np.ascontiguousarray(np.concatenate(rows, axis=1), dtype=np.float32)


class Matcher:
    def __init__(self, source, rate=RATE):
        self.source = source
        self.rate = rate
        self.hop = round(rate * .05)
        self.features = features(source, rate)
        self.length = self.features.shape[1]
        self.query_length = round(WINDOW / .05)
        self.fft_length = next_fast_len(self.length + self.query_length)
        self.fft = rfft(self.features, self.fft_length, axis=1, workers=2)
        energy = np.sum(self.features.astype(np.float64)**2, axis=0)
        cumulative = np.r_[0., np.cumsum(energy)]
        self.norm = np.sqrt(np.maximum(cumulative[self.query_length:] -
                                       cumulative[:-self.query_length], 1e-12))

    def locate(self, query):
        norm = np.linalg.norm(query)
        if norm < 1e-5:
            return None
        product = self.fft * rfft(query[:, ::-1], self.fft_length, axis=1, workers=2)
        corr = irfft(product.sum(axis=0), self.fft_length)
        corr = corr[self.query_length-1:self.length] / (self.norm * norm)
        # FFT roundoff divided by near-zero energy can exceed a real peak.
        corr[self.norm < norm*.01] = -1
        best = int(corr.argmax())
        score = float(corr[best])
        if score < COARSE_THRESHOLD:
            return None
        # Repeated music or game dialogue alone must not establish a unique offset.
        corr[max(0, best-40):best+41] = -1
        if score - float(corr.max()) < .05:
            return None
        return best * self.hop / self.rate, score

    def refine(self, clip, clip_start, source_start, duration=WINDOW):
        rate = self.rate
        query = np.asarray(clip[round(clip_start*rate):round((clip_start+duration)*rate)])
        left = max(0, round((source_start-.15)*rate))
        right = min(len(self.source), round((source_start+duration+.15)*rate))
        source = np.asarray(self.source[left:right])
        if len(query) < round(duration*rate) or len(source) < len(query):
            return None
        query = query - query.mean()
        norm = np.linalg.norm(query)
        if norm < 1e-5:
            return None
        c = signal.correlate(source, query, mode='valid', method='fft')
        cumulative = np.r_[0., np.cumsum(source.astype(np.float64)**2)]
        means = np.r_[0., np.cumsum(source.astype(np.float64))]
        sums = means[len(query):] - means[:-len(query)]
        variance = cumulative[len(query):] - cumulative[:-len(query)] - sums**2/len(query)
        c = np.abs(c) / (np.sqrt(np.maximum(variance, 1e-12)) * norm)
        i = int(c.argmax())
        return (left+i)/rate, min(1., float(c[i]))

    def match(self, clip):
        if min(len(self.source), len(clip))/self.rate < MIN_DURATION:
            return []
        clip_features = features(clip, self.rate)
        anchors = []
        for frame in range(0, clip_features.shape[1]-self.query_length+1, round(STEP/.05)):
            coarse = self.locate(clip_features[:, frame:frame+self.query_length])
            if coarse is None:
                continue
            clip_start = frame*.05
            refined = self.refine(clip, clip_start, coarse[0])
            if refined and refined[1] >= WAVE_THRESHOLD:
                anchors.append({'clip': clip_start, 'offset': refined[0]-clip_start,
                                'score': refined[1], 'coarse_score': coarse[1]})
        groups = []
        for anchor in anchors:
            if (groups and anchor['clip']-groups[-1][-1]['clip'] <= WINDOW and
                    abs(anchor['offset']-groups[-1][-1]['offset']) <= .025):
                groups[-1].append(anchor)
            else:
                groups.append([anchor])
        result = []
        for group in groups:
            if len(group) < 2:
                continue
            offset = float(np.median([a['offset'] for a in group]))
            start, end = group[0]['clip'], group[-1]['clip']+WINDOW
            # Check every second inside the proposed segment: never bridge an edit.
            seconds = []
            for time in np.arange(max(0., start-STEP), min(len(clip)/self.rate-1, end+STEP)+.001, .25):
                check = self.refine(clip, float(time), float(time+offset), duration=1.)
                if check and check[1] >= EDGE_THRESHOLD and abs(check[0]-time-offset) <= .025:
                    seconds.append(float(time))
            runs = []
            for time in seconds:
                if runs and time-runs[-1][-1] < .26:
                    runs[-1].append(time)
                else:
                    runs.append([time])
            for run in runs:
                a, b = run[0], run[-1]+1.
                # A one-second check can straddle an edit. Keep an interior
                # half-second margin, except at the physical ends of the clip.
                a = a+.5 if a > .25 else a
                b = b-.5 if len(clip)/self.rate-b > .25 else b
                if b-a < MIN_DURATION:
                    continue
                confirmed = [x for x in group if x['clip'] >= a-.01 and
                             x['clip']+WINDOW <= b+.01]
                if len(confirmed) < 2:
                    continue
                result.append({'clip_start': round(a, 3), 'clip_end': round(b, 3),
                               'start': round(a+offset, 3), 'end': round(b+offset, 3),
                               'score': round(min(x['score'] for x in confirmed), 4),
                               'coarse_score': round(min(x['coarse_score'] for x in confirmed), 4),
                               'anchors': confirmed})
        return merge_segments(result)


def match_arrays(source, clip, rate=RATE):
    if min(len(source), len(clip))/rate < MIN_DURATION:
        return []
    return Matcher(source, rate).match(clip)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('clips', nargs='+', type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    source = decode(args.source, args.cache/(args.source.stem+'.f32'))
    matcher = Matcher(source)
    results = {}
    for path in args.clips:
        clip = decode(path, args.cache/(path.stem+'.f32'))
        results[path.stem] = matcher.match(clip)
        args.output.write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(path.stem, len(results[path.stem]), flush=True)


if __name__ == '__main__':
    main()
