# 7A-Web交付：校园卡片与交互重构

日期：2026-10-25。基于`e8b40b9`工作区继续开发；阶段7已通过的业务与后端契约保持。

**本次Web重构已实施并完成本批核验，8080交付容器已更新。**
阶段7A整体为进行中，仍有App原型、完整美术资源及宣传模板待完成；本轮未进入阶段8。

后续补充：[小瞳助手面板重构与复验](02-assistant-refresh.md)，包含截图所示空会话界面、多行输入与回答卡片。

## 已实现

- 校园青主题保留，暖白底、分层背景、校园SVG、点阵/弧线/轮廓和不同层级卡片落地。
- 总览重排为欢迎、快捷入口、真实指标与阅读卡；监测/预警/巡检/问题/保养/知识/报表/设置等工作台共用新视觉。
- 折叠导航、Ctrl K页面搜索、可中断的滑动标签、卡片边缘光、按压反馈、分类明细展开。
- 真实导航进度、7类弹窗保存中反馈/防重提、字段错误反馈；失败仍展示原服务端错误，不伪造成功。
- 哈希路由的跳过导航、弹窗命名/初始焦点/回焦、图表描述、筛选名称、原生传感器按钮等可访问性改进。
- 修复扩展验收发现的375px视频操作栏溢出，视频说明和文件输入在窄屏内重排。
- AI算法、规则判定、权限和服务端存储继续使用原业务；Vue 3项目没有引入React运行时或新增产品依赖。

交互来源详见[设计规范与MCP映射](../../../design/web-interaction-system.md)：通过Exa MCP批量读取16个具体组件/专题，
将适用设计改写为Vue/CSS，新增SVG为代码绘制。

## 本批验证

| 验证 | 实测 |
| --- | --- |
| 前端全量 | 124文件 / 1168用例通过，含新增2个表单状态、1个导航竞态用例 |
| 类型/生产构建 | 通过；保留既有主块超过900kB提示 |
| tooling/结构 | 5项通过；范围扩至7A，并按完整Vue文件检查450行限制 |
| 真实浏览器交互 | Chrome，11组通过，页面异常0 |
| 宽窄布局 | 375/768/1280/1920px × 15路由，共60组合，无页面/内容区水平溢出 |
| 自动无障碍 | 15个默认页面，axe的WCAG2 A/AA、2.1 AA标签扫描违规0 |
| 性能抽测 | 侧栏真实点击到下一rAF、90帧鼠标移动采样、query实例保留与路径滚动重置均有记录 |
| 外网依赖 | 浏览器资源请求抽测中，非loopback请求0 |
| 部署 | 仅重建/替换Web；API健康、8080正常，迁移/核心表计数和10个媒体哈希核对 |

浏览器检查覆盖：收起/展开、键盘跳过导航、搜索聚焦/Enter/ESC回焦、边缘光、
录入弹窗真实校验、模态期间快捷键防叠加、身份选择无密码界面、助手打开/关闭、
原生传感器聚焦/独立趋势按钮、真实分类明细展开和减少动效。
测试没有提交有效记录、问题、工单或媒体写入；默认身份会话与页面自动通知回执可能正常增加，
不把“未提交业务写入”误写为“数据库绝无任何会话变化”。

性能为本机Headless Chrome、无CPU/网络降速的抽测；下一rAF并非屏幕真实呈现时刻，
不能据此承诺全部设备的FPS、INP或大规模数据表现。具体值见performance.json。
axe结果覆盖默认页面，不能替代全部动态状态、读屏、系统文字放大及原生设备验收。

## 过程中修复并留证的问题

- 初版路由反馈被旧的取消导航提前结束：先复现RED，再按实际目标修复为GREEN。
- 初次自动检查发现偏浅文字、传感器嵌套按钮、图表命名与若干筛选框缺名；调整后重验。
  初次扫描未等待进入动画，部分对比度反馈属于过渡帧；最终扫描在动画结束后执行。
- 扩至全部路由后发现375px影像工具栏超宽、报表4个状态筛选无名称；已修复并重跑交付实例。

## 证据

- [检查汇总](../../../evidence/stage7a-web-refresh/checks.json)、[浏览器明细](../../../evidence/stage7a-web-refresh/browser.json)。
- [无障碍结果](../../../evidence/stage7a-web-refresh/accessibility.json)、[性能](../../../evidence/stage7a-web-refresh/performance.json)。
- [参考记录](../../../evidence/stage7a-web-refresh/references.json)、[原创资源清单](../../../evidence/stage7a-web-refresh/assets.json)。
- [宽屏首页](../../../evidence/stage7a-web-refresh/screens/desktop/overview-wide.png)、[窄屏首页](../../../evidence/stage7a-web-refresh/screens/mobile/375-overview.png)。
- [窄屏影像](../../../evidence/stage7a-web-refresh/screens/mobile/375-media.png)、[交互截图](../../../evidence/stage7a-web-refresh/screens/dialogs/)。
- [复验脚本与说明](../../../evidence/stage7a-web-refresh/scripts/README.md)、[命令与失败/通过日志](../../../evidence/stage7a-web-refresh/logs/)。

查寝8000/5173本轮仍未运行；没有启动、停止或改动它，不宣称本轮并存健康。
后端无代码变更，未重跑后端全量；做了健康、迁移、部署数据/媒体检查，不复用旧266项测试冒称本轮执行。

## 补充：侧栏引导卡可关闭（2026-10-25）

小瞳引导独立为 CompanionCard.vue，增加关闭按钮与关闭后的恢复入口，键盘关闭后焦点移到恢复按钮；恢复后聚焦实际提问入口。
只在当前浏览器保存界面偏好，刷新/路由切换保持关闭状态，浏览器限制存储时本页仍可关闭；不修改业务数据或助手会话。
类型检查、生产构建、tooling 5 项通过，结构扫描 54 文件无超限。仅重建 Web，8080 上 8 组真实浏览器检查通过，页面异常 0。
[复验结果](../../../evidence/stage7a-web-refresh/dismissible-companion/verification.json)、
[显示状态](../../../evidence/stage7a-web-refresh/dismissible-companion/card-visible.png)、
[关闭状态](../../../evidence/stage7a-web-refresh/dismissible-companion/card-dismissed.png)。
