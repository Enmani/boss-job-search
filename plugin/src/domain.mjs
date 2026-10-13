import { z } from 'zod';

export class TaskError extends Error {
  constructor(code, message, options) { super(message, options); this.code = code; }
}
export const profileSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).default('personal');
export const statuses = ['待筛选', '收藏', '准备投递', '已沟通', '已投递', '面试', 'Offer', '拒绝', '撤回'];
export const preferencesSchema = z.object({
  targetRoles: z.array(z.string().min(1).max(100)).max(20).default([]),
  cities: z.array(z.string().min(1).max(50)).max(20).default([]),
  minMonthlySalaryCny: z.number().int().nonnegative().nullable().default(null),
  locationRequirement: z.string().max(1000).default(''),
  notes: z.string().max(2000).default(''),
  minimumSalary: z.object({amount:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),period:z.enum(['hour','day','month','year'])}).strict().nullable().optional(),
  maxExperienceYears: z.number().nonnegative().max(100).nullable().optional(),
  defaultResumeId: z.string().uuid().nullable().optional(),
}).strict();

export function normalizeText(text) { return text.replace(/\s+/g, ' ').trim(); }
export const platforms = ['boss', 'greenhouse', 'ashby', 'lever', 'manual'];
export const searchPlatforms = ['boss', 'greenhouse', 'ashby', 'lever'];
export const boardTokenSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export function greenhouseBoard(value) {
  if (!value.includes('://')) return boardTokenSchema.parse(value);
  const url = new URL(value);
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/(?:jobs\/\d+)?)?\/?$/);
  if (!['https://boards.greenhouse.io','https://job-boards.greenhouse.io'].includes(url.origin) || !match || url.username || url.password)
    throw new TaskError('INVALID_BOARD', '请填写 Greenhouse 公司招聘页或标识。');
  return boardTokenSchema.parse(match[1]);
}
export const boardsSchema = z.array(z.string().trim().min(1).max(500).transform(greenhouseBoard)).max(10)
  .refine(values => new Set(values).size === values.length, '公司招聘页不能重复');
