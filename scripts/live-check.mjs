import { Client } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { chromium } from '../plugin/node_modules/playwright-core/index.mjs';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { VERSION } from '../plugin/src/server.mjs';

const root=mkdtempSync(join(tmpdir(),'job-search-live-'));
const args=process.argv.slice(2),reportPath=args.find(value=>value.startsWith('--report='))?.slice(9);
const screenshotPath=args.find(value=>value.startsWith('--screenshot='))?.slice(13);
const resumePath=args.find(value=>value.startsWith('--resume='))?.slice(9),contextPath=args.find(value=>value.startsWith('--context='))?.slice(10);
const keepData=args.includes('--keep-data');
const report={checkedAt:new Date().toISOString(),version:VERSION,greenhouse:null,ashby:null,lever:null,manualImport:null,panel:null,boss:null,persistence:null};
const candidates=[];
let client,browser;
async function connect() {
  const connection=new Client({name:'job-search-live-check',version:VERSION});
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
  candidates.push(detail.id);
  for(const [platform,board] of [['ashby','openai'],['lever','spotify']]) {
    await call('set_platform_boards',{platform,boards:[board]});
    const found=await call('search_jobs',{platform,query:'Product Manager',limit:30});
    report[platform]={state:found.state,boards:found.search.boards,returned:found.jobs.length};
    assert.equal(found.state,'ready');assert.ok(found.jobs.length);
    const candidate=found.jobs.find(job=>/Product Manager/i.test(job.title)) || found.jobs[0];
    const read=await call('get_job_detail',{jobId:candidate.id});assert.equal(read.state,'detail');assert.ok(read.job.description.length>100);
    candidates.push(read.job.id);
    report[platform]={state:found.state,boards:found.search.boards,returned:found.jobs.length,title:read.job.title,
      url:read.job.url,descriptionCharacters:read.job.description.length,compensation:read.job.compensation};
    if(platform==='lever') {
      const imported=await call('import_job',{url:read.job.url,title:read.job.title,company:read.job.company,location:read.job.location,
        salary:read.job.salary,description:read.job.description,compensation:read.job.compensation});
      assert.equal(imported.job.id,read.job.id);assert.equal(imported.job.source,'manual_import');
      report.manualImport={state:'passed',url:imported.job.url,descriptionCharacters:imported.job.description.length,identityPreserved:true};
    }
  }
  const {url}=await call('open_dashboard');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('.job-card').first().waitFor();
  await page.locator('#settings-link').click();await page.locator('.platform-card').last().waitFor();
  assert.deepEqual(await page.locator('.platform-card').evaluateAll(cards=>cards.map(card=>card.dataset.platform).sort()),['ashby','boss','greenhouse','lever','linkedin']);
  await page.locator('[data-platform="ashby"]').getByRole('button',{name:'检测',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-platform="ashby"] .platform-status').textContent==='检测通过',{},{timeout:60000});
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  }
  await page.setViewportSize({width:1280,height:1000});
  if(screenshotPath)await page.screenshot({path:resolve(screenshotPath),fullPage:true});
  await page.locator('#home-link').click();
  await page.locator('#source').selectOption('greenhouse');await page.locator('#query').fill('Product Manager');
  await page.locator('#search-form button').click();await page.getByText('已保存 30 个岗位',{exact:true}).waitFor({timeout:60000});
  await page.locator('.job-card button').first().click();await page.locator('#job-dialog').waitFor({state:'visible'});
  await page.locator('#detail-refresh').click();await page.getByText('完整详情已更新',{exact:true}).waitFor({timeout:60000});
  assert.ok((await page.locator('#job-description').textContent()).length>100);
  await page.locator('#close-dialog').click();
  await page.locator('#rank').click();await page.locator('.ranking-result').first().waitFor();
  assert.deepEqual(errors,[]);report.panel={state:'passed',flow:'设置页→真实 Ashby 检测→Greenhouse 搜索→详情→筛选排序',shown:await page.locator('.job-card').count()};
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
      candidates.push(read.job.id);
    } catch(error) {report.boss={state:'failed',message:error.message};}
  }
  await client.close();client=await connect();
  const saved=(await call('get_saved_job',{jobId:detail.id}));
  assert.equal(saved.job.status,'收藏');assert.equal(saved.events.length,1);assert.equal(saved.job.compensation[0]?.currency,detail.compensation[0]?.currency);
  report.persistence={state:'passed',status:saved.job.status,events:saved.events.length};
  if(resumePath) {
    const {resume}=await call('import_resume',{path:resolve(resumePath),label:'实际简历验证',...(contextPath?{contextPath:resolve(contextPath)}:{})});
    const context=await call('screening_context',{resumeId:resume.id,jobIds:candidates});
    if(!reportPath || !keepData)throw new Error('Resume screening needs --report and --keep-data for review before saving assessments.');
    writeFileSync(resolve(reportPath+'.context.private.json'),JSON.stringify(context,null,2));
    writeFileSync(resolve(reportPath+'.session.private.json'),JSON.stringify({root,resumeId:resume.id,jobIds:candidates},null,2));
    report.screening={state:'awaiting_codex_assessment',jobs:candidates.length};
  }
  if(report.boss?.state==='failed')process.exitCode=1;
} catch(error) {report.error=error.message;process.exitCode=1;}
finally {
  if(browser)await browser.close();if(client)await client.close();
  if(reportPath)writeFileSync(resolve(reportPath),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));if(!keepData)rmSync(root,{recursive:true,force:true});
}
