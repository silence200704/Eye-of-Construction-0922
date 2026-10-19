# 阶段 4 完成度报告：档案、监测与预警（返修后重新提交）

## 基本信息

- 阶段编号/名称：4 · 档案、监测、预警
- 对照计划版本或提交：`39173b3`（docs: define stages 4-11 implementation and evidence review gates）
- 本阶段代码分支、提交 SHA：`codex/fullstack-competition`；
  - 首轮实现 `3975ecd`
  - 审核返修 `70bad45`（本报告与证据随后单独提交）
- 报告日期、测试系统、设备：2026-10-19；Windows 10.0.26100 x64；Docker Desktop（zhutong-api / zhutong-web）；Chrome 内核内置浏览器
- 启动方式、页面/API 地址：
  - Docker：`docker compose -f deploy/compose.yaml up -d migrate api web`
  - Web `http://127.0.0.1:8080`，API `http://127.0.0.1:18000`，本地开发 `http://127.0.0.1:5180`
- 数据集 ID、datasetEpoch、Alembic head：`demo-main`；epoch `1`；head `0009_monitoring_assessment`
- 本轮变更摘要：
  - 档案、基准、规则、监测记录、CSV、预警事件与通知使用服务端事务；统一身份、楼栋范围、幂等键、expectedRev、datasetEpoch 与同事务审计回执。
  - 服务端判定引擎与旧 TypeScript 引擎共用 24 条样例（17 条判定、7 条录入校验）。
  - 追加迁移 `0009_monitoring_assessment`，记录保存规则版本、规则快照与判定结果。
  - 返修：补齐记录/修订/试算/CSV 的楼栋范围校验；修复恢复状态被新异常推翻、补录覆盖当前状态、关闭后修订新建事件、停用规则版本回退、跨目标幂等重放、已关闭事件通知仍升级；拆分超长函数与超参签名。
- 自评完成度：返修并复验后，已验证通过 **12 / 12**；已实现未验证 0；失败 0；未实现 0。

## 审核问题返修对照

| 审核问题 | 修复 | 回归测试 |
| --- | --- | --- |
| P1 记录写入缺楼栋范围 | `_point_for_record()` 对测点所属楼栋调用 `require_building`，录入、修订、试算、CSV 提交共用 | `test_record_revision_and_csv_enforce_building_scope`：`buildingIds=[]` 写/改/试算均 403；越权 CSV 不写入 |
| P1 恢复后新增红色仍保持恢复 | `_append_or_upgrade` 检测 `recovering`，新异常退回 `handling`（已确认）或 `pending`（未确认），时间线留痕 | `test_recovery_is_overturned_by_new_abnormal_record`、`test_recovery_overturned_returns_to_pending_when_unacknowledged` |
| P1 补录旧正常记录把事件改成恢复 | `_is_current_record()` 只允许测点最新采样时刻驱动事件；历史补录只存档 | `test_backfill_cannot_enter_recovery`：最新红色仍在，证据仍 1 条 |
| P1 关闭后修订旧证据新建第二事件 | 修订分支只作用于未关闭事件的活跃证据；无未关闭事件时明确不改建事件 | `test_revision_after_close_does_not_create_event`：事件数仍 1，状态仍 closed |
| P1 停用新版本仍回退旧规则 | `rule_applies_to` 先按指标/范围选版本，启停交给引擎判定；TS/Python 同步 | `test_disabled_latest_rule_version_is_not_bypassed`；Web `最新版本停用…` 用例 |
| P1 幂等摘要未含目标 | 命令摘要纳入 HTTP 方法、路径、操作类型与业务载荷；同键跨通知返回 409，不再复用 A 的回执 | `test_same_idempotency_key_cannot_replay_across_notifications` |
| P2 结构指标超限 | 22 处函数/签名超限降为 0；引入 `Command`、`AuditEntry`、`PointWrite`、`ArchiveCommand`、`AssessmentCommand` 等 DTO/Context，拆分超长函数 | `test_structure.py`：新代码函数 ≤80 行、参数 ≤5、文件 ≤450、目录 ≤8 |
| P1 已关闭事件通知仍升级 | `escalate_due` 查询已关闭事件 ID 并跳过其通知，保留历史、不伪造确认 | `test_escalation_skips_closed_events`；真实复验 `closedEventEscalated=0` |

## 逐项完成情况

