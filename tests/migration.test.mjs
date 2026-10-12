import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../plugin/src/store.mjs';

const legacyJob={url:'https://www.zhipin.com/job_detail/legacy.html',title:'产品经理',company:'样例公司',location:'上海',salary:'20-30K',
  experience:'1-3年',degree:'本科',description:'需要产品经验。',rawText:'需要产品经验。',source:'boss_detail'};
function versionOne(root,job=legacyJob) {
  const db=new DatabaseSync(join(root,'jobs.sqlite'));
  db.exec(`CREATE TABLE resumes(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,seen_at TEXT NOT NULL);
    CREATE TABLE assessments(job_id TEXT NOT NULL REFERENCES jobs(id),resume_id TEXT NOT NULL REFERENCES resumes(id),payload TEXT NOT NULL,job_revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(job_id,resume_id));
    CREATE TABLE events(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),status TEXT NOT NULL,note TEXT NOT NULL,follow_up_at TEXT,created_at TEXT NOT NULL,request_id TEXT UNIQUE NOT NULL);
    CREATE TABLE searches(id TEXT PRIMARY KEY,payload TEXT NOT NULL);PRAGMA user_version=1;`);
  db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)').run('legacy-id',job.url,JSON.stringify(job),3,'已投递','2026-10-01T10:00:00Z','2026-10-02T10:00:00Z');
  db.prepare('INSERT INTO resumes VALUES (?,?)').run('resume-id',JSON.stringify({id:'resume-id',label:'样例',text:'产品经验',contextText:''}));
  db.prepare('INSERT INTO assessments VALUES (?,?,?,?,?)').run('legacy-id','resume-id',JSON.stringify({decision:'待核实',summary:'地点待核实',matches:[],gaps:[],questions:[]}),3,'2026-10-02T10:00:00Z');
  db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run('event-id','legacy-id','已投递','历史备注',null,'2026-10-02T10:00:00Z','request-id');
  db.close();
}
test('v0.1.3 migration backs up and preserves ids, revisions, evidence and progress on repeated startup',()=>{
  const root=mkdtempSync(join(tmpdir(),'job-migration-'));let db;
  try {
    versionOne(root);db=new Store(root);
    const job=db.job('legacy-id');assert.equal(job.platform,'boss');assert.equal(job.revision,3);assert.equal(job.status,'已投递');
    assert.equal(job.compensation[0].period,'month');assert.equal(db.history(job.id)[0].note,'历史备注');
    assert.equal(db.list({resumeId:'resume-id'})[0].assessment.stale,false);
    const backups=readdirSync(join(root,'backups'));assert.equal(backups.length,1);
    const snapshot=new DatabaseSync(join(root,'backups',backups[0]),{readOnly:true});
    assert.equal(snapshot.prepare('PRAGMA user_version').get().user_version,1);snapshot.close();
    db.close();db=new Store(root);assert.equal(db.list().length,1);assert.equal(readdirSync(join(root,'backups')).length,1);
  } finally {if(db)db.close();rmSync(root,{recursive:true,force:true});}
});
test('a rejected migration leaves the old schema and data intact',()=>{
  const root=mkdtempSync(join(tmpdir(),'job-migration-'));
  try {
    versionOne(root,{...legacyJob,url:'https://evil.test/job'});assert.throws(()=>new Store(root));
    const original=new DatabaseSync(join(root,'jobs.sqlite'));
    assert.equal(original.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(original.prepare('SELECT status FROM jobs').get().status,'已投递');
    assert.ok(!original.prepare('PRAGMA table_info(jobs)').all().some(column=>column.name==='platform'));original.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
