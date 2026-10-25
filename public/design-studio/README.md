# 筑瞳 · 阶段7A设计室

入口：`http://127.0.0.1:8080/design-studio/index.html`。本目录是设计稿和素材展示，不是移动端实现。
正式 App 必须使用 OpenHarmony ArkTS + ArkUI + Stage，不能把这个网页装进 WebView 作为 App 交付。

## 已交付

- 12个关键页，9类可切换界面状态，手机/宽窗口原型。
- 原创矢量小瞳6状态、校园场景4幅、空态6幅、图案4套各2版、图标16个、流程3套、品牌概念2张。
- 主海报/3场景海报/协同图/16:9与9:16封面，共7套匿名可编辑模板。
- 共52个SVG和对应PNG、语义Token、来源/版本/尺寸/体积/SHA-256清单。

所有图形以项目代码绘制，AI辅助。没有下载或内嵌第三方美术、在线字体、组件源码。
图形的分发条款由项目所有者确定；本清单不冒充第三方授权证明。
新的矢量小瞳是本批设计提案；正式Web已有位图形象保持不变，最终统一使用前应集中视觉复核。

## 数据与功能边界

本原型不连接业务API，不上传图片，不写数据库，不生成工单或伪造回执。
内存中的示例草稿随刷新清空；不能据此宣称阶段9离线持久化已经实现。
所有读数、时间、设备在线、电量、到点和统计为明确标注的示例。
照片槽仅为装饰占位，不是现场证据。海报截图区待阶段10用已验收功能的真实截图替换。
没有真实NFC、GPIO/I2C、实体声光、跨设备分布式或建筑安全鉴定能力。

## 来源与重新导出

`assets/manifest.json` 记录52项资源及PNG哈希。`assets/tokens.json` 定义双端语义。
可编辑美术源为SVG；生成脚本位于仓库 `scripts/design/`。

```powershell
python scripts/design/build.py
node scripts/design/export-assets.mjs
python scripts/design/build.py
python scripts/design/check.py
node scripts/design/check-js.mjs
```

PNG导出使用本机Chrome和忽略目录内的Playwright，仅开发工具，不新增产品依赖。
原生导入时先验证实际SDK支持的资源格式、fp字体缩放、vp触控、安全区、系统返回和图片解码。
应用图标/启动画面是视觉概念，尚不是已通过平台发布验证的资源配置。
