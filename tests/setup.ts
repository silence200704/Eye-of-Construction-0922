/**
 * 测试环境桩。
 *
 * `fake-indexeddb/auto` 放在这里而不是各个测试文件里：Dexie 在**构造时**就把 indexedDB 全局取走，
 * 只要有一个用例先 import 了 `@/db/database` 再引桩，`db.delete()` 就会拿到 undefined。
 * setupFiles 保证它先于所有测试模块执行。
 *
 * store 层会读 localStorage（演示身份）与 navigator.storage（容量提示），
 * node 环境没有这两个 API，这里给最小实现，让仓储逻辑能在真实 IndexedDB（fake-indexeddb）上跑。
 */
import 'fake-indexeddb/auto'

const store = new Map<string, string>()

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
    configurable: true,
  })
}
