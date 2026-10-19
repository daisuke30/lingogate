import { webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
const out=process.argv[2]; const base=process.argv[3]||'http://localhost:4173';
let pv=null;
if(!(await fetch(base+'/').then(r=>r.ok).catch(()=>false))){pv=spawn('npx',['vite','preview','--port','4173','--strictPort'],{stdio:'ignore'});const d=Date.now()+30000;while(Date.now()<d){if(await fetch(base+'/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,300));}}
const b=await webkit.launch();
const ctx=await b.newContext({...devices['iPhone 13'],viewport:{width:390,height:844},serviceWorkers:'block'});
const page=await ctx.newPage(); page.setDefaultNavigationTimeout(60000);
const reqs=[]; page.on('request',r=>{ if(/explain\./.test(r.url())) reqs.push(r.url().split('/').pop()); });
await page.goto(base+'/?skipOnboarding=1',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>(document.querySelector('#root')?.childElementCount??0)>0);
await page.waitForTimeout(1500);
// Katsuta's exact setup: UI=ja (default), front=en (default for ru), and T0174 due.
await page.evaluate(async ()=>{
  const req=indexedDB.open('lingogate');
  const db=await new Promise(r=>{req.onsuccess=()=>r(req.result)});
  const now=Date.now();
  await new Promise(r=>{
    const m=db.transaction('meta','readwrite').objectStore('meta');
    m.put({key:'i18n.appLang', value:'ja'});
    m.put({key:'course.frontLang.ru', value:'en'});
    m.put({key:'onboarding.seen', value:true});
    m.put({key:'course.placementDeferred.ru', value:true});
    m.transaction.oncomplete=()=>r();
  });
  await new Promise(r=>{
    const t=db.transaction('reviewStates','readwrite').objectStore('reviewStates');
    t.put({sentenceId:'T0174',direction:'en2ru',stability:2,difficulty:5,due:now-86400000,reps:1,lapses:0,state:2,lastReview:now-172800000});
    t.transaction.oncomplete=()=>r();
  });
});
await page.goto(base+'/?skipOnboarding=1',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>(document.querySelector('#root')?.childElementCount??0)>0);
await page.waitForTimeout(1800);
const start=page.locator('.btn.primary').first();
if(await start.count()){ await start.click(); await page.waitForTimeout(2500); }
const card=page.locator('.flashcard').first();
await card.click().catch(()=>{}); await page.waitForTimeout(700);
console.log('card:', JSON.stringify((await card.innerText().catch(()=>'')).replace(/\n/g,' | ').slice(0,130)));
const btn=page.locator('.iconbtn.explain').first();
if(!(await btn.count())){ console.log('NO explain button'); await b.close(); if(pv)pv.kill(); process.exit(0); }
await btn.click();
await page.waitForSelector('.explain-body .explain-section',{timeout:40000}).catch(()=>{});
await page.waitForTimeout(700);
await page.screenshot({path:`${out}/check-front-en.png`});
console.log('CHUNKS FETCHED:', JSON.stringify(reqs));
console.log('SHEET:', (await page.locator('.sheet').innerText()).replace(/\n/g,' | ').slice(0,360));
await b.close(); if(pv) pv.kill();
