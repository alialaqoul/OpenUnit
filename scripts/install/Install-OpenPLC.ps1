<#
.SYNOPSIS
  Installs the OpenPLC soft-PLCs of OpenUnit, the plant simulator: a dedicated WSL distribution with
  OpenPLC Runtime v3 and one runtime instance per controller, plus OpenPLC Editor on Windows.

.DESCRIPTION
  1. Verifies the prerequisites: Windows build, Node.js 20+, WSL 2, OpenPLC Editor and its CLI.
     Missing pieces are offered for installation (WSL itself needs administrator rights and a reboot).
  2. Creates the dedicated WSL distribution (default "OpenUnit-PLC", Ubuntu 24.04), or imports a
     prebuilt one with -Package. Other WSL distributions are not touched.
  3. Builds OpenPLC Runtime v3 inside it and creates the 8 runtime instances (npm run plc:setup).
  4. Compiles and downloads the 8 PLC programs (npm run plc:deploy).
  Re-running it is safe: every step checks what is already there.

.PARAMETER Distro    Name of the dedicated WSL distribution.
.PARAMETER Package   A distribution exported with -Export on another PC: imported instead of building.
.PARAMETER Export    After installing, export the distribution to this .tar file for other PCs.
.PARAMETER SkipDeploy  Do not download the PLC programs.
.PARAMETER Yes       Answer yes to every question (unattended).

.EXAMPLE
  .\OpenUnit.cmd install
  .\OpenUnit.cmd install -Export D:\openunit-plc.tar
  .\OpenUnit.cmd install -Package D:\openunit-plc.tar
#>
param(
  [string]$Distro = 'OpenUnit-PLC',
  [string]$Package,
  [string]$Export,
  [switch]$SkipDeploy,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Config = Join-Path $Root 'config\network.json'
$DistroDir = Join-Path $env:LOCALAPPDATA "OpenUnit\wsl\$Distro"
$EditorExe = Join-Path $env:LOCALAPPDATA 'Programs\open-plc-editor\OpenPLC Editor.exe'
$CliShim = Join-Path $env:LOCALAPPDATA 'Programs\openplc-cli\openplc-cli.cmd'
# Pinned OpenPLC Editor release and its published SHA-256
$EditorUrl = 'https://github.com/Autonomy-Logic/openplc-editor/releases/download/v4.3.2/OpenPLC.Editor_4.3.2.exe'
$EditorSha256 = '84AA7ACCFE0A952C970A3D21B0A7B931AB9E62FC8A3FE19A41B7B085160A64EE'
$WslImage = 'Ubuntu-24.04'

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   [ OK ] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   [WARN] $text" -ForegroundColor Yellow }
function Bad($text) { Write-Host "   [FAIL] $text" -ForegroundColor Red }
function Ask($question) {
  if ($Yes) { return $true }
  $a = Read-Host "   $question [Y/n]"
  return ($a -eq '' -or $a -match '^[Yy]')
}
function Stop-Install($text, $code = 1) { Bad $text; Write-Host ''; exit $code }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Wsl-Text([string[]]$wslArgs) {
  # wsl.exe prints UTF-16 for its own messages. With 'Stop', PowerShell 5.1 would turn its stderr into
  # a terminating error, hence 'Continue' for this call.
  $ErrorActionPreference = 'Continue'
  $out = & wsl.exe @wslArgs 2>&1 | Out-String
  return ($out -replace "`0", '')
}
function Get-Distros {
  try { return (Wsl-Text @('-l', '-q')) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ } } catch { return @() }
}

Write-Host 'OpenUnit - 700 MW plant simulator - OpenPLC soft-PLC installer' -ForegroundColor White
Write-Host "Project: $Root"

# ---------------------------------------------------------------- 1. prerequisites
Step 'Checking prerequisites'

$build = [Environment]::OSVersion.Version.Build
if ($build -lt 19041) { Stop-Install "Windows 10 2004 (build 19041) or newer is required for WSL 2 (this is build $build)" }
Ok "Windows build $build"

$nodeOk = $false
try {
  $nv = (& node --version) -replace '^v', ''
  if ([version]$nv -ge [version]'20.0.0') { $nodeOk = $true; Ok "Node.js $nv" } else { Warn "Node.js $nv is too old (20 or newer needed)" }
} catch { Warn 'Node.js not found' }
if (-not $nodeOk) {
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask 'Install Node.js LTS with winget?')) {
    & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
    try { $nv = (& node --version) -replace '^v', ''; Ok "Node.js $nv" } catch { Stop-Install 'Node.js installed - open a new terminal and run the installer again' }
  } else { Stop-Install 'Install Node.js 20 or newer from https://nodejs.org and run the installer again' }
}

$wslOk = $false
if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
  $status = Wsl-Text @('--status')
  if ($LASTEXITCODE -eq 0) {
    $ver = (Wsl-Text @('--version')) -split "`r?`n" | Select-Object -First 1
    if ($ver -match '(\d+\.\d+\.\d+)') { Ok "WSL $($Matches[1])" } else { Ok 'WSL installed' }
    $wslOk = $true
  }
}
if (-not $wslOk) {
  Warn 'WSL (Windows Subsystem for Linux) is not installed or not enabled'
  if (Ask 'Install WSL now? (needs administrator rights, then a reboot)') {
    $p = Start-Process wsl.exe -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait -PassThru
    if ($p.ExitCode -ne 0) { Stop-Install "WSL installation failed (exit $($p.ExitCode)). Check that virtualization is enabled in the BIOS/UEFI." }
    Stop-Install 'WSL installed. Restart Windows, then run this installer again.' 3
  } else { Stop-Install 'WSL is required: run  wsl --install  as administrator, reboot, and run this installer again' }
}

