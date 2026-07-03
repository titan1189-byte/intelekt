@echo off
title Firebase production logs
cd /d "%~dp0"

set "XDG_CONFIG_HOME=%~dp0.firebase-config"
set "FIREBASE_CONFIG_HOME=%~dp0.firebase-config"
set "PATH=C:\Users\alexa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"

if exist "%~dp0node_modules\.bin\firebase.CMD" (
  call "%~dp0node_modules\.bin\firebase.CMD" functions:log --only app --project project-112eca27-802a-43bd-b93 --lines 120
) else (
  firebase functions:log --only app --project project-112eca27-802a-43bd-b93 --lines 120
)

echo.
echo Logs command finished with code %ERRORLEVEL%.
pause
