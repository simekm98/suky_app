// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština) — RYCHLÁ VERZE
//  Formát: "POLE rovná se HODNOTA" / "POLE HODNOTA" / "POLE = HODNOTA"
//  Fonetická normalizace pro AS1/BS1/CS1/DS1/AL1... (eska jedna, á es jedna…)
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var sessionActive = false;
var voicePhase = 'idle';
var pendingField = null;
var pendingValue = null;
var pendingKind = null;
var czechVoice = null;
var micPermissionGranted = false;
var restartTimer = null;
var watchdogTimer = null;
var cycleGeneration = 0;

// ── Fonetická normalizace ────────────────────────────────
// Čeština STT přepíše "AS1" různě: "eska jedna", "á es jedna", "as jedna", "asjedna"...
// Strategie: odstraň mezery a diakritiku, najdi vzor [a-d][sl][1-2]
function normalizePhonetic(text){
  var t = ' ' + text.toLowerCase() + ' ';
  // Nahraď slovní hláskování písmen na jejich grafém (s mezerami pro spolehlivé hranice slov)
  t = t.replace(/ á /g, ' a ').replace(/ bé /g, ' b ').replace(/ cé /g, ' c ').replace(/ dé /g, ' d ');
  t = t.replace(/ eska /g, ' s ').replace(/ es /g, ' s ').replace(/ el /g, ' l ');
  // Slovní číslovky 1/2 v kontextu kódu pole
  t = t.replace(/ jedna /g, ' 1 ').replace(/ jeden /g,' 1 ').replace(/ dva /g, ' 2 ').replace(/ dvě /g, ' 2 ');
  return t;
}

// Najde kód pole typu "as1","bs2","al1" atd. — libovolná kombinace mezer mezi písmeny
function findFieldCode(text){
  var norm = normalizePhonetic(text);
  var compact = norm.replace(/\s+/g, '');
  var m = compact.match(/([abcd])(s|l)(1|2)/);
  if(m) return m[1] + m[2] + m[3];
  return null;
}

// ── Slovní mapování ostatních polí ───────────────────────
var WORD_FIELD_MAP = {
  'šířka':'clen','šíře':'clen',
  'výška':'cwid','výšku':'cwid',
  'délka':'p-length','délku':'p-length',
  'hmotnost':'p-mass','váha':'p-mass','hmotnosti':'p-mass','vaha':'p-mass',
  'vlhkost':'p-moist','vlhkosti':'p-moist',
  'název':'cid','jméno':'cid','identifikace':'cid',
  'vizuální třída':'p-vg','vizuál':'p-vg','vizuální':'p-vg',
  'vrut':'__screw__'
};
var WORD_FIELD_KEYS_SORTED = Object.keys(WORD_FIELD_MAP).sort(function(a,b){ return b.length - a.length; });

var FIELD_LABELS = {
  'clen':'šířka','cwid':'výška','p-length':'délka','p-mass':'hmotnost','p-moist':'vlhkost',
  'as1':'AS1','as2':'AS2','al1':'AL1','al2':'AL2',
  'bs1':'BS1','bs2':'BS2','bl1':'BL1','bl2':'BL2',
  'cs1':'CS1','cs2':'CS2','cl1':'CL1','cl2':'CL2',
  'ds1':'DS1','ds2':'DS2','dl1':'DL1','dl2':'DL2',
  'cid':'název','p-vg':'vizuál','__screw__':'vrut'
};

