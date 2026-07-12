@echo off
setlocal
set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo ERROR: Node.js 24 or newer is required and was not found on PATH. 1>&2
  exit /b 1
)
cd /d "%~dp0"
"%NODE_EXE%" scripts\download-mvp-assets.ts %*
exit /b %errorlevel%
