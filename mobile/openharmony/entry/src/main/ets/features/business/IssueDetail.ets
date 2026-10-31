import { WorkOrder } from '../../data/models/Tasks';
import { AppState } from '../../shared/state/AppState';
import { IssueRecord, RecheckRound, IssueTimeline } from '../../data/models/Reports';
import { reviewActions } from '../../core/business/BusinessPolicy';
import { PageStage } from '../../shared/playful/PageStage';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
import { label, timeText } from '../../shared/format/display';
import { SavedPhotos } from '../reports/SavedPhotos';
import { PhotoOpen, SavedPhoto } from '../../core/media/PhotoReader';

@Component
export struct IssueDetail {
  @Prop state: AppState;
  @Prop issueId: string;
  onManage: (kind: string, id: string) => void = () => {};
  onOrder: (id: string) => void = () => {};
  onEvent: (id: string) => void = () => {};
  onIssue: (id: string) => void = () => {};
  onSupplement: (id: string) => void = () => {};
  onPhoto: (request: PhotoOpen) => Promise<SavedPhoto | null> = async () => null;
  onClearPhotos: () => void = () => {};
  issue(): IssueRecord | undefined { return this.state.workspace.issues.find((row) => row.id === this.issueId); }
  activeRound(): RecheckRound | undefined { return this.issue()?.rechecks?.find((row) => !row.outcome); }
  @Builder
  actions() {
    if (reviewActions(this.issue()!, this.state.user).length) {
      PlayButton({ title: '审核并安排下一步', onAction: () => this.onManage('review', this.issueId), controlId: 'issue-review' });
    }
    if (this.issue()!.reviewAction === 'need_evidence' && this.state.workspace.supplementableIds.includes(this.issueId)) {
      PlayButton({ title: '按审核要求补充材料', onAction: () => this.onSupplement(this.issueId), controlId: 'issue-detail-supplement' });
    }
    if (this.state.user?.role === 'safety' && ['pending_recheck', 'observing'].includes(this.issue()!.status)) {
      PlayButton({ title: this.activeRound() ? '提交本轮复查结论' : '登记复查事项与日期',
        onAction: () => this.onManage(this.activeRound() ? 'outcome' : 'recheck', this.issueId), controlId: 'issue-recheck' });
    }
  }
  @Builder
  relations() {
    ForEach(this.state.workspace.orders.filter((row) => row.issueId === this.issueId), (order: WorkOrder) => {
      AppCard({ color: Theme.cream }) {
        Text(`${order.orderNo} · ${label(order.status)}`).fontSize(17).fontColor(Theme.text);
        Text(`当前责任人：${order.assignee || '待派工'}`).fontSize(14).fontColor(Theme.secondary);
        PlayButton({ title: order.status === 'created' && this.state.user?.role === 'safety' ? '选择维修人，派出这张工单' : '打开工单，接续办理',
          secondary: true, onAction: () => this.onOrder(order.id), controlId: `issue-order-${order.id}` });
      }
    });
    if (this.issue()!.eventId || this.issue()!.linkedEventId) {
      PlayButton({ title: '查看关联预警与恢复依据', secondary: true,
        onAction: () => this.onEvent(this.issue()!.eventId || this.issue()!.linkedEventId || '') });
    }
    if (this.issue()!.duplicateOf) {
      PlayButton({ title: '打开关联的原问题', secondary: true, onAction: () => this.onIssue(this.issue()!.duplicateOf!) });
    }
  }
  build() {
    PageStage() {
      if (this.issue()) {
        AppCard({ color: Theme.soft }) {
          Text(this.issue()!.anomalyType).fontSize(24).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(`${this.issue()!.issueNo} · ${label(this.issue()!.status)}`).fontSize(16).fontColor(Theme.brand);
          Text(this.issue()!.description).fontSize(16).fontColor(Theme.text);
          Text(this.state.workspace.points.find((row) => row.id === this.issue()!.pointId)?.name ??
            this.state.workspace.buildings.find((row) => row.id === this.issue()!.buildingId)?.name ?? '楼栋现场问题').fontSize(14).fontColor(Theme.secondary);
          if (this.issue()!.reviewNote) { Text(`审核意见：${this.issue()!.reviewNote}`).fontSize(15).fontColor(Theme.warning); }
        }
        this.actions(); this.relations();
        SavedPhotos({ ids: this.issue()!.photos, issueId: this.issueId, onOpen: this.onPhoto, onClear: this.onClearPhotos });
        ForEach(this.issue()!.rechecks ?? [], (round: RecheckRound) => {
          AppCard() {
            Text(round.subject).fontSize(17).fontWeight(FontWeight.Bold).fontColor(Theme.text);
            Text(`${round.owner} · ${round.dueDate} · ${round.outcome ?? '待出结论'}`).fontSize(14).fontColor(Theme.brand);
            Text(round.outcomeNote ?? '').fontSize(14).fontColor(Theme.secondary);
          }
        });
        AppCard() {
          Text('这份发现的办理足迹').fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          ForEach(this.issue()!.timeline ?? [], (entry: IssueTimeline) => {
            Text(`${entry.action} · ${entry.by} · ${timeText(entry.at)}`).fontSize(14).fontColor(Theme.brand);
            Text(entry.detail).fontSize(14).fontColor(Theme.secondary);
          });
        }
      } else { AppCard() { Text('问题已不可查看，请返回刷新当前身份范围。').fontSize(16); } }
    }
  }
}
