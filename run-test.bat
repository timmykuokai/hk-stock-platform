@echo off
setlocal
cd /d "%~dp0"

set PORT=8787
set WAIT=6

:menu
cls
echo ============================================================
echo   HK Stock Screener - Run & Test Launcher
echo   (Folder: %CD%)
echo ============================================================
echo.
echo   1) Start server + open browser (manual UI test)
echo   2) Run smoke test (API / npm run smoke)
echo   3) Run front-end UI test (npm run check-ui)
echo   4) Start server + run ALL tests + open browser
echo   5) Stop server (kill all node processes)
echo   6) Exit
echo.
set /p choice="Select [1-6]: "

if "%choice%"=="1" goto start_open
if "%choice%"=="2" goto smoke
if "%choice%"=="3" goto ui
if "%choice%"=="4" goto full
if "%choice%"=="5" goto stop
if "%choice%"=="6" exit /b
echo Invalid option, please retry.
timeout /t 1 /nobreak >nul
goto menu

:start_open
echo.
echo [Start server] launching node server/index.js in a background window...
start "HK Stock Server" cmd /c "node server/index.js"
echo Waiting %WAIT% seconds for server to boot...
timeout /t %WAIT% /nobreak >nul
echo Opening browser: http://localhost:%PORT%
start http://localhost:%PORT%
echo.
echo Server is running in a separate window. Close that window to stop it.
pause
goto menu

:smoke
echo.
echo [Smoke test] requires server running at http://localhost:%PORT%
echo If not started yet, choose 1 or 4 first.
echo.
call npm run smoke
echo.
pause
goto menu

:ui
echo.
echo [Front-end UI test] requires server running at http://localhost:%PORT%
echo If not started yet, choose 1 or 4 first.
echo.
call npm run check-ui
echo.
pause
goto menu

:full
echo.
echo [Full flow] start server - wait %WAIT%s - run all tests - open browser
echo.
echo Starting server...
start "HK Stock Server" cmd /c "node server/index.js"
echo Waiting %WAIT% seconds...
timeout /t %WAIT% /nobreak >nul
echo.
echo ========== [Smoke test] ==========
call npm run smoke
echo.
echo ========== [Front-end UI test] ==========
call npm run check-ui
echo.
echo Opening browser: http://localhost:%PORT%
start http://localhost:%PORT%
echo.
echo Tests done. Server still running in background window; choose 5 to stop.
pause
goto menu

:stop
echo.
echo [Stop server] killing all node processes...
taskkill /f /im node.exe >nul 2>&1
echo Done.
timeout /t 1 /nobreak >nul
goto menu
