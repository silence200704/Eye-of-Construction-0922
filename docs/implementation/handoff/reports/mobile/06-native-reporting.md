# 阶段8第三批：问题上报与照片证据

2026-10-28实施与主要实测，2026-10-29收口。本批实现与核验完成，提交复核；阶段8整体仍在进行中，未进入阶段9。
用户确认暂无可安装HAP的真机，继续模拟器验证；相机真实拍摄和真机安装保持待验收。

## 实际交付

- ArkTS/ArkUI/Stage原生问题池和现场发现表单，延续“小瞳校园守护手账”青绿主题、彩色步骤卡、大触控按钮与按压反馈。
- 工作台/测点独立上报，以及巡检异常内上报；任务问题真实关联到同一测点和任务。
- 异常类型、原始描述、楼栋/测点及固定提交标识；不自动写“已修复”，不伪造现场结论。
- 原生相册/相机选择器接入、JPEG压缩、本机预览、移除、上传及唯一归属；选图返回保留文字与目标。
- 上传与问题提交分别复用稳定标识；重复点击、结果未知、任务冲突及当前授权变化均有处理。
- 问题池读取服务端审核状态/意见；Web能打开同一照片，Web审核反馈能在重启后的App中读回。
- 后端补独立问题回执当前授权和媒体事务内epoch校验，无新增端点或迁移；Web/AI业务代码本批未修改。

契约：[reporting-v1](../../../contracts/mobile/reporting-v1.md)；完整剩余项：[业务对照表](../../stages/mobile/business-coverage.md)。

## 核验结果

| 核验 | 实测结果 | 证据 |
| --- | --- | --- |
| 原生核心 | Node转译/mocks共63项通过，非Hypium；新增report/media核心行96.51%、分支81.03% | [命令汇总](../../../evidence/stage8-reporting/builds/commands.json)、[覆盖](../../../evidence/stage8-reporting/builds/coverage.log) |
| 后端全量 | 284 passed，覆盖率88.93%，退出0；含6项新增授权/epoch竞态回归 | [pytest](../../../evidence/stage8-reporting/builds/backend/pytest.log) |
| 规范 | Ruff check通过；227个文件format --check通过 | [check](../../../evidence/stage8-reporting/builds/backend/ruff.log)、[format](../../../evidence/stage8-reporting/builds/backend/format.log) |
| 原生构建 | Hvigor assembleApp成功，16.816秒；API20公共OpenHarmony SDK，实际模拟器运行时API24 | [构建](../../../evidence/stage8-reporting/builds/hvigor.log) |
| 签名/安装 | codeSigning、verify-app成功；HDC明确返回安装成功，修复后实际选图与提交可用 | [签名](../../../evidence/stage8-reporting/builds/signing.json)、[选图](../../../evidence/stage8-reporting/page/album-selected/screen.png) |
| 结构 | 67个ETS/TS/MJS文件、699个函数，最大文件259行、函数31行；超长/超参/目录超限0；Python辅助脚本和13项素材核验通过 | [原生](../../../evidence/stage8-reporting/builds/structure-native.json)、[脚本/素材](../../../evidence/stage8-reporting/builds/structure-assets.json) |
| 任务上报 | 原生上报ISS-20261028-001；返回核对任务版本并关联后，异常检查真实完成，任务checked | [问题](../../../evidence/stage8-reporting/verification/task-issue.json)、[任务](../../../evidence/stage8-reporting/verification/task-complete.json) |
| 相册/草稿 | 选择明确模拟素材，返回后文字和位置保留；压缩为61074字节JPEG | [界面](../../../evidence/stage8-reporting/page/draft-after-picker/screen.png)、[实测](../../../evidence/stage8-reporting/verification/ui/photo_ready.json) |
| 上传响应丢失 | upstream已201后断响应；只产生1个媒体，0附件、仍1条原任务问题；未显示问题已提交 | [断响应](../../../evidence/stage8-reporting/verification/ui/upload_loss.json) |
| 问题响应丢失 | 同一媒体键重传复用；随后问题已200后断响应；同一业务键重试前后2问题/1媒体/1附件/11审计/10回执完全相同 | [重试](../../../evidence/stage8-reporting/verification/ui/retry.json) |
| Web/原件 | Web显示ISS-20261028-002和同一照片；inspector/safety受保护下载SHA均等于App压缩上传字节 | [Web](../../../evidence/stage8-reporting/page/web-photo/screen.png)、[字节](../../../evidence/stage8-reporting/verification/media.json) |
| 审核/恢复 | Web真实退回补充，原照片保留；备份恢复后API及App重启，2问题/1照片和反馈可见 | [Web审核](../../../evidence/stage8-reporting/page/web-photo/review.png)、[原生回读](../../../evidence/stage8-reporting/page/restored-review-feedback/screen.png) |
| 备份 | 40表逐表计数/SHA一致、1个媒体文件SHA一致；18005已用restored-final启动，业务JSON与重启前一致 | [备份](../../../evidence/stage8-reporting/verification/runtime/backup.json)、[重启](../../../evidence/stage8-reporting/verification/runtime/after-restart.json) |
| 真实TCP授权 | 范围收回403、测点归档404、合法原键重放200；旧epoch上传409；业务/媒体/附件/审计/回执均无增量 | [HTTP](../../../evidence/stage8-reporting/verification/runtime/http-guards.json) |
| 交付/隔离 | API镜像已更新且healthy，迁移退出0/head0013，Web8080/API18000均200；容器内6个修复源文件SHA与本地一致 | [最终清单](../../../evidence/stage8-reporting/verification/final.json) |
| 主库 | 5楼栋、8测点、18记录、2事件、0任务/工单/问题/附件保持；业务快照SHA完全一致 | [前](../../../evidence/stage8-reporting/verification/delivery-before.json)、[后](../../../evidence/stage8-reporting/verification/delivery-after.json) |

