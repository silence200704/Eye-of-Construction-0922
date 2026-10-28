import { AppState } from '../../shared/state/AppState';
import { Theme } from '../../shared/theme/Theme';
import { ConnectionState } from '../../shared/components/ConnectionState';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageStage } from '../../shared/playful/PageStage';
import { StoryHero } from '../../shared/playful/StoryHero';
import { ActionTile } from '../../shared/playful/ActionTile';
import { PlayButton } from '../../shared/playful/PlayButton';
import { activePoints, openEvents, timeText } from '../../shared/format/display';

@Component
export struct WorkbenchPage {
  @Prop state: AppState;
  onTab: (index: number) => void = () => {};
  onRefresh: () => void = () => {};
  onIssues: () => void = () => {};

  @Builder
  header() {
    Row({ space: 10 }) {
      Image($rawfile('playful/icons/shield.svg')).width(45).height(45).padding(9)
        .backgroundColor(Theme.soft).borderRadius(17).accessibilityLevel('no');
      Column({ space: 2 }) {
        Text('筑瞳').fontSize(25).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('校园守护，一起出发').fontSize(11).fontColor(Theme.secondary);
      }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      Text(this.state.mode === 'ready' ? '已连接' : this.state.busy ? '读取中' : '待连接')
        .fontSize(11).fontColor(Theme.brand).padding({ left: 11, right: 11, top: 7, bottom: 7 })
        .backgroundColor(Theme.pale).border({ width: 1, color: Theme.line }).borderRadius(15);
    }.width('100%');
  }

  @Builder
  shortcuts() {
    Row() {
      Text('今天，先去看看').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Blank();
      Text('每一步，都算数').fontSize(11).fontColor(Theme.secondary);
    }.width('100%');
    Row({ space: 12 }) {
      ActionTile({ title: '监测小站', caption: '读数与预警', color: Theme.sky,
        icon: $rawfile('design/svg/icons/monitoring/monitor.svg'), controlId: 'home-monitor',
        onAction: () => this.onTab(1) }).layoutWeight(1);
      ActionTile({ title: '现场任务', caption: '巡检与维修', color: Theme.cream,
        icon: $rawfile('design/svg/icons/field/inspection.svg'), controlId: 'home-tasks',
        onAction: () => this.onTab(2) }).layoutWeight(1);
    }.width('100%');
  }

  build() {
    PageStage() {
      this.header();
      StoryHero({ role: this.state.user?.roleLabel ?? '', onExplore: () => this.onTab(1) });
      ConnectionState({ state: this.state, onSettings: () => this.onTab(3), onRetry: this.onRefresh });
      Row({ space: 12 }) {
        MetricTile({ title: '当前可见测点', color: '#EDF4D5', note: '把细小变化记在心上',
          value: this.state.mode === 'ready' ? String(activePoints(this.state.workspace).length) : '—' }).layoutWeight(1);
        MetricTile({ title: '未关闭预警', color: Theme.peach, note: '需要关注的服务端记录',
          value: this.state.mode === 'ready' ? String(openEvents(this.state.workspace).length) : '—' }).layoutWeight(1);
      }.width('100%');
      this.shortcuts();
      if (this.state.mode === 'ready') {
        PlayButton({ title: `现场发现 · 当前 ${this.state.workspace.issues.length} 条`, secondary: true,
          controlId: 'home-issues', onAction: this.onIssues });
      }
      Text(this.state.mode === 'ready' ? `服务端读取于 ${timeText(this.state.loadedAt)}` : '连接后显示当前身份可见的数据')
        .fontSize(11).fontColor(Theme.secondary);
    }
  }
}
