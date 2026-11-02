import { controlHeight } from '../../shared/layout/ReadingLayout';
import { AppState } from '../../shared/state/AppState';
import { Point, AlarmEvent } from '../../data/models/Monitoring';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { ConnectionState } from '../../shared/components/ConnectionState';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { PlayButton } from '../../shared/playful/PlayButton';
import { activePoints, latestRecord, reading, label, pointLocation, timeText, freshness, visibleEvents } from '../../shared/format/display';
import { filterPoints, filterEvents } from '../../core/monitoring/Selectors';
import { ScopePicker } from './ScopePicker';

@Component
export struct MonitoringPage {
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  @Prop state: AppState;
  @State type: string = 'all';
  @State history: boolean = false;
  @State expandedPoint: string = '';
  @State buildingId: string = '';
  @State floorId: string = '';
  @State page: number = 0;
  @StorageLink('zhutong.motion') motion: boolean = true;
  onOpen: (id: string) => void = () => {};
  onEvent: (id: string) => void = () => {};
  onStats: () => void = () => {};
  onTrend: (id: string) => void = () => {};
  onSettings: () => void = () => {};
  onRefresh: () => void = () => {};

  points(): Point[] {
    return filterPoints(this.state.workspace.points, { buildingId: this.buildingId, floorId: this.floorId, type: this.type });
  }

  firstTrendPoint(): string {
    const row = this.points().find((point: Point) => ['crack', 'tilt', 'vibration', 'temp_humidity'].includes(point.type));
    return row?.id ?? '';
  }

  events(): AlarmEvent[] {
    return filterEvents(this.state.workspace, { buildingId: this.buildingId, floorId: this.floorId, type: this.type }, this.history);
  }

  toggleReading(pointId: string): void {
    this.getUIContext().animateTo({ duration: this.motion ? 180 : 0, curve: Curve.EaseOut },
      () => { this.expandedPoint = this.expandedPoint === pointId ? '' : pointId; });
  }

  @Builder
  readingNotes(point: Point) {
    Text(`采样 ${timeText(latestRecord(this.state.workspace, point.id)?.sampleTime)}`)
      .fontSize(12).fontColor(Theme.secondary);
    Text(`质量：${label(latestRecord(this.state.workspace, point.id)?.quality ?? 'unknown')} · ${label(latestRecord(this.state.workspace, point.id)?.source ?? 'unknown')}`)
      .fontSize(12).fontColor(Theme.secondary);
    Text('打开测点可核对最近记录、规则版本和设备台账。').fontSize(12).fontColor(Theme.brand);
  }

  @Builder
  filterButton(key: string, title: string) {
    Button(title).height(controlHeight(48, this.textScale)).padding({ left: 16, right: 16 })
      .backgroundColor(this.type === key ? Theme.brand : Theme.surface)
      .fontColor(this.type === key ? Color.White : Theme.text)
      .border({ width: 1.2, color: this.type === key ? Theme.ink : Theme.line })
      .shadow({ radius: 0, offsetY: this.type === key ? 3 : 0, color: '#C3D8D1' })
      .onClick(() => { this.type = key; this.page = 0; }).id(`filter-${key}`);
  }

  @Builder
  pointCard(point: Point) {
    AppCard({ color: point.type === 'tilt' ? '#F1F7FE' : point.type === 'vibration' ? '#FFF8E6' : '#FFFFFF' }) {
      Row({ space: 9 }) {
        Image($rawfile('playful/icons/shield.svg')).width(43).height(43).padding(9)
          .backgroundColor(Theme.soft).borderRadius(16).accessibilityLevel('no');
        Text(`${label(point.type)} · ${point.code}`).fontSize(12).fontColor(Theme.brand).layoutWeight(1);
      }.width('100%');
      Text(point.name).fontSize(20).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(pointLocation(this.state.workspace, point)).fontSize(13).fontColor(Theme.secondary);
      Text(reading(latestRecord(this.state.workspace, point.id), point.type)).fontSize(23).fontColor(Theme.text);
      Text(`${freshness(latestRecord(this.state.workspace, point.id))} · 硬件输入模拟`)
        .fontSize(12).fontColor(Theme.warning);
      PlayButton({ title: this.expandedPoint === point.id ? '收起读数说明 −' : '这条读数怎么看？＋', secondary: true,
        onAction: () => this.toggleReading(point.id), controlId: `reading-note-${point.id}` });
      if (this.expandedPoint === point.id) { this.readingNotes(point); }
      PlayButton({ title: '打开这处测点', secondary: true, onAction: () => this.onOpen(point.id), controlId: `point-${point.id}` });
    }
  }

