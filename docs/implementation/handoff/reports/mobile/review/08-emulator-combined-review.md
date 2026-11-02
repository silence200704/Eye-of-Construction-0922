# 阶段7A/8统一复验（模拟器）

日期：2026-10-30。对象：筑瞳 Web/API/OpenHarmony App。结论：**待补证据**。
本轮返修已关闭上一轮两个 P1（连续照片、系统字号），并实测本轮大字号/就地反馈/统计分页/安静模式；
但 App 宽窗/横屏、软键盘遮挡、真实读屏、真机及 Web 表单动作仍缺证据，不能据此宣布阶段7A/8完成。
未进入阶段9，未改业务代码与AI。

## 0. 结论先行

- 连续照片：保留原 `protected-photos` 目录、未清缓存，同一会话连续读工单 6 张（两轮 before/after/acceptance）+ 问题现场图，全部成功；标签正确、无 `File exists`、无上一张残影；force-stop/start 后仍可读。App 缓存文件字节/SHA 与服务端媒体一致（28,791 字节，`275567c7…`）。
- 系统字号：标准→特大热更新日志 `fontScale=1.45`，冷启动仍 1.45；页面文字/控件随倍率变化；特大时工作台单列，标准时双列；四底部导航可见可点。恢复标准后 `fontScale=1`。
- 就地反馈：预警确认成功不再出现在排查表单；短说明、缺核查依据、缺无需维修结论均在当前按钮上方就地提示且不写库；丢弃响应后表单出现原请求核验按钮，重试无重复。巡检错标签/缺人工原因/缺必答项均就地拦截，补齐后可完成。
- 统计：500 测点/5006 记录/57 事件/46 未关闭的压力库中，频次卡仅列 47 个非零对象，按 5/4/3/2/1 降序、同频次按 ID，20/20/7 三页不重不漏；切月/切楼栋回第一页，空楼栋明确空态；总事件/采样不被分页改变。
- 完整现场链：任务到点→必答清单→完成；问题审核转维修→指定维修人 App 一键接单→只填措施完工→验收通过→待复查→复查关闭，四种对象状态分别成立。
- 备份/重启：40 表与 4 个媒体哈希一致；恢复库独立 API 行/媒体一致；18010 本体重启后数据与媒体不变，App 重连 3 测点。
- 未验证：App 横屏/宽窗（旋转命令报成功但屏幕仍 1320×2856）、软键盘遮挡（本机只出现文本选择工具条）、真实读屏（系统确认未替用户接受）、真机、Web 表单验收/复查（本轮用同源命令，Web 页面只读核对）、照片缓存失败注入（沙箱拒绝改目录，只有开发证据）。
- 建议：**待补证据**。本轮未发现 P0/P1；新返修与新增检查在模拟器范围内通过，待补项补齐后再由负责人裁定阶段7A/8。

## 1. 基线与构建

| 项 | 实际值 | 证据 |
| --- | --- | --- |
| HEAD | `bab31e0a3ef555e17e6cdfbda7c9f7b470567bbc`（提示词基线 `8fc6210` 之后的文档提交）；分支 `codex/fullstack-competition` | [head.txt](../../../../evidence/stage8-engineer-combined/baseline/head.txt) |
| 工作区 | 88 项未提交改动，49 文件变更（815+/912-），均为交接前 Web 视觉/文档成果；未 reset/clean/stash | [git-status.txt](../../../../evidence/stage8-engineer-combined/baseline/git-status.txt)、[git-diff-stat.txt](../../../../evidence/stage8-engineer-combined/baseline/git-diff-stat.txt) |
| 源码/配置 | 73 个文件逐文件 SHA-256（含 AppScope app.json5、configuration.json） | [source-hashes.json](../../../../evidence/stage8-engineer-combined/baseline/source-hashes.json) |
| 构建 | Hvigor 退出 0，`BUILD SUCCESSFUL in 23 s 238 ms`；未签名 HAP 1,022,485 字节，SHA-256 `0ddeaf8de596028009bfab5cc7b379521c9fda96a30d90f791ac438fa3e7a777`（与交接记录 `1e23c373…` 不同，以本轮实际产物为准） | [hvigor.log](../../../../evidence/stage8-engineer-combined/builds/hvigor.log) |
| 签名 | 退出 0；debug 公共夹具，profile 到期 2026-11-29；签名 HAP 1,067,578 字节，SHA-256 `414be590cf62185a9b26d4daee3b9004a4e3ffad9b1554a83588501509ff59f3`（未复用旧 `602eb303…`） | [signing.log](../../../../evidence/stage8-engineer-combined/builds/signing.log) |
| 安装/启动 | `install_exit=0`、`start_exit=0`；`org.zhutong.mobile` 0.8.0-dev，API target/compatible 20，debug | [install.log](../../../../evidence/stage8-engineer-combined/builds/install.log)、[start.log](../../../../evidence/stage8-engineer-combined/builds/start.log) |
| 设备 | Pura 90 模拟器，x86_64，1320×2856，运行时 API24；HDC `127.0.0.1:5555` | 本节命令、HDC 实查 |
| 服务 | 隔离 API 18010（本轮重启后 PID 49636）、网关 18011、device 18090→host 18011；App 地址 18090 | 端口/HDC 实查 |
| 字号/读屏 | 标准→特大→标准；最终日志 `fontScale=1`、`screenReader=false`、orientation=0 | [scale.json](../../../../evidence/stage8-engineer-combined/verification/font/scale.json) |

