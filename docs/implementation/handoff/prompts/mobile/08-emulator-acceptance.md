# 转交工程师：阶段7A与阶段8独立验收

你负责筑瞳项目的独立验收，重点是原生模拟器操作和阶段7A视觉验收。请先检验、留证和报告，不擅自修改业务代码、不替项目负责人宣布通过。发现问题输出可复现步骤、风险和最小修复建议。

## 工作区与基线

- 工作区：`C:/Users/Lenovo/Desktop/demo`，分支`codex/fullstack-competition`。
- 本轮代码提交：`ef97e36`，之后若有文档提交，以实际HEAD和源文件哈希共同记录。
- 必须沿用当前工作区：Web视觉改版有既有未提交文件，它们是待验成果。先记录git status/diff，不reset、clean、stash，不用干净checkout把视觉成果丢掉。
- Web：Vue3/Vite；后端：FastAPI/SQLite/Alembic/uv；App：OpenHarmony ArkTS+ArkUI+Stage，包名`org.zhutong.mobile`。
- 五身份直接切换，无账号密码。AI逻辑本轮不变，不接外部API。硬件、读数与声光均明确模拟。
- 用户已确认无真机，继续模拟器验证。真机拍照/安装/实录单列未验证，不用模拟器冒充真机。

先阅读：
1. `docs/implementation/handoff/stages/design/07a-friendly-ui.md`
2. `docs/implementation/handoff/stages/mobile/08-openharmony-online.md`
3. `docs/implementation/handoff/stages/mobile/business-coverage.md`
4. `docs/implementation/handoff/reports/mobile/05-native-inspection.md`、`06-native-reporting.md`、`07-native-handling.md`
5. `docs/implementation/contracts/mobile/inspection-v1.md`、`reporting-v1.md`、`handling-v1.md`（以目录中的实际文件为准）

## 现状，不得混淆

本轮新增原生预警详情/确认/现场排查/处置说明/恢复关闭、声光模拟、楼栋楼层筛选、任务筛选、周月统计、设备模拟状态，以及已提交问题/工单照片查看。
后端追加`0014_device_telemetry`，设备新增可空telemetry，旧数据不默认正常或满电；补了档案/记录/预警/通知读取范围过滤和预警重放前授权。
App最近读数来自`GET /mobile/records`：每测点最近5条，避免全局旧记录截断。统计另从全量授权数据库聚合，不从这5条推算。

已完成的开发检查供你复核，不能代替模拟器实测：
- 后端303 passed，覆盖率89.07%，日志`backend/.runtime-stage8-finish/backend-final.log`。
- 原生Node转译/mocks 93 passed，核心行94.53%、分支81.09%，日志`coverage.log`；不是Hypium。
- Web125文件/1171用例通过；typecheck、build通过。主包仍有900KB阈值提示。
- SDK assembleApp曾成功；最新提交中的部分收口发生在该构建之后，请重新构建、签名、安装最新源码。
- 新页面尚未完成真实模拟器验收，不能把代码存在或上述检查通过写成页面已通过。
- 上次签名因HDC无目标失败；模拟器恢复后须重新签名，不能复用旧签名结果冒充本轮安装。
- 交接时18010/18011存在隔离验收服务；8080/18000没有监听。先检查实际状态，连接拒绝先区分环境与功能失败。

## 环境准备

DevEco：`D:/DevEco/Studio`；OpenHarmony SDK：`D:/DevEco/OpenHarmonySdk/20`。
HDC：`D:/DevEco/Studio/sdk/default/openharmony/toolchains/hdc.exe`。
已有模拟器为`Pura 90`，1320×2856，x86_64，运行时API24。公共SDK API20构建兼容性与运行环境分别记录。
用`Emulator.exe -list -details`和`hdc list targets`核验，不硬猜target。
已有模拟器可用`D:/DevEco/Studio/tools/emulator/Emulator.exe -start "Pura 90" -bootmode coldboot`恢复，不用reset模式。
若提示已运行却无HDC目标，收集启动/连接状态后诊断，不删除实例、不重置数据，不代替用户接受新协议。

