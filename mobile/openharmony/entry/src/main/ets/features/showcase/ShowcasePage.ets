import { AppState } from '../../shared/state/AppState';
import { TaskAccess } from '../../core/field/TaskCommander';
import { selectedDataset } from '../../core/network/DatasetSelection';
import { BusinessStore } from '../../core/business/BusinessStore';
import { ownerKey } from '../../core/offline/OfflineModels';
import { reportId } from '../../core/report/ReportDraft';
import { PageStage } from '../../shared/playful/PageStage';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
interface ShowcaseStatus { runId: string; phase: string; epoch: number; counts: Record<string, number>; source: string; }
interface ShowcasePending { action: string; key: string; epoch: number; body?: string; }
@Component
export struct ShowcasePage {
  @Prop state: AppState;
  store: BusinessStore | undefined = undefined;
  access: () => TaskAccess | null = () => null;
  onReload: (reset: boolean) => void = () => {};
  @State status: ShowcaseStatus | null = null;
  @State busy: boolean = false;
  @State message: string = '';
  @State pending: ShowcasePending | null = null;
  @State sensor: string = 'crack';
  @State level: string = 'yellow';
  private active: boolean = false;
  private scope: string = '';
  aboutToAppear(): void { this.active = true; void this.load(); }
  aboutToDisappear(): void { this.active = false; }
  allowed(): boolean { return selectedDataset() === 'demo-showcase' && this.state.user?.role === 'safety' && this.state.user.buildingIds === null; }
  async load(): Promise<void> {
    const access = this.access(); if (!access || !this.allowed()) return;
    this.scope = `showcase:${ownerKey(access.baseUrl, access.user.id)}`;
    try {
      const response = await access.client.send<ShowcaseStatus>('/datasets/demo-main/showcase/status');
      if (!this.active || this.access()?.client !== access.client) return;
      this.status = response.data;
      const raw = await this.store?.form(this.scope, 'showcase-command');
      if (this.active && raw) this.pending = JSON.parse(raw) as ShowcasePending;
    } catch (_) { if (this.active) this.message = '演示预检未完成，请检查连接与当前身份。'; }
  }
  async action(kind: string): Promise<void> {
    if (this.busy || !this.allowed()) return;
    const access = this.access(); if (!access) return;
    this.busy = true;
    try {
      if (this.pending && this.pending.action !== kind) throw new Error('请先核验上一笔演示操作。');
      if (!this.pending) this.pending = { action: kind, key: `showcase-${reportId()}`, epoch: access.workspace.epoch,
        body: kind === 'sample' ? JSON.stringify({ sensor: this.sensor, level: this.level }) : kind === 'reset' ? JSON.stringify({ confirmDataset: 'demo-showcase' }) : '{}' };
      await this.store?.saveForm(this.scope, 'showcase-command', JSON.stringify(this.pending));
      const response = await access.client.send<ShowcaseStatus>(`/datasets/demo-main/showcase/${kind}`, {
        method: 'POST', body: this.pending.body ?? '{}',
        idempotencyKey: this.pending.key, datasetEpoch: this.pending.epoch });
      if (!this.active || this.access()?.client !== access.client) return;
      if (kind !== 'sample') this.status = response.data;
      await this.store?.saveForm(this.scope, 'showcase-command', ''); this.pending = null;
      this.message = kind === 'reset' ? '专用演示集已复位，旧离线队列保留并隔离。请重新读取。' : '演示控制已由服务端保存。';
      this.onReload(kind === 'reset');
      if (kind === 'sample') await this.load();
    } catch (cause) { if (this.active) this.message = `${(cause as Error).message}；保留原请求以便核验。`; }
    finally { this.busy = false; }
  }
  reset(): void {
    AlertDialog.show({ title: '复位专用比赛演示数据？', message: '仅清理比赛演示集的业务数据并更新版本。主业务集不变，旧手机草稿不会自动提交到新版本。',
      primaryButton: { value: '保留当前进度', action: () => {} }, secondaryButton: { value: '确认复位演示集', action: () => this.action('reset') } });
  }
  build() {
    PageStage() {
      AppCard({ color: Theme.soft }) {
        Text('比赛演示 · 守护接力').fontSize(25).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('五条路径都走真实业务；硬件、读卡与声光明确模拟。').fontSize(15).fontColor(Theme.secondary);
        if (!this.allowed()) { Text('请在“我的”选择比赛演示集，并切换到完整范围的安全管理身份。').fontSize(15).fontColor(Theme.warning); }
        else {
          Text(`运行状态：${this.status?.phase ?? '预检中'} · 数据版本 ${this.status?.epoch ?? this.state.workspace.epoch}`).fontSize(15).fontColor(Theme.brand);
          Text(`任务 ${this.status?.counts['tasks'] ?? 0} · 问题 ${this.status?.counts['issues'] ?? 0} · 工单 ${this.status?.counts['orders'] ?? 0}`).fontSize(15).fontColor(Theme.text);
          Text(this.message).fontSize(14).fontColor(Theme.warning);
          if (this.pending) { PlayButton({ title: '用原请求核验上一笔演示操作', available: !this.busy, onAction: () => this.action(this.pending!.action) }); }
          else {
            PlayButton({ title: '准备待办理数据', available: !this.busy, onAction: () => this.action('prepare') });
            PlayButton({ title: this.status?.phase === 'paused' ? '继续演示讲解' : '暂停演示讲解', secondary: true, available: !this.busy,
              onAction: () => this.action(this.status?.phase === 'paused' ? 'resume' : 'pause') });
            PlayButton({ title: '复位专用演示集', secondary: true, available: !this.busy, onAction: () => this.reset() });
            Select([{ value: '裂缝' }, { value: '倾角' }, { value: '振动' }]).value(this.sensor === 'crack' ? '裂缝' : this.sensor === 'tilt' ? '倾角' : '振动')
              .onSelect((index: number) => { this.sensor = ['crack', 'tilt', 'vibration'][index]; });
            Select([{ value: '黄色样本' }, { value: '橙色样本' }, { value: '红色样本' }, { value: '三次恢复复测' }]).value('选择模拟输入')
              .onSelect((index: number) => { this.level = ['yellow', 'orange', 'red', 'normal'][index]; });
            PlayButton({ title: '写入固定模拟样本并真实判定', secondary: true, available: !this.busy && this.status?.phase === 'ready', onAction: () => this.action('sample') });
            Text('模拟时间按分钟推进，不伪造未来采样；正常档一次补入3条恢复复测。').fontSize(12).fontColor(Theme.secondary);
          }
        }
      }
      AppCard({ color: Theme.cream }) {
        Text('① 模拟监测 → 预警处置 → 趋势与小瞳').fontSize(17).fontColor(Theme.text);
        Text('② 巡检到点 → 清单 → 异常照片 → 审核').fontSize(17).fontColor(Theme.text);
        Text('③ 派单 → 接单维修 → 验收退回/通过 → 复查').fontSize(17).fontColor(Theme.text);
        Text('④ 离线填写 → 重启恢复 → 联网同步 → 对账').fontSize(17).fontColor(Theme.text);
        Text('⑤ 本地知识问答 → 引用 → 关联对象与功能跳转').fontSize(17).fontColor(Theme.text);
        Text('准备只生成待办理数据；暂停停止演示采样操作，不暂停真实业务或伪造人工办理。').fontSize(13).fontColor(Theme.secondary);
      }
    }
  }
}
