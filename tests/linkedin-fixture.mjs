// Synthetic HTML based on the documented public class names, not a live LinkedIn capture.
export const linkedCard=(id='4200000001',title='AI Product Manager')=>`<li><div class="base-card base-search-card" data-entity-urn="urn:li:jobPosting:${id}">
<a class="base-card__full-link" href="https://it.linkedin.com/jobs/view/ai-product-${id}?trackingId=sample"><span>${title}</span></a>
<h3 class="base-search-card__title">${title}</h3><h4 class="base-search-card__subtitle">Sample Company</h4><span class="job-search-card__location">Milan, Italy</span></div></li>`;
export const linkedDetail=(id='4200000001')=>`<!doctype html><html><head><link rel="canonical" href="https://www.linkedin.com/jobs/view/ai-product-${id}"></head>
<body><h1 class="top-card-layout__title">AI Product Manager</h1><a class="topcard__org-name-link">Sample Company</a><span class="topcard__flavor--bullet">Milan, Italy</span>
<div class="compensation__salary">EUR 60,000–80,000/year</div><div class="show-more-less-html__markup"><p>Build AI products with Python.</p><h3>Requirements</h3><ul><li>Product discovery experience.</li></ul></div></body></html>`;
export function linkedFetch(url) {
  const parsed=new URL(url);
  return Promise.resolve(new Response(parsed.pathname.includes('seeMoreJobPostings') ? linkedCard(String(4200000001+Number(parsed.searchParams.get('start') || 0))) : linkedDetail(parsed.pathname.split('/').filter(Boolean).at(-1)),{headers:{'Content-Type':'text/html; charset=utf-8'}}));
}
