# 阶段 5 完成度报告：巡检、问题、工单、保养与报表（待审核）

## 基本信息

- 阶段编号/名称：5 · 点检巡检、问题、工单、复查、保养与报表
- 对照计划：`docs/implementation/handoff/stages/05-field-work.md`（S5-01—S5-12）
- 起始提交：`734626e`（阶段 4 最终核验）
- 本阶段代码提交：`ae289a3`（`feat: implement stage 5 field operations and reports`）
- 分支：`codex/fullstack-competition`
- 报告日期：2026-10-19；测试系统：Windows 10.0.26100 x64
- 隔离环境：临时 SQLite `backend/.runtime-stage5-verify/stage5.sqlite`，
  临时 API `127.0.0.1:18001`，临时 Vite `127.0.0.1:5181`；
  正式容器仍为 8080/18000，查寝保持 5173/8000。
- 数据集：`demo-main`，`datasetEpoch=1`；Alembic head `0009_monitoring_assessment`（本阶段无新迁移）。
- 变更摘要：新增巡检计划/任务、到点与逐点完成、四种来源问题、六种审核出口、复查轮次、
  工单流转与验收、附件归属、保养计划/任务/执行、报表指标、CSV 明细和单事件报告；
  Web 现场业务读写在服务端模式下全部切到后端，旧 IndexedDB 不参与日常写入。
- 自评：S5-01—S5-12 **验证通过 12 / 必验 12**；已实现未验证 0；失败 0；未实现 0。
  本阶段仍为“待审核”，未进入阶段 6。

## 逐项完成情况

| 验收编号 | 四态结果 | 实现文件 | 测试或复现步骤 | 证据 | 差距 |
| --- | --- | --- | --- | --- | --- |
| S5-01 | 验证通过 | `operations/field/inspection.py`、`tests/field/plans/test_plans.py` | 同日两次生成 `skipped=1`；改计划后既有任务 `planSnapshot` 不变；次日按新计划生成新任务 | 自动化测试；HTTP 证据“巡检到点与完成”步骤 | 无 |
| S5-02 | 验证通过 | `domain/inspection/tasks.py`、`field/task_checks.py` | 错标签不计到点；人工签到无原因拒绝；未到点不能完成；必答项缺失返回 422；执行角色之外 403 | 自动化测试；HTTP 证据 `wrongLabelPassed=false`、`attempts=2` | 无 |
| S5-03 | 验证通过 | `field/issues.py`、`field/task_checks.py`、`field/maintenance.py` | 四条来源：传感器、人工上报、巡检、保养；同 `submissionId` 重试不重复建单并补照片；独立上报不合并 | 自动化测试；HTTP 证据含人工/保养/传感器，巡检由测试覆盖 | 无 |
| S5-04 | 验证通过 | `field/reviews.py`、`domain/inspection/issues.py` | 六个出口逐一执行；错误二级分类、过短意见、自关联返回 422；原描述保留 | `tests/field/issues/test_issues.py` | 无 |
| S5-05 | 验证通过 | `field/reviews.py`、`field/maintenance.py`、`field/common.py` | 问题↔问题、问题↔事件、保养任务↔问题双向；自关联/跨范围/不存在目标拒绝 | 自动化测试；HTTP 保养证据 `bidirectional=true` | 无 |
| S5-06 | 验证通过 | `field/orders.py`、`domain/inspection/orders.py` | 派工必须指定人；维修人只能接自己单；物业代接必须写原因；维修人不能验收；退回理由必填 | `tests/field/orders/test_orders.py` | 无 |
| S5-07 | 验证通过 | `field/reviews.py`、`field/orders.py` | 验收通过只到 `pending_recheck`；recovered/observing/recurred 三分支与轮次历史；验收退回再办理 | 自动化测试；HTTP 结构问题与验收退回步骤 | 无 |
| S5-08 | 验证通过 | `operations/datasets/alarms/commands.py`、`field/orders.py` | 当前事件已验收工单可关闭；旧事件工单被拒绝；不满足恢复/依据返回 409/422 | 自动化测试；HTTP 事件关闭 + 二次关闭 409 | 无 |
| S5-09 | 验证通过 | `field/common.py`、`api/backend/media.ts`、`stores/inspection/attachments.ts` | 真实 PNG 上传/下载字节一致；3 张与 600 KB 上限；所有权、测点、唯一归属；同草稿重试不重复占配额 | 自动化测试；HTTP `attachmentBytesMatch=true`、SHA-256 一致 | 无 |
| S5-10 | 验证通过 | `field/issues.py`、`field/orders.py`、`field/maintenance.py` | 分别注入审计写入故障；问题/工单/保养任务与附件、审计、回执均无部分提交 | `tests/field/transactions/test_transactions.py` | 无 |
| S5-11 | 验证通过 | `operations/field/reports/`、`views/operations/ReportsView.vue` | 三项指标从数据库重算；观察中与部分完成不混算；CSV 按筛选导出；单事件报告四节 | 自动化测试；HTTP 指标/导出/事件报告；页面显示 6/1/3/1 行 | 无 |
| S5-12 | 验证通过（限定说明见下） | `api/backend/*`、`stores/*`、`ReportsView.vue`、`EventReportView.vue` | 页面读取巡检/问题/工单/保养/报表；页面“生成今日任务”新增后端回执；刷新、API 重启、清空 localStorage 后数据一致；本地 IndexedDB 无现场业务表 | `evidence/stage5-field/page-verification.json`、`verification.json` | 未取得第二款浏览器引擎，见“真实操作证据” |

