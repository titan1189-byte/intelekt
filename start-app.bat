@echo off
title Intelekt local server
cd /d "%~dp0"

set "NODE_EXE=C:\Users\alexa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo Node was not found:
  echo %NODE_EXE%
  echo.
  echo Install Node.js or ask Codex to check the runtime path.
  pause
  exit /b 1
)

echo Starting Intelekt local server...
echo Folder: %cd%
echo URL: http://127.0.0.1:3100/
echo.

"%NODE_EXE%" local-dev.js

echo.
echo Server stopped. If an error is shown above, send it to Codex.
pause
