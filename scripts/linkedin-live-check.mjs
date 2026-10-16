import {Client} from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),output=args.find(value=>value.startsWith('--report='))?.slice(9),panel=args.includes('--panel');
const root=mkdtempSync(join(tmpdir(),'linkedin-live-')),client=new Client({name:'linkedin-live-check',version:'0.1.0'});
const report={checkedAt:new Date().toISOString(),mode:panel ? 'guest_panel' : 'guest_mcp',state:'not_run',search:null,detail:null,persistence:null};
async function call(name,arguments_={}) {
  const result=await client.callTool({name,arguments:arguments_}),value=JSON.parse(result.content[0].text);
  if(result.isError){const error=new Error(value.message);error.code=value.code;throw error;}return value;
}
async function checkMcp() {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../plugin/src/server.mjs',import.meta.url))],env:{...process.env,BOSS_DATA_DIR:root},stderr:'pipe'}));
  const found=await call('search_jobs',{platform:'linkedin',query:'AI Product',location:'Milan, Italy',limit:1});
  report.search={state:found.state,returned:found.jobs.length,coverage:found.search.coverage,nextOffset:found.search.nextOffset};
  assert.equal(found.state,'ready');assert.equal(found.jobs.length,1);
  const detail=await call('get_job_detail',{jobId:found.jobs[0].id});assert.equal(detail.state,'detail');assert.ok(detail.job.description.length>100);
  report.detail={state:detail.state,url:detail.job.url,title:detail.job.title,characters:detail.job.description.length};
  const saved=await call('get_saved_job',{jobId:detail.job.id});assert.equal(saved.job.description,detail.job.description);report.persistence='passed';
}
async function checkPanel() {
  const {createApp}=await import('../plugin/src/server.mjs'),{chromium}=await import('../plugin/node_modules/playwright-core/index.mjs');
  const app=createApp(root);let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));const url=await app.dashboard.open();
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);await page.getByText('本机求职资料已连接',{exact:true}).waitFor();
    await page.locator('#source').selectOption('linkedin');await page.locator('#query').fill('AI Product');await page.locator('#location').fill('Milan, Italy');
    await page.locator('#search-form button').click();
    await page.waitForFunction(()=>document.querySelector('#notice').classList.contains('error') || document.querySelectorAll('.job-card').length>0,{},{timeout:25000});
    const db=app.store('personal'),search=db.recentSearches()[0];report.search={state:search.state,returned:search.count,coverage:search.coverage,nextOffset:search.nextOffset};
    if(search.state!=='ready'){const error=new Error(search.message);error.code=search.code;throw error;}
    assert.ok(search.count>0);await page.locator('.job-card button').first().click();await page.locator('#job-dialog').waitFor({state:'visible'});
    await page.locator('#detail-refresh').click();
    await page.waitForFunction(()=>{const notice=document.querySelector('#dialog-notice');return notice.classList.contains('error') || notice.textContent==='完整详情已更新';},{},{timeout:25000});
    assert.equal(await page.locator('#dialog-notice').textContent(),'完整详情已更新');
    const description=await page.locator('#job-description').textContent();assert.ok(description.length>100);
    const job=db.list().find(value=>value.description===description);assert.ok(job);
    report.detail={state:'detail',url:job.url,title:job.title,characters:description.length};
    await page.locator('#favorite').click();await page.getByText('进度已保存',{exact:true}).waitFor();
    assert.equal(db.job(job.id).status,'收藏');assert.equal(db.history(job.id).length,1);report.persistence='passed';
    await page.locator('#close-dialog').click();await page.locator('#settings-link').click();
    await page.locator('[data-platform="linkedin"] .platform-status').getByText('读取成功',{exact:true}).waitFor();
    report.panel={search:'passed',detail:'passed',favorite:'passed',settings:'passed'};
    const screenshots=args.find(value=>value.startsWith('--screenshots='))?.slice(14);
    if(screenshots) {
      const {mkdirSync}=await import('node:fs');const target=resolve(screenshots);mkdirSync(target,{recursive:true});
      for(const [theme,width] of [['light',1280],['dark',390]]) {
        await page.setViewportSize({width,height:1000});await page.locator('#theme-select').selectOption(theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
        await page.screenshot({path:join(target,`linkedin-${theme}-${width}.png`),fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await app.close();}
}
try {if(panel)await checkPanel();else await checkMcp();report.state='passed';}
catch(error){report.state='not_passed';report.error={code:error.code || 'CHECK_FAILED',message:error.message};process.exitCode=1;}
finally {
  await client.close();if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));rmSync(root,{recursive:true,force:true});
}
