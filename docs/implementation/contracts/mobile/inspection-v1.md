# OpenHarmony巡检在线写入 v1

2026-10-28；复用[现场业务契约](../field-work-v1.md)，未新增后端端点或迁移。

## 原生命令

- GET `/api/v1/datasets/demo-main/inspection/tasks`：完整任务、冻结清单、逐点结果、到点尝试和rev。
- POST `/inspection/tasks/{encodeURIComponent(taskId)}/check-in`：原始expectedRev、pointId、nfc/manual、labelRead、fallbackReason。
- POST `/inspection/tasks/{encodeURIComponent(taskId)}/complete-point`：原始expectedRev、pointId、已作答answers、linkedIssueId、noIssueReason。
- 写请求带内部Bearer、固定Idempotency-Key和X-Dataset-Epoch。到点HTTP200但attempt.passed=false仍显示失败。

任务和测点来自当前授权快照，写前校验执行角色、目标关系和编辑时版本，再请求服务端当前身份。
POST之后再次核对身份/范围和epoch；旧身份/旧服务在途结果不得回填。
任务结果按服务端返回更新；较旧的回执结果不得覆盖已载入的新rev。
服务端在复用到点/检查完成/任务问题的回执之前，也重新核验当前角色、楼栋范围、任务测点关系及归档状态。
合法重放不拿旧expectedRev与新版本比较；授权撤回或测点归档时不返回旧业务回执。

## 草稿、冲突与重试

- 清单从planSnapshot构造；未作答项保持null，不自动设正常；可选未答项不发送。
- 到点不计为检查完成，逐点完成后任务从pending到partial，全部完成才是checked。
- 手工签到原因必填；异常必须关联本任务本测点已有问题，或提供至少10字的合法无需建问题依据。
- 版本冲突保留当前表单，读取最新任务后明确采用新版本；不静默修改expectedRev覆盖服务器。
- 发送期间禁止重复提交。网络失败/响应不完整视作结果未知，冻结原请求和键，重试复用。
- 未知请求仅能在原服务、epoch、身份及相同授权范围下手动核验；不借另一身份提交。
- 确定的业务校验错误和409不无限重试；401/403或授权变化清除受保护快照和详情。
- 当前草稿/未知请求只在应用内存；点位切换保留当前任务中的填写。跨进程持久化与媒体依赖队列属于阶段9。

## 本批边界

原生新建问题/照片、工单动作、原生预警处置和统计仍按后续批次接入。
已关联问题及无需建问题依据不是创建新问题，不表示异常已维修或预警已关闭。
全部NFC为显式模拟，人工核对与模拟方式分别记录；模拟器验收不代表实际到场或物理设备验收。
