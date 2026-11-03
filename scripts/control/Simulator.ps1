<#
.SYNOPSIS
  Control panel of OpenUnit, the 700 MW plant simulator: start, stop and monitor everything - the process
  model, the controllers (Node.js or OpenPLC soft-PLCs in WSL), the I/O bridge and the web HMI.

.DESCRIPTION
  OpenUnit.cmd                       interactive menu
  OpenUnit.cmd install [-Yes] [-SkipDeploy] [-Distro name] [-Export file.tar] [-Package file.tar]
                                     install / repair: prerequisites, WSL distribution, OpenPLC, PLC programs
  OpenUnit.cmd start [openplc|node] [-IC n] [-NoBrowser]
                                     start everything in the background (default: openplc when installed)
  OpenUnit.cmd stop                  stop everything, including the OpenPLC runtimes
  OpenUnit.cmd restart [mode]        stop + start
  OpenUnit.cmd status                what is running
  OpenUnit.cmd hmi                   open the HMI in the browser
  OpenUnit.cmd editor                open OpenPLC Editor with the controller projects (logic diagrams)
  OpenUnit.cmd plc status            OpenPLC runtimes and PLC states
  OpenUnit.cmd plc run|stop|restart <NODE|all>
  OpenUnit.cmd plc web <NODE>        open a runtime's web page (live values of every variable)
  OpenUnit.cmd deploy [NODE ...]     compile and download PLC programs
  OpenUnit.cmd check [NODE ...]      check PLC programs with the runtime compiler
  OpenUnit.cmd logs                  follow the simulator log (Ctrl+C to leave)
