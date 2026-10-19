interface ErrorEnvelope {
  ok: false
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> }
  meta?: { requestId?: string }
}

interface SuccessEnvelope<T> {
  ok: true
  data: T
  rev?: number | null
  replayed?: boolean
  meta?: { requestId?: string; datasetEpoch?: number }
}

interface ClientOptions {
  baseUrl?: string
  token?: () => string | null
  fetcher?: typeof fetch
  unauthorized?: () => void
  timeoutMs?: number
}

interface RequestOptions {
  path: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** 二进制上传：与 body 二选一；设置后不再 JSON 序列化 */
  rawBody?: BodyInit
  contentType?: string
  headers?: Record<string, string>
  anonymous?: boolean
  timeoutMs?: number
}

/** 命令结果：保留 rev / replayed / requestId / epoch，供写操作判断重放与版本。 */
export interface CommandResult<T> {
  data: T
  rev: number | null
  replayed: boolean
  requestId: string
  datasetEpoch: number | null
}

export class HttpError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly requestId: string
  readonly details: Record<string, unknown>

  constructor(input: ErrorEnvelope & { status: number }) {
    super(input.error.message)
    this.code = input.error.code
    this.status = input.status
    this.retryable = input.error.retryable
    this.requestId = input.meta?.requestId ?? ''
    this.details = input.error.details ?? {}
  }
}

function transportError(code: string, message: string): HttpError {
  return new HttpError({ ok: false, status: 0, error: { code, message, retryable: true } })
}

export function createHttpClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch
  const base = (options.baseUrl ?? '/api/v1').replace(/\/$/, '')

  async function send<T>(input: RequestOptions): Promise<CommandResult<T>> {
    if (!input.path.startsWith('/') || input.path.startsWith('//')) {
      throw transportError('INVALID_REQUEST', '接口路径无效')
    }
    const headers = new Headers(input.headers)
    const token = input.anonymous ? null : options.token?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (input.rawBody !== undefined) {
      if (input.contentType) headers.set('Content-Type', input.contentType)
    } else if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), input.timeoutMs ?? options.timeoutMs ?? 15000)
    try {
      const response = await fetcher(`${base}${input.path}`, {
        method: input.method ?? 'GET', headers, signal: abort.signal,
        ...(input.rawBody !== undefined
          ? { body: input.rawBody }
          : input.body !== undefined
            ? { body: JSON.stringify(input.body) }
            : {}),
      })
      if (response.status === 401 && !input.anonymous && options.token?.() === token) {
        options.unauthorized?.()
      }
      let envelope: unknown
      try { envelope = await response.json() }
      catch {
        // 代理在服务停摆时通常回 HTML 错误页；按"连不上后端"提示，不误报为业务响应格式问题。
        throw response.ok
          ? transportError('INVALID_RESPONSE', '服务返回的内容无效，请检查后端连接')
          : transportError('STORAGE_UNAVAILABLE', '无法连接后端，请保留草稿后重试')
      }
      if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope)) {
        throw transportError('INVALID_RESPONSE', '服务响应格式无效')
      }
      if ((envelope as { ok: boolean }).ok === false && 'error' in envelope) {
        throw new HttpError({ ...(envelope as ErrorEnvelope), status: response.status })
      }
      const success = envelope as SuccessEnvelope<T>
      if (!response.ok || success.ok !== true || !('data' in success)) {
        throw transportError('INVALID_RESPONSE', '服务响应与 HTTP 状态不一致')
      }
      return {
        data: success.data,
        rev: success.rev ?? null,
        replayed: success.replayed === true,
        requestId: success.meta?.requestId ?? '',
        datasetEpoch: success.meta?.datasetEpoch ?? null,
      }
    } catch (cause) {
      if (cause instanceof HttpError) throw cause
      throw transportError('STORAGE_UNAVAILABLE', '无法连接后端，请保留草稿后重试')
    } finally { clearTimeout(timer) }
  }

  async function request<T>(input: RequestOptions): Promise<T> {
    return (await send<T>(input)).data
  }

  /** 受身份保护的内容读取（媒体原件/缩略图），直接返回 Blob。 */
  async function blob(path: string): Promise<Blob> {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw transportError('INVALID_REQUEST', '接口路径无效')
    }
    const headers = new Headers()
    const token = options.token?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetcher(`${base}${path.replace(/^\/api\/v1/, '')}`, { headers })
    if (!response.ok) {
      throw transportError('STORAGE_UNAVAILABLE', '无法读取照片内容，请检查后端连接')
    }
    return response.blob()
  }

  return { request, command: send, blob }
}
