/**
 * ECharts 按需引入（只注册驾驶舱三张图用到的图表与组件，控制构建体积）。
 *
 * 新增图表类型时在本文件补注册，不要在组件里 `import * as echarts` ——
 * 那会把整个 echarts 打进包里（体积提示会立刻出现）。
 * 用法与官方 handbook 的 "Import ECharts on demand" 一致。
 */
import { use, type ComposeOption } from 'echarts/core'
import { BarChart, LineChart, PieChart, type BarSeriesOption, type LineSeriesOption, type PieSeriesOption } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkLineComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer])

/** 本文件注册过的能力对应的 option 类型。 */
export type PanelOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
>

/** 三个等级的颜色与 `src/styles/tokens.css` 的 --st-yellow / --st-orange / --st-red 一致。 */
export const LEVEL_COLORS = { yellow: '#96760c', orange: '#c96a06', red: '#c0362c' } as const

export const LEVEL_NAMES = { yellow: '黄', orange: '橙', red: '红' } as const

/** 三张图共用的内边距，保证纵轴名称与图例不互相压。 */
export const PANEL_GRID = { left: 8, right: 18, top: 34, bottom: 6, containLabel: true }
