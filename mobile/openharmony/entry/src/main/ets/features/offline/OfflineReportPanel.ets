import common from '@ohos.app.ability.common';
import { AppState } from '../../shared/state/AppState';
import { OfflineVault } from '../../core/offline/OfflineVault';
import { OfflinePack, scopeKey } from '../../core/offline/OfflineModels';
import { OutboxStore } from '../../core/offline/queue/OutboxStore';
import { OutboxExecutor } from '../../core/offline/queue/OutboxExecutor';
import { OfflineReport, OfflineOperation, DurablePhoto } from '../../core/offline/queue/QueueModels';
import { NativeDurableFiles } from '../../core/offline/media/NativeDurableFiles';
import { PhotoSelector } from '../../core/media/PhotoSelector';
import { TaskAccess } from '../../core/field/TaskCommander';
import { ApiError } from '../../core/network/ApiError';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { controlHeight } from '../../shared/layout/ReadingLayout';
import { OutboxCards } from './OutboxCards';
import { ReportResult } from '../../data/models/Reports';

@Component
export struct OfflineReportPanel {
  @Prop pack: OfflinePack;
  vault: OfflineVault | undefined = undefined;
  @Prop state: AppState;
  @State draft: OfflineReport | null = null;
  @State drafts: OfflineReport[] = [];
  @State operations: OfflineOperation[] = [];
  @State pointId: string = '';
  @State busy: boolean = false;
  @State saving: boolean = false;
  @State message: string = '';
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  onAccess: () => TaskAccess | null = () => null;
  onExternal: (value: boolean) => void = () => {};
  onSynced: (result: ReportResult) => void = () => {};
  private store: OutboxStore | undefined = undefined;
  private files: NativeDurableFiles | undefined = undefined;
  private selector: PhotoSelector | undefined = undefined;
  private executor: OutboxExecutor | undefined = undefined;
  private active: boolean = false;
  private version: number = 0;
  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.active = true; this.store = new OutboxStore(this.vault!);
    this.files = new NativeDurableFiles(context.filesDir); this.selector = new PhotoSelector(context);
    this.executor = new OutboxExecutor({ store: this.store, files: this.files, access: this.onAccess, onResult: this.onSynced });
    this.pointId = this.pack.workspace.points.find((row) => row.status === 'active')?.id ?? ''; this.reload();
  }
  aboutToDisappear(): void { this.active = false; this.version++; this.executor?.stop(); }
  online(): boolean {
    const access = this.onAccess(); return this.state.mode === 'ready' && !!access &&
      scopeKey({ baseUrl: access.baseUrl, user: access.user, workspace: access.workspace }) === this.pack.scope;
  }
  reason(cause: Error): string { return cause instanceof ApiError ? cause.message : '本机操作或同步暂未完成，原稿保留，请稍后重试。'; }
  async reload(): Promise<void> {
    try {
      const drafts = await this.store!.drafts(this.pack), operations = await this.store!.list(this.pack);
      if (!this.active) return; this.drafts = drafts; this.operations = operations;
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
  }
  async create(): Promise<void> {
    if (this.busy) return; this.busy = true;
    try {
      const draft = await this.store!.create(this.pack, this.pointId);
      if (!this.active) return; this.draft = draft; this.version++;
      this.message = '新草稿已存本机；填写会自动保存，本地保存不等于上报成功。'; await this.reload();
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { if (this.active) this.busy = false; }
  }
  async openDraft(id: string): Promise<void> {
    if (this.busy) return; this.busy = true; this.version++;
    try {
      const drafts = await this.store!.drafts(this.pack);
      if (!this.active) return;
      this.drafts = drafts; this.draft = drafts.find((row) => row.id === id && row.phase === 'editing') ?? null;
      this.saving = false; this.message = '已从本机读取最新草稿。';
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { if (this.active) this.busy = false; }
  }
  edit(key: string, value: string): void {
    if (this.busy || !this.draft) return;
    const draft = JSON.parse(JSON.stringify(this.draft)) as OfflineReport;
    if (key === 'type') draft.anomalyType = value; else draft.description = value;
    this.draft = draft; const version = ++this.version; this.saving = true;
    this.store!.save(this.pack, draft).then(() => {
      if (this.active && version === this.version) { this.saving = false; this.message = '本地草稿已保存，尚未入队。'; }
    }).catch((cause: Error) => { if (this.active && version === this.version) { this.saving = false; this.message = this.reason(cause); } });
  }
  async choosePhoto(source: string): Promise<void> {
    if (this.busy || !this.draft || this.draft.photos.length >= 3) return;
    this.busy = true; this.onExternal(true);
    try {
      const photo = await this.selector!.choose(source);
      if (!photo) return;
      try {
        if (!this.active) return;
        const metadata = await this.files!.save(photo);
        if (!this.active || !this.draft) return;
        const draft = JSON.parse(JSON.stringify(this.draft)) as OfflineReport;
        draft.photos.push(metadata); await this.store!.save(this.pack, draft);
        if (!this.active) return; this.draft = draft; this.message = '照片字节已保存至本机持久目录，尚未上传。';
      } finally { this.selector!.dispose(photo); }
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { this.onExternal(false); if (this.active) this.busy = false; }
  }
  async removePhoto(id: string): Promise<void> {
    if (this.busy || !this.draft) return; this.busy = true;
    try {
      const draft = JSON.parse(JSON.stringify(this.draft)) as OfflineReport;
      draft.photos = draft.photos.filter((row) => row.draftId !== id);
      await this.store!.save(this.pack, draft);
      if (this.active) { this.draft = draft; this.message = '已解除草稿引用；持久文件暂保留，不删除其他操作仍引用的照片。'; }
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { if (this.active) this.busy = false; }
  }
  async enqueue(): Promise<void> {
    if (this.busy || !this.draft) return; this.busy = true;
    try {
      await this.store!.save(this.pack, this.draft);
      await this.store!.enqueue(this.pack, this.draft.id);
      if (!this.active) return;
      this.draft = null; this.version++; this.saving = false;
      this.message = '已在本机入队并固定内容；联网后点同步，尚未上报服务端。'; await this.reload();
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { if (this.active) this.busy = false; }
  }
  async sync(id: string): Promise<void> {
    if (this.busy || !this.online()) return; this.busy = true; this.message = '正在核验权限、上传和提交，请稍候…';
    try {
      await this.executor!.sync(this.pack, id); if (!this.active) return;
      const operation = await this.store!.operation(this.pack, id);
      if (this.active) { this.message = operation.message; await this.reload(); }
    } catch (cause) { if (this.active) this.message = this.reason(cause as Error); }
    finally { if (this.active) this.busy = false; }
  }
  @Builder
  editor() {
    AppCard({ color: Theme.sky }) {
      Text(`当前草稿 · ${this.pack.workspace.points.find((row) => row.id === this.draft!.target.pointId)?.name ?? this.draft!.target.pointId}`)
        .fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      TextInput({ text: this.draft!.anomalyType, placeholder: '异常类型' }).fontSize(16).height(controlHeight(54, this.textScale))
        .maxLength(80).enabled(!this.busy).onChange((value) => this.edit('type', value)).id('offline-report-type');
      TextArea({ text: this.draft!.description, placeholder: '现场观察；比赛素材请标明模拟' }).fontSize(16).height(controlHeight(160, this.textScale))
        .maxLength(4000).enabled(!this.busy).onChange((value) => this.edit('description', value)).id('offline-report-description');
      Text(this.saving ? '正在写入本机，完成前请勿强制结束应用。' : '文本自动保存于本机；没有自动提交服务端。').fontSize(13).fontColor(Theme.warning);
      ForEach(this.draft!.photos, (photo: DurablePhoto) => {
        Image(photo.uri).width('100%').height(180).objectFit(ImageFit.Contain).accessibilityText('本机持久照片，尚未上传');
        PlayButton({ title: '从草稿移除此照片', secondary: true, available: !this.busy, onAction: () => this.removePhoto(photo.draftId) });
      }, (photo: DurablePhoto) => photo.draftId);
      PlayButton({ title: `相册选图 · ${this.draft!.photos.length}/3`, secondary: true, available: !this.busy && this.draft!.photos.length < 3,
        controlId: 'offline-report-album', onAction: () => this.choosePhoto('album') });
      PlayButton({ title: '拍照（设备能力可用时）', secondary: true, available: !this.busy && this.draft!.photos.length < 3,
        controlId: 'offline-report-camera', onAction: () => this.choosePhoto('camera') });
      PlayButton({ title: '保存并加入待同步队列', available: !this.busy, controlId: 'offline-report-enqueue', onAction: () => this.enqueue() });
    }
  }
  build() {
    Column({ space: 18 }) {
    AppCard({ color: Theme.cream }) {
      Text('离线发现，也有来处').fontSize(21).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text('独立现场上报；位置取自随身包。入队后内容固定，上传前会重新核验当前身份与范围。').fontSize(14).fontColor(Theme.secondary);
      Select(this.pack.workspace.points.filter((row) => row.status === 'active').map((row): SelectOption => ({ value: row.name })))
        .height(controlHeight(50, this.textScale)).width('100%')
        .value(this.pack.workspace.points.find((row) => row.id === this.pointId)?.name ?? '请选择测点')
        .onSelect((index: number) => { this.pointId = this.pack.workspace.points.filter((row) => row.status === 'active')[index]?.id ?? ''; })
        .enabled(!this.busy).id('offline-report-point');
      PlayButton({ title: '新建独立上报草稿', secondary: true, available: !this.busy && !!this.pointId, controlId: 'offline-report-new', onAction: () => this.create() });
      if (this.message) { Text(this.message).fontSize(15).fontColor(Theme.brand).id('offline-report-feedback'); }
    }
    if (this.draft) { this.editor(); }
    ForEach(this.drafts.filter((row) => row.phase === 'editing').slice(-20), (row: OfflineReport) => {
      PlayButton({ title: `继续本机草稿 · ${row.anomalyType || row.id}`, secondary: true, available: !this.busy,
        onAction: () => this.openDraft(row.id) });
    }, (row: OfflineReport) => row.id);
    PlayButton({ title: '刷新本机草稿与队列', secondary: true, available: !this.busy, onAction: () => this.reload(), controlId: 'offline-outbox-refresh' });
    OutboxCards({ rows: this.operations, busy: this.busy, online: this.online(), onSync: (id) => this.sync(id) });
    }.width('100%').alignItems(HorizontalAlign.Start);
  }
}
