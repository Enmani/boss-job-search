import {statuses,platformName,options,renderRecords,renderAssessment,renderHistory,element} from './view.js';
import {api,hasAccess} from './client.js';
import {setupImport} from './import.js';

const $=id=>document.getElementById(id);
const state={jobs:[],mode:'list',offset:0,selected:null,busy:false,pendingProgress:null,ranked:false,hasMore:false,nextSearch:null};
const LIMIT=30;
options($('filter-status'),statuses.map(status=>[status,status]));
options($('progress-status'),statuses.map(status=>[status,status]));
function notify(message,error=false,dialog=false) {
  const node=$(dialog ? 'dialog-notice' : 'notice');node.hidden=!message;node.textContent=message;node.classList.toggle('error',error);
}
async function run(action,{dialog=false,loading='正在读取…'}={}) {
  if(state.busy)return;state.busy=true;notify(loading,false,dialog);
  const disabled=[...document.querySelectorAll('button')].map(button=>[button,button.disabled]);
  for(const [button] of disabled)if(!['close-dialog','import-close'].includes(button.id))button.disabled=true;
  try {await action();}
  catch(error) {notify(error.message || '连接失败，请重试',true,dialog);}
  finally {state.busy=false;for(const [button,wasDisabled] of disabled)button.disabled=wasDisabled;updatePagination();updateSearchNext();}
}
function updateSearchNext() {$('search-next').hidden=!state.nextSearch;$('search-next').disabled=state.busy || !state.nextSearch;}
function updatePagination() {$('previous').disabled=state.busy || state.offset===0;$('next').disabled=state.busy || (state.ranked ? !state.hasMore : state.jobs.length<LIMIT);}
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
async function loadJobs() {
  const result=await api(state.ranked ? 'rank_jobs' : 'list_jobs',filters());state.jobs=result.jobs;state.hasMore=result.hasMore;
  $('ranking-scope').hidden=!state.ranked;
  if(state.ranked)$('ranking-scope').textContent=`按条件与 Codex 已存结论排序 · ${result.coverage}`;
  draw();
}
function sourceChanged() {
  const publicApi=$('source').value!=='boss';$('city-field').hidden=publicApi;$('location-field').hidden=!publicApi;
  $('scope').textContent=$('source').value==='linkedin' ? '访客列表实验接入，可能限流' : publicApi ? '仅搜索设置中添加的公司' : '读取当前页，最多 30 个岗位';
  state.nextSearch=null;updateSearchNext();
}
$('source').addEventListener('change',sourceChanged);sourceChanged();
for(const id of ['query','location'])$(id).addEventListener('input',()=>{state.nextSearch=null;updateSearchNext();});
async function refresh() {
  const status=await api('get_status');
  $('connection').textContent='本机求职资料已连接';
  const selected=$('filter-resume').value;
  $('filter-resume').replaceChildren();options($('filter-resume'),[['',status.preferences.defaultResumeId ? '使用默认简历' : '不显示筛选结论'],...status.resumes.map(resume=>[resume.id,resume.label])]);
  const resumeId=selected || status.preferences.defaultResumeId;
  if(status.resumes.some(resume=>resume.id===resumeId))$('filter-resume').value=resumeId;
  await loadJobs();
  notify('');
}
$('refresh').addEventListener('click',()=>run(refresh));
async function searchPage(scope) {
  state.nextSearch=null;updateSearchNext();
  const result=await api('search_jobs',scope),platform=scope.platform;
  if(platform==='linkedin' && result.state==='ready' && result.search.nextOffset!=null &&
    $('source').value===platform && $('query').value.trim()===scope.query && $('location').value.trim()===scope.location)
    state.nextSearch={...scope,pageOffset:result.search.nextOffset};
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
}
$('search-form').addEventListener('submit',event=>{event.preventDefault();run(()=>searchPage({platform:$('source').value,query:$('query').value.trim(),
  cityCode:$('city').value,location:$('location').value.trim(),limit:LIMIT}),{loading:'正在搜索并保存…'});});
$('search-next').addEventListener('click',()=>{if(state.nextSearch)run(()=>searchPage(state.nextSearch),{loading:'正在读取下一批…'});});
$('filter-form').addEventListener('submit',event=>{event.preventDefault();state.offset=0;run(async()=>{await loadJobs();notify('');});});
$('rank').addEventListener('click',()=>run(async()=>{
  state.ranked=!state.ranked;state.offset=0;$('rank').setAttribute('aria-pressed',String(state.ranked));await loadJobs();notify('');
}));
setupImport(async()=>{state.offset=0;$('filter-platform').value='';$('filter-status').value='';$('filter-query').value='';await loadJobs();notify('岗位已导入');});
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
  $('detail-refresh').hidden=job.platform==='manual';
  if(job.source==='manual_import')$('job-meta').textContent+=' · 用户提供的正文';
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
if(hasAccess)run(refresh);else {
  notify('请从 Codex 重新打开面板',true);$('connection').textContent='面板访问链接已失效';
  for(const button of document.querySelectorAll('button'))button.disabled=true;
}
