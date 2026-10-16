export const statuses=['待筛选','收藏','准备投递','已沟通','已投递','面试','Offer','拒绝','撤回'];
export const platformName=value=>({boss:'BOSS 直聘',greenhouse:'Greenhouse',ashby:'Ashby',lever:'Lever',linkedin:'LinkedIn',manual:'通用导入'})[value] || value;
export function element(tag,text,className) {
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;
}
export function options(select,values) {
  for(const [value,label] of values) {const option=element('option',label);option.value=value;select.append(option);}
}
export function jobCard(job,open) {
  const card=element('article',undefined,'job-card');
  card.append(element('h3',job.title),element('p',job.company || '公司未公开'),element('p',job.location || '地点待核实','muted'),
    element('p',job.salary || '薪资待核实','muted'));
  const meta=element('p');meta.append(element('span',platformName(job.platform),'tag'),element('span',job.status,'tag'));card.append(meta);
  if(job.assessment)card.append(element('p',`${job.assessment.decision}${job.assessment.stale ? ' · 需重新筛选' : ''}`,'muted'));
  if(job.ranking) {
    card.append(element('p',`${job.ranking.group} · ${job.ranking.assessmentState}`,'ranking-result'));
    for(const hint of job.ranking.hints)card.append(element('p',`${hint.field}：${hint.reason}`,'muted'));
  }
  const button=element('button','查看');button.type='button';button.addEventListener('click',()=>open(job));card.append(button);return card;
}
export function renderRecords(container,jobs,mode,open,{filtered=false}={}) {
  container.replaceChildren();
  if(!jobs.length) {
    const empty=element('div',undefined,'empty');empty.append(element('p',filtered ? '没有符合条件的记录' : '还没有岗位记录'),
      element('p',filtered ? '调整筛选条件后重试' : '先搜索并保存岗位'));
    const button=element('button',filtered ? '调整筛选' : '搜索');button.type='button';
    button.addEventListener('click',()=>document.getElementById(filtered ? 'filter-query' : 'query').focus());empty.append(button);container.append(empty);return;
  }
  if(mode==='board') {
    const board=element('div',undefined,'kanban');
    for(const status of statuses) {
      const group=jobs.filter(job=>job.status===status);if(!group.length)continue;
      const column=element('section',undefined,'kanban-column');column.append(element('h3',`${status} · ${group.length}`));
      group.forEach(job=>column.append(jobCard(job,open)));board.append(column);
    }
    container.append(board);
  } else {
    const list=element('div',undefined,'job-list');jobs.forEach(job=>list.append(jobCard(job,open)));container.append(list);
  }
}
export function renderAssessment(container,assessment) {
  container.replaceChildren();if(!assessment)return;
  const block=element('section',undefined,'assessment');block.append(element('h3',assessment.decision+(assessment.stale ? ' · 需重新筛选' : '')),
    element('p',assessment.summary));
  for(const [label,items] of [['匹配依据',assessment.matches],['经验缺口',assessment.gaps]]) {
    if(!items.length)continue;block.append(element('h3',label));const list=element('ul');
    for(const item of items)list.append(element('li',`${item.requirement}\n岗位：${item.jobQuote}${item.resumeQuote ? '\n简历：'+item.resumeQuote : ''}`));block.append(list);
  }
  if(assessment.questions.length){block.append(element('h3','待核实'));const list=element('ul');assessment.questions.forEach(question=>list.append(element('li',question)));block.append(list);}
  container.append(block);
}
export function renderHistory(container,events) {
  container.replaceChildren();
  if(!events.length){container.append(element('li','尚未记录进度','muted'));return;}
  for(const event of [...events].reverse()) {
    const item=element('li');item.append(element('p',`${event.status} · ${new Date(event.created_at).toLocaleString('zh-CN')}`),element('p',event.note || '无备注','muted'));
    if(event.follow_up_at)item.append(element('p','跟进：'+new Date(event.follow_up_at).toLocaleString('zh-CN'),'muted'));container.append(item);
  }
}
