import { OfflineOperation } from '../../core/offline/queue/QueueModels';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';

@Component
export struct OutboxCards {
  @Prop rows: OfflineOperation[] = [];
  @Prop busy: boolean = false;
  @Prop online: boolean = false;
  @State page: number = 0;
  onSync: (id: string) => void = () => {};
  label(row: OfflineOperation): string {
    const phase = row.phase;
    if (phase === 'done') return '服务端已确认';
    if (phase === 'queued') return '本地已入队，待同步';
    if (phase === 'waiting' && !row.uncertain) return '等待连接，尚未发出提交';
    if (['sending', 'uploading', 'waiting'].includes(phase)) return '结果待核验，保留原请求重试';
    if (phase === 'blocked') return '权限待核对，原稿保留';
    if (phase === 'conflict') return '请求冲突，请联网核对';
    if (phase === 'isolated') return '数据已复位，旧操作隔离';
    return '不能自动重试，原稿保留';
  }
  build() {
    Column({ space: 18 }) {
    Text('同步手账').fontSize(21).fontWeight(FontWeight.Bold).fontColor(Theme.text);
    if (!this.rows.length) { Text('还没有入队操作，保存草稿不会自动提交。').fontSize(14).fontColor(Theme.secondary); }
    ForEach(this.rows.slice(this.page * 20, (this.page + 1) * 20), (row: OfflineOperation) => {
      AppCard({ color: row.phase === 'done' ? Theme.soft : Theme.cream }) {
        Text(this.label(row)).fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.brand);
        Text(row.request.anomalyType).fontSize(16).fontColor(Theme.text);
        Text(row.request.description).fontSize(14).fontColor(Theme.secondary);
        Text(row.message).fontSize(14).fontColor(Theme.secondary);
        Text(`照片已登记 ${row.uploaded.length}/${row.request.photos.length} · 尝试 ${row.attempts}/5`).fontSize(13).fontColor(Theme.secondary);
        if (row.issueId) { Text(`问题编号 ${row.issueNo}；不等于问题已关闭。`).fontSize(14).fontColor(Theme.brand); }
        if (!['done', 'conflict', 'failed', 'isolated'].includes(row.phase) && row.attempts < 5) {
          PlayButton({ title: row.phase === 'blocked' ? '重新核对权限并同步' : '用原请求同步 / 核验', secondary: true,
            available: this.online && !this.busy, controlId: `outbox-sync-${row.id}`, onAction: () => this.onSync(row.id) });
        }
        if (row.attempts >= 5 && row.phase !== 'done') { Text('已达本轮重试上限；请先联网核查原操作，勿重复新建。').fontSize(13).fontColor(Theme.warning); }
      }
    }, (row: OfflineOperation) => row.id);
    if (this.rows.length > 20) {
      PlayButton({ title: '上一页同步记录', secondary: true, available: !this.busy && this.page > 0,
        onAction: () => { this.page--; }, controlId: 'outbox-previous' });
      PlayButton({ title: '下一页同步记录', secondary: true, available: !this.busy && (this.page + 1) * 20 < this.rows.length,
        onAction: () => { this.page++; }, controlId: 'outbox-next' });
    }
    }.width('100%').alignItems(HorizontalAlign.Start);
  }
}
