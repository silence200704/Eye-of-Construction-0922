# 阶段 2 存储设计

SQLite 通过 Alembic 0003—0007 建立模型，不用 create_all 替代正式迁移。
当前有 29 张应用表，加 alembic_version 共 30 张表。
阶段 3 新增 0008_legacy_revision，单独保存监测记录的旧修订次数 record_revision。
旧 revision=0 原样保留；服务端行版本 revision 从 1 开始，二者不可混用。
0001—0007 历史迁移不改写。

## 数据集与身份

users、login_sessions 保存演示身份及内部会话，不含账号密码。
datasets 初始化 demo-main、demo-showcase 两个测试集，epoch 初值为 1。
每个业务实体以 (dataset_id, id) 为主键，业务编号在数据集内唯一。
关联使用带 dataset_id 的外键，避免同旧编号串到另一测试集。
数据集的 test 标识不覆盖楼栋、测点和媒体原有来源。

## 原表映射

| 原 IndexedDB 表 | SQLite 表与主要约束 |
| --- | --- |
| buildings | buildings；编号唯一，保留位置、负责人、来源、归档字段 |
| floors | floors；归属楼栋外键，楼栋内楼层号唯一 |
| points | points；楼层必须属于指定楼栋，坐标 0—1，启用 NFC 标签不重号 |
| devices | devices；绑定测点外键、编号唯一、量程下限不大于上限 |
| baselines | baselines；测点/指标/版本唯一，同测点指标最多一个当前基准 |
| records | records；测点及设备外键，编号及测点采样时间唯一 |
| audits | audits；原操作者/角色快照保留，新媒体操作按服务端身份留痕 |
| rules | rule_definitions + rules；稳定标识与版本分开，历史版本留存 |
| events | events；同点同规则最多一个未关闭事件，保留证据及替代证据 |
| notifications | notifications；事件外键，生成/展示/确认/升级分别保留 |
| plans | plans；检查范围、周期、清单以 JSON 保存 |
| tasks | tasks；计划与执行时刻唯一，生成时快照和逐点结果以 JSON 保存 |
| issues | issues；原始描述、审核、复查、时间线及关联均保留 |
| workOrders | work_orders；来源关系外键，措施、材料、验收历史保留 |
| attachments | attachments + media_files；每张照片只关联一次且必须有一个归属 |
| maintenancePlans | maintenance_plans；设备、测点及楼栋引用 |
| maintenanceTasks | maintenance_tasks；计划与执行时刻唯一，快照、执行与问题关系保留 |

嵌套清单、作答、证据、时间线、位置历史和快照使用 JSON 列，不展开无必要的子表。
legacy_payload 仅为迁移时保留未知原字段；正式查询以业务列与快照为准，后续写操作不能靠该字段绕过校验。
旧数据中空引用、断链和相互矛盾字段由阶段 3 导入报告识别，不通过关闭外键强行导入。
阶段 3 导入预检补充任务、问题、照片和保养等 JSON 内部引用核对；它们并非数据库外键。
新业务写入和状态流转仍需阶段 5 的业务事务验证。

## 原临时数据的存储去向

media_files 保存文件元数据，media_videos、media_frames、media_comparisons 保存视频、关键帧与比较结果。
preferences 保存偏好，session_states 保存 assistant/scenario/showcase/video 运行状态。
operation_receipts 包含 epoch、身份、操作、幂等键、请求哈希与结果；import_batches 按源哈希识别重复导入。
阶段 3 已完成可获取数据的导出导入，运行状态按只读暂停快照保存，不自动重放写操作。
运行状态的 UI 恢复及新业务接入在阶段 7、9、10 实施。

## 文件与事务

文件使用服务端生成的随机键，原文件名只作为元数据；所有路径限制在运行目录内。
流式接收时限制体积，图片按声明 MIME 与实际格式核对并解码，MP4 验证容器盒长度与必要盒。
文件写入并同步落盘后原子移至 files，数据库元数据及审计在同一事务提交。
数据库失败时补偿移除本次文件；SQLite BEGIN IMMEDIATE 串行保护重复上传及附件配额。
上传幂等键按数据集和上传人区分；重试必须匹配文件哈希与元数据，否则返回 409。
进程在文件发布与数据库提交之间崩溃时可能留下孤立文件；不自动删除，备份只收录数据库引用文件。
每次内容读取检查体积及 SHA-256，缺失和损坏分别返回明确错误。

## 备份恢复

SQLite backup API 获取一致快照；媒体不可变且当前不提供删除接口，因此按快照逐个复制引用文件。
备份清单包含数据库版本、各表数量、所有文件体积和 SHA-256，包含会话密钥。
恢复在新目录暂存、复核后发布，不覆盖正在使用的库。真实升级前已保留阶段 1 数据库与密钥快照。
测试中的阶段 2 schema downgrade 会删除阶段 2 表，只用于迁移往返验证，不作为生产数据回退方法。
