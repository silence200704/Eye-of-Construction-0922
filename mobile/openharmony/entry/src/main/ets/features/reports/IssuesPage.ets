import { AppState } from '../../shared/state/AppState';
import { Point, Building } from '../../data/models/Monitoring';
import { IssueRecord, ReportTarget } from '../../data/models/Reports';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { PlayButton } from '../../shared/playful/PlayButton';
import { label } from '../../shared/format/display';
import { SavedPhotos } from './SavedPhotos';
import { PhotoOpen, SavedPhoto } from '../../core/media/PhotoReader';

@Component
export struct IssuesPage {
  @Prop state: AppState;
  @State choosing: boolean = false;
  onNew: (target: ReportTarget) => void = () => {};
  onRefresh: () => void = () => {};
  onSupplement: (id: string) => void = () => {};
  onPhoto: (request: PhotoOpen) => Promise<SavedPhoto | null> = async () => null;
  onClearPhotos: () => void = () => {};
  @Prop feedback: string = '';
  @Prop busy: boolean = false;

  @Builder
  locations() {
    AppCard({ color: Theme.cream }) {
      Text('选择这份发现的位置').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      ForEach(this.state.workspace.points.filter((row) => row.status === 'active'), (point: Point) => {
        PlayButton({ title: point.name, secondary: true, controlId: `report-point-${point.id}`, onAction: () => this.onNew({
          pointId: point.id, buildingId: point.buildingId, floorId: point.floorId, taskId: '', expectedRev: 0 }) });
      }, (point: Point) => point.id);
      Text('没有对应测点时，也可以记录到楼栋。').fontSize(12).fontColor(Theme.secondary);
      ForEach(this.state.workspace.buildings.filter((row) => row.status === 'active'), (building: Building) => {
        PlayButton({ title: `仅关联楼栋 · ${building.name}`, secondary: true, controlId: `report-building-${building.id}`, onAction: () => this.onNew({
          pointId: '', buildingId: building.id, floorId: '', taskId: '', expectedRev: 0 }) });
      }, (building: Building) => building.id);
    }
  }

  @Builder
  issueCard(issue: IssueRecord) {
    AppCard({ color: issue.reviewAction === 'need_evidence' ? Theme.peach : Theme.pale }) {
      Text(`${issue.issueNo} · ${issue.anomalyType}`).fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(label(issue.status))
        .fontSize(13).fontColor(Theme.brand);
      Text(issue.description).fontSize(14).fontColor(Theme.secondary);
      Text(`关联照片 ${issue.photos.length} 张 · ${issue.source === 'sensor' ? '预警转单' : issue.source === 'maintenance' ? '保养发现' : issue.taskId ? '巡检发现' : '独立上报'}`)
        .fontSize(12).fontColor(Theme.brand);
      if (issue.reviewNote) { Text(`审核反馈：${issue.reviewNote}`).fontSize(13).fontColor(Theme.warning); }
      if (issue.reviewAction === 'need_evidence' && this.state.workspace.supplementableIds.includes(issue.id)) {
        PlayButton({ title: '补充材料', available: !this.busy, controlId: `issue-supplement-${issue.id}`,
          onAction: () => this.onSupplement(issue.id) });
      }
      SavedPhotos({ ids: issue.photos, issueId: issue.id, onOpen: this.onPhoto, onClear: this.onClearPhotos });
    }
  }

  build() {
    PageStage() {
      PageHeading({ title: '每一份发现，都有回音', subtitle: '现场提交与服务端审核进度', kicker: 'DISCOVERY / 现场发现' });
      if (this.state.mode === 'ready') {
        if (this.feedback) { Text(this.feedback).fontSize(13).fontColor(Theme.brand).id('handling-entry-feedback'); }
        PlayButton({ title: this.choosing ? '收起位置选择' : '记录新的现场发现', controlId: 'issue-new',
          onAction: () => { this.choosing = !this.choosing; } });
        if (this.choosing) { this.locations(); }
        ForEach(this.state.workspace.issues, (issue: IssueRecord) => { this.issueCard(issue); }, (issue: IssueRecord) => issue.id);
        if (!this.state.workspace.issues.length) {
          AppCard() { Text('暂无当前范围的问题记录。发现异常时，可从上方开始记录。').fontSize(15).fontColor(Theme.secondary); }
        }
        PlayButton({ title: '刷新服务端进度', secondary: true, onAction: this.onRefresh, controlId: 'issues-refresh' });
      }
    }
  }
}
