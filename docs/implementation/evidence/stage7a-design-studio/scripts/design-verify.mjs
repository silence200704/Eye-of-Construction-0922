import assert from 'node:assert/strict'
import { chromium } from './browser/node_modules/playwright/index.mjs'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const require=createRequire(import.meta.url)
const {default:AxeBuilder}=require('./browser/node_modules/@axe-core/playwright')
const base=process.argv[2]??'http://127.0.0.1:5180'
const out=process.env.DESIGN_EVIDENCE??'backend/.runtime-ui-refresh/design-recheck'
for(const folder of ['phone','wide','states','templates'])await mkdir(out+'/screens/'+folder,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1120}})
await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
const page=await context.newPage()
const errors=[],api=[],writes=[],external=[],checks=[],layouts=[],access=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))api.push(r.url());if(r.method()!=='GET')writes.push(r.method()+' '+r.url());if(!['127.0.0.1','localhost'].includes(url.hostname))external.push(r.url())})
page.setDefaultTimeout(10000)
async function check(name,action){await action();checks.push(name);console.log('PASS '+name)}
async function screen(name){await page.locator('#screen-picker').selectOption(name);await page.locator('#preview-content').evaluate(el=>el.scrollTop=0)}
async function scan(name){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();access.push({name,violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))})}
async function shot(name){await page.screenshot({path:out+'/screens/'+name+'.png',fullPage:true,animations:'disabled'})}
await page.goto(base+'/design-studio/index.html',{waitUntil:'networkidle'})
await check('Prototype is separate from business API and clearly labelled',async()=>{
 assert.ok((await page.locator('.design-notice').innerText()).includes('不连接 API'));assert.equal(await page.getByRole('textbox',{name:/密码/}).count(),0)
})
await shot('phone/workbench')
await check('Monitoring filters preserve missing values and simulation source',async()=>{
 await screen('monitoring');await page.locator('#type-filter').selectOption('vibration');assert.equal(await page.locator('.sensor-list .sensor-card').count(),1);assert.ok((await page.locator('.sensor-list').innerText()).includes('暂无数据'))
 await page.locator('#building-filter').selectOption('1号教学楼');assert.ok((await page.locator('.sensor-list').innerText()).includes('没有示例测点'))
 await page.locator('#type-filter').selectOption('all');await page.locator('#building-filter').selectOption('all')
})
await check('Wide monitoring keeps selected detail alongside list',async()=>{
 await page.getByRole('button',{name:'宽窗口',exact:true}).click();await page.locator('[data-point="1"]').click();assert.equal(await page.locator('#page-title').innerText(),'监测与设备');assert.ok((await page.locator('.wide-detail').innerText()).includes('北侧立柱'))
 await shot('wide/monitoring');await scan('wide-monitoring');await page.getByRole('button',{name:'手机',exact:true}).click()
})
await check('Back returns to monitoring without discarding filters',async()=>{
 await page.locator('[data-point="0"]').click();assert.equal(await page.locator('#page-title').innerText(),'测点详情');await page.getByRole('button',{name:'返回上一页',exact:true}).click();await page.waitForURL(url=>url.hash==='#monitoring')
})
await check('Arrival and completed checklist gate the next step',async()=>{
 await screen('task');const next=page.getByRole('button',{name:'发现异常，填写上报'});assert.equal(await next.isDisabled(),true)
 await page.getByRole('button',{name:'演练模拟到点'}).click();await page.locator('[data-check="0"]').check();assert.equal(await next.isDisabled(),true);await page.locator('[data-check="1"]').check();assert.equal(await next.isDisabled(),false);await next.click();assert.equal(await page.locator('#page-title').innerText(),'问题上报')
})
await check('Report validates inline, preserves temporary draft and caps placeholders',async()=>{
 const input=page.getByRole('textbox',{name:'现场所见',exact:true});await page.getByRole('button',{name:'演练提交上报'}).click();assert.ok((await page.locator('#form-error').innerText()).includes('至少10个字'))
 await input.fill('东侧外墙出现新的裂缝，需要现场复核变化。')
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'添加占位照片',exact:true}).first().click()
 assert.equal(await page.getByRole('button',{name:'添加占位照片',exact:true}).count(),0)
 await page.getByRole('button',{name:'移除第2个占位照片'}).click();assert.equal(await page.getByRole('button',{name:'添加占位照片',exact:true}).count(),1)
 await screen('workbench');await screen('report');assert.ok((await input.inputValue()).includes('新的裂缝'))
 await scan('report-filled');await shot('phone/report');await page.getByRole('button',{name:'演练提交上报'}).click();assert.ok((await page.locator('.receipt-card').innerText()).includes('没有提交服务器'))
})
await check('Identity change isolates draft and enables repair-only workflow',async()=>{
 await screen('order');assert.ok((await page.locator('#preview-content').innerText()).includes('当前身份无法办理'))
 await screen('profile');await page.locator('#identity-picker').selectOption('repair');await screen('report');assert.equal(await page.getByRole('textbox',{name:'现场所见'}).inputValue(),'')
 await screen('order');await page.getByRole('button',{name:'演练接单'}).click();await page.getByRole('textbox',{name:'处理措施'}).fill('检查支架固定情况并完成紧固，提交复核验收。');await page.getByRole('button',{name:'演练申请验收'}).click();assert.ok((await page.locator('.receipt-card').innerText()).includes('申请验收'))
})
await check('Alarm form requires measures and does not close event',async()=>{
 await screen('alarm');await page.getByRole('textbox',{name:'排查结果'}).fill('核对外墙现场状态并留存变化描述，等待复核。');await page.getByRole('button',{name:'演练登记措施'}).click();assert.ok((await page.locator('#form-error').innerText()).includes('处置措施'))
 await page.getByRole('textbox',{name:'处置措施'}).fill('设置观察记录并关联现场问题。');await page.getByRole('button',{name:'演练登记措施'}).click();assert.ok((await page.locator('.receipt-card').innerText()).includes('不是服务端回执')===false);assert.ok((await page.locator('.receipt-card').innerText()).includes('没有业务编号'))
})
await check('Statistics change week/month and expose text data',async()=>{
 await screen('statistics');assert.ok((await page.locator('.total').innerText()).includes('4'));await page.getByRole('button',{name:'本月',exact:true}).click();assert.ok((await page.locator('.total').innerText()).includes('7'));assert.ok(await page.locator('.bar-chart').getAttribute('aria-label'));await shot('phone/statistics')
})
const names=await page.locator('#screen-picker option').evaluateAll(rows=>rows.map(row=>row.value))
await check('All 12 pages and 9 states fit 3 reference windows',async()=>{
 for(const [width,height,wide]of [[1440,1120,false],[1440,1120,true],[375,844,false]]){
  await page.setViewportSize({width,height});await page.getByRole('button',{name:wide?'宽窗口':'手机',exact:true}).click()
  for(const name of names){
   await screen(name)
   if(!wide&&width===1440)await scan('phone-'+name)
   for(const state of ['normal','loading','empty','error','forbidden','offline','submitting','conflict','success']){
    await page.locator('#state-picker').selectOption(state)
    const r=await page.evaluate(()=>{const app=document.querySelector('.app-content');return {doc:document.documentElement.scrollWidth,width:innerWidth,body:app.scrollWidth,client:app.clientWidth}})
    layouts.push({width,wide,name,state,...r});assert.ok(r.doc<=width+1,JSON.stringify(layouts.at(-1)));assert.ok(r.body<=r.client+1,JSON.stringify(layouts.at(-1)))
   }
  }
 }
})
await screen('alarm');await page.locator('#state-picker').selectOption('conflict');await shot('states/conflict-narrow');await scan('conflict-narrow')
await page.locator('#state-picker').selectOption('normal');await shot('phone/alarm-narrow')
await page.setViewportSize({width:1440,height:1120})
await check('Gallery and 7 templates load offline-local assets with editable downloads',async()=>{
 await page.getByRole('button',{name:'图形资源',exact:true}).click();await page.locator('.asset-card').first().waitFor();assert.equal(await page.locator('.asset-card').count(),45);await scan('asset-gallery')
 await page.getByRole('button',{name:'传播模板',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===7);await shot('templates/gallery');await scan('template-gallery')
})
await context.close();await browser.close()
await writeFile(out+'/verification.json',JSON.stringify({base,checks,errors,api,writes,external,layouts,access},null,2))
assert.equal(errors.length,0);assert.equal(api.length,0);assert.equal(writes.length,0);assert.equal(external.length,0)
console.log(JSON.stringify({checks:checks.length,layouts:layouts.length,axe:access.length,violations:access.filter(r=>r.violations.length)},null,2))
if(access.some(r=>r.violations.length))process.exitCode=1
