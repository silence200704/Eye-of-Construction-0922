/**
 * 测试环境桩。
 *
 * store 层会读 localStorage（演示身份）与 navigator.storage（容量提示），
 * node 环境没有这两个 API，这里给最小实现，让仓储逻辑能在真实 IndexedDB（fake-indexeddb）上跑。
 */
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
