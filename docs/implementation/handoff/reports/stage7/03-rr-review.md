# 阶段7 RR1—RR7返修复审：不通过

日期：2026-10-25。代码基线 `2579f1f`，文档 HEAD `4080295`（含 `c26137a`）。

**结论：不通过，阶段7保持待审核。RR2、RR4—RR7核验通过；RR1、RR3部分修复，另有结构门禁失败。**
本轮不进入阶段8，不重做已通过项；7A视觉准备与OpenHarmony原生计划继续保留。

## 核验范围与边界

- 独立重跑后端全量与覆盖率、Web全量、原复审4个前端用例、tooling、类型、构建、Ruff check/format。
- 原后端探针在新的临时SQLite通过真实ASGI路由执行；新增2项有断言的独立失败回归。
  这些是ASGI验收，不冒称真实TCP或浏览器交互；交付库未写入测试数据。
- 审阅补交的宽窄屏DOM与截图，实际查看了wide-assistant、wide-video-restore、narrow-workorder。
  当前没有独立重新操作浏览器；视频截图首屏只覆盖部分帧，完整帧及区域结论结合DOM与回归核对。
- 44题、FAQ两路20/20、冻结题两路57/60、断外网、重启、备份与容器重建为提交证据审阅，
  本轮没有重新执行这些专用脚本，也没有重建交付容器。冻结的3条既有错答不作为新增失败。
- 未修改业务实现或提交者完成度报告；只新增审核文档、探针、失败回归和日志，更新审核索引。

## 仍须修复

### RR1残留 / P1：角色收窄后媒体回执仍泄露已隐藏元数据

定位：[session.py:140](../../../../../backend/src/zhutong/operations/media/session.py:140)，
对照同文件 `_media_readable`（13行）、`_visible_frame_parts`（95行）。

独立复现：

1. 身份A上传未绑定测点的图片；安全身份B有楼栋权限，可将该媒体登记为该楼栋的关键帧。
2. 将B角色改为device，保留同一楼栋范围。按现有所有权规则，B已无权读取A的未绑定媒体。
3. B的GET frames返回空数组；同请求换新幂等键登记返回403「无权读取该媒体」。
4. B使用原幂等键重放却200、`replayed=true`，返回原filename、label、mediaId、尺寸、contentUrl等。
   重放前后frames/audits/receipts计数一致，说明缺陷在输出授权，不是重复写入。

根因：`replay_visible`只检查测点active和楼栋范围，没有复用媒体所有权可见性。
助手重放脱敏、测点范围收回及归档404已修复，但不能因此关闭完整RR1。
本轮实证是**元数据泄露**，没有据此宣称媒体原字节也能越权下载。

最小方案：对媒体重放按对象类型检查当前媒体/帧及依赖的可读性，复用现有授权规则；
比对检查两端帧，视频/分析检查相应媒体依赖。无权时403或404，不返回旧敏感正文；
原回执不变，不重新执行命令，不新增审计/回执。避免另写一套只检查point的授权逻辑。

### RR3残留 / P1：无测点工单仍继承无关测点和预警，污染对象及事实快照

定位：[resolve.py:306](../../../../../backend/src/zhutong/operations/assistant/resolve.py:306)，
显式编号绑定入口见189行。

原缺陷中的「旧问题B覆盖工单A的问题」已修复，显式冲突问题编号也已拒绝。
但本轮使用同一类无测点问题补查整张关系图：

1. 工单A的问题本身`pointId=null`、`eventId=null`，工单自身`pointId=null`。
2. 旧页面上下文带另一个有效测点P及其红色事件E；显式询问工单A状态。
3. 回答的问题/工单正确，但`objects.pointId=P`、`objects.eventId=E`；
   `snapshot.objects`也含P、E的id与rev，与工单A的问题关系不一致。

根因：显式对象的「真实关联为空」仍被当作「未指定、可用旧上下文补全」，`_apply_context`补进旧点/旧事件。
这会把无关对象带入后续问答和版本快照。独立回归在对象断言上失败，非环境/导入错误。

