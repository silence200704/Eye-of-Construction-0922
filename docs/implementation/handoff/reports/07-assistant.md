# 阶段 7 返修完成度报告：小瞳业务问答、知识解释、证据与会话

## 基本信息

- 阶段：7 / 小瞳业务问答、知识解释、证据与会话；状态：**返修完成，待复审**，不进入阶段 8。
- 审核依据：`07-assistant-review.md`、`prompts/07-assistant-fix.md`；基线 `c02a82b`。
- 修复 HEAD：`76f78a1`（代码与测试）；本报告与证据随后续文档提交。
- 迁移：新增 `0013_assistant_session_epoch`，未改写 0001—0012；空库升级、备份恢复与交付卷升级均通过。
- 环境：Windows 10.0.26100、Docker Desktop、SQLite WAL；交付 `18000/8080`，查寝 `8000/5173` 未停止未修改。
- 验证库：`backend/.runtime-stage7-fix`（独立空库，datasetEpoch 1→2）；未清空交付库或 Docker 卷。

## 结论摘要

- 审核列出的 R1—R10 均有代码、自动化用例、真实 HTTP 响应与数据库/媒体后置条件，关闭表见第 3 节。
- 独立库业务/多轮题从 30 条扩到 **44 条，44/44 通过**；每题的意图、对象 ID、关键事实、检查项与
  回答原文在 `verification/questions.json`，逐题表在 `per-question.md`。
- 20 条标准 FAQ 两路 **20/20（检索）与 20/20（助手）**；冻结 60 题两路均为 **57/60**，
  失败仍是 accept-9/25/36（阶段 6 已知），未改冻结答案、未逐题硬编码。
- 全量回归：后端 **254 passed**，前端 **1160 passed / 120 files**，Ruff、typecheck、build、tooling 与结构门禁通过。
- 严格断外网：隔离进程拒绝非 loopback 出站，业务 44/44、FAQ 20/20、冻结 57/60 均完成，出站尝试 0 条。
- 容器按修复 HEAD 重建：迁移到 0013、API healthy、业务表计数不变、10 个媒体文件 SHA-256 全同；
  18000/8080 与 8000/5173 并存。
- 自评：S7-01—S7-10 均有实现与证据；复审结论仍由审核人给出。

## 3. R1—R10 关闭表

| 编号 | 缺陷 | 代码与测试 | 真实响应/后置条件 | 未完成项 |
| --- | --- | --- | --- | --- |
| R1 范围隔离 | 空楼栋身份读范围外影像元数据/案例；收回权限旧会话仍返回正文 | `c72c512`：帧/比对/视频/摘要逐项授权、案例按楼栋过滤；`test_review_boundaries.py` 空范围；`test_video_session.py` 视频范围 | q17/q18/q26/q39：空范围列表为空；收回后旧轮 `historical=true`、事实/正文/对象 ID 不返回；显式失效对象 404 | 无 |
| R2 写保护 | 重复轮次/帧/比对、旧 epoch 被接受、无审计回执 | `c72c512`：四个 POST 全部走 `execute_command`，审计与回执同事务；幂等/冲突/epoch/回滚测试 | q38：同键同内容同 `turnId` 且轮数不增；同键异内容 409；epoch 999 帧写入 409 且帧数不变；回滚测试审计/回执不增 | 无 |
| R3 会话边界 | 权限收回、epoch 变化、显式无效 sessionId | `c72c512`：会话 `epoch` 列/0013、`_owned_session`、逐轮 `_turn_visible/_redacted`；前端存储键含 epoch | q39 脱敏；q42 旧会话 410 `STALE_SESSION`、新会话 epoch 2；显式无效 sessionId 404，不静默回退 | 无 |
| R4 对象/DTO | B99 答 B03、候选 422、问题/工单 ID 丢失 | `c72c512` 楼栋+楼层+指标交集；`c005a1a` 原问句候选点击；`76f78a1` 明确 `chosen` 信号；后端/前端契约测试 | q31 回答 B06 测点；q32 不存在楼层 not_found；q33 同点第二条问题绑定正确；q34 事件/工单上下文保留；q35 原问句点候选后 answered | 无 |
| R5 迟到响应 | 切页/切身份/清空后旧响应回填 | `803db20`：generation/actor/epoch/存储键校验，`restoreRun` 保护，媒体迟到失效；8 项审查用例转 GREEN | `stage7-fix/red-web.log` 为修复前失败；修复后 8/8 通过；全量 1160 通过 | 无 |
| R6 知识入口 | FAQ 检索 20/20、助手仅 9/20 | `b964206` 强知识路由；`8134451` 无对象线索时概念问题交给知识，显式无效对象仍失败 | FAQ 20/20 两路；60 题 57/57；`accept-9/25/36` 保留失败 | 冻结 3 题仍错（不追 60/60） |
| R7 权威判定 | 试算默认阈值/原等级错误；停用规则回退旧版 | `b964206`：复用阶段 4 `rule_for_point`/`assess_record`；`datasets/trials.py`；停用不回退；`0.15` 解析 | q36 停用后“未判定”、`snapshot.rules=[]`；恢复启用后 V1.2；q37 用现行引擎算 5 条、1 条变化、不写库；q37b 缺候选先澄清 | 试算只支持明确候选句式 |
| R8 媒体全流程 | 视频抽帧未入保存链、模拟来源丢失 | `b964206` + `f479e59`：视频原字节/元数据/分析落库，帧 `videoId/timeCode`，来源贯通 | q40 视频/分析/帧/原字节与来源；`restore-after-restart.json` 与 `backup-restore.json` 重启/恢复后 SHA 与关系一致 | 视频分析是预设区域统计，不是真实 CV |
| R9 事实版本 | 缺少查询时刻/行 rev/recordRevision | `b964206`：`snapshot` DTO；历史回答不重算 | q41 旧轮保留 0.95、新轮 0.99；快照含 `rev` 与 `recordRevision` | 无 |
| R10 门禁/格式 | 超长函数、参数、目录与格式问题 | `f479e59`/`8134451`：`answer/`、`cases_fix/`、`tools/` 分层；DTO 参数收敛 | Ruff 244 文件 check/format 通过；结构门禁 2/2；后端 254、前端 1160 | 无 |

