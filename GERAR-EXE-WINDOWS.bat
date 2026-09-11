@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo HostDeck - gerar instalador Windows LOCAL
echo =============================================
echo.
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
echo Versao: %VERSION%
echo Pasta: %CD%
echo.
call npm install
if errorlevel 1 goto :error
call npm run desktop:dist:win
if errorlevel 1 goto :error
echo.
echo Build concluido. Veja a pasta dist\
start "" "%CD%\dist"
exit /b 0
:error
echo.
echo Falha ao gerar o aplicativo. Veja o erro acima.
pause
exit /b 1
