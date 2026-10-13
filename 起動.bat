@echo off
chcp 65001 >nul
pushd "%~dp0"
echo 認定調査票アプリを起動します。このウィンドウは閉じないでください。
node server/index.js
pause
