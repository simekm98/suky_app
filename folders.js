// ══════════════════════════════════════════════════════════
//  SYSTÉM SLOŽEK — WoodGrader 26
// ══════════════════════════════════════════════════════════

// ── Stav ─────────────────────────────────────────────────
var allFolders = [];        // [{id, name, createdAt}]
var activeFolderId = null;  // aktuálně vybraná složka pro nové desky
var filterFolderId = null;  // složka pro filtrování v seznamu ('all' = všechny)
var exportSelected = {};    // {folderId: true/false}
var boardSortMode = 'date';

// ── Helpers ───────────────────────────────────────────────
function genId(){ return 'f_' + Date.now().toString(36) + Math.random().toString(36).substr(2,4); }

function getFolderName(id){
  if(!id) return 'Bez složky';
  var f = allFolders.find(function(x){ return x.id === id; });
  return f ? f.name : 'Neznámá';
}

function getBoardsInFolder(fid){
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  if(fid === 'all') return boards;
  return boards.filter(function(b){ return (b.folderId||null) === fid; });
}

// ── Načtení / uložení složek ──────────────────────────────
function loadFolders(){
  try{
    var raw = localStorage.getItem('wg26_folders');
    if(raw) allFolders = JSON.parse(raw);
    var actRaw = localStorage.getItem('wg26_active_folder');
    if(actRaw) activeFolderId = actRaw;
  }catch(e){}
}

function saveFolders(){
  try{
    localStorage.setItem('wg26_folders', JSON.stringify(allFolders));
    localStorage.setItem('wg26_active_folder', activeFolderId||'');
  }catch(e){}
  if(window.wgMarkDirty) window.wgMarkDirty();
}

// ── Vytvoření složky ──────────────────────────────────────
function createFolder(name){
  if(!name || !name.trim()){ showFolderToast('Zadej název složky'); return null; }
  var folder = { id: genId(), name: name.trim(), createdAt: new Date().toISOString() };
  allFolders.push(folder);
  saveFolders();
  return folder;
}

// ── Startup modal ─────────────────────────────────────────
function openFolderModal(){
  renderFolderModal();
  document.getElementById('modal-folder').classList.add('open');
}
function closeFolderModal(){
  document.getElementById('modal-folder').classList.remove('open');
}

function renderFolderModal(){
  var el = document.getElementById('folder-list-modal');
  if(!el) return;
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  var html = '';

  // Všechny složky
  allFolders.forEach(function(f){
    var count = boards.filter(function(b){ return b.folderId === f.id; }).length;
    var isActive = f.id === activeFolderId;
    html += '<div class="folder-item" data-act="selectfolder" data-fid="'+f.id+'">'
      + '<div class="folder-item-icon">📁</div>'
      + '<div class="folder-item-name">' + escH(f.name) + (isActive?' ✓':'') + '</div>'
      + '<div class="folder-item-count">' + count + ' desek</div>'
      + '</div>';
  });

  if(!allFolders.length){
    html = '<div style="text-align:center;padding:20px;color:var(--g5);font-size:14px">Zatím žádné složky.<br>Vytvoř první složku níže.</div>';
  }

  el.innerHTML = html;
}

// ── Chips v list screenu ──────────────────────────────────
function renderFolderChips(){
  var el = document.getElementById('folder-chips');
  if(!el) return;
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  var html = '<button class="folder-chip'+(filterFolderId===null?' active':'')+'" data-act="filterfolder" data-fid="all">Všechny</button>';
  allFolders.forEach(function(f){
    var count = boards.filter(function(b){ return b.folderId === f.id; }).length;
    html += '<button class="folder-chip'+(filterFolderId===f.id?' active':'')+'" data-act="filterfolder" data-fid="'+f.id+'">'
      + escH(f.name) + ' <span style="opacity:.6">('+count+')</span></button>';
  });
  // Desky bez složky
  var noFolder = boards.filter(function(b){ return !b.folderId; }).length;
  if(noFolder) html += '<button class="folder-chip'+(filterFolderId==='none'?' active':'')+'" data-act="filterfolder" data-fid="none">Bez složky <span style="opacity:.6">('+noFolder+')</span></button>';
  el.innerHTML = html;
}

