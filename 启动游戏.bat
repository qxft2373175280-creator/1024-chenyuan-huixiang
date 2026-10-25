@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-game.ps1"
if errorlevel 1 pause
