@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo HostDeck - gerar instalador oficial Windows
echo =============================================
echo.
call npm install
if errorlevel 1 goto :error
call npm run desktop:dist:win
if errorlevel 1 goto :error
set "INSTALLER=%CD%\release\HostDeck-Setup-LATEST.exe"
if not exist "%INSTALLER%" (
  echo ERRO: instalador LATEST nao encontrado:
  echo %INSTALLER%
  goto :error
)
echo.
echo Instalador oficial pronto:
echo %INSTALLER%
echo.
echo Abrindo o instalador...
start "" "%INSTALLER%"
exit /b 0
:error
echo.
echo Falha ao gerar o instalador. Veja o erro acima.
pause
exit /b 1
