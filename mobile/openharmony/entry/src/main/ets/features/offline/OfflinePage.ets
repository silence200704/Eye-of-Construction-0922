import common from '@ohos.app.ability.common';
import { AppState } from '../../shared/state/AppState';
import { OfflineVault } from '../../core/offline/OfflineVault';
import { NativeLocalSql } from '../../core/offline/NativeLocalSql';
import { OfflinePack, scopeKey } from '../../core/offline/OfflineModels';
import { ConnectionPreferences } from '../../core/storage/ConnectionPreferences';
import { authorizationOf } from '../../core/identity/authorization';
import { ApiError } from '../../core/network/ApiError';
import { InspectionTask } from '../../data/models/Tasks';
import { Point } from '../../data/models/Monitoring';
import { Theme } from '../../shared/theme/Theme';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { latestRecord, reading, timeText } from '../../shared/format/display';
import { controlHeight } from '../../shared/layout/ReadingLayout';

@Component
export struct OfflinePage {
  @Prop @Watch('identityChanged') state: AppState;
  @State pack: OfflinePack | null = null;
  @State text: string = '';
  @State taskId: string = '';
  @State noteRev: number = 0;
  @State message: string = '';
  @State busy: boolean = false;
  @State page: number = 0;
  @State monitoring: boolean = false;
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  private vault: OfflineVault | undefined = undefined;
  private settings: ConnectionPreferences | undefined = undefined;
  private generation: number = 0;
  private stamp: string = '';

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.vault = new OfflineVault(new NativeLocalSql(context)); this.settings = new ConnectionPreferences(context);
    this.identityChanged();
  }
  aboutToDisappear(): void { this.generation++; this.vault?.close().catch(() => {}); }
  identityChanged(): void {
    if (!this.vault) return;
    const stamp = `${this.state.baseUrl}|${this.state.user ? authorizationOf(this.state.user) : this.state.mode}|${this.state.workspace.epoch}`;
    if (stamp === this.stamp) return;
    this.stamp = stamp; this.load();
  }
  reason(cause: Error): string {
    return cause instanceof ApiError ? cause.message : '本机读取或保存失败，请保留数据后重试。';
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.pack = null; this.taskId = ''; this.text = ''; this.page = 0; this.message = '';
    if (this.state.busy) { this.busy = false; this.message = '正在切换身份，请稍候再打开随身包。'; return; }
    this.busy = true;
    try {
      const saved = await this.settings!.load();
      if (generation !== this.generation) return;
      const base = this.state.baseUrl || saved.baseUrl, owner = this.state.user?.id ?? saved.identityId;
      if (!base || !owner) throw new ApiError('NO_OFFLINE_OWNER', '请先在线连接并选择身份，再下载随身包。');
      const pack = await this.vault!.open(base, owner);
      if (generation !== this.generation) return;
      if (pack && this.state.user && pack.scope !== scopeKey({ baseUrl: base, user: this.state.user, workspace: this.state.workspace })) {
        this.message = '在线身份范围或数据版本已变化，请重新下载；旧笔记保留。'; return;
      }
      this.pack = pack; this.message = pack ? '已读取本机随身包，当前服务端权限仍须联网核验。' : '本机没有该服务、身份的随身包，请在线下载。';
    } catch (cause) { if (generation === this.generation) this.message = this.reason(cause as Error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async download(): Promise<void> {
    if (this.busy || this.state.mode !== 'ready' || !this.state.user) return;
    const generation = ++this.generation; this.busy = true;
    try {
      const pack = await this.vault!.download({ baseUrl: this.state.baseUrl, user: this.state.user, workspace: this.state.workspace });
      if (generation !== this.generation) return;
      this.pack = pack; this.taskId = ''; this.text = ''; this.page = 0;
      this.message = '随身包已写入本机关系库；下载不改变服务端业务状态。';
    } catch (cause) { if (generation === this.generation) this.message = this.reason(cause as Error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async choose(taskId: string): Promise<void> {
    if (this.busy || !this.pack) return;
    const generation = this.generation; this.busy = true;
    try {
      if (this.taskId) await this.vault!.saveNote(this.pack, this.taskId, this.text);
      const note = await this.vault!.note(this.pack, taskId);
      if (generation !== this.generation) return;
      this.taskId = taskId; this.text = note?.text ?? ''; this.noteRev = note?.expectedRev ?? 0;
      this.message = note ? '已恢复本地笔记，尚未提交服务端。' : '可记录现场观察；点保存后写入本机。';
    } catch (cause) { if (generation === this.generation) this.message = this.reason(cause as Error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async save(): Promise<void> {
    if (this.busy || !this.pack || !this.taskId) return;
    const generation = this.generation; this.busy = true;
    try {
      const note = await this.vault!.saveNote(this.pack, this.taskId, this.text);
      if (generation !== this.generation) return;
      this.noteRev = note.expectedRev; this.message = '仅本地已保存，尚未同步；没有完成检查或修改服务端任务。';
    } catch (cause) { if (generation === this.generation) this.message = this.reason(cause as Error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  @Builder
  summary() {
    AppCard({ color: Theme.cream }) {
      Text(`离线身份：${this.pack!.user.roleLabel} · ${this.pack!.user.name}`).fontSize(18).fontColor(Theme.text);
      Text(`快照时间 ${timeText(this.pack!.downloadedAt)} · 数据版本 ${this.pack!.workspace.epoch}`).fontSize(13).fontColor(Theme.secondary);
      Text(`服务 ${this.pack!.baseUrl}`).fontSize(12).fontColor(Theme.secondary);
      Text('历史下载快照，不是实时数据；离线时无法确认最新权限。未下载内容不可用，预警不在本机确认或关闭。')
        .fontSize(14).fontColor(Theme.warning);
      Row({ space: 12 }) {
        PlayButton({ title: '已下载任务', secondary: this.monitoring, controlId: 'offline-tasks',
          onAction: () => { this.monitoring = false; this.page = 0; } }).layoutWeight(1);
        PlayButton({ title: '缓存监测', secondary: !this.monitoring, controlId: 'offline-monitoring',
          onAction: () => { this.monitoring = true; this.page = 0; } }).layoutWeight(1);
      }
    }
  }
  @Builder
  notes() {
    if (this.taskId) {
      AppCard({ color: Theme.soft }) {
        Text('现场笔记 · 仅在本机').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text(`任务 ${this.taskId} · 笔记依据版本 ${this.noteRev || this.pack!.workspace.tasks.find((row) => row.id === this.taskId)?.rev}`)
          .fontSize(13).fontColor(Theme.secondary);
        if (this.noteRev && this.noteRev !== this.pack!.workspace.tasks.find((row) => row.id === this.taskId)?.rev) {
          Text('任务已下载新版本，原笔记仍保留旧依据；后续同步前必须核对冲突。').fontSize(14).fontColor(Theme.warning);
        }
        TextArea({ text: this.text, placeholder: '记录现场观察；不是已提交的检查清单' }).height(controlHeight(150, this.textScale))
          .fontSize(16).maxLength(4000).enabled(!this.busy).onChange((value) => { this.text = value; }).id('offline-note');
        Text('点保存后才写入本机；尚不自动提交、上传照片或完成检查。').fontSize(13).fontColor(Theme.warning);
        PlayButton({ title: '保存到本机', available: !this.busy, controlId: 'offline-save', onAction: () => this.save() });
      }
    }
  }
  @Builder
  content() {
    if (this.monitoring) {
      ForEach(this.pack!.workspace.points.slice(this.page * 20, (this.page + 1) * 20), (point: Point) => {
        AppCard() {
          Text(point.name).fontSize(18).fontColor(Theme.text);
          Text(reading(latestRecord(this.pack!.workspace, point.id), point.type)).fontSize(21).fontColor(Theme.brand);
          Text(`缓存采样 ${timeText(latestRecord(this.pack!.workspace, point.id)?.sampleTime)} · 非实时 · 硬件输入模拟`)
            .fontSize(13).fontColor(Theme.warning);
        }
      }, (point: Point) => point.id);
    } else {
      this.notes();
      ForEach(this.pack!.workspace.tasks.slice(this.page * 20, (this.page + 1) * 20), (task: InspectionTask) => {
        PlayButton({ title: `${task.taskNo} · 本地笔记`, secondary: true, available: !this.busy,
          controlId: `offline-task-${task.id}`, onAction: () => this.choose(task.id) });
      }, (task: InspectionTask) => task.id);
    }
    Text(`已缓存 ${this.pack!.workspace.tasks.length} 条任务 / ${this.pack!.workspace.points.length} 个测点；每页20项`)
      .fontSize(13).fontColor(Theme.secondary);
    PlayButton({ title: '上一页', secondary: true, available: !this.busy && this.page > 0, onAction: () => { this.page--; }, controlId: 'offline-previous' });
    PlayButton({ title: '下一页', secondary: true, available: !this.busy && (this.page + 1) * 20 <
      (this.monitoring ? this.pack!.workspace.points.length : this.pack!.workspace.tasks.length), onAction: () => { this.page++; }, controlId: 'offline-next' });
  }
  build() {
    PageStage() {
      PageHeading({ title: '把任务，带在身边', subtitle: '离线随身包 · 本机关系库', kicker: 'OFFLINE / 随身手账' });
      PlayButton({ title: '下载当前身份随身包', available: !this.busy && this.state.mode === 'ready',
        controlId: 'offline-download', onAction: () => this.download() });
      PlayButton({ title: '读取本机随身包', secondary: true, available: !this.busy, controlId: 'offline-load', onAction: () => this.load() });
      if (this.message) { Text(this.message).fontSize(15).fontColor(Theme.brand).id('offline-feedback'); }
      if (this.pack) { this.summary(); this.content(); }
    }
  }
}
