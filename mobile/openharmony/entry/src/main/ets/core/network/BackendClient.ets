import http from '@ohos.net.http';
import { ApiClient, ClientSettings, Envelope, RequestOptions } from '../../data/models/Http';
import { ApiError } from './ApiError';

export class BackendClient implements ApiClient {
  private settings: ClientSettings;
  private active: Set<http.HttpRequest> = new Set();
  private cancelled: boolean = false;

  constructor(settings: ClientSettings) {
    this.settings = settings;
  }

  cancel(): void {
    this.cancelled = true;
    const requests = Array.from(this.active);
    this.active.clear();
    requests.forEach((request: http.HttpRequest) => {
      try { request.destroy(); } catch (_) { /* Late results remain invalidated even if transport cleanup fails. */ }
    });
  }

  async send<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
    if (this.cancelled) throw new ApiError('CANCELLED', '读取已取消');
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('INVALID_PATH', '接口路径无效');
    const request = http.createHttp();
    this.active.add(request);
    const headers: Record<string, string> = { 'Content-Type': options.contentType ?? 'application/json' };
    if (this.settings.token) headers['Authorization'] = `Bearer ${this.settings.token}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (options.datasetEpoch !== undefined) headers['X-Dataset-Epoch'] = String(options.datasetEpoch);
    try {
      const response = await request.request(`${this.settings.baseUrl}/api/v1${path}`, {
        method: options.method === 'POST' ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: headers, extraData: options.body ?? '', expectDataType: http.HttpDataType.STRING,
        connectTimeout: 6000, readTimeout: 10000, usingCache: false
      });
      if (this.cancelled) throw new ApiError('CANCELLED', '读取已取消');
      return this.decode<T>(response);
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError('NETWORK_UNAVAILABLE', '暂时无法连接筑瞳服务，请检查服务地址与网络。');
    } finally {
      if (this.active.delete(request)) request.destroy();
    }
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    if (this.cancelled) throw new ApiError('CANCELLED', '读取已取消');
    if (!/^\/datasets\/demo-main\/media\/[A-Za-z0-9_-]+\/content$/.test(path)) throw new ApiError('INVALID_PATH', '照片地址无效。');
    const request = http.createHttp(); this.active.add(request);
    try {
      const response = await request.request(`${this.settings.baseUrl}/api/v1${path}`, {
        method: http.RequestMethod.GET, header: { Authorization: `Bearer ${this.settings.token}` },
        expectDataType: http.HttpDataType.ARRAY_BUFFER, usingCache: false, connectTimeout: 6000, readTimeout: 10000,
        maxLimit: 1024 * 1024
      });
      if (this.cancelled) throw new ApiError('CANCELLED', '读取已取消');
      if (response.responseCode !== 200) throw new ApiError('MEDIA_UNAVAILABLE', '当前身份无法读取这张照片。', response.responseCode);
      if (!(response.result instanceof ArrayBuffer)) throw new ApiError('INVALID_RESPONSE', '照片内容不完整。');
      return response.result;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError('NETWORK_UNAVAILABLE', '照片暂时无法读取，请重试。');
    } finally { if (this.active.delete(request)) request.destroy(); }
  }

  private decode<T>(response: http.HttpResponse): Envelope<T> {
    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(response.result as string) as Envelope<T>;
    } catch (_) {
      throw new ApiError('INVALID_RESPONSE', '服务响应格式不正确，请核对连接地址。', response.responseCode);
    }
    if (!envelope || typeof envelope.ok !== 'boolean') {
      throw new ApiError('INVALID_RESPONSE', '服务响应格式不正确，请核对连接地址。', response.responseCode);
    }
    if (response.responseCode < 200 || response.responseCode >= 300 || !envelope.ok) {
      throw new ApiError(envelope.error?.code ?? 'HTTP_ERROR',
        envelope.error?.message ?? `服务暂不可用（${response.responseCode}）`, response.responseCode);
    }
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiError('INVALID_RESPONSE', '服务未返回所需数据。', response.responseCode);
    }
    return envelope;
  }
}
