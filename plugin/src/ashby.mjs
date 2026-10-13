import { z } from 'zod';
import { jobSchema, jobIdentity, TaskError } from './domain.mjs';
import { platformBoards, aggregateBoards, filterJobs, period, salaryText } from './boards.mjs';
import { getJson } from './ats-http.mjs';
import { descriptionText } from './job-text.mjs';

const salary = z.object({ compensationType: z.literal('Salary'), currencyCode: z.string().regex(/^[A-Z]{3}$/), minValue: z.number().nonnegative(), maxValue: z.number().nonnegative(), interval: z.string() });
const otherCompensation = z.object({compensationType:z.string().refine(value=>value!=='Salary')});
const postSchema = z.object({
  title: z.string().min(1).max(500), location: z.string().max(300), jobUrl: z.string().url(), applyUrl: z.string().url(),
  descriptionPlain: z.string().max(1000000).optional(), descriptionHtml: z.string().max(1000000).optional(),
  isListed: z.boolean(), isRemote: z.boolean().nullish(), workplaceType: z.string().nullish(),
  secondaryLocations:z.array(z.object({location:z.string().max(300)})).max(100).optional(),
  compensation: z.object({ summaryComponents: z.array(z.union([salary,otherCompensation])).max(30).optional() }).nullable().optional(),
});
export class AshbyJobs {
  constructor(options = {}) { this.options = options; }
  async posts(board) {
    const token = platformBoards('ashby', [board])[0];
    const input = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`, { ...this.options, platform: 'ashby' });
    try { return z.object({ jobs: z.array(postSchema).max(10000) }).parse(input).jobs; }
    catch (error) { throw new TaskError('ASHBY_DATA_INVALID', 'Ashby 岗位字段无效，未保存结果。', {cause:error}); }
  }
  convert(post, board, source) {
    try {
      const identity = jobIdentity(post.jobUrl);
      if (identity.platform !== 'ashby' || identity.boardToken !== board) throw new Error('Identity mismatch');
      const description = post.descriptionPlain?.trim() || descriptionText(post.descriptionHtml || '');
      if (!description) throw new Error('Empty description');
      const compensation = (post.compensation?.summaryComponents || []).filter(value => value.compensationType === 'Salary')
        .map(value => ({ min: value.minValue, max: value.maxValue, currency: value.currencyCode, period: period(value.interval), label: '' }));
      const locations=[...new Set([post.location,...(post.secondaryLocations || []).map(value=>value.location)].filter(Boolean))];
      const salary = salaryText(compensation), location = [...locations, post.workplaceType || (post.isRemote ? 'Remote' : '')].filter(Boolean).join(' · ').slice(0,300);
      return jobSchema.parse({ url: post.jobUrl, applyUrl: post.applyUrl, title: post.title, company: board, location, locations, salary, compensation, description,
        rawText: [post.title, board, ...locations, salary, description].filter(Boolean).join('\n'), source });
    } catch { throw new TaskError('ASHBY_DATA_INVALID', 'Ashby 岗位身份、薪资或正文无效。'); }
  }
  async search({ boards, query, location = '', limit = 15 }) {
    const tokens = platformBoards('ashby', boards);
    if (!tokens.length) throw new TaskError('ASHBY_BOARDS_REQUIRED', '请先添加 Ashby 目标公司。');
    const results = [];
    for (const board of tokens) {
      try {
        const posts = (await this.posts(board)).filter(post => post.isListed);
        const jobs = filterJobs(posts.map(post => this.convert(post, board, 'ashby_search')), query, location);
        results.push({ board, company: board, state: 'ready', total: posts.length, matched: jobs.length, jobs });
      } catch (error) { results.push({ board, state: 'failed', code: error.code || 'ASHBY_DATA_INVALID', message: error.message, jobs: [] }); }
    }
    return aggregateBoards(results, limit);
  }
  async detail(job) {
    if (job.platform !== 'ashby') throw new TaskError('INVALID_PLATFORM', '岗位平台不正确。');
    const post = (await this.posts(job.boardToken)).find(post => post.isListed && jobIdentity(post.jobUrl).platformJobId === job.platformJobId);
    if (!post) throw new TaskError('ASHBY_NOT_FOUND', '岗位已下架或未公开列出。');
    return { state: 'detail', detail: this.convert(post, job.boardToken, 'ashby_detail') };
  }
}
