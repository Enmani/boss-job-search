import {api,hasAccess,setTheme} from './client.js';
import {element,options,platformName} from './view.js';
const $=id=>document.getElementById(id);
let busy=false;
function notify(message,error=false) {const node=$('notice');node.hidden=!message;node.textContent=message;node.classList.toggle('error',error);}
async function run(action) {
  if(busy)return;busy=true;notify('正在处理…');
  const buttons=[...document.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
  try{await action();}catch(error){notify(error.message,true);}finally{busy=false;buttons.forEach(button=>button.disabled=false);}
}
function button(text,action) {const node=element('button',text);node.type='button';node.addEventListener('click',()=>run(action));return node;}
function statusLabel(state) {return ({connected:'已连接',ready:'检测通过',detail:'读取成功',empty:'检测通过',partial:'部分失败',failed:'读取失败',not_configured:'未添加公司',
  busy:'读取中',not_checked:'未检测',rate_limited:'限流中',login_required:'需登录',verification_required:'需验证'})[state] || '未连接';}
function renderPlatforms(status) {
  const container=$('platforms');container.replaceChildren();
  const boss=element('article',undefined,'platform-card');boss.dataset.platform='boss';
  boss.append(element('h3','BOSS 直聘'),element('p',statusLabel(status.browser.state),'platform-status'),element('p','使用普通 Chrome 的登录状态','muted'));
  const actions=element('div',undefined,'job-actions');
  actions.append(button('连接',async()=>{await api('open_login');notify('请在普通 Chrome 完成登录');}),
    button('检测',async()=>{const result=await api('check_platform',{platform:'boss'});await refresh(false);notify(statusLabel(result.state));}));
  boss.append(actions);container.append(boss);
  const linked=element('article',undefined,'platform-card');linked.dataset.platform='linkedin';
  linked.append(element('h3','LinkedIn'),element('p',statusLabel(status.linkedin.state),'platform-status'),element('p','公开页面实验接入','muted'));
  if(status.linkedin.lastCheck)linked.append(element('p',new Date(status.linkedin.lastCheck.checkedAt).toLocaleString('zh-CN'),'muted'));
  if(status.linkedin.retryAt)linked.append(element('p','可重试：'+new Date(status.linkedin.retryAt).toLocaleString('zh-CN'),'muted'));
  const linkedActions=element('div',undefined,'job-actions'),open=element('a','打开原站','button');
  open.href='https://www.linkedin.com/jobs/';open.target='_blank';open.rel='noopener noreferrer';
  linkedActions.append(open,button('检测',async()=>{
    const result=await api('check_platform',{platform:'linkedin'});await refresh(false);notify(result.message || statusLabel(result.state),!['ready','empty'].includes(result.state));
  }));linked.append(linkedActions,element('p','遇到登录或验证时由本人处理','muted'));container.append(linked);
  for(const config of status.platforms) {
    const {platform,boards,lastCheck}=config,card=element('article',undefined,'platform-card');card.dataset.platform=platform;
    card.append(element('h3',platformName(platform)),element('p',lastCheck ? statusLabel(lastCheck.state) : boards.length ? '已配置' : '未添加公司','platform-status'));
    if(lastCheck)card.append(element('p',new Date(lastCheck.checkedAt).toLocaleString('zh-CN'),'muted'));
    const form=element('form'),label=element('label','目标公司'),input=element('textarea');input.rows=4;input.value=boards.join('\n');input.maxLength=5000;
    input.setAttribute('aria-label',`${platformName(platform)} 目标公司`);
    input.placeholder=({greenhouse:'https://job-boards.greenhouse.io/anthropic',ashby:'https://jobs.ashbyhq.com/openai',lever:'https://jobs.lever.co/spotify'})[platform];
    label.append(input);form.append(label,element('p','每行一家公司，最多十家','muted'));
    if(platform==='lever')form.append(element('p','欧洲站请填写完整招聘页链接','muted'));
    const row=element('div',undefined,'job-actions'),save=element('button','保存');save.type='submit';
    row.append(save,button('检测',async()=>{
      const result=await api('check_platform',{platform});await refresh(false);
      notify(result.boards?.some(board=>board.state==='failed') ? result.boards.filter(board=>board.state==='failed').map(board=>`${board.board}：${board.message}`).join('；') : statusLabel(result.state),result.state==='failed');
    }));form.append(row,element('p','检测使用已保存的公司','muted'));
    form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
      await api('set_platform_boards',{platform,boards:input.value.split('\n').map(value=>value.trim()).filter(Boolean)});
      await refresh(false);notify('目标公司已保存');
    });});card.append(form);container.append(card);
  }
}
async function refresh(preferences=true) {
  const status=await api('get_status');renderPlatforms(status);
  if(!preferences)return;
  const p=status.preferences,minimum=p.minimumSalary ?? (p.minMonthlySalaryCny!=null ? {amount:p.minMonthlySalaryCny,currency:'CNY',period:'month'} : null);
  $('target-roles').value=p.targetRoles.join('，');$('cities').value=p.cities.join('，');
  $('default-resume').replaceChildren();options($('default-resume'),[['','暂不选择'],...status.resumes.map(resume=>[resume.id,resume.label])]);$('default-resume').value=p.defaultResumeId || '';
  $('minimum-salary').value=minimum?.amount ?? '';
  if(minimum){if(![...$('salary-currency').options].some(option=>option.value===minimum.currency))options($('salary-currency'),[[minimum.currency,minimum.currency]]);$('salary-currency').value=minimum.currency;$('salary-period').value=minimum.period;}
  $('max-experience').value=p.maxExperienceYears ?? '';$('location-requirement').value=p.locationRequirement;$('preference-notes').value=p.notes;notify('');
}
$('preferences-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const split=value=>value.split(/[,，\n]/).map(word=>word.trim()).filter(Boolean);
  const minimum=$('minimum-salary').value!=='' ? {amount:Number($('minimum-salary').value),currency:$('salary-currency').value,period:$('salary-period').value} : null;
  await api('set_preferences',{preferences:{targetRoles:split($('target-roles').value),cities:split($('cities').value),
    minimumSalary:minimum,minMonthlySalaryCny:minimum?.currency==='CNY' && minimum.period==='month' && Number.isInteger(minimum.amount) ? minimum.amount : null,
    maxExperienceYears:$('max-experience').value!=='' ? Number($('max-experience').value) : null,defaultResumeId:$('default-resume').value || null,
    locationRequirement:$('location-requirement').value,notes:$('preference-notes').value}});notify('求职条件已保存');
});});
$('refresh').addEventListener('click',()=>run(refresh));$('theme-select').value=document.documentElement.dataset.theme;
$('theme-select').addEventListener('change',()=>setTheme($('theme-select').value));
if(hasAccess)run(refresh);else {notify('请从 Codex 重新打开面板',true);document.querySelectorAll('button').forEach(button=>button.disabled=true);}
