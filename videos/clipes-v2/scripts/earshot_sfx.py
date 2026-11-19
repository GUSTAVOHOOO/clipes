# Efeitos do filme com o banco do earshot (v0.4.1, commit 4ac3d2ac2b151e1c23376f9ce7f3047a17050013).
# Substitui scripts/sfx.mjs: lê os MESMOS cues.json (sync.mjs, na grade medida) e, para cada cue, o papel do kit
# declarado em timeline.json sfx[].kit. Renderiza o kit (audio/kit.json → audio/kit/ + kit.lock.json, sem modelos),
# mede o nível da música no segundo antes de cada cue (kit.bed_level) e põe o take no nível bed_db do papel
# (kit.gain_db), alinhado pelo onset/pico medido (kit.place). Saída: audio/sfx.wav + audio/sfx_placement.json.
# Rodar da raiz do projeto com o python do venv do earshot:
#   %TEMP%/clipes-video-earshot/venv/Scripts/python.exe scripts/earshot_sfx.py
import json
import math

import numpy as np
import soundfile as sf
from earshot.forge import kit

SR = 48000
T = json.load(open('timeline.json', encoding='utf-8'))
cues = json.load(open('cues.json', encoding='utf-8'))['cues']
lock = kit.render('audio/kit.json', 'audio/kit')
print(lock['summary'])
music, msr = sf.read('audio/music.wav', always_2d=True)
assert msr == SR

role_of = {s['what']: s['kit'] for s in T['sfx']}
N = int(SR * T['duration'])
out = np.zeros((N + SR, 2))
used, rows = {}, []
for c in sorted(cues, key=lambda c: c['t']):
    rname = role_of[c['what']]
    role = lock['roles'][rname]
    k = used.get(rname, 0)
    used[rname] = k + 1
    take = role['takes'][k % len(role['takes'])]
    y, s2 = sf.read('audio/kit/' + take['file'], always_2d=True)
    assert s2 == SR
    if y.shape[1] == 1:
        y = np.repeat(y, 2, 1)
    try:
        bed = kit.bed_level(music, c['t'], SR)
    except kit.KitError:
        bed = None
    # o peso do timeline (0.4–0.9) ajusta ±3 dB em torno do nível medido do papel
    trim = 0.5 * 20 * math.log10(max(c['gain'], 0.05) / 0.7)
    g = kit.gain_db(take, role, bed) + trim
    g = min(g, kit.CEILING_DB - take['peak_db']) if take.get('peak_db') is not None else g
    start = kit.place(take, role, c['t'])
    i0 = int(round(start * SR))
    seg = y * 10 ** (g / 20)
    if i0 < 0:
        seg, i0 = seg[-i0:], 0
    n = max(0, min(len(seg), len(out) - i0))
    out[i0:i0 + n] += seg[:n]
    rows.append({'t': round(c['t'], 4), 'mark': c.get('mark'), 'role': rname, 'sound': role.get('sound'),
                 'take': take['file'], 'bed_lufs': bed, 'gain_db': round(g, 2), 'start_s': start, 'what': c['what']})

out = out[:N]
sf.write('audio/sfx.wav', out.astype(np.float32), SR, subtype='FLOAT')
json.dump({'earshot': lock.get('earshot'), 'bank': lock.get('bank'), 'cues': rows},
          open('audio/sfx_placement.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
pk = 20 * np.log10(np.abs(out).max() + 1e-12)
print(f'audio/sfx.wav: {len(rows)} efeitos, pico {pk:.1f} dBFS')
for r in rows:
    bed = '  —  ' if r['bed_lufs'] is None else f"{r['bed_lufs']:6.1f}"
    print(f"{r['t']:7.3f}s {r['role']:<13} bed {bed} LUFS  ganho {r['gain_db']:6.1f} dB  {r['what'][:48]}")
