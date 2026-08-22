/* ==========================================================================
   Draft War Room — Cross-Device Live Sync v0.19.1

   Purpose
   ---------------------------------------------------------------------------
   Keep the laptop and tablet on the same draft state without manual refresh.

   - Local actions are pushed immediately.
   - The other device checks for changes once per second.
   - localStorage remains the local safety copy.
   - UI-only preferences stay local to each device.
   - Player ranking/tier metadata stays local; only draft assignment state syncs.

   This intentionally uses Supabase REST rather than a long-lived websocket.
   For draft-night reliability, there is no third-party JS runtime dependency.
   ========================================================================== */

(function(){
  'use strict';

  const TABLE='draft_sync_state';
  const POLL_MS=1000;
  const PUSH_DEBOUNCE_MS=90;
  const DEVICE_KEY='dwr-live-sync-device-id-v1';

  const LOCAL_ONLY_KEYS=new Set([
    'chat',
    'recommendation',
    'playerFilters',
    'collapsedManagers',
    'collapsedBenches',
    'warRoomColumns',
    'playerDataVersion'
  ]);

  const config=window.DWR_LIVE_SYNC||{};

  let baseSave=null;
  let deviceId=null;
  let hydrated=false;
  let applyingRemote=false;
  let pollTimer=null;
  let pushTimer=null;
  let fetchInFlight=false;
  let pushInFlight=false;
  let pushAgain=false;
  let pendingPush=false;
  let lastSeenRevision=0;
  let lastFingerprint='';
  let sequence=0;

  function clone(value){
    if(value===undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function validConfig(){
    const url=String(config.supabaseUrl||'').trim();
    const key=String(config.supabaseKey||'').trim();
    const session=String(config.sessionId||'').trim();

    return config.enabled!==false &&
      /^https:\/\/.+/i.test(url) &&
      key.length>20 &&
      !key.includes('PASTE_') &&
      session.length>=8;
  }

  function normalizeBaseUrl(){
    return String(config.supabaseUrl||'').trim().replace(/\/+$/,'');
  }

  function authHeaders(extra={}){
    const key=String(config.supabaseKey||'').trim();
    const headers={
      apikey:key,
      Accept:'application/json',
      ...extra
    };

    /*
      Supabase's new sb_publishable_* keys are API keys, not JWTs.
      They belong in the `apikey` header and must NOT be sent as
      `Authorization: Bearer ...`.

      Legacy anon keys are JWTs, so keep Bearer support for those.
    */
    if(key.startsWith('eyJ')){
      headers.Authorization=`Bearer ${key}`;
    }

    return headers;
  }

  function getDeviceId(){
    try{
      let id=localStorage.getItem(DEVICE_KEY);

      if(!id){
        id=(crypto?.randomUUID?.() ||
          `device-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
        localStorage.setItem(DEVICE_KEY,id);
      }

      return id;
    }catch(_error){
      return `device-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    }
  }

  function ensureStyles(){
    if(document.getElementById('dwrLiveSyncStyles')) return;

    const style=document.createElement('style');
    style.id='dwrLiveSyncStyles';
    style.textContent=`
      .dwr-sync-status{
        display:inline-flex;
        align-items:center;
        gap:7px;
        min-height:34px;
        padding:0 10px;
        border:1px solid var(--line);
        border-radius:9px;
        background:rgba(28,38,65,.78);
        color:var(--muted);
        font-size:11px;
        font-weight:800;
        white-space:nowrap;
      }

      .dwr-sync-dot{
        width:8px;
        height:8px;
        flex:0 0 8px;
        border-radius:50%;
        background:#7f8ca5;
        box-shadow:0 0 0 3px rgba(127,140,165,.08);
      }

      .dwr-sync-status.connected{
        color:#bff4d3;
        border-color:rgba(85,214,139,.42);
        background:rgba(85,214,139,.08);
      }

      .dwr-sync-status.connected .dwr-sync-dot{
        background:var(--good);
        box-shadow:0 0 0 3px rgba(85,214,139,.12);
      }

      .dwr-sync-status.syncing,
      .dwr-sync-status.connecting{
        color:#ffe6a7;
        border-color:rgba(255,200,87,.38);
        background:rgba(255,200,87,.07);
      }

      .dwr-sync-status.syncing .dwr-sync-dot,
      .dwr-sync-status.connecting .dwr-sync-dot{
        background:var(--warn);
      }

      .dwr-sync-status.offline,
      .dwr-sync-status.error{
        color:#ffb8c1;
        border-color:rgba(255,107,122,.40);
        background:rgba(255,107,122,.07);
      }

      .dwr-sync-status.offline .dwr-sync-dot,
      .dwr-sync-status.error .dwr-sync-dot{
        background:#ff6b7a;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureIndicator(){
    ensureStyles();

    let indicator=document.getElementById('dwrLiveSyncStatus');
    if(indicator) return indicator;

    indicator=document.createElement('div');
    indicator.id='dwrLiveSyncStatus';
    indicator.className='dwr-sync-status';
    indicator.innerHTML=`
      <span class="dwr-sync-dot"></span>
      <span class="dwr-sync-label">Sync</span>
    `;

    const actions=document.querySelector('.header-actions');
    if(actions){
      actions.prepend(indicator);
    }else{
      document.querySelector('header')?.appendChild(indicator);
    }

    return indicator;
  }

  function setStatus(kind,label,title=''){
    const indicator=ensureIndicator();
    indicator.className=`dwr-sync-status ${kind||''}`.trim();
    indicator.querySelector('.dwr-sync-label').textContent=label;
    indicator.title=title;
  }

  function stateReady(){
    return typeof state!=='undefined' &&
      state &&
      Array.isArray(state.players) &&
      state.players.length>0;
  }

  async function waitForState(){
    const started=Date.now();

    while(Date.now()-started<15000){
      if(stateReady()) return true;
      await new Promise(resolve=>setTimeout(resolve,100));
    }

    return false;
  }

  function syncPayload(){
    const payload={
      schemaVersion:1
    };

    if(typeof state==='undefined' || !state) return payload;

    for(const [key,value] of Object.entries(state)){
      if(key==='players') continue;
      if(LOCAL_ONLY_KEYS.has(key)) continue;
      payload[key]=clone(value);
    }

    payload.playerDrafts=(state.players||[])
      .filter(player=>player.draftedBy || player.isKeeper)
      .map(player=>({
        id:player.id,
        draftedBy:player.draftedBy||null,
        isKeeper:!!player.isKeeper
      }));

    return payload;
  }

  function fingerprint(payload){
    return JSON.stringify(payload);
  }

  function nextRevision(){
    sequence=(sequence+1)%1000;

    return Math.max(
      lastSeenRevision+1,
      Date.now()*1000+sequence
    );
  }

  function applyRemotePayload(payload){
    if(!payload || typeof payload!=='object' || !stateReady()) return;

    applyingRemote=true;

    try{
      const draftMap=new Map(
        (payload.playerDrafts||[])
          .filter(item=>item?.id)
          .map(item=>[item.id,item])
      );

      /*
        Preserve the locally-deployed player metadata/rankings.
        Only draft ownership + keeper flags cross devices.
      */
      (state.players||[]).forEach(player=>{
        const remote=draftMap.get(player.id);

        player.draftedBy=remote?.draftedBy||null;
        player.isKeeper=!!remote?.isKeeper;
      });

      for(const [key,value] of Object.entries(payload)){
        if(key==='schemaVersion' || key==='playerDrafts' || key==='players') continue;
        if(LOCAL_ONLY_KEYS.has(key)) continue;
        state[key]=clone(value);
      }

      if(typeof baseSave==='function'){
        baseSave();
      }else if(typeof save==='function'){
        save();
      }

      if(typeof renderAll==='function'){
        renderAll();
      }

      lastFingerprint=fingerprint(syncPayload());
    }finally{
      applyingRemote=false;
    }
  }

  function remoteUrl(){
    const filter=encodeURIComponent(String(config.sessionId||'').trim());

    return `${normalizeBaseUrl()}/rest/v1/${TABLE}` +
      `?session_id=eq.${filter}` +
      `&select=session_id,payload,revision,source_device,updated_at` +
      `&limit=1`;
  }

  function upsertUrl(){
    return `${normalizeBaseUrl()}/rest/v1/${TABLE}?on_conflict=session_id`;
  }

  async function readRemote(initial=false){
    if(fetchInFlight || !validConfig() || !stateReady()) return;

    fetchInFlight=true;

    try{
      const response=await fetch(remoteUrl(),{
        method:'GET',
        headers:authHeaders(),
        cache:'no-store'
      });

      if(!response.ok){
        throw new Error(`Sync read failed (${response.status})`);
      }

      const rows=await response.json();
      const row=Array.isArray(rows) ? rows[0] : null;

      if(!row){
        if(initial){
          hydrated=true;
          await pushNow(true);
        }

        return;
      }

      const revision=Number(row.revision)||0;

      if(initial){
        lastSeenRevision=Math.max(lastSeenRevision,revision);
        applyRemotePayload(row.payload);
        hydrated=true;
        setStatus('connected','Sync Connected','Laptop and tablet are sharing the same draft state.');
        return;
      }

      if(revision<=lastSeenRevision) return;

      lastSeenRevision=revision;

      if(row.source_device!==deviceId){
        applyRemotePayload(row.payload);
        setStatus('connected','Sync Connected','Updated from the other device.');
      }
    }catch(error){
      console.warn('Draft War Room live sync read error:',error);
      setStatus(
        navigator.onLine?'error':'offline',
        navigator.onLine?'Sync Error':'Sync Offline',
        String(error?.message||error)
      );
    }finally{
      fetchInFlight=false;
    }
  }

  async function pushNow(force=false){
    if(!validConfig() || !stateReady()) return;

    if(!hydrated && !force){
      pendingPush=true;
      return;
    }

    if(pushInFlight){
      pushAgain=true;
      return;
    }

    const payload=syncPayload();
    const currentFingerprint=fingerprint(payload);

    if(!force && currentFingerprint===lastFingerprint){
      pendingPush=false;
      return;
    }

    pushInFlight=true;
    pendingPush=false;

    const revision=nextRevision();

    try{
      setStatus('syncing','Syncing…','Sending this device’s draft update.');

      const response=await fetch(upsertUrl(),{
        method:'POST',
        headers:authHeaders({
          'Content-Type':'application/json',
          Prefer:'resolution=merge-duplicates,return=representation'
        }),
        body:JSON.stringify({
          session_id:String(config.sessionId).trim(),
          payload,
          revision,
          source_device:deviceId,
          updated_at:new Date().toISOString()
        })
      });

      if(!response.ok){
        const detail=await response.text().catch(()=> '');
        throw new Error(`Sync write failed (${response.status})${detail?`: ${detail}`:''}`);
      }

      lastSeenRevision=Math.max(lastSeenRevision,revision);
      lastFingerprint=currentFingerprint;
      hydrated=true;

      setStatus('connected','Sync Connected','Laptop and tablet are sharing the same draft state.');
    }catch(error){
      pendingPush=true;
      console.warn('Draft War Room live sync write error:',error);

      setStatus(
        navigator.onLine?'error':'offline',
        navigator.onLine?'Sync Error':'Sync Offline',
        String(error?.message||error)
      );
    }finally{
      pushInFlight=false;

      if(pushAgain || pendingPush){
        pushAgain=false;
        clearTimeout(pushTimer);
        pushTimer=setTimeout(()=>pushNow(false),350);
      }
    }
  }

  function schedulePush(){
    if(applyingRemote) return;

    pendingPush=true;
    clearTimeout(pushTimer);

    pushTimer=setTimeout(()=>{
      pushNow(false);
    },PUSH_DEBOUNCE_MS);
  }

  function hookSave(){
    if(typeof save!=='function') return false;
    if(save.__dwrLiveSyncWrapped) return true;

    baseSave=save;

    const wrappedSave=function(){
      baseSave();

      if(!applyingRemote){
        schedulePush();
      }
    };

    wrappedSave.__dwrLiveSyncWrapped=true;
    save=wrappedSave;

    return true;
  }

  function startPolling(){
    clearInterval(pollTimer);

    pollTimer=setInterval(()=>{
      readRemote(false);
    },POLL_MS);
  }

  async function initialize(){
    deviceId=getDeviceId();
    ensureIndicator();

    if(!validConfig()){
      setStatus(
        'connecting',
        'Sync Setup',
        'Add the Supabase Project URL and public publishable/anon key to config.js.'
      );
      return;
    }

    setStatus('connecting','Sync Connecting…','Connecting laptop/tablet draft state.');

    hookSave();

    const ready=await waitForState();

    if(!ready){
      setStatus('error','Sync Error','Draft state did not finish loading.');
      return;
    }

    /*
      Initial rule:
      - If the shared session already exists, it wins.
      - If it does not exist yet, this device seeds it.
      This prevents a stale second device from overwriting the first one.
    */
    await readRemote(true);
    startPolling();

    window.addEventListener('online',()=>{
      setStatus('connecting','Sync Reconnecting…');
      readRemote(false);
      if(pendingPush) schedulePush();
    });

    window.addEventListener('offline',()=>{
      setStatus('offline','Sync Offline','Local draft data is still safe. Sync will retry when internet returns.');
    });
  }

  window.DWR_LiveSync={
    version:'0.19.1',
    getStatus(){
      return {
        enabled:validConfig(),
        hydrated,
        deviceId,
        sessionId:config.sessionId||null,
        lastSeenRevision
      };
    },
    forcePull(){
      return readRemote(false);
    },
    forcePush(){
      return pushNow(true);
    }
  };

  initialize();
})();
