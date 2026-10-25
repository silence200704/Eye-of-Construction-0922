# 阶段 7 返修完成度报告：小瞳业务问答、知识解释、证据与会话

## 基本信息

- 阶段：7 / 小瞳业务问答、知识解释、证据与会话；状态：**复审返修完成，保持待审核**，不进入阶段 8。
- 审核依据：`reports/stage7/02-rereview.md`、`prompts/07-assistant-rereview-fix.md`；
  上一轮基线 `76f78a1`（代码）/`1e6c8a5`（文档）。
- 本轮修复 HEAD：`2579f1f`（代码与测试）；本报告与证据随后续文档提交。
- 迁移：`0013_assistant_session_epoch`，未改写 0001—0012；空库升级、备份恢复与交付卷升级通过。
- 环境：Windows 10.0.26100、Docker Desktop、SQLite WAL；筑瞳交付 `18000/8080` 可用。
  本轮开始时查寝 `8000/5173` 连接拒绝；没有启动、停止或修改它，也不声称并存健康。
- 验证库：`backend/.runtime-stage7-fix`（独立空库，datasetEpoch 1→2）；未清空交付库或 Docker 卷。

## 结论摘要

- 复审 RR1—RR7 均有代码、稳定回归与真实响应，关闭表见第 3 节。
- 独立库业务/多轮题 **44/44 通过**；新增复审边界另建后端 10 项、前端 5 项正式用例。
- 20 条标准 FAQ 两路 **20/20**；冻结 60 题两路 **57/60**，失败仍是 accept-9/25/36，未改题目或期望。
- 全量回归：后端 **264 passed、覆盖率 88.78%**，前端 **1165 passed / 122 files**；Ruff 247 文件、
  typecheck、build、tooling 5、结构门禁通过。
- 严格断外网：业务 44/44、FAQ 20/20、冻结 57/60 完成，出站尝试 0 条。
- 容器按 `2579f1f` 重建：迁移 0013、API healthy、业务表计数不变、10 个媒体 SHA 全同。
- 宽屏 1440×900、窄屏 390×844 的真实截图与 DOM 快照已补；视频恢复页面显示 3 帧与区域结果。
- 自评：RR1—RR7 已关闭；S7-01—S7-10 仍有实现与证据；最终结论由复审给出。

## 3. 复审 RR1—RR7 关闭表

| 编号 | 复审发现 | 修复与测试 | 真实响应/后置条件 | 未完成 |
| --- | --- | --- | --- | --- |
| RR1 重放绕过权限 | 旧 Idempotency-Key 仍返回原读数/对象 | `2579f1f`：助手重放按当前会话可见性脱敏；媒体重放按当前测点授权 404 | 后端 `test_scope_replay.py`：范围收回、角色收窄、对象归档后重放无正文；轮次/审计/回执不增；probes `replayed` 为 `historical=true` | 无 |
| RR2 恢复竞态/缓存 | 首次 restore、视频字节下载、同 id 范围收窄 | `2579f1f`：恢复捕获 actor/dataset/epoch/角色/楼栋/generation，空状态也失效；每个 await 后复核；媒体 scope watch | 前端 5 项正式用例：首次恢复切身份、视频下载切身份、同 id 范围收窄清字节、分析延迟窗口、视频往返恢复全绿 | 无 |
| RR3 工单关系串问题 | 显式工单 + 旧问题上下文拼错 | `2579f1f`：显式工单先绑定自身问题/测点，再过滤上下文；显式冲突返回失败 | `test_relations_knowledge.py`：工单回答绑定 A，旧 B 不出现在事实/对象；工单+另一个问题编号 not_found | 无 |
| RR4 视频分析恢复 | 本地 videoId 落库，刷新丢分析 | `2579f1f`：Web 等帧登记后整张映射；服务端校验 video/point/frame/region 引用 | 后端 `test_media_analysis.py` 覆盖外帧/本地 ID/归档重放；前端往返与延迟上传用例；页面 `wide-video-restore.txt` 显示 3 帧与“疑似变化 12.0%” | 视频算法仍是预设统计 |
| RR5 空范围概况 | 无测点问题/工单污染；GET /issues 旁路 | `2579f1f`：问题按楼栋、工单按关联问题授权；GET /issues 同一边界 | probes `0/0/0`，GET /issues 返回 `[]`；`test_scope_replay.py` 覆盖 | 其他未复验旧列表另行跟踪 |
| RR6 记录截断 | 只聚合前 20 个测点 | `2579f1f`：全授权集合求和；空档案楼按授权计入楼栋 | probes 22/22；测试 23 点 22 记录、空楼栋计数 | 无 |
| RR7 检索异常 500 | `_knowledge=None` 时 `.get` 崩溃 | `2579f1f`：空值先判；业务失败保留、知识题 unavailable | probes B99 返回 200 `not_found`；有效测点仍读事实；知识题 `decision=unavailable` | 无 |

## 4. 原 R1—R10 关闭状态

