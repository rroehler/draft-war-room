/* ==========================================================================
   Draft War Room — Opponent Draft Simulator v0.16.4

   Purpose:
   - Simulate realistic opponent selections locally during MOCK drafts.
   - Uses market ADP as the primary proxy for how other managers draft.
   - Uses our Overall Rank only as a secondary value signal.
   - Respects actual availability, keepers, roster construction, snake order,
     and reserved keeper picks already implemented by the app.
   - Never calls OpenAI and never runs in Live Draft mode.
   ========================================================================== */

(function(){
  const USER_MANAGER='High Roehler';
  const LAST_DRAFT_PICK=264;
  const SIM_PICK_DELAY_MS=3000;

  let simulationInProgress=false;

  function wait(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
  }

  const STARTER_REQUIREMENTS={
    QB:1,
    RB:2,
    WR:3,
    TE:1,
    DP:1,
    'D/ST':1,
    K:1
  };

  /* Absolute safety caps. Actual desired roster totals come from each
     manager's persistent simulator profile and are intentionally different. */
  const HARD_POSITION_CAPS={
    QB:3,
    RB:9,
    WR:10,
    TE:3,
    DP:2,
    'D/ST':3,
    K:2
  };

  const TIER_BONUS={1:12,2:7,3:3,4:0,5:-1,6:-2};

  function numeric(value,fallback){
    const n=Number(value);
    return Number.isFinite(n) && n>0 ? n : fallback;
  }

  function availablePlayers(){
    return (state.players||[]).filter(player=>!player.draftedBy);
  }

  function managerCounts(manager){
    return typeof counts==='function'
      ? counts(manager)
      : (()=>{
          const result={QB:0,RB:0,WR:0,TE:0,DP:0,'D/ST':0,K:0};
          (state.players||[])
            .filter(player=>player.draftedBy===manager)
            .forEach(player=>{
              if(result[player.position]!==undefined) result[player.position]++;
            });
          return result;
        })();
  }

  function managerRosterSize(manager){
    return Object.values(managerCounts(manager)).reduce((a,b)=>a+b,0);
  }

  /* ------------------------------------------------------------------------
     Persistent manager profiles
     ------------------------------------------------------------------------
     A mock should feel like 11 different humans rather than 11 copies of the
     same optimizer. Profiles remain stable throughout one mock and regenerate
     when a new mock begins.

     League-specific assumptions from the user's room:
     - Most managers carry 2 QBs; a few carry 3 and a few stop at 1.
     - Most managers carry 2 D/ST; a few carry 3 and a few stop at 1.
     - TE reaches happen and some managers actively attack the position.
     - QB runs have been common in prior drafts.
     ------------------------------------------------------------------------ */

  function nameHash(text){
    let hash=2166136261;
    for(let i=0;i<text.length;i++){
      hash^=text.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return hash>>>0;
  }

  function ensureSimulatorSeed(){
    if(!Number.isInteger(state.simulatorSeed)){
      state.simulatorSeed=Math.floor(Math.random()*0x7fffffff);
      if(typeof save==='function') save();
    }
    return state.simulatorSeed;
  }

  function seededUnit(key){
    let x=nameHash(`${ensureSimulatorSeed()}|${key}`) || 1;
    x^=x<<13; x^=x>>>17; x^=x<<5;
    return ((x>>>0)%1000000)/1000000;
  }

  function weightedTarget(key,distribution){
    const roll=seededUnit(key);
    let cumulative=0;
    for(const [value,weight] of distribution){
      cumulative+=weight;
      if(roll<=cumulative) return value;
    }
    return distribution[distribution.length-1][0];
  }

  const ARCHETYPES=[
    'balanced',
    'rb-heavy',
    'wr-heavy',
    'qb-aggressive',
    'te-aggressive',
    'value-hunter',
    'hero-rb'
  ];

  function managerProfile(manager){
    const archetype=ARCHETYPES[
      Math.floor(seededUnit(`${manager}|archetype`)*ARCHETYPES.length)
    ];

    /* Most teams finish with two. A few deliberately carry three. */
    let qbTarget=weightedTarget(`${manager}|qbTarget`,[
      [1,0.12],[2,0.74],[3,0.14]
    ]);

    /* League-specific D/ST behavior:
       most managers carry exactly one; roughly 3-4 of 11 opponents will
       carry a second or third defense. */
    let dstTarget=weightedTarget(`${manager}|dstTarget`,[
      [1,0.64],[2,0.27],[3,0.09]
    ]);

    /* TE is more varied because this league has shown real reaches. */
    let teTarget=weightedTarget(`${manager}|teTarget`,[
      [1,0.25],[2,0.55],[3,0.20]
    ]);

    let kTarget=weightedTarget(`${manager}|kTarget`,[
      [1,0.90],[2,0.10]
    ]);

    const profile={
      archetype,
      targets:{
        QB:qbTarget,
        RB:7,
        WR:8,
        TE:teTarget,
        DP:1,
        'D/ST':dstTarget,
        K:kTarget
      },
      bias:{QB:0,RB:0,WR:0,TE:0,DP:0,'D/ST':0,K:0},
      qbAggression:seededUnit(`${manager}|qbAggression`),
      teAggression:seededUnit(`${manager}|teAggression`),
      rbAggression:seededUnit(`${manager}|rbAggression`),
      wrAggression:seededUnit(`${manager}|wrAggression`),
      runSensitivity:0.65+seededUnit(`${manager}|runSensitivity`)*0.70,
      reachTolerance:0.75+seededUnit(`${manager}|reachTolerance`)*0.55
    };

    if(archetype==='rb-heavy'){
      profile.bias.RB+=8; profile.bias.WR-=3;
      profile.targets.RB=8; profile.targets.WR=7;
    }else if(archetype==='wr-heavy'){
      profile.bias.WR+=8; profile.bias.RB-=3;
      profile.targets.WR=9; profile.targets.RB=6;
    }else if(archetype==='qb-aggressive'){
      profile.bias.QB+=10;
      profile.qbAggression=Math.max(profile.qbAggression,0.82);
      profile.targets.QB=Math.max(2,profile.targets.QB);
    }else if(archetype==='te-aggressive'){
      profile.bias.TE+=11;
      profile.teAggression=Math.max(profile.teAggression,0.85);
      profile.targets.TE=Math.max(2,profile.targets.TE);
    }else if(archetype==='value-hunter'){
      profile.reachTolerance=Math.min(profile.reachTolerance,0.88);
    }else if(archetype==='hero-rb'){
      profile.bias.WR+=5;
      profile.bias.RB-=1;
      profile.targets.WR=9;
      profile.targets.RB=6;
    }

    /* Small manager-specific noise around the archetype. */
    for(const pos of ['QB','RB','WR','TE','DP','D/ST','K']){
      const noise=Math.floor(seededUnit(`${manager}|${pos}|noise`)*7)-3;
      profile.bias[pos]+=noise;
    }

    return profile;
  }

  function simulatorProfiles(){
    return Object.fromEntries(
      MANAGERS
        .filter(manager=>manager!==USER_MANAGER)
        .map(manager=>[manager,managerProfile(manager)])
    );
  }

  function recentPositionCounts(limit=8){
    const result={QB:0,RB:0,WR:0,TE:0,DP:0,'D/ST':0,K:0};
    (state.history||[]).slice(-limit).forEach(entry=>{
      const player=(state.players||[]).find(p=>p.id===entry.id);
      if(player && result[player.position]!==undefined){
        result[player.position]++;
      }
    });
    return result;
  }

  function livePicksRemainingFor(manager){
    let remaining=0;
    for(let pick=state.currentPick;pick<=LAST_DRAFT_PICK;pick++){
      if(managerForPick(pick)!==manager) continue;
      if(typeof keeperAtPick==='function' && keeperAtPick(pick)) continue;
      remaining++;
    }
    return remaining;
  }

  function missingFixedPositions(manager){
    const c=managerCounts(manager);
    return Object.entries(STARTER_REQUIREMENTS)
      .filter(([pos,need])=>(c[pos]||0)<need)
      .map(([pos])=>pos);
  }

  function lateForcedPositions(manager){
    const missing=missingFixedPositions(manager);
    const picksLeft=livePicksRemainingFor(manager);
    const round=roundForPick(state.currentPick);

    /* Hard starter safety remains the first priority. */
    if(missing.length && picksLeft<=missing.length){
      return new Set(missing);
    }

    /* League-specific late bench construction:
       most managers in this room carry QB2 and D/ST2, while a minority carry
       QB3 / D/ST3. Profiles vary those targets per manager. Once the draft is
       almost over, protect enough remaining selections to make those tendencies
       show up in the finished rosters instead of letting every final pick become
       another RB/WR dart throw. */
    if(round>=18){
      const c=managerCounts(manager);
      const profile=managerProfile(manager);
      const secondaryPositions=[];
      let secondaryDeficit=0;

      for(const pos of ['QB','D/ST']){
        const target=profile.targets[pos]||1;
        const deficit=Math.max(0,target-(c[pos]||0));
        if(deficit>0){
          secondaryPositions.push(pos);
          secondaryDeficit+=deficit;
        }
      }

      const totalProtected=missing.length+secondaryDeficit;
      const buffer=round>=20 ? 0 : 1;

      if(
        totalProtected>0 &&
        picksLeft<=totalProtected+buffer
      ){
        return new Set([...missing,...secondaryPositions]);
      }
    }

    return null;
  }

  function positionAllowed(player,manager,round,forcedPositions){
    const pos=player.position;
    const c=managerCounts(manager);
    const profile=managerProfile(manager);
    const target=profile.targets[pos] ?? HARD_POSITION_CAPS[pos] ?? 99;

    if(forcedPositions && !forcedPositions.has(pos)) return false;

    const hardCap=HARD_POSITION_CAPS[pos];
    if(hardCap!=null && (c[pos]||0)>=hardCap) return false;

    /* QB: most managers want two, a few want three. QB2 is allowed earlier
       than a generic one-QB simulator because this room has historically
       produced real QB runs. QB3 remains a later depth behavior. */
    if(pos==='QB'){
      if((c.QB||0)>=target) return false;
      if((c.QB||0)>=2 && round<13) return false;
      if((c.QB||0)>=1 && round<6 && profile.qbAggression<0.90) return false;
    }

    /* TE reaches are intentionally allowed. Aggressive TE managers can take
       TE2 surprisingly early; TE3 is still mainly a later bench choice. */
    if(pos==='TE'){
      if((c.TE||0)>=target) return false;
      if((c.TE||0)>=2 && round<12) return false;
      if((c.TE||0)>=1 && round<6 && profile.teAggression<0.82) return false;
    }

    /* One IDP starter: do not let it distort the valuable early/middle rounds. */
    if(pos==='DP'){
      if((c.DP||0)>=1 && round<17) return false;
      if(round<11) return false;
    }

    /* This particular room commonly carries multiple defenses, but they should
       still be a late-draft behavior rather than a Round-8 value source. */
    if(pos==='D/ST'){
      if((c['D/ST']||0)>=target) return false;
      if((c['D/ST']||0)===0 && round<13) return false;
      if((c['D/ST']||0)===1 && round<16) return false;
      if((c['D/ST']||0)>=2 && round<19) return false;
    }

    if(pos==='K'){
      if((c.K||0)>=target) return false;
      if((c.K||0)===0 && round<17) return false;
      if((c.K||0)>=1 && round<21) return false;
    }

    return true;
  }

  function positionNeedScore(pos,manager,round){
    const c=managerCounts(manager);
    const count=c[pos]||0;
    const profile=managerProfile(manager);
    const target=profile.targets[pos]||1;

    if(pos==='RB'){
      if(count===0) return 20;
      if(count===1) return 16;
      if(count===2) return 7;
      if(count===3) return 3;
      if(count===4) return 1;
      if(count===5) return profile.targets.RB>=8 ? 0 : -2;
      if(count===6) return profile.targets.RB>=8 ? -2 : -6;
      if(count===7) return profile.targets.RB>=8 ? -5 : -10;
      return -16;
    }

    if(pos==='WR'){
      if(count===0) return 22;
      if(count===1) return 18;
      if(count===2) return 15;
      if(count===3) return 8;
      if(count===4) return 5;
      if(count===5) return 2;
      if(count===6) return profile.targets.WR>=9 ? 0 : -3;
      if(count===7) return profile.targets.WR>=9 ? -2 : -7;
      if(count===8) return profile.targets.WR>=9 ? -5 : -11;
      return -16;
    }

    if(pos==='QB'){
      if(count===0){
        let score=0;
        if(round<=2) score=-2+profile.qbAggression*8;
        else if(round<=4) score=4+profile.qbAggression*9;
        else if(round<=7) score=9+profile.qbAggression*8;
        else score=14;
        return score;
      }

      if(count===1){
        if(target<2) return -30;
        if(round<6) return -28;
        if(round<=9) return -10+profile.qbAggression*8;
        if(round<=13) return 3+profile.qbAggression*6;
        if(round<=17) return 10;
        return 15;
      }

      if(count===2){
        if(target<3) return -45;
        if(round<13) return -45;
        if(round<=17) return -4+profile.qbAggression*7;
        if(round<=19) return 8;
        return 13;
      }

      return -70;
    }

    if(pos==='TE'){
      if(count===0){
        /* Aggressive TE managers can make real reaches in Rounds 2–5. */
        if(round===1) return profile.teAggression>0.92 ? 5 : 0;
        if(round<=3) return 4+profile.teAggression*10;
        if(round<=7) return 9+profile.teAggression*8;
        return 14;
      }

      if(count===1){
        if(target<2) return -28;
        if(round<5) return profile.teAggression>0.92 ? -5 : -35;
        if(round<=8) return -10+profile.teAggression*10;
        if(round<=13) return 3+profile.teAggression*6;
        if(round<=17) return 8;
        return 11;
      }

      if(count===2){
        if(target<3) return -42;
        if(round<12) return -42;
        if(round<=17) return -10+profile.teAggression*5;
        return 2;
      }

      return -70;
    }

    if(pos==='DP'){
      if(count===0) return round>=13 ? 12 : 4;
      if(count===1) return round>=19 ? -10 : -50;
      return -65;
    }

    if(pos==='D/ST'){
      if(count===0){
        if(round<13) return -50;
        if(round<=15) return 5;
        return 12;
      }
      if(count===1){
        if(target<2) return -40;
        if(round<16) return -50;
        if(round<=18) return 8;
        if(round<=20) return 14;
        return 18;
      }
      if(count===2){
        if(target<3) return -50;
        if(round<19) return -60;
        if(round<=20) return 8;
        return 14;
      }
      return -70;
    }

    if(pos==='K'){
      if(count===0) return round>=18 ? 12 : -20;
      if(count===1 && target>=2 && round>=21) return -2;
      return -65;
    }

    return 0;
  }

  function structuralUrgency(pos,manager,round){
    const c=managerCounts(manager);
    const need=STARTER_REQUIREMENTS[pos]||0;
    const missing=Math.max(0,need-(c[pos]||0));
    if(!missing) return 0;

    /* Starter gaps gradually matter more as the mock progresses. */
    if(round>=10) return missing*8;
    if(round>=7) return missing*5;
    if(round>=4) return missing*2;
    return 0;
  }

  function tierScarcityScore(player){
    const pos=player.position;
    const tier=numeric(player.tier,99);
    if(tier>=99) return 0;

    const sameTier=availablePlayers().filter(p=>
      p.position===pos && numeric(p.tier,99)===tier
    ).length;

    if(sameTier===1) return 5;
    if(sameTier===2) return 3;
    if(sameTier<=4) return 1;
    return 0;
  }

  function marketScore(player,pick,manager){
    const rank=numeric(player.rank,999);
    const adp=numeric(player.adp,rank<999?rank+8:999);
    const c=managerCounts(manager);
    const already=c[player.position]||0;

    /* Other managers behave mostly like the market, not like our custom board. */
    const blended=0.76*adp + 0.24*rank;
    let score=160-blended;

    /* Falling starters should get scooped up. Falling bench duplicates should
       not automatically force every roster into the same QB/TE/DST totals. */
    const overdue=pick-adp;
    if(overdue>0){
      let multiplier=2.55;
      let cap=46;

      if(player.position==='QB' && already>=1){
        multiplier=already>=2 ? 0.70 : 1.15;
        cap=already>=2 ? 10 : 18;
      }else if(player.position==='TE' && already>=1){
        multiplier=already>=2 ? 0.75 : 1.30;
        cap=already>=2 ? 11 : 21;
      }else if(player.position==='D/ST' && already>=1){
        multiplier=0.90;
        cap=14;
      }else if(player.position==='K' && already>=1){
        multiplier=0.45;
        cap=7;
      }

      score+=Math.min(cap,overdue*multiplier);
    }

    /* Normal reaches happen. Manager personality and positional runs can make
       QB/TE reaches noticeably more aggressive than a sterile ADP simulator. */
    const profile=managerProfile(manager);
    let reachTolerance=profile.reachTolerance;
    if(player.position==='QB') reachTolerance*=0.90+profile.qbAggression*0.28;
    if(player.position==='TE') reachTolerance*=0.90+profile.teAggression*0.35;

    const reach=adp-pick;
    if(reach>8) score-=(reach-8)*(1.35/reachTolerance);
    if(reach>22) score-=(reach-22)*(1.65/reachTolerance);

    return score;
  }

  function runPressureScore(pos,manager){
    const recent6=recentPositionCounts(6);
    const recent10=recentPositionCounts(10);
    const profile=managerProfile(manager);
    const count6=recent6[pos]||0;
    const count10=recent10[pos]||0;

    if(pos==='QB'){
      /* QB runs are intentionally the strongest run effect in this room. */
      let score=0;
      if(count6>=2) score+=4;
      if(count6>=3) score+=6;
      if(count6>=4) score+=6;
      if(count10>=5) score+=5;
      return score*profile.runSensitivity;
    }

    if(pos==='TE'){
      let score=0;
      if(count6>=2) score+=3;
      if(count6>=3) score+=3;
      if(count10>=4) score+=2;
      return score*profile.runSensitivity;
    }

    let score=0;
    if(count6>=3) score+=2;
    if(count6>=5) score+=2;
    return score*profile.runSensitivity;
  }

  function targetDepthScore(pos,manager,round){
    const c=managerCounts(manager);
    const profile=managerProfile(manager);
    const target=profile.targets[pos]||0;
    const count=c[pos]||0;
    if(count>=target) return 0;

    /* These preferences get stronger late so the room actually develops the
       league-specific bench patterns instead of converging on RB/WR depth. */
    if(pos==='QB'){
      if(count===1 && target>=2){
        if(round>=20) return 24;
        if(round>=16) return 14;
        if(round>=10) return 5;
      }
      if(count===2 && target>=3){
        if(round>=20) return 22;
        if(round>=17) return 8;
      }
    }

    if(pos==='TE'){
      if(count===1 && target>=2){
        if(round>=18) return 12;
        if(round>=15) return 7;
        if(round>=9) return 3;
      }
      if(count===2 && target>=3){
        if(round>=20) return 10;
        if(round>=16) return 3;
      }
    }

    if(pos==='D/ST'){
      if(count===1 && target>=2){
        if(round>=20) return 32;
        if(round>=18) return 20;
        if(round>=16) return 8;
      }
      if(count===2 && target>=3){
        if(round>=21) return 28;
        if(round>=19) return 16;
      }
    }

    return 0;
  }

  function candidateScore(player,manager,pick){
    const round=roundForPick(pick);
    const pos=player.position;
    const profile=managerProfile(manager);
    const tier=numeric(player.tier,99);

    let score=marketScore(player,pick,manager);
    score+=positionNeedScore(pos,manager,round);
    score+=structuralUrgency(pos,manager,round);
    score+=profile.bias[pos]||0;
    score+=TIER_BONUS[tier]||0;
    score+=tierScarcityScore(player);
    score+=targetDepthScore(pos,manager,round);
    score+=runPressureScore(pos,manager);

    /* Extra room-specific aggression. */
    if(pos==='QB' && round<=8) score+=profile.qbAggression*3;
    if(pos==='TE' && round<=8) score+=profile.teAggression*4;

    /* Keep simulations from becoming identical without allowing wild reaches. */
    score+=(Math.random()-0.5)*8;

    return score;
  }

  function marketMetric(player){
    const rank=numeric(player.rank,999);
    const adp=numeric(player.adp,rank<999?rank+8:999);
    return 0.78*adp+0.22*rank;
  }

  function candidatePool(manager,pick){
    const round=roundForPick(pick);
    const forced=lateForcedPositions(manager);
    const all=availablePlayers();

    let pool=all.filter(player=>positionAllowed(player,manager,round,forced));

    /* Market guardrail: an early/mid-round manager normally chooses from a
       reasonably local part of the market board. This prevents ADP-20 players
       from sliding to pick 45 while still allowing normal reaches. */
    const profile=managerProfile(manager);
    const baseReachWindow=pick<=72 ? 22 : pick<=144 ? 30 : 42;
    const guarded=pool.filter(player=>{
      const adp=numeric(player.adp,999);
      const rank=numeric(player.rank,999);

      let reachWindow=baseReachWindow;
      if(player.position==='QB'){
        reachWindow+=Math.round(profile.qbAggression*10);
        if((recentPositionCounts(6).QB||0)>=3) reachWindow+=8;
      }
      if(player.position==='TE'){
        reachWindow+=Math.round(profile.teAggression*14);
      }

      return adp<=pick+reachWindow || rank<=pick+Math.max(14,reachWindow-6);
    });

    if(guarded.length>=8) pool=guarded;

    /* Keep scoring work bounded while preserving every realistically selectable
       player around the current market range. */
    return pool
      .slice()
      .sort((a,b)=>marketMetric(a)-marketMetric(b))
      .slice(0,70);
  }

  function weightedChoice(scored){
    if(!scored.length) return null;

    scored.sort((a,b)=>b.score-a.score);
    const finalists=scored.slice(0,6);
    const best=finalists[0].score;

    /* Softmax over only the plausible finalists. Most picks come from the top
       2-3 choices, but different mocks can diverge naturally. */
    const temperature=5.5;
    const weights=finalists.map(item=>Math.exp((item.score-best)/temperature));
    const total=weights.reduce((a,b)=>a+b,0);
    let roll=Math.random()*total;

    for(let i=0;i<finalists.length;i++){
      roll-=weights[i];
      if(roll<=0) return finalists[i].player;
    }

    return finalists[0].player;
  }

  function choosePlayerForManager(manager,pick=state.currentPick){
    const pool=candidatePool(manager,pick);
    const scored=pool.map(player=>({
      player,
      score:candidateScore(player,manager,pick)
    }));

    let chosen=weightedChoice(scored);

    /* Absolute fallback should only be reachable very late in strange tests. */
    if(!chosen){
      chosen=availablePlayers()
        .slice()
        .sort((a,b)=>marketMetric(a)-marketMetric(b))[0]||null;
    }

    return chosen;
  }

  function advanceReservedKeeperPicks(){
    while(
      state.currentPick<=LAST_DRAFT_PICK &&
      typeof keeperAtPick==='function' &&
      keeperAtPick(state.currentPick)
    ){
      state.currentPick++;
    }
  }

  /* Fast batch assignment: mirrors draftPlayer history semantics but renders once
     at the end instead of rebuilding the whole UI after every simulated pick. */
  function assignSimulatedPick(player,manager){
    if(!player || player.draftedBy) return null;

    const pick=state.currentPick;
    player.draftedBy=manager;
    player.isKeeper=false;

    state.history=state.history||[];
    state.history.push({
      id:player.id,
      manager,
      isKeeper:false,
      prevPick:pick,
      simulated:true
    });

    state.currentPick++;
    advanceReservedKeeperPicks();
    state.recommendation=null;

    return {
      pick,
      round:roundForPick(pick),
      manager,
      playerId:player.id,
      player:player.name,
      position:player.position,
      adp:player.adp||null,
      rank:player.rank||null
    };
  }

  function simulationAllowed(){
    if(state.draftMode==='live'){
      alert('Simulation is disabled while Live Draft mode is active.');
      return false;
    }
    return true;
  }

  function simulateOneOpponentPick(){
    if(!simulationAllowed()) return [];

    advanceReservedKeeperPicks();

    if(state.currentPick>LAST_DRAFT_PICK) return [];

    const manager=managerForPick(state.currentPick);
    if(manager===USER_MANAGER){
      alert('High Roehler is on the clock. Make your pick first, then simulate the opponents.');
      return [];
    }

    const before=state.history?.length||0;
    const startPick=state.currentPick;
    const player=choosePlayerForManager(manager,state.currentPick);
    const result=assignSimulatedPick(player,manager);
    const picks=result?[result]:[];

    if(picks.length){
      state.simulationLastBatch={
        historyLengthBefore:before,
        historyLengthAfter:state.history.length,
        startPick,
        endPick:state.currentPick,
        picks
      };
      save();
      renderAll();
      announceSimulation(picks);
    }

    return picks;
  }

  async function simulateToMyPick(){
    if(simulationInProgress) return [];
    if(!simulationAllowed()) return [];

    advanceReservedKeeperPicks();

    if(state.currentPick>LAST_DRAFT_PICK) return [];

    if(managerForPick(state.currentPick)===USER_MANAGER){
      alert('High Roehler is already on the clock. Make your pick first, then use Sim to My Pick.');
      return [];
    }

    const historyLengthBefore=state.history?.length||0;
    const startPick=state.currentPick;
    const simulated=[];
    let safety=0;

    simulationInProgress=true;
    state.simulationLastBatch=null;
    refreshSimulatorControls();

    try{
      while(
        state.currentPick<=LAST_DRAFT_PICK &&
        managerForPick(state.currentPick)!==USER_MANAGER &&
        safety<80
      ){
        safety++;

        /*
          Keeper-reserved selections are not live picks, so move across them
          immediately. The next real opponent pick still gets the full 3-second
          viewing window.
        */
        const beforeKeeperSkip=state.currentPick;
        advanceReservedKeeperPicks();

        if(state.currentPick!==beforeKeeperSkip){
          save();
          renderAll();
          refreshSimulatorControls();
        }

        if(state.currentPick>LAST_DRAFT_PICK) break;
        if(managerForPick(state.currentPick)===USER_MANAGER) break;

        const manager=managerForPick(state.currentPick);
        const player=choosePlayerForManager(manager,state.currentPick);
        if(!player) break;

        const result=assignSimulatedPick(player,manager);
        if(!result) break;

        simulated.push(result);

        /*
          Persist and render after EVERY opponent selection. This is the key
          training behavior: the user gets a live-looking draft room for three
          seconds before the next player comes off the board.
        */
        save();
        renderAll();
        refreshSimulatorControls();

        if(typeof showDraftActivity==='function'){
          showDraftActivity(
            `SIM · #${result.pick} ${result.manager} drafted ${result.player}, ${result.position}`,
            'draft'
          );
        }

        /*
          Keep each completed live pick visible for a full three seconds.
          Do not wait after the final opponent selection once High Roehler is
          already on the clock.
        */
        if(
          state.currentPick<=LAST_DRAFT_PICK &&
          managerForPick(state.currentPick)!==USER_MANAGER
        ){
          await wait(SIM_PICK_DELAY_MS);
        }
      }

      if(simulated.length){
        state.simulationLastBatch={
          historyLengthBefore,
          historyLengthAfter:state.history.length,
          startPick,
          endPick:state.currentPick,
          picks:simulated
        };

        save();
        renderAll();
        announceSimulation(simulated);
      }

      return simulated;
    }finally{
      simulationInProgress=false;
      refreshSimulatorControls();

      /*
        renderAll() may have recreated the header controls while the async loop
        was running. Refresh once more after the flag changes so the final
        buttons always return to their normal state.
      */
      if(typeof renderAll==='function'){
        renderAll();
      }
      refreshSimulatorControls();
    }
  }

  function canUndoLastSimulation(){
    const batch=state.simulationLastBatch;
    return !!(
      batch &&
      Number.isInteger(batch.historyLengthBefore) &&
      Number.isInteger(batch.historyLengthAfter) &&
      (state.history?.length||0)===batch.historyLengthAfter
    );
  }

  function undoLastSimulation(){
    if(!canUndoLastSimulation()){
      alert('There is no untouched simulation batch to undo.');
      return;
    }

    const batch=state.simulationLastBatch;

    while((state.history?.length||0)>batch.historyLengthBefore){
      const entry=state.history.pop();
      const player=state.players.find(p=>p.id===entry.id);
      if(player && !player.isKeeper){
        player.draftedBy=null;
        player.isKeeper=false;
      }
    }

    state.currentPick=batch.startPick;
    state.recommendation=null;
    state.simulationLastBatch=null;
    save();
    renderAll();

    if(typeof showDraftActivity==='function'){
      showDraftActivity(`Simulation undone · back to pick #${state.currentPick}`,'undo');
    }
  }

  function announceSimulation(picks){
    if(!picks.length) return;

    const next=state.currentPick<=LAST_DRAFT_PICK
      ? `${managerForPick(state.currentPick)} at #${state.currentPick}`
      : 'draft complete';

    if(typeof showDraftActivity==='function'){
      const range=picks.length===1
        ? `#${picks[0].pick}`
        : `#${picks[0].pick}–${picks[picks.length-1].pick}`;
      showDraftActivity(
        `Simulated ${picks.length} opponent pick${picks.length===1?'':'s'} ${range} · ${next}`,
        'draft'
      );
    }

    console.groupCollapsed(`Draft War Room simulation · ${picks.length} picks`);
    console.table(picks.map(p=>({
      Pick:p.pick,
      Manager:p.manager,
      Player:p.player,
      Pos:p.position,
      ADP:p.adp,
      Rank:p.rank
    })));
    console.groupEnd();

    console.groupCollapsed('Draft War Room simulator profiles');
    console.table(
      Object.entries(simulatorProfiles()).map(([manager,p])=>({
        Manager:manager,
        Archetype:p.archetype,
        QB:p.targets.QB,
        TE:p.targets.TE,
        'D/ST':p.targets['D/ST'],
        RB:p.targets.RB,
        WR:p.targets.WR
      }))
    );
    console.groupEnd();
  }

  function ensureSimulatorStyles(){
    if(document.getElementById('dwrSimulatorStyles')) return;
    const style=document.createElement('style');
    style.id='dwrSimulatorStyles';
    style.textContent=`
      #simToMyPickBtn.sim-ready{font-weight:700}
      #simToMyPickBtn:disabled,#undoSimulationBtn:disabled{opacity:.45;cursor:not-allowed}
      #simToMyPickBtn:disabled{white-space:nowrap}
      #undoSimulationBtn{white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function refreshSimulatorControls(){
    const sim=document.getElementById('simToMyPickBtn');
    const undo=document.getElementById('undoSimulationBtn');
    if(!sim || !undo) return;

    const isLive=state.draftMode==='live';
    const userOnClock=
      state.currentPick<=LAST_DRAFT_PICK &&
      managerForPick(state.currentPick)===USER_MANAGER;

    sim.disabled=
      simulationInProgress ||
      isLive ||
      userOnClock ||
      state.currentPick>LAST_DRAFT_PICK;

    sim.textContent=simulationInProgress
      ? 'Simulating…'
      : 'Sim to My Pick';

    sim.classList.toggle('sim-ready',!sim.disabled);

    sim.title=simulationInProgress
      ? 'Opponent picks are advancing one at a time every 3 seconds'
      : isLive
        ? 'Disabled during Live Draft mode'
        : userOnClock
          ? 'Make High Roehler\'s pick first'
          : 'Simulate realistic opponent picks one at a time until High Roehler is on the clock';

    undo.disabled=simulationInProgress || !canUndoLastSimulation();
  }

  function ensureSimulatorControls(){
    ensureSimulatorStyles();
    const actions=document.querySelector('.header-actions');
    if(!actions) return;

    let sim=document.getElementById('simToMyPickBtn');
    if(!sim){
      sim=document.createElement('button');
      sim.id='simToMyPickBtn';
      sim.textContent='Sim to My Pick';
      sim.onclick=()=>{
        simulateToMyPick().catch(error=>{
          console.error('Timed simulation failed.',error);
          simulationInProgress=false;
          refreshSimulatorControls();
          alert(error?.message || 'Timed simulation failed.');
        });
      };

      const anchor=document.getElementById('headerUndoBtn');
      if(anchor) actions.insertBefore(sim,anchor);
      else actions.appendChild(sim);
    }

    let undo=document.getElementById('undoSimulationBtn');
    if(!undo){
      undo=document.createElement('button');
      undo.id='undoSimulationBtn';
      undo.textContent='Undo Sim';
      undo.onclick=undoLastSimulation;

      const anchor=document.getElementById('headerUndoBtn');
      if(anchor) actions.insertBefore(undo,anchor);
      else actions.appendChild(undo);
    }

    refreshSimulatorControls();
  }

  /* Keep button state synchronized after any War Room render. */
  if(typeof renderWarRoom==='function'){
    const renderWarRoomBeforeSimulator=renderWarRoom;
    renderWarRoom=function(){
      renderWarRoomBeforeSimulator();
      ensureSimulatorControls();
      refreshSimulatorControls();
    };
  }

  /* New mocks get a fresh set of manager personalities. */
  if(typeof startNewMock==='function'){
    const startNewMockBeforeSimulatorProfiles=startNewMock;
    startNewMock=function(keepPreDraftSetup){
      state.simulatorSeed=Math.floor(Math.random()*0x7fffffff);
      state.simulationLastBatch=null;
      startNewMockBeforeSimulatorProfiles(keepPreDraftSetup);
    };
  }

  window.DWR_simulator={
    version:'0.16.4',
    choosePlayerForManager,
    managerProfile,
    simulatorProfiles,
    pickDelayMs:SIM_PICK_DELAY_MS,
    simulateOneOpponentPick,
    simulateToMyPick,
    undoLastSimulation,
    canUndoLastSimulation
  };

  ensureSimulatorControls();

  console.log('Draft War Room Opponent Draft Simulator v0.16.4 loaded.');
})();
