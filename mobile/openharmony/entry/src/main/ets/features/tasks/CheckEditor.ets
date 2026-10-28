import { AppState } from '../../shared/state/AppState';
import { InspectionTask } from '../../data/models/Tasks';
import { TaskWrite, TaskCommandResult } from '../../data/models/Inspection';
import { CheckDraft } from '../../core/field/CheckDraft';
import { authorizationOf } from '../../core/identity/authorization';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { CheckInForm } from './CheckInForm';
import { ChecklistForm } from './ChecklistForm';

@Component
export struct CheckEditor {
  @Prop state: AppState;
  @Prop task: InspectionTask;
  @Prop @Watch('switchPoint') pointId: string;
  @State draft: CheckDraft = new CheckDraft();
  @State localMessage: string = '';
  @State localColor: string = Theme.brand;
  private drafts: Map<string, CheckDraft> = new Map();
  private selected: string = '';
  private active: boolean = false;
  onSubmit: (request: TaskWrite) => Promise<TaskCommandResult | undefined> = async () => undefined;
  onRetry: () => Promise<TaskCommandResult | undefined> = async () => undefined;
  onReload: () => void = () => {};

  aboutToAppear(): void { this.active = true; this.switchPoint(); }
  aboutToDisappear(): void { this.active = false; }

  switchPoint(): void {
    if (this.selected) this.drafts.set(this.selected, this.draft.copy());
    this.selected = this.pointId;
    this.draft = this.drafts.get(this.pointId)?.copy() ?? new CheckDraft(this.task, this.pointId);
    this.localMessage = '';
  }

  locked(): boolean {
    return this.state.command.phase === 'sending' || this.state.command.phase === 'unknown' ||
      this.state.user?.role !== this.task.planSnapshot.executorRole;
  }

  field(key: string, value: string): void {
    const draft = this.draft.copy();
    if (key === 'method') draft.method = value;
    if (key === 'labelRead') draft.labelRead = value;
    if (key === 'fallbackReason') draft.fallbackReason = value;
    if (key === 'noIssueReason') draft.noIssueReason = value;
    this.draft = draft;
    this.localMessage = '';
  }

  async submit(action: string): Promise<void> {
    this.localMessage = this.draft.validate(action, this.task, this.pointId);
    this.localColor = this.localMessage ? Theme.danger : Theme.brand;
    if (this.localMessage) return;
    await this.finish(this.onSubmit(this.draft.request(action, this.task.id, this.pointId)));
  }

  async finish(pending: Promise<TaskCommandResult | undefined>): Promise<void> {
    const pointId = this.pointId;
    const taskId = this.task.id;
    const user = this.state.user ? authorizationOf(this.state.user) : '';
    const result = await pending;
    if (!this.active || !result || result.task.id !== taskId || pointId !== this.pointId || !this.state.user || authorizationOf(this.state.user) !== user) return;
    const previous = this.draft;
    this.draft = new CheckDraft(result.task, pointId);
    this.draft.labelRead = previous.labelRead;
    this.draft.method = previous.method;
    this.draft.fallbackReason = previous.fallbackReason;
    this.localMessage = result.attempt?.message ?? (result.task.status === 'checked' ? '全部测点已检查完成。' : '本测点已完成，其他测点请继续核对。');
    this.localColor = result.attempt?.passed === false ? Theme.danger : Theme.brand;
  }

  @Builder
  feedback() {
    if (this.localMessage) { Text(this.localMessage).fontSize(14).fontColor(this.localColor).id('inspection-feedback'); }
    if (this.state.command.message && this.state.command.message !== this.localMessage && this.state.command.pointId === this.pointId) {
      Text(this.state.command.message).fontSize(13).fontColor(this.state.command.phase === 'done' ? Theme.brand : Theme.danger)
        .id('inspection-command-message');
    }
    if (this.state.command.phase === 'unknown') {
      PlayButton({ title: '用原请求核验并重试', secondary: true,
        onAction: () => this.finish(this.onRetry()), controlId: 'inspection-retry' });
      Text('结果未知时保留原请求，不修改内容或重复创建操作。').fontSize(12).fontColor(Theme.warning);
    }
    if (this.state.command.phase === 'conflict' || this.task.rev !== this.draft.rev) {
      Text('填写内容已保留。先读取最新任务，再核对后采用当前版本。').fontSize(12).fontColor(Theme.warning);
      PlayButton({ title: '读取最新任务', secondary: true, onAction: this.onReload, controlId: 'inspection-reload' });
      PlayButton({ title: '已核对，采用当前版本', secondary: true, available: !this.locked(),
        onAction: () => { const draft = this.draft.copy(); draft.rev = this.task.rev; this.draft = draft; }, controlId: 'inspection-use-revision' });
    }
  }

