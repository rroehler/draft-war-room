
const BUILD_VERSION='0.10.1';
const manualDraftDialog=openDraftDialog;

const STARTER_SLOTS=[
  ['QB',['QB']],
  ['RB',['RB']],['RB',['RB']],
  ['WR',['WR']],['WR',['WR']],['WR',['WR']],
  ['TE',['TE']],
  ['FLEX',['RB','WR','TE']],
  ['DP',['DP']],
  ['D/ST',['D/ST']],
  ['K',['K']]
];

/* ---------- State helpers ---------- */

function ensureQuickSelectState(){
  if(typeof state.quickSelect!=='boolean'){
    state.quickSelect=true;
    save();
  }
}

function ensurePlayerFilterState(){
  if(!state.playerFilters||typeof state.playerFilters!=='object'){
    state.playerFilters={
      search:'',
      position:'',
      tier:'',
      includeDrafted:false
    };
  }
  if(typeof state.playerFilters.includeDrafted!=='boolean'){
    state.playerFilters.includeDrafted=false;
  }
}

function ensureDraftBoardState(){
  if(!state.collapsedManagers||typeof state.collapsedManagers!=='object'){
    state.collapsedManagers={};
  }
  if(!state.collapsedBenches||typeof state.collapsedBenches!=='object'){
    state.collapsedBenches={};
  }

  /* Fresh Draft Board experience: all manager cards and benches collapsed. */
  MANAGERS.filter(m=>m!=='High Roehler').forEach(m=>{
    if(typeof state.collapsedManagers[m]!=='boolean') state.collapsedManagers[m]=true;
    if(typeof state.collapsedBenches[m]!=='boolean') state.collapsedBenches[m]=true;
  });
}

function updateQuickSelectButton(){
  const b=document.getElementById('quickSelectBtn');
  if(!b)return;
  b.textContent=`Quick Select: ${state.quickSelect?'ON':'OFF'}`;
  b.classList.toggle('quick-on',!!state.quickSelect);
}

function ensureHeaderDraftControls(){
  const actions=document.querySelector('.header-actions');
  if(!actions)return;

  if(!document.getElementById('quickSelectBtn')){
    const quick=document.createElement('button');
    quick.id='quickSelectBtn';
    quick.onclick=()=>{
      state.quickSelect=!state.quickSelect;
      save();
      updateQuickSelectButton();
      renderWarRoom();
    };
    actions.prepend(quick);
  }

  if(!document.getElementById('headerUndoBtn')){
    const undoBtn=document.createElement('button');
    undoBtn.id='headerUndoBtn';
    undoBtn.textContent='Undo Pick';
    undoBtn.onclick=()=>undo();
    actions.appendChild(undoBtn);
  }

  updateQuickSelectButton();
}

openDraftDialog=function(player){
  ensureQuickSelectState();

  if(state.quickSelect&&!state.keeperMode){
    draftPlayer(player.id,managerForPick(state.currentPick),false);
    return;
  }

  manualDraftDialog(player);
};

/* ---------- Tier grouping ---------- */

function groupWarRoomTiers(){
  document.querySelectorAll('.wr-tier .tier-scroll').forEach(scroll=>{
    if(scroll.querySelector('.tier-section'))return;

    const children=[...scroll.children];
    if(!children.length)return;

    const fragment=document.createDocumentFragment();
    let section=null;

    children.forEach(el=>{
      if(el.classList.contains('tier-label')){
        const match=el.textContent.match(/Tier\s*(\d+)/i);
        section=document.createElement('div');
        section.className='tier-section';
        section.dataset.tier=match?match[1]:'unrated';
        fragment.appendChild(section);
        section.appendChild(el);
      }else{
        if(!section){
          section=document.createElement('div');
          section.className='tier-section';
          section.dataset.tier='unrated';
          fragment.appendChild(section);
        }
        section.appendChild(el);
      }
    });

    scroll.replaceChildren(fragment);
  });
}

/* ---------- Always refresh deployed players.json ---------- */

async function syncFreshPlayerData(){
  try{
    const response=await fetch(
      `players.json?v=${BUILD_VERSION}&fresh=${Date.now()}`,
      {cache:'no-store'}
    );

    if(!response.ok)return;

    const fresh=await response.json();
    const saved=new Map((state.players||[]).map(p=>[p.id,p]));

    state.players=fresh.map(player=>({
      ...player,
      draftedBy:saved.get(player.id)?.draftedBy??player.draftedBy??null,
      isKeeper:saved.get(player.id)?.isKeeper??player.isKeeper??false
    }));

    save();
    renderAll();
  }catch(err){
    console.warn('Using saved player data.',err);
  }
}

