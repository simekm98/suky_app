// ═══════════════════════════════════════════════════════════
//  EXCEL IMPORT — WoodGrader 26
//  Nahraje .xlsx se sloupci jako v exportu a vytvoří desky
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

// Mapování názvů sloupců (case-insensitive, různé varianty)
var COL_MAP = {
  'board':'id', 'id':'id', 'deska':'id', 'název':'id',
  'b_mm':'b', 'b':'b', 'šířka':'b', 'sirka':'b', 'width':'b',
  'd_mm':'d', 'd':'d', 'výška':'d', 'vyska':'d', 'height':'d',
  'length_mm':'length', 'délka':'length', 'delka':'length', 'length':'length',
  'mass_g':'mass', 'hmotnost':'mass', 'mass':'mass', 'weight':'mass',
  'moisture_%':'moisture', 'vlhkost':'moisture', 'moisture':'moisture',
  'vg':'vg',
  'screw':'screw', 'vrut':'screw',
  'f1_hz':'f1', 'f1':'f1',
  'f2_hz':'f2', 'f2':'f2',
  'f3_hz':'f3', 'f3':'f3',
  'knot':'knotnum', 'suk':'knotnum',
  'as1':'as1','as2':'as2','al1':'al1','al2':'al2',
  'bs1':'bs1','bs2':'bs2','bl1':'bl1','bl2':'bl2',
  'cs1':'cs1','cs2':'cs2','cl1':'cl1','cl2':'cl2',
  'ds1':'ds1','ds2':'ds2','dl1':'dl1','dl2':'dl2'
};

function normalizeKey(k){
  return String(k||'').trim().toLowerCase()
    .replace(/[áä]/g,'a').replace(/[čć]/g,'c').replace(/[ďđ]/g,'d')
    .replace(/[éě]/g,'e').replace(/[íî]/g,'i').replace(/[ňń]/g,'n')
    .replace(/[óô]/g,'o').replace(/[řŕ]/g,'r').replace(/[šś]/g,'s')
    .replace(/[ťţ]/g,'t').replace(/[úůü]/g,'u').replace(/[ýÿ]/g,'y')
    .replace(/[žź]/g,'z');
}

