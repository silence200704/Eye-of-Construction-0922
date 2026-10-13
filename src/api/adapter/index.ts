/**
 * V2-1 适配层门面。
 *
 * 两种实现：
 * - `local`：委派现有 store（本轮交付的样例，见 `local.ts`）；
 * - `http`：V2-2 起接服务端的骨架，**目前没有任何部署目标**，调用即返回 `NOT_DEPLOYED`。
 *
 * 页面接适配层的顺序（V2-3 起）：先换成 `local`（行为保持不变，便于对比），
 * 服务端就绪后再把 `kind` 改成 `http`，页面代码不用动。
 */
import { fail } from '../contract/envelope'
import { errorOf } from '../contract/errors'
import type { ApiResult } from '../contract/envelope'
import type { WriteRequest } from '../contract/guard'
import { resetReplayTable, submitLocal } from './local'
import type { WriteReceipt } from './local'

export interface ApiAdapter {
  kind: 'local' | 'http'
  submit(request: WriteRequest): Promise<ApiResult<WriteReceipt>>
}

/** 本地适配器：先契约校验，再委派现有受控入口；不替换任何现有业务路径。 */
export function createLocalApi(): ApiAdapter {
  return { kind: 'local', submit: submitLocal }
}

/**
 * HTTP 适配器骨架。
 *
 * **未部署**：V2-2 建好服务端与前缀后，在这里实现 `fetch(baseUrl + RESOURCES[..].path)`，
 * 并把服务端返回的 `code` 直接透出（此时 `local.ts` 里那张中文关键词映射表应删除）。
 */
export function createHttpApi(baseUrl: string): ApiAdapter {
  return {
    kind: 'http',
    async submit(request: WriteRequest): Promise<ApiResult<WriteReceipt>> {
      return fail(errorOf('NOT_DEPLOYED', { baseUrl, action: request.action, reason: 'V2-1 只交付契约：服务端与部署条件未就绪' }))
    },
  }
}

/** 本地适配层的内存重放表复位（清库、重载演示数据、测试之间调用）。 */
export function resetLocalApiState(): void {
  resetReplayTable()
}

export type { WriteReceipt }