| 编号 | 缺陷 | 代码与测试 | 真实响应/后置条件 | 未完成项 |
| --- | --- | --- | --- | --- |
| R1 范围隔离 | 空楼栋身份读范围外影像元数据/案例；收回权限旧会话仍返回正文 | `c72c512`：帧/比对/视频/摘要逐项授权、案例按楼栋过滤；`test_review_boundaries.py` 空范围；`test_video_session.py` 视频范围 | q17/q18/q26/q39：空范围列表为空；收回后旧轮 `historical=true`、事实/正文/对象 ID 不返回；显式失效对象 404 | 无 |
| R2 写保护 | 重复轮次/帧/比对、旧 epoch 被接受、无审计回执 | `c72c512`：四个 POST 全部走 `execute_command`，审计与回执同事务；幂等/冲突/epoch/回滚测试 | q38：同键同内容同 `turnId` 且轮数不增；同键异内容 409；epoch 999 帧写入 409 且帧数不变；回滚测试审计/回执不增 | 无 |
| R3 会话边界 | 权限收回、epoch 变化、显式无效 sessionId | `c72c512`：会话 `epoch` 列/0013、`_owned_session`、逐轮 `_turn_visible/_redacted`；前端存储键含 epoch | q39 脱敏；q42 旧会话 410 `STALE_SESSION`、新会话 epoch 2；显式无效 sessionId 404，不静默回退 | 无 |
| R4 对象/DTO | B99 答 B03、候选 422、问题/工单 ID 丢失 | `c72c512` 楼栋+楼层+指标交集；`c005a1a` 原问句候选点击；`76f78a1` 明确 `chosen` 信号；后端/前端契约测试 | q31 回答 B06 测点；q32 不存在楼层 not_found；q33 同点第二条问题绑定正确；q34 事件/工单上下文保留；q35 原问句点候选后 answered | 无 |
| R5 迟到响应 | 切页/切身份/清空后旧响应回填 | `803db20`：generation/actor/epoch/存储键校验，`restoreRun` 保护，媒体迟到失效；8 项审查用例转 GREEN | `stage7-fix/red-web.log` 为修复前失败；修复后 8/8 通过；全量 1165 通过 | 无 |
| R6 知识入口 | FAQ 检索 20/20、助手仅 9/20 | `b964206` 强知识路由；`8134451` 无对象线索时概念问题交给知识，显式无效对象仍失败 | FAQ 20/20 两路；60 题 57/57；`accept-9/25/36` 保留失败 | 冻结 3 题仍错（不追 60/60） |
| R7 权威判定 | 试算默认阈值/原等级错误；停用规则回退旧版 | `b964206`：复用阶段 4 `rule_for_point`/`assess_record`；`datasets/trials.py`；停用不回退；`0.15` 解析 | q36 停用后“未判定”、`snapshot.rules=[]`；恢复启用后 V1.2；q37 用现行引擎算 5 条、1 条变化、不写库；q37b 缺候选先澄清 | 试算只支持明确候选句式 |
| R8 媒体全流程 | 视频抽帧未入保存链、模拟来源丢失 | `b964206` + `f479e59`：视频原字节/元数据/分析落库，帧 `videoId/timeCode`，来源贯通 | q40 视频/分析/帧/原字节与来源；`restore-after-restart.json` 与 `backup-restore.json` 重启/恢复后 SHA 与关系一致 | 视频分析是预设区域统计，不是真实 CV |
| R9 事实版本 | 缺少查询时刻/行 rev/recordRevision | `b964206`：`snapshot` DTO；历史回答不重算 | q41 旧轮保留 0.95、新轮 0.99；快照含 `rev` 与 `recordRevision` | 无 |
| R10 门禁/格式 | 超长函数、参数、目录与格式问题 | `f479e59`/`8134451`：`answer/`、`cases_fix/`、`tools/` 分层；DTO 参数收敛 | Ruff 247 文件 check/format 通过；结构门禁 2/2；后端 264、前端 1165 | 无 |

## 5. 业务与多轮题

- 44 题覆盖：显式测点/趋势、事件原因/回放/恢复、问题与工单、概况、知识、无依据、注入、
  范围受限、跨身份会话、缺候选澄清、停用规则、0.15 试算、真候选点击、同点多问题、
  旧 epoch、幂等、权限收回、视频、历史快照、刷新只读。
- 关键结果：q31 B06→B06；q32 不存在楼层→not_found；q33 同点第二条问题 ID 正确；
  q35 原问句 `chosen` 点选后 answered；q38 冲突/旧 epoch 均 409；q39 脱敏且不含对象 ID；
  q40 视频/帧/分析/字节；q41 旧值不漂移；q42 旧会话 410、新会话 epoch 2。
- 逐题文件：`verification/questions.json`、`per-question.md`；本报告不汇总掩盖错对象，对象 ID 逐题保留。

## 6. 知识两路

| 数据 | 检索 | 助手 | 说明 |
| --- | --- | --- | --- |
| 20 条标准 FAQ | 20/20 | 20/20 | 修复前助手仅 9/20 |
| 冻结 60 题 | 57/60 | 57/60 | SHA/期望答案未改；失败 accept-9/25/36 与阶段 6 一致 |