## 接口与数据库

- 契约：[field-work-v1.md](../../contracts/field-work-v1.md)。新增路由见契约“巡检计划与任务、
  问题上报与审核、工单与事件关闭、附件与保养、报表”五节。
- 所有写请求复用阶段 4：Bearer 身份、`X-Dataset-Epoch`、`Idempotency-Key`、`expectedRev`；
  业务写、双向关联、附件归属、审计与回执同事务。
- 无新增迁移；空库 `zhutong init` 从 0001 升级到 0009 成功。
- 独立临时库写入后实测：6 个问题、3 张工单、1 个巡检计划/任务、1 个保养计划/任务、
  2 个附件/媒体、60 条审计、52 条回执（含页面点击“生成今日任务”产生的
  `inspection_task_generate` / `inspection_generate|2026-10-19`）。
- 事务失败回归：问题、工单、保养执行三条路径分别注入 `write_audit` 故障，
  对象、附件、审计、回执计数均保持不变；详见 `tests/field/transactions`。
- 同一请求同键重放返回 `replayed=true` 且不增计数；同键异内容返回 409；
  问题上报换键但同 `submissionId` 时只补照片、不重复建单。
- 媒体：2 个临时库媒体文件的 SHA-256 与上传响应和下载字节一致；
  备份恢复后 2 个媒体文件哈希仍一致。

## 自动化验证

| 命令 | 实际结果/数量 | 退出码 | 覆盖范围 |
| --- | --- | --- | --- |
| `uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80 -q`（backend） | 181 passed，88.21% | 0 | 阶段 1—5 全量后端 |
| `uv run ruff check src tests migrations` | All checks passed | 0 | 后端与迁移 |
| `uv run ruff format --check src tests migrations` | 161 files already formatted | 0 | 后端与迁移 |
| 递归结构门禁（含在 pytest） | 0 违规 | 0 | `domain/inspection`、`operations/field`、`routers/datasets/field`、`tests/field`；文件≤450、函数≤80、参数≤5、目录文件≤8 |
| `npm test` | 113 文件 / 1136 用例 | 0 | Web 既有单测 |
| `npm run test:tooling` | 4 pass | 0 | 工具链与预览脚本 |
| `npm run typecheck` | 通过 | 0 | Vue + TS |
| `npm run build` | 通过，6.70s；主包 1000.51 kB 警告 | 0 | 生产构建 |

关键新增测试：`tests/field/` 下 7 个测试模块、24 个用例，覆盖计划/任务快照、到点与完成、
四来源、六出口、双向关联、工单权限、验收退回、复查三分支、事件关闭依据、附件配额与补传、
事务回滚、指标与导出、单事件报告、结构门禁。前端新增服务端客户端由 typecheck 与真实页面验证，
没有在测试环境伪造 `backendActive()`；测试环境仍按既有设计运行本地纯前端分支。

## 真实操作证据

隔离库通过真实 HTTP 完成两条闭环与四次例外动作：

1. 设备问题 `ISS-20261019-001` → 工单 `WO-20261019-001` 派工/接单/完工/验收 →
   问题 `pending_recheck` → 复查 `recovered` → `closed`；上传照片 69 字节，
   下载字节完全一致，SHA-256 `c47dd946…52a4eb96`；工单 `submittedAt` 在验收后保留。
2. 结构问题 `ISS-20261019-002` → 转专业排查 `investigating` → 安排复查 → `observing`
   （下一轮目标日期）→ `recurred` → `pending_review`，两轮历史均保留。
3. 另外完成：`need_evidence` 退回补充、验收退回后再次办理、保养异常转问题
   `ISS-20261019-005`（任务执行 `issueId` 与问题 `maintenanceTaskId` 双向）。
4. 事件 `E20261019-001` 使用**当前事件**工单 `WO-20261019-003` 验收通过 + 3 条恢复复测关闭；
   同一事件第二次关闭返回 409。