export function jobIdentity(value, {allowManual=false}={}) {
  let url; try {url = new URL(value);} catch {throw new TaskError('INVALID_JOB_URL','岗位链接格式不正确。');}
  if (!url.username && !url.password) {
    const boss = url.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/);
    if (url.origin === 'https://www.zhipin.com' && boss)
      return {platform:'boss',boardToken:'',platformJobId:boss[1],url:url.origin+url.pathname};
    const gh = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/jobs\/([1-9]\d*)\/?$/);
    if (['https://boards.greenhouse.io','https://job-boards.greenhouse.io'].includes(url.origin) && gh)
      return {platform:'greenhouse',boardToken:boardTokenSchema.parse(gh[1]),platformJobId:gh[2],
        url:`https://job-boards.greenhouse.io/${gh[1]}/jobs/${gh[2]}`};
    const ats = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\/(?:apply|application))?\/?$/);
    if (ats && ['https://jobs.ashbyhq.com','https://jobs.lever.co','https://jobs.eu.lever.co'].includes(url.origin)) {
      const platform = url.hostname === 'jobs.ashbyhq.com' ? 'ashby' : 'lever';
      return {platform,boardToken:boardTokenSchema.parse(ats[1]),platformJobId:ats[2].toLowerCase(),
        ...(platform === 'lever' ? {region:url.hostname === 'jobs.eu.lever.co' ? 'eu' : 'global'} : {}),
        url:`${url.origin}/${ats[1]}/${ats[2].toLowerCase()}`};
    }
    if (allowManual && ['http:','https:'].includes(url.protocol) &&
        !['www.zhipin.com','boards.greenhouse.io','job-boards.greenhouse.io','jobs.ashbyhq.com','jobs.lever.co','jobs.eu.lever.co'].includes(url.hostname)) {
      for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      if (url.href.length > 2000) throw new TaskError('INVALID_JOB_URL','岗位链接过长。');
      return {platform:'manual',boardToken:'',platformJobId:url.href,url:url.href};
    }
  }
  throw new TaskError('INVALID_JOB_URL', '请提供有效岗位链接；其他平台请使用通用导入。');
}
export function jobUrl(value) {return jobIdentity(value).url;}
export const compensationSchema = z.object({
  min:z.number().nonnegative(),max:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),
  period:z.enum(['hour','day','month','year','unknown']),label:z.string().max(300).default(''),
}).strict().refine(value => value.max >= value.min, '薪资范围无效');
export const jobSchema = z.object({
  url: z.string().max(2000), title: z.string().trim().min(1).max(500),
  platform:z.enum(platforms).optional(),platformJobId:z.string().max(2000).optional(),boardToken:boardTokenSchema.or(z.literal('')).optional(),
  region:z.enum(['global','eu']).optional(),
  applyUrl:z.string().url().max(2000).refine(value => {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}).optional(),
  compensation:z.array(compensationSchema).max(30).default([]),
  company: z.string().max(500).default(''), location: z.string().max(300).default(''),
  locations: z.array(z.string().max(300)).max(100).optional(),
  salary: z.string().max(200).default(''), experience: z.string().max(200).default(''),
  degree: z.string().max(200).default(''), description: z.string().max(100000).default(''),
  rawText: z.string().trim().min(1).max(120000), source: z.enum(['boss_search', 'boss_detail', 'browser_import','greenhouse_search','greenhouse_detail','ashby_search','ashby_detail','lever_search','lever_detail','manual_import']),
}).transform((job,context) => {
  const identity=jobIdentity(job.url,{allowManual:job.source==='manual_import'});
  for(const field of ['platform','platformJobId','boardToken','region']) {
    if(job[field] !== undefined && job[field] !== identity[field])
      context.addIssue({code:z.ZodIssueCode.custom,message:'岗位身份不一致',path:[field]});
  }
  if (searchPlatforms.some(platform => job.source.startsWith(platform+'_') && identity.platform !== platform))
    context.addIssue({code:z.ZodIssueCode.custom,message:'岗位来源不一致',path:['source']});
  const range=identity.platform === 'boss' ? salaryRange(job.salary) : null;
  const {platform,platformJobId,boardToken,region,url,applyUrl,compensation,...fields}=job;
  return {...identity,...fields,applyUrl:applyUrl || identity.url,
    compensation:identity.platform === 'boss' ? range ? [{...range,currency:'CNY',period:'month',label:''}] : [] : job.compensation};
});
export function completeDescription(job) {
  return ['boss_detail','greenhouse_search','greenhouse_detail','ashby_search','ashby_detail','lever_search','lever_detail'].includes(job.source) && !!job.description.trim();
}
export const assessmentSchema = z.object({
  decision: z.enum(['推荐', '待核实', '不符合']), summary: z.string().trim().min(1).max(2000),
  matches: z.array(z.object({
    requirement: z.string().trim().min(1).max(500), jobQuote: z.string().trim().min(1).max(2000),
    resumeQuote: z.string().trim().min(1).max(2000),
  }).strict()).max(30),
  gaps: z.array(z.object({ requirement: z.string().trim().min(1).max(500), jobQuote: z.string().trim().min(1).max(2000) }).strict()).max(30),
  questions: z.array(z.string().trim().min(1).max(1000)).max(30),
}).strict();