开发方证据（本轮未独立重跑）：Node/mocks **104 passed**、行 94.85%/分支 81.89%；结构 1058 函数、最大文件 311 行、最大函数 43 行、文件/参数/目录超限 0；SDK 构建通过。[coverage.log](../../../../evidence/stage8-reading-layout/builds/coverage.log)、[structure-native.json](../../../../evidence/stage8-reading-layout/builds/structure-native.json)、[hvigor.log](../../../../evidence/stage8-reading-layout/builds/hvigor.log)

## 2. A. 连续照片回读与权限

对象：`ISS-20261029-001`（`iss_a4d02452…`，1 张现场图）与 `WO-20261029-001`（`wo_628896dd…`，已验收，3 张）。附件/媒体：

| 标签 | 附件 | 媒体 | 字节 | SHA-256 |
| --- | --- | --- | --- | --- |
| 现场 | `att_7c2372…` | `d6d6fd06…` | 28,791 | `275567c7…` |
| 维修前 | `att_5d02d7…` | `69b03767…` | 30,819 | `72671b6d…` |
| 维修后 | `att_fcbb79…` | `1a55f832…` | 30,990 | `2791ad37…` |
| 验收 | `att_d0b90a…` | `bfb02e55…` | 28,914 | `2cf2893b…` |

- 保留既有 `cache/protected-photos` 空目录，全程不清缓存。工单**同一会话连续读两轮** 3 张：before→after→acceptance，全部显示正确标签与图片，`saved-photo-feedback` 为空，无 `File exists`。[order-rounds.json](../../../../evidence/stage8-engineer-combined/verification/photos/order-rounds.json)
- 同一会话随后读问题现场图，显示“现场照片”，仍无错误；同一会话累计 7 次连续读取（3+3+1）无清缓存。[issue-readback.json](../../../../evidence/stage8-engineer-combined/verification/photos/issue-readback.json)
- force-stop/start 后重进工单，仍可读“维修前照片”，无错误。[cold-restart.json](../../../../evidence/stage8-engineer-combined/verification/photos/cold-restart.json)
- 读取“现场照片”时直接拉取 App 缓存文件：`preview-1793329696061-21iyu4qfpxl.jpg`，28,791 字节，SHA `275567c7…`，与服务端媒体 SHA 完全一致；不是只证明服务器自己一致。[cache-hash.json](../../../../evidence/stage8-engineer-combined/verification/photos/cache-hash.json)
- 只读查看不增加业务对象/审计/回执：读取前 1 问题/1 工单/4 媒体/4 附件/审计 48/回执 42，读取后完全相同。
- 返回/身份切换：以 inspector 打开同一工单，初始无 `saved-photo-preview` 残留；离开页面预览被清理。[identity-switch.json](../../../../evidence/stage8-engineer-combined/verification/photos/identity-switch.json)
- 页面：`page/photos/round1-0..2`、`round2-0..2`、`issue-scene`、`cold-restart-before`。

