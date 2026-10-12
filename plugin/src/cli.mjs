import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const [action,name,inputPath]=process.argv.slice(2);
if(action !== 'call' && action !== 'tools') {
  console.error('用法：node src/cli.mjs tools | call <工具名> <参数JSON文件>');process.exitCode=1;
} else {
  const client=new Client({name:'boss-job-search-cli',version:'0.1.3'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],stderr:'inherit'}));
    const response=action === 'tools' ? await client.listTools() : await client.callTool({name,arguments:inputPath ? JSON.parse(await readFile(inputPath,'utf8')) : {}});
    if(response.isError) process.exitCode=1;
    console.log(action === 'tools' ? JSON.stringify(response) : response.content[0].text);
  } finally {await client.close();}
}
