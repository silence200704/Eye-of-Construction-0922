# 筑瞳全业务与双端联动总图

2026-11-01，按当前代码与角色规则整理。所有分区组成同一张总图，Web/App入口分别标识，共用状态链与编号引用。

- `zhutong-business-flow.svg`：可放大查看的矢量总图，优先打开此版本。
- `zhutong-business-flow.png`：单张高清长图，适合发送和插入文档。
- `section-source.md`：11个分区的Mermaid源图，包含跨区接续端口。
- `zhutong-business-flow.mmd`：全部业务与跨区连线的单一Mermaid源图。
- `build_poster.py`：提取分区及合成总图；中间渲染结果只写`backend/.runtime-business-diagram`。

蓝色标Web，绿色标App，灰色标共用业务；角色、按钮/入口、状态与完成条件位于节点内。分区⑤→⑥→⑦是问题维修主闭环，⑧为独立预警关闭，⑩为双向接力与离线同步。

覆盖：身份、档案/基准/规则、录入/修订/CSV、监测趋势、巡检到点/清单/异常、保养、六类审核、建单/派工/维修/退回/验收、三类复查、通知/预警、小瞳/影像/地图/统计、双端刷新、持久离线与冲突、专用集演示及复位边界。

按代码核对的现状差异：

1. **Web独立手工建单、无关联问题工单详情入口待补。** `IssuePoolView`主要以问题打开工单，`resolveWorkOrderTarget`明确拒绝无`issueId`的工单。当前此类工单在App办理；不能把共用API当成已有Web按钮。问题来源工单可双端接续。
2. **预警转关联问题只允许safety身份。** 后端`operations/field/issues.py`对`sensor`来源单独限制；原身份操作表已纠正。五身份独立人工上报与此不同。
3. 服务端模式备份/恢复按维护工具办理；不要把旧浏览器本地JSON备份入口当作服务端数据库恢复。

此图说明业务与操作路径，不代替原生按钮、真机、权限与故障场景验收。当前软件限制沿用0.9完成报告。

维护：用`python build_poster.py prepare`提取分区，再用Mermaid CLI（本次12.0.0、Chrome）将中间mmd渲染为同名svg，最后执行`python build_poster.py compose`。PNG为Chrome对合成SVG的完整尺寸截图；未使用生成式图片工具重写文字或业务关系。
