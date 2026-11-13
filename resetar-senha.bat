@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Feche antes a janela preta do sistema, se estiver aberta.
pause
node server.js --resetar-senha
pause
