import { chromium } from './browser/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const root = process.env.ASSISTANT_UI_EVIDENCE ?? 'backend/.runtime-ui-refresh/assistant-capture-recheck'
await mkdir(root + '/screens', {recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
for(const [name,base] of [['before','http://127.0.0.1:8080'],['after','http://127.0.0.1:5180']]) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.goto(base+'/#/reports',{waitUntil:'networkidle'})
 await page.getByRole('button',{name:'问小瞳',exact:true}).click()
 await page.locator('#assistant-panel').waitFor()
 await page.screenshot({path:root+'/screens/'+name+'-wide.png',animations:'disabled'})
 await writeFile(root+'/'+name+'-dom.txt',await page.locator('#assistant-panel').innerText())
 if(name==='after') {
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:root+'/screens/after-narrow.png',animations:'disabled'})
 }
 await page.close()
}
await browser.close()
console.log('Captured assistant before/after and 390px view')
