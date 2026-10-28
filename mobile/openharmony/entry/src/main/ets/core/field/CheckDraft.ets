import { ChecklistAnswer, InspectionTask } from '../../data/models/Tasks';
import { CheckInBody, CompleteBody, TaskWrite } from '../../data/models/Inspection';

export class CheckDraft {
  rev: number = 0;
  method: string = 'nfc';
  labelRead: string = '';
  fallbackReason: string = '';
  answers: ChecklistAnswer[] = [];
  linkedIssueId: string | null = null;
  noIssueReason: string = '';

  constructor(task?: InspectionTask, pointId: string = '') {
    if (!task) return;
    this.rev = task.rev;
    const result = task.results.find((row) => row.pointId === pointId);
    this.answers = task.planSnapshot.checklist.map((item): ChecklistAnswer => {
      const saved = result?.checklist.find((answer) => answer.key === item.key);
      return { key: item.key, label: item.label, result: saved?.result ?? null, note: saved?.note ?? '' };
    });
    this.linkedIssueId = result?.abnormalHandling?.linkedIssueId ?? null;
    this.noIssueReason = result?.abnormalHandling?.reason ?? '';
  }

  copy(): CheckDraft {
    const copy = new CheckDraft();
    copy.rev = this.rev;
    copy.method = this.method;
    copy.labelRead = this.labelRead;
    copy.fallbackReason = this.fallbackReason;
    copy.answers = this.answers.map((answer): ChecklistAnswer =>
      ({ key: answer.key, label: answer.label, result: answer.result, note: answer.note }));
    copy.linkedIssueId = this.linkedIssueId;
    copy.noIssueReason = this.noIssueReason;
    return copy;
  }

  choose(key: string, result: string): void {
    if (!['ok', 'abnormal'].includes(result)) return;
    this.answers = this.answers.map((answer): ChecklistAnswer =>
      ({ key: answer.key, label: answer.label, result: answer.key === key ? result : answer.result, note: answer.note }));
  }

  note(key: string, note: string): void {
    this.answers = this.answers.map((answer): ChecklistAnswer =>
      ({ key: answer.key, label: answer.label, result: answer.result, note: answer.key === key ? note : answer.note }));
  }

  validate(action: string, task: InspectionTask, pointId: string): string {
    if (task.rev !== this.rev) return '任务版本已变化，请核对服务端更新，再采用当前版本。';
    const result = task.results.find((row) => row.pointId === pointId);
    if (!result) return '该测点不属于当前任务。';
    if (result.status === 'completed') return '该测点已完成检查，不重复提交。';
    if (action === 'check-in') {
      if (!this.labelRead.trim()) return '请填写本次读取或核对的标签编号。';
      if (this.method === 'manual' && !this.fallbackReason.trim()) return '人工签到必须填写原因。';
      return '';
    }
    if (result.status === 'pending') return '请先完成到点核对，再提交检查。';
    if (task.planSnapshot.checklist.some((item) => item.required && !this.answers.find((a) => a.key === item.key)?.result)) {
      return '请完成全部必答检查项。';
    }
    if (this.linkedIssueId && !result.issueIds.includes(this.linkedIssueId)) return '关联问题必须来自本任务、本测点。';
    if (this.answers.some((answer) => answer.result === 'abnormal') && !this.linkedIssueId && this.noIssueReason.trim().length < 10) {
      return '存在异常，请关联问题或填写不少于10字的无需建问题依据。';
    }
    return '';
  }

  request(action: string, taskId: string, pointId: string): TaskWrite {
    let body: string;
    if (action === 'check-in') {
      const payload: CheckInBody = { expectedRev: this.rev, pointId, method: this.method,
        labelRead: this.labelRead.trim(), fallbackReason: this.fallbackReason.trim() };
      body = JSON.stringify(payload);
    } else {
      const payload: CompleteBody = { expectedRev: this.rev, pointId,
        answers: this.answers.filter((answer) => answer.result !== null),
        linkedIssueId: this.linkedIssueId, noIssueReason: this.noIssueReason.trim() };
      body = JSON.stringify(payload);
    }
    return { taskId, pointId, action, body };
  }
}
