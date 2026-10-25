@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or newer, then open this file again.
  pause
  exit /b 1
)
python -m ai_memory launch
if errorlevel 1 (
  echo Project Memory Engine could not start. Check the error above.
  pause
)
