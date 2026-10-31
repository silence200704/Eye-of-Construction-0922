# 原生全业务与双端联动 v3

2026-10-31。ArkTS/ArkUI/Stage；App版本0.9.0-dev。AI服务算法保持原样。

## 业务契约

原生新增入口复用 `/api/v1/datasets/{datasetId}` 下的既有命令：

- 问题：`POST /issues`、任务关联上报、`/issues/{id}/review`、`/supplements`、`/rechecks`、`/rechecks/outcome`。
- 工单：`POST /work-orders`、`/work-orders/{id}/actions`；assigned/repairing/submitted/verified/returned按原状态机执行。
- 保养：`GET /maintenance/tasks`、`POST /maintenance/tasks/{id}/execute`。
- 巡检和预警复用原命令，增加跨进程固定请求记录；每个写命令仍使用当前身份、expectedRev、epoch和幂等键。
- 媒体上传、重放与元数据响应追加`meta.datasetEpoch`，兼容旧消费者；新原生流程校验该字段及SHA/字节大小。
- 服务端派工额外校验候选人启用状态、维修/物业角色及目标楼栋范围，避免派给无法接单的人。

App补齐问题关系、审核、时间线、工单来源及复查轮次DTO；保养使用服务端snapshot/execution结构，不混成巡检任务。
支持主业务集与专用比赛集切换；原生传输连接创建时固定数据集，缓存、草稿和队列按服务/数据集/身份/epoch/范围分区。

## 本地存储与提交

schema1/2追加升级到3，保留原快照、笔记、独立上报及媒体队列；新增business_forms、business_commands、field_operations、offline_files。
未知版本或损坏数据不清库。

草稿可编辑，发送后正文/目标/键冻结；正文保存SHA-256摘要，服务端仍独立验证自己的幂等摘要。
巡检流程原子入队，先到点、再异常问题/照片、再逐点完成；后续请求第一次发送前才绑定前一步已确认的rev和问题ID。
照片先持久复制并记写入台账，上传返回mediaId后再关联；ArrayBuffer不放入ArkUI响应式状态。
同一草稿重复入队复用固定操作，真正的新上报使用新的submissionId；未知结果重试复用原键和正文。

网络/服务异常有退避与5次自动尝试上限，人工排查后可明确继续核验原请求。403、409、epoch或文件损坏分别暂停/冲突/隔离/失败，不无限重试。
冲突保留原操作和内容，展示当前对象与本地依据，明确核对后产生新逻辑提交；未知结果不能用新键绕过。
切身份/服务/数据集暂停原队列；返回旧身份的恢复确认持久保存，重启不会绕过。
在线管理动作只在线权威生效；离线保存草稿。接单必须联网确认，完工队列限已确认实际接单人。

文件清理只针对当前身份分区、超过7天且所有草稿/命令/队列均未引用的登记文件。路径须属于确定的私有目录；不递归删除目录，不清理仍有引用的照片。

## 刷新与建议

App与Web前台可见时每5秒读取，失败退避至最多30秒，回前台立即读取；读操作不重放业务写入。
远程列表在身份/epoch一致后发布，按rev保留更新的本机服务端结果；正在填写的表单单独保存，不被轮询覆盖。
Web同一ID的角色/范围变化触发重新载入，清除旧范围快照；旧令牌返回的JSON和媒体丢弃。
小瞳建议只追加到当前身份可编辑草稿，保留照片，不执行任何业务命令；有待核验请求时拒绝修改。

## 专用演示控制

仅`demo-showcase`、完整范围safety身份可以调用：

- `GET /showcase/status`：运行状态、epoch、实际任务/问题/工单/保养/事件计数。
- `POST /showcase/prepare`：通过原业务服务准备模拟档案/规则/正常样本/待办，重复准备保留进度。
- `POST /showcase/pause`、`/resume`：保存演示运行阶段；暂停阻止演示采样，不阻止人工真实业务办理。
- `POST /showcase/sample`：`sensor=crack|tilt|vibration`、`level=normal|yellow|orange|red`；固定输入走真实判定，normal一次3条恢复复测。
- `POST /showcase/reset`：`{confirmDataset:"demo-showcase"}`；同事务清理专用集业务行并递增epoch。同键重试不再次复位；保留身份、密钥、回执历史及物理媒体文件，不动主业务集。

模拟时刻按分钟推进，明确为模拟；不插入超出允许窗口的未来采样。时间窗耗尽返回冲突，不能伪造成功。
此批提供准备、采样、人工接力与进度控制，不提供自动替人审核、验收或关闭的脚本。
