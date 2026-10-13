const HOST='com.boss_job_search.bridge';
const STATE_KEY='nativeConnection';
const ALARM='native-connection-retry';
const MAX_ATTEMPTS=6;

// Retry state survives worker suspension, but resets with the browser session.
export function createNativeConnection({chromeApi,onCommand,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let port=null,ready=false,state=null,serial=Promise.resolve(),timer=null,handshake=null,disposed=false;
  const fresh=()=>({state:'disconnected',attempts:0,nextRetryAt:null,lastError:null,at:now()});
  const enqueue=operation=>{
    const result=serial.then(()=>disposed ? undefined : operation());
    serial=result.catch(error=>{
      console.error('本机连接状态失败:',error.message);
      chromeApi.action.setBadgeText({text:'!'});
      chromeApi.action.setTitle({title:'连接失败，点击重试'});
    });
    return result;
  };
  async function loadState() {
    if(state)return;
    const saved=(await chromeApi.storage.session.get(STATE_KEY))[STATE_KEY];
    state=saved && ['connecting','connected','waiting','exhausted','disconnected'].includes(saved.state) &&
      Number.isInteger(saved.attempts) && saved.attempts>=0 && saved.attempts<=MAX_ATTEMPTS &&
      (saved.nextRetryAt===null || Number.isFinite(saved.nextRetryAt)) ? saved : fresh();
  }
  async function save() {
    state.at=now();
    await chromeApi.storage.session.set({[STATE_KEY]:state});
  }
  function clearTimers() {
    if(timer!==null)clearTimer(timer);
    if(handshake!==null)clearTimer(handshake);
    timer=handshake=null;
  }
  async function failed(connection,message) {
    if(port!==connection)return;
    port=null;ready=false;clearTimers();
    state.lastError=message ? message.slice(0,300) : null;
    if(message)console.error('本机连接失败:',message);
    chromeApi.action.setBadgeText({text:'!'});
    if(state.attempts>=MAX_ATTEMPTS) {
      state.state='exhausted';state.nextRetryAt=null;
      chromeApi.action.setTitle({title:'连接失败，点击重试'});
      await chromeApi.alarms.clear(ALARM);
      await save();return;
    }
    state.state='waiting';
    const fast=state.attempts<=2;
    state.nextRetryAt=now()+(fast ? 5000 : 60000);
    chromeApi.action.setTitle({title:'连接中断，正在重试'});
    await save();
    // Alarms wake a suspended MV3 worker. The timer only accelerates the first two retries.
    await chromeApi.alarms.create(ALARM,{delayInMinutes:1});
    if(fast)timer=setTimer(()=>{void enqueue(connect);},5000);
  }
  async function connect() {
    await loadState();
    if(port || state.attempts>=MAX_ATTEMPTS)return;
    clearTimers();await chromeApi.alarms.clear(ALARM);
    state.attempts++;state.state='connecting';state.nextRetryAt=null;
    await save();
    const connection=chromeApi.runtime.connectNative(HOST);
    port=connection;
    connection.onMessage.addListener(message=>{
      if(message.type==='ready' && message.protocol===1)void enqueue(async()=>{
        if(port!==connection)return;
        clearTimers();ready=true;state=fresh();state.state='connected';
        await chromeApi.alarms.clear(ALARM);await save();
        chromeApi.action.setBadgeText({text:'OK'});
        chromeApi.action.setTitle({title:'求职已连接'});
      });
      else if(message.type==='command')onCommand(message,connection);
    });
    connection.onDisconnect.addListener(()=>{
      // runtime.lastError is only valid inside this event callback.
      const message=chromeApi.runtime.lastError?.message;
      void enqueue(()=>failed(connection,message));
    });
    handshake=setTimer(()=>{void enqueue(async()=>{
      if(port!==connection || ready)return;
      await failed(connection,'本机程序未完成连接');connection.disconnect();
    });},15000);
    try {
      connection.postMessage({type:'hello',protocol:1,extensionId:chromeApi.runtime.id,
        version:chromeApi.runtime.getManifest().version});
    } catch(error) {
      await failed(connection,error.message);connection.disconnect();
    }
  }
  async function initialize() {
    await loadState();
    if(state.state==='connected')state=fresh();
    if(state.state==='exhausted') {
      chromeApi.action.setBadgeText({text:'!'});
      chromeApi.action.setTitle({title:'连接失败，点击重试'});return;
    }
    if(state.state==='waiting' && state.nextRetryAt>now()) {
      if(!await chromeApi.alarms.get(ALARM))await chromeApi.alarms.create(ALARM,{delayInMinutes:1});
      return;
    }
    await connect();
  }
  const retry=()=>enqueue(async()=>{
    if(ready)return;
    const previous=port;port=null;clearTimers();
    if(previous)previous.disconnect();
    state=fresh();await save();await connect();
  });
  const startup=()=>enqueue(async()=>{
    if(port)return;
    state=fresh();await save();await connect();
  });
  const alarm=event=>{
    if(event.name===ALARM)void enqueue(connect);
  };
  chromeApi.alarms.onAlarm.addListener(alarm);
  chromeApi.runtime.onStartup.addListener(startup);
  chromeApi.runtime.onInstalled.addListener(startup);
  chromeApi.action.onClicked.addListener(retry);
  return {
    start:()=>enqueue(initialize),retry,isCurrent:connection=>port===connection,
    idle:()=>serial,
    dispose() {
      disposed=true;clearTimers();const previous=port;port=null;if(previous)previous.disconnect();
      chromeApi.alarms.onAlarm.removeListener(alarm);
      chromeApi.runtime.onStartup.removeListener(startup);
      chromeApi.runtime.onInstalled.removeListener(startup);
      chromeApi.action.onClicked.removeListener(retry);
    },
  };
}
