# 现场业务接口 v1（阶段 5 返修后，待审核）

路径前缀 `/api/v1/datasets/{dataset_id}`。写请求复用阶段 4 的 `Authorization`、
`Idempotency-Key`、`X-Dataset-Epoch`、`expectedRev`、审计、回执与函数作用域写会话；
业务写、双向关联、附件归属、审计与回执在同一事务提交，提交成功后才返回成功。
Alembic head 为 `0010_work_order_assignee`（工单 `assignee_id`、`accepted_by_id`）。

## 状态与权限矩阵

| 对象 | 合法状态 / 转移 | 动作与允许身份 |
| --- | --- | --- |
| 巡检计划 | 启停由 `enabled` 表达，不删除历史 | 新建/编辑 safety、device；启停 safety |
| 巡检任务 | `pending → partial → checked`，由逐点结果推导 | 生成 safety、property、device；到点/完成/上报限任务快照的执行角色本人 |
| 问题 | `pending_review`、`repairing`、`investigating`、`pending_recheck`、`observing`、`closed` | 上报 safety、property、device、inspector、repair；预警转单仅 safety；审核、复查登记、复查结论仅 safety |
| 工单 | `created → assigned → repairing → submitted → verified / returned`；`returned → repairing → submitted` | 派工 safety；接单/完工 repair；物业值班可代接但必须写原因并记录实际接单人；验收 safety；维修人不能验收或自行改派 |
| 保养计划 | 启停由 `enabled` 表达 | 新建/编辑 safety、device；启停 safety |
| 保养任务 | `pending → done`，一个周期只执行一次 | 生成 safety、property、device；执行 safety、property、device、repair |
| 附件 | 唯一归属问题/工单/保养任务 | 随上报、审核、完工、验收、保养执行命令写入 |

账号 `buildingIds` 非空时，计划、任务、问题、工单、保养任务与附件按对象楼栋校验；
越权返回 `403 SCOPE_FORBIDDEN`。写入校验发生在读取目标后、任何状态/附件判断之前，
不依赖请求是否携带照片；受限身份不能操作无法确定楼栋的工单。任务生成只遍历操作者范围内的
启用计划。人员姓名只作历史字段，授权按身份 ID 与角色。

## 巡检计划与任务

| 方法/路径 | 说明 |
| --- | --- |
| GET `/inspection/plans` | 计划列表 |
| POST `/inspection/plans` | 计划草稿；`kind=inspection/patrol`，周期 `day/week/month + interval + atTime` |
| PATCH `/inspection/plans/{id}` | 必须带 `expectedRev` |
| POST `/inspection/plans/{id}/enabled` | `{expectedRev, enabled}` |
| GET `/inspection/tasks` | 任务列表，含生成时冻结的 `planSnapshot` 与逐点结果 |
| POST `/inspection/tasks/generate` | `{date}`；业务键 `planId@plannedAt`，重复生成不重复建单 |
| POST `/inspection/tasks/{id}/check-in` | `{expectedRev, pointId, method=nfc/manual, labelRead, fallbackReason}`；错标签不通过；人工签到必须写原因；成功/失败尝试都追加 `attempts` |
| POST `/inspection/tasks/{id}/complete-point` | `{expectedRev, pointId, answers, linkedIssueId, noIssueReason}`；未到点、必答项缺失、异常无后续依据均拒绝 |
| POST `/inspection/tasks/{id}/issues` | `{expectedRev, pointId, anomalyType, description, submissionId, photos}`；问题与任务关联同事务；同 `submissionId` 重试只补照片 |

任务状态只由 `results` 推导。`arrived` 不算完成，部分点位完成是 `partial`，不能当作任务完成。
修改计划不回写已生成任务的快照。`linkedIssueId` 必须是本任务、本点位且未关闭的问题。
`answers` 使用 DTO：`key` 必须来自任务快照，`result` 只能是 `ok/abnormal`（旧值 `normal`
显式转换为 `ok`）；空字符串、未知 key、重复 key 都返回 `422`，服务端用快照补 `label`。

