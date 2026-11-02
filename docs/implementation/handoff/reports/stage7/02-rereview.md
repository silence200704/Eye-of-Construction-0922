# 阶段7返修复审：不通过

日期：2026-10-25。代码基线：`76f78a1`；文档HEAD：`1e6c8a5`，含`e7bc91c`。
对照原审核R1—R10、阶段7计划和返修契约；保留2026-10-24的OpenHarmony与7A视觉计划。

**结论：不通过，继续定向返修；阶段7保持待审核，不进入阶段8。**
原缺陷已修复相当部分，但权限重放、恢复竞态、对象关系和视频恢复仍有可重复的主链路缺口。
用户提交的44/44及57/60是其给定问集的实测记录；本复审新增边界不在该问集，不把它们混成原44题失败。

## 核验方式与范围

- 独立复跑后端254项及覆盖率、Web1160项、tooling、类型、构建、Ruff与结构门禁。
- 后端探针使用独立临时SQLite、FastAPI TestClient、真实路由/授权/命令/数据库；称为ASGI边界复验，
  不冒称TCP或浏览器操作。所有模拟业务都在临时库，通过正式接口建立。
- 前端4个审查用例执行真实store/恢复/适配代码；只替换网络和解码边界，失败均为断言差异，非导入/环境错误。
- 检索故障项明确采用注入：让_knowledge返回其真实异常分支的None，验证路由如何降级。
- 原审核证据不修改；未修业务实现、未清交付数据、未启动/停止查寝或交付容器。
- 当前浏览器交互工具不可用，本轮审阅提交的DOM与3张PNG，没有独立重新点击宽/窄屏页面。

## 必须返修的发现

### RR1 / P1：旧回执重放绕过当前权限（R1/R2/R3仍未闭合）

位置：[query路由](../../../../../backend/src/zhutong/routers/datasets/assistant/api.py:43)、
[回执重放](../../../../../backend/src/zhutong/operations/datasets/core/workspace.py:226)。

复现：给同一身份授权B03，保存“B03-F2-CRACK01现在怎么样”的回答，再将buildingIds改为[]。
新键提问返回not_found；GET原会话正确脱敏；但用原Idempotency-Key重放原请求，仍200、replayed=true，
返回0.82mm、位置、原事件和记录ID。回执路径未调用会话的当前可见性检查。

影响：GET会话脱敏可以被POST幂等重放绕过，角色/知识权限收窄后的历史响应也须考虑同样边界。
最小方案：保持原回执及业务副作用不变，对输出做当前授权投影/脱敏或明确拒绝；不能重新执行写入来“刷新权限”。
补普通会话、媒体/视频回执重放及角色/知识收窄测试；重放不得新增业务、审计或回执。

### RR2 / P1：首次恢复和视频字节下载仍会串身份（R1/R5未闭合）

位置：[恢复入口](../../../../../src/assistant/session.ts:186)、
[会话restore](../../../../../src/assistant/remote/session.ts:149)、
[视频恢复](../../../../../src/stores/media/remote.ts:152)、
[媒体缓存watch](../../../../../src/stores/media.ts:326)。

新增3项失败：

1. 尚无turns/sessionId的首次restore进行中切身份，watch条件为false，没有使restoreRun失效；
   旧响应随后将原身份正文和对象填入新身份页面。
2. restoreRemote通过一次身份检查后，继续await视频frameBlob；在这个await期间切身份，
   下载完成后仍restoreVideo/restoreAnalysis，回填旧视频。
3. 同一用户id不变，buildingIds由null变为[]，已加载照片Blob仍在；目前只watch用户id，未观察授权范围。

最小方案：请求捕获actor/dataset/epoch/授权指纹与generation，所有await之后、所有缓存/存储写入之前复核；
身份/epoch切换即使当前列表为空也使在途restore失效。同id权限变化也清缓存。
清理应针对原请求身份的键，不误删新身份本来可恢复的会话；避免再复制多套不一致的迟到判定。

### RR3 / P1：显式工单与旧问题上下文拼成错误业务事实（R4未闭合）

位置：[显式对象解析](../../../../../backend/src/zhutong/operations/assistant/resolve.py:189)、
[旧上下文合并](../../../../../backend/src/zhutong/operations/assistant/resolve.py:292)、
[对象关系补齐](../../../../../backend/src/zhutong/operations/assistant/resolve.py:380)。