if (Test-Path $EditorExe) { Ok 'OpenPLC Editor installed' } else {
  Warn 'OpenPLC Editor not installed (needed to compile the PLC programs and to watch the logic live)'
  if (Ask 'Download and install OpenPLC Editor 4.3.2 (per user, no admin rights)?') {
    $dl = Join-Path $env:TEMP 'OpenPLC.Editor_4.3.2.exe'
    Write-Host '   downloading ...'
    Invoke-WebRequest -Uri $EditorUrl -OutFile $dl -UseBasicParsing
    $sum = (Get-FileHash $dl -Algorithm SHA256).Hash
    if ($sum -ne $EditorSha256) { Remove-Item $dl -Force; Stop-Install "OpenPLC Editor download has the wrong checksum ($sum)" }
    $p = Start-Process $dl -ArgumentList '/S' -Wait -PassThru
    Remove-Item $dl -Force
    if (-not (Test-Path $EditorExe)) { Stop-Install "OpenPLC Editor installation failed (exit $($p.ExitCode))" }
    Ok 'OpenPLC Editor installed'
  } elseif (-not $SkipDeploy) { Stop-Install 'OpenPLC Editor is required to deploy the programs (or use -SkipDeploy)' }
}
if ((Test-Path $EditorExe) -and -not (Test-Path $CliShim)) {
  # The CLI must not inherit "run as plain Node" from an editor terminal
  $saved = $env:ELECTRON_RUN_AS_NODE; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $p = Start-Process $EditorExe -ArgumentList '--cli', 'install-cli' -Wait -PassThru -WindowStyle Hidden
  if ($saved) { $env:ELECTRON_RUN_AS_NODE = $saved }
}
if (Test-Path $CliShim) { Ok 'openplc-cli available' } elseif (-not $SkipDeploy) { Stop-Install 'openplc-cli could not be installed: launch OpenPLC Editor once, then run the installer again' }

# ---------------------------------------------------------------- 2. dedicated WSL distribution
Step "WSL distribution '$Distro'"
$have = Get-Distros
if ($have -contains $Distro) {
  Ok 'already exists - reusing it'
} else {
  New-Item -ItemType Directory -Force (Split-Path $DistroDir -Parent) | Out-Null
  if ($Package) {
    if (-not (Test-Path $Package)) { Stop-Install "Package not found: $Package" }
    Write-Host "   importing $Package ..."
    & wsl.exe --import $Distro $DistroDir $Package
    if ($LASTEXITCODE -ne 0) { Stop-Install 'wsl --import failed' }
    Ok "imported into $DistroDir"
  } else {
    Write-Host "   installing $WslImage as '$Distro' (download about 400 MB) ..."
    New-Item -ItemType Directory -Force $DistroDir | Out-Null
    & wsl.exe --install $WslImage --name $Distro --location $DistroDir --no-launch
    if ($LASTEXITCODE -ne 0) { Stop-Install "Creating the distribution failed. Is virtualization enabled? Try: wsl --install $WslImage --name $Distro" }
    Ok "installed into $DistroDir"
  }
}
# The simulator works as root inside it; also skip the first-run user prompt if someone opens it.
& wsl.exe -d $Distro -u root -- sh -c "grep -q '^default=root' /etc/wsl.conf 2>/dev/null || printf '\n[user]\ndefault=root\n' >> /etc/wsl.conf"
$who = (Wsl-Text @('-d', $Distro, '-u', 'root', '--', 'whoami')).Trim()
if ($who -ne 'root') { Stop-Install "The distribution does not run commands ($who)" }
Ok 'distribution runs commands'

# Point the simulator at it
$json = Get-Content $Config -Raw
$json2 = $json -replace '("distro"\s*:\s*)"[^"]*"', ('$1"' + $Distro + '"')
if ($json2 -ne $json) { [IO.File]::WriteAllText($Config, $json2, (New-Object Text.UTF8Encoding $false)); Ok "config/network.json -> openplc.wsl.distro = $Distro" }

# ---------------------------------------------------------------- 3. OpenPLC runtime + instances
Step 'OpenPLC Runtime v3 and the 8 controller instances (first time: about 10 minutes)'
Push-Location $Root
try {
  & node scripts/plc-setup.js
  if ($LASTEXITCODE -ne 0) { Stop-Install 'OpenPLC setup failed (see the messages above)' }
  Ok 'runtimes ready'

  # ---------------------------------------------------------------- 4. programs
  if (-not $SkipDeploy) {
    Step 'Compiling and downloading the 8 PLC programs'
    & node scripts/plc-deploy.js
    if ($LASTEXITCODE -ne 0) { Stop-Install 'Deploying the PLC programs failed (see the messages above)' }
    Ok 'programs deployed'
  }
} finally { Pop-Location }

# ---------------------------------------------------------------- 5. optional export
if ($Export) {
  Step "Exporting '$Distro' to $Export"
  & wsl.exe --terminate $Distro | Out-Null
  & wsl.exe --export $Distro $Export
  if ($LASTEXITCODE -ne 0) { Stop-Install 'wsl --export failed' }
  Ok "exported - install it on another PC with:  OpenUnit.cmd install -Package `"$Export`""
}

Step 'Done'
Write-Host '   Start the simulator with the soft-PLCs:   npm run start:openplc'
Write-Host '   HMI: http://127.0.0.1:8080    OpenPLC Editor: open plc\projects\<NODE>, runtime 127.0.0.11 ... .18, user/password openplc'
Write-Host ''
