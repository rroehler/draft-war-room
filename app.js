const MANAGERS = ['High Roehler','Taylor','Shaun','Burke','Damon','KP','Tyler','Ian','Jolley','Levi','Dallas','Josh'];
const POSITIONS = ['QB','RB','WR','TE','DP','D/ST','K'];
const COMMANDMENTS = [
  'Every pick must improve the expected points of your starting lineup more than any alternative available at that pick.',
  'Use ADP to predict availability, not to decide player value.',
  'Never pass on a player if waiting is likely to cost you the opportunity to draft anyone from that tier.',
  'Draft for value, not for need. Needs can be filled later. Lost value cannot.',
  "Trust our board over ESPN's board.",
  'Stay flexible. Never force a pre-draft plan when the draft board offers better value.',
  'Do not chase positional runs. Decide whether to join them or exploit them.',
  "Never draft a player's ceiling at his floor price.",
  'When in doubt, choose the player who gives you the most ways to win.',
  'Always think one pick ahead, not one pick at a time.'
];
const DEFAULT_TARGETS = {QB:2,RB:6,WR:7,TE:2,DP:1,'D/ST':1,K:1};
const STORAGE='draft-war-room-v1';
let state={};

function initialState(players){return {
  players,
  draftOrder:[...MANAGERS],
  currentPick:1,
  history:[],
  targets:{...DEFAULT_TARGETS},
  recommendation:null,
  chat:[],
  keeperMode:false
}}

