import { Identity } from '../../data/models/Identity';
import { Workspace } from '../../data/models/Workspace';
import { authorizationOf } from '../identity/authorization';
import { normalizeEndpoint } from '../network/Endpoint';
import { selectedDataset } from '../network/DatasetSelection';

export interface OfflineInput { baseUrl: string; user: Identity; workspace: Workspace; }
export interface OfflinePack extends OfflineInput { datasetId: string; scope: string; downloadedAt: string; }
export interface LocalNote { taskId: string; expectedRev: number; text: string; updatedAt: string; }
export interface LocalSql {
  execute: (sql: string, args: string[]) => Promise<void>;
  read: (sql: string, args: string[]) => Promise<string[]>;
  close: () => Promise<void>;
}
export function ownerKey(baseUrl: string, userId: string): string {
  return JSON.stringify([normalizeEndpoint(baseUrl), selectedDataset(), userId]);
}
export function scopeKey(input: OfflineInput): string {
  return JSON.stringify([ownerKey(input.baseUrl, input.user.id), input.workspace.epoch, authorizationOf(input.user)]);
}