| 验收编号 | 四态结果 | 实现文件/提交 | 测试或复现步骤 | 证据路径 | 差距 |
| --- | --- | --- | --- | --- | --- |
| S4-01 | 验证通过 | `operations/datasets/archive.py`、`assets.py`、`routers/datasets/archive.py` | 真实建档 B99→改名→归档；错误楼层、坐标 1.2、重复 NFC、过期 rev 被拒；清空浏览器存储后读取一致 | `stage4-overview-server.png`；`test_archive.py` | 无 |
| S4-02 | 验证通过 | `versions.py`、`domain/monitoring/rules.py`、`0009_monitoring_assessment.py` | 基准 v2、规则 V1.1 真实创建；新记录引用 v2/V1.1，旧记录仍 v1/V1.0；停用 V1.1 后新记录 `excluded/规则未启用` 且规则版本为 V1.1；旧库 `recordRevision=0` | `stage4-recheck.json`；`test_disabled_latest_rule_version_is_not_bypassed` | 无 |
| S4-03 | 验证通过 | `domain/monitoring/*`、`tests/shared/assessment-samples.json` | 同一 JSON 驱动 TS/Python：17 条判定 + 7 条录入校验全绿；覆盖缺项、质量、量程、阈值边界、速率、持续、恢复、环境、停用/未生效 | `engineParity.test.ts`、`test_engine.py` | 无 |
| S4-04 | 验证通过 | `records.py`、`alarms/apply.py` | 修订保留 `before` 原值与原因；补录旧记录只存档、不改当前事件；关闭后修订旧证据不新建事件 | `test_backfill_cannot_enter_recovery`、`test_revision_after_close_does_not_create_event`；`stage4-recheck.json` | 无 |
| S4-05 | 验证通过 | `csv.py`、`importer.py`、`ImportPanel.vue` | 真实 3 行 CSV：2 警告 1 错误，确认写 2 行；过期 token 409；第二行注入失败整批回滚；历史行不改变当前事件 | `stage4-recheck.json`；`test_csv.py` | 无 |
| S4-06 | 验证通过 | `core/workspace.py` `Command`；`client.ts` 命令通道 | 同键同内容重放；同键不同内容 409；同键跨通知 409 且 B 未展示；过期 rev/epoch 拒绝；记录/修订/CSV 重试只写一次 | `test_same_idempotency_key_cannot_replay_across_notifications`；`stage4-recheck.json` | 无 |
| S4-07 | 验证通过 | `domain/monitoring/events.py`、`alarms/apply.py` | 真实倾斜点 0.12/0.22/0.32 单事件黄→橙→红；恢复后新红色退回 pending/handling，时间线“恢复状态被新异常推翻”，关闭 409；合法恢复+依据+无需维修才关闭 | `test_recovery_is_overturned_by_new_abnormal_record`；`stage4-recheck.json` | 无 |
| S4-08 | 验证通过 | `alarms/commands.py`、`stores/events.ts` | 9 条通知登记展示、2 条确认；未确认通知超时一次升级；第二次核验 0；已关闭事件的通知不再升级 | `test_notification_lifecycle_open_event`、`test_escalation_skips_closed_events`；`stage4-recheck.json` | 无 |
| S4-09 | 验证通过 | `stores/archive|records|events.ts`、`api/backend/*` | 总览/监测/趋势/详情/预警读服务端；停 API 后保存失败可见、记录数不变；恢复后重试成功 | `stage4-overview-server.png`、`stage4-monitor-server.png` | 无 |
| S4-10 | 验证通过 | `records.py` 单事务；`write_session` | 记录写入后注入通知异常，records/events/notifications/audits/receipts 全部回到操作前 | `test_mid_transaction_failure_rolls_back_everything` | 无 |
| S4-11 | 验证通过 | `core/workspace.py` 权限矩阵；`records.py` 范围校验 | inspector 建档 403；`buildingIds=[]` 账号对范围外测点录入/修订/试算 403；越权 CSV 422 且不写入；伪造 actor 422；跨数据集 404 | `test_record_revision_and_csv_enforce_building_scope`、`test_archive.py` 权限用例；`stage4-recheck.json` | 无 |
| S4-12 | 验证通过 | `0009` 迁移、备份恢复、Docker 重建 | 原 stage 3 卷 0008→0009；重建 API 后数据仍在；备份/校验/恢复逐表一致；查寝 8000/5173 与筑瞳 18000/8080 同时 200 | `stage4-backup-manifest.json`；端口检查输出 | 无 |

