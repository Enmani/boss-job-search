import { Client } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { chromium } from '../plugin/node_modules/playwright-core/index.mjs';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root=mkdtempSync(join(tmpdir(),'job-search-live-'));
const args=process.argv.slice(2),reportPath=args.find(value=>value.startsWith('--report='))?.slice(9);
const screenshotPath=args.find(value=>value.startsWith('--screenshot='))?.slice(13);
const report={checkedAt:new Date().toISOString(),version:'0.2.0',greenhouse:null,panel:null,boss:null,persistence:null};
let client,browser;
async function connect() {
  const connection=new Client({name:'job-search-live-check',version:'0.2.0'});
  await connection.connect(new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../plugin/src/server.mjs',import.meta.url))],
    env:{...process.env,BOSS_DATA_DIR:root,
      ...(args.includes('--boss') ? {BOSS_BRIDGE_CONFIG:process.env.BOSS_BRIDGE_CONFIG || join(process.env.LOCALAPPDATA,'boss-job-search','bridge','config.json')} : {})},stderr:'pipe'}));
  return connection;
}
async function call(name,input={}) {
  const result=await client.callTool({name,arguments:input});
  if(result.isError)throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}
try {
  client=await connect();await call('set_greenhouse_boards',{boards:['anthropic']});
  const result=await call('search_jobs',{platform:'greenhouse',query:'Product Manager',limit:3});
  assert.equal(result.state,'ready');assert.ok(result.jobs.length);
  const detail=(await call('get_job_detail',{jobId:result.jobs[0].id})).job;
  assert.ok(detail.description.length>100);assert.equal(detail.company,'Anthropic');
  await call('update_progress',{jobId:detail.id,status:'收藏',note:'隔离资料中的验证记录',requestId:randomUUID()});
  report.greenhouse={state:result.state,boards:result.search.boards,returned:result.jobs.length,
    url:detail.url,title:detail.title,descriptionCharacters:detail.description.length,compensation:detail.compensation};
  const {url}=await call('open_dashboard');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('.job-card').first().waitFor();
  await page.locator('#source').selectOption('greenhouse');await page.locator('#query').fill('Product Manager');
  await page.locator('#search-form button').click();await page.getByText('已保存 30 个岗位',{exact:true}).waitFor({timeout:60000});
  await page.locator('.job-card button').first().click();await page.locator('#job-dialog').waitFor({state:'visible'});
  await page.locator('#detail-refresh').click();await page.getByText('完整详情已更新',{exact:true}).waitFor({timeout:60000});
  assert.ok((await page.locator('#job-description').textContent()).length>100);
  await page.locator('#close-dialog').click();
  if(screenshotPath)await page.screenshot({path:resolve(screenshotPath),fullPage:true});
  assert.deepEqual(errors,[]);report.panel={state:'passed',flow:'真实 Greenhouse 搜索→详情→共用本机记录',shown:await page.locator('.job-card').count()};
  await browser.close();browser=null;
  if(args.includes('--boss')) {
    try {
      const status=await call('get_status');assert.equal(status.browser.state,'connected');
      const found=await call('search_jobs',{platform:'boss',query:'AI产品',limit:3});
      assert.equal(found.state,'ready');assert.ok(found.jobs.length);
      const read=await call('get_job_detail',{jobId:found.jobs[0].id});assert.equal(read.state,'detail');
      assert.ok(read.job.description.length>100);
      report.boss={state:'passed',returned:found.jobs.length,title:read.job.title,url:read.job.url,
        descriptionCharacters:read.job.description.length};
    } catch(error) {report.boss={state:'failed',message:error.message};}
  }
  await client.close();client=await connect();
  const saved=(await call('get_saved_job',{jobId:detail.id}));
  assert.equal(saved.job.status,'收藏');assert.equal(saved.events.length,1);assert.equal(saved.job.compensation[0]?.currency,detail.compensation[0]?.currency);
  report.persistence={state:'passed',status:saved.job.status,events:saved.events.length};
  if(report.boss?.state==='failed')process.exitCode=1;
} catch(error) {report.error=error.message;process.exitCode=1;}
finally {
  if(browser)await browser.close();if(client)await client.close();
  if(reportPath)writeFileSync(resolve(reportPath),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));rmSync(root,{recursive:true,force:true});
}
