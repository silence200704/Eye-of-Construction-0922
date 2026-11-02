# 阶段7A与阶段8独立验收（模拟器）

日期：2026-10-29。对象：筑瞳 Web/API/OpenHarmony App。结论：**建议不通过当前 HAP**。
本轮有实际模拟器操作与数据库/审计/回执核对，也发现两个可稳定复现的 P1 缺陷；真机项、宽窗与真实读屏未验证。
本报告只给事实与建议，不宣布阶段7A/8完成，不进入阶段9，未改业务代码与AI。

## 0. 结论先行

- 预警确认→现场排查→三次恢复复测→关闭全链在模拟器实际操作通过，审计/回执/时间线/通知同步；声光模拟只改本机输出，不改事件状态。
- 设备在线/离线低电量/未知三态与数据库一致；楼栋+楼层+类型交集筛选、空态楼栋正确；周/月统计与授权数据库一致。
- Web 60 个页面/宽度组合 0 溢出、11 项键盘/焦点/减少动效交互通过、15 页 axe 0 违规；Web 200% 等效视口 0 裁切。
- **P1：已提交照片连续回读失败**。第一张成功后，后续每张都显示红色 `File exists`，直到清空 App 缓存目录；维修前/后/验收标签因此不能正常连续核验。
- **P1：系统字号放大不生效**。系统字体设为“特大”并重启应用后，EntryAbility 仍记录 `fontScale=1`，界面截图与标准字号一致；App 未声明跟随系统字体。
- App 横屏/宽窗未能由现有模拟器命令产生；真实读屏需用户确认开启，本轮未代替用户接受；真机拍照/安装/实录未验证。
- 建议：**不通过**，先修两个 P1（照片缓存目录、字体配置），再复验照片连续回读、字体放大，并补宽窗/读屏与真机证据。

## 1. 基线、构建与运行环境

| 项 | 实际值 | 证据 |
| --- | --- | --- |
| HEAD | `7842e701f554d09a803bd6cee81d4fa772cb3fb9`，分支 `codex/fullstack-competition` | [head.txt](../../../../evidence/stage8-engineer-review/baseline/head.txt) |
| 工作区 | 87 项未提交改动；49 文件变更（815+/912-），均为交接前已有 Web 视觉与文档改动；本轮未 reset/clean/stash | [git-status.txt](../../../../evidence/stage8-engineer-review/baseline/git-status.txt)、[git-diff-stat.txt](../../../../evidence/stage8-engineer-review/baseline/git-diff-stat.txt) |
| 原生源码 | 68 个 ETS/TS 文件，逐文件 SHA-256 | [source-hashes.json](../../../../evidence/stage8-engineer-review/baseline/source-hashes.json) |
| Hvigor 构建 | 退出码 0，`BUILD SUCCESSFUL in 10 s 49 ms`；未签名 HAP 973,042 字节，SHA-256 `3077222c…6472` | [hvigor.log](../../../../evidence/stage8-engineer-review/builds/native/hvigor.log) |
| 签名 | 退出码 0；debug 公共 SDK 夹具，profile 到期 2026-11-28；签名 HAP 1,018,296 字节，SHA-256 `602eb303764036f538c7ed881660b7c1c2bb1c05e765ae492ce9af5db1e07c47` | [signing.log](../../../../evidence/stage8-engineer-review/builds/native/signing.log) |
| 安装/启动 | HDC `install bundle successfully`、`aa start ability successfully`；14:55 直接捕获 `install_exit=0 start_exit=0`；运行包 `org.zhutong.mobile` 0.8.0-dev，API target/compatible 20，debug | [install-rerun.log](../../../../evidence/stage8-engineer-review/builds/native/install-rerun.log)、[install.json](../../../../evidence/stage8-engineer-review/builds/native/install.json) |
| 工具链 | DevEco 6.1.1.418 / Hvigor 6.24.5 / Node 18.20.1 / JBR 21.0.8；OpenHarmony 公共 SDK 6.0.0.47 API20（Beta1） | `mobile/openharmony/README.md`、构建日志 |
| 设备 | Pura 90 手机模拟器，x86_64，1320×2856，运行时 API24，系统 `emulator 6.1.0.126` | [03-native-platform-probe.md](../03-native-platform-probe.md)、HDC 实查 |
| 服务 | 隔离 API 127.0.0.1:18010 + 故障网关 18011；device 18090→host 18011 反向映射；App 地址 `http://127.0.0.1:18090` | 启动前端口检查、HDC `fport ls` |
| 系统字号 | 验收时切到“特大”再恢复“标准”；App 日志始终 `fontScale=1` | [font-scale.json](../../../../evidence/stage8-engineer-review/verification/defects/font-scale.json) |
| 读屏 | `com.huawei.hmos.screenreader` 已安装、默认关闭；点击开关出现系统确认“开启 (5 秒)”，未代替用户接受 | [screenreader.json](../../../../evidence/stage8-engineer-review/verification/ux/screenreader.json) |
| 横竖屏 | 多次 `-rotation left` 均返回 `Scenario simulation success`，屏幕仍 1320×2856；旋转锁定为关闭 | [rotation.json](../../../../evidence/stage8-engineer-review/verification/ux/rotation.json) |

