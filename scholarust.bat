@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if "%~1"=="" goto start
if /i "%~1"=="start" goto start
if /i "%~1"=="stop" goto stop
if /i "%~1"=="status" goto status
echo Usage: scholarust.bat [start^|stop^|status]
exit /b 1

:start
where cargo >nul 2>&1
if errorlevel 1 (
    if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
        set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    ) else (
        echo [error] Rust toolchain not found. Install from https://rustup.rs
        exit /b 1
    )
)
where node >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js not found. Install Node 18+ from https://nodejs.org
    exit /b 1
)
if not exist node_modules (
    echo Installing root dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)
if not exist frontend\node_modules (
    echo Installing frontend dependencies...
    call npm --prefix frontend install
    if errorlevel 1 exit /b 1
)
echo Starting ScholaRust (tauri dev, logs in new window)...
start "ScholaRust Dev" cmd /k "npm run dev"
exit /b 0

:stop
taskkill /f /im scholarust.exe >nul 2>&1
taskkill /f /im llama-server.exe >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo ScholaRust stopped (app, model server, dev server).
exit /b 0

:status
tasklist /fi "imagename eq scholarust.exe" | findstr /i "scholarust.exe" >nul && echo app:   running || echo app:   stopped
tasklist /fi "imagename eq llama-server.exe" | findstr /i "llama-server.exe" >nul && echo model: running || echo model: stopped
exit /b 0
