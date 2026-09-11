@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo HostDeck - configurar GitHub Releases
echo =============================================
echo.
set /p REPO=Digite USUARIO/REPOSITORIO (ex: felipe/hostdeck): 
if "%REPO%"=="" exit /b 1
call npm run github:setup -- %REPO%
if errorlevel 1 goto :error
echo.
echo GitHub configurado. Faça commit desses arquivos antes de publicar.
pause
exit /b 0
:error
pause
exit /b 1
