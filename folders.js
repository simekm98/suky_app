// ═══════════════════════════════════════════════════════════
//  SLOŽKY + SEZNAM DESEK — WoodGrader 26
//  Kompletní přepis — jeden zdroj pravdy
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

// ── Stav ─────────────────────────────────────────────────
var allFolders = [];
var activeFolderId = null;   // do které složky se ukládá
var filterFolderId = '__all'; // '__all' | folderId | '__none'
var boardSortMode  = 'date'; // 'date' | 'name'
var searchQuery    = '';

// ── Persistence ──────────────────────────────────────────
function loadFolders(){
  try{
    var raw = localStorage.getItem('wg26_folders');
    if(raw) allFolders = JSON.parse(raw);
    activeFolderId = localStorage.getItem('wg26_active_folder') || null;
  }catch(e){}
}
function saveFolders(){
  try{
    localStorage.setItem('wg26_folders', JSON.stringify(allFolders));
    localStorage.setItem('wg26_active_folder', activeFolderId||'');
  }catch(e){}
}

// ── Helpers ───────────────────────────────────────────────
function genId(){ return 'f_'+Date.now().toString(36)+Math.random().toString(36).substr(2,4); }
function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function getFolderName(id){
  if(!id) return 'Bez složky';
  var f = allFolders.find(function(x){ return x.id===id; });
  return f ? f.name : '?';
}
function getBoards(){ return window.wgGetAllBoards ? window.wgGetAllBoards() : []; }
function showToast(msg){
  var t=document.getElementById('toast');
  if(!t)return; t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2400);
}

// ── Aktivní složka label v entry screenu ─────────────────
function updateActiveFolderBar(){
  var lbl = document.getElementById('active-folder-label');
  if(!lbl) return;
  lbl.textContent = activeFolderId ? getFolderName(activeFolderId) : '(bez složky — vyber složku)';
  lbl.style.color = activeFolderId ? 'var(--br)' : 'var(--g5)';
}
window.updateActiveFolderBar = updateActiveFolderBar;
window.getFolderActivId = function(){ return activeFolderId; };
window.wgGetFolders = function(){ return allFolders; };
window.wgCreateFolder = function(name){
  var newF={id:'f'+Date.now(), name:name};
  allFolders.push(newF);
  saveFolders();
  activeFolderId=newF.id;
  saveActiveFolder();
  updateActiveLabel();
  if(typeof updateFolderSelect==='function') updateFolderSelect();
  if(typeof updateBlinkStates==='function') setTimeout(updateBlinkStates,80);
};
window.wgDeleteFolder = function(fid){
  allFolders=allFolders.filter(function(f){return f.id!==fid;});
  saveFolders();
  if(activeFolderId===fid){
    activeFolderId=allFolders.length?allFolders[0].id:null;
    saveActiveFolder();
    updateActiveLabel();
  }
  if(typeof updateFolderSelect==='function') updateFolderSelect();
  if(typeof updateBlinkStates==='function') setTimeout(updateBlinkStates,80);
};
window.wgSetActiveFolder = function(fid){
  if(!fid){ activeFolderId=null; saveActiveFolder(); updateActiveLabel(); return; }
  var f=allFolders.find(function(x){return x.id===fid;});
  if(f){ activeFolderId=f.id; saveActiveFolder(); updateActiveLabel(); }
  if(typeof updateBlinkStates==='function') setTimeout(updateBlinkStates,80);
  if(typeof updateFolderSelect==='function') updateFolderSelect();
};
window.getFolderNameSafe = getFolderName;
window.getCurrentFilterFolderId = function(){ return filterFolderId; };
window.wgGetAllFoldersList = function(){ return allFolders; };
window.wgCreateFolderByName = function(name){
  var f = createFolder(name);
  return f ? f.id : null;
};
// Vytvoří složku A NASTAVÍ ji jako aktivní (pro hlasové vytvoření složky)
function saveActiveFolder(){
  try{ localStorage.setItem('wg26_active_folder', activeFolderId||''); }catch(e){}
}
window.wgCreateAndActivateFolder = function(name){
  var f = createFolder(name);
  if(!f) return null;
  activeFolderId = f.id;
  saveFolders();
  saveActiveFolder();
  updateActiveFolderBar(); // Okamžitě zobrazit název na hlavní straně
  if(typeof updateFolderSelect==='function') updateFolderSelect();
  if(typeof renderFolderChips === 'function') renderFolderChips();
  if(typeof updateBlinkStates==='function') updateBlinkStates();
  return f.id;
};
window.renderFolderChipsGlobal = renderFolderChips;

