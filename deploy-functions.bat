@echo off
title Deploy Intelekt Functions
cd /d "%~dp0"

set "XDG_CONFIG_HOME=%~dp0.firebase-config"
set "FIREBASE_CONFIG_HOME=%~dp0.firebase-config"
set "PATH=C:\Users\alexa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"

call "%~dp0deploy-env-check.bat" || goto done
if exist "%~dp0node_modules\.bin\firebase.CMD" (
  call "%~dp0node_modules\.bin\firebase.CMD" deploy --only functions --project project-112eca27-802a-43bd-b93
) else (
  firebase deploy --only functions --project project-112eca27-802a-43bd-b93
)

:done
echo.
echo Functions deploy finished with code %ERRORLEVEL%.
pause
