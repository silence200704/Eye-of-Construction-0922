import { ReportResult } from '../../data/models/Reports';
import { AlarmEvent } from '../../data/models/Monitoring';
import { MaintenanceTask } from '../../data/models/business/Maintenance';

export interface BusinessWrite { path: string; targetId: string; kind: string; body: string; }
export interface BusinessResult extends ReportResult { event?: AlarmEvent; maintenance?: MaintenanceTask; }
export class BusinessState { phase: string = 'idle'; message: string = ''; operationId: string = ''; }
export interface PendingBusiness { write: BusinessWrite; scope: string; key: string; sent: boolean; phase: string; result?: BusinessResult; requestHash?: string; }
export interface BusinessJournal {
  load: (scope: string) => Promise<PendingBusiness | null>;
  save: (pending: PendingBusiness) => Promise<void>;
}