// ── Export modal ──────────────────────────────────────────
function openExportModal(){
  renderExportModal();
  document.getElementById('modal-export').classList.add('open');
}
function closeExportModal(){
  document.getElementById('modal-export').classList.remove('open');
}

function renderExportModal(){
  var el = document.getElementById('export-folder-list');
  if(!el) return;
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  exportSelected = {};

  var html = '<div class="folder-item" data-act="toggleexport" data-fid="all" style="background:var(--brl)">'
    + '<input type="checkbox" id="exp-all" style="width:20px;height:20px;margin-right:12px" onclick="void(0)">'
    + '<div class="folder-item-name" style="font-weight:700">Všechny složky</div>'
    + '<div class="folder-item-count">' + boards.length + ' desek</div>'
    + '</div>';

  allFolders.forEach(function(f){
    var count = boards.filter(function(b){ return b.folderId === f.id; }).length;
    exportSelected[f.id] = false;
    html += '<div class="folder-item" data-act="toggleexport" data-fid="'+f.id+'">'
      + '<input type="checkbox" id="exp-'+f.id+'" style="width:20px;height:20px;margin-right:12px">'
      + '<div class="folder-item-icon">📁</div>'
      + '<div class="folder-item-name">' + escH(f.name) + '</div>'
      + '<div class="folder-item-count">' + count + ' desek</div>'
      + '</div>';
  });

  var noFolder = boards.filter(function(b){ return !b.folderId; }).length;
  if(noFolder){
    exportSelected['none'] = false;
    html += '<div class="folder-item" data-act="toggleexport" data-fid="none">'
      + '<input type="checkbox" id="exp-none" style="width:20px;height:20px;margin-right:12px">'
      + '<div class="folder-item-icon">📄</div>'
      + '<div class="folder-item-name">Bez složky</div>'
      + '<div class="folder-item-count">' + noFolder + ' desek</div>'
      + '</div>';
  }
  el.innerHTML = html;
}

function toggleExportFolder(fid){
  if(fid === 'all'){
    var allOn = Object.values(exportSelected).every(function(v){ return v; });
    Object.keys(exportSelected).forEach(function(k){ exportSelected[k] = !allOn; });
    // Aktualizuj checkboxy
    Object.keys(exportSelected).forEach(function(k){
      var cb = document.getElementById('exp-'+k);
      if(cb) cb.checked = exportSelected[k];
    });
    var allCb = document.getElementById('exp-all');
    if(allCb) allCb.checked = !allOn;
  } else {
    exportSelected[fid] = !exportSelected[fid];
    var cb2 = document.getElementById('exp-'+fid);
    if(cb2) cb2.checked = exportSelected[fid];
  }
}

