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
import { selectOrders } from '../../core/business/BusinessPolicy';
import { MaintenanceTask } from '../../data/models/business/Maintenance';
import { filterTasks } from '../../core/monitoring/Selectors';

@Component
export struct TasksPage {
  @Prop state: AppState;
  @Prop @Watch('applyView') view: string = '';
  @State orders: boolean = false;
  @State maintenance: boolean = false;
  @State mine: boolean = true;
  @State orderStatus: string = 'all';
  @State search: string = '';
  @State orderPage: number = 0;
  @State orderPoint: string = '';
  onManual: () => void = () => {};
  onMaintenance: (id: string) => void = () => {};
  @State status: string = 'all';
  @State kind: string = 'all';
  @State date: string = '';
  @State page: number = 0;
  onSettings: () => void = () => {};
  onRefresh: () => void = () => {};
  onOpen: (id: string) => void = () => {};
  onOpenOrder: (id: string) => void = () => {};
  aboutToAppear(): void { this.applyView(); }
  applyView(): void {
    if (!this.view) return;
    this.orders = this.view.startsWith('orders:'); this.maintenance = false;
    this.orderStatus = this.orders ? this.view.split(':')[1] : 'all'; this.orderPage = 0;
  }

  tasks(): InspectionTask[] { return filterTasks(this.state.workspace.tasks, { date: this.date, status: this.status, kind: this.kind }); }

  filteredOrders(): WorkOrder[] { return selectOrders(this.state.workspace.orders, { userId: this.state.user?.id ?? '',
    mine: this.mine && ['repair', 'property'].includes(this.state.user?.role ?? ''), status: this.orderStatus, search: this.search, pointId: this.orderPoint }); }

  @Builder
  orderFilters() {
    TextInput({ text: this.search, placeholder: '搜索工单号、标题或维修人' }).height(52).onChange((value: string) => { this.search = value; this.orderPage = 0; });
    Select([{ value: '全部状态' }, { value: '待派工' }, { value: '待接单' }, { value: '处理中' }, { value: '待验收' }, { value: '已验收' }, { value: '退回返工' }])
      .value('按工单状态筛选').onSelect((i: number) => { this.orderStatus = ['all', 'created', 'assigned', 'repairing', 'submitted', 'verified', 'returned'][i]; this.orderPage = 0; });
    Select([{ value: '全部位置' }, ...this.state.workspace.points.map((row): SelectOption => ({ value: row.name }))]).value('按测点筛选')
      .onSelect((i: number) => { this.orderPoint = i ? this.state.workspace.points[i - 1].id : ''; this.orderPage = 0; });
    PlayButton({ title: this.mine ? '我的待办 / 切换全部' : '全部可见 / 切换我的', secondary: true, onAction: () => { this.mine = !this.mine; this.orderPage = 0; } });
    if (this.state.user?.role === 'safety') { PlayButton({ title: '新建维修工单', onAction: this.onManual, controlId: 'manual-order' }); }
  }

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
            PlayButton({ title: '检查任务', secondary: this.orders, controlId: 'task-inspections',
              onAction: () => { this.orders = false; this.maintenance = false; } }).layoutWeight(1);
            PlayButton({ title: '维修工单', secondary: !this.orders, controlId: 'task-orders',
              onAction: () => { this.orders = true; this.maintenance = false; } }).layoutWeight(1);
          }.padding(7).width('100%').backgroundColor(Theme.surface).borderRadius(23)
            .border({ width: 1.2, color: Theme.line });
          PlayButton({ title: this.maintenance ? '✓ 设备保养任务' : '查看设备保养任务', secondary: true, onAction: () => { this.maintenance = !this.maintenance; } });
          if (this.maintenance) {
            ForEach(this.state.workspace.maintenance ?? [], (task: MaintenanceTask) => {
              AppCard() {
                Text(`${task.taskNo} · ${label(task.status)}`).fontSize(18).fontColor(Theme.text);
                Text(task.snapshot.planName ?? task.snapshot.deviceName ?? '设备保养').fontSize(16).fontColor(Theme.brand);
                Text(`截止 ${timeText(task.dueAt)}`).fontSize(13).fontColor(Theme.secondary);
                if (task.status === 'pending' && ['safety', 'property', 'device', 'repair'].includes(this.state.user?.role ?? '')) {
                  PlayButton({ title: '填写保养清单与措施', onAction: () => this.onMaintenance(task.id) });
                }
                if (task.execution) { Text(`保养措施：${task.execution.measures}`).fontSize(14).fontColor(Theme.secondary); }
              }
            });
            if (!(this.state.workspace.maintenance?.length)) { Text('当前没有保养任务，由网页计划生成后显示。').fontSize(15); }
          } else if (this.orders) {
            this.orderFilters();
            Text(`共 ${this.filteredOrders().length} 张工单`).fontSize(14).fontColor(Theme.secondary);
            ForEach(this.filteredOrders().slice(this.orderPage * 20, (this.orderPage + 1) * 20), (order: WorkOrder) => { this.orderCard(order); }, (order: WorkOrder) => order.id);
            PlayButton({ title: '上一页工单', secondary: true, available: this.orderPage > 0, onAction: () => { this.orderPage--; } });
            PlayButton({ title: '下一页工单', secondary: true, available: (this.orderPage + 1) * 20 < this.filteredOrders().length, onAction: () => { this.orderPage++; } });
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
