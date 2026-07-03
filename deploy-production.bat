@echo off
title Deploy Intelekt to Firebase
cd /d "%~dp0"

set "XDG_CONFIG_HOME=%~dp0.firebase-config"
set "FIREBASE_CONFIG_HOME=%~dp0.firebase-config"
set "PATH=C:\Users\alexa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"

echo Deploying Intelekt to Firebase project:
echo project-112eca27-802a-43bd-b93
echo.

call "%~dp0deploy-env-check.bat" || goto done
if exist "%~dp0node_modules\.bin\firebase.CMD" (
  call "%~dp0node_modules\.bin\firebase.CMD" deploy --project project-112eca27-802a-43bd-b93
) else (
  firebase deploy --project project-112eca27-802a-43bd-b93
)

:done
echo.
echo Deploy command finished with code %ERRORLEVEL%.
pause