// ── Export do Excelu po složkách ──────────────────────────
function doFolderExport(){
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  var knots  = window.wgGetKnots    ? window.wgGetKnots()    : [];
  if(knots.length){
    var ex = window.getBoardExtra ? window.getBoardExtra() : {};
    boards = boards.concat([{id:'(aktuální)',b:0,d:0,knots:knots,folderId:activeFolderId,savedAt:new Date().toISOString()}]);
  }

  // Určíme které složky exportovat
  var selectedFids = Object.keys(exportSelected).filter(function(k){ return exportSelected[k]; });
  var exportAll = selectedFids.length === 0; // pokud nic nevybráno = vše

  var wb = XLSX.utils.book_new();
  var hdrs = ['board','b_mm','d_mm','length_mm','mass_g','density_kgm3','MOED_L_MPa','MOED_B_MPa',
              'moisture_%','VG','screw','f1_Hz','f2_Hz','f3_Hz','knot',
              'AS1','AS2','AL1','AL2','BS1','BS2','BL1','BL2','CS1','CS2','CL1','CL2','DS1','DS2','DL1','DL2',
              'area_mm2','a_i_mm','KAR_%','DAB','třída'];

  // Skupiny: každá složka = list
  var groups = {};

  // Složky
  allFolders.forEach(function(f){
    if(!exportAll && !exportSelected[f.id]) return;
    groups[f.name] = boards.filter(function(b){ return b.folderId === f.id; });
  });

  // Bez složky
  var noFolderBoards = boards.filter(function(b){ return !b.folderId; });
  if(noFolderBoards.length && (exportAll || exportSelected['none'])){
    groups['Bez složky'] = noFolderBoards;
  }

  if(!Object.keys(groups).length){ showFolderToast('Nic k exportu'); return; }

  Object.keys(groups).forEach(function(sheetName){
    var shBoards = groups[sheetName];
    var rows = [];
    shBoards.forEach(function(bd){
      if(!bd.knots||!bd.knots.length){
        rows.push([bd.id,bd.b,bd.d,'','','','','','',bd.vg||'',bd.screw?'ano':'',
          '','','',0,'','','','','','','','','','','','','','','','','','','','','','']);
        return;
      }
      var calcMOED = window.calcMOED || function(){ return {}; };
      var calcDen  = window.calcDensity || function(){ return null; };
      var polys    = window.mkPolys      ? window.mkPolys(bd.knots,bd.b,bd.d) : [];
      var calcUA   = window.calcUA       ? window.calcUA   : function(){ return 0; };
      var kAi      = window.kAi          ? window.kAi      : function(){ return 0; };
      var kPts     = window.kPts         ? window.kPts     : function(){ return null; };
      var pArea    = window.pArea        ? window.pArea    : function(){ return 0; };
      var calcDAB  = window.calcDAB      ? window.calcDAB  : function(){ return 0; };
      var grade    = window.grade        ? window.grade    : function(){ return '?'; };

      var ua  = calcUA(polys,bd.b,bd.d);
      var kar = bd.b*bd.d>0?(ua/(bd.b*bd.d))*100:0;
      var dab = calcDAB(bd.knots,bd.b);
      var den = calcDen(bd.mass,bd.length,bd.b,bd.d);
      var mr  = calcMOED(bd);
      var gr  = grade(kar,dab,bd.knots.length);

      bd.knots.forEach(function(k,ki){
        var pts = kPts(k,bd.b,bd.d);
        var area = pts ? pArea(pts) : 0;
        var ai   = kAi(k,bd.b);
        var isL  = ki===bd.knots.length-1;
        var fft  = bd.fft||[];
        rows.push([bd.id,bd.b,bd.d,
          isL?bd.length||'':'', isL?bd.mass||'':'', isL?den!=null?den:'':'',
          isL?mr.moedL!=null?mr.moedL:'':'', isL?mr.moedB!=null?mr.moedB:'':'',
          isL?bd.moisture!=null?bd.moisture:'':'', isL?bd.vg||'':'', isL?bd.screw?'ano':'':'',
          isL?fft[0]||'':'', isL?fft[1]||'':'', isL?fft[2]||'':'',
          ki+1,
          k.as1!=null?k.as1:'',k.as2!=null?k.as2:'',k.al1!=null?k.al1:'',k.al2!=null?k.al2:'',
          k.bs1!=null?k.bs1:'',k.bs2!=null?k.bs2:'',k.bl1!=null?k.bl1:'',k.bl2!=null?k.bl2:'',
          k.cs1!=null?k.cs1:'',k.cs2!=null?k.cs2:'',k.cl1!=null?k.cl1:'',k.cl2!=null?k.cl2:'',
          k.ds1!=null?k.ds1:'',k.ds2!=null?k.ds2:'',k.dl1!=null?k.dl1:'',k.dl2!=null?k.dl2:'',
          +area.toFixed(1), ai>0?+ai.toFixed(1):'',
          isL?+kar.toFixed(2):'', isL?+dab.toFixed(4):'', isL?gr:'']);
      });
    });
    if(rows.length){
      var ws = XLSX.utils.aoa_to_sheet([hdrs].concat(rows));
      var safeName = sheetName.substr(0,31).replace(/[\\\/\?\*\[\]]/g,'_');
      XLSX.utils.book_append_sheet(wb,ws,safeName);
    }
  });

  XLSX.writeFile(wb,'woodgrader_export_'+new Date().toISOString().slice(0,10)+'.xlsx');
  closeExportModal();
  showFolderToast('Export dokončen ✓');
}

