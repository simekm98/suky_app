// ══════════════════════════════════════════════════════════
//  WoodGrader 26 — Supabase Cloud Sync
//  Offline-first: localStorage je primární, Supabase je záloha
// ══════════════════════════════════════════════════════════
(function(){
'use strict';

var SUPABASE_URL = '';   // nastaveno z konfigurace
var SUPABASE_KEY = '';
var DEVICE_ID = null;
var syncEnabled = false;
var syncPending = false;
var lastSyncAt = null;

// ── Inicializace ──────────────────────────────────────────
function initSync(){
  var cfg = loadSyncConfig();
  if(cfg){
    SUPABASE_URL = cfg.url || '';
    SUPABASE_KEY = cfg.key || '';
    syncEnabled = cfg.enabled || false;
    DEVICE_ID = cfg.deviceId || generateDeviceId();
    saveSyncConfig();
  } else {
    DEVICE_ID = generateDeviceId();
  }
  updateSyncUI();
  if(syncEnabled && SUPABASE_URL && SUPABASE_KEY){
    // Při startu načti data z cloudu pokud jsme online
    if(navigator.onLine) pullFromCloud();
  }
  // Periodik sync každých 30s
  setInterval(function(){
    if(syncEnabled && syncPending && navigator.onLine) pushToCloud();
  }, 30000);
  window.addEventListener('online', function(){
    updateSyncStatus('online');
    if(syncEnabled && syncPending) pushToCloud();
  });
  window.addEventListener('offline', function(){ updateSyncStatus('offline'); });
}

function generateDeviceId(){
  return 'dev_' + Math.random().toString(36).substr(2,9) + '_' + Date.now().toString(36);
}

// ── Konfigurace ───────────────────────────────────────────
function loadSyncConfig(){
  try{
    var raw = localStorage.getItem('wg26_sync_cfg');
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
function saveSyncConfig(){
  try{
    localStorage.setItem('wg26_sync_cfg', JSON.stringify({
      url: SUPABASE_URL, key: SUPABASE_KEY,
      enabled: syncEnabled, deviceId: DEVICE_ID
    }));
  } catch(e){}
}

// ── API volání ────────────────────────────────────────────
function supaFetch(path, method, body){
  if(!SUPABASE_URL || !SUPABASE_KEY) return Promise.reject(new Error('Supabase není nakonfigurováno'));
  var url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path;
  var headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=representation'
  };
  return fetch(url, {
    method: method || 'GET',
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r){
    if(!r.ok) return r.text().then(function(t){ throw new Error(r.status + ': ' + t.slice(0,100)); });
    return r.json().catch(function(){ return {}; });
  });
}

// ── Push — odešli data na cloud ───────────────────────────
function pushToCloud(){
  if(!syncEnabled || !SUPABASE_URL || !SUPABASE_KEY) return;
  var boards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
  var knots  = window.wgGetKnots   ? window.wgGetKnots()    : [];

  // Pokud aktuální deska má suky, přidej ji dočasně
  var allBoards = boards.slice();
  if(knots.length){
    allBoards = allBoards.concat([{
      id: (document.getElementById('cid')||{}).value || '?',
      b: parseFloat((document.getElementById('clen')||{}).value) || 0,
      d: parseFloat((document.getElementById('cwid')||{}).value) || 0,
      knots: knots, savedAt: new Date().toISOString(), _current: true
    }]);
  }

  var payload = {
    device_id: DEVICE_ID,
    boards_json: JSON.stringify(allBoards),
    synced_at: new Date().toISOString(),
    boards_count: boards.length
  };

  updateSyncStatus('syncing');

  // Upsert — pokud záznam pro toto zařízení existuje, aktualizuj
  supaFetch('wg_devices?device_id=eq.' + DEVICE_ID, 'DELETE')
    .catch(function(){}) // ignoruj chybu pokud neexistuje
    .then(function(){
      return supaFetch('wg_devices', 'POST', payload);
    })
    .then(function(){
      syncPending = false;
      lastSyncAt = new Date();
      updateSyncStatus('ok');
    })
    .catch(function(err){
      updateSyncStatus('error', err.message);
    });
}

// ── Pull — načti data z cloudu ────────────────────────────
function pullFromCloud(){
  if(!syncEnabled || !SUPABASE_URL || !SUPABASE_KEY) return;
  updateSyncStatus('syncing');

  // Načti všechna zařízení kromě tohoto
  supaFetch('wg_devices?device_id=neq.' + DEVICE_ID + '&order=synced_at.desc', 'GET')
    .then(function(rows){
      if(!rows || !rows.length){
        updateSyncStatus('ok');
        return;
      }
      // Slouč data ze všech zařízení
      var mergedBoards = [];
      var seenIds = {};
      var myBoards = window.wgGetAllBoards ? window.wgGetAllBoards() : [];

      // Přidej vlastní desky
      myBoards.forEach(function(b){ if(b.id) seenIds[b.id + '_' + (b.savedAt||'')] = true; mergedBoards.push(b); });

      // Přidej cizí desky které ještě nemáme
      rows.forEach(function(row){
        try{
          var boards = JSON.parse(row.boards_json || '[]');
          boards.forEach(function(b){
            if(b._current) return; // přeskoč dočasné záznamy
            var key = b.id + '_' + (b.savedAt||'');
            if(!seenIds[key]){
              seenIds[key] = true;
              b._fromDevice = row.device_id;
              mergedBoards.push(b);
            }
          });
        } catch(e){}
      });

      // Seřaď dle savedAt
      mergedBoards.sort(function(a,b){
        var ta = a.savedAt || '', tb = b.savedAt || '';
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

      if(mergedBoards.length > myBoards.length){
        var added = mergedBoards.length - myBoards.length;
        // Aktualizuj allBoards
        var ab = window.wgGetAllBoards ? window.wgGetAllBoards() : [];
        ab.splice(0, ab.length);
        mergedBoards.forEach(function(b){ ab.push(b); });
        if(window.wgSave) window.wgSave();
        if(window.renderBlistGlobal) window.renderBlistGlobal();
        showSyncToast('☁ Synchronizováno — +' + added + ' desek z cloudu');
      }
      updateSyncStatus('ok');
    })
    .catch(function(err){
      updateSyncStatus('error', err.message);
    });
}

// ── Trigger push při každé změně dat ─────────────────────
function markDirty(){
  syncPending = true;
  if(syncEnabled && navigator.onLine){
    clearTimeout(window._syncDebounce);
    window._syncDebounce = setTimeout(pushToCloud, 3000); // debounce 3s
  }
}
window.wgMarkDirty = markDirty;

// ── UI ────────────────────────────────────────────────────
function updateSyncUI(){
  // Sync toggle v nastavení
  var toggle = document.querySelector('[data-opt="cloud"]');
  if(toggle) toggle.classList.toggle('on', syncEnabled);
  // Status indikátor v topbaru
  var ind = document.getElementById('sync-indicator');
  if(!ind) return;
  if(!syncEnabled){ ind.style.display = 'none'; return; }
  ind.style.display = '';
  updateSyncStatus(navigator.onLine ? 'ok' : 'offline');
}

function updateSyncStatus(state, msg){
  var ind = document.getElementById('sync-indicator');
  if(!ind) return;
  var colors = {ok:'#27AE60', offline:'#888', syncing:'#E67E22', error:'#C0392B'};
  var labels = {ok:'☁', offline:'✈', syncing:'↻', error:'☁!'};
  ind.style.color = colors[state] || '#888';
  ind.title = msg || state;
  ind.textContent = labels[state] || '☁';
}

function showSyncToast(msg){
  var t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 3000);
}

// ── Konfigurace z nastavení UI ────────────────────────────
window.saveSyncSettings = function(url, key, enabled){
  SUPABASE_URL = url.trim();
  SUPABASE_KEY = key.trim();
  syncEnabled = enabled;
  saveSyncConfig();
  updateSyncUI();
  if(enabled && url && key && navigator.onLine){
    pushToCloud();
    setTimeout(pullFromCloud, 1000);
  }
  showSyncToast(enabled ? '☁ Cloud sync aktivován' : 'Cloud sync vypnut');
};

window.wgPullFromCloud = pullFromCloud;
window.wgPushToCloud = pushToCloud;

// ── Init ──────────────────────────────────────────────────
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initSync);
} else {
  initSync();
}

})();
