# 阶段8第二批：原生巡检到点与检查写入

核验日期：2026-10-28。本批已实现并完成独立库真实HTTP、原生模拟器、数据库与回执交叉核验。
阶段8继续进行中；S8-03本批自验满足，未据此宣布整个App或阶段8完成，未进入阶段9。
完整范围继续跟踪在[业务对照表](../../stages/mobile/business-coverage.md)。

## 本批实际交付

- 原生任务详情：冻结计划/清单、必查测点、执行角色、截止时间、逐点进度、到点尝试记录和只读身份提示。
- 模拟NFC与人工核对：显式标模拟；错标签不计到点，人工无原因不通过；失败尝试仍由服务端留痕。
- 冻结检查表单：必答项、正常/异常、观察备注、关联本任务本测点已有问题或合法的无需另建问题依据。
- 逐点完成：到点保持任务pending；部分检查完成为partial，全部检查完成才是checked；已完成清单可只读查看。
- 写入含当前身份、原始expectedRev、固定幂等键和epoch。发送中禁止重复提交，响应未知只用原请求重试。
- 写前/写后核对身份范围；切身份迟到响应丢弃；刷新任务在读取后再次核验范围，不发布半批/越权结果。
- 409保留当前表单，读取新任务后明确采用版本，不静默覆盖；旧回执不覆盖已载入的更高rev。
- 保留卡通手账、彩色步骤卡和大触控按钮；使用ArkTS/ArkUI/Stage，没有WebView壳或Flutter。

后端复用既有端点、事务与状态机，并补上巡检回执重放前的当前目标授权校验；未新增迁移，Alembic保持0013。Web和AI逻辑未修改。
契约：[原生巡检v1](../../../contracts/mobile/inspection-v1.md)。

## 核验结果

| 核验 | 真实结果 | 证据 |
| --- | --- | --- |
| Native核心逻辑 | 41项Node测试通过；HTTP/Preferences使用mock，不冒充Hypium | [日志](../../../evidence/stage8-inspection/builds/node-tests.log) |
| 新增field核心覆盖 | Node转译层行覆盖95.14%、分支87.31%；范围限CheckDraft/TaskCommander，不代表整个App原生覆盖率 | [覆盖日志](../../../evidence/stage8-inspection/builds/coverage.log) |
| 既有后端契约回归 | 巡检计划及答案边界选定测试7 passed，退出0 | [命令记录](../../../evidence/stage8-inspection/builds/commands.json) |
| 后端完整回归 | 278 passed，覆盖率88.88%，退出0；含三个巡检写入口12项重放鉴权/合法重试回归 | [pytest](../../../evidence/stage8-inspection/builds/backend/pytest.log) |
| 后端规范 | Ruff check通过，225个文件format --check通过 | [check](../../../evidence/stage8-inspection/builds/backend/ruff.log)、[format](../../../evidence/stage8-inspection/builds/backend/format.log) |
| SDK构建 | assembleApp退出0，19.860秒；API20/OpenHarmony公共SDK，组件元数据Beta1 | [Hvigor](../../../evidence/stage8-inspection/builds/hvigor.log) |
| 签名/安装 | codesign/verify-app成功，HDC明确返回安装成功，实际原生界面可操作 | [签名](../../../evidence/stage8-inspection/builds/signing.json)、[包信息](../../../evidence/stage8-inspection/builds/pack-info.json) |
| 原生结构 | 54个ETS/TS/MJS文件、478个函数；最大代码文件246行、函数31行；超参/目录超限0 | [结构](../../../evidence/stage8-inspection/builds/structure-native.json) |
| Python/素材 | 本批脚本无超长文件/函数/签名，13项素材SHA/XML核验通过 | [辅助检查](../../../evidence/stage8-inspection/builds/structure-assets.json) |
| 服务端规则 | 错角色403；人工无原因passed=false；未到点/漏答/异常无依据/错误关联均CHECK_INCOMPLETE | [真实HTTP](../../../evidence/stage8-inspection/verification/http.json) |
| 回执当前授权 | 楼栋范围收回403、执行角色改变403、测点归档404；恢复合法权限后原键重放200，无审计/回执增量 | [真实重放](../../../evidence/stage8-inspection/verification/replay-auth.json) |
| 到点/必答原生实测 | 错标签保留失败，人工原因与必答校验可见；到点不算完成 | [arrival](../../../evidence/stage8-inspection/verification/ui/arrival.json)、[未作答](../../../evidence/stage8-inspection/page/missing-required/screen.png) |
| 完成及重启 | 一条任务两个测点0/2→1/2→2/2；checked；关闭App再启动后仍读取同一结果 | [completion](../../../evidence/stage8-inspection/verification/ui/completion.json)、[重启](../../../evidence/stage8-inspection/page/restart-checked/screen.png) |
| 原生版本冲突 | 外部HTTP先更新相同任务，旧副本提交409；显式读取/采用后继续办理 | [conflict](../../../evidence/stage8-inspection/verification/ui/conflict.json)、[页面](../../../evidence/stage8-inspection/page/revision-conflict/screen.png) |
| 原生未知响应 | 代理在服务端已提交后断开响应；页面显示结果未知，同键重试不多建到点尝试/审计/回执 | [retry](../../../evidence/stage8-inspection/verification/ui/retry.json)、[页面](../../../evidence/stage8-inspection/page/unknown-response/screen.png) |
| 原生只读身份 | 物业可查看巡检任务，不能操作巡检员清单；后端对应写请求403 | [readonly](../../../evidence/stage8-inspection/verification/ui/readonly.json) |
| 独立API重启 | 两个验收任务逐字段与重启前一致；完成任务checked，冲突/重试任务按设计保留partial | [重启后](../../../evidence/stage8-inspection/verification/restart-after.json) |
| 主演示数据 | 原Web/API业务快照哈希相同；5楼栋/8测点/18记录/2事件/0任务/0工单未改变 | [前](../../../evidence/stage8-inspection/verification/delivery-before.json)、[后](../../../evidence/stage8-inspection/verification/delivery-after.json) |
| 交付容器 | API镜像已更新、healthy；迁移退出0且head0013；Web8080/API18000均200；容器内修复文件SHA与本地一致 | [部署核验](../../../evidence/stage8-inspection/verification/final.json) |

