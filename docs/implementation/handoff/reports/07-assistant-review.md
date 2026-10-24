# 阶段 7 独立审核：不通过

审核日期：2026-10-24；执行取证：2026-10-23。审核代码 HEAD：`c02a82b`，
包含 `f3a2e8b`、`191497c`、`42bed60`，对照阶段 7 计划和全阶段约束。

结论：**不通过，返修后复审；阶段 7 保持待审核，不进入阶段 8。**
问题涉及授权、重复写入、对象绑定、知识入口和媒体持久化，不能只补页面截图后放行。
本轮未修改业务实现、原提交报告或交付库；新增内容只有审查脚本、失败用例、证据和审核文档。

## 核验方法与边界

- 后端全量测试、前端全量测试、tooling、类型检查、生产构建、Ruff 均独立执行。
- 缺陷复现使用独立 TemporaryDirectory 数据库和 FastAPI TestClient；调用真实 ASGI 路由、
  授权依赖、领域操作与 SQLite。这是 ASGI HTTP 边界复验，不冒称真实 TCP/浏览器测试。
- Web 审查用例执行真实 Pinia store/适配函数，只替换网络和视频解码边界。
- 20 条 FAQ 比较使用原 corpus 的标准问法、同一临时库、同一身份；该临时库没有嵌入模型，
  使用正式 FAQ/关键词降级路径。它不替代带模型的冻结 60 题验收。
- 生产端口只做 GET 存活检查；未重建容器、清库、改查寝工程或终止任何交付服务。
- 本轮未补采窄屏/视频/双点页面证据，也未重新执行用户的 Docker 备份恢复流程，不能据本审核宣称这些已复验通过。

## 已确认缺陷

### R1 / P1：媒体列表与相似案例存在范围越权，Web 媒体缓存不随身份清空

位置：`backend/src/zhutong/operations/media/session.py:89`、`:151`；
`backend/src/zhutong/operations/assistant/facts_extras.py:64`；`src/stores/media.ts:401`。

- `buildingIds=[]` 身份不带 pointId 读取 frames、comparisons、summary，均得到 200，
  返回其他楼栋的 2 帧、2 次比对及文件名、mediaId、pointId、contentUrl。
- 同身份问“有没有类似裂缝案例”，返回范围外问题编号、状态等案例信息。
- Web 在旧身份取得媒体字节后切到空范围新身份，frames 仍保留；新增审查用例失败。
- 内容接口本身仍可能拒绝原图读取；这不能抵消列表元数据已经泄露的事实。

最小修复：复用既有业务范围判定，列表和聚合逐项授权，无 pointId 时也过滤；
无测点媒体按上传者/角色授权。身份、范围、数据集或 epoch 变化应清除媒体和比对缓存，
正在上传/恢复的旧请求也不得回填。补空范围、部分范围、无测点媒体和身份切换回归。

### R2 / P1：新增写入绕过幂等、epoch、审计与回执

位置：`backend/src/zhutong/routers/datasets/assistant/api.py:15`、`:61`、`:77`。

- 相同 Idempotency-Key 连问两次，写出不同 turnId；重复登记帧和比对也各新增两行。
- 携带 `X-Dataset-Epoch: 999` 的提问仍成功保存轮次。
- 探针前后：turns 0→3、frames 0→2、comparisons 0→2，operation_receipts 8→8。
  audits 9→10 的唯一增量来自原有照片上传；这些新增命令没有自己的审计/回执。
- Write 依赖保证数据库事务，不等于已经执行命令幂等与 epoch 检查。

最小修复：复用既有 Command/execute_command，摘要包含目标路径和载荷；保存答案、会话、
轮次、媒体关联、审计和回执同事务。同键同内容返回原结果，同键异内容冲突；旧 epoch 拒绝。
助手拒绝业务办理的口径可保留，但会话/媒体持久化本身仍是写操作，必须遵守总计划。

### R3 / P1：会话恢复绕过当前范围与 epoch

位置：`backend/src/zhutong/operations/assistant/sessions.py:10`、`:119`；
`src/assistant/remote/session.ts:32`。