export function validateEvidence(assessment, job, resume) {
  const jobText = normalizeText([job.rawText, job.description].join(' '));
  const resumeText = normalizeText([resume.text, resume.contextText].join(' '));
  for (const item of [...assessment.matches, ...assessment.gaps]) {
    if (!jobText.includes(normalizeText(item.jobQuote))) {
      throw new TaskError('JOB_EVIDENCE_MISSING', '岗位引用未出现在已保存的岗位原文中。');
    }
  }
  for (const item of assessment.matches) {
    if (!resumeText.includes(normalizeText(item.resumeQuote))) {
      throw new TaskError('RESUME_EVIDENCE_MISSING', '简历引用未出现在简历或事实原文中。');
    }
  }
  if (assessment.decision === '推荐' && assessment.matches.length === 0) {
    throw new TaskError('EVIDENCE_REQUIRED', '推荐岗位需要至少一条有原文依据的匹配项。');
  }
  if (assessment.decision === '不符合' && assessment.gaps.length === 0) {
    throw new TaskError('EVIDENCE_REQUIRED', '排除岗位需要记录岗位要求和不符合原因。');
  }
}

export function salaryRange(salary) {
  // Only explicit monthly CNY ranges are comparable. Daily/yearly and 面议 stay unknown.
  const text = salary.replace(/\s+/g, '');
  if (/天|日|年|小时|USD|EUR|€|\$/i.test(text)) return null;
  let match = text.match(/^(\d+(?:\.\d+)?)\s*[-–~至]\s*(\d+(?:\.\d+)?)K(?:·\d+薪|\/月|元\/月)?$/i);
  if (match) return { min: Number(match[1]) * 1000, max: Number(match[2]) * 1000 };
  match = text.match(/^(\d+(?:\.\d+)?)\s*[-–~至]\s*(\d+(?:\.\d+)?)万(?:\/月|元\/月)?$/);
  if (match) return { min: Number(match[1]) * 10000, max: Number(match[2]) * 10000 };
  match = text.match(/^(\d+)\s*[-–~至]\s*(\d+)(?:元\/月|\/月)$/);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

export function constraintHints(job, preferences) {
  const hints = [];
  const minimum = preferences.minimumSalary ?? (preferences.minMonthlySalaryCny != null ? {amount:preferences.minMonthlySalaryCny,currency:'CNY',period:'month'} : null);
  const bossSalary = !job.compensation && job.url?.startsWith('https://www.zhipin.com/') ? salaryRange(job.salary) : null;
  const compensation = job.compensation || (bossSalary ? [{...bossSalary,currency:'CNY',period:'month'}] : []);
  const range = minimum ? compensation.filter(value=>value.currency===minimum.currency && value.period===minimum.period) : [];
  if (minimum) {
    if (!range.length) hints.push({ kind:'待核实',field:'薪资',reason:`没有同币种、同周期的明确薪资（${minimum.currency}/${minimum.period}）。` });
    else if (range.every(value=>value.max < minimum.amount)) hints.push({ kind:'不符合',field:'薪资',reason:'薪资上限低于最低要求。' });
    else if (range.some(value=>value.min < minimum.amount)) hints.push({ kind:'待核实',field:'薪资',reason:'范围包含低于最低要求的报价。' });
  }
  if (preferences.cities.length && !preferences.cities.some(city => [job.location,...(job.locations || [])].some(location=>location.toLowerCase().includes(city.toLowerCase())))) {
    hints.push({ kind: '待核实', field: '地点', reason: '岗位地点与偏好不一致，需核实远程或搬迁条件。' });
  }
  if (preferences.locationRequirement) hints.push({ kind: '待核实', field: '办公范围', reason: preferences.locationRequirement });
  if (preferences.maxExperienceYears != null && !/经验不限|不限|无需经验/i.test(job.experience)) {
    const match = job.experience.match(/^(\d+(?:\.\d+)?)(?:\s*[-–~至]\s*\d+)?\s*(?:年|years?)(?:以上|\+)?$/i);
    if (!match) hints.push({kind:'待核实',field:'经验',reason:'没有明确的最低工作年限。'});
    else if (Number(match[1]) > preferences.maxExperienceYears) hints.push({kind:'不符合',field:'经验',reason:'岗位最低经验要求超过设定上限。'});
  }
  return hints;
}
