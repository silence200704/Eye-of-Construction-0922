export interface ResponseMeta {
  requestId?: string;
  datasetEpoch?: number;
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
  body?: string;
}

export interface ApiClient {
  send<T>(path: string, options?: RequestOptions): Promise<Envelope<T>>;
  cancel(): void;
}

export interface ClientSettings {
  baseUrl: string;
  token: string;
}
