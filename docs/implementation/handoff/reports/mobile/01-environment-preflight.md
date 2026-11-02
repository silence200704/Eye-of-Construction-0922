# 原生开发环境预检

核对日期：2026-10-26。用户说明工具已下载后，检查本机安装、SDK描述文件和实际版本命令。
本次完成环境盘点与证据，不创建原生业务工程，不把阶段7A或阶段8标为通过。

后续最新：独立OpenHarmony公共SDK API20已编译并签名安装，资源/网络/本地存储通过；见[平台核验](03-native-platform-probe.md)。下方为首次环境预检记录。

后续进展：用户已创建Pura 90并已启动连接，DevEco中文界面也已核验；见[模拟器核验](02-emulator-connected.md)。下方为空目录的记录保留为首次预检历史。

## 实测现状

| 项目 | 结果 | 依据 |
| --- | --- | --- |
| DevEco Studio | 6.1.1.418 | D:/DevEco/Studio/product-info.json；注册表安装位置一致 |
| SDK产品 | HarmonyOS 6.1.1，API24，6.1.1.125 | sdk/default/sdk-pkg.json |
| 公共组件 | ets/js/native/previewer/toolchains，API24 | openharmony各组件oh-uni-package.json |
| Node | v18.20.1 | DevEco自带node.exe --version，退出0 |
| OHPM | 6.1.2.285 | DevEco自带node执行pm-cli.js --version，退出0 |
| Hvigor / 插件 | 6.24.5 / 6.24.5 | package.json读取，未运行构建任务 |
| HDC | 3.2.0d | hdc.exe -v，退出0；未启动设备发现服务 |
| JBR | OpenJDK21.0.8 | java.exe -version，退出0 |
| 本地模拟器 | 当前配置D:/DevEco/Emulator/deployed为空 | 未据此推断所有路径都无镜像；未验证实例启动、系统/API或HAP安装 |

SDK产品标签为HarmonyOS；包含名为openharmony的公共组件目录，不能仅凭目录名就宣布目标OpenHarmony设备兼容。
参赛要求的OpenHarmony原生路线保持，具体编译目标、运行环境和可用API仍需按S8-01锁定与实测。
未替用户接受软件协议、安装额外软件、调整系统PATH、下载镜像或登录账号。

## 下一步最小核验

1. 在DevEco设备管理器确认并启动可用手机模拟器，记录实际系统、API和镜像版本；需要的首次确认由用户完成。
2. 对照目标OpenHarmony运行环境配置匹配SDK；当前自带SDK作为候选，不先承诺兼容性。
3. 使用DevEco标准工程完成原生页面最小编译、签名/安装和启动；得到真实构建任务与退出码后再锁定工具组合。
4. 用最小工程验证PNG/SVG资源、Navigation返回/窗口、系统字号、私有文件、图片选择和局域网连接，再接业务页。

与7A的关系：当前解决了“工具未安装”的历史环境缺口；资源实际导入、真实读屏和原生性能仍未验证，7A计分暂不改变。
与阶段8的关系：工具版本可读不等于S8-01构建安装通过；目前仍无HAP验收结果。

## 证据与复跑

[机器可读实测](../../../evidence/native-preflight/environment-20261026.json)。探测脚本仅读取允许的工具元数据与版本输出，不读取签名材料。

```powershell
python scripts/mobile/probe_environment.py --studio-root D:/DevEco/Studio --emulator-root D:/DevEco/Emulator/deployed --output backend/.runtime-ui-refresh/native-environment-recheck.json
```

官方参考：[OpenHarmony 6.0发布说明](https://github.com/openharmony/docs/blob/master/en/release-notes/OpenHarmony-v6.0-release.md)提供对应工具/SDK包信息，
[DevEco官方介绍](https://developer.huawei.com/consumer/cn/deveco-studio)介绍开发和模拟器能力；本报告版本以本机实测为准，不以网页最新版本替换已安装版本。