  @Builder
  alarmCard(event: AlarmEvent) {
    AppCard({ color: event.level === 'red' ? '#FFF0E9' : '#FFFAEB' }) {
      Text(event.eventNo).fontSize(15).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(`${label(event.level)} · ${event.status === 'pending' ? '待确认' : label(event.status)}`)
        .fontSize(16).fontColor(event.level === 'red' ? Theme.danger : Theme.warning);
      Text(this.state.workspace.points.find((point) => point.id === event.pointId)?.name ?? '关联测点')
        .fontSize(14).fontColor(Theme.text);
      Text(`最近触发 ${timeText(event.lastTriggerAt)}`).fontSize(12).fontColor(Theme.secondary);
      PlayButton({ title: '打开预警，继续处置', secondary: true, controlId: `alarm-${event.id}`, onAction: () => this.onEvent(event.id) });
    }
  }

  @Builder
  content() {
    ScopePicker({ workspace: this.state.workspace, buildingId: this.buildingId, floorId: this.floorId,
      onBuilding: (id) => { this.buildingId = id; this.floorId = ''; this.page = 0; },
      onFloor: (id) => { this.floorId = id; this.page = 0; } });
    PlayButton({ title: '看看本周 / 本月守护统计', secondary: true, controlId: 'monitor-statistics', onAction: this.onStats });
    PlayButton({ title: '查看监测趋势', secondary: true, controlId: 'monitor-trend',
      available: this.firstTrendPoint() !== '', onAction: () => this.onTrend(this.firstTrendPoint()) });
    Scroll() {
      Row({ space: 8 }) {
        this.filterButton('all', '全部');
        this.filterButton('crack', '裂缝');
        this.filterButton('tilt', '倾角');
        this.filterButton('vibration', '振动');
      }
    }.scrollable(ScrollDirection.Horizontal).width('100%').scrollBar(BarState.Off);
    Text(`当前可见 ${this.points().length} 个测点`).fontSize(14).fontColor(Theme.secondary);
    ForEach(this.points().slice(this.page * 20, (this.page + 1) * 20), (point: Point) => { this.pointCard(point); }, (point: Point) => point.id);
    if (this.points().length > 20) {
      Text(`第 ${this.page + 1} / ${Math.ceil(this.points().length / 20)} 页 · 每页20处`).fontSize(14).fontColor(Theme.secondary);
      PlayButton({ title: '上一页测点', secondary: true, available: this.page > 0, controlId: 'points-previous', onAction: () => { this.page--; } });
      PlayButton({ title: '下一页测点', secondary: true, available: (this.page + 1) * 20 < this.points().length,
        controlId: 'points-next', onAction: () => { this.page++; } });
    }
    if (this.points().length === 0) {
      AppCard() {
        Text('这个范围还没有测点').fontSize(18).fontColor(Theme.text);
        Text('请切换筛选或身份；缺少记录不代表监测正常。').fontSize(14).fontColor(Theme.secondary);
      }
    }
    Text('预警记录').fontSize(22).fontWeight(FontWeight.Medium).fontColor(Theme.text);
    PlayButton({ title: this.history ? '只看未关闭预警' : '翻开历史预警', secondary: true,
      onAction: () => { this.history = !this.history; }, controlId: 'toggle-event-history' });
    ForEach(this.events(), (event: AlarmEvent) => { this.alarmCard(event); }, (event: AlarmEvent) => event.id);
    if (this.events().length === 0) {
      Text('当前授权范围内没有对应预警记录。').fontSize(14).fontColor(Theme.secondary);
    }
  }

  build() {
    PageStage() {
        PageHeading({ title: '把变化，看清楚', subtitle: '三类监测 · 硬件输入模拟', kicker: 'MONITOR / 监测小站' });
        ConnectionState({ state: this.state, onSettings: this.onSettings, onRetry: this.onRefresh });
        if (this.state.mode === 'ready') { this.content(); }
    }
  }
}
