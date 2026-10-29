# 原生补证与工单办理 v1

2026-10-29。适用OpenHarmony ArkTS/ArkUI业务包；仅身份切换，无账号密码。
业务路径均位于`/api/v1/datasets/{datasetId}`，当前App固定`demo-main`。

## 简洁操作约定

- 正常路径就地办理，只显示当前身份、当前状态可执行的主要动作。
- 补充材料从原问题进入，自动带入位置和原始记录；填写补充说明，不再新建问题或重新选位置。
- 被派工人点击“接单，开始处理”即提交接单命令，不增加确认弹窗。
- 完工只必填维修措施，材料、备注、照片可选；已有措施在返工时带入，可编辑后再次提交。
- 仅物业代接必须说明原因；放弃草稿、并发冲突和提交结果不明有必要的明确处理入口。
- 处理中锁定重复操作并即时显示状态；失败保留草稿，结果不明直接用原请求核验。
- 同一业务的编号、版本、幂等键和照片引用由系统携带，普通用户不录入这些内部字段。
- 后续预警、统计、离线与演示编排沿用这组约定；减少重复输入，不跳过验收、复查或权限校验。

## 接口与权限

| 接口 | 返回/作用 | 当前权限 |
| --- | --- | --- |
| GET `/issues/supplement-targets` | 可补证的问题ID数组，不改变既有问题JSON | 原创建审计actor与当前楼栋范围 |
| GET `/issues/{id}/supplement-context` | issue、existingPhotoCount、existingPhotoBytes | 原上报身份、楼栋与有效测点 |
| POST `/issues/{id}/supplements` | `{issue}`，追加材料后仍待审核 | 同上；当前必须为pending_review/need_evidence |
| GET `/work-orders/{id}/handling-context` | order、buildingId、existingPhotoCount、existingPhotoBytes | 当前楼栋范围 |
| POST `/work-orders/{id}/actions` | 沿用既有`{order}`事务命令 | 派工/验收由safety；接单由指定repair或有原因的property；完工仅实际接单人 |

补证输入：`{expectedRev,note,photos}`；说明去空白后至少10字，最多4000字。
照片项为`{mediaId,draftId,kind}`；补证使用scene，维修照片只能before/after，不冒充验收照片。
审核为image时必须添加新照片，重复引用已有附件不算新证据。
原描述、位置和已有照片不覆盖；新说明、附件ID、原审核类别/意见追加时间线，清除reviewAction后重新待审核。

接单输入：`{expectedRev,to:"repairing",note,photos:[]}`。
完工输入：`{expectedRev,to:"submitted",note,photos,measures,materials}`，measures非空。
接单不发送空measures/materials，不清除返工前的维修资料。
已有与新增照片共同受同一对象3张/600KB约束；App先展示剩余配额，服务端仍独立校验。
本机压缩、上传mediaId与关联归属分开；原生响应式状态只放预览元数据，ArrayBuffer留在私有提交状态。

## 事务、一致性和错误

所有写入使用当前服务端身份、`Idempotency-Key`、`X-Dataset-Epoch`、`expectedRev`。
业务实体、照片归属、审计及回执同事务。原请求重放前重新检查当前身份、角色、范围和实际接单人。
已授权原请求可以返回旧回执，客户端按rev合并，不能把更新的已验收工单倒退为待验收。
同键异载荷409；版本或状态冲突409；楼栋越权/非原上报身份403。
角色/办理人错误保留既有工单409口径；不是通过返回旧回执绕过当前权限。

App在办理前读取上下文；每个异步返回均核验授权指纹、generation及epoch，旧身份返回不能回填。
409保留草稿，读取最新进度后由用户明确采用当前版本；重试会形成与新版本对应的新命令键。
网络异常且可能已经提交时冻结原body/key；“用原请求核验并重试”不重新生成业务或照片。
工单响应须包含匹配对象ID、正确动作状态、递增整数rev、单号和照片数组，残缺响应进入待核验，不显示成功。

验收通过只推进问题到待复查。问题恢复结论、问题关闭、工单验收与预警关闭分别成立。
本阶段未提交草稿与未知请求仍只在进程内保留，跨进程持久化队列属于阶段9。
工单照片在App显示预览/上传状态与已关联张数；已提交原件放大查看目前由Web承担。

证据：[本批报告](../../handoff/reports/mobile/07-native-handling.md)、[业务/重试/恢复](../../evidence/stage8-handling/verification/)。
