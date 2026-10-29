import { controlHeight } from '../../shared/layout/ReadingLayout';
import { AppState } from '../../shared/state/AppState';
import { AlarmEvent, AlarmTimeline } from '../../data/models/Monitoring';
import { EventView, EventWrite } from '../../core/alerts/EventSession';
import { Theme } from '../../shared/theme/Theme';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { label, timeText } from '../../shared/format/display';
import { SignalPreview } from './SignalPreview';

@Component
export struct EventDetail {
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  @Prop state: AppState;
  @Prop eventId: string;
  @Prop command: EventView;
  @State kind: string = 'investigation';
  @State note: string = '';
  @State basis: string = '';
  @State noRepairNote: string = '';
  @State showNote: boolean = false;
  @State showClose: boolean = false;
  onWrite: (write: EventWrite) => void = () => {};
  onRetry: () => void = () => {};
  onReload: () => void = () => {};
  event(): AlarmEvent | undefined { return this.state.workspace.events.find((row) => row.id === this.eventId); }
  locked(): boolean { return this.command.eventId === this.eventId && ['sending', 'unknown'].includes(this.command.phase); }
  @Builder
  feedback(controlId: string, action: string = '') {
    if (this.command.messageFor(this.eventId, action)) {
      Text(this.command.messageFor(this.eventId, action)).fontSize(15).fontColor(['error', 'conflict'].includes(this.command.phase) ? Theme.danger : Theme.brand)
        .id(controlId).accessibilityText(this.command.message);
      if (this.command.phase === 'unknown') {
        PlayButton({ title: '用原请求核验办理结果', controlId: 'alarm-retry', onAction: this.onRetry });
      }
    }
  }
  @Builder
  summary() {
    AppCard({ color: this.event()!.level === 'red' ? Theme.peach : Theme.cream }) {
      Text(this.event()!.eventNo).fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(`${label(this.event()!.level)} · ${this.event()!.status === 'pending' ? '待确认' : label(this.event()!.status)}`)
        .fontSize(20).fontColor(Theme.danger).id('alarm-status');
      Text(this.state.workspace.points.find((row) => row.id === this.event()!.pointId)?.name ?? '历史测点').fontSize(17).fontColor(Theme.text);
      Text(`首次 ${timeText(this.event()!.openedAt)}\n最近 ${timeText(this.event()!.lastTriggerAt)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`规则 ${this.event()!.ruleCode} · 模拟监测触发`).fontSize(13).fontColor(Theme.brand);
      if (this.event()!.acknowledgedBy) { Text(`确认人：${this.event()!.acknowledgedBy}`).fontSize(14).fontColor(Theme.text); }
      if (this.event()!.closeBasis) { Text(`关闭依据：${this.event()!.closeBasis}`).fontSize(14).fontColor(Theme.text); }
    }
  }
  @Builder
  notes() {
    AppCard({ color: Theme.soft }) {
      Text('记录现场排查与措施').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Select([{ value: '现场排查' }, { value: '处置措施' }]).value(this.kind === 'investigation' ? '现场排查' : '处置措施')
        .height(controlHeight(50, this.textScale)).onSelect((index: number) => { this.kind = index === 0 ? 'investigation' : 'measures'; }).id('alarm-note-kind').accessibilityText('现场记录类别');
      TextArea({ text: this.note, placeholder: '填写现场观察或已采取的措施，至少10字' }).height(controlHeight(160, this.textScale)).fontSize(16)
        .enabled(!this.locked()).onChange((value: string) => { this.note = value; }).id('alarm-field-note').accessibilityText('排查或处置说明');
      this.feedback('alarm-note-feedback', 'field-notes');
      PlayButton({ title: '保存这次现场记录', available: !this.locked(), controlId: 'alarm-note-save', onAction: () => this.onWrite({
        eventId: this.eventId, action: 'field-notes', kind: this.kind, note: this.note }) });
      Text('保存说明不会改变监测判定、验收结果或关闭事件。').fontSize(13).fontColor(Theme.secondary);
    }
  }
  @Builder
  closeForm() {
    AppCard({ color: Theme.cream }) {
      Text('核对恢复依据，关闭当前预警').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      TextArea({ text: this.basis, placeholder: '恢复复测与复查依据（必填）' }).height(controlHeight(120, this.textScale)).fontSize(16).enabled(!this.locked())
        .onChange((value: string) => { this.basis = value; }).id('alarm-close-basis').accessibilityText('关闭复查依据');
      TextArea({ text: this.noRepairNote, placeholder: '无需维修的现场核查结论；已有当前关联已验收工单时可留空' })
        .height(controlHeight(120, this.textScale)).fontSize(16).enabled(!this.locked()).onChange((value: string) => { this.noRepairNote = value; })
        .id('alarm-close-note').accessibilityText('无需维修现场核查结论');
      this.feedback('alarm-close-feedback', 'close');
      PlayButton({ title: '提交恢复依据并关闭预警', available: !this.locked(), controlId: 'alarm-close-save', onAction: () => this.onWrite({
        eventId: this.eventId, action: 'close', basis: this.basis, noRepairNote: this.noRepairNote }) });
      Text('服务端复核连续恢复记录、当前工单和权限；不满足时保留填写内容并提示原因。').fontSize(13).fontColor(Theme.secondary);
    }
  }
  @Builder
  actions() {
    if ((!this.showNote && !this.showClose) || this.event()!.status === 'closed') { this.feedback('alarm-feedback'); }
    if (this.state.user?.role === 'safety' && this.event()!.status === 'pending') {
      PlayButton({ title: '确认预警，开始跟进', available: !this.locked(), controlId: 'alarm-acknowledge',
        onAction: () => this.onWrite({ eventId: this.eventId, action: 'acknowledge' }) });
    }
    if (['safety', 'property'].includes(this.state.user?.role ?? '') && this.event()!.status !== 'closed') {
      PlayButton({ title: this.showNote ? '收起现场记录' : '登记排查 / 处置措施', secondary: true, available: !this.locked(),
        controlId: 'alarm-note-open', onAction: () => { this.showNote = !this.showNote; this.showClose = false; } });
      if (this.showNote) { this.notes(); }
    }
    if (this.state.user?.role === 'safety' && this.event()!.status === 'recovering') {
      PlayButton({ title: this.showClose ? '收起恢复核查' : '核查恢复并关闭', secondary: true, available: !this.locked(),
        controlId: 'alarm-close-open', onAction: () => { this.showClose = !this.showClose; this.showNote = false; } });
      if (this.showClose) { this.closeForm(); }
    }
    PlayButton({ title: '刷新当前预警', secondary: true, available: !this.locked(), controlId: 'alarm-reload', onAction: this.onReload });
  }
  build() {
    PageStage() {
      if (this.state.mode === 'ready' && this.event()) {
        PageHeading({ title: '把异常，认真接住', subtitle: '确认、排查与恢复，各有记录', kicker: 'ALERT / 预警手账' });
        this.summary(); this.actions(); SignalPreview();
        AppCard() {
          Text('这次预警的处置足迹').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          ForEach(this.event()!.timeline ?? [], (row: AlarmTimeline) => {
            Text(`${row.action} · ${row.by}`).fontSize(16).fontWeight(FontWeight.Medium).fontColor(Theme.brand);
            Text(row.detail).fontSize(14).fontColor(Theme.text);
            Text(timeText(row.at)).fontSize(12).fontColor(Theme.secondary);
          });
        }
      } else { AppCard() { Text('当前预警不可查看，请返回重新读取。').fontSize(17).fontColor(Theme.secondary); } }
    }
  }
}
