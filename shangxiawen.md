# 筑瞳 Demo 上下文交接（shangxiawen）

> 这份文档用于把项目上下文完整交给下一个对话。**接手时先读本文，再读 `docs/交互与展示改造方案.md` 与 `docs/完成度报告.md`。**
> 文档日期：2026-09-21。工程目录：`C:\Users\Lenovo\Desktop\demo`。

---

## 0. 一句话现状

筑瞳（校园建筑健康监测与预警系统）纯前端演示工程，目标是方案里的 **V1.0 完整业务闭环**。
**V0.1 与 V0.2 已完成并冻结**；**V0.3（人工检查与维修处置）已完成到"工单闭环"**，
当前标记为 `package.json 0.3.0` / `APP_VERSION = 'V0.3'` / `APP_STAGE = '开发中'`。

**测试 366 项 / 27 个文件全过**，`typecheck` 与 `build` 通过，规模检查 **0 不合规**
（动态语言文件 ≤450 行、函数 ≤80 行、参数 ≤5、每层目录 ≤8 文件）。

---

## 1. 权威文档与边界

| 材料 | 位置 |
| --- | --- |
| 分版本设计与业务闭环实施方案 **V1.1**（含 §13 预警标准） | `C:\Users\Lenovo\Documents\Codex\2026-09-13\x20-x20-open-harmony-x20-x20\outputs\筑瞳Demo分版本设计与业务闭环实施方案_V1.1.docx` |
| V1.7 评审版原始参赛方案（硬件清单、功能编号 F01–F30） | 同目录 `课题三_..._筑瞳_V1.7评审版.docx` |
| 演示预警规则 V1.0（交付给项目组的正式文档） | 工程内 `docs/筑瞳校园建筑健康监测演示预警规则V1.0.docx`（同内容 PDF 并存） |
| 交互与展示改造方案（评审补充，含 P0/P1 清单） | `docs/交互与展示改造方案.md` |
| 逐轮完成度报告（含每轮修正与实机证据） | `docs/完成度报告.md` |
| 与方案的逐项对照、演示脚本、冻结清单 | `docs/版本对照与验收.md` |

**技术边界（用户确认，不要改）**：Vue 3 + TypeScript + Vite；Pinia + Vue Router（hash 模式）；Dexie/IndexedDB；
**自研轻量设计系统，不引第三方 UI 库**；**SVG 自绘校园图与楼层图，不引地图库**；本地静态服务运行（`npm run serve`，4173）。

**V0.2 已冻结**：后续版本只在冻结基线上叠加，**不回改 V0.2 的判定口径**。

---

## 2. 硬性约束（来自 AGENTS.md，必须遵守）

1. 文件行数：动态语言 ≤450 行；函数 ≤80 行；参数 ≤5 个；每层目录 ≤8 个文件（**测试与源码同标准**）。
2. 每次任务结束要：给**完成度报告**、检查是否引入冗余代码（重复逻辑、无用代码、未使用导入）、
   发现坏味道要指出并给优化建议。
3. 未经确认不做大范围重构；影响当前任务正确性的可以先做最小修复。
4. 优先级：功能正确 > 不破坏现有业务 > 结构清晰 > 可维护 > 简单直接 > 性能 > 视觉统一。

**用户的工作节奏要求**：每个阶段停下汇报（说清完成到哪一步、主要完成什么），**不要顺手多做**。

### 反复出现的口径纪律（本项目最常被评审抓的点）

- **不能编造工程安全数值**：倾角变化速率阈值至今"未配置，待结构专业人员确认"，页面照此显示。
- **实测与占位严格区分**；数据不足不显示"正常"；状态与允许操作分列。
- **界面隐藏不算权限**：权限必须落在仓储层（已经历三次同类修正：事件关闭、任务写入、审核写入）。
- **判定输入必须是"本次操作后的状态"**，不是"操作前的库状态"（工单提交曾因此必然失败）。
- **跨表写入必须单事务**：业务数据 + 审计日志一起提交，否则会留下半成品或无留痕记录。
- **读数据以数据库为准**：内存缓存可能"命中但已过期"，并发下会把已关联的判成没关联。
- **时间显示统一走 `formatDateTime()`**：直接截 ISO 字符串会把本地时间显示成 UTC。

