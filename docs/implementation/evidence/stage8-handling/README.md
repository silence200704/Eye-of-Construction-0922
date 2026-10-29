# 原生补证与工单接续证据

2026-10-29。交付库与隔离验收库分开。阶段8仍进行中；无真机/Hypium/离线持久化通过声明。

- [最终断言清单](verification/final.json)：源提交、源哈希、HAP哈希、测试与容器核对。
- [契约](../../contracts/mobile/handling-v1.md)：接口、权限、事务、错误和简洁操作约定。
- [报告](../../handoff/reports/mobile/07-native-handling.md)：本批通过项与阶段剩余项。
- [业务](verification/business/)：原始问题、补证、Web验收、复查关闭与最终HAP文字工单。
- [命令](verification/commands/)：真实响应丢失、重试前后计数及权限收回重放。
- [持久化](verification/runtime/)：两次独立目录恢复、40表哈希与3个媒体SHA。
- [交付库](verification/delivery/)：重建前后业务摘要一致，未把隔离验收数据写进日常演示库。
- [页面](page/)：原生SDK布局/截图与Web截图/AX，均为真实操作结果。

原生最短完工流程：任务→维修工单→查看并办理→一键接单→填写措施→提交完工。
补证流程：原问题卡片→补充材料→填写补充说明/按要求加图→提交，无需重复选位置。
Web验收/复查各自留痕，不因减少点击把验收当成关闭。

主闭环使用一条模拟问题和一张关联工单；最终HAP另做一张手工工单的无照片最短路径。
合成图片明确写有SIMULATED ACCEPTANCE IMAGE，不能作为真实校园缺陷或硬件证据。
原生相册动作在系统选择器中实测；相机/真机仍按前批已记录限制保留待验收。

构建与测试日志按backend/native/web/deployment分组；[cycles](builds/cycles/)保留失败结果。
`backend-first-full`是旧契约回归296过/1失败，已通过独立targets接口修复；最终pytest297通过。
`ui-open-order`漏切工单页签、`ui-completion`误匹配成功提示均为自动化脚本失败，不能算业务通过。
后续返工场景重新记录提交已保存但响应丢失，重试前后六类计数及工单行一致；最终HAP再独立实测正常最短流程。

复验入口：`scripts/mobile/handling/{common,ui_flow,smoke,verify,collect}.py`。
只对新的独立数据库运行common初始化夹具；ui_flow须按报告顺序穿插Web审核/验收和系统相册选择。
网关18009仅向隔离API18008转发，并按显式标记丢失一次成功响应；不用于交付系统。
服务端运行、备份和媒体文件留在忽略目录`backend/.runtime-native-handling`，不提交会话密钥或私有签名材料。
