import { readJobDocument } from './reader.js';

const HOST='com.boss_job_search.bridge';
const sessions=new Map(),openUrls=new Map();
let port=null,ready=false,busy=false,retries=0;

function jobUrl(value) {
  const url=new URL(value);
  if(url.origin!=='https://www.zhipin.com' || !/^\/job_detail\/[a-zA-Z0-9_-]+\.html$/.test(url.pathname))throw new Error('Invalid job URL');
  return url.origin+url.pathname;
}
function validateCommand(command) {
  if(!command || command.type!=='command' || !/^[0-9a-f-]{36}$/.test(command.id) ||
      !/^[0-9a-f-]{36}$/.test(command.sessionId))throw new Error('Invalid command');
  const input=command.params;
  if(!input || typeof input!=='object')throw new Error('Missing arguments');
  if(command.method==='search') {
    if(typeof input.query!=='string' || !input.query.trim() || input.query.length>100 ||
        !/^\d{9}$/.test(input.cityCode) || !Number.isInteger(input.limit) || input.limit<1 || input.limit>30)throw new Error('Invalid search');
  } else if(command.method==='detail') jobUrl(input.url);
  else if(!['login','close'].includes(command.method))throw new Error('Unknown command');
  return command;
}
async function waitForDocument(tabId) {
  const deadline=Date.now()+20000;
  while(Date.now()<deadline) {
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete' && !tab.pendingUrl && tab.url) {
      if(new URL(tab.url).origin!=='https://www.zhipin.com')return {state:'outside_boss'};
      return null;
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Document timeout');
}
async function navigate(sessionId,mode,url,active=false) {
  let session=sessions.get(sessionId);
  if(!session){session={};sessions.set(sessionId,session);}
  let tab;
  if(session[mode]) {
    try {tab=await chrome.tabs.get(session[mode]);}
    catch {delete session[mode];}
  }
  if(tab)tab=await chrome.tabs.update(tab.id,{url,active});
  else tab=await chrome.tabs.create({url,active});
  session[mode]=tab.id;
  return {tabId:tab.id,gate:await waitForDocument(tab.id)};
}
async function read(tabId,mode,limit=15) {
  const [{result}]=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:readJobDocument,args:[mode,limit]});
  if(!result)throw new Error('No document result');
  return result;
}
async function execute({method,params,sessionId}) {
  if(method==='close') {
    const session=sessions.get(sessionId);
    let closedTabs=0;
    for(const id of Object.values(session || {})) {
      try {await chrome.tabs.get(id);}
      catch {continue;}
      await chrome.tabs.remove(id);closedTabs++;
    }
    sessions.delete(sessionId);
    return {state:'closed',closedTabs};
  }
  if(method==='login') {
    const {gate}=await navigate(sessionId,'login','https://www.zhipin.com/web/user/',true);
    return gate || {state:'login_required',message:'请本人在普通 Chrome 完成登录或验证，然后重新搜索。'};
  }
  if(method==='search') {
    const url=new URL('https://www.zhipin.com/web/geek/jobs');
    url.searchParams.set('query',params.query);url.searchParams.set('city',params.cityCode);
    const {tabId,gate}=await navigate(sessionId,'search',url.href);
    if(gate)return gate;
    const result=await read(tabId,'search',params.limit);
    const scope=new URL((await chrome.tabs.get(tabId)).url);
    if(scope.searchParams.get('query')!==params.query || scope.searchParams.get('city')!==params.cityCode)return {state:'search_scope_changed'};
    const jobs=(result.jobs || []).map(({openUrl,...job})=>{
      openUrls.delete(job.url);openUrls.set(job.url,openUrl);
      return job;
    });
    while(openUrls.size>300)openUrls.delete(openUrls.keys().next().value);
    return {...result,query:scope.searchParams.get('query'),cityCode:scope.searchParams.get('city'),jobs};
  }
  const canonical=jobUrl(params.url),url=openUrls.get(canonical) || canonical;
  if(jobUrl(url)!==canonical)throw new Error('Wrong detail URL');
  const {tabId,gate}=await navigate(sessionId,'detail',url);
  if(gate)return gate;
  const result=await read(tabId,'detail');
  if(result.state==='detail' && result.job.url!==canonical)return {state:'detail_identity_changed'};
  return result;
}
async function handle(command,connection) {
  if(busy) {connection.postMessage({type:'response',id:command.id,error:{message:'另一个岗位读取正在进行。'}});return;}
  busy=true;
  try {
    validateCommand(command);
    const result=await execute(command);
    if(port===connection)connection.postMessage({type:'response',id:command.id,result});
  } catch {
    if(port===connection)connection.postMessage({type:'response',id:command.id,error:{message:'岗位页面操作失败，请检查页面是否正常、是否已登录。'}});
  } finally {busy=false;}
}
function connect() {
  if(port)return;
  const connection=chrome.runtime.connectNative(HOST);
  port=connection;
  connection.onMessage.addListener(message=>{
    if(message.type==='ready') {
      ready=true;retries=0;chrome.action.setBadgeText({text:'OK'});
      chrome.action.setTitle({title:'求职已连接，Codex 可以直接搜索'});
    } else if(message.type==='command')handle(message,connection);
  });
  connection.onDisconnect.addListener(()=>{
    const reason=chrome.runtime.lastError;
    if(port!==connection)return;
    port=null;ready=false;chrome.action.setBadgeText({text:'!'});
    if(reason)console.error('本机连接失败:',reason.message);
    chrome.action.setTitle({title:reason ? '求职连接中断，请确认本机通信已安装' : '求职未连接'});
    if(retries++<2)setTimeout(connect,5000);
  });
  connection.postMessage({type:'hello',protocol:1,extensionId:chrome.runtime.id,version:chrome.runtime.getManifest().version});
}
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.action.onClicked.addListener(()=>{if(!ready)connect();});
connect();