> App 连接地址、身份与字号已恢复：最终截图显示“已连接”、3 个测点、1 个未关闭预警、`当前：学校安全管理人员`（[final-home](../../../../evidence/stage8-engineer-review/page/restore/final-home/screen.png)、[final-profile](../../../../evidence/stage8-engineer-review/page/restore/final-profile/screen.png)）；系统字号恢复“标准”，读屏保持关闭，旋转锁定保持关闭。

## 2. 验收口径

- 只把本轮实际点按、实际 HTTP/数据库读写与截图算作本轮证据；开发方自测日志只作复核，不代替模拟器操作。
- 模拟器等于模拟器，不等同真机；相机、真机安装、真机实录单独列为未验证。
- 测试写入全部在 `backend/.runtime-stage8-finish/api` 隔离库；未写交付库、未清 Docker 卷、未工厂重置。
- 照片链与工单通过真实服务端命令建立（工单验收由 safety 命令完成，不是本轮 Web 点按），App 回读为实际操作；本轮未复演 App 相册选图上传。
- 页面截图由 SDK `uitest screenCap` 实际生成并保存 `layout.json`；未用 Web 原型或拼图代替。

## 3. S7A-01—08

| 编号 | 结论 | 本轮实际证据与限制 |
| --- | --- | --- |
| S7A-01 | 通过 | Web 与 App 同用青绿/暖白、小瞳与卡片语义；Web 截图与 App 原生截图均实际生成。视觉方向沿用此前确认，本轮未新增用户审批。 |
| S7A-02 | 通过 | 既有 104 项素材在 API20 签名包解码显示的结论仍成立；本轮 Web 验收 `outboundRequests=0`，App 无外网资源依赖。素材清单/许可沿用前轮。 |
| S7A-03 | 通过 | Web 15 个关键页 × 4 宽度共 60 组合，`docWidth==width`、卡片越界 0；11 项交互全部通过；真实业务数据未被替换。[results.json](../../../../evidence/stage8-engineer-review/web/results.json) |
| S7A-04 | 未验证 | App 已有监测/预警/统计/现场页与状态组件；但本轮未能产生横屏/宽窗，宽窄窗口下的关键原型落地未实测。 |
| S7A-05 | 失败 | Web：键盘/焦点/Skip link/减少动效通过，15 页 axe 0 违规；App：系统“特大”字号不生效（P1），真实读屏未启用（需用户授权）。字体项直接不满足。 |
| S7A-06 | 未验证 | Web 375/768/1280/1920 截图齐全且无溢出；App 横屏/宽窗截图未取得（模拟器旋转命令无效），不能以竖屏截图替代。 |
| S7A-07 | 通过 | Web 本机采样 median 5.2ms、p95 6.2ms、>50ms 0 帧、无外网请求；App 500 测点/5006 记录压力夹具 API 与分页可用；构建通过。未宣称真实 FPS。 |
| S7A-08 | 未验证 | 传播模板/匿名版沿用前轮交付，本轮未重新核对 DOCX/PPT/视频模板；不据旧材料宣称本轮通过。 |

