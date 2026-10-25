# 小瞳问答契约 v1（阶段 7）

日期：2026-10-24。状态：阶段 7 返修待复审。本契约只覆盖小瞳问答、会话与影像会话；
舞台统一控制与复位仍归阶段10；2026-10-24计划修订后，OpenHarmony原生App归阶段8—9，双端视觉归7A。
返修基线：独立审核 R1—R10；迁移 head `0013_assistant_session_epoch`。

## 1. 原则

- 不调用外部生成或向量 API；业务事实只读当前服务端数据库，知识只来自阶段 6 本地知识库。
- 预设问法与自由输入走同一条解析路径；问句与知识原文都是数据，永远不能变成命令。
- 回答中的业务事实、知识引用与导航建议分列标注；建议不等于已执行。
- 小瞳不提供写入或办理动作：写入请求只返回拒绝与工作台/系统设置导航。
- 对象解析按稳定 ID；无对象、同名多项或越权时澄清或明确失败，不使用默认对象兜底。

## 2. 数据契约

### 2.1 回答 `answer`

| 字段 | 语义 |
| --- | --- |
| `intent` | `point_status`、`point_trend`、`event_reason`、`open_events`、`campus_overview`、`issue_status`、`reading_recovery`、`event_replay`、`case_search`、`rule_simulate`、`knowledge`、`demo_command`、`spatial_go`、`media_compare` 等 |
| `status` | `answered`、`need_choice`、`clarify`、`not_found`、`unsupported` |
| `conclusion` | 一句话结论；缺数据时写缺什么，不写“正常” |
| `facts[]` | `{label,value,unit}`；只来自本次服务端查询 |
| `evidence[]` | `{kind:record/event,ref,id,detail}`；编号可回查 |
| `objects` | `{pointId,eventId,issueId,workOrderId,buildingId}`，全部可为 null；不使用名称代替 ID |
| `links[]` | `{kind,objectId}`，前端只按 `actions.ts` 白名单生成路径 |
| `citations[]` | 知识引用：`documentId/chunkId/title/version/sha256/lineStart/lineEnd/sourcePath/methods` |
| `knowledge` | `{decision:answer/clarify/no_basis/unavailable,mode,indexVersion,reason,excerpt}` |
| `sources` | `{facts:server_db/none,knowledge?:local_kb/...,queriedAt}`；业务事实与知识来源分开 |
| `snapshot` | 业务回答附带：查询时刻、对象 `{id,rev}`、记录 `{id,rev,recordRevision}`、规则/基准版本；历史轮次不重算 |
| `historical` | 会话恢复时，引用对象失效/归档/越权/知识停用的轮次置 true，正文脱敏且 `sources.facts=none` |
| `gaps[]` | 缺对象、缺依据、缺记录等限制，前端展示为限制说明 |
| `followups[]` | 最多 3 条建议问法，不执行 |
| `dataNotes[]` | 数据口径、演示关联、未执行等说明 |
| `extras` | 趋势样本、回放节点、案例行、试算行等结构化结果，仅服务端返回 |

### 2.2 会话

- `session_id` 按 `dataset_id + actor_id + epoch` 隔离；跨身份读取返回 404。
- 每轮保存 `question`、完整 `answer`、`seq`、`created_at`，与回答同事务写入；提问命令复用幂等键、
  回执与审计，同键同内容重放原轮次，同键异内容 409。
- 幂等重放不重新执行业务，但输出必须按**当前**授权重新投影：助手回答不可见时返回与 GET 会话相同的
  脱敏占位；媒体帧/比对/视频/分析所属测点已越权或归档时返回 404。重放不得新增轮次、审计或回执。
- 数据集的 epoch 保存在会话上；epoch 变化后旧会话读取/追加返回 410 `STALE_SESSION`，
  新提问建立新 epoch 会话。前端存储键绑定身份、数据集与 epoch。
- 会话恢复按当前身份、角色、楼栋范围、对象状态与知识启用状态逐轮复核：不可见的轮次返回
  `historical=true` 的脱敏占位，不返回原业务正文。
- 前端恢复请求在发起时捕获 actor/dataset/epoch/角色/楼栋范围与 generation；即使当前没有轮次或
  sessionId，身份、范围或 epoch 变化也会使在途恢复失效。所有 await 之后、回填与存储之前重新核对；
  同一 user id 的楼栋范围收窄同样清除已取回媒体字节。清理只针对原请求键，不误删新身份会话。

### 2.3 知识入口

- 有具体对象（编号、楼栋、楼层或上下文 ID）时，实时事实优先；对象不存在或越权保持业务失败，
  不得改写成知识成功。
- 没有点名任何对象的概念问题，若本地检索返回 `answer/clarify`，交给知识回答；`no_basis` 仍明确无依据。
- 检索返回 `null`（异常降级）时，显式对象仍按业务 `not_found`/事实回答，知识题返回
  `knowledge.decision=unavailable`，不得抛 500。
- 20 条标准 FAQ 与冻结 60 题分别从 `/knowledge/search` 与 `/assistant/query` 两路核对；
  冻结题目的 SHA 与期望答案不改，阶段 6 三条旧错答保留失败记录。

