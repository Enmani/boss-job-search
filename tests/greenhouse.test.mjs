import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../plugin/src/store.mjs';
import { GreenhouseJobs,descriptionText } from '../plugin/src/greenhouse.mjs';
import { jobSchema,jobIdentity,greenhouseBoard,constraintHints } from '../plugin/src/domain.mjs';
import { post,greenhouseFetch } from './greenhouse-fixture.mjs';

test('Greenhouse canonical identity survives host aliases and rejects mismatched provenance',()=>{
  const identity=jobIdentity('https://boards.greenhouse.io/sampleco/jobs/123?gh_src=fixture');
  assert.equal(identity.url,'https://job-boards.greenhouse.io/sampleco/jobs/123');
  assert.equal(greenhouseBoard(identity.url),'sampleco');
  assert.throws(()=>jobIdentity('https://job-boards.greenhouse.io.evil.test/sampleco/jobs/123'));
  assert.throws(()=>jobSchema.parse({url:identity.url,title:'Product Manager',rawText:'Product team',source:'boss_detail'}));
  assert.throws(()=>jobSchema.parse({url:identity.url,title:'Product Manager',rawText:'Product team',source:'greenhouse_detail',platformJobId:'124'}));
});
test('public board search filters actual full descriptions, location and reports partial failure',async()=>{
  const gh=new GreenhouseJobs({fetchImpl:greenhouseFetch});
  const result=await gh.search({boards:['sampleco'],query:'AI products',location:'London',limit:3});
  assert.equal(result.state,'ready');assert.equal(result.matched,1);assert.match(result.jobs[0].description,/Three years/);
  assert.doesNotMatch(result.jobs[0].description,/<p>|&lt;/);
  assert.equal((await gh.search({boards:['sampleco'],query:'AI products',location:'Berlin',limit:3})).state,'empty');
  const partial=await gh.search({boards:['sampleco','missing'],query:'Product',limit:3});
  assert.equal(partial.state,'partial');assert.equal(partial.jobs.length,1);assert.equal(partial.boards[1].code,'GREENHOUSE_NOT_FOUND');
  assert.equal((await gh.search({boards:['missing'],query:'Product',limit:3})).state,'failed');
  assert.match(descriptionText('&amp;lt;p&amp;gt;AI &amp;amp; design&amp;lt;/p&amp;gt;'),/AI & design/);
});
test('detail preserves currency and explicit pay period; list refresh retains salary and application history',async()=>{
  const root=mkdtempSync(join(tmpdir(),'greenhouse-store-')),db=new Store(root);
  try {
    const gh=new GreenhouseJobs({fetchImpl:greenhouseFetch});
    const listing=(await gh.search({boards:['sampleco'],query:'Product',limit:3})).jobs[0];
    let job=db.upsertJobs([listing])[0];
    job=db.upsertJobs([(await gh.detail(job)).detail])[0];
    assert.equal(job.compensation[0].currency,'USD');assert.equal(job.compensation[0].period,'year');
    assert.equal(constraintHints(job,{cities:[],minMonthlySalaryCny:30000,locationRequirement:''})[0].kind,'待核实');
    db.progress({jobId:job.id,status:'已投递',note:'本人已提交（样例）',requestId:randomUUID()});
    const refreshed=db.upsertJobs([{...listing,url:listing.url.replace('job-boards','boards')}])[0];
    assert.equal(refreshed.id,job.id);assert.equal(refreshed.salary,job.salary);assert.equal(refreshed.status,'已投递');
    assert.equal(refreshed.revision,job.revision);
    assert.equal(db.history(job.id).length,1);
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
test('malformed data, missing body and wrong detail identity never become empty success',async()=>{
  for(const value of [{jobs:[{...post,content:''}]},{jobs:[{...post,content:null}]},{jobs:'broken'}]) {
    const gh=new GreenhouseJobs({fetchImpl:url=>Promise.resolve(Response.json(url.includes('/jobs') ? value : {name:'样例公司'}))});
    const result=await gh.search({boards:['sampleco'],query:'Product',limit:3});
    assert.equal(result.state,'failed');assert.equal(result.jobs.length,0);assert.equal(result.boards[0].code,'GREENHOUSE_DATA_INVALID');
  }
  const gh=new GreenhouseJobs({fetchImpl:()=>Promise.resolve(Response.json({...post,id:124}))});
  await assert.rejects(()=>gh.detail({platform:'greenhouse',boardToken:'sampleco',platformJobId:'123',company:'样例公司'}),error=>error.code==='DETAIL_IDENTITY_INVALID');
});
test('bounded API timeout remains explicit and foreign board URLs are never fetched',async()=>{
  let calls=0;
  const gh=new GreenhouseJobs({timeoutMs:20,fetchImpl:(url,{signal})=>{
    calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  }});
  await assert.rejects(()=>gh.get('https://evil.test/'),error=>error.name==='ZodError');assert.equal(calls,0);
  await assert.rejects(()=>gh.get('sampleco'),error=>error.code==='GREENHOUSE_TIMEOUT');
});
