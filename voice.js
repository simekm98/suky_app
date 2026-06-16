// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština)
//  Kontinuální smyčka: pole+hodnota → "okej?" → ano/ne → další
//  Podporuje: rozměry, VG 1-4, vrut ano/ne
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var sessionActive = false;
var voicePhase = 'idle';        // idle | listening | confirming
var pendingField = null;
var pendingValue = null;        // číslo NEBO 'ano'/'ne' pro vrut, NEBO 1-4 pro VG
var pendingKind = null;         // 'number' | 'bool' | 'vg'
var czechVoice = null;
var micPermissionGranted = false;
var restartTimer = null;
var watchdogTimer = null;

// ── Mapování polí ──────────────────────────────────────────
var FIELD_MAP = {
  'šířka':'clen','šíře':'clen',
  'výška':'cwid','výšku':'cwid',
  'délka':'p-length','délku':'p-length',
  'hmotnost':'p-mass','váha':'p-mass','hmotnosti':'p-mass','vaha':'p-mass',
  'vlhkost':'p-moist','vlhkosti':'p-moist',
  'as jedna':'as1','a s jedna':'as1','a jedna':'as1',
  'as dva':'as2','a s dva':'as2','a dva':'as2',
  'al jedna':'al1','a l jedna':'al1',
  'al dva':'al2','a l dva':'al2',
  'bs jedna':'bs1','b s jedna':'bs1','b jedna':'bs1',
  'bs dva':'bs2','b s dva':'bs2','b dva':'bs2',
  'bl jedna':'bl1','bl dva':'bl2',
  'cs jedna':'cs1','c s jedna':'cs1','c jedna':'cs1',
  'cs dva':'cs2','c s dva':'cs2','c dva':'cs2',
  'cl jedna':'cl1','cl dva':'cl2',
  'ds jedna':'ds1','d s jedna':'ds1','d jedna':'ds1',
  'ds dva':'ds2','d s dva':'ds2','d dva':'ds2',
  'dl jedna':'dl1','dl dva':'dl2',
  'název':'cid','jméno':'cid','identifikace':'cid',
  'vizuál':'p-vg','vizuální':'p-vg','vizuální třída':'p-vg','třída':'p-vg',
  'vrut':'__screw__'
};

// Klíče seřazené dle délky (nejdelší první) pro správné rozpoznání ("vizuální třída" před "třída")
var FIELD_KEYS_SORTED = Object.keys(FIELD_MAP).sort(function(a,b){ return b.length - a.length; });

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

function isStandaloneIOS(){
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  var isStandalone = window.navigator.standalone === true ||
                      window.matchMedia('(display-mode: standalone)').matches;
  return isIOS && isStandalone;
}

function checkVoiceSupport(){
  var SR = getSR();
  if(!SR){
    if(isStandaloneIOS()){
      return {ok:false, reason:'iOS blokuje rozpoznávání řeči v aplikacích přidaných na plochu. Otevři tuto stránku přímo v Safari (zadej adresu, ne ikonu na ploše).', critical:true};
    }
    return {ok:false, reason:'Tento prohlížeč nepodporuje rozpoznávání řeči. Zkus Safari nebo Chrome.', critical:true};
  }
  return {ok:true};
}

