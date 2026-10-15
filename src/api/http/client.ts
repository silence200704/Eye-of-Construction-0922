interface ErrorEnvelope {
  ok: false
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> }
  meta?: { requestId?: string }
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
  headers?: Record<string, string>
  anonymous?: boolean
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

  async function request<T>(input: RequestOptions): Promise<T> {
    if (!input.path.startsWith('/') || input.path.startsWith('//')) {
      throw transportError('INVALID_REQUEST', '接口路径无效')
    }
    const headers = new Headers(input.headers)
    const token = input.anonymous ? null : options.token?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (input.body !== undefined) headers.set('Content-Type', 'application/json')
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 15000)
    try {
      const response = await fetcher(`${base}${input.path}`, {
        method: input.method ?? 'GET', headers, signal: abort.signal,
        ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      })
      if (response.status === 401 && !input.anonymous && options.token?.() === token) {
        options.unauthorized?.()
      }
      let envelope: unknown
      try { envelope = await response.json() }
      catch { throw transportError('INVALID_RESPONSE', '服务返回的内容无效，请检查后端连接') }
      if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope)) {
        throw transportError('INVALID_RESPONSE', '服务响应格式无效')
      }
      if ((envelope as { ok: boolean }).ok === false && 'error' in envelope) {
        throw new HttpError({ ...(envelope as ErrorEnvelope), status: response.status })
      }
      if (!response.ok || (envelope as { ok: unknown }).ok !== true || !('data' in envelope)) {
        throw transportError('INVALID_RESPONSE', '服务响应与 HTTP 状态不一致')
      }
      return (envelope as { data: T }).data
    } catch (cause) {
      if (cause instanceof HttpError) throw cause
      throw transportError('STORAGE_UNAVAILABLE', '无法连接后端，请保留草稿后重试')
    } finally { clearTimeout(timer) }
  }

  return { request }
}
