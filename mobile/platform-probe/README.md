# 原生平台能力验证工程

由本机 DevEco Studio 实际创建的 Empty Ability / ArkTS / Stage 工程整理而来。
这是独立平台实验，bundleName 为 `org.zhutong.platformprobe`，不是正式业务 App。
当前编译使用 OpenHarmony 公共 SDK 6.0.0.47/API20，runtimeOS=OpenHarmony，设备类型为 default。
SDK来自官方6.0发布页，压缩包SHA-256已核验；组件元数据标记Beta1，保留该标记。
运行环境为Pura 90模拟器，镜像标签HarmonyOS 6.1.1，实际核心标识OpenHarmony-6.1.1.125/API24。

## 运行

在仓库根目录执行 `python scripts/mobile/prepare_probe.py`，按素材清单验证 SHA 后生成 rawfile。
在 DevEco 打开本目录并同步依赖；Node/OHPM/Hvigor/JBR 使用已安装工具版本。
没有提交 local.properties、签名材料、设备数据和构建缓存。

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco/Studio/sdk'
$env:JAVA_HOME='D:/DevEco/Studio/jbr'
$env:Path='D:/DevEco/Studio/jbr/bin;D:/DevEco/Studio/tools/node;' + $env:Path
Set-Location mobile/platform-probe
Set-Content -LiteralPath local.properties -Value 'sdk.dir=D:/DevEco/OpenHarmonySdk'
& D:/DevEco/Studio/tools/node/node.exe D:/DevEco/Studio/tools/ohpm/bin/pm-cli.js install
& D:/DevEco/Studio/tools/node/node.exe D:/DevEco/Studio/tools/hvigor/bin/hvigorw.js assembleApp --no-daemon
```

锁文件保留 DevEco 模板的 Hypium/Hamock 开发依赖；本工程未执行其模板单测，不把构建当单测。
OHPM 6.1.2 的 install 帮助没有离线参数；首次同步需要镜像站可达或已有缓存，不修改锁文件规避依赖校验。

模拟器 `127.0.0.1:5555` 连接后，显式建立
`hdc -t 127.0.0.1:5555 rport tcp:18080 tcp:8080`。
这里只为开发实验把模拟器 18080 反向转发至电脑 8080，不把设备 loopback 当作电脑地址。
正式 App 的连接设置和 LAN 验证另行实现，不沿用此地址为用户默认值。

## 验证边界

- 原生图片框架逐项解码 52 PNG / 52 SVG，匹配登记尺寸并释放像素资源；两张原生 Image 实际加载回调另记录。
- 网络只 GET 现有 `/health/ready` 与 `/demo/identities`；不生成会话，不执行任何业务写入。
- 仅在本 App 沙箱创建独立关系库计数表、UTF-8 文件与 JSON 报告；不访问服务端 SQLite。
- `native-asset-report.json` / `native-capability-report.json` 写入本 App 的 filesDir；进程重启后核对前后计数。
- 调试签名HAP已经校验、安装并启动；仅当前模拟器，不表示真机或参赛发布签名已验收。
- `assembleApp` 有可抛异常 API 的 ArkTS 提醒、未配置混淆与未签名提醒，不能称为零警告。

## 调试签名

回到仓库根目录执行：

```powershell
python scripts/mobile/sign_probe.py --studio D:/DevEco/Studio --sdk D:/DevEco/OpenHarmonySdk --target 127.0.0.1:5555
```

脚本只允许签本验证包，使用SDK公开开发样例证书，生成绑定当前模拟器且有效30天的debug profile。
不申请提升ACL，不修改设备校验，不复制SDK私钥，不签正式业务App；profile及HAP写入被Git忽略的backend/.runtime-native-probe/signing。
完整code signing和verify-app均已通过。此公开样例身份不用于正式分发；正式签名后续另办。
构建仍产出unsigned HAP，由此脚本独立签名，不把Hvigor“skip sign”提示改写为Hvigor已签名。

安装时使用本机HDC和Windows绝对路径，检查stdout的实际安装结果，不能只看退出码。
旧com.example验证包与新org.zhutong验证包分开，避免签名不同导致覆盖失败；没有卸载旧包或清空其数据。
正式 App 计划位于mobile/openharmony，本批没有创建业务App，也不混用验证包充当业务交付。
