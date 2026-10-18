@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   筑瞳 Demo 本地演示服务
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本。
  echo        下载地址：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] 首次运行，正在安装依赖，请稍候...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo [1/3] 依赖已存在，跳过安装。
)

echo.
echo [2/3] 正在构建...
call npm run build
if errorlevel 1 (
  echo [错误] 构建失败，请查看上方错误信息。
  pause
  exit /b 1
)

echo.
echo [3/3] 启动或复用本地服务：http://127.0.0.1:4173
echo       已运行的筑瞳预览将直接复用；其他程序占用时会提示。
echo.
start "" http://127.0.0.1:4173
call npm run serve
if errorlevel 1 (
  echo [错误] 预览启动失败，请查看上方提示。
  pause
  exit /b 1
)

pause
