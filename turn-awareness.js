/* ==========================================================================
   Draft War Room — Snake Turn Awareness v0.15.4
   Makes "next pick" mean the next LIVE High Roehler selection after the
   current selection, and exposes full turn context to the AI engine.
   ========================================================================== */

(function(){
  const USER_MANAGER='High Roehler';
  const LAST_DRAFT_PICK=264;

  function isReservedKeeperPick(pick){
    return typeof keeperAtPick==='function' && !!keeperAtPick(pick);
  }

  function isLivePick(pick){
    return pick>=1 && pick<=LAST_DRAFT_PICK && !isReservedKeeperPick(pick);
  }

  function pickSummary(pick){
    return {
      pick,
      round:roundForPick(pick),
      manager:managerForPick(pick),
      reservedKeeper:isReservedKeeperPick(pick)
    };
  }

  function nextLivePickFor(manager,startPick){
    for(let pick=Math.max(1,startPick); pick<=LAST_DRAFT_PICK; pick++){
      if(
        isLivePick(pick) &&
        managerForPick(pick)===manager
      ){
        return pick;
      }
    }
    return null;
  }

  function livePicksInRange(startInclusive,endExclusive){
    const picks=[];

    for(
      let pick=Math.max(1,startInclusive);
      pick<endExclusive && pick<=LAST_DRAFT_PICK;
      pick++
    ){
      if(isLivePick(pick)){
        picks.push(pickSummary(pick));
      }
    }

    return picks;
  }

  function getUserTurnContext(currentPick=state.currentPick){
    const currentManager=managerForPick(currentPick);
    const currentPickIsUser=
      currentManager===USER_MANAGER &&
      isLivePick(currentPick);

    /*
      If High Roehler is currently on the clock, "next user pick" must begin
      AFTER the current pick. If another manager is on the clock, the search
      begins with the current live pick so the number of opposing selections
      still to occur is accurate.
    */
    const nextSearchStart=currentPickIsUser
      ? currentPick+1
      : currentPick;

    const nextUserPick=nextLivePickFor(
      USER_MANAGER,
      nextSearchStart
    );

    const livePicksBeforeNextUser=nextUserPick
      ? livePicksInRange(nextSearchStart,nextUserPick)
      : [];

    const opponentLivePicksBeforeNextUser=
      livePicksBeforeNextUser.filter(
        p=>p.manager!==USER_MANAGER
      );

    /*
      Build the current snake-turn package. At a turn such as 2.12 / 3.01,
      this will be [24,25]. A keeper-reserved slot between two live user picks
      does not count as an opposing selection.
    */
    const currentTurnPicks=[];
    let followingUserPickAfterTurn=null;
    let livePicksBeforeFollowingTurn=[];
    let opponentLivePicksBeforeFollowingTurn=[];

    if(currentPickIsUser){
      currentTurnPicks.push(currentPick);

      let lastTurnPick=currentPick;

      while(true){
        const candidate=nextLivePickFor(
          USER_MANAGER,
          lastTurnPick+1
        );

        if(!candidate) break;

        const between=livePicksInRange(
          lastTurnPick+1,
          candidate
        );

        const opposing=between.filter(
          p=>p.manager!==USER_MANAGER
        );

        if(opposing.length===0){
          currentTurnPicks.push(candidate);
          lastTurnPick=candidate;
          continue;
        }

        followingUserPickAfterTurn=candidate;
        livePicksBeforeFollowingTurn=between;
        opponentLivePicksBeforeFollowingTurn=opposing;
        break;
      }

      if(!followingUserPickAfterTurn){
        const afterLast=nextLivePickFor(
          USER_MANAGER,
          currentTurnPicks[currentTurnPicks.length-1]+1
        );

        if(afterLast){
          followingUserPickAfterTurn=afterLast;
          livePicksBeforeFollowingTurn=livePicksInRange(
            currentTurnPicks[currentTurnPicks.length-1]+1,
            afterLast
          );
          opponentLivePicksBeforeFollowingTurn=
            livePicksBeforeFollowingTurn.filter(
              p=>p.manager!==USER_MANAGER
            );
        }
      }
    }

    return {
      currentPick,
      currentManager,
      currentPickIsUser,

      nextUserPick,
      picksUntilNextUserPick:nextUserPick
        ? nextUserPick-currentPick
        : null,
      livePicksBeforeNextUser,
      opponentLivePicksBeforeNextUser,
      opponentLivePickCountBeforeNextUser:
        opponentLivePicksBeforeNextUser.length,

      currentTurnPicks,
      currentTurnPickCount:currentTurnPicks.length,
      isBackToBackTurn:currentTurnPicks.length>1,

      followingUserPickAfterTurn,
      livePicksBeforeFollowingTurn,
      opponentLivePicksBeforeFollowingTurn,
      opponentLivePickCountBeforeFollowingTurn:
        opponentLivePicksBeforeFollowingTurn.length
    };
  }

  window.DWR_getUserTurnContext=getUserTurnContext;

  /*
    Patch only the small "High Roehler's Next Pick" card after the existing
    War Room renderer runs. This avoids replacing the large layout.js renderer.
  */
  const renderWarRoomBeforeTurnAwareness=renderWarRoom;

  renderWarRoom=function(){
    renderWarRoomBeforeTurnAwareness();

    const card=document.querySelector('#war-room .wr-next');
    if(!card) return;

    const ctx=getUserTurnContext();

    if(!ctx.nextUserPick){
      card.innerHTML=`
        <div class="muted">High Roehler's Next Pick</div>
        <div class="hero">Draft complete</div>
      `;
      return;
    }

    let detail='';

    if(
      ctx.currentPickIsUser &&
      ctx.opponentLivePickCountBeforeNextUser===0
    ){
      detail='Back-to-back · no opponent picks';
    }else{
      const count=ctx.opponentLivePickCountBeforeNextUser;
      detail=`${count} opponent pick${count===1?'':'s'} before you`;
    }

    card.innerHTML=`
      <div class="muted">High Roehler's Next Pick</div>
      <div class="hero">#${ctx.nextUserPick}</div>
      <div>${detail}</div>
    `;
  };

  console.log('Draft War Room Snake Turn Awareness v0.15.4 loaded.');
})();