## 问题上报与审核

| 方法/路径 | 说明 |
| --- | --- |
| GET `/issues` | 问题池 |
| POST `/issues` | `{source=report/sensor, pointId, buildingId, floorId, zoneId, anomalyType, description, submissionId, eventId?, photos}`；`submissionId` 必填；同一次上报重试不重复建单并补关联照片；独立上报不按时间桶合并。`eventId` 只允许 `source=sensor`，且服务端必须校验事件、测点、楼栋与身份；其他来源携带事件 ID 返回 `422` |
| POST `/issues/{id}/review` | `{expectedRev, action, category, note, duplicateOf?, linkedEventId?, photos, noPhotoReason}` |
| POST `/issues/{id}/rechecks` | `{expectedRev, subject, owner, dueDate}`；仅待复查/观察中，且不能有未出结论的轮次 |
| POST `/issues/{id}/rechecks/outcome` | `{expectedRev, outcome=recovered/observing/recurred, note, nextDueDate?}` |

六种审核出口与二级分类：

| 出口 | 允许分类 | 状态结果 |
| --- | --- | --- |
| `to_repair` | equipment、general | `repairing`，同事务生成待派工工单 |
| `to_investigate` | crack、tilt、structure | `investigating` |
| `recheck` | unclear、remeasure | `pending_recheck` |
| `need_evidence` | image、location、description、measurement | `pending_review` |
| `link_object` | issue、event | `closed`；目标必须存在、在范围内、不能自关联；双向时间线同事务 |
| `close_no_fault` | no_fault、false_alarm、reading_stable、non_structural、handled | `closed` |

审核意见不少于 4 字；退回补充、关闭、转专业排查不少于 10 字；`handled` 必须有照片或
不少于 10 字的无照片原因。审核不覆盖原描述；已关闭问题不能再审核。

复查三种结论：`recovered` 关闭问题；`observing` 保持观察中并登记下一轮；`recurred`
回到 `pending_review` 继续处置，不新建无关问题。复查按轮次追加，历史轮次不覆盖。

审核转移受问题状态约束：`pending_review` 可用六种出口；`investigating` 可转维修、复查、
退回补充、关联或关闭；`pending_recheck / observing` 可转维修、复查、关联或关闭；
`repairing` 不开放审核，必须先完成并验收工单。已有未验收工单时重复 `to_repair` 返回
`409 STATE_CONFLICT`。开始新的维修处置周期时，旧的无结论复查轮次保留历史并写
`invalidatedAt/invalidatedReason`，不能再用于登记结论或关闭问题；验收后必须重新登记复查。
`recheck` 在已有未出结论轮次时拒绝重复安排。

## 工单与事件关闭

| 方法/路径 | 说明 |
| --- | --- |
| GET `/work-orders` | 工单列表 |
| POST `/work-orders` | 手工建单（safety） |
| POST `/work-orders/{id}/actions` | `{expectedRev, to, note, assigneeId?, dueAt?, measures?, materials?, photos}` |

派工必须用 `assigneeId` 指定启用且具备维修/物业身份的人，服务端保存 `assigneeId` 与姓名快照；
其他动作携带 `assigneeId` 返回 409。接单必须由 `assigneeId` 对应身份执行；物业值班可代接但
必须写原因，`acceptedById` 记录实际接单人，原 `assignee/assigneeId` 不被改写。提交完工只能由
`acceptedById` 执行；姓名相同但身份 ID 不同不授予权限。提交待验收必须有维修措施；验收退回
必须有理由；验收通过只把关联问题推进到 `pending_recheck`，不直接关闭问题或预警。
每次验收动作追加 `reviews`，不清空上一次结论。

