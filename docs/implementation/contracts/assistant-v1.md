# 小瞳问答契约 v1（阶段 7）

日期：2026-10-23。状态：阶段 7 待审核。本契约只覆盖小瞳问答、会话与影像会话；
舞台统一控制与复位仍归阶段 10，Android 归阶段 8—9。

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
| `gaps[]` | 缺对象、缺依据、缺记录等限制，前端展示为限制说明 |
| `followups[]` | 最多 3 条建议问法，不执行 |
| `dataNotes[]` | 数据口径、演示关联、未执行等说明 |
| `extras` | 趋势样本、回放节点、案例行、试算行等结构化结果，仅服务端返回 |

### 2.2 会话

- `session_id` 按 `dataset_id + actor_id` 隔离；跨身份读取返回 404。
- 每轮保存 `question`、完整 `answer`、`seq`、`created_at`，与回答同事务写入。
- 数据集 epoch 变化、身份切换或对象失效时，前端清空会话与对象上下文；恢复只读，
  不重放写入、媒体处理、自动导览或演示办理。
- 前端用 `sessionStorage` 记住当前身份与数据集下的 `sessionId`；刷新后读取服务端轮次，
  迟到响应按轮次序号丢弃。

## 3. 影像会话

- `POST /media` 上传原字节；`POST /media-sessions/frames` 登记关键帧（媒体必须属于同测点）。
- `POST /media-sessions/comparisons` 保存真实算出的比对结果；前后帧必须属于同一测点。
- `GET /media-sessions/summary?pointId=` 返回帧、比对与最新采样时间；帧元数据含来源、
  文件名、大小、宽高与受保护 `contentUrl`。
- 客户端不得保存 `blob:` URL；刷新后通过 `/media/{id}/content` 按身份重建预览。
- 影像差异不进入预警判定，不给毫米数，不自动生成事件。

## 4. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/datasets/{datasetId}/assistant/query` | 提问；写会话与轮次；幂等键 |
| GET | `/api/v1/datasets/{datasetId}/assistant/sessions` | 当前身份的会话列表 |
| GET | `/api/v1/datasets/{datasetId}/assistant/sessions/{id}` | 轮次；跨身份 404 |
| GET/POST | `/api/v1/datasets/{datasetId}/media-sessions/frames` | 关键帧读取/登记 |
| GET/POST | `/api/v1/datasets/{datasetId}/media-sessions/comparisons` | 比对读取/保存 |
| GET | `/api/v1/datasets/{datasetId}/media-sessions/summary` | 帧 + 比对 + 最新采样 |
| GET | `/api/v1/datasets/{datasetId}/media/{mediaId}/content` | 受保护原字节 |

请求上下文 `context`：`pointId/eventId/issueId/workOrderId/pointIds/caseIds/replayNode/videoId/simulation/source(page/previous/explicit)`。
问句中的显式编号优先于上下文；上下文对象不存在或越权时明确失败。

## 5. 权限与失败

- 全部读写沿用五类预置身份与楼栋范围；隐藏字段或前端提示不作为授权依据。
- 越权/不存在对象返回 `not_found`；检索失败返回 `knowledge.unavailable`；无依据返回
  `no_basis` 且不产生引用；后端断开时前端显示“无法读取服务端小瞳回答”，不补造结果。
- 知识引用打开前核对文档版本与片段哈希；版本或哈希不一致时不展示旧文。

## 6. 明确不做

- 不接外部大模型、嵌入 API、摄像头或校园监控；不做真实视觉识别或准确率声明。
- 不在本阶段做 Flutter/Android（阶段 8—9）与舞台统一控制/复位（阶段 10）。
