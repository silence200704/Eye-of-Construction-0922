# 阶段7A/8剩余证据补验（模拟器）

日期：2026-10-30。对象：筑瞳 API/OpenHarmony App/Web。代码：`845c564`（实际 HEAD `02e1ffe` 文档提交后）。结论：**本轮补验项通过；阶段7A、8仍待补证据**。
新文案、原请求重试、发送前断连、409/403、Web 表单验收/复查/关闭及媒体途中收权已取得实际证据；
App 宽窗、软键盘、真实读屏、真机仍缺证据，未进入阶段9。未改业务代码与AI。

## 0. 结论先行

- 新文案：丢弃一次成功响应后，排查表单就地显示“办理结果待核验，服务端可能已保存。请用原请求核验，勿另建重复操作。”与原请求核验按钮；同键重试后审计/回执/时间线不再增加，成功改为“服务端已保存”。
- 发送前连接失败：网关停止后提交，显示原“暂时无法连接…”错误，不出现“可能已保存”，无重试按钮，审计/回执不变。
- 409 冲突保留“对象已被其他操作修改，请刷新后重试”；403 角色拒绝由服务端返回，App 401/403 页面路径未单独复演。
- Web 表单：新问题 `ISS-20261030-001` 经 App 接单完工后，Web 真实填写验收意见并点“验收通过”，再真实登记复查、填写复查结论并“提交结论”；问题 closed、两张工单 verified、无预警被合并关闭。
- 媒体途中收权：18014 暂留现场图 28,791 字节（SHA `275567c7…`），2.3 秒内归档测点并放行；App 未显示预览、未写新缓存；恢复测点后可正常读图，缓存 SHA 一致。
- 仍未验证：App 宽窗/横屏（折叠屏 2210×2416 已产生，但 App 在约 703px 手机浮动窗口，未获全宽布局）、软键盘（输入法隐私协议未接受，键盘未实际出现）、真实读屏（系统确认未接受）、真机。
- 建议：**待补证据**；本轮补验项可关闭，宽窗/软键盘/读屏/真机补齐后再裁定阶段7A/8。

## 1. 基线与构建

| 项 | 实际值 | 证据 |
| --- | --- | --- |
| HEAD | `02e1ffe61b34b79a5d485a4c4e68024f30b915de`；代码基线 `845c564`（文案修复） | [head.txt](../../../../evidence/stage8-engineer-gaps/baseline/head.txt) |
| 工作区 | 90 项未提交改动，含既有 Web 视觉/文档成果；未 reset/clean/stash | [git-status.txt](../../../../evidence/stage8-engineer-gaps/baseline/git-status.txt) |
| 源码 | 73 个源码/配置 SHA-256 | [source-hashes.json](../../../../evidence/stage8-engineer-gaps/baseline/source-hashes.json) |
| 构建 | 退出 0，`BUILD SUCCESSFUL in 12 s 353 ms`；未签名 HAP 1,022,613 字节，SHA-256 `f51911d91dd517cb6a8c92eb48918ea4a6c6e5cc82faac652be4a55423f82121` | [hvigor.log](../../../../evidence/stage8-engineer-gaps/builds/native/hvigor.log) |
| 签名 | 退出 0；签名 HAP 1,067,456 字节，SHA-256 `7ff52c16b2bd1bc8ca6de7dab9ff8dcad0344048ce723e8c684d61237ead143d`（未复用旧 `414be590…`） | [signing.log](../../../../evidence/stage8-engineer-gaps/builds/native/signing.log) |
| 安装/启动 | `install_exit=0`、`start_exit=0`；包 `org.zhutong.mobile` 0.8.0-dev | [install.log](../../../../evidence/stage8-engineer-gaps/builds/native/install.log)、[start.log](../../../../evidence/stage8-engineer-gaps/builds/native/start.log) |
| 开发检查 | 105 项 Node/mocks、SDK 构建、结构门禁为开发方证据，本轮未重跑 | 08-evidence-gap-handoff.md |
| 设备 | Pura 90 1320×2856 API24；临时 GapFold（Mate X7）2210×2416，验收后停止并删除 | HDC 实查、[wide.json](../../../../evidence/stage8-engineer-gaps/verification/window/wide.json) |

## 2. 未知结果文案与原请求重试

