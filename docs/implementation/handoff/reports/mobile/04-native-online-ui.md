# 阶段8首批：原生在线基础与卡通界面

日期：2026-10-26。结论：本轮App界面重设计已实施并在真实运行的手机模拟器核验，原生在线只读基础可用。
阶段8仍为进行中，整项0/14；不以UI完成替代到点、上报/照片、办理、统计和真机验收，未进入阶段9。
核验对象仅为筑瞳Web/API/App，保留既有端口隔离。

## 实际交付

- `mobile/openharmony`：ArkTS/ArkUI/Stage业务工程，包名`org.zhutong.mobile`，版本0.8.0-dev。
- 工作台、监测列表、测点详情、检查任务/工单列表与空态、我的/身份/连接设置均为原生界面。
- “小瞳的校园守护手账”视觉：薄荷/奶油/杏桃色卡片、原创机器人与校园/工具箱插画、背景图案、贴纸、圆角行动卡。
- 交互：小瞳点按展开可收起的引导卡并直接进入监测；测点卡就地展开采样/质量/来源；按钮压下回弹、导航选中扩宽、连接折叠、真实数字更新强调。
- “轻动效”可关闭并跨进程保存；关闭后小瞳引导和任务切换照常可用。点击直接更新原生状态，不排队等待装饰动画。
- 应用图标与启动窗口使用同套小瞳素材和纸色底；不再引用DevEco默认图标资源。
- 13项原创SVG含清单、SHA与AI辅助标记；15份实际引用rawfile资源经清单校验复制，应用图标另生成到media目录。
- 保留青绿色品牌、现有后端与助手算法；不新增登录页、账号或密码。

来源与转译详见[设计规范](../../../design/app-cartoon-ui.md)。本轮通过Exa MCP及浏览读取用户提供的参考站点，
取其卡片/导航/展开/反馈思路，用ArkUI重写，没有把React组件、外站图片或在线字体加入App。

## 在线基础和数据边界

原生HTTP读取现有身份目录和内部演示会话，服务端确认当前身份；五类角色均有新版界面实际切换证据。
先取档案epoch，再取记录、事件、检查任务与工单，全部通过代次/epoch核对后才显示。
读取前后复核身份id/角色/楼栋范围；身份或连接变化清除旧数据和详情导航，并取消在途请求。
401仅允许同身份恢复一次；403不会改用高权限身份。令牌只在内存，连接偏好只保存成功地址与身份ID。

当前服务端快照：8个活动测点、18条监测记录、2个事件，其中1个未关闭；检查任务0、工单0。
首页显示8/1，空任务显示工具箱空态，没有为展示创建任务、问题、附件或工单。
倾角测点读X0.07/Y0°，详情记录`R20261018-009`；来源、质量和规则版本可见，旧采样标“历史采样，非实时数据”。
倾角历史正确显示其已关闭事件`E20261018-002`，没有混入裂缝事件`E20261018-001`。
服务未提供设备电量/最近设备上报时间时显示未知，不补成正常或100%。所有硬件输入保留模拟标记。

## 实测环境、构建与签名

| 项目 | 实际结果 |
| --- | --- |
| IDE/工具 | DevEco6.1.1.418、Hvigor6.24.5、Node18.20.1、JBR21.0.8 |
| 编译SDK | 独立OpenHarmony公共SDK6.0.0.47/API20，组件标记Beta1，runtimeOS=OpenHarmony |
| 安装目标 | Pura90 x86_64手机模拟器，1320×2856，运行时API24/核心标识OpenHarmony-6.1.1.125 |
| Hvigor assembleApp | 退出0，最终构建12.054秒，生成原生HAP |
| 调试签名与验签 | 退出0，codeSigning=true、Digest verify=true、verify-app success |
| 安装/启动 | HDC明确返回install bundle successfully、aa start ability successfully；实际控件树属于org.zhutong.mobile |
| 连接 | device18080→host8080显式HDC反向映射；App调用筑瞳同源API，后台18000 |

签名包SHA-256：`1eb8b36092bad191ada73dee6b0846f96b4aa78668eee690565eaf240d2b7f8f`，442669字节。
本地包：`backend/.runtime-native-online/signing/entry-default-debug-signed.hap`。
使用公共SDK开发签名夹具，设备绑定debug profile，过期2026-11-25T14:07:43Z，没有提升ACL；不是正式发布身份。
设备标识、私有profile及HAP不放入公共证据目录。原始Hvigor未配置个人签名的skip提示保留，之后独立签名与验签成功。
构建仍有Preferences.getSync可能抛异常的提示，未将warnings描述为0；未使用商业专有Kit。

