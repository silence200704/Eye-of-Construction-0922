# 筑瞳 OpenHarmony 原生 App

ArkTS + ArkUI + Stage；业务包名`org.zhutong.mobile`，版本`0.8.0-dev`。
当前完成在线基础、“校园守护手账”UI与巡检到点/检查写入，包含四入口、测点详情、五身份切换、连接设置和动效偏好。
任务详情支持模拟NFC/人工核对、冻结清单、必答/异常依据、逐点完成、版本冲突及原请求重试。
独立/任务问题上报、原生相册压缩/上传/关联、问题池和Web反馈回读已接入；选图/提交均有失败与重试状态。
原生退回补证、工单办理、预警处置和统计仍按阶段8继续；相机代码已有，模拟器真实拍照未通过，不把本批完成等同整个阶段完成。

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
node --test tests/mobile/*.test.mjs
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
巡检只允许任务指定角色办理，其他身份只读；工单暂只展示。历史监测不标成实时，无设备字段不填默认正常/100%电量。

## 结构与复验

`core`负责网络/身份/偏好，`data`负责DTO与快照读取，`features`负责页面，`shared/playful`负责8个可复用视觉组件。
自动复验入口为`scripts/mobile/verification/playful.py`，每个phase只操作`org.zhutong.mobile`并保存SDK布局和截图。
具体环境、结果、限制和阶段台账见`docs/implementation/handoff/reports/mobile/04-native-online-ui.md`。
2026-10-28巡检写入及原生实测见`docs/implementation/handoff/reports/mobile/05-native-inspection.md`。
2026-10-29问题/照片收口见`docs/implementation/handoff/reports/mobile/06-native-reporting.md`；63项Node/mocks不代表Hypium或真机通过。
全业务剩余项见`docs/implementation/handoff/stages/mobile/business-coverage.md`，不省略照片、问题、工单和离线流程。