对象：`E20261030-001`（`evt_6c1b6742e8b44a2cb618ea67cdd2c4bf`，振动红级），由一条模拟高振动记录合法新建；起点 pending rev1，审计 73/回执 64。

| 步骤 | 实际界面/服务端 | 计数 |
| --- | --- | --- |
| 确认 | “服务端已保存本次办理。” | handling rev2；74/65 |
| 丢弃 field-notes 成功响应 | 就地显示 **“办理结果待核验，服务端可能已保存。请用原请求核验，勿另建重复操作。”** + “用原请求核验办理结果”按钮 | 上游已提交：75/66 |
| 原键/原内容重试 | “服务端已保存本次办理。” | 仍 75/66；时间线 3 条、现场排查 1 条，无重复 |
| 发送前断连（停 18011 后提交） | **“暂时无法连接筑瞳服务，请检查服务地址与网络。”**，无重试按钮 | 仍 75/66，不称可能已保存 |
| 外部先写一条措施制造版本冲突 | App 就地 **“对象已被其他操作修改，请刷新后重试”** | 不写库；冲突前 76/67 |
| inspector 越权确认 | HTTP 403 `ROLE_FORBIDDEN` | 计数不变 |
| 恢复复测/关闭 | closed rev6，关闭依据保留 | 最终审计/回执 100/90 |

- 截图/证据：[unknown-new-copy](../../../../evidence/stage8-engineer-gaps/page/alerts/unknown-new-copy)、[unknown-retried-new-copy](../../../../evidence/stage8-engineer-gaps/page/alerts/unknown-retried-new-copy)、[pre-send-failure](../../../../evidence/stage8-engineer-gaps/page/alerts/pre-send-failure)、[conflict-409](../../../../evidence/stage8-engineer-gaps/page/alerts/conflict-409)、[unknown-new-copy.json](../../../../evidence/stage8-engineer-gaps/verification/alerts/unknown-new-copy.json)、[pre-send-failure.json](../../../../evidence/stage8-engineer-gaps/verification/alerts/pre-send-failure.json)、[conflict.json](../../../../evidence/stage8-engineer-gaps/verification/alerts/conflict.json)、[role-403.json](../../../../evidence/stage8-engineer-gaps/verification/alerts/checks/role-403.json)、[timeline.json](../../../../evidence/stage8-engineer-gaps/verification/alerts/checks/timeline.json)
- 限制：401/403 的 App 页面路径未单独复演（仅服务端 403 与代码路径）；未做“旧身份继续提交”实测。

## 3. 宽窗与软键盘

### 3.1 宽窗

- Pura 90 `-rotation left/right` 仍报 success 但屏幕 1320×2856（沿用统一复验结论，本轮未重复旋转）。
- `aa start --ww/--wh` 返回 `Error 10106107 The current device does not support using window options`。
- 用已下载的 Foldable 镜像新建临时 `GapFold`（Mate X7，screen 2210×2416，density 500），展开后 App 可安装启动；但 App 内容宽约 **703px**，窗口菜单为“悬浮窗/分屏/全景多窗/关闭”，尝试拖动边缘/分屏后仍为手机宽浮动/分屏窗口，未得到全宽应用布局。
- 结论：**宽窗/横屏仍未验证**；2210×2416 是真实折叠屏尺寸，但没有得到 App 全宽渲染，不能把系统屏幕尺寸当 App 宽窗通过。临时实例已停止并删除。[wide.json](../../../../evidence/stage8-engineer-gaps/verification/window/wide.json)、`page/window/foldable/screens/fold-open.png`、`fold-app-profile.png`、`fold-panorama.png`、`fold-split.png`、`fold-tree.json`

### 3.2 软键盘

- Pura 90 点击预警文本域只出现“粘贴/自动填充/拍摄输入”文本选择工具条，没有系统键盘。
- GapFold 首次输入触发“小艺输入法”隐私协议（取消/同意）；协议未接受，键盘未出现。
- 结论：**软键盘未实际出现**，无法验证键盘遮挡/输入时提交可达。需用户授权输入法隐私条款后才能补。[keyboard.json](../../../../evidence/stage8-engineer-gaps/verification/keyboard/keyboard.json)、`page/window/foldable/screens/fold-current.png`、`fold-consent-layout.json`、统一复验 `page/font/hot-alert-keyboard`

## 4. 真实读屏