// ── Render boardlistu s filtrováním ──────────────────────
// (override renderBlist z hlavního kódu)
function renderBlistWithFolders(){
  var el = document.getElementById('blist');
  if(!el) return;
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  var search = (document.getElementById('search-input')||{}).value||'';
  search = search.toLowerCase().trim();

  // Filtr podle složky
  var filtered = boards.filter(function(b){
    if(filterFolderId === null) return true;
    if(filterFolderId === 'all') return true;
    if(filterFolderId === 'none') return !b.folderId;
    return b.folderId === filterFolderId;
  });

  // Filtr podle vyhledávání
  if(search){
    filtered = filtered.filter(function(b){
      return (b.id||'').toLowerCase().includes(search);
    });
  }

  if(!filtered.length){
    el.innerHTML = '<div style="text-align:center;padding:28px;color:var(--g5);font-size:14px">'+(search?'Žádná shoda':'Žádné desky')+'</div>';
    return;
  }

  // Řazení
  var indices = filtered.map(function(_,i){ return i; });
  if(boardSortMode === 'name'){
    filtered.sort(function(a,b){ return (a.id||'').localeCompare(b.id||'','cs'); });
  } else {
    filtered.sort(function(a,b){
      var ta=a.savedAt||'', tb=b.savedAt||'';
      return ta<tb?1:(ta>tb?-1:0);
    });
  }

  var calcUA  = window.calcUA   || function(){ return 0; };
  var calcDAB = window.calcDAB  || function(){ return 0; };
  var mkPolys = window.mkPolys  || function(){ return []; };
  var grade   = window.grade    || function(){ return '?'; };
  var gcls    = window.gcls     || function(){ return 'gna'; };

  var html = '';
  filtered.forEach(function(bd){
    // Найди реальный индекс в allBoards
    var realBi = boards.indexOf(bd);
    var ps  = mkPolys(bd.knots||[],bd.b,bd.d);
    var ua  = calcUA(ps,bd.b,bd.d);
    var kar = bd.b*bd.d>0?(ua/(bd.b*bd.d))*100:0;
    var dab = calcDAB(bd.knots||[],bd.b);
    var gr  = grade(kar,dab,(bd.knots||[]).length);
    var dt  = bd.savedAt ? new Date(bd.savedAt).toLocaleString('cs',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    var folderName = bd.folderId ? getFolderName(bd.folderId) : '';
    var tags=[];
    if(bd.vg) tags.push('VG'+bd.vg);
    if(bd.moisture!=null) tags.push('w:'+bd.moisture+'%');
    if(bd.screw) tags.push('Vrut');

    html += '<div class="bitem" data-act="openboard" data-bi="'+realBi+'">'
      + '<div class="binfo">'
      + '<strong>'+escH(bd.id||'')+(tags.length?' <span style="font-size:11px;color:var(--g5);font-weight:500">'+tags.join(' ')+'</span>':'')+'</strong>'
      + '<span>'+(folderName?'📁 '+escH(folderName)+' · ':'')+((bd.knots||[]).length)+' suků · KAR '+kar.toFixed(1)+'% · '+dt+'</span>'
      + '</div>'
      + '<span class="gp '+gcls(gr)+'">'+gr+'</span>'
      + '<button class="bdel" data-act="delb" data-bi="'+realBi+'">🗑</button>'
      + '</div>';
  });
  el.innerHTML = html;
}

function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

function showFolderToast(msg){
  var t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2400);
}

// ── Event delegation ──────────────────────────────────────

