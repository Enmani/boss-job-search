export const post={id:123,title:'Product Manager',location:{name:'London, UK'},
  absolute_url:'https://job-boards.greenhouse.io/sampleco/jobs/123?utm_source=fixture',
  content:'&lt;h2&gt;Product team&lt;/h2&gt;&lt;p&gt;Build useful AI products.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Three years of product experience.&lt;/li&gt;&lt;/ul&gt;'};
export function greenhouseFetch(url) {
  const path=new URL(url).pathname;
  if(!path.startsWith('/v1/boards/sampleco'))return Promise.resolve(new Response('{}',{status:404,headers:{'Content-Type':'application/json'}}));
  const payload=path.endsWith('/jobs/123') ? {...post,pay_input_ranges:[{min_cents:10000000,max_cents:14000000,currency_type:'USD',title:'Annual Salary'}]}
    : path.endsWith('/jobs') ? {jobs:[post,{...post,id:124,title:'Software Engineer',location:{name:'Berlin, Germany'},absolute_url:'https://job-boards.greenhouse.io/sampleco/jobs/124',content:'<p>Write reliable software.</p>'}]}
    : {name:'样例科技'};
  return Promise.resolve(Response.json(payload));
}
export const disconnectedBoss={async status(){return {state:'extension_unavailable'};},async close(){return {state:'closed'};}};
