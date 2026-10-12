import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createApp,dataRoot,VERSION } from './server.mjs';

const [action,name,inputPath]=process.argv.slice(2);
if(action === 'panel') {
  const app=createApp(dataRoot()),url=await app.dashboard.open(name && name!=='--open' ? name : 'personal');
  console.log(url);
  if(process.argv.includes('--open') && process.platform==='win32') {
    const opener=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
    opener.on('error',()=>console.error('请复制上方链接，在浏览器打开。'));
  }
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
} else if(action !== 'call' && action !== 'tools') {
  console.error('用法：node src/cli.mjs panel [资料名] [--open] | tools | call <工具名> <参数JSON文件>');process.exitCode=1;
} else {
  const client=new Client({name:'boss-job-search-cli',version:VERSION});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],stderr:'inherit'}));
    const response=action === 'tools' ? await client.listTools() : await client.callTool({name,arguments:inputPath ? JSON.parse(await readFile(inputPath,'utf8')) : {}});
    if(response.isError) process.exitCode=1;
    console.log(action === 'tools' ? JSON.stringify(response) : response.content[0].text);
  } finally {await client.close();}
}
