@echo off
title Deploy Intelekt Hosting
cd /d "%~dp0"

set "XDG_CONFIG_HOME=%~dp0.firebase-config"
set "FIREBASE_CONFIG_HOME=%~dp0.firebase-config"
set "PATH=C:\Users\alexa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"

if exist "%~dp0node_modules\.bin\firebase.CMD" (
  call "%~dp0node_modules\.bin\firebase.CMD" deploy --only hosting --project project-112eca27-802a-43bd-b93
) else (
  firebase deploy --only hosting --project project-112eca27-802a-43bd-b93
)

echo.
echo Hosting deploy finished with code %ERRORLEVEL%.
pause