/* ---------- ESPN-style roster rendering ---------- */

function orderedRoster(manager){
  const order=new Map((state.history||[]).map((h,i)=>[h.id,i]));
  return roster(manager).slice().sort(
    (a,b)=>(order.get(a.id)??9999)-(order.get(b.id)??9999)
  );
}

function buildLineup(manager){
  const players=orderedRoster(manager);
  const used=new Set();

  const slots=STARTER_SLOTS.map(([label,eligible])=>({
    label,
    eligible,
    player:null
  }));

  slots.filter(s=>s.label!=='FLEX').forEach(slot=>{
    const player=players.find(p=>
      !used.has(p.id)&&slot.eligible.includes(p.position)
    );

    if(player){
      slot.player=player;
      used.add(player.id);
    }
  });

  const flex=slots.find(s=>s.label==='FLEX');
  const flexPlayer=players.find(p=>
    !used.has(p.id)&&flex.eligible.includes(p.position)
  );

  if(flexPlayer){
    flex.player=flexPlayer;
    used.add(flexPlayer.id);
  }

  return{
    slots,
    bench:players.filter(p=>!used.has(p.id))
  };
}

function slotHtml(label,player){
  return `<div class="lineup-slot ${player?'filled':'empty'}">
    <span class="lineup-pos">${label}</span>
    <span class="lineup-player">${
      player
        ? `${player.name}${player.isKeeper?' <span class="tiny">(K)</span>':''}`
        : 'Empty'
    }</span>
  </div>`;
}

function startersHtml(slots){
  return `<div class="starter-slots">
    ${slots.map(s=>slotHtml(s.label,s.player)).join('')}
  </div>`;
}

function benchHtml(bench){
  return `<div class="bench-slots">
    ${Array.from({length:11},(_,i)=>slotHtml('BE',bench[i])).join('')}
  </div>`;
}

function rosterCardHtml(manager,benchCollapsed=false){
  const {slots,bench}=buildLineup(manager);

  return `<div class="espn-lineup">
    ${startersHtml(slots)}

    <div class="bench-divider">
      <span>Bench</span>
      <span>${Math.min(bench.length,11)}/11</span>
    </div>

    <div class="bench-body ${benchCollapsed?'collapsed':''}">
      ${benchHtml(bench)}
    </div>
  </div>`;
}

/* ---------- War Room ---------- */