## 4. S8-01—14

| 编号 | 结论 | 本轮实际证据与限制 |
| --- | --- | --- |
| S8-01 | 通过（模拟器） | 最新源码重新构建、签名、安装（直接退出码 0）、启动（退出码 0）；五身份无密码切换并显示“当前：…”。真机安装单列未验证。 |
| S8-02 | 通过 | App 工作台 3 测点/1 未关闭预警与数据库一致；Web 预警页同一时刻显示待确认 1、已关闭 1；切身份后按当前角色重载，动作按钮随角色变化；未做逐对象全量残留比对。[1280-alarms.png](../../../../evidence/stage8-engineer-review/web/pages/1280/1280-alarms.png) |
| S8-03 | 未验证 | 本轮夹具无巡检任务，未复演错标签/人工原因/必答/异常后续校验；前轮 05 报告有实测，不能据此升级本轮。 |
| S8-04 | 未验证 | 真机拍照/相册未验证；模拟器相册选图本轮未复演。已提交照片的 App 回读另见 P1 缺陷。 |
| S8-05 | 通过 | 预警确认响应被网关丢弃后，App 显示待核验；原请求重试后 rev/时间线/通知/审计/回执完全不变。[ack-retry.json](../../../../evidence/stage8-engineer-review/verification/alerts/ack-retry.json) 问题/工单重试沿用前轮 06/07 实测。 |
| S8-06 | 未验证 | 本轮未复演“App 接单完工→Web 验收→待复查”闭环；前轮 07 有模拟器证据。 |
| S8-07 | 未验证 | 仅验证“恢复前关闭”被服务端 409 拒绝，未做 Web/App 跨端版本冲突与迟到响应专项。 |
| S8-08 | 未验证 | App 多次 force-stop/start 后问题/工单/预警仍可读；新 API 进程读取同库副本与 18010 完全一致。但未重启 18010 本体，不能据此宣称 API 重启通过。[fresh-process.json](../../../../evidence/stage8-engineer-review/verification/persistence/fresh-process.json) |
| S8-09 | 失败 | Hvigor 构建与安装通过；但系统字体放大不生效（P1），App 宽窗未取得；原生 93 项 Node/mocks 为开发方日志，非 Hypium。 |
| S8-10 | 未验证 | 无真机，巡检上报/工单处理真机实录均未取得。 |
| S8-11 | 通过 | 裂缝/倾角/振动读数、单位、采样时间、来源、质量正确；在线85%、离线12%低电量、未知/null 与数据库一致；无遥测设备显示未知而非满电/在线；楼栋+楼层+类型交集正确。[states.json](../../../../evidence/stage8-engineer-review/verification/device/states.json) |
| S8-12 | 通过 | 历史预警可见已关闭事件与关闭依据；确认/排查/恢复/关闭全链实际点按；safety 可写、property 只能登记、inspector 只读；rev 1→5、审计 27→34、回执 25→31、通知 3 条同刻确认；Web 同步显示已关闭。 |
| S8-13 | 通过 | 近7天 2026-10-23—29：2 次预警、1 未关闭、6 条采样；近30天 2026-09-30—10-29 同值；空态楼栋 0/0；API 与数据库一致；日期补零与上海时区可见。[api.json](../../../../evidence/stage8-engineer-review/verification/insights/api.json) |
| S8-14 | 失败 | 7A 视觉、加载/错误/无权状态与触控目标可用；但照片连续回读失败、系统字号不跟随、宽窗未验证，整项不通过。 |

## 5. 业务实测明细

### 5.1 身份与范围

- 五身份依次切换：物业值班、设备管理、巡检、维修、安全管理，均显示服务端当前角色，无账号密码表单；最终恢复 safety。[roles.json](../../../../evidence/stage8-engineer-review/verification/identity/roles.json)
- 空态楼栋 `FINISH-B`：测点 0、预警 0，显示“这个范围还没有测点 / 缺少记录不代表监测正常 / 没有对应预警记录”。[empty-building.json](../../../../evidence/stage8-engineer-review/verification/scope/empty-building.json)
- 预警权限：inspector 无确认/登记/关闭按钮；property 仅有“登记排查/处置措施”；safety 有确认与（恢复后）关闭。证据页：`page/alerts/inspector-readonly`、`page/alerts/property-readonly`。
- 未专项复验：处理中收回楼栋范围/角色后的迟到响应，以及旧筛选结果覆盖新页面。

