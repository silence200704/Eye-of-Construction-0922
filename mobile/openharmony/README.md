# 筑瞳 OpenHarmony 原生 App

ArkTS + ArkUI + Stage；业务包名`org.zhutong.mobile`，版本`0.9.0-dev`。
2026-11-01全业务补齐：原生审核六类分流、派工、手工建单、维修返工、验收、复查与保养；两端前台5秒读取、持久草稿与依赖同步、专用演示集控制已实现，待集中界面验收。
请先读[功能身份操作表](../../docs/implementation/handoff/reports/mobile/business/02-role-guide.md)、[交付报告](../../docs/implementation/handoff/reports/mobile/business/01-completion.md)及[统一验收提示词](../../docs/implementation/handoff/prompts/mobile/business/01-unified-acceptance.md)。以下保留历次实现与证据边界。
当前完成在线基础、“校园守护手账”UI与巡检到点/检查写入，包含五个底部入口、测点详情、五身份切换、连接设置和动效偏好。
任务详情支持模拟NFC/人工核对、冻结清单、必答/异常依据、逐点完成、版本冲突及原请求重试。
独立/任务问题上报、原生相册压缩/上传/关联、问题池和Web反馈回读已接入；选图/提交均有失败与重试状态。
原生退回补证、工单办理、预警处置、设备状态、筛选与统计均已接入，部分闭环有独立模拟器证据。
底部新增「小瞳」：输入条固定为底部单行，提问先展示约 1.5 秒三步思考卡；形象直接使用电脑端 `src/components/assistant/xiaotong.png`（移动端复制为 `rawfile/playful/characters/xiaotong.png`），调用与 Web 同源的 `/datasets/demo-main/assistant/query`，支持通用问答和带 `workOrderId/issueId/pointId` 的上下文问答；工单/问题/巡检页有“问小瞳”入口，回答可定位到相关页面。当前上报草稿存在时，可把建议填入备注/描述，仍由人核对后提交，不会自动代办。

「监测趋势」已接入监测页与测点详情：选择单个传感器测点后查看近 7 天/30 天历史采样，按裂缝宽度、倾角双轴、振动有效值/峰值、温湿度分别出图；默认把上海时区同一天的多条采样合成日均点，也可切换回原始采样点，并显示基准线、规则快照中的三级阈值线、最近记录和有效/存疑/无效质量计数。趋势走现有 `/datasets/demo-main/records`，读取前后复核身份与数据集版本；无效质量记录不画入曲线，历史采样明确标为非实时，人工检查点不提供数值趋势。

照片回读/字号配置及大字号布局、就地反馈、统计分页已返修，等待新包复验；相机代码已有，模拟器真实拍照未通过，阶段7A、8仍待审核。

## 已核验环境

- DevEco Studio `D:/DevEco/Studio`，6.1.1.418；Node18.20.1、JBR21.0.8、Hvigor6.24.5。
- 独立公共OpenHarmony SDK `D:/DevEco/OpenHarmonySdk/20`，6.0.0.47/API20，组件元数据标记Beta1。
- compile/target/compatible SDK均20，runtimeOS OpenHarmony，设备类型default。
- Pura90模拟器x86_64，运行时API24。此记录不代表OpenHarmony物理设备已验证。
- `local.properties`本机配置`sdk.dir=D:/DevEco/OpenHarmonySdk`，不提交本机路径文件。

## 准备与构建

仓库根目录运行：

```powershell
python scripts/mobile/artwork/build.py
python scripts/mobile/prepare_online.py
$nativeTests = rg --files tests/mobile -g '*.test.mjs'
node --test $nativeTests
node scripts/mobile/verification/structure.mjs
python scripts/mobile/verification/structure.py
```

DevEco打开本目录并通过OHPM恢复锁文件对应依赖。在本目录构建：

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco/Studio/sdk'
$env:JAVA_HOME='D:/DevEco/Studio/jbr'
$env:Path='D:/DevEco/Studio/jbr/bin;D:/DevEco/Studio/tools/node;' + $env:Path
& D:/DevEco/Studio/tools/node/node.exe D:/DevEco/Studio/tools/hvigor/bin/hvigorw.js assembleApp --no-daemon
```

Hvigor未配置个人签名。仓库根目录的`python scripts/mobile/sign_online.py --studio D:/DevEco/Studio --sdk D:/DevEco/OpenHarmonySdk --target 127.0.0.1:5555`
使用SDK公开开发夹具生成设备绑定的30天debug签名，并校验HAP。其身份不能用于正式发布；私有profile/设备标识不提交。
签名包保存在`backend/.runtime-native-online/signing/entry-default-debug-signed.hap`。

## 连接与运行

App“我的→校园服务连接→设置”填写提供筑瞳同源API的电脑地址，实际设备通常为`http://电脑局域网IP:8080`。
模拟器不能把自身127.0.0.1默认当作宿主机。已核验的HDC映射为device18080→host8080：