构建沿用`mobile/openharmony/README.md`的环境与命令。签名入口：
`python scripts/mobile/sign_online.py --studio D:/DevEco/Studio --sdk D:/DevEco/OpenHarmonySdk --target <实际target>`。
HAP：`backend/.runtime-native-online/signing/entry-default-debug-signed.hap`。
安装使用HDC，Windows本地绝对路径用反斜杠。记录构建退出码、HAP字节数/SHA、签名校验、实际安装和启动结果，不提交设备标识/会话密钥/私有签名材料。

测试写入必须在独立数据库，不写日常交付库：
- 数据目录`backend/.runtime-stage8-finish/api`，API18010、故障网关18011；源码脚本在`scripts/mobile/completion/`。
- 初始化/启动时设置ZHUTONG_RUNTIME_DIR与ZHUTONG_DATABASE_URL，使用`uv run python -m zhutong init`和`uv run uvicorn zhutong.app:create_app --factory --host 127.0.0.1 --port 18010`。
- 网关入口`python -m scripts.mobile.completion.proxy`；只转发18010，不用于交付。
- device18090→host18011用`hdc rport tcp:18090 tcp:18011`，App填`http://127.0.0.1:18090`。不要误用fport方向。
- 现有夹具已建立3类型测点、3设备、2预警、空态楼栋。先读`docs/implementation/evidence/stage8-online-completion/verification/business/fixture.json`并核对数据库，不盲目重复造数据。
- helper阶段顺序为`open_event`→调用`common.recover()`产生三次恢复复测→`close_event`。它们尚待真实运行，断言写死初始2预警，只适用于相应夹具，不适用于任意交付数据。
- Web验收另启隔离Vite5184代理18010，配置已有`backend/.runtime-stage8-finish/vite.config.mjs`。5184未运行时需要启动，不修改正式端口。
- 启动交付容器前备份现有数据，沿用`deploy/compose.yaml`；不得清空Docker卷、工厂重置、导入测试夹具覆盖交付数据。

## 必测业务与后置条件

每项记录实际身份、对象ID、epoch、操作前后rev、HTTP响应、数据库/审计/回执、截图或录屏。自动化失败保留原日志，查明原因后重新验证。

1. **身份隔离**：五身份切换无密码；楼栋空范围读不到档案/记录/预警/通知；处理中收回范围或角色，迟到响应不回填；旧回执不能绕过当前权限。
2. **监测/设备**：裂缝、倾角、振动读数/单位/时间/来源/质量正确；楼栋+楼层+类型筛选取交集；在线85%、离线12%低电量、未知/null均与数据库一致，缺字段不得显示满电/在线。振动仅统计窗口，不伪装原始波形。
3. **最近记录与长数据**：每测点最近5条正确；超过全局2000条后仍保留各测点最新记录。统计包含全部授权记录，不能用预览条数代替总量。
4. **预警确认**：safety从pending确认为handling；其他身份只读。模拟保存成功后丢响应，App显示待核验，原请求重试不重复增加审计/回执/时间线。
5. **排查/措施**：safety/property可追加至少10字说明；原时间线保留，不直接改变监测判定或关闭。角色、版本、epoch冲突明确失败，保留文字，不静默覆盖。
6. **恢复关闭**：未满足连续恢复条件不能关；3条有效恢复复测后recovering；核查依据与无需维修结论/当前已验收工单依据由服务端复核；成功才closed。工单验收、问题关闭和预警关闭独立成立。
7. **声光模拟**：常亮色块、一次本机短音、停止与离开页面释放资源；播放不改变事件状态。只记录实际音频API输出与可观察结果，不把输出字节当作已听到声音或实体声光已接通。
8. **统计**：近7天/30天、楼栋/测点频次、在用三类测点分布、日趋势、空态；核对Asia/Shanghai日界线、日期补零、首次触发计数及全部授权记录；迟到旧身份/旧筛选结果不能覆盖新页面。
9. **任务**：日期、状态、点检/巡检筛选；模拟/人工到点、必答清单、异常关联、逐点完成与Web一致。保留前批同对象闭环，不只检查列表。
10. **上报与补证**：独立/任务上报；原上报人从原问题补证，不重新选位置、不覆盖原始事实、不另建问题；需要图片时必须新增图片，已有与新增共同计3张/600KB。
11. **工单**：指定维修人一键接单，无多余确认；物业代接必须写原因；完工只必填措施，照片/材料可选；Web退回后显示原因、重接/返工，再验收、待复查和恢复结论闭环。
12. **受保护照片**：问题/工单已提交照片可在App查看；维修前/后/验收标签准确；Web与App下载同一压缩文件SHA一致；不匿名请求、不把ArrayBuffer放入响应式状态；离开/身份变化清除沙箱预览，迟到字节不写入。选图取消/拒绝权限/超限均不丢文字或假成功。
13. **持久化**：API与App重启后已提交数据可读；完整备份→校验→新目录恢复，逐表哈希/计数与媒体SHA一致。未提交跨进程离线草稿仍属于阶段9，不当作已实现。

