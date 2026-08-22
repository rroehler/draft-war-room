/* ==========================================================================
   Draft War Room — Header Toolbar Menu v0.18.7

   Purpose:
   - Keep high-frequency draft controls visible.
   - Move lower-frequency setup/recovery/reference/export actions into a More menu.
   - Hide mock-only simulator controls during Live Draft mode.
   - Convert Start Live Draft into a compact LIVE status once live mode begins.
   ========================================================================== */

(function(){
  let syncing=false;

  function liveDraftIsActiveForToolbar(){
    return state?.draftMode==='live';
  }

  function closeMoreMenu(){
    const menu=document.getElementById('headerMoreMenu');
    const button=document.getElementById('headerMoreBtn');

    if(menu) menu.classList.remove('open');
    if(button) button.setAttribute('aria-expanded','false');
  }

  function toggleMoreMenu(event){
    event?.stopPropagation();

    const menu=document.getElementById('headerMoreMenu');
    const button=document.getElementById('headerMoreBtn');
    if(!menu || !button) return;

    const open=!menu.classList.contains('open');
    menu.classList.toggle('open',open);
    button.setAttribute('aria-expanded',String(open));
  }

  function ensureToolbarStyles(){
    if(document.getElementById('dwrToolbarMenuStyles')) return;

    const style=document.createElement('style');
    style.id='dwrToolbarMenuStyles';
    style.textContent=`
      .header-actions{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:8px;
        flex-wrap:nowrap;
      }

      .header-more-menu{
        position:relative;
        display:inline-flex;
        align-items:center;
        flex:0 0 auto;
      }

      #headerMoreBtn{
        white-space:nowrap;
      }

      #headerMoreBtn .more-caret{
        display:inline-block;
        margin-left:5px;
        font-size:.78em;
        transition:transform .15s ease;
      }

      .header-more-menu.open #headerMoreBtn .more-caret{
        transform:rotate(180deg);
      }

      .header-more-panel{
        display:none;
        position:absolute;
        right:0;
        top:calc(100% + 8px);
        z-index:10000;
        min-width:180px;
        padding:6px;
        border:1px solid #334155;
        border-radius:10px;
        background:#111827;
        box-shadow:0 12px 30px rgba(0,0,0,.35);
      }

      .header-more-menu.open .header-more-panel{
        display:flex;
        flex-direction:column;
        gap:4px;
      }

      .header-actions .header-more-panel button{
        width:100%;
        min-width:0;
        text-align:left;
        justify-content:flex-start;
        white-space:nowrap;
        border-color:transparent;
        background:#172033;
      }

      .header-actions .header-more-panel button:hover:not(:disabled){
        background:#24314a;
        border-color:#3b82f6;
      }

      #startLiveDraftBtn.toolbar-live-status{
        pointer-events:none;
        cursor:default;
        opacity:1 !important;
        min-width:auto;
        padding-left:14px;
        padding-right:14px;
        border-color:#34d399;
        background:rgba(16,185,129,.12);
        color:#6ee7b7;
        font-weight:800;
        letter-spacing:.06em;
      }

      #startLiveDraftBtn.toolbar-live-status::before{
        content:'●';
        margin-right:6px;
        font-size:.72em;
      }

      .mock-only-control-hidden{
        display:none !important;
      }

      @media (max-width:1250px){
        .header-actions{
          gap:6px;
        }

        .header-actions > button,
        .header-more-menu > button{
          padding-left:10px;
          padding-right:10px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureMoreMenu(actions){
    let menu=document.getElementById('headerMoreMenu');

    if(!menu){
      menu=document.createElement('div');
      menu.id='headerMoreMenu';
      menu.className='header-more-menu';

      const button=document.createElement('button');
      button.id='headerMoreBtn';
      button.type='button';
      button.setAttribute('aria-haspopup','menu');
      button.setAttribute('aria-expanded','false');
      button.innerHTML=`More <span class="more-caret">▼</span>`;
      button.onclick=toggleMoreMenu;

      const panel=document.createElement('div');
      panel.id='headerMorePanel';
      panel.className='header-more-panel';
      panel.setAttribute('role','menu');

      menu.append(button,panel);

      const undo=document.getElementById('headerUndoBtn');
      if(undo && undo.parentElement===actions){
        actions.insertBefore(menu,undo);
      }else{
        actions.appendChild(menu);
      }
    }

    return menu;
  }

  function moveUtilityButtonsIntoMenu(){
    const panel=document.getElementById('headerMorePanel');
    if(!panel) return;

    const newMock=document.getElementById('newMockBtn') || document.getElementById('resetBtn');
    const undoSim=document.getElementById('undoSimulationBtn');
    const command=document.getElementById('commandmentsBtn');
    const recap=document.getElementById('draftRecapBtn');

    /*
      Order the menu by likely use:
      - New Mock: start/reset utility
      - Undo Sim: mock-only recovery
      - Commandments: reference
      - Draft Recap: export
    */
    for(const button of [newMock,undoSim,command,recap]){
      if(button && button.parentElement!==panel){
        panel.appendChild(button);
      }
    }
  }

  function syncLiveModeControls(){
    const isLive=liveDraftIsActiveForToolbar();
    const sim=document.getElementById('simToMyPickBtn');
    const undoSim=document.getElementById('undoSimulationBtn');
    const live=document.getElementById('startLiveDraftBtn');

    if(sim){
      sim.classList.toggle('mock-only-control-hidden',isLive);
    }

    if(undoSim){
      undoSim.classList.toggle('mock-only-control-hidden',isLive);
    }

    if(live){
      live.classList.toggle('toolbar-live-status',isLive);

      if(isLive){
        live.textContent='LIVE';
        live.disabled=true;
        live.setAttribute('aria-label','Live Draft Active');
        live.title='Live Draft Active';
      }else{
        /*
          Let the existing live-draft code own normal mock-mode text/state.
          Only remove the status decoration here.
        */
        live.removeAttribute('aria-label');

        if(live.textContent==='LIVE' && typeof updateLiveDraftButton==='function'){
          updateLiveDraftButton();
        }
      }
    }

    if(isLive) closeMoreMenu();
  }

  function syncToolbar(){
    if(syncing) return;
    syncing=true;

    try{
      ensureToolbarStyles();

      const actions=document.querySelector('.header-actions');
      if(!actions) return;

      ensureMoreMenu(actions);
      moveUtilityButtonsIntoMenu();
      syncLiveModeControls();
    }finally{
      syncing=false;
    }
  }

  /*
    The app re-renders/re-binds header controls frequently. Wrap the final
    versions of both helpers after simulator + recap have loaded.
  */
  if(typeof ensureHeaderDraftControls==='function'){
    const ensureHeaderBeforeToolbar=ensureHeaderDraftControls;

    ensureHeaderDraftControls=function(){
      ensureHeaderBeforeToolbar();
      syncToolbar();
    };
  }

  if(typeof renderAll==='function'){
    const renderAllBeforeToolbar=renderAll;

    renderAll=function(){
      renderAllBeforeToolbar();
      syncToolbar();
    };
  }

  /*
    Start Live Draft changes state immediately and then renders. A microtask
    sync handles any path that updates the button without a full render.
  */
  if(typeof updateLiveDraftButton==='function'){
    const updateLiveDraftButtonBeforeToolbar=updateLiveDraftButton;

    updateLiveDraftButton=function(){
      updateLiveDraftButtonBeforeToolbar();
      queueMicrotask(syncToolbar);
    };
  }

  document.addEventListener('click',event=>{
    const menu=document.getElementById('headerMoreMenu');
    if(menu && !menu.contains(event.target)){
      closeMoreMenu();
    }
  });

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape') closeMoreMenu();
  });

  syncToolbar();

  window.DWR_syncToolbar=syncToolbar;

  console.log('Draft War Room Header Toolbar Menu v0.18.7 loaded.');
})();