## 3. 影像与视频会话

- `POST /media` 上传原字节；`POST /media-sessions/frames` 登记关键帧（媒体必须属于同测点）；
  可携带 `videoId/timeCode` 把抽帧绑定到已登记视频。
- `POST /media-sessions/comparisons` 保存真实算出的比对结果；前后帧必须属于同一测点。
- `POST /media-sessions/videos` 登记视频原字节与元数据（文件名、标题、来源、素材键、可比性、备注），
  同媒体同元数据幂等重放，异内容 409；`POST /media-sessions/videos/{id}/analysis` 保存区域/关键帧分析。
- 视频分析只接受服务端身份：`analysis.videoId` 必须等于该视频，`pointId` 必须等于该测点，
  `frameIds` 与区域 `beforeId/afterId` 必须属于该视频/测点；本地 `video_*`/`media_*` 身份一律 422。
- Web 保存分析前等待关键帧登记完成，把 videoId、frameIds、区域前后帧 ID 整张映射为服务端 ID；
  任一项未登记则明确不保存，不拿本地 ID 兜底。
- 帧、比对、视频、比对列表和 `summary` 均按测点逐项校验楼栋范围；受限身份没有 pointId 时也不能
  通过列表或摘要读到范围外元数据。
- `GET /media-sessions/summary?pointId=` 返回帧、比对、视频与最新采样时间；帧元数据含来源、
  文件名、大小、宽高、时间码、视频 ID 与受保护 `contentUrl`。
- 客户端不得保存 `blob:` URL；刷新后通过 `/media/{id}/content` 按身份重建预览。
- 来源（上传/演示生成/视频抽帧/公开参考）从上传贯通到恢复；模拟素材如实标注，不冒充实拍。
- 影像差异不进入预警判定，不给毫米数，不自动生成事件。

## 4. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/datasets/{datasetId}/assistant/query` | 提问；写会话与轮次；幂等键 |
| GET | `/api/v1/datasets/{datasetId}/assistant/sessions` | 当前身份的会话列表 |
| GET | `/api/v1/datasets/{datasetId}/assistant/sessions/{id}` | 轮次；跨身份 404 |
| GET/POST | `/api/v1/datasets/{datasetId}/media-sessions/frames` | 关键帧读取/登记 |
| GET/POST | `/api/v1/datasets/{datasetId}/media-sessions/comparisons` | 比对读取/保存 |
| GET/POST | `/api/v1/datasets/{datasetId}/media-sessions/videos` | 视频元数据读取/登记 |
| POST | `/api/v1/datasets/{datasetId}/media-sessions/videos/{id}/analysis` | 视频区域/关键帧分析保存 |
| GET | `/api/v1/datasets/{datasetId}/media-sessions/summary` | 帧 + 比对 + 视频 + 最新采样 |
| GET | `/api/v1/datasets/{datasetId}/media/{mediaId}/content` | 受保护原字节 |

请求上下文 `context`：`chosen/pointId/eventId/issueId/workOrderId/pointIds/caseIds/replayNode/videoId/simulation/source(page/previous/explicit)`。
问句中的显式编号优先于上下文；显式工单先绑定其真实问题/事件/测点关系，再用兼容的旧上下文补齐。
同一问句的显式工单与问题编号不一致时返回明确失败，不拼成一条回答。同一问句命中多个测点/事件时
先返回候选。候选点击必须携带 `chosen=true` 且 ID 属于本轮候选，服务端才采用；旧上下文单独存在时
不代替用户选择。上下文对象不存在或越权时明确失败。所有写接口要求 `Idempotency-Key` 与 `X-Dataset-Epoch`。

## 5. 权限、写入与失败

- 全部读写沿用五类预置身份与楼栋范围；隐藏字段或前端提示不作为授权依据。
- 概况与问题池共用范围边界：楼栋级无测点问题按 `buildingId` 授权，工单按关联问题或测点授权；
  `pointId=None` 不代表全范围。记录总数对全部授权测点聚合，不做未声明的截断。本阶段同时修复
  `GET /issues` 已证实的列表旁路；其他尚未复验的旧列表另行跟踪。
- 会话轮次、帧、比对、视频、分析均通过既有命令执行器写入：业务内容、审计与幂等回执同事务；
  失败整体回滚，重试不增加行数。
- 越权/不存在对象返回 `not_found`；旧 epoch 写入 409 `DATASET_EPOCH_CONFLICT`；旧 epoch 会话
  读取/追加 410 `STALE_SESSION`；检索失败返回 `knowledge.unavailable`；无依据返回
  `no_basis` 且不产生引用；后端断开时前端显示“无法读取服务端小瞳回答”，不补造结果。
- 知识引用打开前核对文档版本与片段哈希；版本或哈希不一致时不展示旧文。

## 6. 明确不做

- 不接外部大模型、嵌入 API、摄像头或校园监控；不做真实视觉识别或准确率声明。
- 不在本阶段实现OpenHarmony App（阶段8—9）、完整双端视觉落地（阶段7A）或舞台统一控制/复位（阶段10）。