### 5.2 监测、设备与筛选

- 三种测点读数：裂缝 `0.5 mm`（恢复复测后）、倾角 `X 0.05 / Y 0°`、振动 `0.05 m/s² · RMS`，均带采样/来源/质量/“硬件输入模拟”。
- 设备台账（页面 `page/device/*-detail`）：
  - crack `dev_90f297…`：`在线（模拟） · 电量 85% · 最近上报 2026/10/29 上午11:48:37`
  - tilt `dev_30dc50…`：`离线（模拟） · 电量 12% 低电量 · 最近上报 …`
  - vibration `dev_5a6ff9…`：`连接未知（模拟） · 电量 未知 · 最近上报 未知`
- 临时创建无 telemetry 设备 `dev_b9d8cd1f…`（后已归档）：显示“连接未知 · 电量未知 · 最近设备上报未知”，未显示在线/满电。[no-telemetry.json](../../../../evidence/stage8-engineer-review/verification/device/no-telemetry.json)
- 筛选交集：全部 3 → 楼栋 `小瞳守护教学楼` 3 → 1层 2 → 1层+倾角 1；页面 `page/scope/*`。

### 5.3 预警确认、排查、恢复与关闭

对象：`E20261029-001`（`evt_fbc46c84dd974167bf9693465e6d35c7`，裂缝测点 `pnt_d462d6c50005437ca6b39878165eeada`）。

| 步骤 | status | rev | audits | receipts | 结果 |
| --- | --- | --- | --- | --- | --- |
| 起点 | pending | 1 | 27 | 25 | 待确认 |
| 确认（响应丢弃） | handling | 2 | 28 | 26 | App 显示“用原请求核验办理结果”；3 条通知同刻确认 |
| 原请求重试 | handling | 2 | 28 | 26 | 时间线/通知/审计/回执均未重复 |
| 现场排查（合法10字以上） | handling | 3 | 29 | 27 | 最后时间线“现场排查” |
| 增加 2 条恢复复测 | handling | 3 | — | — | 未满足连续恢复，不得关闭 |
| 增加第 3 条 | recovering | 4 | 33 | 30 | 进入“恢复待确认” |
| 恢复前关闭（HTTP） | 409 | 4 | 33 | 30 | `STATE_CONFLICT`：非恢复态不可关闭 |
| 仅填依据关闭 | recovering | 4 | 33 | 30 | 服务端拒绝：无已验收工单时必须填“无需维修”结论，未写入 |
| 补结论后关闭 | closed | 5 | 34 | 31 | 关闭依据保留，Web 预警页显示已关闭 |

- 短说明拦截：输入“短句”保存后提示“排查或措施说明至少10字”，未写库（审计/回执仍 28/26）。但提示出现在操作区上方，用户点按保存时在表单底部看不到，需上滑才能看到（P2）。
- 历史：监测页“翻开历史预警”显示 `E20261029-001 红色紧急核查 · 已关闭`，详情保留关闭依据。[history.json](../../../../evidence/stage8-engineer-review/verification/alerts/history.json)
- 证据 JSON：[pre](../../../../evidence/stage8-engineer-review/verification/alerts/pre.json)、[ack-dropped](../../../../evidence/stage8-engineer-review/verification/alerts/ack-dropped.json)、[ack-retry](../../../../evidence/stage8-engineer-review/verification/alerts/ack-retry.json)、[field-note](../../../../evidence/stage8-engineer-review/verification/alerts/field-note.json)、[recovery-two](../../../../evidence/stage8-engineer-review/verification/alerts/recovery/recovery-two-records.json)、[recovery-three](../../../../evidence/stage8-engineer-review/verification/alerts/recovery/recovery-three-records.json)、[close](../../../../evidence/stage8-engineer-review/verification/alerts/close/close.json)。
- 页面：`page/alerts/ack-unknown`、`ack-saved`、`field-note-saved`、`event-closed`、`history-closed`、`history-closed-detail`。

