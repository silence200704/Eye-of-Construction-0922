# 旧数据迁移接口 v1

所有路径以 `/api/v1/datasets/{dataset_id}/imports` 为前缀，需要内部演示身份令牌。
仅 role=safety 且 buildingIds=null 的全校安全管理身份可访问；无登录页、账号密码。
HTTP 外层信封沿用 [HTTP 契约](http-v1.md)。

| 方法与后缀 | 行为 |
| --- | --- |
| POST `/preview` | 检查格式、字段、唯一性、关系与文件；回滚数据库，清理本次临时文件 |
| POST 空后缀 | 对同一快照再次校验并提交；新导入 201，完全重复 200 |
| GET 空后缀 | 查询已提交的导入报告 |
| GET `/snapshot` | 读取已迁移原字段快照及运行状态数量，用于核对 |

## 请求与来源

接收 JSON 对象，format 为 `zhutong-migration-v1` 或旧 `zhutong-demo-backup`，
schemaVersion 为 1—7，data 为旧表名到原始行数组的映射。
sourceName 标识来源，未提供时为 legacy-json-backup；exportedAt 不参与来源哈希。
counts 可声明逐表数量；声明不符、未知业务表、重复旧 ID、无效类型均报告。
缺少的已知表按空数组处理；附件 Blob/缩略图用含 MIME 的 base64 data URL 传输。

已知旧表为 buildings、floors、points、devices、baselines、records、audits、rules、
events、notifications、plans、tasks、issues、workOrders、attachments、
maintenancePlans、maintenanceTasks。保留原 ID、编号、时间、来源、历史人员及未知原字段。
监测记录旧 revision=0 保存为 record_revision=0，服务端行版本从 1 开始。

可选 runtime 包含 preferences、assistant、scenario、showcase、video、frames、assets、comparisons。
照片、缩略图、视频与关键帧字节写入私有文件目录，SQLite 保存元数据及 SHA-256。
比较、分析、会话和场景结果作为 JSON 快照保存。旧身份、回执仅用于历史，不能充当权限或重放凭据。
会话和场景标记 paused-read-only；本阶段不自动恢复到运行中的 UI，不重放办理操作。

前端导出的 `zhutong-migration-collection-v1` 是 packages + missing 的外层集合，
由前端拆成单来源包调用上述接口，服务端不直接接收集合。
主库映射 demo-main，zhutong-showcase 映射 demo-showcase。
浏览器数据库按来源隔离：某一浏览器或端口的导入不代表其他来源已迁移。

## 一致性与报告

来源哈希由 sourceName、规范化 data、runtime 共同决定。
同数据集相同来源哈希返回已有报告，replayed=true；逐表 inserted=0、matched=source。
不同快照但相同旧 ID 必须原内容一致才能复用；不覆盖冲突数据。
字段映射、业务数据、运行快照及导入批次同事务提交，失败整包回滚。
每个来源包独立提交，集合中一个失败不会撤销此前成功的来源包。

报告含 valid、sourceName、sourceHash、datasetId、tables、fieldsVerified、filesVerified、errors、warnings。
tables 逐表给出 source、inserted、matched；errors/warnings 每项给出 table、id、message。
预检不通过仍返回 HTTP 200、valid=false；正式提交不通过返回 422 IMPORT_INVALID，details.report 附完整报告。
无效 JSON 为 422 VALIDATION_FAILED，超过请求体限制为 413 IMPORT_TOO_LARGE，身份不足为 403。
请求默认上限 80 MiB，每个媒体文件仍受默认 32 MiB 限制；不接收 NaN/Infinity。
此接口尚未接入客户端 expectedEpoch，不作为离线业务同步接口。

## Web 使用

设置页支持检查导入、本机快照导出、旧 JSON 文件导入、历史报告读取和报告导出。
动态打开已有 Dexie 数据库并使用只读事务，不升级旧 schema、不清空或回写源库。
未发现数据库时明确报告，不创建空库。当前正在分析或执行助手任务时阻止捕获不完整内存快照。
偏好仅采集本工作区前缀，内部访问令牌不导出。
损坏或缺失字节、断链、冲突逐项报告，不以空对象代替文件。
浏览器刷新前已丢失的临时内容无法恢复；随包素材来源与许可说明一同保留。
