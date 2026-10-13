import test from 'node:test';
import assert from 'node:assert/strict';
import {AshbyJobs} from '../plugin/src/ashby.mjs';
import {LeverJobs} from '../plugin/src/lever.mjs';
import {jobIdentity,jobSchema} from '../plugin/src/domain.mjs';
import {platformBoards} from '../plugin/src/boards.mjs';
import {getJson} from '../plugin/src/ats-http.mjs';
import {atsFetch,ashbyPost,leverPost,ids} from './ats-fixture.mjs';

test('ATS identity, region and configuration reject foreign origins and inconsistent provenance',()=>{
  assert.equal(platformBoards('ashby',['https://jobs.ashbyhq.com/sample/'])[0],'sample');
  assert.equal(platformBoards('lever',['https://jobs.eu.lever.co/sample/'])[0],'https://jobs.eu.lever.co/sample');
  const global=jobIdentity(leverPost().hostedUrl),eu=jobIdentity(leverPost(ids[0],true).hostedUrl);
  assert.equal(global.region,'global');assert.equal(eu.region,'eu');
  assert.equal(jobIdentity(ashbyPost().applyUrl+'?utm_source=test').url,ashbyPost().jobUrl);
  assert.throws(()=>platformBoards('lever',['https://jobs.eu.lever.co.evil.test/sample']));
  assert.throws(()=>platformBoards('ashby',['sample','https://jobs.ashbyhq.com/sample']));
  assert.throws(()=>jobSchema.parse({url:eu.url,title:'Product',rawText:'body',source:'lever_detail',region:'global'}));
});
test('Ashby reads published full descriptions and salary without treating null equity as salary',async()=>{
  const api=new AshbyJobs({fetchImpl:atsFetch}),result=await api.search({boards:['sample'],query:'Three years',limit:3});
  assert.equal(result.state,'ready');assert.equal(result.jobs.length,1);
  assert.equal((await api.search({boards:['sample'],query:'AI',location:'Paris'})).jobs.length,1);
  assert.deepEqual(result.jobs[0].compensation,[{min:80000,max:100000,currency:'GBP',period:'year',label:''}]);
  const detail=await api.detail(result.jobs[0]);assert.equal(detail.detail.description,result.jobs[0].description);
  const partial=await api.search({boards:['sample','missing'],query:'AI',limit:3});assert.equal(partial.state,'partial');assert.equal(partial.boards[1].code,'ASHBY_NOT_FOUND');
  const malformed=new AshbyJobs({fetchImpl:async()=>Response.json({jobs:[{...ashbyPost(),compensation:{summaryComponents:[{compensationType:'Salary',currencyCode:'GBP',minValue:null,maxValue:100,interval:'1 YEAR'}]}}]})});
  assert.equal((await malformed.search({boards:['sample'],query:'AI'})).state,'failed');
});
test('Lever includes lists and closing text, uses EU endpoints, and rejects wrong detail identity',async()=>{
  const fetched=[],api=new LeverJobs({fetchImpl:url=>{fetched.push(url);return atsFetch(url);}});
  const result=await api.search({boards:['https://jobs.eu.lever.co/sample'],query:'Closing benefits',limit:2});
  assert.equal(result.state,'ready');assert.match(result.jobs[0].description,/Requirements\nThree years of experience\./);
  assert.ok(fetched.every(url=>new URL(url).hostname==='api.eu.lever.co'));
  assert.equal((await api.search({boards:['https://jobs.eu.lever.co/sample'],query:'AI',location:'Stockholm'})).jobs.length,1);
  const detail=await api.detail(result.jobs[0]);assert.equal(detail.detail.region,'eu');assert.equal(detail.detail.compensation[0].period,'year');
  const wrong=new LeverJobs({fetchImpl:async()=>Response.json(leverPost(ids[1],true))});
  await assert.rejects(()=>wrong.detail(result.jobs[0]),error=>error.code==='DETAIL_IDENTITY_INVALID');
});
test('Lever pagination reads beyond first page and fails explicitly on repeated pages',async()=>{
  let calls=0;
  const first=Array.from({length:100},(_,index)=>leverPost(`12345678-1234-4234-8234-${String(index+10).padStart(12,'0')}`));
  const api=new LeverJobs({fetchImpl:async url=>{calls++;return Response.json(new URL(url).searchParams.get('skip')==='0' ? first : [leverPost()]);}});
  const result=await api.search({boards:['sample'],query:'Product',limit:2});assert.equal(result.boards[0].total,101);assert.equal(calls,2);
  const repeat=new LeverJobs({fetchImpl:async()=>Response.json(first)});
  const failed=await repeat.search({boards:['sample'],query:'Product'});assert.equal(failed.state,'failed');assert.equal(failed.boards[0].code,'LEVER_PAGINATION_INVALID');
});
test('public HTTP transport rejects non-JSON, excessive data, rate limits and timeouts',async()=>{
  for(const [response,code] of [[new Response('html'),'ASHBY_DATA_INVALID'],[Response.json({},{status:429}),'ASHBY_RATE_LIMIT'],[Response.json({large:'x'.repeat(100)}),'ASHBY_TOO_LARGE']])
    await assert.rejects(()=>getJson('https://api.ashbyhq.com/',{platform:'ashby',maxBytes:30,fetchImpl:async()=>response}),error=>error.code===code);
  await assert.rejects(()=>getJson('https://api.ashbyhq.com/',{platform:'ashby',timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))}),error=>error.code==='ASHBY_TIMEOUT');
  let calls=0;const api=new AshbyJobs({fetchImpl:async()=>{calls++;return Response.json({});}});
  await assert.rejects(()=>api.search({boards:['https://evil.test/sample'],query:'AI'}));assert.equal(calls,0);
});
