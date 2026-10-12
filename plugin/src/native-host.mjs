import net from 'node:net';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve,dirname,join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { encodeFrame, FrameReader } from './framing.mjs';
import { readBridgeConfig,allowedCaller } from './bridge-config.mjs';

const requestSchema = z.object({
  id:z.string().uuid(),sessionId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),
  method:z.enum(['status','search','detail','login','close']),
  params:z.record(z.unknown()),
}).strict();
const fail = (code,message) => ({code,message});

export function startHost(config,{input=process.stdin,output=process.stdout,timeoutMs=40000,observe}={}) {
  const pending = new Map(), clients = new Set(), reader = new FrameReader();
  let version = null, active = null, stopped = false;
  const server = net.createServer(socket => {
    if (clients.size >= 8) {socket.destroy();return;}
    clients.add(socket);
    const decoder = new FrameReader();
    let received = false;
    const initialTimer = setTimeout(() => socket.destroy(),2000);
    socket.on('error',() => {});
    socket.on('close',() => {
      clearTimeout(initialTimer);clients.delete(socket);
      // A disconnected client does not cancel a running browser operation.
      // Its deadline still releases the busy flag and the pending entry.
    });
    socket.on('data',chunk => {
      try {
        for (const raw of decoder.push(chunk)) {
          if (received) throw new Error('One request per connection');
          received = true;clearTimeout(initialTimer);
          const request = requestSchema.parse(raw);
          const reply = value => socket.end(encodeFrame({id:request.id,...value}));
          if (!timingSafeEqual(Buffer.from(request.token),Buffer.from(config.token))) {
            reply({error:fail('BRIDGE_ACCESS_DENIED','本机通信凭据无效。')});return;
          }
          if (!version) {reply({error:fail('EXTENSION_STARTING','浏览器扩展尚未连接完成。')});return;}
          if (request.method === 'status') {
            reply({result:{state:'connected',method:'Chrome scripting / ISOLATED',extensionVersion:version,busy:!!active}});return;
          }
          if (active) {reply({error:fail('BROWSER_BUSY','另一个岗位读取正在进行，请完成后重试。')});return;}
          // Internal command IDs are independent of client-provided IDs.
          const id = randomUUID();
          const timer = setTimeout(() => {
            const item = pending.get(id);pending.delete(id);if(active === id)active=null;
            if(item && !item.socket.destroyed) item.socket.end(encodeFrame({id:item.clientId,error:fail('PAGE_TIMEOUT','岗位页面读取超时，未保存此次结果。')}));
          },timeoutMs);
          pending.set(id,{socket,clientId:request.id,timer});active=id;
          output.write(encodeFrame({type:'command',id,sessionId:request.sessionId,method:request.method,params:request.params}));
        }
      } catch {socket.destroy();}
    });
  });
  const stop = (state='disconnected',code) => {
    if(stopped)return;stopped=true;
    if(active)active=null;
    for(const item of pending.values()){clearTimeout(item.timer);item.socket.destroy();}
    pending.clear();for(const socket of clients)socket.destroy();server.close();input.destroy();output.end();
    observe?.(state,code);
  };
  input.on('data',chunk => {
    try {
      for(const message of reader.push(chunk)) {
        if(message.type === 'hello') {
          if(message.protocol !== 1 || message.extensionId !== config.extensionId || message.version !== '0.1.3') throw new Error('Wrong extension protocol');
          version=message.version;observe?.('connected');output.write(encodeFrame({type:'ready',protocol:1}));continue;
        }
        if(message.type !== 'response' || typeof message.id !== 'string') throw new Error('Wrong response');
        if(active === message.id)active=null;
        const item=pending.get(message.id);if(!item)continue;
        pending.delete(message.id);clearTimeout(item.timer);
        const response=message.error
          ? {error:fail('PAGE_OPERATION_FAILED', typeof message.error.message==='string' ? message.error.message.slice(0,300) : '浏览器未完成操作。')}
          : {result:message.result};
        if(!item.socket.destroyed)item.socket.end(encodeFrame({id:item.clientId,...response}));
      }
    } catch {stop('protocol_error');}
  });
  input.once('end',()=>stop());input.once('error',()=>stop());output.once('error',()=>stop());
  server.on('error',error=>stop('pipe_error',error.code));
  server.once('listening',()=>observe?.('listening'));
  server.listen(config.pipe);
  return {server,stop};
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv[2] !== '--config')throw new Error('Missing config');
    const config=readBridgeConfig(process.argv[3]);
    const observe=(state,code) => {
      try {writeFileSync(join(dirname(process.argv[3]),'host-state.json'),JSON.stringify({state,at:new Date().toISOString(),...(code?{code}: {})}));}
      catch {process.stderr.write('Native host diagnostics unavailable.\n');}
    };
    observe('starting');
    if(!allowedCaller(process.argv[4],config.extensionId)) {
      observe('caller_rejected');throw new Error('Wrong caller');
    }
    const host=startHost(config,{observe});
    process.once('SIGTERM',()=>host.stop());process.once('SIGINT',()=>host.stop());
  } catch {process.stderr.write('BOSS native host configuration or caller is invalid.\n');process.exitCode=1;}
}
