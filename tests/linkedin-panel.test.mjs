import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../plugin/node_modules/playwright-core/index.mjs';
import {createApp} from '../plugin/src/server.mjs';
import {GreenhouseJobs} from '../plugin/src/greenhouse.mjs';
import {LinkedInJobs} from '../plugin/src/linkedin.mjs';
import {greenhouseFetch,disconnectedBoss} from './greenhouse-fixture.mjs';
import {linkedFetch} from './linkedin-fixture.mjs';

test('LinkedIn panel buttons search the next actual offset, read details, preserve progress and show rate-limit errors',async()=>{
  const root=mkdtempSync(join(tmpdir(),'linkedin-panel-')),requests=[];
  const reader=new LinkedInJobs({minIntervalMs:0,fetchImpl:url=>{requests.push(url);return linkedFetch(url);}});
  const app=createApp(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}),{linkedin:reader});let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const url=await app.dashboard.open();await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);await page.locator('#settings-link').click();await page.locator('[data-platform="linkedin"] .platform-status').waitFor();
    assert.equal(await page.locator('[data-platform="linkedin"] .platform-status').textContent(),'未检测');
    await page.locator('[data-platform="linkedin"]').getByRole('button',{name:'检测',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-platform="linkedin"] .platform-status').textContent==='检测通过');
    await page.locator('#home-link').click();await page.locator('#source').selectOption('linkedin');
    assert.equal(await page.locator('#city-field').isVisible(),false);await page.locator('#query').fill('AI Product');await page.locator('#location').fill('Milan, Italy');
    await page.locator('#search-form button').click();await page.getByText('已保存 1 个岗位',{exact:true}).waitFor();
    await page.locator('#search-next').click();await page.waitForFunction(()=>document.querySelectorAll('.job-card').length===2);
    assert.equal(new URL(requests.at(-1)).searchParams.get('start'),'1');
    await page.locator('.job-card button').first().click();await page.locator('#job-dialog').waitFor({state:'visible'});
    await page.locator('#detail-refresh').click();await page.getByText('完整详情已更新',{exact:true}).waitFor();
    assert.match(await page.locator('#job-description').textContent(),/Product discovery experience/);
    await page.locator('#favorite').click();await page.getByText('进度已保存',{exact:true}).waitFor();await page.locator('#close-dialog').click();
    const selected=app.store('personal').list().find(job=>job.status==='收藏');assert.equal(app.store('personal').history(selected.id).length,1);
    await page.locator('#query').fill('changed');assert.equal(await page.locator('#search-next').isVisible(),false);
    reader.fetch=async()=>new Response('',{status:429});await page.locator('#search-form button').click();await page.locator('#notice.error').waitFor();
    assert.match(await page.locator('#notice').textContent(),/429/);assert.equal(app.store('personal').list().length,2);
    await page.locator('#settings-link').click();await page.locator('[data-platform="linkedin"] .platform-status').getByText('限流中',{exact:true}).waitFor();
    for(const theme of ['light','dark'])for(const width of [1280,740,390]) {
      await page.setViewportSize({width,height:1000});await page.locator('#theme-select').selectOption(theme);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    }
    await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.documentElement.style.zoom='2');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
