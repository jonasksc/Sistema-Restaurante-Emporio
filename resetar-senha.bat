@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Emporio Cachoeira - Recuperar PIN Administrador

rem Este arquivo deve ficar na mesma pasta de iniciar.bat e server.js.
cd /d "%~dp0"
if errorlevel 1 goto erro_pasta

if not exist "%~dp0iniciar.bat" goto erro_arquivos
if not exist "%~dp0server.js" goto erro_arquivos

echo =====================================================
echo        EMPORIO CACHOEIRA - RECUPERAR PIN
echo =====================================================
echo.
echo Esta ferramenta recupera SOMENTE o PIN do administrador.
echo Nao altera PINs de funcionarios, vendas, mesas ou estoque.
echo.
echo IMPORTANTE: feche totalmente o Emporio Cachoeira.
echo A recuperacao criara um backup do banco de dados.
echo Ao terminar, abra iniciar.bat para criar um novo PIN.
echo.
call "%~dp0iniciar.bat" recuperar
set "RETORNO=%ERRORLEVEL%"
if not "%RETORNO%"=="0" (
 echo.
 echo Nao foi possivel concluir a recuperacao.
 echo Confira a mensagem acima e tente com o sistema fechado.
 pause
)
exit /b %RETORNO%

:erro_pasta
echo ERRO: nao foi possivel abrir a pasta do sistema.
pause
exit /b 1

:erro_arquivos
echo ERRO: coloque resetar-senha.bat na mesma pasta de iniciar.bat e server.js.
echo Nao execute este arquivo diretamente de dentro do ZIP.
pause
exit /b 1
