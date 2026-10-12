import {statuses,platformName,options,renderRecords,renderAssessment,renderHistory,element} from './view.js';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token'),profile=params.get('profile') || 'personal';
const state={jobs:[],mode:'list',offset:0,selected:null,busy:false,pendingProgress:null};
const LIMIT=30;
options($('filter-status'),statuses.map(status=>[status,status]));
options($('progress-status'),statuses.map(status=>[status,status]));
const theme=localStorage.getItem('job-panel-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function setTheme(value) {document.documentElement.dataset.theme=value;$('theme').textContent=value==='dark' ? '浅色' : '深色';localStorage.setItem('job-panel-theme',value);}
setTheme(theme);
$('theme').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark' ? 'light' : 'dark'));
function notify(message,error=false,dialog=false) {
  const node=$(dialog ? 'dialog-notice' : 'notice');node.hidden=!message;node.textContent=message;node.classList.toggle('error',error);
}
async function api(name,args={}) {
  const response=await fetch(`/api/tools/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({profile,...args})});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.message || '读取失败，请重试');error.code=data.code;throw error;}
  return data;
}
async function run(action,{dialog=false,loading='正在读取…'}={}) {
  if(state.busy)return;state.busy=true;notify(loading,false,dialog);
  const disabled=[...document.querySelectorAll('button')].map(button=>[button,button.disabled]);
  for(const [button] of disabled)if(!['close-dialog','theme'].includes(button.id))button.disabled=true;
  try {await action();}
  catch(error) {notify(error.message || '连接失败，请重试',true,dialog);}
  finally {state.busy=false;for(const [button,wasDisabled] of disabled)button.disabled=wasDisabled;updatePagination();}
}
function updatePagination() {$('previous').disabled=state.busy || state.offset===0;$('next').disabled=state.busy || state.jobs.length<LIMIT;}
function filters() {
  return {limit:LIMIT,offset:state.offset,query:$('filter-query').value.trim(),
    ...($('filter-platform').value ? {platform:$('filter-platform').value} : {}),
    ...($('filter-status').value ? {status:$('filter-status').value} : {}),
    ...($('filter-resume').value ? {resumeId:$('filter-resume').value} : {})};
}
function draw() {
  renderRecords($('records'),state.jobs,state.mode,openJob,{filtered:state.offset>0 || !!($('filter-query').value || $('filter-platform').value || $('filter-status').value)});
  $('record-count').textContent=state.jobs.length ? `显示第 ${state.offset+1}–${state.offset+state.jobs.length} 条记录` : '';
  updatePagination();
}
async function loadJobs() {state.jobs=(await api('list_jobs',filters())).jobs;draw();}
function sourceChanged() {
  const gh=$('source').value==='greenhouse';$('city-field').hidden=gh;$('location-field').hidden=!gh;$('companies').hidden=!gh;
  $('scope').textContent=gh ? '仅搜索已添加公司的公开岗位' : '读取当前页，最多 30 个岗位';
}
$('source').addEventListener('change',sourceChanged);sourceChanged();
async function refresh() {
  const [status]=await Promise.all([api('get_status'),loadJobs()]);
  $('connection').textContent=status.browser.state==='connected' ? '本机资料已连接 · BOSS 扩展可用' : '本机资料已连接 · BOSS 扩展未连接';
  $('boards').value=status.greenhouseBoards.join('\n');
  const selected=$('filter-resume').value;
  $('filter-resume').replaceChildren();options($('filter-resume'),[['','不显示筛选结论'],...status.resumes.map(resume=>[resume.id,resume.label])]);
  if(status.resumes.some(resume=>resume.id===selected))$('filter-resume').value=selected;
  notify('');
}
$('refresh').addEventListener('click',()=>run(refresh));
$('login').addEventListener('click',()=>run(async()=>{await api('open_login');notify('请在普通 Chrome 完成登录');}));
$('boards-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const boards=$('boards').value.split('\n').map(value=>value.trim()).filter(Boolean);
  const saved=await api('set_greenhouse_boards',{boards});$('boards').value=saved.boards.join('\n');notify('目标公司已保存');
});});
$('search-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const platform=$('source').value;
  if(platform==='greenhouse') {
    const boards=$('boards').value.split('\n').map(value=>value.trim()).filter(Boolean);
    await api('set_greenhouse_boards',{boards});
  }
  const result=await api('search_jobs',{platform,query:$('query').value.trim(),cityCode:$('city').value,location:$('location').value.trim(),limit:LIMIT});
  state.offset=0;$('filter-platform').value=platform;$('filter-status').value='';$('filter-query').value='';
  await loadJobs();
  $('search-result').replaceChildren();
  if(result.search.boards)for(const board of result.search.boards) {
    const text=board.state==='failed' ? `${board.board}：${board.message}` : `${board.company}：${board.matched} / ${board.total} 个岗位符合关键词`;
    $('search-result').append(element('p',text,board.state==='failed' ? 'error' : ''));
  }
  if(result.state==='ready')notify(`已保存 ${result.jobs.length} 个岗位`);
  else if(result.state==='empty')notify('本次搜索没有符合条件的岗位');
  else notify(result.message || '读取未完成，请重试',true);
}, {loading:'正在搜索并保存…'});});
$('filter-form').addEventListener('submit',event=>{event.preventDefault();state.offset=0;run(async()=>{await loadJobs();notify('');});});
for(const [id,mode] of [['list-mode','list'],['board-mode','board']])$(id).addEventListener('click',()=>{
  state.mode=mode;$('list-mode').setAttribute('aria-pressed',String(mode==='list'));$('board-mode').setAttribute('aria-pressed',String(mode==='board'));draw();
});
for(const [id,delta] of [['previous',-LIMIT],['next',LIMIT]])$(id).addEventListener('click',()=>run(async()=>{
  state.offset=Math.max(0,state.offset+delta);await loadJobs();notify('');
}));
function localDate(value) {
  if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function showJob(job,events) {
  state.selected=job;$('job-title').textContent=job.title;
  $('job-meta').textContent=[job.company,job.location,job.salary || '薪资待核实',platformName(job.platform)].filter(Boolean).join(' · ');
  $('job-link').href=job.applyUrl || job.url;$('job-description').textContent=job.description || '尚未读取完整正文，请点击读详情';
  const latest=events.at(-1);$('progress-status').value=job.status;$('progress-note').value=latest?.note || '';$('follow-up').value=localDate(latest?.follow_up_at);
  renderHistory($('history'),events);renderAssessment($('assessment'),state.jobs.find(value=>value.id===job.id)?.assessment);
}
function openJob(job) {run(async()=>{
  const saved=await api('get_saved_job',{jobId:job.id});showJob(saved.job,saved.events);state.pendingProgress=null;
  notify('');notify('',false,true);$('job-dialog').showModal();
});}
$('close-dialog').addEventListener('click',()=>$('job-dialog').close());
$('detail-refresh').addEventListener('click',()=>run(async()=>{
  const selected=state.selected.id,result=await api('get_job_detail',{jobId:selected});
  if(result.state!=='detail'){notify(result.message || '完整详情未读取',true,true);return;}
  await loadJobs();const saved=await api('get_saved_job',{jobId:selected});showJob(saved.job,saved.events);notify('完整详情已更新',false,true);
},{dialog:true,loading:'正在读取完整详情…'}));
async function saveProgress(input) {
  const payload={jobId:state.selected.id,...input},fingerprint=JSON.stringify(payload);
  if(state.pendingProgress?.fingerprint!==fingerprint)state.pendingProgress={fingerprint,requestId:crypto.randomUUID()};
  await api('update_progress',{...payload,requestId:state.pendingProgress.requestId});state.pendingProgress=null;
  await loadJobs();const saved=await api('get_saved_job',{jobId:payload.jobId});showJob(saved.job,saved.events);notify('进度已保存',false,true);
}
$('favorite').addEventListener('click',()=>run(()=>saveProgress({status:'收藏',note:$('progress-note').value,
  followUpAt:$('follow-up').value ? new Date($('follow-up').value).toISOString() : null}),{dialog:true,loading:'正在保存进度…'}));
$('progress-form').addEventListener('submit',event=>{event.preventDefault();run(()=>saveProgress({
  status:$('progress-status').value,note:$('progress-note').value,
  followUpAt:$('follow-up').value ? new Date($('follow-up').value).toISOString() : null,
}),{dialog:true,loading:'正在保存进度…'});});
if(token)run(refresh);else {
  notify('请从 Codex 重新打开面板',true);$('connection').textContent='面板访问链接已失效';
  for(const button of document.querySelectorAll('button'))if(button.id!=='theme')button.disabled=true;
}
