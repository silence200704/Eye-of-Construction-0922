# 阶段7A设计批次复验

当前证据来自 `http://127.0.0.1:8080/design-studio/index.html`，本机Headless Chrome，2026-10-25。
这不是原生设备/SDK、真实读屏或生产长列表证据。原型与业务API隔离，临时草稿不落业务库。

## 文件

- verification.json：11组交互、324组布局、17次axe、异常/API/外网/非GET请求统计。
- font-keyboard.json：8页文字200%压力、草稿恢复、Tab顺序与减少动效。
- performance.json：四档尺寸48组合、首屏与45资源卡图集抽测；无真实INP/FPS保证。
- assets-check.json、js-structure.json：素材/包哈希、PNG尺寸、Python/JS结构与语法检查。
- deployment.json：部署与业务库计数/媒体SHA比对。
- checks/：命令、退出码和MCP参考映射；logs/保留本批Web测试/构建/镜像日志。
- screens/：手机、宽窗、状态与模板；所有App画面均为明确标注的设计原型。

## 重跑

在项目根目录准备被忽略的QA依赖，脚本只用本机Chrome，不需要下载浏览器：

```powershell
npm install --prefix backend/.runtime-ui-refresh/browser --no-package-lock --no-save playwright @axe-core/playwright
Copy-Item docs/implementation/evidence/stage7a-design-studio/scripts/*.mjs backend/.runtime-ui-refresh/
$env:DESIGN_EVIDENCE = 'backend/.runtime-ui-refresh/design-recheck'
node backend/.runtime-ui-refresh/design-verify.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/design-font.mjs http://127.0.0.1:8080
node backend/.runtime-ui-refresh/design-performance.mjs http://127.0.0.1:8080
python scripts/design/check.py
node scripts/design/check-js.mjs
npm test
npm run test:tooling
npm run build
```

设计资源再生成见public/design-studio/README.md；重新生成SVG后需重新导出PNG并重打资源ZIP再检查。
首次测试发现的两个交互问题及草稿保留缺口已修复，过程写在报告；不把后续通过的JSON冒充首轮失败原始记录。
文字压力采用浏览器内将关键节点字号设为两倍，不等同鸿蒙系统fp缩放；原生测试仍待工具链与设备。