通过正式接口创建无测点问题A及其工单WO-…-001，再创建问题B。携带问题B/测点的旧上下文，
问“WO-…-001现在怎么样”，回答同时给出问题B（pending_review）和工单A（created）。
实际工单issueId指向A，answer.objects.issueId却指向B。

影响：问句显式工单未覆盖旧问题关系，状态说明、快照、导航可能串到另一问题。
最小方案：先从显式对象解析权威的工单→问题→事件/测点关系，再合并与此关系兼容的旧上下文。
多个显式对象互相矛盾要澄清/拒绝，不拼成一条回答。补“显式工单A+旧问题B”“楼栋级无测点工单”等回归。

### RR4 / P1：Web实际保存的视频分析不能正常刷新恢复（R8未闭合）

位置：[分析传输](../../../../../src/stores/media/remote.ts:102)、
[分析恢复校验](../../../../../src/stores/media/videoSession.ts:137)。

真实store链路：载入视频→登记为mv-server→抽帧→等待上传→分析→保存→新store恢复。
外层URL使用服务端videoId，analysis.videoId仍为本地video_*；刷新恢复的videoMeta.id是mv-server，
restoreAnalysis因ID不等直接丢弃，videoAnalysis=null。区域结果内的beforeId/afterId也未做完整服务端映射。

当前q40/API夹具直接提交服务端视频ID，能证明数据库保存字节/JSON，不能发现Web本地ID到服务端ID的错误。
最小方案：传输边界统一转换整张引用关系（videoId、frameIds、区域前后帧ID），等待帧登记完成再保存，
禁止用尚未登记的本地ID兜底；服务端校验提供的引用属于该视频/测点。
补Web完整往返恢复与上传尚未完成时分析测试，不仅断言上传函数被调用。

### RR5 / P1：无测点问题/工单仍污染空范围概况（R1未闭合）

位置：[campus_overview](../../../../../backend/src/zhutong/operations/assistant/answer/facts_more.py:203)。

临时库存在B03楼栋级无测点问题与工单；buildingIds=[]身份问全校概况，得到0栋/0测点，却有1问题/1工单。
原因是把point_id=None直接当作可见，未回溯issue.building_id授权。
最小方案：按楼栋和关联问题解析范围，不能以“无测点”作为全范围；统计与明细共用同一过滤边界。

同时实测既有GET /issues对该空范围身份返回完整范围外问题。其list_issues只按dataset过滤，
这是前序阶段遗留读取风险，不是本轮新增改动；但不能在助手侧脱敏后留下可绕过的同数据明细入口。
至少将本次证实的旁路纳入定向修复；其他未复验的旧列表另行跟踪，不借此要求全面重构。

### RR6 / P2：概况把全部记录静默截为20个测点

位置：[聚合记录计数](../../../../../backend/src/zhutong/operations/assistant/answer/facts_more.py:217)。

建立23个测点、22条有效记录，全校概况实测仅计19条。代码只遍历list(point_ids)[:20]，
未声明截断，且集合迭代次序不稳定；重现时结果可能19或20，均非真实22。
最小方案：对完整授权集合聚合；展示分页不能改变总数。补超过20测点和有档案无测点楼栋的统计边界。
与S7-01关键事实准确性直接相关，不能用原44题较小数据集通过代替此项。

### RR7 / P2：知识检索异常时部分业务查询变成500（R6/S7-10缺口）

位置：[_general_knowledge](../../../../../backend/src/zhutong/operations/assistant/answer/compose.py:199)。

_knowledge在捕获检索异常后返回None；此时查询不存在B99测点，_general_knowledge调用None.get，
实际响应500 INTERNAL。应明确返回业务not_found及知识不可用状态，不能让检索降级挡住业务失败说明。
最小方案：Optional知识结果先判空，保留显式对象失败语义；补有效对象、无效对象、概念问题三类检索异常场景。

## 原R1—R10的复审状态

