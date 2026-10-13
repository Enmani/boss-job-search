import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../plugin/node_modules/playwright-core/index.mjs';
import {createApp} from '../plugin/src/server.mjs';
import {GreenhouseJobs} from '../plugin/src/greenhouse.mjs';
import {AshbyJobs} from '../plugin/src/ashby.mjs';
import {LeverJobs} from '../plugin/src/lever.mjs';
import {greenhouseFetch,disconnectedBoss} from './greenhouse-fixture.mjs';
import {atsFetch} from './ats-fixture.mjs';

test('settings cards configure and detect platforms; preferences, import and ranking work through actual buttons',async()=>{
  const root=mkdtempSync(join(tmpdir(),'job-settings-'));
  const app=createApp(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}),{ashby:new AshbyJobs({fetchImpl:atsFetch}),lever:new LeverJobs({fetchImpl:atsFetch})});
  let browser;
  try {
    const resume=app.store('personal').addResume({label:'产品路线',text:'Build AI products.',contextText:''});
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const url=await app.dashboard.open();await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);await page.locator('#settings-link').click();await page.locator('.platform-card').last().waitFor();
    assert.equal(await page.locator('.platform-card').count(),4);assert.equal(await page.locator('[data-platform="ashby"] .platform-status').textContent(),'未添加公司');
    for(const platform of ['ashby','lever']) {
      await page.locator(`[data-platform="${platform}"] textarea`).fill(platform==='ashby' ? 'https://jobs.ashbyhq.com/sample' : 'https://jobs.eu.lever.co/sample');
      await page.locator(`[data-platform="${platform}"] button[type="submit"]`).click();await page.getByText('目标公司已保存',{exact:true}).waitFor();
      await page.locator(`[data-platform="${platform}"]`).getByRole('button',{name:'检测',exact:true}).click();
      await page.waitForFunction(p=>document.querySelector(`[data-platform="${p}"] .platform-status`).textContent==='检测通过',platform);
    }
    await page.locator('#default-resume').selectOption(resume.id);await page.locator('#minimum-salary').fill('80000');
    await page.locator('#salary-currency').selectOption('GBP');await page.locator('#salary-period').selectOption('year');
    await page.locator('#preferences-form button').click();await page.getByText('求职条件已保存',{exact:true}).waitFor();
    for(const theme of ['light','dark'])for(const width of [1280,740,390]) {
      await page.setViewportSize({width,height:1000});await page.locator('#theme-select').selectOption(theme);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    }
    await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.documentElement.style.zoom='2');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    await page.locator('#home-link').click();await page.locator('#source').selectOption('ashby');
    assert.equal(await page.locator('#boards-form').count(),0);
    await page.locator('#query').fill('AI');await page.locator('#search-form button').click();await page.getByText('已保存 1 个岗位',{exact:true}).waitFor();
    await page.locator('#source').selectOption('lever');await page.locator('#search-form button').click();await page.getByText('已保存 1 个岗位',{exact:true}).waitFor();
    await page.locator('#import-open').click();await page.locator('#import-url').fill('https://example.com/jobs/manual');
    await page.locator('#import-job-title').fill('Manual Product');await page.locator('#import-description').fill('Build AI products. <script>window.injected=true</script>');
    await page.locator('#import-form button[type="submit"]').click();await page.getByText('岗位已导入',{exact:true}).waitFor();
    await page.locator('#rank').click();await page.waitForFunction(()=>document.querySelector('#rank').getAttribute('aria-pressed')==='true' && document.querySelectorAll('.ranking-result').length===3);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    assert.match(await page.locator('.job-card').filter({hasText:'Manual Product'}).locator('.ranking-result').textContent(),/待核实 · 未筛选/);
    await page.locator('.job-card').filter({hasText:'Manual Product'}).getByRole('button',{name:'查看'}).click();
    await page.locator('#job-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#detail-refresh').isVisible(),false);
    assert.match(await page.locator('#job-description').textContent(),/<script>/);await page.keyboard.press('Escape');
    const prefs=app.store('personal').preferences();assert.equal(prefs.defaultResumeId,resume.id);assert.equal(prefs.minimumSalary.currency,'GBP');
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
