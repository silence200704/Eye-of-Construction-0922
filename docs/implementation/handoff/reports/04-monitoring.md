# 阶段 4 完成度报告：档案、监测与预警（第二轮定向返修后）

## 基本信息

- 阶段编号/名称：4 · 档案、监测、预警
- 对照计划版本或提交：`39173b3`（docs: define stages 4-11 implementation and evidence review gates）
- 本阶段代码分支、提交 SHA：`codex/fullstack-competition`
  - 首轮实现 `3975ecd`
  - 第一轮返修 `70bad45`
  - 第二轮定向返修 `20a3c25`（本报告与证据随后单独提交）
- 报告日期、测试系统、设备：2026-10-19；Windows 10.0.26100 x64；Docker Desktop（zhutong-api / zhutong-web）；Chrome 内核内置浏览器
- 启动方式、页面/API 地址：
  - Docker：`docker compose -f deploy/compose.yaml up -d migrate api web`
  - Web `http://127.0.0.1:8080`，API `http://127.0.0.1:18000`，本地开发 `http://127.0.0.1:5180`
- 数据集 ID、datasetEpoch、Alembic head：`demo-main`；epoch `1`；head `0009_monitoring_assessment`
- 本轮变更摘要：
  - 档案、基准、规则、监测记录、CSV、预警事件与通知使用服务端事务；统一身份、楼栋范围、幂等键、expectedRev、datasetEpoch 与同事务审计回执。
  - 服务端判定引擎与旧 TypeScript 引擎共用 24 条样例。
  - 追加迁移 `0009_monitoring_assessment`，记录保存规则版本、规则快照与判定结果。
  - 第二轮返修：当前记录修订可建单/升级/推翻恢复；已关闭事件历史修订不新建事件；规则按稳定标识先选当时版本再判范围/启停；结构门禁递归扫描；全部 Python 文件格式化。
- 自评完成度：第二轮返修并复验后，已验证通过 **12 / 12**；已实现未验证 0；失败 0；未实现 0。

## 第二轮审核问题返修对照

| 审核问题 | 修复 | 回归测试 |
| --- | --- | --- |
| 最新正常记录修订为红色未建单 | `revision_flow` 对“无开放事件、非关闭事件证据、当前有效记录”返回 `None`，由普通事件流程按业务条件建单 | `test_revision_latest_normal_to_red_creates_event`：assessment=red，action=created，1 事件 1 证据，before 保留 0.55 |
| recovering 时最新恢复记录修订为红色仍可关闭 | 当前记录修订走普通事件流程，`resume_from_recovery` 将状态退回 pending/handling，时间线留痕；关闭因非 recovering 返回 409 | `test_revision_latest_recovery_to_red_invalidates_recovery_pending`、`..._handling` |
| 已关闭事件历史修订无条件新建事件 | 先检查关闭事件活跃/被替代证据；命中则只更新记录，明确“历史修订只更新记录，不新建事件” | `test_revision_after_close_does_not_create_event`：事件数仍 1、状态 closed |
| 补录旧正常记录推翻当前异常 | 仅最新有效采样记录驱动事件；补录只存档并提示 | `test_backfill_cannot_enter_recovery`：状态 pending/red，证据 1 条 |
| 规则新版本排除原楼栋后回退旧版 | 每个稳定 `ruleId` 先按采样时间选当时版本，再判指标/楼栋/测点范围；不适用不回溯旧版 | 真实复验 G：V1.1 排除楼栋、V1.2 排除测点后当前 preview/record 均无规则；历史 -60 分钟仍 V1.0 |
| 规则新版本停用后回退旧版 | 同上；停用版本被选中后由引擎判 `excluded/规则未启用` | `test_disabled_latest_rule_version_is_not_bypassed`；Web 同名用例 |
| 独立规则被误删 | 按 ruleId 分组，只淘汰同一 ruleId 的旧版本；其他 ruleId 保留 | `test_independent_rule_still_selected`；Web `不同 ruleId 的独立规则仍各自保留` |
| apply.py 实际 499 行 | 拆出 `alarms/shared.py`、`alarms/revisions.py`；`apply.py` 实际 **313 行**（见下文扫描） | `test_structure.py` |
| 结构门禁未递归 | `test_structure.py` 递归扫描 domain、operations、routers 与 tests/monitoring 全部子目录；文件行数、函数、参数、目录直接文件数均检查 | 递归扫描 **0 处超限** |
| 格式检查失败 | `ruff format src tests migrations`，复跑 `--check` 通过 | 下方命令退出码 |

## 逐项完成情况

