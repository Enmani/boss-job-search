import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../plugin/src/store.mjs';
import { salaryRange,jobUrl,constraintHints } from '../plugin/src/domain.mjs';
import { loadResume } from '../plugin/src/resume.mjs';

const sample = {url:'https://www.zhipin.com/job_detail/test_123.html?securityId=ignored',title:'计算设计师',company:'示例公司',location:'上海',salary:'20-30K·13薪',experience:'1-3年',degree:'硕士',description:'需要 Rhino 和 Grasshopper。',rawText:'计算设计师 20-30K·13薪 需要 Rhino 和 Grasshopper。',source:'boss_detail'};
const withStore = action => {
  const directory=mkdtempSync(join(tmpdir(),'boss-store-')); const db=new Store(directory);
  try { return action(db,directory); } finally {db.close();rmSync(directory,{recursive:true,force:true});}
};

test('canonical identity rejects foreign links and strips tracking',() => {
  assert.equal(jobUrl(sample.url),'https://www.zhipin.com/job_detail/test_123.html');
  for(const bad of ['https://www.zhipin.com.evil.test/job_detail/a.html','https://www.zhipin.com/web/geek/jobs','http://www.zhipin.com/job_detail/a.html']) assert.throws(() => jobUrl(bad));
});
test('monthly salary comparison leaves yearly, daily and negotiation unknown',() => {
  assert.deepEqual(salaryRange('20-30K·13薪'),{min:20000,max:30000});
  assert.equal(salaryRange('200-400元/天'),null);assert.equal(salaryRange('20-30万/年'),null);assert.equal(salaryRange('面议'),null);
  assert.equal(constraintHints(sample,{cities:[],minMonthlySalaryCny:35000,locationRequirement:''})[0].kind,'不符合');
});
test('deduplication preserves application history and full description',() => withStore(db => {
  const job=db.upsertJobs([sample])[0];
  db.progress({jobId:job.id,status:'已投递',note:'本人已提交',followUpAt:null,requestId:randomUUID()});
  const newer=db.upsertJobs([{...sample,url:sample.url.replace('ignored','new'),company:'简称',location:'上海·浦东',salary:'',experience:'',degree:'',source:'boss_search',description:'',rawText:'短卡片'}])[0];
  assert.equal(newer.id,job.id);assert.equal(newer.description,sample.description);assert.equal(newer.status,'已投递');assert.equal(db.history(job.id).length,1);
  assert.equal(newer.company,sample.company);assert.equal(newer.location,sample.location);assert.equal(newer.salary,sample.salary);
  assert.equal(newer.experience,sample.experience);assert.equal(newer.degree,sample.degree);assert.equal(newer.revision,job.revision);
  const changed=db.upsertJobs([{...sample,source:'boss_search',description:'',salary:'30-40K',rawText:'新卡片'}])[0];
  assert.equal(changed.salary,'30-40K');assert.equal(changed.revision,job.revision+1);
}));
test('invalid batch is rejected before any insert',() => withStore(db => {
  assert.throws(() => db.upsertJobs([sample,{...sample,url:'https://evil.test/a'}]));assert.equal(db.list().length,0);
}));
test('evidence validation rejects invented resume quotes and stale conclusions',() => withStore(db => {
  const job=db.upsertJobs([sample])[0],resume=db.addResume({label:'计算设计',text:'研究项目使用 Rhino 和 Grasshopper。',contextText:''});
  const assessment={decision:'推荐',summary:'工具经验对应。',matches:[{requirement:'Rhino',jobQuote:'需要 Rhino 和 Grasshopper。',resumeQuote:'研究项目使用 Rhino 和 Grasshopper。'}],gaps:[],questions:['跨境远程范围待核实']};
  db.assess(job.id,resume.id,1,assessment);
  assert.throws(() => db.assess(job.id,resume.id,1,{...assessment,matches:[{...assessment.matches[0],resumeQuote:'具有十年正式任职经验'}]}),/简历引用/);
  db.upsertJobs([{...sample,description:'需要五年 Rhino 工作经验。',rawText:'计算设计师 需要五年 Rhino 工作经验。'}]);
  assert.equal(db.list({resumeId:resume.id})[0].assessment.stale,true);
  assert.throws(() => db.assess(job.id,resume.id,1,assessment),/岗位内容已更新/);
}));
test('retries are idempotent; reused request ids cannot hide changed writes',() => withStore(db => {
  const job=db.upsertJobs([sample])[0];const input={jobId:job.id,status:'面试',note:'已安排第一轮',followUpAt:'2026-10-14T10:00:00+02:00',requestId:randomUUID()};
  const event=db.progress(input);assert.equal(db.progress(input).id,event.id);assert.equal(db.history(job.id).length,1);
  assert.throws(() => db.progress({...input,status:'Offer'}),/不同的更新/);assert.equal(db.job(job.id).status,'面试');
}));
test('event failure rolls status back rather than leaving a misleading current state',() => withStore(db => {
  const job=db.upsertJobs([sample])[0];
  db.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(() => db.progress({jobId:job.id,status:'已投递',note:'',followUpAt:null,requestId:randomUUID()}));
  assert.equal(db.job(job.id).status,'待筛选');assert.equal(db.history(job.id).length,0);
}));
test('SQLite backup includes recent WAL writes and can be reopened independently',() => withStore((db,directory) => {
  const job=db.upsertJobs([sample])[0];db.progress({jobId:job.id,status:'收藏',note:'准备了解远程条件',followUpAt:null,requestId:randomUUID()});
  const file=join(directory,'backup.sqlite');db.backup(file);
  const snapshot=new DatabaseSync(file,{readOnly:true});
  try {assert.equal(snapshot.prepare('SELECT status FROM jobs').get().status,'收藏');assert.equal(snapshot.prepare('SELECT count(*) AS n FROM events').get().n,1);}
  finally {snapshot.close();}
}));
test('resume import keeps evidence but redacts contact details',async () => {
  const directory=mkdtempSync(join(tmpdir(),'boss-resume-'));const path=join(directory,'resume.md');
  writeFileSync(path,'计算设计研究者，使用 Rhino、Grasshopper 和 Python 开展项目分析。邮箱 example@example.com，电话 +1 202 555 0123。硕士2024年6月毕业。');
  try {const resume=await loadResume({path,label:'样例'});assert.match(resume.text,/2024年6月/);assert.ok(!resume.text.includes('example@example.com'));assert.ok(!resume.text.includes('202 555 0123'));}
  finally {rmSync(directory,{recursive:true,force:true});}
});
