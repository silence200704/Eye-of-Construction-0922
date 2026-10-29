export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface ChecklistAnswer {
  key: string;
  label: string;
  result: string | null;
  note: string;
}

export interface TaskAttempt {
  at: string;
  method: string;
  labelRead: string;
  fallbackReason: string;
  passed: boolean;
  message: string;
}

export interface TaskPlan {
  planName: string;
  executorRole: string;
  buildingId: string;
  pointIds: string[];
  kind?: string;
  checklist: ChecklistItem[];
}

export interface TaskCheck {
  pointId: string;
  status: string;
  checkedAt?: string | null;
  attempts: TaskAttempt[];
  checklist: ChecklistAnswer[];
  issueIds: string[];
  abnormalHandling?: AbnormalHandling;
}

export interface AbnormalHandling {
  linkedIssueId: string | null;
  reason: string;
}

export interface InspectionTask {
  id: string;
  taskNo: string;
  buildingId: string;
  planSnapshot: TaskPlan;
  plannedAt: string;
  dueAt: string;
  status: string;
  results: TaskCheck[];
  rev: number;
}

export interface WorkOrder {
  id: string;
  orderNo: string;
  title: string;
  issueId: string | null;
  pointId: string | null;
  status: string;
  assignee: string;
  dueAt: string | null;
  measures: string;
  materials: string;
  assigneeId: string;
  acceptedById: string;
  photos: string[];
  reviews: OrderReview[];
  timeline: OrderTimeline[];
  rev: number;
}

export interface OrderReview { at: string; by: string; result: string; note: string; }
export interface OrderTimeline { at: string; by: string; action: string; detail: string; }
