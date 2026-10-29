import { InspectionTask, WorkOrder } from '../../data/models/Tasks';
import { AppState } from '../../shared/state/AppState';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { ConnectionState } from '../../shared/components/ConnectionState';
import { PageStage } from '../../shared/playful/PageStage';
import { PageHeading } from '../../shared/playful/PageHeading';
import { EmptyBuddy } from '../../shared/playful/EmptyBuddy';
import { PlayButton } from '../../shared/playful/PlayButton';
import { label, timeText } from '../../shared/format/display';
import { TaskFilters } from './TaskFilters';
import { filterTasks } from '../../core/monitoring/Selectors';

@Component
export struct TasksPage {
  @Prop state: AppState;
  @State orders: boolean = false;
  @State status: string = 'all';
  @State kind: string = 'all';
  @State date: string = '';
  @State page: number = 0;
  onSettings: () => void = () => {};
  onRefresh: () => void = () => {};
  onOpen: (id: string) => void = () => {};
  onOpenOrder: (id: string) => void = () => {};

  tasks(): InspectionTask[] { return filterTasks(this.state.workspace.tasks, { date: this.date, status: this.status, kind: this.kind }); }

  @Builder
  taskCard(task: InspectionTask) {
    AppCard({ color: '#FFFBED' }) {
      Text(task.planSnapshot.planName).fontSize(20).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(`${task.taskNo} · ${label(task.status)}`).fontSize(14).fontColor(Theme.brand);
      Text(`计划 ${timeText(task.plannedAt)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`截止 ${timeText(task.dueAt)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`必查 ${task.planSnapshot.pointIds.length} 处 · 已完成 ${task.results.filter((row) => row.status === 'completed').length} 处`)
        .fontSize(14).fontColor(Theme.text);
      PlayButton({ title: this.state.user?.role === task.planSnapshot.executorRole ? '打开巡检手账' : '查看任务详情',
        secondary: true, onAction: () => this.onOpen(task.id), controlId: `inspection-task-${task.id}` });
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
      PlayButton({ title: '查看并办理', secondary: true, controlId: `work-order-${order.id}`, onAction: () => this.onOpenOrder(order.id) });
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
            TaskFilters({ filter: { date: this.date, status: this.status, kind: this.kind },
              onStatus: (value) => { this.status = value; this.page = 0; }, onKind: (value) => { this.kind = value; this.page = 0; },
              onDate: (value) => { this.date = value; this.page = 0; } });
            Text(`匹配 ${this.tasks().length} 条任务`).fontSize(14).fontColor(Theme.secondary);
            ForEach(this.tasks().slice(this.page * 20, (this.page + 1) * 20), (task: InspectionTask) => { this.taskCard(task); }, (task: InspectionTask) => task.id);
            if (this.tasks().length > 20) {
              PlayButton({ title: '上一页任务', available: this.page > 0, secondary: true, onAction: () => { this.page--; }, controlId: 'tasks-previous' });
              PlayButton({ title: '下一页任务', available: (this.page + 1) * 20 < this.tasks().length, secondary: true,
                onAction: () => { this.page++; }, controlId: 'tasks-next' });
            }
          }
          if ((this.orders ? this.state.workspace.orders.length : this.tasks().length) === 0) {
            EmptyBuddy({ title: this.orders ? '工具已备好，等一份工单' : '暂时没有待办，小瞳准备好了',
              note: '当前授权范围没有对应任务。这里读取服务端记录，不会自动生成演示任务。' });
          }
        }
    }
  }
}
