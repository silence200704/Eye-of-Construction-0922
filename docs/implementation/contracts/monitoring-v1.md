# 档案、监测与预警接口 v1（阶段 4 已实现）

本文件记录阶段 4 冻结并实现的契约。路径前缀为 `/api/v1/datasets/{dataset_id}`；
当前演示数据集为 `demo-main`，`datasetEpoch` 从服务端读取。

## 信封与请求头

- 读取：`GET`，`Authorization: Bearer <token>`，返回 `{ ok, data, rev, replayed, meta }`，
  `meta.datasetEpoch` 为当前数据集 epoch。
- 写入：`POST/PATCH`，另需 `Idempotency-Key` 与 `X-Dataset-Epoch`。
  - 缺 `Idempotency-Key` → `400 IDEMPOTENCY_KEY_REQUIRED`
  - 缺 `X-Dataset-Epoch` → `400 DATASET_EPOCH_REQUIRED`
  - epoch 与当前数据集不一致 → `409 DATASET_EPOCH_CONFLICT`，不落库
- 同键同内容重放 → `200`，`replayed=true`，返回原回执对象；同键不同内容 → `409 IDEMPOTENCY_CONFLICT`。
- 幂等摘要包含 HTTP 方法、路径、操作类型与业务载荷；同一键用于不同通知/事件/记录时
  不会复用成功回执，而是返回 `409 IDEMPOTENCY_CONFLICT`。
- `rev` 是行乐观锁；修改必须携带 `expectedRev`。监测记录的 `revision` 是业务修订次数
  （旧库从 0 开始），与行版本 `rev` 分开。

## 权限矩阵（服务端校验，客户端字段不作为授权依据）

| 动作 | 允许身份 |
| --- | --- |
| 楼栋/楼层/测点/设备建档、修改、归档/恢复 | safety、device |
| 基准值版本写入 | safety、device |
| 预警规则建档/新版本 | safety、device |
| 监测记录录入、修订、CSV 提交 | safety、property、device、inspector |
| 确认/关闭预警事件 | safety |
| 通知展示/确认/超时核验 | safety、property、device、inspector、repair |

账号 `buildingIds` 非空时，写楼栋/楼层/测点/设备/记录前校验对象所属楼栋；
读取仍可浏览全校，但跨数据集对象 ID 一律 404。

## 档案接口

| 方法/路径 | 说明 |
| --- | --- |
| GET `/archive` | 楼栋、楼层、测点、设备、基准、规则、最近 500 条审计与 epoch |
| GET `/state` | 数据集 id、epoch、各表计数 |
| GET `/audits?limit=` | 审计列表 |
| POST `/buildings`、PATCH `/buildings/{id}` | 建档/修改；编号唯一，占位坐标 0—1 |
| POST `/floors`、PATCH `/floors/{id}` | 楼层号在同一楼栋唯一，楼层必须属于指定楼栋 |
| POST `/points`、PATCH `/points/{id}` | 坐标 0—1、测点编号唯一、启用 NFC 全校唯一；位置变化必须写原因并追加 `locationHistory` |
| POST `/devices`、PATCH `/devices/{id}` | 设备编号唯一、量程上限大于下限、绑定测点必须存在 |
| POST `/archive/{id}/archive`、`/restore` | body `{kind, expectedRev, reason}`；有在册测点时楼栋/楼层不能归档；归档测点级联归档其设备；恢复先校验上级在册 |

归档不删除对象，历史记录仍可解释；`legacy_payload` 只读溯源，不参与业务写入。

## 基准与规则版本

| 方法/路径 | 说明 |
| --- | --- |
| GET `/baselines?pointId=` | 全部版本 |
| POST `/baselines` | `{pointId, values, unit, reason, effectiveFrom, expectedVersion}`；版本号自增，旧版本 `current=false`，新版本 `current=true` |
| GET `/rules` | 全部规则版本行 |
| POST `/rules` | 仅测试/初始化使用，创建定义与 V1.0 |
| POST `/rules/{ruleId}/versions` | 修改生成新版本；必须同时携带 `expectedRev` 与 `expectedVersion`；新 `effectiveFrom` 不得早于当前版本 |

判定按采样时间选取“当时生效”的基准与规则版本；历史记录保存
`baselineVersion/baselineValues/ruleVersion/ruleSnapshot/assessment`，不会用最新阈值重算历史。

## 监测接口

