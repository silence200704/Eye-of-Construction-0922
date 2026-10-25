import { prototype as model } from '../data.js'
import { button, section } from '../ui.js'

const states = {
  loading: { title: '正在读取数据', text: '加载状态设计示意；当前未发送网络请求。', art: 'download', action: '返回正常原型' },
  empty: { title: '这里还没有内容', text: '可以回到工作台查看任务，或调整筛选条件。', art: 'tasks', action: '返回正常原型' },
  error: { title: '暂时连接不上服务', text: '保留已填写内容，不回退为本地业务写入成功。', art: 'api', action: '演练重试后的界面' },
  forbidden: { title: '当前身份无法查看', text: '核对身份和授权范围；隐藏越权对象与照片，不沿用旧会话内容。', art: 'search', action: '返回正常原型' },
  conflict: { title: '数据已有变化，请重新核对', text: '保留原草稿，不自动覆盖。先读取服务器当前值，再决定是否重新提交。', art: 'api', action: '演练重新核对' },
  submitting: { title: '正在提交，请稍候', text: '提交状态设计示意，不表示当前有请求。在正式页面由真实请求控制，禁止重复提交。', art: 'download', action: '结束提交状态演练' },
  success: { title: '提交结果设计示意', text: '这不是服务端回执。正式页面只有收到真实回执后才显示“服务器已确认”。', art: 'tasks', action: '返回正常原型' },
}

export function stateView() {
  if (model.viewState === 'normal' || model.viewState === 'offline') return ''
  const state = states[model.viewState]
  return `<section class="state-card" aria-label="原型状态 ${state.title}"><img src="./assets/empty/${state.art}.svg" alt="" width="240" height="180" /><h3>${state.title}</h3><p>${state.text}</p><button class="action primary" data-action="normal">${state.action}</button>${button('回到工作台', 'workbench')}</section>`
}

export function offlineBanner() {
  return model.viewState === 'offline' ? '<p class="offline-note" role="status">离线快照设计示例 · 示例数据截止10-25 09:30，非实时。待同步不等于服务器已确认。</p>' : ''
}

export function receipt() {
  return section('演练完成 · 没有提交服务器', `<img class="receipt-mascot" src="./assets/mascot/found.svg" width="120" height="120" alt="小瞳找到依据的状态插画" /><p>${model.result}</p><p>没有业务编号或伪造回执。正式实现会展示真实编号、服务器确认时间和可查询结果。</p><button class="action primary" data-action="reset-result">返回当前原型</button>`, 'receipt-card')
}
