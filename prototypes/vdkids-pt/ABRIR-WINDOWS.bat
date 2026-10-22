@echo off
cd /d "%~dp0"
echo.
echo  Prototipo vdkids - servidor local
echo  Pasta: %cd%
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale em https://nodejs.org e rode este .bat de novo.
  pause
  exit /b 1
)
echo  Abrindo http://127.0.0.1:4173/pt-br/
echo  Deixe esta janela aberta. Ctrl+C para parar.
echo.
start "" "http://127.0.0.1:4173/pt-br/"
node servidor.mjs --port 4173
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao iniciar. Confira se Node.js esta instalado.
  pause
)
