import {parseDocument} from 'htmlparser2';
import {findAll,getInnerHTML,textContent} from 'domutils';
import {knownJobIdentity,jobSchema,normalizeText,TaskError} from './domain.mjs';
import {descriptionText} from './job-text.mjs';

const classIs=(node,name)=>(node.attribs?.class || '').split(/\s+/).includes(name);
const first=(root,predicate)=>findAll(predicate,root)[0];
const byClass=(root,name)=>first(root,node=>classIs(node,name));
const text=node=>node ? normalizeText(textContent(node)) : '';
const invalid=message=>new TaskError('LINKEDIN_LAYOUT_UNRECOGNIZED',message);
function documentFor(html) {
  const root=parseDocument(html),title=text(first(root,node=>node.name==='title'));
  if(/^(?:Sign In|Login|LinkedIn Login|登录|登入)(?:\s|\||$)/i.test(title))throw new TaskError('LINKEDIN_LOGIN_REQUIRED','LinkedIn 要求本人登录。');
  if(first(root,node=>node.name==='form' && /\/(?:checkpoint|challenge)\b/.test(node.attribs?.action || '')))
    throw new TaskError('LINKEDIN_VERIFICATION_REQUIRED','LinkedIn 要求本人完成验证。');
  return root;
}
function identityFrom(value) {
  const job=knownJobIdentity(value);
  return job?.platform==='linkedin' ? job : null;
}
export function linkedinSearchUrl({query,location='',offset=0}) {
  const url=new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
  url.search=new URLSearchParams({keywords:query,location,start:String(offset)});
  return url.href;
}
export function parseLinkedInSearch(html,{query,location='',offset=0,limit=15}) {
  const root=documentFor(html),cards=findAll(node=>classIs(node,'base-search-card'),root),jobs=[],seen=new Set();let consumed=0;
  if(!cards.length) {
    const empty=byClass(root,'jobs-search-no-results-banner') || byClass(root,'no-results');
    if(!empty)throw invalid('未识别到 LinkedIn 岗位卡片或明确的无结果提示。');
    return {state:'empty',jobs:[],returned:0,nextOffset:null,searchUrl:linkedinSearchUrl({query,location,offset}),coverage:'访客页面明确显示无结果'};
  }
  for(const card of cards) {
    consumed++;
    const anchor=first(card,node=>node.name==='a' && classIs(node,'base-card__full-link'));
    const identity=identityFrom(anchor?.attribs?.href || '');
    const urn=card.attribs?.['data-entity-urn'];
    if(!identity || (urn && urn!==`urn:li:jobPosting:${identity.platformJobId}`))throw invalid('LinkedIn 卡片链接与岗位编号不一致。');
    const title=text(byClass(card,'base-search-card__title')),company=text(byClass(card,'base-search-card__subtitle')),location=text(byClass(card,'job-search-card__location'));
    if(!title || !company || !location)throw invalid('LinkedIn 卡片缺少名称、公司或地点。');
    if(!seen.has(identity.platformJobId)) {
      seen.add(identity.platformJobId);
      jobs.push(jobSchema.parse({...identity,title,company,location,rawText:[title,company,location].join('\n'),source:'linkedin_search'}));
    }
    if(jobs.length===limit)break;
  }
  const nextOffset=offset+consumed;
  return {state:'ready',jobs,returned:jobs.length,nextOffset:nextOffset<=1000 ? nextOffset : null,
    searchUrl:linkedinSearchUrl({query,location,offset}),coverage:'LinkedIn 访客搜索的一页列表；正文需另读，可能受限流或登录影响'};
}
export function parseLinkedInDetail(html,expectedId) {
  const root=documentFor(html);
  const identifiers=findAll(node=>(node.name==='link' && (node.attribs?.rel || '').split(/\s+/).includes('canonical')) ||
    (node.name==='meta' && node.attribs?.property==='og:url'),root)
    .map(node=>identityFrom(node.attribs.href || node.attribs.content || '')).filter(Boolean);
  if(!identifiers.length)throw new TaskError('DETAIL_IDENTITY_UNCONFIRMED','LinkedIn 详情没有可核对的主岗位链接。');
  if(identifiers.some(identity=>identity.platformJobId!==expectedId))throw new TaskError('DETAIL_IDENTITY_INVALID','返回的 LinkedIn 详情与所选岗位不同。');
  const title=text(byClass(root,'top-card-layout__title')),company=text(byClass(root,'topcard__org-name-link')),
    location=text(byClass(root,'topcard__flavor--bullet')),markup=byClass(root,'show-more-less-html__markup');
  const description=markup ? descriptionText(getInnerHTML(markup)) : '';
  if(!description || !title || !company || !location)throw invalid('LinkedIn 完整正文或主要字段尚未读取。');
  if(/sign in to (?:view|see|read) (?:the )?(?:full|complete)|登录.{0,8}(?:完整|全部)/i.test(description))
    throw new TaskError('LINKEDIN_LOGIN_REQUIRED','LinkedIn 正文被登录要求遮挡。');
  const salary=text(byClass(root,'compensation__salary')).slice(0,200);
  return jobSchema.parse({...identifiers[0],title,company,location,salary,description,
    rawText:[title,company,location,salary,description].filter(Boolean).join('\n'),source:'linkedin_detail'});
}