// ── TTS ──────────────────────────────────────────────────
function pickCzechVoice(){
  if(!synth) return null;
  var voices = synth.getVoices();
  return voices.find(function(v){ return v.lang==='cs-CZ'; })
      || voices.find(function(v){ return v.lang && v.lang.indexOf('cs')===0; })
      || null;
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
    u.rate = 1.05;
    var done = false;
    var finish = function(){ if(done) return; done=true; if(onEnd) onEnd(); };
    u.onend = finish;
    u.onerror = finish;
    // Watchdog — pokud TTS zůstane viset (známý iOS bug), pokračuj po 4s
    setTimeout(finish, 4000);
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

function parseFieldFromText(text){
  text = text.toLowerCase().trim();
  for(var i=0;i<FIELD_KEYS_SORTED.length;i++){
    var key = FIELD_KEYS_SORTED[i];
    if(text.indexOf(key) >= 0) return FIELD_MAP[key];
  }
  return null;
}

function parseBoolFromText(text){
  text = text.toLowerCase();
  if(/\bano\b/.test(text) || /\bje\b/.test(text) || /\bjo\b/.test(text)) return true;
  if(/\bne\b/.test(text) || /\bnení\b/.test(text)) return false;
  return null;
}

function isStopCommand(text){
  text = text.toLowerCase();
  return text.indexOf('konec')>=0 || text.indexOf('hotovo')>=0 || text.indexOf('stop')>=0 || text.indexOf('ukončit')>=0;
}

// ── Žádost o mikrofon ─────────────────────────────────────
function requestMicPermission(callback){
  if(micPermissionGranted){ callback(true); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    callback(false, 'Mikrofon API není dostupné (vyžaduje HTTPS).');
    return;
  }
  navigator.mediaDevices.getUserMedia({audio:true})
    .then(function(stream){
      stream.getTracks().forEach(function(t){ t.stop(); });
      micPermissionGranted = true;
      callback(true);
    })
    .catch(function(err){
      callback(false, 'Přístup k mikrofonu odepřen: ' + err.message);
    });
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
    if(support.critical){
      updateVoiceUI('error', support.reason);
      setTimeout(function(){ if(!sessionActive) updateVoiceUI('idle',''); }, 6000);
    }
    return;
  }

  sessionActive = true;
  updateVoiceUI('requesting','Žádám o přístup k mikrofonu…');

  requestMicPermission(function(granted, errMsg){
    if(!granted){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast(errMsg || 'Mikrofon nedostupný');
      return;
    }
    speak('Poslouchám. Říkej pole a hodnotu.', function(){
      runRecognitionCycle('listen');
    });
  });
}

function stopVoiceSession(){
  sessionActive = false;
  clearAllTimers();
  if(recognition){ try{ recognition.onend=null; recognition.onerror=null; recognition.abort(); }catch(e){} }
  if(synth) try{ synth.cancel(); }catch(e){}
  voicePhase = 'idle';
  updateVoiceUI('idle','');
  speak('Hlasové zadávání ukončeno.');
}

function clearAllTimers(){
  if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
  if(watchdogTimer){ clearTimeout(watchdogTimer); watchdogTimer=null; }
}

// ── JEDNOTNÁ smyčka rozpoznávání ────────────────────────────
// mode: 'listen' (čeká pole+hodnota) nebo 'confirm' (čeká ano/ne)
function runRecognitionCycle(mode){
  if(!sessionActive) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  clearAllTimers();

  // Ukonči předchozí instanci pokud běží
  if(recognition){
    try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){}
  }

  recognition = new SR();
  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  voicePhase = mode === 'confirm' ? 'confirming' : 'listening';
  updateVoiceUI(voicePhase, mode==='confirm'
    ? ((FIELD_LABELS[pendingField]||pendingField) + ' = ' + pendingValue + ' — okej?')
    : '🎤 Poslouchám…');

  var gotResult = false;

  recognition.onresult = function(event){
    gotResult = true;
    clearAllTimers();
    var transcript = event.results[0][0].transcript;
    if(mode === 'confirm') processConfirmation(transcript);
    else processFieldValue(transcript);
  };

  recognition.onerror = function(event){
    if(!sessionActive) return;
    if(event.error === 'no-speech' || event.error === 'aborted'){
      restartTimer = setTimeout(function(){ runRecognitionCycle(mode); }, 350);
      return;
    }
    if(event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast('Mikrofon zablokován — povol v nastavení prohlížeče');
      return;
    }
    // audio-capture, network apod. — zkus restart
    restartTimer = setTimeout(function(){ runRecognitionCycle(mode); }, 700);
  };

  recognition.onend = function(){
    if(!sessionActive) return;
    if(!gotResult){
      restartTimer = setTimeout(function(){ runRecognitionCycle(mode); }, 300);
    }
  };

  // Watchdog: pokud recognition "zatuhne" (známý iOS/Android bug), restartuj po 8s
  watchdogTimer = setTimeout(function(){
    if(sessionActive && voicePhase===(mode==='confirm'?'confirming':'listening') && !gotResult){
      try{ recognition.abort(); }catch(e){}
    }
  }, 8000);

  try{
    recognition.start();
  } catch(e){
    restartTimer = setTimeout(function(){ runRecognitionCycle(mode); }, 700);
  }
}