## 结构与代码规模

- 返修前扫描：6 个函数 >80 行、16 个签名 >5 参数（合计 22 处）。
- 返修后扫描：新增 `domain/monitoring`、`operations/datasets`、`routers/datasets` 三处 **0 处超限**。
- 新增/拆分后的关键文件：`records.py` 403 行、`assets.py` 349 行、`archive.py` 346 行、`apply.py` 380 行、`commands.py` 240 行；目录文件数 ≤8。
- 参数封装：`Command(request, operation, payload)`、`AuditEntry(...)`、`PointWrite/DeviceWrite/ArchiveCommand`、`AssessmentCommand/EventSeed/RevisionSeed`、`RuleVersionCommand/RevisionCommand`。
- 回归门禁：`backend/tests/monitoring/test_structure.py` 直接扫描 AST，防止再次长出超长函数或超参签名。

## 接口与数据库

- 契约：[monitoring-v1.md](../contracts/monitoring-v1.md)。写入统一 `Idempotency-Key` + `X-Dataset-Epoch` + `expectedRev`（如适用）；响应保留 `rev/replayed/meta.requestId`。
- 权限/范围实测：inspector 建档 403；`buildingIds=[]` 的 device 账号对 B07 测点录入/修订/试算 403；越权 CSV 422；请求体伪造 `actor` 422；跨数据集对象 404。
- 幂等实测：同键同内容 `replayed=true`；同键不同内容/不同通知对象 `409 IDEMPOTENCY_CONFLICT`，B 通知保持未展示。
- 一次成功写入（真实 UI）：`R20261018-001` 0.70 mm，橙色；记录 rev 1、recordRevision 0、baselineVersion 1、ruleVersion V1.0；同事务生成事件 `E20261018-001` 与 2 条通知，审计与回执各新增。
- 迁移与备份：运行卷升级前备份 `/data/backup-pre-stage4`；返修后重建镜像并复跑迁移、备份校验与恢复，恢复库与源库逐表一致（18 记录 / 2 事件 / 9 通知 / 46 审计 / 34 回执，head 0009）。
- 媒体：本阶段未改媒体写入；备份 manifest 中媒体文件校验通过。

## 自动化验证

| 命令 | 实际结果/数量 | 退出码 | 覆盖范围 | 日志路径 |
| --- | --- | --- | --- | --- |
| `cd backend && .venv/Scripts/python.exe -m pytest -q` | 124 passed | 0 | 阶段 1—4 全部后端测试 | 本轮终端输出 |
| `... -m pytest --cov=zhutong` | 124 passed，总覆盖率 89% | 0 | 后端全量 + 覆盖率 | 本轮终端输出 |
| `... -m ruff check src tests` | All checks passed | 0 | Python 结构、导入、行宽 | 本轮终端输出 |
| `npm run typecheck` | 通过 | 0 | Vue/TS 全量类型 | 本轮终端输出 |
| `npx vitest run` | 113 文件 / 1132 用例通过 | 0 | Web 全量单测 | 本轮终端输出 |
| `npm run build` | 构建成功（6.13s） | 0 | 生产包 | `dist/` |
| 独立临时库真实 HTTP 复验 | 7 类缺陷全部按预期 | 0 | 录入/修订/CSV/事件/规则/幂等/通知 | `docs/implementation/evidence/stage4-recheck.json` |

- 关键新增测试：范围越权、恢复推翻、补录不覆盖、关闭后修订、停用版本、跨目标幂等、关闭事件通知、结构指标。
- 未运行：Flutter/真机（阶段 8）、断外网（阶段 11）。

## 真实操作证据

