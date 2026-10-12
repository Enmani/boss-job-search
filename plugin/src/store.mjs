import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TaskError, jobSchema, preferencesSchema, assessmentSchema, validateEvidence, statuses, boardsSchema } from './domain.mjs';

const now = () => new Date().toISOString();
const parse = row => row ? JSON.parse(row.payload) : null;
const content = ({source,...fields}) => JSON.stringify(fields);

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'jobs.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) { this.db.close(); throw new TaskError('NEWER_DATABASE', '数据来自较新版本，请先更新插件。'); }
    if (version === 0) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE resumes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, payload TEXT NOT NULL,
        revision INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT NOT NULL);
      CREATE TABLE assessments (job_id TEXT NOT NULL REFERENCES jobs(id), resume_id TEXT NOT NULL REFERENCES resumes(id),
        payload TEXT NOT NULL, job_revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(job_id,resume_id));
      CREATE TABLE events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
        status TEXT NOT NULL, note TEXT NOT NULL, follow_up_at TEXT, created_at TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL);
      CREATE TABLE searches (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      PRAGMA user_version=1;
      COMMIT;
    `);
    if(version < 2) {
      try {
        if(version === 1) {
          const backups=join(directory,'backups');mkdirSync(backups,{recursive:true});
          this.backup(join(backups,`pre-v0.2-${randomUUID()}.sqlite`));
        }
        this.transaction(() => {
          this.db.exec('ALTER TABLE jobs ADD COLUMN platform TEXT; ALTER TABLE jobs ADD COLUMN identity_key TEXT;');
          for(const row of this.db.prepare('SELECT id,payload FROM jobs').all()) {
            const job=jobSchema.parse(parse(row));
            this.db.prepare('UPDATE jobs SET payload=?,url=?,platform=?,identity_key=? WHERE id=?')
              .run(JSON.stringify(job),job.url,job.platform,this.identity(job),row.id);
          }
          this.db.exec('CREATE UNIQUE INDEX jobs_identity ON jobs(identity_key); CREATE INDEX jobs_platform ON jobs(platform); PRAGMA user_version=2;');
        });
      } catch(error) {this.db.close();throw error;}
    }
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  preferences() { return parse(this.db.prepare("SELECT payload FROM settings WHERE key='preferences'").get()) ?? preferencesSchema.parse({}); }
  setPreferences(input) {
    const preferences = preferencesSchema.parse(input);
    this.db.prepare("INSERT INTO settings VALUES ('preferences',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(preferences));
    return preferences;
  }
  boards() {return parse(this.db.prepare("SELECT payload FROM settings WHERE key='greenhouse_boards'").get()) ?? [];}
  setBoards(input) {
    const boards=boardsSchema.parse(input);
    this.db.prepare("INSERT INTO settings VALUES ('greenhouse_boards',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(boards));
    return boards;
  }
  identity(job) {return `${job.platform}:${job.boardToken}:${job.platformJobId}`;}
  addResume(resume) {
    const value = { ...resume, id: randomUUID(), importedAt: now() };
    this.db.prepare('INSERT INTO resumes VALUES (?,?)').run(value.id, JSON.stringify(value));
    return { id: value.id, label: value.label, sourcePath: value.sourcePath, importedAt: value.importedAt, characters: value.text.length };
  }
  resumes() { return this.db.prepare('SELECT payload FROM resumes').all().map(parse).map(({text,contextText,...metadata}) => ({...metadata,characters:text.length})); }
  resume(id) {
    const result = parse(this.db.prepare('SELECT payload FROM resumes WHERE id=?').get(id));
    if (!result) throw new TaskError('RESUME_NOT_FOUND', '未找到这份简历。');
    return result;
  }
  upsertJobs(inputs) {
    const jobs = inputs.map(value => jobSchema.parse(value));
    return this.transaction(() => jobs.map(job => {
      const row = this.db.prepare('SELECT * FROM jobs WHERE identity_key=?').get(this.identity(job));
      const time = now();
      if (row) {
        const old = parse(row);
        // List cards have shorter company/location labels and can have unreadable salaries.
        // Preserve a complete snapshot; only explicit comparable list fields may update it.
        let merged=job;
        if(job.source === 'boss_search' || job.source === 'browser_import') {
          merged={...job};
          for(const field of ['company','location','salary','experience','degree']) {
            if(!merged[field])merged[field]=old[field];
          }
          if(old.description) {
            merged={...old,...Object.fromEntries(['title','salary','experience','degree'].map(field=>[field,job[field] || old[field]]))};
          }
        }
        if(job.source === 'greenhouse_search' && !job.compensation.length && old.compensation.length)
          merged={...merged,salary:old.salary,compensation:old.compensation,
            rawText:[job.title,job.company,job.location,old.salary,job.description].filter(Boolean).join('\n')};
        merged=jobSchema.parse(merged);
        const payload = JSON.stringify(merged);
        this.db.prepare('UPDATE jobs SET payload=?,revision=?,seen_at=? WHERE id=?').run(payload, row.revision + (content(merged) !== content(old) ? 1 : 0), time, row.id);
        return this.job(row.id);
      }
      const id = randomUUID();
      this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(id, job.url, JSON.stringify(job), 1, '待筛选', time, time,job.platform,this.identity(job));
      return this.job(id);
    }));
  }
  job(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!row) throw new TaskError('JOB_NOT_FOUND', '未找到这个岗位。');
    return { ...parse(row), id: row.id, revision: row.revision, status: row.status, firstSeenAt: row.created_at, lastSeenAt: row.seen_at };
  }
  list({ status, platform, query='', resumeId, limit = 50, offset = 0 } = {}) {
    const clauses=[],args=[];
    if(status){clauses.push('status=?');args.push(status);}
    if(platform){clauses.push('platform=?');args.push(platform);}
    if(query){clauses.push("instr(lower(json_extract(payload,'$.title') || ' ' || json_extract(payload,'$.company') || ' ' || json_extract(payload,'$.location')),lower(?))>0");args.push(query);}
    const rows=this.db.prepare(`SELECT id FROM jobs ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''} ORDER BY seen_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(...args,limit,offset);
    return rows.map(row => {
      const job = this.job(row.id);
      const assessment = resumeId ? this.db.prepare('SELECT * FROM assessments WHERE job_id=? AND resume_id=?').get(job.id, resumeId) : null;
      const latestEvent = this.db.prepare('SELECT status,note,follow_up_at AS followUpAt,created_at AS createdAt FROM events WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(job.id);
      return { ...job, latestEvent: latestEvent ?? null, assessment: assessment ? { ...parse(assessment), assessedAt: assessment.updated_at, stale: assessment.job_revision !== job.revision } : null };
    });
  }
  assess(jobId, resumeId, revision, input) {
    const assessment = assessmentSchema.parse(input);
    return this.transaction(() => {
      const job = this.job(jobId);
      if (job.revision !== revision) throw new TaskError('JOB_CHANGED', '岗位内容已更新，请重新读取后筛选。');
      validateEvidence(assessment, job, this.resume(resumeId));
      this.db.prepare('INSERT INTO assessments VALUES (?,?,?,?,?) ON CONFLICT(job_id,resume_id) DO UPDATE SET payload=excluded.payload,job_revision=excluded.job_revision,updated_at=excluded.updated_at')
        .run(jobId, resumeId, JSON.stringify(assessment), revision, now());
      return { jobId, resumeId, ...assessment };
    });
  }
  progress({jobId,status,note='',followUpAt=null,requestId}) {
    if (!statuses.includes(status)) throw new TaskError('INVALID_STATUS', '求职状态无效。');
    return this.transaction(() => {
      this.job(jobId);
      const existing = this.db.prepare('SELECT * FROM events WHERE request_id=?').get(requestId);
      if (existing) {
        if (existing.job_id !== jobId || existing.status !== status || existing.note !== note || existing.follow_up_at !== followUpAt)
          throw new TaskError('REQUEST_CONFLICT', '重复请求标识对应了不同的更新。');
        return existing;
      }
      const id = randomUUID();
      this.db.prepare('UPDATE jobs SET status=? WHERE id=?').run(status, jobId);
      this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(id, jobId, status, note, followUpAt, now(), requestId);
      return this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    });
  }
  history(jobId) { this.job(jobId); return this.db.prepare('SELECT * FROM events WHERE job_id=? ORDER BY rowid').all(jobId); }
  recordSearch(value) {
    const result = { ...value, id: randomUUID(), checkedAt: now() };
    this.db.prepare('INSERT INTO searches VALUES (?,?)').run(result.id, JSON.stringify(result));
    return result;
  }
  finishSearch(id, update) {
    const previous = parse(this.db.prepare('SELECT payload FROM searches WHERE id=?').get(id));
    if (!previous) throw new TaskError('SEARCH_NOT_FOUND', '搜索记录不存在。');
    const result = {...previous,...update,finishedAt:now()};
    this.db.prepare('UPDATE searches SET payload=? WHERE id=?').run(JSON.stringify(result),id);
    return result;
  }
  backup(path) { this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`); return path; }
  recentSearches() { return this.db.prepare('SELECT payload FROM searches ORDER BY rowid DESC LIMIT 10').all().map(parse); }
}
