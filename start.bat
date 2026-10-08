@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERREUR] Node.js 20.19+ est requis.
  pause
  exit /b 1
)
echo [INFO] Fermeture des processus utilisant les ports 3001, 5173 et 5174...
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\cleanup-ports.ps1"
if errorlevel 1 (
  echo [ERREUR] Impossible de liberer tous les ports RobloxAssetsCreator.
  echo Lis les messages ci-dessus pour identifier le processus concerne.
  pause
  exit /b 1
)
node scripts/check-ports.js
if errorlevel 1 (
  echo [ERREUR] Un port est toujours occupe apres le nettoyage.
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
