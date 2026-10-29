import { AppState } from '../../shared/state/AppState';
import { ReportView } from '../../core/report/ReportView';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { PlayButton } from '../../shared/playful/PlayButton';
import { PhotoCards } from './PhotoCards';
import { HandlingFields } from './HandlingFields';
import { label } from '../../shared/format/display';

@Component
export struct ReportPage {
  @Prop state: AppState;
  @Prop report: ReportView;
  onField: (key: string, value: string) => void = () => {};
  onChoose: (source: string) => void = () => {};
  onRemove: (id: string) => void = () => {};
  onSubmit: () => void = () => {};
  onRetry: () => void = () => {};
  onReload: () => void = () => {};
  onAdopt: (rev: number) => void = () => {};
  onDone: () => void = () => {};
  onDiscard: () => void = () => {};
  onKind: (id: string, kind: string) => void = () => {};

  locked(): boolean { return ['sending', 'picking', 'unknown', 'done'].includes(this.report.phase); }

  currentRev(): number {
    const target = this.report.draft?.target;
    if (target?.issueId) return this.state.workspace.issues.find((row) => row.id === target.issueId)?.rev ?? 0;
    if (target?.orderId) return this.state.workspace.orders.find((row) => row.id === target.orderId)?.rev ?? 0;
    return this.state.workspace.tasks.find((row) => row.id === target?.taskId)?.rev ?? 0;
  }

  @Builder
  location() {
    AppCard({ color: Theme.soft }) {
      Text(this.report.draft?.target.issueId ? '补充原问题材料' : this.report.draft?.target.orderId ? '工单现场办理' :
        this.report.draft?.target.taskId ? '来自这一次巡检' : '独立现场上报').fontSize(15).fontColor(Theme.brand);
      Text(this.state.workspace.points.find((row) => row.id === this.report.draft?.target.pointId)?.name ??
        this.state.workspace.buildings.find((row) => row.id === this.report.draft?.target.buildingId)?.name ?? '')
        .fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text).id('report-target');
      Text(this.report.draft?.target.orderId ? '只办理当前工单，提交完工后由安全管理人员验收。' :
        '位置随本次草稿固定；提交进入待审核，不直接生成已修复结论。').fontSize(12).fontColor(Theme.secondary);
    }
  }

  @Builder
  details() {
    AppCard({ color: Theme.cream }) {
      Text('① 说说你看到了什么').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      TextInput({ text: this.report.draft?.anomalyType ?? '', placeholder: '异常类型，如墙面裂缝、设备松动' })
        .height(54).fontSize(15).maxLength(80).enabled(!this.locked()).backgroundColor(Theme.surface)
        .onChange((value: string) => this.onField('anomalyType', value)).id('report-anomaly');
      TextArea({ text: this.report.draft?.description ?? '', placeholder: '记录位置、现象和观察情况，不需要填写专业结论' })
        .height(155).fontSize(15).maxLength(4000).enabled(!this.locked()).backgroundColor(Theme.surface)
        .onChange((value: string) => this.onField('description', value)).id('report-description');
      Text('仅记录真实观察；比赛素材请在描述中明确标注。').fontSize(12).fontColor(Theme.secondary);
    }
  }

  @Builder
  feedback() {
    AppCard({ color: this.report.phase === 'done' ? Theme.soft : Theme.pale }) {
      Text(this.report.phase === 'done' ? '这份记录，已经送达' : '③ 核对后，交给服务端')
        .fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(this.report.message).fontSize(14).fontColor(['unknown', 'conflict', 'upload-error'].includes(this.report.phase) ? Theme.warning : Theme.brand)
        .id('report-feedback');
      if (this.report.phase === 'done') {
        Text(this.report.order ? `工单 ${this.report.order.orderNo} · ${label(this.report.order.status)} · ${this.report.order.photos.length} 张照片` :
          `问题编号 ${this.report.issue?.issueNo ?? ''} · 已关联 ${this.report.issue?.photos.length ?? 0} 张照片`)
          .fontSize(15).fontColor(Theme.text).id('report-success');
        PlayButton({ title: this.report.order ? '返回工单，查看进度' : '返回，继续现场检查', controlId: 'report-done', onAction: this.onDone });
      } else if (this.report.phase === 'unknown') {
        Text('服务端可能已保存。保留原请求核验，避免再建一个问题。').fontSize(12).fontColor(Theme.warning);
        PlayButton({ title: '用原请求核验并重试', controlId: 'report-retry', onAction: this.onRetry });
      } else if (this.report.phase === 'conflict') {
        Text('记录已更新，填写内容和照片已保留。读取最新进度后，再核对并采用当前版本。').fontSize(12).fontColor(Theme.warning);
        PlayButton({ title: '读取最新办理进度', secondary: true, controlId: 'report-reload', onAction: this.onReload });
        PlayButton({ title: '已核对，采用当前版本', secondary: true, available: this.currentRev() > 0,
          controlId: 'report-adopt', onAction: () => this.onAdopt(this.currentRev()) });
      } else {
        PlayButton({ title: this.report.phase === 'sending' ? '正在上传并保存…' : this.report.phase === 'upload-error' ? '重试上传并提交' :
          this.report.draft?.target.issueId ? '提交补充材料' : this.report.draft?.target.orderId ?
            this.report.draft.target.action === 'submitted' ? '提交完工，等待验收' : '确认代接，开始处理' : '提交这份现场记录',
          available: !this.locked(), controlId: 'report-submit', onAction: this.onSubmit });
        Button('放弃本次草稿').height(48).fontColor(Theme.secondary).backgroundColor(Theme.surface)
          .enabled(!this.locked()).onClick(this.onDiscard).id('report-discard');
      }
    }
  }

  build() {
    PageStage() {
      if (this.state.mode === 'ready' && this.report.draft) {
        PageHeading({ title: this.report.draft.target.issueId ? '把这份记录，补充完整' : this.report.draft.target.orderId ? '把维修，认真交接好' : '把发现，认真记下来',
          subtitle: '文字 + 照片，让后续处理更清楚', kicker: 'FIELD STORY / 现场记录' });
        this.location();
        if (this.report.phase !== 'done') {
          if (this.report.draft.target.issueId || this.report.draft.target.orderId) {
            HandlingFields({ draft: this.report.draft, locked: this.locked(), onField: this.onField });
          } else { this.details(); }
          if (this.report.draft.target.action !== 'repairing') {
            PhotoCards({ photos: this.report.draft.photos, locked: this.locked(), onChoose: this.onChoose, onRemove: this.onRemove,
              existingCount: this.report.draft.target.existingPhotoCount ?? 0, existingBytes: this.report.draft.target.existingPhotoBytes ?? 0,
              orderPhotos: !!this.report.draft.target.orderId, requiredPhoto: this.report.draft.target.requirePhoto ?? false, onKind: this.onKind });
          }
        }
        this.feedback();
      } else {
        AppCard() { Text('当前草稿不可查看，请返回重新选择授权位置。').fontSize(17).fontColor(Theme.secondary); }
      }
    }
  }
}