最小方案：区分显式对象已绑定但关联为空与尚未指定对象；先确定显式工单/问题的完整关系，再过滤旧上下文。
没有关联的点/事件保持null，快照不列无关对象；保留普通代词追问、合法候选点击和已有冲突处理。
不要为此大范围重写解析器。

### 结构门禁 / P2：seed_video为82行，全量pytest实际失败

定位：[stage7_seeds.py:189](../../../../../backend/scripts/stage7/stage7_seeds.py:189)。

当前提交的函数189—270行，AST计数82行；文件与`2579f1f`一致，本轮未改动该脚本。
独立全量结果为**263 passed / 1 failed，覆盖率88.78%**；失败就是现有结构门禁。
单独复跑结构门禁仍**1 passed / 1 failed**。因此当前代码不能采纳报告中的264全过、结构2全过结论。

最小方案：按职责抽取「关键帧登记」或「分析载荷构造」的小函数，保留3/6/9秒帧、服务端引用与区域统计。
不要删除必要断言、压缩代码、改80行阈值或把scripts/stage7移出扫描以绕过门禁。
这是局部拆分建议；本轮未执行重构。

## RR关闭核对

| 项 | 本轮判定 | 独立证据 |
| --- | --- | --- |
| RR1 | 部分修复，未关闭 | 助手范围/知识角色收窄回归通过；媒体所有权收窄重放失败 |
| RR2 | 通过 | 原首次恢复/下载窗口/同id范围3项转绿；正式前端测试全过，代码逐await复核恢复结果 |
| RR3 | 部分修复，未关闭 | 原工单问题事实正确；新增无关point/event对象与快照断言失败 |
| RR4 | 通过 | 真实store往返及延迟帧登记正式用例通过；后端引用校验用例通过，补交恢复DOM |
| RR5 | 通过 | 临时库空范围概况为0，GET issues为空；正式范围测试通过 |
| RR6 | 通过 | 原探针23点/22有效记录，概况22；正式空楼栋计数用例通过 |
| RR7 | 通过 | 故障注入无效对象200/not_found；有效对象与知识unavailable正式用例通过 |

以上是复审问题关闭数，不将5/7误报为S7-01—S7-10的阶段完成比例。

## 独立检查

| 检查 | 本轮结果 |
| --- | --- |
| `uv run pytest --cov=zhutong --cov-report=term --cov-fail-under=80 -q` | 263 passed / 1 failed；88.78% |
| `uv run pytest tests/monitoring/test_structure.py -q` | 1 passed / 1 failed，退出1 |
| 新增2项审核回归 | 2 failed，退出1；失败分别对应上述RR1/RR3 |
| `npm test` | 122文件 / 1165 passed |
| 原4个前端审查用例独立配置 | 2文件 / 4 passed |
| `uv run ruff check .` / `uv run ruff format --check .` | 均通过；248文件already formatted |
| `npm run test:tooling` | 5 passed，退出0 |
| `npm run typecheck` / `npm run build` | 均退出0；仍有既有900kB块体积提示 |
| 端口只读探测 | 18000 `/api/v1/health/ready` 200，8080 200；8000/5173连接拒绝 |

未启动、停止或改动查寝，未清空Docker卷；本轮不宣称两项目并存已实测。

证据：[results.json](../../../evidence/stage7-final-review/results.json)、
[checks.json](../../../evidence/stage7-final-review/checks.json)、
[日志目录](../../../evidence/stage7-final-review/logs/)。
原`stage7-rereview`失败证据未覆盖。

## 后续

按[本轮最小返修提示词](../../prompts/07-assistant-rr-final-fix.md)修上述3项，重新提交审核。
其余已验证修复保持；无需重做阶段6知识检索或大范围重构。
通过后按已修订顺序推进7A双端亲和视觉，再进入阶段8 OpenHarmony原生App。
