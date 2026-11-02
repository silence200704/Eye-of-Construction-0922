# Web卡片与交互系统（2026-10-25）

本次按用户“主题不变、重构前端、大量卡片与背景设计、操作跟手、通过MCP参考组件”实施。
保留校园守护主题和现有品牌青`#0F6E7C`，使用暖白纸面、校园几何插画与分层卡片。
这是阶段7A的Web交付批次，App继续按OpenHarmony原生方案推进。

## 页面结构

- 外壳：浅色分区导航、图标收起模式、上下文标签、Ctrl K页面搜索、始终可见的数据来源。
- 背景：青绿/杏黄柔和色域、细点阵、等高线、同心弧、校园轮廓；使用本地CSS与SVG。
- 总览：校园欢迎卡、4张业务入口卡、4张真实统计卡、地图/记录/档案/日志阅读卡。
- 其他工作台：统一轻量标题卡、表单卡与表格；趋势、影像、风险等级、来源、单位和证据仍清晰可读。
- 传感器卡：浅色读数区、真实状态标签、原生键盘聚焦按钮，底部业务按钮独立操作。
- 空态/加载：原创资料盒插画，加载反馈只在真实请求或任务进行时出现。

## MCP参考与实际应用

通过Exa MCP `web_fetch_exa`两批读取16个组件/专题；另以网页工具核对用户提供的四个站点。
组件以当前Vue 3和CSS原生实现，不把React示例当可直接安装的Vue依赖。

| 参考 | 用到的设计 | 对应实现 |
| --- | --- | --- |
| [Bencho Edge light](https://bencho.dev/blocks/edge-light)、[Aceternity Spotlight](https://ui.aceternity.com/components/card-spotlight) | 鼠标靠近时卡片边缘跟随亮起 | `directives/edgeLight.ts`；阅读卡/快捷卡 |
| [Bencho Tab bar](https://bencho.dev/blocks/tab-bar)、[Aceternity Tabs](https://ui.aceternity.com/components/tabs) | 选中底片滑移、快速切换可中断 | `FeatureLinks.vue`，仅动画transform |
| [Bencho Collapsing sidebar](https://bencho.dev/blocks/collapsing-sidebar) | 导航可收起成图标，保留可访问名称 | `AppShell.vue`、`NavGroups.vue` |
| [Aceternity Expandable cards](https://ui.aceternity.com/components/expandable-card)、[Bencho Accordion](https://bencho.dev/blocks/faq-accordion) | 展开真实分类明细 | `InsightBoards.vue` |
| [Aceternity Stateful button](https://ui.aceternity.com/components/stateful-button)、[Bencho Loading](https://bencho.dev/blocks/loading-state) | 请求进行中有反馈，结束由真实结果决定 | `AppButton.vue`、7个录入弹窗、路由进度条 |
| [Bencho Form error](https://bencho.dev/blocks/form-error) | 字段错误贴近控件，轻量提示 | `.ctl--invalid`，沿用既有真实校验结果 |
| [Uiverse Buttons](https://uiverse.io/ui/animated-buttons) | 悬停层次、按压反馈 | 按钮和快捷卡 |
| [Uiverse Patterns](https://uiverse.io/ui/background-patterns) | 点阵、几何线条、装饰层级 | `CampusBackdrop.vue`、卡片弧纹 |
| [Kinetics](https://kinetics.colorion.co/#library) | 轻弹性曲线，及时响应输入 | 120–200ms交互节奏，减少动效可关闭 |

其余读取条目见`evidence/stage7a-web-refresh/references.json`。涉及文本改写等能力的示例只作为考察，
没有把外部AI调用或不存在的业务能力加进系统。所有新增图案与SVG为本项目代码绘制；未复制站点整段组件源码。

## 跟手与可访问性约束

1. 点击立即进入已有业务动作；不等待离场动画、装饰计时或虚构进度。
2. 路由反馈跟随实际导航生命周期；已取消的旧导航不结束新导航的加载状态，已有失败/通过回归。
3. 标签切换使用FLIP位移；连续切换取消旧动画，从当前可见位置继续。
4. 边缘光每个活动表面每帧至多更新一次；离开/卸载取消，触屏和减少动效模式不启动跟随。
5. 表单pending绑定真实Promise，7个弹窗显示忙碌状态并抑制重复提交；失败显示原错误并可重试。
6. Ctrl K搜索直接聚焦输入；Enter前往、Escape关闭并回焦；已有模态框打开时不叠加搜索框。
7. 页内对象query变化保留页面实例和滚动位置；切换工作页面回到内容顶部。
8. 告警色和文字保留；前景/背景对比度检查在初始动画结束后执行。
9. 本地SVG、CSS和系统字体提供视觉资源；运行时不依赖参考站、在线字体、React动画库或MCP服务。

## 已交付资源与阶段边界

源码：`src/components/visual/`（6个组件）、`src/styles/refresh/`、`src/directives/edgeLight.ts`。
新增11个线性图标、1幅校园场景、背景线形/点阵组合、1幅空态插画；源文件和SHA见assets.json。
小瞳沿用既有形象与状态。本批没有生成原7A清单的全部6组小瞳/4幅校园/6幅空态/16图标及宣传模板。
App关键原型、原生资源导出和宣传套件仍按7A计划办理，不能以本批Web截图代替原生App验收。

实测、图片和复验脚本见[Web交付报告](../handoff/reports/design/01-web-refresh.md)。

## 小瞳助手补充

欢迎区采用小瞳形象、能力标签、真实问题卡与对象提示；输入区采用带焦点反馈的多行卡片，发送状态跟随真实请求。
MCP 另读取 Bencho AI Chat Input、Aceternity Card Hover Effect、Placeholders And Vanish Input 三个条目，
用于输入表面层级、卡片悬停和发送反馈构思。实现保留即时发送，不使用消散延时，不添加在线模型或语音能力。
问题卡为原生按钮；中文输入法确认与 Shift+Enter 保留输入，Enter 才提交。减少动效模式关闭装饰过渡。
见[补充交付报告](../handoff/reports/design/02-assistant-refresh.md)。
