import { ChecklistItem, ChecklistAnswer } from '../Tasks';
export interface MaintenanceTask {
  id: string; taskNo: string; buildingId: string; deviceId: string; pointId: string | null;
  status: string; plannedAt: string; dueAt: string; rev: number;
  planSnapshot: MaintenanceSnapshot; answers?: ChecklistAnswer[]; measures?: string; materials?: string;
  issueId?: string | null; photos?: string[];
}
export interface MaintenanceSnapshot { name?: string; planName?: string; checklist: ChecklistItem[]; owner?: string; }