### 5.4 声光模拟

- 详情页“声光模拟 · 仅本机预览”，点“预览一次模拟提示”后反馈“短音输出 4800 字节，色块保持模拟提示”，按钮变为“停止模拟提示”；停止后显示“模拟已停止，事件状态没有改变”。
- 播放前后事件均 `closed` rev5，审计未增加；离开页面未崩溃。音频 API 为 `@ohos.multimedia.audio` 16kHz 单声道 S16LE 原始输出；**未验证实体声光或可听声音**，只记录 API 写入字节与页面反馈。[sound.json](../../../../evidence/stage8-engineer-review/verification/alerts/sound.json)、`page/alerts/sound-playing`、`sound-stopped`。

### 5.5 统计

- API 与 App 一致：近7天 `2026-10-23—2026-10-29`，触发 2、未关闭 1、采样 6；近30天 `2026-09-30—2026-10-29` 同值；趋势按首次触发日计数，10-29 为 2，其余为 0；楼栋频次含 0 的空态楼栋。
- 空态楼栋：`触发 0 次预警`、`采样 0 条`，无类型/测点行。
- 统计从全量授权数据库聚合，不从 App 的“每测点最近5条”推算；本轮 6 条采样与数据库 `records` 一致。
- 页面：`page/insights/week`、`month`、`empty-building`、`all-buildings`；[api.json](../../../../evidence/stage8-engineer-review/verification/insights/api.json)。

### 5.6 照片回读（发现 P1）

- 数据链（真实服务端命令）：
  - 问题 `ISS-20261029-001`（`iss_a4d02452…`）1 张 scene，附件 `att_7c2372…`，媒体 `d6d6fd06…`，28,791 字节，SHA `275567c7…`。
  - 工单 `WO-20261029-001`（`wo_628896dd…`）已验收，3 张：before `att_5d02d7…`/`69b03767…`、after `att_fcbb79…`/`1a55f832…`、acceptance `att_d0b90a…`/`bfb02e55…`。
  - 四个媒体经服务端下载与上传字节 SHA 全部一致。[downloads.json](../../../../evidence/stage8-engineer-review/verification/photos/downloads.json)
- 问题照片：inspector 打开 `ISS-20261029-001` → “查看第 1 张照片” → 显示“现场照片”与原图（首次写入成功）。
- 工单照片：清空缓存目录后每次只读一张，可分别看到“维修前照片”“维修后照片”“验收照片”，标签与 kind 一致；页面 `page/photos/order-before-first`、`order-after`、`order-acceptance`。
- **连续回读失败**：第一张成功后点第二张，卡片显示红色 `File exists`，无图片；第三张同样。删除 `cache/protected-photos` 后第一张又成功，证明缺陷稳定复现。[photo-cache.json](../../../../evidence/stage8-engineer-review/verification/defects/photo-cache.json)、`page/photos/order-second-fails`。
- 定位与最小修复：`PreviewFiles.ets:10` 每次 `fs.mkdirSync(directory, true)`；该目录首次成功后保留，第二次创建在本机运行时返回 `File exists`（与 EEXIST 一致）。改为先 `fs.accessSync` 判断或捕获已存在错误后继续即可。
- 影响：用户无法连续查看同一问题/工单的多张照片，维修前/后/验收标签无法按正常操作核验；属演示可见缺陷。

### 5.7 持久化

- App 多次 force-stop/start 后，问题/工单/预警仍可读；最终 App 截图恢复 3 测点/1 未关闭预警。
- 新建独立 API 进程（18012，同库副本）读取 issues/orders/events 与 18010 完全一致（1 问题、1 工单、2 预警），说明数据已落库、可被新进程读取。[fresh-process.json](../../../../evidence/stage8-engineer-review/verification/persistence/fresh-process.json)
- 未重启 18010 本体，未做备份→校验→新目录恢复；该项沿用前轮 07 证据，本轮不升级为通过。

### 5.8 Web 响应式、键盘、可访问性与性能

