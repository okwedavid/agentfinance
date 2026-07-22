@echo off
echo Lightweight Install - No Native Dependencies
echo This version works on Windows 11 without GTK/cairo
echo.
taskkill /F /IM node.exe 2>nul
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json
echo Installing...
call npm install --no-optional --legacy-peer-deps
echo.
echo Done! Testing...
call node src/demo/generateDemoProduct.js
echo If demo succeeded, add Groq key: copy .env.example .env && notepad .env
pause
