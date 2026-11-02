# 筑瞳 App：小瞳的校园守护手账

2026-10-26按用户本轮要求替换原生App界面；保留筑瞳青绿色主题和OpenHarmony原生路线。
本轮落地工作台、监测列表、测点详情、任务/工单空态、身份与连接设置。
原型中的后续上报、工单办理等流程继续遵循阶段8业务门槛，不用装饰按钮代替真实功能。

## 视觉与原生组件

- 奶油纸色背景、浅点阵和涂鸦；薄荷绿欢迎卡、开心果色测点卡、杏桃色预警卡、天空蓝/奶黄色入口。
- 原创小瞳采用圆润单眼机器人、叶芽天线、工具贴纸；配校园小楼和工具箱，不使用现场照片冒充证据。
- 欢迎卡、数字卡、行动卡、读数卡、身份票卡、工具箱空态保持不同层级，正文和危险状态保留清晰对比。
- 底部四入口为工作台/监测/任务/我的；选中入口扩宽。详情使用Navigation系统返回，保留监测筛选。
- 点击小瞳可摆动并展开可关闭的引导卡，直接进入真实监测页；测点卡可就地展开采样/质量/来源，保持浏览上下文。
- 按钮有短距离压下/回弹，真实数值更新只做轻微缩放，不编造数字递增。业务导航与展开直接响应，不等待装饰动画完成。
- 我的页面提供“轻动效”开关。关闭小瞳浮动、卡片弹性和数字强调，持久化后重启仍保留；原生基础导航仍可用。
- 主要按钮至少48vp；使用系统字体和原生Button/Toggle，装饰图片不参与读屏焦点。
- 当前实测为手机模拟器默认字号。大字号、读屏、宽窗、真机和帧率尚未验收，不能据静态截图宣称全部适配。

## 参考来源与转译

本轮通过浏览与Exa MCP读取用户指定站点及下列组件页。借鉴布局和反馈方式，未引入React运行时或复制第三方素材。

| 来源 | 参考点 | ArkUI落地 |
| --- | --- | --- |
| [Bencho Tab Bar](https://bencho.dev/blocks/tab-bar) | 选中导航扩展、轻弹性 | BottomDock选中权重与原生弹簧曲线 |
| [Bencho Pill Accordion](https://bencho.dev/blocks/pill-accordion) | 胶囊入口展开内容 | 我的页连接设置折叠卡 |
| [Uiverse Cards](https://uiverse.io/cards) | 可触摸的层叠卡片 | AppCard、ActionTile、身份票卡 |
| [Uiverse Patterns](https://uiverse.io/patterns) | 背景纹样 | 原创点阵与校园涂鸦，低对比装饰层 |
| [Aceternity Bento Grid](https://ui.aceternity.com/components/bento-grid) | 大小卡片形成层级 | 工作台双列指标和行动入口 |
| [Aceternity Wobble Card](https://ui.aceternity.com/components/wobble-card) | 响应输入的卡片反馈 | 触屏压下/缩放，取消鼠标悬停依赖 |
| [Kinetics Number Counter](https://kinetics.colorion.co/effects/number-counter/) | 数字强调 | 服务端真实数值变化时短暂缩放 |
| [Kinetics Card Resize](https://kinetics.colorion.co/effects/card-resize/) | 卡片展开与收起 | 连接设置原生布局动画 |

## 素材、数据和交付

13项原创SVG登记在`mobile/openharmony/artwork/manifest.json`，含作者/AI辅助标记、用途路径、尺寸、字节和SHA-256。
源图由`scripts/mobile/artwork/build.py`生成；`prepare_online.py`核验清单后复制实际引用资源及应用图标。
素材不引用外站图片、字体或脚本，运行时无需访问参考站点。

首页8个测点、1个未关闭预警来自当前服务端快照；任务/工单为空时保留友好空态。
断连清除受保护计数，以“—”显示；缺少电量/最近上报时间显示未知；历史采样明确标记非实时。
不改变后端、助手算法和已有Web样式；不新增登录、账号密码或硬件开发。

验收与截图见[本轮报告](../handoff/reports/mobile/04-native-online-ui.md)。
