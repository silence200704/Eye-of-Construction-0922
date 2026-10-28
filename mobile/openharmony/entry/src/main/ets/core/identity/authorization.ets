import { Identity } from '../../data/models/Identity';

interface ScopeFingerprint {
  id: string;
  role: string;
  buildingIds: string[] | null;
}

export function authorizationOf(user: Identity): string {
  const scope: ScopeFingerprint = { id: user.id, role: user.role,
    buildingIds: user.buildingIds === null ? null : user.buildingIds.slice().sort() };
  return JSON.stringify(scope);
}