## 核验结果与证据

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 核心逻辑回归 | Node23/23通过；加载实际.ets逻辑，原生HTTP/Preferences使用mock，不冒充Hypium | [测试日志](../../../evidence/stage8-playful/builds/node-tests.log) |
| 原生结构 | SDK ArkTS解析器递归扫描45个ETS/TS/MJS文件、309个函数；最大文件183行、函数31行，参数/目录超限0 | [结构](../../../evidence/stage8-playful/builds/structure-native.json) |
| Python/素材 | 辅助脚本无超长函数/超参；13项SVG的XML/大小/SHA一致，无外部素材引用 | [结构与素材](../../../evidence/stage8-playful/builds/structure-assets.json) |
| 工作台 | 真实8/1、欢迎卡、两个入口、点按小瞳；不据截图声称帧率达标 | [首页](../../../evidence/stage8-playful/page/home/screen.png)、[点按](../../../evidence/stage8-playful/verification/home.json) |
| 监测/详情 | 三类型切换、详情返回保留筛选、历史预警范围正确，真实记录号可核对 | [监测](../../../evidence/stage8-playful/page/monitor-tilt/screen.png)、[详情](../../../evidence/stage8-playful/page/point/screen.png)、[交互结果](../../../evidence/stage8-playful/verification/monitor.json) |
| 任务/工单 | 原生分段切换与两种真实空态 | [任务](../../../evidence/stage8-playful/page/tasks/screen.png)、[工单](../../../evidence/stage8-playful/page/orders/screen.png) |
| 五身份/连接卡 | 五身份选中态与服务端当前角色一致；连接设置展开/收起 | [身份结果](../../../evidence/stage8-playful/verification/identities.json)、[我的](../../../evidence/stage8-playful/page/profile/screen.png) |
| 轻动效 | 关闭后任务切换可用，force-stop/start后Toggle仍false，最终恢复开启 | [结果](../../../evidence/stage8-playful/verification/appearance.json)、[重启截图](../../../evidence/stage8-playful/page/motion-off-restart/screen.png) |
| 错误连接 | 18081失败可见，旧计数清除为“—”；重启恢复上次成功的18080连接与安全身份 | [结果](../../../evidence/stage8-playful/verification/error.json)、[失败页](../../../evidence/stage8-playful/page/error-clears-data/screen.png) |
| HTTP交叉核对 | 五类身份读取同一演示库，服务端计数与App一致；验证客户端会话已退出，无业务写入 | [快照](../../../evidence/stage8-playful/verification/server.json) |

截图均由SDK uitest从运行中的App采集，并配套保存原生layout.json；未用Web原型/拼图代替原生截图。
模拟器输入法首次隐私提示曾打断地址输入，已选择取消/退出输入法，未同意其条款；之后最终地址失败/恢复复验通过。
SDK按包过滤在输入法切换期间偶尔返回空树，采集器会从全局树中只保留包名匹配且focused的App原生根，系统界面不进入公开页面证据。
最终安装版本的六组UI复验均在本轮最终签名之后执行；旧平台/基础证据保留为历史，不据旧截图宣称新版验证。
页面人工视觉检查覆盖首页、监测、详情、任务/工单、身份、动效偏好与错误页；尚未进行完整读屏/字号验证。
命令退出码见[记录](../../../evidence/stage8-playful/builds/command-results.json)，签名/源文件指纹和页面索引见[交付清单](../../../evidence/stage8-playful/verification/delivery.json)。

## 与计划衔接

S8-01/02/08/09/11/14的在线只读与手机UI子项已有证据，14项整项验收均不提前升级。
阶段7A仍5/8，保留品牌最终视觉确认、读屏/大字号和性能缺口。本批没有全量重测未修改的Web/后端，也不重复宣称它们的新通过数。
下一批先任务详情/模拟到点/人工原因/检查清单，再问题与照片，再工单办理和Web验收。
App历史预警确认/排查/处置、建筑/楼层筛选、统计和宽窗适配尚待实施或验收。
真机拍照/相册、触控大字号/读屏、长列表性能、Hypium、物理OpenHarmony设备和阶段9离线队列均未完成，不列为本轮通过。