renderWarRoom=function(){
  ensureQuickSelectState();

  const currentManager=managerForPick(state.currentPick);
  const nextPick=nextPickFor('High Roehler',state.currentPick);
  const totals=totalCounts();
  const rec=state.recommendation;

  const tierCard=(pos,areaClass)=>`
    <div class="card wr-tier ${areaClass}">
      <div class="section-title">
        <h3>${pos}</h3>
        <span class="tiny">Available</span>
      </div>
      <div class="tier-scroll">${playerRows(pos,40)}</div>
    </div>`;

  document.getElementById('war-room').innerHTML=`
    <div class="war-room-layout">
      <div class="card wr-recommendation">
        <div class="section-title">
          <div>
            <div class="muted">Recommendation</div>
            <div class="rec-name">${rec?.recommendation||'—'}</div>
          </div>
          <button id="recommendBtn" class="primary">Recommend</button>
        </div>
        ${
          rec
            ? `<div class="confidence">Confidence ${rec.confidence}%</div>
               <ul class="reason-list">${(rec.reason||[]).map(x=>`<li>${x}</li>`).join('')}</ul>
               ${rec.warning?`<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>`:''}`
            : `<div class="recommendation-empty muted">Recommendation details will appear here when the decision engine is connected.</div>`
        }
      </div>

      <div class="card wr-status-card wr-next">
        <div class="muted">High Roehler's Next Pick</div>
        <div class="hero">${nextPick?`#${nextPick}`:'Draft complete'}</div>
        <div>${nextPick?`${Math.max(0,nextPick-state.currentPick)} picks away`:''}</div>
      </div>

      <div class="card wr-summary">
        <div class="section-title">
          <h3>Draft Position Summary</h3>
          <button id="targetsBtn">Edit</button>
        </div>
        <div class="summary">
          ${POSITIONS.map(p=>`<span class="pill"><strong>${p}</strong> ${totals[p]}/${state.targets[p]}</span>`).join('')}
        </div>
      </div>

      <div class="card wr-status-card wr-current">
        <div class="muted">Current Pick</div>
        <div class="hero">#${state.currentPick}</div>
        <div>${currentManager}</div>
        <div class="tiny">Round ${roundForPick(state.currentPick)}</div>
        <div class="quick-status tiny">${state.quickSelect?'Quick Select ON':'Quick Select OFF'}</div>
      </div>

      <div class="card wr-roster">
        <div class="section-title">
          <h3>Your Roster</h3>
          <button id="undoBtn">Undo Pick</button>
        </div>
        ${rosterCardHtml('High Roehler',false)}
      </div>

      ${tierCard('QB','wr-tier-qb')}
      ${tierCard('RB','wr-tier-rb')}
      ${tierCard('WR','wr-tier-wr')}
      ${tierCard('TE','wr-tier-te')}
    </div>`;

  document.querySelectorAll('#war-room [data-player]').forEach(el=>{
    el.onclick=()=>openDraftDialog(
      state.players.find(p=>p.id===el.dataset.player)
    );
  });

  document.getElementById('undoBtn').onclick=undo;
  document.getElementById('targetsBtn').onclick=openTargets;
  document.getElementById('recommendBtn').onclick=getRecommendation;

  groupWarRoomTiers();
  ensureHeaderDraftControls();
};

/* ---------- Players tab ---------- */

const LABEL_GUIDE=[
  ['Elite / Must Draft','Top-end player we are comfortable taking at or slightly ahead of market price.'],
  ['Target / Strong Target','Player we actively want when the price is reasonable.'],
  ['Fair Value / Solid Value','Good selection at expected cost; no need to reach.'],
  ['Only If They Fall','Interesting player, but only when available below normal draft price.'],
  ['Avoid at ADP','We dislike the current price more than we dislike the player.'],
  ['Depth','Later-round roster depth rather than a priority selection.']
];

function openLabelsGuide(){
  const dialog=document.getElementById('labelsDialog');

  document.getElementById('labelsGuide').innerHTML=`
    <div class="label-guide-list">
      ${LABEL_GUIDE.map(([name,desc])=>`
        <div class="label-guide-row">
          <span class="label-badge label-neutral">${name}</span>
          <span>${desc}</span>
        </div>`).join('')}
    </div>`;

  dialog.showModal();
}

function resetPlayerFilters(){
  ensurePlayerFilterState();

  state.playerFilters={
    search:'',
    position:'',
    tier:'',
    includeDrafted:false
  };

  save();
  renderPlayers();
}

function syncFiltersFromControls(){
  ensurePlayerFilterState();

  state.playerFilters.search=document.getElementById('playerSearch')?.value||'';
  state.playerFilters.position=document.getElementById('positionFilter')?.value||'';
  state.playerFilters.tier=document.getElementById('tierFilter')?.value||'';
  state.playerFilters.includeDrafted=!!document.getElementById('includeDrafted')?.checked;

  save();
  renderPlayerTable();
}

function tierBadge(tier){
  const t=String(tier||'').trim();
  return t
    ? `<span class="tier-badge tier-${t}">${t}</span>`
    : '—';
}

function labelBadge(label){
  const text=label||'Unrated';
  const key=text.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  return `<span class="label-badge label-${key}">${text}</span>`;
}

renderPlayers=function(){
  ensurePlayerFilterState();
  const f=state.playerFilters;

  document.getElementById('players').innerHTML=`
    <div class="players-shell">
      <div class="card players-card">
        <div class="section-title players-title">
          <div>
            <h2>Available Players</h2>
            <div class="muted">Click a player to assign the pick</div>
          </div>
          <button id="labelsHelpBtn">What do Our Labels mean?</button>
        </div>

        <div class="players-toolbar">
          <input id="playerSearch" value="${escapeHtml(f.search)}" placeholder="Search player or NFL team">

          <select id="positionFilter">
            <option value="">All positions</option>
            ${POSITIONS.map(p=>`
              <option value="${p}" ${f.position===p?'selected':''}>${p}</option>
            `).join('')}
          </select>

          <select id="tierFilter">
            <option value="">All tiers</option>
            <option value="1" ${f.tier==='1'?'selected':''}>Tier 1</option>
            <option value="2" ${f.tier==='2'?'selected':''}>Tier 2</option>
            <option value="3" ${f.tier==='3'?'selected':''}>Tier 3</option>
            <option value="4+" ${f.tier==='4+'?'selected':''}>Tier 4+</option>
          </select>

          <label class="drafted-toggle">
            <input type="checkbox" id="includeDrafted" ${f.includeDrafted?'checked':''}>
            <span>Include already drafted</span>
          </label>

          <button id="resetFiltersBtn">Reset Filters</button>
        </div>

        <div class="player-table-wrap">
          <div id="playerTable"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('playerSearch').addEventListener('input',syncFiltersFromControls);
  document.getElementById('positionFilter').addEventListener('input',syncFiltersFromControls);
  document.getElementById('tierFilter').addEventListener('input',syncFiltersFromControls);
  document.getElementById('includeDrafted').addEventListener('change',syncFiltersFromControls);

  document.getElementById('resetFiltersBtn').onclick=resetPlayerFilters;
  document.getElementById('labelsHelpBtn').onclick=openLabelsGuide;

  renderPlayerTable();
}

