import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID,randomBytes } from 'node:crypto';
import { encodeFrame,FrameReader } from '../plugin/src/framing.mjs';

export const job={url:'https://www.zhipin.com/job_detail/native_fixture.html',title:'示例产品经理',
  company:'示例公司',location:'示例地址',salary:'10-20K',experience:'1-3年',degree:'本科',
  description:'需求分析与产品迭代。',rawText:'需求分析与产品迭代。',source:'boss_detail'};

// Real native framing with an explicit Chrome fixture, never a real website result.
export async function nativeFixture({launcher=false,version='0.1.3'}={}) {
  const directory=mkdtempSync(join(tmpdir(),'boss-native-'));
  const config={extensionId:'a'.repeat(32),pipe:'\\\\.\\pipe\\boss-job-search-'+randomUUID(),
    token:randomBytes(32).toString('hex')};
  const configPath=join(directory,'config.json');writeFileSync(configPath,JSON.stringify(config));
  let command=process.execPath,args=[resolve('plugin/src/native-host.mjs'),'--config',configPath,
    `chrome-extension://${config.extensionId}/`];
  if(launcher) {
    const path=join(directory,'host.cmd');
    writeFileSync(path,'@echo off\r\n"'+process.execPath+'" "'+resolve('plugin/src/native-host.mjs')+'" --config "'+configPath+'" "%~1"\r\n','ascii');
    command=process.env.ComSpec;
    args=['/d','/s','/c',`""${path}" "chrome-extension://${config.extensionId}/""`];
  }
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,windowsVerbatimArguments:launcher});
  const decoder=new FrameReader();let reply;
  const fixture={directory,configPath,config,child,mode:'ready',delay:0,
    send:value=>child.stdin.write(encodeFrame(value)),
    async close(){child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);});rmSync(directory,{recursive:true,force:true});},
  };
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Fixture native handshake timeout')),5000);
    reply=()=>{clearTimeout(timer);resolve();};
    child.once('exit',code=>{if(code)reject(new Error('Fixture host exited'));});
  });
  child.stdout.on('data',chunk=>{
    for(const message of decoder.push(chunk)) {
      if(message.type==='ready'){reply();continue;}
      if(message.type!=='command')continue;
      setTimeout(()=>{
        let result;
        if(message.method==='search')result=fixture.mode==='ready'
          ? {state:'ready',query:message.params.query,cityCode:message.params.cityCode,jobs:[{...job,description:'',source:'boss_search'}]}
          : {state:fixture.mode,jobs:[]};
        else if(message.method==='detail')result={state:'detail',job:fixture.mode==='wrong_detail' ? {...job,url:'https://www.zhipin.com/job_detail/wrong.html'} : job};
        else if(message.method==='close')result={state:'closed',closedTabs:0};
        else result={state:'login_required'};
        if(!child.stdin.destroyed)fixture.send({type:'response',id:message.id,result});
      },fixture.delay);
    }
  });
  fixture.send({type:'hello',protocol:1,extensionId:config.extensionId,version});
  try {await ready;}
  catch(error) {await fixture.close();throw error;}
  return fixture;
}
