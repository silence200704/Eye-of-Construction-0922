import { InspectionTask, TaskAttempt, ChecklistAnswer } from './Tasks';

export interface TaskWrite {
  taskId: string;
  pointId: string;
  action: string;
  body: string;
}

export interface TaskCommandResult {
  task: InspectionTask;
  attempt?: TaskAttempt;
}

export class TaskCommandState {
  phase: string = 'idle';
  taskId: string = '';
  pointId: string = '';
  message: string = '';
  operationId: string = '';
}

export interface CheckInBody {
  expectedRev: number;
  pointId: string;
  method: string;
  labelRead: string;
  fallbackReason: string;
}

export interface CompleteBody {
  expectedRev: number;
  pointId: string;
  answers: ChecklistAnswer[];
  linkedIssueId: string | null;
  noIssueReason: string;
}
