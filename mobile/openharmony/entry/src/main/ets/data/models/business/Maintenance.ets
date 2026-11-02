import { ChecklistItem, ChecklistAnswer } from '../Tasks';
export interface MaintenanceTask {
  id: string; taskNo: string; deviceId: string;
  status: string; plannedAt: string; dueAt: string; rev: number;
  snapshot: MaintenanceSnapshot; execution?: MaintenanceExecution;
  issueId?: string | null; photos?: string[];
}
export interface MaintenanceSnapshot {
  name?: string; planName?: string; deviceName?: string; checklist: ChecklistItem[]; owner?: string;
  buildingId: string; pointId?: string | null;
}
export interface MaintenanceExecution { answers: ChecklistAnswer[]; measures: string; materials: string; photos?: string[]; }
