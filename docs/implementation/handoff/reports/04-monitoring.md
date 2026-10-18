# 阶段 4 完成度报告：档案、监测与预警

## 基本信息

- 阶段编号/名称：4 · 档案、监测、预警
- 对照计划版本或提交：`39173b3`（docs: define stages 4-11 implementation and evidence review gates）
- 本阶段代码分支、提交 SHA：`codex/fullstack-competition`；代码提交 `3975ecd`（本报告与文档随后单独提交）
- 报告日期、测试系统、设备：2026-10-18；Windows 10.0.26100 x64；Docker Desktop（zhutong-api / zhutong-web）；Chrome 内核内置浏览器
- 启动方式、页面/API 地址：
  - Docker：`docker compose -f deploy/compose.yaml up -d migrate api web`
  - Web `http://127.0.0.1:8080`，API `http://127.0.0.1:18000`，本地开发 `http://127.0.0.1:5180`
- 数据集 ID、datasetEpoch、Alembic head：`demo-main`；epoch `1`；head `0009_monitoring_assessment`
- 本轮变更摘要：
  - 新增档案/基准/规则/监测记录/CSV/事件/通知数据集接口，统一身份、范围、幂等键、expectedRev、datasetEpoch 与同事务审计回执。
  - 服务端判定引擎与旧 TypeScript 引擎共用 24 条样例（17 条判定、7 条录入校验）。
  - 档案、监测、事件、通知从 IndexedDB 切换到服务端；演示/助手旧写入入口在服务端模式明确暂停。
  - 追加迁移 `0009_monitoring_assessment`，记录保存规则版本、规则快照与判定结果。
  - 修复旧引擎变化速率把当前记录误当“上一条”导致速率规则永不触发的问题。
- 自评完成度：已验证通过 **12 / 12**；已实现未验证 0；失败 0；未实现 0。

## 逐项完成情况

