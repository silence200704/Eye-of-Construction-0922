export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(cause: Error): string {
  return cause instanceof ApiError ? cause.message : '暂时无法完成读取，请检查连接后重试。';
}