renderPlayerTable=function(){
  ensurePlayerFilterState();

  const f=state.playerFilters;
  const q=f.search.toLowerCase().trim();
  const searchActive=q.length>0;

  const list=state.players
    .filter(player=>{
      const tier=Number(player.tier)||99;

      const tierMatch=
        !f.tier ||
        (f.tier==='4+' ? tier>=4 : String(player.tier)===f.tier);

      const positionMatch=
        !f.position || player.position===f.position;

      const searchMatch=
        !q ||
        `${player.name} ${player.nflTeam}`.toLowerCase().includes(q);

      /* Default: drafted players hidden.
         Exception: if search text matches them, show them so the user can see who drafted them.
         Or show all when the checkbox is checked. */
      const availabilityMatch=
        !player.draftedBy ||
        f.includeDrafted ||
        (searchActive && searchMatch);

      return tierMatch && positionMatch && searchMatch && availabilityMatch;
    })
    .sort((a,b)=>(Number(a.adp)||999)-(Number(b.adp)||999))
    .slice(0,400);

  document.getElementById('playerTable').innerHTML=`
    <table class="table players-table">
      <colgroup>
        <col class="col-player">
        <col class="col-pos">
        <col class="col-tier">
        <col class="col-adp">
        <col class="col-label">
        <col class="col-status">
      </colgroup>

      <thead>
        <tr>
          <th>Player</th>
          <th>POS</th>
          <th>Tier</th>
          <th>ADP</th>
          <th>Our Label</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        ${list.map(player=>`
          <tr data-player="${player.id}" class="${player.draftedBy?'drafted-row':''}">
            <td>
              <div class="player-name-cell">
                <b>${player.name}</b>
                <span>${player.nflTeam}</span>
              </div>
            </td>
            <td class="center-cell">${player.position}</td>
            <td class="center-cell">${tierBadge(player.tier)}</td>
            <td class="center-cell">${player.adp||'—'}</td>
            <td>${labelBadge(player.ourLabel)}</td>
            <td>${player.draftedBy?`${player.draftedBy}${player.isKeeper?' (K)':''}`:'Available'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  document.querySelectorAll('#playerTable [data-player]').forEach(el=>{
    el.onclick=()=>{
      const player=state.players.find(p=>p.id===el.dataset.player);
      if(!player.draftedBy)openDraftDialog(player);
    };
  });
};

/* ---------- Draft Board ---------- */

function toggleManagerCard(manager){
  ensureDraftBoardState();

  state.collapsedManagers[manager]=!state.collapsedManagers[manager];
  save();
  renderDraftBoard();
}

function toggleManagerBench(manager){
  ensureDraftBoardState();

  state.collapsedBenches[manager]=!state.collapsedBenches[manager];
  save();
  renderDraftBoard();
}

renderDraftBoard=function(){
  ensureDraftBoardState();

  const others=MANAGERS.filter(m=>m!=='High Roehler');

  document.getElementById('draft-board').innerHTML=`
    <div class="section-title">
      <div>
        <h2>Draft Board</h2>
        <div class="muted">Live roster view for the other managers.</div>
      </div>
    </div>

    <div class="grid board-grid lineup-board">
      ${others.map(manager=>{
        const managerCollapsed=!!state.collapsedManagers[manager];
        const benchCollapsed=!!state.collapsedBenches[manager];
        const lineup=buildLineup(manager);

        return `
          <div class="card manager-card lineup-manager-card ${managerCollapsed?'collapsed':''}">
            <div class="manager-card-head">
              <div class="manager-head-row">
                <h3>${manager}</h3>
                <button
                  type="button"
                  class="collapse-manager-btn"
                  data-manager="${manager}"
                >
                  ${managerCollapsed?'Expand ▼':'Collapse ▲'}
                </button>
              </div>

              <div class="manager-summary">
                ${positionSummaryText(counts(manager))}
              </div>
            </div>

            <div class="manager-lineup-body">
              <div class="espn-lineup">
                ${startersHtml(lineup.slots)}

                <div class="bench-divider bench-divider-control">
                  <span>Bench · ${Math.min(lineup.bench.length,11)}/11</span>
                  <button
                    type="button"
                    class="collapse-bench-btn"
                    data-manager="${manager}"
                  >
                    ${benchCollapsed?'Show Bench ▼':'Hide Bench ▲'}
                  </button>
                </div>

                <div class="bench-body ${benchCollapsed?'collapsed':''}">
                  ${benchHtml(lineup.bench)}
                </div>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  document.querySelectorAll('.collapse-manager-btn').forEach(btn=>{
    btn.onclick=()=>toggleManagerCard(btn.dataset.manager);
  });

  document.querySelectorAll('.collapse-bench-btn').forEach(btn=>{
    btn.onclick=()=>toggleManagerBench(btn.dataset.manager);
  });
};

/* ---------- Keep overrides active ---------- */

const baseRenderAll=renderAll;

renderAll=function(){
  baseRenderAll();
  renderPlayers();
  renderDraftBoard();
  ensureHeaderDraftControls();
  groupWarRoomTiers();
};

if(typeof state!=='undefined'&&state){
  ensureQuickSelectState();
  ensurePlayerFilterState();
  ensureDraftBoardState();
  ensureHeaderDraftControls();

  if(state.players){
    renderWarRoom();
    renderPlayers();
    renderDraftBoard();
  }

  setTimeout(syncFreshPlayerData,50);
}


/* ========================================================================
   v0.10.1
   Flexible War Room columns + temporary draft activity confirmation
   ======================================================================== */

const FLEX_COLUMN_OPTIONS = ['QB','TE','DP','D/ST','K'];

function ensureWarRoomColumnState(){
  if(!state.warRoomColumns || typeof state.warRoomColumns !== 'object'){
    state.warRoomColumns = {flexA:'QB', flexB:'TE'};
  }

  if(!FLEX_COLUMN_OPTIONS.includes(state.warRoomColumns.flexA)){
    state.warRoomColumns.flexA = 'QB';
  }

  if(!FLEX_COLUMN_OPTIONS.includes(state.warRoomColumns.flexB)){
    state.warRoomColumns.flexB = 'TE';
  }
}

function flexibleColumnSelect(slotKey,currentValue){
  return `<select class="wr-column-select" data-column-slot="${slotKey}" aria-label="Choose position for this War Room column">
    ${FLEX_COLUMN_OPTIONS.map(pos =>
      `<option value="${pos}" ${currentValue===pos?'selected':''}>${pos}</option>`
    ).join('')}
  </select>`;
}

function flexibleTierCard(pos,areaClass,slotKey=null){
  return `<div class="card wr-tier ${areaClass}">
    <div class="section-title">
      ${slotKey ? flexibleColumnSelect(slotKey,pos) : `<h3>${pos}</h3>`}
      <span class="tiny">Available</span>
    </div>
    <div class="tier-scroll">${playerRows(pos,40)}</div>
  </div>`;
}

function updateWarRoomColumn(slotKey,value){
  ensureWarRoomColumnState();
  state.warRoomColumns[slotKey] = value;
  save();
  renderWarRoom();
}

/* ---- Draft activity confirmation ---- */

let draftActivityFadeTimer = null;
let draftActivityClearTimer = null;

function showDraftActivity(message,type='draft'){
  const bar = document.getElementById('draftActivity');
  if(!bar) return;

  clearTimeout(draftActivityFadeTimer);
  clearTimeout(draftActivityClearTimer);

  bar.textContent = message;
  bar.classList.remove('fading','undo');
  if(type === 'undo') bar.classList.add('undo');

  /* Restart the appearance animation even when picks come rapidly. */
  bar.classList.remove('active');
  void bar.offsetWidth;
  bar.classList.add('active');

  draftActivityFadeTimer = setTimeout(() => {
    bar.classList.add('fading');
  }, 4500);

  draftActivityClearTimer = setTimeout(() => {
    bar.classList.remove('active','fading','undo');
    bar.textContent = '';
  }, 5000);
}

/* Capture every successful pick, regardless of whether it came from
   Quick Select, the Players tab, Keeper Mode, or manual manager selection. */
const draftPlayerBeforeActivity = draftPlayer;
draftPlayer = function(id,manager,isKeeper=false){
  const player = state.players.find(p => p.id === id);
  const canDraft = !!player && !player.draftedBy;

  draftPlayerBeforeActivity(id,manager,isKeeper);

  if(canDraft && player && player.draftedBy === manager){
    showDraftActivity(
      `${manager} drafted ${player.name}, ${player.position}`,
      'draft'
    );
  }
};

const undoBeforeActivity = undo;
undo = function(){
  const last = state.history?.[state.history.length - 1];
  const player = last ? state.players.find(p => p.id === last.id) : null;
  const manager = last?.manager;

  undoBeforeActivity();

  if(last && player && manager){
    showDraftActivity(
      `Pick undone: ${manager} — ${player.name}, ${player.position}`,
      'undo'
    );
  }
};

/* Replace only the War Room renderer. Players and Draft Board remain v0.9.0 behavior. */
renderWarRoom = function(){
  ensureQuickSelectState();
  ensureWarRoomColumnState();

  const currentManager = managerForPick(state.currentPick);
  const nextPick = nextPickFor('High Roehler',state.currentPick);
  const totals = totalCounts();
  const rec = state.recommendation;
  const flexA = state.warRoomColumns.flexA;
  const flexB = state.warRoomColumns.flexB;

  document.getElementById('war-room').innerHTML = `
    <div class="war-room-layout">
      <div class="card wr-recommendation">
        <div class="section-title">
          <div>
            <div class="muted">Recommendation</div>
            <div class="rec-name">${rec?.recommendation||'—'}</div>
          </div>
          <button id="recommendBtn" class="primary">Recommend</button>
        </div>

        ${
          rec
            ? `<div class="confidence">Confidence ${rec.confidence}%</div>
               <ul class="reason-list">${(rec.reason||[]).map(x=>`<li>${x}</li>`).join('')}</ul>
               ${rec.warning?`<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>`:''}`
            : `<div class="recommendation-empty muted">Recommendation details will appear here when the decision engine is connected.</div>`
        }
      </div>

      <div class="card wr-status-card wr-next">
        <div class="muted">High Roehler's Next Pick</div>
        <div class="hero">${nextPick?`#${nextPick}`:'Draft complete'}</div>
        <div>${nextPick?`${Math.max(0,nextPick-state.currentPick)} picks away`:''}</div>
      </div>

      <div class="card wr-summary">
        <div class="section-title">
          <h3>Draft Position Summary</h3>
          <button id="targetsBtn">Edit</button>
        </div>
        <div class="summary">
          ${POSITIONS.map(p=>`<span class="pill"><strong>${p}</strong> ${totals[p]}/${state.targets[p]}</span>`).join('')}
        </div>
      </div>

      <div class="card wr-status-card wr-current">
        <div class="muted">Current Pick</div>
        <div class="hero">#${state.currentPick}</div>
        <div>${currentManager}</div>
        <div class="tiny">Round ${roundForPick(state.currentPick)}</div>
        <div class="quick-status tiny">${state.quickSelect?'Quick Select ON':'Quick Select OFF'}</div>
      </div>

      <div class="card wr-roster">
        <div class="section-title">
          <h3>Your Roster</h3>
          <button id="undoBtn">Undo Pick</button>
        </div>
        ${rosterCardHtml('High Roehler',false)}
      </div>

      ${flexibleTierCard('WR','wr-tier-wr')}
      ${flexibleTierCard('RB','wr-tier-rb')}
      ${flexibleTierCard(flexA,'wr-tier-qb','flexA')}
      ${flexibleTierCard(flexB,'wr-tier-te','flexB')}
    </div>`;

  document.querySelectorAll('#war-room [data-player]').forEach(el=>{
    el.onclick=()=>openDraftDialog(
      state.players.find(p=>p.id===el.dataset.player)
    );
  });

  document.querySelectorAll('.wr-column-select').forEach(select=>{
    select.addEventListener('change',()=>{
      updateWarRoomColumn(select.dataset.columnSlot,select.value);
    });
  });

  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('targetsBtn').onclick = openTargets;
  document.getElementById('recommendBtn').onclick = getRecommendation;

  groupWarRoomTiers();
  ensureHeaderDraftControls();
};

/* Ensure an existing saved draft gets the default QB / TE pair on first v0.10 load. */
if(typeof state !== 'undefined' && state){
  ensureWarRoomColumnState();
  save();
  if(state.players) renderWarRoom();
}