| 验收编号 | 四态结果 | 实现文件/提交 | 测试或复现步骤 | 证据路径 | 差距 |
| --- | --- | --- | --- | --- | --- |
| S4-01 | 验证通过 | `operations/datasets/archive.py`、`assets.py`、`routers/datasets/archive.py` | 真实创建 B99→改名→归档；测试覆盖错误楼层、坐标 1.2、重复 NFC、过期 rev；清空浏览器存储后读取一致 | `docs/implementation/evidence/stage4-overview-server.png`；`backend/tests/monitoring/test_archive.py`（6 项） | 无 |
| S4-02 | 验证通过 | `versions.py`、`0009_monitoring_assessment.py` | 基准 v2、规则 V1.1 真实创建；新记录 `R20261018-010` 引用 v2/V1.1；旧记录仍 v1/V1.0；旧库记录 `recordRevision=0` | API 对象见下文；`test_rules.py`、`test_records.py` | 无 |
| S4-03 | 验证通过 | `domain/monitoring/*`、`tests/shared/assessment-samples.json` | 同一 JSON 驱动 TS/Python：17 条判定 + 7 条录入校验，共 24 项两侧全绿；覆盖缺项、质量、量程、阈值边界、速率、持续、恢复、环境、停用/未生效 | `tests/shared/engineParity.test.ts`；`backend/tests/monitoring/test_engine.py` | 无 |
| S4-04 | 验证通过 | `records.py` 修订路径；`RecordDialog`→`/records/{id}/revisions` | 真实修订 `R20261018-001`（0.70→0.52）与 `R20261018-005`（0.55→0.56）；`before` 保留原值/原因；事件旧证据移入 `supersededEvidences` | API 核验输出；`stage4-monitor-server.png` | 无 |
| S4-05 | 验证通过 | `domain/monitoring/csv.py`、`importer.py`、`ImportPanel.vue` | 真实粘贴 3 行：2 警告 1 错误；确认只写 2 行；错误行不写；过期 token 返回 `409 PREVIEW_STALE`；第二行注入失败整批回滚 | UI“导入结果：写入 2 条，跳过错误行 1 条”；`test_csv.py`（5 项） | 无 |
| S4-06 | 验证通过 | `core/workspace.py` 幂等/epoch/rev；`client.ts` 命令通道 | 同键同内容重放、同键不同内容 409、过期 rev 409、缺 epoch 400、过期 epoch 409；记录/修订/CSV 重试各只写一次 | `test_archive.py`、`test_records.py`、`test_csv.py` | 无 |
| S4-07 | 验证通过 | `domain/monitoring/events.py`、`alarms/apply.py` | 真实倾斜测点 0.12/0.22/0.32 生成一条事件，等级黄→橙→红、2 次升级；3 条恢复记录后 `recovering`；安全管理人员填写依据+无需维修结论后关闭；物业关闭被 403、缺依据 422 | `stage4-alarms-server.png`；E20261018-002 时间线含关闭 | 无 |
| S4-08 | 验证通过 | `alarms/commands.py`、`stores/events.ts`、通知面板 | 打开详情登记 9 条通知已展示；确认事件同时确认 E001 的两条通知；E002 七条未确认通知超时后一次升级 7 条，第二次核验 0 条 | API `(9,9,2,7)`（总数/已展示/已确认/已升级）；UI“7 条通知已超过…已按规则标记升级去向” | 无 |
| S4-09 | 验证通过 | `stores/archive|records|events.ts`、`api/backend/*` | 总览/监测/趋势/详情/预警均读服务端；停止 API 后保存显示“保存失败…”，记录数保持 17，无本地成功；恢复 API 后重试载入成功 | `stage4-overview-server.png`、`stage4-monitor-server.png`；断网快照与日志 | 无 |
| S4-10 | 验证通过 | `records.py` 单事务；`write_session` | 记录写入后注入通知写入异常：records/events/notifications/audits/receipts 全部回到操作前数量 | `test_mid_transaction_failure_rolls_back_everything` | 无 |
| S4-11 | 验证通过 | 权限矩阵 `core/workspace.py`；`buildingIds` 范围校验 | inspector 建档 403；范围受限账号跨楼栋建档 403；伪造 `actor` 422；跨数据集对象 404 | `test_archive.py` 的 `test_role_and_building_scope_enforced`、`test_forged_actor_and_cross_dataset_access_rejected` | 无 |
| S4-12 | 验证通过 | `0009` 迁移、备份恢复、Docker 重建 | 原 stage 3 卷从 `0008` 升至 `0009`；重建 API 后数据仍在；备份→校验→恢复后 18/2/9/46/34 与源库一致；查寝 8000/5173 与筑瞳 18000/8080 同时 200 | `stage4-backup-manifest.json`；端口检查输出 | 无 |

## 接口与数据库

- 新增契约：[monitoring-v1.md](../contracts/monitoring-v1.md)。所有写接口统一使用
  `Idempotency-Key` + `X-Dataset-Epoch` + `expectedRev`（如适用），响应保留 `rev/replayed/meta.requestId`。
- 身份/范围实测：
  - `demo-inspector` 建档 → `403 ROLE_FORBIDDEN`。
  - 范围账号（仅 B03）在 B07 建档 → `403 SCOPE_FORBIDDEN`。
  - 请求体带 `actor` → `422 VALIDATION_FAILED`（Pydantic `extra=forbid`）。
  - 主库对象 ID 拿到 `demo-showcase` → `404 NOT_FOUND`。
- 一次成功写入（真实 UI）：`R20261018-001`，0.70 mm，橙色；
  - 记录 `rev=1`，`recordRevision=0`，`baselineVersion=1`，`ruleVersion=V1.0`；
  - 同事务生成事件 `E20261018-001`（rev 1，pending）与 2 条通知；
  - 审计新增“录入监测记录”与“生成橙色排查预警事件”两条，回执新增 1 条。
- 重试/冲突/回滚：
  - 同键记录重试 → `replayed=true`，records 仍 1 条；
  - 同键不同楼栋名 → `409 IDEMPOTENCY_CONFLICT`；
  - 过期 rev → `409 REVISION_CONFLICT`；旧 epoch → `409 DATASET_EPOCH_CONFLICT`；
  - 第二行通知注入异常 → 整批 500，records/events/notifications/audits/receipts 全部回滚。
