import { FieldOperation } from './FieldModels';
import { BusinessDraft } from '../../business/BusinessDraft';
import { AppState } from '../../../shared/state/AppState';
export function conflictDraft(row: FieldOperation, state: AppState): BusinessDraft {
  if (!['conflict', 'failed'].includes(row.phase)) throw new Error('结果未知时先核验原请求。');
  const payload = JSON.parse(row.body || row.write.body) as BusinessDraft;
  const draft = new BusinessDraft();
  draft.kind = row.write.kind === 'order' ? 'order' : row.write.kind === 'maintenance' ? 'maintenance' :
    row.write.path.endsWith('supplements') ? 'supplement' : 'report';
  draft.targetId = row.write.targetId;
  const fields: string[] = ['measures', 'materials', 'note', 'anomalyType', 'description', 'pointId', 'buildingId', 'floorId', 'nextDueDate', 'abnormalNote'];
  const output = draft as Object as Record<string, string>, input = payload as Object as Record<string, string>;
  for (const field of fields) if (input[field] !== undefined) output[field] = input[field];
  const action = JSON.parse(row.body || row.write.body) as Record<string, string | number>;
  draft.action = String(action['to'] ?? draft.action);
  const target = draft.kind === 'order' ? state.workspace.orders.find((item) => item.id === row.write.targetId) :
    draft.kind === 'maintenance' ? state.workspace.maintenance?.find((item) => item.id === row.write.targetId) :
      state.workspace.issues.find((item) => item.id === row.write.targetId);
  if (target) draft.rev = target.rev;
  draft.answers = payload.answers ?? []; draft.createIssue = payload.createIssue ?? false;
  return draft;
}
