export const ids=['12345678-1234-4234-8234-123456789001','12345678-1234-4234-8234-123456789002'];
export const ashbyPost=(id=ids[0])=>({title:'AI Product Manager',location:'London',jobUrl:`https://jobs.ashbyhq.com/sample/${id}`,
  applyUrl:`https://jobs.ashbyhq.com/sample/${id}/application`,descriptionPlain:'Build AI products. Three years of experience.',isListed:true,isRemote:null,workplaceType:null,secondaryLocations:[{location:'Paris'}],
  compensation:{summaryComponents:[{compensationType:'Salary',currencyCode:'GBP',minValue:80000,maxValue:100000,interval:'1 YEAR'},
    {compensationType:'EquityCashValue',currencyCode:'GBP',minValue:null,maxValue:null,interval:'1 YEAR'}]}});
export const leverPost=(id=ids[0],eu=false)=>({id,text:'AI Product Manager',categories:{location:'London',allLocations:['London','Stockholm']},
  hostedUrl:`https://jobs.${eu?'eu.':''}lever.co/sample/${id}`,applyUrl:`https://jobs.${eu?'eu.':''}lever.co/sample/${id}/apply`,
  descriptionPlain:'Build AI products.',lists:[{text:'Requirements',content:'<p>Three years of experience.</p>'}],additionalPlain:'Closing benefits.',
  salaryRange:{currency:'GBP',interval:'yearly',min:80000,max:100000}});
export async function atsFetch(input) {
  const url=new URL(input);
  if(url.pathname.includes('/missing'))return Response.json({error:'missing'},{status:404});
  if(url.hostname==='api.ashbyhq.com')return Response.json({jobs:[ashbyPost(),{...ashbyPost(ids[1]),isListed:false}]});
  if(url.hostname==='api.lever.co' || url.hostname==='api.eu.lever.co') {
    const id=url.pathname.split('/')[4],post=leverPost(id || ids[0],url.hostname==='api.eu.lever.co');
    return Response.json(id ? post : [post]);
  }
  throw new Error('Unexpected fetch');
}