// Aktivuje EXISTUJÍCÍ složku podle jména (fuzzy match) — pro hlasový příkaz
// "vyber složku X" / "změna složky X". Nevytváří novou, jen přepne aktivní.
window.wgActivateFolderByName = function(name){
  if(!name) return null;
  var n = name.trim().toLowerCase();
  var found = allFolders.find(function(f){ return f.name.toLowerCase()===n; });
  if(!found){
    // zkus částečnou shodu (obsahuje/je obsaženo)
    found = allFolders.find(function(f){
      var fn=f.name.toLowerCase();
      return fn.indexOf(n)>=0 || n.indexOf(fn)>=0;
    });
  }
  if(!found) return null;
  activeFolderId = found.id;
  saveFolders();
  if(typeof updateActiveFolderBar === 'function') updateActiveFolderBar();
  if(typeof renderFolderChips === 'function') renderFolderChips();
  return found.id;
};
window.wgOpenFolderPicker = function(){ openFolderModal(); };

// ── FOLDER MODAL ──────────────────────────────────────────
function openFolderModal(){
  renderFolderModal();
  var m = document.getElementById('modal-folder');
  if(m) m.classList.add('open');
}
function closeFolderModal(){
  var m = document.getElementById('modal-folder');
  if(m) m.classList.remove('open');
}

function renderFolderModal(){
  var el = document.getElementById('folder-list-modal');
  if(!el) return;
  var boards = getBoards();
  var html = '';
  allFolders.forEach(function(f){
    var cnt = boards.filter(function(b){ return b.folderId===f.id; }).length;
    var active = f.id===activeFolderId;
    html += '<div class="folder-item" data-act="selectfolder" data-fid="'+f.id+'">'
      +'<div class="folder-item-icon" style="font-size:20px">📁</div>'
      +'<div style="flex:1"><div class="folder-item-name">'+escH(f.name)+'</div>'
      +'<div class="folder-item-count">'+cnt+' desek</div></div>'
      +(active?'<span style="color:var(--br);font-size:18px">✓</span>':'')
      +'</div>';
  });
  if(!allFolders.length){
    html = '<div style="text-align:center;padding:24px 16px;color:var(--g5);font-size:14px">Žádné složky.<br>Vytvoř první níže.</div>';
  }
  el.innerHTML = html;
}

function createFolder(name){
  if(!name||!name.trim()){ showToast('Zadej název složky'); return null; }
  var f = {id:genId(), name:name.trim(), createdAt:new Date().toISOString()};
  allFolders.push(f);
  saveFolders();
  return f;
}

// Smaže složku. Desky v ní zůstanou (jen ztratí folderId, "Bez složky").
function deleteFolder(fid){
  var idx = allFolders.findIndex(function(f){ return f.id===fid; });
  if(idx<0) return false;
  var name = allFolders[idx].name;
  if(!confirm('Smazat složku "'+name+'"? Desky v ní zůstanou zachované jako "Bez složky".')) return false;
  allFolders.splice(idx,1);
  // Odeber folderId z desek které do ní patřily
  var boards = getBoards();
  boards.forEach(function(b){ if(b.folderId===fid) b.folderId=null; });
  if(activeFolderId===fid) activeFolderId = allFolders.length ? allFolders[0].id : null;
  if(filterFolderId===fid) filterFolderId = '__all';
  saveFolders();
  if(window.wgSave) window.wgSave();
  showToast('Složka "'+name+'" smazána');
  return true;
}

