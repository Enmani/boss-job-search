import { z } from 'zod';

export class TaskError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const profileSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).default('personal');
export const statuses = ['待筛选', '收藏', '准备投递', '已沟通', '已投递', '面试', 'Offer', '拒绝', '撤回'];
export const preferencesSchema = z.object({
  targetRoles: z.array(z.string().min(1).max(100)).max(20).default([]),
  cities: z.array(z.string().min(1).max(50)).max(20).default([]),
  minMonthlySalaryCny: z.number().int().nonnegative().nullable().default(null),
  locationRequirement: z.string().max(1000).default(''),
  notes: z.string().max(2000).default(''),
}).strict();

export function normalizeText(text) { return text.replace(/\s+/g, ' ').trim(); }
export function jobUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.zhipin.com' ||
      !/^\/job_detail\/[a-zA-Z0-9_-]+\.html$/.test(url.pathname)) {
    throw new TaskError('INVALID_JOB_URL', '请提供 BOSS 直聘岗位详情链接。');
  }
  // Tracking parameters are not part of job identity.
  return `https://www.zhipin.com${url.pathname}`;
}
export const jobSchema = z.object({
  url: z.string().transform(jobUrl), title: z.string().min(1).max(500),
  company: z.string().max(500).default(''), location: z.string().max(300).default(''),
  salary: z.string().max(200).default(''), experience: z.string().max(200).default(''),
  degree: z.string().max(200).default(''), description: z.string().max(40000).default(''),
  rawText: z.string().min(1).max(50000), source: z.enum(['boss_search', 'boss_detail', 'browser_import']),
});
export const assessmentSchema = z.object({
  decision: z.enum(['推荐', '待核实', '不符合']), summary: z.string().min(1).max(2000),
  matches: z.array(z.object({
    requirement: z.string().min(1).max(500), jobQuote: z.string().min(1).max(2000),
    resumeQuote: z.string().min(1).max(2000),
  }).strict()).max(30),
  gaps: z.array(z.object({ requirement: z.string().min(1).max(500), jobQuote: z.string().min(1).max(2000) }).strict()).max(30),
  questions: z.array(z.string().min(1).max(1000)).max(30),
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
  const range = salaryRange(job.salary);
  if (preferences.minMonthlySalaryCny !== null) {
    if (!range) hints.push({ kind: '待核实', field: '薪资', reason: '没有明确的人民币月薪范围。' });
    else if (range.max < preferences.minMonthlySalaryCny) hints.push({ kind: '不符合', field: '薪资', reason: '薪资上限低于最低月薪。' });
    else if (range.min < preferences.minMonthlySalaryCny) hints.push({ kind: '待核实', field: '薪资', reason: '范围包含低于最低月薪的报价。' });
  }
  if (preferences.cities.length && !preferences.cities.some(city => job.location.includes(city))) {
    hints.push({ kind: '待核实', field: '地点', reason: '岗位地点与偏好不一致，需核实远程或搬迁条件。' });
  }
  if (preferences.locationRequirement) hints.push({ kind: '待核实', field: '办公范围', reason: preferences.locationRequirement });
  return hints;
}
