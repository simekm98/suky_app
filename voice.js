// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština)
//  Formát: "POLE rovná se HODNOTA" (např. "AS1 rovná se 20")
//  Kontinuální smyčka s delším restartem (iOS Safari fix)
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
var cycleGeneration = 0; // zabraňuje souběhu starých/nových cyklů

// ── Mapování polí — fonetické varianty pro "AS1", "AS 1" atd. ─
// Klíč = jak to STT typicky přepíše, hodnota = ID inputu
var FIELD_MAP = {
  // Geometrie
  'šířka':'clen','šíře':'clen',
  'výška':'cwid','výšku':'cwid',
  'délka':'p-length','délku':'p-length',
  'hmotnost':'p-mass','váha':'p-mass','hmotnosti':'p-mass','vaha':'p-mass',
  'vlhkost':'p-moist','vlhkosti':'p-moist',
  'název':'cid','jméno':'cid','identifikace':'cid',
  'vizuální třída':'p-vg','vizuál':'p-vg','vizuální':'p-vg',
  'vrut':'__screw__',
  // Suky — fonetické varianty "AS1" (eska/es jedna/a s jedna apod.)
  'as1':'as1','as 1':'as1','a s 1':'as1','a s jedna':'as1','as jedna':'as1','a jedna':'as1',
  'as2':'as2','as 2':'as2','a s 2':'as2','a s dva':'as2','as dva':'as2','a dva':'as2',
  'al1':'al1','al 1':'al1','a l 1':'al1','a l jedna':'al1','al jedna':'al1',
  'al2':'al2','al 2':'al2','a l 2':'al2','a l dva':'al2','al dva':'al2',
  'bs1':'bs1','bs 1':'bs1','b s 1':'bs1','b s jedna':'bs1','bs jedna':'bs1','b jedna':'bs1',
  'bs2':'bs2','bs 2':'bs2','b s 2':'bs2','b s dva':'bs2','bs dva':'bs2','b dva':'bs2',
  'bl1':'bl1','bl 1':'bl1','b l jedna':'bl1','bl jedna':'bl1',
  'bl2':'bl2','bl 2':'bl2','b l dva':'bl2','bl dva':'bl2',
  'cs1':'cs1','cs 1':'cs1','c s 1':'cs1','c s jedna':'cs1','cs jedna':'cs1','c jedna':'cs1',
  'cs2':'cs2','cs 2':'cs2','c s 2':'cs2','c s dva':'cs2','cs dva':'cs2','c dva':'cs2',
  'cl1':'cl1','cl 1':'cl1','c l jedna':'cl1','cl jedna':'cl1',
  'cl2':'cl2','cl 2':'cl2','c l dva':'cl2','cl dva':'cl2',
  'ds1':'ds1','ds 1':'ds1','d s 1':'ds1','d s jedna':'ds1','ds jedna':'ds1','d jedna':'ds1',
  'ds2':'ds2','ds 2':'ds2','d s 2':'ds2','d s dva':'ds2','ds dva':'ds2','d dva':'ds2',
  'dl1':'dl1','dl 1':'dl1','d l jedna':'dl1','dl jedna':'dl1',
  'dl2':'dl2','dl 2':'dl2','d l dva':'dl2','dl dva':'dl2'
};
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
function isIOSDevice(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
}

function checkVoiceSupport(){
  var SR = getSR();
  if(!SR){
    if(isStandaloneIOS()){
      return {ok:false, reason:'iOS blokuje rozpoznávání řeči v aplikacích přidaných na plochu. Otevři tuto stránku přímo v Safari.', critical:true};
    }
    return {ok:false, reason:'Tento prohlížeč nepodporuje rozpoznávání řeči.', critical:true};
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
    setTimeout(finish, 4000); // watchdog pro iOS TTS bug (zůstává viset)
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

// ── Parsování "POLE rovná se HODNOTA" ────────────────────────
// Odděluje pole od hodnoty pomocí klíčových slov "rovná se" / "rovnáse" / "="
var EQUALS_PATTERNS = ['rovná se','rovnáse','rovna se','je','='];

function splitFieldAndValue(text){
  text = text.toLowerCase().trim();
  // Najdi oddělovač
  var splitIdx = -1, splitLen = 0;
  EQUALS_PATTERNS.forEach(function(p){
    var idx = text.indexOf(p);
    if(idx >= 0 && (splitIdx===-1 || idx < splitIdx)){
      splitIdx = idx; splitLen = p.length;
    }
  });

  var fieldPart, valuePart;
  if(splitIdx >= 0){
    fieldPart = text.substring(0, splitIdx).trim();
    valuePart = text.substring(splitIdx + splitLen).trim();
  } else {
    // Fallback: žádný oddělovač — zkus najít pole na začátku a číslo na konci
    fieldPart = text;
    valuePart = text;
  }
  return {fieldPart:fieldPart, valuePart:valuePart, fullText:text};
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
  cycleGeneration++;
  updateVoiceUI('requesting','Žádám o přístup k mikrofonu…');

  requestMicPermission(function(granted, errMsg){
    if(!granted){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast(errMsg || 'Mikrofon nedostupný');
      return;
    }
    speak('Poslouchám. Říkej pole rovná se hodnota.', function(){
      runRecognitionCycle('listen', cycleGeneration);
    });
  });
}

function stopVoiceSession(){
  sessionActive = false;
  cycleGeneration++; // znehodnotí všechny pending callbacky
  clearAllTimers();
  if(recognition){ try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){} }
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
// gen = generation token — pokud se mezitím session zastavila/restartovala, starý callback se ignoruje
function runRecognitionCycle(mode, gen){
  if(!sessionActive || gen !== cycleGeneration) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  clearAllTimers();

  if(recognition){
    try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){}
    recognition = null;
  }

  // iOS Safari potřebuje krátkou pauzu po předchozím audio session než nový recognition spustí
  var startDelay = isIOSDevice() ? 350 : 50;

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
    ? ((FIELD_LABELS[pendingField]||pendingField) + ' rovná se ' + pendingValue + ' — okej?')
    : '🎤 Poslouchám… (pole rovná se hodnota)');

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
      runRecognitionCycle(mode, gen);
      return;
    }
    if(event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast('Mikrofon zablokován — povol v nastavení prohlížeče (ikona zámku v adresním řádku)');
      return;
    }
    if(event.error === 'network'){
      showVoiceToast('Rozpoznávání řeči potřebuje internet');
      runRecognitionCycle(mode, gen);
      return;
    }
    // audio-capture apod.
    runRecognitionCycle(mode, gen);
  };

  recognition.onend = function(){
    if(!sessionActive || gen !== cycleGeneration) return;
    if(!gotResult){
      runRecognitionCycle(mode, gen);
    }
  };

  watchdogTimer = setTimeout(function(){
    if(sessionActive && gen===cycleGeneration && !gotResult){
      try{ recognition.abort(); }catch(e){}
    }
  }, 9000);

  try{
    recognition.start();
  } catch(e){
    if(sessionActive && gen===cycleGeneration) runRecognitionCycle(mode, gen);
  }
}

