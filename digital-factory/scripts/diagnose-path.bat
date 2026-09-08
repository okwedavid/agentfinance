@echo off
echo === DIAGNOSE PATH ===
echo Current dir: %CD%
echo Looking for package.json files:
dir /s /b package.json | findstr digital-factory
echo.
echo Your error: C:\factory\agentfinance\package.json not found
echo Means you ran npm install in C:\factory\agentfinance\  (no package.json)
echo Correct:
echo If cloned whole repo to C:\factory\agentfinance:
echo   cd C:\factory\agentfinance\digital-factory
echo   npm install --omit=optional
echo If extracted only digital-factory to C:\factory:
echo   cd C:\factory
echo   npm install --omit=optional
echo.
if exist C:\factory\agentfinance\digital-factory\package.json (
  echo FOUND: C:\factory\agentfinance\digital-factory\package.json
)
if exist C:\factory\package.json (
  echo FOUND: C:\factory\package.json
)
pause
if exist C:\factory\agentfinance\digital-factory\package.json cd /d C:\factory\agentfinance\digital-factory
if exist C:\factory\package.json cd /d C:\factory
echo Now in: %CD%
dir package.json
pause