**限制**：
- 取图途中切身份/收回范围未能制造：照片走本机回环，完成远快于身份切换；代码有 generation/lease 复核，但本轮无“途中”实测。取图后离开/切身份无残留已实测。
- 缓存失败注入被系统拒绝：`mv cache/protected-photos …` 返回 Permission denied，无法在不改应用的情况下制造写失败；中文错误文案只有开发方 Node/mocks 证据与代码检查，页面未实际触发。正常路径未出现英文错误或沙箱路径。

## 3. B. 系统字号、布局、导航与实际窗口

| 状态 | 实际日志/布局 | 证据 |
| --- | --- | --- |
| 初始冷启动 | `fontScale=1`，工作台两列（monitor x=63–639，tasks x=681–1257） | [scale.json](../../../../evidence/stage8-engineer-combined/verification/font/scale.json)、`page/font/standard-home` |
| 标准→特大热更新 | 系统滑块“特大/5.000000”，实际交付倍率 **1.45**（不把滑块刻度当倍率）；页面随热更新放大 | `page/font/hot-home`、`hot-monitor`、`hot-tasks`、`hot-profile` |
| 特大冷启动 | 仍 `fontScale=1.45`；工作台单列（monitor y=1507–1993，tasks y=2035–2422） | `page/font/cold-home`、`hot-home-shortcuts` |
| 最小字号 | 拖到最左日志 `fontScale=0.85`；随后恢复标准 | [scale.json](../../../../evidence/stage8-engineer-combined/verification/font/scale.json) |
| 恢复标准冷启动 | `fontScale=1`，滑块“标准/2.000000”，工作台恢复两列 | `page/font/standard-home` |

- 逐页检查（1.45）：首页、监测、任务筛选、任务详情/到点/清单、预警详情/排查表单、工单详情、照片、统计、我的/连接设置。文字换行、无重叠；输入框/文本域/选择器随 `controlHeight` 增高；长标题换行显示，按钮保持可点；底部四导航均可见、可点、选中态正确（`page/font/*`）。
- 首页大字号下快捷卡在单列中顺序堆叠；滚动到底“巡检与维修”和“现场发现”均可完整到达，未被底栏永久遮挡（`page/font/hot-home-bottom`）。
- 任务日期筛选在 1.45 下控件增高；日期非法提示在输入框下方就地显示（键盘收起的正常状态）。
- **未验证**：
  - 软键盘没有出现：点击文本域只出现“粘贴/自动填充/拍摄输入”工具条，无系统键盘；无法验证键盘遮挡与输入时提交可达。[alert-keyboard.json](../../../../evidence/stage8-engineer-combined/verification/font/alert-keyboard.json)、`page/font/hot-alert-keyboard`
  - 横屏/宽窗：`Emulator -instance "Pura 90" -rotation left/right` 均报 `Scenario simulation success`，截图仍 1320×2856；宽窗验收阻断。[rotation.json](../../../../evidence/stage8-engineer-combined/verification/window/rotation.json)
  - 真实读屏：系统“是否开启屏幕朗读？/开启 (7 秒)”需用户确认，本轮未代替接受；实际语音/焦点顺序未验证。[screenreader.json](../../../../evidence/stage8-engineer-combined/verification/screenreader.json)
- 安静模式：关闭“轻动效”后依次切 工作台/监测/任务/我的，均可用、无卡住；Tabs 动画时长按偏好为 0。随后恢复开启。[motion-off](../../../../evidence/stage8-engineer-combined/page/font/motion-off)、`motion-off-tabs`、`motion-on`。

## 4. C. 就地反馈与简洁流程

### 4.1 预警表单与动作隔离

对象：`E20261029-002`（`evt_6ba7dbe6…`，振动黄色）。起点 pending rev1，审计 48/回执 42。

| 动作 | 实际 | 库/回执 |
| --- | --- | --- |
| 确认 | 操作区显示“服务端已保存本次办理。”；打开排查表单后**不再显示确认文案** | handling rev2；审计 49/回执 43 |
| 短说明“短句” | 保存按钮上方就地显示“排查或措施说明至少10字。”，无需上滑；输入保留 | 不写库，49/43 |
| 丢弃一次成功响应 | 排查表单就地出现“暂时无法连接…”与“用原请求核验办理结果”按钮；重试成功 | 提交后 50/44；重试后 50/44，时间线仅 1 条现场排查，无重复 |
| 恢复前关闭（缺依据） | 关闭表单就地显示“只有恢复待确认事件可以填写复查依据关闭。” | 不写库 |
| 仅填恢复依据 | 就地显示“关闭事件必须有当前事件关联且验收通过的工单，或填写‘无需维修’现场核查结论” | 不写库；仍 recovering rev4 |
| 补无需维修结论 | “服务端已保存本次办理。”；closed rev5，关闭依据保留 | 审计 55/回执 48 |

