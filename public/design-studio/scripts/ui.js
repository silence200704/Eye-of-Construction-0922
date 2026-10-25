import { iconGroups } from './data.js'

export function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function icon(name) {
  const group = Object.keys(iconGroups).find(key => iconGroups[key].includes(name)) ?? 'monitoring'
  return `<img class="glyph" src="./assets/icons/${group}/${name}.svg" alt="" width="22" height="22" />`
}

export function button(label, target, className = '') {
  return `<button type="button" class="action ${className}" data-go="${target}">${label}<span aria-hidden="true">→</span></button>`
}

export function chip(text, tone = 'neutral') {
  return `<span class="chip chip--${tone}">${text}</span>`
}

export function section(title, content, className = '') {
  return `<section class="app-card ${className}"><h3>${title}</h3>${content}</section>`
}

export function heading(label, title, caption) {
  return `<div class="section-heading"><span class="eyebrow">${label}</span><h3>${title}</h3><p>${caption}</p></div>`
}

export function timeline(labels) {
  return `<ol class="timeline">${labels.map((label, index) => `<li><span>${index+1}</span><div>${label}</div></li>`).join('')}</ol>`
}
