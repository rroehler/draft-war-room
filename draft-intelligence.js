/* ========================================================================== 
   Draft War Room — Draft Intelligence Layer v0.16.0
   Roster-aware, keeper-aware, tier-aware decision facts for the AI.
   Also keeps the War Room tier board consistent with Overall Rank.
   ========================================================================== */

(function(){
  const USER='High Roehler';
  const TEAM_COUNT=12;
  const LAST_DRAFT_PICK=264;

  const BASE_STARTERS={
    QB:1,
    RB:2,
    WR:3,
    TE:1,
    DP:1,
    'D/ST':1,
    K:1
  };

  const FLEX_ELIGIBLE=['RB','WR','TE'];
  const CORE_POSITIONS=['QB','RB','WR','TE'];
  const LATE_POSITIONS=['DP','D/ST','K'];

  function num(value,fallback=null){
    const n=Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function boardSort(a,b){
    const ra=num(a.rank,9999), rb=num(b.rank,9999);
    if(ra!==rb) return ra-rb;

    const ta=num(a.tier,99), tb=num(b.tier,99);
    if(ta!==tb) return ta-tb;

    return num(a.adp,9999)-num(b.adp,9999);
  }

  function compactPlayer(player){
    return {
      id:player.id,
      name:player.name,
      team:player.nflTeam,
      pos:player.position,
      rank:num(player.rank),
      posRank:num(player.posRank),
      tier:num(player.tier),
      adp:num(player.adp),
      label:player.ourLabel || 'Unrated',
      keeper:!!player.isKeeper
    };
  }

  function managerCounts(manager){
    if(typeof counts==='function') return counts(manager);

    const result=Object.fromEntries(POSITIONS.map(pos=>[pos,0]));
    (state.players||[])
      .filter(player=>player.draftedBy===manager)
      .forEach(player=>{
        if(result[player.position]!==undefined) result[player.position]++;
      });

    return result;
  }

  function lineupStateFromCounts(inputCounts){
    const c=Object.fromEntries(
      Object.keys(BASE_STARTERS).map(pos=>[pos,num(inputCounts?.[pos],0)])
    );

    const baseFilled={};
    const baseOpen={};

    for(const [pos,required] of Object.entries(BASE_STARTERS)){
      baseFilled[pos]=Math.min(required,c[pos]||0);
      baseOpen[pos]=Math.max(0,required-(c[pos]||0));
    }

    const flexEligibleExtras=FLEX_ELIGIBLE.reduce(
      (sum,pos)=>sum+Math.max(0,(c[pos]||0)-BASE_STARTERS[pos]),
      0
    );

    const flexFilled=Math.min(1,flexEligibleExtras);
    const flexOpen=1-flexFilled;

    const baseOpenTotal=Object.values(baseOpen).reduce((a,b)=>a+b,0);
    const coreBaseOpenTotal=CORE_POSITIONS.reduce(
      (sum,pos)=>sum+(baseOpen[pos]||0),
      0
    );
    const lateBaseOpenTotal=LATE_POSITIONS.reduce(
      (sum,pos)=>sum+(baseOpen[pos]||0),
      0
    );

    return {
      counts:c,
      requirements:{...BASE_STARTERS,FLEX:1},
      baseFilled,
      baseOpen,
      baseOpenTotal,
      coreBaseOpenTotal,
      lateBaseOpenTotal,
      flexFilled,
      flexOpen,
      flexEligibleExtras,
      openStartingSlotsTotal:baseOpenTotal+flexOpen,
      fixedSkillSlotsFilled:
        baseFilled.QB+baseFilled.RB+baseFilled.WR+baseFilled.TE,
      fixedSkillSlotsRequired:
        BASE_STARTERS.QB+BASE_STARTERS.RB+BASE_STARTERS.WR+BASE_STARTERS.TE
    };
  }

  function isReservedKeeperPick(pick){
    return typeof keeperAtPick==='function' && !!keeperAtPick(pick);
  }

  function remainingLivePicksForManager(manager){
    let total=0;

    for(let pick=Math.max(1,state.currentPick||1);pick<=LAST_DRAFT_PICK;pick++){
      if(managerForPick(pick)===manager && !isReservedKeeperPick(pick)) total++;
    }

    return total;
  }

  function userKeeperLeverage(){
    const keeper=state.keepers?.[USER];
    if(!keeper?.playerId) return null;

    const player=(state.players||[]).find(p=>p.id===keeper.playerId);
    if(!player) return null;

    const costRound=num(keeper.round);
    const rank=num(player.rank);
    const posRank=num(player.posRank);
    const boardRound=rank ? Math.ceil(rank/TEAM_COUNT) : null;
    const roundSurplus=(costRound && boardRound)
      ? costRound-boardRound
      : null;

    const premiumOneStarterAnchor=
      ['QB','TE'].includes(player.position) &&
      posRank!==null &&
      posRank<=(player.position==='QB'?6:5) &&
      roundSurplus!==null &&
      roundSurplus>=3;

    return {
      player:compactPlayer(player),
      costRound,
      boardRound,
      roundSurplus,
      premiumOneStarterAnchor,
      meaning:premiumOneStarterAnchor
        ? `${player.name} is a high-end ${player.position} at a major keeper discount; duplicating this one-starter position early has a high opportunity cost.`
        : `${player.name} is already secured at keeper cost Round ${costRound}.`
    };
  }

  function recentLiveHistory(){
    return (state.history||[])
      .filter(entry=>!entry.isKeeper)
      .map(entry=>{
        const player=(state.players||[]).find(p=>p.id===entry.id);
        return {
          manager:entry.manager,
          player:player?.name || entry.id,
          pos:player?.position || null,
          rank:num(player?.rank),
          tier:num(player?.tier),
          adp:num(player?.adp)
        };
      });
  }

  function positionCountsFromPicks(picks){
    const result=Object.fromEntries(POSITIONS.map(pos=>[pos,0]));
    picks.forEach(pick=>{
      if(pick.pos && result[pick.pos]!==undefined) result[pick.pos]++;
    });
    return result;
  }

  function buildRunEvidence(){
    const history=recentLiveHistory();
    const last6=history.slice(-6);
    const last12=history.slice(-12);

    let previousUserIndex=-1;
    for(let i=history.length-1;i>=0;i--){
      if(history[i].manager===USER){
        previousUserIndex=i;
        break;
      }
    }

    const sincePreviousUserPick=previousUserIndex>=0
      ? history.slice(previousUserIndex+1)
      : history.slice();

    return {
      last6:positionCountsFromPicks(last6),
      last12:positionCountsFromPicks(last12),
      sincePreviousUserPick:positionCountsFromPicks(sincePreviousUserPick),
      sincePreviousUserPickTotal:sincePreviousUserPick.length,
      note:'These are observed selections only. They are evidence of a run, not proof that future managers will keep drafting the position.'
    };
  }

  function turnContext(){
    if(typeof window.DWR_getUserTurnContext==='function'){
      return window.DWR_getUserTurnContext();
    }

    const currentPick=state.currentPick;
    const currentManager=managerForPick(currentPick);
    const currentPickIsUser=currentManager===USER;
    const start=currentPickIsUser?currentPick+1:currentPick;

    let nextUserPick=null;
    for(let pick=start;pick<=LAST_DRAFT_PICK;pick++){
      if(managerForPick(pick)===USER && !isReservedKeeperPick(pick)){
        nextUserPick=pick;
        break;
      }
    }

    const before=[];
    if(nextUserPick){
      for(let pick=start;pick<nextUserPick;pick++){
        if(isReservedKeeperPick(pick)) continue;
        before.push({
          pick,
          round:roundForPick(pick),
          manager:managerForPick(pick),
          reservedKeeper:false
        });
      }
    }

    return {
      currentPick,
      currentManager,
      currentPickIsUser,
      nextUserPick,
      picksUntilNextUserPick:nextUserPick?nextUserPick-currentPick:null,
      livePicksBeforeNextUser:before,
      opponentLivePicksBeforeNextUser:before.filter(p=>p.manager!==USER),
      opponentLivePickCountBeforeNextUser:before.filter(p=>p.manager!==USER).length,
      currentTurnPicks:currentPickIsUser?[currentPick]:[],
      currentTurnPickCount:currentPickIsUser?1:0,
      isBackToBackTurn:false,
      followingUserPickAfterTurn:null,
      opponentLivePicksBeforeFollowingTurn:[],
      opponentLivePickCountBeforeFollowingTurn:0
    };
  }

  function managerBaseNeed(manager,pos){
    const lineup=lineupStateFromCounts(managerCounts(manager));
    return lineup.baseOpen[pos]||0;
  }

  function potentialDemandBeforeNext(turn,pos){
    const picks=turn?.opponentLivePicksBeforeNextUser||[];
    const uniqueManagers=[...new Set(picks.map(p=>p.manager))];
    const managersWithBaseNeed=uniqueManagers.filter(
      manager=>managerBaseNeed(manager,pos)>0
    );

    const livePickSlotsFromManagersWithBaseNeed=picks.filter(
      pick=>managersWithBaseNeed.includes(pick.manager)
    ).length;

    return {
      uniqueOpponentManagersBeforeNext:uniqueManagers.length,
      managersWithOpenBaseStarterAtPosition:managersWithBaseNeed.length,
      managerNamesWithOpenBaseStarterAtPosition:managersWithBaseNeed,
      livePickSlotsOwnedByThoseManagers:livePickSlotsFromManagersWithBaseNeed,
      note:'This is potential demand from roster construction, not a prediction that those managers will select this position.'
    };
  }

  function tierKey(player){
    const tier=num(player.tier);
    return tier===null?'unrated':String(tier);
  }

  function buildPositionSupply(turn,runEvidence){
    const all=state.players||[];
    const result={};

    for(const pos of POSITIONS){
      const initial=all.filter(p=>p.position===pos);
      const available=initial.filter(p=>!p.draftedBy).slice().sort(boardSort);
      const drafted=initial.filter(p=>!!p.draftedBy);

      const tierTotals={};
      const tierAvailable={};

      initial.forEach(player=>{
        const key=tierKey(player);
        tierTotals[key]=(tierTotals[key]||0)+1;
      });

      available.forEach(player=>{
        const key=tierKey(player);
        tierAvailable[key]=(tierAvailable[key]||0)+1;
      });

      const numericAvailableTiers=available
        .map(p=>num(p.tier))
        .filter(t=>t!==null)
        .sort((a,b)=>a-b);

      const topAvailableTier=numericAvailableTiers.length
        ? numericAvailableTiers[0]
        : null;

      const topTierPlayers=topAvailableTier===null
        ? []
        : available.filter(p=>num(p.tier)===topAvailableTier);

      const tier12Initial=initial.filter(p=>{
        const t=num(p.tier);
        return t!==null && t<=2;
      }).length;

      const tier12Remaining=available.filter(p=>{
        const t=num(p.tier);
        return t!==null && t<=2;
      }).length;

      const adpBeforeNext=turn?.nextUserPick
        ? available.filter(p=>{
            const adp=num(p.adp);
            return adp!==null && adp<=turn.nextUserPick;
          })
        : [];

      result[pos]={
        initialPlayerCount:initial.length,
        availablePlayerCount:available.length,
        draftedOrKeptCount:drafted.length,
        tierTotals,
        tierAvailable,
        topAvailableTier,
        topTierRemaining:topTierPlayers.length,
        topTierPlayers:topTierPlayers.slice(0,8).map(compactPlayer),
        tier1And2Initial:tier12Initial,
        tier1And2Remaining:tier12Remaining,
        tier1And2DraftedOrKept:tier12Initial-tier12Remaining,
        bestAvailable:available.slice(0,8).map(compactPlayer),
        availableWithAdpAtOrBeforeNextUserPick:adpBeforeNext.length,
        namesWithAdpAtOrBeforeNextUserPick:adpBeforeNext.slice(0,10).map(p=>p.name),
        observedRecentSelections:{
          last6:runEvidence.last6[pos]||0,
          last12:runEvidence.last12[pos]||0,
          sincePreviousUserPick:runEvidence.sincePreviousUserPick[pos]||0
        },
        potentialDemandBeforeNext:potentialDemandBeforeNext(turn,pos)
      };
    }

    return result;
  }

  function boardValueBand(surplus){
    if(surplus>=15) return 'major_fall';
    if(surplus>=7) return 'clear_value';
    if(surplus>=-5) return 'near_board';
    return 'reach';
  }

  function candidateImpact(player,beforeLineup,keeperLeverage){
    const afterCounts={...beforeLineup.counts};
    afterCounts[player.position]=(afterCounts[player.position]||0)+1;
    const afterLineup=lineupStateFromCounts(afterCounts);

    const starterSlotsFilledDelta=
      beforeLineup.openStartingSlotsTotal-afterLineup.openStartingSlotsTotal;

    let lineupImpact='depth';

    if(starterSlotsFilledDelta>0){
      if((beforeLineup.baseOpen[player.position]||0)>0){
        lineupImpact='fills_base_starter';
      }else if(
        FLEX_ELIGIBLE.includes(player.position) &&
        beforeLineup.flexOpen>0
      ){
        lineupImpact='fills_flex';
      }
    }else if(
      keeperLeverage?.premiumOneStarterAnchor &&
      keeperLeverage.player.pos===player.position &&
      ['QB','TE'].includes(player.position)
    ){
      lineupImpact='duplicate_one_start';
    }

    return {
      lineupImpact,
      starterSlotsFilledDelta,
      afterLineup
    };
  }

  function chooseCandidatePool(available){
    const chosen=new Map();

    available.slice().sort(boardSort).slice(0,100).forEach(
      player=>chosen.set(player.id,player)
    );

    const positionLimits={
      QB:14,
      RB:28,
      WR:38,
      TE:14,
      DP:12,
      'D/ST':10,
      K:10
    };

    for(const [pos,limit] of Object.entries(positionLimits)){
      available
        .filter(player=>player.position===pos)
        .sort(boardSort)
        .slice(0,limit)
        .forEach(player=>chosen.set(player.id,player));
    }

    return [...chosen.values()].sort(boardSort);
  }

  function buildCandidates(lineup,keeperLeverage,positionSupply,turn){
    const available=(state.players||[])
      .filter(player=>!player.draftedBy)
      .sort(boardSort);

    const pool=chooseCandidatePool(available);
    const currentPick=num(state.currentPick,1);
    const nextUserPick=num(turn?.nextUserPick);
    const opponentsBeforeNext=num(turn?.opponentLivePickCountBeforeNextUser,0);

    const candidates=pool.map(player=>{
      const rank=num(player.rank,9999);
      const adp=num(player.adp,9999);
      const tier=num(player.tier,99);
      const impact=candidateImpact(player,lineup,keeperLeverage);
      const supply=positionSupply[player.position]||{};
      const sameTierRemaining=(state.players||[]).filter(p=>
        !p.draftedBy &&
        p.position===player.position &&
        num(p.tier,99)===tier
      ).length;

      const boardSurplusPicks=currentPick-rank;
      const marketSurplusPicks=currentPick-adp;

      let adpTiming='unknown';
      if(opponentsBeforeNext===0){
        adpTiming='safe_until_next_user_pick_no_opponents';
      }else if(adp<=currentPick){
        adpTiming='already_past_market_adp';
      }else if(nextUserPick!==null && adp<=nextUserPick){
        adpTiming='market_adp_before_next_user_pick';
      }else if(nextUserPick!==null){
        adpTiming='market_adp_after_next_user_pick';
      }

      return {
        ...compactPlayer(player),
        lineupImpact:impact.lineupImpact,
        starterSlotsFilledDelta:impact.starterSlotsFilledDelta,
        rosterCountAtPositionBefore:lineup.counts[player.position]||0,
        requiredBaseSlotsAtPosition:BASE_STARTERS[player.position]||0,
        openBaseSlotsAtPositionBefore:lineup.baseOpen[player.position]||0,
        openStartingSlotsAfterPick:impact.afterLineup.openStartingSlotsTotal,
        boardSurplusPicks,
        boardValueBand:boardValueBand(boardSurplusPicks),
        marketSurplusPicks,
        adpTiming,
        nextUserPick,
        opponentLivePicksBeforeNext:opponentsBeforeNext,
        samePositionAsPremiumKeeper:
          !!keeperLeverage?.premiumOneStarterAnchor &&
          keeperLeverage.player.pos===player.position,
        sameTierRemainingAtPosition:sameTierRemaining,
        topAvailableTierAtPosition:supply.topAvailableTier??null,
        topTierRemainingAtPosition:supply.topTierRemaining??null,
        tier1And2RemainingAtPosition:supply.tier1And2Remaining??null,
        observedSelectionsAtPositionLast6:
          supply.observedRecentSelections?.last6??0,
        observedSelectionsAtPositionSincePreviousUserPick:
          supply.observedRecentSelections?.sincePreviousUserPick??0,
        potentialOpponentManagersWithBaseNeedBeforeNext:
          supply.potentialDemandBeforeNext?.managersWithOpenBaseStarterAtPosition??0
      };
    });

    const baseStarterCandidates=candidates.filter(
      c=>c.lineupImpact==='fills_base_starter' && CORE_POSITIONS.includes(c.pos)
    );

    const bestBaseStarter=baseStarterCandidates.slice().sort(
      (a,b)=>a.rank-b.rank
    )[0] || null;

    const bestWR=candidates
      .filter(c=>c.pos==='WR')
      .slice()
      .sort((a,b)=>a.rank-b.rank)[0] || null;

    candidates.forEach(candidate=>{
      candidate.bestCoreBaseStarterRank=bestBaseStarter?.rank??null;
      candidate.advantageVsBestCoreBaseStarter=bestBaseStarter
        ? bestBaseStarter.rank-candidate.rank
        : null;
      candidate.bestAvailableWRRank=bestWR?.rank??null;
      candidate.advantageVsBestAvailableWR=bestWR
        ? bestWR.rank-candidate.rank
        : null;
    });

    return candidates;
  }

  function structuralWarnings(lineup,keeperLeverage,positionSupply,round){
    const warnings=[];

    if((lineup.baseOpen.WR||0)>0){
      warnings.push(
        `WR is NOT covered: ${lineup.baseFilled.WR}/${BASE_STARTERS.WR} fixed WR starter slots are filled; ${lineup.baseOpen.WR} remain open.`
      );
    }

    if((lineup.baseOpen.WR||0)>=2 && round>=5){
      warnings.push(
        `Two or more fixed WR starter slots are still open in Round ${round}; repeated RB/TE/QB depth picks now carry meaningful roster-construction cost in this 3-WR full-PPR format.`
      );
    }

    if(keeperLeverage?.premiumOneStarterAnchor){
      warnings.push(keeperLeverage.meaning);
    }

    if(lineup.flexOpen===0){
      warnings.push(
        'FLEX is already occupied by roster construction. An additional RB/WR/TE beyond its fixed-position requirement is bench depth unless it replaces a weaker starter.'
      );
    }

    for(const pos of CORE_POSITIONS){
      if((lineup.baseOpen[pos]||0)<=0) continue;
      const supply=positionSupply[pos];
      if(!supply) continue;

      if(
        supply.tier1And2Initial>0 &&
        supply.tier1And2Remaining<=2
      ){
        warnings.push(
          `${pos} upper-tier depletion: only ${supply.tier1And2Remaining} of ${supply.tier1And2Initial} Tier 1-2 ${pos}s remain while High Roehler still has ${lineup.baseOpen[pos]} fixed ${pos} starter slot(s) open.`
        );
      }
    }

    return warnings;
  }

  function bestByImpact(candidates){
    const types=[
      'fills_base_starter',
      'fills_flex',
      'depth',
      'duplicate_one_start'
    ];

    return Object.fromEntries(types.map(type=>[
      type,
      candidates.filter(c=>c.lineupImpact===type).slice(0,6).map(c=>({
        name:c.name,
        pos:c.pos,
        rank:c.rank,
        tier:c.tier,
        adp:c.adp,
        boardSurplusPicks:c.boardSurplusPicks
      }))
    ]));
  }

  function buildDraftIntelligence(){
    const turn=turnContext();
    const userCounts=managerCounts(USER);
    const lineup=lineupStateFromCounts(userCounts);
    const keeperLeverage=userKeeperLeverage();
    const runEvidence=buildRunEvidence();
    const positionSupply=buildPositionSupply(turn,runEvidence);
    const livePicksRemaining=remainingLivePicksForManager(USER);
    const round=roundForPick(state.currentPick||1);

    const depthBudget=
      livePicksRemaining-lineup.openStartingSlotsTotal;

    const hardConstraints={
      livePicksRemaining,
      openStartingSlotsTotal:lineup.openStartingSlotsTotal,
      depthBudget,
      mustFillStarterNow:depthBudget<=0,
      impossibleToFillAllStarters:depthBudget<0,
      validImpactTypesIfMustFillStarterNow:[
        'fills_base_starter',
        'fills_flex'
      ],
      note:'depthBudget is how many future High Roehler live picks can be spent without filling an open starting slot while still retaining enough picks to complete the starting lineup.'
    };

    const decisionCandidates=buildCandidates(
      lineup,
      keeperLeverage,
      positionSupply,
      turn
    );

    return {
      version:'0.16.0',
      roster:{
        lineup,
        livePicksRemaining,
        depthBudget,
        targetTotals:{...(state.targets||{})},
        targetTotalsAreGoalsNotMandatoryStarters:true
      },
      keeperLeverage,
      runEvidence,
      positionSupply,
      hardConstraints,
      structuralWarnings:structuralWarnings(
        lineup,
        keeperLeverage,
        positionSupply,
        round
      ),
      bestByImpact:bestByImpact(decisionCandidates),
      leagueStructuralDemand:{
        teams:TEAM_COUNT,
        fixedStarterSlotsPerTeam:{...BASE_STARTERS},
        fixedLeagueStarterSlots:{
          QB:12,
          RB:24,
          WR:36,
          TE:12,
          DP:12,
          'D/ST':12,
          K:12
        },
        flexSlots:12,
        flexEligible:[...FLEX_ELIGIBLE],
        note:'WR has three fixed starters per team before FLEX, so WR starter need is structurally larger than QB/TE and larger than RB base-slot demand.'
      },
      decisionCandidates
    };
  }

  window.DWR_buildDraftIntelligence=buildDraftIntelligence;
  window.DWR_lineupStateFromCounts=lineupStateFromCounts;

  /* -----------------------------------------------------------------------
     War Room board consistency fix
     - Same player availability source as Players tab
     - Tier grouping retained
     - Within each tier, use Overall Rank instead of ADP
     - Do not silently truncate relevant available players
     ----------------------------------------------------------------------- */

  if(typeof playerRows==='function'){
    playerRows=function(pos,limit=999){
      const list=(state.players||[])
        .filter(player=>!player.draftedBy && player.position===pos)
        .slice()
        .sort((a,b)=>{
          const ta=num(a.tier,99), tb=num(b.tier,99);
          if(ta!==tb) return ta-tb;
          return boardSort(a,b);
        });

      if(!list.length){
        return '<div class="muted">No available players.</div>';
      }

      let lastTier=null;

      return list.map(player=>{
        const tier=player.tier || 'Unrated';
        const tierLabel=tier!==lastTier
          ? `<div class="tier-label">${tier==='Unrated'?'Unrated':`Tier ${tier}`}</div>`
          : '';

        lastTier=tier;

        const rank=player.rank ? `#${player.rank}` : 'Unranked';
        const posRank=player.posRank ? `${player.position}${player.posRank}` : player.position;
        const adp=player.adp ? `ADP ${player.adp}` : '';

        return `${tierLabel}<div class="player-row" data-player="${player.id}">
          <span>
            <b>${player.name}</b>
            <div class="tiny">${player.nflTeam} · ${player.ourLabel||'Unrated'}</div>
          </span>
          <span class="tiny">${rank} · ${posRank}${adp?` · ${adp}`:''}</span>
        </div>`;
      }).join('');
    };
  }

  /* Replace the one Commandment that was too absolute for a dynamic roster. */
  if(typeof COMMANDMENTS!=='undefined' && Array.isArray(COMMANDMENTS)){
    const old='Draft for value, not for need. Needs can be filled later. Lost value cannot.';
    const replacement='Draft for value, but value is roster-dependent: unfilled starting slots, keeper leverage, tier scarcity, and marginal lineup impact change what a player is worth to High Roehler.';
    const idx=COMMANDMENTS.indexOf(old);
    if(idx>=0) COMMANDMENTS[idx]=replacement;

    const keeperRule='Do not spend meaningful early draft capital duplicating a strong one-starter keeper unless the falling value is truly exceptional.';
    if(!COMMANDMENTS.includes(keeperRule)) COMMANDMENTS.push(keeperRule);

    const wrRule='In this 3-WR full-PPR league, never confuse unfilled WR starter slots with WR depth.';
    if(!COMMANDMENTS.includes(wrRule)) COMMANDMENTS.push(wrRule);
  }

  if(
    typeof state!=='undefined' &&
    state?.players?.length &&
    typeof renderWarRoom==='function'
  ){
    renderWarRoom();
  }

  console.log('Draft War Room Draft Intelligence v0.16.0 loaded.');
})();