- 15 页 × 375/768/1280/1920 = 60 组合，`docWidth` 均等于视口宽，越界卡片 0；11 项交互（侧栏、Skip link、Ctrl+K/ Escape、指针光效、表单校验、身份选择、助手开合、趋势键盘、洞察展开、减少动效）全部通过，页面错误 0。[results.json](../../../../evidence/stage8-engineer-review/web/results.json)
- axe 扫描 15 个默认页，违规 0。[web-accessibility.log](../../../../evidence/stage8-engineer-review/builds/web/web-accessibility.log)
- 200% 浏览器缩放等效（1280→640 CSS px）抽查总览/预警/问题/监测/报表，横向溢出与裁切卡片均为 0。[web-zoom200.log](../../../../evidence/stage8-engineer-review/builds/web/web-zoom200.log)
- 本机采样 median 5.2ms / p95 6.2ms / >50ms 0 帧 / 外网请求 0；脚本明确声明不是通用 FPS 或 INP 保证。[web-performance.log](../../../../evidence/stage8-engineer-review/builds/web/web-performance.log)
- 副作用：打开预警页产生 4 次 `notifications/escalate` 写请求（隔离库），无业务对象写入；`validBusinessWrites=0`。

### 5.9 App 长列表压力（独立夹具）

- 夹具：复制验收库后新增 497 个测点、497 台设备、5,000 条记录（另含原库 3 测点/3 活跃设备/6 记录），最终 **500 测点 / 501 设备（含1归档）/ 5,006 记录**；独立 API 18012，未污染验收库。[seed.json](../../../../evidence/stage8-engineer-review/verification/stress/seed.json)
- API：`/mobile/records` 返回 2,492 行（每活跃测点最近 5 条），耗时 82–178ms；`/archive` 500 测点 26–66ms；`/mobile/insights` 105–117ms；桌面 `/records` 返回 2,000 行（全局截断），说明 App 不依赖该截断。
- 抽查 `pnt_stress_0000` 的最近 5 条与数据库逐条 recordNo/采样时间一致；在全局 5,006 条下仍保留每点最新 5 条。[records.json](../../../../evidence/stage8-engineer-review/verification/stress/records.json)
- App：连到 18012 后监测页显示 `当前可见 500 个测点`、`第 1 / 25 页 · 每页20处`；翻到第 2 页墙钟约 2.9s（含 HDC layout dump 轮询）；RSS 298,304 kB、HWM 311,372 kB。连接过程墙钟 20.6s 含地址输入与多次 dump，**不是纯加载时间**，不能当作性能结论。[ui.json](../../../../evidence/stage8-engineer-review/verification/stress/ui.json)、[paging.json](../../../../evidence/stage8-engineer-review/verification/stress/paging.json)
- 未测：500 点下统计页渲染、帧率、低端机；未宣称通用 FPS。

## 6. 缺陷与风险

### P1-1 已提交照片连续回读失败（代码缺陷）

- 现象：第一张照片成功后，后续任意照片显示 `File exists`，无图片，直到清空 App 缓存目录。
- 复现：safety → 维修手账 `WO-20261029-001` → 删除 `cache/protected-photos` → 查看第1张成功 → 查看第2张失败 → 第3张仍失败。
- 定位：`mobile/openharmony/entry/src/main/ets/core/media/PreviewFiles.ets:10` `fs.mkdirSync(directory, true)`；现象与该调用在目录已存在时返回 `File exists` 一致。
- 最小修复：先 `fs.accessSync` 判断目录存在，或捕获 `EEXIST` 后继续；不要只清文件，目录会保留。
- 证据：[photo-cache.json](../../../../evidence/stage8-engineer-review/verification/defects/photo-cache.json)、`page/photos/order-before-first`、`page/photos/order-second-fails`。

### P1-2 系统字号放大不生效（配置缺陷）