function processFieldValue(transcript, gen){
  if(isStopCommand(transcript)){ stopVoiceSession(); return; }

  var split = splitFieldAndValue(transcript);
  var field = parseFieldFromText(split.fieldPart) || parseFieldFromText(split.fullText);

  if(!field){
    showVoiceToast('Nerozpoznáno pole: "'+transcript+'" — zkus "AS1 rovná se 20"');
    speak('Nerozuměla jsem políčku. Zkus znovu, například A S jedna rovná se dvacet.', function(){
      if(sessionActive) runRecognitionCycle('listen', gen);
    });
    return;
  }

  var kind, value;
  if(field === '__screw__'){
    kind = 'bool';
    value = parseBoolFromText(split.valuePart) !== null ? parseBoolFromText(split.valuePart) : parseBoolFromText(split.fullText);
    if(value === null){
      showVoiceToast('U vrutu řekni ano nebo ne');
      speak('Vrut rovná se ano, nebo vrut rovná se ne.', function(){
        if(sessionActive) runRecognitionCycle('listen', gen);
      });
      return;
    }
  } else if(field === 'p-vg'){
    kind = 'vg';
    value = parseSpokenNumber(split.valuePart) !== null ? parseSpokenNumber(split.valuePart) : parseSpokenNumber(split.fullText);
    if(value===null || value<1 || value>4){
      showVoiceToast('Vizuál musí být 1 až 4');
      speak('Vizuál rovná se číslo jedna až čtyři.', function(){
        if(sessionActive) runRecognitionCycle('listen', gen);
      });
      return;
    }
    value = Math.round(value);
  } else {
    kind = 'number';
    value = parseSpokenNumber(split.valuePart);
    if(value===null || isNaN(value)) value = parseSpokenNumber(split.fullText.replace(split.fieldPart,''));
    if(value===null || isNaN(value)){
      showVoiceToast('Nerozpoznána hodnota v: "'+transcript+'"');
      speak('Nerozuměla jsem hodnotě.', function(){
        if(sessionActive) runRecognitionCycle('listen', gen);
      });
      return;
    }
  }

  pendingField = field;
  pendingValue = value;
  pendingKind = kind;

  var label = FIELD_LABELS[field] || field;
  var spokenValue = kind==='bool' ? (value?'ano':'ne') : value;
  speak(label + ' rovná se ' + spokenValue + '. Okej?', function(){
    if(sessionActive) runRecognitionCycle('confirm', gen);
  });
}

function processConfirmation(transcript, gen){
  var text = transcript.toLowerCase();
  var positive = text.indexOf('ano')>=0 || text.indexOf('jo')>=0 || text.indexOf('jasn')>=0 || text.indexOf('okej')>=0 || text.indexOf('ok')>=0;
  var negative = !positive && text.indexOf('ne')>=0;

  if(positive){
    applyVoiceValue(gen);
  } else if(negative){
    speak('Dobře, zkus znovu.', function(){
      pendingField=null; pendingValue=null; pendingKind=null;
      if(sessionActive) runRecognitionCycle('listen', gen);
    });
    showVoiceToast('Zrušeno — řekni hodnotu znovu');
  } else {
    speak('Řekni ano nebo ne.', function(){
      if(sessionActive) runRecognitionCycle('confirm', gen);
    });
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
  showVoiceToast(label+' = '+shown+' ✓ zapsáno');

  speak('Zapsáno. Další?', function(){
    pendingField=null; pendingValue=null; pendingKind=null;
    if(sessionActive) runRecognitionCycle('listen', gen);
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
