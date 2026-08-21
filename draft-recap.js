/* ==========================================================================
   Draft War Room — Draft Recap Export v0.16.5

   Adds a Draft Recap button that downloads a Word-readable .doc file
   containing the draft in chronological pick order.

   Works offline and in both Mock and Live Draft modes.
   ========================================================================== */

(function(){
  const USER_MANAGER='High Roehler';
  const LAST_DRAFT_PICK=264;

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[char]));
  }

  function playerById(id){
    return (state.players||[]).find(player=>player.id===id) || null;
  }

  function pickNumberFromHistory(entry){
    /*
      Normal manual picks are stored by app.js with prevPick.
      Simulator picks add both pick and prevPick.
    */
    const explicit=Number(entry?.pick);
    if(Number.isInteger(explicit) && explicit>0) return explicit;

    const prev=Number(entry?.prevPick);
    if(Number.isInteger(prev) && prev>0) return prev;

    return null;
  }

  function liveHistoryRows(){
    return (state.history||[])
      .map((entry,index)=>{
        const player=playerById(entry.id);
        const pick=pickNumberFromHistory(entry);

        if(!player || !pick) return null;

        return {
          pick,
          round:typeof roundForPick==='function'
            ? roundForPick(pick)
            : Math.ceil(pick/12),
          manager:entry.manager || player.draftedBy || '',
          player:player.name || '',
          position:player.position || '',
          nflTeam:player.nflTeam || '',
          overallRank:player.rank || '',
          posRank:player.posRank
            ? `${player.position}${player.posRank}`
            : '',
          tier:player.tier || '',
          adp:player.adp || '',
          label:player.ourLabel || '',
          keeper:!!entry.isKeeper,
          simulated:!!entry.simulated,
          historyIndex:index
        };
      })
      .filter(Boolean);
  }

  function keeperRows(){
    const rows=[];

    if(!state.keepers || typeof state.keepers!=='object') return rows;

    for(let pick=1;pick<=LAST_DRAFT_PICK;pick++){
      if(typeof keeperAtPick!=='function') break;

      const reserved=keeperAtPick(pick);
      if(!reserved?.player) continue;

      const player=reserved.player;

      rows.push({
        pick,
        round:typeof roundForPick==='function'
          ? roundForPick(pick)
          : Math.ceil(pick/12),
        manager:reserved.manager || player.draftedBy || '',
        player:player.name || '',
        position:player.position || '',
        nflTeam:player.nflTeam || '',
        overallRank:player.rank || '',
        posRank:player.posRank
          ? `${player.position}${player.posRank}`
          : '',
        tier:player.tier || '',
        adp:player.adp || '',
        label:player.ourLabel || '',
        keeper:true,
        simulated:false,
        historyIndex:-1
      });
    }

    return rows;
  }

  function draftRows(){
    /*
      Keepers normally are not inserted into state.history when Pre-Draft setup
      is applied, so merge keeper-reserved slots with chronological live history.
      If a keeper somehow exists in history too, de-duplicate by pick.
    */
    const byPick=new Map();

    keeperRows().forEach(row=>byPick.set(row.pick,row));

    liveHistoryRows().forEach(row=>{
      if(!byPick.has(row.pick) || !row.keeper){
        byPick.set(row.pick,row);
      }
    });

    return [...byPick.values()]
      .sort((a,b)=>a.pick-b.pick || a.historyIndex-b.historyIndex);
  }

  function modeLabel(){
    return state.draftMode==='live' ? 'Live Draft' : 'Mock Draft';
  }

  function draftSlot(){
    const order=state.draftOrder||[];
    const index=order.indexOf(USER_MANAGER);
    return index>=0 ? index+1 : '';
  }

  function highRoehlerRosterRows(){
    const myPlayers=(state.players||[]).filter(
      player=>player.draftedBy===USER_MANAGER
    );

    const pickMap=new Map(
      draftRows()
        .filter(row=>row.manager===USER_MANAGER)
        .map(row=>[row.player,row])
    );

    const posOrder=['QB','RB','WR','TE','DP','D/ST','K'];

    return myPlayers
      .map(player=>{
        const row=pickMap.get(player.name);
        return {
          position:player.position || '',
          player:player.name || '',
          nflTeam:player.nflTeam || '',
          pick:row?.pick || '',
          round:row?.round || '',
          keeper:!!player.isKeeper
        };
      })
      .sort((a,b)=>{
        const pa=posOrder.indexOf(a.position);
        const pb=posOrder.indexOf(b.position);
        if(pa!==pb) return pa-pb;
        return (Number(a.pick)||9999)-(Number(b.pick)||9999);
      });
  }

  function rosterSummary(){
    const positions=['QB','RB','WR','TE','DP','D/ST','K'];
    const my=highRoehlerRosterRows();

    return positions
      .map(pos=>`${pos}: ${my.filter(row=>row.position===pos).length}`)
      .join(' | ');
  }

  function buildWordHtml(){
    const rows=draftRows();
    const myRoster=highRoehlerRosterRows();
    const generated=new Date();
    const completedPicks=rows.length;
    const currentPick=Number(state.currentPick)||1;

    const draftTable=rows.length
      ? rows.map(row=>`
          <tr class="${row.manager===USER_MANAGER?'mine':''}">
            <td>${row.pick}</td>
            <td>${row.round}</td>
            <td>${escapeHtml(row.manager)}</td>
            <td><strong>${escapeHtml(row.player)}</strong>${row.keeper?' <span class="keeper">(Keeper)</span>':''}</td>
            <td>${escapeHtml(row.position)}</td>
            <td>${escapeHtml(row.nflTeam)}</td>
            <td>${escapeHtml(row.overallRank)}</td>
            <td>${escapeHtml(row.posRank)}</td>
            <td>${escapeHtml(row.tier)}</td>
            <td>${escapeHtml(row.adp)}</td>
            <td>${escapeHtml(row.label)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="11">No draft selections have been recorded yet.</td></tr>`;

    const rosterTable=myRoster.length
      ? myRoster.map(row=>`
          <tr>
            <td>${escapeHtml(row.position)}</td>
            <td><strong>${escapeHtml(row.player)}</strong>${row.keeper?' <span class="keeper">(Keeper)</span>':''}</td>
            <td>${escapeHtml(row.nflTeam)}</td>
            <td>${escapeHtml(row.pick)}</td>
            <td>${escapeHtml(row.round)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="5">No High Roehler players recorded.</td></tr>`;

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Draft War Room Recap</title>
<style>
  @page Section1 {
    size: 11in 8.5in;
    mso-page-orientation: landscape;
    margin: .45in .45in .45in .45in;
  }
  div.Section1 { page: Section1; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1f2937;
    font-size: 9pt;
  }
  h1 {
    font-size: 20pt;
    margin: 0 0 4pt 0;
    color: #111827;
  }
  h2 {
    font-size: 13pt;
    margin: 16pt 0 6pt 0;
    color: #111827;
  }
  .subtitle {
    font-size: 10pt;
    color: #4b5563;
    margin-bottom: 12pt;
  }
  .summary {
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    padding: 8pt;
    margin-bottom: 12pt;
  }
  .summary-row { margin: 2pt 0; }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    background: #1f2937;
    color: #ffffff;
    border: 1px solid #64748b;
    padding: 4pt 3pt;
    font-weight: bold;
    text-align: left;
  }
  td {
    border: 1px solid #cbd5e1;
    padding: 3pt;
    vertical-align: top;
  }
  tr.mine td { background: #eef6ff; }
  .keeper {
    font-size: 8pt;
    color: #7c3aed;
    font-weight: bold;
  }
  .note {
    color: #64748b;
    font-size: 8pt;
    margin-top: 6pt;
  }
  .roster-table { width: 70%; }
</style>
</head>
<body>
<div class="Section1">
  <h1>Draft War Room — Draft Recap</h1>
  <div class="subtitle">${escapeHtml(modeLabel())} · High Roehler · 12-Team ESPN Full PPR</div>

  <div class="summary">
    <div class="summary-row"><strong>Draft slot:</strong> ${escapeHtml(draftSlot()||'—')}</div>
    <div class="summary-row"><strong>Selections recorded:</strong> ${completedPicks}</div>
    <div class="summary-row"><strong>Current draft position:</strong> #${currentPick}</div>
    <div class="summary-row"><strong>High Roehler roster:</strong> ${escapeHtml(rosterSummary())}</div>
    <div class="summary-row"><strong>Generated:</strong> ${escapeHtml(generated.toLocaleString())}</div>
  </div>

  <h2>Draft Order — Pick by Pick</h2>
  <table>
    <thead>
      <tr>
        <th>Pick</th>
        <th>Rd</th>
        <th>Manager</th>
        <th>Player</th>
        <th>POS</th>
        <th>NFL</th>
        <th>Ovr Rank</th>
        <th>Pos Rank</th>
        <th>Tier</th>
        <th>ADP</th>
        <th>Our Label</th>
      </tr>
    </thead>
    <tbody>${draftTable}</tbody>
  </table>

  <div class="note">High Roehler selections are shaded. Keeper-reserved selections are inserted at their actual draft slots.</div>

  <h2>High Roehler Final / Current Roster</h2>
  <table class="roster-table">
    <thead>
      <tr>
        <th>POS</th>
        <th>Player</th>
        <th>NFL</th>
        <th>Pick</th>
        <th>Round</th>
      </tr>
    </thead>
    <tbody>${rosterTable}</tbody>
  </table>
</div>
</body>
</html>`;
  }

  function filename(){
    const now=new Date();
    const stamp=[
      now.getFullYear(),
      String(now.getMonth()+1).padStart(2,'0'),
      String(now.getDate()).padStart(2,'0')
    ].join('-');

    const mode=state.draftMode==='live' ? 'live-draft' : 'mock-draft';
    return `Draft-War-Room-${mode}-recap-${stamp}.doc`;
  }

  function downloadDraftRecap(){
    const html=buildWordHtml();
    const blob=new Blob(['\ufeff',html],{
      type:'application/msword;charset=utf-8'
    });

    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');

    link.href=url;
    link.download=filename();
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(()=>URL.revokeObjectURL(url),2000);

    if(typeof showDraftActivity==='function'){
      showDraftActivity('Draft recap downloaded','draft');
    }
  }

  function ensureDraftRecapButton(){
    const actions=document.querySelector('.header-actions');
    if(!actions) return;

    let button=document.getElementById('draftRecapBtn');

    if(!button){
      button=document.createElement('button');
      button.id='draftRecapBtn';
      button.textContent='Draft Recap';
      button.title='Download a Word recap of the draft in pick order';
      button.onclick=downloadDraftRecap;

      /*
        Put recap near Undo Pick when possible so it behaves like a utility,
        not a draft-mode control.
      */
      const undo=document.getElementById('headerUndoBtn');
      if(undo){
        actions.insertBefore(button,undo);
      }else{
        actions.appendChild(button);
      }
    }

    button.disabled=!state.players || (
      !(state.history||[]).length &&
      !Object.values(state.keepers||{}).some(k=>k?.playerId)
    );
  }

  /*
    Header controls are recreated/rebound in layout.js after many renders.
    Wrap that function so Draft Recap remains available after every update.
  */
  if(typeof ensureHeaderDraftControls==='function'){
    const ensureHeaderBeforeDraftRecap=ensureHeaderDraftControls;

    ensureHeaderDraftControls=function(){
      ensureHeaderBeforeDraftRecap();
      ensureDraftRecapButton();
    };
  }

  /*
    As a second safety net, wrap renderAll because some builds can render the
    header without calling ensureHeaderDraftControls directly.
  */
  if(typeof renderAll==='function'){
    const renderAllBeforeDraftRecap=renderAll;

    renderAll=function(){
      renderAllBeforeDraftRecap();
      ensureDraftRecapButton();
    };
  }

  ensureDraftRecapButton();

  window.DWR_downloadDraftRecap=downloadDraftRecap;
  window.DWR_buildDraftRecapRows=draftRows;

  console.log('Draft War Room Draft Recap Export v0.16.5 loaded.');
})();