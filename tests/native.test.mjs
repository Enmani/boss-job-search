import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Client } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { FrameReader,encodeFrame,MAX_FRAME } from '../plugin/src/framing.mjs';
import { BossBrowser } from '../plugin/src/browser.mjs';
import { allowedCaller } from '../plugin/src/bridge-config.mjs';
import { nativeFixture,job } from './native-fixture.mjs';

test('native caller is an extension origin, independent of the optional URL root slash',()=>{
  const id='a'.repeat(32);
  assert.equal(allowedCaller('chrome-extension://'+id,id),true);
  assert.equal(allowedCaller('chrome-extension://'+id+'/',id),true);
  for(const url of ['https://'+id,'chrome-extension://'+id+'.example/','chrome-extension://'+id+'/page.html',
    'chrome-extension://other/','chrome-extension://user@'+id+'/','chrome-extension://'+id+'/?other=1']) {
    assert.equal(allowedCaller(url,id),false);
  }
});

test('native framing accepts split UTF8 frames and rejects oversized or malformed data',()=>{
  const input=Buffer.concat([encodeFrame({text:'中文'}),encodeFrame({id:2})]),decoder=new FrameReader(),result=[];
  for(const byte of input)result.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(result,[{text:'中文'},{id:2}]);
  const large=Buffer.alloc(4);large.writeUInt32LE(MAX_FRAME+1);
  assert.throws(()=>new FrameReader().push(large));
  assert.throws(()=>new FrameReader().push(Buffer.from([1,0,0,0,123])));
});

test('native pipe authentication, concurrent busy state, page gates and wrong detail identity',async()=>{
  const fixture=await nativeFixture(),browser=new BossBrowser(fixture.directory);browser.configPath=fixture.configPath;
  try {
    assert.equal((await browser.status()).state,'connected');
    const wrongPath=join(fixture.directory,'wrong.json');
    writeFileSync(wrongPath,JSON.stringify({...fixture.config,token:'0'.repeat(64)}));
    const wrong=new BossBrowser(fixture.directory);wrong.configPath=wrongPath;
    assert.equal((await wrong.status()).code,'BRIDGE_ACCESS_DENIED');
    fixture.delay=200;
    const first=browser.search('personal',{query:'示例',cityCode:'100010000',limit:15});
    await new Promise(resolve=>setTimeout(resolve,30));
    await assert.rejects(browser.search('personal',{query:'第二次',cityCode:'100010000',limit:15}),error=>error.code==='BROWSER_BUSY');
    assert.equal((await first).jobs.length,1);
    fixture.delay=0;fixture.mode='verification_required';
    assert.equal((await browser.search('personal',{query:'示例',cityCode:'100010000',limit:15})).state,'verification_required');
    fixture.mode='wrong_detail';
    await assert.rejects(browser.detail('personal',job.url),error=>error.code==='DETAIL_IDENTITY_INVALID');
  } finally {await browser.close();await fixture.close();}
});

test('v0.2 extension uses the same native protocol without tying compatibility to its release version',async()=>{
  const fixture=await nativeFixture({version:'0.2.0'}),browser=new BossBrowser(fixture.directory);browser.configPath=fixture.configPath;
  try {
    const status=await browser.status();assert.equal(status.state,'connected');assert.equal(status.extensionVersion,'0.2.0');
    assert.equal((await browser.search('personal',{query:'示例',limit:15})).jobs.length,1);
  } finally {await browser.close();await fixture.close();}
});

test('stdio MCP sends search/detail through native pipe and persists only successful data across restart',async()=>{
  const fixture=await nativeFixture({launcher:true});let client;
  const connect=async()=>{
    const value=new Client({name:'native-mcp-fixture',version:'1.0.0'});
    await value.connect(new StdioClientTransport({command:process.execPath,args:[resolve('plugin/src/server.mjs')],
      env:{...process.env,BOSS_DATA_DIR:join(fixture.directory,'db'),BOSS_BRIDGE_CONFIG:fixture.configPath},stderr:'pipe'}));
    return value;
  };
  const call=async(name,args={})=>{
    const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content[0].text);return JSON.parse(r.content[0].text);
  };
  try {
    client=await connect();
    const searched=await call('search_jobs',{query:'示例',limit:15});
    assert.equal(searched.state,'ready');assert.equal(searched.search.state,'ready');assert.equal(searched.jobs.length,1);
    assert.equal(searched.jobs[0].description,'');
    const detail=await call('get_job_detail',{jobId:searched.jobs[0].id});
    assert.equal(detail.job.description,job.description);assert.equal(detail.job.id,searched.jobs[0].id);
    fixture.mode='login_required';
    const gated=await call('search_jobs',{query:'未登录'});
    assert.equal(gated.state,'login_required');assert.equal(gated.search.state,'login_required');assert.equal(gated.jobs.length,0);
    fixture.mode='wrong_detail';
    const invalid=await client.callTool({name:'get_job_detail',arguments:{jobId:detail.job.id}});
    assert.equal(invalid.isError,true);
    await client.close();client=await connect();
    const saved=await call('list_jobs');
    assert.equal(saved.jobs.length,1);assert.equal(saved.jobs[0].description,job.description);
    assert.equal(saved.jobs[0].salary,job.salary);assert.equal(saved.jobs[0].status,'待筛选');
    const status=await call('get_status');assert.equal(status.browser.state,'connected');
    assert.equal(status.recentSearches[0].state,'login_required');
  } finally {if(client)await client.close();await fixture.close();}
});
