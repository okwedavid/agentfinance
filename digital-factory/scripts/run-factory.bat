@echo off
echo Starting Digital Factory...
cd /d %~dp0\..
set /p count="How many products to generate? (1-10, default 3): "
if "%count%"=="" set count=3
echo Generating %count% products with Groq...
call node src/factory.js --batch %count%
echo.
echo Done! Check C:\DigitalFactory\Products and Published
pause
