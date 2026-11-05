@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 exit /b 1
call npm install
if errorlevel 1 exit /b 1
call npm run dist
if errorlevel 1 exit /b 1