- 短说明与关闭缺依据的反馈都在当前表单按钮上方，点击后当前视口可见；未出现上一动作成功文案串入。[ack-and-note-isolation.json](../../../../evidence/stage8-engineer-combined/verification/alerts/ack-and-note-isolation.json)、[note-short.json](../../../../evidence/stage8-engineer-combined/verification/alerts/note-short.json)、[note-retry.json](../../../../evidence/stage8-engineer-combined/verification/alerts/note-retry.json)、[close-empty-basis.json](../../../../evidence/stage8-engineer-combined/verification/alerts/close-empty-basis.json)、[close-note-required.json](../../../../evidence/stage8-engineer-combined/verification/alerts/close-note-required.json)、[close.json](../../../../evidence/stage8-engineer-combined/verification/alerts/close.json)
- 页面：`page/alerts/ack-success`、`note-form-no-ack-message`、`note-short-inline`、`note-unknown-inline`、`note-retried-inline`、`close-empty-basis`、`close-note-required-inline`、`close-success-feedback`。
- 观察：丢弃响应后的文案是通用网络错误，非明确的“结果未知”；但同处出现“用原请求核验办理结果”按钮，重试复用原键成功（见 P3-1）。

### 4.2 巡检到点与完成

任务：`TK-20261030-001`（`plan_2e4d…@2026-10-30T01:00:00+00:00`），inspector，必答 1 项；点位标签在测试中登记为 `TAG-UNIFIED-CRACK` v2。

| 操作 | 实际 | 结果 |
| --- | --- | --- |
| 未填标签直接核对 | 当前按钮旁显示“请填写本次读取或核对的标签编号。” | 未到点 |
| 正确标签、未填人工原因 | 显示“人工签到必须填写原因。” | 未到点 |
| 补原因后核对 | 显示“人工兜底核对通过（标签 TAG-UNIFIED-CRACK v2）”；原因保留 | 到点成功 |
| 未答必答项直接提交 | 显示“请完成全部必答检查项。” | 未完成 |
| 选正常并提交 | 显示“全部测点已检查完成。” | task checked rev3，result completed |

- 反馈均在当前到点/完成按钮附近，修改后原输入未清空。[checkin-no-reason.json](../../../../evidence/stage8-engineer-combined/verification/inspection/checkin-no-reason.json)、[checkin-success.json](../../../../evidence/stage8-engineer-combined/verification/inspection/checkin-success.json)、[feedback.json](../../../../evidence/stage8-engineer-combined/verification/inspection/feedback.json)；页面 `page/inspection/*`。
- 任务日期：`2026-02-29`、`2026-13-01`、`2026-04-31` 显示“请填写有效日期（YYYY-MM-DD），或清空查看全部任务。”；`2024-02-29` 合法；清空后恢复全部（0 任务时“匹配 0 条任务”）。[date-validation.json](../../../../evidence/stage8-engineer-combined/verification/tasks/date-validation.json)

### 4.3 最短现场闭环

1. 安全审核 `ISS-20261029-001` 转维修（category=equipment）→ 问题 repairing，生成 `WO-20261030-001`（rev1 created）。
2. 安全派指定人 demo-repair → assigned。
3. App 维修身份打开工单，点“接单，开始处理”一次即 repairing，无二次确认；点“填写措施，提交完工”，只填措施，不选照片/材料 → submitted rev4，acceptedBy demo-repair。
4. 安全验收 → verified rev5；问题自动 pending_recheck rev3（验收只推进待复查）。
5. 安全登记复查（subject/owner/dueDate）→ pending_recheck；复查结论 recovered → 问题 closed rev5。
6. App 工单页刷新显示“验收通过”；问题页显示“已关闭”；Web `/issues` 同一时刻显示“已关闭 1｜共1条问题｜工单2张”。[loop/final.json](../../../../evidence/stage8-engineer-combined/verification/loop/final.json)、`page/loop/order-verified-app`、`issue-closed-app`、[web-issues.png](../../../../evidence/stage8-engineer-combined/page/web-issues.png)

