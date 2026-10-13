/** 页面尚未挂载时也要给出可读错误，不能把 #app 留成空白。 */
export function showMountFailure(cause: unknown): void {
  const detail = cause instanceof Error ? cause.message : String(cause)
  console.error('筑瞳启动失败：', cause)
  const root = document.querySelector<HTMLElement>('#app')
  if (root === null) return

  const panel = document.createElement('main')
  panel.style.cssText = 'display:grid;place-items:center;min-height:100vh;padding:24px;font:16px/1.6 system-ui,sans-serif;color:#16343b;background:#f5f8f8'
  const card = document.createElement('section')
  card.style.cssText = 'max-width:640px;padding:28px;border:1px solid #d7e2e3;border-radius:12px;background:#fff;box-shadow:0 12px 28px rgba(21,51,59,.08)'
  const title = document.createElement('h1')
  title.textContent = '本地数据启动失败'
  const message = document.createElement('p')
  message.textContent = `未进入业务页面：${detail || '未知错误'}`
  const retry = document.createElement('button')
  retry.textContent = '重新载入'
  retry.type = 'button'
  retry.onclick = () => location.reload()
  card.append(title, message, retry)
  panel.append(card)
  root.replaceChildren(panel)
}
