# ============================================================
#  Local processing agent - 3D Scan
#  Connects your Render site to this computer: sends a heartbeat,
#  pulls photo jobs, runs RealityScan, uploads the result model.
#
#  Run it by double-clicking run-agent.bat
# ============================================================

# ----------- SETTINGS: edit these three lines only -----------
$Server      = "https://YOUR-APP.onrender.com"
$Token       = "PASTE-YOUR-AGENT-TOKEN-HERE"
$RealityScan = "C:\Program Files\Epic Games\RealityScan\RealityScan.exe"
# -------------------------------------------------------------

$ErrorActionPreference = "Stop"
$Work = Join-Path $PSScriptRoot "work"
$ProcessBat = Join-Path $PSScriptRoot "process.bat"
$Headers = @{ Authorization = "Bearer $Token" }

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }

# ---------- Preflight: verify the link before waiting ----------
function Preflight {
  Log "Checking settings and connection..."

  if ($Server -match "YOUR-APP" -or [string]::IsNullOrWhiteSpace($Server)) {
    Log "X  Server URL not set. Edit the Server line at the top of agent.ps1."; return $false
  }
  if ($Token -match "PASTE-YOUR" -or [string]::IsNullOrWhiteSpace($Token)) {
    Log "X  Token not set. Paste AGENT_TOKEN from Render into the Token line."; return $false
  }
  if (-not (Test-Path $RealityScan)) {
    Log "!  RealityScan not found at: $RealityScan"
    Log "   Fix the RealityScan line at the top (processing will fail without it, but I'll still test the link)."
  } else {
    Log "OK RealityScan found"
  }

  # 1) Is the server up and the feature enabled?
  try {
    $st = Invoke-RestMethod -Uri "$Server/api/local/agent-status" -TimeoutSec 25
  } catch {
    Log "X  Cannot reach the server: $Server"
    Log "   Check the URL and that the Render service is a running Web Service."
    return $false
  }
  if (-not $st.enabled) {
    Log "X  Server is up but AGENT_TOKEN is not set in Render."
    return $false
  }
  Log "OK Server reachable and feature enabled"

  # 2) Is the token correct? (test heartbeat)
  try {
    Invoke-RestMethod -Uri "$Server/api/agent/heartbeat" -Method Post -Headers $Headers -TimeoutSec 25 | Out-Null
  } catch {
    Log "X  Wrong token - the Token value does not match AGENT_TOKEN in Render."
    return $false
  }
  Log "OK Token valid - connection successful!"
  Log "   Open your phone now; the Scan tab will show the computer as connected."
  return $true
}

Log "Starting agent - server: $Server"
if (-not (Preflight)) {
  Log "Stopped due to a setup issue above. Fix it and re-run run-agent.bat."
  exit 1
}
Log "Waiting for jobs... (keep this window open)"

while ($true) {
  try {
    # 1) heartbeat - tells the site the computer is online
    $beat = Invoke-RestMethod -Uri "$Server/api/agent/heartbeat" -Method Post -Headers $Headers -TimeoutSec 20
    if (-not $beat.hasJob) { Start-Sleep -Seconds 5; continue }

    # 2) pull the next job (marks it processing)
    $job = $null
    try {
      $resp = Invoke-WebRequest -Uri "$Server/api/agent/next" -Headers $Headers -TimeoutSec 20 -UseBasicParsing
      if ($resp.StatusCode -eq 200) { $job = $resp.Content | ConvertFrom-Json }
    } catch { $job = $null }
    if (-not $job) { Start-Sleep -Seconds 5; continue }

    Log "New job: $($job.id) - $($job.photoCount) photos - quality: $($job.quality)"

    # clean work folders for this job
    $jobDir = Join-Path $Work $job.id
    $photos = Join-Path $jobDir "photos"
    $out    = Join-Path $jobDir "out"
    if (Test-Path $jobDir) { Remove-Item $jobDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $photos, $out | Out-Null

    # 3) download photos (ZIP) and extract
    $zipPath = Join-Path $jobDir "photos.zip"
    Log "Downloading photos..."
    Invoke-WebRequest -Uri "$Server/api/agent/photos/$($job.id)" -Headers $Headers -OutFile $zipPath -TimeoutSec 300 -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $photos -Force

    # 4) run RealityScan via process.bat (call the .bat directly so cmd's
    #    multi-quote stripping rule can't mangle the paths)
    #    GLB export embeds the color texture in one file.
    $outFile = Join-Path $out "model.glb"
    Log "Running RealityScan... (may take several minutes)"
    & $ProcessBat $photos $outFile $job.quality $RealityScan
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "RealityScan returned error code $code" }
    if (-not (Test-Path $outFile)) { throw "RealityScan produced no model file (check photo quality and overlap)" }

    # 5) zip the output (obj + mtl if any) and upload
    $resultZip = Join-Path $jobDir "result.zip"
    Compress-Archive -Path (Join-Path $out "*") -DestinationPath $resultZip -Force
    Log "Uploading model..."
    Invoke-RestMethod -Uri "$Server/api/agent/result/$($job.id)" -Method Post -Headers $Headers `
      -InFile $resultZip -ContentType "application/zip" -TimeoutSec 600 | Out-Null

    Log "Done: job $($job.id)"
    Remove-Item $jobDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  catch {
    $msg = $_.Exception.Message
    Log "Error: $msg"
    # report failure so it shows on the phone
    if ($job -and $job.id) {
      try {
        Invoke-RestMethod -Uri "$Server/api/agent/fail/$($job.id)" -Method Post -Headers $Headers `
          -Body (@{ error = $msg } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 20 | Out-Null
      } catch {}
    }
    Start-Sleep -Seconds 5
  }
}