// ── CHIPS + SEARCH + SORT v list screenu ─────────────────
function renderFolderChips(){
  var el = document.getElementById('folder-chips');
  if(!el) return;
  var boards = getBoards();

  var html = '<button class="folder-chip'+(filterFolderId==='__all'?' active':'')+'" data-act="filterfolder" data-fid="__all">Vše ('+boards.length+')</button>';

  allFolders.forEach(function(f){
    var cnt = boards.filter(function(b){ return b.folderId===f.id; }).length;
    html += '<span style="display:inline-flex;align-items:center;gap:2px">'
      +'<button class="folder-chip'+(filterFolderId===f.id?' active':'')+'" data-act="filterfolder" data-fid="'+f.id+'">'+escH(f.name)+' ('+cnt+')</button>'
      +'<button data-act="deletefolder" data-fid="'+f.id+'" style="background:none;border:none;color:var(--g5);font-size:14px;padding:2px 4px;cursor:pointer" aria-label="Smazat složku">✕</button>'
      +'</span>';
  });

  var noFolderCnt = boards.filter(function(b){ return !b.folderId; }).length;
  if(noFolderCnt){
    html += '<button class="folder-chip'+(filterFolderId==='__none'?' active':'')+'" data-act="filterfolder" data-fid="__none">Bez složky ('+noFolderCnt+')</button>';
  }

  el.innerHTML = html;
}

function renderStatsButton(){
  var el = document.getElementById('stats-btn-wrap');
  if(!el) return;
  el.style.display = '';
}

// ── HLAVNÍ RENDER LISTU ───────────────────────────────────
var selectMode = false;
var selectedBoardIndices = {}; // {realBi: true}

function toggleSelectMode(){
  selectMode = !selectMode;
  selectedBoardIndices = {};
  renderBlistMain();
  updateSelectBar();
}

function updateSelectBar(){
  var bar = document.getElementById('select-action-bar');
  if(!bar) return;
  var count = Object.keys(selectedBoardIndices).length;
  bar.style.display = selectMode ? '' : 'none';
  var countEl = document.getElementById('select-count');
  if(countEl) countEl.textContent = count + ' vybráno';
}