function load(){
  const raw=localStorage.getItem(STORAGE);
  if(raw){state=JSON.parse(raw); renderAll(); return;}
  fetch('players.json').then(r=>r.json()).then(players=>{state=initialState(players);save();renderAll()});
}
function save(){localStorage.setItem(STORAGE,JSON.stringify(state))}
function roundForPick(p){return Math.ceil(p/12)}
function managerForPick(p){
  const r=roundForPick(p), idx=(p-1)%12;
  return r%2===1 ? state.draftOrder[idx] : state.draftOrder[11-idx];
}
function nextPickFor(manager, after=state.currentPick){
  for(let p=after;p<=264;p++) if(managerForPick(p)===manager) return p;
  return null;
}
function roster(manager){return state.players.filter(p=>p.draftedBy===manager)}
function counts(manager){const c=Object.fromEntries(POSITIONS.map(p=>[p,0]));roster(manager).forEach(p=>{if(c[p.position]!=null)c[p.position]++});return c}
function totalCounts(){const c=Object.fromEntries(POSITIONS.map(p=>[p,0]));state.players.filter(p=>p.draftedBy).forEach(p=>{if(c[p.position]!=null)c[p.position]++});return c}
function positionSummaryText(c){return POSITIONS.map(p=>`${p} ${c[p]}/${state.targets[p]}`).join(' | ')}
function snapshotForAI(){
  const currentManager=managerForPick(state.currentPick);
  const nextUserPick=nextPickFor('High Roehler',state.currentPick);
  return {
    currentPick:state.currentPick,currentManager,nextUserPick,picksUntilUser:nextUserPick?nextUserPick-state.currentPick:null,
    userRoster:roster('High Roehler'),positionSummary:totalCounts(),
    otherRosters:Object.fromEntries(MANAGERS.filter(m=>m!=='High Roehler').map(m=>[m,roster(m)])),
    players:state.players.filter(p=>!p.draftedBy)
  }
}
function draftPlayer(id, manager, isKeeper=false){
  const p=state.players.find(x=>x.id===id); if(!p||p.draftedBy)return;
  const prevPick=state.currentPick;
  p.draftedBy=manager;p.isKeeper=isKeeper;
  state.history.push({id,manager,isKeeper,prevPick});
  if(!isKeeper) state.currentPick++;
  state.recommendation=null;save();renderAll();
}
function undo(){
  const h=state.history.pop(); if(!h)return;
  const p=state.players.find(x=>x.id===h.id); if(p){p.draftedBy=null;p.isKeeper=false}
  state.currentPick=h.prevPick;state.recommendation=null;save();renderAll();
}
function openDraftDialog(player){
  const d=document.getElementById('draftDialog');
  document.getElementById('draftDialogTitle').textContent=`${state.keeperMode?'Assign Keeper':'Draft'}: ${player.name}`;
  document.getElementById('draftDialogBody').innerHTML=`<div class="grid" style="grid-template-columns:repeat(3,1fr)">${MANAGERS.map(m=>`<button data-manager="${m}">${m}</button>`).join('')}</div>`;
  document.querySelectorAll('#draftDialogBody [data-manager]').forEach(b=>b.onclick=()=>{draftPlayer(player.id,b.dataset.manager,state.keeperMode);d.close()});
  d.showModal();
}
function playerRows(pos, limit=14){
  const list=state.players.filter(p=>!p.draftedBy&&p.position===pos).sort((a,b)=>{
    const ta=Number(a.tier)||99,tb=Number(b.tier)||99;if(ta!==tb)return ta-tb;
    const aa=Number(a.adp)||999,ab=Number(b.adp)||999;return aa-ab;
  }).slice(0,limit);
  if(!list.length)return '<div class="muted">No available players.</div>';
  let lastTier=null;
  return list.map(p=>{
    const tier=p.tier||'Unrated'; const label=tier!==lastTier?`<div class="tier-label">${tier==='Unrated'?'Unrated':`Tier ${tier}`}</div>`:'';lastTier=tier;
    return `${label}<div class="player-row" data-player="${p.id}"><span><b>${p.name}</b><div class="tiny">${p.nflTeam} · ${p.ourLabel||'Unrated'}</div></span><span class="tiny">${p.adp?`ADP ${p.adp}`:''}</span></div>`
  }).join('')
}
function renderWarRoom(){
  const cur=managerForPick(state.currentPick), next=nextPickFor('High Roehler',state.currentPick), total=totalCounts(), mine=roster('High Roehler');
  const rec=state.recommendation;
  document.getElementById('war-room').innerHTML=`
    <div class="notice">Testing build: player names are seeded from last year's draft recap. 2026 tiers/ADP/labels still need to be loaded.</div>
    <div class="grid top-grid">
      <div class="card"><div class="muted">Current Pick</div><div class="hero">#${state.currentPick}</div><div>${cur}</div><div class="tiny">Round ${roundForPick(state.currentPick)}</div></div>
      <div class="card"><div class="muted">High Roehler's Next Pick</div><div class="hero">${next?`#${next}`:'Draft complete'}</div><div>${next?`${Math.max(0,next-state.currentPick)} picks away`:''}</div></div>
      <div class="card"><div class="section-title"><div><div class="muted">Recommendation</div><div class="rec-name">${rec?.recommendation||'—'}</div></div><button id="recommendBtn" class="primary">Recommend</button></div>
        ${rec?`<div class="confidence">Confidence ${rec.confidence}%</div><ul class="reason-list">${(rec.reason||[]).map(x=>`<li>${x}</li>`).join('')}</ul>${rec.warning?`<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>`:''}`:'<div class="muted">Ask the decision engine when you are close to or on the clock.</div>'}</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="section-title"><h3>Draft Position Summary</h3><button id="targetsBtn">Edit Targets</button></div><div class="summary">${POSITIONS.map(p=>`<span class="pill"><strong>${p}</strong> ${total[p]}/${state.targets[p]}</span>`).join('')}</div></div>
    <div class="grid tier-grid">
      ${['QB','RB','WR','TE'].map(pos=>`<div class="card tier-column"><div class="section-title"><h3>${pos}</h3><span class="tiny">Available</span></div>${playerRows(pos)}</div>`).join('')}
    </div>
    <div class="card" style="margin-top:14px"><div class="section-title"><h3>Your Roster</h3><button id="undoBtn">Undo Last Pick</button></div>${mine.length?`<div class="roster-list">${POSITIONS.map(pos=>mine.filter(p=>p.position===pos).map(p=>`<div class="roster-line"><span class="pos">${pos}</span><span>${p.name}${p.isKeeper?' <span class="tiny">(Keeper)</span>':''}</span></div>`).join('')).join('')}</div>`:'<div class="muted">No players assigned yet.</div>'}</div>`;
  document.querySelectorAll('#war-room [data-player]').forEach(el=>el.onclick=()=>openDraftDialog(state.players.find(p=>p.id===el.dataset.player)));
  document.getElementById('undoBtn').onclick=undo;
  document.getElementById('targetsBtn').onclick=openTargets;
  document.getElementById('recommendBtn').onclick=getRecommendation;
}
function renderPlayers(){
  document.getElementById('players').innerHTML=`<div class="card"><div class="section-title"><h2>Available Players</h2><div class="muted">Click a player to assign the pick</div></div><div class="filters"><input id="playerSearch" placeholder="Search player or NFL team"><select id="positionFilter"><option value="">All positions</option>${POSITIONS.map(p=>`<option>${p}</option>`).join('')}</select><select id="statusFilter"><option value="available">Available only</option><option value="all">All players</option></select></div><div id="playerTable"></div></div>`;
  ['playerSearch','positionFilter','statusFilter'].forEach(id=>document.getElementById(id).oninput=renderPlayerTable);renderPlayerTable();
}
function renderPlayerTable(){
  const q=(document.getElementById('playerSearch')?.value||'').toLowerCase(),pos=document.getElementById('positionFilter')?.value||'',status=document.getElementById('statusFilter')?.value||'available';
  const list=state.players.filter(p=>(status==='all'||!p.draftedBy)&&(!pos||p.position===pos)&&(!q||`${p.name} ${p.nflTeam}`.toLowerCase().includes(q))).sort((a,b)=>(Number(a.adp)||999)-(Number(b.adp)||999)).slice(0,300);
  document.getElementById('playerTable').innerHTML=`<table class="table"><thead><tr><th>Player</th><th>Pos</th><th>Tier</th><th>ADP</th><th>Our Label</th><th>Status</th></tr></thead><tbody>${list.map(p=>`<tr data-player="${p.id}"><td><b>${p.name}</b> <span class="tiny">${p.nflTeam}</span></td><td>${p.position}</td><td>${p.tier||'—'}</td><td>${p.adp||'—'}</td><td>${p.ourLabel||'Unrated'}</td><td>${p.draftedBy?`${p.draftedBy}${p.isKeeper?' (K)':''}`:'Available'}</td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('#playerTable [data-player]').forEach(el=>el.onclick=()=>{const p=state.players.find(x=>x.id===el.dataset.player);if(!p.draftedBy)openDraftDialog(p)});
}
function renderDraftBoard(){
  const others=MANAGERS.filter(m=>m!=='High Roehler');
  document.getElementById('draft-board').innerHTML=`<div class="section-title"><div><h2>Draft Board</h2><div class="muted">What everyone else has done. No predictions.</div></div></div><div class="grid board-grid">${others.map(m=>{
    const r=roster(m),c=counts(m);return `<div class="card manager-card"><h3>${m}</h3><div class="manager-summary">${positionSummaryText(c)}</div>${POSITIONS.map(pos=>{const ps=r.filter(p=>p.position===pos);return ps.length?`<div class="position-group"><b>${pos}</b><div class="tiny">${ps.map(p=>`${p.name}${p.isKeeper?' (K)':''}`).join(' · ')}</div></div>`:''}).join('')||'<div class="muted">No players yet.</div>'}</div>`}).join('')}</div>`;
}
function renderPlaybook(){
  document.getElementById('playbook').innerHTML=`<div class="grid" style="grid-template-columns:1fr 1fr"><div class="card"><h2>Draft Commandments</h2><ol>${COMMANDMENTS.map(c=>`<li style="margin:10px 0">${c}</li>`).join('')}</ol></div><div class="card"><h2>Decision Tree</h2><div class="decision-tree"><div class="node">Who gives High Roehler the most expected lineup value now?</div><div class="arrow">↓</div><div class="node">Will waiting likely cost the entire tier?</div><div class="arrow">↓</div><div class="node">Use ADP to judge availability — not value.</div><div class="arrow">↓</div><div class="node">Join or exploit positional runs; never chase automatically.</div><div class="arrow">↓</div><div class="node">Take the best value and stay flexible.</div></div></div></div>`;
}
function renderChat(){
  document.getElementById('chat').innerHTML=`<div class="card"><div class="section-title"><h2>Draft Assistant</h2><div class="muted">Uses the live draft state</div></div><div id="chatLog" class="chat-log">${state.chat.map(x=>`<div class="bubble ${x.role==='user'?'user':'ai'}">${escapeHtml(x.text)}</div>`).join('')}</div><div class="chat-compose"><textarea id="chatInput" placeholder="Why this player? Should I exploit this run?"></textarea><button id="chatSend" class="primary">Send</button></div></div>`;
  document.getElementById('chatSend').onclick=sendChat;
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function getRecommendation(){
  const btn=document.getElementById('recommendBtn');btn.disabled=true;btn.textContent='Thinking…';
  try{const r=await fetch('/api/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshotForAI())});const data=await r.json();if(!r.ok)throw new Error(data.error||'Failed');state.recommendation=data;save();renderWarRoom()}catch(e){alert(e.message)}finally{if(document.getElementById('recommendBtn')){document.getElementById('recommendBtn').disabled=false;document.getElementById('recommendBtn').textContent='Recommend'}}
}
async function sendChat(){
  const input=document.getElementById('chatInput'),message=input.value.trim();if(!message)return;state.chat.push({role:'user',text:message});save();renderChat();
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshotForAI(),message})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Failed');state.chat.push({role:'ai',text:data.answer});save();renderChat()}catch(e){state.chat.push({role:'ai',text:`Error: ${e.message}`});save();renderChat()}
}
function openTargets(){
  const d=document.getElementById('settingsDialog');document.getElementById('settingsBody').innerHTML=`<div class="grid" style="grid-template-columns:repeat(3,1fr)">${POSITIONS.map(p=>`<label>${p}<input style="width:100%;margin-top:5px" type="number" min="0" data-target="${p}" value="${state.targets[p]}"></label>`).join('')}</div><button id="saveTargets" class="primary" style="margin-top:14px">Save</button>`;
  document.getElementById('saveTargets').onclick=()=>{document.querySelectorAll('[data-target]').forEach(i=>state.targets[i.dataset.target]=Number(i.value));save();renderAll();d.close()};d.showModal();
}
function renderAll(){renderWarRoom();renderPlayers();renderDraftBoard();renderPlaybook();renderChat();document.getElementById('keeperBtn').textContent=state.keeperMode?'Exit Keeper Mode':'Keeper Mode';document.getElementById('keeperBtn').classList.toggle('primary',state.keeperMode)}

document.querySelectorAll('nav [data-page]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));document.getElementById(b.dataset.page).classList.add('active');b.classList.add('active')});
document.getElementById('commandmentsBtn').onclick=()=>document.getElementById('commandmentsDialog').showModal();
document.getElementById('commandmentsList').innerHTML=COMMANDMENTS.map(c=>`<li style="margin:10px 0">${c}</li>`).join('');
document.getElementById('keeperBtn').onclick=()=>{state.keeperMode=!state.keeperMode;save();renderAll()};
document.getElementById('resetBtn').onclick=()=>{if(confirm('Reset all draft picks, keepers, recommendations, and chat?')){localStorage.removeItem(STORAGE);location.reload()}};
load();
