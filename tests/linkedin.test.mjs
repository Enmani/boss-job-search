import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {jobIdentity,jobSchema,completeDescription} from '../plugin/src/domain.mjs';
import {parseLinkedInSearch,parseLinkedInDetail} from '../plugin/src/linkedin-html.mjs';
import {LinkedInJobs} from '../plugin/src/linkedin.mjs';
import {createActions} from '../plugin/src/actions.mjs';
import {Store} from '../plugin/src/store.mjs';
import {GreenhouseJobs} from '../plugin/src/greenhouse.mjs';
import {disconnectedBoss,greenhouseFetch} from './greenhouse-fixture.mjs';
import {linkedCard,linkedDetail,linkedFetch} from './linkedin-fixture.mjs';
const scope={query:'AI Product',location:'Milan, Italy',limit:15,offset:0};

test('LinkedIn identities normalize numeric, slug, regional and currentJobId links, rejecting foreign and ambiguous links',()=>{
  for(const url of ['https://www.linkedin.com/jobs/view/4200000001?trackingId=sample','https://it.linkedin.com/jobs/view/ai-product-4200000001/',
    'https://linkedin.com/jobs/search/?keywords=AI&currentJobId=4200000001'])assert.equal(jobIdentity(url).url,'https://www.linkedin.com/jobs/view/4200000001');
  for(const url of ['https://www.linkedin.com.evil.test/jobs/view/4200000001','http://www.linkedin.com/jobs/view/4200000001',
    'https://www.linkedin.com/jobs/search/?keywords=AI','https://www.linkedin.com/jobs/search/?currentJobId=1&currentJobId=2',
    'https://user:pass@www.linkedin.com/jobs/view/4200000001','https://www.linkedin.com/jobs/view/4200000001?currentJobId=4200000002'])assert.throws(()=>jobIdentity(url));
  assert.throws(()=>jobSchema.parse({url:'https://www.linkedin.com/jobs/view/4200000001',title:'AI',rawText:'text',source:'linkedin_search',platformJobId:'2'}));
});
test('LinkedIn search counts consumed cards and preserves list-only scope; ambiguous empty pages are explicit failures',()=>{
  const page=parseLinkedInSearch(linkedCard()+linkedCard()+linkedCard('4200000002'),{...scope,limit:2});
  assert.equal(page.jobs.length,2);assert.equal(page.nextOffset,3);assert.ok(page.jobs.every(job=>!completeDescription(job)));
  assert.equal(parseLinkedInSearch(linkedCard()+linkedCard('4200000002'),{...scope,limit:1}).nextOffset,1);
  assert.equal(parseLinkedInSearch('<div class="jobs-search-no-results-banner">No jobs found</div>',scope).state,'empty');
  for(const html of ['', '<html><p>Join LinkedIn</p></html>','<!---->'])assert.throws(()=>parseLinkedInSearch(html,scope),error=>error.code==='LINKEDIN_LAYOUT_UNRECOGNIZED');
  assert.throws(()=>parseLinkedInSearch(linkedCard().replace('urn:li:jobPosting:4200000001','urn:li:jobPosting:2'),scope));
});
test('LinkedIn details require the selected primary identity and body, leaving salary units unguessed',()=>{
  const job=parseLinkedInDetail(linkedDetail(),'4200000001');
  assert.equal(completeDescription(job),true);assert.match(job.description,/Requirements/);assert.equal(job.compensation.length,0);assert.match(job.salary,/EUR/);
  assert.throws(()=>parseLinkedInDetail(linkedDetail('4200000002'),'4200000001'),error=>error.code==='DETAIL_IDENTITY_INVALID');
  assert.throws(()=>parseLinkedInDetail(linkedDetail().replace(/<link[^>]+>/,''),'4200000001'),error=>error.code==='DETAIL_IDENTITY_UNCONFIRMED');
  assert.throws(()=>parseLinkedInDetail('<title>Sign In | LinkedIn</title>','4200000001'),error=>error.code==='LINKEDIN_LOGIN_REQUIRED');
  assert.throws(()=>parseLinkedInDetail(linkedDetail().replace('Build AI products with Python.','Sign in to view full description'),'4200000001'),error=>error.code==='LINKEDIN_LOGIN_REQUIRED');
  assert.throws(()=>parseLinkedInDetail('<form action="/checkpoint/challenge"></form>','4200000001'),error=>error.code==='LINKEDIN_VERIFICATION_REQUIRED');
});
test('LinkedIn transport is cookie-free, never follows redirects, and honors rate-limit cooldown without retrying',async()=>{
  let now=1000,calls=0;
  const api=new LinkedInJobs({now:()=>now,minIntervalMs:0,fetchImpl:async(url,options)=>{
    calls++;assert.equal(new URL(url).hostname,'www.linkedin.com');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);
    return new Response('limited',{status:429,headers:{'Retry-After':'900','Content-Type':'text/html'}});
  }});
  await assert.rejects(()=>api.search(scope),error=>error.code==='LINKEDIN_RATE_LIMIT');assert.equal(calls,1);
  now+=300000;await assert.rejects(()=>api.search(scope),error=>error.code==='LINKEDIN_RATE_LIMIT');assert.equal(calls,1);
  assert.equal(api.status().retryAt,new Date(901000).toISOString());now=901001;assert.equal(api.status().state,'not_checked');
  // fetch can return LinkedIn's nonstandard 999 although Response's constructor rejects it.
  const status999=new Response('',{status:403});Object.defineProperty(status999,'status',{value:999});
  for(const [response,code] of [[new Response('',{status:302,headers:{Location:'/authwall'}}),'LINKEDIN_LOGIN_REQUIRED'],
    [status999,'LINKEDIN_ACCESS_BLOCKED'],[new Response('',{status:403}),'LINKEDIN_ACCESS_BLOCKED'],
    [Response.json({jobs:[]}),'LINKEDIN_DATA_INVALID'],[new Response('x'.repeat(20),{headers:{'Content-Type':'text/html'}}),'LINKEDIN_TOO_LARGE']]) {
    const reader=new LinkedInJobs({maxBytes:10,fetchImpl:async()=>response});
    await assert.rejects(()=>reader.search(scope),error=>error.code===code);
  }
});
test('LinkedIn concurrency, request interval and network timeouts remain explicit',async()=>{
  let finish,now=1000,calls=0;
  const api=new LinkedInJobs({now:()=>now,minIntervalMs:0,fetchImpl:async()=>{calls++;return new Promise(resolve=>{finish=()=>resolve(new Response(linkedCard(),{headers:{'Content-Type':'text/html'}}));});}});
  const pending=api.search(scope);assert.equal(api.status().state,'busy');await assert.rejects(()=>api.search(scope),error=>error.code==='LINKEDIN_BUSY');finish();await pending;
  assert.equal(calls,1);assert.equal(api.status().state,'ready');
  const delays=[],paced=new LinkedInJobs({now:()=>now,waitImpl:async delay=>{delays.push(delay);now+=delay;},fetchImpl:linkedFetch});
  await paced.search(scope);await paced.search(scope);assert.deepEqual(delays,[3000]);
  const timeout=new LinkedInJobs({timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
  await assert.rejects(()=>timeout.search(scope),error=>error.code==='LINKEDIN_TIMEOUT');
  const wrong=new LinkedInJobs({fetchImpl:async()=>new Response(linkedCard('4200000001','x'.repeat(501)),{headers:{'Content-Type':'text/html'}})});
  await assert.rejects(()=>wrong.search(scope),error=>error.code==='LINKEDIN_DATA_INVALID');
});
function legacyJob(db,url,id=randomUUID()) {
  const value={platform:'manual',boardToken:'',platformJobId:url,url,applyUrl:url,title:'旧岗位',company:'公司',location:'Milan',salary:'',experience:'',degree:'',description:'已提供的正文',rawText:'已提供的正文',compensation:[],source:'manual_import'};
  db.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(id,url,JSON.stringify(value),1,'收藏','2026-10-01','2026-10-01','manual',`manual::${url}`);return id;
}
test('old manual LinkedIn records retain id, history and full body on adoption; duplicate aliases roll back explicitly',()=>{
  const root=mkdtempSync(join(tmpdir(),'linkedin-adopt-')),db=new Store(root);
  try {
    const id=legacyJob(db,'https://it.linkedin.com/jobs/view/ai-product-4200000001?trk=old');
    db.progress({jobId:id,status:'面试',note:'样例',requestId:randomUUID()});
    const saved=db.upsertJobs(parseLinkedInSearch(linkedCard(),scope).jobs)[0];
    assert.equal(saved.id,id);assert.equal(saved.platform,'linkedin');assert.equal(saved.status,'面试');assert.equal(saved.description,'已提供的正文');assert.equal(db.history(id).length,1);
    const detail=db.upsertJobs([parseLinkedInDetail(linkedDetail(),'4200000001')])[0];
    assert.equal(detail.id,id);const listed=db.upsertJobs(parseLinkedInSearch(linkedCard(),scope).jobs)[0];
    assert.equal(listed.description,detail.description);assert.equal(listed.revision,detail.revision);
    legacyJob(db,'https://www.linkedin.com/jobs/view/4200000002');legacyJob(db,'https://it.linkedin.com/jobs/view/old-title-4200000002');
    assert.throws(()=>db.upsertJobs(parseLinkedInSearch(linkedCard('4200000002'),scope).jobs),error=>error.code==='JOB_IDENTITY_CONFLICT');
    legacyJob(db,'https://www.linkedin.com/jobs/search/?keywords=old');
    assert.equal(db.upsertJobs([{url:'https://example.com/jobs/new',title:'New',rawText:'body',source:'manual_import'}]).length,1);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('LinkedIn actions log failures without touching jobs and share detail, screening and progress storage',async()=>{
  const root=mkdtempSync(join(tmpdir(),'linkedin-actions-'));
  const reader=new LinkedInJobs({fetchImpl:linkedFetch,minIntervalMs:0});
  const actions=createActions(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}),{linkedin:reader});
  try {
    const found=await actions.invoke('search_jobs',{platform:'linkedin',query:'AI Product',location:'Milan',pageOffset:2});
    assert.equal(found.jobs[0].platformJobId,'4200000003');assert.equal(found.search.nextOffset,3);
    const detail=await actions.invoke('get_job_detail',{jobId:found.jobs[0].id});assert.equal(detail.state,'detail');
    const resume=actions.store('personal').addResume({label:'样例',text:'I build AI products with Python.',contextText:''});
    const context=await actions.invoke('screening_context',{resumeId:resume.id,jobIds:[detail.job.id]});assert.equal(context.jobs[0].descriptionComplete,true);
    const ranked=await actions.invoke('rank_jobs',{platform:'linkedin',resumeId:resume.id});assert.equal(ranked.jobs.length,1);
    let finish;
    reader.fetch=async()=>new Promise(resolve=>{finish=()=>resolve(new Response(linkedCard(),{headers:{'Content-Type':'text/html'}}));});
    const pending=reader.search(scope),busy=await actions.invoke('check_platform',{platform:'linkedin'});
    assert.equal(busy.state,'busy');assert.equal(busy.code,'LINKEDIN_BUSY');finish();await pending;
    reader.fetch=async()=>new Response('',{status:429});
    await assert.rejects(()=>actions.invoke('search_jobs',{platform:'linkedin',query:'AI'}),error=>error.code==='LINKEDIN_RATE_LIMIT');
    assert.equal(actions.store('personal').recentSearches()[0].state,'failed');assert.equal(actions.store('personal').list().length,1);
  }finally{await actions.close();rmSync(root,{recursive:true,force:true});}
});
