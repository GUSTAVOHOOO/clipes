import json
from pathlib import Path
p=Path(__file__).parent/'media';p.mkdir(exist_ok=True)
vocab='a legenda acompanha cada palavra no tempo do vídeo'.split()
words=[{'text':vocab[i%len(vocab)],'start':round(i*.3,3),'end':round((i+1)*.3,3)} for i in range(24000)]
(p/'transcript.json').write_text(json.dumps(words,ensure_ascii=False),encoding='utf8')
header="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H0000FF00,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,250,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
def time(s): return f'0:{int(s//60):02}:{s%60:05.2f}'
for i in range(0,200,4):
 a=i*.3;b=min(60,(i+4)*.3); text=' '.join(r'{\kf30}'+vocab[j%len(vocab)] for j in range(i,i+4))
 header+=f'Dialogue: 0,{time(a)},{time(b)},Default,,0,0,0,,{text}\n'
(p/'karaoke.ass').write_text(header,encoding='utf8')
