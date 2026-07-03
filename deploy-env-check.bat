@echo off
if exist ".env" (
  findstr /R /C:"^PORT=" ".env" >nul
  if not errorlevel 1 (
    echo ERROR: .env contains PORT, which is reserved by Firebase Functions.
    echo Remove PORT from .env or use .env.local for local server settings.
    exit /b 1
  )
)
if not exist ".env.project-112eca27-802a-43bd-b93" (
  echo ERROR: Missing production env file .env.project-112eca27-802a-43bd-b93
  exit /b 1
)
findstr /C:"SESSION_COOKIE_NAME=__session" ".env.project-112eca27-802a-43bd-b93" >nul
if errorlevel 1 (
  echo ERROR: Production must use SESSION_COOKIE_NAME=__session for Firebase Hosting rewrites.
  exit /b 1
)
findstr /R /C:"^PORT=" ".env.project-112eca27-802a-43bd-b93" >nul
if not errorlevel 1 (
  echo ERROR: Production env contains PORT, which is reserved by Firebase Functions.
  exit /b 1
)
exit /b 0
