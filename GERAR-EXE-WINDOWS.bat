@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo HostDeck - gerar INSTALADOR Windows
echo =============================================
echo.
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set INSTALLER=%CD%\dist\HostDeck-Setup-%VERSION%-x64.exe
echo Versao: %VERSION%
echo Instalador: %INSTALLER%
echo.
call npm install
if errorlevel 1 goto :error
call npm run desktop:dist:win
if errorlevel 1 goto :error
if not exist "%INSTALLER%" (
  echo.
  echo ERRO: o instalador esperado nao foi encontrado:
  echo %INSTALLER%
  goto :error
)
echo.
echo Instalador gerado corretamente.
echo Abrindo o instalador HostDeck agora...
start "" "%INSTALLER%"
exit /b 0
:error
echo.
echo Falha ao gerar o instalador. Veja o erro acima.
pause
exit /b 1
