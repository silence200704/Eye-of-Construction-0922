# 阶段 7 完成度报告：小瞳业务问答、知识解释、证据与会话

## 基本信息

- 阶段编号/名称：7 / 小瞳业务问答、知识解释、证据与会话
- 对照计划：`docs/implementation/handoff/stages/07-assistant.md` S7-01—S7-10
- 代码分支与提交：`codex/fullstack-competition`
  - 后端：`f3a2e8b` feat: add server-side assistant facts, knowledge and sessions
  - Web：`191497c` feat: connect xiaotong web to server answers, sessions and media
  - 补充测试：`42bed60` test: cover dataset epoch invalidation
  - 文档与证据：本轮文档提交（含本报告与 `evidence/stage7-assistant/`）
- 报告日期：2026-10-23；Windows 10.0.26100，Docker Desktop，SQLite WAL
- 启动方式：`docker compose -f deploy/compose.yaml up --build -d`
  - Web `http://127.0.0.1:8080`，API `http://127.0.0.1:18000`，开发页 `http://127.0.0.1:5180`
  - 查寝 8000/5173 未停止、未修改；本轮实测 8000/5173 均 200
- 数据集：`demo-main`；验证库 datasetEpoch 起始 1；Alembic head `0012_assistant_sessions`
- 本轮摘要：新增服务端小瞳解析/对象解析/业务事实/知识引用/会话与轮次/影像会话；Web 在服务端模式下
  改读服务端回答，保留原有视觉、趋势、比较、试算、回放与导览编排；冻结 30 条业务/多轮题，30/30
  关键事实、对象绑定与引用检查通过；阶段 6 的 60 条知识题重跑仍为 57/60（未改 3 条错答，不称 60/60）。
- 自评：验证通过 9 / 必验 10；已实现未验证 1（S7-06 小屏交互证据与视频/双点页面级证据）；失败 0；未实现 0。
  （限制见文末：小屏交互证据、阶段 6 三条既有错答、试算问法仅支持契约句式。）

## 逐项完成情况

| 验收编号 | 四态结果 | 实现/证据 | 测试或复现 | 差距 |
| --- | --- | --- | --- | --- |
| S7-01 | 验证通过 | `operations/assistant/{parse,resolve,facts,facts_more,facts_extras,compose}.py`；`sources.facts=server_db`+`queriedAt`+对象 ID | 30 题逐题快照；容器冒烟 `runtime/http-smoke.json`；`tests/assistant/test_facts.py` | 无 |
| S7-02 | 验证通过 | `knowledge_answers.py`；`GET /knowledge/documents/{id}` 引用查看；无依据/澄清分支 | 阶段 6 acceptance 重跑 57/60、引用有效率 100%；q14/q15；页面引用展开 `page/knowledge-citation.txt` | 阶段 6 既有 3 题仍错，保留记录 |
| S7-03 | 验证通过 | 解析优先级（显式编号 > 显式线索 > 上下文）；同名候选 | 30 题全部通过，见 `verification/questions.json`、`per-question.md`；q11 多候选 | 无 |
| S7-04 | 验证通过 | `resolve._apply_context`、会话按身份/数据集、`epochVersion` 清空、迟到响应 generation | q03/q17/q18/q20/q30；`serverMode.test.ts` 5 项（含迟到、身份/epoch） | 数据集复位用 epoch 事件单测，未在交付库做破坏性复位 |
| S7-05 | 验证通过 | 服务端 links 白名单；`remote/answer.ts` 映射；3D 链接补楼栋/楼层 | 页面点击「监测趋势」→`#/trend?point=pnt_b03_f2_crack01`；返回后无面板/遮挡 `page/deep-link.txt` | 3D/影像页仅链接级与恢复级验证 |
| S7-06 | 已实现未验证 | 复用原视觉/趋势/试算/回放；媒体会话正式读写 | `page/visual-evidence.txt`、`trend` 页、`page/trial.txt`、`page/replay.txt`、`page/media-restore.txt`；相关前端用例全绿 | 视频/双点比较仅自动化回归；浏览器无视口切换能力，小屏证据缺失；因此不标验证通过 |
| S7-07 | 验证通过 | 0012 迁移；会话/轮次同事务；媒体帧/比对持久化；受保护内容接口 | 刷新恢复 `page/session-restore.txt`；媒体恢复 `page/media-restore.txt`；备份恢复 `runtime/backup-restore.json`（2 会话/27 轮/2 帧/1 比对） | 恢复为只读，未重放写入/媒体处理 |
| S7-08 | 验证通过 | 小瞳不提供写入动作；`demo_command` 拒绝并只导航设置/工作台 | q16/q21/q27 前后快照一致；写入请求无副作用 | 本阶段没有需要接入的助手准备/办理命令；准备仍只在系统设置/工作台由真实命令执行 |
| S7-09 | 验证通过 | 身份/楼栋/数据集隔离；注入只当数据；引用只读 | q16/q17/q18/q20；`test_context.py` 注入与范围；页面切身份提示 | 无 |
| S7-10 | 验证通过 | 本地检索/模板；无外部模型；API 断开明确失败 | `runtime/offline-and-api-down.json`（代理黑洞下 3 问 200）；241 后端/1152 前端/5 tooling | 断外网以代理阻断模拟，未物理拔网 |