## 阶段7A与原生体验验收

- 沿用现有青绿、暖白、卡通小瞳、校园图案和卡片；记录双端语义是否一致，不虚构用户已作新的视觉审批。
- Web375/768/1280/1920px关键页：总览、地图/趋势、预警、巡检、问题工单、助手、报表、设置；验证键盘、200%文字、焦点、减少动效、错误、权限和加载状态，装饰不遮挡内容。
- App竖屏与实际横屏/宽窗口分别截图，不能拉伸图片。已有工具支持`Emulator -instance "Pura 90" -rotation left/right`；先看实际屏幕方向再操作，测试后恢复。
- 实际系统字号放大后验证按钮、导航、选择器、表单、照片与长文本；文字不能截断、遮挡提交或产生死区。不要只改截图尺寸。
- 实际屏幕朗读验证可访问名称/顺序/状态播报；模拟器有`com.huawei.hmos.screenreader`包，但未验证启用/读出。若权限/协议/能力受阻，明确记录未验证原因，请用户操作必要授权，不能用axe或语义树冒充真实读屏。
- EntryAbility的ZhutongUX日志记录fontScale/screenReader/orientation，只导出相关行，勿导出完整设备隐私日志。
- 长列表至少500测点/5000记录独立压力夹具，记录API时延、实际首屏、分页/筛选与交互采样、内存/渲染可用性；App测点和任务每页20条。不能用下一rAF冒充真实屏幕呈现或通用FPS保证。
- 浏览器工具缺失时可用已有Playwright/axe，记录工具缺失及替代方式；参考`docs/implementation/evidence/stage7a-web-refresh/scripts/README.md`。不得用程序化点DOM代替原生App验收。
- 素材离线可读、无外网依赖、匿名模板与模拟标注核查，既有素材/原型证据可引用但要说明版本，不能把设计原型当原生实现。

## 交付报告

提交到`docs/implementation/handoff/reports/mobile/review/08-emulator-review.md`，原始证据另建`docs/implementation/evidence/stage8-engineer-review/`分层目录；每目录直接文件尽量≤8。
不要覆盖前轮失败证据，不提交数据库、token、session.key、设备UDID或私有签名配置。

报告必须包含：
1. 实际HEAD、工作区diff摘要、源码/HAP哈希、工具链、系统/API、设备/窗口/字体/读屏状态。
2. S7A-01—08、S8-01—14逐项表：通过/失败/未验证，具体证据路径、限制和结论；真机项单列，不能将未验证算通过。
3. 每条业务：起点、身份、操作步骤、对象ID、预期/实际、前后状态/rev、数据库/审计/回执及媒体核对。
4. 发现问题按P0/P1/P2/P3列出，附定位、稳定复现、影响、最小修复建议；纯环境阻断与代码缺陷分开。
5. 所有命令、开始结束时间、退出码及原日志；截图/录屏必须实际生成，缺失说明原因。
6. 备份恢复、源数据未污染、临时服务归属/清理、恢复App日常连接的结果。

结束时只给事实与建议“通过/不通过/待补证据”。最终阶段审核由项目负责人根据报告、完整计划和原始证据裁定。不要因为代码齐全就宣布阶段7A/8完成，也不要进入阶段9或改AI。
