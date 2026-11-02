# 小瞳面板复验

在项目根目录执行。实际环境：Windows、本机 Chrome、Node、运行中的 8080 Web 与 18000 API。
浏览器测试会发送真实问题并保留助手轮次，不会写入监测记录、问题、工单或媒体。

工具安装在忽略目录，不改变产品 package.json 或锁文件：

```powershell
npm install --prefix backend/.runtime-ui-refresh/browser --no-package-lock --no-save playwright @axe-core/playwright
Copy-Item docs/implementation/evidence/stage7a-assistant-ui/scripts/*.mjs backend/.runtime-ui-refresh/
$env:ASSISTANT_UI_EVIDENCE = 'backend/.runtime-ui-refresh/assistant-recheck'
node backend/.runtime-ui-refresh/assistant-verify.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/architecture.mjs
npm test
npm run test:tooling
npm run typecheck
npm run build
```

本目录保存本次最终脚本；browser.json 为 8080 实测。之前开发复验的选择器和拦截器脚本调整不属于产品缺陷。
产品检查发现的提示文字对比度问题已修复，再次扫描通过。
assistant-capture.mjs 展示采图流程；当前重跑时两个端口都可能是新版本，不能重建历史旧页面。
历史 before-wide.png 与用户旧界面截图只作本次前后比较，不将重跑的新截图冒充旧页面。
减少动效、布局和 axe 均为 Headless Chrome 抽测，不替代原生鸿蒙和真实手机验收。

snapshot.py 通过 API 容器的 Python 只读查询 SQLite：

```powershell
Get-Content docs/implementation/evidence/stage7a-assistant-ui/scripts/snapshot.py | docker compose -f deploy/compose.yaml exec -T api /app/.venv/bin/python -
```

计数排除 login_sessions、audits、operation_receipts；本次前后唯一额外变化为 assistant_turns 75→88，来自多轮真实 UI 调试和复验。没有删除测试会话来掩盖变化。