| 验收编号 | 四态结果 | 实现文件/提交 | 测试或复现步骤 | 证据路径 | 差距 |
| --- | --- | --- | --- | --- | --- |
| S4-01 | 验证通过 | `operations/datasets/archive.py`、`assets.py`、`routers/datasets/archive.py` | 真实建档 B99→改名→归档；错误楼层、坐标 1.2、重复 NFC、过期 rev 被拒；清空浏览器存储后读取一致 | `stage4-overview-server.png`；`api/test_archive.py` | 无 |
| S4-02 | 验证通过 | `versions.py`、`domain/monitoring/rules.py`、`src/core/rules.ts`、`0009` | 基准 v2、规则新版本；新记录引用新版本，旧记录不变；新版本排除楼栋/测点/停用均不回退；历史采样仍 V1.0；旧库 `recordRevision=0` | `stage4-recheck-round2.json` G；`test_rules_scope.py`；Web 规则版本用例 | 无 |
| S4-03 | 验证通过 | `domain/monitoring/*`、`tests/shared/assessment-samples.json` | 同一 JSON 驱动 TS/Python：17 条判定 + 7 条录入校验全绿 | `engineParity.test.ts`、`domain/test_engine.py` | 无 |
| S4-04 | 验证通过 | `records.py`、`alarms/revisions.py` | 最新正常→红色建单；recovering→最新恢复记录修订红色撤销恢复；关闭后历史修订不改建；补录只存档；原值/原因/替代证据保留 | `api/test_events.py`；`stage4-recheck-round2.json` A/B/D/E | 无 |
| S4-05 | 验证通过 | `csv.py`、`importer.py`、`ImportPanel.vue` | 真实 3 行 CSV：2 警告 1 错误，写 2 行；过期 token 409；第二行注入失败整批回滚；历史行不改变当前事件 | `api/test_csv.py` | 无 |
| S4-06 | 验证通过 | `core/workspace.py` `Command`；`client.ts` | 同键同内容重放；同键不同内容/跨通知 409；过期 rev/epoch 拒绝；修订重试不重复事件/通知/审计 | `api/test_scope.py`；`stage4-recheck-round2.json` F/I | 无 |
| S4-07 | 验证通过 | `domain/monitoring/events.py`、`alarms/apply.py`、`alarms/revisions.py` | 黄→橙→红单事件；恢复后新增红色或修订恢复记录为红色均退回 pending/handling，关闭 409；合法恢复+依据+无需维修才关闭 | `api/test_events.py`；真实复验 B/C | 无 |
| S4-08 | 验证通过 | `alarms/commands.py`、`stores/events.ts` | 9 条通知展示、2 条确认；超时一次升级；第二次核验 0；已关闭事件 3 条通知升级 0 | `api/test_events.py`；真实复验 H | 无 |
| S4-09 | 验证通过 | `stores/archive|records|events.ts`、`api/backend/*` | 总览/监测/趋势/详情/预警读服务端；停 API 后保存失败可见、记录数不变；恢复后重试成功 | `stage4-overview-server.png`、`stage4-monitor-server.png` | 无 |
| S4-10 | 验证通过 | `records.py` 单事务；`write_session` | 记录写入后注入通知异常，records/events/notifications/audits/receipts 全部回到操作前 | `api/test_records.py` 回滚用例 | 无 |
| S4-11 | 验证通过 | `core/workspace.py` 权限矩阵；`records.py` 范围校验 | inspector 建档 403；`buildingIds=[]` 对范围外测点录入/修订/试算 403；越权 CSV 不写入；伪造 actor 422；跨数据集 404 | `api/test_scope.py`；`api/test_archive.py` | 无 |
| S4-12 | 验证通过 | `0009` 迁移、备份恢复、Docker 重建 | 运行卷 0008→0009；重建 API 后数据仍在；备份/校验/恢复逐表一致；查寝 8000/5173 与筑瞳 18000/8080 同时 200 | `stage4-backup-manifest.json`；端口检查输出 | 无 |

## 结构与格式（实际扫描结果）

递归扫描范围：`src/zhutong/domain/monitoring`、`src/zhutong/operations/datasets`（含 `alarms/`、`core/`）、
`src/zhutong/routers/datasets`、`tests/monitoring`（含 `api/`、`domain/`）。

- 超长函数（>80 行）：**0**
- 超参签名（>5 参数）：**0**
- 超长文件（>450 行）：**0**
- 目录直接文件数（>8）：**0**
- 最大文件：`records.py` **405 行**；`apply.py` **313 行**、`revisions.py` **182 行**、`shared.py` **71 行**。
- 目录文件数：`domain/monitoring` 8、`operations/datasets` 6、`alarms` 5、`core` 5、`routers/datasets` 7、`tests/monitoring` 3、`tests/monitoring/api` 7、`tests/monitoring/domain` 2。
- `test_structure.py` 已改为递归扫描子目录；不再跳过 `alarms/core`，只忽略 `__pycache__`。

## 接口与数据库

- 契约：[monitoring-v1.md](../contracts/monitoring-v1.md)。写入统一 `Idempotency-Key` + `X-Dataset-Epoch` + `expectedRev`（如适用）；响应保留 `rev/replayed/meta.requestId`。
- 幂等摘要含方法、路径、操作类型与载荷；跨通知同键返回 409。
- 规则选择：稳定 ruleId 先选版本，再判范围/启停；关闭事件历史修订只更新记录。
- 迁移与备份：运行卷升级前备份 `/data/backup-pre-stage4`；第二轮重建镜像后复跑迁移、备份校验与恢复，恢复库与源库逐表一致（18 记录 / 2 事件 / 9 通知 / 46 审计 / 34 回执，head 0009）。
- 媒体：本阶段未改媒体写入；备份 manifest 中媒体文件校验通过。