- 状态分别成立：任务 checked、问题 closed、工单 verified、预警 E20261029-002 closed rev5；没有把验收当问题/预警关闭。
- **限制**：第4/5步的验收与复查通过同源安全命令执行，未点 Web 表单；Web 页面仅只读核对。正常接单无确认、完工只必填措施已在 App 实测。

## 5. D. 统计排序、分页与长数据

### 5.1 验收库

关闭两条预警后：`触发 2 次预警 / 当前未关闭 0 次 / 采样 9 条`（6 条原采样 + 3 条恢复复测），与数据库一致；页面 `page/restore/stats-acceptance`。

### 5.2 压力库

- 夹具：500 测点、5006 记录；在原 2 事件基础上，用**直接 SQL 在独立压力库**新增 45 个点的 55 条测试事件（1 点 5 次、1 点 4 次、1 点 3 次、1 点 2 次、其余各 1 次），明确标注为读取/分页夹具，不是业务写入；未写交付库。[events.json](../../../../evidence/stage8-engineer-combined/verification/stress/events.json)
- API：week/month 均 57 事件、46 未关闭、5006 采样；`byPoint` 500 行中非零 47；排序前五 5/4/3/2/1，同频次按 ID；`/mobile/records` 2,492 行 168ms；insights 409ms(周)/218ms(月)。[insights.json](../../../../evidence/stage8-engineer-combined/verification/stress/insights.json)、[expected-ranking.json](../../../../evidence/stage8-engineer-combined/verification/stress/expected-ranking.json)
- UI 三页逐项采集：
  - 第1页：20 项，压力测点001–004（5/4/3/2）、crack、vibration、005–018；`共47项 · 第1/3页 · 每页20项`；上一页 disabled，下一页 enabled。
  - 第2页：20 项，019–038；总数仍 47。
  - 第3页：7 项，039–045；下一页 disabled，上一页 enabled。
  - 47 项无重复、无遗漏；顺序与 API 降序/ID 稳定排序一致。[page1.json](../../../../evidence/stage8-engineer-combined/verification/stress/page1.json)、[pages.json](../../../../evidence/stage8-engineer-combined/verification/stress/pages.json)、`page/stress/stats-*`
- 切月后回第1页（`共47项 · 第1/3页`）；切“安静小院”显示两次“本期没有触发预警的对象。”且无页码；切回全部楼栋回第1页；总事件/采样仍 57/5006。[filters.json](../../../../evidence/stage8-engineer-combined/verification/stress/filters.json)
- 类型分布：裂缝167/倾角167/振动166，与 API 一致；3 行不触发分页。[types.json](../../../../evidence/stage8-engineer-combined/verification/stress/types.json)
- 交互/内存：重新打开统计页约 2.96s、翻页约 2.92s（墙钟含 HDC layout dump，不是渲染帧时）；RSS 349,512 kB、HWM 373,732 kB。[perf.json](../../../../evidence/stage8-engineer-combined/verification/stress/perf.json)

## 6. E. 重启、备份、冲突、模板与恢复

- **备份/恢复**：40 张表逐表计数+SHA 与 4 个媒体文件 SHA 全部一致；`backup-combined` 独立 API 18013 读取 issues/orders/events/attachments 与 18010 完全相同，媒体内容 SHA 一致。[backup.json](../../../../evidence/stage8-engineer-combined/verification/backup.json)、[restored-api.json](../../../../evidence/stage8-engineer-combined/verification/backup/restored-api.json)
- **18010 本体重启**：停止 PID 10108，用同一 runtime/DB 重启为 PID 49636；健康检查 ready，业务行 1 问题/2 工单/2 事件/4 附件、媒体 SHA 不变；App force-stop/start 后重连，显示 3 测点/0 未关闭。[after-restart.json](../../../../evidence/stage8-engineer-combined/verification/backup/after-restart.json)、`page/restore/after-api-restart`
- **跨端 rev 冲突**：对已验证工单用旧 `expectedRev` 提交 → HTTP 409 `REVISION_CONFLICT`，对象与计数不变。[rev.json](../../../../evidence/stage8-engineer-combined/verification/conflicts/rev.json)
- **模板匿名性**：模板生成器文本只含“匿名设计/宣传模板、硬件输入模拟”，未出现学校/学院/指导教师/队名；模板画廊无身份信息。最终 DOCX/PPT/视频属阶段11，本轮未核对成品。[templates.py](../../../../../../scripts/design/templates.py)
- **未补验**：处理中收回楼栋/角色的迟到响应、相册选图上传、工单退回重办、App 冲突 UI；分别沿用 06/07 或原阶段表的历史版本，不计本轮通过。
- **阶段9**：离线持久化未实施；本轮未用内存草稿冒充离线队列。

