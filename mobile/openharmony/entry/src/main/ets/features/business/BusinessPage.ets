import { ChecklistAnswer } from '../../data/models/Tasks';
import { PhotoLink } from '../../data/models/Reports';
import common from '@ohos.app.ability.common';
import { AppState } from '../../shared/state/AppState';
import { BusinessDraft, businessWrite, businessFormKey } from '../../core/business/BusinessDraft';
import { BusinessSession } from '../../core/business/BusinessSession';
import { BusinessState, BusinessResult } from '../../core/business/BusinessModels';
import { BusinessStore } from '../../core/business/BusinessStore';
import { BusinessPhoto, uploadBusinessPhotos } from '../../core/business/BusinessPhotos';
import { NativeDurableFiles } from '../../core/offline/media/NativeDurableFiles';
import { PhotoSelector } from '../../core/media/PhotoSelector';
import { scopeKey } from '../../core/offline/OfflineModels';
import { TaskAccess } from '../../core/field/TaskCommander';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
import { ReviewFields } from './ReviewFields';
import { OrderFields } from './OrderFields';
import { RecheckFields } from './RecheckFields';
import { MaintenanceFields } from './MaintenanceFields';
import { ReportFields } from './ReportFields';
import { FieldQueue } from '../../core/offline/field/FieldQueue';
import { orderAllowed } from '../../core/field/OrderPolicy';

