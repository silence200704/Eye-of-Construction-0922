# 模拟器与中文界面核验

核对日期：2026-10-26。用户告知创建完成后，确认创建对象为Pura 90本地模拟器，原生业务工程尚未创建。

后续最新：已完成独立原生验证包构建、调试签名、安装与平台能力实验，见[平台核验](03-native-platform-probe.md)。下方为实例首次连接时的实测记录。

## 已验证

| 项目 | 实测 |
| --- | --- |
| DevEco简体中文 | 窗口显示“欢迎访问DevEco Studio”“设备管理器”；ide.general.xml的selectedLocale与lastSelectedLocale均为zh-CN |
| 创建实例 | Pura 90，phone，x86_64，4核/4GB，实例目录D:/DevEco/Emulator/deployed/Pura 90 |
| 镜像标签 | HarmonyOS 6.1.1(24) |
| 实际启动 | 官方Emulator CLI启动，isRunning=true；本轮CUA观察到模拟器锁屏，不冒充App界面 |
| HDC连接 | 127.0.0.1:5555 |
| 运行时API | param get const.ohos.apiversion → 24，退出0 |
| 运行时核心标识 | const.ohos.fullname → OpenHarmony-6.1.1.125，退出0 |
| 运行时类型 | const.product.model → emulator，退出0；软件版本emulator 6.1.0.126(SP1DEVC00E120R4P11) |
| 原系统 | Web8080、API18000健康接口均200，未修改查寝端口或进程 |

先通过DevEco设备管理器确认名称和镜像。设备管理器绑定的截图与窗口状态不一致，未继续按不匹配画面操作，改用官方Emulator帮助列出的CLI启动同一实例。
使用普通冷启动，未清空模拟器数据、重建实例、接受协议或修改Windows安全配置。模拟器保持运行供后续调试。
DevEco中文为用户在前次中断后已完成的设置；本轮仅读取和核验，不声称由本轮代改。

## 可重复的命令

```powershell
& D:/DevEco/Studio/tools/emulator/Emulator.exe -list -details -instancePath D:/DevEco/Emulator/deployed -imageRoot D:/DevEco/Sdk
& D:/DevEco/Studio/tools/emulator/Emulator.exe -start 'Pura 90' -instancePath D:/DevEco/Emulator/deployed -imageRoot D:/DevEco/Sdk
python scripts/mobile/probe_environment.py --studio-root D:/DevEco/Studio --emulator-root D:/DevEco/Emulator/deployed --target 127.0.0.1:5555 --output backend/.runtime-ui-refresh/emulator-recheck.json
```

启动命令的进程在模拟器运行期间保持存活；不把仍运行的进程写成已退出0。连接和系统参数读取均已实际完成。
[机器可读记录](../../../evidence/native-preflight/emulator-connected-20261026.json)保存版本命令、显式目标和各项退出码。

## 阶段口径

已解决“模拟器实例尚未创建/未启动”的环境缺口。镜像产品标签与运行时核心标识分别记录，不把一个属性等同全部兼容性证明。
仍待DevEco标准最小原生工程的HAP编译、签名/安装、启动及资源/网络能力验证；没有安装项目App，没有原生业务成果。
S8-01包含完整构建安装、身份和连接，当前只完成其中环境部分，不能标为通过。7A视觉和原生资源验证状态不在本轮自动升级。
