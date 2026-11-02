# Web交互与布局复验

脚本使用本地Playwright/Chrome和axe；没有产品运行时依赖。Windows工作区根目录执行：

```powershell
New-Item -ItemType Directory -Force backend/.runtime-ui-refresh/browser
npm install --prefix backend/.runtime-ui-refresh/browser --no-package-lock --no-save playwright @axe-core/playwright
Copy-Item docs/implementation/evidence/stage7a-web-refresh/scripts/*.mjs backend/.runtime-ui-refresh/
node backend/.runtime-ui-refresh/verify.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/accessibility.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/performance.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/architecture.mjs
```

要求已安装Chrome，且目标为筑瞳实例。verify输出11组交互、4种宽度共60布局组合和截图；
accessibility等待进入动画结束后扫描15个默认页；performance记录本机下一rAF间隔和90帧采样，
不等同真实屏幕呈现时间或跨设备FPS保证。

脚本不提交有效业务录入。正常启动身份会话、进入预警页的自动通知回执可能写入服务端，
这些与测试业务写入分开记录在browser.json。

snapshot.py用于现有容器的只读计数/媒体哈希核对，保存本轮使用的SQL与文件校验逻辑。
新增参考和原创资源见父目录references.json、assets.json；浏览器默认视口和实际URL均保留在结果中。
