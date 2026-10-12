import { z } from 'zod';
import { compile } from 'html-to-text';
import { decodeHTML } from 'entities';
import { boardTokenSchema, boardsSchema, jobSchema, TaskError } from './domain.mjs';

const toText=compile({wordwrap:false,limits:{maxInputLength:1000000},selectors:[
  {selector:'a',options:{ignoreHref:true}},{selector:'img',format:'skip'},
  {selector:'h1',options:{uppercase:false}},{selector:'h2',options:{uppercase:false}},
  {selector:'h3',options:{uppercase:false}},
]});
export function descriptionText(content) {
  // Greenhouse can return entity-encoded markup as well as ordinary HTML.
  // Decode markup before conversion; plain-text rendering never executes it.
  let html=content;
  for(let pass=0;pass<2 && /&(?:amp;)?lt;\/?(?:p|div|ul|li|br|h[1-6]|strong|span)\b/i.test(html);pass++) html=decodeHTML(html);
  return toText(html).trim();
}
const postSchema=z.object({
  id:z.number().int().positive().safe(),title:z.string().min(1).max(500),
  company_name:z.string().max(500).optional(),location:z.object({name:z.string().max(300)}),
  absolute_url:z.string().url().max(2000),content:z.string().min(1).max(1000000),
  pay_input_ranges:z.array(z.object({min_cents:z.number().nonnegative(),max_cents:z.number().nonnegative(),
    currency_type:z.string().regex(/^[A-Z]{3}$/),title:z.string().max(300).optional()})).max(30).optional(),
});
const MAX_RESPONSE=24*1024*1024;
export class GreenhouseJobs {
  constructor({fetchImpl=fetch,timeoutMs=15000}={}) {this.fetch=fetchImpl;this.timeoutMs=timeoutMs;}
  async get(board,path='') {
    boardTokenSchema.parse(board);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response=await this.fetch(`https://boards-api.greenhouse.io/v1/boards/${board}${path}`,
        {signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});
      if(response.status===404)throw new TaskError('GREENHOUSE_NOT_FOUND','公司招聘页或岗位已不存在。');
      if(response.status===429)throw new TaskError('GREENHOUSE_RATE_LIMIT','Greenhouse 请求过多，请稍后重试。');
      if(!response.ok)throw new TaskError('GREENHOUSE_HTTP_ERROR',`Greenhouse 返回 HTTP ${response.status}。`);
      if(!response.headers.get('content-type')?.includes('application/json'))
        throw new TaskError('GREENHOUSE_DATA_INVALID','Greenhouse 未返回有效岗位数据。');
      let size=0;const chunks=[];
      for await(const chunk of response.body) {
        size+=chunk.length;
        if(size>MAX_RESPONSE){controller.abort();throw new TaskError('GREENHOUSE_TOO_LARGE','公司岗位数据过大，请改用岗位链接读取。');}
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch(error) {
      if(error instanceof TaskError)throw error;
      if(controller.signal.aborted)throw new TaskError('GREENHOUSE_TIMEOUT','Greenhouse 读取超时，请重试。');
      if(error instanceof SyntaxError)throw new TaskError('GREENHOUSE_DATA_INVALID','Greenhouse 返回的数据无法解析。');
      throw new TaskError('GREENHOUSE_NETWORK_ERROR','无法连接 Greenhouse，请检查网络后重试。');
    } finally {clearTimeout(timer);}
  }
  convert(input,board,company,source) {
    try {
      const post=postSchema.parse(input),description=descriptionText(post.content);
      if(!description)throw new Error('Empty description');
      const compensation=(post.pay_input_ranges || []).map(range=>{
        const label=range.title || '';
        const period=/\b(?:annual|yearly|per year)\b|年薪/i.test(label) ? 'year'
          : /\b(?:monthly|per month)\b|月薪/i.test(label) ? 'month'
          : /\b(?:hourly|per hour)\b|时薪/i.test(label) ? 'hour' : 'unknown';
        return {min:range.min_cents/100,max:range.max_cents/100,currency:range.currency_type,period,label};
      });
      const salary=compensation.map(range=>`${range.min.toLocaleString('en-US')}-${range.max.toLocaleString('en-US')} ${range.currency}${range.label ? ' · '+range.label : ''}`).join('; ');
      return jobSchema.parse({url:`https://job-boards.greenhouse.io/${board}/jobs/${post.id}`,applyUrl:post.absolute_url,
        title:post.title,company:post.company_name || company,location:post.location.name,salary,compensation,description,
        rawText:[post.title,post.company_name || company,post.location.name,salary,description].filter(Boolean).join('\n'),source});
    } catch {throw new TaskError('GREENHOUSE_DATA_INVALID','Greenhouse 岗位字段或正文无效，未保存结果。');}
  }
  async search({boards,query,location='',limit=15}) {
    const tokens=boardsSchema.parse(boards);
    if(!tokens.length)throw new TaskError('GREENHOUSE_BOARDS_REQUIRED','请先添加目标公司的 Greenhouse 招聘页。');
    const results=[];
    // A board failure is explicit; successful boards remain usable and are labelled partial.
    for(const board of tokens) {
      try {
        const [metadata,page]=await Promise.all([this.get(board),this.get(board,'/jobs?content=true')]);
        const company=z.object({name:z.string().min(1).max(500)}).parse(metadata).name;
        const inputs=z.object({jobs:z.array(postSchema).max(10000)}).parse(page).jobs;
        const jobs=inputs.map(post=>this.convert(post,board,company,'greenhouse_search')).filter(job=>
          `${job.title} ${job.company} ${job.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
          (!location || job.location.toLocaleLowerCase().includes(location.toLocaleLowerCase())));
        results.push({board,company,state:'ready',total:inputs.length,matched:jobs.length,jobs});
      } catch(error) {
        results.push({board,state:'failed',code:error instanceof TaskError ? error.code : 'GREENHOUSE_DATA_INVALID',
          message:error instanceof TaskError ? error.message : '公司岗位数据格式无效。',jobs:[]});
      }
    }
    const failures=results.filter(value=>value.state==='failed'),all=results.flatMap(value=>value.jobs);
    // Round-robin keeps each configured company represented within a bounded result page.
    const jobs=[];
    for(let index=0;jobs.length<limit && index<all.length;index++)
      for(const result of results) {if(result.jobs[index] && jobs.length<limit)jobs.push(result.jobs[index]);}
    return {state:failures.length ? failures.length===results.length ? 'failed' : 'partial' : jobs.length ? 'ready' : 'empty',
      jobs,boards:results.map(({jobs,...metadata})=>metadata),matched:all.length,returned:jobs.length,
      coverage:'已添加公司招聘页的公开岗位；关键词匹配标题、公司和正文，地点匹配地点文字；未覆盖其他公司'};
  }
  async detail(job) {
    if(job.platform!=='greenhouse')throw new TaskError('INVALID_PLATFORM','岗位平台不正确。');
    const post=await this.get(job.boardToken,`/jobs/${job.platformJobId}?pay_transparency=true`);
    const detail=this.convert(post,job.boardToken,job.company,'greenhouse_detail');
    if(detail.platformJobId!==job.platformJobId)throw new TaskError('DETAIL_IDENTITY_INVALID','返回的详情与所选岗位不同。');
    return {state:'detail',detail};
  }
}
