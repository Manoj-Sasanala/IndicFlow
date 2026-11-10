@echo off
cd /d "%~dp0"
title IndicFlow
echo ========================================================
echo   Launching IndicFlow from: %cd%
echo ========================================================
npm start
pause