- 身份原先授权 B03，保存读数 0.82 的回答；随后收回楼栋范围。
  新查询已 not_found，但 GET 原会话仍 200，并恢复原完整读数、测点与位置。
- 临时库 epoch 增加后，原会话仍可读取、继续追加；服务端会话没有 epoch 隔离。
- 显式无效 sessionId 会静默回退到该身份最近会话，掩盖对象/会话失效。
- 前端存储键只有 actorId 与本地 resetAt，不能代表服务端 datasetId/epoch。

最小修复：会话关联 datasetId、epoch；读取/恢复重新核验引用对象和知识的当前可见性，
无权内容不返回原答案正文。失效对象明确标记，旧 epoch 不继续绑定；无效显式会话不得静默换会话。
可保留历史查询时间和原快照，但历史快照不能成为绕过当前授权的通道。

### R4 / P1：显式楼栋被忽略，候选选择与多轮对象链路不通

位置：`backend/src/zhutong/operations/assistant/resolve.py:190`；
`backend/src/zhutong/operations/assistant/facts.py:125`；
`src/assistant/remote/session.ts:62`、`src/assistant/remote/answer.ts:117`。

- 库里只有 B03，问“B99 的裂缝测点现在怎么样”，实际回答 B03 的 0.82；指标匹配未与楼栋线索取交集。
- 测点回答中列出唯一未关闭事件，但 objects.eventId=null；接着问“这条预警为什么被触发”得到 not_found。
- Web 映射丢弃 issueId/workOrderId，下一轮无法保持精确的问题/工单绑定。
- Web 候选选择发出 context.chosen=true；后端 QueryContext 禁止额外字段，实际 HTTP 返回 422。

最小修复：显式编号、楼栋、楼层、指标共同约束候选；不匹配就失败/澄清。
明确维护已解析的事件、问题、工单 ID；使用独立传输 DTO 白名单，不能将 UI AskContext 整体展开。
补“实际点击候选→请求→回答→追问”的跨层验证，不能只测 need_choice 输出。

### R5 / P1：迟到响应仍会串会话、覆盖新页面或恢复旧轮次

位置：`src/assistant/session.ts:157`、`:276`；`src/assistant/remote/session.ts:131`。

独立审查复现三种失败：

1. 远程请求尚未完成时切页对象 A→B，A 的回答仍被接收；远程分支没有设置 requestContext。
2. 请求中切换身份，旧响应先 rememberServerSession，再检查 generation，旧会话 ID 写进新身份存储键。
3. 恢复请求中调用 clear，迟到的 restore 仍重新写入旧 turns/sessionId。

最小修复：请求开始捕获身份、数据集、epoch、generation 和存储键；所有状态/存储写入前统一校验。
ask、restore、媒体恢复都要覆盖，不能只保护 answer 卡片；切换页面对象也使旧请求失效。

### R6 / P1：知识检索分数不能代表助手入口，标准 FAQ 在意图路由中丢失

位置：`backend/src/zhutong/operations/assistant/parse.py:163`；
`backend/src/zhutong/operations/assistant/compose.py:91`；`backend/scripts/knowledge/evaluate.py:35`。

原 corpus 的 20 条标准 FAQ：直接 knowledge/search 为 **20/20 answer**，
相同问题经 assistant/query 只有 **9/20 answered**；其余 11 条均 not_found。
例如“CSV 导入为什么需要先预检？”被当成事件原因，“恢复待确认会自动关闭预警吗？”
被当成当前事件恢复，“维修人员可以自行验收工单吗？”被当成当前问题状态。

提交的 57/60 数据是知识检索接口评测，不证明助手完整入口仍为 57/60。
本轮没有带模型重跑全部 60 题，不推断它们经助手入口的具体得分。

最小修复：区分通用知识解释与指定对象的实时事实；复用 FAQ/知识决策，
既不因“为什么/问题/设备”等单词强制业务查询，也不把显式业务对象无权/不存在的失败包装成知识成功。
冻结原题和期望答案，分别保存 search 与 assistant 两条路径的逐题结果。

### R7 / P1：规则选择与试算脱离阶段 4 权威判定