## 7. S7A-01—08

| 编号 | 结论 | 本轮/历史说明 |
| --- | --- | --- |
| S7A-01 | 通过 | 品牌/主题未变；本轮原生页面均沿用青绿/暖白/小瞳。 |
| S7A-02 | 通过（历史） | 素材未改；沿用 104 项离线素材证据，本轮未重扫许可清单。 |
| S7A-03 | 通过（历史） | Web 60 组合/11 交互沿用 08-emulator-review；本轮只用 Web 读取闭环状态。 |
| S7A-04 | 未验证 | 大字/竖屏单列、标准双列已实测；宽窗/横屏未产生。 |
| S7A-05 | 未验证 | 字号已修且实测 1.45；软键盘未出现、真实读屏未启用，关键子项缺证据。 |
| S7A-06 | 未验证 | App 横屏/宽窗未取得；Web 宽度截图沿用历史。 |
| S7A-07 | 通过 | 构建通过；500 点统计/分页与内存已采样；Web 性能沿用历史。 |
| S7A-08 | 未验证 | 模板源文本匿名已核；正式 DOCX/PPT/视频未交付核对。 |

## 8. S8-01—14

| 编号 | 结论 | 本轮/历史说明 |
| --- | --- | --- |
| S8-01 | 通过（模拟器） | 重建/签名/安装/启动退出 0；本轮 safety/inspector/repair 实测，property/device 沿用历史。真机未验证。 |
| S8-02 | 通过 | App 3 测点/0 未关闭与 Web 已关闭问题/2 工单一致；身份切换重载。 |
| S8-03 | 通过 | 到点/人工原因/必答/完成就地拦截与成功；日期校验。 |
| S8-04 | 未验证 | 相册上传/真机未复演；照片回读另见 A。 |
| S8-05 | 通过 | 丢弃响应原键重试无重复；历史照片/工单重试证据。 |
| S8-06 | 通过（限服务端动作） | App 接单/完工实测；验收/复查经同源命令，Web UI 未点。 |
| S8-07 | 未验证 | 服务端 409 已实测；App 冲突 UI 沿用历史。 |
| S8-08 | 通过 | 18010 本体重启、40 表/4 媒体备份恢复、App 重连。 |
| S8-09 | 未验证 | 构建/安装/字号/返回可用；宽窗/软键盘缺证据。 |
| S8-10 | 未验证 | 无真机，实录未取得。 |
| S8-11 | 通过 | 三类型读数/设备三态/筛选沿用历史；本轮监测 3 点与筛选正常。 |
| S8-12 | 通过 | 预警确认/排查/恢复/关闭、权限、rev、幂等、动作隔离、就地反馈本轮实测。 |
| S8-13 | 通过 | 验收 2/0/9；压力 57/46/5006、47 非零、3 页排序分页；空态/切月/切楼栋。 |
| S8-14 | 未验证 | 页面/大字/单列/反馈可用；宽窗、软键盘、读屏仍缺。 |

## 9. 缺陷与观察

### P2-1 未知结果文案偏通用（UX）

- 现象：网关丢弃一次成功响应后，排查表单显示“暂时无法连接筑瞳服务，请检查服务地址与网络。”，旁边虽有“用原请求核验办理结果”按钮，但文案未直接说明“结果可能已保存、请核验”。
- 影响：用户可能误以为提交失败而重填；实际原请求已提交，重试复用原键成功。
- 最小修复：对“已发出 POST 且无响应”的 unknown 分支使用“结果未知，记录可能已保存；请用原请求核验”文案；网络未发出时才用“无法连接”。
- 证据：[note-unknown-inline](../../../../evidence/stage8-engineer-combined/page/alerts/note-unknown-inline)、[note-retry.json](../../../../evidence/stage8-engineer-combined/verification/alerts/note-retry.json)。