---

## 3. 架构与文件地图（接手先看这几处）

```
src/
  types/           domain.ts（Point/Baseline/MonitorRecord…）、rules.ts、events.ts、
                   inspection.ts（V0.3 巡检与工单模型）、catalog.ts（业务字典、APP_VERSION、SCHEMA_VERSION=4）
  config/          预警规则初始化 ruleSeed.ts、演示剧本 demoScript.ts、CSV 模板、口径文案
    fields/        五类建档表单字段 schema
  core/            纯函数层（可离线测试，是判定口径的唯一来源）
    assess/        判定引擎与触发值（triggerOf/levelOfRecord/assessRecord）
    rules.ts       **按采样时间选取生效的规则与基准**（ruleAppliesTo/rulesForPoint/ruleForPoint/baselineAtTime）
    event/plan.ts  事件生成/去重/升级/关闭的纯函数决策
    chart/         趋势序列（trend.ts）与纵轴刻度（axis.ts）
    csv/           CSV 解析（parse.ts）与导入逐行校验（preview.ts）
    inspection/    V0.3 巡检：taskPlan / checkIn / issueMerge / workOrderFlow
    map/           视口坐标换算（coords.ts）+ 缩放/平移控制器
    integrity.ts   数据一致性检查（含 NFC 标签重复、巡检与处置链引用）
  db/              IndexedDB（database.ts 到 v4）、repo.ts、backup.ts（**照片以 base64 随备份**）、seed*
    inspection/    事务提交（disposal.ts）、问题写入（issueWrites.ts）、附件压缩（attachments.ts）、旧库迁移（migrate.ts）
  stores/          archive / records / events / session
    inspection/    plans / tasks / issues / workOrders / attachments / taskWriteGuards / issueReview
    writes/        archiveWrites / ruleWrites / eventWrites / demoWrites / importWrites
  views/           overview / campus / archive / monitor / trend / alarms / standards / settings
    operations/    InspectionView.vue（点检巡检）、IssuePoolView.vue（问题与工单）
  components/
    inspection/    PlanForm、PhotoUploader
      task/        TaskCard、TaskDetail、NfcCheckIn
      issue/       IssueForm、ManualIssueForm、IssueDetail、WorkOrderPanel
    settings/      IntegrityPanel
```

**库结构 v4**：`buildings/floors/points/devices/baselines/records/audits/rules/events/notifications`
+ V0.3 新增 `plans/tasks/issues/workOrders/attachments`（**只新增表，不改旧表**）。

**几处稳定标识**：
- 任务主键 = `计划ID@执行时刻`（并发幂等的关键）；
- 问题主键 = `iss_` + **完整提交标识的 base64url**（不用哈希，因此没有碰撞面）；
- 业务编号：`R<日期>-序号`（记录）、`ISS-/WO-/TK-/PLAN-<YYYYMMDD>-序号`（本地日期递增、作废不复用）；
- 测点 `nfc = { code, version, boundAt, boundBy, remark }`，编号取 `NFC-<测点编号>`，**全校唯一**。

---

## 4. 已完成（按版本）

### V0.1 建档与录入（完成）
楼栋/楼层/测点/设备建档、基准按版本、单条录入、查询、修订留痕、归档不删除、备份恢复、操作日志。

### V0.2 预警事件闭环（已冻结，195 项测试时的验收）
按采样时间取生效基准与规则 → 事件生成/去重/升级 → 站内通知与确认 → 恢复待确认 → 授权关闭；
趋势图（数据线 + 基准分段线 + 三级阈值线 + 事件节点 + 修订标记）；CSV 批量导入（上传/粘贴、逐行校验、错误行不写入、
复用录入路径、来源标 `csv`）。

### V0.3（进行中，已完成部分）
1. **数据模型**：计划/任务/问题/附件/工单 + 库 v4 + 旧库迁移（测点补 NFC 标签）+ 编号规则；
2. **计划与任务**：计划仓储（归属校验）、**并发安全的任务生成**（业务键主键 + 事务内 add）、
   今日待办与我的任务（**任务保存不可变计划快照**：范围/归属/清单不随计划改动而变）；
