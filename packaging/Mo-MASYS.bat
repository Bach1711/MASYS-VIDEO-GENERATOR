@echo off
setlocal
rem MASYS Video - bam dup file nay de bat tool (spec D15).
chcp 65001 >nul
title MASYS Video - dung dong cua so nay khi dang dung tool
cd /d "%~dp0"
if not exist "%~dp0node\node.exe" (
  echo Thieu thu muc node. Hay giai nen lai toan bo file zip roi chay lai.
  pause
  exit /b 1
)
"%~dp0node\node.exe" "%~dp0app\dist\launcher.js"
if errorlevel 1 pause
