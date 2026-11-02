import { Theme } from '../../shared/theme/Theme';
import { TrendPoint, TrendThresholds, formatTrend } from '../../core/monitoring/Trend';

export interface TrendChartData {
  points: TrendPoint[];
  segments: TrendPoint[][];
  thresholds: TrendThresholds | null;
  baseline: number | null;
  unit: string;
  digits: number;
}

interface AxisRange {
  min: number;
  max: number;
}

interface ChartGeometry {
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  range: AxisRange;
}

@Component
export struct TrendChart {
  @Prop data: TrendChartData;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private context: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);

  private axisRange(): AxisRange {
    let min = this.data.points[0].value;
    let max = this.data.points[0].value;
    for (const point of this.data.points) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
    if (this.data.baseline !== null) {
      min = Math.min(min, this.data.baseline);
      max = Math.max(max, this.data.baseline);
    }
    if (this.data.thresholds !== null) {
      const values: (number | null)[] = [
        this.data.thresholds.yellow,
        this.data.thresholds.orange,
        this.data.thresholds.red,
      ];
      for (const value of values) {
        if (value === null) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    const span = max - min;
    const pad = span > 0 ? span * 0.12 : Math.max(Math.abs(max) * 0.05, 0.01);
    return { min: min - pad, max: max + pad };
  }

  private xOf(time: number, geometry: ChartGeometry): number {
    const first = this.data.points[0].t;
    const last = this.data.points[this.data.points.length - 1].t;
    if (last === first) return geometry.left + geometry.plotWidth / 2;
    return geometry.left + (time - first) / (last - first) * geometry.plotWidth;
  }

  private yOf(value: number, geometry: ChartGeometry): number {
    if (geometry.range.max === geometry.range.min) return geometry.top + geometry.plotHeight / 2;
    return geometry.top + (geometry.range.max - value) / (geometry.range.max - geometry.range.min) * geometry.plotHeight;
  }

  private shortDate(time: number): string {
    const date = new Date(time + 8 * 3600000);
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return `${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
  }

  private drawGrid(geometry: ChartGeometry): void {
    const ctx = this.context;
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < 3; index += 1) {
      const y = geometry.top + geometry.plotHeight * index / 2;
      ctx.strokeStyle = '#E4EEE6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(geometry.left, y);
      ctx.lineTo(geometry.left + geometry.plotWidth, y);
      ctx.stroke();
      const value = geometry.range.max - (geometry.range.max - geometry.range.min) * index / 2;
      ctx.fillStyle = Theme.secondary;
      ctx.fillText(formatTrend(value, this.data.digits), geometry.left - 6, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = Theme.secondary;
    ctx.fillText(this.shortDate(this.data.points[0].t), geometry.left, geometry.top + geometry.plotHeight + 8);
    ctx.textAlign = 'right';
    ctx.fillText(this.shortDate(this.data.points[this.data.points.length - 1].t),
      geometry.left + geometry.plotWidth, geometry.top + geometry.plotHeight + 8);
  }

  private drawReferenceLine(value: number, color: string, label: string, geometry: ChartGeometry): void {
    const ctx = this.context;
    const y = this.yOf(value, geometry);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(geometry.left, y);
    ctx.lineTo(geometry.left + geometry.plotWidth, y);
    ctx.stroke();
    ctx.restore();
    ctx.font = '22px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, geometry.left + 4, y - 2);
  }

  private drawLine(segment: TrendPoint[], geometry: ChartGeometry): void {
    if (segment.length === 0) return;
    const ctx = this.context;
    if (segment.length > 1) {
      const gradient = ctx.createLinearGradient(0, geometry.top, 0, geometry.top + geometry.plotHeight);
      gradient.addColorStop(0, '#8CCFC9');
      gradient.addColorStop(1, '#F8F8F0');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(this.xOf(segment[0].t, geometry), this.yOf(segment[0].value, geometry));
      for (let index = 1; index < segment.length; index += 1) {
        ctx.lineTo(this.xOf(segment[index].t, geometry), this.yOf(segment[index].value, geometry));
      }
      ctx.lineTo(this.xOf(segment[segment.length - 1].t, geometry), geometry.top + geometry.plotHeight);
      ctx.lineTo(this.xOf(segment[0].t, geometry), geometry.top + geometry.plotHeight);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = Theme.brand;
    ctx.lineWidth = 3.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let index = 0; index < segment.length; index += 1) {
      const x = this.xOf(segment[index].t, geometry);
      const y = this.yOf(segment[index].value, geometry);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (segment.length <= 36) {
      ctx.fillStyle = Theme.surface;
      ctx.strokeStyle = Theme.brand;
      ctx.lineWidth = 2.6;
      for (const point of segment) {
        ctx.beginPath();
        ctx.arc(this.xOf(point.t, geometry), this.yOf(point.value, geometry), 3.2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    const last = segment[segment.length - 1];
    ctx.fillStyle = Theme.brand;
    ctx.beginPath();
    ctx.arc(this.xOf(last.t, geometry), this.yOf(last.value, geometry), 5, 0, 2 * Math.PI);
    ctx.fill();
  }

  private draw(): void {
    const ctx = this.context;
    const width = ctx.width;
    const height = ctx.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 80 || height < 60) return;
    ctx.clearRect(0, 0, width, height);
    if (this.data.points.length === 0) return;
    const left = 80;
    const right = 18;
    const top = 28;
    const bottom = 42;
    const plotWidth = Math.max(10, width - left - right);
    const plotHeight = Math.max(10, height - top - bottom);
    const geometry: ChartGeometry = { left, top, plotWidth, plotHeight, range: this.axisRange() };
    this.drawGrid(geometry);
    if (this.data.baseline !== null) {
      this.drawReferenceLine(this.data.baseline, '#8A9A91', '基准', geometry);
    }
    if (this.data.thresholds !== null) {
      const thresholds = this.data.thresholds;
      if (thresholds.yellow !== null) {
        this.drawReferenceLine(thresholds.yellow, '#C79A12', '黄', geometry);
      }
      if (thresholds.orange !== null) {
        this.drawReferenceLine(thresholds.orange, '#C86C18', '橙', geometry);
      }
      if (thresholds.red !== null) {
        this.drawReferenceLine(thresholds.red, Theme.danger, '红', geometry);
      }
    }
    for (const segment of this.data.segments) {
      this.drawLine(segment, geometry);
    }
  }

  build() {
    Canvas(this.context)
      .width('100%')
      .height(230)
      .onReady(() => { this.draw(); })
      .onAreaChange(() => { this.draw(); })
      .accessibilityText(`${this.data.unit}趋势图，共 ${this.data.points.length} 个数值点`);
  }
}