```powershell
& D:/DevEco/Studio/sdk/default/openharmony/toolchains/hdc.exe -t 127.0.0.1:5555 rport tcp:18080 tcp:8080
```

先用`fport ls`检查映射是否存在，避免重复添加。在App填写`http://127.0.0.1:18080`。
首次采用服务端默认演示身份，五类身份直接切换，不用账号密码。仅保存成功服务地址、身份ID和动效偏好；令牌不落盘。

网络失败、身份变动或epoch不一致不会显示本地成功；旧身份在途响应会失效，完整快照载入前不展示半批数据。
巡检只允许任务指定角色办理，其他身份只读；工单按指定/实际接单人办理。历史监测不标成实时，无设备字段不填默认正常/100%电量。

## 结构与复验

`core`负责网络/身份/偏好，`data`负责DTO与快照读取，`features`负责页面，`shared/playful`负责8个可复用视觉组件。
自动复验入口为`scripts/mobile/verification/playful.py`，每个phase只操作`org.zhutong.mobile`并保存SDK布局和截图。
具体环境、结果、限制和阶段台账见`docs/implementation/handoff/reports/mobile/04-native-online-ui.md`。
2026-10-28巡检写入及原生实测见`docs/implementation/handoff/reports/mobile/05-native-inspection.md`。
2026-10-29问题/照片收口见`docs/implementation/handoff/reports/mobile/06-native-reporting.md`；63项Node/mocks不代表Hypium或真机通过。
全业务剩余项见`docs/implementation/handoff/stages/mobile/business-coverage.md`，不省略照片、问题、工单和离线流程。
原生补证、一键接单、完工与退回重办以及Web验收/复查闭环见`docs/implementation/handoff/reports/mobile/07-native-handling.md`。
正常接单不加确认；完工只必填措施。原生核心77项Node/mocks通过，SDK构建和模拟器安装/实际写入另有证据，非Hypium或真机。

2026-10-30交接：以上63/77项为历史批次；最新开发检查为2026-10-29的104项Node/mocks，核心与布局行94.85%、分支81.89%，SDK构建通过。
实际页面仍待工程师重新签名安装验证。见[本批交接](../../docs/implementation/handoff/reports/mobile/review/08-reading-layout.md)、
[统一复验提示词](../../docs/implementation/handoff/prompts/mobile/08-emulator-combined-recheck.md)，不再只运行根目录测试而遗漏子目录业务用例。

统一复验已关闭照片/字号两个P1，仍待宽窗、键盘、真实读屏及Web表单操作证据。
最新`845c564`明确预警未知结果文案，105项Node/mocks、SDK构建通过，新文案页面未复验；使用[剩余补验提示词](../../docs/implementation/handoff/prompts/mobile/08-evidence-gap-check.md)。

后续工程师已取得未知结果文案、Web真实表单和媒体途中归档拦截证据。最新`97f8ddc`补充照片权限变化的中性提示/当前窗口toast，107项Node/mocks和SDK构建通过，提示页面待验。
宽窗、软键盘、真实读屏与真机仍未验证；见[最新交接](../../docs/implementation/handoff/reports/mobile/review/followups/photo-feedback.md)。

用户已要求不等待补验，直接进入阶段9。“我的→离线随身包”现可把已读取的身份快照与任务现场笔记存入原生关系库，离线读取缓存并保留依据版本。
只有点击保存的笔记保证落库，尚无照片持久化/完整清单/上传命令队列，不会显示为服务端已提交；下一批继续同步能力。
首批114项Node回归、SDK构建与结构门禁通过，未安装或要求设备验收。见[阶段9首批报告](../../docs/implementation/handoff/reports/mobile/offline/01-local-pack.md)。

2026-10-31第二批：随身包内新增“离线上报·草稿与同步队列”，文字自动保存，上传用JPEG保存到filesDir，入队后固定内容/key；联网同身份可手动先传照片再提交问题。
schema2升级保留v1笔记，125项原生回归、SDK构建及结构门禁通过；本轮未签名安装/设备实测。
仍不含完整巡检清单/工单离线命令、冲突变基UI或自动联网同步，见[第二批报告](../../docs/implementation/handoff/reports/mobile/offline/02-report-outbox.md)。
