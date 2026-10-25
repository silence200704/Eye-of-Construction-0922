import { prototype as model, draftFor } from '../data.js'
import { button, chip, escape, heading, icon, section, timeline } from '../ui.js'

export function tasks() {
  const labels = { inspection: '巡检', spot: '点检', orders: '工单' }
  const tabs = `<div class="segmented" role="group" aria-label="任务类型">${Object.entries(labels).map(([key, label]) => `<button data-task-tab="${key}" aria-pressed="${model.taskTab === key}">${label}</button>`).join('')}</div>`
  return heading('现场任务', '今天，按清单走一遍', '设计样例 · 实际任务会保留生成时的计划快照。') + tabs +
    section(`${labels[model.taskTab]} · 待办理`, `${chip('未开始')}<h4>${model.taskTab === 'orders' ? '示例工单 W01 · 设备维修' : '1号教学楼 · 东侧外墙'}</h4><p>示例时间 09:00—11:30 · 2个检查项</p>${button('查看办理步骤', model.taskTab === 'orders' ? 'order' : 'task', 'primary')}`) +
    section('带着依据去现场', '<p>异常描述与照片各自保存；退回时保留原始内容，不用新描述覆盖历史现场记录。</p>')
}

export function task() {
  const items = ['外墙表面变化', '测点设备固定情况']
  const list = items.map((text, index) => `<label class="check-row"><input type="checkbox" data-check="${index}" ${model.checks.has(index) ? 'checked' : ''} ${!model.arrived ? 'disabled' : ''} /><span>${text}<small>逐项核对后勾选</small></span></label>`).join('')
  return heading('巡检任务 · 样例 T01', '先到点，再逐项记录', '1号教学楼 · 东侧外墙；到点方式不等同真实身份或到场证明。') +
    `<div class="step-strip"><span class="active">1 到点</span><span class="${model.arrived ? 'active' : ''}">2 检查</span><span>3 提交</span></div>` +
    section('到点登记', `${chip(model.arrived ? '模拟到点已选择 · 原型' : '等待到点', model.arrived ? 'neutral' : 'muted')}<p>本轮不开发真实NFC读取；人工到点需在正式页面填写原因。</p><button class="action" data-action="arrive" ${model.arrived ? 'disabled' : ''}>演练模拟到点${icon('location')}</button>`) +
    section(`检查清单 · ${model.checks.size}/2项`, list + '<p>未到点或清单未完成时，不允许演练下一步。</p>') +
    `<button class="action primary" data-go="report" ${!model.arrived || model.checks.size !== 2 ? 'disabled' : ''}>发现异常，填写上报${icon('report')}</button>`
}

export function report() {
  const draft = draftFor('report')
  const slots = Array.from({ length: 3 }, (_, index) => index < model.samplePhotos ? `<div class="photo-slot"><img src="./assets/empty/photos.svg" alt="装饰照片占位，非现场证据" width="70" height="56" /><span>非现场证据</span><button type="button" data-remove-photo="${index}" aria-label="移除第${index+1}个占位照片">移除</button></div>` : `<button type="button" class="photo-slot" data-action="photo">${icon('camera')}<span>添加占位照片</span></button>`).join('')
  return heading('现场记录', '说清楚你看到的变化', '原型临时填写仅在本页内存保留；真实草稿恢复与补传待阶段9。') +
    section('关联位置', `<h4>1号教学楼 · 东侧外墙</h4><p>示例-P01 · 关联示例任务 T01</p>`) +
    `<form novalidate class="app-card" data-form="report"><h3>问题描述</h3><label>现场所见<textarea name="description" rows="4" required minlength="10" aria-describedby="form-error" placeholder="写下位置、现象和变化，至少10个字">${escape(draft.description ?? '')}</textarea></label><div class="photo-label"><b>照片占位 · ${model.samplePhotos}/3</b><span>正式上报每张≤600KB</span></div><div class="photo-grid">${slots}</div><p>此处不选择或上传真实照片。插画不作为现场证据。</p><p id="form-error" class="field-error" role="alert"></p><button class="action primary" type="submit">演练提交上报<span aria-hidden="true">→</span></button></form>`
}

export function order() {
  const editable = model.identity === 'repair'
  const steps = ['已派工 · 示例 W01', model.orderStep === 'assigned' ? '等待接单' : '已演练接单', '填写措施和完工材料', 'Web验收 / 不自动关闭事件']
  return heading('工单办理', '办完之后，再交给验收', '设备维修样例；实际办理身份与楼栋范围仍由服务端核验。') +
    section('维修工单 · 样例 W01', `${chip('待办理', 'warning')}<h4>测点设备支架检查</h4><p>关联示例问题 I01 · 1号教学楼</p>${timeline(steps)}`) +
    (!editable ? section('当前身份无法办理', `<p>当前为巡检员原型身份。请到“我的”切换维修员，再演练接单和完工。</p>${button('前往身份切换', 'profile')}`) :
      model.orderStep === 'assigned' ? '<button class="action primary" data-action="accept-order">演练接单<span aria-hidden="true">→</span></button>' :
        `<form novalidate class="app-card" data-form="order"><h3>完工记录</h3><label>处理措施<textarea name="description" rows="4" required minlength="10" aria-describedby="form-error" placeholder="描述采取的措施，至少10个字">${escape(draftFor('order').description ?? '')}</textarea></label><p>正式页面按契约提交前后照片和完工信息，本原型不执行工单状态变更。</p><p id="form-error" class="field-error" role="alert"></p><button class="action primary" type="submit">演练申请验收<span aria-hidden="true">→</span></button></form>`)
}