- 现象：系统字体“特大”并重启后，EntryAbility 日志仍 `fontScale=1`；同一首页截图字节数与标准字号一致，界面不变。
- 定位：`AppScope/app.json5` 无 `configuration`，`AppScope/resources/base/profile/configuration.json` 不存在。
- 最小修复：新增 `{"configuration":{"fontSizeScale":"followSystem","fontSizeMaxScale":"2"}}`，并在 `app.json5` 增加 `"configuration": "$profile:configuration"`；随后复验 200% 下按钮、导航、选择器、表单、长文本不截断/不遮挡。
- 证据：[font-scale.json](../../../../evidence/stage8-engineer-review/verification/defects/font-scale.json)、`page/settings-font/screen-large.png`、`page/ux/font-large-home`。

### P2-1 预警表单校验反馈不在操作视野内

- 现象：在“登记排查/处置措施”底部点保存，短说明被拒（至少10字），但提示渲染在操作区上方，当前视口看不到，需上滑才发现；关闭表单的“无需维修”提示同样。
- 影响：用户可能以为点击无效并重复操作；演示中容易卡住。
- 最小修复：把 `command.message` 放到当前表单卡片内、按钮上方，或提交失败后自动滚动到提示。

### P2-2 原始系统错误直接展示给用户

- 照片回读失败时直接显示 `File exists`（英文系统错误），未转换为“照片暂不可用，请重试/清理缓存”等业务提示。
- 最小修复：`SavedPhotos` 捕获后映射为业务文案，同时修复 P1-1。

### P3-1 统计页包含 0 频次对象

- `insights.summary` 的 `byBuilding`/`byPoint` 按授权对象全集生成，包含 0 次预警的楼栋/测点；500 测点夹具会生成 500 行 0 频次列表，存在渲染与阅读负担。
- 建议：仅返回有预警的对象，或“前 N + 其余 N 个测点无预警”摘要；至少分页。未在本轮 UI 实测 500 点统计页。

### P3-2 任务日期筛选只校验格式

- `TaskFilters.ets:22` 仅正则 `^\d{4}-\d{2}-\d{2}$`，`2026-02-30` 可通过格式校验并得到 0 结果；未做日历合法性校验。
- 建议：用日期解析校验真实日期，非法时给明确提示。本轮无任务夹具，未实际触发。

### 环境阻断（非代码缺陷）

- 横屏/宽窗：`Emulator -rotation left` 三次均报成功但画面仍 1320×2856（含启动器），旋转锁定已关闭；宽窗验收被阻断。
- 读屏：系统确认“是否开启屏幕朗读？/开启 (5 秒)”需用户本机确认；本轮未代替用户接受，实际语音/焦点顺序未验证。
- 真机：无设备，拍照/安装/实录未验证。

## 7. 真机与未验证清单

- 真机安装/启动、真机相机拍照、真机相册、真机完整实录（S8-04、S8-10）。
- 真实屏幕朗读的语音内容、焦点顺序与状态播报。
- App 横屏/宽窗布局与系统字体 200% 下的实际排版（字体配置修复后需复验）。
- 巡检任务写入口（本轮无任务夹具；S8-03）。
- 工单 App 接单→完工→Web 验收→待复查闭环（本轮未复演；S8-06）。
- 跨端版本冲突、处理中收回范围/角色的迟到响应（S8-07 与身份隔离子项）。
- 18010 本体 API 重启与完整备份恢复（S8-08）。
- 500 测点下统计页渲染与真机帧率。

## 8. 命令、退出码与证据索引

