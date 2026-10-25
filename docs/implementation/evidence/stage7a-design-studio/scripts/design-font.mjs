import assert from 'node:assert/strict'
import { chromium } from './browser/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const out=process.env.DESIGN_EVIDENCE??'backend/.runtime-ui-refresh/design-recheck'
await mkdir(out,{recursive:true})
const base=process.argv[2]??'http://127.0.0.1:5180'
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1120},reducedMotion:'reduce'})
const page=await context.newPage()
await page.goto(base+'/design-studio/index.html',{waitUntil:'networkidle'})
const results=[]
for(const screen of ['workbench','monitoring','statistics','task','report','order','profile','sync']){
 await page.locator('#screen-picker').selectOption(screen)
 await page.locator('#device').evaluate(el=>{
  const values=[el,...el.querySelectorAll('*')].map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}))
  for(const {node,size} of values)node.style.fontSize=(size*2)+'px'
 })
 const r=await page.locator('#device').evaluate(el=>{const content=el.querySelector('.app-content');return {width:el.clientWidth,scroll:el.scrollWidth,contentWidth:content.clientWidth,contentScroll:content.scrollWidth}})
 results.push({screen,scale:2,...r})
 if(r.scroll>r.width+1||r.contentScroll>r.contentWidth+1)console.log('OVERFLOW '+JSON.stringify(results.at(-1)))
 // Inline sizing is reset between pages to avoid cumulative scaling.
 await page.reload({waitUntil:'networkidle'})
}
await page.locator('#screen-picker').selectOption('alarm')
await page.getByRole('textbox',{name:'排查结果'}).fill('原型核对现场状态，保留排查结果和处理措施。')
await page.getByRole('textbox',{name:'处置措施'}).fill('设置观察记录。')
await page.locator('#state-picker').selectOption('error');await page.locator('#state-picker').selectOption('normal')
assert.ok((await page.getByRole('textbox',{name:'排查结果'}).inputValue()).includes('保留排查结果'))
assert.equal(await page.getByRole('textbox',{name:'处置措施'}).inputValue(),'设置观察记录。')
await page.getByRole('textbox',{name:'排查结果'}).focus();await page.keyboard.press('Tab')
assert.equal(await page.getByRole('textbox',{name:'处置措施'}).evaluate(el=>el===document.activeElement),true)
const keyboard={draftRestored:true,tabOrder:true,reducedMotion:await page.locator('.action').first().evaluate(el=>getComputedStyle(el).transitionDuration)}
await browser.close()
await writeFile(out+'/font-keyboard.json',JSON.stringify({base,results,keyboard,scope:'Browser text-only 200% style stress, not native system font scaling or screen reader verification'},null,2))
assert.ok(results.every(r=>r.scroll<=r.width+1&&r.contentScroll<=r.contentWidth+1))
console.log('Text 200% and keyboard checks passed')
