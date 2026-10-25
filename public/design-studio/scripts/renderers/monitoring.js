import { points, prototype as model, draftFor } from '../data.js'
import { button, chip, escape, heading, icon, section, timeline } from '../ui.js'

function pointCard(point, index) {
  return `<button class="sensor-card" data-point="${index}"><span class="sensor-top">${icon(point.type)}<span>${point.label}</span>${chip(point.state, point.tone)}</span><span class="reading">${point.value}<small>${point.unit}</small></span><strong>${point.building} · ${point.name}</strong><span class="sensor-meta">${point.connection} · 电量 ${point.battery}</span><span class="sensor-meta">示例采样时间 10-25 09:30 · 模拟输入</span></button>`
}

export function monitoring() {
  const filters = `<div class="filters"><label>楼栋<select id="building-filter"><option value="all">全部楼栋</option>${['1号教学楼', '2号实验楼'].map(name => `<option ${model.building === name ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>监测类型<select id="type-filter"><option value="all">全部类型</option>${points.map(p => `<option value="${p.type}" ${model.filter === p.type ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label></div>`
  const selected = points.map((point, index) => ({ point, index })).filter(({ point }) => (model.filter === 'all' || point.type === model.filter) && (model.building === 'all' || point.building === model.building))
  const list = selected.length ? selected.map(({ point, index }) => pointCard(point, index)).join('') : '<p class="empty-filter">当前筛选没有示例测点，请更换条件。</p>'
  const detail = model.point ? `<div class="wide-detail">${point()}</div>` : ''
  return heading('模拟监测', '读数与来源，一起看清', '缺失值显示暂无数据；在线和电量同样为模拟。') + filters + `<div class="monitor-layout"><div class="sensor-list">${list}</div>${detail}</div>` + `<div class="quick-grid">${button('预警台账', 'alarms')}${button('周月统计', 'statistics')}</div>`
}

export function point() {
  const p = model.point
  return section(`${p.building} · ${p.name}`, `${chip(p.state, p.tone)}<div class="detail-reading">${p.value}<small>${p.unit}</small></div><p>${p.id} · ${p.label}</p><dl class="detail-grid"><div><dt>输入来源</dt><dd>模拟输入</dd></div><div><dt>采样时间</dt><dd>示例 10-25 09:30</dd></div><div><dt>设备状态</dt><dd>${p.connection}</dd></div><div><dt>设备电量</dt><dd>${p.battery}</dd></div></dl><p>这里的数值只用于界面设计，不是建筑安全鉴定结论。</p>${button('查看关联预警', 'alarm')}`) + section('历史读数', '<p>实际页面由服务端记录绘制，缺数据处保留断点。原型不补造历史曲线。</p>')
}

export function alarms() {
  return heading('需要关注', '让每条提醒，都有去向', '当前与历史分列；级别、状态和对象使用文字说明。') +
    section('当前预警', `${chip('黄色关注', 'warning')}<h4>东侧外墙 · 裂缝变化</h4><p>1号教学楼 · 示例事件 A01</p>${timeline(['09:30 模拟读数触发 · 示例', '待授权人员确认'])}${button('查看预警与处置', 'alarm', 'primary')}`) +
    section('历史台账', `${chip('已关闭 · 历史示例', 'muted')}<h4>示例事件 H01</h4><p>历史只读；关闭后停止通知升级。不能因修订历史记录新建当前事件。</p>`)
}

export function alarm() {
  return heading('预警处置', '先核对现场，再留下措施', '示例事件 A01 · 模拟输入 · 演示规则不是国家鉴定标准。') +
    section('当前依据', `${chip('黄色关注', 'warning')}<h4>1号教学楼 · 东侧外墙</h4><p>示例读数0.18mm；实际判定必须展示保存的规则版本与证据。</p>${timeline(['预警形成', '确认并现场排查', '登记措施 / 关联问题', '符合关闭条件后，由授权人员关闭'])}`) +
    `<form novalidate class="app-card" data-form="alarm"><h3>现场排查与措施</h3><label>排查结果<textarea name="description" rows="3" required minlength="10" aria-describedby="form-error" placeholder="描述现场所见，至少10个字">${escape(draftFor('alarm').description ?? '')}</textarea></label><label>处置措施<textarea name="measure" rows="2" aria-describedby="form-error" required placeholder="填写实际采取的措施">${escape(draftFor('alarm').measure ?? '')}</textarea></label><p id="form-error" class="field-error" role="alert"></p><button class="action primary" type="submit">演练登记措施<span aria-hidden="true">→</span></button><p>本原型不执行预警确认或关闭。正式版本接入现有权限与工单验收条件。</p></form>`
}

export function statistics() {
  const monthly = model.period === 'month'
  const values = monthly ? [3, 1, 2, 1] : [0, 1, 0, 2, 0, 1, 0]
  const labels = monthly ? ['第1周', '第2周', '第3周', '第4周'] : ['一', '二', '三', '四', '五', '六', '日']
  const sum = values.reduce((a, b) => a + b, 0)
  const chart = `<div class="bar-chart" role="img" aria-label="示例预警频次：${labels.map((label, i) => `${label}${values[i]}次`).join('，')}">${values.map((value, i) => `<div><span>${value}</span><i style="height:${value*27+4}px"></i><small>${labels[i]}</small></div>`).join('')}</div>`
  return heading('统计概览', '把变化，放回时间里看', '所有图表数字为原型样例；正式页面由授权数据聚合。') +
    `<div class="segmented" role="group" aria-label="统计周期"><button data-period="week" aria-pressed="${!monthly}">本周</button><button data-period="month" aria-pressed="${monthly}">本月</button></div>` +
    section('预警频次 · 示例', `<p class="total">${sum}<small>次 · ${monthly ? '本月' : '本周'}示例</small></p>${chart}`) +
    section('类型分布 · 示例', `<dl class="distribution"><div><dt>裂缝</dt><dd>${monthly ? 4 : 2}次</dd></div><div><dt>倾角</dt><dd>${monthly ? 2 : 1}次</dd></div><div><dt>加速度</dt><dd>1次</dd></div></dl><p>说明：这是统计展示样例，与上方实时测点样例不代表同一数据集。</p>`)
}
