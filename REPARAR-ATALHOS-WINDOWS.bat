@echo off
setlocal
set "HOSTDECK_LOCAL=%LOCALAPPDATA%\Programs\HostDeck\HostDeck.exe"
set "HOSTDECK_MACHINE=%ProgramFiles%\HostDeck\HostDeck.exe"

echo Fechando apenas instancias de desenvolvimento do Electron, se existirem...
wmic process where "name='electron.exe' and commandline like '%%node_modules%%electron%%'" call terminate >nul 2>&1

if exist "%HOSTDECK_LOCAL%" (
  echo Abrindo HostDeck instalado:
  echo %HOSTDECK_LOCAL%
  start "" "%HOSTDECK_LOCAL%"
  echo O aplicativo vai remover atalhos antigos de Electron e recriar os atalhos HostDeck.
  exit /b 0
)
if exist "%HOSTDECK_MACHINE%" (
  echo Abrindo HostDeck instalado:
  echo %HOSTDECK_MACHINE%
  start "" "%HOSTDECK_MACHINE%"
  exit /b 0
)
echo HostDeck.exe instalado nao foi encontrado.
echo Execute INSTALAR-WINDOWS.bat ou release\HostDeck-Setup-LATEST.exe.
pause
exit /b 1
