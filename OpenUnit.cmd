@echo off
rem OpenUnit - 700 MW gas-fired steam power plant simulator. The single entry point of the project.
rem Double-click it for the interactive menu, or give a command:
rem   OpenUnit.cmd install [-Yes] [-SkipDeploy] [-Distro name] [-Export file.tar] [-Package file.tar]
rem   OpenUnit.cmd start [openplc^|node] [-IC n] [-NoBrowser] ^| stop ^| restart [mode] ^| status
rem   OpenUnit.cmd hmi ^| editor ^| logs ^| deploy [NODE ...] ^| check [NODE ...]
rem   OpenUnit.cmd plc status ^| plc run^|stop^|restart NODE^|all ^| plc web NODE
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\control\Simulator.ps1" %*
set RC=%ERRORLEVEL%
rem a command run from Explorer or a shortcut: keep the window open when it failed
if not "%RC%"=="0" if not "%~1"=="" pause
exit /b %RC%
