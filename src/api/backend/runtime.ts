/**
 * 服务端数据集门面。
 *
 * 数据集固定为 demo-main；epoch 来自服务端，每次写入都带上，复位前的旧请求会被拒绝。
 * 本模块只做传输与类型对齐，不复制业务判定。
 */
import { ref } from 'vue'
import { backendEnabled } from '@/api/http/runtime'
import type { CommandResult } from '@/api/http/client'
import { useBackendSessionStore } from '@/stores/backend/session'

const selected = localStorage.getItem('zhutong-api/dataset-id')
export const DATASET_ID = selected === 'demo-showcase' ? 'demo-showcase' : 'demo-main'
let epoch = 1

/** 数据集 epoch 的响应式镜像：复位后问答上下文必须失效。 */
export const epochVersion = ref(1)

export function backendActive(): boolean {
  return backendEnabled && useBackendSessionStore().user !== null
}

export function setEpoch(next: number): void {
  if (Number.isInteger(next) && next > 0) {
    epoch = next
    epochVersion.value = next
  }
}

export function currentEpoch(): number {
  return epoch
}

/**
 * 依赖浏览器演示库的旧入口在服务端模式下必须明确暂停。
 * 阶段 10 会把演示编排接到服务端；在那之前，不能一边读服务端、一边把结果写进 IndexedDB。
 */
export function requireLocalDemo(feature: string): void {
  if (backendActive()) {
    throw new Error(`${feature}仍基于浏览器演示数据；服务端演示编排将在阶段 10 提供，当前已暂停，避免写出第二份结果`)
  }
}

interface CommandOptions {
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  key: string
  epoch?: number
}

function digits(value: unknown): string {
  return encodeURIComponent(String(value))
}

/** HTTP 头只接受 ISO-8859-1；含中文的幂等键在发送前收敛为稳定的 ASCII 摘要。 */
function asciiKey(key: string): string {
  if (/^[\x20-\x7e]+$/.test(key)) return key
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `key_${(hash >>> 0).toString(36)}`
}

export async function command<T>(suffix: string, options: CommandOptions): Promise<CommandResult<T>> {
  const session = useBackendSessionStore()
  const result = await session.http.command<T>({
    path: `/datasets/${DATASET_ID}${suffix}`,
    method: options.method ?? 'POST',
    body: options.body,
    headers: {
      'Idempotency-Key': asciiKey(options.key),
      'X-Dataset-Epoch': String(options.epoch ?? epoch),
    },
  })
  if (result.datasetEpoch !== null) setEpoch(result.datasetEpoch)
  return result
}

/** 二进制上传（照片）：仍走同一套身份、epoch 与幂等回执。 */
export async function commandRaw<T>(
  suffix: string,
  options: { rawBody: BodyInit; contentType: string; key: string; epoch?: number },
): Promise<CommandResult<T>> {
  const session = useBackendSessionStore()
  const result = await session.http.command<T>({
    path: `/datasets/${DATASET_ID}${suffix}`,
    method: 'POST',
    rawBody: options.rawBody,
    contentType: options.contentType,
    headers: {
      'Idempotency-Key': asciiKey(options.key),
      'X-Dataset-Epoch': String(options.epoch ?? epoch),
    },
  })
  if (result.datasetEpoch !== null) setEpoch(result.datasetEpoch)
  return result
}

export async function blobOf(path: string): Promise<Blob> {
  return useBackendSessionStore().http.blob(path)
}

export async function read<T>(suffix: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const session = useBackendSessionStore()
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${digits(key)}=${digits(value)}`)
    .join('&')
  const result = await session.http.command<T>({
    path: `/datasets/${DATASET_ID}${suffix}${query === '' ? '' : `?${query}`}`,
  })
  if (result.datasetEpoch !== null) setEpoch(result.datasetEpoch)
  return result.data
}
