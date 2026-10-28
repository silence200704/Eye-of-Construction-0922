export interface ResponseMeta {
  requestId?: string;
  datasetEpoch?: number;
  receiptId?: string;
  replayed?: boolean;
}

export interface ApiFailure {
  code: string;
  message: string;
}

export interface Envelope<T> {
  ok: boolean;
  data: T;
  meta?: ResponseMeta;
  error?: ApiFailure;
}

export interface RequestOptions {
  method?: string;
  body?: string | ArrayBuffer;
  contentType?: string;
  idempotencyKey?: string;
  datasetEpoch?: number;
}

export interface ApiClient {
  send<T>(path: string, options?: RequestOptions): Promise<Envelope<T>>;
  cancel(): void;
}

export interface ClientSettings {
  baseUrl: string;
  token: string;
}
