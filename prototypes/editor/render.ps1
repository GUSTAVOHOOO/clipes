$ErrorActionPreference='Stop'
foreach ($encoder in @('h264_nvenc','libx264')) {
  $log = Join-Path (Get-Location) "media/$encoder.log"
  $args = @('-hide_banner','-y','-ss','120','-i','media/fonte.mp4','-t','60','-vf','crop=608:1080:656:0,scale=1080:1920,ass=media/karaoke.ass','-c:v',$encoder,'-preset',$(if($encoder -eq 'h264_nvenc'){'p4'}else{'medium'}),'-c:a','aac',"media/$encoder.mp4")
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $p=Start-Process ffmpeg -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput "media/$encoder.out"
  $ram=0; $gpu=0
  while (-not $p.HasExited) { $p.Refresh(); try { $ram=[Math]::Max($ram,$p.WorkingSet64) } catch {}; $v=(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | Select-Object -First 1); if ($v -match '^\d+$') { $gpu=[Math]::Max($gpu,[int]$v) }; Start-Sleep -Milliseconds 500 }
  $watch.Stop(); $p.WaitForExit(); [pscustomobject]@{encoder=$encoder;seconds=$watch.Elapsed.TotalSeconds;ramMiB=[Math]::Round($ram/1MB,1);gpuTotalMiB=$gpu;exit=$p.ExitCode} | ConvertTo-Json -Compress | Add-Content -Encoding utf8 media/render-metrics.jsonl
}
