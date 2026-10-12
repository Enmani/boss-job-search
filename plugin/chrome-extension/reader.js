// This function is serialized by chrome.scripting; all dependencies stay inside it.
export async function readJobDocument(mode,limit=15) {
  const visible = element => element && element.getClientRects().length > 0;
  const text = element => visible(element) ? (element.innerText || '').trim() : '';
  const first = (root, selectors) => {
    for (const selector of selectors) {
      const element = [...root.querySelectorAll(selector)].find(visible);
      if (element && text(element)) return text(element);
    }
    return '';
  };
  const cleanSalary = value => /[\uE000-\uF8FF]/u.test(value) ? '' : value;
  const experiencePattern = /^(?:\d+(?:[-–]\d+)?年(?:以上|以内)?|经验不限|应届生)$/;
  const degreePattern = /^(?:学历不限|初中及以下|初中|高中|中专|中技|大专|本科|硕士|博士)$/;
  const cardFields = card => {
    const rawText = text(card).slice(0,5000);
    const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
    const degreeIndex = lines.findIndex(line => degreePattern.test(line));
    // The exported live cards have title, salary, requirements, company, location.
    // Use positions only when the observed requirements and two final fields agree.
    const knownLayout = degreeIndex > 1 && lines.length === degreeIndex + 3;
    const salaryLine = knownLayout && /[\uE000-\uF8FF]|^(?:\d+.*(?:K|元\/|万)|面议)/i.test(lines[1]) ? lines[1] : '';
    const salaryText = first(card, ['.salary', '.salary-text', '.job-salary']) || salaryLine;
    return {
      company:first(card, ['.company-name', '.brand-name']) || (knownLayout ? lines[degreeIndex+1] : ''),
      location:first(card, ['.job-area', '.job-area-wrapper']) || (knownLayout ? lines[degreeIndex+2] : ''),
      experience:knownLayout ? lines.slice(2,degreeIndex).find(line => experiencePattern.test(line)) || '' : '',
      degree:knownLayout ? lines[degreeIndex] : '',
      salary:cleanSalary(salaryText),
      salaryFontEncoded:/[\uE000-\uF8FF]/u.test(salaryText || rawText),rawText,
    };
  };
  const normalizeUrl = href => {
    const url = new URL(href, location.href);
    if (url.origin !== 'https://www.zhipin.com' ||
        !/^\/job_detail\/[a-zA-Z0-9_-]+\.html$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  };
  const deadline = Date.now() + 15000;
  do {
    if (location.origin !== 'https://www.zhipin.com') return {state:'outside_boss'};
    const body = document.body?.innerText || '';
    if (/安全验证|访问异常|访问受限|拖动滑块|请完成验证|请求过于频繁/.test(body)) {
      return {state:'verification_required'};
    }
    if (/^\/web\/user\//.test(location.pathname)) return {state:'login_required'};
    if (mode === 'search') {
      const root = document.querySelector('.rec-job-list, .job-list-container');
      const links = root ? [...root.querySelectorAll('a[href*="/job_detail/"]')].filter(visible) : [];
      const jobs = [];
      for (const link of links) {
        const url = normalizeUrl(link.href);
        const card = link.closest('li') || link.closest('.job-card-wrapper, .job-card-box') || link.parentElement;
        const title = first(card, ['.job-name', '.job-title', 'h3']) || text(link).split('\n')[0];
        if (!url || !title || jobs.some(job => job.url === url)) continue;
        jobs.push({url,title,...cardFields(card),description:'',source:'boss_search',openUrl:link.href});
      }
      if (jobs.length) return {state:'ready', query:new URL(location.href).searchParams.get('query'),
        cityCode:new URL(location.href).searchParams.get('city'), jobs:jobs.slice(0,limit)};
      if (/暂无相关职位|没有找到相关职位|未找到相关职位|暂无符合条件的职位/.test(body)) {
        return {state:'empty',jobs:[]};
      }
    } else if (mode === 'detail') {
      if (/登录查看完整内容|登录后查看|登录后可查看/.test(body)) return {state:'login_required'};
      if (/该职位已停止招聘|职位已关闭|职位已下线/.test(body)) return {state:'job_closed'};
      const description = first(document, ['.job-sec-text', '.job-detail .text', '.job-detail-section .job-description']);
      const title = first(document, ['.job-banner .name h1', '.job-banner h1', 'h1']);
      if (description && title) {
        const salaryText = first(document, ['.job-banner .salary']);
        const locationText = first(document, ['.job-location .location-address', '.job-banner .text-city']);
        const company = first(document, ['.sider-company .company-info a', '.company-info .company-name', '.company-name'])
          .replace(/^公司名称\s*/, '');
        const bannerText = first(document,['.job-banner']);
        const experience = first(document,['.job-banner .text-experience', '.job-banner .text-exp']) ||
          bannerText.split(/[\s·|]+/).find(value => experiencePattern.test(value)) || '';
        const degree = first(document,['.job-banner .text-degree']) ||
          bannerText.split(/[\s·|]+/).find(value => degreePattern.test(value)) || '';
        // Headhunter pages label the client in the banner instead of the company sidebar.
        // Strip only the exact visible city/requirements suffix observed on that line.
        const clientLine = bannerText.split('\n').find(line => line.startsWith('客户公司：')) || '';
        const metadataSuffix = `${locationText} ${experience} ${degree}`;
        const clientCompany = locationText && experience && degree && clientLine.endsWith(metadataSuffix)
          ? clientLine.slice('客户公司：'.length,-metadataSuffix.length).trim() : '';
        return {state:'detail',job:{url:normalizeUrl(location.href),title,company:company || clientCompany,
          location:locationText, salary:cleanSalary(salaryText),
          salaryFontEncoded:!!salaryText && !cleanSalary(salaryText),
          experience,degree,description,
          rawText:[bannerText,company,locationText,description].filter(Boolean).join('\n'),source:'boss_detail'}};
      }
    }
    await new Promise(resolve => setTimeout(resolve,250));
  } while (Date.now() < deadline);
  return {state:'layout_unrecognized',diagnostics:{path:location.pathname,title:document.title,readyState:document.readyState}};
}