## 接口与数据库

- 契约：[assistant-v1.md](../contracts/assistant-v1.md)
- 新增：`POST /assistant/query`、`GET /assistant/sessions`、`GET /assistant/sessions/{id}`、
  `GET/POST /media-sessions/frames`、`GET/POST /media-sessions/comparisons`、`GET /media-sessions/summary`。
- 身份与范围：会话按 `dataset_id+actor_id` 隔离；跨身份读会话 404（q20）；范围受限身份看不到 B06
  （q17），概况只统计授权楼栋（q18）。
- 会话写入：`assistant_sessions`/`assistant_turns` 与回答同事务；q19 读取首轮对象 ID 一致。
- 迁移：0012 追加，不改写 0001—0011；空库升级与备份恢复通过；Docker `alembic_version=0012_assistant_sessions`。
- 媒体：原字节上传后登记关键帧；帧输出含来源/文件名/大小/宽高/受保护 contentUrl；跨测点登记与跨测点
  比对返回 409；内容接口按身份返回原字节（q26）。
- 备份恢复：`runtime/backup-restore.json` 记录 40 张表逐表哈希一致、模型/文件校验通过；
  assistant 2 会话/27 轮、media 2 文件/2 帧/1 比对均恢复。

## 自动化验证

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `python -m pytest -q` | 241 passed | 阶段 1—7；新增 21 项小瞳/会话/媒体 |
| `ruff check src tests migrations scripts` + `ruff format` | 通过 | 后端全量 |
| `npm test -- --run` | 118 文件 / 1152 passed | 前端全量，含映射/服务端会话/迟到/epoch |
| `npm run typecheck` | 通过 | vue-tsc |
| `npm run build` | 通过 | 交付包（保留既有 chunk 体积警告） |
| `npm run test:tooling` | 5 passed | 预览器 4 项 + 阶段 5—7 结构门禁 |
| 结构门禁 | 通过 | 新增/修改 TS/Vue 函数 ≤80 行、参数 ≤5、文件 ≤450 行 |

新增测试覆盖的风险：对象优先级（问句新对象覆盖旧上下文）、同名澄清、范围隔离、会话跨身份 404、
迟到响应丢弃、epoch 变化清空、知识引用版本/哈希、媒体跨测点拒绝、无依据不编造、写入无副作用。

## 真实操作证据

- 30 条业务/多轮题：独立空库 + 固定前置（B05/B06、规则/基准、5 条记录、问题/工单、2 篇知识、2 帧/1 比对），
  30/30 通过；逐题对象 ID、关键事实与引用见 `verification/questions.json`、`per-question.md`。
