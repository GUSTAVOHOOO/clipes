"""Compara busca FFmpeg à decodificação integral usada na referência curta."""
import argparse
import json
import subprocess
from pathlib import Path
import numpy as np
from faster_whisper.audio import decode_audio

p = argparse.ArgumentParser()
p.add_argument('--media', type=Path, required=True)
a = p.parse_args()
manifest = json.loads((Path(__file__).resolve().parents[1]/'dataset'/'manifest.json').read_text(encoding='utf8'))
item = next(i for i in manifest['items'] if i['id'] == 'QiwQ62ypdcI')
path = a.media/item['file']
full = decode_audio(str(path), sampling_rate=16000)
for sample in (item['samples'][0], item['samples'][1], item['samples'][-1]):
    t = sample['start']
    pcm = subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(path),'-t','3','-f','f32le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
    x = np.frombuffer(pcm,dtype='<f4')[16000:32000]
    center = int((t+1)*16000)
    _,lag = max((np.dot(x,full[center+k:center+k+len(x)]),k) for k in range(-4800,4801,16))
    print(f'{item["id"]} {t}: {lag/16:.1f} ms')
