@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Emporio Cachoeira - Iniciar
cd /d "%~dp0"
if errorlevel 1 goto erro_pasta
set "EMPORIO_BASE=%~dp0"
rem Inicia localmente no primeiro acesso; depois do PIN o Wi-Fi funciona automaticamente.
set "EMPORIO_HOST=0.0.0.0"
set "NODE_EXE="

rem Duplo clique = iniciar normalmente. Comandos opcionais: diagnostico / firewall / recuperar.
if /I "%~1"=="diagnostico" goto diagnostico
if /I "%~1"=="wifi" goto diagnostico
if /I "%~1"=="firewall" goto firewall
if /I "%~1"=="recuperar" goto recuperar
if not "%~1"=="" goto ajuda

if not exist "%~dp0server.js" goto erro_arquivos
if not exist "%~dp0launcher.js" goto erro_arquivos
if not exist "%~dp0diagnostico-inicializacao.js" goto erro_arquivos
if not exist "%~dp0node_modules\sql.js\package.json" goto erro_arquivos
call :procurar_node
if not defined NODE_EXE goto instalar_node
if not exist "%NODE_EXE%" goto instalar_node
goto iniciar

:instalar_node
cls
echo ======================================================
echo EMPORIO CACHOEIRA - NODE.JS NAO ENCONTRADO
echo ======================================================
echo.
if not exist "%~dp0node-runtime.msi" goto erro_sem_instalador
echo Existe um instalador offline do Node.js neste pacote.
echo Instale apenas se confiar na origem do arquivo.
echo.
choice /C SN /M "Deseja abrir o instalador do Node.js"
if errorlevel 2 exit /b 1
start /wait "" msiexec.exe /i "%~dp0node-runtime.msi"
call :procurar_node
if not defined NODE_EXE goto erro_node
if not exist "%NODE_EXE%" goto erro_node
goto iniciar

:iniciar
"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 goto erro_node
cls
echo ======================================================
echo           EMPORIO CACHOEIRA - INICIANDO
echo ======================================================
echo.
echo Um unico arquivo inicia o sistema no computador.
echo Apos cadastrar o PIN do administrador, o Wi-Fi sera liberado.
echo A porta 3000 pode mudar para 3001-3009 caso esteja ocupada.
echo Veja o endereco exato indicado abaixo.
echo.
echo Diagnostico automatico: Node, banco de dados, arquivos e servidor.
echo Apenas itens testados aparecem como [OK].
echo Em caso de falha, consulte dados\diagnostico-inicializacao.log.
echo.
"%NODE_EXE%" "%~dp0launcher.js"
set "CODIGO=%ERRORLEVEL%"
if "%CODIGO%"=="0" exit /b 0
echo.
echo Codigo de encerramento: %CODIGO%
echo Consulte LEIA-ME-PRIMEIRO.txt ou envie uma foto da mensagem.
pause
exit /b %CODIGO%

:diagnostico
cls
echo ======================================================
echo EMPORIO CACHOEIRA - DIAGNOSTICO WI-FI
 echo ======================================================
echo.
echo [1] Enderecos IP da maquina:
ipconfig
 echo.
echo [2] Perfil de rede - o Wi-Fi deve estar PRIVADO:
powershell.exe -NoProfile -Command "Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory | Format-Table -AutoSize"
echo.
echo [3] Portas 3000 a 3009 em uso:
netstat -ano -p tcp | findstr /R ":300[0-9] "
echo.
echo Inicie o sistema com dois cliques em iniciar.bat.
echo No celular, use o IPv4 do Wi-Fi + a porta exibida pelo sistema.
echo Consulte LEIA-ME-PRIMEIRO.txt para as solucoes comuns.
pause
exit /b 0

:firewall
cls
echo ======================================================
echo EMPORIO CACHOEIRA - AUTORIZAR WI-FI NO FIREWALL
 echo ======================================================
echo.
echo Esta operacao solicita permissao de ADMINISTRADOR do Windows.
echo Sera criada uma regra para TCP 3000-3009 SOMENTE na rede
 echo PRIVADA e para dispositivos da mesma sub-rede local.
echo NAO use em redes publicas, de convidados ou desconhecidas.
echo.
choice /C SN /M "Confirma a criacao da regra de Firewall"
if errorlevel 2 (echo Nenhuma alteracao realizada. & pause & exit /b 0)
powershell.exe -NoProfile -Command "Start-Process -FilePath 'netsh.exe' -ArgumentList 'advfirewall firewall add rule name=EmporioCachoeiraWiFiLocal dir=in action=allow protocol=TCP localport=3000-3009 profile=private remoteip=localsubnet' -Verb RunAs -Wait"
echo.
echo Confira a regra de Firewall (caso tenha autorizado):
netsh advfirewall firewall show rule name=EmporioCachoeiraWiFiLocal
pause
exit /b 0

:recuperar
cls
echo ======================================================
echo EMPORIO CACHOEIRA - RECUPERAR PIN ADMINISTRADOR
 echo ======================================================
echo.
echo ATENCAO: feche todas as janelas do Emporio antes de continuar.
echo Esta operacao limpa APENAS o PIN do administrador.
echo O programa cria backup local antes da alteracao.
echo Para preservar a seguranca, execute APENAS no computador principal.
echo.
set "CONF="
set /p "CONF=Para confirmar, digite RECUPERAR e pressione Enter: "
if /I not "%CONF%"=="RECUPERAR" (echo Operacao cancelada. & pause & exit /b 0)
if not exist "%~dp0server.js" goto erro_arquivos
call :procurar_node
if not defined NODE_EXE goto erro_node
if not exist "%NODE_EXE%" goto erro_node
"%NODE_EXE%" "%~dp0server.js" --resetar-senha
set "CODIGO=%ERRORLEVEL%"
if not "%CODIGO%"=="0" echo Falha na recuperacao. Consulte a mensagem acima.
pause
exit /b %CODIGO%

:procurar_node
set "NODE_EXE="
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE for %%F in (node.exe) do if not "%%~$PATH:F"=="" if exist "%%~$PATH:F" set "NODE_EXE=%%~$PATH:F"
exit /b 0

:ajuda
echo Uso: clique duas vezes em iniciar.bat para iniciar o sistema.
echo Opcoes pelo CMD: iniciar.bat diagnostico ^| firewall ^| recuperar
pause
exit /b 1
:erro_pasta
echo ERRO: nao foi possivel entrar na pasta do programa.
pause
exit /b 1
:erro_arquivos
echo ERRO: faltam arquivos. Extraia o ZIP inteiro antes de executar iniciar.bat.
pause
exit /b 1
:erro_sem_instalador
echo ERRO: Node.js nao instalado e node-runtime.msi nao encontrado.
pause
exit /b 1
:erro_node
echo ERRO: Node.js nao encontrado ou nao foi possivel executar.
echo Conclua a instalacao, feche esta janela e abra iniciar.bat novamente.
pause
exit /b 1
