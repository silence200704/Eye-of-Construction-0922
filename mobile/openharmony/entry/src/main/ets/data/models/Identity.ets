export interface Identity {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  buildingIds: string[] | null;
}

export interface IdentitySession {
  accessToken: string;
  expiresAt: number;
  user: Identity;
}

export interface ConnectionSettings {
  baseUrl: string;
  identityId: string;
}
