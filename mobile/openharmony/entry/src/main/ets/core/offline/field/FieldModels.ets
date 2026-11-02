import { BusinessWrite } from '../../business/BusinessModels';
import { BusinessPhoto } from '../../business/BusinessPhotos';
export interface FieldOperation {
  id: string; scope: string; write: BusinessWrite; dependencies: string[]; photos: BusinessPhoto[];
  body: string; key: string; phase: string; attempts: number; nextAttempt: number;
  message: string; result: string; sent: boolean; replaces?: string;
  requestHash?: string;
}
export interface FieldEntity { id: string; rev: number; }
export interface FieldResult {
  task?: FieldEntity; order?: FieldEntity; issue?: FieldEntity; event?: FieldEntity;
  attempt?: FieldAttempt;
}
export interface FieldAttempt { passed: boolean; }
export interface FieldWorkflow { id: string; scope: string; writes: BusinessWrite[]; photos: BusinessPhoto[]; }
