@echo off
setlocal
cd /d "%~dp0"
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set INSTALLER=%CD%\dist\HostDeck-Setup-%VERSION%-x64.exe
if not exist "%INSTALLER%" (
  echo O instalador ainda nao existe. Gerando primeiro...
  call "%CD%\GERAR-EXE-WINDOWS.bat"
  exit /b %errorlevel%
)
start "" "%INSTALLER%"
