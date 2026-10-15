# 数据集与媒体 HTTP 约定

前缀 /api/v1。全部接口需要服务端内部 Bearer 会话，页面仍无账号密码登录。
数据集必须存在且启用，楼栋范围以数据库中当前身份为准。

| 方法和路径 | 输入 | 结果 |
| --- | --- | --- |
| GET /datasets | 无 | 可用测试数据集 id/name/kind/epoch |
| POST /datasets/{datasetId}/media | 原始文件字节，请求头 Content-Type；query fileName 必填，pointId/origin/capturedAt 可选；Idempotency-Key 可选 | 新上传 201，匹配重试 200、replayed=true |
| GET /datasets/{datasetId}/media/{mediaId} | 无 | 媒体元数据 |
| GET /datasets/{datasetId}/media/{mediaId}/content | 无 | 原始字节；私有缓存策略，按 MIME 返回 |
| POST /datasets/{datasetId}/attachments | mediaId/draftId/kind；thumbId 可选；issueId/workOrderId/maintenanceTaskId 恰好一个 | 新关联 201，匹配重试 200、replayed=true |

上传采用原始二进制请求体，不是 JSON/base64 或 multipart。
origin 为 upload/video_frame/demo_generated/demo_public/demo_evidence，默认 upload。
媒体 DTO 返回 id、fileName、mimeType、size、sha256、width、height、pointId、origin、capturedAt、uploadedAt、uploadedBy、contentUrl。
storage_key 和服务器路径不返回。MP4 width/height 为 0，表示本阶段未提取尺寸。
Content-Type 只支持 image/png、image/jpeg、image/webp、video/mp4。
暂不转码压缩；未来客户端使用既有图片压缩逻辑后上传正式附件。

关联对象必须是真实存在的同数据集问题、工单或保养任务；限制三张照片、合计 600 KB。
kind 为 scene/before/after/acceptance，验收照片仅安全管理人员可添加。
非安全管理人员仅能关联本人上传文件，上传或读取具备测点的媒体都按楼栋范围验证。
无测点文件仅本人及不受楼栋限制的安全管理人员可读取。

错误沿用统一信封；新增 MEDIA_TOO_LARGE(413)、UNSUPPORTED_MEDIA/MEDIA_TYPE_MISMATCH(415)、
INVALID_MEDIA/ATTACHMENT_LIMIT(422)、MEDIA_MISSING(404)、MEDIA_CORRUPT/IDEMPOTENCY_CONFLICT/STATE_CONFLICT(409)、
ROLE_FORBIDDEN/SCOPE_FORBIDDEN(403)。
单对象配额及幂等校验在事务内执行，失败不留下部分关联或审计记录。

媒体接口已可用，Web 业务页面尚未切换到这些接口；阶段 3—5 按模块接入。
datasetEpoch 请求冲突处理和离线同步协议在阶段 9 实施，本阶段不将其写成已支持。