验收使用独立API18005、故障代理18006、模拟器18086反向映射和隔离Web5182。未将验收问题写入交付库。
最后App恢复18080→8080与demo-safety；隔离Web和原生证据对应同一问题/媒体ID。
收口后仅停止本批自建18005/18006/5182临时服务，验收/备份/恢复目录保留；交付18000/8080再次返回200。
八个原生phase为setup、complete、prepare_photo、photo_ready、upload_loss、retry、restored、finish。
任务文字上报实测早于最后一次渲染修复；最终HAP重新完成选图、压缩、双重重试、恢复及跨端读回。

## 实测缺陷与修复

1. 独立上报直接返回旧回执时跳过当前位置权限；媒体上传忽略传入epoch，且流期间复位仍可能落库。
   先复现6项失败，再在回执前授权、媒体写事务内校验；同样6项回归转GREEN，额外TCP复验通过。
   未提供epoch的旧媒体调用继续兼容，本版App始终带epoch，没有宣称已强制升级所有旧Web调用。
2. 相册首次实际确认后App崩溃：ArkUI观察代理包裹ArrayBuffer，PhotoCards读取byteLength触发内部槽异常。
   保留[原失败摘要](../../../evidence/stage8-reporting/review/photo-reactive-crash.json)，增加metadata-only回归；
   ReportView只含预览原始值，字节留在私有提交状态。修复后的最终HAP已重新实测，没有用Node通过冒充原生渲染通过。
3. 任务上报返回后保留原检查草稿；由于任务rev已改变，须明确采用当前版本并选择已关联问题再提交。
   验收脚本已按真实交互补齐该步骤，没有绕过rev校验或修改数据库伪造checked。

RED检查点：`49757db`、`f6ecb01`、`7a56d56`、`501b630`、`9d67c37`、`ab9bfe4`、`30f3bff`、`7afff24`、`a666250`。
主要GREEN：`aa96e59`、`1408633`、`5f574a9`、`af28863`、`bdeb75b`、`dad2a18`、`7ab8cec`、`41439fe`。
当前分支均可达；最终代码与证据源哈希见final.json，未混入既有未提交Web设计改动。
验收脚本、真实HTTP守卫与导入排序收口为`4856036`；最终清单将该提交作为代码证据锚点。
HAP SHA：`a35b12102672539cd81321d74f326849c8e617bccf9ff00b1118406d4c97fd7b`，714718字节；公共SDK调试签名，非正式发布签名。

## 仍需完成

- 本批是“上报与读取反馈”，原生退回补证操作尚未实现，不能靠重新建问题代替补证；下一批先接该入口和原件权限复验。
- 再接指定人接单、措施/材料/办理照片、完工/退回再办理，与Web验收及复查闭环。
- 原生预警处置、模拟设备状态、日期/楼栋/类型筛选和统计仍在计划内。
- 相机代码与mock已有，当前模拟器实际拍照未通过；用户确认暂无真机，真机拍照/安装/实录继续待验收。
- 未提交草稿、未知请求、照片依赖队列不跨进程持久化；相册选择期间保留不等于阶段9离线完成。
- Hypium、宽窗、大字号、读屏、帧率和真实设备兼容性未通过，不以截图代替。
- 本批未改Web业务源文件，未重新运行Web全量Vitest/typecheck/build；Web端验证为隔离实例真实回读/审核。
