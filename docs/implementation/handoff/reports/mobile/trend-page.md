# 原生 App 监测趋势完成报告

2026-10-31。新增范围仅限 OpenHarmony 原生 App；Web 端趋势页未改动。

## 做了什么

1. 新增原生「监测趋势」页，从两个位置进入：
   - 监测页「查看监测趋势」按钮；
   - 测点详情「查看这处测点的监测趋势」按钮；
   - 小瞳回答里的 `point_trend` 链接也改为直接打开趋势页。
2. 单测点查看近 7 天 / 近 30 天采样，按指标分图：
   - 裂缝：裂缝宽度；
   - 倾角：X 轴、Y 轴；
   - 振动：加速度有效值、峰值；
   - 温湿度：温度、相对湿度；
   - 人工检查点不提供数值趋势。
3. 图表展示服务端记录曲线、最近记录，以及记录规则快照中的基准线和黄/橙/红三级阈值线；阈值按裂缝/倾角的相对基准换算成绝对值，振动按绝对判定。按采样间隔断开长缺口，避免一条线跨越没有采样的时段。
4. 为了在手机上更直观，默认按上海时区把同一天的多条采样合成一个日均点；页面提供「日均趋势」开关，可切回每条原始采样。最近记录始终显示原始值，图表副标题同时保留原始极值范围，不把日均值冒充成实际采样。
4. 数据读取复用现有 `/datasets/demo-main/records?pointId=...&limit=5000`，不增加后端接口；读取前后复核服务端身份和数据集 epoch，身份切换/授权变化时旧响应不能落到页面。
5. 明确数据边界：
   - 历史采样标为“非实时”，不替代监测与预警判定；
   - 质量 `invalid` 的记录不画入曲线，页面仍显示采样总数与有效/存疑/无效计数；
   - 页面提示趋势不自动生成正式结构预警。

## 验证

- Node 原生回归：**134 项通过**（含新增 `tests/mobile/online/trend.test.mjs` 7 项：指标字段、时间过滤、日均分组、汇总与断线、阈值换算、测点/epoch 校验、身份切换后的迟到响应）。
- 结构门禁：`node scripts/mobile/verification/structure.mjs` 通过，`violations=[]`；最大文件为 `TrendPage.ets`，378 行。
- SDK 构建：`hvigorw assembleApp --no-daemon` **BUILD SUCCESSFUL**。
- 模拟器：签名 HAP 安装并启动 `org.zhutong.mobile`，实测：
  - 监测页进入趋势，裂缝 7 天原始 20 条，日均后 8 个点；切 30 天原始 93 条，日均后 31 个点；
  - 关闭「日均趋势」后曲线恢复每条原始采样，7 天显示 20 点；
  - 倾角 21 条原始、8 个日均点，显示 X/Y 两张图和 0.10/0.20/0.30° 阈值；
  - 温湿度 26 条原始、8 个日均点，显示温度/相对湿度两张图，环境规则无三级阈值时只画数据；
  - 从测点详情进入趋势成功，测点自动带出；
  - 截图：
    - [7 天裂缝日均](C:/Users/Lenovo/Desktop/demo/docs/implementation/evidence/stage-library-3d/trend-daily.png)
    - [30 天裂缝日均](C:/Users/Lenovo/Desktop/demo/docs/implementation/evidence/stage-library-3d/trend-daily-30d.png)
    - [倾角日均 X/Y](C:/Users/Lenovo/Desktop/demo/docs/implementation/evidence/stage-library-3d/trend-daily-tilt.png)
    - [温湿度日均](C:/Users/Lenovo/Desktop/demo/docs/implementation/evidence/stage-library-3d/trend-daily-temp.png)

## 文件

- `mobile/openharmony/entry/src/main/ets/features/trend/TrendPage.ets`
- `mobile/openharmony/entry/src/main/ets/features/trend/TrendChart.ets`
- `mobile/openharmony/entry/src/main/ets/core/monitoring/Trend.ets`
- `mobile/openharmony/entry/src/main/ets/core/identity/WorkspaceController.ets`
- `mobile/openharmony/entry/src/main/ets/data/models/Monitoring.ets`
- `mobile/openharmony/entry/src/main/ets/pages/Index.ets`
- `mobile/openharmony/entry/src/main/ets/features/monitoring/MonitoringPage.ets`
- `mobile/openharmony/entry/src/main/ets/features/monitoring/PointDetail.ets`
- `tests/mobile/online/trend.test.mjs`
- `mobile/openharmony/README.md`

## 边界

这次是移动端单测点趋势查看，不是电脑端完整趋势分析：未做双测点对比、自定义起止日期、修订替代分组、逐点事件节点和规则换版分段；移动端一次读取单测点最多 5000 条记录并在本地按 7/30 天筛选。真实设备、宽窗和读屏未在本次范围内重新验收。