  @Builder
  abnormal() {
    if (this.draft.answers.some((row) => row.result === 'abnormal')) {
      AppCard({ color: Theme.peach }) {
        Text('异常需要有后续依据').fontSize(17).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('可关联本任务、本测点已上报的问题；确实无需另建问题时，填写至少10字的现场依据。')
          .fontSize(12).fontColor(Theme.secondary);
        ForEach(this.task.results.find((row) => row.pointId === this.pointId)?.issueIds ?? [], (id: string) => {
          Button(this.draft.linkedIssueId === id ? `已关联 ${id}` : `关联 ${id}`).constraintSize({ minHeight: 48 })
            .fontSize(12).backgroundColor(Theme.pale).fontColor(Theme.brand).enabled(!this.locked())
            .onClick(() => { const draft = this.draft.copy(); draft.linkedIssueId = draft.linkedIssueId === id ? null : id; this.draft = draft; });
        }, (id: string) => id);
        TextArea({ text: this.draft.noIssueReason, placeholder: '仅在确认无需另建问题时填写依据，不能以此跳过实际处置' })
          .height(112).fontSize(14).backgroundColor(Theme.surface).enabled(!this.locked())
          .onChange((value: string) => this.field('noIssueReason', value)).id('inspection-no-issue-reason');
        Text('需要新问题或照片时，请先通过Web任务上报；App上报入口仍在后续批次接入。')
          .fontSize(11).fontColor(Theme.warning);
      }
    }
  }

  build() {
    Column({ space: 18 }) {
      this.feedback();
      if (this.task.results.find((row) => row.pointId === this.pointId)?.status === 'completed') {
        AppCard({ color: Theme.soft }) {
          Text('这一处，已认真检查完成').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text('检查结果已由服务端保存。任务完成不等于问题、工单或预警已关闭。').fontSize(13).fontColor(Theme.secondary);
        }
        ChecklistForm({ items: this.task.planSnapshot.checklist, answers: this.draft.answers, locked: true });
        if (this.draft.noIssueReason) {
          Text(`异常处置依据：${this.draft.noIssueReason}`).fontSize(13).fontColor(Theme.secondary);
        }
      } else {
        if (this.task.results.find((row) => row.pointId === this.pointId)?.status === 'pending') {
          CheckInForm({ draft: this.draft, locked: this.locked(),
            expectedLabel: this.state.workspace.points.find((point) => point.id === this.pointId)?.nfc?.code ?? '',
            onField: (key, value) => this.field(key, value) });
          PlayButton({ title: this.state.command.phase === 'sending' ? '正在核对…' : '核对本次到点',
            available: !this.locked(), onAction: () => this.submit('check-in'), controlId: 'inspection-check-in' });
        } else {
          Text('到点核对通过，接下来填写检查清单。').fontSize(14).fontColor(Theme.brand).id('inspection-arrived');
          ChecklistForm({ items: this.task.planSnapshot.checklist, answers: this.draft.answers, locked: this.locked(),
            onChoose: (key, value) => { const draft = this.draft.copy(); draft.choose(key, value); this.draft = draft; },
            onNote: (key, value) => { const draft = this.draft.copy(); draft.note(key, value); this.draft = draft; } });
          this.abnormal();
          PlayButton({ title: this.state.command.phase === 'sending' ? '正在保存…' : '③ 提交本测点检查',
            available: !this.locked(), onAction: () => this.submit('complete-point'), controlId: 'inspection-complete' });
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start);
  }
}
