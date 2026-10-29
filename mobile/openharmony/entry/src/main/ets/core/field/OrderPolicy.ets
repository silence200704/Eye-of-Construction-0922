import { WorkOrder } from '../../data/models/Tasks';
import { Identity } from '../../data/models/Identity';

export function orderAllowed(order: WorkOrder, user: Identity | null, action: string): boolean {
  if (!user || !['repair', 'property'].includes(user.role)) return false;
  if (action === 'repairing') return ['assigned', 'returned'].includes(order.status) && !!order.assigneeId &&
    (user.id === order.assigneeId || user.role === 'property');
  return action === 'submitted' && order.status === 'repairing' && order.acceptedById === user.id;
}
