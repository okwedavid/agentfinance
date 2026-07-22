@echo off
echo ==========================================
echo FIX Windows Install - No Canvas Build v2.1
echo ==========================================
echo Your error:
echo - canvas needs GTK/cairo.h not installed
echo - EPERM rmdir due to long path + double nested agentfinance\agentfinance\
echo - puppeteer deprecated
echo.
echo Solution: Lightweight build without native deps
echo CURRENT DIR: %CD%
echo If your path is like C:\Users\DELL\Desktop\agentfinance\agentfinance\digital-factory\
echo That's TOO LONG and NESTED (agentfinance twice). Move to C:\factory\
echo.
set /p move="Move to C:\factory? (y/n): "
if /i "%move%"=="y" (
  if not exist C:\factory mkdir C:\factory
  xcopy /E /I /Y "%CD%" C:\factory\ >nul
  echo Moved to C:\factory\
  cd /d C:\factory
)
echo.
echo 2. Killing processes that lock node_modules...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM Code.exe 2>nul
echo 3. Removing old node_modules manually (ignores EPERM)...
:retry_rm
if exist node_modules (
  echo Removing node_modules...
  rmdir /s /q node_modules 2>nul
  if exist node_modules (
    echo Still exists, trying via PowerShell...
    powershell -Command "Remove-Item -Path 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue"
    timeout /t 2 /nobreak >nul
  )
)
if exist package-lock.json del /f /q package-lock.json
echo 4. Enable Long Paths in Windows (requires Admin)...
powershell -Command "Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1 -ErrorAction SilentlyContinue; Write-Host 'LongPathsEnabled set (needs Admin)'"
echo 5. Installing LIGHTWEIGHT deps (no canvas, no puppeteer required)...
call npm install --no-optional
if %errorlevel% neq 0 (
  echo npm install failed, trying second method...
  call npm cache clean --force
  call npm install --no-optional --legacy-peer-deps
)
echo.
echo 6. Testing demo (no API key needed)...
call node src/demo/generateDemoProduct.js
echo.
echo ==========================================
echo INSTALL FIXED? Check above logs.
echo Products\ai-freelancer-client-os\Customer\
echo Publishing\
echo Now add Groq key to .env: copy .env.example .env + notepad .env
echo Then: npm run factory:single
echo ==========================================
pause
