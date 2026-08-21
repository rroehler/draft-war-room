/* ==========================================================================
   Draft War Room — Pick Decision Coach v0.18.4

   High-effort rebuild of the War Room decision layer.

   Core philosophy
   ---------------------------------------------------------------------------
   This layer does NOT choose a player and does NOT produce a confidence score.
   It gives the drafter the same facts an experienced drafter should process:

   1. Roster Budget
   2. Position Pressure
   3. Tier Cliffs
   4. Board Value
   5. Return Risk
   6. Draft-Room Runs
   7. A decision question

   Chat remains available as a state-aware second opinion.

   All decision-coach calculations run locally and work offline.
   ========================================================================== */

(function(){
  const USER='High Roehler';
  const LAST_DRAFT_PICK=264;

  const CORE_POSITIONS=['QB','RB','WR','TE'];
  const ALL_POSITIONS=['QB','RB','WR','TE','DP','D/ST','K'];

  /*
    END-OF-DRAFT strategic roster construction rules.
    These are intentionally NOT the starting-lineup counts.
  */
  const ROSTER_RULES={
    QB:{min:2,max:3,target:'2–3',yellowDistance:1},
    RB:{min:5,max:null,target:'5+',yellowDistance:2},
    WR:{min:7,max:null,target:'7+',yellowDistance:2},
    TE:{min:2,max:2,target:'2',yellowDistance:1},
    DP:{min:1,max:1,target:'1',yellowDistance:0},
    'D/ST':{min:1,max:1,target:'1',yellowDistance:0},
    K:{min:1,max:1,target:'1',yellowDistance:0}
  };

  const DECISION_RULES=[
    'Overall Rank is our player value. ADP is market timing. Never use ADP as the reason a player is better.',
    'Tier cliffs matter more than tiny Overall Rank gaps. Protect access to scarce tiers when the drop is meaningful.',
    'A positional run is information, not a command. Join a run only when the remaining tier or roster situation justifies it.',
    'Roster Budget uses the final roster guardrails: QB 2–3, RB 5+, WR 7+, TE 2, DP 1, D/ST 1, K 1.',
    'Green means the minimum is met. Gray means a hard ceiling is reached and the position is closed.',
    'Keep flexible roster spots available early. As flexible picks shrink, unmet roster minimums become increasingly important.',
    'At a snake turn, plan the two picks together. No opponent can steal a player between back-to-back selections.',
    'A discounted keeper at a one-starter position changes opportunity cost. Do not duplicate QB or TE early without a real value reason.',
    'Late in the draft, never spend a flexible pick that makes the final roster guardrails impossible to complete.'
  ];

  function numberOr(value,fallback=null){
    const n=Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function positiveNumberOr(value,fallback=9999){
    const n=Number(value);
    return Number.isFinite(n) && n>0 ? n : fallback;
  }

  function playerCompact(player){
    return {
      id:player?.id||null,
      name:player?.name||'Unknown',
      pos:player?.position||null,
      team:player?.nflTeam||null,
      rank:numberOr(player?.rank),
      posRank:numberOr(player?.posRank),
      tier:numberOr(player?.tier),
      adp:numberOr(player?.adp),
      label:player?.ourLabel||'Unrated'
    };
  }

  function userRoster(){
    if(typeof roster==='function') return roster(USER);
    return (state.players||[]).filter(player=>player.draftedBy===USER);
  }

  function countsFromRoster(players){
    const result={QB:0,RB:0,WR:0,TE:0,DP:0,'D/ST':0,K:0};

    (players||[]).forEach(player=>{
      if(result[player.position]!==undefined){
        result[player.position]++;
      }
    });

    return result;
  }

  function userCounts(){
    return countsFromRoster(userRoster());
  }

  function isReservedKeeperPick(pick){
    return typeof keeperAtPick==='function' && !!keeperAtPick(pick);
  }

  function livePicksRemainingForUser(){
    let total=0;

    for(
      let pick=Math.max(1,Number(state.currentPick)||1);
      pick<=LAST_DRAFT_PICK;
      pick++
    ){
      if(managerForPick(pick)!==USER) continue;
      if(isReservedKeeperPick(pick)) continue;
      total++;
    }

    return total;
  }

  /*
    Pure helper used by both the app and the regression tests.
  */
  function buildRosterBudgetFromCounts(counts,picksLeft){
    const rows=ALL_POSITIONS.map(position=>{
      const rule=ROSTER_RULES[position];
      const have=Number(counts?.[position]||0);
      const need=Math.max(0,rule.min-have);
      const hardClosed=rule.max!==null && have>=rule.max;

      let status='red';
      let label='Needed';

      if(hardClosed){
        status='closed';
        label='Closed';
      }else if(have>=rule.min){
        status='green';
        label='Met';
      }else if(
        have>0 &&
        need<=rule.yellowDistance
      ){
        status='yellow';
        label='Close';
      }

      return {
        position,
        have,
        need,
        target:rule.target,
        min:rule.min,
        max:rule.max,
        status,
        label
      };
    });

    const required=rows.reduce((sum,row)=>sum+row.need,0);
    const flexible=Number.isFinite(Number(picksLeft))
      ? Number(picksLeft)-required
      : 0;

    return {
      rows,
      picksLeft:Number(picksLeft)||0,
      required,
      flexible:Math.max(0,flexible),
      rawFlexible:flexible,
      locked:required>0 && flexible===0,
      impossible:flexible<0
    };
  }

  function rosterBudget(){
    return buildRosterBudgetFromCounts(
      userCounts(),
      livePicksRemainingForUser()
    );
  }

  function turnContext(){
    if(typeof window.DWR_getUserTurnContext==='function'){
      try{
        return window.DWR_getUserTurnContext(state.currentPick);
      }catch(error){
        console.warn('Pick Decision Coach: turn-awareness fallback.',error);
      }
    }

    const currentPick=Number(state.currentPick)||1;
    const currentManager=managerForPick(currentPick);
    const currentPickIsUser=
      currentManager===USER &&
      !isReservedKeeperPick(currentPick);

    const searchStart=currentPickIsUser
      ? currentPick+1
      : currentPick;

    let nextUserPick=null;

    for(let pick=searchStart;pick<=LAST_DRAFT_PICK;pick++){
      if(
        managerForPick(pick)===USER &&
        !isReservedKeeperPick(pick)
      ){
        nextUserPick=pick;
        break;
      }
    }

    const opposing=[];
    if(nextUserPick){
      for(let pick=searchStart;pick<nextUserPick;pick++){
        if(isReservedKeeperPick(pick)) continue;
        if(managerForPick(pick)!==USER){
          opposing.push(pick);
        }
      }
    }

    return {
      currentPick,
      currentManager,
      currentPickIsUser,
      nextUserPick,
      opponentLivePickCountBeforeNextUser:opposing.length,
      currentTurnPicks:currentPickIsUser?[currentPick]:[],
      currentTurnPickCount:currentPickIsUser?1:0,
      isBackToBackTurn:false,
      followingUserPickAfterTurn:null,
      opponentLivePickCountBeforeFollowingTurn:0
    };
  }

  function nextRelevantHorizon(turn){
    /*
      Normal pick: next live High Roehler pick.
      First pick of a snake turn: nobody can steal a player before the second
      pick, so return-risk planning should also surface the following turn.
    */
    if(
      turn?.currentPickIsUser &&
      turn?.opponentLivePickCountBeforeNextUser===0 &&
      turn?.nextUserPick
    ){
      return {
        immediatePick:turn.nextUserPick,
        immediateOpponents:0,
        afterTurnPick:turn.followingUserPickAfterTurn||null,
        afterTurnOpponents:
          turn.opponentLivePickCountBeforeFollowingTurn||0,
        backToBack:true
      };
    }

    return {
      immediatePick:turn?.nextUserPick||null,
      immediateOpponents:
        turn?.opponentLivePickCountBeforeNextUser||0,
      afterTurnPick:null,
      afterTurnOpponents:0,
      backToBack:false
    };
  }

  function available(position=null){
    return (state.players||[]).filter(player=>
      !player.draftedBy &&
      (!position || player.position===position)
    );
  }

  function byOverallRank(a,b){
    const rankA=positiveNumberOr(a.rank);
    const rankB=positiveNumberOr(b.rank);

    if(rankA!==rankB) return rankA-rankB;

    const tierA=positiveNumberOr(a.tier,99);
    const tierB=positiveNumberOr(b.tier,99);

    if(tierA!==tierB) return tierA-tierB;

    const adpA=positiveNumberOr(a.adp);
    const adpB=positiveNumberOr(b.adp);

    if(adpA!==adpB) return adpA-adpB;

    return String(a.name).localeCompare(String(b.name));
  }

  function positionIsClosed(position,budgetState){
    const row=budgetState.rows.find(r=>r.position===position);
    return row?.status==='closed';
  }

  function tierSnapshot(position){
    const list=available(position)
      .filter(player=>Number.isFinite(Number(player.tier)))
      .sort((a,b)=>{
        const tierA=positiveNumberOr(a.tier,99);
        const tierB=positiveNumberOr(b.tier,99);
        if(tierA!==tierB) return tierA-tierB;
        return byOverallRank(a,b);
      });

    if(!list.length){
      return {
        position,
        tier:null,
        count:0,
        nextTier:null,
        nextCount:0,
        rankGap:null,
        best:null,
        currentTierPlayers:[],
        severity:'none'
      };
    }

    const tier=Number(list[0].tier);
    const currentTierPlayers=list.filter(
      player=>Number(player.tier)===tier
    );

    const tierNumbers=[...new Set(
      list
        .map(player=>Number(player.tier))
        .filter(Number.isFinite)
    )].sort((a,b)=>a-b);

    const nextTier=tierNumbers.find(value=>value>tier)??null;
    const nextTierPlayers=nextTier===null
      ? []
      : list.filter(player=>Number(player.tier)===nextTier);

    const currentRanks=currentTierPlayers
      .map(player=>numberOr(player.rank))
      .filter(Number.isFinite);

    const nextRanks=nextTierPlayers
      .map(player=>numberOr(player.rank))
      .filter(Number.isFinite);

    const currentWorst=currentRanks.length
      ? Math.max(...currentRanks)
      : null;

    const nextBest=nextRanks.length
      ? Math.min(...nextRanks)
      : null;

    const rankGap=
      currentWorst!==null && nextBest!==null
        ? nextBest-currentWorst
        : null;

    let severity='normal';

    if(currentTierPlayers.length===1){
      severity='last';
    }else if(currentTierPlayers.length===2){
      severity='thin';
    }

    if(
      nextTier!==null &&
      (
        nextTier-tier>=2 ||
        (rankGap!==null && rankGap>=12)
      )
    ){
      severity=currentTierPlayers.length<=2
        ? 'cliff'
        : 'drop';
    }

    return {
      position,
      tier,
      count:currentTierPlayers.length,
      nextTier,
      nextCount:nextTierPlayers.length,
      rankGap,
      best:[...currentTierPlayers].sort(byOverallRank)[0]||null,
      currentTierPlayers:[...currentTierPlayers].sort(byOverallRank),
      severity
    };
  }

  function recentLiveEntries(){
    return (state.history||[])
      .filter(entry=>!entry.isKeeper)
      .map(entry=>{
        const player=(state.players||[]).find(p=>p.id===entry.id);
        return {
          manager:entry.manager,
          pos:player?.position||null,
          player:player?.name||entry.id
        };
      });
  }

  function positionCounts(entries){
    const result={QB:0,RB:0,WR:0,TE:0,DP:0,'D/ST':0,K:0};

    entries.forEach(entry=>{
      if(result[entry.pos]!==undefined) result[entry.pos]++;
    });

    return result;
  }

  function runEvidence(){
    const history=recentLiveEntries();
    const last5=history.slice(-5);
    const last8=history.slice(-8);

    let previousUserIndex=-1;
    for(let i=history.length-1;i>=0;i--){
      if(history[i].manager===USER){
        previousUserIndex=i;
        break;
      }
    }

    const sinceUser=previousUserIndex>=0
      ? history.slice(previousUserIndex+1)
      : history.slice();

    const c5=positionCounts(last5);
    const c8=positionCounts(last8);
    const cSince=positionCounts(sinceUser);

    const runs=[];

    for(const position of CORE_POSITIONS){
      let detected=false;
      let strength='';

      if(position==='QB'||position==='TE'){
        if((c5[position]||0)>=2){
          detected=true;
          strength=(c5[position]||0)>=3?'strong':'active';
        }else if((c8[position]||0)>=3){
          detected=true;
          strength='active';
        }
      }else{
        if((c5[position]||0)>=4){
          detected=true;
          strength='strong';
        }else if((c8[position]||0)>=5){
          detected=true;
          strength='active';
        }
      }

      if(detected){
        runs.push({
          position,
          strength,
          last5:c5[position]||0,
          last8:c8[position]||0,
          sinceUser:cSince[position]||0
        });
      }
    }

    runs.sort((a,b)=>{
      if(a.strength!==b.strength){
        return a.strength==='strong'?-1:1;
      }
      return b.last5-a.last5 || b.last8-a.last8;
    });

    return {
      last5:c5,
      last8:c8,
      sinceUser:cSince,
      sinceUserTotal:sinceUser.length,
      runs
    };
  }

  function boardValue(player,currentPick){
    const rank=numberOr(player.rank);

    if(rank===null){
      return {key:'unknown',label:'Unranked',delta:null};
    }

    const delta=currentPick-rank;

    if(delta>=15){
      return {key:'major-value',label:`Falling +${delta}`,delta};
    }
    if(delta>=7){
      return {key:'value',label:`Value +${delta}`,delta};
    }
    if(delta>=-6){
      return {key:'fair',label:'Fair range',delta};
    }
    if(delta>=-14){
      return {key:'reach',label:`Reach ${Math.abs(delta)}`,delta};
    }

    return {
      key:'big-reach',
      label:`Reach ${Math.abs(delta)}`,
      delta
    };
  }

  function riskAgainstPick(player,pick){
    const adp=numberOr(player.adp);

    if(!pick || adp===null){
      return {key:'unknown',label:'ADP unknown'};
    }

    const difference=adp-pick;

    if(difference<=-8){
      return {key:'gone',label:'Likely gone'};
    }
    if(difference<=3){
      return {key:'risk',label:'At risk'};
    }
    if(difference<=12){
      return {key:'maybe',label:'Could return'};
    }

    return {key:'safe',label:'Likely available'};
  }

  function returnRisk(player,horizon){
    if(!horizon?.immediatePick){
      return {
        key:'none',
        label:'Draft ending',
        detail:'No later High Roehler pick.'
      };
    }

    if(horizon.immediateOpponents===0){
      const after=horizon.afterTurnPick
        ? riskAgainstPick(player,horizon.afterTurnPick)
        : null;

      return {
        key:'turn-safe',
        label:`Safe to #${horizon.immediatePick}`,
        detail:after
          ? `After turn (#${horizon.afterTurnPick}): ${after.label}`
          : 'No opponent can take him before your next selection.'
      };
    }

    const immediate=riskAgainstPick(player,horizon.immediatePick);

    return {
      ...immediate,
      detail:`Before #${horizon.immediatePick}: ${immediate.label}`
    };
  }

  function pressureSeverity(level){
    return ({
      required:6,
      urgent:5,
      pressure:4,
      watch:3,
      open:2,
      closed:0
    })[level]||1;
  }

  function positionPressure(position,budgetState,tier,turn,runs){
    const row=budgetState.rows.find(item=>item.position===position);
    const horizon=nextRelevantHorizon(turn);

    if(!row){
      return {position,level:'open',label:'OPEN',detail:'Available'};
    }

    if(row.status==='closed'){
      return {
        position,
        level:'closed',
        label:'CLOSED',
        detail:`${row.have}/${row.target} · hard ceiling reached`
      };
    }

    if(row.need>0 && budgetState.impossible){
      return {
        position,
        level:'required',
        label:'REQUIRED',
        detail:`Need ${row.need} · roster requirements are already mathematically behind`
      };
    }

    if(row.need>0 && budgetState.locked){
      return {
        position,
        level:'required',
        label:'REQUIRED',
        detail:`Need ${row.need} · every remaining pick must fill a minimum`
      };
    }

    if(row.need>0 && budgetState.flexible<=2){
      return {
        position,
        level:'urgent',
        label:'URGENT',
        detail:`Need ${row.need} · only ${budgetState.flexible} flexible pick${budgetState.flexible===1?'':'s'} remain`
      };
    }

    const opponents=horizon.backToBack
      ? horizon.afterTurnOpponents
      : horizon.immediateOpponents;

    const run=runs.runs.find(item=>item.position===position);

    const severeTier=
      tier.tier!==null &&
      ['last','thin','cliff'].includes(tier.severity);

    if(
      row.need>0 &&
      severeTier &&
      opponents>=4
    ){
      return {
        position,
        level:'pressure',
        label:'PRESSURE',
        detail:`Need ${row.need} · ${tier.count} left in Tier ${tier.tier}`
      };
    }

    /*
      A run only escalates pressure when it is paired with thin supply.
      This prevents "run detected" from becoming "chase the run."
    */
    if(
      row.need>0 &&
      run &&
      tier.tier!==null &&
      tier.count<=3 &&
      opponents>=4
    ){
      return {
        position,
        level:'pressure',
        label:'PRESSURE',
        detail:`Need ${row.need} · ${run.position} run + only ${tier.count} in Tier ${tier.tier}`
      };
    }

    if(row.need>0){
      return {
        position,
        level:'watch',
        label:'WATCH',
        detail:`Need ${row.need} to reach ${row.target}`
      };
    }

    if(
      (position==='RB'||position==='WR'||position==='QB') &&
      severeTier &&
      opponents>=6
    ){
      return {
        position,
        level:'watch',
        label:'WATCH',
        detail:`Minimum met · ${tier.count} left in Tier ${tier.tier}`
      };
    }

    return {
      position,
      level:'open',
      label:'OPEN',
      detail:`${row.have}/${row.target} · minimum met`
    };
  }

  function candidatePool(budgetState,round){
    return available()
      .filter(player=>{
        const position=player.position;

        if(positionIsClosed(position,budgetState)){
          return false;
        }

        /*
          Keep the "board value" strip focused on decisions that matter now.
          Late positions enter naturally later or when roster flexibility is low.
        */
        if(['DP','D/ST','K'].includes(position)){
          const row=budgetState.rows.find(r=>r.position===position);
          const requiredSoon=
            row?.need>0 &&
            (
              budgetState.flexible<=2 ||
              round>=15
            );

          return requiredSoon;
        }

        return CORE_POSITIONS.includes(position);
      })
      .sort(byOverallRank);
  }

  function topDecisionCandidates(data){
    const round=typeof roundForPick==='function'
      ? roundForPick(state.currentPick)
      : Math.ceil(state.currentPick/12);

    return candidatePool(data.budget,round)
      .slice(0,5)
      .map(player=>({
        player,
        value:boardValue(player,state.currentPick),
        risk:returnRisk(player,data.horizon)
      }));
  }

  function cliffAlerts(data){
    return CORE_POSITIONS
      .filter(position=>!positionIsClosed(position,data.budget))
      .map(position=>data.tiers[position])
      .filter(tier=>tier.tier!==null)
      .sort((a,b)=>{
        const order={cliff:0,last:1,thin:2,drop:3,normal:4,none:5};
        const severity=(order[a.severity]??9)-(order[b.severity]??9);
        if(severity!==0) return severity;
        if(a.count!==b.count) return a.count-b.count;
        return a.tier-b.tier;
      });
  }

  function focusPositions(data){
    if(data.budget.locked || data.budget.impossible){
      return data.budget.rows
        .filter(row=>row.need>0)
        .map(row=>row.position);
    }

    const core=CORE_POSITIONS
      .filter(position=>data.pressures[position].level!=='closed')
      .map(position=>{
        const pressure=data.pressures[position];
        const tier=data.tiers[position];
        const best=tier.best;
        const rank=numberOr(best?.rank,9999);

        let score=pressureSeverity(pressure.level)*100;

        if(tier.count===1) score+=35;
        else if(tier.count===2) score+=20;
        else if(tier.count===3) score+=8;

        if(tier.severity==='cliff') score+=25;
        if(rank<9999) score+=Math.max(0,35-rank/10);

        return {position,score};
      })
      .sort((a,b)=>b.score-a.score);

    return core.slice(0,2).map(item=>item.position);
  }

  function primaryFocusText(data){
    if(data.budget.impossible){
      return 'Repair roster requirements';
    }

    if(data.budget.locked){
      const needed=data.budget.rows
        .filter(row=>row.need>0)
        .map(row=>row.position);
      return `Required: ${needed.join(' / ')}`;
    }

    if(data.turn.currentPickIsUser && data.horizon.backToBack){
      const focus=focusPositions(data);
      return `Plan the two-pick turn${focus.length?` · ${focus.join(' / ')}`:''}`;
    }

    const focus=focusPositions(data);
    if(focus.length>=2) return `${focus[0]} vs ${focus[1]}`;
    if(focus.length===1) return `${focus[0]} decision`;

    return 'Best open value';
  }

  function decisionQuestion(data){
    if(data.budget.impossible){
      return 'The final roster guardrails can no longer all be reached. Which missing requirement should you repair first, and what caused the lost flexibility?';
    }

    if(data.budget.locked){
      const positions=data.budget.rows
        .filter(row=>row.need>0)
        .map(row=>row.position)
        .join(', ');

      return `Roster lock: every remaining pick must help satisfy ${positions}. Which required position gives you the best tier and value right now?`;
    }

    if(data.turn.currentPickIsUser && data.horizon.backToBack){
      const after=data.horizon.afterTurnPick;
      return after
        ? `You control both picks in this turn. Which two-player combination gives you the best value while protecting the tiers most likely to disappear before #${after}?`
        : 'You control both picks in this turn. Which two-player combination best balances value, roster construction, and tier scarcity?';
    }

    const urgent=CORE_POSITIONS.filter(position=>
      ['required','urgent'].includes(data.pressures[position].level)
    );

    if(urgent.length){
      return `Can you address ${urgent.join(' or ')} now without passing an exceptional falling value at another open position?`;
    }

    const cliffs=cliffAlerts(data);
    const thin=cliffs.find(tier=>
      ['cliff','last','thin'].includes(tier.severity)
    );

    if(thin){
      return `${thin.position} has ${thin.count} player${thin.count===1?'':'s'} left in Tier ${thin.tier}. Is that tier access more valuable than the best alternative on your board?`;
    }

    const run=data.runs.runs[0];
    if(run){
      return `${run.position} is running (${run.last5} of the last 5 picks). Is the remaining ${run.position} tier actually disappearing, or can you exploit the run somewhere else?`;
    }

    return 'Which available player best combines our board value, tier security, roster fit, and the risk that he will not make it back?';
  }

  function decisionData(){
    const budgetState=rosterBudget();
    const turn=turnContext();
    const horizon=nextRelevantHorizon(turn);
    const runs=runEvidence();

    const tiers=Object.fromEntries(
      CORE_POSITIONS.map(position=>[
        position,
        tierSnapshot(position)
      ])
    );

    const pressures=Object.fromEntries(
      CORE_POSITIONS.map(position=>[
        position,
        positionPressure(
          position,
          budgetState,
          tiers[position],
          turn,
          runs
        )
      ])
    );

    const data={
      budget:budgetState,
      turn,
      horizon,
      runs,
      tiers,
      pressures
    };

    data.candidates=topDecisionCandidates(data);
    data.cliffs=cliffAlerts(data);
    data.focus=focusPositions(data);
    data.primaryFocus=primaryFocusText(data);
    data.question=decisionQuestion(data);

    return data;
  }

  function tierText(tier){
    if(tier.tier===null) return 'No rated tier';

    let text=`${tier.count} in Tier ${tier.tier}`;

    if(tier.nextTier!==null){
      text+=` → T${tier.nextTier}`;
    }

    if(tier.rankGap!==null && tier.rankGap>=8){
      text+=` · rank gap ${tier.rankGap}`;
    }

    return text;
  }

  function budgetTableHtml(data){
    const rows=data.budget.rows.map(row=>{
      const right=row.status==='closed'
        ? 'CLOSED'
        : row.need>0
          ? `NEED ${row.need}`
          : 'MET';

      return `
        <div class="budget-strip budget-${row.status}">
          <strong class="budget-strip-pos">${row.position}</strong>
          <span class="budget-strip-count">${row.have} / ${row.target}</span>
          <span class="budget-strip-status">${right}</span>
        </div>`;
    }).join('');

    const summaryClass=[
      'budget-summary',
      data.budget.locked?'locked':'',
      data.budget.impossible?'impossible':''
    ].filter(Boolean).join(' ');

    return `
      <div class="decision-budget-sticky">
        <div class="budget-metrics">
          <div><strong>${data.budget.picksLeft}</strong><span>Picks left</span></div>
          <div><strong>${data.budget.required}</strong><span>Required</span></div>
          <div><strong>${data.budget.flexible}</strong><span>Flexible</span></div>
        </div>

        <div class="budget-strips">${rows}</div>

        ${
          data.budget.impossible
            ? `<div class="${summaryClass}">Roster requirements are behind.</div>`
            : data.budget.locked
              ? `<div class="${summaryClass}">ROSTER LOCK · every remaining pick is required</div>`
              : ''
        }
      </div>`;
  }

  function pressureHtml(data){
    return CORE_POSITIONS.map(position=>{
      const pressure=data.pressures[position];
      const tier=data.tiers[position];

      return `
        <div class="decision-pressure-row pressure-${pressure.level}">
          <div class="decision-pressure-pos">${position}</div>
          <div class="decision-pressure-state">${pressure.label}</div>
          <div class="decision-pressure-detail">
            <span>${pressure.detail}</span>
            <span class="decision-pressure-tier">${tierText(tier)}</span>
          </div>
        </div>`;
    }).join('');
  }

  function candidateHtml(data){
    if(!data.candidates.length){
      return `<div class="muted tiny">No open decision candidates.</div>`;
    }

    return data.candidates.slice(0,4).map(item=>{
      const player=item.player;

      return `
        <div class="decision-candidate-row">
          <div class="decision-candidate-player">
            <strong>${player.name}</strong>
            <span>
              ${player.position}
              · #${player.rank||'—'}
              · T${player.tier||'—'}
              · ADP ${player.adp||'—'}
            </span>
          </div>

          <span class="decision-tag value-${item.value.key}">
            ${item.value.label}
          </span>

          <span class="decision-tag risk-${item.risk.key}" title="${item.risk.detail||''}">
            ${item.risk.label}
          </span>
        </div>`;
    }).join('');
  }

  function roomPulseHtml(data){
    const cliff=data.cliffs.find(tier=>
      ['cliff','last','thin','drop'].includes(tier.severity)
    ) || data.cliffs[0];

    let cliffText='No rated offensive tier data.';
    if(cliff){
      cliffText=`${cliff.position}: ${tierText(cliff)}`;
    }

    let runText='No strong positional run detected.';
    if(data.runs.runs.length){
      runText=data.runs.runs
        .slice(0,2)
        .map(run=>
          `${run.position} ${run.strength} · ${run.last5}/5 (${run.last8}/8)`
        )
        .join(' · ');
    }

    return `
      <div class="decision-room-pulse">
        <div><strong>Tier watch:</strong> ${cliffText}</div>
        <div><strong>Room activity:</strong> ${runText}</div>
        ${data.runs.runs.length
          ? `<div class="tiny decision-run-reminder">Runs are evidence, not commands. Check the remaining tier before chasing.</div>`
          : ''}
      </div>`;
  }

  function turnLineHtml(data){
    if(!data.turn.currentPickIsUser){
      return `${data.turn.currentManager} is on the clock`;
    }

    if(data.horizon.backToBack){
      const after=data.horizon.afterTurnPick;
      return after
        ? `Back-to-back · #${state.currentPick} + #${data.horizon.immediatePick} · then ${data.horizon.afterTurnOpponents} opponents before #${after}`
        : `Back-to-back · #${state.currentPick} + #${data.horizon.immediatePick}`;
    }

    if(data.horizon.immediatePick){
      return `${data.horizon.immediateOpponents} opponent pick${data.horizon.immediateOpponents===1?'':'s'} before #${data.horizon.immediatePick}`;
    }

    return 'Final High Roehler selection';
  }


  const TIER_TAB_POSITIONS=['QB','RB','WR','TE','DP','D/ST','K'];

  function tierTabCard(position){
    const remaining=available(position).length;

    return `
      <div class="card tier-tab-card">
        <div class="tier-tab-column-head">
          <strong>${position}</strong>
          <span>${remaining}</span>
        </div>
        <div class="tier-tab-scroll">${playerRows(position,60)}</div>
      </div>`;
  }

  function compactPressureHtml(data){
    return CORE_POSITIONS.map(position=>{
      const pressure=data.pressures[position];
      const tier=data.tiers[position];
      const row=data.budget.rows.find(item=>item.position===position);

      const need=row.need>0
        ? `Need ${row.need}`
        : `${row.have}/${row.target}`;

      const tierText=tier.tier!==null
        ? `T${tier.tier} · ${tier.count} left`
        : 'No tier';

      return `
        <div class="pressure-tile pressure-${pressure.level}">
          <div class="pressure-tile-top">
            <strong>${position}</strong>
            <span>${pressure.label}</span>
          </div>
          <div class="pressure-tile-bottom">${need} · ${tierText}</div>
        </div>`;
    }).join('');
  }

  function shortDecisionAlert(data){
    if(data.budget.impossible){
      return {
        eyebrow:'ROSTER WARNING',
        headline:'Requirements are behind',
        body:'Use the remaining picks to repair the missing minimums.'
      };
    }

    if(data.budget.locked){
      return {
        eyebrow:'ROSTER LOCK',
        headline:'No flexible picks remain',
        body:'Every remaining selection must satisfy an unmet roster minimum.'
      };
    }

    if(data.turn.currentPickIsUser && data.horizon.backToBack){
      return {
        eyebrow:'TWO-PICK TURN',
        headline:'Plan both picks together',
        body:data.horizon.afterTurnPick
          ? `Protect what may disappear before #${data.horizon.afterTurnPick}.`
          : 'Balance value and roster needs across both selections.'
      };
    }

    const cliff=data.cliffs.find(tier=>
      ['cliff','last','thin'].includes(tier.severity)
    );

    if(cliff){
      return {
        eyebrow:'TIER ALERT',
        headline:`${cliff.position} · ${cliff.count} left in Tier ${cliff.tier}`,
        body:`Decide whether preserving this tier is worth passing the best alternative.`
      };
    }

    const run=data.runs.runs[0];
    if(run){
      return {
        eyebrow:'ROOM MOVEMENT',
        headline:`${run.position} run · ${run.last5} of last 5`,
        body:'Check the remaining tier before reacting.'
      };
    }

    return {
      eyebrow:'ON THE CLOCK',
      headline:data.primaryFocus,
      body:'Balance board value, tier access, roster fit, and return risk.'
    };
  }

  function compactRoomPulseHtml(data){
    const cliff=data.cliffs.find(tier=>
      ['cliff','last','thin','drop'].includes(tier.severity)
    ) || data.cliffs[0];

    const tierLine=cliff
      ? `${cliff.position} T${cliff.tier} · ${cliff.count} left${cliff.nextTier!==null?` → T${cliff.nextTier}`:''}`
      : 'No meaningful tier alert';

    const run=data.runs.runs[0];
    const runLine=run
      ? `${run.position} ${run.last5}/5`
      : 'No run';

    return `
      <div class="room-pulse-line">
        <span><b>Tier</b> ${tierLine}</span>
        <i></i>
        <span><b>Run</b> ${runLine}</span>
      </div>`;
  }

  function renderDecisionPanel(data){
    const alert=shortDecisionAlert(data);

    return `
      <div class="decision-hero">
        <div class="decision-pick-badge">
          <span>Pick</span>
          <strong>#${state.currentPick}</strong>
        </div>

        <div class="decision-hero-copy">
          <div class="decision-hero-kicker">${turnLineHtml(data)}</div>
          <div class="decision-hero-title">${data.primaryFocus}</div>
        </div>

        <button id="askDecisionChatBtn" class="decision-chat-button">
          Ask Chat
        </button>
      </div>

      <div class="pressure-strip">
        ${compactPressureHtml(data)}
      </div>

      <div class="decision-alert">
        <span class="decision-alert-eyebrow">${alert.eyebrow}</span>
        <strong>${alert.headline}</strong>
        <p>${alert.body}</p>
      </div>

      ${compactRoomPulseHtml(data)}
    `;
  }

  function decisionChatPrompt(data){
    const budgetText=data.budget.rows
      .map(row=>`${row.position} ${row.have}/${row.target}`)
      .join(', ');

    const candidateText=data.candidates
      .slice(0,5)
      .map(item=>
        `${item.player.name} (${item.player.position}, Rank ${item.player.rank||'—'}, Tier ${item.player.tier||'—'}, ADP ${item.player.adp||'—'}, ${item.value.label}, ${item.risk.label})`
      )
      .join('; ');

    return [
      `Help me think through pick #${state.currentPick}.`,
      `Do not choose a player for me unless I explicitly ask you to make the choice.`,
      `Primary focus: ${data.primaryFocus}.`,
      `Roster budget: ${budgetText}.`,
      `Picks left: ${data.budget.picksLeft}; required: ${data.budget.required}; flexible: ${data.budget.flexible}.`,
      `Top decision candidates: ${candidateText}.`,
      `Decision question: ${data.question}`
    ].join(' ');
  }

  function openChatWithDecision(data){
    const chatNav=document.querySelector('nav [data-page="chat"]');
    if(chatNav) chatNav.click();

    requestAnimationFrame(()=>{
      const input=document.getElementById('chatInput');
      if(!input) return;

      input.value=decisionChatPrompt(data);
      input.focus();

      if(typeof input.setSelectionRange==='function'){
        input.setSelectionRange(
          input.value.length,
          input.value.length
        );
      }
    });
  }

  function applyDecisionRulesToCommandments(){
    const button=document.getElementById('commandmentsBtn');
    const title=document.querySelector('#commandmentsDialog h2');
    const list=document.getElementById('commandmentsList');

    if(button) button.textContent='Decision Rules';
    if(title) title.textContent='Draft Decision Rules';

    if(list){
      list.innerHTML=DECISION_RULES
        .map(rule=>`<li style="margin:10px 0">${rule}</li>`)
        .join('');
    }

    if(button){
      button.onclick=()=>{
        applyDecisionRulesToCommandments();
        document.getElementById('commandmentsDialog')?.showModal();
      };
    }
  }

  function ensureDecisionStyles(){
    if(document.getElementById('dwrDecisionCoachStyles')) return;

    const style=document.createElement('style');
    style.id='dwrDecisionCoachStyles';
    style.textContent=`
      /* v0.18.4 — separate Decision and Tiers tabs */

      #war-room .decision-tab-layout{
        display:grid;
        grid-template-columns:minmax(430px,1.1fr) minmax(340px,.9fr);
        grid-template-rows:minmax(0,1fr);
        gap:14px;
        height:calc(100vh - 174px);
        min-height:590px;
        overflow:hidden;
      }

      .decision-left-stack{
        display:grid;
        grid-template-rows:auto minmax(190px,1fr);
        gap:12px;
        min-width:0;
        min-height:0;
      }

      .decision-main-card,
      .decision-roster-card{
        min-width:0;
        min-height:0;
        margin:0;
      }

      .decision-main-card{
        padding:18px 20px;
        overflow:auto;
      }

      .decision-tracker-card{
        display:flex;
        flex-direction:column;
        min-height:0;
        margin:0;
        padding:16px 18px;
        overflow:hidden;
      }

      .decision-tracker-label{
        margin-bottom:10px;
        color:var(--muted);
        font-size:8px;
        font-weight:900;
        letter-spacing:.09em;
        text-transform:uppercase;
      }

      .decision-tracker-current{
        display:grid;
        grid-template-columns:auto minmax(0,1fr);
        align-items:center;
        gap:16px;
        padding-bottom:12px;
        border-bottom:1px solid var(--line);
      }

      .decision-tracker-pick{
        display:flex;
        flex-direction:column;
        align-items:flex-start;
      }

      .decision-tracker-pick span{
        color:var(--muted);
        font-size:8px;
        text-transform:uppercase;
        letter-spacing:.06em;
      }

      .decision-tracker-pick strong{
        margin-top:1px;
        font-size:38px;
        line-height:.95;
      }

      .decision-tracker-owner strong{
        display:block;
        font-size:21px;
        line-height:1.05;
      }

      .decision-tracker-owner strong.user-pick{
        color:var(--good);
      }

      .decision-tracker-owner span{
        display:block;
        margin-top:4px;
        color:var(--muted);
        font-size:10px;
      }

      .decision-tracker-next{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-top:11px;
        padding:9px 10px;
        border-radius:7px;
        background:rgba(109,168,255,.07);
      }

      .decision-tracker-next span{
        color:var(--muted);
        font-size:8px;
        text-transform:uppercase;
        letter-spacing:.05em;
      }

      .decision-tracker-next strong{
        font-size:12px;
        text-align:right;
      }

      .decision-upcoming{
        display:grid;
        grid-template-rows:auto repeat(4,minmax(0,1fr));
        gap:5px;
        flex:1;
        min-height:0;
        margin-top:12px;
      }

      .decision-upcoming-title{
        color:var(--muted);
        font-size:8px;
        font-weight:900;
        letter-spacing:.07em;
        text-transform:uppercase;
      }

      .decision-upcoming-row{
        display:grid;
        grid-template-columns:50px minmax(0,1fr) auto;
        align-items:center;
        gap:9px;
        min-height:0;
        padding:5px 8px;
        border-bottom:1px solid rgba(148,163,184,.16);
        font-size:10px;
      }

      .decision-upcoming-row:last-child{
        border-bottom:0;
      }

      .decision-upcoming-row.user{
        border-radius:6px;
        background:rgba(85,214,139,.08);
      }

      .decision-upcoming-pick{
        color:var(--accent);
        font-weight:900;
      }

      .decision-upcoming-manager{
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-weight:700;
      }

      .decision-upcoming-row.user .decision-upcoming-manager{
        color:var(--good);
      }

      .decision-upcoming-round{
        color:var(--muted);
        font-size:8px;
      }

      .decision-roster-card{
        display:flex;
        flex-direction:column;
        overflow-y:auto;
        padding:13px 15px;
      }

      .decision-hero{
        display:grid;
        grid-template-columns:auto minmax(0,1fr) auto;
        align-items:center;
        gap:14px;
        padding-bottom:14px;
        border-bottom:1px solid var(--line);
      }

      .decision-pick-badge{
        width:64px;
        height:64px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        border:1px solid rgba(109,168,255,.45);
        border-radius:10px;
        background:rgba(109,168,255,.08);
      }

      .decision-pick-badge span{
        color:var(--muted);
        font-size:9px;
        text-transform:uppercase;
        letter-spacing:.08em;
      }

      .decision-pick-badge strong{
        margin-top:2px;
        font-size:24px;
        line-height:1;
      }

      .decision-hero-kicker{
        color:var(--muted);
        font-size:10px;
        margin-bottom:3px;
      }

      .decision-hero-title{
        font-size:clamp(28px,2.2vw,38px);
        line-height:1;
        font-weight:900;
      }

      .decision-chat-button{
        padding:7px 10px;
        font-size:10px;
      }

      .pressure-strip{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        margin-top:15px;
        border:1px solid var(--line);
        border-radius:9px;
        overflow:hidden;
        background:rgba(7,16,31,.28);
      }

      .pressure-tile{
        min-width:0;
        padding:9px 10px 8px;
        border-top:3px solid transparent;
      }

      .pressure-tile + .pressure-tile{
        border-left:1px solid var(--line);
      }

      .pressure-tile-top{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
      }

      .pressure-tile-top strong{font-size:13px}

      .pressure-tile-top span{
        font-size:7px;
        font-weight:900;
      }

      .pressure-tile-bottom{
        margin-top:3px;
        color:var(--muted);
        font-size:9px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .pressure-required,
      .pressure-urgent{
        border-top-color:#ff6b7a;
        background:rgba(255,107,122,.045);
      }

      .pressure-required .pressure-tile-top span,
      .pressure-urgent .pressure-tile-top span{
        color:#ff9eaa;
      }

      .pressure-pressure{
        border-top-color:var(--warn);
        background:rgba(255,200,87,.035);
      }

      .pressure-pressure .pressure-tile-top span,
      .pressure-watch .pressure-tile-top span{
        color:var(--warn);
      }

      .pressure-watch{border-top-color:rgba(255,200,87,.48)}
      .pressure-open{border-top-color:var(--good)}
      .pressure-open .pressure-tile-top span{color:var(--good)}
      .pressure-closed{opacity:.5;border-top-color:#7f8ca5}

      .decision-alert{
        margin-top:16px;
        padding:13px 15px;
        border-left:4px solid var(--accent);
        border-radius:0 8px 8px 0;
        background:rgba(109,168,255,.07);
      }

      .decision-alert-eyebrow{
        display:block;
        margin-bottom:3px;
        color:var(--accent);
        font-size:8px;
        font-weight:900;
        text-transform:uppercase;
      }

      .decision-alert strong{
        display:block;
        font-size:18px;
      }

      .decision-alert p{
        margin:5px 0 0;
        color:#dce5f5;
        font-size:11px;
        line-height:1.3;
      }

      .room-pulse-line{
        display:flex;
        align-items:center;
        gap:10px;
        margin-top:11px;
        color:var(--muted);
        font-size:9px;
      }

      .room-pulse-line b{
        margin-right:4px;
        color:#dce5f5;
      }

      .room-pulse-line i{
        width:1px;
        height:12px;
        background:var(--line);
      }

      .decision-roster-card > .section-title{
        margin-bottom:9px;
        padding-bottom:7px;
        border-bottom:1px solid var(--line);
      }

      .decision-budget-sticky{
        position:relative;
        padding:0 0 9px;
        margin-bottom:3px;
        background:transparent;
      }

      .budget-metrics{
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:5px;
        margin-bottom:7px;
      }

      .budget-metrics > div{
        padding:6px 4px;
        text-align:center;
        border:1px solid var(--line);
        border-radius:6px;
        background:rgba(255,255,255,.025);
      }

      .budget-metrics strong{
        display:block;
        font-size:15px;
      }

      .budget-metrics span{
        display:block;
        margin-top:3px;
        color:var(--muted);
        font-size:7px;
        text-transform:uppercase;
      }

      .budget-strips{display:grid;gap:2px}

      .budget-strip{
        display:grid;
        grid-template-columns:42px 1fr auto;
        gap:7px;
        align-items:center;
        min-height:25px;
        padding:3px 7px;
        border-radius:5px;
        font-size:9px;
      }

      .budget-strip-count{text-align:center}
      .budget-strip-status{font-size:7px;font-weight:900}
      .budget-red{background:rgba(255,107,122,.18);color:#ffd7dc}
      .budget-yellow{background:rgba(255,200,87,.18);color:#ffe6a7}
      .budget-green{background:rgba(85,214,139,.17);color:#c8f8da}
      .budget-closed{background:rgba(148,163,184,.14);color:#c8ced8}

      .budget-summary{
        margin-top:5px;
        padding:5px 6px;
        text-align:center;
        border-radius:6px;
        font-size:8px;
      }

      .decision-roster-card .lineup-slot{
        min-height:26px;
        border:0;
        border-bottom:1px solid rgba(148,163,184,.18);
        border-radius:0;
        background:transparent;
      }

      .decision-roster-card .lineup-pos{
        min-height:25px;
        border-right:0;
        background:transparent;
        color:var(--accent);
        justify-content:flex-start;
        font-size:8px;
      }

      .decision-roster-card .lineup-player{
        padding:4px 2px;
        font-size:10px;
      }

      /* Tiers tab */
      #tiers .tiers-tab-shell{
        display:grid;
        grid-template-rows:auto minmax(0,1fr);
        gap:10px;
        height:calc(100vh - 174px);
        min-height:590px;
        overflow:hidden;
      }

      .tier-pick-tracker{
        display:grid;
        grid-template-columns:auto minmax(180px,1fr) auto;
        align-items:center;
        gap:14px;
        padding:10px 14px;
        border:1px solid var(--line);
        border-radius:10px;
        background:var(--panel);
      }

      .tier-pick-number{
        display:flex;
        align-items:baseline;
        gap:6px;
      }

      .tier-pick-number span{
        color:var(--muted);
        font-size:9px;
        text-transform:uppercase;
      }

      .tier-pick-number strong{
        font-size:24px;
      }

      .tier-on-clock strong{
        display:block;
        font-size:15px;
      }

      .tier-on-clock span{
        color:var(--muted);
        font-size:9px;
      }

      .tier-on-clock.user strong{color:var(--good)}

      .tier-next-user{
        text-align:right;
        font-size:10px;
      }

      .tier-next-user span{
        display:block;
        color:var(--muted);
        font-size:8px;
        text-transform:uppercase;
      }

      .tiers-tab-columns{
        display:grid;
        grid-template-columns:repeat(7,minmax(0,1fr));
        gap:7px;
        min-height:0;
      }

      .tier-tab-card{
        display:flex;
        flex-direction:column;
        min-width:0;
        min-height:0;
        margin:0;
        padding:7px 6px;
        overflow:hidden;
      }

      .tier-tab-column-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:5px;
        padding:2px 2px 6px;
        border-bottom:1px solid var(--line);
      }

      .tier-tab-column-head strong{
        font-size:11px;
        letter-spacing:.03em;
      }

      .tier-tab-column-head span{
        color:var(--muted);
        font-size:8px;
      }

      .tier-tab-scroll{
        flex:1;
        min-height:0;
        overflow-y:auto;
        padding-right:3px;
      }

      .tier-tab-card .tier-section{
        margin:6px 0 7px;
        padding:5px 4px;
        border-radius:7px;
        border:1px solid transparent;
      }

      .tier-tab-card .tier-section .tier-label{
        margin-bottom:3px;
        padding:0 1px 3px;
        font-size:8px;
      }

      .tier-tab-card .player-row{
        margin:0;
        padding:6px 3px;
        border:0;
        border-bottom:1px solid rgba(148,163,184,.14);
        border-radius:0;
        background:transparent;
      }

      .tier-tab-card .player-row:hover{
        background:rgba(109,168,255,.07);
      }

      .tier-tab-card .player-row b{
        display:block;
        font-size:9px;
        line-height:1.12;
      }

      .tier-tab-card .player-row .tiny{
        font-size:7px;
        line-height:1.15;
      }

      .tier-tab-card .tier-section[data-tier="1"]{
        background:rgba(212,175,55,.30);
        border-color:rgba(238,201,73,.52);
      }

      .tier-tab-card .tier-section[data-tier="2"]{
        background:rgba(192,192,192,.24);
        border-color:rgba(224,224,224,.38);
      }

      .tier-tab-card .tier-section[data-tier="3"]{
        background:rgba(205,127,50,.28);
        border-color:rgba(226,151,75,.44);
      }

      .tier-tab-card .tier-section[data-tier="4"],
      .tier-tab-card .tier-section[data-tier="5"],
      .tier-tab-card .tier-section[data-tier="unrated"]{
        background:transparent;
        border-color:transparent;
      }

      .decision-framework{display:grid;gap:7px;margin-top:10px}

      .decision-framework-step,
      .decision-rule-card{
        padding:8px 9px;
        border:1px solid var(--line);
        border-radius:8px;
        background:rgba(255,255,255,.025);
      }

      .decision-rule-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:7px;
        margin-top:9px;
      }

      @media(max-width:1250px){
        .tiers-tab-columns{gap:5px}
        .tier-tab-card{padding:6px 4px}
        .tier-tab-card .player-row{padding:5px 2px}
        .tier-tab-card .player-row b{font-size:8px}
        .tier-tab-card .player-row .tiny{font-size:6px}
      }

      @media(max-width:850px){
        #war-room .decision-tab-layout{
          grid-template-columns:1fr;
          height:auto;
          overflow:visible;
        }

        .decision-left-stack{
          grid-template-rows:auto auto;
        }

        #tiers .tiers-tab-shell{
          height:auto;
          overflow:visible;
        }

        .tiers-tab-columns{min-height:620px}
      }

      @media(max-width:620px){
        .pressure-strip{grid-template-columns:1fr 1fr}
        .tier-tab-card{min-width:0}

        .tier-pick-tracker{
          grid-template-columns:auto 1fr;
        }

        .tier-next-user{
          grid-column:1/-1;
          text-align:left;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function renderDecisionWarRoom(){
    ensureQuickSelectState();
    ensureDecisionStyles();

    const data=decisionData();

    document.getElementById('war-room').innerHTML=`
      <div class="decision-tab-layout">
        <div class="decision-left-stack">
          <div class="card decision-main-card">
            ${renderDecisionPanel(data)}
          </div>

          ${decisionPickTrackerCardHtml()}
        </div>

        <div class="card decision-roster-card">
          <div class="section-title">
            <h3>Your Roster</h3>
          </div>

          ${budgetTableHtml(data)}
          ${rosterCardHtml(USER,false)}
        </div>
      </div>`;

    const chatButton=document.getElementById('askDecisionChatBtn');
    if(chatButton){
      chatButton.onclick=()=>openChatWithDecision(data);
    }

    ensureHeaderDraftControls();
    applyDecisionRulesToCommandments();
  }

  function decisionPickTrackerCardHtml(){
    const data=decisionData();
    const currentManager=managerForPick(state.currentPick);
    const isUser=
      currentManager===USER &&
      !isReservedKeeperPick(state.currentPick);

    let nextText='Draft complete';

    if(data.horizon.immediatePick){
      nextText=data.horizon.immediateOpponents===0
        ? `#${data.horizon.immediatePick} · back-to-back`
        : `#${data.horizon.immediatePick} · ${data.horizon.immediateOpponents} opponent pick${data.horizon.immediateOpponents===1?'':'s'}`;
    }else if(isUser){
      nextText='Final pick';
    }

    const upcoming=[];

    for(let pick=state.currentPick+1; pick<=state.currentPick+4; pick++){
      const manager=managerForPick(pick);
      if(!manager) break;

      const reserved=isReservedKeeperPick(pick);
      const userPick=manager===USER && !reserved;

      upcoming.push(`
        <div class="decision-upcoming-row ${userPick?'user':''}">
          <span class="decision-upcoming-pick">#${pick}</span>
          <span class="decision-upcoming-manager">
            ${reserved?`${manager} · Keeper`:userPick?'HIGH ROEHLER':manager}
          </span>
          <span class="decision-upcoming-round">R${roundForPick(pick)}</span>
        </div>
      `);
    }

    while(upcoming.length<4){
      upcoming.push(`
        <div class="decision-upcoming-row">
          <span class="decision-upcoming-pick">—</span>
          <span class="decision-upcoming-manager muted">Draft complete</span>
          <span class="decision-upcoming-round"></span>
        </div>
      `);
    }

    return `
      <div class="card decision-tracker-card">
        <div class="decision-tracker-label">Draft Tracker</div>

        <div class="decision-tracker-current">
          <div class="decision-tracker-pick">
            <span>Current Pick</span>
            <strong>#${state.currentPick}</strong>
          </div>

          <div class="decision-tracker-owner">
            <strong class="${isUser?'user-pick':''}">
              ${isUser?'YOUR PICK':currentManager}
            </strong>
            <span>Round ${roundForPick(state.currentPick)} · ${isUser?'You are on the clock':'On the clock'}</span>
          </div>
        </div>

        <div class="decision-tracker-next">
          <span>Next High Roehler</span>
          <strong>${nextText}</strong>
        </div>

        <div class="decision-upcoming">
          <div class="decision-upcoming-title">Coming Up</div>
          ${upcoming.join('')}
        </div>
      </div>`;
  }

  function tierPickTrackerHtml(){
    const data=decisionData();
    const currentManager=managerForPick(state.currentPick);
    const isUser=
      currentManager===USER &&
      !isReservedKeeperPick(state.currentPick);

    let nextText='Draft complete';

    if(data.horizon.immediatePick){
      nextText=data.horizon.immediateOpponents===0
        ? `#${data.horizon.immediatePick} · back-to-back`
        : `#${data.horizon.immediatePick} · ${data.horizon.immediateOpponents} opponent pick${data.horizon.immediateOpponents===1?'':'s'}`;
    }else if(isUser){
      nextText='Final pick';
    }

    return `
      <div class="tier-pick-tracker">
        <div class="tier-pick-number">
          <span>Pick</span>
          <strong>#${state.currentPick}</strong>
        </div>

        <div class="tier-on-clock ${isUser?'user':''}">
          <strong>${isUser?'YOUR PICK':currentManager}</strong>
          <span>Round ${roundForPick(state.currentPick)} · ${isUser?'You are on the clock':'On the clock'}</span>
        </div>

        <div class="tier-next-user">
          <span>Next High Roehler</span>
          <strong>${nextText}</strong>
        </div>
      </div>`;
  }

  function groupTierTabSections(container){
    container.querySelectorAll('.tier-tab-scroll').forEach(scroll=>{
      if(scroll.querySelector('.tier-section')) return;

      const children=[...scroll.children];
      if(!children.length) return;

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

  function renderTiers(){
    const container=document.getElementById('tiers');
    if(!container || !state?.players?.length) return;

    ensureDecisionStyles();

    container.innerHTML=`
      <div class="tiers-tab-shell">
        ${tierPickTrackerHtml()}

        <div class="tiers-tab-columns">
          ${TIER_TAB_POSITIONS.map(position=>tierTabCard(position)).join('')}
        </div>
      </div>`;

    groupTierTabSections(container);

    container.querySelectorAll('[data-player]').forEach(el=>{
      el.onclick=()=>openDraftDialog(
        state.players.find(player=>player.id===el.dataset.player)
      );
    });

  }

  function renderDecisionPlaybook(){
    const steps=[
      ['1. Roster Budget','How many required roster spots remain, and how many flexible picks are still available?'],
      ['2. Position Pressure','Which positions are OPEN, WATCH, PRESSURE, URGENT, REQUIRED, or CLOSED?'],
      ['3. Tier Check','Is a useful tier about to disappear before High Roehler picks again?'],
      ['4. Board Value','Use Overall Rank to identify falling value, fair value, and reaches.'],
      ['5. Return Risk','Use ADP only to estimate whether a player is likely to survive until the next pick.'],
      ['6. Room Activity','Recognize positional runs, but check supply before reacting.'],
      ['7. Make the Pick','Choose the player whose value, tier, roster fit, and return risk best fit the board.']
    ];

    const rosterRules=Object.entries(ROSTER_RULES).map(([position,rule])=>{
      let meaning='';

      if(position==='QB'){
        meaning='QB2 is required. QB3 is optional. QB closes after QB3.';
      }else if(position==='RB'){
        meaning='Five is the minimum. RB remains open after RB5.';
      }else if(position==='WR'){
        meaning='Seven is the minimum. WR remains open after WR7.';
      }else if(position==='TE'){
        meaning='Exactly two. TE closes after TE2.';
      }else{
        meaning=`Exactly one. ${position} closes after the first.`;
      }

      return `
        <div class="decision-rule-card">
          <strong>${position} · ${rule.target}</strong>
          <span class="muted">${meaning}</span>
        </div>`;
    }).join('');

    document.getElementById('playbook').innerHTML=`
      <div class="grid" style="grid-template-columns:1.12fr .88fr;align-items:start">
        <div class="card">
          <h2>Draft Decision Framework</h2>
          <div class="muted">The app frames the decision. High Roehler makes the pick.</div>

          <div class="decision-framework">
            ${steps.map(([title,text])=>`
              <div class="decision-framework-step">
                <strong>${title}</strong>
                <span>${text}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <h2>Roster Guardrails</h2>
          <div class="muted">End-of-draft construction rules — not starter counts.</div>

          <div class="decision-rule-grid">
            ${rosterRules}
          </div>

          <h3 style="margin-top:15px">Roster Budget colors</h3>
          <div class="decision-rule-grid">
            <div class="decision-rule-card budget-red">
              <strong>Red · Needed</strong>
              <span>Material work remains before the minimum is reached.</span>
            </div>
            <div class="decision-rule-card budget-yellow">
              <strong>Yellow · Close</strong>
              <span>Near the minimum. Keep the position on your radar.</span>
            </div>
            <div class="decision-rule-card budget-green">
              <strong>Green · Met</strong>
              <span>The minimum is satisfied and the position can still remain open.</span>
            </div>
            <div class="decision-rule-card budget-closed">
              <strong>Gray · Closed</strong>
              <span>A hard ceiling has been reached. Stop adding the position.</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  /*
    Give state-aware Chat the exact same deterministic facts visible in the
    War Room. This prevents the Chat tab from falling back to stale starter-only
    logic when the user asks about roster construction.
  */
  if(typeof snapshotForAI==='function'){
    const snapshotForAIBeforeDecisionCoach=snapshotForAI;

    snapshotForAI=function(){
      const snapshot=snapshotForAIBeforeDecisionCoach();
      const data=decisionData();

      snapshot.strategy=snapshot.strategy||{};
      snapshot.strategy.decisionMode=
        'Decision coach: explain tradeoffs and draft context. Do not make an automatic pick unless the user explicitly asks you to choose.';
      snapshot.strategy.rosterGuardrails={
        QB:{min:2,max:3},
        RB:{min:5,max:null},
        WR:{min:7,max:null},
        TE:{min:2,max:2},
        DP:{min:1,max:1},
        'D/ST':{min:1,max:1},
        K:{min:1,max:1}
      };

      snapshot.decisionSupport={
        rosterBudget:data.budget,
        primaryFocus:data.primaryFocus,
        decisionQuestion:data.question,
        positionPressure:Object.fromEntries(
          CORE_POSITIONS.map(position=>[
            position,
            {
              ...data.pressures[position],
              tier:{
                tier:data.tiers[position].tier,
                remaining:data.tiers[position].count,
                nextTier:data.tiers[position].nextTier,
                severity:data.tiers[position].severity
              }
            }
          ])
        ),
        turn:{
          currentPick:state.currentPick,
          backToBack:data.horizon.backToBack,
          nextUserPick:data.horizon.immediatePick,
          opponentPicksBeforeNext:data.horizon.immediateOpponents,
          followingTurnPick:data.horizon.afterTurnPick,
          opponentPicksBeforeFollowingTurn:data.horizon.afterTurnOpponents
        },
        roomRuns:data.runs.runs,
        topCandidates:data.candidates.map(item=>({
          player:playerCompact(item.player),
          boardValue:item.value,
          returnRisk:item.risk
        }))
      };

      return snapshot;
    };
  }

  /*
    Final presentation override. No Recommend button is rendered anywhere.
  */
  renderWarRoom=renderDecisionWarRoom;
  renderPlaybook=renderDecisionPlaybook;

  if(typeof renderAll==='function'){
    const renderAllBeforeTiers=renderAll;

    renderAll=function(){
      renderAllBeforeTiers();
      renderTiers();
    };
  }

  applyDecisionRulesToCommandments();

  if(typeof state!=='undefined' && state?.players?.length){
    renderWarRoom();
    renderTiers();
    renderPlaybook();
  }

  window.DWR_DecisionCoach={
    version:'0.18.4',
    rosterRules:ROSTER_RULES,
    decisionRules:DECISION_RULES,
    buildRosterBudgetFromCounts,
    decisionData,
    runEvidence,
    tierSnapshot,
    renderTiers
  };

  console.log('Draft War Room Pick Decision Coach v0.18.4 loaded.');
})();