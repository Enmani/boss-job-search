import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../plugin/node_modules/playwright-core/index.mjs';
import { readJobDocument } from '../plugin/chrome-extension/reader.js';

test('extension DOM reader keeps salary glyphs unknown, parses visible card fields and blocks login-gated detail',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  let html='<ul class="rec-job-list"><li><a href="/job_detail/fixture.html">产品经理<br>\uE035-\uE037K<br>1-3年<br>本科<br>样例公司<br>北京·海淀</a></li><li style="display:none"><a href="/job_detail/hidden.html">隐藏岗位</a></li></ul>';
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
    await page.goto('https://www.zhipin.com/web/geek/jobs?query=产品&city=100010000');
    const result=await page.evaluate(readJobDocument,'search');
    assert.equal(result.state,'ready');assert.equal(result.jobs.length,1);
    assert.equal(result.jobs[0].salary,'');assert.equal(result.jobs[0].salaryFontEncoded,true);
    assert.equal(result.jobs[0].company,'样例公司');assert.equal(result.jobs[0].location,'北京·海淀');
    assert.equal(result.jobs[0].experience,'1-3年');assert.equal(result.jobs[0].degree,'本科');
    for(const [body,state] of [['暂无相关职位','empty'],['请完成验证','verification_required']]){
      html='<p>'+body+'</p>';await page.reload();assert.equal((await page.evaluate(readJobDocument,'search')).state,state);
    }
    html='<h1>样例岗位</h1><p>登录查看完整内容</p><div class="job-sec-text">被遮挡描述</div>';
    await page.goto('https://www.zhipin.com/job_detail/fixture.html');
    assert.equal((await page.evaluate(readJobDocument,'detail')).state,'login_required');
    html='<div class="job-banner"><h1>样例岗位</h1><p>北京 3-5年 大专</p><span class="salary">8-10K</span></div><div class="company-name">公司名称<br>样例公司</div><div class="job-sec-text">需要产品需求分析。</div>';
    await page.reload();
    const detail=await page.evaluate(readJobDocument,'detail');
    assert.equal(detail.state,'detail');assert.equal(detail.job.company,'样例公司');
    assert.equal(detail.job.experience,'3-5年');assert.equal(detail.job.description,'需要产品需求分析。');
    html='<div class="job-banner"><h1>AI产品经理</h1><span class="salary">30-50K</span><p>客户公司：某大型知名汽车研发上市公司<span class="text-city">宁德</span> <span class="text-exp">经验不限</span> <span class="text-degree">学历不限</span></p></div><div class="job-sec-text">岗位职责：规划 AI 原生产品。</div>';
    await page.reload();
    const clientDetail=await page.evaluate(readJobDocument,'detail');
    assert.equal(clientDetail.job.company,'某大型知名汽车研发上市公司');
    assert.equal(clientDetail.job.location,'宁德');
  } finally {await browser.close();}
});
