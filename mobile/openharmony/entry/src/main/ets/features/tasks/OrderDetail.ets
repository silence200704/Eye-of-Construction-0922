import { AppState } from '../../shared/state/AppState';
import { WorkOrder, OrderReview, OrderTimeline } from '../../data/models/Tasks';
import { orderAllowed } from '../../core/field/OrderPolicy';
import { Theme } from '../../shared/theme/Theme';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { label, timeText } from '../../shared/format/display';
import { SavedPhotos } from '../reports/SavedPhotos';
import { PhotoOpen, SavedPhoto } from '../../core/media/PhotoReader';

@Component
export struct OrderDetail {
  @Prop state: AppState;
  @Prop orderId: string;
  @Prop busy: boolean = false;
  @Prop feedback: string = '';
  onHandle: (action: string) => void = () => {};
  onReload: () => void = () => {};
  onPhoto: (request: PhotoOpen) => Promise<SavedPhoto | null> = async () => null;
  onClearPhotos: () => void = () => {};
  order(): WorkOrder | undefined { return this.state.workspace.orders.find((row) => row.id === this.orderId); }

  @Builder
  summary() {
    AppCard({ color: Theme.soft }) {
      Text(this.order()!.title).fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(`${this.order()!.orderNo} · ${label(this.order()!.status)}`).fontSize(17).fontColor(Theme.brand).id('order-status');
      Text(`指定维修人：${this.order()!.assignee || '尚未派工'}`).fontSize(14).fontColor(Theme.text);
      Text(`实际接单人：${this.state.identities.find((row) => row.id === this.order()!.acceptedById)?.name ?? '尚未接单'}`)
        .fontSize(14).fontColor(Theme.secondary);
      Text(`截止 ${timeText(this.order()!.dueAt)}`).fontSize(12).fontColor(Theme.secondary);
      if (this.order()!.measures) { Text(`维修措施：${this.order()!.measures}`).fontSize(14).fontColor(Theme.text); }
      if (this.order()!.materials) { Text(`材料：${this.order()!.materials}`).fontSize(13).fontColor(Theme.secondary); }
      Text(`已关联 ${this.order()!.photos?.length ?? 0} 张办理/验收照片。`).fontSize(12).fontColor(Theme.secondary);
    }
  }

  @Builder
  actions() {
    if (this.feedback) { Text(this.feedback).fontSize(14).fontColor(Theme.brand).id('order-feedback'); }
    if (orderAllowed(this.order()!, this.state.user, 'repairing')) {
      PlayButton({ title: this.state.user?.id !== this.order()!.assigneeId ? '说明原因并代接' :
        this.order()!.status === 'returned' ? '重新接续办理' : '接单，开始处理',
        available: !this.busy, controlId: 'order-accept', onAction: () => this.onHandle('repairing') });
    } else if (orderAllowed(this.order()!, this.state.user, 'submitted')) {
      PlayButton({ title: '填写措施，提交完工', available: !this.busy,
        controlId: 'order-submit-open', onAction: () => this.onHandle('submitted') });
    } else {
      Text(this.order()!.status === 'submitted' ? '已提交，等待学校安全管理人员在Web验收。' :
        this.order()!.status === 'verified' ? '工单已验收，关联问题仍须按复查结论办理。' : '当前身份查看进度；办理需由指定维修人或实际接单人操作。')
        .fontSize(14).fontColor(Theme.secondary);
    }
    PlayButton({ title: '刷新办理进度', secondary: true, available: !this.busy, controlId: 'order-reload', onAction: this.onReload });
  }

  @Builder
  history() {
    ForEach(this.order()!.reviews ?? [], (review: OrderReview) => {
      AppCard({ color: review.result === 'fail' ? Theme.peach : Theme.pale }) {
        Text(review.result === 'fail' ? '验收退回，请补办' : '验收通过').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text(review.note).fontSize(14).fontColor(Theme.secondary);
        Text(`${review.by} · ${timeText(review.at)}`).fontSize(12).fontColor(Theme.secondary);
      }
    });
    AppCard() {
      Text('办理足迹').fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      ForEach(this.order()!.timeline ?? [], (entry: OrderTimeline) => {
        Text(`${entry.action} · ${entry.by}`).fontSize(14).fontColor(Theme.brand);
        if (entry.detail) { Text(entry.detail).fontSize(13).fontColor(Theme.secondary); }
      });
    }
  }

  build() {
    PageStage() {
      if (this.state.mode === 'ready' && this.order()) {
        PageHeading({ title: '把这份守护，接续下去', subtitle: '接单 → 维修 → 提交验收', kicker: 'REPAIR / 维修手账' });
        this.summary(); this.actions();
        SavedPhotos({ ids: this.order()!.photos ?? [], orderId: this.orderId, onOpen: this.onPhoto, onClear: this.onClearPhotos });
        this.history();
      } else {
        AppCard() { Text('当前工单不可查看，请返回重新读取。').fontSize(17).fontColor(Theme.secondary); }
      }
    }
  }
}
