@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Protótipo vdkids/Kyrios — servidor local
echo  Pasta: %cd%
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale em https://nodejs.org e abra este .bat de novo.
  pause
  exit /b 1
)
echo  Subindo em http://127.0.0.1:4173/pt-br/
echo  Deixe esta janela aberta. Ctrl+C para parar.
echo.
start "" "http://127.0.0.1:4173/pt-br/"
npx --yes serve -l 4173 .
