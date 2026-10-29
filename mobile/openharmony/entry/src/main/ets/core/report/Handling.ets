import { ReportTarget, HandlingRequest, HandlingContext } from '../../data/models/Reports';
import { TaskAccess } from '../field/TaskCommander';
import { orderAllowed } from '../field/OrderPolicy';
import { ReportDraft } from './ReportDraft';
import { ReportLease } from './ReportLease';
import { ApiError } from '../network/ApiError';

export function initialTarget(access: TaskAccess, request: HandlingRequest): ReportTarget {
  const issue = access.workspace.issues.find((row) => row.id === request.issueId);
  const order = access.workspace.orders.find((row) => row.id === request.orderId);
  if ((!issue && !order) || (request.orderId && (!order || !orderAllowed(order, access.user, request.action ?? '')))) {
    throw new ApiError('ACTION_UNAVAILABLE', '当前状态或身份不能办理此动作，请由指定人员处理。', 409);
  }
  const related = issue ?? access.workspace.issues.find((row) => row.id === order?.issueId);
  const pointId = issue?.pointId ?? order?.pointId ?? '';
  const point = access.workspace.points.find((row) => row.id === pointId);
  return { pointId, buildingId: point?.buildingId ?? related?.buildingId ?? '', floorId: point?.floorId ?? related?.floorId ?? '',
    taskId: '', expectedRev: issue?.rev ?? order?.rev ?? 0, issueId: request.issueId, orderId: request.orderId, action: request.action };
}

export async function prepareHandling(lease: ReportLease, target: ReportTarget): Promise<ReportDraft> {
  await lease.authorize(target);
  const path = target.issueId ? `/issues/${encodeURIComponent(target.issueId)}/supplement-context` :
    `/work-orders/${encodeURIComponent(target.orderId ?? '')}/handling-context`;
  const response = await lease.access.client.send<HandlingContext>(`/datasets/demo-main${path}`);
  await lease.authorize(target);
  if (response.meta?.datasetEpoch !== lease.access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '数据已复位，请重新读取。');
  const context = response.data;
  const row = context.issue ?? context.order;
  if (!row || row.id !== (target.issueId ?? target.orderId) || !Number.isInteger(row.rev)) {
    throw new ApiError('INVALID_RESPONSE', '服务端办理上下文不完整。');
  }
  target.expectedRev = row.rev;
  target.existingPhotoCount = context.existingPhotoCount; target.existingPhotoBytes = context.existingPhotoBytes;
  target.requirePhoto = context.issue?.reviewCategory === 'image';
  target.requireNote = !!context.order && target.action === 'repairing' && context.order.assigneeId !== lease.access.user.id;
  if (context.issue && (context.issue.status !== 'pending_review' || context.issue.reviewAction !== 'need_evidence')) {
    throw new ApiError('STATE_CONFLICT', '当前问题没有待补充的材料，请重新读取。', 409);
  }
  if (context.order && !orderAllowed(context.order, lease.access.user, target.action ?? '')) {
    throw new ApiError('STATE_CONFLICT', '工单状态已变化，请重新读取。', 409);
  }
  const draft = new ReportDraft(target);
  draft.anomalyType = context.issue?.anomalyType ?? '';
  draft.description = context.issue?.description ?? '';
  draft.measures = context.order?.measures ?? ''; draft.materials = context.order?.materials ?? '';
  return draft;
}
