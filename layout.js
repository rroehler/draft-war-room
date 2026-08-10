/* Draft War Room layout + draft-speed controls + tier grouping + fresh player-data sync.
   Existing drafting/state logic remains in app.js. */

const manualDraftDialog = openDraftDialog;

function ensureQuickSelectState(){
  if(typeof state.quickSelect!=='boolean'){
    state.quickSelect=true;
    save();
  }
}

function updateQuickSelectButton(){
  const btn=document.getElementById('quickSelectBtn');
  if(!btn)return;
  const enabled=!!state.quickSelect;
  btn.textContent=`Quick Select: ${enabled?'ON':'OFF'}`;
  btn.classList.toggle('quick-on',enabled);
  btn.title=enabled
    ?'Player clicks automatically go to the manager on the clock.'
    :'Player clicks open the manager selection dialog.';
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
    const currentManager=managerForPick(state.currentPick);
    draftPlayer(player.id,currentManager,false);
    return;
  }

  manualDraftDialog(player);
};

/* Wrap each complete tier (label + players) in one visual section. */
function groupWarRoomTiers(){
  document.querySelectorAll('.wr-tier .tier-scroll').forEach(scroll=>{
    const children=Array.from(scroll.children);
    if(!children.length)return;

    const fragment=document.createDocumentFragment();
    let section=null;

    children.forEach(el=>{
      if(el.classList.contains('tier-label')){
        const match=el.textContent.match(/Tier\s*(\d+)/i);
        const tier=match?match[1]:'unrated';

        section=document.createElement('div');
        section.className='tier-section';
        section.dataset.tier=tier;
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

/* Always refresh player metadata from players.json on page load.
   Draft assignments are preserved by player id, so updated tiers/ADP/labels
   can be deployed without private-window/cache workarounds. */
async function syncFreshPlayerData(){
  try{
    const response=await fetch(`players.json?fresh=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`players.json ${response.status}`);
    const freshPlayers=await response.json();

    const savedById=new Map((state.players||[]).map(p=>[p.id,p]));
    state.players=freshPlayers.map(fresh=>{
      const saved=savedById.get(fresh.id);
      return {
        ...fresh,
        draftedBy:saved?.draftedBy??fresh.draftedBy??null,
        isKeeper:saved?.isKeeper??fresh.isKeeper??false
      };
    });

    save();
    renderAll();
  }catch(err){
    console.warn('Could not refresh players.json; using saved player data.',err);
  }
}

renderWarRoom=function(){
  ensureQuickSelectState();

  const cur=managerForPick(state.currentPick);
  const next=nextPickFor('High Roehler',state.currentPick);
  const total=totalCounts();
  const mine=roster('High Roehler');
  const rec=state.recommendation;

  const tierCard=(pos,areaClass)=>`
    <div class="card wr-tier ${areaClass}">
      <div class="section-title">
        <h3>${pos}</h3>
        <span class="tiny">Available</span>
      </div>
      <div class="tier-scroll">
        ${playerRows(pos,40)}
      </div>
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

        ${rec
          ?`<div class="confidence">Confidence ${rec.confidence}%</div>
             <ul class="reason-list">${(rec.reason||[]).map(x=>`<li>${x}</li>`).join('')}</ul>
             ${rec.warning?`<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>`:''}`
          :`<div class="recommendation-empty muted">
               Recommendation details will appear here when the decision engine is connected.
             </div>`}
      </div>

      <div class="card wr-status-card wr-next">
        <div class="muted">High Roehler's Next Pick</div>
        <div class="hero">${next?`#${next}`:'Draft complete'}</div>
        <div>${next?`${Math.max(0,next-state.currentPick)} picks away`:''}</div>
      </div>

      <div class="card wr-summary">
        <div class="section-title">
          <h3>Draft Position Summary</h3>
          <button id="targetsBtn">Edit</button>
        </div>
        <div class="summary">
          ${POSITIONS.map(p=>`<span class="pill"><strong>${p}</strong> ${total[p]}/${state.targets[p]}</span>`).join('')}
        </div>
      </div>

      <div class="card wr-status-card wr-current">
        <div class="muted">Current Pick</div>
        <div class="hero">#${state.currentPick}</div>
        <div>${cur}</div>
        <div class="tiny">Round ${roundForPick(state.currentPick)}</div>
        <div class="quick-status tiny">${state.quickSelect?'Quick Select ON':'Quick Select OFF'}</div>
      </div>

      <div class="card wr-roster">
        <div class="section-title">
          <h3>Your Roster</h3>
          <button id="undoBtn">Undo Pick</button>
        </div>
        ${mine.length
          ?`<div class="roster-list">
              ${POSITIONS.map(pos=>
                mine.filter(p=>p.position===pos)
                  .map(p=>`<div class="roster-line"><span class="pos">${pos}</span><span>${p.name}${p.isKeeper?' <span class="tiny">(Keeper)</span>':''}</span></div>`)
                  .join('')
              ).join('')}
             </div>`
          :'<div class="muted">No players assigned yet.</div>'}
      </div>

      ${tierCard('QB','wr-tier-qb')}
      ${tierCard('RB','wr-tier-rb')}
      ${tierCard('WR','wr-tier-wr')}
      ${tierCard('TE','wr-tier-te')}
    </div>`;

  document.querySelectorAll('#war-room [data-player]').forEach(el=>{
    el.onclick=()=>openDraftDialog(state.players.find(p=>p.id===el.dataset.player));
  });

  document.getElementById('undoBtn').onclick=undo;
  document.getElementById('targetsBtn').onclick=openTargets;
  document.getElementById('recommendBtn').onclick=getRecommendation;

  groupWarRoomTiers();
  ensureHeaderDraftControls();
};

const originalRenderAll=renderAll;
renderAll=function(){
  originalRenderAll();
  ensureHeaderDraftControls();
  groupWarRoomTiers();
};

if(typeof state!=='undefined'&&state){
  ensureQuickSelectState();
  ensureHeaderDraftControls();
  if(state.players)renderWarRoom();

  /* Give app.js a moment to finish its initial localStorage load, then
     reconcile that saved state against the newest deployed players.json. */
  setTimeout(syncFreshPlayerData,50);
}
