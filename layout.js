/* Draft War Room layout + quick select + tier grouping + fresh data sync + ESPN-style rosters */

const manualDraftDialog = openDraftDialog;

const STARTER_SLOTS = [
  ['QB',['QB']],['RB',['RB']],['RB',['RB']],['WR',['WR']],['WR',['WR']],['WR',['WR']],
  ['TE',['TE']],['FLEX',['RB','WR','TE']],['DP',['DP']],['D/ST',['D/ST']],['K',['K']]
];

function ensureQuickSelectState(){
  if(typeof state.quickSelect!=='boolean'){state.quickSelect=true;save();}
}
function updateQuickSelectButton(){
  const b=document.getElementById('quickSelectBtn'); if(!b)return;
  b.textContent=`Quick Select: ${state.quickSelect?'ON':'OFF'}`;
  b.classList.toggle('quick-on',!!state.quickSelect);
}
function ensureHeaderDraftControls(){
  const a=document.querySelector('.header-actions'); if(!a)return;
  if(!document.getElementById('quickSelectBtn')){
    const b=document.createElement('button'); b.id='quickSelectBtn';
    b.onclick=()=>{state.quickSelect=!state.quickSelect;save();updateQuickSelectButton();renderWarRoom()};
    a.prepend(b);
  }
  if(!document.getElementById('headerUndoBtn')){
    const b=document.createElement('button'); b.id='headerUndoBtn'; b.textContent='Undo Pick'; b.onclick=()=>undo(); a.appendChild(b);
  }
  updateQuickSelectButton();
}
openDraftDialog=function(player){
  ensureQuickSelectState();
  if(state.quickSelect&&!state.keeperMode){draftPlayer(player.id,managerForPick(state.currentPick),false);return;}
  manualDraftDialog(player);
};

function groupWarRoomTiers(){
  document.querySelectorAll('.wr-tier .tier-scroll').forEach(scroll=>{
    const kids=[...scroll.children]; if(!kids.length)return;
    const frag=document.createDocumentFragment(); let section=null;
    kids.forEach(el=>{
      if(el.classList.contains('tier-label')){
        const m=el.textContent.match(/Tier\s*(\d+)/i);
        section=document.createElement('div'); section.className='tier-section'; section.dataset.tier=m?m[1]:'unrated';
        frag.appendChild(section); section.appendChild(el);
      }else{
        if(!section){section=document.createElement('div');section.className='tier-section';section.dataset.tier='unrated';frag.appendChild(section)}
        section.appendChild(el);
      }
    });
    scroll.replaceChildren(frag);
  });
}

async function syncFreshPlayerData(){
  try{
    const r=await fetch(`players.json?fresh=${Date.now()}`,{cache:'no-store'}); if(!r.ok)return;
    const fresh=await r.json(), saved=new Map((state.players||[]).map(p=>[p.id,p]));
    state.players=fresh.map(p=>({...p,draftedBy:saved.get(p.id)?.draftedBy??p.draftedBy??null,isKeeper:saved.get(p.id)?.isKeeper??p.isKeeper??false}));
    save();renderAll();
  }catch(e){console.warn('Using saved player data',e)}
}

function orderedRoster(manager){
  const hist=new Map((state.history||[]).map((h,i)=>[h.id,i]));
  return roster(manager).slice().sort((a,b)=>(hist.get(a.id)??9999)-(hist.get(b.id)??9999));
}
function buildLineup(manager){
  const players=orderedRoster(manager), used=new Set();
  const slots=STARTER_SLOTS.map(([label,eligible])=>({label,eligible,player:null}));
  slots.filter(s=>s.label!=='FLEX').forEach(s=>{
    const p=players.find(x=>!used.has(x.id)&&s.eligible.includes(x.position));
    if(p){s.player=p;used.add(p.id)}
  });
  const flex=slots.find(s=>s.label==='FLEX');
  const fp=players.find(x=>!used.has(x.id)&&flex.eligible.includes(x.position));
  if(fp){flex.player=fp;used.add(fp.id)}
  return {slots,bench:players.filter(x=>!used.has(x.id))};
}
function slotHtml(label,p){
  return `<div class="lineup-slot ${p?'filled':'empty'}"><span class="lineup-pos">${label}</span><span class="lineup-player">${p?`${p.name}${p.isKeeper?' <span class="tiny">(K)</span>':''}`:'Empty'}</span></div>`;
}
function rosterCardHtml(manager){
  const {slots,bench}=buildLineup(manager);
  return `<div class="espn-lineup"><div class="starter-slots">${slots.map(s=>slotHtml(s.label,s.player)).join('')}</div>
    <div class="bench-divider"><span>Bench</span><span>${Math.min(bench.length,11)}/11</span></div>
    <div class="bench-slots">${Array.from({length:11},(_,i)=>slotHtml('BE',bench[i])).join('')}</div></div>`;
}

