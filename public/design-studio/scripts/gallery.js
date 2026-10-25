import { escape } from './ui.js'

let assets = null

function entry(asset) {
  return `<article class="asset-card"><div class="asset-canvas"><img loading="lazy" src="./assets/${asset.path}" alt="${escape(asset.id)}" width="${asset.width}" height="${asset.height}" /></div><h3>${escape(asset.id)}</h3><p>${asset.width} × ${asset.height} · SVG · ${asset.bytes}字节</p><a href="./assets/${asset.path}" download>下载可编辑SVG</a>${asset.png ? ` · <a href="./${asset.png.path}" download>下载PNG</a>` : ''}</article>`
}

export async function renderGallery(mode) {
  const root = document.querySelector('#gallery')
  root.innerHTML = '<p role="status">正在读取本地资源清单…</p>'
  try {
    if (!assets) {
      const reply = await fetch('./assets/manifest.json')
      if (!reply.ok) throw new Error(`清单读取失败 (${reply.status})`)
      assets = (await reply.json()).assets
    }
    if (root.hidden || root.dataset.mode !== mode) return
    const selected = assets.filter(asset => mode === 'templates' ? asset.path.startsWith('templates/') : !asset.path.startsWith('templates/'))
    root.innerHTML = `<div class="gallery-head"><p class="eyebrow">${mode === 'templates' ? '匿名传播模板' : '本地资源包'}</p><h2>${mode === 'templates' ? '每一个场景，有一张清楚的画面。' : '同一套校园语言，照顾双端。'}</h2><p>${mode === 'templates' ? '7套可编辑模板；App与离线能力标为待实现，截图区待阶段10替换。' : '矢量小瞳6状态、校园插画4幅、空态6幅、图案4套双版本、图标16个、流程3套及品牌概念。'}</p><a href="./downloads/zhutong-artwork-v1.zip" download>下载完整SVG/PNG资源包</a> · <a href="./assets/manifest.json" download>下载来源、版本与SHA-256清单</a> · <a href="./assets/tokens.json" download>下载双端语义Token</a><p>目标SDK的资源兼容性、应用图标导出与系统缩放待原生环境实测。</p></div><div class="asset-grid ${mode === 'templates' ? 'asset-grid--templates' : ''}">${selected.map(entry).join('')}</div>`
  } catch (error) {
    root.innerHTML = `<h2>资源暂时无法读取</h2><p>${escape(error.message)}</p><button class="action" data-action="gallery-retry">重新读取本地清单</button>`
  }
}