位置：`backend/src/zhutong/operations/assistant/facts.py:84`；
`backend/src/zhutong/operations/assistant/compose.py:190`；
`backend/src/zhutong/operations/assistant/facts_extras.py:117`。

- 同一规则新版本停用后，助手过滤 enabled 再取版本，回退显示旧 V0.9；与阶段 4 先选版本再判断启用的口径不一致。
- 问“试算黄色阈值改为0.15毫米”，服务端实际使用黄0.1/橙0.2/红0.3的默认值。
- 库内 assessment.state=red，试算却把 original 展示为 normal，因为读取不存在的 level 字段。
- 试算直接比较原始第一个值，没有复用基准变化量、变化速率、持续规则等权威算法。

最小修复：明确“采样时判定依据”和“当前生效规则”的时间语义，复用阶段 4 选择器/判定引擎；
不复制第二套判定。解析实际阈值，字段缺失应澄清或明确沿用的版本，不能硬编码默认值。
追加停用/排除范围/未来生效/独立 ruleId、基准和速率试算等回归，试算前后业务库不变。
Web 部分试算仍走既有本地算法；这不消除已公布服务端接口返回错误事实的问题。

### R8 / P1：视频与分析结果尚未完整持久化，来源标记会丢失

位置：`src/stores/media/videoSession.ts:34`、`:64`、`:89`；
`src/api/backend/mediaSession.ts:20`；`backend/src/zhutong/operations/media/session.py:79`。

- 服务端模式下 loadBundledVideo→captureKeyframes 产生 3 帧，settleSync 后正式上传/登记调用均为 0。
  抽帧直接赋值 frames，绕过 addFrame/enqueueSync；视频元数据和分析结果仍仅在内存。
- 帧登记固定 video_id=None，DTO 不接 videoId；恢复时不能重建原视频身份与可比条件。
- 上传模拟图片没有传 origin，正式上传接口按普通 upload 处理，恢复会丢失模拟/公开参考来源。
- analyseRegions/analyseVideo 的结果没有正式保存链路；已保存普通照片对比不能代表所有视觉流程已经完成。

最小修复：补视频原字节、元数据、关键帧关联、分析/区域比对结果的正式读写与只读恢复，
保留原算法；来源标记贯穿上传、存库、备份、恢复和 UI。失败不得显示已保存。
因此 S7-06/S7-07 需要实现返修，不能只归为“缺页面证据”。

### R9 / P2：事实快照没有完整的行版本契约

位置：`backend/src/zhutong/operations/assistant/compose.py:71`、`:229`；
`backend/src/zhutong/operations/assistant/facts.py:173`；`facts_more.py:244`。

objects 只有 ID，sources 只有查询时间/来源；recordRevision 只是部分证据文本中的修订次数，
不是 expectedRev，也不能表示事件、问题、工单行版本。当前契约不能验证“回答后对象已变更”。

最小修复：定义结构化事实快照/引用 DTO，保存所用对象的 row rev、recordRevision、规则/基准版本和查询时间，
只读恢复标记历史快照；再次查询使用当前数据。不要把 recordRevision 与乐观锁 rev 混用。

### R10 / P2：结构门禁漏扫，格式检查未通过

位置：`backend/tests/monitoring/test_structure.py:8`，实际超限见 results.json.structure。

| 项目 | 实测 |
| --- | --- |
| operations/assistant 直接 Python 文件 | 9 个 |
| facts.point_status | 94 行 |
| compose._business_answer | 7 参数 |
| resolve.resolve_objects、sessions.append_turn | 各 6 参数 |
| scripts/stage7_cases.run | 210 行、6 参数 |
| scripts/stage7_cases_late.run_late | 323 行 |
| scripts/stage7_http_support.seed_archive / Api.ask | 134 行 / 6 参数 |

现有门禁没有覆盖 operations/assistant、tests/assistant 和阶段 7 脚本，故全量测试绿不代表新增代码符合指标。
Ruff check 通过；format --check 实测失败：stage7_cases.py、stage7_cases_late.py、stage7_checks.py、
stage7_verify.py、operations/assistant/knowledge_answers.py，共 5 文件。

