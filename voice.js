// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština)
//  Uživatel řekne pole + hodnotu, app zopakuje, uživatel potvrdí
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var voiceState = 'idle'; // idle | listening | confirming
var pendingField = null;
var pendingValue = null;
var czechVoice = null;

// ── Mapování hlasových příkazů na pole formuláře ──────────
var FIELD_MAP = {
  // Geometrie desky
  'šířka': 'clen', 'šíře': 'clen', 'b': 'clen',
  'výška': 'cwid', 'výšku': 'cwid', 'd': 'cwid',
  'délka': 'p-length', 'délku': 'p-length',
  'hmotnost': 'p-mass', 'váha': 'p-mass', 'hmotnosti': 'p-mass',
  'vlhkost': 'p-moist', 'vlhkosti': 'p-moist',
  // Suky — plocha A
  'as jedna': 'as1', 'a s jedna': 'as1', 'a jedna': 'as1',
  'as dva': 'as2', 'a s dva': 'as2', 'a dva': 'as2',
  'al jedna': 'al1', 'a l jedna': 'al1',
  'al dva': 'al2', 'a l dva': 'al2',
  // Plocha B
  'bs jedna': 'bs1', 'b s jedna': 'bs1', 'b jedna': 'bs1',
  'bs dva': 'bs2', 'b s dva': 'bs2', 'b dva': 'bs2',
  'bl jedna': 'bl1', 'bl dva': 'bl2',
  // Plocha C
  'cs jedna': 'cs1', 'c s jedna': 'cs1', 'c jedna': 'cs1',
  'cs dva': 'cs2', 'c s dva': 'cs2', 'c dva': 'cs2',
  'cl jedna': 'cl1', 'cl dva': 'cl2',
  // Plocha D
  'ds jedna': 'ds1', 'd s jedna': 'ds1', 'd jedna': 'ds1',
  'ds dva': 'ds2', 'd s dva': 'ds2', 'd dva': 'ds2',
  'dl jedna': 'dl1', 'dl dva': 'dl2',
  // ID desky
  'název': 'cid', 'jméno': 'cid', 'id': 'cid', 'identifikace': 'cid'
};

var FIELD_LABELS = {
  'clen':'šířka', 'cwid':'výška', 'p-length':'délka', 'p-mass':'hmotnost', 'p-moist':'vlhkost',
  'as1':'AS1', 'as2':'AS2', 'al1':'AL1', 'al2':'AL2',
  'bs1':'BS1', 'bs2':'BS2', 'bl1':'BL1', 'bl2':'BL2',
  'cs1':'CS1', 'cs2':'CS2', 'cl1':'CL1', 'cl2':'CL2',
  'ds1':'DS1', 'ds2':'DS2', 'dl1':'DL1', 'dl2':'DL2',
  'cid':'název'
};

// ── Inicializace rozpoznávání řeči ────────────────────────
function initRecognition(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    return null;
  }
  var r = new SR();
  r.lang = 'cs-CZ';
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 3;
  return r;
}

// ── Inicializace TTS ────────────────────────────────────────
function pickCzechVoice(){
  if(!synth) return null;
  var voices = synth.getVoices();
  var cz = voices.find(function(v){ return v.lang === 'cs-CZ'; })
        || voices.find(function(v){ return v.lang && v.lang.indexOf('cs') === 0; });
  return cz || null;
}
if(synth){
  synth.onvoiceschanged = function(){ czechVoice = pickCzechVoice(); };
  czechVoice = pickCzechVoice();
}

function speak(text, onEnd){
  if(!synth){ if(onEnd) onEnd(); return; }
  synth.cancel();
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'cs-CZ';
  if(czechVoice) u.voice = czechVoice;
  u.rate = 1.0;
  u.onend = function(){ if(onEnd) onEnd(); };
  synth.speak(u);
}

// ── Parsování čísla z mluveného textu ──────────────────────
var WORD_NUMS = {
  'nula':0,'jedna':1,'jeden':1,'dva':2,'dvě':2,'tři':3,'čtyři':4,'pět':5,
  'šest':6,'sedm':7,'osm':8,'devět':9,'deset':10,
  'jedenáct':11,'dvanáct':12,'třináct':13,'čtrnáct':14,'patnáct':15,
  'šestnáct':16,'sedmnáct':17,'osmnáct':18,'devatenáct':19,'dvacet':20,
  'třicet':30,'čtyřicet':40,'padesát':50,'šedesát':60,'sedmdesát':70,
  'osmdesát':80,'devadesát':90,'sto':100,'dvěstě':200,'třista':300
};

function parseSpokenNumber(text){
  text = text.toLowerCase().trim();
  // Zkus přímo najít číslici (i s desetinnou čárkou/tečkou)
  var digitMatch = text.match(/-?\d+[.,]?\d*/);
  if(digitMatch){
    return parseFloat(digitMatch[0].replace(',', '.'));
  }
  // Zkus slovní číslovky — jednoduchá kombinace (desítky + jednotky)
  var words = text.split(/\s+/);
  var total = null;
  var tempTens = 0;
  words.forEach(function(w){
    w = w.replace(/[.,]/g,'');
    if(WORD_NUMS.hasOwnProperty(w)){
      var val = WORD_NUMS[w];
      if(val >= 20 && val % 10 === 0){
        tempTens = val;
      } else if(tempTens > 0 && val < 10){
        total = (total||0) + tempTens + val;
        tempTens = 0;
      } else {
        total = (total||0) + val + tempTens;
        tempTens = 0;
      }
    }
  });
  if(tempTens > 0) total = (total||0) + tempTens;
  return total;
}