| 原项 | 结论 | 依据 |
| --- | --- | --- |
| R1范围 | 部分修复，未关闭 | 媒体/案例基本过滤已补；RR1/RR2/RR5仍存在 |
| R2命令 | 部分修复，未关闭 | 幂等/审计/epoch基础用例通过；RR1回执敏感内容绕过权限 |
| R3会话 | 部分修复，未关闭 | GET脱敏、旧epoch410已补；RR1/RR2仍可泄漏旧回答 |
| R4对象 | 部分修复，未关闭 | B99/楼层/候选chosen及ID保留已补；RR3关系仍会串 |
| R5迟到响应 | 部分修复，未关闭 | 原8项回归已过；RR2首次恢复和视频await窗口漏验 |
| R6知识 | 常规问答已改进，未完全关闭 | 20FAQ路径已有测试/结果，冻结题未变；RR7降级500 |
| R7判定/试算 | 本轮未发现阻断 | 已复用阶段4选择器/引擎，0.15/原state/停用用例通过；不代表所有未测自由问法支持 |
| R8媒体 | 部分修复，未关闭 | 上传/登记/来源/数据库恢复已补；RR4 Web分析实际恢复失败 |
| R9事实版本 | 本轮未发现新增阻断 | snapshot含rev/recordRevision，历史值稳定回归通过；错误对象关系仍需RR3纠正 |
| R10结构/格式 | 本轮检查通过 | 递归覆盖已补，相关结构2项和tooling通过；Ruff check/format通过 |

## 独立检查结果

| 检查 | 本轮结果 | 退出码 |
| --- | --- | --- |
| uv run pytest --cov=zhutong --cov-report=term --cov-fail-under=80 -q | 254 passed；覆盖率88.65%；186.09秒 | 0 |
| uv run ruff check src tests migrations scripts | All checks passed | 0 |
| uv run ruff format --check src tests migrations scripts | 243 files already formatted | 0 |
| npm test | 120文件、1160用例通过 | 0 |
| npm run test:tooling | 5通过 | 0 |
| npm run typecheck | 通过 | 0 |
| npm run build | 通过，11.06秒；主包1022.65kB，保留体积警告 | 0 |
| 独立后端probes.py | 完成取证，记录RR1/RR3/RR5/RR6/RR7 | 0（不是验收通过） |
| 独立前端审查 | 2文件、4个断言失败，复现RR2/RR4 | 1 |

本轮未带模型独立重跑冻结60题或原44题TCP脚本；这两类分数按提交材料审核，不宣称已独立重复得到。
冻结acceptance.json的SHA仍为0d3b42c6f3e41cbc18085145cc2429fec53ecbaea028f9b23e002812963a7b16，
与阶段6一致，Git差异未发现改题/改期望。3条旧错答仍按原裁定保留，不因此单独否决本阶段。

## 运行与页面材料的核对限制

- 已检查questions.json的44/44、knowledge-paths.json的20/20与57/60汇总；并查看逐项逻辑与相关自动测试。
- 已检查backup-restore.json中14项hash匹配与表计数说明；本轮未重新创建/恢复该备份。
- 已审阅断外网、容器重建、重启恢复记录，但未独立重跑这些过程，不能以材料中的JSON分析恢复代替RR4的Web验证。
- PNG尺寸实测为1440×900、1440×900、390×844。wide-assistant.png画面未展开问答面板，
  与交互清单对应行的描述不一致，需换正确截图或修正索引；不能由此推断其余DOM步骤未做。
- 窄屏清单记录首页/候选/趋势/影像/返回/刷新，未像宽屏逐项覆盖引用、试算、回放、问题工单等。
  返修后补这些关键窄屏步骤的实际状态和数据关联，不把宽屏结果直接算作窄屏通过。
- 本轮GET探测8000/5173/8080/18000均连接拒绝，属于当前环境未运行，未启动/重启它们。
  不据此认定提交时的并存记录虚假，也不声称本轮独立核验了健康容器或生产页面。

## 下一步

使用[定向返修提示词](../../prompts/07-assistant-rereview-fix.md)解决RR1—RR7，补宽窄屏状态证据再复审。
优先使用已有范围/对象关系/请求上下文帮助函数，只做当前正确性所需局部整理，不全面重构。
按用户AGENTS.md，如需超出该范围的结构优化，先单独确认；本轮未实施任何业务修复。

7A插画/原型可以按新计划准备，但不能凭视觉或OpenHarmony路线更新免除这些功能失败项。
审核证据位于`docs/implementation/evidence/stage7-rereview/`；阶段7状态继续待审核。
