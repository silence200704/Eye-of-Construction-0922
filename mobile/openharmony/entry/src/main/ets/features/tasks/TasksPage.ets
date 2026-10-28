import { InspectionTask, WorkOrder } from '../../data/models/Tasks';
import { AppState } from '../../shared/state/AppState';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { ConnectionState } from '../../shared/components/ConnectionState';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { EmptyBuddy } from '../../shared/playful/EmptyBuddy';
import { label, timeText } from '../../shared/format/display';

@Component
export struct TasksPage {
  @Prop state: AppState;
  @State orders: boolean = false;
  onSettings: () => void = () => {};
  onRefresh: () => void = () => {};

  @Builder
  taskCard(task: InspectionTask) {
    AppCard({ color: '#FFFBED' }) {
      Text(task.planSnapshot.planName).fontSize(20).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(`${task.taskNo} · ${label(task.status)}`).fontSize(14).fontColor(Theme.brand);
      Text(`计划 ${timeText(task.plannedAt)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`截止 ${timeText(task.dueAt)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`必查 ${task.planSnapshot.pointIds.length} 处 · 已完成 ${task.results.filter((row) => row.status === 'completed').length} 处`)
        .fontSize(14).fontColor(Theme.text);
      Text('到点、清单检查与问题上报将在后续批次接入。').fontSize(12).fontColor(Theme.secondary);
    }
  }

  @Builder
  orderCard(order: WorkOrder) {
    AppCard() {
      Text(order.title).fontSize(20).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(`${order.orderNo} · ${label(order.status)}`).fontSize(14).fontColor(Theme.brand);
      Text(`办理人 ${order.assignee || '尚未指派'}`).fontSize(14).fontColor(Theme.text);
      Text(`截止 ${timeText(order.dueAt)}`).fontSize(13).fontColor(Theme.secondary);
      if (order.measures) { Text(order.measures).fontSize(14).fontColor(Theme.secondary); }
      Text('接单、完工和退回补办将在后续批次接入；完工不等于验收通过。').fontSize(12).fontColor(Theme.secondary);
    }
  }

  build() {
    PageStage() {
        PageHeading({ title: '一处一处，认真照看', subtitle: '检查和维修，都有自己的进度', kicker: 'FIELD / 现场任务' });
        ConnectionState({ state: this.state, onSettings: this.onSettings, onRetry: this.onRefresh });
        if (this.state.mode === 'ready') {
          Row({ space: 8 }) {
            Button('检查任务').height(48).backgroundColor(this.orders ? Theme.surface : Theme.brand)
              .fontColor(this.orders ? Theme.text : Color.White).onClick(() => { this.orders = false; }).id('task-inspections');
            Button('维修工单').height(48).backgroundColor(this.orders ? Theme.brand : Theme.surface)
              .fontColor(this.orders ? Color.White : Theme.text).onClick(() => { this.orders = true; }).id('task-orders');
          }.padding(7).width('100%').backgroundColor(Theme.surface).borderRadius(23)
            .border({ width: 1.2, color: Theme.line });
          if (this.orders) {
            ForEach(this.state.workspace.orders, (order: WorkOrder) => { this.orderCard(order); }, (order: WorkOrder) => order.id);
          } else {
            ForEach(this.state.workspace.tasks, (task: InspectionTask) => { this.taskCard(task); }, (task: InspectionTask) => task.id);
          }
          if ((this.orders ? this.state.workspace.orders.length : this.state.workspace.tasks.length) === 0) {
            EmptyBuddy({ title: this.orders ? '工具已备好，等一份工单' : '暂时没有待办，小瞳准备好了',
              note: '当前授权范围没有对应任务。这里读取服务端记录，不会自动生成演示任务。' });
          }
        }
    }
  }
}
