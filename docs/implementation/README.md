# 筑瞳完整项目实施台账

本目录是 2026-10-15 起的完整项目实施依据，优先于旧文档中的“只做纯前端”范围说明。
项目用于比赛演示，采用真实后端、持久化和跨端业务流程；本地检索助手不接外部模型 API。
2026-10-24范围修订：参赛通知赛题3；App改OpenHarmony原生，新增阶段7A双端亲和视觉。
用户决定不开展硬件开发，全部硬件输入用模拟数据，按[赛题对照与边界](design/competition-scope.md)如实展示。

## 已确认约定

- Web保留Vue3、TypeScript、Vite，按校园守护主题重设计UI；后端FastAPI、SQLAlchemy、SQLite、Alembic、uv、Docker。
- App改为OpenHarmony API≥12、ArkTS+ArkUI+Stage、DevEco/Hvigor/OHPM，交付原生HAP；不再交Flutter/Android版。
- App包含监测/设备状态、历史预警与现场处置、周月统计；重点保留点检巡检、上报、工单与有限离线。
- 到点默认显式模拟NFC和人工签到；真实NFC按设备能力可选，不采购南向硬件、不开发GPIO/I2C固件。
- 临时模拟输入也经真实服务端命令入库；来源、时间、设备状态和声光模拟标记明确，不冒称硬件实测。
- 双端采用小瞳、校园插画、图案、友好空态与状态反馈，图案不遮告警/证据；详见[视觉规范](design/competition-visual-system.md)。
- 所有可获取旧数据作为测试数据迁移；媒体元数据入库，原文件独立持久化。
- 无登录界面和账号密码；首次直接进入默认演示身份，可随时切换，服务端验证身份、角色及范围。
- 助手参考小信的业务直答、FAQ、同义词、向量召回、澄清、上下文、追问和导航。
- 默认本地 BGE 中文向量模型、SQLite 向量存储、NumPy 检索；回答使用本地知识与业务模板。
- 演示场景必须经过真实业务接口；复位递增 datasetEpoch，隔离旧离线队列。
- 只拆接入所需结构，其他历史结构债单独记录。

## 阶段状态

| 阶段 | 内容 | 状态 | 核验记录 |
| --- | --- | --- | --- |
| 0 | 基线与盘点 | 通过 | [阶段 0](stages/00-baseline.md) |
| 1 | 后端工程、身份切换与 HTTP 接入 | 通过 | [阶段 1](stages/01-foundation.md)、[身份调整](stages/01-identity-only.md) |
| 2 | 数据模型、迁移链与媒体 | 通过 | [阶段 2](stages/02-storage.md) |
| 3 | 旧数据迁移 | 通过 | [阶段 3](stages/03-legacy-migration.md) |
| 4 | 档案、监测、预警 | 通过 | [最终核验](stages/04-monitoring.md)、[历轮报告](handoff/reports/04-monitoring.md)、[接口契约](contracts/monitoring-v1.md) |
| 5 | 巡检、问题、工单、保养 | 通过 | [最终复核](handoff/reports/05-field-work-final.md)、[返修报告](handoff/reports/05-field-work-fix.md)、[接口契约](contracts/field-work-v1.md) |
| 6 | 知识库、本地向量检索 | 通过（10/10门槛） | [完成与核验报告](handoff/reports/06-local-retrieval.md)、[接口契约](contracts/knowledge-v1.md)、[逐题结果](evidence/stage6-knowledge/retrieval/acceptance-final.json) |
| 7 | 助手与证据展示 | 通过（10月25日三项残留已核验关闭） | [最终复核](handoff/reports/stage7/04-final-acceptance.md)、[完成度报告](handoff/reports/07-assistant.md)、[前轮失败记录](handoff/reports/stage7/03-rr-review.md) |
| 7A | 双端亲和视觉、Web落地、App原型与宣传模板 | 进行中：5/8整项通过；104项素材已通过原生解码，余视觉确认、读屏/字号与性能复核 | [Web报告](handoff/reports/design/01-web-refresh.md)、[设计交付](handoff/reports/design/03-app-prototypes-assets.md)、[原生资源核验](handoff/reports/mobile/03-native-platform-probe.md) |
| 8 | OpenHarmony原生监测与在线现场业务 | 进行中：巡检写入、独立/任务上报、相册压缩上传及Web反馈回读已实测；退回补证/工单/预警统计/真机等继续推进，阶段未通过 | [问题照片报告](handoff/reports/mobile/06-native-reporting.md)、[巡检报告](handoff/reports/mobile/05-native-inspection.md)、[业务对照](handoff/stages/mobile/business-coverage.md) |
| 9 | OpenHarmony离线同步 | 计划已修订，未实施 | [详细计划](handoff/stages/mobile/09-offline-sync.md) |
| 10 | 比赛演示控制 | 未开始 | 完成后创建 |
| 11 | 综合验收与离线交付 | 未开始 | 完成后创建 |

## 完成度规则

每阶段记录实际交付、验收命令与结果、未完成项、阻塞和下一阶段条件。
代码完成、自动验证通过、真实运行通过分别记录；环境阻塞不能写成已通过。
以验收项为准，不用代码行数或已创建文件数推算完成率。

- [实施路线与验收门槛](roadmap.md)
- [数据迁移映射](data-map.md)
- [结构基线及行为约束](baseline.md)
- [阶段 4—11 详细实施与审核计划](handoff/README.md)
- [阶段完成度报告模板](handoff/completion-report.md)
- [赛题3要求、模拟范围、匿名材料与时间节点](design/competition-scope.md)
- [OpenHarmony原生App技术与页面规划](design/harmonyos-native-app.md)
- [双端视觉与比赛传播设计](design/competition-visual-system.md)
- [App卡通界面与参考组件映射](design/app-cartoon-ui.md)
