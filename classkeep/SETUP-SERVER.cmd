@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 goto failed
py -3 -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r integrations\career-server\requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" scripts\start_integrated.py --check-config
pause
exit /b
:failed
echo Setup failed. Check Node.js and Python installation.
pause
exit /b 1