// ── Detekce podpory ────────────────────────────────────────
function getSR(){ return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
function isIOSDevice(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
function isStandaloneIOS(){
  var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIOSDevice() && isStandalone;
}
function checkVoiceSupport(){
  var SR = getSR();
  if(!SR){
    if(isStandaloneIOS()) return {ok:false, reason:'iOS blokuje rozpoznávání řeči v PWA na ploše. Otevři stránku v Safari.', critical:true};
    return {ok:false, reason:'Prohlížeč nepodporuje rozpoznávání řeči.', critical:true};
  }
  return {ok:true};
}

// ── TTS — zkráceno, bez zbytečných vět ───────────────────
function pickCzechVoice(){
  if(!synth) return null;
  var voices = synth.getVoices();
  return voices.find(function(v){ return v.lang==='cs-CZ'; })
      || voices.find(function(v){ return v.lang && v.lang.indexOf('cs')===0; }) || null;
}
if(synth){
  synth.onvoiceschanged = function(){ czechVoice = pickCzechVoice(); };
  czechVoice = pickCzechVoice();
}

function speak(text, onEnd){
  if(!synth){ if(onEnd) onEnd(); return; }
  try{
    synth.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'cs-CZ';
    if(czechVoice) u.voice = czechVoice;
    u.rate = 1.25; // rychlejší řeč
    var done = false;
    var finish = function(){ if(done) return; done=true; if(onEnd) onEnd(); };
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, 2500); // kratší watchdog
    synth.speak(u);
  } catch(e){ if(onEnd) onEnd(); }
}

// ── Parsování čísla ──────────────────────────────────────────
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
  var digitMatch = text.match(/-?\d+[.,]?\d*/);
  if(digitMatch) return parseFloat(digitMatch[0].replace(',', '.'));
  var words = text.split(/\s+/);
  var total = null, tempTens = 0;
  words.forEach(function(w){
    w = w.replace(/[.,]/g,'');
    if(WORD_NUMS.hasOwnProperty(w)){
      var val = WORD_NUMS[w];
      if(val>=20 && val%10===0){ tempTens=val; }
      else if(tempTens>0 && val<10){ total=(total||0)+tempTens+val; tempTens=0; }
      else { total=(total||0)+val+tempTens; tempTens=0; }
    }
  });
  if(tempTens>0) total=(total||0)+tempTens;
  return total;
}

// ── Rozdělení textu na pole + hodnotu ─────────────────────
var EQUALS_PATTERNS = ['rovná se','rovnáse','rovna se','='];

function parseCommand(text){
  text = text.toLowerCase().trim();

  // 1. Zkus najít kód pole (AS1, BS2, atd.)
  var code = findFieldCode(text);
  var field = code || null;

  // 2. Pokud kód nenalezen, zkus slovní pole
  if(!field){
    for(var i=0;i<WORD_FIELD_KEYS_SORTED.length;i++){
      var key = WORD_FIELD_KEYS_SORTED[i];
      if(text.indexOf(key) >= 0){ field = WORD_FIELD_MAP[key]; break; }
    }
  }
  if(!field) return {field:null, valueText:text};

  // 3. Najdi část textu PO poli (oddělovač nebo prostě zbytek)
  var valueText = text;
  // Zkus najít oddělovač
  var splitIdx = -1, splitLen = 0;
  EQUALS_PATTERNS.forEach(function(p){
    var idx = text.indexOf(p);
    if(idx >= 0 && (splitIdx===-1 || idx < splitIdx)){ splitIdx=idx; splitLen=p.length; }
  });
  if(splitIdx >= 0){
    valueText = text.substring(splitIdx+splitLen).trim();
  } else {
    // Bez oddělovače — vezmi všechny číslice z celého textu (poslední číslo ve větě je obvykle hodnota)
    var allNums = text.match(/-?\d+[.,]?\d*/g);
    if(allNums && allNums.length){
      valueText = allNums[allNums.length-1];
    }
  }
  return {field:field, valueText:valueText};
}

function parseBoolFromText(text){
  text = text.toLowerCase();
  if(/\bano\b/.test(text) || /\bjo\b/.test(text)) return true;
  if(/\bne\b/.test(text)) return false;
  return null;
}

function isStopCommand(text){
  text = text.toLowerCase();
  return text.indexOf('konec')>=0 || text.indexOf('hotovo')>=0 || text.indexOf('stop')>=0 || text.indexOf('ukončit')>=0;
}

// ── Mikrofon permission ───────────────────────────────────
function requestMicPermission(callback){
  if(micPermissionGranted){ callback(true); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    callback(false, 'Mikrofon API není dostupné (vyžaduje HTTPS).'); return;
  }
  navigator.mediaDevices.getUserMedia({audio:true})
    .then(function(stream){
      stream.getTracks().forEach(function(t){ t.stop(); });
      micPermissionGranted = true;
      callback(true);
    })
    .catch(function(err){ callback(false, 'Mikrofon odepřen: ' + err.message); });
}

