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
