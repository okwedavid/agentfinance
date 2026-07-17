@echo off
echo Installing n8n locally for Windows 11...
npm install -g n8n
n8n --version
echo.
echo To start n8n: n8n start
echo Then open http://localhost:5678
echo Import workflows from digital-factory/n8n-workflows/
pause