原生七组phase为setup/arrival/completion/conflict/retry/readonly/finish，均有布局树与真实截图；不是浏览器原型。
验收数据库独立，API18003、故障注入代理18004，模拟器18084反向映射；主Web8080/API18000不受业务写入影响。
“另一端更新”使用同一真实HTTP命令模拟Web写入，本批没有录制Web页面点击。照片和问题新建不计入本批通过。
结束时App恢复正式18080→8080连接与安全管理演示身份，未在主库自动造任务。

## 实测发现与修复

首次原生复验发现：服务端已partial，摘要仍显示0/2；原因是Builder参数保留初始任务对象。
摘要与到点历史改为读取当前响应式任务；修复后实时1/2、2/2及数据库结果一致。
失败截图/布局和当时服务端任务保留在[原失败证据](../../../evidence/stage8-inspection/review/summary-before-fix/screen.png)，没有覆盖成成功。
另一修复是刷新任务后再核验身份范围，对应新增RED→GREEN回归；防止同ID收窄范围后回填旧数据。
收口复核还发现服务端直接返回旧回执时会跳过目标权限：先复现6失败/2通过，再修复到点、完成和任务问题三个入口。
新增回归覆盖角色/楼栋/归档变化及合法旧rev重放；真实HTTP使用原生响应丢失场景的同一键核验，权限配置仅临时调整独立验收库并还原。
模拟器系统输入法首次提示及覆盖窗口影响自动操作，脚本只取消/退出其授权提示，并在确实显示键盘时收起键盘；未代用户接受条款。

## 版本与检查点

本批业务代码提交`6ce1dc7`；RED/基础检查点`b3a147b`、表单RED`e165dd6`、范围竞态RED`b1b1a8d`，
命令/草稿GREEN为`4aa210a`、`4eb9134`、`e24edc1`，原生失败复现记录`2b543ae`。均在当前活动分支可达。
服务端回执鉴权RED为`194de00`，修复为`f9ca5eb`；没有放宽合法重试或版本校验。
补齐三个入口12项回归、真实重放与部署证据收集脚本提交为`1b0cf11`。
本批先前未提交的原生基础单独纳入检查点，未把既有Web界面改动混入这些代码提交。
HAP SHA-256：`af689aa49d26a4293dd7cfdc413517d8c985292fa3b80fcab7a672752215c910`，562875字节。
使用公共SDK开发签名夹具，debug profile到2026-11-27T06:28:37Z；非正式发布身份，设备标识和私有profile不导出。
最终原生源文件哈希、回执ID和审计计数见[核验清单](../../../evidence/stage8-inspection/verification/final.json)。

## 完成度与下一批次

- S8-03自验满足：错标签/人工无原因、到点与完成分离、必答/异常后续依据均有HTTP和原生证据。
- S8-01/02/05/07/08/09/14部分子项新增证据，整个阶段8仍在进行中；真机/媒体/工单等不能据此标通过。
- 点位切换保留当前任务表单；返回/切身份/终止进程后的未提交草稿和未知请求不承诺持久化，不作为阶段9成果。
- 下一批先补表单与媒体选择器生命周期保护，接独立/任务问题新建、相册/相机/压缩/上传/重试及Web原件核对。
- 之后接指定人接单、措施/材料/前后照片、完工退回、Web验收/复查；再补原生预警处置/统计与筛选。
- 物理OpenHarmony设备、真机拍照/实录、Hypium、宽窗/大字号/读屏及帧率均未验收；Node mock测试不代表这些已通过。
- 所有NFC、监测和设备输入仍明确模拟。检查完成不自动关闭问题、工单或预警。
