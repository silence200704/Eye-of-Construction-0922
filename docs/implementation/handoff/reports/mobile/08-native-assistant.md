# 移动端小瞳 AI 交接报告

2026-10-31。OpenHarmony 原生 App 接入与 Web 同源的服务端小瞳：

- 通用问答；
- 带工单 / 问题 / 巡检测点上下文的问答；
- 工单上报辅助：回答中的建议可填入当前上报草稿的备注或维修措施；
- 从回答直接打开工单、问题、预警、测点等原业务页面。

## 形象统一

手机端小瞳形象改用与电脑端同一个素材 `src/components/assistant/xiaotong.png`（复制到
`rawfile/playful/characters/`）：工作台故事卡、连接状态、我的身份卡、AI 页头图都用它；
底部“小瞳”Tab 用缩小后的 `xiaotong-icon.png`，避免每帧解码 1254px 大图。旧 guide/rest/scout
SVG 只作为历史素材保留，不再出现在运行时页面。

## 实现

| 层 | 文件 | 作用 |
| --- | --- | --- |
| DTO | `data/models/Assistant.ets` | 会话、回答、事实、链接、上下文类型 |
| 会话 | `core/assistant/AssistantSession.ets` | POST `/datasets/demo-main/assistant/query`，校验 epoch，维护本地线程，错误重试 |
| 页面 | `features/assistant/AssistantPage.ets` | 问答气泡、事实、可点链接、追问建议、输入框、建议填入按钮 |
| 导航 | `pages/Index.ets`、`shared/playful/BottomDock.ets` | 新增「小瞳」Tab；连接重置时清空会话；链接跳转到原业务页 |
| 上报 | `core/report/ReportSession.ets` | `applySuggestion()` 只填文字，不提交、不覆盖已有说明 |
| 入口 | `OrderDetail`、`IssuesPage`、`TaskDetail` | “问小瞳：这一单怎么处理 / 这条问题怎么办 / 这次巡检怎么查” |

- 请求带 `Idempotency-Key`、`X-Dataset-Epoch` 和当前身份 token；epoch 不一致拒绝展示旧回答。
- 上下文只发送服务端允许的 `workOrderId / issueId / pointId / eventId`，并设 `chosen: true`。
- 回答链接按服务端 `workorder_detail / issue_detail / event_detail / point_trend / spatial_3d / monitor / settings` 映射到原生页面。
- 没有自动提交：AI 结论只能作为草稿建议，工单接单、维修、提交验收仍走人的现有操作与权限校验。
- 现有身份切换、被动取消、网络失败逻辑不改变；AI 不绕过工单/问题权限。

## 输入与思考过程

- 输入条固定在页面底部、BottomDock 之上，永远单行；发送按钮与输入同一行，不再随消息滚走。
- 提问后先出现三步思考卡：识别/读取/整理，每步约 500ms，共约 1.5 秒；卡上显示小瞳形象、当前步骤
  和进度点，服务端答案在这之后才出现，不会瞬间弹出。
- 思考期间禁止重复发送；新消息/答案到达后自动滚到最新位置。
- 思考文案按上下文区分（工单、问题、预警、通用），但都只显示流程名，不伪造内部推理内容。

## 入口修复：点击“问小瞳”看似无反应（2026-10-31）

**现象。** 巡检手账、问题池、维修手账点“问小瞳：…”后停留在原页，看起来按钮不可点；系统返回一次才看到小瞳页。

**根因。** 详情页是压栈的 `NavDestination`，而小瞳是根 `Tabs` 的第 4 个 Tab。原 `Index.openAssistant()`
只设 `this.tab = 3`，切换发生在被盖住的根页上；点击事件与上下文绑定其实都已生效。

**修复。** `openAssistant()` 在切 Tab 前先 `NavPathStack.clear()` 回到根页（仅当栈非空），三个入口共用这一处。
详情页随之关闭，与 Web 端“关详情再开小瞳”的口径一致；不新增路由、不改业务数据与权限。

**实测（Pura90 模拟器，`org.zhutong.mobile`，debug 夹具签名）。** 修复前点巡检入口后布局仍是“巡检手账”，
按返回才出现小瞳页且上下文已为 `TK-20261031-001 …`。修复后三个入口点按即进入小瞳页并绑定对象：
`TK-20261031-001 演示场景：3 号教学楼二层日常巡检`、`ISS-20261031-011 裂缝`、
`WO-20261031-001 设备故障（ISS-20261031-001）`。真机与方向切换未验。

## 验证

- 原生 Node/mocks：**127 项通过**（本功能批次；新增 2 项 AI 会话测试：上下文请求、失败不伪造回答）。
- 2026-10-31 入口修复后全量移动端 Node/mocks：**134 项通过**。
- 模拟器实际安装：工作台已加载 9 个测点、15 条问题；AI 页输入条固定在底部单行，已实际发出一次 `POST /assistant/query`。
- `node scripts/mobile/verification/structure.mjs`：退出码 0，无结构违规。
- `python scripts/mobile/verification/structure.py`：退出码 0。
- SDK 构建：`assembleApp --no-daemon` **BUILD SUCCESSFUL**；未配置签名，未安装到模拟器/真机。
- 服务端接口实测：带 `workOrderId` 的 `/assistant/query` 返回 200，回答包含 6 条事实和 2 个链接。

## 仍需设备复验

- 已在 Pura 90 模拟器安装；宽窗、软键盘、真实读屏与长对话仍待人工复验；
- 当前使用本机临时后端 `18001`（Docker 数据副本迁移后），并非正式容器；如重启服务后 App 无法连接，需要恢复端口转发和服务。
- AI 只做演示级问答，不接真实大模型训练数据，不承诺每问必答。
