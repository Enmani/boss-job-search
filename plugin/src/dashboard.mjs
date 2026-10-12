import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { profileSchema,TaskError } from './domain.mjs';
import { failure } from './actions.mjs';

const files=new Map([['/',['index.html','text/html']],['/dashboard.js',['dashboard.js','text/javascript']],
  ['/view.js',['view.js','text/javascript']],['/style.css',['style.css','text/css']]]);
const allowed=new Set(['get_status','search_jobs','get_job_detail','get_saved_job','list_jobs','list_resumes',
  'set_greenhouse_boards','update_progress','get_progress_history','open_login']);
const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
export class Dashboard {
  constructor(actions) {this.actions=actions;this.token=randomBytes(32).toString('hex');this.server=null;this.starting=null;}
  async open(profile='personal') {
    profile=profileSchema.parse(profile);
    if(!this.starting)this.starting=this.start().catch(error=>{this.starting=null;throw error;});
    await this.starting;
    return `${this.origin}/#token=${this.token}&profile=${encodeURIComponent(profile)}`;
  }
  async start() {
    const assets=new Map();
    for(const [path,[file,type]] of files)assets.set(path,{type,body:await readFile(new URL(`../panel/${file}`,import.meta.url))});
    const server=createServer((request,response)=>this.handle(request,response,assets));
    server.requestTimeout=20000;server.headersTimeout=10000;server.maxConnections=32;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    this.server=server;this.origin=`http://127.0.0.1:${server.address().port}`;
  }
  async handle(request,response,assets) {
    response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if(request.headers.host!==new URL(this.origin).host){json(response,403,{code:'HOST_REJECTED',message:'访问地址不正确。'});return;}
      if(request.method==='GET' && assets.has(request.url)) {
        const {type,body}=assets.get(request.url);response.writeHead(200,{'Content-Type':type+'; charset=utf-8'});response.end(body);return;
      }
      const match=request.url.match(/^\/api\/tools\/([a-z_]+)$/);
      if(!match || !allowed.has(match[1])){json(response,404,{code:'NOT_FOUND',message:'操作不存在。'});return;}
      if(request.method!=='POST'){json(response,405,{code:'METHOD_REJECTED',message:'请求方式不正确。'});return;}
      const bearer=(request.headers.authorization || '').replace(/^Bearer /,'');
      if(!/^[a-f0-9]{64}$/.test(bearer) || !timingSafeEqual(Buffer.from(bearer),Buffer.from(this.token))){json(response,401,{code:'ACCESS_DENIED',message:'请从 Codex 重新打开面板。'});return;}
      if(request.headers.origin!==this.origin || !request.headers['content-type']?.startsWith('application/json'))
        {json(response,403,{code:'ORIGIN_REJECTED',message:'请求来源不正确。'});return;}
      let size=0;const chunks=[];
      for await(const chunk of request) {
        size+=chunk.length;
        if(size>65536)throw new TaskError('INPUT_TOO_LARGE','输入内容过大。');
        chunks.push(chunk);
      }
      let args;try{args=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new TaskError('INVALID_INPUT','输入格式不正确。');}
      const value=await this.actions.invoke(match[1],args);json(response,200,value);
    } catch(error) {if(!response.destroyed && !response.headersSent)json(response,400,failure(error));}
  }
  async close() {
    if(this.starting)await this.starting.catch(()=>{});
    if(this.server) {
      const server=this.server;this.server=null;
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    }
    this.starting=null;
  }
}
