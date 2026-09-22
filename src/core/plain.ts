/**
 * 写库前的深拷贝：把 Vue 响应式对象转为可写库的纯数据。
 *
 * 为什么不直接用 `structuredClone`：结构化克隆遇到 Proxy 会抛 `DataCloneError`，
 * 而 store 里的领域对象基本都是响应式代理 —— 这正是本函数存在的理由。
 *
 * 为什么不用 JSON：JSON 会把 **Blob 序列化成 `{}`**。照片附件（`IssueAttachment.blob/thumb`）
 * 走的就是这条路径，一旦经过 JSON，照片在本机库里就只剩一个空对象：
 * 详情页对它调 `createObjectURL` 会抛 TypeError（整个详情区渲染不出来）、
 * 备份导出对它调 `arrayBuffer()` 会抛错、恢复后再存一遍也还是空。
 *
 * 领域数据只由字符串、数字、布尔、null、数组、普通对象与 Blob 组成
 * （时间一律存 ISO 字符串，没有 Date 字段），所以逐层手写拷贝就够：
 * - 普通对象与数组逐层复制，顺带把响应式代理解包成纯数据；
 * - **Blob / File 原样返回**：它们是宿主对象，IndexedDB 的结构化克隆原生支持；
 *   Blob 内容不可变，共享同一实例是安全的。
 */
export function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return value.map((row) => toPlain(row)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) out[key] = toPlain((value as Record<string, unknown>)[key])
  return out as T
}
