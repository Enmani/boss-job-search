import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { join,dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TaskError, jobUrl, jobSchema } from './domain.mjs';
import { readBridgeConfig } from './bridge-config.mjs';
import { encodeFrame, FrameReader } from './framing.mjs';

const pageSchema = z.object({
  state:z.enum(['ready','empty','detail','login_required','verification_required','layout_unrecognized',
    'job_closed','outside_boss','search_scope_changed','detail_identity_changed']),
}).passthrough();

export class BossBrowser {
  constructor(root) {
    this.configPath=process.env.BOSS_BRIDGE_CONFIG || join(root,'bridge','config.json');
    this.sessionId=randomUUID();this.used=false;
  }
  request(method,params={},timeoutMs=45000) {
    const config=readBridgeConfig(this.configPath),id=randomUUID();
    return new Promise((resolve,reject) => {
      const socket=net.createConnection(config.pipe),decoder=new FrameReader();
      let settled=false;
      const finish=(error,value) => {
        if(settled)return;settled=true;clearTimeout(timer);socket.destroy();
        error ? reject(error) : resolve(value);
      };
      const timer=setTimeout(() => finish(new TaskError('BRIDGE_TIMEOUT','扩展读取超时，未保存此次结果。')),timeoutMs);
      socket.once('connect',() => socket.write(encodeFrame({id,sessionId:this.sessionId,token:config.token,method,params})));
      socket.on('data',chunk => {
        try {
          for(const response of decoder.push(chunk)) {
            if(response.id !== id)throw new Error('Wrong response identity');
            if(response.error) {
              const code=typeof response.error.code==='string' ? response.error.code : 'BRIDGE_FAILED';
              const message=typeof response.error.message==='string' ? response.error.message : '扩展通信失败。';
              finish(new TaskError(code,message));return;
            }
            if(!response.result || typeof response.result !== 'object')throw new Error('Missing result');
            finish(null,response.result);return;
          }
        } catch {finish(new TaskError('BRIDGE_PROTOCOL_INVALID','扩展返回了无法识别的通信数据。'));}
      });
      socket.once('error',() => finish(new TaskError('EXTENSION_NOT_CONNECTED','普通 Chrome 的求职扩展未连接，请打开 Chrome 并确认扩展已启用。')));
      socket.once('close',() => {if(!settled)finish(new TaskError('EXTENSION_DISCONNECTED','浏览器扩展连接中断，未保存此次结果。'));});
    });
  }
  async status() {
    try {return await this.request('status',{},3000);}
    catch(error) {
      if(!(error instanceof TaskError))throw error;
      const status={state:'extension_unavailable',code:error.code,message:error.message};
      try {
        const diagnostics=JSON.parse(readFileSync(join(dirname(this.configPath),'host-state.json'),'utf8'));
        status.hostDiagnostics=z.object({state:z.enum(['starting','listening','connected','caller_rejected','disconnected','pipe_error','protocol_error']),
          at:z.string().datetime(),code:z.string().max(80).optional()}).parse(diagnostics);
      } catch {
        status.hostDiagnostics={state:'unavailable'};
      }
      return status;
    }
  }
  async page(method,params) {
    this.used=true;
    const value=await this.request(method,params);
    try {return pageSchema.parse(value);}
    catch {throw new TaskError('PAGE_DATA_INVALID','扩展未返回有效的岗位状态，结果未保存。');}
  }
  async search(profile,{query,cityCode='100010000',limit=15}) {
    const page=await this.page('search',{query,cityCode,limit});
    if(page.state === 'ready' || page.state === 'empty') {
      if(page.query !== query || page.cityCode !== cityCode)throw new TaskError('SEARCH_SCOPE_CHANGED','页面关键词或城市与搜索要求不同，结果未保存。');
      let jobs;
      try {
        jobs=z.array(jobSchema).max(limit).parse(page.jobs);
        if(page.state === 'ready' && !jobs.length || page.state === 'empty' && jobs.length)throw new Error('Wrong result count');
        if(jobs.some(job=>job.source!=='boss_search' || job.description))throw new Error('Wrong search source');
      } catch {throw new TaskError('PAGE_DATA_INVALID','搜索条目格式或状态无效，结果未保存。');}
      const url=new URL('https://www.zhipin.com/web/geek/jobs');
      url.searchParams.set('query',query);url.searchParams.set('city',cityCode);
      return {...page,jobs,searchUrl:url.href,coverage:'原生 Chrome 扩展读取当前搜索页；未遍历全部结果'};
    }
    return {...page,jobs:[]};
  }
  async detail(profile,url) {
    const canonical=jobUrl(url),page=await this.page('detail',{url:canonical});
    if(page.state !== 'detail')return page;
    let detail;
    try {detail=jobSchema.parse(page.job);}
    catch {throw new TaskError('PAGE_DATA_INVALID','详情字段无效，结果未保存。');}
    if(detail.url !== canonical || detail.source !== 'boss_detail' || !detail.description.trim()) {
      throw new TaskError('DETAIL_IDENTITY_INVALID','未读到所选岗位的完整详情，结果未保存。');
    }
    return {state:'detail',detail};
  }
  async login() {return this.page('login',{});}
  async close() {
    if(!this.used)return {state:'closed',closedTabs:0};
    try {return await this.request('close',{},5000);}
    catch(error) {
      if(!(error instanceof TaskError))throw error;
      return {state:'extension_unavailable',code:error.code,message:error.message};
    } finally {this.used=false;}
  }
}
