@echo off
rem murmur-mcp for Windows: runs murmur-mcp.cjs with the app's own Node (Electron run as Node),
rem or with node when this folder is not inside an installed app.
set "MURMUR_APP=%~dp0..\..\Murmur.exe"
if exist "%MURMUR_APP%" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%MURMUR_APP%" "%~dp0murmur-mcp.cjs" %*
) else (
  node "%~dp0murmur-mcp.cjs" %*
)
exit /b %ERRORLEVEL%