// ── Aktualizuj label aktivní složky v entry screenu ──────
function updateActiveFolderBar(){
  var lbl = document.getElementById('active-folder-label');
  if(!lbl) return;
  if(!activeFolderId){
    lbl.textContent = '(bez složky)';
    lbl.style.color = 'var(--g5)';
  } else {
    lbl.textContent = getFolderName(activeFolderId);
    lbl.style.color = 'var(--br)';
  }
}
window.updateActiveFolderBar = updateActiveFolderBar;

function initFolders(){
  loadFolders();

  // Ukáž startup modal jen pokud není aktivní složka a jsou žádné desky
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  // Vždy nabídni výběr při prvním spuštění (žádná aktivní složka)
  if(!activeFolderId && allFolders.length === 0){
    // Vytvoř výchozí složku "Výchozí"
    // (uživatel si může přejmenovat)
  }
  // Pokud existují složky ale žádná není aktivní — otevři modal
  if(allFolders.length > 0 && !activeFolderId){
    setTimeout(openFolderModal, 500);
  }

  // Override renderBlist
  window.renderBlistGlobal = renderBlistWithFolders;

  // Override save hook — přidej folderId do newBoard
  var origNewBoard = window._origNewBoard;

  // Přidej folder ikonu do topbaru list screenu (tlačítko pro správu složek)
  var listTopbar = document.querySelector('#s-list .topbar');
  if(listTopbar){
    var folderBtn = document.createElement('button');
    folderBtn.className = 'tbtn';
    folderBtn.setAttribute('data-act','openfolder');
    folderBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    folderBtn.title = 'Správa složek';
    // Vlož před první tlačítko
    listTopbar.insertBefore(folderBtn, listTopbar.querySelector('.tbtn'));
  }

  // Sort tlačítka
  document.addEventListener('click',function(e){
    var btn = e.target.closest('[data-act]');
    if(!btn) return;
    var act = btn.getAttribute('data-act');

    if(act === 'selectfolder'){
      var fid = btn.getAttribute('data-fid');
      activeFolderId = fid;
      saveFolders();
      closeFolderModal();
      showFolderToast('Složka: ' + getFolderName(fid));
      renderFolderChips();
      updateActiveFolderBar();
    }
    else if(act === 'createfolder'){
      var inp = document.getElementById('new-folder-name');
      var name = inp ? inp.value.trim() : '';
      if(!name){ showFolderToast('Zadej název'); return; }
      var f = createFolder(name);
      if(f){
        activeFolderId = f.id;
        saveFolders();
        if(inp) inp.value = '';
        renderFolderModal();
        renderFolderChips();
        closeFolderModal();
        showFolderToast('Složka "'+f.name+'" vytvořena a aktivní ✓');
        updateActiveFolderBar();
      }
    }
    else if(act === 'closefolder'){ closeFolderModal(); }
    else if(act === 'closeexport'){ closeExportModal(); }
    else if(act === 'openfolder'){ openFolderModal(); }
    else if(act === 'openexport'){ openExportModal(); }
    else if(act === 'doexport'){ doFolderExport(); }
    else if(act === 'filterfolder'){
      var fid2 = btn.getAttribute('data-fid');
      filterFolderId = fid2 === 'all' ? null : fid2;
      renderFolderChips();
      renderBlistWithFolders();
    }
    else if(act === 'toggleexport'){
      var fid3 = btn.getAttribute('data-fid');
      toggleExportFolder(fid3);
    }
  });

  // Spuštění aplikace — nastav složku + nabídni výběr
  setTimeout(function(){
    if(allFolders.length > 0 && !activeFolderId){
      activeFolderId = allFolders[0].id;
      saveFolders();
    }
    renderFolderChips();
    updateActiveFolderBar();
  }, 300);
  // Nabídni výběr složky při každém startu (pokud existují)
  setTimeout(function(){
    if(allFolders.length > 0){
      openFolderModal();
    }
  }, 700);
}

// Exportuj do globálního scope
window.initFolders     = initFolders;
window.openFolderModal = openFolderModal;
window.renderFolderChips = renderFolderChips;
window.getFolderActivId = function(){ return activeFolderId; };
window.escH = escH;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initFolders);
} else {
  initFolders();
}
