@echo off
setlocal
cd /d "%~dp0"
set "INSTALLER=%CD%\release\HostDeck-Setup-LATEST.exe"
if not exist "%INSTALLER%" (
  echo O instalador atual ainda nao existe. Gerando primeiro...
  call npm run desktop:dist:win
  if errorlevel 1 goto :error
)
if not exist "%INSTALLER%" goto :error
echo Instalando sempre a versao atual:
echo %INSTALLER%
start "" "%INSTALLER%"
exit /b 0
:error
echo Nao foi possivel preparar o HostDeck.
pause
exit /b 1
