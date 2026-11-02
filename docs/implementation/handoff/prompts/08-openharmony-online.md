# 阶段8执行提示词：OpenHarmony原生App

请在现有筑瞳仓库实施阶段8，先核验阶段7复审与7A原型前置，再读AGENTS.md、实施台账、
stages/mobile/08-openharmony-online.md、三份design文档、field-work/monitoring/media/http契约。
历史Flutter、Android、APK计划已被替代，不创建Flutter、uni-app、React Native或H5壳。

1. 使用DevEco Studio创建mobile/openharmony，ArkTS+ArkUI+Stage，OpenHarmony API≥12；
   先冻结SDK/工具链/目标运行环境，验证构建、签名安装、原生HTTP、照片与关系库最小实验。
2. API/数据库仍复用FastAPI+SQLite/Alembic，身份/范围/幂等/rev/epoch同契约；App本地schema单独管理。
3. 四入口为工作台/监测/任务/我的；上报为主要行动入口。监测含倾角/裂缝/振动、设备在线电量、
   建筑/楼层/类型筛选、历史预警；显示实际数据源与时间，缺值未知，不写死健康数字。
4. App能按权限确认预警、记录排查与处置措施并查看维护台账；复用原命令和关闭条件，不只跳Web办理。
5. 原生统计含预警频次、类型分布、周/月趋势，与数据库聚合一致；仅有模拟数据也如实标注。
6. 完成点检巡检、模拟NFC/人工到点、清单、照片问题上报、接单/完工/退回重办；Web执行审核验收。
7. 原生照片采集/选择/压缩/上传保留3张/600KB约束，固定draftId/submissionId/幂等键，失败不假装已保存。
8. 用7A小瞳/插画/图案与token实现亲和页面，保留原生返回、安全区、字体缩放、触控和状态反馈。
9. 全部南向输入模拟；不采购硬件、不开发GPIO/I2C，不声称实体声光已通。普通设备能力如拍照须真实调用并记录。
10. 真机/模拟器/预览器分别留证；ArkTS检查、原生单测/UI测试、Hvigor构建、安装实录和数据库/回执核对。

先在线主链路，再阶段9持久队列；本阶段未支持的离线提交明确失败。App主要通过LAN电脑地址访问8080 API。
不修改8000/5173，不清演示数据和Docker卷；正式截图/视频匿名，不能把模拟器输出称真机。
按S8-01—14逐项提交；未通过前不进入阶段9。没有设备/签名/SDK时记录阻塞，不伪造HAP安装结果。