5. 报表接口返回 response/closure/periodic 三项；问题导出 6 行；任务导出；
   事件报告四节齐全且 `closed=true`。

页面证据（IAB DOM 快照，5181 临时实例）：

- 巡检页显示 `PLAN-20261019-001` 与任务；点击“生成今日任务”返回“今日任务已是最新”，
  后端新增回执 `rcpt_b704de167eed4ee4a22100a3a1357b26`。
- 问题池显示 6 条问题/3 张工单；详情抽屉显示 1 张现场照片、已验收工单、1 轮复查与完整时间线。
- 保养页显示保养计划、已完成任务与四个独立分区计数。
- 报表页三项指标与导出计数和服务端 JSON 一致；事件报告页标注“数据来源：后端数据库”，
  并显示工单提交时间与关闭依据。
- 刷新报表页、停止并重启临时 API 后继续读取同一数据；清空 localStorage 后重新载入，
  仍显示同一 6 条问题、100% 闭环率与 6 行导出。
- 浏览器 `zhutong-demo` IndexedDB 中 issues/tasks/workOrders/attachments/maintenanceTasks
  均不存在或计数为 0，未出现“服务端 + 本地”混合数据。

IAB 截图接口在本机连续返回 `surface preparation timeout`，因此未生成页面截图；
本报告不以截图作为通过依据，页面事实以 DOM 快照文本、后端回执与数据库记录交叉核对。
“另一浏览器”以清空 localStorage 的独立载入 + 独立 HTTP 客户端读取共同替代，
未取得 Chrome/Edge 等第二浏览器引擎。

## 回归与限制

- 全量后端 181 项包含阶段 1—4 既有测试；前端 1136 项全部通过。
- 备份：临时库备份 `backend/.stage5-backup` 已校验，恢复至 `backend/.stage5-restore`；
  10 张业务表计数完全一致，2 个媒体文件 SHA-256 一致；恢复目录以 18002 启动后
  events=1、issues=6、closed 事件与 69 字节媒体均可读。
- 容器：按 `deploy/compose.yaml` 两次重建 API/Web/migrate；migrate 退出 0、API healthy；
  首次重建前后 18 张受核对表计数完全一致（含 5 楼栋、8 测点、18 记录、2 事件、9 通知、46 审计、44 回执），
  runtime 卷未清空，8 个媒体文件保留。最终重建后业务对象计数不变；回执从 44 增至 51，
  新增 7 条均为页面访问触发的 `notification_escalate`，不是重建写入。
- 端口：查寝 8000/5173 与筑瞳 18000/8080 同时返回 200；未停止或改动查寝服务。
- 仍保留的浏览器/本地数据入口：`VITE_BACKEND_ENABLED=false` 的纯前端演示模式、
  自动演示与场景写入、助手/影像会话（阶段 6/7/10 接通），在服务端模式下保持暂停，
  不会绕过后端写业务事实。
- `linkIssueToPoint` 的“单独补关联已存在问题”未提供独立命令；现有页面在
  “提交检查完成”时带 `linkedIssueId`，巡检上报本身已原子关联任务。该入口当前无页面调用，
  后续如需要可单独补命令。
- 单事件打印页仍使用既有 `buildEventReport` 纯函数，数据来自服务端读取的事件/问题/工单；
  后端 `/reports/events/{id}` 已实现并有自动化测试，供 Flutter 或后续统一渲染复用。
- 构建主包 1000.51 kB 超过 900 kB 提示阈值；本次未做大范围拆包，留待后续展示增强阶段评估。
- 已知低优先级：报表页指标失败时目前没有页面级错误条；本地演示分支的既有功能未在本阶段重做。
- 未开始：阶段 6 知识库、阶段 7 助手、阶段 8—9 Flutter、阶段 10 演示控制。

## 提交审核的材料

- 代码：本阶段代码提交 `ae289a3`；报告 SHA 更新提交紧随其后，单独列出。
- 契约：`docs/implementation/contracts/field-work-v1.md`
- 真实 HTTP 证据：`docs/implementation/evidence/stage5-field/verification.json`
- 页面证据：`docs/implementation/evidence/stage5-field/page-verification.json`
- 备份与部署证据：`backup.json`、`backup-manifest.json`、`deployment.json`
- 复现脚本：`backend/scripts/stage5_http_verify.py`（临时库 `/api` 18001）
- 需要重点审核：事件关闭依据是否只取当前事件工单；六出口/复查分流是否完整；
  照片归属与配额；事务回滚；页面是否仍有混合写入入口。

阶段 5 保持“待审核”，审核结论出来前不进入阶段 6，也不把台账改成“通过”。
