# ============================================================
#  وكيل المعالجة المحلية — 3D Scan
#  يربط موقعك على Render بكمبيوترك: ينبض بالحياة، يسحب مهام
#  الصور، يشغّل RealityScan، ويرفع النموذج الناتج.
#
#  التشغيل: انقر نقرًا مزدوجًا على run-agent.bat
#  (أو:  powershell -ExecutionPolicy Bypass -File agent.ps1)
# ============================================================

# ----------- الإعدادات: عدّل هذي الثلاثة فقط -----------
$Server      = "https://YOUR-APP.onrender.com"   # رابط موقعك على Render
$Token       = "PASTE-YOUR-AGENT-TOKEN-HERE"     # نفس قيمة AGENT_TOKEN في Render
$RealityScan = "C:\Program Files\Epic Games\RealityScan\RealityScan.exe"
# --------------------------------------------------------

$ErrorActionPreference = "Stop"
$Work = Join-Path $PSScriptRoot "work"
$ProcessBat = Join-Path $PSScriptRoot "process.bat"
$Headers = @{ Authorization = "Bearer $Token" }

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }

if (-not (Test-Path $RealityScan)) {
  Log "تحذير: لم أجد RealityScan في: $RealityScan"
  Log "عدّل المسار في أعلى agent.ps1 ثم أعد التشغيل."
}

Log "بدء الوكيل — الخادم: $Server"
Log "في انتظار المهام… (اترك هذه النافذة مفتوحة)"

while ($true) {
  try {
    # 1) نبضة حياة — يعرف الموقع أن الكمبيوتر متصل
    $beat = Invoke-RestMethod -Uri "$Server/api/agent/heartbeat" -Method Post -Headers $Headers -TimeoutSec 20
    if (-not $beat.hasJob) { Start-Sleep -Seconds 5; continue }

    # 2) اسحب المهمة التالية
    $job = $null
    try {
      $resp = Invoke-WebRequest -Uri "$Server/api/agent/next" -Headers $Headers -TimeoutSec 20
      if ($resp.StatusCode -eq 200) { $job = $resp.Content | ConvertFrom-Json }
    } catch { $job = $null }
    if (-not $job) { Start-Sleep -Seconds 5; continue }

    Log "مهمة جديدة: $($job.id) — $($job.photoCount) صورة — جودة: $($job.quality)"

    # مجلدات عمل نظيفة لهذه المهمة
    $jobDir = Join-Path $Work $job.id
    $photos = Join-Path $jobDir "photos"
    $out    = Join-Path $jobDir "out"
    if (Test-Path $jobDir) { Remove-Item $jobDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $photos, $out | Out-Null

    # 3) نزّل الصور (ZIP) وفكّها
    $zipPath = Join-Path $jobDir "photos.zip"
    Log "تنزيل الصور…"
    Invoke-WebRequest -Uri "$Server/api/agent/photos/$($job.id)" -Headers $Headers -OutFile $zipPath -TimeoutSec 300
    Expand-Archive -Path $zipPath -DestinationPath $photos -Force

    # 4) شغّل RealityScan عبر process.bat
    $outFile = Join-Path $out "model.obj"
    Log "تشغيل RealityScan… (قد يستغرق عدة دقائق)"
    $p = Start-Process -FilePath "cmd.exe" `
         -ArgumentList "/c", "`"$ProcessBat`"", "`"$photos`"", "`"$outFile`"", $job.quality `
         -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { throw "RealityScan رجع رمز خطأ $($p.ExitCode)" }
    if (-not (Test-Path $outFile)) { throw "لم يُنتج RealityScan ملف نموذج (تحقق من جودة الصور والتداخل)" }

    # 5) اضغط الناتج (obj + mtl إن وُجد) وارفعه
    $resultZip = Join-Path $jobDir "result.zip"
    Compress-Archive -Path (Join-Path $out "*") -DestinationPath $resultZip -Force
    Log "رفع النموذج…"
    Invoke-RestMethod -Uri "$Server/api/agent/result/$($job.id)" -Method Post -Headers $Headers `
      -InFile $resultZip -ContentType "application/zip" -TimeoutSec 600 | Out-Null

    Log "✅ اكتملت المهمة $($job.id)"
    Remove-Item $jobDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  catch {
    $msg = $_.Exception.Message
    Log "خطأ: $msg"
    # أبلغ السيرفر بالفشل حتى يظهر للمستخدم على الجوال
    if ($job -and $job.id) {
      try {
        Invoke-RestMethod -Uri "$Server/api/agent/fail/$($job.id)" -Method Post -Headers $Headers `
          -Body (@{ error = $msg } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 20 | Out-Null
      } catch {}
    }
    Start-Sleep -Seconds 5
  }
}
