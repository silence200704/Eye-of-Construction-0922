/**
 * V2-1 契约冻结 · 统一错误码。
 *
 * 前端适配层与服务端**共用这一份**：前端按 `code` 决定文案与是否可重试，
 * 不解析 message 文本（文案会改，码不改）。`http` 是 V2-2 起服务端应答要用的映射；
 * 本地适配层不产生 HTTP，只产生 code（见 `adapter/local.ts`）。
 *
 * **幂等命中不是错误**：重复提交同一 `idempotencyKey` 时服务端返回既有对象，
 * 响应里 `replayed: true`（见 `envelope.ts` 的 `ApiOk`），不在这里占一个错误码位。
 */
import type { ErrorCode } from './errors.types'

export interface ErrorCodeDef {
  /** 服务端应答状态码；本地适配层不使用 */
  http: number
  /** 客户端可直接重试（网络/存储类）；业务类错误重试无用 */
  retryable: boolean
  /** 默认中文文案：界面直接显示，不再自己拼 */
  message: string
}

export const ERROR_CODES: Record<ErrorCode, ErrorCodeDef> = {
  AUTH_REQUIRED: { http: 401, retryable: false, message: '缺少操作身份，请先登录或选择演示身份' },
  ROLE_FORBIDDEN: { http: 403, retryable: false, message: '当前角色无权执行该操作' },
  SCOPE_FORBIDDEN: { http: 403, retryable: false, message: '该对象不在当前账号的楼栋范围内' },
  VALIDATION_FAILED: { http: 400, retryable: false, message: '字段校验未通过' },
  IMMUTABLE_FIELD: { http: 400, retryable: false, message: '编号、状态与创建/更新痕迹由服务端维护，请求不能自带' },
  NOT_FOUND: { http: 404, retryable: false, message: '对象不存在或已归档' },
  STATE_CONFLICT: { http: 409, retryable: false, message: '当前状态不允许该操作' },
  VERSION_CONFLICT: { http: 409, retryable: false, message: '该对象已被他人更新，请刷新后重试' },
  ATTACHMENT_LIMIT: { http: 413, retryable: false, message: '照片张数或体积超出上限' },
  ATTACHMENT_BROKEN: { http: 422, retryable: false, message: '附件字节缺失或损坏，无法入库' },
  STORAGE_UNAVAILABLE: { http: 503, retryable: true, message: '服务端或对象存储暂不可用，保留草稿后可重试' },
  NOT_DEPLOYED: { http: 501, retryable: false, message: '该能力尚未部署到服务端（V2-1 只交付契约）' },
  INTERNAL: { http: 500, retryable: true, message: '服务端内部错误' },
}

export type ApiErrorDetails = Record<string, string | number | boolean | null>

export interface ApiError {
  code: ErrorCode
  message: string
  retryable: boolean
  details: ApiErrorDetails
}

export function httpStatusOf(code: ErrorCode): number {
  return ERROR_CODES[code].http
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable
}

/** 按错误码造错误对象；`details` 用于带出字段名、当前版本号这类可定位信息。 */
export function errorOf(code: ErrorCode, details: ApiErrorDetails = {}): ApiError {
  const def = ERROR_CODES[code]
  return { code, message: def.message, retryable: def.retryable, details }
}
