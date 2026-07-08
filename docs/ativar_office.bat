@echo off
title Ativador Automatizado - Office 2021 LTSC
cls

:: Verificar Privilégios Administrativos
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Por favor, execute este script como ADMINISTRADOR!
    echo Clique com o botao direito no arquivo e selecione "Executar como Administrador".
    echo.
    pause
    exit /b
)

echo =======================================================
echo     Script de Ativacao para Office 2021 ProPlus LTSC
echo =======================================================
echo.

:: Detectar automaticamente o caminho de instalacao do Office
set "OFFICEPATH="
if exist "%ProgramFiles%\Microsoft Office\Office16\ospp.vbs" (
    set "OFFICEPATH=%ProgramFiles%\Microsoft Office\Office16"
) else if exist "%ProgramFiles(x86)%\Microsoft Office\Office16\ospp.vbs" (
    set "OFFICEPATH=%ProgramFiles(x86)%\Microsoft Office\Office16"
)

if "%OFFICEPATH%"=="" (
    echo [ERRO] Nao foi possivel encontrar o Office 2021 instalado neste sistema.
    echo Verifique se a instalacao foi concluida corretamente.
    echo.
    pause
    exit /b
)

:: Entrar no diretorio do Office
cd /d "%OFFICEPATH%"

:: Solicitar a chave ao usuario
echo Cole ou digite a sua chave de 25 caracteres do Office 2021.
echo Formato esperado: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
echo.
set /p "CHAVE=Insira a sua chave e aperte ENTER: "

if "%CHAVE%"=="" (
    echo [ERRO] Nenhuma chave foi informada. O script sera encerrado.
    echo.
    pause
    exit /b
)

echo.
echo =======================================================
echo [1/3] Injetando a chave de produto no sistema...
echo =======================================================
cscript ospp.vbs /inpkey:HJT9T-9HN8J-H4CQP-TG9BF-F636K

echo.
echo =======================================================
echo [2/3] Forcando a ativacao do Office...
echo =======================================================
cscript ospp.vbs /act

echo.
echo =======================================================
echo [3/3] Verificando o status final da ativacao...
echo =======================================================
cscript ospp.vbs /dstatus

echo.
echo =======================================================
echo Processo concluido! Verifique nas linhas acima se a
echo ativacao retornou "LICENSED" (Licenciado).
echo =======================================================
echo.
pause