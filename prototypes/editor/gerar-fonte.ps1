$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force media | Out-Null
py generate.py
ffmpeg -hide_banner -y -f lavfi -i "color=c=0x33475e:s=1920x1080:r=30:d=7200" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=7200" -vf "drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':timecode='00\:00\:00\:00':rate=30:fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" -c:v h264_nvenc -preset p1 -rc vbr -cq 35 -b:v 1M -g 300 -c:a aac -b:a 48k -movflags +faststart -shortest media/fonte.mp4
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar Fonte" }
