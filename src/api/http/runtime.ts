export const backendEnabled = import.meta.env.MODE !== 'test'
  && import.meta.env.VITE_BACKEND_ENABLED !== 'false'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export interface BackendUser {
  id: string
  name: string
  role: string
  roleLabel: string
  buildingIds: string[] | null
}

export interface IdentityResult {
  accessToken: string
  expiresAt: number
  user: BackendUser
}
