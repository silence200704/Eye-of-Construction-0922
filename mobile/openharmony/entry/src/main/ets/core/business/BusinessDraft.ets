import { PhotoLink } from '../../data/models/Reports';
import { ChecklistAnswer } from '../../data/models/Tasks';
import { BusinessWrite } from './BusinessModels';
import { reportId } from '../report/ReportDraft';

export class BusinessDraft {
  kind: string = ''; targetId: string = ''; rev: number = 0; action: string = 'to_repair';
  category: string = 'equipment'; note: string = ''; assigneeId: string = ''; dueAt: string = '';
  title: string = ''; pointId: string = ''; subject: string = ''; owner: string = ''; dueDate: string = '';
  outcome: string = 'recovered'; nextDueDate: string = ''; duplicateOf: string = ''; linkedEventId: string = '';
  noPhotoReason: string = ''; measures: string = ''; materials: string = ''; abnormalNote: string = '';
  createIssue: boolean = false; photos: PhotoLink[] = []; answers: ChecklistAnswer[] = [];
  anomalyType: string = ''; description: string = ''; buildingId: string = ''; floorId: string = '';
  taskId: string = ''; submissionId: string = reportId();
  eventId: string = '';
  existingPhotoCount: number = 0; existingPhotoBytes: number = 0; requirePhoto: boolean = false;
  requiredAnswerKeys: string[] = [];
}
export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function businessFormKey(draft: BusinessDraft): string {
  return `${draft.kind}:${draft.targetId || draft.taskId || draft.buildingId}:${draft.pointId}:${draft.action}`;
}
export function deadline(value: string): string | null {
  if (!value.trim()) return null;
  if (validDay(value)) return `${value}T18:00:00+08:00`;
  if (!Number.isNaN(new Date(value).getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  throw new Error('截止日期无效，请选择快捷日期或填写 YYYY-MM-DD。');
}
export interface ReviewPayload {
  expectedRev: number; action: string; category: string; note: string; duplicateOf: string | null;
  linkedEventId: string | null; photos: PhotoLink[]; noPhotoReason: string;
}
function reviewBody(d: BusinessDraft): ReviewPayload {
  const minimum = ['need_evidence', 'to_investigate', 'close_no_fault'].includes(d.action) ? 10 : 4;
  if (d.note.trim().length < minimum) throw new Error(`审核意见至少${minimum}字，请说明判断依据。`);
  if (d.action === 'link_object' && !(d.category === 'event' ? d.linkedEventId : d.duplicateOf)) throw new Error('请选择关联对象。');
  if (d.action === 'close_no_fault' && d.category === 'handled' && !d.photos.length && d.noPhotoReason.trim().length < 10) {
    throw new Error('当场处理请提供照片或至少10字的无法拍照原因。');
  }
  return { expectedRev: d.rev, action: d.action, category: d.category, note: d.note.trim(),
    duplicateOf: d.duplicateOf || null, linkedEventId: d.linkedEventId || null, photos: d.photos, noPhotoReason: d.noPhotoReason };
}
function orderBody(d: BusinessDraft): string {
  if (d.action === 'assigned' && !d.assigneeId) throw new Error('请选择维修人。');
  if (['returned', 'verified'].includes(d.action) && !d.note.trim()) throw new Error('请填写验收意见。');
  if (d.action === 'submitted' && !d.measures.trim()) throw new Error('请填写维修措施。');
  return JSON.stringify({ expectedRev: d.rev, to: d.action, note: d.note.trim(),
    assigneeId: d.action === 'assigned' ? d.assigneeId : undefined, dueAt: deadline(d.dueAt) ?? undefined,
    measures: d.action === 'submitted' ? d.measures.trim() : undefined,
    materials: d.action === 'submitted' ? d.materials.trim() : undefined, photos: d.photos });
}
export function businessWrite(d: BusinessDraft): BusinessWrite {
  let path = '', body = '', kind = 'issue'; const id = encodeURIComponent(d.targetId);
  if (d.kind === 'review') { path = `/issues/${id}/review`; body = JSON.stringify(reviewBody(d)); }
  if (d.kind === 'report') {
    if (!d.anomalyType.trim() || !d.description.trim() || !d.buildingId) throw new Error('请填写异常类型、现场描述及位置。');
    path = d.taskId ? `/inspection/tasks/${encodeURIComponent(d.taskId)}/issues` : '/issues'; kind = d.taskId ? 'task' : 'issue';
    body = JSON.stringify({ expectedRev: d.taskId ? d.rev : undefined, pointId: d.pointId || null,
      buildingId: d.taskId ? undefined : d.buildingId, floorId: d.taskId ? undefined : d.floorId,
      source: d.taskId ? undefined : d.eventId ? 'sensor' : 'report', eventId: d.eventId || undefined,
      anomalyType: d.anomalyType, description: d.description, submissionId: d.submissionId, photos: d.photos });
  }
  if (d.kind === 'supplement') {
    if (d.note.trim().length < 10) throw new Error('补充说明至少10字，请按审核要求补充。');
    if (d.requirePhoto && !d.photos.length) throw new Error('本次审核要求补充新的现场照片。');
    path = `/issues/${id}/supplements`; body = JSON.stringify({ expectedRev: d.rev, note: d.note, photos: d.photos });
  }
  if (d.kind === 'order') { path = `/work-orders/${id}/actions`; body = orderBody(d); kind = 'order'; }
  if (d.kind === 'manual') {
    if (!d.title.trim()) throw new Error('请填写工单标题。');
    path = '/work-orders'; kind = 'order'; body = JSON.stringify({ title: d.title.trim(), pointId: d.pointId || null, dueAt: deadline(d.dueAt), note: d.note });
  }
  if (d.kind === 'recheck') {
    if (!d.subject.trim() || !d.owner.trim() || !validDay(d.dueDate)) throw new Error('请填写复查事项、责任人和有效日期。');
    path = `/issues/${id}/rechecks`; body = JSON.stringify({ expectedRev: d.rev, subject: d.subject, owner: d.owner, dueDate: d.dueDate });
  }
  if (d.kind === 'outcome') {
    if (d.note.trim().length < 4) throw new Error('复查意见至少4字。');
    if (d.outcome === 'observing' && !validDay(d.nextDueDate)) throw new Error('继续观察请填写有效的下次日期。');
    path = `/issues/${id}/rechecks/outcome`; body = JSON.stringify({ expectedRev: d.rev, outcome: d.outcome,
      note: d.note, nextDueDate: d.outcome === 'observing' ? d.nextDueDate : null });
  }
  if (d.kind === 'maintenance') {
    if (!d.measures.trim() || !validDay(d.nextDueDate)) throw new Error('请填写保养措施和下次保养日期。');
    if (d.answers.some((row) => !row.result && (d.requiredAnswerKeys ?? []).includes(row.key) || row.result === 'abnormal' && !row.note.trim())) throw new Error('请完成必答清单，异常项填写依据。');
    if (d.answers.some((row) => row.result === 'abnormal') && !d.abnormalNote.trim()) throw new Error('存在异常，请填写异常说明。');
    if (d.createIssue && !d.abnormalNote.trim()) throw new Error('异常转问题请填写异常说明。');
    path = `/maintenance/tasks/${id}/execute`; kind = 'maintenance';
    body = JSON.stringify({ expectedRev: d.rev, answers: d.answers.filter((row) => !!row.result), measures: d.measures, materials: d.materials,
      nextDueDate: d.nextDueDate, note: d.note, abnormalNote: d.abnormalNote, createIssue: d.createIssue, photos: d.photos });
  }
  if (!path) throw new Error('当前办理方式不可用。');
  return { path, body, kind, targetId: d.kind === 'manual' || d.kind === 'report' && !d.taskId ? '' : d.kind === 'report' ? d.taskId : d.targetId };
}