存在重复规则选择/试算逻辑与上下文数据泥团，分别造成口径漂移和遗漏字段。
建议仅复用已有选择器、引入本阶段 DTO/请求上下文、拆分超长函数和脚本用例分组；不全面改造助手。
依用户 AGENTS.md，结构优化方案需在安排返修时确认，是否按这一最小范围一并处理。

## 独立命令结果

| 命令 | 本轮结果 | 退出码 |
| --- | --- | --- |
| backend: uv run pytest --cov=zhutong --cov-report=term --cov-fail-under=80 -q | 241 passed；87.72% | 0 |
| backend: uv run ruff check src tests migrations scripts | All checks passed | 0 |
| backend: uv run ruff format --check src tests migrations scripts | 5 files would be reformatted | 1 |
| npm test | 118 文件 / 1152 passed | 0 |
| npm run test:tooling | 5 passed；后端漏扫另列 | 0 |
| npm run typecheck | 通过 | 0 |
| npm run build | 通过，6.40s；主包1016.81kB，既有体积警告 | 0 |
| backend/.venv/Scripts/python.exe docs/implementation/evidence/stage7-review/probes.py | 观测到上述缺陷，输出 results.json | 0 |
| npx vitest run --config docs/implementation/evidence/stage7-review/vitest.review.config.ts | 2 文件 / 8 个审查用例全部失败，成功复现缺陷 | 1 |

probes.py 的 0 表示取证脚本完成，不表示验收通过。新增失败用例在 evidence 下，未混入原回归结果。
8000/5173、8080/5180 的 GET 均200；18000 的 /api/v1/health/live、/ready 均200。
探测 /api/v1/health 本身是404（无此路由），不作为服务故障。

## 阶段门槛裁定

| 项目 | 审核结果 |
| --- | --- |
| S7-01 | 不通过：规则/试算事实与行版本契约未达标 |
| S7-02 | 不通过：知识入口路由失败；检索57/60不能代替助手验收 |
| S7-03 | 不通过：错楼栋与候选选择422，现有30题覆盖不足 |
| S7-04 | 不通过：多轮ID丢失、迟到响应、恢复/epoch边界失败 |
| S7-05 | 待补证据：完整深链与返回交互未独立验证，且存在迟到响应问题 |
| S7-06 | 不通过：视频保存、试算、来源标记有实现缺口，另缺小屏等页面证据 |
| S7-07 | 不通过：权限变化恢复与媒体全流程持久化不完整 |
| S7-08 | 业务办理请求拒绝并导航的范围口径认可；会话/媒体写入通用门禁仍不通过 |
| S7-09 | 不通过：范围外列表/案例、会话恢复和媒体缓存隔离失败 |
| S7-10 | 部分通过：前序自动化和本地查询可执行；代理黑洞不足以证明服务端断外网，需补严格阻断证据 |

## 对提交者三点疑问的裁定

1. **需要补小屏交互证据**。可用支持视口模拟的浏览器，记录实际宽高、步骤和页面状态；
   不能只缩放截图。先修实现，再补宽/窄屏候选选择、引用、深链、视频、双点比较和刷新恢复。
   本轮没有验证当前浏览器是否支持视口调整，不采纳“当前工具一定做不到”作为免验依据。
2. **冻结题目和期望答案，允许改通用实现**。阶段 6 的3条旧错答保留历史记录，
   不要求本轮硬追60/60；也不禁止一般性逻辑改进。两条入口分别实测、如实记分，禁止逐题硬编码。
3. **交付库现有冒烟会话先保留**。作为持久化演示历史，由阶段10统一复位策略处理；
   返修/复验用独立临时库，不为审核清理 demo-main 或 Docker 卷。

## 证据与下一步

- [后端探针与结果](../../evidence/stage7-review/results.json)：writes/scope/objects/revokedScope/epoch/rules/canonicalFaqs/structure。
- [前端失败输出](../../evidence/stage7-review/web-test.log)、web.test.ts、media.test.ts：共8项。
- [可执行返修提示词](../prompts/07-assistant-fix.md)：按 R1—R10 定向处理，再复审。

当前未授权实施返修，本轮不修改业务代码、不创建“审核通过”标签、不进入阶段8。