## 自动化验证（实际命令与退出码）

| 命令 | 实际结果/数量 | 退出码 | 覆盖范围 |
| --- | --- | --- | --- |
| `uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80 -q` | 131 passed；覆盖率 89.67% | 0 | 后端全量 |
| `uv run ruff check src tests migrations` | All checks passed | 0 | 全后端 + 迁移 |
| `uv run ruff format --check src tests migrations` | 123 files already formatted | 0 | 全后端 + 迁移 |
| `npm test` | 113 文件 / 1136 用例通过 | 0 | Web 全量单测 |
| `npm run test:tooling` | 4 pass / 0 fail | 0 | 启动器 |
| `npm run typecheck` | 通过 | 0 | Vue/TS |
| `npm run build` | 构建成功 | 0 | 生产包 |
| 独立临时库真实 HTTP 复验 | 9 组场景按预期 | 0 | 修订/规则/通知/幂等 |

新增回归：`api/test_events.py`（修订建单、恢复推翻、关闭后修订、补录、重试、通知）、
`api/test_scope.py`（范围、跨目标幂等）、`api/test_rules_scope.py`（楼栋/测点/停用、历史、独立规则）、
`test_structure.py`（递归结构门禁）。

## 真实复验（独立临时数据库，真实 HTTP）

证据：[stage4-recheck-round2.json](C:/Users/Lenovo/Desktop/demo/docs/implementation/evidence/stage4-recheck-round2.json)

- A 最新正常 0.55→修订 0.82：assessment=red，action=created，1 事件、1 证据，before.width=0.55。
- B recovering 后修订最新恢复记录为红色：message 含“恢复待确认已被新异常推翻”，状态 pending，时间线有该动作，关闭 409。
- C 已确认事件同样操作：状态 handling，关闭 409。
- D 关闭事件后修订原异常证据：message “历史修订只更新记录，不新建事件”，事件数 1、状态 closed。
- E 最新红色 + 更早三条正常：状态 pending/red，证据 1。
- F 修订重试：前后 events=1、notifications=3、audits=56。
- G 规则范围变更：V1.1 排除楼栋、V1.2 排除测点后当前 preview 与记录均无规则；历史 -60 分钟仍 V1.0；独立规则仍选中并生成黄色记录。
- H 关闭事件 3 条通知升级 0；开放事件通知照常升级。
- I 同一键跨通知 409 IDEMPOTENCY_CONFLICT。

## 回归与限制

- 已回归：后端 131、Web 1136、启动器 4、类型检查、构建、Ruff、格式、备份校验、端口并存。
- 保留已修行为：楼栋范围 403、跨目标幂等 409、新异常推翻恢复、停用/范围变更不回退、关闭事件通知不升级、CSV 原子提交与回滚、rev/epoch 冲突、演示身份、端口隔离。
- 仍读写旧 IndexedDB：巡检、问题、工单、保养、媒体分析（阶段 5）；服务端模式已暂停旧一键脚本、模拟实时采样、自动演示与浏览器备份恢复，提示阶段 10。
- 已知问题：
  1. P3：服务端确认事件后，右上角提醒角标仍保留本地未读提醒，需手动关闭；不影响服务端通知状态。
  2. P3：生产包主 chunk 988.63 kB，构建提示超过 900 kB；既有分包结构。
  3. P2（阶段 5 前置）：服务端关闭事件目前只接受“无需维修”结论；阶段 5 接通已验收工单依据后复验。
  4. P3：趋势页“命中规则”按所选时间段显示；V1.1 后历史段仍显示 V1.0，与按采样时间解释一致，但页面未标注“分段”。
- 未新增“历史发现补建问题”功能；CSV/补录当前只存档，阶段 5 再定入口。

## 提交审核的材料

- 代码：`codex/fullstack-competition`，`3975ecd` → `70bad45` → `20a3c25`；本报告、证据随后单独提交。
- 报告：[04-monitoring.md](C:/Users/Lenovo/Desktop/demo/docs/implementation/handoff/reports/04-monitoring.md)
- 契约：[monitoring-v1.md](C:/Users/Lenovo/Desktop/demo/docs/implementation/contracts/monitoring-v1.md)
- 证据：`stage4-recheck-round2.json`、`stage4-overview-server.png`、`stage4-alarms-server.png`、`stage4-monitor-server.png`、`stage4-backup-manifest.json`。
- 镜像：`zhutong-api:stage1`、`zhutong-web:stage1` 已按第二轮代码重建；API 健康、Web 200；demo-main 数据保持 18 记录/2 事件/9 通知/46 审计/34 回执。
- 阶段状态保持“待审核”，等待复审结论。
