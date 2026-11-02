# 阶段8前置：原生构建、签名与平台能力核验

核验日期：2026-10-26（北京时间）。本轮在真实DevEco标准工程上完成独立平台实验，正式业务App尚未开始接入。
结论：OpenHarmony公共SDK编译、调试签名、当前模拟器安装启动、资源解码、原生网络和本地存储均已实测。
阶段8保持进行中，S8-01仍为部分完成，其余业务门槛不据此升级；未进入阶段9。

## 源码与工具

- 工程：[mobile/platform-probe](../../../../../mobile/platform-probe/README.md)，由先前DevEco实际创建的Empty Ability/ArkTS/Stage标准工程整理。
- bundleName=`org.zhutong.platformprobe`，`runtimeOS=OpenHarmony`，compile/compatible/target API均为20，deviceTypes=`default`。
- 独立SDK：`D:/DevEco/OpenHarmonySdk/20`，公共SDK6.0.0.47；5个组件元数据均为API20/Beta1。
- DevEco6.1.1.418、Hvigor/插件6.24.5、Node18.20.1、JBR21.0.8、OHPM6.1.2.285；没有替换原IDE随附SDK。
- 原生页面和框架使用公共`@ohos`接口；没有WebView、Flutter、RN、商业专有Kit或外部AI调用。
- 素材由`prepare_probe.py`按既有清单逐项校验SHA后生成rawfile；不重复提交104份资源副本。

最初随附HarmonyOS API24构建可以通过；直接切OpenHarmony API24则报缺少专用组件，失败日志保留。
随后按[OpenHarmony官方6.0发布页](https://github.com/openharmony/docs/blob/master/en/release-notes/OpenHarmony-v6.0-release.md)取得公共SDK，
官方整包SHA-256为`a315834ac133625efc912bd078f3e2b2550868d04aef1b5aa4f9679c8b3c9d8e`，实测一致。
只解包Windows组件至全新目录，保留NOTICE；未替用户点击协议、登录云账号或修改系统全局PATH。
官方发布页称6.0 Release，但压缩包组件标记Beta1，报告不把元数据改成Release。

## 实测结果

| 检查 | 实际结果 |
| --- | --- |
| OHPM安装 | exit0，既有模板锁文件同步成功；模板Hypium/Hamock单测未执行，不计为通过 |
| OpenHarmony Hvigor assembleApp | exit0，最终构建11.538秒；pack.info为API20/Beta1/default |
| 资源导入和解码 | 52 PNG + 52 SVG，104/104尺寸匹配；原生Image的PNG/SVG加载回调均true |
| 实屏 | 1320×2856原生截图与原生控件树，显示小瞳、校园图案、104/104和能力4/4 |
| 网络 | 原生HTTP经显式HDC反向转发读取电脑8080的health/ready，status=ready/database=sqlite |
| 身份目录 | 原生GET读取5类角色：safety/property/device/inspector/repair；没有创建会话或切换身份 |
| 关系库 | 独立沙箱RDB写入并关闭重开；签名包首次0→1，强停并重启进程后1→2 |
| 沙箱文件 | UTF-8标记实际写入并读回相等；报告从应用私有filesDir取回 |
| 签名 | 官方hapsigner sign-profile/sign-app/verify-app均exit0，代码签名与摘要校验通过 |
| 签名包安装/启动 | HDC明确install bundle successfully，aa明确start ability successfully；原生报告确认实际运行 |
| 结构 | 8份原生TS/ETS源码，最大95行；非UI函数SDK AST最大22行/3参数；UI方法人工复核最大22行/0参数；无目录直接文件数超8 |
| 原系统 | 本轮启动已安装Docker Desktop，原有筑瞳API/Web自动恢复；最终HTTP状态见机器记录 |

原生报告的sdkApi=24是**运行环境API**，不是编译目标；编译API20由产物pack.info证明。
最终筑瞳8080与18000均200；查寝8000/5173连接拒绝，本轮未启动、停止或修改查寝，不把端口并存项写成通过。
该模拟器镜像产品标签为HarmonyOS，核心属性为OpenHarmony；本轮不能推广为所有OpenHarmony真机兼容。
网络地址`127.0.0.1:18080`是模拟器端显式rport，不是把手机127.0.0.1误当电脑；正式App仍需连接设置与LAN核验。
关系库计数只证明独立实验持久化，不证明阶段9业务草稿、媒体队列或离线同步已完成。

## 签名说明与一次安装拒绝

使用SDK公开开发样例证书，debug profile绑定当前模拟器，有效30天；未申请提升ACL。
私有目录中的profile包含设备绑定，未提交Git；仓库只保存脱敏签名结果和公开证书验证日志。
该签名不代表正式分发/赛事发布签名，未把SDK公开样例密钥当作项目正式签名身份。
方法依据[OpenHarmony官方hapsigner](https://github.com/openharmony/developtools_hapsigner)。

早期com.example验证包以unsigned安装，后来signed覆盖时报9568332“install sign info inconsistent”。
没有关闭签名校验、卸载旧包或清空数据；改用独立org.zhutong.platformprobe标识后，签名包实际安装、启动和核验成功。
安装失败时HDC也可能退出0，因此本轮同时检查响应文本和实际应用报告，不以进程退出码代替安装成功。

## 验证命令与证据

准备/构建/签名命令详见工程README；设置的JAVA_HOME/PATH只影响当前构建进程。
本轮仅修改原生验证源码、辅助脚本和计划报告，未修改后端/Web业务实现，未为此重复跑全量Web/后端用例。
ArkTS编译仍有可抛异常API提醒；Hvigor未自动签名、未启用混淆；verify-app有可选outproof参数提醒，未宣称零警告。

- [最终签名包证据](../../../evidence/native-preflight/signed-openharmony20/result.json)、[签名结果](../../../evidence/native-preflight/signed-openharmony20/signing.json)。
- [逐项解码](../../../evidence/native-preflight/signed-openharmony20/assets.json)、[首次能力核验](../../../evidence/native-preflight/signed-openharmony20/capabilities-first.json)、[进程重启后](../../../evidence/native-preflight/signed-openharmony20/capabilities-after-restart.json)。
- [原生实屏](../../../evidence/native-preflight/signed-openharmony20/screen.png)、[控件树](../../../evidence/native-preflight/signed-openharmony20/layout.json)、[产物API](../../../evidence/native-preflight/signed-openharmony20/pack-info.json)。
- [构建日志](../../../evidence/native-preflight/builds/openharmony-api20.log)、[签名验证日志](../../../evidence/native-preflight/builds/signing.log)、[下载校验](../../../evidence/native-preflight/sdk/download-result.json)、[SDK元数据](../../../evidence/native-preflight/sdk/installed.json)。

## 阶段裁定与下一批

S7A-02的资源准备与离线原生导入已有证据，升级通过；7A整项从4/8变为5/8。
小瞳集中视觉确认、真实读屏/系统字号和业务长列表/原生性能仍待完成，不宣称7A全部通过。
S8-01的编译/调试签名/模拟器安装连通子项完成；五类身份切换、正式连接设置和真机部分仍待验收，阶段8整项通过仍为0/14。

下一批按计划建立mobile/openharmony业务工程，复用已验证的公共API20工具链和原生素材路径：
先接连接设置与五类身份（无账号密码、切身份取消旧请求），再接工作台/监测/预警/任务只读列表。
每批用服务端ID、授权范围和真实HTTP核对；上报、照片、工单、冲突与跨端闭环随后逐项实施。
系统图片选择/相机、Navigation返回、宽窗口和系统字号仍需最小实验，不用浏览器设计稿替代。
