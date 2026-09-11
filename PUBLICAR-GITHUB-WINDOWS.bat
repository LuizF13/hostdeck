@echo off
setlocal
cd /d "%~dp0"
echo.
echo HostDeck - publicar nova versao no GitHub
echo ===========================================
echo.
call npm run github:release:patch
if errorlevel 1 (
  echo.
  echo A publicacao nao foi concluida. Leia a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Tag enviada. Acompanhe o workflow Release Desktop no GitHub Actions.
pause
