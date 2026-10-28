import url from '@ohos.url';
import { ApiError } from './ApiError';

export function normalizeEndpoint(input: string): string {
  try {
    const address = new url.URL(input.trim());
    if (!['http:', 'https:'].includes(address.protocol) || !address.hostname ||
      address.username || address.password || address.search || address.hash ||
      !['/', '', '/api/v1', '/api/v1/'].includes(address.pathname)) {
      throw new Error('Invalid service root');
    }
    return `${address.protocol}//${address.host}`;
  } catch (_) {
    throw new ApiError('INVALID_ADDRESS', '请输入完整的 http:// 或 https:// 服务地址，不要包含账号、密码或查询参数。');
  }
}