- 阶段 6 回归：同一 `acceptance.json`（SHA-256 未变）重跑 57/60；失败仍是 accept-9/25/36，
  与阶段 6 一致；`citationsValid=true`。
- 容器冒烟：安全身份 6 问（业务 4、知识 1、写入 1）200；会话 34 轮可读；写请求无事实、只给设置入口。
- 页面（交付 8080，DOM 文本证据，未伪造截图）：
  - 业务问答：事实、证据、来源、导航、追问齐全；来源明确“服务端数据库本次查询”。
  - 知识问答：结论、知识依据、版本/行号与“查看引用”展开原文分开显示；业务事实显示“没有可绑定业务数据”。
  - 刷新恢复：显示“已恢复上次小瞳会话（只读；不会重放写入、影像处理或自动导览）”。
  - 影像页：2 帧从受保护内容接口恢复，显示服务端保存说明与 1 次比对记录。
  - 视觉证据：还原 2 帧后给出当前读数、事件峰值、趋势与照片对；明确“关键帧已保存到服务端”。
  - 试算/回放：候选阈值表 4 条、不写库；回放 9 个节点；深链跳转与返回无面板遮挡。
- 断外网：`HTTP(S)_PROXY=http://127.0.0.1:9` 下业务/知识/队列 3 问均 200；无外部模型调用。
- API 断开：连接 18009 明确 `ConnectError`；前端单测断言显示“无法读取服务端小瞳回答”，不补造。
- 端口共存：8000/5173 查寝 200；18000/8080 筑瞳正常；5180 开发页 200。

## 回归与限制

- 已回归：阶段 4—6 后端全量、Web 全量、媒体/知识/报表/现场任务相关用例；Docker 重建后迁移 0012。
- 仍使用本地 IndexedDB 的功能：仅纯前端演示模式（`VITE_BACKEND_ENABLED=false`）；服务端模式下小瞳业务事实
  不读 IndexedDB。视觉/视频/双点比较的算法在前端执行，但其数据源为服务端加载的档案、记录与会话媒体。
- 已知问题：
  1. 阶段 6 冻结 60 题中 accept-9/25/36 仍为错答（no_basis/clarify），本阶段未改答案；不得宣称 60/60。
  2. 试算自由问法只支持契约句式（如“试算黄色阈值改为0.15毫米…”）；“0.1/0.2/0.3 试算”会提示补充阈值，
     不编造结果。
  3. 小屏/窄屏交互未出证据：当前浏览器能力无视口切换，未伪造截图；宽屏 1280×720 DOM 证据已保留。
  4. 视频比较与双点比较未出页面级证据，仅自动化回归通过与既有页面入口保留。
  5. 交付库 `demo-main` 增加了本轮冒烟会话（助手会话/轮次，不含业务数据变更）；如需干净演示库可由
     系统设置或阶段 10 复位统一处理，本轮未清空业务数据或 Docker 卷。
- 未完成/下一阶段前置：不进入阶段 8；Flutter、离线同步与舞台统一控制未实施。

## 提交审核材料

- 代码：`f3a2e8b`、`191497c`、`42bed60`；文档与证据见本轮文档提交。
- 契约：`docs/implementation/contracts/assistant-v1.md`
- 证据目录：`docs/implementation/evidence/stage7-assistant/`
  - `verification/questions.json`、`per-question.md`、`stage6-acceptance-regression.json`
  - `runtime/http-smoke.json`、`backup-restore.json`、`offline-and-api-down.json`
  - `page/{session-restore,business-answer,knowledge-citation,media-restore,visual-evidence,trial,replay,deep-link}.txt`
- 需要重点审核：S7-08 的“无助手写入命令”口径是否符合预期；视觉/视频算法在前端执行是否满足“来源与
  模拟性质如实展示”；30 题前置是否足以代表业务/多轮覆盖面。

阶段状态保持“待审核”，未更新为通过；审核通过前不进入阶段 8。
