import { AppState } from '../../shared/state/AppState';
import { MonitorRecord, Point } from '../../data/models/Monitoring';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { PlayButton } from '../../shared/playful/PlayButton';
import { EmptyBuddy } from '../../shared/playful/EmptyBuddy';
import { controlHeight } from '../../shared/layout/ReadingLayout';
import { label, reading, timeText, freshness } from '../../shared/format/display';
import {
  TrendField,
  TrendPoint,
  TrendRuleInfo,
  TrendSummary,
  buildTrendPoints,
  dailyAveragePoints,
  filterTrendRecords,
  formatTrend,
  splitTrendLine,
  trendBaseline,
  trendFields,
  trendSummary,
  trendThresholds,
} from '../../core/monitoring/Trend';
import { TrendChart, TrendChartData } from './TrendChart';

@Component
export struct TrendPage {
  @Prop state: AppState;
  @Prop pointId: string;
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  onLoad: (pointId: string) => Promise<MonitorRecord[] | null> = async () => null;
  @State currentId: string = '';
  @State days: number = 7;
  @State daily: boolean = true;
  @State records: MonitorRecord[] = [];
  @State loading: boolean = false;
  @State loaded: boolean = false;
  @State message: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.currentId = this.initialPoint();
    this.load();
  }

  aboutToDisappear(): void {
    this.generation += 1;
  }

  private sensorPoints(): Point[] {
    return this.state.workspace.points.filter((row: Point) =>
      row.status === 'active' && trendFields(row.type).length > 0);
  }

  private initialPoint(): string {
    const requested = this.sensorPoints().find((row: Point) => row.id === this.pointId);
    return requested?.id ?? this.sensorPoints()[0]?.id ?? '';
  }

  private point(): Point | undefined {
    return this.state.workspace.points.find((row: Point) => row.id === this.currentId && row.status === 'active');
  }

  private async load(): Promise<void> {
    if (this.currentId === '') {
      this.records = [];
      this.loaded = true;
      return;
    }
    const generation = ++this.generation;
    this.loading = true;
    this.loaded = false;
    this.records = [];
    this.message = '';
    try {
      const rows = await this.onLoad(this.currentId);
      if (generation !== this.generation) return;
      if (rows === null) throw new Error('趋势暂不可用，请重新读取。');
      this.records = rows;
      this.loaded = true;
    } catch (cause) {
      if (generation !== this.generation) return;
      this.message = cause instanceof Error ? cause.message : '趋势读取失败，请重试。';
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private selectPoint(id: string): void {
    if (id === this.currentId) return;
    this.currentId = id;
    this.days = 7;
    this.load();
  }

  private visibleRecords(): MonitorRecord[] {
    return filterTrendRecords(this.records, this.days, Date.now());
  }

  private chartRecords(): MonitorRecord[] {
    return this.visibleRecords().filter((row: MonitorRecord) => row.quality !== 'invalid');
  }

  private fields(): TrendField[] {
    return trendFields(this.point()?.type ?? '');
  }

  private fieldPoints(field: TrendField): TrendPoint[] {
    return buildTrendPoints(this.chartRecords(), field);
  }

  private displayPoints(field: TrendField): TrendPoint[] {
    const raw = this.fieldPoints(field);
    return this.daily ? dailyAveragePoints(raw) : raw;
  }

  private rawRangeText(field: TrendField): string {
    const summary = trendSummary(this.fieldPoints(field));
    if (summary.count === 0) return '';
    return `极值 ${this.formatValue(summary.min, field)}–${this.formatValue(summary.max, field)}`;
  }

  private ruleOf(field: TrendField): TrendRuleInfo {
    return trendThresholds(this.chartRecords(), this.point()?.type ?? '', field.key);
  }

  private chartData(field: TrendField): TrendChartData {
    const rows = this.chartRecords();
    const points = this.displayPoints(field);
    const latest = rows.length > 0 ? rows[rows.length - 1] : undefined;
    return {
      points,
      segments: splitTrendLine(points),
      thresholds: this.ruleOf(field).thresholds,
      baseline: trendBaseline(latest, field.key),
      unit: field.unit,
      digits: field.digits,
    };
  }

  private latestRecord(): MonitorRecord | undefined {
    const rows = this.chartRecords();
    return rows.length > 0 ? rows[rows.length - 1] : undefined;
  }

  private currentReading(): string {
    return reading(this.latestRecord(), this.point()?.type ?? '');
  }

  private formatValue(value: number | null, field: TrendField): string {
    return formatTrend(value, field.digits);
  }

  private summaryText(field: TrendField): string {
    const summary: TrendSummary = trendSummary(this.displayPoints(field));
    if (summary.count === 0) return '所选范围内没有可用数值。';
    const change = summary.change === null ? '—' :
      `${summary.change > 0 ? '+' : ''}${this.formatValue(summary.change, field)}`;
    return `最新 ${this.formatValue(summary.latest, field)}${field.unit}｜范围 ${this.formatValue(summary.min, field)}–${this.formatValue(summary.max, field)}｜较首条 ${change}${field.unit}`;
  }

  private thresholdText(field: TrendField): string {
    const info = this.ruleOf(field);
    const thresholds = info.thresholds;
    if (thresholds === null) return '';
    const parts: string[] = [];
    if (thresholds.yellow !== null) parts.push(`黄 ${this.formatValue(thresholds.yellow, field)}`);
    if (thresholds.orange !== null) parts.push(`橙 ${this.formatValue(thresholds.orange, field)}`);
    if (thresholds.red !== null) parts.push(`红 ${this.formatValue(thresholds.red, field)}`);
    if (parts.length === 0) return '';
    return `阈值${info.version === '' ? '' : ` ${info.version}`}｜${parts.join(' / ')} ${field.unit}`;
  }

  private recordCountText(): string {
    const rows = this.visibleRecords();
    let valid = 0;
    let suspect = 0;
    let invalid = 0;
    for (const row of rows) {
      if (row.quality === 'valid') valid += 1;
      else if (row.quality === 'invalid') invalid += 1;
      else suspect += 1;
    }
    return `${rows.length} 条采样 · 有效 ${valid} · 存疑 ${suspect} · 无效 ${invalid}`;
  }

  private stateColor(): string {
    const state = this.latestRecord()?.assessment?.state ?? '';
    if (state === 'red') return Theme.danger;
    if (state === 'orange' || state === 'yellow') return Theme.warning;
    if (state === 'recovering') return Theme.brand;
    return Theme.secondary;
  }

  @Builder
  selector() {
    Select(this.sensorPoints().map((row: Point): SelectOption => ({ value: `${row.code} ${row.name}` })))
      .selected(Math.max(0, this.sensorPoints().findIndex((row: Point) => row.id === this.currentId)))
      .value(this.point()?.code ?? '选择测点')
      .onSelect((index: number) => {
        const row = this.sensorPoints()[index];
        if (row) this.selectPoint(row.id);
      })
      .height(controlHeight(50, this.textScale))
      .width('100%')
      .font({ size: 16 })
      .backgroundColor(Theme.surface)
      .id('trend-point')
      .accessibilityText('选择趋势测点');
  }

  @Builder
  rangeButtons() {
    Row({ space: 10 }) {
      PlayButton({ title: '近7天', secondary: this.days !== 7, controlId: 'trend-week',
        onAction: () => { this.days = 7; } }).layoutWeight(1);
      PlayButton({ title: '近30天', secondary: this.days !== 30, controlId: 'trend-month',
        onAction: () => { this.days = 30; } }).layoutWeight(1);
    }.width('100%');
  }

  @Builder
  averageToggle() {
    Row({ space: 12 }) {
      Column({ space: 3 }) {
        Text('日均趋势').fontSize(16).fontWeight(FontWeight.Medium).fontColor(Theme.text);
        Text(this.daily ? '同一天多条采样取平均，曲线更直观；最近记录仍是原始值' : '按每条采样显示原始点')
          .fontSize(12).fontColor(Theme.secondary);
      }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      Toggle({ type: ToggleType.Switch, isOn: this.daily })
        .selectedColor(Theme.brand)
        .onChange((enabled: boolean) => { this.daily = enabled; })
        .id('trend-average')
        .accessibilityText('日均趋势');
    }.width('100%');
  }

  @Builder
  summaryCard() {
    AppCard({ color: '#E5F2E9' }) {
      Row({ space: 8 }) {
        Text(this.point()?.code ?? '').fontSize(13).fontColor(Theme.brand).layoutWeight(1);
        Text(this.days === 7 ? '近 7 天' : '近 30 天').fontSize(12).fontColor(Theme.secondary);
      }.width('100%');
      Text(this.point()?.name ?? '').fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(this.currentReading()).fontSize(25).fontColor(Theme.text);
      if (this.latestRecord()) {
        Text(`采样 ${timeText(this.latestRecord()!.sampleTime)} · ${freshness(this.latestRecord())}`)
          .fontSize(13).fontColor(Theme.warning);
        Text(`最近判定：${label(this.latestRecord()!.assessment?.state ?? 'unknown')}`)
          .fontSize(13).fontColor(this.stateColor());
      } else {
        Text('所选范围内暂无记录，不判为正常。').fontSize(14).fontColor(Theme.secondary);
      }
      Text(this.recordCountText()).fontSize(12).fontColor(Theme.secondary);
      Text('历史采样展示，不是实时监测；预警仍以事件与规则引擎为准。').fontSize(12).fontColor(Theme.secondary);
    }
  }

  @Builder
  chartCard(field: TrendField) {
    AppCard() {
      Row({ space: 8 }) {
        Column({ space: 4 }) {
          Text(field.label).fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(this.daily ? `日均 · ${field.unit} · 原始 ${this.fieldPoints(field).length} 条（${this.rawRangeText(field)}）`
            : `原始 · ${field.unit} · 按采样时间`).fontSize(12).fontColor(Theme.secondary);
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        Text(`${this.displayPoints(field).length} 点`).fontSize(12).fontColor(Theme.brand);
      }.width('100%');
      if (this.displayPoints(field).length === 0) {
        Text('该指标在所选范围内没有可用数值。').fontSize(14).fontColor(Theme.secondary);
      } else {
        TrendChart({ data: this.chartData(field) });
        Text(this.summaryText(field)).fontSize(13).fontColor(Theme.secondary);
        if (this.thresholdText(field) !== '') {
          Text(this.thresholdText(field)).fontSize(12).fontColor(Theme.warning);
        }
      }
    }
  }

  @Builder
  recordRow(record: MonitorRecord) {
    Row({ space: 10 }) {
      Column({ space: 3 }) {
        Text(timeText(record.sampleTime)).fontSize(13).fontColor(Theme.text);
        Text(`${label(record.quality)} · ${label(record.source)}${record.isBackfill ? ' · 历史补录' : ''}`)
          .fontSize(11).fontColor(record.quality === 'valid' ? Theme.secondary : Theme.danger);
      }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      Text(reading(record, this.point()?.type ?? '')).fontSize(15).fontColor(Theme.brand);
    }.width('100%').padding(12).backgroundColor(Theme.surface)
      .border({ width: 1, color: Theme.line, radius: 14 });
  }

  private recentRows(): MonitorRecord[] {
    const rows = this.chartRecords();
    const start = Math.max(0, rows.length - 5);
    return rows.slice(start).slice().reverse();
  }

  @Builder
  recentRecords() {
    Text('最近记录').fontSize(21).fontWeight(FontWeight.Medium).fontColor(Theme.text);
    ForEach(this.recentRows(), (record: MonitorRecord) => { this.recordRow(record); }, (record: MonitorRecord) => record.id);
  }

  @Builder
  notes() {
    Text('看图口径').fontSize(19).fontWeight(FontWeight.Medium).fontColor(Theme.text);
    Text('日均趋势把上海时区同一天的多条采样取平均；关闭后显示每条原始采样。最近记录始终是原始值。')
      .fontSize(13).fontColor(Theme.secondary);
    Text('曲线只读取服务端监测记录，不重算分级；黄/橙/红虚线来自记录里的规则快照。')
      .fontSize(13).fontColor(Theme.secondary);
    Text('无效质量记录不画入曲线；重复修订与历史补录保留来源，不伪装成实时数据。')
      .fontSize(13).fontColor(Theme.secondary);
    Text('影像、趋势与监测记录都不自动生成正式结构预警。').fontSize(13).fontColor(Theme.secondary);
  }

  @Builder
  errorCard() {
    AppCard({ color: '#FFF8E8' }) {
      Text(this.message).fontSize(15).fontColor(Theme.danger);
      PlayButton({ title: '重新读取趋势', secondary: true, controlId: 'trend-retry', onAction: () => this.load() });
    }
  }

  build() {
    PageStage() {
      PageHeading({ title: '把变化，连成一条线', subtitle: '单测点历史采样 · 按指标分图', kicker: 'TREND / 监测趋势' });
      if (this.state.mode !== 'ready') {
        AppCard({ color: '#FFF8E8' }) {
          Text('先连上校园服务，才能查看趋势。').fontSize(17).fontColor(Theme.text);
          Text('到「我的」设置连接后，再回到监测入口。').fontSize(13).fontColor(Theme.secondary);
        }
      } else if (this.sensorPoints().length === 0) {
        EmptyBuddy({ title: '当前范围没有传感器测点', note: '人工检查点没有数值趋势；请切换身份或监测范围。' });
      } else {
        this.selector();
        this.rangeButtons();
        this.averageToggle();
        if (this.loading) {
          Row({ space: 10 }) {
            LoadingProgress().width(28).height(28).color(Theme.brand);
            Text('正在读取趋势…').fontSize(15).fontColor(Theme.brand);
          }.width('100%');
        }
        if (this.message !== '') this.errorCard();
        if (this.loaded && !this.loading && this.point()) {
          this.summaryCard();
          if (this.fields().length === 0) {
            EmptyBuddy({ title: '这个测点没有数值趋势', note: '人工检查点请在巡检手账查看检查记录。' });
          } else if (this.visibleRecords().length === 0) {
            EmptyBuddy({ title: '所选范围没有采样记录', note: '没有记录不代表监测正常；请切换时间范围或核对服务端数据。' });
          } else {
            if (this.chartRecords().length === 0) {
              AppCard({ color: '#FFF8E8' }) {
                Text('所选范围的记录质量均无效，暂不绘制趋势。').fontSize(15).fontColor(Theme.warning);
              }
            } else {
              ForEach(this.fields(), (field: TrendField) => { this.chartCard(field); },
                (field: TrendField) => `${this.currentId}-${this.days}-${this.daily ? 'avg' : 'raw'}-${field.key}`);
              this.recentRecords();
            }
            this.notes();
          }
        } else if (this.loaded && !this.loading) {
          AppCard({ color: '#FFF8E8' }) {
            Text('这个测点当前不可查看').fontSize(17).fontColor(Theme.text);
            Text('连接、身份或档案已变化，请返回后重新读取。').fontSize(13).fontColor(Theme.secondary);
          }
        }
      }
    }
  }
}
