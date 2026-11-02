# 阶段7 RR返修后的最后三项定向修复

先读AGENTS.md、reports/stage7/03-rr-review.md及evidence/stage7-final-review。
代码基线2579f1f，文档4080295。阶段7待审核，不进入8，不重做已核验通过的RR2、RR4—RR7。
保留7A视觉、OpenHarmony API≥12原生App与全部南向硬件模拟的设计计划。

## 只修以下范围

1. RR1媒体回执授权：当前replay_visible只看point，遗漏媒体所有权。
   复现为A上传未绑定媒体→safety身份B登记帧→B改device且楼栋不变：GET帧隐藏、
   新键登记403，但旧键重放200返回私有元数据。
   重放时复用当前媒体/帧可读性，按帧、比对两端、视频/分析的真实依赖检查，不只看point。
   拒绝时403/404，不返回旧敏感内容；不重办命令、不覆盖原回执、不新增审计或回执。
   补所有权/角色收窄用例，保留范围收回及归档404、授权不变时正常重放的回归。
2. RR3完整关系：显式工单的问题没有point/event时，不能用旧上下文的无关点/预警补空。
   区分「关联确实为空」与「还没有指定对象」；回答objects保持真实关系，snapshot不收录无关对象。
   保留正常代词追问、chosen候选点击、显式工单+冲突问题编号拒绝。
   补同楼栋不同点/事件，以及无测点无事件工单的旧上下文用例；不用跳过所有上下文的粗暴方案。
3. 局部拆分backend/scripts/stage7/stage7_seeds.py的seed_video（189—270行，82行）。
   抽取帧登记或分析载荷构造职责，保留3/6/9秒帧及合法服务端ID；函数≤80行、参数≤5。
   不删门禁、不放宽阈值、不通过压行或移出扫描绕过，不做其他大范围重构。

## 先RED后GREEN

在backend执行：

```powershell
uv run pytest ../docs/implementation/evidence/stage7-final-review/test_media_replay.py ../docs/implementation/evidence/stage7-final-review/test_object_graph.py -q
uv run pytest tests/monitoring/test_structure.py -q
```

当前分别是2 failed和1 passed/1 failed。将对应覆盖迁入正式测试；保留审核原件及旧失败日志。
不得修改审查期望让错误行为通过。probes.py退出0只代表取证完成，不代表授权与关系通过。

## 提交前验证

- 全量pytest覆盖率≥80%、Ruff check/format、Web全量、原4项审查用例、tooling、类型、构建均通过。
- 使用临时数据库复验RR1/RR3，记录请求、当前GET、新键、重放响应与前后表计数。
- seed_video经拆分后重跑相关44题/视频种子流程，核对帧数、时间与服务端引用关系不变。
- 知识题不改期望，不宣称60/60；如未重跑知识/断外网/备份脚本，明确引用前轮证据，
  不把旧日志时间或旧SHA冒称本轮全量实测；交付核验需要更新的证据照常补齐。
- 业务实现修改后按正常流程重建交付容器，核对迁移、数据和媒体保持；不启动/停止查寝来凑并存证据。
- 更新完成度报告和关闭表，纠正本轮独立检查实际263通过/1失败与自报264全过的差异，给出修复后真实命令结果。

阶段7保持待审核；通过后先7A，再8。不更换AI方案、不增加外部API或硬件开发。
