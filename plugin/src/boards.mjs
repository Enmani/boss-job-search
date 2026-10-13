import { z } from 'zod';
import { boardTokenSchema, greenhouseBoard, TaskError } from './domain.mjs';

export const publicPlatforms = ['greenhouse', 'ashby', 'lever'];
const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function platformBoard(platform, value) {
  if (platform === 'greenhouse') return greenhouseBoard(value);
  if (!value.includes('://')) return boardTokenSchema.parse(value);
  let url; try { url = new URL(value); } catch { throw new TaskError('INVALID_BOARD', '公司招聘页格式不正确。'); }
  const origins = platform === 'ashby' ? ['https://jobs.ashbyhq.com'] : ['https://jobs.lever.co', 'https://jobs.eu.lever.co'];
  const path = url.pathname.match(new RegExp(`^/([a-zA-Z0-9_-]+)(?:/${uuid}(?:/(?:apply|application))?)?/?$`));
  if (!origins.includes(url.origin) || !path || url.username || url.password)
    throw new TaskError('INVALID_BOARD', '请填写该平台的公司招聘页或公司标识。');
  const token = boardTokenSchema.parse(path[1]);
  return url.hostname === 'jobs.eu.lever.co' ? `https://jobs.eu.lever.co/${token}` : token;
}
export function platformBoards(platform, values) {
  z.enum(publicPlatforms).parse(platform);
  const boards = z.array(z.string().trim().min(1).max(500)).max(10).parse(values).map(value => platformBoard(platform, value));
  if (new Set(boards).size !== boards.length) throw new TaskError('INVALID_BOARD', '公司招聘页不能重复。');
  return boards;
}
export const boardInputs = z.array(z.string().trim().min(1).max(500)).max(10);
export function leverSite(board) {
  const canonical = platformBoard('lever', board);
  return canonical.includes('://') ? { token: new URL(canonical).pathname.slice(1), region: 'eu' } : { token: canonical, region: 'global' };
}
export function aggregateBoards(results, limit) {
  const jobs = [], matched = results.reduce((sum, result) => sum + (result.matched || 0), 0);
  const failures = results.filter(result => result.state === 'failed');
  for (let index = 0; jobs.length < limit && index < matched; index++)
    for (const result of results) if (result.jobs[index] && jobs.length < limit) jobs.push(result.jobs[index]);
  return { state: failures.length ? failures.length === results.length ? 'failed' : 'partial' : jobs.length ? 'ready' : 'empty',
    jobs, boards: results.map(({ jobs, ...metadata }) => metadata), matched, returned: jobs.length,
    coverage: '已添加公司招聘页的公开岗位；关键词匹配标题、公司和正文，地点匹配地点文字；未覆盖其他公司' };
}
export function filterJobs(jobs, query, location) {
  return jobs.filter(job => `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(query.toLowerCase()) &&
    (!location || [job.location,...(job.locations || [])].some(value=>value.toLowerCase().includes(location.toLowerCase()))));
}
export function period(value) {
  return ({ '1 HOUR': 'hour', '1 DAY': 'day', '1 MONTH': 'month', '1 YEAR': 'year', hourly: 'hour', daily: 'day', monthly: 'month', yearly: 'year', annually: 'year' })[value] || 'unknown';
}
export function salaryText(ranges) {
  return ranges.map(range => `${range.min.toLocaleString('en-US')}-${range.max.toLocaleString('en-US')} ${range.currency} · ${range.period}`).join('; ').slice(0, 200);
}