| 时间（本机） | 命令/操作 | 结果 |
| --- | --- | --- |
| 14:04—14:05 | `hvigorw.js assembleApp --no-daemon` | 退出 0，BUILD SUCCESSFUL，[hvigor.log](../../../../evidence/stage8-engineer-review/builds/native/hvigor.log) |
| 14:05:35 | `python scripts/mobile/sign_online.py --studio … --sdk … --target 127.0.0.1:5555` | 退出 0，验签成功，[signing.log](../../../../evidence/stage8-engineer-review/builds/native/signing.log) |
| 14:06 | `hdc install -r …signed.hap`；`aa start -a EntryAbility -b org.zhutong.mobile` | 首次安装成功，[install.json](../../../../evidence/stage8-engineer-review/builds/native/install.json) |
| 14:06—14:12 | 连接 18090、五身份、预警确认/重试/排查 | 见 5.1、5.3 |
| 14:12—14:15 | 恢复复测、关闭、声光、统计 | 见 5.3—5.5 |
| 14:16—14:28 | 设备三态、筛选取交集、空态楼栋、照片链与回读 | 见 5.2、5.6 |
| 14:29 | 系统字号“特大”、重启、日志检查、恢复“标准” | `fontScale=1`，[font-scale.json](../../../../evidence/stage8-engineer-review/verification/defects/font-scale.json) |
| 14:31—14:33 | `node verify.mjs http://127.0.0.1:5184`、`accessibility.mjs`、`performance.mjs` | 退出 0，[web-verify.log](../../../../evidence/stage8-engineer-review/builds/web/web-verify.log) 等 |
| 14:33—14:40 | 500 点/5006 记录压力夹具、API 与 App 分页 | 见 5.9 |
| 14:46 | 200% 等效视口抽查 | 0 溢出，[web-zoom200.log](../../../../evidence/stage8-engineer-review/builds/web/web-zoom200.log) |
| 14:44—14:50 | 恢复 App 18090/safety、停止临时服务、移除 18092 映射 | 见第 9 节 |
| 14:55 | 重装最终 HAP 并启动，直接捕获退出码 | `install_exit=0`、`start_exit=0`，连接与 safety 身份保持，[install-rerun.log](../../../../evidence/stage8-engineer-review/builds/native/install-rerun.log) |

- 原始页面：`page/` 下每目录含 `layout.json`、`screen.png`、`ids.json`；关键目录：`page/alerts`（确认/排查/关闭/声光/历史）、`page/insights`（周/月/空态）、`page/device`（三态/无遥测）、`page/scope`（楼栋/楼层/类型/空态）、`page/photos`（问题/工单三标签与失败）、`page/restore`（恢复连接）、`page/settings-font`、`page/ux/font-large-home`、`page/rotation-*`。Web 页面按宽度在 `web/pages/{375,768,1280,1920}`，另有 `web/zoom200`；证据 JSON 在 `verification/`。
- 开发方自测复核：后端 `303 passed`、覆盖率 89.07%；原生 Node/mocks `93 passed`、行94.53%/分支81.09%；Web `125 文件/1171 用例` 通过。均为开发方日志，不等于本轮模拟器实测。

## 9. 临时服务、清理与恢复

- 已停止：压力 API 18012、Web 隔离 Vite 5184；已移除 device `18092→18012` 反向映射。
- 保留：验收前已存在的 API 18010、网关 18011、device `18090→18011`，App 已恢复连接 18090。
- App 状态：safety 身份、3 测点、1 未关闭预警；系统字号“标准”、读屏关闭、旋转锁定关闭；未恢复出厂、未删除模拟器数据。
- 隔离验收库新增：1 个问题、1 个已验收工单、4 个媒体/附件、预警 `E20261029-001` 已关闭、临时设备已归档；均在 `backend/.runtime-stage8-finish`，未写交付库。
- 本轮未做“完整备份→校验→新目录恢复”；该证据沿用 07 批记录，不据此升级 S8-08。交付库（Docker 卷）未被清空或导入夹具。
- 压力夹具库与 Web 验收脚本保留在 `backend/.runtime-stage8-stress`、`backend/.runtime-stage8-finish/web-review`（未提交，不参与交付），供复核。
- 未修改业务代码、Web 视觉改动、AI 逻辑；新增仅为证据脚本与文档。

## 10. 建议

**不通过当前 HAP。** 依据：

1. P1 照片连续回读失败直接违反必测第12项“受保护照片”与 S8-14“App 页面可用”的要求；
2. P1 系统字号不跟随直接违反 S7A-05/S8-14；
3. App 宽窗/横屏与真实读屏未取得证据，真机项仍未验证。

修复 P1-1、P1-2 后，建议按以下顺序复验：照片连续查看 3 张且标签正确 → 系统字号 200% 下关键页无截断/遮挡 → App 横屏/宽窗截图 → 读屏（需用户授权）→ 真机拍照/安装/实录。复验通过后再由项目负责人裁定阶段7A/8是否通过；本轮不进入阶段9。
