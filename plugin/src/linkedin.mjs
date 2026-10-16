import {z} from 'zod';
import {setTimeout as wait} from 'node:timers/promises';
import {jobIdentity,TaskError} from './domain.mjs';
import {linkedinSearchUrl,parseLinkedInSearch,parseLinkedInDetail} from './linkedin-html.mjs';

const searchInput=z.object({query:z.string().trim().min(1).max(100),location:z.string().trim().max(100).default(''),
  offset:z.number().int().min(0).max(1000).default(0),limit:z.number().int().min(1).max(30).default(15)}).strict();
function retryDuration(header,now) {
  if(!header)return 300000;
  const milliseconds=/^\d+$/.test(header) ? Number(header)*1000 : Date.parse(header)-now;
  return Number.isFinite(milliseconds) ? Math.max(300000,milliseconds) : 300000;
}
export class LinkedInJobs {
  constructor({fetchImpl=fetch,timeoutMs=15000,maxBytes=4*1024*1024,now=Date.now,minIntervalMs=3000,waitImpl=wait}={}) {
    this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.maxBytes=maxBytes;this.now=now;this.minIntervalMs=minIntervalMs;this.wait=waitImpl;
    this.busy=false;this.nextAllowedAt=0;this.cooldownUntil=0;this.lastState='not_checked';this.lastError=null;
  }
  status() {return {state:this.busy ? 'busy' : this.cooldownUntil>this.now() ? 'rate_limited' : this.lastState==='rate_limited' ? 'not_checked' : this.lastState,
    retryAt:this.cooldownUntil>this.now() ? new Date(this.cooldownUntil).toISOString() : null,error:this.lastError};}
  async read(action) {
    try {const result=await action();this.lastState=result.state;this.lastError=null;return result;}
    catch(error) {
      if(error instanceof z.ZodError)error=new TaskError('LINKEDIN_DATA_INVALID','LinkedIn 岗位字段无效，未保存结果。',{cause:error});
      if(error.code!=='LINKEDIN_BUSY') {
        this.lastState=({LINKEDIN_RATE_LIMIT:'rate_limited',LINKEDIN_LOGIN_REQUIRED:'login_required',LINKEDIN_VERIFICATION_REQUIRED:'verification_required'})[error.code] || 'failed';
        this.lastError={code:error.code || 'OPERATION_FAILED',message:error.message};
      }
      throw error;
    }
  }
  async get(url) {
    if(this.busy)throw new TaskError('LINKEDIN_BUSY','LinkedIn 正在读取，请稍后重试。');
    if(this.now()<this.cooldownUntil)throw new TaskError('LINKEDIN_RATE_LIMIT',`LinkedIn 限流中，请在 ${new Date(this.cooldownUntil).toISOString()} 后重试。`);
    this.busy=true;
    let response,controller,timer;
    try {
      const delay=this.nextAllowedAt-this.now();if(delay>0)await this.wait(delay);
      controller=new AbortController();timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      response=await this.fetch(url,{redirect:'manual',credentials:'omit',signal:controller.signal,headers:{Accept:'text/html'}});
      if(response.status===429) {
        this.cooldownUntil=Math.min(8640000000000000,this.now()+retryDuration(response.headers.get('retry-after'),this.now()));
        throw new TaskError('LINKEDIN_RATE_LIMIT','LinkedIn 返回429限流；已暂停至少五分钟，未保存为搜索结果。');
      }
      if(response.status>=300 && response.status<400) {
        const destination=response.headers.get('location') || '';
        if(/\/(?:authwall|login|uas\/login)\b/.test(destination))throw new TaskError('LINKEDIN_LOGIN_REQUIRED','LinkedIn 要求本人登录。');
        if(/\/(?:checkpoint|challenge)\b/.test(destination))throw new TaskError('LINKEDIN_VERIFICATION_REQUIRED','LinkedIn 要求本人完成验证。');
        throw new TaskError('LINKEDIN_REDIRECT','LinkedIn 返回跳转，未继续读取。');
      }
      if(response.status===403 || response.status===999)throw new TaskError('LINKEDIN_ACCESS_BLOCKED','LinkedIn 拒绝此次公开读取。');
      if(response.status===401)throw new TaskError('LINKEDIN_LOGIN_REQUIRED','LinkedIn 要求本人登录。');
      if(response.status===404)throw new TaskError('LINKEDIN_NOT_FOUND','LinkedIn 岗位或页面已不存在。');
      if(!response.ok)throw new TaskError('LINKEDIN_HTTP_ERROR',`LinkedIn 返回 HTTP ${response.status}。`);
      if(!response.headers.get('content-type')?.includes('text/html'))throw new TaskError('LINKEDIN_DATA_INVALID','LinkedIn 未返回岗位网页。');
      let size=0;const chunks=[];
      for await(const chunk of response.body) {
        size+=chunk.length;
        if(size>this.maxBytes){controller.abort();throw new TaskError('LINKEDIN_TOO_LARGE','LinkedIn 页面超出读取上限。');}
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    }catch(error) {
      if(error instanceof TaskError)throw error;
      if(controller?.signal.aborted)throw new TaskError('LINKEDIN_TIMEOUT','LinkedIn 读取超时，请稍后重试。');
      throw new TaskError('LINKEDIN_NETWORK_ERROR','无法连接 LinkedIn，请检查网络。');
    }finally {
      if(response?.body && !response.bodyUsed)await response.body.cancel().catch(()=>{});
      clearTimeout(timer);this.busy=false;this.nextAllowedAt=this.now()+this.minIntervalMs;
    }
  }
  async search(input) {
    const scope=searchInput.parse(input);
    return this.read(async()=>parseLinkedInSearch(await this.get(linkedinSearchUrl(scope)),scope));
  }
  async detail(job) {
    const identity=jobIdentity(job.url);
    if(identity.platform!=='linkedin' || job.platform!=='linkedin' || identity.platformJobId!==job.platformJobId)
      throw new TaskError('INVALID_PLATFORM','LinkedIn 岗位身份不一致。');
    return this.read(async()=>({state:'detail',detail:parseLinkedInDetail(await this.get(identity.url),identity.platformJobId)}));
  }
  async check() {
    const page=await this.search({query:'Product Manager',location:'',limit:1});
    return {state:page.state,coverage:page.coverage};
  }
}