function processFieldValue(transcript){
  if(isStopCommand(transcript)){ stopVoiceSession(); return; }

  var field = parseFieldFromText(transcript);
  if(!field){
    showVoiceToast('Nerozpoznáno pole: "'+transcript+'"');
    speak('Nerozuměla jsem políčku.', function(){
      if(sessionActive) runRecognitionCycle('listen');
    });
    return;
  }

  var kind, value;
  if(field === '__screw__'){
    kind = 'bool';
    value = parseBoolFromText(transcript);
    if(value === null){
      showVoiceToast('U vrutu řekni ano nebo ne');
      speak('Vrut — řekni ano nebo ne.', function(){
        if(sessionActive) runRecognitionCycle('listen');
      });
      return;
    }
  } else if(field === 'p-vg'){
    kind = 'vg';
    value = parseSpokenNumber(transcript);
    if(value===null || value<1 || value>4){
      showVoiceToast('Vizuál musí být 1 až 4');
      speak('Vizuální třída je číslo jedna až čtyři.', function(){
        if(sessionActive) runRecognitionCycle('listen');
      });
      return;
    }
    value = Math.round(value);
  } else {
    kind = 'number';
    value = parseSpokenNumber(transcript);
    if(value===null || isNaN(value)){
      showVoiceToast('Nerozpoznána hodnota: "'+transcript+'"');
      speak('Nerozuměla jsem hodnotě.', function(){
        if(sessionActive) runRecognitionCycle('listen');
      });
      return;
    }
  }

  pendingField = field;
  pendingValue = value;
  pendingKind = kind;

  var label = FIELD_LABELS[field] || field;
  var spokenValue = kind==='bool' ? (value?'ano':'ne') : value;
  speak(label + ' ' + spokenValue + '. Okej?', function(){
    if(sessionActive) runRecognitionCycle('confirm');
  });
}

function processConfirmation(transcript){
  var text = transcript.toLowerCase();
  var positive = text.indexOf('ano')>=0 || text.indexOf('jo')>=0 || text.indexOf('jasn')>=0 || text.indexOf('okej')>=0 || text.indexOf('ok')>=0;
  var negative = !positive && text.indexOf('ne')>=0;

  if(positive){
    applyVoiceValue();
  } else if(negative){
    speak('Dobře, zkus znovu.', function(){
      pendingField=null; pendingValue=null; pendingKind=null;
      if(sessionActive) runRecognitionCycle('listen');
    });
    showVoiceToast('Zrušeno — řekni hodnotu znovu');
  } else {
    speak('Řekni ano nebo ne.', function(){
      if(sessionActive) runRecognitionCycle('confirm');
    });
  }
}

function applyVoiceValue(){
  if(pendingField === '__screw__'){
    var cb = document.getElementById('cb-screw');
    if(cb){
      var want = !!pendingValue;
      var has = cb.classList.contains('checked');
      if(want !== has) cb.click(); // využije existující toggle logiku
    }
  } else {
    var el = document.getElementById(pendingField);
    if(el){
      el.value = pendingValue;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      // Pro VG pole je potřeba i kliknout na příslušné tlačítko (UI je button-based)
      if(pendingField === 'p-vg'){
        var vgBtn = document.querySelector('[data-act="setvg"][data-vg="'+pendingValue+'"]');
        if(vgBtn) vgBtn.click();
      }
    }
  }

  var label = FIELD_LABELS[pendingField] || pendingField;
  var shown = pendingKind==='bool' ? (pendingValue?'ano':'ne') : pendingValue;
  showVoiceToast(label+' = '+shown+' ✓ zapsáno');

  speak('Zapsáno. Další?', function(){
    pendingField=null; pendingValue=null; pendingKind=null;
    if(sessionActive) runRecognitionCycle('listen');
  });
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
  setTimeout(function(){t.classList.remove('show');},3200);
}

// ── Skrytí tlačítka mimo entry screen ──────────────────────
function updateVoiceFabVisibility(){
  var fab = document.querySelector('.voice-fab');
  if(!fab) return;
  var entryActive = document.getElementById('s-entry') && document.getElementById('s-entry').classList.contains('active');
  fab.style.display = entryActive ? '' : 'none';
  if(!entryActive && sessionActive){ stopVoiceSession(); }
}

// ── Init ─────────────────────────────────────────────────
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
