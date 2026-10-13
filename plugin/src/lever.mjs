import { z } from 'zod';
import { jobSchema, jobIdentity, TaskError } from './domain.mjs';
import { platformBoards, leverSite, aggregateBoards, filterJobs, period, salaryText } from './boards.mjs';
import { getJson } from './ats-http.mjs';
import { descriptionText } from './job-text.mjs';

const postSchema = z.object({
  id: z.string().uuid(), text: z.string().min(1).max(500), hostedUrl: z.string().url(), applyUrl: z.string().url(),
  categories: z.object({ location: z.string().max(300).optional(),allLocations:z.array(z.string().max(300)).max(100).optional() }),
  descriptionPlain: z.string().max(1000000).optional(), description: z.string().max(1000000).optional(),
  lists: z.array(z.object({ text: z.string().max(500), content: z.string().max(1000000) })).max(100).optional(),
  additionalPlain: z.string().max(1000000).optional(), additional: z.string().max(1000000).optional(),
  workplaceType: z.string().optional(), salaryDescriptionPlain: z.string().max(100000).optional(),
  salaryRange: z.object({ currency: z.string(), interval: z.string(), min: z.number().nonnegative(), max: z.number().nonnegative() }).nullable().optional(),
});
export class LeverJobs {
  constructor(options = {}) { this.options = options; }
  async get(board, path) {
    const { token, region } = leverSite(board), host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    return getJson(`https://${host}/v0/postings/${token}${path}`, { ...this.options, platform: 'lever' });
  }
  convert(input, board, source) {
    try {
      const post = postSchema.parse(input), { token, region } = leverSite(board), identity = jobIdentity(post.hostedUrl);
      if (identity.platform !== 'lever' || identity.boardToken !== token || identity.region !== region || identity.platformJobId !== post.id.toLowerCase()) throw new Error('Identity mismatch');
      const description = [post.descriptionPlain?.trim() || descriptionText(post.description || ''),
        ...(post.lists || []).map(list => [list.text, descriptionText(list.content)].join('\n')),
        post.additionalPlain?.trim() || descriptionText(post.additional || ''), post.salaryDescriptionPlain].filter(Boolean).join('\n\n');
      if (!description.trim()) throw new Error('Empty description');
      const compensation = post.salaryRange ? [{ min: post.salaryRange.min, max: post.salaryRange.max, currency: post.salaryRange.currency,
        period: period(post.salaryRange.interval), label: '' }] : [];
      const locations=[...new Set([post.categories.location,...(post.categories.allLocations || [])].filter(Boolean))];
      const salary = salaryText(compensation), location = [...locations, post.workplaceType].filter(Boolean).join(' · ').slice(0,300);
      return jobSchema.parse({ url: post.hostedUrl, applyUrl: post.applyUrl, title: post.text, company: token, location, locations, salary, compensation, description,
        rawText: [post.text, token, ...locations, salary, description].filter(Boolean).join('\n'), source });
    } catch (error) { throw new TaskError('LEVER_DATA_INVALID', 'Lever 岗位身份、字段或正文无效。', {cause:error}); }
  }
  async posts(board) {
    const posts = [], seen = new Set();
    for (let skip = 0; skip < 10000; skip += 100) {
      let page;
      try { page = z.array(postSchema).max(100).parse(await this.get(board, `?mode=json&skip=${skip}&limit=100`)); }
      catch (error) { if (error instanceof TaskError) throw error; throw new TaskError('LEVER_DATA_INVALID', 'Lever 岗位数据格式无效。', {cause:error}); }
      for (const post of page) {
        if (seen.has(post.id)) throw new TaskError('LEVER_PAGINATION_INVALID', '岗位分页重复，请重试。');
        seen.add(post.id); posts.push(post);
      }
      if (page.length < 100) return posts;
    }
    throw new TaskError('LEVER_TOO_MANY_JOBS', '公司岗位超过读取上限，未返回截断结果。');
  }
  async search({ boards, query, location = '', limit = 15 }) {
    const tokens = platformBoards('lever', boards);
    if (!tokens.length) throw new TaskError('LEVER_BOARDS_REQUIRED', '请先添加 Lever 目标公司。');
    const results = [];
    for (const board of tokens) {
      try {
        const posts = await this.posts(board), jobs = filterJobs(posts.map(post => this.convert(post, board, 'lever_search')), query, location);
        results.push({ board, company: leverSite(board).token, state: 'ready', total: posts.length, matched: jobs.length, jobs });
      } catch (error) { results.push({ board, state: 'failed', code: error.code || 'LEVER_DATA_INVALID', message: error.message, jobs: [] }); }
    }
    return aggregateBoards(results, limit);
  }
  async detail(job) {
    if (job.platform !== 'lever') throw new TaskError('INVALID_PLATFORM', '岗位平台不正确。');
    const board = job.region === 'eu' ? `https://jobs.eu.lever.co/${job.boardToken}` : job.boardToken;
    const detail = this.convert(await this.get(board, `/${job.platformJobId}?mode=json`), board, 'lever_detail');
    if (detail.platformJobId !== job.platformJobId) throw new TaskError('DETAIL_IDENTITY_INVALID', '返回详情与所选岗位不同。');
    return { state: 'detail', detail };
  }
}
