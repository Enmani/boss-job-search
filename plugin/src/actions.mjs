import { z } from 'zod';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { loadResume } from './resume.mjs';
import { profileSchema,preferencesSchema,assessmentSchema,jobSchema,compensationSchema,statuses,platforms,searchPlatforms,boardsSchema,
  constraintHints,completeDescription,knownJobIdentity,TaskError } from './domain.mjs';
import { publicPlatforms,boardInputs,platformBoards } from './boards.mjs';
import { AshbyJobs } from './ashby.mjs';
import { LeverJobs } from './lever.mjs';
import { LinkedInJobs } from './linkedin.mjs';
import { rankJobs } from './ranking.mjs';

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
export function createActions(root,browser,greenhouse,{ashby=new AshbyJobs(),lever=new LeverJobs(),linkedin=new LinkedInJobs()}={}) {
  const stores=new Map(),tools=new Map();
  const providers={greenhouse,ashby,lever,linkedin};
  const store=profile=>{
    profile=profileSchema.parse(profile);
    if(!stores.has(profile))stores.set(profile,new Store(join(root,profile)));
    return stores.get(profile);
  };
  const tool=(name,description,schema,write,action,{external=false}={})=>
    tools.set(name,{name,description,schema,write,external,action,validate:z.object(schema).strict()});
  tool('get_status','查看本机求职资料、浏览器连接、目标公司和最近搜索记录。',identity,false,async ({profile})=>({
    browser:await browser.status(profile),resumes:store(profile).resumes(),preferences:store(profile).preferences(),
    greenhouseBoards:store(profile).boards(),platforms:publicPlatforms.map(platform=>({platform,boards:store(profile).boards(platform),lastCheck:store(profile).setting(`${platform}_check`)})),
    linkedin:{...linkedin.status(),lastCheck:store(profile).setting('linkedin_check')},
    recentSearches:store(profile).recentSearches(),dataDirectory:join(root,profile),
  }));
  tool('open_login','在普通 Chrome 打开 BOSS 登录页；登录和验证码由本人完成。',identity,true,({profile})=>browser.login(profile),{external:true});
  tool('close_browser','关闭当前会话创建的岗位标签，不关闭本人其他标签。',{},true,()=>browser.close());
  tool('set_greenhouse_boards','保存最多十个目标公司的 Greenhouse 招聘页或 board token。只搜索这些公司的公开岗位。',{
    ...identity,boards:boardsSchema,
  },true,({profile,boards})=>({boards:store(profile).setBoards(boards)}));
  tool('set_platform_boards','保存 Greenhouse、Ashby 或 Lever 的目标公司。Lever 欧洲站请提供 jobs.eu.lever.co 招聘页。',{
    ...identity,platform:z.enum(publicPlatforms),boards:boardInputs,
  },true,({profile,platform,boards})=>({platform,boards:store(profile).setBoards(boards,platform)}));
  tool('check_platform','实际检测平台读取状态。BOSS 查看本机桥接；公开接口检测已配置公司；LinkedIn 实验读取访客页。结果附检测时间。',{
    ...identity,platform:z.enum(searchPlatforms),
  },true,async ({profile,platform})=>{
    const checkedAt=new Date().toISOString(),db=store(profile);
    if(platform==='boss')return {platform,checkedAt,...await browser.status(profile)};
    if(platform==='linkedin') {
      let check;
      try{check={platform,checkedAt,...await linkedin.check()};}
      catch(error){check={platform,checkedAt,...linkedin.status(),...failure(error)};}
      db.setSetting('linkedin_check',check);return check;
    }
    const boards=db.boards(platform);
    const result=boards.length ? await providers[platform].search({boards,query:'',location:'',limit:1}) : {state:'not_configured',boards:[]};
    if(JSON.stringify(db.boards(platform))!==JSON.stringify(boards))throw new TaskError('PLATFORM_CONFIGURATION_CHANGED','目标公司已更新，请重新检测。');
    const check={platform,checkedAt,state:result.state,boards:result.boards};db.setSetting(`${platform}_check`,check);return check;
  },{external:true});
  tool('search_jobs','搜索并保存岗位。BOSS 使用普通 Chrome；Greenhouse、Ashby、Lever 搜索已添加公司；LinkedIn 实验性读取免登录访客列表，用 pageOffset 继续下一页，限流不重试。失败不能当作零结果。',{
    ...identity,platform:z.enum(searchPlatforms).default('boss'),query:z.string().trim().min(1).max(100),
    cityCode:z.string().regex(/^\d{9}$/).default('100010000'),location:z.string().trim().max(100).default(''),
    boardTokens:boardInputs.optional(),limit:z.number().int().min(1).max(30).default(15),pageOffset:z.number().int().min(0).max(1000).default(0),
  },true,async ({profile,platform,boardTokens,pageOffset,...input})=>{
    const db=store(profile),boards=publicPlatforms.includes(platform) ? platformBoards(platform,boardTokens ?? db.boards(platform)) : [];
    const scope=platform==='boss' ? {query:input.query,cityCode:input.cityCode,limit:input.limit}
      : platform==='linkedin' ? {query:input.query,location:input.location,limit:input.limit,offset:pageOffset}
      : {query:input.query,location:input.location,limit:input.limit,boards};
    if(publicPlatforms.includes(platform) && !boards.length)throw new TaskError(`${platform.toUpperCase()}_BOARDS_REQUIRED`,'请先在设置中添加目标公司。');
    const run=db.recordSearch({platform,...scope,state:'running'});
    try {
      const page=platform==='boss' ? await browser.search(profile,scope) : await providers[platform].search(scope);
      const jobs=['ready','partial'].includes(page.state) ? db.upsertJobs(page.jobs) : [];
      const record=db.finishSearch(run.id,{state:page.state,count:jobs.length,searchUrl:page.searchUrl,
        coverage:page.coverage,boards:page.boards,matched:page.matched,returned:page.returned,nextOffset:page.nextOffset});
      return {state:page.state,message:blockedMessages[page.state] || '',jobs,search:record};
    } catch(error) {db.finishSearch(run.id,{state:'failed',...failure(error)});throw error;}
  },{external:true});
  tool('get_job_detail','按平台刷新岗位正文。BOSS 使用普通 Chrome，公开接口按公司读取；通用导入返回已提供的正文。',{
    ...identity,jobId:uuid,
  },true,async ({profile,jobId})=>{
    const db=store(profile),job=db.job(jobId);
    const current=job.platform==='manual' ? {...job,...(knownJobIdentity(job.url) || {})} : job;
    if(current.platform==='manual')return {state:'user_provided',message:'此正文由用户提供，可重新导入更新。',job};
    const page=current.platform==='boss' ? await browser.detail(profile,current.url) : await providers[current.platform].detail(current);
    if(page.state!=='detail')return {state:page.state,message:blockedMessages[page.state] || '详情尚未读取。',jobId};
    return {state:'detail',job:db.upsertJobs([page.detail])[0]};
  },{external:true});
  tool('get_saved_job','读取已保存的岗位正文和进度历史，不访问网站。',{
    ...identity,jobId:uuid,
  },false,({profile,jobId})=>({job:store(profile).job(jobId),events:store(profile).history(jobId)}));
  tool('import_visible_jobs','保存实际读取的岗位材料及来源。导入记录不证明工具执行了搜索。',{
    ...identity,jobs:z.array(jobSchema).min(1).max(30),observedQuery:z.string().trim().min(1).max(100).optional(),
  },true,({profile,jobs,observedQuery})=>{
    const db=store(profile),saved=db.upsertJobs(jobs);
    const search=observedQuery ? db.recordSearch({query:observedQuery,state:'imported_visible_page',count:saved.length,coverage:'已读取的可见材料'}) : null;
    return {jobs:saved,search};
  });
  tool('import_job','通用岗位导入：保存用户提供的链接、字段与岗位正文，不抓取任意网站。工资仅比较明确的币种和周期。',{
    ...identity,url:z.string().min(1).max(2000),title:z.string().trim().min(1).max(500),
    company:z.string().max(500).default(''),location:z.string().max(300).default(''),salary:z.string().max(200).default(''),
    experience:z.string().max(200).default(''),description:z.string().trim().min(1).max(100000),
    compensation:z.array(compensationSchema).max(30).default([]),
  },true,({profile,...input})=>({job:store(profile).upsertJobs([{...input,source:'manual_import',
    rawText:[input.title,input.company,input.location,input.salary,input.experience,input.description].filter(Boolean).join('\n')}])[0]}));
  tool('import_resume','导入本机 PDF、DOCX、TXT 或 Markdown 简历，可附已确认事实文件。隐藏联系方式后保存在本机。每次导入创建新版本。',{
    ...identity,path:z.string().min(1).max(2000),label:z.string().trim().min(1).max(100),contextPath:z.string().min(1).max(2000).optional(),
  },true,async ({profile,...input})=>({resume:store(profile).addResume(await loadResume(input))}));
  tool('list_resumes','查看已导入简历的路线、来源和版本。',identity,false,({profile})=>({resumes:store(profile).resumes()}));
  tool('get_resume','读取指定简历版本及事实原文，用于对照岗位筛选。',{...identity,resumeId:uuid},false,
    ({profile,resumeId})=>({resume:store(profile).resume(resumeId)}));
  tool('set_preferences','保存用户确认的目标岗位、地点、薪资及单位、最低经验要求上限、办公范围和默认简历。',{
    ...identity,preferences:preferencesSchema,
  },true,({profile,preferences})=>({preferences:store(profile).setPreferences(preferences)}));
  tool('screening_context','读取简历、岗位和偏好，由 Codex 对照原文筛选。币种或计薪周期未知时不能强行比较。',{
    ...identity,resumeId:uuid,jobIds:z.array(uuid).min(1).max(30),
  },false,({profile,resumeId,jobIds})=>{
    const db=store(profile),preferences=db.preferences();
    return {resume:db.resume(resumeId),preferences,jobs:jobIds.map(id=>{
      const job=db.job(id);return {...job,constraintHints:constraintHints(job,preferences),descriptionComplete:completeDescription(job)};
    })};
  });
  tool('save_assessment','保存有原文依据的推荐、待核实或不符合结论。岗位更新后拒绝旧版本结论。',{
    ...identity,jobId:uuid,resumeId:uuid,jobRevision:z.number().int().positive(),assessment:assessmentSchema,
  },true,({profile,jobId,resumeId,jobRevision,assessment})=>({assessment:store(profile).assess(jobId,resumeId,jobRevision,assessment)}));
  tool('save_assessments','一次保存最多30个由 Codex 对照原文得出的筛选结论。任一引用、版本或身份无效则整批不保存。',{
    ...identity,resumeId:uuid,assessments:z.array(z.object({jobId:uuid,jobRevision:z.number().int().positive(),assessment:assessmentSchema}).strict()).min(1).max(30),
  },true,({profile,resumeId,assessments})=>({assessments:store(profile).assessMany(resumeId,assessments)}));
  tool('rank_jobs','按已确认的条件和当前简历版本的原文筛选结论排序。未筛选、未知条件与过期结论明确区分；排序本身不进行语义判断。最多读取500个候选。',{
    ...identity,status:z.enum(statuses).optional(),platform:z.enum(platforms).optional(),query:z.string().trim().max(100).default(''),
    resumeId:uuid.optional(),includeRejected:z.boolean().default(true),limit:z.number().int().min(1).max(100).default(30),offset:z.number().int().nonnegative().default(0),
  },false,({profile,limit,offset,includeRejected,...input})=>{
    const db=store(profile),preferences=db.preferences(),resumeId=input.resumeId || preferences.defaultResumeId || undefined;
    if(resumeId)db.resume(resumeId);
    const candidates=db.list({...input,resumeId,limit:501,offset:0});
    const ranked=rankJobs(candidates.slice(0,500),preferences,{includeRejected});
    return {jobs:ranked.slice(offset,offset+limit),total:ranked.length,hasMore:offset+limit<ranked.length,candidateLimitReached:candidates.length>500,
      resumeId:resumeId ?? null,coverage:candidates.length>500 ? '最近500个符合条件的候选，需缩小范围' : '全部符合条件的已保存岗位'};
  });
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
