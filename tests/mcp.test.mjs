import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

async function connect(root) {
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('plugin/src/server.mjs')],env:{...process.env,BOSS_DATA_DIR:root},stderr:'pipe'});
  const client=new Client({name:'boss-integration-test',version:'1.0.0'});await client.connect(transport);return client;
}
async function call(client,name,args) {
  const result=await client.callTool({name,arguments:args});
  if(result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}
test('real stdio MCP: imports, screening evidence, progress, restart, isolation',async () => {
  const root=mkdtempSync(join(tmpdir(),'boss-mcp-')); const path=join(root,'resume.md');
  writeFileSync(path,'我在建筑研究中使用 Rhino 和 Grasshopper 进行计算设计，持有建筑学硕士，现居德国。软件工程任职经历尚不足两年。');
  let client;
  try {
    client=await connect(root); const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='search_jobs'));
    const {resume}=await call(client,'import_resume',{path,label:'计算设计'});
    const {jobs,search}=await call(client,'import_visible_jobs',{observedQuery:'计算设计',jobs:[{url:'https://www.zhipin.com/job_detail/fixture_job.html',title:'计算设计师',rawText:'需要 Rhino 和 Grasshopper。办公地点上海。',description:'需要 Rhino 和 Grasshopper。办公地点上海。',source:'browser_import'}]});
    assert.equal(search.state,'imported_visible_page');
    const context=await call(client,'screening_context',{resumeId:resume.id,jobIds:[jobs[0].id]});assert.match(context.resume.text,/不足两年/);
    await call(client,'save_assessment',{jobId:jobs[0].id,resumeId:resume.id,jobRevision:jobs[0].revision,assessment:{decision:'待核实',summary:'相关工具经验有依据，办公范围待核实。',matches:[{requirement:'计算设计工具',jobQuote:'需要 Rhino 和 Grasshopper。',resumeQuote:'我在建筑研究中使用 Rhino 和 Grasshopper 进行计算设计'}],gaps:[],questions:['是否接受常驻德国长期远程？']}});
    const progress={jobId:jobs[0].id,status:'收藏',note:'待确认远程',requestId:randomUUID()};
    await Promise.all([call(client,'update_progress',progress),call(client,'update_progress',progress)]);
    assert.equal((await call(client,'get_progress_history',{jobId:jobs[0].id})).events.length,1);
    await client.close();client=await connect(root);
    const saved=await call(client,'list_jobs',{resumeId:resume.id});assert.equal(saved.jobs[0].status,'收藏');assert.equal(saved.jobs[0].assessment.decision,'待核实');
    assert.equal((await call(client,'list_jobs',{profile:'other'})).jobs.length,0);
    const invalid=await client.callTool({name:'get_status',arguments:{profile:'../personal'}});assert.ok(invalid.isError);
  } finally {if(client) await client.close();rmSync(root,{recursive:true,force:true});}
});
