@echo off
setlocal
set "LOG=%APPDATA%\HostDeck\logs\main.log"
echo.
echo HostDeck - Log de diagnostico
echo %LOG%
echo.
if exist "%LOG%" (
  start "" notepad "%LOG%"
) else (
  echo O arquivo de log ainda nao existe.
  echo Abra o HostDeck uma vez e tente novamente.
  pause
)