### P3-1 压力库 API 仍返回零频次对象

- `byPoint` 返回 500 行（含 453 个零），App 过滤为 47 行；UI 满足“仅非零”，但 500 点下接口载荷偏大。非本轮阻断；建议后端只返回非零或分页。
- 证据：[insights.json](../../../../evidence/stage8-engineer-combined/verification/stress/insights.json)。

### 环境阻断（非代码缺陷）

- 横屏/宽窗：`-rotation left/right` 均报 success，屏幕仍 1320×2856。
- 软键盘：点击文本域只出现文本选择工具条，无软键盘；无法验证遮挡。
- 读屏：系统确认“开启 (7 秒)”，未替用户接受。
- 缓存失败注入：沙箱拒绝改 `protected-photos`，无法安全制造写失败；中文文案仅有开发测试证据。

## 10. 命令、证据与恢复

| 时间（本机） | 操作 | 结果 |
| --- | --- | --- |
| 10:54 | Hvigor assembleApp | 退出 0，23s238，[hvigor.log](../../../../evidence/stage8-engineer-combined/builds/hvigor.log) |
| 10:54:34 | 签名 | 退出 0，签名 SHA `414be590…`，[signing.log](../../../../evidence/stage8-engineer-combined/builds/signing.log) |
| 10:54 | 安装/启动 | `install_exit=0`、`start_exit=0` |
| 11:08—11:41 | 字号标准→特大→0.85→标准，热/冷启动、逐页检查 | `1.45`/`1`，见第3节 |
| 11:44—11:47 | 预警确认/排查/恢复/关闭 | rev1→5，审计48→55，回执42→48 |
| 11:47—12:05 | 任务到点/清单/完成；问题→工单→验收→复查 | task rev3 checked；issue rev5 closed；order rev5 verified |
| 12:05—12:20 | 备份、18013 恢复核对、18010 重启 | 40表/4媒体一致；PID 49636 |
| 12:20—12:40 | 500点压力库统计三页/筛选/性能 | 57/46/5006，47非零，3页 |
| 12:28 | 恢复 App 18090/safety、标准字号 | 3测点/0未关闭；`fontScale=1` |

- 原始页面：`page/` 下每目录含 layout/screen/ids；证据 JSON 在 `verification/`；Web 读取截图 `page/web-issues.png`、`page/web-inspection.png`。
- 临时服务：18012/18013/5184 已停止，18092 映射已移除；18010/18011 保留，18090→18011 保留。
- 备份目录 `backend/.runtime-stage8-finish/backup-combined` 与压力库 `backend/.runtime-stage8-stress` 未提交，供复核。
- 隔离库测试数据变更：crack 点绑定模拟标签 `TAG-UNIFIED-CRACK`（rev1→2）；创建 2 个巡检计划/任务（`TK-20261030-001` checked、`TK-20261030-002` pending）；问题转维修生成 `WO-20261030-001`，另有关闭事件 `E20261029-002`。均在 `backend/.runtime-stage8-finish`，未写交付库。
- 未修改业务代码、Web 视觉改动或 AI；新增仅为证据脚本与报告。App 已恢复 18090/safety、标准字号、读屏关闭。

## 11. 建议

**待补证据。** 本轮未发现 P0/P1；两个历史 P1 已关闭，新增大字号布局、就地反馈、动作隔离、统计分页、安静模式在模拟器实际通过。仍需补齐：

1. 真实 App 横屏/宽窗截图与布局检查（当前模拟器旋转命令无效）。
2. 软键盘出现时的遮挡/提交可达验证（当前模拟器只显示文本选择工具条）。
3. 真实读屏的可访问名称/顺序/状态播报（需用户本机确认开启）。
4. Web 表单实际验收/复查点击（本轮为同源命令+Web 只读核对）。
5. 真机安装/拍照/相册/实录（用户无真机，继续单列未验证）。
6. 照片缓存失败注入的中文提示（沙箱限制，仅开发证据）。

以上补齐后再由负责人裁定阶段7A/8；本轮不进入阶段9。
