@echo off
set DEVECO_SDK_HOME=D:/DevEco/Studio/sdk
set JAVA_HOME=D:/DevEco/Studio/jbr
set Path=D:/DevEco/Studio/jbr/bin;D:/DevEco/Studio/tools/node;%Path%
cd /d C:/Users/Lenovo/Desktop/demo/mobile/openharmony
"D:/DevEco/Studio/tools/node/node.exe" "D:/DevEco/Studio/tools/hvigor/bin/hvigorw.js" assembleApp --no-daemon
echo EXIT=%ERRORLEVEL%
