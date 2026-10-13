import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../plugin/src/store.mjs';
import {rankJobs} from '../plugin/src/ranking.mjs';
import {jobSchema,preferencesSchema,completeDescription} from '../plugin/src/domain.mjs';
import {createActions} from '../plugin/src/actions.mjs';
import {GreenhouseJobs} from '../plugin/src/greenhouse.mjs';
import {disconnectedBoss,greenhouseFetch} from './greenhouse-fixture.mjs';
const manual=(id,extra={})=>({url:`https://example.com/jobs/${id}?utm_source=sample`,title:'AI产品',rawText:'需要产品需求分析。',description:'需要产品需求分析。',source:'manual_import',...extra});
const assessment={decision:'推荐',summary:'原文对应',matches:[{requirement:'产品',jobQuote:'需要产品需求分析。',resumeQuote:'项目包含产品需求分析。'}],gaps:[],questions:[]};
test('manual import keeps meaningful identity and text, deduplicates tracking without losing progress',()=>{
  const root=mkdtempSync(join(tmpdir(),'jobs-import-')),db=new Store(root);
  try {
    const job=db.upsertJobs([manual('1')])[0];assert.equal(job.platform,'manual');assert.equal(completeDescription(job),false);
    db.progress({jobId:job.id,status:'面试',note:'样例',requestId:randomUUID()});
    const refreshed=db.upsertJobs([manual('1',{url:'https://example.com/jobs/1?utm_source=changed'})])[0];
    assert.equal(refreshed.id,job.id);assert.equal(refreshed.status,'面试');assert.equal(db.history(job.id).length,1);
    assert.notEqual(db.upsertJobs([manual('1',{url:'https://example.com/jobs/1?role=another'})])[0].id,job.id);
    assert.notEqual(db.upsertJobs([manual('1',{url:'https://example.com/#/jobs/1'})])[0].id,db.upsertJobs([manual('1',{url:'https://example.com/#/jobs/2'})])[0].id);
    const leverUrl='https://jobs.lever.co/sample/12345678-1234-4234-8234-123456789001';
    assert.notEqual(db.upsertJobs([manual('1',{url:leverUrl})])[0].id,db.upsertJobs([manual('1',{url:leverUrl.replace('jobs.lever','jobs.eu.lever')})])[0].id);
    for(const url of ['javascript:alert(1)','file:///C:/private','https://user:password@example.com/job'])assert.throws(()=>jobSchema.parse(manual('1',{url})));
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('a platform check cannot persist a result for companies changed while the request was running',async()=>{
  const root=mkdtempSync(join(tmpdir(),'jobs-check-race-'));let finish;
  const api={search:()=>new Promise(resolve=>{finish=resolve;})};
  const actions=createActions(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}),{ashby:api});
  try {
    await actions.invoke('set_platform_boards',{platform:'ashby',boards:['before']});
    const pending=actions.invoke('check_platform',{platform:'ashby'});
    await actions.invoke('set_platform_boards',{platform:'ashby',boards:['after']});
    finish({state:'ready',boards:[{board:'before',state:'ready'}]});
    await assert.rejects(()=>pending,error=>error.code==='PLATFORM_CONFIGURATION_CHANGED');
    assert.equal(actions.store('personal').setting('ashby_check'),null);
  }finally{await actions.close();rmSync(root,{recursive:true,force:true});}
});
test('batch assessments are atomic for bad evidence, stale versions and duplicate jobs',()=>{
  const root=mkdtempSync(join(tmpdir(),'jobs-batch-')),db=new Store(root);
  try {
    const jobs=db.upsertJobs([manual('1'),manual('2')]),resume=db.addResume({label:'样例',text:'项目包含产品需求分析。',contextText:''});
    const entries=jobs.map(job=>({jobId:job.id,jobRevision:job.revision,assessment}));
    assert.throws(()=>db.assessMany(resume.id,[entries[0],{...entries[1],assessment:{...assessment,matches:[{...assessment.matches[0],resumeQuote:'虚构任职'}]}}]));
    assert.ok(db.list({resumeId:resume.id}).every(job=>!job.assessment));
    assert.throws(()=>db.assessMany(resume.id,[{...entries[0],assessment:{...assessment,matches:[{...assessment.matches[0],jobQuote:'   '}]}}]));
    assert.throws(()=>db.assessMany(resume.id,[entries[0],entries[0]]));
    assert.equal(db.assessMany(resume.id,entries).length,2);
    db.upsertJobs([manual('2',{description:'正文更新。',rawText:'正文更新。'})]);
    assert.throws(()=>db.assessMany(resume.id,entries),error=>error.code==='JOB_CHANGED');
    assert.equal(db.list({resumeId:resume.id}).find(job=>job.id===jobs[1].id).assessment.stale,true);
    assert.throws(()=>db.setPreferences({defaultResumeId:randomUUID()}),error=>error.code==='RESUME_NOT_FOUND');
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('ranking action sorts across page boundaries, uses default resume, and exposes its candidate bound',async()=>{
  const root=mkdtempSync(join(tmpdir(),'jobs-ranking-')),actions=createActions(root,disconnectedBoss,new GreenhouseJobs({fetchImpl:greenhouseFetch}));
  try {
    const db=actions.store('personal'),jobs=db.upsertJobs(Array.from({length:32},(_,index)=>manual(String(index))));
    const resume=db.addResume({label:'样例',text:'项目包含产品需求分析。',contextText:''});
    db.assess(jobs[0].id,resume.id,jobs[0].revision,assessment);db.setPreferences({defaultResumeId:resume.id});
    const ranked=await actions.invoke('rank_jobs',{limit:1});assert.equal(ranked.jobs[0].id,jobs[0].id);assert.equal(ranked.hasMore,true);
    assert.equal(ranked.total,32);assert.equal(ranked.candidateLimitReached,false);
    db.upsertJobs(Array.from({length:500},(_,index)=>manual('additional-'+index)));
    const bounded=await actions.invoke('rank_jobs',{limit:1});assert.equal(bounded.total,500);assert.equal(bounded.candidateLimitReached,true);
    assert.match(bounded.coverage,/最近500/);
  }finally{await actions.close();rmSync(root,{recursive:true,force:true});}
});
test('ranking compares only declared units, preserves unknown and stale assessments, and orders before paging',()=>{
  const preference=preferencesSchema.parse({minimumSalary:{amount:80000,currency:'EUR',period:'year'},maxExperienceYears:3});
  const base={...jobSchema.parse(manual('1')),experience:'1-3年',compensation:[{min:90000,max:100000,currency:'EUR',period:'year',label:''}]};
  const jobs=[{...base,id:'low',compensation:[{min:100,max:200,currency:'EUR',period:'year',label:''}],assessment:{...assessment,stale:false}},
    {...base,id:'stale',assessment:{...assessment,stale:true}},{...base,id:'unknown',compensation:[{min:90000,max:100000,currency:'USD',period:'year',label:''}]},
    {...base,id:'recommended',assessment:{...assessment,stale:false}},{...base,id:'unreviewed'},{...base,id:'years',experience:'5年以上'}];
  const result=rankJobs(jobs,preference);
  assert.equal(result[0].id,'recommended');assert.equal(result.find(job=>job.id==='unknown').ranking.group,'待核实');
  assert.equal(result.find(job=>job.id==='stale').ranking.group,'需复核');assert.equal(result.find(job=>job.id==='unreviewed').ranking.group,'未筛选');
  assert.ok(result.slice(-2).every(job=>job.ranking.group==='不符合'));
  assert.equal(rankJobs(jobs,preference,{includeRejected:false}).length,4);
});
