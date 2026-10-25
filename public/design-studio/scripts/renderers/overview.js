import { prototype as model } from '../data.js'
import { button, chip, heading, icon, section } from '../ui.js'

export function workbench() {
  const hero = `<section class="app-welcome"><div><span class="eyebrow">校园守护 · 今天也辛苦了</span><h3>从眼前的一步，<br />照顾好这座校园。</h3><p>先看看待办，再出发。</p></div><img src="./assets/mascot/ready.svg" alt="小瞳陪伴形象" width="112" height="112" /><img class="hero-scene" src="./assets/scenes/morning.svg" alt="校园装饰插画，非实拍" width="640" height="360" /></section>`
  const stats = `<div class="metric-grid"><button data-go="tasks"><b>2</b><span>待办任务 · 示例</span></button><button data-go="alarms"><b>1</b><span>待关注预警 · 示例</span></button><button data-go="sync"><b>1</b><span>待同步 · 状态示例</span></button></div>`
  const actions = `<div class="quick-grid">${[['monitor', '看监测', 'monitoring'], ['inspection', '去巡检', 'tasks'], ['report', '记问题', 'report'], ['order', '办工单', 'order']].map(([glyph, label, go]) => `<button data-go="${go}">${icon(glyph)}<span>${label}</span></button>`).join('')}</div>`
  const next = section('下一步，先去这里', `${chip('巡检 · 待到点')}<h4>1号教学楼 · 日常巡检</h4><p>东侧外墙 / 北侧立柱 · 2个必查项</p>${button('查看任务与到点', 'task', 'primary')}`, 'featured-card')
  return hero + stats + heading('我的现场', '每一项待办，都有清楚的下一步', '以下为设计示例，不代表当前业务数据。') + actions + next
}

export function profile() {
  return heading('我的', '以当前身份，接续工作', '身份切换没有账号密码。实际权限始终由服务端核验。') +
    section('当前演示身份', `<div class="identity-card">${icon('identity')}<div><h4>${model.identity === 'inspector' ? '巡检员' : '维修员'}</h4><p>原型身份，不是授权凭据</p></div></div><label>切换身份<select id="identity-picker"><option value="inspector" ${model.identity === 'inspector' ? 'selected' : ''}>巡检员</option><option value="repair" ${model.identity === 'repair' ? 'selected' : ''}>维修员</option></select></label>`) +
    section('连接与本地记录', `${button('同步中心', 'sync')}<p>本设计稿不连接业务接口。真机通过受控局域网地址连接电脑服务，不能使用手机自身的127.0.0.1。</p>`) +
    section('权限帮助', '<p>照片将调用原生系统选择或相机；拒绝后可返回、重新选择或查看帮助，不强制循环弹窗。</p>') +
    section('设计交接', '<p>OpenHarmony ArkTS / ArkUI / Stage，API≥12。当前未验证设备与SDK组合；本页不是安装包。</p>')
}

export function sync() {
  return heading('安心留存', '先分清楚，记录到了哪一步', '原型状态示意；当前页面没有真实离线队列，刷新会清空临时填写。') +
    section('本地保存', `${chip('仅设计示例', 'muted')}<h4>外墙巡检记录草稿</h4><p>本地草稿与服务器确认分列，不用“已保存”冒充“提交成功”。</p>`) +
    section('待同步', `${chip('尚未获服务器确认', 'warning')}<h4>1项上报 · 示例</h4><p>示例场景：网络恢复后补传。身份、数据版本变化时必须重新核对。</p><button class="action primary" data-action="sync-demo">查看同步结果设计<span aria-hidden="true">→</span></button>`) +
    section('冲突处理', '<p>保留原草稿，展示服务端当前值；不默认覆盖。可核对后另行提交，或撤销本次编辑。</p>')
}