| 方法/路径 | 说明 |
| --- | --- |
| GET `/records?pointId=&limit=` | 按采样时间升序，最多 5000 条 |
| POST `/records` | `{pointId, deviceId, values, unit, sampleTime, sampleWindow, source, quality, qualityNote, note}`；记录、判定、事件/通知、审计、回执同一事务 |
| POST `/records/{id}/revisions` | 必须带 `expectedRev` 与 `reason`；原值、原快照写入 `revisions`，`recordRevision+1`，按新采样时间重取基准与规则版本 |
| POST `/assessments/preview` | 只读试算，不产生记录、事件或通知 |
| POST `/records/import-preview` | 逐行返回 `lineNo/status/payload/messages` 与 `token`；不写库 |
| POST `/records/import` | `{csvText, token, lineNos, fileName}`；重读档案、规则、基准和记录；token 不一致 → `409 PREVIEW_STALE`；选中有效行整批原子提交，任一行失败整批回滚 |

校验与旧引擎同口径：缺项不按零、质量存疑/无效不判定、超设备量程标无效、振动必须写统计窗口、
同测点同分钟不重复、采样时间不得晚于当前（5 分钟容差）、历史补录必须写说明。
记录、修订、试算与 CSV 共用测点入口，按测点所属楼栋校验账号范围；越权返回 `403 SCOPE_FORBIDDEN`。

历史补录/历史修订只存档并保留判定快照，不驱动当前事件状态；只有测点最新采样时刻的记录
可以建单、升级、恢复或覆盖事件状态。

## 事件与通知

| 方法/路径 | 说明 |
| --- | --- |
| GET `/events?status=all|open|closed` | 事件含证据、被替代证据、升级历史、时间线 |
| GET `/notifications?eventId=` | 站内通知 |
| POST `/events/{id}/acknowledge` | 仅 safety；`pending→handling`；同事件未确认通知一并确认 |
| POST `/events/{id}/close` | 仅 safety；仅 `recovering`；必须填 `basis` 与阶段 4 的 `noRepairNote`；关闭依据与时间线、审计同事务 |
| POST `/notifications/{id}/present` | 首次展示登记 `presentedAt`；重复调用不重复写 |
| POST `/notifications/{id}/acknowledge` | 登记确认人/时间；不冒充短信送达 |
| POST `/notifications/escalate` | 服务端时间核验未确认、未升级且超时的通知；已关闭事件的通知跳过；只升级一次，`escalationSource=""` |

事件按“数据集 + 测点 + 稳定 ruleId”归并；未关闭时只有一条。等级只升不降，
`peakLevel` 与 `upgrades` 保留历史；恢复只把事件标为 `recovering`，不自动关闭。
恢复待确认被新的越限读数推翻时，事件退回 `pending`（未确认）或 `handling`（已确认），
恢复状态不再成立，且不能凭旧恢复状态关闭。
修订会把旧证据移入 `supersededEvidences`，同一条记录最多一条活跃证据；事件已关闭后
修订旧证据只更新记录，不新建第二事件。
规则版本按采样时间先选当时生效版本，再判断启停；停用的最新版本不会被旧版本绕过，
记录判定为 `excluded`（规则未启用）。

## 主要错误码

`VALIDATION_FAILED`、`INVALID_FLOOR`、`INVALID_COORDINATE`、`DUPLICATE_CODE`、
`DUPLICATE_NFC`、`DUPLICATE_FLOOR`、`DEPENDENTS_ACTIVE`、`PARENT_ARCHIVED`、
`REVISION_CONFLICT`、`EXPECTED_REV_REQUIRED`、`EXPECTED_VERSION_REQUIRED`、
`IDEMPOTENCY_KEY_REQUIRED`、`IDEMPOTENCY_CONFLICT`、`DATASET_EPOCH_REQUIRED`、
`DATASET_EPOCH_CONFLICT`、`PREVIEW_STALE`、`INVALID_ROWS`、`STATE_CONFLICT`、
`ROLE_FORBIDDEN`、`SCOPE_FORBIDDEN`、`NOT_FOUND`。

## 阶段边界

- 阶段 4 关闭事件只接受“无需维修”现场核查结论；关联已验收工单分支在阶段 5 接通。
- 通知超时按服务端真实时间核验；演示时钟在阶段 10 接入，本阶段不使用模拟时间。
- 演示数据复位/清空在阶段 10 接入；当前服务端模式明确暂停旧浏览器演示写入入口。
- 巡检、问题、工单、保养仍以 IndexedDB 为权威，阶段 5 迁移。
