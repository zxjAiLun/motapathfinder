param(
  [string]$RepoRoot = "",
  [string]$ProjectRoot = "",
  [string]$RouteFile = "",
  [int]$StepDelayMs = 700,
  [switch]$NoLive,
  [switch]$NoAutoPlay,
  [switch]$Headless,
  [switch]$CloseWhenDone
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path $RepoRoot).Path
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Join-Path $RepoRoot "Only upV2.1\Only upV2.1"
} else {
  $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

if ([string]::IsNullOrWhiteSpace($RouteFile)) {
  $RouteFile = Join-Path $RepoRoot "shared-solver\routes\generated\agenda-policy-evaluation\mt1-mt3-i893-hp8425.current-exact.route.json"
} else {
  $RouteFile = (Resolve-Path $RouteFile).Path
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "project\data.js"))) {
  throw "Project root does not contain project\data.js: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $RouteFile)) {
  throw "Route file does not exist: $RouteFile"
}

$liveValue = if ($NoLive) { "0" } else { "1" }
$headlessValue = if ($Headless) { "1" } else { "0" }
$keepOpenValue = if ($CloseWhenDone) { "0" } else { "1" }

Set-Location $RepoRoot
if ($NoLive) {
  & node ".\shared-solver\route-gui.js" `
    "--project-root=$ProjectRoot" `
    "--route-file=$RouteFile" `
    "--live=0" `
    "--headless=$headlessValue" `
    "--step-delay-ms=$StepDelayMs" `
    "--keep-open=$keepOpenValue"
  if ($LASTEXITCODE -ne 0) {
    throw "Route GUI exited with code $LASTEXITCODE"
  }
  exit 0
}

$logFile = Join-Path $RepoRoot "shared-solver\routes\generated\windows-route-gui-live.log"
$errorLogFile = Join-Path $RepoRoot "shared-solver\routes\generated\windows-route-gui-live.err.log"
$nodeArguments = @(
  ".\shared-solver\route-gui.js",
  ('--project-root="' + $ProjectRoot + '"'),
  ('--route-file="' + $RouteFile + '"'),
  "--live=$liveValue",
  "--headless=$headlessValue",
  "--step-delay-ms=$StepDelayMs",
  "--keep-open=$keepOpenValue"
)
$guiProcess = Start-Process `
  -FilePath "node" `
  -WorkingDirectory $RepoRoot `
  -ArgumentList $nodeArguments `
  -RedirectStandardOutput $logFile `
  -RedirectStandardError $errorLogFile `
  -PassThru `
  -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(30)
$guiPort = $null
while ((Get-Date) -lt $deadline) {
  if ($guiProcess.HasExited) {
    throw "Route GUI exited before publishing its URL. See $errorLogFile"
  }
  if (Test-Path -LiteralPath $logFile) {
    $urlLine = Get-Content -LiteralPath $logFile -Tail 30 | Where-Object { $_ -match "Route GUI: http://127\.0\.0\.1:(\d+)/" } | Select-Object -Last 1
    if ($urlLine -match "Route GUI: http://127\.0\.0\.1:(\d+)/") {
      $guiPort = [int]$Matches[1]
      break
    }
  }
  Start-Sleep -Milliseconds 200
}
if (-not $guiPort) {
  throw "Timed out waiting for Route GUI URL. See $logFile"
}

$guiUrl = "http://127.0.0.1:$guiPort"
Write-Output "Route GUI: $guiUrl/"
Write-Output "Live browser and GUI are running; logs: $logFile"
if (-not $NoAutoPlay) {
  $sessionDeadline = (Get-Date).AddSeconds(30)
  $sessionReady = $false
  while ((Get-Date) -lt $sessionDeadline) {
    try {
      $sessionStatus = Invoke-RestMethod -Uri "$guiUrl/api/session/status"
      if ($sessionStatus.state -eq "failed") {
        throw "Live session failed before auto-play. See $errorLogFile"
      }
      if ($sessionStatus.state -eq "paused") {
        $sessionReady = $true
        break
      }
    } catch {
      if ($_.Exception.Message -like "Live session failed before auto-play.*") { throw }
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $sessionReady) {
    throw "Timed out waiting for live session to become ready. See $logFile"
  }
  $playResponse = Invoke-RestMethod `
    -Uri "$guiUrl/api/session/play" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{ stepDelayMs = $StepDelayMs } | ConvertTo-Json)
  if (-not $playResponse.ok) {
    throw "Route GUI refused auto-play. See $errorLogFile"
  }
  Write-Output "Auto-play started. Use -NoAutoPlay to leave the session paused."
}
if ($CloseWhenDone) {
  Wait-Process -Id $guiProcess.Id
}
