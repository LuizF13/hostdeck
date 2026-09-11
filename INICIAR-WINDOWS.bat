@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/NPM nao encontrado. Instale o Node.js LTS e tente novamente.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias do HostDeck...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)
echo Abrindo HostDeck...
call npm run desktop:dev