function renderBlistMain(){
  var el = document.getElementById('blist');
  if(!el) return;

  var boards = getBoards();

  // 1. Filtr složka
  var filtered = boards.filter(function(b){
    if(filterFolderId==='__all') return true;
    if(filterFolderId==='__none') return !b.folderId;
    return b.folderId === filterFolderId;
  });

  // 2. Filtr vyhledávání
  var q = searchQuery.toLowerCase().trim();
  if(q){
    filtered = filtered.filter(function(b){
      return (b.id||'').toLowerCase().indexOf(q) >= 0;
    });
  }

  // 3. Řazení
  filtered = filtered.slice(); // kopie
  if(boardSortMode==='name'){
    filtered.sort(function(a,b){ return (a.id||'').localeCompare(b.id||'','cs'); });
  } else {
    filtered.sort(function(a,b){
      var ta=a.savedAt||'', tb=b.savedAt||'';
      return ta<tb?1:(ta>tb?-1:0);
    });
  }

  if(!filtered.length){
    el.innerHTML = '<div style="text-align:center;padding:28px;color:var(--g5);font-size:14px">'
      +(q ? 'Nic nenalezeno pro "'+escH(q)+'"' : 'Žádné desky')+'</div>';
    return;
  }

  // Pomocné funkce
  var mkPolys   = window.mkPolys    || function(k,b,d){ return []; };
  var calcUA    = window.calcUA     || function(){ return 0; };
  var calcDAB   = window.calcDAB    || function(){ return 0; };
  var grade     = window.grade      || function(){ return '?'; };
  var gcls      = window.gcls       || function(){ return 'gna'; };

  var html = '';
  filtered.forEach(function(bd){
    var realBi = boards.indexOf(bd);
    var knots  = bd.knots||[];
    var ps     = mkPolys(knots, bd.b||0, bd.d||0);
    var ua     = calcUA(ps, bd.b||0, bd.d||0);
    var kar    = (bd.b&&bd.d) ? (ua/(bd.b*bd.d))*100 : 0;
    var dab    = calcDAB(knots, bd.b||0);
    var gr     = grade(kar, dab, knots.length);
    var dt     = bd.savedAt ? new Date(bd.savedAt).toLocaleString('cs',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    var folderTag = bd.folderId ? '📁 '+escH(getFolderName(bd.folderId))+' · ' : '';
    var tags   = [];
    if(bd.vg)              tags.push('VG'+bd.vg);
    if(bd.moisture!=null)  tags.push('w:'+bd.moisture+'%');
    if(bd.screw)           tags.push('Vrut');
    if(bd.fft&&bd.fft[0]) tags.push('f:'+bd.fft[0]+'Hz');

    var checked = selectedBoardIndices[realBi] ? 'checked' : '';
    var checkboxHtml = selectMode
      ? '<input type="checkbox" data-act="selectboard" data-bi="'+realBi+'" '+checked+' style="width:22px;height:22px;margin-right:10px;flex-shrink:0">'
      : '';
    var clickAct = selectMode ? 'selectboard' : 'openboard';

    html += '<div class="bitem" data-act="'+clickAct+'" data-bi="'+realBi+'">'
      +checkboxHtml
      +'<div class="binfo">'
      +'<strong>'+escH(bd.id||'')+(tags.length?' <span style="font-size:11px;color:var(--g5)">'+tags.join(' ')+'</span>':'')+'</strong>'
      +'<span>'+folderTag+knots.length+' suků · KAR '+kar.toFixed(1)+'% · '+dt+'</span>'
      +'</div>'
      +'<span class="gp '+gcls(gr)+'">'+gr+'</span>'
      +(selectMode ? '' : '<button class="bdel" data-act="delb" data-bi="'+realBi+'">🗑</button>')
      +'</div>';
  });

  el.innerHTML = html;
  updateSelectBar();
}

// ── EXPORT MODAL ──────────────────────────────────────────
var exportSelected = {};

function openExportModal(){
  renderExportModal();
  var m = document.getElementById('modal-export');
  if(m) m.classList.add('open');
}
function closeExportModal(){
  var m = document.getElementById('modal-export');
  if(m) m.classList.remove('open');
}
function renderExportModal(){
  var el = document.getElementById('export-folder-list');
  if(!el) return;
  var boards = getBoards();
  exportSelected = {};

  var html = '<div class="folder-item" data-act="toggleexport" data-fid="__all" style="background:var(--g1)">'
    +'<input type="checkbox" id="exp-all" style="width:20px;height:20px;margin-right:12px">'
    +'<div class="folder-item-name" style="font-weight:700">Všechny složky</div>'
    +'<div class="folder-item-count">'+boards.length+' desek</div></div>';

  allFolders.forEach(function(f){
    var cnt = boards.filter(function(b){ return b.folderId===f.id; }).length;
    exportSelected[f.id] = false;
    html += '<div class="folder-item" data-act="toggleexport" data-fid="'+f.id+'">'
      +'<input type="checkbox" id="exp-'+f.id+'" style="width:20px;height:20px;margin-right:12px">'
      +'<div class="folder-item-icon">📁</div>'
      +'<div class="folder-item-name">'+escH(f.name)+'</div>'
      +'<div class="folder-item-count">'+cnt+' desek</div></div>';
  });

  var noFolderCnt = boards.filter(function(b){ return !b.folderId; }).length;
  if(noFolderCnt){
    exportSelected['__none'] = false;
    html += '<div class="folder-item" data-act="toggleexport" data-fid="__none">'
      +'<input type="checkbox" id="exp-none" style="width:20px;height:20px;margin-right:12px">'
      +'<div class="folder-item-icon">📄</div>'
      +'<div class="folder-item-name">Bez složky</div>'
      +'<div class="folder-item-count">'+noFolderCnt+' desek</div></div>';
  }
  el.innerHTML = html;
}

function toggleExportFolder(fid){
  if(fid==='__all'){
    var allOn = Object.keys(exportSelected).every(function(k){ return exportSelected[k]; });
    Object.keys(exportSelected).forEach(function(k){ exportSelected[k]=!allOn; });
    Object.keys(exportSelected).forEach(function(k){
      var cb=document.getElementById('exp-'+k); if(cb) cb.checked=!allOn;
    });
    var allCb=document.getElementById('exp-all'); if(allCb) allCb.checked=!allOn;
  } else {
    exportSelected[fid] = !exportSelected[fid];
    var cb2=document.getElementById('exp-'+fid); if(cb2) cb2.checked=exportSelected[fid];
    // sync all-checkbox
    var allChecked=Object.keys(exportSelected).every(function(k){ return exportSelected[k]; });
    var allCb2=document.getElementById('exp-all'); if(allCb2) allCb2.checked=allChecked;
  }
}

function doFolderExport(){
  var boards  = getBoards();
  var selectedFids = Object.keys(exportSelected).filter(function(k){ return exportSelected[k]; });
  var exportAll = selectedFids.length===0;

  var wb = XLSX.utils.book_new();
  var hdrs = ['board','b_mm','d_mm','length_mm','mass_g','density_kgm3','MOED_L_MPa','MOED_B_MPa',
              'moisture_%','VG','screw','f1_Hz','f2_Hz','f3_Hz','knot',
              'AS1','AS2','AL1','AL2','BS1','BS2','BL1','BL2','CS1','CS2','CL1','CL2','DS1','DS2','DL1','DL2',
              'area_mm2','a_i_mm','KAR_%','DAB','třída'];

  var groups = {};
  allFolders.forEach(function(f){
    if(!exportAll && !exportSelected[f.id]) return;
    groups[f.name] = boards.filter(function(b){ return b.folderId===f.id; });
  });
  var noFolderBoards = boards.filter(function(b){ return !b.folderId; });
  if(noFolderBoards.length && (exportAll||exportSelected['__none'])){
    groups['Bez složky'] = noFolderBoards;
  }
  if(!Object.keys(groups).length){ showToast('Nic k exportu'); return; }

  var mkPolys   = window.mkPolys    || function(){ return []; };
  var calcUA    = window.calcUA     || function(){ return 0; };
  var calcDAB   = window.calcDAB    || function(){ return 0; };
  var calcDen   = window.calcDensity|| function(){ return null; };
  var calcMOED  = window.calcMOED   || function(){ return {}; };
  var kPts      = window.kPts       || function(){ return null; };
  var pArea     = window.pArea      || function(){ return 0; };
  var kAi       = window.kAi        || function(){ return 0; };
  var grade     = window.grade      || function(){ return '?'; };

  Object.keys(groups).forEach(function(shName){
    var shBoards = groups[shName];
    var rows = [];
    shBoards.forEach(function(bd){
      var knots = bd.knots||[];
      if(!knots.length){
        rows.push([bd.id,bd.b,bd.d,'','','','','','',bd.vg||'',bd.screw?'ano':'','','','',0].concat(new Array(21).fill('')));
        return;
      }
      var ps  = mkPolys(knots,bd.b,bd.d);
      var ua  = calcUA(ps,bd.b,bd.d);
      var kar = bd.b*bd.d>0?(ua/(bd.b*bd.d))*100:0;
      var dab = calcDAB(knots,bd.b);
      var den = calcDen(bd.mass,bd.length,bd.b,bd.d);
      var mr  = calcMOED(bd);
      var gr  = grade(kar,dab,knots.length);
      var fft = bd.fft||[];
      knots.forEach(function(k,ki){
        var pts=kPts(k,bd.b,bd.d); var area=pts?pArea(pts):0; var ai=kAi(k,bd.b);
        var isL=ki===knots.length-1;
        rows.push([bd.id,bd.b,bd.d,
          isL?bd.length||'':'',isL?bd.mass||'':'',isL?den!=null?den:'':'',
          isL?mr.moedL||'':'',isL?mr.moedB||'':'',
          isL?bd.moisture!=null?bd.moisture:'':'',isL?bd.vg||'':'',isL?bd.screw?'ano':'':'',
          isL?fft[0]||'':'',isL?fft[1]||'':'',isL?fft[2]||'':'',ki+1,
          k.as1!=null?k.as1:'',k.as2!=null?k.as2:'',k.al1!=null?k.al1:'',k.al2!=null?k.al2:'',
          k.bs1!=null?k.bs1:'',k.bs2!=null?k.bs2:'',k.bl1!=null?k.bl1:'',k.bl2!=null?k.bl2:'',
          k.cs1!=null?k.cs1:'',k.cs2!=null?k.cs2:'',k.cl1!=null?k.cl1:'',k.cl2!=null?k.cl2:'',
          k.ds1!=null?k.ds1:'',k.ds2!=null?k.ds2:'',k.dl1!=null?k.dl1:'',k.dl2!=null?k.dl2:'',
          +area.toFixed(1),ai>0?+ai.toFixed(1):'',isL?+kar.toFixed(2):'',isL?+dab.toFixed(4):'',isL?gr:'']);
      });
    });
    if(rows.length){
      var ws=XLSX.utils.aoa_to_sheet([hdrs].concat(rows));
      XLSX.utils.book_append_sheet(wb,ws,shName.substr(0,31).replace(/[\\\/\?\*\[\]]/g,'_'));
    }
  });
  XLSX.writeFile(wb,'woodgrader_export_'+new Date().toISOString().slice(0,10)+'.xlsx');
  closeExportModal();
  showToast('Export dokončen ✓');
}

// ── EVENT DELEGATION ──────────────────────────────────────
document.addEventListener('click',function(e){
  var btn = e.target.closest('[data-act]');
  if(!btn) return;
  var act = btn.getAttribute('data-act');

  if(act==='selectfolder'){
    var fid = btn.getAttribute('data-fid');
    var modalEl = document.getElementById('modal-folder');
    var isBulkMove = modalEl && modalEl.getAttribute('data-bulk-move')==='1';
    if(isBulkMove){
      var ids3 = Object.keys(selectedBoardIndices).map(Number);
      var boards3 = getBoards();
      var folderName3 = getFolderName(fid);
      // Najít duplicitní ID v cílové složce
      var movedCount = 0, skippedCount = 0, renamedCount = 0;
      ids3.forEach(function(idx){
        var bd = boards3[idx];
        if(!bd) return;
        var dup = boards3.find(function(b,bi){ return bi!==idx && b.folderId===fid && b.id===bd.id; });
        if(dup){
          // Nabídnout: přejmenovat nebo přeskočit
          var choice = confirm('Deska "'+bd.id+'" již ve složce "'+folderName3+'" existuje. OK = Přejmenovat (_2), Zrušit = Přeskočit');
          if(choice){
            // Přejmenovat
            var baseId = bd.id.replace(/_\d+$/,'');
            var suffix = 2;
            var newId = baseId+'_'+suffix;
            while(boards3.find(function(b){ return b.folderId===fid && b.id===newId; })){
              suffix++; newId = baseId+'_'+suffix;
            }
            bd.id = newId;
            bd.folderId = fid;
            renamedCount++;
          } else {
            skippedCount++;
          }
        } else {
          bd.folderId = fid;
          movedCount++;
        }
      });
      if(window.wgSave) window.wgSave();
      modalEl.removeAttribute('data-bulk-move');
      selectedBoardIndices = {};
      selectMode = false;
      closeFolderModal();
      renderBlistMain();
      renderFolderChips();
      var msg = movedCount+' přesunuto';
      if(renamedCount) msg += ', '+renamedCount+' přejmenováno';
      if(skippedCount) msg += ', '+skippedCount+' přeskočeno';
      showToast(msg+' → "'+folderName3+'"');
      return;
    }
    activeFolderId = fid;
    saveFolders();
    updateActiveFolderBar();
    renderFolderChips();
    renderBlistMain();
    closeFolderModal();
    showToast('Složka: '+getFolderName(fid));
  }
  else if(act==='createfolder'){
    var inp = document.getElementById('new-folder-name');
    var name = inp ? inp.value.trim() : '';
    var f = createFolder(name);
    if(f){
      activeFolderId = f.id;
      saveFolders();
      if(inp) inp.value='';
      updateActiveFolderBar();
      renderFolderModal();
      renderFolderChips();
      renderBlistMain();
      closeFolderModal();
      showToast('Složka "'+f.name+'" vytvořena ✓');
      // Okamžitě aktualizovat select na hlavní straně
      if(typeof updateFolderSelect==='function') updateFolderSelect();
      if(typeof updateBlinkStates==='function') setTimeout(updateBlinkStates,50);
    }
  }
  else if(act==='closefolder')  { closeFolderModal(); }
  else if(act==='closeexport')  { closeExportModal(); }
  else if(act==='openfolder')   { openFolderModal(); }
  else if(act==='openexport')   { openExportModal(); }
  else if(act==='doexport')     { doFolderExport(); }
  else if(act==='toggleexport') { toggleExportFolder(btn.getAttribute('data-fid')); }
  else if(act==='filterfolder'){
    filterFolderId = btn.getAttribute('data-fid');
    renderFolderChips();
    renderBlistMain();
  }
  else if(act==='deletefolder'){
    var fidDel = btn.getAttribute('data-fid');
    if(deleteFolder(fidDel)){
      updateActiveFolderBar();
      renderFolderChips();
      renderBlistMain();
    }
  }
  else if(act==='togglesetectmode'){
    toggleSelectMode();
  }
  else if(act==='selectboard'){
    var biSel = parseInt(btn.getAttribute('data-bi'));
    if(selectedBoardIndices[biSel]) delete selectedBoardIndices[biSel];
    else selectedBoardIndices[biSel] = true;
    renderBlistMain();
  }
  else if(act==='bulkdelete'){
    var ids = Object.keys(selectedBoardIndices).map(Number);
    if(!ids.length){ showToast('Nic není vybráno'); return; }
    if(!confirm('Smazat '+ids.length+' vybraných desek?')) return;
    var boards2 = getBoards();
    ids.sort(function(a,b){return b-a;}).forEach(function(idx){ boards2.splice(idx,1); });
    if(window.wgSave) window.wgSave();
    selectedBoardIndices = {};
    selectMode = false;
    renderBlistMain();
    renderFolderChips();
    showToast(ids.length+' desek smazáno');
  }
  else if(act==='bulkmoveopen'){
    var ids2 = Object.keys(selectedBoardIndices);
    if(!ids2.length){ showToast('Nic není vybráno'); return; }
    renderFolderModal();
    var m = document.getElementById('modal-folder');
    if(m){
      m.setAttribute('data-bulk-move','1');
      m.classList.add('open');
    }
  }
  else if(act==='setsort'){
    boardSortMode = btn.getAttribute('data-sort');
    document.querySelectorAll('[data-act="setsort"]').forEach(function(b){
      var isMe = b.getAttribute('data-sort')===boardSortMode;
      b.style.background = isMe ? 'var(--br)' : '#fff';
      b.style.color = isMe ? '#fff' : 'var(--g7)';
      b.style.borderColor = isMe ? 'var(--br)' : 'var(--g3)';
    });
    renderBlistMain();
  }
});

// ── Search input ──────────────────────────────────────────
document.addEventListener('input',function(e){
  if(e.target && e.target.id==='search-input'){
    searchQuery = e.target.value||'';
    renderBlistMain();
  }
});

// ── Init ─────────────────────────────────────────────────
function initFolders(){
  loadFolders();

  // Nastav globální render funkci
  window.renderBlistGlobal = renderBlistMain;
  // Override starý renderBlist
  window.renderBlist = renderBlistMain;

  // Exportuj potřebné funkce
  window.escH = escH;
  window.openFolderModal  = openFolderModal;
  window.closeFolderModal = closeFolderModal;
  window.openExportModal  = openExportModal;
  window.closeExportModal = closeExportModal;

  // Init aktivní složka — automaticky vyber první, žádný prompt
  if(!activeFolderId && allFolders.length>0){
    activeFolderId = allFolders[0].id;
    saveFolders();
  }

  setTimeout(function(){
    updateActiveFolderBar();
    renderFolderChips();
    renderBlistMain();
    if(typeof updateFolderSelect==='function') updateFolderSelect();
  }, 400);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',initFolders);
} else {
  initFolders();
}

})();
