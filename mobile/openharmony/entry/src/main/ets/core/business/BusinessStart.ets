import { ChecklistAnswer } from '../../data/models/Tasks';
import { AppState } from '../../shared/state/AppState';
import { BusinessDraft } from './BusinessDraft';
import { orderActions, reviewActions, canPrepareRepair } from './BusinessPolicy';
export function startBusiness(state: AppState, kind: string, id: string, action: string = ''): string {
  const draft = new BusinessDraft(); draft.kind = kind; draft.targetId = id;
  if (['manual', 'review', 'recheck', 'outcome'].includes(kind) && state.user?.role !== 'safety') throw new Error('此项由安全管理人员办理。');
  if (kind === 'order') {
    const order = state.workspace.orders.find((row) => row.id === id);
    if (!order || !(action === 'draft' ? canPrepareRepair(order, state.user) : orderActions(order, state.user).includes(action))) throw new Error('当前身份或工单状态不能执行此操作。');
    draft.action = action === 'draft' ? 'submitted' : action; draft.rev = order.rev; draft.measures = order.measures; draft.materials = order.materials;
    draft.pointId = order.pointId ?? '';
  }
  if (['review', 'recheck', 'outcome'].includes(kind)) {
    const issue = state.workspace.issues.find((row) => row.id === id);
    if (!issue) throw new Error('问题已不可查看。');
    if (kind === 'review' && !reviewActions(issue, state.user).length) throw new Error('当前问题没有可执行的审核动作。');
    draft.rev = issue.rev; draft.pointId = issue.pointId ?? '';
    draft.subject = `复查 ${issue.issueNo} ${issue.anomalyType}`; draft.owner = state.user?.name ?? '';
  }
  if (kind === 'maintenance') {
    const task = state.workspace.maintenance?.find((row) => row.id === id);
    if (!task || task.status !== 'pending' || !['safety', 'property', 'device', 'repair'].includes(state.user?.role ?? '')) throw new Error('当前身份或保养任务状态不可办理。');
    draft.rev = task.rev; draft.pointId = task.snapshot.pointId ?? '';
    draft.requiredAnswerKeys = task.snapshot.checklist.filter((item) => item.required).map((item) => item.key);
    draft.answers = task.snapshot.checklist.map((item): ChecklistAnswer => ({ key: item.key, label: item.label, result: null, note: '' }));
  }
  if (kind === 'supplement') {
    const issue = state.workspace.issues.find((row) => row.id === id);
    if (!issue || !state.workspace.supplementableIds.includes(id)) throw new Error('仅原上报身份可补充此问题材料。');
    draft.rev = issue.rev; draft.pointId = issue.pointId ?? ''; draft.buildingId = issue.buildingId;
  }
  return JSON.stringify(draft);
}
