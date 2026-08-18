/* ========================================================================== 
   Draft War Room — Players Tab Sorting v0.15.3
   True Overall Rank + Position Rank display.
   ========================================================================== */

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
      const rankA=Number(a.rank)||9999;
      const rankB=Number(b.rank)||9999;

      if(sortBy==='adp'){
        const adpA=Number(a.adp)||9999;
        const adpB=Number(b.adp)||9999;
        if(adpA!==adpB) return adpA-adpB;
        return rankA-rankB;
      }

      if(sortBy==='posRank'){
        /* If one position is filtered, this becomes a clean RB1/RB2/etc. sort.
           With all positions shown, group positions first so multiple POS1 values
           are not mixed together. */
        const pa=POSITIONS.indexOf(a.position);
        const pb=POSITIONS.indexOf(b.position);
        if(pa!==pb) return pa-pb;

        const pra=Number(a.posRank)||9999;
        const prb=Number(b.posRank)||9999;
        if(pra!==prb) return pra-prb;
        return rankA-rankB;
      }

      if(sortBy==='name'){
        return a.name.localeCompare(b.name);
      }

      /* Default: our researched cross-position draft board. */
      return rankA-rankB;
    });
  }

  function positionRankText(player){
    const rank=Number(player.posRank);
    return rank ? `${player.position}${rank}` : '—';
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

            <button id="labelsHelpBtn">
              What do Our Labels mean?
            </button>
          </div>

          <div class="players-toolbar players-toolbar-sorted">
            <input
              id="playerSearch"
              value="${escapeHtml(f.search)}"
              placeholder="Search player or NFL team">

            <select id="positionFilter">
              <option value="">All positions</option>
              ${POSITIONS.map(p=>`
                <option value="${p}" ${f.position===p?'selected':''}>
                  ${p}
                </option>
              `).join('')}
            </select>

            <select id="tierFilter">
              <option value="">All tiers</option>
              <option value="1" ${f.tier==='1'?'selected':''}>Tier 1</option>
              <option value="2" ${f.tier==='2'?'selected':''}>Tier 2</option>
              <option value="3" ${f.tier==='3'?'selected':''}>Tier 3</option>
              <option value="4+" ${f.tier==='4+'?'selected':''}>Tier 4+</option>
            </select>

            <select id="sortByFilter" aria-label="Sort players">
              <option value="rank" ${f.sortBy==='rank'?'selected':''}>Sort: Overall Rank</option>
              <option value="adp" ${f.sortBy==='adp'?'selected':''}>Sort: ADP</option>
              <option value="posRank" ${f.sortBy==='posRank'?'selected':''}>Sort: Position Rank</option>
              <option value="name" ${f.sortBy==='name'?'selected':''}>Sort: Name</option>
            </select>

            <label class="drafted-toggle">
              <input
                type="checkbox"
                id="includeDrafted"
                ${f.includeDrafted?'checked':''}>
              <span>Include already drafted</span>
            </label>

            <button id="resetFiltersBtn">
              Reset Filters
            </button>
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
        !q ||
        `${player.name} ${player.nflTeam}`.toLowerCase().includes(q);

      const availabilityMatch=
        !player.draftedBy ||
        f.includeDrafted ||
        (searchActive && searchMatch);

      return tierMatch && positionMatch && searchMatch && availabilityMatch;
    });

    /* 405-player database: do not silently hide the final five records. */
    list=sortPlayers(list,f.sortBy).slice(0,405);

    document.getElementById('playerTable').innerHTML=`
      <table class="table players-table players-table-ranked">
        <colgroup>
          <col class="col-rank">
          <col class="col-player">
          <col class="col-pos">
          <col class="col-posrank">
          <col class="col-tier">
          <col class="col-adp">
          <col class="col-label">
          <col class="col-status">
        </colgroup>

        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>POS</th>
            <th>Pos Rank</th>
            <th>Tier</th>
            <th>ADP</th>
            <th>Our Label</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          ${list.map(player=>`
            <tr
              data-player="${player.id}"
              class="${player.draftedBy?'drafted-row':''}">

              <td class="center-cell overall-rank-cell">
                ${player.rank||'—'}
              </td>

              <td>
                <div class="player-name-cell">
                  <b>${player.name}</b>
                  <span>${player.nflTeam}</span>
                </div>
              </td>

              <td class="center-cell">${player.position}</td>
              <td class="center-cell pos-rank-cell">${positionRankText(player)}</td>
              <td class="center-cell">${tierBadge(player.tier)}</td>
              <td class="center-cell">${player.adp||'—'}</td>
              <td>${labelBadge(player.ourLabel)}</td>

              <td>
                ${player.draftedBy
                  ? `${player.draftedBy}${player.isKeeper?' (K)':''}`
                  : 'Available'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;

    document.querySelectorAll('#playerTable [data-player]').forEach(el=>{
      el.onclick=()=>{
        const player=state.players.find(p=>p.id===el.dataset.player);

        if(!player.draftedBy){
          openDraftDialog(player);
        }
      };
    });
  };

  ensureSortState();

  if(state.players){
    renderPlayers();
  }
})();
