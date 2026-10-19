# 阶段 5 首轮返修报告（待复审）

## 基本信息

- 阶段：5 · 点检巡检、问题、工单、复查、保养与报表
- 审核依据：[首轮审核报告](05-field-work-review.md)（`c034f30`）、[返修提示词](../prompts/05-field-work-fix.md)
- 起始受审代码：`ae289a3`；返修代码提交：见下方“提交材料”
- 日期：2026-10-19；隔离环境：独立临时 SQLite、临时 API `18001`、临时 Vite `5181`
- Alembic head：`0010_work_order_assignee`（新增 `work_orders.assignee_id`、`accepted_by_id`）
- 结论：R5-01—R5-08 已修复并有回归；S5-01—S5-12 自评 **12/12 验证通过**。
  阶段仍为“待审核”，等待复审通过后才进入阶段 6。
- 旧报告 [05-field-work.md](05-field-work.md) 保留为历史，不覆盖。

## R5-01—R5-08 逐项修复

| 编号 | 四态结果 | 修复内容 | 回归证据 |
| --- | --- | --- | --- |
| R5-01 | 验证通过 | 新增 `require_target_building`；`access.py` 统一读取计划/任务/问题/工单/保养计划/保养任务并校验原归属；工单无测点时从关联问题解析楼栋；受限身份无法确定楼栋即拒绝。任务生成只遍历范围内启用计划；无照片请求也先校验范围。 | `tests/field/regressions/test_scope.py`：`buildingIds=[]` 对审核、计划启停、派工、保养执行、生成任务均为 403/0；指定楼栋可审核；跨楼栋 403 |
| R5-02 | 验证通过 | 新增迁移 `0010` 保存 `assignee_id`、`accepted_by_id`；派工只接受 `assigneeId`，其他动作携带即 409；接单按身份 ID，物业代接保留原维修人并记录实际接单人；完工只能由 `acceptedById` 提交；历史姓名仅展示。 | `test_order_identity.py`：篡改维修人 409、同名不同 ID 拒绝、错人完工 409、物业代接与代交成功；后端全量测试 |
| R5-03 | 验证通过 | 只有 `source=sensor` 才能携带事件 ID，其他来源直接 422；问题不再从 payload 回填 `eventId`；事件关闭再次校验工单 `origin=event`、问题 `source=sensor`、问题事件与测点匹配。 | `test_source_binding.py`：人工伪造事件 422；跨测点工单关闭 422；合法传感器链关闭成功 |
| R5-04 | 验证通过 | 审核按状态开放出口；`repairing` 不开放审核；已有未验收工单重复 `to_repair` 返回 409；`recheck` 已有未出结论轮次时拒绝；新维修周期把旧的无结论轮次持久标记 `invalidatedAt/invalidatedReason`，保留历史但不能再出结论。 | `test_review_cycles.py`：重复转维修只有一张工单；新维修后旧轮次结论 422；维修中直接关闭 422 |
| R5-05 | 验证通过 | 新增 `ChecklistAnswerInput` DTO（`ok/abnormal/normal`）与 `normalize_answers`：空字符串在 DTO 层 422；未知 key、重复 key 422；`normal` 显式转为 `ok`；`label` 从快照补；巡检与保养共用。 | `test_answers.py`：巡检四类非法答案全部 422；`normal` 完成并保存快照 label；保养空结果 422 |
| R5-06 | 验证通过 | 巡检/保养生成由 store 在独立操作开始时生成命令 ID，失败重试复用，成功后清空；业务唯一键仍为 `planId@plannedAt`。计划编辑键纳入 `expectedRev`。 | `tests/api/backendFieldKeys.test.ts`、`backendGenerateKeys.test.ts`：独立操作键不同、失败重试同键、计划 rev 变化产生不同键 |
| R5-07 | 验证通过 | `kind=acceptance` 只允许 safety 且必须归属工单；补缩略图图片校验；`noPhotoReason` 写入问题时间线与审计；关联已关闭事件与已关闭问题一致要求不少于 10 字专门依据。 | `test_evidence.py`：维修人 acceptance 403；无照片原因可从时间线与审计查到；关闭事件短依据 422、长依据 200 |
| R5-08 | 验证通过 | 拆分 `createHttpClient`、`reportInspectionIssue`、`savePlan`；新增 TypeScript AST 工具测试，扫描本阶段实际改动文件，函数≤80 行、参数≤5、文件≤450 行。 | `npm run test:tooling` 5 pass；Python 递归结构门禁通过 |

## S5-01—S5-12 完成度

