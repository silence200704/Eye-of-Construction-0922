import { AppState } from '../../shared/state/AppState';
import { InspectionTask, TaskAttempt } from '../../data/models/Tasks';
import { TaskWrite, TaskCommandResult } from '../../data/models/Inspection';
import { ReportTarget } from '../../data/models/Reports';
import { Theme } from '../../shared/theme/Theme';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { AppCard } from '../../shared/components/AppCard';
import { CheckEditor } from './CheckEditor';
import { timeText, label } from '../../shared/format/display';

@Component
export struct TaskDetail {
  @Prop state: AppState;
  @Prop taskId: string;
  @State selectedPoint: string = '';
  onSubmit: (request: TaskWrite) => Promise<TaskCommandResult | undefined> = async () => undefined;
  onRetry: () => Promise<TaskCommandResult | undefined> = async () => undefined;
  onReload: () => void = () => {};
  onReport: (target: ReportTarget) => void = () => {};

  aboutToAppear(): void {
    this.selectedPoint = this.task()?.planSnapshot.pointIds[0] ?? '';
  }

  task(): InspectionTask | undefined { return this.state.workspace.tasks.find((task) => task.id === this.taskId); }

  pointStatus(pointId: string): string {
    const status = this.task()?.results.find((row) => row.pointId === pointId)?.status ?? 'pending';
    return status === 'completed' ? '检查完成' : status === 'arrived' ? '已到点，待检查' : '待到点';
  }

  @Builder
  summary() {
    AppCard({ color: Theme.soft }) {
      Text(this.task()!.planSnapshot.planName).fontSize(23).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(`${this.task()!.taskNo} · ${label(this.task()!.status)}`).fontSize(14).fontColor(Theme.brand).id('task-summary-status');
      Text(`已完成 ${this.task()!.results.filter((row) => row.status === 'completed').length} / ${this.task()!.planSnapshot.pointIds.length} 处`)
        .fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text).id('task-progress');
      Text(`截止 ${timeText(this.task()!.dueAt)}`).fontSize(12).fontColor(Theme.secondary);
      Text(`执行身份：${this.state.identities.find((row) => row.role === this.task()!.planSnapshot.executorRole)?.roleLabel ?? this.task()!.planSnapshot.executorRole}`)
        .fontSize(12).fontColor(Theme.secondary);
      Text('到点、完成检查与问题关闭分别核验；硬件输入使用显式模拟。').fontSize(12).fontColor(Theme.brand);
    }
  }

  @Builder
  points(task: InspectionTask) {
    Text('选择本次照看的测点').fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
    ForEach(task.planSnapshot.pointIds, (id: string, index: number) => {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          Text(`${index + 1}`).fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.brand);
          Column({ space: 5 }) {
            Text(this.state.workspace.points.find((point) => point.id === id)?.name ?? id)
              .fontSize(15).fontColor(Theme.text);
            Text(this.pointStatus(id)).fontSize(12).fontColor(Theme.brand);
          }.alignItems(HorizontalAlign.Start).layoutWeight(1);
          Text(this.selectedPoint === id ? '当前' : '打开').fontSize(12).fontColor(Theme.brand);
        }.padding(14).width('100%');
      }.width('100%').backgroundColor(this.selectedPoint === id ? Theme.cream : Theme.surface)
        .border({ radius: 20, width: 1.2, color: this.selectedPoint === id ? Theme.brand : Theme.line })
        .enabled(this.state.command.phase !== 'sending' && this.state.command.phase !== 'unknown')
        .onClick(() => { this.selectedPoint = id; }).id(`task-point-${id}`);
    }, (id: string) => id);
  }

  @Builder
  attempts() {
    AppCard() {
      Text('本测点到点记录').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      ForEach(this.task()!.results.find((row) => row.pointId === this.selectedPoint)?.attempts ?? [], (attempt: TaskAttempt) => {
        Text(`${attempt.passed ? '通过' : '未通过'} · ${attempt.method === 'nfc' ? '模拟读卡' : '人工核对'}`)
          .fontSize(14).fontColor(attempt.passed ? Theme.brand : Theme.danger);
        Text(attempt.message).fontSize(12).fontColor(Theme.secondary);
        Text(timeText(attempt.at)).fontSize(11).fontColor(Theme.secondary);
        if (attempt.fallbackReason) { Text(`人工原因：${attempt.fallbackReason}`).fontSize(12).fontColor(Theme.secondary); }
      }, (attempt: TaskAttempt) => `${attempt.at}-${attempt.labelRead}-${attempt.method}`);
      if ((this.task()!.results.find((row) => row.pointId === this.selectedPoint)?.attempts.length ?? 0) === 0) {
        Text('还没有到点尝试；失败尝试也会由服务端保留。').fontSize(12).fontColor(Theme.secondary);
      }
    }
  }

  build() {
    PageStage() {
      if (this.state.mode === 'ready' && this.task()) {
        PageHeading({ title: '带着清单，照看每一处', subtitle: '到点 → 检查 → 服务端保存', kicker: 'FIELD NOTE / 巡检手账' });
        this.summary();
        this.points(this.task()!);
        if (this.state.user?.role !== this.task()!.planSnapshot.executorRole) {
          Text('当前身份可查看任务；请切换为任务指定的执行身份办理。').fontSize(14).fontColor(Theme.warning).id('task-readonly');
        } else if (this.selectedPoint) {
          CheckEditor({ state: this.state, task: this.task()!, pointId: this.selectedPoint,
            onSubmit: this.onSubmit, onRetry: this.onRetry, onReload: this.onReload,
            onReport: () => this.onReport({ pointId: this.selectedPoint, taskId: this.taskId, expectedRev: this.task()!.rev,
              buildingId: this.task()!.buildingId, floorId: this.state.workspace.points.find((row) => row.id === this.selectedPoint)?.floorId ?? '' }) });
        }
        this.attempts();
      } else {
        AppCard() {
          Text('当前任务不可查看').fontSize(20).fontColor(Theme.text);
          Text('连接、身份或任务范围已变化，请返回后重新读取。').fontSize(13).fontColor(Theme.secondary);
        }
      }
    }
  }
}