1. 服务端数据总览：`stage4-overview-server.png`，左侧“服务端数据 · demo-main”，4 栋 / 8 点 / 4 设备 / 17 条记录。
2. 真实录入：B03-F2-CRACK01 0.70 mm → `R20261018-001` 橙色 + `E20261018-001`；两条同事务审计。
3. 黄橙红：倾斜点 0.12/0.22/0.32° → 单事件 `E20261018-002`，2 次升级；恢复复测 + 依据 + 无需维修结论关闭。
4. 修订：`R20261018-001` 0.70→0.52，`before` 保留 0.70；`R20261018-005` CSV 记录 0.55→0.56。
5. CSV：3 行中写 2 行、跳过 1 个未知测点；整批原子提交。
6. 通知：打开详情登记 7 条展示；确认事件确认两条通知；超时核验 7 条升级；返修后已关闭事件的通知升级数为 0。
7. 跨浏览器存储：新标签清空 localStorage 与 IndexedDB 后仍读取 4/8/4/17 与同一批事件。
8. 断 API：停止 `zhutong-api-1` 保存失败可见，记录数不变；重启后重试恢复。
9. 版本解释：基准 v2 / 规则 V1.1 后新记录 `R20261018-010` 引用新版本；旧记录仍 v1/V1.0；旧库 `recordRevision=0`。
10. 返修复验（独立临时库，真实 HTTP；详见 `stage4-recheck.json`）：
    - `buildingIds=[]` 向范围外测点写入/修订/试算均 403；越权 CSV 不落库。
    - 恢复待确认后新增红色：状态 `recovering→pending`，时间线含“恢复状态被新异常推翻”，关闭返回 409。
    - 最新红色 + 更早三条正常：事件保持 `pending/red`，证据 1 条。
    - 关闭后修订旧异常证据：返回“历史修订不新建事件”，事件数仍 1。
    - 停用 V1.1：记录使用 V1.1 且 `excluded/规则未启用`，不回退 V1.0。
    - 同一幂等键跨通知：409，第二通知未展示。
    - 关闭事件通知超时：3 条已关闭事件通知升级 0 条；开放事件通知升级 6 条。

对象 ID（脱敏后保留关系）：

- 楼栋 `bld_37e13c2fbd37405b84d4633fd53cf4a8`（B99，rev 3，archived）
- 记录 `rec_4bf39921bb8a45f5933d22d7f85dbce3`（R20261018-001，rev 2，recordRevision 1）
- 记录 `rec_911e7fa917154440b25f3530790b1806`（R20261018-010，baseline v2 / rule V1.1）
- 事件 `evt_f92dbbbf8e5847e7a739bee286a849a5`（E20261018-001，handling，rev 5）
- 事件 `evt_e424123e27954387a43ba7d212e32205`（E20261018-002，closed，rev 5）

## 回归与限制

- 已回归：后端 124 项、Web 1132 项、类型检查、构建、Ruff、备份校验、两个项目端口并存。
- 仍读写旧 IndexedDB：巡检、问题、工单、保养、媒体分析（阶段 5）；演示准备、一键脚本、模拟实时采样、自动演示在服务端模式明确暂停并提示阶段 10。
- 行为口径变化：CSV/历史补录不再驱动当前事件，只存档并在结果中提示；阶段 5 若需要“历史发现补建问题”，应另设明确入口，不能恢复为覆盖当前状态。
- 已知问题：
  1. P3：服务端确认事件后，右上角提醒角标仍保留本地未读提醒，需手动关闭；不影响服务端通知状态。
  2. P3：生产包主 chunk 988.63 kB，构建提示超过 900 kB；既有分包结构，阶段 4 未扩大范围。
  3. P2（阶段 5 前置）：服务端关闭事件目前只接受“无需维修”结论；阶段 5 接通已验收工单依据后复验。
  4. P3：趋势页“命中规则”按所选时间段显示；新增 V1.1 后历史段显示 V1.0，与按采样时间解释一致，但页面未明显标注“分段”。
- 阶段 5 前置：工单验收依据、问题/工单/巡检/保养服务端化；阶段 10 前置：演示时钟、复位与场景编排。

## 提交审核的材料

- 代码：`codex/fullstack-competition`，首轮 `3975ecd`，返修 `70bad45`；本报告、契约、证据随后单独提交。
- 自动化：本报告命令与数量；返修真实复验 `docs/implementation/evidence/stage4-recheck.json`。
- 截图：`stage4-overview-server.png`、`stage4-alarms-server.png`、`stage4-monitor-server.png`；备份 manifest。
- 镜像：`zhutong-api:stage1`、`zhutong-web:stage1` 已按返修代码重建；API 健康、Web 200。
- 需要重点审核的疑问：
  1. 历史补录/CSV 只存档、不驱动当前事件的口径，是否符合你对“历史发现”的预期？
  2. 阶段 5 接通工单验收依据时，是否需要为历史补录单独提供“补建问题”入口？
  3. 已关闭事件的通知保留历史但不再升级，是否还需在详情页标注“事件关闭后停止升级”？