- `com.huawei.hmos.screenreader` 已安装、默认关闭；系统“是否开启屏幕朗读？/开启 (N 秒)”确认需用户本机授权，本轮未替用户接受。
- 因此没有实际语音、焦点顺序或状态播报证据；不以语义树/axe 代替。[screenreader.json](../../../../evidence/stage8-engineer-gaps/verification/screenreader.json)、统一复验 `page/screenreader/screen.png`

## 5. Web 实际表单验收与复查

对象：`ISS-20261030-001`（`iss_a52ce9b10ab24d18ab69c0cd4a54936a`）；工单 `WO-20261030-002`（`wo_8fb290…`）、`WO-20261030-003`（`wo_3171d4…`）。

1. 新问题由 API 以 inspector 合法提交；safety 审核 `to_repair`（equipment）生成 `WO-20261030-002` 并派 demo-repair。
2. App 维修身份真实点“接单，开始处理”（一次）→ repairing；只填措施“缺口补验：App接单并只填措施完工。”→ submitted rev4；照片/材料未选。
3. Web safety 打开问题详情，真实填写验收意见“缺口补验：Web表单验收意见，维修措施已核对。”并点“验收通过”→ 工单 verified rev5，review.note 原样落库；问题 pending_recheck rev3。
4. 为覆盖带意见验收，第二次审核转维修生成 `WO-20261030-003`，App 再次接单/只填措施完工；Web 再次填写验收意见并点“验收通过”→ verified rev5，问题 pending_recheck rev5。
5. Web 真实登记复查：事项“缺口补验：复查裂缝封闭层与设备固定件”、责任人“李老师（后勤保障处）”、目标日期 2026-11-06；再点“记录复查结论”，选择默认“确认恢复”，填写“缺口补验：现场复查确认恢复，封闭层与固定件正常。”并“提交结论”→ 问题 closed rev7。
6. 最终：两张工单均 verified rev5，问题 closed rev7；预警 `E20261029-002`/`E20261030-001` 各自 closed；问题关闭、工单验收、预警关闭分别成立，未合并成一个成功结论。

- 页面/请求证据：`page/web/verify/verify-filled.png`、`verified.png`、`recheck-filled.png`、`recheck-registered.png`、`outcome-form.png`、`outcome-submitted.png`；[verified.json](../../../../evidence/stage8-engineer-gaps/verification/web/verified.json)、[final.json](../../../../evidence/stage8-engineer-gaps/verification/web/final.json)、[web-verify-action.log](../../../../evidence/stage8-engineer-gaps/builds/web/verify/web-verify-action.log)、[web-recheck-submit.log](../../../../evidence/stage8-engineer-gaps/builds/web/recheck/web-recheck-submit.log)、[web-outcome-submit.log](../../../../evidence/stage8-engineer-gaps/builds/web/outcome/web-outcome-submit.log)
- 第一次 Web 验收（order 002）按钮点击时验收意见为空（未填），不作为“提交意见”证据；带意见的 order 003 才是本轮表单验收通过项。
- 未覆盖“验收退回后返工再验收”分支；本轮用第二次转维修替代，退回分支仍为历史版本。

## 6. 媒体途中收权（可选补证，已取得）

- 测试网关 18014（独立 runtime）暂留现场图 `d6d6fd06…`；`held-media.json` 记录 `outcome=holding`，28,791 字节，SHA `275567c7…`，2.3 秒后检测到。
- 在暂留窗口内以合法档案命令归档测点 `pnt_d462d6c50005437ca6b39878165eeada`（HTTP 200，0.04 秒），再写 `release-media.json`；网关记录 `outcome=released`，返回字节 SHA 不变。
- App 在放行后未显示 `saved-photo-preview`、未显示反馈、未新增缓存文件（原缓存仅保留 11:08 旧文件）；后置授权拦截生效，无旧照片回填/越权预览。
- 恢复测点（active rev4）后，App 重新打开照片成功，新缓存 `preview-…4fmi8wx0d3a.jpg` 28,791 字节，SHA `275567c7…`。
- 结论：**通过**，但 App 在授权变化后是静默不显示，没有明确“权限已变化”提示（P2-1）。[hold.json](../../../../evidence/stage8-engineer-gaps/verification/media/hold.json)、[held-media.gateway.json](../../../../evidence/stage8-engineer-gaps/verification/media/held-media.gateway.json)、[archive.json](../../../../evidence/stage8-engineer-gaps/verification/media/archive.json)、[restore.json](../../../../evidence/stage8-engineer-gaps/verification/media/restore.json)、[after-restore-preview](../../../../evidence/stage8-engineer-gaps/page/media/after-restore-preview)
- 限制：暂留只证明“收到上游字节后、发给 App 前收权”的路径；未测试下载中返回/切身份的取消路径，也未扩大 8 秒或修改 App 超时。

