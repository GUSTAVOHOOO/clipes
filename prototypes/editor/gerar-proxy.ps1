$ErrorActionPreference = "Stop"
ffmpeg -hide_banner -y -hwaccel cuda -hwaccel_output_format cuda -i media/fonte.mp4 -vf scale_cuda=640:360 -c:v h264_nvenc -preset p1 -cq 30 -g 30 -c:a copy -movflags +faststart media/proxy.mp4
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar proxy" }