function parseNum(v){
  if(v===undefined || v===null || v==='') return null;
  if(typeof v==='number') return v;
  var s = String(v).replace(',','.').trim();
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseBool(v){
  if(v===undefined||v===null||v==='') return false;
  var s = String(v).toLowerCase().trim();
  return s==='ano'||s==='yes'||s==='true'||s==='1'||s==='x';
}

// ── Parsuj řádky listu do desek ────────────────────────────
function parseSheetToBoards(rows, folderId){
  if(!rows.length) return [];
  var headerRow = rows[0];
  var colIdx = {}; // normalizedField -> column index
  headerRow.forEach(function(h, i){
    var norm = normalizeKey(h);
    if(COL_MAP[norm]) colIdx[COL_MAP[norm]] = i;
  });

  if(colIdx.id===undefined){
    return null; // tento list nevypadá jako export desek
  }

  var boardsMap = {}; // boardId+savedIdx -> board object (skupina podle id, protože každý suk = řádek)
  var boardOrder = [];
  var currentBoardKey = null;

  for(var r=1; r<rows.length; r++){
    var row = rows[r];
    if(!row || !row.length) continue;
    var id = row[colIdx.id];
    if(id===undefined || id==='') continue;

    // Nový board začíná pokaždé, kdy se liší ID od posledního ZNÁMÉHO (jednoduchá heuristika:
    // pokud má řádek vyplněné b/d, je to začátek nového boardu)
    var bVal = colIdx.b!==undefined ? parseNum(row[colIdx.b]) : null;
    var dVal = colIdx.d!==undefined ? parseNum(row[colIdx.d]) : null;
    var key = String(id) + '_' + r; // pokud chceme oddělit duplicity, ale spojíme stejné ID po sobě

    // Spoj řádky se stejným ID a stejnými b/d jdoucí bezprostředně po sobě do jednoho boardu
    var lastKey = boardOrder.length ? boardOrder[boardOrder.length-1] : null;
    var lastBoard = lastKey ? boardsMap[lastKey] : null;
    var sameAsLast = lastBoard && lastBoard.id===String(id) &&
                      (bVal===null || lastBoard.b===bVal) &&
                      (dVal===null || lastBoard.d===dVal);

    var board;
    if(sameAsLast){
      board = lastBoard;
    } else {
      board = {
        id: String(id),
        b: bVal || 0,
        d: dVal || 0,
        length: colIdx.length!==undefined ? parseNum(row[colIdx.length]) : null,
        mass: colIdx.mass!==undefined ? parseNum(row[colIdx.mass]) : null,
        moisture: colIdx.moisture!==undefined ? parseNum(row[colIdx.moisture]) : null,
        vg: colIdx.vg!==undefined && row[colIdx.vg]!=='' ? String(row[colIdx.vg]) : null,
        screw: colIdx.screw!==undefined ? parseBool(row[colIdx.screw]) : false,
        fft: [],
        knots: [],
        folderId: folderId,
        savedAt: new Date().toISOString()
      };
      if(colIdx.f1!==undefined){ var f1=parseNum(row[colIdx.f1]); if(f1!=null) board.fft[0]=f1; }
      if(colIdx.f2!==undefined){ var f2=parseNum(row[colIdx.f2]); if(f2!=null) board.fft[1]=f2; }
      if(colIdx.f3!==undefined){ var f3=parseNum(row[colIdx.f3]); if(f3!=null) board.fft[2]=f3; }
      boardsMap[key] = board;
      boardOrder.push(key);
    }

    // Přidej suk pokud má aspoň jednu hodnotu AS/BS/CS/DS
    var knot = {};
    ['as1','as2','al1','al2','bs1','bs2','bl1','bl2','cs1','cs2','cl1','cl2','ds1','ds2','dl1','dl2'].forEach(function(f){
      if(colIdx[f]!==undefined){
        var v = parseNum(row[colIdx[f]]);
        if(v!==null) knot[f]=v;
      }
    });
    if(Object.keys(knot).length>0){
      board.knots.push(knot);
    }
  }

  return boardOrder.map(function(k){ return boardsMap[k]; });
}

// ── Hlavní import funkce ────────────────────────────────────
function importExcelFile(file){
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = new Uint8Array(e.target.result);
      var wb = XLSX.read(data, {type:'array'});
      var allNewBoards = [];
      var skippedSheets = [];

      wb.SheetNames.forEach(function(sheetName){
        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        if(!rows.length) return;

        // Vytvoř/najdi složku se jménem listu (pokud list nemá generický název)
        var folderId = null;
        var genericNames = ['sheet1','list1','suky'];
        if(genericNames.indexOf(sheetName.toLowerCase())<0){
          folderId = findOrCreateFolderByName(sheetName);
        }

        var boards = parseSheetToBoards(rows, folderId);
        if(boards===null){
          skippedSheets.push(sheetName);
          return;
        }
        allNewBoards = allNewBoards.concat(boards);
      });

      if(!allNewBoards.length){
        showImportToast('Nenalezena žádná platná data k importu' + (skippedSheets.length?' (přeskočeno: '+skippedSheets.join(', ')+')':''));
        return;
      }

      // Zobraz potvrzovací dialog
      showImportConfirm(allNewBoards, skippedSheets);

    } catch(err){
      showImportToast('Chyba čtení Excelu: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function findOrCreateFolderByName(name){
  if(!window.wgGetAllFoldersList) return null;
  var folders = window.wgGetAllFoldersList();
  var existing = folders.find(function(f){ return f.name.toLowerCase()===name.toLowerCase(); });
  if(existing) return existing.id;
  if(window.wgCreateFolderByName) return window.wgCreateFolderByName(name);
  return null;
}

// ── Potvrzovací dialog před importem ─────────────────────────
function showImportConfirm(boards, skippedSheets){
  var totalKnots = boards.reduce(function(s,b){ return s+b.knots.length; },0);
  var msg = 'Importovat ' + boards.length + ' desek (' + totalKnots + ' suků)?';
  if(skippedSheets.length) msg += '\\nPřeskočeno listů: ' + skippedSheets.join(', ');

  if(confirm(msg)){
    var allBoards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
    boards.forEach(function(b){ allBoards.push(b); });
    if(window.wgSave) window.wgSave();
    if(window.renderBlistGlobal) window.renderBlistGlobal();
    if(window.renderFolderChipsGlobal) window.renderFolderChipsGlobal();
    showImportToast('Importováno ' + boards.length + ' desek ✓');
  }
}

function showImportToast(msg){
  var t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},3200);
}

// ── Event handling ───────────────────────────────────────────
function handleImportFileInput(input){
  var file = input.files[0];
  if(!file) return;
  importExcelFile(file);
  input.value = ''; // reset pro další import
}
window.handleImportFileInput = handleImportFileInput;

})();