## 4. 业务与多轮题

- 44 题覆盖：显式测点/趋势、事件原因/回放/恢复、问题与工单、概况、知识、无依据、注入、
  范围受限、跨身份会话、缺候选澄清、停用规则、0.15 试算、真候选点击、同点多问题、
  旧 epoch、幂等、权限收回、视频、历史快照、刷新只读。
- 关键结果：q31 B06→B06；q32 不存在楼层→not_found；q33 同点第二条问题 ID 正确；
  q35 原问句 `chosen` 点选后 answered；q38 冲突/旧 epoch 均 409；q39 脱敏且不含对象 ID；
  q40 视频/帧/分析/字节；q41 旧值不漂移；q42 旧会话 410、新会话 epoch 2。
- 逐题文件：`verification/questions.json`、`per-question.md`；本报告不汇总掩盖错对象，对象 ID 逐题保留。

## 5. 知识两路

| 数据 | 检索 | 助手 | 说明 |
| --- | --- | --- | --- |
| 20 条标准 FAQ | 20/20 | 20/20 | 修复前助手仅 9/20 |
| 冻结 60 题 | 57/60 | 57/60 | SHA/期望答案未改；失败 accept-9/25/36 与阶段 6 一致 |

- 逐题：`verification/knowledge-paths.json`、`knowledge-paths.md`。
- 冻结题问句与期望来自 `backend/resources/knowledge/acceptance.json`，未改一题一答；助手回答与检索
  同源，未硬编码。

## 6. 页面与视口

- 宽屏 1440×900、窄屏 390×844 实际设置视口；截图与 DOM 快照在 `evidence/stage7-assistant/page/`。
- 已实测：候选、知识引用展开、趋势深链、双点比较、影像/视频、事件详情、问题/工单详情、
  试算、回放、窄屏返回与刷新只读。
- 交付库没有问题/工单/视频业务数据，因此这些深链在 4180 隔离验收实例录制；交付库的首页、
  候选、趋势、影像、刷新在 8080 录制。隔离实例不是故障，也不修改交付库。
- 说明：候选点击现在发送 `chosen=true`，服务端仅在 ID 属于本轮候选时采用。

## 7. 断外网与恢复

- `verification/offline-process.json`：独立 API 进程用 `sitecustomize` 拒绝非 loopback
  `connect/connect_ex/getaddrinfo`；业务 44/44、FAQ 20/20、冻结 57/60、媒体 4 文件可读，
  出站日志为空；另起进程连接 `example.com` 被拒绝，证明闸门有效。
- `restore-after-restart.json`：同一验证库重启 API 后，会话、epoch 2、视频字节、分析、帧来源、
  比对全部恢复；旧 epoch 会话仍 410。
- `backup-restore.json`：备份清单 40+ 表与 14 个文件逐一 SHA 一致，8 个模型文件恢复；
  恢复后登录新增 1 条 `login_sessions`（验证客户端登录），业务表与媒体无差异。
- `container-rebuild.json`：重建前后业务表计数无差异、10 个媒体 SHA 全同、head 0013；
  18000/8080/8000/5173 均返回预期状态。

## 8. 自动化与门禁

| 命令 | 结果 |
| --- | --- |
| `python -m pytest -q` | 254 passed |
| `ruff check .` / `ruff format --check .` | 通过 / 244 files formatted |
| `npm test -- --run` | 120 files / 1160 passed |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过（保留既有 chunk 体积警告） |
| `npm run test:tooling` | 5 passed |
| 结构门禁 | 2 passed；函数 ≤80 行、参数 ≤5、文件/目录预算通过 |

## 9. 限制与未完成

1. 冻结 60 题仍有 3 条阶段 6 已知错答（accept-9/25/36），不宣称 60/60。
2. 试算要求明确候选阈值（如“黄色阈值改为0.15”）；`0.1/0.2/0.3` 组合会要求澄清，不用默认值兜底。
3. 视频分析是前端预设区域/像素统计，不是真实视觉识别，不给毫米数、不进预警链。
4. 交付库缺少问题/工单/视频数据，相关深链页面证据来自隔离实例；交付库冒烟会话按裁定保留，
   阶段 10 统一复位。
5. 0013 升级后旧交付会话 `epoch=0`，读取会 410；数据行未删除，复审时属预期。
6. 本阶段未做 OpenHarmony App、Flutter、离线同步或舞台统一控制。

## 10. 提交材料

- 代码：`80f1f6e`、`3072725`、`7e30e31`、`c68174c`、`c72c512`、`803db20`、`b964206`、
  `f479e59`、`8134451`、`c005a1a`、`76f78a1`。
- 契约：`docs/implementation/contracts/assistant-v1.md`。
- 证据：`docs/implementation/evidence/stage7-assistant/`
  - `verification/{questions.json,per-question.md,knowledge-paths.json,knowledge-paths.md,restore-after-restart.json,backup-restore.json,offline-process.json,container-rebuild.json}`
  - `page/interaction-evidence.md` 与宽窄屏 `.txt/.png`
  - `runtime/http-smoke.json`；原审核失败证据仍保留在 `evidence/stage7-review/`。
- 阶段状态保持“待审核”；复审通过前不进入阶段 8。
