import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeConnection } from '../plugin/chrome-extension/connection.js';

function event() {
  const listeners=new Set();
  return {addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener),
    emit:value=>{for(const listener of listeners)listener(value);}};
}
function fixture() {
  let time=1000,nextTimer=0,stored={},controller;
  const timers=new Map(),alarms=new Map(),ports=[];
  const result={available:false,hang:false,badge:null,title:null,ports,alarms,get stored(){return structuredClone(stored);}};
  const chrome={
    runtime:{id:'a'.repeat(32),onStartup:event(),onInstalled:event(),getManifest:()=>({version:'0.2.0'}),
      connectNative(host) {
        assert.equal(host,'com.boss_job_search.bridge');
        const port={onMessage:event(),onDisconnect:event(),closed:false,
          disconnect(){if(!port.closed){port.closed=true;port.onDisconnect.emit();}},
          postMessage(message){
            assert.equal(message.type,'hello');
            queueMicrotask(()=>{
              if(port.closed || result.hang)return;
              if(result.available)port.onMessage.emit({type:'ready',protocol:1});
              else {
                chrome.runtime.lastError={message:'Specified native messaging host not found.'};
                port.disconnect();delete chrome.runtime.lastError;
              }
            });
          },
        };
        ports.push(port);return port;
      }},
    action:{onClicked:event(),setBadgeText:({text})=>{result.badge=text;},setTitle:({title})=>{result.title=title;}},
    storage:{session:{async get(key){return {[key]:structuredClone(stored[key])};},
      async set(value){stored={...stored,...structuredClone(value)};}}},
    alarms:{onAlarm:event(),async clear(name){return alarms.delete(name);},async get(name){return alarms.get(name);},
      async create(name,{delayInMinutes}){alarms.set(name,{name,scheduledTime:time+delayInMinutes*60000});}},
  };
  result.flush=async()=>{for(let i=0;i<3;i++){await new Promise(resolve=>setImmediate(resolve));await controller.idle();}};
  result.start=async()=>{
    controller=createNativeConnection({chromeApi:chrome,onCommand:()=>{},now:()=>time,
      setTimer:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id;},
      clearTimer:id=>timers.delete(id)});
    await controller.start();await result.flush();return controller;
  };
  result.suspend=()=>controller.dispose();
  result.advance=async duration=>{
    const end=time+duration;
    while(true) {
      const timerEntry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      const alarmEntry=[...alarms].sort((a,b)=>a[1].scheduledTime-b[1].scheduledTime)[0];
      const timerAt=timerEntry?.[1].at??Infinity,alarmAt=alarmEntry?.[1].scheduledTime??Infinity;
      const at=Math.min(timerAt,alarmAt);
      if(at>end)break;
      time=at;
      if(timerAt<=alarmAt){timers.delete(timerEntry[0]);timerEntry[1].callback();}
      else {alarms.delete(alarmEntry[0]);chrome.alarms.onAlarm.emit(alarmEntry[1]);}
      await result.flush();
    }
    time=end;await result.flush();
  };
  result.click=async()=>{chrome.action.onClicked.emit();await result.flush();};
  return result;
}

test('missing host for longer than the old retry window recovers through an alarm without a click',async()=>{
  const f=fixture();await f.start();
  await f.advance(16000);
  assert.equal(f.ports.length,3);
  assert.equal(f.stored.nativeConnection.state,'waiting');
  assert.equal(f.stored.nativeConnection.lastError,'Specified native messaging host not found.');
  f.available=true;
  await f.advance(54000);
  assert.equal(f.badge,'OK');assert.equal(f.ports.length,4);
  assert.equal(f.stored.nativeConnection.state,'connected');
  assert.equal(f.stored.nativeConnection.attempts,0);assert.equal(f.alarms.size,0);
  f.suspend();
});

test('worker restarts retain the bounded retry budget and the toolbar click starts a new budget',async()=>{
  const f=fixture();await f.start();await f.advance(10000);
  for(let i=0;i<3;i++){f.suspend();await f.start();await f.advance(60000);}
  assert.equal(f.ports.length,6);assert.equal(f.stored.nativeConnection.state,'exhausted');
  assert.equal(f.alarms.size,0);
  f.suspend();await f.start();await f.advance(600000);
  assert.equal(f.ports.length,6);
  f.available=true;await f.click();
  assert.equal(f.ports.length,7);assert.equal(f.badge,'OK');
  f.suspend();
});

test('a late ready/disconnect from an abandoned connection cannot overwrite the replacement',async()=>{
  const f=fixture();f.hang=true;await f.start();
  const previous=f.ports[0];
  f.hang=false;f.available=true;await f.click();
  previous.onMessage.emit({type:'ready',protocol:1});previous.onDisconnect.emit();await f.flush();
  assert.equal(previous.closed,true);assert.equal(f.ports.length,2);
  assert.equal(f.stored.nativeConnection.state,'connected');assert.equal(f.alarms.size,0);
  f.suspend();
});

test('a native host that never completes its hello handshake gets a finite timeout and retry',async()=>{
  const f=fixture();f.hang=true;await f.start();await f.advance(15000);
  assert.equal(f.ports[0].closed,true);
  assert.equal(f.stored.nativeConnection.lastError,'本机程序未完成连接');
  f.hang=false;f.available=true;await f.advance(5000);
  assert.equal(f.ports.length,2);assert.equal(f.badge,'OK');
  f.suspend();
});