// ── Session control ────────────────────────────────────────
function toggleVoiceSession(){
  if(sessionActive) stopVoiceSession();
  else startVoiceSession();
}

function startVoiceSession(){
  var support = checkVoiceSupport();
  if(!support.ok){
    showVoiceToast(support.reason);
    updateVoiceUI('error', support.reason);
    setTimeout(function(){ if(!sessionActive) updateVoiceUI('idle',''); }, 5000);
    return;
  }

  sessionActive = true;
  cycleGeneration++;
  updateVoiceUI('requesting','Připravuji mikrofon…');

  requestMicPermission(function(granted, errMsg){
    if(!granted){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast(errMsg || 'Mikrofon nedostupný');
      return;
    }
    // Krátké uvítání, hned poslouchej
    var gen = cycleGeneration;
    runRecognitionCycle('listen', gen);
  });
}

function stopVoiceSession(){
  sessionActive = false;
  cycleGeneration++;
  clearAllTimers();
  if(recognition){ try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){} }
  if(synth) try{ synth.cancel(); }catch(e){}
  voicePhase = 'idle';
  updateVoiceUI('idle','');
}

function clearAllTimers(){
  if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
  if(watchdogTimer){ clearTimeout(watchdogTimer); watchdogTimer=null; }
}

// ── JEDNOTNÁ smyčka rozpoznávání ────────────────────────────
function runRecognitionCycle(mode, gen){
  if(!sessionActive || gen !== cycleGeneration) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  clearAllTimers();
  if(recognition){
    try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){}
    recognition = null;
  }

  // Minimální nutné zpoždění (iOS potřebuje trochu, jinak konflikt audio session)
  var startDelay = isIOSDevice() ? 150 : 20;
  restartTimer = setTimeout(function(){
    if(!sessionActive || gen !== cycleGeneration) return;
    actuallyStartRecognition(mode, gen);
  }, startDelay);
}

function actuallyStartRecognition(mode, gen){
  var SR = getSR();
  recognition = new SR();
  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;

  voicePhase = mode === 'confirm' ? 'confirming' : 'listening';
  updateVoiceUI(voicePhase, mode==='confirm'
    ? ((FIELD_LABELS[pendingField]||pendingField) + ' = ' + pendingValue + ' — ano/ne?')
    : '🎤 AS1 = 20 …');

  var gotResult = false;

  recognition.onresult = function(event){
    if(gen !== cycleGeneration) return;
    gotResult = true;
    clearAllTimers();
    var transcript = event.results[0][0].transcript;
    if(mode === 'confirm') processConfirmation(transcript, gen);
    else processFieldValue(transcript, gen);
  };

  recognition.onerror = function(event){
    if(!sessionActive || gen !== cycleGeneration) return;
    if(event.error === 'no-speech' || event.error === 'aborted'){
      runRecognitionCycle(mode, gen); return;
    }
    if(event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast('Mikrofon zablokován v nastavení prohlížeče');
      return;
    }
    runRecognitionCycle(mode, gen);
  };

  recognition.onend = function(){
    if(!sessionActive || gen !== cycleGeneration) return;
    if(!gotResult) runRecognitionCycle(mode, gen);
  };

  watchdogTimer = setTimeout(function(){
    if(sessionActive && gen===cycleGeneration && !gotResult){ try{ recognition.abort(); }catch(e){} }
  }, 6000);

  try{ recognition.start(); }
  catch(e){ if(sessionActive && gen===cycleGeneration) runRecognitionCycle(mode, gen); }
}