| 编号 | 四态结果 | 依据 |
| --- | --- | --- |
| S5-01 | 验证通过 | `test_plans.py` 新增真实断言：重复生成不重复、改计划不改旧快照、次日新快照；HTTP 也生成巡检任务 |
| S5-02 | 验证通过 | 错标签/人工原因/必答项/角色拒绝；答案 DTO 空值、未知 key、重复 key 均 422 |
| S5-03 | 验证通过 | 四种来源可追溯；人工伪造事件 422；同 submissionId 重试只建一次；独立上报不合并 |
| S5-04 | 验证通过 | 六种出口仍可用；状态转移表、重复转维修、旧复查失效均有回归 |
| S5-05 | 验证通过 | 问题/事件/保养双向关联；自关联、跨范围、不存在目标拒绝 |
| S5-06 | 验证通过 | 派工/接单/完工/验收全部按身份 ID；篡改维修人、同名不同 ID、错人完工均拒绝 |
| S5-07 | 验证通过 | 验收只到 `pending_recheck`；recovered/observing/recurred 与旧轮次失效回归 |
| S5-08 | 验证通过 | 当前事件合法工单关闭成功；旧事件/人工伪造工单被拒；二次关闭 409 |
| S5-09 | 验证通过 | 真实字节/哈希、3 张与 600 KB、所有权、测点、唯一归属、草稿补传；acceptance 身份限制 |
| S5-10 | 验证通过 | 问题/工单/保养三条审计故障回滚，核对状态、关系、附件、审计与回执 |
| S5-11 | 验证通过 | 三项指标/CSV/事件报告从数据库重算；页面显示 6 行问题、4 行工单 |
| S5-12 | 验证通过（同引擎独立源） | 页面完成 ISS-20261019-003 → WO-20261019-004 → 接单 → 完工 → 验收 → 复查 recovered 全链；刷新、API 重启、`localhost:5181` 独立源（全新 localStorage/IndexedDB）读取一致；未取得第二款浏览器引擎 |

## 真实运行与页面办理链

隔离临时库（`0010`）通过真实 HTTP 完成设备问题→维修→验收→复查恢复、结构问题→排查/观察→复发、
退回补充、验收退回后重办、保养异常转问题、当前事件工单关闭事件。证据：
[verification.json](../../evidence/stage5-field/verification.json)。

页面（IAB，5181）完整办理链：

1. 打开 `ISS-20261019-003`，页面选择“转维修工单/设备故障”，提交审核，生成 `WO-20261019-004`。
2. 页面选择“演示维修人员（维修人员）”派工，提示“已流转到「已派工待接单」”。
3. 顶栏切换为维修人员，页面识别“当前身份与该指派一致”，点击接单，提示“处理中”。
4. 页面填写措施“页面办理：更换固定件并复紧”、材料与说明，提交待验收；提交时间为
   `2026-10-19 18:43`。
5. 切回 safety，填写“页面验收：措施与时间线完整，进入待复查”，验收通过。
6. 页面登记复查“页面复查：复测裂缝宽度”，目标日期 2026-10-19；记录 `recovered`，
   问题关闭。
7. 后端核对：问题 `closed`、工单 `verified`、`assigneeId=demo-repair`、
   `acceptedById=demo-repair`、`submittedAt` 存在、复查结论与依据存在。

页面证据：[page-verification.json](../../evidence/stage5-field/page-verification.json)。
截图接口仍报 `surface preparation timeout`，未伪造截图；以 DOM 文本、操作动作和后端对象交叉核对。

## 自动化验证

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80 -q` | 200 passed，88.92% | 0 |
| `uv run ruff check src tests migrations` | All checks passed | 0 |
| `uv run ruff format --check src tests migrations` | 171 files already formatted | 0 |
| Python 递归结构门禁 | 0 违规 | 0 |
| `npm test` | 115 文件 / 1140 用例 | 0 |
| `npm run test:tooling` | 5 pass（含 TS/Vue 结构门禁） | 0 |
| `npm run typecheck` | 通过 | 0 |
| `npm run build` | 通过，5.47s；主包 1001.39 kB 警告 | 0 |

回归测试新增 18 项（`tests/field/regressions`）与 4 项前端命令键测试；原有阶段 4 全部测试仍通过。
逐项命令记录：[test-run.json](../../evidence/stage5-field/test-run.json)。

## 备份、迁移与容器

- 临时库：备份→校验→恢复至独立目录，10 张表计数一致，2 个媒体文件 SHA-256 一致；
  恢复 API 读取 issues=6、orders=4、closed=2、ISS-003 closed、WO-004 verified。
- 容器：先在正式数据卷上备份并校验（0009 快照，8 个媒体文件），再重建触发
  `0010` 迁移；migrate 退出 0、API healthy；业务表计数与迁移前完全一致（5 楼栋、8 测点、
  18 记录、2 事件、9 通知、46 审计、56 回执、8 媒体）。恢复副本为 0009 快照，8 个媒体文件可读。
- 查寝端口：本轮早先检查 8000/5173 为 200；最终复检时两个端口均无监听（本轮只执行筑瞳
  compose，没有停止或改动查寝）。因此“重建后两项目端口并存”这一项**本轮未验证**，
  列为环境阻塞，需查寝恢复后复验。

## 已知限制

- IAB 截图接口失败；不伪造截图。
- “独立浏览环境”使用同一 IAB 引擎的 `localhost` 独立源，不是第二款浏览器内核；
  未声称跨内核验证。
- 主包 1001.39 kB 仍超过 900 kB 提示；本阶段未做全局拆包。
- 查寝当前未监听，端口并存待复验。
- 旧报告中的 `S5-01` 测试引用已补上；旧报告保留为历史。

## 提交材料

- 返修代码提交 SHA：提交后填写
- 契约：[field-work-v1.md](../../contracts/field-work-v1.md)
- HTTP/页面/备份/部署/命令证据：`docs/implementation/evidence/stage5-field/`
- 复现：`backend/scripts/stage5_http_verify.py`（临时 API 18001；需先初始化独立库）

阶段 5 保持“待审核”。请复审 R5-01—R5-08 与页面完整办理链；复审通过前不进入阶段 6。