renderWarRoom=function(){
  ensureQuickSelectState();
  const cur=managerForPick(state.currentPick),next=nextPickFor('High Roehler',state.currentPick),total=totalCounts(),rec=state.recommendation;
  const tier=(pos,cls)=>`<div class="card wr-tier ${cls}"><div class="section-title"><h3>${pos}</h3><span class="tiny">Available</span></div><div class="tier-scroll">${playerRows(pos,40)}</div></div>`;
  document.getElementById('war-room').innerHTML=`<div class="war-room-layout">
    <div class="card wr-recommendation"><div class="section-title"><div><div class="muted">Recommendation</div><div class="rec-name">${rec?.recommendation||'—'}</div></div><button id="recommendBtn" class="primary">Recommend</button></div>
    ${rec?`<div class="confidence">Confidence ${rec.confidence}%</div><ul class="reason-list">${(rec.reason||[]).map(x=>`<li>${x}</li>`).join('')}</ul>${rec.warning?`<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>`:''}`:`<div class="recommendation-empty muted">Recommendation details will appear here when the decision engine is connected.</div>`}</div>
    <div class="card wr-status-card wr-next"><div class="muted">High Roehler's Next Pick</div><div class="hero">${next?`#${next}`:'Draft complete'}</div><div>${next?`${Math.max(0,next-state.currentPick)} picks away`:''}</div></div>
    <div class="card wr-summary"><div class="section-title"><h3>Draft Position Summary</h3><button id="targetsBtn">Edit</button></div><div class="summary">${POSITIONS.map(p=>`<span class="pill"><strong>${p}</strong> ${total[p]}/${state.targets[p]}</span>`).join('')}</div></div>
    <div class="card wr-status-card wr-current"><div class="muted">Current Pick</div><div class="hero">#${state.currentPick}</div><div>${cur}</div><div class="tiny">Round ${roundForPick(state.currentPick)}</div><div class="quick-status tiny">${state.quickSelect?'Quick Select ON':'Quick Select OFF'}</div></div>
    <div class="card wr-roster"><div class="section-title"><h3>Your Roster</h3><button id="undoBtn">Undo Pick</button></div>${rosterCardHtml('High Roehler')}</div>
    ${tier('QB','wr-tier-qb')}${tier('RB','wr-tier-rb')}${tier('WR','wr-tier-wr')}${tier('TE','wr-tier-te')}
  </div>`;
  document.querySelectorAll('#war-room [data-player]').forEach(el=>el.onclick=()=>openDraftDialog(state.players.find(p=>p.id===el.dataset.player)));
  document.getElementById('undoBtn').onclick=undo; document.getElementById('targetsBtn').onclick=openTargets; document.getElementById('recommendBtn').onclick=getRecommendation;
  groupWarRoomTiers();ensureHeaderDraftControls();
};

renderDraftBoard=function(){
  const others=MANAGERS.filter(m=>m!=='High Roehler');
  document.getElementById('draft-board').innerHTML=`<div class="section-title"><div><h2>Draft Board</h2><div class="muted">Live roster view for the other managers.</div></div></div>
    <div class="grid board-grid lineup-board">${others.map(m=>`<div class="card manager-card lineup-manager-card"><div class="manager-card-head"><h3>${m}</h3><div class="manager-summary">${positionSummaryText(counts(m))}</div></div>${rosterCardHtml(m)}</div>`).join('')}</div>`;
};

const originalRenderAll=renderAll;
renderAll=function(){originalRenderAll();renderDraftBoard();ensureHeaderDraftControls();groupWarRoomTiers()};

if(typeof state!=='undefined'&&state){
  ensureQuickSelectState();ensureHeaderDraftControls();
  if(state.players){renderWarRoom();renderDraftBoard()}
  setTimeout(syncFreshPlayerData,50);
}