function processFieldValue(transcript, gen){
  if(isStopCommand(transcript)){ stopVoiceSession(); return; }

  var parsed = parseCommand(transcript);
  if(!parsed.field){
    showVoiceToast('Nerozpoznáno: "'+transcript+'" — zkus "AS1 = 20"');
    // Žádné TTS — okamžitě poslouchej dál (rychlost)
    if(sessionActive) runRecognitionCycle('listen', gen);
    return;
  }

  var field = parsed.field;
  var kind, value;

  if(field === '__screw__'){
    kind = 'bool';
    value = parseBoolFromText(parsed.valueText);
    if(value === null){
      showVoiceToast('Vrut: řekni ano nebo ne');
      if(sessionActive) runRecognitionCycle('listen', gen);
      return;
    }
  } else if(field === 'p-vg'){
    kind = 'vg';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || value<1 || value>4){
      showVoiceToast('Vizuál: číslo 1 až 4');
      if(sessionActive) runRecognitionCycle('listen', gen);
      return;
    }
    value = Math.round(value);
  } else {
    kind = 'number';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || isNaN(value)){
      showVoiceToast('Nerozpoznána hodnota v: "'+transcript+'"');
      if(sessionActive) runRecognitionCycle('listen', gen);
      return;
    }
  }

  pendingField = field;
  pendingValue = value;
  pendingKind = kind;

  var label = FIELD_LABELS[field] || field;
  var spokenValue = kind==='bool' ? (value?'ano':'ne') : value;
  // Krátké TTS potvrzení, hned poslouchej na ano/ne
  speak(label + ' ' + spokenValue + '?', function(){
    if(sessionActive) runRecognitionCycle('confirm', gen);
  });
}

function processConfirmation(transcript, gen){
  var text = transcript.toLowerCase();
  var positive = /\bano\b/.test(text) || /\bjo\b/.test(text) || text.indexOf('jasn')>=0 || text.indexOf('okej')>=0 || text.indexOf('ok')>=0;
  var negative = !positive && /\bne\b/.test(text);

  if(positive){
    applyVoiceValue(gen);
  } else if(negative){
    showVoiceToast('Zrušeno — zkus znovu');
    pendingField=null; pendingValue=null; pendingKind=null;
    if(sessionActive) runRecognitionCycle('listen', gen);
  } else {
    // Nerozuměl — rovnou poslouchej znovu na ano/ne (bez TTS prodlevy)
    if(sessionActive) runRecognitionCycle('confirm', gen);
  }
}

function applyVoiceValue(gen){
  if(pendingField === '__screw__'){
    var cb = document.getElementById('cb-screw');
    if(cb){
      var want = !!pendingValue;
      var has = cb.classList.contains('checked');
      if(want !== has) cb.click();
    }
  } else {
    var el = document.getElementById(pendingField);
    if(el){
      el.value = pendingValue;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      if(pendingField === 'p-vg'){
        var vgBtn = document.querySelector('[data-act="setvg"][data-vg="'+pendingValue+'"]');
        if(vgBtn) vgBtn.click();
      }
    }
  }

  var label = FIELD_LABELS[pendingField] || pendingField;
  var shown = pendingKind==='bool' ? (pendingValue?'ano':'ne') : pendingValue;
  showVoiceToast(label+' = '+shown+' ✓');

  pendingField=null; pendingValue=null; pendingKind=null;
  // Bez TTS — okamžitě poslouchej dál (maximální rychlost)
  if(sessionActive) runRecognitionCycle('listen', gen);
}

// ── UI feedback ───────────────────────────────────────────
function updateVoiceUI(state, msg){
  var btn = document.getElementById('btn-voice');
  var indicator = document.getElementById('voice-status');
  if(btn){
    btn.classList.toggle('voice-active', state==='listening'||state==='confirming'||state==='requesting');
    btn.textContent = sessionActive ? '⏹' : '🎤';
  }
  if(indicator){
    if(state==='idle'){ indicator.style.display='none'; }
    else {
      indicator.style.display='';
      indicator.textContent = msg;
      indicator.style.background = state==='error' ? '#C0392B' : 'var(--g9)';
    }
  }
}

function showVoiceToast(msg){
  var t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2200);
}

function updateVoiceFabVisibility(){
  var fab = document.querySelector('.voice-fab');
  if(!fab) return;
  var entryActive = document.getElementById('s-entry') && document.getElementById('s-entry').classList.contains('active');
  fab.style.display = entryActive ? '' : 'none';
  if(!entryActive && sessionActive){ stopVoiceSession(); }
}

function initVoice(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    toggleVoiceSession();
  });
  updateVoiceFabVisibility();
  setInterval(updateVoiceFabVisibility, 400);
  var support = checkVoiceSupport();
  if(!support.ok) console.warn('[Voice] '+support.reason);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', initVoice);
} else {
  initVoice();
}

})();
