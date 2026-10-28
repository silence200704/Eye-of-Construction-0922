import { AppState } from '../../shared/state/AppState';
import { ReportView } from '../../core/report/ReportSession';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { PlayButton } from '../../shared/playful/PlayButton';
import { PhotoCards } from './PhotoCards';

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

  locked(): boolean { return ['sending', 'picking', 'unknown', 'done'].includes(this.report.phase); }

  @Builder
  location() {
    AppCard({ color: Theme.soft }) {
      Text(this.report.draft?.target.taskId ? '来自这一次巡检' : '独立现场上报').fontSize(15).fontColor(Theme.brand);
      Text(this.state.workspace.points.find((row) => row.id === this.report.draft?.target.pointId)?.name ??
        this.state.workspace.buildings.find((row) => row.id === this.report.draft?.target.buildingId)?.name ?? '')
        .fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text).id('report-target');
      Text('位置随本次草稿固定；提交进入待审核，不直接生成已修复结论。').fontSize(12).fontColor(Theme.secondary);
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
        Text(`问题编号 ${this.report.issue?.issueNo ?? ''} · 已关联 ${this.report.issue?.photos.length ?? 0} 张照片`)
          .fontSize(15).fontColor(Theme.text).id('report-success');
        PlayButton({ title: '返回，继续现场检查', controlId: 'report-done', onAction: this.onDone });
      } else if (this.report.phase === 'unknown') {
        Text('服务端可能已保存。保留原请求核验，避免再建一个问题。').fontSize(12).fontColor(Theme.warning);
        PlayButton({ title: '用原请求核验并重试', controlId: 'report-retry', onAction: this.onRetry });
      } else if (this.report.phase === 'conflict' && this.report.draft?.target.taskId) {
        Text('先读取最新任务；核对关联问题后，再明确采用版本。照片和描述保留。').fontSize(12).fontColor(Theme.warning);
        PlayButton({ title: '读取最新任务', secondary: true, controlId: 'report-reload', onAction: this.onReload });
        PlayButton({ title: '已核对，采用当前版本', secondary: true, controlId: 'report-adopt', onAction: () =>
          this.onAdopt(this.state.workspace.tasks.find((row) => row.id === this.report.draft?.target.taskId)?.rev ?? 0) });
      } else {
        PlayButton({ title: this.report.phase === 'sending' ? '正在上传并保存…' : this.report.phase === 'upload-error' ? '重试上传并提交' : '提交这份现场记录',
          available: !this.locked(), controlId: 'report-submit', onAction: this.onSubmit });
        Button('放弃本次草稿').height(48).fontColor(Theme.secondary).backgroundColor(Theme.surface)
          .enabled(!this.locked()).onClick(this.onDiscard).id('report-discard');
      }
    }
  }

  build() {
    PageStage() {
      if (this.state.mode === 'ready' && this.report.draft) {
        PageHeading({ title: '把发现，认真记下来', subtitle: '文字 + 照片，让后续处理更清楚', kicker: 'FIELD STORY / 现场发现' });
        this.location();
        if (this.report.phase !== 'done') {
          this.details();
          PhotoCards({ photos: this.report.draft.photos, locked: this.locked(), onChoose: this.onChoose, onRemove: this.onRemove });
        }
        this.feedback();
      } else {
        AppCard() { Text('当前草稿不可查看，请返回重新选择授权位置。').fontSize(17).fontColor(Theme.secondary); }
      }
    }
  }
}
