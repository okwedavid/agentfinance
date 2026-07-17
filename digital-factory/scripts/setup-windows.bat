@echo off
echo ==========================================
echo  DIGITAL FACTORY - Windows 11 Setup
echo ==========================================

REM Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found! Install Node.js 20+ from https://nodejs.org
  pause
  exit /b
)

echo Node.js found: 
node --version

REM Check n8n
n8n --version >nul 2>&1
if %errorlevel% neq 0 (
  echo Installing n8n globally...
  npm install -g n8n
) else (
  echo n8n found:
  n8n --version
)

REM Setup directories
echo Creating factory directories...
if not exist "C:\DigitalFactory" mkdir "C:\DigitalFactory"
if not exist "C:\DigitalFactory\Products" mkdir "C:\DigitalFactory\Products"
if not exist "C:\DigitalFactory\catalog" mkdir "C:\DigitalFactory\catalog"
if not exist "C:\DigitalFactory\Published" mkdir "C:\DigitalFactory\Published"
if not exist "C:\DigitalFactory\_quality_reports" mkdir "C:\DigitalFactory\_quality_reports"

REM Install factory deps
echo Installing factory dependencies...
cd /d %~dp0\..
call npm install

echo.
echo ==========================================
echo  Setup Complete!
echo ==========================================
echo  1. Copy .env.example to .env and add GROQ_API_KEY
echo     Get free key: https://console.groq.com/
echo  2. Run: npm run factory:single
echo  3. Start n8n: n8n start
echo  4. Import workflows from n8n-workflows/
echo.
pause
