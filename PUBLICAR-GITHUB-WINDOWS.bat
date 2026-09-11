@echo off
setlocal
cd /d "%~dp0"
echo.
echo HostDeck - publicar nova versao no GitHub
echo ===========================================
echo.
set /p MSG=Resumo da atualizacao (Enter para usar padrao): 
echo.
if "%MSG%"=="" (
  call npm run release
) else (
  call npm run release -- "%MSG%"
)
if errorlevel 1 (
  echo.
  echo A publicacao nao foi concluida. Leia a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Release enviada. O GitHub Actions vai gerar o instalador oficial.
pause
