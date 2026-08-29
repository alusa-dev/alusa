@echo off
setlocal

set "ROOT=%~dp0"
set "NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\alusa-tools\node-v22.13.1-win-x64"
set "CODEX_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
set "APP_PORT=3000"

if not exist "%NODE_DIR%\node.exe" (
  echo Node local nao encontrado em:
  echo %NODE_DIR%
  echo.
  echo Instale/prepare o Node 22.13.1 antes de rodar este servidor.
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%NODE_DIR%\node_modules\npm\bin;%CODEX_BIN%;%PATH%"

cd /d "%ROOT%"

echo Verificando porta %APP_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
  echo Encerrando servidor anterior na porta %APP_PORT% ^(PID %%P^)...
  taskkill /F /PID %%P >nul 2>&1
)

echo Iniciando Alusa em http://localhost:3000
echo.
echo Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.

cd /d "%ROOT%apps\web"

call "%NODE_DIR%\pnpm.cmd" exec dotenv -o -e ../../.env -e ../../.env.local -e .env.local -- node ../../scripts/validate-db-env.mjs dev
if errorlevel 1 (
  echo.
  echo Falha na validacao do ambiente.
  pause
  exit /b 1
)

call "%NODE_DIR%\pnpm.cmd" exec dotenv -o -e ../../.env -e ../../.env.local -e .env.local -- cross-env NODE_OPTIONS=--max-old-space-size=8192 NEXT_TELEMETRY_DISABLED=1 next dev --webpack -p %APP_PORT%

endlocal
