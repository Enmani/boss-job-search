import { z } from 'zod';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { loadResume } from './resume.mjs';
import { profileSchema,preferencesSchema,assessmentSchema,jobSchema,statuses,platforms,boardsSchema,
  constraintHints,completeDescription,TaskError } from './domain.mjs';

const identity={profile:profileSchema},uuid=z.string().uuid();
const blockedMessages={
  login_required:'请本人在普通 Chrome 登录，再重新搜索。',
  verification_required:'BOSS 要求安全验证；请本人完成验证后再继续。',
  layout_unrecognized:'页面未识别，需要检查页面结构。',job_closed:'该岗位已停止招聘。',
  outside_boss:'页面跳转到站外或空白页。',search_scope_changed:'页面搜索条件已变化。',
  detail_identity_changed:'页面与所选岗位不同。',partial:'部分公司读取失败，请查看搜索记录。',
  failed:'公司招聘页读取失败，请查看搜索记录。',
};
export function failure(error) {
  return error instanceof TaskError ? {code:error.code,message:error.message}
    : error instanceof z.ZodError ? {code:'INVALID_INPUT',message:'输入格式不正确，请核对参数。'}
    : {code:'OPERATION_FAILED',message:'操作失败，请检查文件权限、数据库和运行环境。'};
}
export function createActions(root,browser,greenhouse) {
  const stores=new Map(),tools=new Map();
  const store=profile=>{
    profile=profileSchema.parse(profile);
    if(!stores.has(profile))stores.set(profile,new Store(join(root,profile)));
    return stores.get(profile);
  };
  const tool=(name,description,schema,write,action,{external=false}={})=>
    tools.set(name,{name,description,schema,write,external,action,validate:z.object(schema).strict()});
  tool('get_status','查看本机求职资料、浏览器连接、目标公司和最近搜索记录。',identity,false,async ({profile})=>({
    browser:await browser.status(profile),resumes:store(profile).resumes(),preferences:store(profile).preferences(),
    greenhouseBoards:store(profile).boards(),recentSearches:store(profile).recentSearches(),dataDirectory:join(root,profile),
  }));
  tool('open_login','在普通 Chrome 打开 BOSS 登录页；登录和验证码由本人完成。',identity,true,({profile})=>browser.login(profile),{external:true});
  tool('close_browser','关闭当前会话创建的岗位标签，不关闭本人其他标签。',{},true,()=>browser.close());
  tool('set_greenhouse_boards','保存最多十个目标公司的 Greenhouse 招聘页或 board token。只搜索这些公司的公开岗位。',{
    ...identity,boards:boardsSchema,
  },true,({profile,boards})=>({boards:store(profile).setBoards(boards)}));
  tool('search_jobs','搜索并保存岗位。boss 通过原生 Chrome 读取当前页；greenhouse 通过公开接口搜索已添加公司的标题和正文。部分失败会标记 partial，不能当作零结果。',{
    ...identity,platform:z.enum(platforms).default('boss'),query:z.string().trim().min(1).max(100),
    cityCode:z.string().regex(/^\d{9}$/).default('100010000'),location:z.string().trim().max(100).default(''),
    boardTokens:boardsSchema.optional(),limit:z.number().int().min(1).max(30).default(15),
  },true,async ({profile,platform,boardTokens,...input})=>{
    const db=store(profile),boards=boardTokens ?? db.boards();
    const scope=platform==='boss' ? {query:input.query,cityCode:input.cityCode,limit:input.limit}
      : {query:input.query,location:input.location,limit:input.limit,boards};
    if(platform==='greenhouse' && !boards.length)throw new TaskError('GREENHOUSE_BOARDS_REQUIRED','请先添加目标公司的 Greenhouse 招聘页。');
    const run=db.recordSearch({platform,...scope,state:'running'});
    try {
      const page=platform==='boss' ? await browser.search(profile,scope) : await greenhouse.search(scope);
      const jobs=['ready','partial'].includes(page.state) ? db.upsertJobs(page.jobs) : [];
      const record=db.finishSearch(run.id,{state:page.state,count:jobs.length,searchUrl:page.searchUrl,
        coverage:page.coverage,boards:page.boards,matched:page.matched,returned:page.returned});
      return {state:page.state,message:blockedMessages[page.state] || '',jobs,search:record};
    } catch(error) {db.finishSearch(run.id,{state:'failed',...failure(error)});throw error;}
  },{external:true});
  tool('get_job_detail','按岗位平台读取最新完整正文并更新本机记录。BOSS 使用原生 Chrome，Greenhouse 使用公开接口。',{
    ...identity,jobId:uuid,
  },true,async ({profile,jobId})=>{
    const db=store(profile),job=db.job(jobId);
    const page=job.platform==='boss' ? await browser.detail(profile,job.url) : await greenhouse.detail(job);
    if(page.state!=='detail')return {state:page.state,message:blockedMessages[page.state] || '详情尚未读取。',jobId};
    return {state:'detail',job:db.upsertJobs([page.detail])[0]};
  },{external:true});
  tool('get_saved_job','读取已保存的岗位正文和进度历史，不访问网站。',{
    ...identity,jobId:uuid,
  },false,({profile,jobId})=>({job:store(profile).job(jobId),events:store(profile).history(jobId)}));
  tool('import_visible_jobs','保存实际读取的 BOSS 或 Greenhouse 岗位材料。导入记录不证明工具执行了搜索。',{
    ...identity,jobs:z.array(jobSchema).min(1).max(30),observedQuery:z.string().trim().min(1).max(100).optional(),
  },true,({profile,jobs,observedQuery})=>{
    const db=store(profile),saved=db.upsertJobs(jobs);
    const search=observedQuery ? db.recordSearch({query:observedQuery,state:'imported_visible_page',count:saved.length,coverage:'已读取的可见材料'}) : null;
    return {jobs:saved,search};
  });
  tool('import_resume','导入本机 PDF、DOCX、TXT 或 Markdown 简历，可附已确认事实文件。隐藏联系方式后保存在本机。每次导入创建新版本。',{
    ...identity,path:z.string().min(1).max(2000),label:z.string().trim().min(1).max(100),contextPath:z.string().min(1).max(2000).optional(),
  },true,async ({profile,...input})=>({resume:store(profile).addResume(await loadResume(input))}));
  tool('list_resumes','查看已导入简历的路线、来源和版本。',identity,false,({profile})=>({resumes:store(profile).resumes()}));
  tool('get_resume','读取指定简历版本及事实原文，用于对照岗位筛选。',{...identity,resumeId:uuid},false,
    ({profile,resumeId})=>({resume:store(profile).resume(resumeId)}));
  tool('set_preferences','保存用户确认的目标岗位、城市、人民币最低月薪和办公范围。',{
    ...identity,preferences:preferencesSchema,
  },true,({profile,preferences})=>({preferences:store(profile).setPreferences(preferences)}));
  tool('screening_context','读取简历、岗位和偏好，由 Codex 对照原文筛选。币种或计薪周期未知时不能强行比较。',{
    ...identity,resumeId:uuid,jobIds:z.array(uuid).min(1).max(10),
  },false,({profile,resumeId,jobIds})=>{
    const db=store(profile),preferences=db.preferences();
    return {resume:db.resume(resumeId),preferences,jobs:jobIds.map(id=>{
      const job=db.job(id);return {...job,constraintHints:constraintHints(job,preferences),descriptionComplete:completeDescription(job)};
    })};
  });
  tool('save_assessment','保存有原文依据的推荐、待核实或不符合结论。岗位更新后拒绝旧版本结论。',{
    ...identity,jobId:uuid,resumeId:uuid,jobRevision:z.number().int().positive(),assessment:assessmentSchema,
  },true,({profile,jobId,resumeId,jobRevision,assessment})=>({assessment:store(profile).assess(jobId,resumeId,jobRevision,assessment)}));
  tool('list_jobs','查看本机岗位及进度，可按平台、状态、标题公司地点关键词和简历版本筛选。',{
    ...identity,status:z.enum(statuses).optional(),platform:z.enum(platforms).optional(),query:z.string().trim().max(100).default(''),
    resumeId:uuid.optional(),limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().nonnegative().default(0),
  },false,({profile,...input})=>({jobs:store(profile).list(input)}));
  tool('update_progress','记录收藏、沟通、投递、面试等进度并保留历史。只记账，不发送消息或申请。重试同一动作复用 requestId UUID。',{
    ...identity,jobId:uuid,status:z.enum(statuses),note:z.string().max(3000).default(''),
    followUpAt:z.string().datetime({offset:true}).nullable().default(null),requestId:uuid,
  },true,({profile,...input})=>({event:store(profile).progress(input)}));
  tool('get_progress_history','查看岗位的全部进度变更记录。',{...identity,jobId:uuid},false,
    ({profile,jobId})=>({events:store(profile).history(jobId)}));
  tool('backup_records','创建包含本机简历、岗位、筛选和进度的 SQLite 备份。',identity,true,({profile})=>{
    const directory=join(root,profile,'backups');mkdirSync(directory,{recursive:true});
    const path=join(directory,`jobs-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`);
    store(profile).backup(path);return {path};
  });
  return {tools,store,async invoke(name,args={}) {
    const definition=tools.get(name);
    if(!definition)throw new TaskError('TOOL_NOT_FOUND','操作不存在。');
    return definition.action(definition.validate.parse(args));
  },async close() {try{await browser.close();}finally{for(const db of stores.values())db.close();stores.clear();}}};
}
