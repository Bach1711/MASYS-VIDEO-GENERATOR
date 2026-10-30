@echo off
setlocal
rem KOL Fashion MASYS Video - bam dup file nay de bat tool (spec D15, D16).
rem Ban dang dung ghi trong phien-ban\hien-tai.txt; cap nhat / quay ve chi doi file do.
chcp 65001 >nul
title KOL Fashion MASYS Video - dung dong cua so nay khi dang dung tool
cd /d "%~dp0"
set "MASYS_HOME=%~dp0"

:start
set "CUR="
if exist "%~dp0phien-ban\hien-tai.txt" set /p CUR=<"%~dp0phien-ban\hien-tai.txt"
if not defined CUR goto broken
if not exist "%~dp0phien-ban\%CUR%\node\node.exe" goto broken
"%~dp0phien-ban\%CUR%\node\node.exe" "%~dp0phien-ban\%CUR%\app\dist\launcher.js"
set "CODE=%errorlevel%"

rem 76 = tool vua cap nhat hoac quay ve: chay ban moi ghi trong hien-tai.txt.
if "%CODE%"=="76" (
  set "MASYS_SWITCHED=1"
  goto start
)

rem Ban vua cap nhat hong ngay khi chay (chua kip tu quay ve): quay ve ban cu.
if exist "%~dp0phien-ban\dang-thu.txt" (
  echo Ban moi khong chay duoc, dang quay ve ban cu...
  >"%~dp0phien-ban\loi-cap-nhat.txt" <nul set /p "=%CUR%"
  copy /y "%~dp0phien-ban\dang-thu.txt" "%~dp0phien-ban\hien-tai.txt" >nul
  del "%~dp0phien-ban\dang-thu.txt"
  set "MASYS_SWITCHED=1"
  goto start
)

if not "%CODE%"=="0" pause
exit /b %CODE%

:broken
echo Thieu thu muc phien-ban. Hay giai nen lai toan bo file zip roi chay lai.
pause
exit /b 1
