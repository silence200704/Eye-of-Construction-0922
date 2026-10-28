export interface TaskPlan {
  planName: string;
  executorRole: string;
  buildingId: string;
  pointIds: string[];
}

export interface TaskCheck {
  pointId: string;
  status: string;
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
}
