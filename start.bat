@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERREUR] Node.js 20.19+ est requis.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [INFO] Installation des dependances...
  call npm install || exit /b 1
)
start "RobloxAssetsCreator API" cmd /k "cd /d %~dp0 && npm run dev:server"
timeout /t 2 /nobreak >nul
start "RobloxAssetsCreator Web" cmd /k "cd /d %~dp0 && npm run dev:web"
echo.
echo Interface: http://127.0.0.1:5173
echo API:       http://127.0.0.1:3001
echo.
endlocal