#>
param(
  [Parameter(Position = 0)][string]$Command = 'menu',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @(),
  [int]$IC = 0,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$LogDir = Join-Path $Root 'logs'
$PidFile = Join-Path $LogDir 'simulator.pid'
$ModeFile = Join-Path $LogDir 'simulator.mode'
$LogFile = Join-Path $LogDir 'simulator.log'
$ErrFile = Join-Path $LogDir 'simulator-error.log'
$Cfg = Get-Content (Join-Path $Root 'config\network.json') -Raw | ConvertFrom-Json
$HmiUrl = "http://$($Cfg.hmi.host):$($Cfg.hmi.port)"
$Distro = $Cfg.openplc.wsl.distro
$EditorExe = Join-Path $env:LOCALAPPDATA 'Programs\open-plc-editor\OpenPLC Editor.exe'
$Controllers = 'CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP'

function Seg([string]$t, [string]$color = 'Gray') { Write-Host $t -NoNewline -ForegroundColor $color }
function Info($t) { Write-Host "  $t" }
function Ok($t) { Seg '  [ OK ] ' 'Green'; Write-Host $t }
function Warn($t) { Seg '  [ -- ] ' 'Yellow'; Write-Host $t }
function Bad($t) { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function Ask([string]$q) {
  Seg "  $q " 'Cyan'
  $a = Read-Host
  if ($null -eq $a) { return $null }   # end of input (piped)
  return $a.Trim()
}

function Require-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Bad 'Node.js is not installed - run OpenUnit.cmd install'; exit 1 }
}
function Quiet-Native([scriptblock]$block) {
  # With 'Stop', PowerShell 5.1 turns a native program's redirected stderr into a terminating error
  $ErrorActionPreference = 'Continue'
  & $block 2>$null
}
function OpenPlc-Installed {
  try { $l = (Quiet-Native { & wsl.exe -l -q } | Out-String) -replace "`0", '' } catch { return $false }
  return ($l -split "`r?`n" | ForEach-Object { $_.Trim() }) -contains $Distro
}
function Get-SimProcesses {
  # Every node.exe of this simulator: the launcher and the processes it forks
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine -match 'src[\\/]launcher\.js' -or ($_.CommandLine -like "*$Root*" -and $_.CommandLine -match 'src[\\/](plant|hmi|controllers|openplc)[\\/]'))
  }
}
function Get-Launcher {
  if (Test-Path $PidFile) {
    $id = [int](Get-Content $PidFile -Raw)
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and ($p.ProcessName -eq 'node' -or $p.ProcessName -eq 'cmd')) { return $p }
  }
  $l = Get-SimProcesses | Where-Object { $_.CommandLine -match 'launcher\.js' } | Select-Object -First 1
  if ($l) { return Get-Process -Id $l.ProcessId -ErrorAction SilentlyContinue }
  return $null
}
function Hmi-Up {
  try { $null = Invoke-WebRequest "$HmiUrl/api/catalog" -UseBasicParsing -TimeoutSec 2; return $true } catch { return $false }
}
function Listening-Ports {
  $set = @{}
  foreach ($line in (netstat -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING') { $set[[int]$Matches[1]] = $true }
  }
  return $set
}

# ------------------------------------------------------------------ commands
function Start-Sim([string]$mode) {
  Require-Node
  if (Get-Launcher) { Warn 'The simulator is already running (OpenUnit.cmd stop first).'; return }
  if (-not $mode) { if (OpenPlc-Installed) { $mode = 'openplc' } else { $mode = 'node' } }
  if ($mode -eq 'openplc' -and -not (OpenPlc-Installed)) { Bad "OpenPLC is not installed (WSL distribution '$Distro' missing) - run OpenUnit.cmd install, or start in node mode"; return }
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  # Created through WMI: fully detached from this window (closing it does not stop the simulator),
  # hidden, with the output going to the log files.
  $node = (Get-Command node).Source
  $flags = if ($mode -eq 'openplc') { ' --openplc' } else { '' }
  $envSet = if ($IC -gt 0) { "set SIM_IC=$IC&& " } else { 'set SIM_IC=&& ' }
  $cmdLine = "cmd.exe /d /c `"${envSet}set SIM_RUNTIME=&& set SIM_CONFIG=&& `"$node`" src\launcher.js$flags > `"$LogFile`" 2> `"$ErrFile`"`""
  $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $Root; ProcessStartupInformation = $si }
  if ($r.ReturnValue -ne 0) { Bad "Could not start the simulator (Win32_Process.Create returned $($r.ReturnValue))"; return }
  $p = Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue
  Set-Content $PidFile $r.ProcessId
  Set-Content $ModeFile $mode
  $what = if ($mode -eq 'openplc') { 'plant + 8 OpenPLC soft-PLCs + I/O bridge + HMI' } else { 'plant + 8 Node.js controllers + HMI' }
  Info "Starting the simulator ($what) ..."
  $t0 = Get-Date
  while (-not (Hmi-Up)) {
    if (-not $p -or $p.HasExited) { Bad 'The simulator stopped during start-up - see logs\simulator-error.log'; Get-Content $ErrFile -Tail 15 -ErrorAction SilentlyContinue; return }
    if (((Get-Date) - $t0).TotalSeconds -gt 120) { Bad 'The HMI did not come up within 2 minutes - see logs\simulator.log'; return }
    Start-Sleep -Milliseconds 500
  }
  if ($mode -eq 'openplc') {
    # the plant waits until every PLC has been initialised by the I/O bridge
    while (-not (Select-String -Path $LogFile -Pattern 'simulation running' -Quiet) -and ((Get-Date) - $t0).TotalSeconds -lt 120) { Start-Sleep -Milliseconds 500 }
  }
  Ok "Simulator running ($mode) - HMI $HmiUrl   (log: logs\simulator.log)"
  if (-not $NoBrowser) { Start-Process $HmiUrl }
}

function Stop-Sim {
  $procs = @(Get-SimProcesses)
  $launcher = Get-Launcher
  if ($launcher) { Quiet-Native { & taskkill.exe /T /F /PID $launcher.Id } | Out-Null }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($launcher -or $procs.Count) { Ok 'Simulator processes stopped' } else { Info 'The simulator was not running' }
  if (OpenPlc-Installed) {
    Push-Location $Root
    try { & node -e "import('./src/openplc/host.js').then(async (h) => { await h.stopAllRuntimes(); })" } finally { Pop-Location }
    Ok 'OpenPLC runtimes stopped'
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Show-Status {
  Write-Host ''
  $launcher = Get-Launcher
  $mode = if ($launcher -and (Test-Path $ModeFile)) { (Get-Content $ModeFile -Raw).Trim() } else { '-' }
  if ($launcher) { Ok "Simulator running (launcher PID $($launcher.Id), mode $mode, since $($launcher.StartTime))" } else { Warn 'Simulator not running' }
  if (Hmi-Up) { Ok "Web HMI           $HmiUrl" } else { Warn "Web HMI           $HmiUrl (not answering)" }
  $ports = Listening-Ports
  $pp = $Cfg.nodes.PLANT.port
  if ($ports[[int]$pp]) { Ok "Plant / field I/O Modbus TCP :$pp" } else { Warn "Plant / field I/O Modbus TCP :$pp" }
  if ($mode -eq 'node') {
    foreach ($n in $Controllers) {
      $port = $Cfg.nodes.$n.port
      if ($ports[[int]$port]) { Ok ("{0,-17} Modbus TCP :{1}" -f "$n (Node.js)", $port) } else { Warn ("{0,-17} Modbus TCP :{1}" -f "$n (Node.js)", $port) }
    }
  }
  if (OpenPlc-Installed) {
    Write-Host ''
    Info "OpenPLC soft-PLCs (WSL distribution '$Distro'):"
    Push-Location $Root
    try { & node scripts/plc-control.js status | ForEach-Object { Write-PlcLine $_ } } finally { Pop-Location }
  } else { Info 'OpenPLC soft-PLCs: not installed (OpenUnit.cmd install)' }
  Write-Host ''
}

function Write-PlcLine([string]$line) {
  # plc-control.js status table: header, then one row per PLC
  $color = if ($line -match '^PLC\s') { 'DarkCyan' } elseif ($line -match 'not running|\bdown\b|STOP|error|fail') { 'Yellow' } elseif ($line -match '\bRUN\b') { 'Green' } else { 'Gray' }
  Write-Host "    $line" -ForegroundColor $color
}

function Show-Log {
  if (-not (Test-Path $LogFile)) { Info 'No log yet'; return }
  Write-Host "  Last 40 lines of logs\simulator.log (follow it live with: OpenUnit.cmd logs)" -ForegroundColor DarkGray
  foreach ($l in (Get-Content $LogFile -Tail 40)) {
    $color = if ($l -match '(?i)error|fail|exception|crash') { 'Red' } elseif ($l -match '(?i)warn|trip|restart') { 'Yellow' } else { 'Gray' }
    Write-Host "  $l" -ForegroundColor $color
  }
}

function Open-Editor {
  if (-not (Test-Path $EditorExe)) { Bad 'OpenPLC Editor is not installed - run OpenUnit.cmd install'; return }
  # lists the 8 controller projects on the Editor's start screen, then starts it
  Run-Node 'scripts/plc-editor.js' @()
  Info 'Click a controller on the start screen: its program opens as a function block diagram.'
  Info "Live values: Debugger, runtime IP 127.0.0.11 (CCS) ... 127.0.0.18 (BOP), user/password $($Cfg.openplc.user)/$($Cfg.openplc.password)."
}

function Plc([string[]]$a) {
  Require-Node
  $sub = if ($a.Count -ge 1) { $a[0] } else { 'status' }
  if ($sub -eq 'web') {
    if ($a.Count -lt 2) { Bad 'usage: OpenUnit.cmd plc web <NODE>'; return }
    $n = $a[1].ToUpper()
    if (-not $Cfg.openplc.nodes.$n) { Bad "Unknown controller $n"; return }
    Start-Process "http://localhost:$($Cfg.openplc.nodes.$n.webPort)"
    Info "Log in with $($Cfg.openplc.user)/$($Cfg.openplc.password); the Monitoring page shows every variable live."
    return
  }
  Push-Location $Root
  try { & node scripts/plc-control.js @a } finally { Pop-Location }
}

function Named-Args([string[]]$a) {
  # '-Yes -Export D:\x.tar' -> @{ Yes = $true; Export = 'D:\x.tar' }, for splatting into a script
  $h = @{}
  for ($i = 0; $i -lt $a.Count; $i++) {
    if ($a[$i] -notmatch '^-(\w+)$') { Bad "Unexpected argument '$($a[$i])'"; exit 2 }
    $name = $Matches[1]
    if ($i + 1 -lt $a.Count -and $a[$i + 1] -notmatch '^-\w+$') { $h[$name] = $a[$i + 1]; $i++ } else { $h[$name] = $true }
  }
  return $h
}

function Install-All([string[]]$a) {
  $named = Named-Args $a
  try { & (Join-Path $Root 'scripts\install\Install-OpenPLC.ps1') @named } catch { Bad "Installation failed: $_" }
}

function Run-Node([string]$script, [string[]]$a) {
  Require-Node
  Push-Location $Root
  try { & node $script @a } finally { Pop-Location }
}

$MenuWidth = 78
function Menu-Item([string]$key, [string]$label, [bool]$on = $true, [int]$width = 40) {
  # one menu cell: yellow number, white label; dimmed when the item does not apply right now
  if (-not $key) { Seg (' ' * $width); return }
  Seg ('{0,4}  ' -f $key) $(if ($on) { 'Yellow' } else { 'DarkGray' })
  Seg $label.PadRight($width - 6) $(if ($on) { 'White' } else { 'DarkGray' })
}
function Menu-Row($left, $right) {
  Menu-Item @left
  if ($right) { Menu-Item @right }
  Write-Host ''
}
function Menu-Header([string]$left, [string]$right = '') {
  Write-Host ''
  Seg ('  ' + $left.PadRight(40)) 'DarkCyan'
  Write-Host $right -ForegroundColor DarkCyan
}

function Show-Header([bool]$running, [bool]$installed) {
  try { $Host.UI.RawUI.WindowTitle = 'OpenUnit - control panel' } catch { }
  $line = '  ' + ('=' * $MenuWidth)
  Write-Host $line -ForegroundColor DarkCyan
  Seg '    OpenUnit' 'Cyan'
  Write-Host '   700 MW Gas-Fired Steam Power Plant Simulator - control panel' -ForegroundColor Gray
  Write-Host $line -ForegroundColor DarkCyan
  Seg '    Simulator  ' 'DarkGray'
  if ($running) {
    $mode = if (Test-Path $ModeFile) { (Get-Content $ModeFile -Raw).Trim() } else { '?' }
    Seg 'RUNNING' 'Green'; Seg ("  ($mode)").PadRight(20) 'Gray'
  } else { Seg 'STOPPED' 'Yellow'; Seg (' ' * 20) }
  Seg 'HMI  ' 'DarkGray'; Write-Host $HmiUrl -ForegroundColor $(if ($running) { 'Cyan' } else { 'DarkGray' })
  Seg '    OpenPLC    ' 'DarkGray'
  if ($installed) { Seg 'INSTALLED' 'Green'; Write-Host "  (WSL $Distro)" -ForegroundColor Gray }
  else { Seg 'NOT INSTALLED' 'Yellow'; Write-Host '  - choose 12 to install (2 Node.js also works without it)' -ForegroundColor Gray }
  Write-Host ('  ' + ('-' * $MenuWidth)) -ForegroundColor DarkCyan
}

function Wait-Menu {
  Write-Host ''
  Seg '  Press Enter to return to the menu ' 'DarkGray'
  return ($null -ne (Read-Host))
}

function Show-Menu {
  while ($true) {
    $running = [bool](Get-Launcher)
    $installed = OpenPlc-Installed
    try { Clear-Host } catch { }
    Show-Header $running $installed
    Menu-Header 'SIMULATOR' 'OPENPLC SOFT-PLCS'
    Menu-Row @{ key = '1'; label = 'Start - OpenPLC soft-PLCs'; on = (-not $running -and $installed) } @{ key = '7'; label = 'OpenPLC Editor - logic diagrams'; on = $installed }
    Menu-Row @{ key = '2'; label = 'Start - Node.js controllers'; on = (-not $running) } @{ key = '8'; label = 'PLC runtimes  run/stop/restart/web'; on = $installed }
    Menu-Row @{ key = '3'; label = 'Stop everything'; on = $running } @{ key = '9'; label = 'Deploy PLC programs'; on = $installed }
    Menu-Row @{ key = '4'; label = 'Restart'; on = $running } @{ key = '10'; label = 'Check PLC programs'; on = $installed }
    Menu-Row @{ key = '5'; label = 'Status' }
    Menu-Row @{ key = '6'; label = 'Open the HMI'; on = $running }
    Menu-Row @{ key = '11'; label = 'Show the log' }
    Menu-Header 'SETUP'
    Menu-Row @{ key = '12'; label = 'Install / repair  (prerequisites, WSL, OpenPLC)'; width = 60 }
    Menu-Row @{ key = '0'; label = 'Exit' }
    Write-Host ''
    $c = Ask 'Choice >'
    if ($null -eq $c) { return }
    if ($c -eq '0') { return }
    Write-Host ''
    switch ($c) {
      { $_ -in '1', '2' } {
        $ic = Ask 'Initial condition  1 cold  2 hot standby  3 FSNL  4 50 %  5 100 %  (Enter = default) >'
        $script:IC = if ($ic -match '^[1-5]$') { [int]$ic } else { 0 }
        Start-Sim $(if ($c -eq '1') { 'openplc' } else { 'node' })
      }
      '3' { Stop-Sim }
      '4' { $m = if (Test-Path $ModeFile) { (Get-Content $ModeFile -Raw).Trim() } else { '' }; Stop-Sim; Start-Sim $m }
      '5' { Show-Status }
      '6' { Start-Process $HmiUrl; Ok "HMI opened in the browser: $HmiUrl" }
      '7' { Open-Editor }
      '8' {
        Push-Location $Root
        try { & node scripts/plc-control.js status | ForEach-Object { Write-PlcLine $_ } } finally { Pop-Location }
        Write-Host ''
        $act = Ask 'Action  run / stop / restart / web  (Enter = back) >'
        if ($act) {
          $n = Ask 'Controller  CCS BMS CMB FWC STC DEH GEN BOP  or all >'
          if (($act -eq 'stop' -or $act -eq 'restart') -and ($n -match 'BMS|DEH|all') -and $running) { Warn 'Stopping BMS or DEH while the plant runs trips the unit (hardwired watchdog) - freeze the simulator first.' }
          if ($n) { Plc @($act, $n) }
        }
      }
      '9' { Run-Node 'scripts/plc-deploy.js' @() }
      '10' { Run-Node 'scripts/plc-check.js' @() }
      '11' { Show-Log }
      '12' { Install-All @() }
      default { Bad "Unknown choice '$c' - type a number from the menu" }
    }
    if (-not (Wait-Menu)) { return }
  }
}

switch ($Command.ToLower()) {
  'menu' { Show-Menu }
  'start' { Start-Sim ($Rest | Select-Object -First 1) }
  'stop' { Stop-Sim }
  'restart' { $m = ($Rest | Select-Object -First 1); if (-not $m -and (Test-Path $ModeFile)) { $m = (Get-Content $ModeFile -Raw).Trim() }; Stop-Sim; Start-Sim $m }
  'status' { Show-Status }
  'hmi' { Start-Process $HmiUrl }
  'editor' { Open-Editor }
  'plc' { Plc $Rest }
  'deploy' { Run-Node 'scripts/plc-deploy.js' $Rest }
  'check' { Run-Node 'scripts/plc-check.js' $Rest }
  'logs' { if (Test-Path $LogFile) { Get-Content $LogFile -Tail 40 -Wait } else { Info 'No log yet' } }
  'install' { Install-All $Rest }
  default { Get-Help $PSCommandPath -Detailed | Out-Host; exit 2 }
}
