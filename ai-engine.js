/* ==========================================================================
   Draft War Room — AI Decision Engine v1
   Fast-track version for 2026 draft week.
   ========================================================================== */

(function(){
  const AI_API_BASE = String(window.DWR_AI_API_BASE || '').replace(/\/+$/,'');

  function compactPlayer(p){
    return {
      id:p.id,
      name:p.name,
      team:p.nflTeam,
      pos:p.position,
      tier:p.tier || null,
      adp:p.adp || null,
      label:p.ourLabel || 'Unrated',
      keeper:!!p.isKeeper
    };
  }

  function sortAvailable(a,b){
    const ta=Number(a.tier)||99, tb=Number(b.tier)||99;
    if(ta!==tb) return ta-tb;
    return (Number(a.adp)||9999)-(Number(b.adp)||9999);
  }

  function currentKeeperSummary(){
    const result=[];
    if(!state.keepers) return result;

    for(const manager of MANAGERS){
      const keeper=state.keepers[manager];
      if(!keeper?.playerId) continue;
      const player=state.players.find(p=>p.id===keeper.playerId);
      if(!player) continue;
      result.push({
        manager,
        round:Number(keeper.round)||null,
        player:compactPlayer(player)
      });
    }
    return result;
  }

  function recentDraftPicks(limit=24){
    return (state.history||[]).slice(-limit).map((h,index)=>{
      const p=state.players.find(x=>x.id===h.id);
      return {
        manager:h.manager,
        player:p?.name || h.id,
        pos:p?.position || null,
        tier:p?.tier || null,
        adp:p?.adp || null,
        keeper:!!h.isKeeper
      };
    });
  }

  function recentPositionRun(){
    const recent=recentDraftPicks(12);
    const counts=Object.fromEntries(POSITIONS.map(p=>[p,0]));
    recent.forEach(p=>{
      if(p.pos && counts[p.pos]!==undefined) counts[p.pos]++;
    });
    return counts;
  }

  function opponentRosterCounts(){
    return Object.fromEntries(
      MANAGERS
        .filter(m=>m!=='High Roehler')
        .map(m=>[m,counts(m)])
    );
  }

  function relevantAvailablePlayers(){
    const all=state.players.filter(p=>!p.draftedBy).slice().sort(sortAvailable);
    const chosen=new Map();

    /* Broad overall board */
    all.slice(0,100).forEach(p=>chosen.set(p.id,p));

    /* Guarantee useful positional depth, even late in the draft. */
    const limits={QB:16,RB:28,WR:32,TE:16,DP:14,'D/ST':12,K:12};

    for(const [pos,limit] of Object.entries(limits)){
      all.filter(p=>p.position===pos).slice(0,limit).forEach(p=>chosen.set(p.id,p));
    }

    return [...chosen.values()].sort(sortAvailable).map(compactPlayer);
  }

  function picksBeforeNextUserPick(){
    const next = nextPickFor('High Roehler',state.currentPick);
    if(!next) return [];

    const result=[];
    for(let pick=state.currentPick; pick<next && pick<=264; pick++){
      result.push({
        pick,
        round:roundForPick(pick),
        manager:managerForPick(pick),
        reservedKeeper:typeof keeperAtPick==='function' ? !!keeperAtPick(pick) : false
      });
    }
    return result;
  }

  function enhancedSnapshotForAI(){
    const nextUserPick=nextPickFor('High Roehler',state.currentPick);
    const currentManager=managerForPick(state.currentPick);
    const myCounts=counts('High Roehler');

    const missing = typeof missingRequiredPositions==='function'
      ? missingRequiredPositions('High Roehler')
      : POSITIONS.filter(pos=>(myCounts[pos]||0)===0);

    const livePicksRemaining = typeof remainingLivePicksFor==='function'
      ? remainingLivePicksFor('High Roehler')
      : null;

    return {
      league:{
        platform:'ESPN',
        teams:12,
        scoring:'Full PPR',
        snake:true,
        starters:{QB:1,RB:2,WR:3,TE:1,FLEX:1,DP:1,'D/ST':1,K:1},
        benchSlots:11,
        rosterTargets:{...state.targets},
        requiredAtLeastOne:['QB','RB','WR','TE','DP','D/ST','K'],
        keeperRule:'One keeper from round 4 or later with a two-round penalty; waiver keeper costs round 10. Pre-Draft state contains the actual announced keeper and cost.'
      },

      strategy:{
        team:'High Roehler',
        commandments:[...COMMANDMENTS],
        priorities:[
          'Use tiers and our board to determine value; use ADP mainly to estimate whether a player will survive.',
          'Do not force a preset positional round plan.',
          'Three starting WR plus FLEX makes WR depth important, but do not pass superior value.',
          'Do not chase runs automatically; decide whether to join or exploit them.',
          'Late in the draft, every required position must be filled at least once.',
          'Past manager tendencies are weak evidence only; do not assume this year repeats prior drafts.'
        ]
      },

      draft:{
        mode:state.draftMode || 'mock',
        currentPick:state.currentPick,
        currentRound:roundForPick(state.currentPick),
        currentManager,
        draftOrder:[...state.draftOrder],
        nextUserPick,
        picksUntilUser:nextUserPick ? Math.max(0,nextUserPick-state.currentPick) : null,
        managersBeforeNextUserPick:picksBeforeNextUserPick(),
        recentPicks:recentDraftPicks(24),
        recent12PositionCounts:recentPositionRun(),
        keepers:currentKeeperSummary()
      },

      highRoehler:{
        roster:roster('High Roehler').map(compactPlayer),
        counts:myCounts,
        missingRequiredPositions:missing,
        livePicksRemaining
      },

      opponents:{
        rosterCounts:opponentRosterCounts()
      },

      availablePlayers:relevantAvailablePlayers()
    };
  }

  /* Override the original lightweight snapshot. */
  snapshotForAI = enhancedSnapshotForAI;

  async function callAI(payload){
    if(!AI_API_BASE || AI_API_BASE.includes('YOUR-VERCEL-PROJECT')){
      throw new Error('AI backend URL is not configured yet. Update config.js after the Vercel deployment.');
    }

    const response=await fetch(`${AI_API_BASE}/api/assistant`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });

    let data={};
    try{
      data=await response.json();
    }catch{
      throw new Error(`AI backend returned HTTP ${response.status}.`);
    }

    if(!response.ok){
      throw new Error(data.error || `AI request failed (${response.status}).`);
    }

    return data;
  }

  getRecommendation = async function(){
    const btn=document.getElementById('recommendBtn');
    if(btn){
      btn.disabled=true;
      btn.textContent='Thinking…';
    }

    try{
      const data=await callAI({
        mode:'recommend',
        state:snapshotForAI()
      });

      state.recommendation=data;
      save();
      renderWarRoom();
    }catch(error){
      alert(error.message);
    }finally{
      const current=document.getElementById('recommendBtn');
      if(current){
        current.disabled=false;
        current.textContent='Recommend';
      }
    }
  };

  sendChat = async function(){
    const input=document.getElementById('chatInput');
    const message=input?.value.trim();
    if(!message) return;

    state.chat.push({role:'user',text:message});
    save();
    renderChat();

    try{
      const data=await callAI({
        mode:'chat',
        state:snapshotForAI(),
        message
      });

      state.chat.push({role:'ai',text:data.answer});
    }catch(error){
      state.chat.push({role:'ai',text:`Error: ${error.message}`});
    }

    save();
    renderChat();
  };

  console.log('Draft War Room AI Decision Engine v1 loaded.');
})();