interface SavedBusinessForm { draft: BusinessDraft; photos: BusinessPhoto[]; }
interface BudgetAttachment { issueId: string | null; workOrderId: string | null; maintenanceTaskId: string | null; size: number; }
@Component
export struct BusinessPage {
  @Prop state: AppState;
  @Prop initial: string;
  store: BusinessStore | undefined = undefined;
  queue: FieldQueue | undefined = undefined;
  access: () => TaskAccess | null = () => null;
  onExternal: (active: boolean) => void = () => {};
  onResult: (result: BusinessResult) => void = () => {};
  onDone: () => void = () => {};
  onDraft: (scope: string, key: string) => void = () => {};
  onAsk: (draft: BusinessDraft) => void = () => {};
  @State draft: BusinessDraft = new BusinessDraft();
  @State photos: BusinessPhoto[] = [];
  @State command: BusinessState = new BusinessState();
  @State message: string = '';
  @State saving: boolean = false;
  @State picking: boolean = false;
  private session: BusinessSession | undefined = undefined;
  private files: NativeDurableFiles | undefined = undefined;
  private selector: PhotoSelector | undefined = undefined;
  private active: boolean = false;
  private scope: string = '';
  private target: string = '';
  private saveVersion: number = 0;
  @State queued: boolean = false;
  aboutToAppear(): void { this.active = true; void this.initialize(); }
  aboutToDisappear(): void { this.active = false; this.session?.deactivate(); }
  async initialize(): Promise<void> {
    try {
      this.draft = JSON.parse(this.initial) as BusinessDraft;
      if (!this.state.user) return;
      this.scope = scopeKey({ baseUrl: this.state.baseUrl, user: this.state.user, workspace: this.state.workspace });
      this.target = businessFormKey(this.draft);
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.files = new NativeDurableFiles(context.filesDir); this.selector = new PhotoSelector(context);
      const saved = await this.store?.form(this.scope, this.target);
      if (!this.active) return;
      if (saved) { const data = JSON.parse(saved) as SavedBusinessForm; this.draft = data.draft; this.photos = data.photos; }
      await this.readBudget();
      if (!this.active) return;
      this.session = new BusinessSession({ access: this.access, journal: this.store?.journal(),
        onChange: (view) => { if (this.active) this.command = view; }, onResult: this.onResult });
      await this.session.restore();
      if (this.draft.kind === 'order' && this.draft.action === 'repairing' && !saved &&
        this.state.workspace.orders.find((row) => row.id === this.draft.targetId)?.assigneeId === this.state.user?.id && this.command.phase !== 'unknown') {
        await this.submit();
      }
    } catch (_) { if (this.active) this.message = '本地草稿暂不可读取，请保留数据后重新打开。'; }
  }
  async readBudget(): Promise<void> {
    const access = this.access(); if (!access || !this.draft.targetId) return;
    try {
      const response = await access.client.send<BudgetAttachment[]>('/datasets/demo-main/attachments');
      if (!this.active || this.access()?.client !== access.client || response.meta?.datasetEpoch !== access.workspace.epoch) return;
      const rows = response.data.filter((row) => this.draft.kind === 'order' ? row.workOrderId === this.draft.targetId :
        this.draft.kind === 'maintenance' ? row.maintenanceTaskId === this.draft.targetId : row.issueId === this.draft.targetId);
      const draft = JSON.parse(JSON.stringify(this.draft)) as BusinessDraft;
      draft.existingPhotoCount = rows.length; draft.existingPhotoBytes = rows.reduce((total, row) => total + row.size, 0);
      const issue = this.state.workspace.issues.find((row) => row.id === draft.targetId);
      draft.requirePhoto = draft.kind === 'supplement' && issue?.reviewCategory === 'image'; this.draft = draft;
    } catch (_) { this.message = '暂未取得已有照片配额，提交时服务端会再次核验。'; }
  }
  locked(): boolean { return this.queued || this.picking || ['sending', 'unknown', 'done'].includes(this.command.phase); }
  async save(): Promise<void> {
    const version = ++this.saveVersion; this.saving = true;
    try {
      if (!this.store) throw new Error('本地存储尚未就绪');
      const saved: SavedBusinessForm = { draft: this.draft, photos: this.photos };
      await this.store.saveForm(this.scope, this.target, JSON.stringify(saved));
      if (this.active && !this.locked()) this.onDraft(this.scope, this.target);
      if (this.active && version === this.saveVersion) this.message = '草稿已保存在本机。';
    } catch (_) { if (this.active) this.message = '草稿未保存，请勿离开页面。'; }
    finally { if (version === this.saveVersion) this.saving = false; }
  }
  field(key: string, value: string): void {
    const draft = JSON.parse(JSON.stringify(this.draft)) as BusinessDraft;
    const data = draft as Object as Record<string, string | number | boolean>;
    data[key] = key === 'createIssue' ? value === 'true' : value.slice(0, 4000);
    if (key === 'action') draft.category = value === 'to_repair' ? 'equipment' : value === 'to_investigate' ? 'crack' :
      value === 'recheck' ? 'unclear' : value === 'need_evidence' ? 'image' : value === 'link_object' ? 'issue' : 'no_fault';
    this.draft = draft; void this.save();
  }
  async ask(): Promise<void> {
    if (this.locked()) return;
    await this.save(); if (this.active) this.onAsk(this.draft);
  }
  answer(key: string, value: string, note: boolean): void {
    const draft = JSON.parse(JSON.stringify(this.draft)) as BusinessDraft;
    draft.answers = draft.answers.map((row): ChecklistAnswer => ({ key: row.key, label: row.label,
      result: row.key === key && !note ? value : row.result, note: row.key === key && note ? value : row.note }));
    this.draft = draft; void this.save();
  }
  async choose(source: string): Promise<void> {
    if (this.locked() || this.photos.length + (this.draft.existingPhotoCount ?? 0) >= 3) return;
    this.picking = true; this.onExternal(true);
    try {
      const picked = await this.selector?.choose(source);
      if (!picked) return;
      try {
        const durable = await this.files!.save(picked);
        if (!this.active) return;
        const photo: BusinessPhoto = { draftId: durable.draftId, path: durable.path, uri: durable.uri, fileName: durable.fileName,
          mimeType: durable.mimeType, source: durable.source, size: durable.size, sha256: durable.sha256,
          kind: this.draft.kind === 'order' ? this.draft.action === 'submitted' ? 'after' : 'acceptance' : 'scene', mediaId: '' };
        this.photos = [...this.photos, photo]; await this.save();
      } finally { this.selector?.dispose(picked); }
    } catch (_) { this.message = '照片未添加，可能取消、无权限或保存失败；文字已保留。'; }
    finally { this.picking = false; this.onExternal(false); }
  }
  async submit(): Promise<void> {
    if (this.locked()) return;
    const access = this.access();
    if (!access) { this.message = '当前离线，草稿已保留。联网后核对状态再提交。'; return; }
    this.picking = true;
    try {
      if (this.draft.kind === 'order' && this.draft.action === 'submitted') {
        const order = access.workspace.orders.find((row) => row.id === this.draft.targetId);
        if (!order || !orderAllowed(order, access.user, 'submitted')) throw new Error('维修草稿已保留。先联网接单，再核对最新版本并提交完工。');
      }
      this.draft.photos = this.photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId || 'pending', draftId: photo.draftId, kind: photo.kind }));
      businessWrite(this.draft);
      this.draft.photos = await uploadBusinessPhotos(this.photos, { access, current: this.access, files: this.files!, pointId: this.draft.pointId, save: async () => this.save() });
      if (!this.active) return;
      await this.session?.submit(businessWrite(this.draft));
      if (this.command.phase === 'done') await this.store?.saveForm(this.scope, this.target, '');
    } catch (cause) { if (this.active) this.message = (cause as Error).message; }
    finally { this.picking = false; }
    if (this.active && this.command.phase === 'done' && (this.draft.kind === 'manual' ||
      this.draft.kind === 'review' && this.draft.action === 'to_repair' || this.draft.kind === 'order' && this.draft.action === 'repairing')) this.onDone();
  }
  async enqueue(): Promise<void> {
    if (this.locked() || this.queued || !this.queue) return;
    this.picking = true;
    try {
      const access = this.access();
      if (this.draft.kind === 'order' && this.draft.action === 'submitted') {
        const order = this.state.workspace.orders.find((row) => row.id === this.draft.targetId);
        if (order?.status !== 'repairing' || order.acceptedById !== this.state.user?.id) throw new Error('先联网确认本人接单，才能排队提交完工。');
      }
      this.draft.photos = this.photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId || 'pending', draftId: photo.draftId, kind: photo.kind }));
      const write = businessWrite(this.draft);
      await this.queue.enqueue(this.scope, write, [], this.photos);
      this.queued = true; this.message = '已入同步队列，服务端尚未确认；本次内容已冻结。';
      await this.store?.saveForm(this.scope, this.target, '');
    } catch (cause) { this.message = (cause as Error).message; }
    finally { this.picking = false; }
  }
  adopt(): void {
    const initial = JSON.parse(this.initial) as BusinessDraft;
    const current = this.draft.kind === 'order' ? this.state.workspace.orders.find((row) => row.id === this.draft.targetId) :
      this.draft.kind === 'maintenance' ? this.state.workspace.maintenance?.find((row) => row.id === this.draft.targetId) :
      this.state.workspace.issues.find((row) => row.id === this.draft.targetId);
    const draft = JSON.parse(JSON.stringify(this.draft)) as BusinessDraft; draft.rev = current?.rev ?? initial.rev;
    this.draft = draft; this.command = new BusinessState(); void this.save();
  }
  currentSummary(): string {
    const order = this.state.workspace.orders.find((row) => row.id === this.draft.targetId);
    if (this.draft.kind === 'order' && order) return `服务端：${order.status} · ${order.assignee || '待派工'} · 版本 ${order.rev}\n措施：${order.measures || '尚未登记'}`;
    const issue = this.state.workspace.issues.find((row) => row.id === this.draft.targetId);
    return issue ? `服务端：${issue.status} · 版本 ${issue.rev}\n审核：${issue.reviewNote || '暂无意见'}` : '请返回详情读取最新进度，再核对本机草稿。';
  }
  @Builder
  evidence() {
    AppCard({ color: Theme.sky }) {
      Text('照片证据 · 持久保存在本机').fontSize(17).fontColor(Theme.text);
      Text(`已有 ${this.draft.existingPhotoCount ?? 0} 张 · 本次 ${this.photos.length} 张 · 剩余 ${Math.max(0, 3 - (this.draft.existingPhotoCount ?? 0) - this.photos.length)} 张`)
        .fontSize(13).fontColor(Theme.brand);
      ForEach(this.photos, (photo: BusinessPhoto) => {
        Image(photo.uri).height(160).width('100%').objectFit(ImageFit.Contain);
        Text(photo.kind === 'acceptance' ? '验收照片' : photo.kind === 'after' ? '维修后' : photo.kind === 'before' ? '维修前' : '现场照片').fontSize(14).fontColor(Theme.brand);
        if (this.draft.kind === 'order' && this.draft.action === 'submitted') {
          PlayButton({ title: '切换维修前 / 后', secondary: true, available: !this.locked(), onAction: () => {
            photo.kind = photo.kind === 'before' ? 'after' : 'before'; this.photos = [...this.photos]; void this.save(); } });
        }
        PlayButton({ title: '移除此张', secondary: true, available: !this.locked(), onAction: () => {
          this.photos = this.photos.filter((row) => row.draftId !== photo.draftId); void this.save(); } });
      });
      PlayButton({ title: '从相册添加', secondary: true, available: !this.locked() && this.photos.length + (this.draft.existingPhotoCount ?? 0) < 3, onAction: () => this.choose('album') });
      PlayButton({ title: '拍照添加', secondary: true, available: !this.locked() && this.photos.length + (this.draft.existingPhotoCount ?? 0) < 3, onAction: () => this.choose('camera') });
      Text('同一业务已有与新增照片共同受3张/600KB限制，服务端会再次校验。').fontSize(12).fontColor(Theme.secondary);
    }
  }
  build() {
    PageStage() {
      PageHeading({ title: this.draft.kind === 'review' ? '让每份发现，有下一步' : this.draft.kind === 'order' ? '把这份工单，交接清楚' :
        this.draft.kind === 'manual' ? '新建一份维修安排' : this.draft.kind === 'maintenance' ? '给设备，一次认真照料' : '认真复查，记录变化',
        subtitle: '草稿自动保存 · 正式结果以服务端确认为准', kicker: 'CARE / 业务办理' });
      PlayButton({ title: '问小瞳，帮我整理办理说明', secondary: true, available: !this.locked(), onAction: () => this.ask() });
      if (['report', 'supplement'].includes(this.draft.kind)) { ReportFields({ draft: this.draft, locked: this.locked() || this.queued, onField: (k, v) => this.field(k, v) }); }
      else if (this.draft.kind === 'review') { ReviewFields({ draft: this.draft, state: this.state, locked: this.locked(), onField: (k, v) => this.field(k, v) }); }
      else if (['order', 'manual'].includes(this.draft.kind)) { OrderFields({ draft: this.draft, state: this.state, locked: this.locked(), onField: (k, v) => this.field(k, v) }); }
      else if (this.draft.kind === 'maintenance') {
        MaintenanceFields({ draft: this.draft, locked: this.locked(), items: this.state.workspace.maintenance?.find((row) => row.id === this.draft.targetId)?.snapshot.checklist ?? [],
          onField: (k, v) => this.field(k, v), onAnswer: (k, v, n) => this.answer(k, v, n) });
      } else { RecheckFields({ draft: this.draft, locked: this.locked(), onField: (k, v) => this.field(k, v) }); }
      if (['report', 'supplement', 'review', 'maintenance'].includes(this.draft.kind) || this.draft.kind === 'order' && ['submitted', 'verified', 'returned'].includes(this.draft.action)) { this.evidence(); }
      AppCard() {
        Text(this.saving ? '正在保存本机草稿…' : this.message).fontSize(14).fontColor(Theme.secondary);
        Text(this.command.message).fontSize(15).fontColor(this.command.phase === 'done' ? Theme.brand : Theme.warning).id('business-feedback');
        if (this.command.phase === 'unknown') {
          PlayButton({ title: '用原请求核验办理结果', onAction: () => this.session?.retry(), controlId: 'business-retry' });
        } else if (this.command.phase === 'done') {
          PlayButton({ title: '查看结果，继续下一步', onAction: this.onDone, controlId: 'business-done' });
        } else if (this.command.phase === 'conflict') {
          Text(this.currentSummary()).fontSize(15).fontColor(Theme.text);
          Text(`本机依据版本 ${this.draft.rev}；服务端最新进度请查看来源详情。原内容保留。`).fontSize(14).fontColor(Theme.warning);
          PlayButton({ title: '已核对，采用当前版本', secondary: true, onAction: () => this.adopt() });
        } else {
          PlayButton({ title: this.picking ? '正在处理…' : '确认提交本次办理', available: !this.locked() && !this.queued, onAction: () => this.submit(), controlId: 'business-submit' });
          if (['report', 'supplement', 'maintenance'].includes(this.draft.kind) || this.draft.kind === 'order' && this.draft.action === 'submitted') {
            PlayButton({ title: this.queued ? '已入队，等待服务端确认' : '保存为待同步办理', secondary: true, available: !this.locked() && !this.queued, onAction: () => this.enqueue() });
          }
        }
      }
    }
  }
}
