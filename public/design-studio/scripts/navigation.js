import { prototype as model, screens } from './data.js'

let onNavigate = () => {}

export function go(screen) {
  if (!screens[screen]) return
  const depth = history.state?.designDepth ?? 0
  history.pushState({ designDepth: depth + 1 }, '', `#${screen}`)
  model.screen = screen
  model.result = null
  model.viewState = 'normal'
  onNavigate()
  document.querySelector('#preview-content').scrollTop = 0
  document.querySelector('#preview-content')?.focus({ preventScroll: true })
}

export function initNavigation(render) {
  onNavigate = render
  const key = location.hash.slice(1)
  model.screen = screens[key] ? key : 'workbench'
  history.replaceState({ designDepth: 0 }, '', `#${model.screen}`)
  document.querySelector('#back').addEventListener('click', () => {
    if ((history.state?.designDepth ?? 0) > 0) history.back()
    else go('workbench')
  })
  window.addEventListener('popstate', () => {
    model.screen = screens[location.hash.slice(1)] ? location.hash.slice(1) : 'workbench'
    model.result = null
    model.viewState = 'normal'
    onNavigate()
  })
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); go('workbench') })
}
