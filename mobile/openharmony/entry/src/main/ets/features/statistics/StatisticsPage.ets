import { AppState } from '../../shared/state/AppState';
import { InsightQuery, MobileInsights, InsightDay } from '../../data/models/online/Insights';
import { Theme } from '../../shared/theme/Theme';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { ScopePicker } from '../monitoring/ScopePicker';
import { CountCard } from './CountCard';

@Component
export struct StatisticsPage {
  @Prop state: AppState;
  @State period: string = 'week';
  @State buildingId: string = '';
  @State data: MobileInsights | null = null;
  @State loading: boolean = false;
  @State message: string = '';
  private generation: number = 0;
  onLoad: (query: InsightQuery) => Promise<MobileInsights | null> = async () => null;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation++; }
  async load(): Promise<void> {
    const generation = ++this.generation; this.loading = true; this.data = null; this.message = '';
    try {
      const result = await this.onLoad({ period: this.period, buildingId: this.buildingId });
      if (generation !== this.generation) return;
      if (!result || !Array.isArray(result.trend)) throw new Error('统计暂不可用，请重试。');
      this.data = result;
    } catch (cause) { if (generation === this.generation) this.message = (cause as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  @Builder
  totals() {
    AppCard({ color: Theme.soft }) {
      Text(`${this.data!.startDate} — ${this.data!.endDate}`).fontSize(15).fontColor(Theme.brand);
      Text(`触发 ${this.data!.totalEvents} 次预警`).fontSize(28).fontWeight(FontWeight.Bold).fontColor(Theme.text).id('stats-event-total');
      Text(`其中当前未关闭 ${this.data!.openEvents} 次 · 采样 ${this.data!.recordCount} 条`).fontSize(15).fontColor(Theme.secondary);
      Text('按首次触发日期计事件数；上海时区。模拟数据，来自当前授权数据库。').fontSize(12).fontColor(Theme.secondary);
    }
  }
  @Builder
  trend() {
    AppCard({ color: Theme.sky }) {
      Text('每天的守护足迹').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Scroll() {
        Row({ space: 10 }) {
          ForEach(this.data!.trend, (row: InsightDay) => {
            Column({ space: 8 }) {
              Text(String(row.count)).fontSize(14).fontColor(Theme.brand);
              Column().width(23).height(6 + 90 * row.count / Math.max(1, ...this.data!.trend.map((day) => day.count)))
                .backgroundColor(Theme.brand).borderRadius(10);
              Text(row.date.slice(5)).fontSize(12).fontColor(Theme.secondary);
            }.justifyContent(FlexAlign.End).constraintSize({ minHeight: 150 }).accessibilityGroup(true).accessibilityText(`${row.date}，预警${row.count}次`);
          }, (row: InsightDay) => row.date);
        }
      }.scrollable(ScrollDirection.Horizontal).width('100%').scrollBar(BarState.Off);
    }
  }
  build() {
    PageStage() {
      PageHeading({ title: '每一份守护，都有记录', subtitle: '周月统计 · 当前授权范围', kicker: 'INSIGHTS / 守护手账' });
      ScopePicker({ workspace: this.state.workspace, buildingId: this.buildingId, showFloor: false,
        onBuilding: (id) => { this.buildingId = id; this.load(); } });
      Row({ space: 12 }) {
        PlayButton({ title: '近7天', secondary: this.period !== 'week', controlId: 'stats-week',
          onAction: () => { this.period = 'week'; this.load(); } }).layoutWeight(1);
        PlayButton({ title: '近30天', secondary: this.period !== 'month', controlId: 'stats-month',
          onAction: () => { this.period = 'month'; this.load(); } }).layoutWeight(1);
      }.width('100%');
      if (this.loading) { Text('正在读取统计…').fontSize(16).fontColor(Theme.brand); }
      if (this.message) { Text(this.message).fontSize(16).fontColor(Theme.danger); }
      if (this.data) {
        this.totals(); this.trend();
        CountCard({ title: '楼栋预警频次', rows: this.data.byBuilding, controlId: 'stats-building' });
        CountCard({ title: '测点预警频次', rows: this.data.byPoint, controlId: 'stats-point' });
        CountCard({ title: '在用传感器测点类型', rows: this.data.sensorTypes, types: true, controlId: 'stats-types' });
      }
      PlayButton({ title: '刷新这份统计', secondary: true, available: !this.loading, controlId: 'stats-refresh', onAction: () => this.load() });
    }
  }
}