## 7. 缺陷与观察

### P2-1 授权变化后照片打开静默无提示

- 现象：媒体暂留期间归档测点并放行后，App 不显示预览，也不显示“照片暂不可用/权限已变化”等提示；用户只看到照片按钮无反应。
- 影响：现场弱网或权限变更时用户无法判断是加载中、失败还是已失去权限。
- 最小修复：`SavedPhotos`/`PhotoReader` 在 `AUTHORIZATION_CHANGED`/`CANCELLED` 时显示中性提示，例如“权限已变化，照片未打开；请重新读取”，并避免页面重载把提示清空。
- 证据：[app-after-release.json](../../../../evidence/stage8-engineer-gaps/verification/media/app-after-release.json)、`page/media/hold-after-release`。

### 环境/授权阻断（非代码缺陷）

- 宽窗：折叠屏 2210×2416 已产生，但 App 在约 703px 手机浮动/分屏窗口，未获全宽布局；`aa --ww` 设备不支持。
- 软键盘：只出现文本选择工具条；GapFold 触发小艺输入法隐私协议，未接受。
- 读屏：系统开启确认未替用户接受。

## 8. S7A/S8 本轮补验表

| 编号 | 本轮结论 | 说明 |
| --- | --- | --- |
| S7A-05 | 未验证 | 字号/布局沿用统一复验通过；软键盘、真实读屏仍缺。 |
| S7A-06 | 未验证 | Web 宽度沿用；App 宽窗/横屏仍未取得。 |
| S8-05 | 通过（补验） | 新文案、原请求重试、发送前断连、409/403 已实测。 |
| S8-06 | 通过（补验） | App 接单/完工 + Web 表单验收意见 + 复查/关闭实际点按。 |
| S8-09 | 未验证 | 构建/字体/返回可用；宽窗、软键盘缺。 |
| S8-14 | 未验证 | Web 表单与文案通过；宽窗/键盘/读屏缺。 |
| 其余 S7A/S8 | 沿用统一复验 | 照片、1.45 字号、47 对象三页统计、备份/重启引用 08-emulator-combined-review；真机仍未验证。 |

## 9. 命令、退出码与恢复

| 时间（本机） | 操作 | 结果 |
| --- | --- | --- |
| 21:00—21:02 | Hvigor assembleApp；签名；安装；启动 | 退出 0；HAP `f51911d9…` / 签名 `7ff52c16…` |
| 21:04—21:12 | 新文案丢响应/重试/发送前断连/409/403 | 见第2节 |
| 21:13—21:20 | GapFold 创建、展开 2210×2416、安装启动 | 宽窗未获全宽；实例已删除 |
| 21:30—21:39 | 新问题/工单 App 接单完工、Web 验收意见/复查/关闭 | 见第5节 |
| 21:40—21:41 | 18014 暂留/归档测点/放行/恢复 | 见第6节 |
| 21:46 | 恢复 App 18090/safety、标准字号；停止 18014/18094/5184；删除 GapFold | 3 测点/0 未关闭 |

- 临时服务：18014 与 18094 映射已停止/移除；5184 已停止；GapFold 已停止并删除；18010/18011 保持原归属，18090→18011 保留。
- App 最终：safety、18090、3 测点/0 未关闭；标准字号、读屏关闭。测点 `pnt_d462…` 已恢复 active rev4。
- 隔离库新增：事件 `E20261030-001` closed、问题 `ISS-20261030-001` closed rev7、工单 002/003 verified、审计/回执 100/90；均在 `.runtime-stage8-finish`，未写交付库。
- 未修改业务代码、Web 视觉或 AI；新增仅为证据脚本与报告。

## 10. 建议

**待补证据。** 本轮新文案/重试/断连/409/403、Web 表单验收/复查/关闭、媒体途中收权均通过；宽窗、软键盘、真实读屏和真机仍缺实际证据，阶段7A/8不能提前通过。补齐后由负责人裁定，本轮不进入阶段9。
