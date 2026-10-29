# 阶段8：原生补证与工单接续批次

2026-10-29。**本批自验完成，提交审核；阶段8整体仍在进行中。**
OpenHarmony API20公共SDK构建，Pura90手机模拟器验证；未把模拟器当成真机或Hypium。

## 交付行为

原上报人从问题卡片进入补充材料，位置与原始描述直接带入；新说明/照片追加原问题，不创建第二个问题。
指定维修人点击一次即可接单；完工只必填措施，材料和照片可选。返工带回原措施，并展示Web验收退回原因。
页面仅显示当前身份/状态可用动作，提交锁定重复操作；正常接单没有确认弹窗。
冲突保留填写内容，采用刷新版本后再提交；结果不明使用原请求核验，不要求重新填写。

Web继续承担审核、派工、验收和复查；原生页面不复制后台管理表单。
修复Web有效身份刷新后未加载派工名单的问题，避免额外切换身份。
同时纠正照片组件仍写“纯前端/本地档案”的旧提示，明确已选只是草稿，业务成功后才算保存。

契约：[handling-v1](../../../contracts/mobile/handling-v1.md)；剩余业务：[对照表](../../stages/mobile/business-coverage.md)。

## 实际业务证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Web退回图片材料→App补充 | 同一问题，原描述/照片保留，照片1→2，仍待审核 | [补证结果](../../../evidence/stage8-handling/verification/business/supplement.json) |
| Web转维修并派工→App接单 | 指定人一键接单，无二次确认 | [原生动作](../../../evidence/stage8-handling/verification/ui/open_order.json) |
| App提交完工→响应丢失→原请求重试 | 显示待核验，重试前后工单/附件/审计/回执数量完全不变 | [重试结果](../../../evidence/stage8-handling/verification/commands/completion-retry.json) |
| Web退回→App重接/返工 | 退回理由保留，新措施提交同一工单，未再建单 | [返工](../../../evidence/stage8-handling/verification/ui/rework.json) |
| Web验收→复查→问题关闭 | 验收后明确pending_recheck，登记恢复结论后才closed | [验收后置条件](../../../evidence/stage8-handling/verification/business/verified.json)、[闭环](../../../evidence/stage8-handling/verification/business/closed.json) |
| 原件跨端读取 | 3个媒体由原上传身份与safety读回，字节大小与SHA一致，Web点开工单图 | [媒体哈希](../../../evidence/stage8-handling/verification/business/closed.json)、[Web照片](../../../evidence/stage8-handling/page/web/photo/screen.png) |
| 真实HTTP权限/重放 | 范围收回403、角色收回409、非原上报人403，同键异载荷409，无新写入 | [守卫](../../../evidence/stage8-handling/verification/commands/guards.json) |
| 备份恢复/API与App重启 | 40张表逐表哈希、3个媒体哈希一致；恢复API后已验收/已关闭可读 | [最终备份](../../../evidence/stage8-handling/verification/runtime/backup-final.json)、[最终重启](../../../evidence/stage8-handling/verification/runtime/after-restart-final.json) |
| 最终HAP最短路径 | 另建一张隔离冒烟工单，最终HAP一键接单→只填措施→无照片提交成功 | [最终包写入](../../../evidence/stage8-handling/verification/business/final-smoke-result.json) |

主闭环为1条问题/1张关联工单；最终HAP另增1张手工冒烟工单，不与主问题相连。
所有硬件和照片素材均明确模拟；照片为本地合成图，不是真实校园隐患。
Web页面证据在隔离5183，API18008/网关18009；交付库原业务数据没有加入这些验收对象。

## 自动化与结构

| 检查 | 实际结果 |
| --- | --- |
| 后端pytest | 297通过，覆盖率88.94% |
| 后端Ruff/格式 | check与format --check通过，235文件格式通过 |
| 原生核心Node转译/mocks | 77通过；不是Hypium；report与OrderPolicy核心行95.98%、分支87.10% |
| Web Vitest | 125文件/1171通过，含刷新派工名单回归 |
| tooling / typecheck / build | 5项工具测试通过，类型检查与构建通过；主包仍有900KB阈值提示 |
| 原生SDK | Hvigor assembleApp成功，公共SDK调试签名校验与模拟器安装成功 |
| 结构门禁 | SDK ETS解析/递归函数参数与文件规模、Python助手扫描通过，未放宽阈值 |

真实命令、签名哈希、源文件哈希及容器核对见[最终清单](../../../evidence/stage8-handling/verification/final.json)。
日志分组在[builds](../../../evidence/stage8-handling/builds/)，页面在[page](../../../evidence/stage8-handling/page/)。
最终HAP SHA-256：`e27e462a2c7a22cc3946c0c0decad391f1f9b9a489e7ad075c45184a75f03824`，813151字节；
包在`backend/.runtime-native-online/signing/entry-default-debug-signed.hap`，调试签名，不作为正式发布签名。
最终新增回执完整性守卫后已重新编译、签名、安装，并再次实际接单/提交无照片工单，不只是回读旧构建。

## 本轮发现并修复的问题

1. 新增createdById到旧GET/issues投影导致现有POST/GET一致性回归失败：原全量296过/1失败保留。
   移除该字段，另提供授权补证ID列表；原有回归未修改，最终297通过。
2. Web身份恢复后派工名单为空：新增回归先RED再GREEN，刷新后直接可选择维修人。
3. 原生仅按工单ID判断成功会接受残缺回执：回归先RED再GREEN，改为校验状态、rev、单号、照片数组。
4. 首次自动化脚本没有先切“维修工单”页签，另一次把工单成功提示误认作问题提示，导致脚本失败。
   两次均保留原日志；核对原生截图后修正脚本。随后返工场景重新完整测量重试前后计数，没有以失败日志冒充通过。

RED/GREEN提交包含`65c4df1/7b0a3ab`、`a66cfbf/2efb440`、`8a210a4/a6cd881`、`7c0f01c/1a749de`；
实际完整SHA以git记录与最终清单为准，其他DTO/核心分步提交同分支可达。
UI为`d0b9889`，Web提示为`e4a8a81`。现有未提交Web视觉改版保留，没有混入本批代码提交。

## 部署与边界

Docker API/Web镜像已重建，迁移仍为0013，API18000健康、Web8080正常。
重建前后业务摘要一致：5楼栋/8测点/18记录/2事件，任务/问题/工单/附件仍为0。
App验收后恢复device18080→host8080和safety身份，临时服务仅在证据收集期间运行。
Docker构建包含本机既有Web视觉工作区；本批另记录改动文件的源哈希，不宣称整个工作区全为已提交HEAD。

S8-06的模拟器在线闭环自验满足；S8-04真机相机、S8-10真机实录继续待验收，用户已确认暂无真机。
已提交工单原件在Web查看，App暂无已提交原件放大页；本轮原生只验新选照片预览和已关联张数。
未提交草稿/未知请求不跨进程持久化；完整离线队列仍在阶段9。
原生预警处置、设备模拟状态、筛选统计、宽窗/字号/读屏/性能仍有计划项，未宣称阶段8完成。

后续按预警处置→设备状态与筛选统计→设备体验核验继续，每一批沿用契约中的简洁操作约定。
