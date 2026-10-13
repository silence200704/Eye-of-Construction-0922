/** 浏览器在旧构建文件失效、服务断开时给出的模块载入错误；不要误判业务失败。 */
export function isModuleLoadFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:chunk|CSS chunk) .+ failed/i.test(message)
}

export function answerFailure(cause: string): { message: string; reload: boolean } {
  if (isModuleLoadFailure(cause)) return {
    message: '应用资源未能载入，可能是页面版本已更新或本地服务暂时不可用。请刷新加载新版后再提问。',
    reload: true,
  }
  return { message: `读取失败：${cause}（可点发送重试）`, reload: false }
}