3. **到点打卡**：**到点与检查完成分开**（`pending / arrived / completed`）、模拟读卡 + 人工兜底留痕、
   `attempts` 尝试历史（失败只留痕不回退）、检查清单逐项作答、异常项必须关联真实问题或写依据；
4. **问题池**：三类来源汇聚（传感器预警 / 巡检发现 / 人工上报）、人工上报入口（不限身份、来源不可伪造）、
   筛选（状态/来源/楼栋/异常类型）、详情（关联任务、预警事件、原问题、工单、照片、时间线）、
   **审核六个一级出口 + 二级分类**、**关联既有对象双向留痕**、**审核权限与关联目标校验下沉仓储**；
5. **工单闭环**：**审核转维修原子建单**（问题+工单+日志单事务）→ 派工（限安全管理人员、必指定人）→
   接单/完工（限维修侧、措施必填、完工照片入库）→ 验收退回/通过（**通过后问题进"待复查"，不自动关闭**）。

### 尚未开始（V0.3 剩余 / V1.0）
- 预警中心事件详情"**转问题处理**"入口（仅安全管理人员，预填事件编号/测点/等级/证据摘要）；
- 交互收口 P1-1/P1-2（审核结果预览、状态卡点击筛选、右侧抽屉、人工上报后自动定位、出口切换清空关联字段、提交中禁用）；
- P1-3 **"无需建问题 / 无需处理"结构化原因**（读数稳定 / 非结构部位 / 已当场处理 + ≥10 字说明 + 写日志 + 按人员/楼栋/原因类型统计；"已当场处理"要求照片或说明无法拍照的原因）；
- **`closeBasis()` 接入事件关闭唯一入口**：连续 3 条恢复复测 **且**（关联工单验收通过 或 安全管理人员"无需维修"核查结论）**且** 关闭人限安全管理人员，关闭写事件时间线、问题时间线与审计日志；
- V1.0：观察期与复查日期、复发关联原问题、周期保养、三个管理统计指标、CSV 明细、HTML 可打印报告、六分钟 V1 演示脚本。

---

## 5. 下一步的明确顺序（评审给定）

1. 预警中心"转问题处理"入口（`issues.createIssueFromEvent()` 已就绪并有测试，剩页面挂按钮 + 预填）；
2. P1-1/P1-2 交互收口（见上）；
3. P1-3 结构化原因与统计；
4. `closeBasis()` 接入事件关闭唯一入口；
5. 观察期/复发 → 周期保养 → 三个统计指标 → CSV 明细与可打印报告；
6. 固定六分钟 V1 演示脚本：
   `预警 → 问题 → 工单 → 验收 → 复测 → 关闭`。

**现场演示串联（评审指定）**：地图异常测点 → 人工上报或预警转问题 → 问题池待审核 → 审核结果预览 →
派工与验收 → 复测恢复 → 授权关闭。

---

## 6. 待用户拍板的问题（接手时要继续追问）

1. **倾角变化速率阈值**：仍"未配置"，页面照此显示，不编造数值。
2. **恢复待确认口径**：保持"连续 3 条有效复测"，不为演示改成 1 条。
3. **审核出口口径冲突（已定案）**：采用"**六个一级出口 + 二级分类**"——
   转维修工单（设备故障/一般维修）、转专业排查（建筑裂缝/倾斜/结构安全）、安排复查（情况不明/需再次测量）、
   退回补充（图片/位置/描述/测量数据不足）、关联既有对象（关联已有问题/关联既有预警事件）、
   无需处理并关闭（未发现异常/误报/非结构部位/已当场处理）。**已实现**，无需再问。
4. **我提出的保留意见（尚未得到回应，可继续提）**：
   - "无需建问题"以前的"≥10 字"门槛容易被套话糊弄 → 已在 P1-3 改为结构化原因，做的时候请坚持；
   - 材料与口播不要出现"真实 NFC 打卡"这类表述，统一说"到点核对（纯前端阶段为模拟读取）"；
   - 任务详情目前是页内展开，V0.3 收尾时建议改为路由页 `/inspection/task/:id`（手机端体验）。