- 逐题：`verification/knowledge-paths.json`、`knowledge-paths.md`。
- 冻结题问句与期望来自 `backend/resources/knowledge/acceptance.json`，未改一题一答；助手回答与检索
  同源，未硬编码。

## 7. 页面与视口

- 宽屏 1440×900、窄屏 390×844 实际设置视口；截图与 DOM 快照在 `evidence/stage7-assistant/page/`。
- 已实测：候选、知识引用展开、趋势深链、双点比较、影像/视频、事件详情、问题/工单详情、
  试算、回放、窄屏返回与刷新只读；窄屏另补知识引用、试算、回放、工单关联问题四组状态。
- RR4 页面证据：`wide-video-restore.txt/.png` 显示服务端恢复的 3 帧（3/6/9 秒）与区域结论
  “疑似变化 12.0% 差异像素”；刷新只读，不重放抽帧或分析。
- `wide-assistant.png` 已重拍为面板实际展开状态；旧截图不作为证据。
- 交付库没有问题/工单/视频业务数据，因此这些深链在 4180 隔离验收实例录制；交付库的首页、
  候选、趋势、影像、刷新在 8080 录制。隔离实例不是故障，也不修改交付库。
- 说明：候选点击现在发送 `chosen=true`，服务端仅在 ID 属于本轮候选时采用。

## 8. 断外网与恢复

- `verification/offline-process.json`：独立 API 进程用 `sitecustomize` 拒绝非 loopback
  `connect/connect_ex/getaddrinfo`；业务 44/44、FAQ 20/20、冻结 57/60、媒体 4 文件可读，
  出站日志为空；另起进程连接 `example.com` 被拒绝，证明闸门有效。
- `restore-after-restart.json`：同一验证库重启 API 后，会话、epoch 2、视频字节、分析、帧来源、
  比对全部恢复；旧 epoch 会话仍 410。
- `backup-restore.json`：备份清单 40+ 表与 14 个文件逐一 SHA 一致，8 个模型文件恢复；
  恢复后登录新增 1 条 `login_sessions`（验证客户端登录），业务表与媒体无差异。
- `container-rebuild.json`：重建前后业务表计数无差异、10 个媒体 SHA 全同、head 0013；
  18000 API healthy、8080 返回 200。查寝 8000/5173 本轮探测连接拒绝，未由本轮停止或启动，
  因此不写“并存已复验”。

## 9. 自动化与门禁

| 命令 | 结果 |
| --- | --- |
| `python -m pytest -q` | 264 passed；覆盖率 88.78% |
| `ruff check .` / `ruff format --check .` | 通过 / 247 files formatted |
| `npm test -- --run` | 122 files / 1165 passed |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过（保留既有 chunk 体积警告） |
| `npm run test:tooling` | 5 passed |
| 结构门禁 | 2 passed；函数 ≤80 行、参数 ≤5、文件/目录预算通过 |

## 10. 限制与未完成

1. 冻结 60 题仍有 3 条阶段 6 已知错答（accept-9/25/36），不宣称 60/60。
2. 试算要求明确候选阈值（如“黄色阈值改为0.15”）；`0.1/0.2/0.3` 组合会要求澄清，不用默认值兜底。
3. 视频分析是前端预设区域/像素统计，不是真实视觉识别，不给毫米数、不进预警链。
4. 交付库缺少问题/工单/视频数据，相关深链页面证据来自隔离实例；交付库冒烟会话按裁定保留，
   阶段 10 统一复位。
5. 0013 升级后部分迁移前会话 `epoch=0`，读取会 410；当前 epoch 1 冒烟会话可用，旧行未删除，复审时属预期。
6. 复审轮开始时查寝 8000/5173 未运行；本轮未启动或停止其它项目，因此并存只保留历史记录，不宣称本轮复验。
7. 本阶段未做 OpenHarmony App、Flutter、离线同步或舞台统一控制。

## 11. 提交材料

- 代码：`80f1f6e`、`3072725`、`7e30e31`、`c68174c`、`c72c512`、`803db20`、`b964206`、
  `f479e59`、`8134451`、`c005a1a`、`76f78a1`、`2579f1f`。
- 契约：`docs/implementation/contracts/assistant-v1.md`。
- 复审证据：`docs/implementation/evidence/stage7-rereview/`（`checks.json`、`web-test.log`、
  `results-after-fix.json`）；本轮 4 个审查用例已迁入 `tests/assistant/session/rereviewRestore.test.ts`
  与 `tests/media/rereview/`，另补 10 项后端正式回归 `tests/rereview/`。
- 证据：`docs/implementation/evidence/stage7-assistant/`
  - `verification/{questions.json,per-question.md,knowledge-paths.json,knowledge-paths.md,restore-after-restart.json,backup-restore.json,offline-process.json,container-rebuild.json}`
  - `page/interaction-evidence.md` 与宽窄屏 `.txt/.png`
  - `runtime/http-smoke.json`；原审核失败证据仍保留在 `evidence/stage7-review/`。
- 阶段状态保持“待审核”；复审通过前不进入阶段 8。
