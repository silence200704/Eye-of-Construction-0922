/** 应用启动顺序：集中维护并让旧库升级集成测试直接复用。 */
export interface StartupDependencies {
  archive: { bootstrap(): Promise<void> }
  records: { load(): Promise<void> }
  events: { load(): Promise<void>; catchUpEscalations(): Promise<number> }
  reloaders: { reload(): Promise<void> }[]
}

/**
 * 数据库先升级并载入档案，再读记录、事件和派生业务仓储。
 * `reloaders` 并行只是读取；任一失败都会拒绝，让 App 显示可读的失败原因。
 */
export async function startApplication(input: StartupDependencies): Promise<void> {
  await input.archive.bootstrap()
  await input.records.load()
  await input.events.load()
  await input.events.catchUpEscalations()
  await Promise.all(input.reloaders.map((store) => store.reload()))
}
