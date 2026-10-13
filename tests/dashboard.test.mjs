import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '../plugin/node_modules/playwright-core/index.mjs';
import { createApp } from '../plugin/src/server.mjs';
import { GreenhouseJobs } from '../plugin/src/greenhouse.mjs';
import { greenhouseFetch,disconnectedBoss } from './greenhouse-fixture.mjs';

const appFor=root=>createApp(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}));
test('local panel rejects missing credentials, foreign origins and filesystem tools',async()=>{
  const root=mkdtempSync(join(tmpdir(),'job-panel-')),app=appFor(root);
  try {
    const url=new URL(await app.dashboard.open()),token=new URLSearchParams(url.hash.slice(1)).get('token');
    const request=(tool,body,headers={})=>fetch(`${url.origin}/api/tools/${tool}`,{method:'POST',
      headers:{'Content-Type':'application/json',Origin:url.origin,Authorization:`Bearer ${token}`,...headers},body:JSON.stringify(body)});
    assert.equal((await request('list_jobs',{}, {Authorization:''})).status,401);
    assert.equal((await request('update_progress',{}, {Origin:'https://evil.test'})).status,403);
    assert.equal((await request('import_resume',{path:'C:/private/resume.pdf'})).status,404);
    assert.equal((await request('list_jobs',{profile:'../other'})).status,400);
    assert.equal((await request('list_jobs',{})).status,200);
    const html=await fetch(url.origin+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.equal((await fetch(url.origin+'/?token='+token)).status,404);
  } finally {await app.close();rmSync(root,{recursive:true,force:true});}
});
test('real browser panel: search, detail, progress, filtering, responsive themes and persistent records',async()=>{
  const root=mkdtempSync(join(tmpdir(),'job-panel-ui-'));let app=appFor(root),browser;
  try {
    const url=await app.dashboard.open();
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);await page.getByText('还没有岗位记录',{exact:true}).waitFor();
    await page.locator('#settings-link').click();await page.locator('[data-platform="greenhouse"] textarea').fill('https://job-boards.greenhouse.io/sampleco');
    await page.locator('[data-platform="greenhouse"] button[type="submit"]').click();await page.getByText('目标公司已保存',{exact:true}).waitFor();
    await page.locator('#home-link').click();await page.locator('#source').selectOption('greenhouse');
    await page.locator('#query').fill('Product');await page.locator('#search-form button').click();
    await page.getByText('已保存 1 个岗位',{exact:true}).waitFor();
    assert.equal(app.store('personal').list()[0].platform,'greenhouse');
    await page.getByRole('button',{name:'查看',exact:true}).click();await page.locator('#job-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#job-description').textContent(),/Three years of product experience/);
    await page.locator('#detail-refresh').click();await page.getByText('完整详情已更新',{exact:true}).waitFor();
    assert.match(await page.locator('#job-meta').textContent(),/USD/);
    await page.locator('#favorite').click();await page.getByText('进度已保存',{exact:true}).waitFor();
    await page.locator('#progress-status').selectOption('已投递');await page.locator('#progress-note').fill('本人已提交（样例测试）');
    await page.locator('#progress-form button').click();await page.waitForFunction(()=>document.querySelector('#history li p').textContent.startsWith('已投递'));
    await page.locator('#close-dialog').click();await page.locator('#board-mode').click();
    assert.equal(await page.locator('.kanban-column > h3').textContent(),'已投递 · 1');
    for(const theme of ['light','dark'])for(const width of [1280,740,390]) {
      await page.setViewportSize({width,height:1000});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`${theme} ${width} overflow`);
      assert.ok(await page.evaluate(()=>[...document.querySelectorAll('button,label,p,h1,h2,h3')].every(node=>parseFloat(getComputedStyle(node).fontSize)>=14)));
    }
    await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.documentElement.style.zoom='2');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    await page.getByRole('button',{name:'查看',exact:true}).click();
    await page.locator('#job-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
    await page.locator('#job-dialog').waitFor({state:'hidden'});await page.evaluate(()=>document.documentElement.style.zoom='1');
    await page.locator('#filter-status').selectOption('拒绝');await page.locator('#filter-form button[type="submit"]').click();
    await page.getByText('没有符合条件的记录',{exact:true}).waitFor();assert.deepEqual(errors,[]);
    await browser.close();browser=null;await app.close();app=appFor(root);
    const saved=app.store('personal').list()[0];assert.equal(saved.status,'已投递');assert.equal(app.store('personal').history(saved.id).length,2);
    assert.equal(app.store('other').list().length,0);
  } finally {if(browser)await browser.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
