import { chromium } from './browser/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const out=process.env.DESIGN_EVIDENCE??'backend/.runtime-ui-refresh/design-recheck'
await mkdir(out,{recursive:true})
const base=process.argv[2]??'http://127.0.0.1:5180'
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1120}})
await page.goto(base+'/design-studio/index.html',{waitUntil:'networkidle'})
const initial=await page.evaluate(()=>{
 const nav=performance.getEntriesByType('navigation')[0]
 return {domContentLoadedMs:nav.domContentLoadedEventEnd,loadMs:nav.loadEventEnd,
  resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transfer:r.transferSize,durationMs:r.duration})),
  heapBytes:performance.memory?.usedJSHeapSize??null}
})
const layouts=[]
for(const width of [375,768,1280,1920]){
 await page.setViewportSize({width,height:1120})
 for(const screen of ['workbench','monitoring','point','alarms','alarm','statistics','tasks','task','report','order','sync','profile']){
  await page.locator('#screen-picker').selectOption(screen)
  layouts.push(await page.evaluate(()=>{const el=document.querySelector('.app-content');return {screen:location.hash,width:innerWidth,docWidth:document.documentElement.scrollWidth,content:el.clientWidth,scroll:el.scrollWidth}}))
 }
}
await page.setViewportSize({width:1440,height:1120})
const navigation=await page.evaluate(async()=>{
 const values=[]
 for(const screen of ['workbench','monitoring','alarm','tasks','report','sync','profile']){
  const select=document.querySelector('#screen-picker'),start=performance.now()
  select.value=screen;select.dispatchEvent(new Event('change',{bubbles:true}))
  await new Promise(resolve=>requestAnimationFrame(resolve))
  values.push({screen,nextFrameMs:performance.now()-start})
 }
 return values
})
await page.getByRole('button',{name:'图形资源',exact:true}).click()
await page.locator('.asset-card').first().waitFor()
const gallery=await page.evaluate(()=>({cards:document.querySelectorAll('.asset-card').length,nodes:document.querySelectorAll('#gallery *').length,heapBytes:performance.memory?.usedJSHeapSize??null}))
await browser.close()
if(layouts.some(r=>r.docWidth>r.width+1||r.scroll>r.content+1))throw new Error('layout overflow')
await writeFile(out+'/performance.json',JSON.stringify({base,initial,navigation,gallery,layouts,scope:'Local Chrome without CPU/network throttling; next rAF is not a measured screen presentation or an INP guarantee; gallery is 45 design cards, not a production business stress test.'},null,2))
console.log(JSON.stringify({layoutChecks:layouts.length,initialMs:initial.domContentLoadedMs,gallery},null,2))
