import { FieldQueue } from '../../core/offline/field/FieldQueue';
import { FieldOperation } from '../../core/offline/field/FieldModels';
import { FieldExecutor } from '../../core/offline/field/FieldExecutor';
import { TaskAccess } from '../../core/field/TaskCommander';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
@Component
export struct FieldSync {
  @Prop scope: string;
  @Prop @Watch('reload') tick: string = '';
  queue: FieldQueue | undefined = undefined;
  executor: FieldExecutor | undefined = undefined;
  access: () => TaskAccess | null = () => null;
  onResolve: (row: FieldOperation) => void = () => {};
  onResume: (scope: string) => void = () => {};
  @State rows: FieldOperation[] = [];
  @State busy: boolean = false;
  @State message: string = '';
  @State page: number = 0;
  private active: boolean = false;
  aboutToAppear(): void { this.active = true; void this.reload(); }
  aboutToDisappear(): void { this.active = false; }
  async reload(): Promise<void> {
    try { const rows = await this.queue?.list(this.scope); if (this.active) this.rows = rows ?? []; }
    catch (_) { if (this.active) this.message = '本地队列暂不可读取，请保留数据。'; }
  }
  async sync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { if (!this.access()) throw new Error('当前离线；本地内容已保留，请联网后重试。'); this.onResume(this.scope); await this.executor?.sync(this.scope); await this.reload(); }
    catch (cause) { this.message = (cause as Error).message; }
    finally { this.busy = false; }
  }
  text(row: FieldOperation): string {
    const body = JSON.parse(row.body || row.write.body) as Record<string, string | number>;
    return String(body['description'] ?? body['measures'] ?? body['note'] ?? (row.write.path.endsWith('check-in') ? '到点核对' : '检查清单'));
  }
  status(row: FieldOperation): string {
    if (row.phase === 'done') return '服务端已保存';
    if (row.phase === 'conflict') return '版本或状态冲突，等待核对';
    if (row.phase === 'isolated') return '数据已复位，旧操作已隔离';
    if (row.phase === 'blocked') return '权限待核对，已暂停';
    if (row.phase === 'cancelled') return '已放弃原办理，历史保留';
    if (row.phase === 'failed') return '无法提交，请检查内容';
    return row.sent ? '办理结果待核验' : '本地已保存，待同步';
  }
  build() {
    Column({ space: 16 }) {
      AppCard({ color: Theme.sky }) {
        Text('同步中心 · 每一步都有回音').fontSize(22).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('只有服务端确认后才算提交完成；未知结果使用原请求核验。').fontSize(14).fontColor(Theme.secondary);
        Text('切回原身份后，点击下方同步按钮确认恢复该身份队列。').fontSize(13).fontColor(Theme.secondary);
        Text(this.message).fontSize(14).fontColor(Theme.warning);
        PlayButton({ title: this.busy ? '正在核验与同步…' : '核验权限并同步当前队列', available: !this.busy, onAction: () => this.sync() });
        PlayButton({ title: '刷新本机进度', secondary: true, available: !this.busy, onAction: () => this.reload() });
      }
      ForEach(this.rows.slice(this.page * 20, (this.page + 1) * 20), (row: FieldOperation) => {
        AppCard({ color: row.phase === 'done' ? Theme.soft : row.phase === 'conflict' ? Theme.peach : Theme.cream }) {
          Text(this.status(row)).fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(this.text(row)).fontSize(15).fontColor(Theme.secondary);
          Text(`${row.photos.length} 张照片 · 已尝试 ${row.attempts} 次`).fontSize(12).fontColor(Theme.secondary);
          Text(row.message).fontSize(14).fontColor(Theme.warning);
          if (row.dependencies.length && row.phase !== 'done') { Text('前一步服务端确认后才继续；前一步冲突或到点失败时不会越过。').fontSize(12).fontColor(Theme.secondary); }
          if (row.phase === 'conflict' || row.phase === 'failed') {
            PlayButton({ title: '打开最新对象与原内容，核对后重新办理', secondary: true, onAction: () => this.onResolve(row) });
          }
          if (row.attempts >= 5 && !['done', 'conflict', 'failed', 'isolated'].includes(row.phase)) {
            Text('已到自动重试上限，请核对服务；仍使用原请求核验。').fontSize(13).fontColor(Theme.warning);
            PlayButton({ title: '已排查连接，继续核验原请求', secondary: true, available: !this.busy, onAction: async () => {
              await this.queue?.retry(row.id, this.scope); await this.sync(); } });
          }
        }
      });
      if (!this.rows.length) { Text('本身份暂无待同步现场办理。').fontSize(16).fontColor(Theme.secondary); }
      PlayButton({ title: '上一页', secondary: true, available: this.page > 0, onAction: () => { this.page--; } });
      PlayButton({ title: '下一页', secondary: true, available: (this.page + 1) * 20 < this.rows.length, onAction: () => { this.page++; } });
    }.width('100%');
  }
}
