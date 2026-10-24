import { webkit, devices } from 'playwright';
const out=process.argv[2], base=process.argv[3], sids=process.argv[4].split(',');
const JA=/[ぁ-んァ-ン一-龥]/;
const b=await webkit.launch();
for (const sid of sids) {
  const ctx=await b.newContext({...devices['iPhone 13'],viewport:{width:390,height:844},serviceWorkers:'block'});
  const page=await ctx.newPage(); page.setDefaultNavigationTimeout(60000);
  const reqs=[]; page.on('request',r=>{ if(/explain\./.test(r.url())) reqs.push(r.url().split('/').pop()); });
  await page.goto(base+'/?skipOnboarding=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>(document.querySelector('#root')?.childElementCount??0)>0);
  await page.waitForTimeout(1600);
  await page.evaluate(async (sid)=>{
    const req=indexedDB.open('lingogate'); const db=await new Promise(r=>{req.onsuccess=()=>r(req.result)}); const now=Date.now();
    await new Promise(r=>{const m=db.transaction('meta','readwrite').objectStore('meta');
      m.put({key:'i18n.appLang',value:'ja'}); m.put({key:'course.frontLang.ru',value:'en'});
      m.put({key:'onboarding.seen',value:true}); m.put({key:'course.placementDeferred.ru',value:true});
      m.transaction.oncomplete=()=>r();});
    await new Promise(r=>{const t=db.transaction('reviewStates','readwrite').objectStore('reviewStates');
      t.put({sentenceId:sid,direction:'en2ru',stability:2,difficulty:5,due:now-86400000,reps:1,lapses:0,state:2,lastReview:now-172800000});
      t.transaction.oncomplete=()=>r();});
  }, sid);
  await page.goto(base+'/?skipOnboarding=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>(document.querySelector('#root')?.childElementCount??0)>0);
  await page.waitForTimeout(2000);
  const start=page.locator('.btn.primary').first(); if(await start.count()){ await start.click(); await page.waitForTimeout(2800); }
  const card=page.locator('.flashcard').first(); await card.click().catch(()=>{}); await page.waitForTimeout(900);
  const t0=Date.now();
  await page.locator('.explain-cta').first().click();
  await page.waitForSelector('.explain-body .explain-section',{timeout:45000}).catch(()=>{});
  const cold=Date.now()-t0;
  const tWords=Date.now();
  await page.waitForFunction(()=>document.querySelectorAll('.explain-word').length>0,{timeout:45000}).catch(()=>{});
  const wordsMs=Date.now()-tWords;
  await page.waitForTimeout(700);
  const sk=await page.evaluate(()=>[...document.querySelectorAll('.explain-skeleton li')].map(li=>({s:li.querySelector('.explain-surface')?.textContent,n:li.querySelector('.explain-note')?.textContent})));
  const rp=await page.evaluate(()=>[...document.querySelectorAll('.explain-replies li')].map(li=>({ru:li.querySelector('.explain-reply-ru')?.textContent,g:li.querySelector('.explain-note')?.textContent})));
  const gl=await page.evaluate(()=>[...document.querySelectorAll('.explain-gloss')].map(e=>e.textContent));
  console.log(`\n=== ${sid} === sheet visible ${cold}ms | +words ${wordsMs}ms | chunks ${reqs.length}`);
  console.log(' skeleton notes JA:', sk.every(x=>JA.test(x.n||'')), JSON.stringify(sk.slice(0,2)));
  console.log(' reply glosses EN:', rp.every(x=>x.g&&!JA.test(x.g)), JSON.stringify(rp));
  console.log(' word glosses:', JSON.stringify(gl.slice(0,4)));
  await page.screenshot({path:`${out}/${sid}.png`});
  await page.evaluate(()=>{const b=document.querySelector('.explain-body'); b.scrollTop=b.scrollHeight*0.55;});
  await page.waitForTimeout(400); await page.screenshot({path:`${out}/${sid}-words.png`});
  await ctx.close();
}
await b.close();