- 迁移与备份：
  - 运行卷升级前已备份到 `/data/backup-pre-stage4`（会话密钥、SQLite、媒体、manifest）；
  - 新增版本在子目录 `migrations/versions/stage4/`，通过 `recursive_version_locations=true` 发现，head `0009`；
  - 阶段完成后备份 `/data/backup-stage4`，`verify-backup` 通过，恢复目录与源库逐表数量一致。
- 媒体 SHA-256：本阶段未改媒体写入；备份 manifest 中媒体文件校验通过。

## 自动化验证

| 命令 | 实际结果/数量 | 退出码 | 覆盖范围 | 日志路径 |
| --- | --- | --- | --- | --- |
| `cd backend && .venv/Scripts/python.exe -m pytest -q` | 114 passed | 0 | 阶段 1—4 全部后端测试 | 本轮终端输出 |
| `cd backend && .venv/Scripts/python.exe -m ruff check src tests` | All checks passed | 0 | 新增/修改 Python 结构、导入、行宽 | 本轮终端输出 |
| `npm run typecheck` | 通过 | 0 | Vue/TS 全量类型 | 本轮终端输出 |
| `npx vitest run` | 113 文件 / 1131 用例通过 | 0 | Web 全量单测（基线 1104，新增 27） | 本轮终端输出 |
| `npm run build` | 构建成功（6.18s） | 0 | 生产包 | `dist/` |
| `docker compose build migrate api web` | 三镜像构建成功 | 0 | 部署产物 | Docker 输出 |

- 关键新增行为的 RED/GREEN：先写共享样例与后端接口测试，首个实现运行暴露并修复
  “规则定义未 flush 导致外键失败”“建筑/基准未 flush 导致 rev 为空”“修订请求多传 pointId”
  三处问题；修复后全部转绿。变化速率缺陷另加回归用例。
- 未运行的检查：Flutter（阶段 8）、真机（阶段 8）、断外网（阶段 11）。
- 新增测试覆盖的风险：跨身份/范围越权、重复提交、旧版本覆盖、半条业务、历史阈值漂移、
  CSV 过期预检、恢复不自动关闭、通知重复升级。

## 真实操作证据

1. 服务端数据总览：`stage4-overview-server.png`。左侧显示“服务端数据 · demo-main”，
   4 栋 / 8 测点 / 4 设备 / 17 条记录；最近记录 `R20261018-009`。
2. 真实录入：`快捷录入`→B03-F2-CRACK01→0.70 mm→保存。
   实际生成 `R20261018-001`（橙色）与 `E20261018-001`；操作日志出现两条同事务审计。
3. 黄橙红升级：倾斜测点 0.12/0.22/0.32° 三条记录 → 单事件 `E20261018-002`，
   peak=red，2 次升级，3 条证据；随后 3 条恢复复测 → `recovering`。
4. 修订：`R20261018-001` 0.70→0.52，原因“原始读数录错，按现场复核更正”；
   `revisions[0].before.values.width=0.70`；事件证据移入已替代。
5. CSV：粘贴 3 行（2 有效 1 未知测点）→“写入 2 条，跳过错误行 1 条”；
   事件 E001 追加证据，不重复建单。
6. 关闭：E002 恢复待确认后，安全管理人员填写
   “连续三次复测均低于恢复阈值，现场复查无新增异常”与
   “现场核查确认倾斜测点无新增异常，无需维修”，关闭成功；时间线含关闭依据。
7. 通知：打开 E002 详情 → 7 条通知登记“已展示”；把未确认通知时间提前 2 小时后点击
   “立即检查超时通知” → 7 条升级；第二次核验 0 条。
8. 跨浏览器存储：新标签页清空 localStorage 与全部 IndexedDB 后重新进入，
   仍显示 4/8/4/17 与同一批事件，证明事实来自服务端。
9. 断 API：停止 `zhutong-api-1` 后保存记录，页面显示“保存失败…”；服务端记录数不变；
   重启 API 后“重试”恢复载入。