事件关闭仍按阶段 4：必须处于 `recovering`，并重新核验当前有效采样序列。处置依据只接受
**当前事件**关联且 `verified` 的工单，或 safety 填写的合法“无需维修”现场核查结论；
工单必须来自该事件的传感器问题链（`origin=event`、问题 `source=sensor`、问题 `eventId`
与测点均匹配），同测点旧事件或人工问题伪填的工单不能借用。任务完成、工单验收、问题关闭、
事件关闭是四个独立结果。

## 附件与保养

| 方法/路径 | 说明 |
| --- | --- |
| POST `/media?fileName=&pointId=&capturedAt=` | 上传真实图片；返回 `id/sha256/size/width/height/contentUrl`；同草稿键重试复用 |
| GET `/attachments` | 业务附件列表 |
| POST `/maintenance/plans`、PATCH `/maintenance/plans/{id}`、`/enabled` | 保养计划 |
| GET `/maintenance/tasks`、POST `/maintenance/tasks/generate` | 周期任务；业务键 `planId@plannedAt` |
| POST `/maintenance/tasks/{id}/execute` | `{expectedRev, answers, measures, materials, nextDueDate, note, abnormalNote, createIssue, photos}` |

照片规则：每个业务归属最多 3 张、总计 600 KB、必须是图片；只能关联本人上传的媒体（safety
可关联任意上传）；测点必须与归属对象一致；一张媒体只能有一个业务归属；`draftId` 重试
不重复占配额。`kind=acceptance` 只允许 safety 提交且必须归属维修工单，维修人不能把现场照片
伪装为验收证据。照片先上传、业务命令提交未完成时，可用同一草稿重试补关联；未上传成功不得
显示为“证据已提交”。“已当场处理”使用 `noPhotoReason` 时，原因写入问题时间线和审计；
关联已关闭问题或已关闭预警事件都要求在审核意见中写明不少于 10 字的专门依据。

保养执行必须完成必答项、填写措施、合法的下次日期；有异常项必须说明，`createIssue=true`
时任务执行记录与问题双向关联并在同一事务提交，重试不重复建问题。没有异常不能转问题。

## 报表

| 方法/路径 | 说明 |
| --- | --- |
| GET `/reports/indicators?start=&end=&buildingId=&pointId=` | 三项指标；按数据库明细计算；分母为 0 返回 `value=null` |
| GET `/reports/export?kind=events/issues/orders/maintenance/tasks/rechecks&...&status=` | 中文表头与明细行；时间/楼栋/测点/状态筛选 |
| GET `/reports/events/{id}` | 单事件处置报告：事件证据、提醒确认、问题工单、关闭依据、合并时间线 |

指标口径：

1. **预警响应时长（小时）**：分母为范围内已响应事件；首次响应取人工确认与转出问题中更早
   的时间；未响应事件进不纳入清单。
2. **问题按期闭环率**：分母为范围内已关闭且登记过复查的问题；按最后复查目标日期当天
   23:59:59 前关闭计按期；已关闭但从未登记复查、仍未关闭的问题单列，不进分母。
3. **复查 / 保养按期完成率**：复查按结论时间与轮次目标日期，保养按执行时间与计划执行日；
   尚未出结论的复查轮次、未完成保养任务单列，不进分母。

`observing` 不是最终闭环，不计入问题关闭率；任务 `partial` 不等于完成；验收率不冒充问题
关闭率。

## 主要错误码

`VALIDATION_FAILED`、`REVIEW_INVALID`、`RECHECK_INVALID`、`CHECK_INCOMPLETE`、
`MAINTENANCE_INVALID`、`ATTACHMENT_LIMIT`、`STATE_CONFLICT`、`ROLE_FORBIDDEN`、
`SCOPE_FORBIDDEN`、`NOT_FOUND`、`REVISION_CONFLICT`、`EXPECTED_REV_REQUIRED`、
`IDEMPOTENCY_KEY_REQUIRED`、`IDEMPOTENCY_CONFLICT`、`DATASET_EPOCH_REQUIRED`、
`DATASET_EPOCH_CONFLICT`、`CLOSE_BASIS_REQUIRED`。
