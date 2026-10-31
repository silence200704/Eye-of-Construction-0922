import common from '@ohos.app.ability.common';
import { AppState } from '../../shared/state/AppState';
import { BusinessStore } from '../../core/business/BusinessStore';
import { FieldQueue } from '../../core/offline/field/FieldQueue';
import { scopeKey } from '../../core/offline/OfflineModels';
import { CheckDraft } from '../../core/field/CheckDraft';
import { BusinessDraft, businessWrite } from '../../core/business/BusinessDraft';
import { BusinessWrite } from '../../core/business/BusinessModels';
import { BusinessPhoto } from '../../core/business/BusinessPhotos';
import { NativeDurableFiles } from '../../core/offline/media/NativeDurableFiles';
import { PhotoSelector } from '../../core/media/PhotoSelector';
import { reportId } from '../../core/report/ReportDraft';
import { InspectionTask } from '../../data/models/Tasks';
import { ChecklistForm } from '../tasks/ChecklistForm';
import { CheckInForm } from '../tasks/CheckInForm';
import { FormField } from '../business/FormField';
import { PageStage } from '../../shared/playful/PageStage';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
interface SavedInspection { check: CheckDraft; report: BusinessDraft; photos: BusinessPhoto[]; workflowId: string; queued: boolean; }
@Component
export struct OfflineInspection {
  @Prop state: AppState;
  @Prop taskId: string;
  store: BusinessStore | undefined = undefined;
  queue: FieldQueue | undefined = undefined;
  onExternal: (value: boolean) => void = () => {};
  @State pointId: string = '';
  @State draft: CheckDraft = new CheckDraft();
  @State report: BusinessDraft = new BusinessDraft();
  @State photos: BusinessPhoto[] = [];
  @State queued: boolean = false;
  @State busy: boolean = false;
  @State message: string = '';
  private scope: string = '';
  private workflowId: string = '';
  private active: boolean = false;
  private generation: number = 0;
  task(): InspectionTask | undefined { return this.state.workspace.tasks.find((row) => row.id === this.taskId); }
  aboutToAppear(): void {
    this.active = true;
    if (this.state.user) this.scope = scopeKey({ baseUrl: this.state.baseUrl, user: this.state.user, workspace: this.state.workspace });
    void this.select(this.task()?.planSnapshot.pointIds[0] ?? '');
  }
  aboutToDisappear(): void { this.active = false; this.generation++; }
  async select(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.loadPoint(id); }
    catch (_) { this.message = '本地草稿暂不可读取，请保留数据。'; }
    finally { this.busy = false; }
  }
  private async loadPoint(id: string): Promise<void> {
    if (this.pointId) await this.save();
    const run = ++this.generation; this.pointId = id;
    this.draft = new CheckDraft(this.task(), id); this.report = new BusinessDraft(); this.photos = []; this.queued = false;
    this.workflowId = `inspection-${reportId()}`;
    this.report.kind = 'report'; this.report.taskId = this.taskId; this.report.pointId = id;
    this.report.buildingId = this.task()?.buildingId ?? ''; this.report.rev = this.task()?.rev ?? 0;
    const saved = await this.store?.form(this.scope, `inspection:${this.taskId}:${id}`);
    if (!this.active || run !== this.generation || !saved) return;
    const data = JSON.parse(saved) as SavedInspection;
    const check = new CheckDraft();
    check.rev = data.check.rev; check.method = data.check.method; check.labelRead = data.check.labelRead;
    check.fallbackReason = data.check.fallbackReason; check.answers = data.check.answers;
    check.linkedIssueId = data.check.linkedIssueId; check.noIssueReason = data.check.noIssueReason;
    this.draft = check; this.report = data.report; this.photos = data.photos; this.workflowId = data.workflowId; this.queued = data.queued;
    if (data.queued) {
      const rows = await this.queue?.list(this.scope);
      if (rows?.filter((row) => row.id.startsWith(`${data.workflowId}-`)).every((row) => row.phase === 'cancelled')) {
        this.queued = false; this.workflowId = `inspection-${reportId()}`;
      }
    }
  }
  async save(): Promise<void> {
    if (!this.pointId || !this.store) return;
    const saved: SavedInspection = { check: this.draft, report: this.report, photos: this.photos, workflowId: this.workflowId, queued: this.queued };
    try { await this.store.saveForm(this.scope, `inspection:${this.taskId}:${this.pointId}`, JSON.stringify(saved)); }
    catch (_) { this.message = '本地保存失败，请勿离开。'; throw new Error(this.message); }
  }
  field(key: string, value: string): void {
    const draft = this.draft.copy();
    if (key === 'method') draft.method = value;
    if (key === 'labelRead') draft.labelRead = value;
    if (key === 'fallbackReason') draft.fallbackReason = value;
    if (key === 'noIssueReason') draft.noIssueReason = value;
    this.draft = draft; void this.save();
  }
  reportField(key: string, value: string): void {
    const draft = JSON.parse(JSON.stringify(this.report)) as BusinessDraft;
    if (key === 'anomalyType') draft.anomalyType = value;
    if (key === 'description') draft.description = value;
    this.report = draft; void this.save();
  }
  async photo(source: string): Promise<void> {
    if (this.busy || this.queued || this.photos.length >= 3) return;
    this.busy = true; this.onExternal(true);
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext, selector = new PhotoSelector(context);
    try {
      const picked = await selector.choose(source); if (!picked) return;
      try {
        const photo = await new NativeDurableFiles(context.filesDir).save(picked);
        const durable: BusinessPhoto = { draftId: photo.draftId, path: photo.path, uri: photo.uri, size: photo.size,
          fileName: photo.fileName, mimeType: photo.mimeType, source: photo.source, sha256: photo.sha256, kind: 'scene', mediaId: '' };
        if (!this.active) return; this.photos = [...this.photos, durable]; await this.save();
      } finally { selector.dispose(picked); }
    } catch (_) { this.message = '照片未添加，原草稿保留。'; }
    finally { this.busy = false; this.onExternal(false); }
  }
  async enqueue(): Promise<void> {
    if (!this.task() || !this.queue || this.busy || this.queued) return;
    this.busy = true;
    try {
      const task = this.task()!, writes: BusinessWrite[] = [];
      if (this.state.user?.role !== task.planSnapshot.executorRole) throw new Error('请由任务指定执行身份填写。');
      if (task.results.find((row) => row.pointId === this.pointId)?.status === 'completed') throw new Error('缓存中此测点已完成。');
      if (task.results.find((row) => row.pointId === this.pointId)?.status === 'pending') {
        const error = this.draft.validate('check-in', task, this.pointId); if (error) throw new Error(error);
        const write = this.draft.request('check-in', task.id, this.pointId);
        writes.push({ path: `/inspection/tasks/${encodeURIComponent(task.id)}/check-in`, kind: 'task', targetId: task.id, body: write.body });
      }
      const projected = JSON.parse(JSON.stringify(task)) as InspectionTask;
      projected.results = projected.results.map((row) => { if (row.pointId === this.pointId) row.status = 'arrived'; return row; });
      const check = this.draft.copy();
      if (this.report.description.trim()) {
        writes.push(businessWrite(this.report)); check.linkedIssueId = 'pending-offline-issue';
        projected.results.find((row) => row.pointId === this.pointId)?.issueIds.push('pending-offline-issue');
      }
      const error = check.validate('complete-point', projected, this.pointId); if (error) throw new Error(error);
      const complete = check.request('complete-point', task.id, this.pointId);
      writes.push({ path: `/inspection/tasks/${encodeURIComponent(task.id)}/complete-point`, kind: 'task', targetId: task.id, body: complete.body });
      await this.queue.workflow({ id: this.workflowId, scope: this.scope, writes, photos: this.photos });
      this.queued = true; await this.save(); this.message = '本地流程已冻结：先核对到点，再上报异常及照片，最后提交检查；尚未完成服务端任务。';
    } catch (cause) { this.message = (cause as Error).message; }
    finally { this.busy = false; }
  }
  build() {
    PageStage() {
      AppCard({ color: Theme.soft }) {
        Text('离线巡检手账').fontSize(24).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('显示下载快照。填写与入队仅保存在本机，联网核验后才推进服务端状态。').fontSize(14).fontColor(Theme.warning);
        ForEach(this.task()?.planSnapshot.pointIds ?? [], (id: string) => {
          PlayButton({ title: this.state.workspace.points.find((row) => row.id === id)?.name ?? id, secondary: id !== this.pointId,
            available: !this.busy, onAction: () => this.select(id) });
        });
      }
      if (this.task() && this.pointId) {
        if (this.draft.rev !== this.task()!.rev) {
          Text(`本机依据版本 ${this.draft.rev}；当前任务版本 ${this.task()!.rev}。请核对已有到点、问题和完成状态。`).fontSize(15).fontColor(Theme.warning);
          PlayButton({ title: '已核对最新任务，保留内容继续办理', secondary: true, available: !this.queued && !this.busy, onAction: () => {
            const draft = this.draft.copy(); draft.rev = this.task()!.rev; this.draft = draft; this.report.rev = draft.rev;
            this.workflowId = `inspection-${reportId()}`; void this.save(); } });
        }
        CheckInForm({ draft: this.draft, locked: this.busy || this.queued, expectedLabel: this.state.workspace.points.find((row) => row.id === this.pointId)?.nfc?.code ?? '', onField: (k, v) => this.field(k, v) });
        ChecklistForm({ items: this.task()!.planSnapshot.checklist, answers: this.draft.answers, locked: this.busy || this.queued,
          onChoose: (k, v) => { const draft = this.draft.copy(); draft.choose(k, v); this.draft = draft; void this.save(); },
          onNote: (k, v) => { const draft = this.draft.copy(); draft.note(k, v); this.draft = draft; void this.save(); } });
        FormField({ title: '异常类型 · 需要上报时填写', value: this.report.anomalyType, locked: this.queued, onValue: (v) => this.reportField('anomalyType', v) });
        FormField({ title: '异常描述 · 填写后先建关联问题', value: this.report.description, multiline: true, locked: this.queued, onValue: (v) => this.reportField('description', v) });
        FormField({ title: '无需另建问题的依据 · 有异常且不上报时至少10字', value: this.draft.noIssueReason, multiline: true, locked: this.queued, onValue: (v) => this.field('noIssueReason', v) });
        ForEach(this.photos, (photo: BusinessPhoto) => { Image(photo.uri).width('100%').height(180).objectFit(ImageFit.Contain); });
        PlayButton({ title: '添加异常现场照片', secondary: true, available: !this.busy && !this.queued, onAction: () => this.photo('album') });
        PlayButton({ title: '拍摄异常现场照片', secondary: true, available: !this.busy && !this.queued, onAction: () => this.photo('camera') });
        Text(this.message).fontSize(15).fontColor(Theme.warning);
        PlayButton({ title: this.queued ? '已保存待同步流程' : '保存并排队办理本测点', available: !this.busy && !this.queued, onAction: () => this.enqueue() });
      }
    }
  }
}