10. 版本解释：基准 v2 / 规则 V1.1 生效后新增 `R20261018-010`，
    其 `baselineVersion=2`、`ruleVersion=V1.1`；`R20261018-001` 仍为 1/V1.0；
    旧库 `R20260915-001` 的 `recordRevision` 仍为 0。
11. 备份恢复：`backup-stage4` → `verify-backup` → `restore-stage4`，
    恢复库与源库均为 18 记录 / 2 事件 / 9 通知 / 46 审计 / 34 回执，head 0009。
12. 并存：查寝 8000、5173 与筑瞳 18000、8080 同时返回 200；未终止查寝进程。

对象 ID（脱敏后保留关系）：

- 楼栋 `bld_37e13c2fbd37405b84d4633fd53cf4a8`（B99，rev 3，archived）
- 记录 `rec_4bf39921bb8a45f5933d22d7f85dbce3`（R20261018-001，rev 2，recordRevision 1）
- 记录 `rec_911e7fa917154440b25f3530790b1806`（R20261018-010，baseline v2 / rule V1.1）
- 事件 `evt_f92dbbbf8e5847e7a739bee286a849a5`（E20261018-001，handling，rev 5）
- 事件 `evt_e424123e27954387a43ba7d212e32205`（E20261018-002，closed，rev 5）

## 回归与限制

- 已回归前序阶段：后端 114 项、Web 1131 项；阶段 3 导入重放、媒体与备份测试仍通过。
- 筑瞳与查寝同时运行：通过，端口互不占用；未终止查寝服务。
- 仍读写旧 IndexedDB 的功能：
  - 巡检、问题、工单、保养、媒体分析等阶段 5 模块仍以浏览器库为权威；
  - 演示准备、完整自动演示、一键脚本、模拟实时采样、模拟超时通知在服务端模式已明确暂停并提示
    “阶段 10 提供”，不会写出第二份本地结果；
  - `archive.log` 在服务端模式返回不落库占位，不写本地审计。
- 新发现结构债/风险：
  1. P3：服务端确认事件后，右上角提醒角标仍保留本地未读提醒，需手动关闭；不影响服务端通知状态。
  2. P3：生产包主 chunk 988.63 kB，构建提示超过 900 kB；属既有分包结构，阶段 4 未扩大范围。
  3. P2（阶段 5 前置）：服务端关闭事件目前只接受“无需维修”结论；Web 若关联了本地工单，
     仍须填现场核查结论，阶段 5 接通已验收工单依据后复验。
  4. P3：趋势页页头“命中规则”显示所选时间段的规则版本；新增 V1.1 后历史段仍显示 V1.0，
     与按采样时间解释的口径一致，但页面未明显标注“分段”。
- 已知问题：
  - 服务端数据集初始内容仍依赖阶段 3 导入；阶段 4 未新增演示种子或复位接口（阶段 10）。
  - 规则修改必须同时带 `expectedRev` 与 `expectedVersion`，旧客户端若只带 rev 会被拒绝（400）。
- 未完成项/阻塞/下一阶段前置：
  - 阶段 5 需接通工单验收依据、问题/工单/巡检/保养服务端化，并复验事件关闭依据。
  - 阶段 10 需接入演示时钟、演示复位与场景编排，复验通知超时与数据集 epoch。

## 提交审核的材料

- 代码位置：分支 `codex/fullstack-competition`，代码提交 `3975ecd`；本报告、契约、README 与截图随后单独提交。
- 验收清单、测试日志、截图：`docs/implementation/evidence/stage4-*.png`、`stage4-backup-manifest.json`；本报告逐项列出命令与结果。
- 镜像：`zhutong-api:stage1`、`zhutong-web:stage1`（本轮重建）；容器 `zhutong-api-1` 健康、`zhutong-web-1` 200。
- 需要重点审核的疑问：
  1. 事件关闭在阶段 4 强制“无需维修”结论，是否与阶段 5 工单依据的过渡口径一致？
  2. 服务端模式暂停旧自动演示/模拟实时采样是否符合“本阶段只做档案、监测、预警”的范围？
  3. 通知超时核验允许对已关闭事件的未确认通知升级；是否应在阶段 5 改为跳过已关闭事件？