// ── Parsování pole z mluveného textu ────────────────────────
function parseFieldFromText(text){
  text = text.toLowerCase().trim();
  // Najdi nejdelší shodu z FIELD_MAP
  var bestMatch = null, bestLen = 0;
  Object.keys(FIELD_MAP).forEach(function(key){
    if(text.indexOf(key) >= 0 && key.length > bestLen){
      bestMatch = FIELD_MAP[key];
      bestLen = key.length;
    }
  });
  return bestMatch;
}

// ── Hlavní hlasový workflow ────────────────────────────────
function startVoiceInput(){
  if(voiceState !== 'idle') return;
  recognition = initRecognition();
  if(!recognition){
    showVoiceToast('Hlasové ovládání není v tomto prohlížeči podporováno');
    return;
  }

  voiceState = 'listening';
  updateVoiceUI('listening', 'Poslouchám… řekni pole a hodnotu');

  recognition.onresult = function(event){
    var transcript = event.results[0][0].transcript;
    handleVoiceCommand(transcript);
  };
  recognition.onerror = function(event){
    voiceState = 'idle';
    updateVoiceUI('idle', '');
    if(event.error !== 'aborted') showVoiceToast('Chyba rozpoznávání: ' + event.error);
  };
  recognition.onend = function(){
    if(voiceState === 'listening'){
      voiceState = 'idle';
      updateVoiceUI('idle', '');
    }
  };

  try{ recognition.start(); }catch(e){ showVoiceToast('Mikrofon nedostupný'); voiceState='idle'; updateVoiceUI('idle',''); }
}

function stopVoiceInput(){
  if(recognition){ try{ recognition.abort(); }catch(e){} }
  voiceState = 'idle';
  updateVoiceUI('idle', '');
}

function handleVoiceCommand(transcript){
  var field = parseFieldFromText(transcript);
  var value = parseSpokenNumber(transcript);

  if(!field){
    speak('Nerozpoznala jsem políčko. Zkus to znovu.', function(){
      voiceState='idle'; updateVoiceUI('idle','');
    });
    showVoiceToast('Nerozpoznáno pole: "' + transcript + '"');
    return;
  }
  if(value === null || isNaN(value)){
    speak('Nerozpoznala jsem hodnotu. Zkus to znovu.', function(){
      voiceState='idle'; updateVoiceUI('idle','');
    });
    showVoiceToast('Nerozpoznána hodnota: "' + transcript + '"');
    return;
  }

  pendingField = field;
  pendingValue = value;
  voiceState = 'confirming';
  var label = FIELD_LABELS[field] || field;
  var confirmText = label + ': ' + value + '. Je to správně? Řekni ano nebo ne.';
  updateVoiceUI('confirming', label + ' = ' + value + ' — potvrď "ano" / "ne"');

  speak(confirmText, function(){
    listenForConfirmation();
  });
}

function listenForConfirmation(){
  var confirmRec = initRecognition();
  if(!confirmRec){ voiceState='idle'; updateVoiceUI('idle',''); return; }

  confirmRec.onresult = function(event){
    var text = event.results[0][0].transcript.toLowerCase();
    if(text.indexOf('ano') >= 0 || text.indexOf('jo') >= 0 || text.indexOf('jasně') >= 0){
      applyVoiceValue();
    } else if(text.indexOf('ne') >= 0){
      speak('Dobře, zkus to znovu.', function(){
        voiceState = 'idle';
        updateVoiceUI('idle','');
        showVoiceToast('Zrušeno — zkus znovu');
      });
    } else {
      speak('Nerozuměla jsem. Zkus celý záznam znovu.', function(){
        voiceState='idle'; updateVoiceUI('idle','');
      });
    }
  };
  confirmRec.onerror = function(){
    voiceState='idle'; updateVoiceUI('idle','');
  };
  try{ confirmRec.start(); }catch(e){ voiceState='idle'; updateVoiceUI('idle',''); }
}

function applyVoiceValue(){
  var el = document.getElementById(pendingField);
  if(el){
    el.value = pendingValue;
    // Trigger input event aby se spočítaly KAR/DAB/hustota
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  var label = FIELD_LABELS[pendingField] || pendingField;
  speak('Uloženo.', function(){
    voiceState = 'idle';
    updateVoiceUI('idle','');
  });
  showVoiceToast(label + ' = ' + pendingValue + ' ✓ zapsáno');
  pendingField = null; pendingValue = null;
}

// ── UI feedback ───────────────────────────────────────────
function updateVoiceUI(state, msg){
  var btn = document.getElementById('btn-voice');
  var indicator = document.getElementById('voice-status');
  if(btn){
    btn.classList.toggle('voice-active', state==='listening' || state==='confirming');
  }
  if(indicator){
    if(state==='idle'){
      indicator.style.display='none';
    } else {
      indicator.style.display='';
      indicator.textContent = msg;
    }
  }
}

function showVoiceToast(msg){
  var t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2800);
}


// ── Skrytí tlačítka mimo entry screen ──────────────────────
function updateVoiceFabVisibility(){
  var fab = document.querySelector('.voice-fab');
  if(!fab) return;
  var entryActive = document.getElementById('s-entry') && document.getElementById('s-entry').classList.contains('active');
  fab.style.display = entryActive ? '' : 'none';
}

// ── Init ─────────────────────────────────────────────────
function initVoice(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    if(voiceState === 'idle') startVoiceInput();
    else stopVoiceInput();
  });
  updateVoiceFabVisibility();
  setInterval(updateVoiceFabVisibility, 400);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', initVoice);
} else {
  initVoice();
}

})();
