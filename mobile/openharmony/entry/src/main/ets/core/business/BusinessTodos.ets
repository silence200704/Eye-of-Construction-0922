import { Workspace } from '../../data/models/Workspace';
import { Identity } from '../../data/models/Identity';
export interface BusinessTodo { title: string; count: number; kind: string; status: string; }
export function businessTodos(workspace: Workspace, user: Identity | null): BusinessTodo[] {
  if (!user) return [];
  const rows: BusinessTodo[] = [];
  if (user.role === 'safety') {
    rows.push({ title: '待审核发现', kind: 'issues', status: 'pending_review', count: workspace.issues.filter((r) => r.status === 'pending_review').length });
    rows.push({ title: '待派工', kind: 'orders', status: 'created', count: workspace.orders.filter((r) => r.status === 'created').length });
    rows.push({ title: '待验收维修', kind: 'orders', status: 'submitted', count: workspace.orders.filter((r) => r.status === 'submitted').length });
    rows.push({ title: '待复查', kind: 'issues', status: 'pending_recheck', count: workspace.issues.filter((r) => ['pending_recheck', 'observing'].includes(r.status)).length });
  }
  if (['repair', 'property'].includes(user.role)) {
    for (const status of ['assigned', 'repairing', 'returned']) rows.push({ title: status === 'assigned' ? '我的待接单' : status === 'returned' ? '需要返工' : '我的维修中',
      kind: 'orders', status, count: workspace.orders.filter((r) => r.status === status && (r.assigneeId === user.id || r.acceptedById === user.id)).length });
  }
  rows.push({ title: '我的检查任务', kind: 'inspection', status: 'all', count: workspace.tasks.filter((r) => r.planSnapshot.executorRole === user.role && r.status !== 'checked').length });
  rows.push({ title: '需要补充材料', kind: 'issues', status: 'supplement', count: workspace.issues.filter((r) => r.reviewAction === 'need_evidence' && workspace.supplementableIds.includes(r.id)).length });
  return rows;
}
