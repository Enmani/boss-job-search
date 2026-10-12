import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TaskError } from './domain.mjs';

export const HOST_NAME = 'com.boss_job_search.bridge';
export function allowedCaller(value,extensionId) {
  try {
    const url=new URL(value);
    return url.protocol==='chrome-extension:' && url.hostname===extensionId &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      (url.pathname==='' || url.pathname==='/');
  } catch {return false;}
}
export const bridgeConfigSchema = z.object({
  extensionId:z.string().regex(/^[a-p]{32}$/),
  pipe:z.string().startsWith('\\\\.\\pipe\\boss-job-search-').max(200),
  token:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function readBridgeConfig(path) {
  try { return bridgeConfigSchema.parse(JSON.parse(readFileSync(path,'utf8'))); }
  catch { throw new TaskError('BRIDGE_NOT_CONFIGURED','本机通信尚未安装或配置损坏，请运行插件的 install-native.ps1。'); }
}
