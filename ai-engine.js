/* ==========================================================================
   Draft War Room — AI Decision Engine v1.3 / app v0.16.0
   Roster-aware + keeper-aware + positional-depletion intelligence.
   ========================================================================== */

(function(){
  const AI_API_BASE=String(window.DWR_AI_API_BASE||'').replace(/\/+$/,'');
  const USER='High Roehler';

  function compactPlayer(player){
    return {
      id:player.id,
      name:player.name,
      team:player.nflTeam,
      pos:player.position,
      rank:Number(player.rank)||null,
      posRank:Number(player.posRank)||null,
      tier:Number(player.tier)||null,
      adp:Number(player.adp)||null,
      label:player.ourLabel||'Unrated',
      keeper:!!player.isKeeper
    };
  }

  function recentDraftPicks(limit=24){
    return (state.history||[])
      .filter(entry=>!entry.isKeeper)
      .slice(-limit)
      .map(entry=>{
        const player=(state.players||[]).find(p=>p.id===entry.id);
        return {
          manager:entry.manager,
          player:player?.name||entry.id,
          pos:player?.position||null,
          rank:Number(player?.rank)||null,
          tier:Number(player?.tier)||null,
          adp:Number(player?.adp)||null
        };
      });
  }

  function currentKeeperSummary(){
    const result=[];
    if(!state.keepers) return result;

    for(const manager of MANAGERS){
      const keeper=state.keepers[manager];
      if(!keeper?.playerId) continue;

      const player=(state.players||[]).find(p=>p.id===keeper.playerId);
      if(!player) continue;

      result.push({
        manager,
        round:Number(keeper.round)||null,
        player:compactPlayer(player)
      });
    }

    return result;
  }

  function opponentRosterCounts(){
    return Object.fromEntries(
      MANAGERS
        .filter(manager=>manager!==USER)
        .map(manager=>[manager,counts(manager)])
    );
  }

  function fallbackAvailablePlayers(){
    return (state.players||[])
      .filter(player=>!player.draftedBy)
      .slice()
      .sort((a,b)=>(Number(a.rank)||9999)-(Number(b.rank)||9999))
      .slice(0,130)
      .map(compactPlayer);
  }

  function buildSnapshot(){
    const intelligence=typeof window.DWR_buildDraftIntelligence==='function'
      ? window.DWR_buildDraftIntelligence()
      : null;

    const turn=typeof window.DWR_getUserTurnContext==='function'
      ? window.DWR_getUserTurnContext()
      : null;

    const decisionCandidates=intelligence?.decisionCandidates?.length
      ? intelligence.decisionCandidates
      : fallbackAvailablePlayers();

    let intelligenceSummary=null;

    if(intelligence){
      const {decisionCandidates:ignored,...rest}=intelligence;
      intelligenceSummary=rest;
    }

    return {
      league:{
        platform:'ESPN',
        teams:12,
        scoring:'Full PPR',
        snake:true,
        starters:{
          QB:1,
          RB:2,
          WR:3,
          TE:1,
          FLEX:1,
          DP:1,
          'D/ST':1,
          K:1
        },
        flexEligible:['RB','WR','TE'],
        benchSlots:11,
        rosterTargets:{...(state.targets||{})},
        keeperRule:'One keeper from round 4 or later with a two-round penalty; waiver pickup costs round 10. Keeper selections occupy their reserved round and are not live draft picks.'
      },

      strategy:{
        team:USER,
        commandments:[...COMMANDMENTS],
        decisionHierarchy:[
          'Hard draft/lineup feasibility and valid availability first.',
          'Marginal lineup value and roster construction second: fixed starter > FLEX > bench depth unless a real value/tier exception justifies deviating.',
          'Keeper leverage matters: a premium keeper at a one-starter position sharply lowers the marginal value of spending early capital at that same position.',
          'Overall Rank is the baseline cross-position board, but it is not an autopick list. Dynamic roster fit can override small rank differences.',
          'Tier cliffs and positional depletion matter more than tiny Overall Rank gaps.',
          'ADP estimates market timing only. It is not player value.',
          'Observed runs and opponent roster needs are evidence, not certainty.'
        ],
        formatSpecific:[
          'This is a 3-WR full-PPR league. WR has three fixed starting slots before FLEX; one rostered WR does not mean WR is covered.',
          'Do not repeatedly add RB depth while multiple WR fixed starter slots remain open unless the RB represents a genuine tier/value exception.',
          'QB and TE are one-starter positions. Once filled by a strong option, early duplication has high opportunity cost.',
          'DP, D/ST, and K are required by the end, but normally should not displace core offensive value early or in the middle rounds.'
        ]
      },

      draft:{
        mode:state.draftMode||'mock',
        currentPick:state.currentPick,
        currentRound:roundForPick(state.currentPick),
        currentManager:managerForPick(state.currentPick),
        draftOrder:[...state.draftOrder],
        userTurn:turn,
        recentPicks:recentDraftPicks(24),
        keepers:currentKeeperSummary()
      },

      highRoehler:{
        roster:roster(USER).map(compactPlayer),
        counts:counts(USER)
      },

      opponents:{
        rosterCounts:opponentRosterCounts()
      },

      intelligence:intelligenceSummary,

      /* The backend may recommend only an exact name from this list. */
      availablePlayers:decisionCandidates
    };
  }

  snapshotForAI=buildSnapshot;

  async function callAI(payload){
    if(!AI_API_BASE||AI_API_BASE.includes('YOUR-VERCEL-PROJECT')){
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
      throw new Error(data.error||`AI request failed (${response.status}).`);
    }

    return data;
  }

  getRecommendation=async function(){
    const button=document.getElementById('recommendBtn');
    if(button){
      button.disabled=true;
      button.textContent='Thinking…';
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

  sendChat=async function(){
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

  /* Re-render after overriding the click handlers so existing DOM buttons point
     at the v0.16.0 AI functions even when localStorage caused an early sync render. */
  if(typeof state!=='undefined' && state?.players?.length){
    if(typeof renderWarRoom==='function') renderWarRoom();
    if(typeof renderChat==='function') renderChat();
  }

  console.log('Draft War Room AI Decision Engine v1.3 / v0.16.0 loaded.');
})();
