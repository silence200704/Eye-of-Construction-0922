import assert from 'node:assert/strict'
import { chromium } from './browser/node_modules/playwright/index.mjs'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const require=createRequire(import.meta.url)
const {default:AxeBuilder}=require('./browser/node_modules/@axe-core/playwright')
const base=process.argv[2]??'http://127.0.0.1:5180'
const output=process.env.ASSISTANT_UI_EVIDENCE??'backend/.runtime-ui-refresh/assistant-recheck'
await mkdir(output+'/screens',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage()
const errors=[],writes=[],checks=[],layouts=[],a11y=[],replies=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname})})
page.on('response',async r=>{if(r.url().endsWith('/assistant/query'))replies.push({status:r.status(),body:await r.json()})})
async function check(name, action){await action();checks.push(name);console.log('PASS '+name)}
async function shot(name){await page.screenshot({path:output+'/screens/'+name+'.png',animations:'disabled'})}
async function showAll(){const btn=page.getByRole('button',{name:'立即显示全部'});if(await btn.count())await btn.click();await page.locator('#assistant-panel .answer').last().waitFor()}
async function axe(name){await page.waitForTimeout(350);const scan=await new AxeBuilder({page}).include('#assistant-panel').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();a11y.push({name,violations:scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});assert.equal(scan.violations.length,0,JSON.stringify(a11y.at(-1)))}
await page.goto(base+'/#/reports',{waitUntil:'networkidle'})
await page.getByRole('button',{name:'问小瞳',exact:true}).click()
await page.locator('.assistant-welcome').waitFor()
await check('welcome accessible, no overflow on 7 screen sizes',async()=>{
 for(const [width,height]of [[1440,1000],[1280,720],[1024,600],[900,700],[768,1024],[390,844],[375,667]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100)
  const result=await page.locator('#assistant-panel').evaluate(el=>{const body=el.querySelector('.body');const first=el.querySelector('.assistant-welcome');const footer=el.querySelector('.composer');return {width:innerWidth,doc:document.documentElement.scrollWidth,panel:el.clientWidth,scroll:el.scrollWidth,bodyTop:body.getBoundingClientRect().top,firstTop:first.getBoundingClientRect().top,footerBottom:footer.getBoundingClientRect().bottom,height:innerHeight}})
  layouts.push(result);assert.ok(result.doc<=width+1);assert.ok(result.scroll<=result.panel+1);assert.ok(result.firstTop>=result.bodyTop-1);assert.ok(result.footerBottom<=height+1)
 }
})
await axe('welcome-375')
await page.setViewportSize({width:1440,height:1000})
await shot('after-wide')
await axe('welcome-wide')
await check('starter card sends exactly one actual server query and busy locks composer',async()=>{
 let release;const hold=new Promise(r=>release=r)
 await page.route('**/assistant/query',async route=>{const response=await route.fetch();await hold;await route.fulfill({response})})
 const before=writes.filter(r=>r.path.endsWith('/assistant/query')).length
 await page.getByRole('button',{name:'全校有哪些异常？',exact:true}).click()
 assert.equal(await page.getByRole('textbox',{name:'问小瞳',exact:true}).isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'处理中',exact:true}).isDisabled(),true)
 release()
 await page.getByRole('textbox',{name:'问小瞳',exact:true}).waitFor()
 await page.waitForFunction(()=>!document.querySelector('textarea[name="assistant-question"]').disabled)
 await page.unroute('**/assistant/query');await showAll();assert.equal(writes.filter(r=>r.path.endsWith('/assistant/query')).length,before+1)
 assert.ok((await page.locator('#assistant-panel .answer').last().innerText()).includes('业务事实'))
})
await check('IME confirmation and Shift Enter do not send; Enter submits real FAQ',async()=>{
 const input=page.getByRole('textbox',{name:'问小瞳',exact:true});const before=writes.filter(r=>r.path.endsWith('/assistant/query')).length
 await input.fill('系统有哪些演示身份？')
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true})
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229})
 await input.press('End');await input.press('Shift+Enter')
 assert.ok((await input.inputValue()).includes('\n'));assert.equal(writes.filter(r=>r.path.endsWith('/assistant/query')).length,before)
 await input.fill('系统有哪些演示身份？');await input.press('Enter')
 await page.waitForFunction(()=>!document.querySelector('textarea[name="assistant-question"]').disabled)
 await showAll();assert.equal(writes.filter(r=>r.path.endsWith('/assistant/query')).length,before+1)
})
await check('real knowledge citation opens original text',async()=>{
 const citation=page.locator('#assistant-panel .citation').first();await citation.waitFor();await citation.click()
 await page.locator('#assistant-panel .citation-body .text').first().waitFor();assert.ok((await page.locator('#assistant-panel .citation-body .text').first().innerText()).length>20)
 assert.equal(await citation.getAttribute('aria-expanded'),'true')
})
await shot('answer-wide');await axe('answer-wide')
await page.setViewportSize({width:390,height:844});await shot('answer-narrow');await axe('answer-narrow')
await check('recommendations and data explanation remain usable',async()=>{
 await page.locator('#assistant-panel .explanation summary').click();assert.equal(await page.locator('#assistant-panel .explanation').getAttribute('open'),'')
 const more=page.getByRole('button',{name:'更多问题',exact:true});if(await more.count()){await more.click();assert.equal(await more.getAttribute('aria-expanded'),'true')}
})
await check('Escape closes and reopen restores current conversation',async()=>{
 await page.locator('#assistant-panel textarea').focus();await page.keyboard.press('Escape');await page.locator('#assistant-panel').waitFor({state:'hidden'})
 await page.getByRole('button',{name:'问筑瞳：打开本地数据问答',exact:true}).click();await page.locator('#assistant-panel .answer').last().waitFor()
})
await check('desktop drawer allows underlying page interaction',async()=>{
 await page.setViewportSize({width:1440,height:1000})
 const link=page.locator('.side').getByRole('link',{name:'校园态势',exact:true});const target=await link.getAttribute('href');await link.click();await page.waitForURL(url=>url.hash===target);assert.equal(await page.locator('#assistant-panel').isVisible(),true)
})
await check('page reload restores server conversation without resubmitting questions',async()=>{
 const before=writes.filter(r=>r.path.endsWith('/assistant/query')).length
 await page.reload({waitUntil:'networkidle'})
 if(!await page.locator('#assistant-panel').count())await page.getByRole('button',{name:'问筑瞳：打开本地数据问答',exact:true}).click()
 await page.locator('#assistant-panel .question').filter({hasText:'系统有哪些演示身份？'}).last().waitFor()
 assert.equal(writes.filter(r=>r.path.endsWith('/assistant/query')).length,before)
})
await context.close()
const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
const rp=await reduced.newPage();await rp.goto(base+'/#/reports',{waitUntil:'networkidle'});await rp.getByRole('button',{name:'问筑瞳：打开本地数据问答',exact:true}).click();await rp.locator('.assistant-welcome').waitFor()
assert.equal(await rp.locator('.starter-card').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');checks.push('reduced motion disables decorative card transition')
await rp.screenshot({path:output+'/screens/after-narrow.png',animations:'disabled'});await reduced.close()
await browser.close()
assert.equal(errors.length,0);assert.ok(replies.every(r=>r.status===200));assert.equal(replies.length,2)
await writeFile(output+'/browser.json',JSON.stringify({base,checks,layouts,a11y,errors,writes,replies},null,2))
console.log('All '+checks.length+' interaction groups passed, '+a11y.length+' axe scans clear')
