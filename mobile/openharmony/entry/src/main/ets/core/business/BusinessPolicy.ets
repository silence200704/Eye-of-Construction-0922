import { Identity } from '../../data/models/Identity';
import { IssueRecord } from '../../data/models/Reports';
import { WorkOrder } from '../../data/models/Tasks';
import { orderAllowed } from '../field/OrderPolicy';

export interface ActionChoice { key: string; title: string; }
export const REVIEW_CHOICES: ActionChoice[] = [
  { key: 'to_repair', title: '安排维修' }, { key: 'to_investigate', title: '转专业排查' },
  { key: 'recheck', title: '安排复查' }, { key: 'need_evidence', title: '退回补充材料' },
  { key: 'link_object', title: '关联已有记录' }, { key: 'close_no_fault', title: '核查后关闭' }
];
export function reviewActions(issue: IssueRecord, user: Identity | null): ActionChoice[] {
  if (user?.role !== 'safety') return [];
  if (['pending_review', 'investigating'].includes(issue.status)) return REVIEW_CHOICES;
  return ['pending_recheck', 'observing'].includes(issue.status) ?
    REVIEW_CHOICES.filter((row) => ['to_repair', 'recheck', 'link_object', 'close_no_fault'].includes(row.key)) : [];
}
export function orderActions(order: WorkOrder, user: Identity | null): string[] {
  if (user?.role === 'safety') return order.status === 'created' ? ['assigned'] :
    order.status === 'submitted' ? ['verified', 'returned'] : [];
  return ['repairing', 'submitted'].filter((action) => orderAllowed(order, user, action));
}
export function canPrepareRepair(order: WorkOrder, user: Identity | null): boolean {
  return !!user && ['repair', 'property'].includes(user.role) && order.assigneeId === user.id &&
    ['assigned', 'returned'].includes(order.status);
}
export interface OrderFilter { userId: string; mine: boolean; status: string; search: string; pointId: string; }
export function selectOrders(orders: WorkOrder[], query: OrderFilter): WorkOrder[] {
  const text = query.search.trim().toLowerCase();
  return orders.filter((row) => (!query.mine || row.assigneeId === query.userId || row.acceptedById === query.userId) &&
    (query.status === 'all' || row.status === query.status) && (!query.pointId || row.pointId === query.pointId) &&
    (!text || `${row.orderNo} ${row.title} ${row.assignee}`.toLowerCase().includes(text)));
}