---

## 7. 验收方法（很关键，能省大量时间）

### 环境
- `npm run dev`（5173）用于开发；**验收用打包产物**：`npm run build` 后 `npm run serve`（4173）。
- **预览服务会随宿主进程退出而停掉**：停掉后页面变成 `chrome-error://chromewebdata/`，
  `location.origin` 为 `null`、IndexedDB 直接以 SecurityError 拒绝访问——先确认服务在不在，别误判成应用故障。
- 导航要带破缓存参数：`http://127.0.0.1:4173/?v=<递增数字>#/路由`。

### 浏览器操作（这台机器上的坑）
- **Playwright 的 locator click 会莫名超时**（元素可见、启用、位置稳定也超时）；`cua.click` 也已不可靠。
  **最稳的是页面内点击**：`evaluate` 里 `el.click()`（Vue 的 `@click` 正常收到）。
- **给输入框赋值要用原生 setter**：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v)`
  再派发 `input`（select 用 `HTMLSelectElement.prototype`，textarea 用 `HTMLTextAreaElement.prototype`）。
  注意 `el.constructor.prototype` 会抛 `Illegal invocation`。
- **合成 PointerEvent 能测落点**，但必须带 `pointerId: 1`、`pointerType: 'mouse'`、`buttons` 正确，
  且按 `pointerdown → pointerup` 顺序派发（楼层图落点挂在 pointerup 上）。
- **文件上传**：IAB 不支持 filechooser，用 `new File([blob], name, {type})` + `DataTransfer` 赋给 `input.files`
  再 `dispatchEvent(new Event('change'))`，走的是真实 `onFile` 处理函数。造测试图片用 canvas + `toBlob`。
- **写库结果直接查 IndexedDB**（数表行数、看字段），比读界面文字可靠；涉及写入的操作要给足 2~3 秒再读。
- 页面内 `el.click()` 之后如果立刻读结果，容易读到旧状态；**重要断言前先等 1.5~3 秒**。
- 截图 `nodeRepl.emitImage(await tab.screenshot())` 会落盘到 `artifacts\sess_...\*.png`，
  可交给只读的视觉验收 agent 对照检查。

### 自动化测试
- `npm test`（vitest，**node 环境**）。仓储测试用 **fake-indexeddb**（已装 devDependency）+
  `tests/setup.ts`（localStorage 桩），能跑真实 IndexedDB 行为（并发、事务回滚都靠它验）。
- 测试目录结构与源码同标准：`tests/{events,trend,map,inspection/{plans,tasks,issues,workorders}}/`，
  共用夹具 `tests/fixtures.ts`。**新增测试注意每个目录 ≤8 个文件。**

### 规模自检脚本（接手后可直接跑）
```python
import io, os, re
def scan(path):
    lines = io.open(path, encoding='utf-8').read().split('\n')
    pat = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(')
    out = []
    for i, l in enumerate(lines):
        m = pat.match(l)
        if not m: continue
        depth = 0; started = False
        for j in range(i, len(lines)):
            depth += lines[j].count('{') - lines[j].count('}')
            if '{' in lines[j]: started = True
            if started and depth <= 0:
                out.append((j - i + 1, m.group(1) or m.group(2))); break
    return out
bad = 0
for root in ('src', 'tests'):
    for dp, dn, fn in os.walk(root):
        code = [f for f in fn if f.endswith('.ts') or (root == 'src' and f.endswith('.vue'))]
        if len(code) > 8: print(f'[目录>8] {dp}: {len(code)}'); bad += 1
        for f in code:
            p = os.path.join(dp, f)
            n = len(io.open(p, encoding='utf-8').read().split('\n'))
            if n > 450: print(f'[文件>450] {p}: {n}'); bad += 1
            if root == 'src':
                for ln, name in scan(p):
                    if ln > 80: print(f'[函数>80] {name} {p} = {ln}'); bad += 1
print('不合规项:', bad)
```

---

## 8. 演示与交付物

- **演示数据**：设置页"重新载入示例校区"（4 栋楼 / 8 测点 / 4 设备 / 8 条记录 / 0 事件）；
  预警中心"一键演示脚本"会写入 8 条裂缝样本并生成事件与通知。**当前工程内演示表已清空**（plans/tasks/issues/attachments/workOrders 为空）。
- **身份切换**：任务归属与工单权限按执行角色区分，演示时要用「系统设置 → 演示身份」切换
  （安全管理人员 / 巡检人员 / 维修人员）；**页面与仓储都会校验角色**。
- **交付物**：`dist/` 构建产物；`docs/` 下三份文档 + 预警规则 Word（**用 WPS 打开/另存，不要用 LibreOffice 生成**；
  标题样式必须显式写 `outlineLevel`，否则 WPS 目录显示"错误！未找到目录项"）。
- Word/PDF 交付件的既有版本已在 `docs/`，重生成时保持同样口径。

---

## 9. 已知易错点（踩过的坑，别再踩）

| 坑 | 正确做法 |
| --- | --- |
| 判定/选规则只看时间不看适用范围 | 规则要过 `ruleAppliesTo()`（指标 + 启用 + 楼栋/测点范围） |
| 用"当前"基准/规则判断历史记录 | 一律按**采样时间**取当时生效版本 |
| 跨表写入分两次 | 业务数据 + 审计日志放同一个 IndexedDB 事务 |
| 内存缓存优先 | 写入前**读库**；缓存可能"命中但已过期" |
| 布尔 prop 缺省被 Vue 转成 `false` | 用 `withDefaults` 显式给默认值（曾把"开始检查"按钮整没了） |
| 时间直接截 ISO | 用 `formatDateTime()` |
| 计划改动追溯改写历史任务 | 任务保存不可变 `planSnapshot` |
| 用哈希做主键 | 用完整业务键（任务用 `计划ID@执行时刻`，问题用提交标识 base64url） |
| 提交时用旧状态判定 | 先把提交内容并入候选状态，再交给 core 判定 |
| 页面隐藏按钮当权限 | 仓储层校验角色 |
| 测试夹具缺字段导致假通过 | 夹具要跟类型同步（例如 `makePoint` 默认带 `nfc`） |

---

## 10. 一批可以直接复用的验收口令（现场演示/答辩）

1. **数据可不可信**：录入不填宽度 → 提示"缺项不按零处理"；同一分钟重复 → 提示改用修订；
   修改保存原值（记录详情可见修订前原值）。
2. **预警是否可解释**：录入 0.62/0.73/0.82 → 黄/橙/红逐级升级，同一未关闭事件只追加证据不重复建单；
   趋势图阈值线落在 0.60/0.70/0.80 刻度上，事件节点与预警中心同源。
3. **批量导入不绕过校验**：错误 CSV 六类逐行提示且不写入；正确 CSV 写入后与手工录入结果一致；
   操作日志留批次文件名。
4. **到点不是查完**：模拟读卡后点位是"已到点，待检查"，任务进度仍 0/1；清单答完才算检查完成；
   扫错卡只留痕不回退。
5. **三来源同池但可追溯**：人工上报/巡检发现/预警转单都能追到原始任务或事件；来源不可伪造。
6. **审核不是结案**：六个一级出口 + 二级分类；转维修**真建工单**；验收通过只到"待复查"，不自动关闭。
7. **权限在仓储**：非安全管理人员无法审核、无法派工、无法写审核结果（页面与仓储双拦）。

---

## 11. 接手后的第一批命令

```bash
npm install          # 首次
npm test             # 应看到 366 项全过、27 个文件
npm run typecheck    # 类型检查
npm run build        # 打包（vue-tsc + vite build）
npm run serve        # 本地静态服务 4173，验收用
```

浏览器打开 `http://127.0.0.1:4173/?v=1#/`，先「系统设置 → 重新载入示例校区」，
再按第 5 节的顺序继续开发：**转问题处理入口 → P1 交互收口 → 结构化原因 → closeBasis 接入关闭 → V1.0 剩余**。
