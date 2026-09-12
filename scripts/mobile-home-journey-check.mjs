import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:5197';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5197','--strictPort'], {env:{...process.env,VITE_SUPABASE_URL:base,VITE_SUPABASE_ANON_KEY:'synthetic-key'},stdio:'ignore'});
let browser;
try {
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(/^\/(rest|auth|functions)\//.test(url.pathname))return route.fulfill({contentType:'application/json',body:'[]'});
    return route.continue();
  });
  await mkdir('output/mobile-home',{recursive:true});
  for(const width of [390,320,1440]){
    await page.setViewportSize({width,height:844}); await page.goto(base);
    const reject=page.getByRole('button',{name:'Reject optional',exact:true});
    if(await reject.isVisible())await reject.click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width<500)assert.ok(await page.locator('.hero-media').evaluate(el=>el.getBoundingClientRect().height<640));
    await page.getByRole('link',{name:'Find your school or camp',exact:true}).click();
    await page.waitForTimeout(500);
    assert.ok(await page.locator('#find-your-club').evaluate(el=>el.getBoundingClientRect().top>=0));
    await page.screenshot({path:`output/mobile-home/finder-${width}.png`});
  }
  let count=0;
  for(const category of ['Wraparound','Holiday Camps']){
    await page.goto(base);
    await page.getByLabel('Care type',{exact:true}).selectOption(category);
    const titles=await page.getByLabel('School or camp',{exact:true}).locator('option').allTextContents();
    for(const title of titles){
      await page.goto(base);
      await page.getByLabel('Care type',{exact:true}).selectOption(category);
      await page.getByLabel('School or camp',{exact:true}).selectOption(title);
      assert.ok((await page.locator('.home-route-summary').innerText()).includes(title));
      const link=page.getByRole('link',{name:`Start an Après School booking for ${title}`,exact:true});
      const href=await link.getAttribute('href');
      const url=new URL(href,base);
      const school=title.replace('Holiday Camp at ','').replace('Ripley Court School','Ripley Court');
      assert.equal(url.pathname,'/launch-booking'); assert.equal(url.searchParams.get('school'),school);
      await link.click(); await page.waitForURL('**/launch-booking?school=*');
      await page.getByText('is ready and will stay selected after you sign in',{exact:false}).waitFor();
      assert.ok((await page.locator('body').innerText()).includes(school)); count++;
    }
  }
  assert.equal(count,9);
  console.log('PASS: 3 viewport layouts, compact mobile hero, finder anchor, 9 selected-school routes through sign-in gate. No live accounts or submissions.');
}finally{await browser?.close();server.kill();}
