/**
 * 错误码枚举单独一层，避免 `errors.ts` 与 `guard.ts` 相互 import 形成环。
 * 这里是**冻结清单**：新增码必须同时补 `errors.ts` 的文案与 HTTP 映射。
 */
export const ERROR_CODE_LIST = [
  'AUTH_REQUIRED',
  'ROLE_FORBIDDEN',
  'SCOPE_FORBIDDEN',
  'VALIDATION_FAILED',
  'IMMUTABLE_FIELD',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'VERSION_CONFLICT',
  'ATTACHMENT_LIMIT',
  'ATTACHMENT_BROKEN',
  'STORAGE_UNAVAILABLE',
  'NOT_DEPLOYED',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODE_LIST)[number]
