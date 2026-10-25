import { points, prototype as model, screens, draftFor } from './data.js'
import { icon } from './ui.js'
import { go, initNavigation } from './navigation.js'
import { renderGallery } from './gallery.js'
import { workbench, profile, sync } from './renderers/overview.js'
import { monitoring, point, alarms, alarm, statistics } from './renderers/monitoring.js'
import { tasks, task, report, order } from './renderers/field.js'
import { stateView, offlineBanner, receipt } from './renderers/states.js'

const views = { workbench, monitoring, point, alarms, alarm, statistics, tasks, task, report, order, sync, profile }
const content = document.querySelector('#preview-content')

function render() {
  const meta = screens[model.screen]
  document.querySelector('#page-title').textContent = meta.title
  document.querySelector('#mapping').textContent = meta.map
  document.querySelector('#screen-picker').value = model.screen
  document.querySelector('#state-picker').value = model.viewState
  document.querySelector('.identity-pill').textContent = model.identity === 'inspector' ? '巡检员' : '维修员'
  content.innerHTML = model.result ? receipt() : stateView() || offlineBanner() + views[model.screen]()
  document.querySelector('#bottom-nav').innerHTML = [
    ['workbench', '工作台', 'campus'], ['monitoring', '监测', 'monitor'],
    ['tasks', '任务', 'inspection'], ['profile', '我的', 'identity'],
  ].map(([key, title, glyph]) => `<button data-go="${key}" ${meta.tab === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span></button>`).join('')
}

function changeMode(mode) {
  model.mode = mode
  document.querySelector('#prototype-stage').hidden = mode !== 'prototype'
  document.querySelector('#inspector').hidden = mode !== 'prototype'
  const gallery = document.querySelector('#gallery')
  gallery.hidden = mode === 'prototype'
  gallery.dataset.mode = mode
  document.querySelectorAll('button[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)))
  if (mode !== 'prototype') void renderGallery(mode)
}

function action(name) {
  if (name === 'arrive') model.arrived = true
  if (name === 'photo' && model.samplePhotos < 3) model.samplePhotos++
  if (name === 'accept-order') model.orderStep = 'accepted'
  if (name === 'normal') model.viewState = 'normal'
  if (name === 'reset-result') model.result = null
  if (name === 'sync-demo') model.viewState = 'conflict'
  if (name === 'gallery-retry') { void renderGallery(model.mode); return }
  render()
}

function click(event) {
  const target = event.target.closest('button')
  if (!target || target.disabled) return
  const data = target.dataset
  if (data.go) { go(data.go); return }
  if (data.mode) { changeMode(data.mode); return }
  if (data.window) {
    model.window = data.window
    document.querySelector('#device').classList.toggle('device--wide', data.window === 'wide')
    document.querySelector('#window-label').textContent = data.window === 'wide' ? '宽窗口 · 自适应列表/详情设计' : '手机 · 390px 设计参考'
    document.querySelectorAll('[data-window]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.window === data.window)))
    return
  }
  if (data.point !== undefined) {
    model.point = points[Number(data.point)]
    if (model.window === 'wide' && model.screen === 'monitoring') render()
    else go('point')
    return
  }
  if (data.taskTab) model.taskTab = data.taskTab
  if (data.period) model.period = data.period
  if (data.removePhoto !== undefined) model.samplePhotos = Math.max(0, model.samplePhotos - 1)
  if (data.action) { action(data.action); return }
  if (data.taskTab || data.period || data.removePhoto !== undefined) render()
}

function change(event) {
  const target = event.target
  const known = ['screen-picker', 'state-picker', 'type-filter', 'building-filter', 'identity-picker']
  if (!known.includes(target.id) && target.dataset.check === undefined) return
  if (target.id === 'screen-picker') { go(target.value); return }
  if (target.id === 'state-picker') { model.viewState = target.value; model.result = null }
  if (target.id === 'type-filter') model.filter = target.value
  if (target.id === 'building-filter') model.building = target.value
  if (target.id === 'identity-picker') {
    model.identity = target.value
    model.arrived = false
    model.checks.clear()
    model.samplePhotos = 0
    model.orderStep = 'assigned'
    model.result = null
  }
  if (target.dataset.check !== undefined) {
    const index = Number(target.dataset.check)
    if (target.checked) model.checks.add(index)
    else model.checks.delete(index)
  }
  const activeId = target.id
  render()
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true })
}

function submit(event) {
  const form = event.target.closest('[data-form]')
  if (!form) return
  event.preventDefault()
  const description = new FormData(form).get('description')?.toString().trim() ?? ''
  if (description.length < 10) {
    form.querySelector('#form-error').textContent = '请写下至少10个字，说明位置和现场变化。'
    form.querySelector('[name="description"]').setAttribute('aria-invalid', 'true')
    form.querySelector('[name="description"]').focus()
    return
  }
  if (form.dataset.form === 'alarm' && !new FormData(form).get('measure')?.toString().trim()) {
    form.querySelector('#form-error').textContent = '请填写实际采取的处置措施。'
    form.querySelector('[name="measure"]').setAttribute('aria-invalid', 'true')
    form.querySelector('[name="measure"]').focus()
    return
  }
  model.result = `${form.dataset.form === 'order' ? '申请验收' : form.dataset.form === 'alarm' ? '措施登记' : '问题上报'}界面演练完成；填写仅用于本次设计预览。`
  model.viewState = 'normal'
  render()
  content.focus({ preventScroll: true })
  document.querySelector('#announcement').textContent = '界面演练完成，没有提交到服务器。'
}

document.querySelector('#screen-picker').innerHTML = Object.entries(screens).map(([key, value]) => `<option value="${key}">${value.title}</option>`).join('')
document.addEventListener('click', click)
document.addEventListener('change', change)
document.addEventListener('submit', submit)
document.addEventListener('input', event => {
  event.target.removeAttribute('aria-invalid')
  const error = event.target.closest('form')?.querySelector('#form-error')
  if (error) error.textContent = ''
  const form = event.target.closest('[data-form]')
  if (form && event.target.name) draftFor(form.dataset.form)[event.target.name] = event.target.value
})
initNavigation(render)
render()
