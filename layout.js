
const BUILD_VERSION='0.15.1';
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

  if(state.quickSelect){
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
        <div class="your-roster-summary">
          ${positionSummaryText(counts('High Roehler'))}
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
    <div class="section-title draft-board-titlebar">
      <div>
        <h2>Draft Board</h2>
        <div class="muted">Live roster view for the other managers.</div>
      </div>
      <div class="draft-board-global-actions">
        <button type="button" id="collapseAllManagers">Collapse All</button>
        <button type="button" id="expandAllManagers">Expand All</button>
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

  document.getElementById('collapseAllManagers').onclick=()=>{
    ensureDraftBoardState();
    MANAGERS.filter(m=>m!=='High Roehler').forEach(manager=>{
      state.collapsedManagers[manager]=true;
    });
    save();
    renderDraftBoard();
  };

  document.getElementById('expandAllManagers').onclick=()=>{
    ensureDraftBoardState();
    MANAGERS.filter(m=>m!=='High Roehler').forEach(manager=>{
      state.collapsedManagers[manager]=false;
    });
    save();
    renderDraftBoard();
  };
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
   v0.14.0
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


/* ---- Keeper mechanics ---- */

function keeperAtPick(pick){
  if(!state.keepers || !pick) return null;

  const manager = managerForPick(pick);
  const round = roundForPick(pick);
  const keeper = state.keepers[manager];

  if(!keeper?.playerId || Number(keeper.round) !== round){
    return null;
  }

  const player = state.players.find(p => p.id === keeper.playerId);
  if(!player) return null;

  return {manager, round, player, keeper};
}

function clearAppliedKeepers(){
  state.players.forEach(player => {
    if(player.isKeeper){
      player.draftedBy = null;
      player.isKeeper = false;
    }
  });
}

function applySavedKeepers(){
  if(!state.keepers) return;

  MANAGERS.forEach(manager => {
    const keeper = state.keepers[manager];
    if(!keeper?.playerId || !keeper.round) return;

    const player = state.players.find(p => p.id === keeper.playerId);
    if(!player) return;

    player.draftedBy = manager;
    player.isKeeper = true;
  });
}

function advancePastReservedKeeperPicks(){
  let skipped = false;

  while(state.currentPick <= 264 && keeperAtPick(state.currentPick)){
    state.currentPick++;
    skipped = true;
  }

  return skipped;
}

/* Make "next pick" ignore a manager's already-spent keeper selection. */
const nextPickForBeforeKeepers = nextPickFor;
nextPickFor = function(manager, after=state.currentPick){
  for(let pick=after; pick<=264; pick++){
    if(managerForPick(pick) === manager && !keeperAtPick(pick)){
      return pick;
    }
  }
  return null;
};

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
   Quick Select, the Players tab, or manual manager selection. */
const draftPlayerBeforeActivity = draftPlayer;
draftPlayer = function(id,manager,isKeeper=false){
  const player = state.players.find(p => p.id === id);
  const canDraft = !!player && !player.draftedBy;

  draftPlayerBeforeActivity(id,manager,isKeeper);

  if(canDraft && player && player.draftedBy === manager){
    /* The base draft function advances one pick. If that lands on one or
       more keeper-reserved selections, move past them automatically. */
    if(!isKeeper && advancePastReservedKeeperPicks()){
      save();
      renderAll();
    }

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


/* ---- Late-draft required-position warning ---- */

const REQUIRED_ROSTER_POSITIONS = ['QB','RB','WR','TE','DP','D/ST','K'];

function remainingLivePicksFor(manager){
  let remaining=0;

  for(let pick=state.currentPick; pick<=264; pick++){
    if(managerForPick(pick)===manager && !keeperAtPick(pick)){
      remaining++;
    }
  }

  return remaining;
}

function missingRequiredPositions(manager='High Roehler'){
  const c=counts(manager);
  return REQUIRED_ROSTER_POSITIONS.filter(pos => (c[pos]||0)===0);
}

function lateDraftRosterWarning(){
  const picksLeft=remainingLivePicksFor('High Roehler');
  const missing=missingRequiredPositions('High Roehler');

  if(picksLeft>4 || !missing.length){
    return null;
  }

  let level='yellow';
  let lead='ROSTER WARNING';

  if(picksLeft===3){
    level='orange';
  }else if(picksLeft<=2){
    level='red';
  }

  if(picksLeft===1){
    lead='MUST DRAFT';
  }

  return {
    picksLeft,
    missing,
    level,
    lead
  };
}

function rosterWarningHtml(){
  const warning=lateDraftRosterWarning();
  if(!warning) return '';

  const missingText=warning.missing.join(', ');
  const pickWord=warning.picksLeft===1?'pick':'picks';

  return `
    <div class="late-roster-warning ${warning.level}">
      <div class="late-roster-warning-title">⚠ ${warning.lead}</div>
      <div class="late-roster-warning-text">
        ${warning.picksLeft} ${pickWord} remaining · Missing ${missingText}
      </div>
    </div>
  `;
}

/* Make this constraint available to the future AI decision engine too. */
const snapshotForAIBeforeRosterWarning = snapshotForAI;
snapshotForAI = function(){
  const snapshot=snapshotForAIBeforeRosterWarning();
  const warning=lateDraftRosterWarning();

  snapshot.rosterRequirements={
    requiredPositions:[...REQUIRED_ROSTER_POSITIONS],
    missingPositions:missingRequiredPositions('High Roehler'),
    livePicksRemaining:remainingLivePicksFor('High Roehler'),
    lateDraftWarning:warning
  };

  return snapshot;
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
        ${rosterWarningHtml()}
        <div class="your-roster-summary">
          ${positionSummaryText(counts('High Roehler'))}
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

function renderPreDraftSetup(){
  const body=document.getElementById('preDraftBody');
  const order=state.draftOrder||[...MANAGERS];

  if(!state.keepers||typeof state.keepers!=='object'){
    state.keepers={};
  }

  body.innerHTML=`
    <div class="predraft-v13">
      <div class="predraft-v13-top">
        <div class="muted predraft-v13-intro">Set the draft order and keeper assignments before the draft begins.</div>

        <div class="predraft-v13-summary">
          <span id="predraftOrderStatus" class="pill">12/12 managers</span>
          <span id="predraftKeeperStatus" class="pill">0 keepers</span>
        </div>
      </div>

      <div class="predraft-v13-grid">
        <section class="predraft-v13-panel predraft-v13-order">
          <div class="predraft-v13-panel-head predraft-v13-order-head">
            <div>
              <h3>Draft Order</h3>
              <div class="muted">Pick 1 through 12</div>
            </div>
            <div class="predraft-v13-actions">
              <button type="button" id="randomizeDraftOrder">Randomize</button>
              <button type="button" id="resetDraftOrder">Reset</button>
            </div>
          </div>

          <div class="predraft-v13-order-list">
            ${Array.from({length:12},(_,i)=>`
              <label class="predraft-v13-order-row">
                <span class="predraft-v13-pick">${i+1}</span>
                <select data-draft-slot="${i}">
                  ${MANAGERS.map(manager=>`
                    <option value="${manager}" ${order[i]===manager?'selected':''}>${manager}</option>
                  `).join('')}
                </select>
              </label>
            `).join('')}
          </div>

          <div id="draftOrderValidation" class="predraft-validation"></div>
        </section>

        <section class="predraft-v13-panel predraft-v13-keepers">
          <div class="predraft-v13-panel-head">
            <div>
              <h3>Keepers</h3>
              <div class="muted">Optional player and round cost</div>
            </div>
            <button type="button" id="clearKeepers">Clear</button>
          </div>

          <div class="predraft-v13-keeper-list">
            ${MANAGERS.map(manager=>{
              const keeper=state.keepers?.[manager]||{};
              const currentPlayer=state.players.find(p=>p.id===keeper.playerId);

              return `
                <div class="predraft-v13-keeper-row">
                  <div class="predraft-v13-manager">${manager}</div>

                  <div class="predraft-v13-search">
                    <input
                      class="keeper-player-search"
                      data-keeper-search="${manager}"
                      value="${currentPlayer?escapeHtml(currentPlayer.name):''}"
                      placeholder="Search player"
                      autocomplete="off"
                    >
                    <div
                      class="keeper-search-results"
                      data-keeper-results="${manager}"
                    ></div>
                  </div>

                  <input
                    class="keeper-round-input"
                    type="number"
                    min="1"
                    max="22"
                    data-keeper-round="${manager}"
                    value="${keeper.round||''}"
                    placeholder="Rd"
                    aria-label="${manager} keeper round"
                  >
                </div>
              `;
            }).join('')}
          </div>
        </section>
      </div>

      <div class="predraft-v13-footer">
        <div id="predraftSummary" class="muted">Review the setup, then save once.</div>
        <button type="button" id="savePreDraftSetup" class="primary">Save Pre-Draft Setup</button>
      </div>
    </div>
  `;

  const readOrder=()=>[...document.querySelectorAll('[data-draft-slot]')].map(s=>s.value);
  const keeperCount=()=>MANAGERS.filter(m=>state.keepers?.[m]?.playerId).length;

  function validateOrder(){
    const valid=new Set(readOrder()).size===MANAGERS.length;
    const v=document.getElementById('draftOrderValidation');
    const k=keeperCount();

    v.textContent=valid?'12/12 managers assigned · No conflicts':'Each manager must appear exactly once.';
    v.className=`predraft-validation ${valid?'valid':'invalid'}`;

    document.getElementById('predraftOrderStatus').textContent=valid?'12/12 managers':'Order conflict';
    document.getElementById('predraftKeeperStatus').textContent=`${k} keeper${k===1?'':'s'}`;
    document.getElementById('predraftSummary').textContent=valid
      ? `Draft order complete · ${k} keeper${k===1?'':'s'} assigned`
      : 'Fix the draft-order conflict before saving.';

    return valid;
  }

  document.querySelectorAll('[data-draft-slot]').forEach(select=>{
    select.addEventListener('change',validateOrder);
  });

  document.getElementById('randomizeDraftOrder').onclick=()=>{
    const shuffled=[...MANAGERS];
    for(let i=shuffled.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
    document.querySelectorAll('[data-draft-slot]').forEach((select,i)=>{
      select.value=shuffled[i];
    });
    validateOrder();
  };

  document.getElementById('resetDraftOrder').onclick=()=>{
    document.querySelectorAll('[data-draft-slot]').forEach((select,i)=>{
      select.value=MANAGERS[i];
    });
    validateOrder();
  };

  document.querySelectorAll('[data-keeper-search]').forEach(input=>{
    input.addEventListener('input',()=>{
      const manager=input.dataset.keeperSearch;
      const results=document.querySelector(`[data-keeper-results="${manager}"]`);
      const q=input.value.trim().toLowerCase();

      const selectedPlayer=state.keepers?.[manager]?.playerId
        ? state.players.find(p=>p.id===state.keepers[manager].playerId)
        : null;

      if(selectedPlayer&&input.value.trim()!==selectedPlayer.name){
        delete state.keepers[manager].playerId;
      }

      if(!q){
        results.innerHTML='';
        results.classList.remove('open');
        validateOrder();
        return;
      }

      const matches=state.players
        .filter(p=>p.name.toLowerCase().includes(q))
        .slice(0,8);

      results.innerHTML=matches.map(player=>`
        <button
          type="button"
          class="keeper-result"
          data-keeper-player="${player.id}"
          data-keeper-manager="${manager}"
        >
          <b>${player.name}</b>
          <span>${player.position} · ${player.nflTeam}</span>
        </button>
      `).join('');

      results.classList.toggle('open',matches.length>0);

      results.querySelectorAll('[data-keeper-player]').forEach(button=>{
        button.onclick=()=>{
          const selectedManager=button.dataset.keeperManager;
          const playerId=button.dataset.keeperPlayer;
          const player=state.players.find(p=>p.id===playerId);

          state.keepers[selectedManager]={
            ...(state.keepers[selectedManager]||{}),
            playerId
          };

          input.value=player?.name||'';
          results.innerHTML='';
          results.classList.remove('open');
          validateOrder();
        };
      });
    });
  });

  document.getElementById('clearKeepers').onclick=()=>{
    clearAppliedKeepers();
    state.keepers={};
    save();
    renderAll();
    renderPreDraftSetup();
  };

  document.getElementById('savePreDraftSetup').onclick=()=>{
    if(!validateOrder()) return;

    const usedPlayers=new Set();
    let valid=true;
    let message='';

    MANAGERS.forEach(manager=>{
      const keeper=state.keepers[manager];
      const roundInput=document.querySelector(`[data-keeper-round="${manager}"]`);
      const round=Number(roundInput?.value||0);

      if(!keeper?.playerId){
        if(roundInput) roundInput.value='';
        delete state.keepers[manager];
        return;
      }

      if(usedPlayers.has(keeper.playerId)){
        valid=false;
        message='A player cannot be assigned as keeper to more than one manager.';
        return;
      }

      usedPlayers.add(keeper.playerId);

      if(!Number.isInteger(round)||round<1||round>22){
        valid=false;
        message=`${manager} needs a keeper round from 1 through 22.`;
        return;
      }

      keeper.round=round;
    });

    if(!valid){
      alert(message);
      return;
    }

    state.draftOrder=readOrder();
    clearAppliedKeepers();
    applySavedKeepers();
    advancePastReservedKeeperPicks();

    save();
    document.getElementById('preDraftDialog').close();
    renderAll();
  };

  validateOrder();
}
document.getElementById('preDraftBtn').onclick = () => {
  renderPreDraftSetup();
  document.getElementById('preDraftDialog').showModal();
};

/* Re-apply persisted keeper assignments after a refresh/fresh players.json sync. */
if(typeof state !== 'undefined' && state?.players){
  if(state.keepers && Object.keys(state.keepers).length){
    applySavedKeepers();
    advancePastReservedKeeperPicks();
    save();
    renderAll();
  }
}


/* ==========================================================================
   NEW MOCK WORKFLOW — v0.14.0
   ========================================================================== */

function ensureNewMockDialog(){
  let dialog=document.getElementById('newMockDialog');
  if(dialog) return dialog;

  dialog=document.createElement('dialog');
  dialog.id='newMockDialog';
  dialog.innerHTML=`
    <div class="dialog-head">
      <div>
        <h2>Start New Mock</h2>
        <div class="muted">Choose what you want to keep from the current setup.</div>
      </div>
      <button type="button" id="closeNewMockDialog">Close</button>
    </div>

    <div class="new-mock-options">
      <button type="button" class="new-mock-option primary-option" id="newMockKeepSetup">
        <span class="new-mock-option-title">Keep Pre-Draft Setup</span>
        <span class="new-mock-option-text">
          Keep the current draft order and keepers, but clear all live draft picks and start again.
        </span>
      </button>

      <button type="button" class="new-mock-option danger-option" id="newMockResetEverything">
        <span class="new-mock-option-title">Reset Everything</span>
        <span class="new-mock-option-text">
          Clear the draft, draft order, and all keeper assignments for a completely fresh setup.
        </span>
      </button>
    </div>
  `;

  document.body.appendChild(dialog);

  document.getElementById('closeNewMockDialog').onclick=()=>dialog.close();
  document.getElementById('newMockKeepSetup').onclick=()=>{
    dialog.close();
    startNewMock(true);
  };
  document.getElementById('newMockResetEverything').onclick=()=>{
    if(!confirm('Reset the entire mock AND all Pre-Draft setup?')){
      return;
    }
    dialog.close();
    startNewMock(false);
  };

  return dialog;
}

function clearLiveDraftAssignments(){
  state.players.forEach(player=>{
    player.draftedBy=null;
    player.isKeeper=false;
  });

  state.currentPick=1;
  state.history=[];
  state.recommendation=null;
  state.chat=[];

  /* Return the live War Room to its normal starting view. */
  state.warRoomColumns={flexA:'QB',flexB:'TE'};
  state.quickSelect=true;

  /* A new mock should open the Draft Board cleanly collapsed. */
  state.collapsedManagers={};
  state.collapsedBenches={};
  ensureDraftBoardState();

  /* Player-table filters are convenience preferences, not draft state.
     Keep them, but always hide drafted players on a fresh mock. */
  ensurePlayerFilterState();
  state.playerFilters.includeDrafted=false;
}

function startNewMock(keepPreDraftSetup){
  clearLiveDraftAssignments();

  if(keepPreDraftSetup){
    if(!state.keepers || typeof state.keepers!=='object'){
      state.keepers={};
    }

    applySavedKeepers();
    advancePastReservedKeeperPicks();
  }else{
    state.draftOrder=[...MANAGERS];
    state.keepers={};
  }

  save();

  const activity=document.getElementById('draftActivity');
  if(activity){
    activity.textContent='';
    activity.classList.remove('active','fading','undo');
  }

  renderAll();

  showDraftActivity(
    keepPreDraftSetup
      ? 'New mock started · Pre-Draft setup kept'
      : 'New mock started · Pre-Draft setup cleared',
    'draft'
  );
}

function configureNewMockButton(){
  const button=document.getElementById('resetBtn');
  if(!button) return;

  button.textContent='New Mock';
  button.classList.remove('danger');

  button.onclick=()=>{
    ensureNewMockDialog().showModal();
  };
}

/* app.js creates the old Reset Draft handler first; layout.js loads afterward,
   so this intentionally replaces that behavior. */
configureNewMockButton();


/* ==========================================================================
   START LIVE DRAFT — v0.15.1
   ========================================================================== */

function liveDraftIsActive(){
  return state.draftMode === 'live';
}

function liveDraftKeeperCount(){
  return MANAGERS.filter(manager => state.keepers?.[manager]?.playerId).length;
}

function highRoehlerDraftSlot(){
  const index=(state.draftOrder||[]).indexOf('High Roehler');
  return index >= 0 ? index + 1 : null;
}

function firstLivePick(){
  let pick=1;
  while(pick<=264 && keeperAtPick(pick)) pick++;
  return pick;
}

function updateLiveDraftButton(){
  const button=document.getElementById('startLiveDraftBtn');
  if(!button) return;

  if(liveDraftIsActive()){
    button.textContent='Live Draft Active';
    button.disabled=true;
    button.classList.add('live-active');
  }else{
    button.textContent='Start Live Draft';
    button.disabled=false;
    button.classList.remove('live-active');
  }
}

function ensureStartLiveDraftButton(){
  const button=document.getElementById('startLiveDraftBtn');
  if(!button) return;
  button.onclick=()=>openStartLiveDraftDialog();
  updateLiveDraftButton();
}

function ensureStartLiveDraftDialog(){
  let dialog=document.getElementById('startLiveDraftDialog');
  if(dialog) return dialog;
  dialog=document.createElement('dialog');
  dialog.id='startLiveDraftDialog';
  document.body.appendChild(dialog);
  return dialog;
}

function openStartLiveDraftDialog(){
  const dialog=ensureStartLiveDraftDialog();
  const slot=highRoehlerDraftSlot();
  const keeperCount=liveDraftKeeperCount();
  const next=firstLivePick();
  const firstManager=managerForPick(next);

  dialog.innerHTML=`
    <div class="dialog-head">
      <div>
        <h2>Start Live Draft</h2>
        <div class="muted">This clears mock-draft activity and locks in the current Pre-Draft setup.</div>
      </div>
      <button type="button" id="closeStartLiveDraft">Close</button>
    </div>
    <div class="live-draft-checklist">
      <div class="live-draft-check-row"><span>High Roehler draft slot</span><strong>${slot?`Pick ${slot}`:'Not assigned'}</strong></div>
      <div class="live-draft-check-row"><span>Managers assigned</span><strong>${new Set(state.draftOrder||[]).size}/12</strong></div>
      <div class="live-draft-check-row"><span>Keepers configured</span><strong>${keeperCount}</strong></div>
      <div class="live-draft-check-row"><span>First live selection</span><strong>#${next} · ${firstManager}</strong></div>
    </div>
    <div class="live-draft-warning">Starting the live draft will remove all mock selections, history, recommendations, and chat. Your draft order and keepers will be preserved.</div>
    <label class="live-draft-confirm-line"><input type="checkbox" id="liveDraftConfirm"><span>I verified the draft order and keepers.</span></label>
    <div class="live-draft-dialog-actions">
      <button type="button" id="cancelStartLiveDraft">Cancel</button>
      <button type="button" id="confirmStartLiveDraft" class="primary" disabled>Start Live Draft</button>
    </div>`;

  const checkbox=document.getElementById('liveDraftConfirm');
  const confirmButton=document.getElementById('confirmStartLiveDraft');
  checkbox.onchange=()=>{confirmButton.disabled=!checkbox.checked;};
  document.getElementById('closeStartLiveDraft').onclick=()=>dialog.close();
  document.getElementById('cancelStartLiveDraft').onclick=()=>dialog.close();
  confirmButton.onclick=()=>{
    const assigned=new Set(state.draftOrder||[]);
    if(assigned.size!==12 || !(state.draftOrder||[]).includes('High Roehler')){
      alert('The Draft Order must contain all 12 managers exactly once before starting the live draft.');
      return;
    }
    dialog.close();
    startLiveDraft();
  };
  dialog.showModal();
}

function startLiveDraft(){
  clearLiveDraftAssignments();
  state.draftMode='live';
  state.liveDraftStartedAt=new Date().toISOString();
  applySavedKeepers();
  advancePastReservedKeeperPicks();
  save();
  renderAll();
  updateLiveDraftButton();
  const manager=managerForPick(state.currentPick);
  showDraftActivity(`LIVE DRAFT READY · Pick #${state.currentPick}: ${manager}`,'draft');
}

/* Wrap New Mock so live-draft mode gets a stronger warning and is exited cleanly. */
const startNewMockBeforeLiveDraft=startNewMock;
startNewMock=function(keepPreDraftSetup){
  state.draftMode='mock';
  state.liveDraftStartedAt=null;
  startNewMockBeforeLiveDraft(keepPreDraftSetup);
  updateLiveDraftButton();
};

function protectNewMockDuringLiveDraft(){
  const button=document.getElementById('resetBtn');
  if(!button) return;
  button.textContent='New Mock';
  button.classList.remove('danger');
  button.onclick=()=>{
    if(liveDraftIsActive()){
      const proceed=confirm('LIVE DRAFT IS ACTIVE. Starting a new mock will clear the live draft progress. Continue?');
      if(!proceed) return;
    }
    ensureNewMockDialog().showModal();
  };
}

/* Re-bind these static header controls after every render. */
const ensureHeaderDraftControlsBeforeLiveDraft=ensureHeaderDraftControls;
ensureHeaderDraftControls=function(){
  ensureHeaderDraftControlsBeforeLiveDraft();
  ensureStartLiveDraftButton();
  protectNewMockDuringLiveDraft();
};

ensureStartLiveDraftButton();
protectNewMockDuringLiveDraft();
updateLiveDraftButton();

/* Draft War Room — Players Tab Sorting v0.15.2 */
(function(){
  function ensureSortState(){
    ensurePlayerFilterState();
    if(!state.playerFilters.sortBy){
      state.playerFilters.sortBy='rank';
      save();
    }
  }

  function sortPlayers(list,sortBy){
    return list.slice().sort((a,b)=>{
      if(sortBy==='adp'){
        return (Number(a.adp)||9999)-(Number(b.adp)||9999);
      }

      if(sortBy==='posRank'){
        const pa=POSITIONS.indexOf(a.position);
        const pb=POSITIONS.indexOf(b.position);
        if(pa!==pb) return pa-pb;

        const ra=Number(a.posRank)||9999;
        const rb=Number(b.posRank)||9999;
        if(ra!==rb) return ra-rb;

        return (Number(a.adp)||9999)-(Number(b.adp)||9999);
      }

      if(sortBy==='name'){
        return a.name.localeCompare(b.name);
      }

      /* Rank = our board order: tier first, then ADP. */
      const ta=Number(a.tier)||99;
      const tb=Number(b.tier)||99;
      if(ta!==tb) return ta-tb;

      return (Number(a.adp)||9999)-(Number(b.adp)||9999);
    });
  }

  renderPlayers=function(){
    ensurePlayerFilterState();
    ensureSortState();

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

          <div class="players-toolbar players-toolbar-sorted">
            <input id="playerSearch" value="${escapeHtml(f.search)}" placeholder="Search player or NFL team">

            <select id="positionFilter">
              <option value="">All positions</option>
              ${POSITIONS.map(p=>`<option value="${p}" ${f.position===p?'selected':''}>${p}</option>`).join('')}
            </select>

            <select id="tierFilter">
              <option value="">All tiers</option>
              <option value="1" ${f.tier==='1'?'selected':''}>Tier 1</option>
              <option value="2" ${f.tier==='2'?'selected':''}>Tier 2</option>
              <option value="3" ${f.tier==='3'?'selected':''}>Tier 3</option>
              <option value="4+" ${f.tier==='4+'?'selected':''}>Tier 4+</option>
            </select>

            <select id="sortByFilter" aria-label="Sort players">
              <option value="rank" ${f.sortBy==='rank'?'selected':''}>Sort: Rank</option>
              <option value="adp" ${f.sortBy==='adp'?'selected':''}>Sort: ADP</option>
              <option value="posRank" ${f.sortBy==='posRank'?'selected':''}>Sort: Position Rank</option>
              <option value="name" ${f.sortBy==='name'?'selected':''}>Sort: Name</option>
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

    document.getElementById('sortByFilter').addEventListener('change',()=>{
      state.playerFilters.sortBy=document.getElementById('sortByFilter').value;
      save();
      renderPlayerTable();
    });

    document.getElementById('resetFiltersBtn').onclick=()=>{
      state.playerFilters={
        search:'',
        position:'',
        tier:'',
        includeDrafted:false,
        sortBy:'rank'
      };
      save();
      renderPlayers();
    };

    document.getElementById('labelsHelpBtn').onclick=openLabelsGuide;
    renderPlayerTable();
  };

  renderPlayerTable=function(){
    ensurePlayerFilterState();
    ensureSortState();

    const f=state.playerFilters;
    const q=f.search.toLowerCase().trim();
    const searchActive=q.length>0;

    let list=state.players.filter(player=>{
      const tier=Number(player.tier)||99;
      const tierMatch=
        !f.tier ||
        (f.tier==='4+' ? tier>=4 : String(player.tier)===f.tier);

      const positionMatch=
        !f.position || player.position===f.position;

      const searchMatch=
        !q || `${player.name} ${player.nflTeam}`.toLowerCase().includes(q);

      const availabilityMatch=
        !player.draftedBy ||
        f.includeDrafted ||
        (searchActive && searchMatch);

      return tierMatch && positionMatch && searchMatch && availabilityMatch;
    });

    list=sortPlayers(list,f.sortBy).slice(0,400);

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
              <td><div class="player-name-cell"><b>${player.name}</b><span>${player.nflTeam}</span></div></td>
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
        if(!player.draftedBy) openDraftDialog(player);
      };
    });
  };

  ensureSortState();
  if(state.players) renderPlayers();
})();
