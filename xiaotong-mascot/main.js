const zone = document.querySelector('.mascot-zone')
const status = document.querySelector('.status')
const controls = [...document.querySelectorAll('[data-action]')]
let searchTimer = null

const messages = {
  idle: '待机：准备查看当前本地数据',
  searching: '检索中：正在读取本地证据',
  found: '找到证据：请点开原始记录核对',
  empty: '暂无数据：请检查测点和时间范围',
}

function setState(next) {
  window.clearTimeout(searchTimer)
  zone.dataset.state = next
  status.textContent = messages[next]
  controls.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.action === next))
  })
  if (next === 'searching') {
    searchTimer = window.setTimeout(() => setState('found'), 1200)
  }
}

controls.forEach((button) => {
  button.addEventListener('click', () => setState(button.dataset.action))
})

document.addEventListener('visibilitychange', () => {
  zone.dataset.paused = String(document.hidden)
})
