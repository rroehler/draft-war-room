/* Layout-only override for the War Room page.
   Existing drafting/state logic remains in app.js. */

renderWarRoom = function () {
  const cur = managerForPick(state.currentPick);
  const next = nextPickFor('High Roehler', state.currentPick);
  const total = totalCounts();
  const mine = roster('High Roehler');
  const rec = state.recommendation;

  const tierCard = (pos, areaClass) => `
    <div class="card wr-tier ${areaClass}">
      <div class="section-title">
        <h3>${pos}</h3>
        <span class="tiny">Available</span>
      </div>
      <div class="tier-scroll">
        ${playerRows(pos, 40)}
      </div>
    </div>`;

  document.getElementById('war-room').innerHTML = `
    <div class="war-room-layout">
      <div class="card wr-recommendation">
        <div class="section-title">
          <div>
            <div class="muted">Recommendation</div>
            <div class="rec-name">${rec?.recommendation || '—'}</div>
          </div>
          <button id="recommendBtn" class="primary">Recommend</button>
        </div>

        ${rec
          ? `<div class="confidence">Confidence ${rec.confidence}%</div>
             <ul class="reason-list">${(rec.reason || []).map(x => `<li>${x}</li>`).join('')}</ul>
             ${rec.warning ? `<div class="tiny" style="margin-top:8px;color:var(--warn)">${rec.warning}</div>` : ''}`
          : `<div class="recommendation-empty muted">
               Recommendation details will appear here when the decision engine is connected.
             </div>`}
      </div>

      <div class="card wr-status-card wr-next">
        <div class="muted">High Roehler's Next Pick</div>
        <div class="hero">${next ? `#${next}` : 'Draft complete'}</div>
        <div>${next ? `${Math.max(0, next - state.currentPick)} picks away` : ''}</div>
      </div>

      <div class="card wr-summary">
        <div class="section-title">
          <h3>Draft Position Summary</h3>
          <button id="targetsBtn">Edit</button>
        </div>
        <div class="summary">
          ${POSITIONS.map(p => `<span class="pill"><strong>${p}</strong> ${total[p]}/${state.targets[p]}</span>`).join('')}
        </div>
      </div>

      <div class="card wr-status-card wr-current">
        <div class="muted">Current Pick</div>
        <div class="hero">#${state.currentPick}</div>
        <div>${cur}</div>
        <div class="tiny">Round ${roundForPick(state.currentPick)}</div>
      </div>

      <div class="card wr-roster">
        <div class="section-title">
          <h3>Your Roster</h3>
          <button id="undoBtn">Undo</button>
        </div>
        ${mine.length
          ? `<div class="roster-list">
              ${POSITIONS.map(pos =>
                mine
                  .filter(p => p.position === pos)
                  .map(p => `<div class="roster-line"><span class="pos">${pos}</span><span>${p.name}${p.isKeeper ? ' <span class="tiny">(Keeper)</span>' : ''}</span></div>`)
                  .join('')
              ).join('')}
             </div>`
          : '<div class="muted">No players assigned yet.</div>'}
      </div>

      ${tierCard('QB', 'wr-tier-qb')}
      ${tierCard('RB', 'wr-tier-rb')}
      ${tierCard('WR', 'wr-tier-wr')}
      ${tierCard('TE', 'wr-tier-te')}
    </div>`;

  document.querySelectorAll('#war-room [data-player]').forEach(el => {
    el.onclick = () => openDraftDialog(state.players.find(p => p.id === el.dataset.player));
  });

  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('targetsBtn').onclick = openTargets;
  document.getElementById('recommendBtn').onclick = getRecommendation;
};

/* app.js may have rendered before this override loaded. Re-render once now. */
if (typeof state !== 'undefined' && state && state.players) {
  renderWarRoom();
}
