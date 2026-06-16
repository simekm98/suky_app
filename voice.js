// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 — REAL-TIME VERZE
//  Formát: "plocha A rozměr jedna rovná se 20"
//  Bez TTS prodlev — jen krátký pípnutí + vizuální feedback
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var czechVoice = null;
var sessionActive = false;
var voicePhase = 'idle';
var pendingField = null;
var pendingValue = null;
var pendingKind = null;
var micPermissionGranted = false;
var restartTimer = null;
var watchdogTimer = null;
var cycleGeneration = 0;
var audioCtxBeep = null;

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

// Mluví KRÁTCE — jen pole a hodnotu, žádné věty navíc
function speak(text, onEnd){
  if(!synth){ if(onEnd) onEnd(); return; }
  try{
    synth.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'cs-CZ';
    if(czechVoice) u.voice = czechVoice;
    u.rate = 1.3; // rychlá řeč
    var done = false;
    var finish = function(){ if(done) return; done=true; if(onEnd) onEnd(); };
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, 2200); // watchdog — pokud TTS zůstane viset
    synth.speak(u);
  } catch(e){ if(onEnd) onEnd(); }
}

// ── Viditelný debug panel (funguje i na telefonu bez připojení k PC) ──
function dlog(msg, cls){
  console.log('[Voice]', msg);
  var panel = document.getElementById('voice-debug');
  if(!panel) return;
  panel.classList.add('show');
  var line = document.createElement('div');
  if(cls) line.className = cls;
  line.textContent = new Date().toLocaleTimeString('cs-CZ').slice(0,8) + '  ' + msg;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  // Omez na posledních 40 řádků
  while(panel.children.length > 40) panel.removeChild(panel.firstChild);
}

// ── Mapování "plocha X rozměr Y" ──────────────────────────
var PLOCHA_MAP = {'a':'a','á':'a','b':'b','bé':'b','c':'c','cé':'c','d':'d','dé':'d'};
// Rozměr 1=S1, 2=S2, 3=L1, 4=L2 — odpovídá novému zobrazení A1/A2/A3/A4 v UI
var ROZMER_MAP = {
  '1':'s1','jedna':'s1','jeden':'s1','první':'s1',
  '2':'s2','dva':'s2','dvě':'s2','druhý':'s2',
  '3':'l1','tři':'l1','třetí':'l1',
  '4':'l2','čtyři':'l2','čtvrtý':'l2'
};

// ── Slovní mapování ostatních polí ───────────────────────
var WORD_FIELD_MAP = {
  'šířka b':'clen','šířka':'clen','šíře':'clen',
  'výška d':'cwid','výška':'cwid','výšku':'cwid',
  'délka':'p-length','délku':'p-length',
  'hmotnost':'p-mass','hmotnosti':'p-mass',
  'vlhkost w':'p-moist','vlhkost':'p-moist','vlhkosti':'p-moist',
  'název':'cid',
  'vizuál':'p-vg',
  'vrut':'__screw__'
};
var WORD_FIELD_KEYS_SORTED = Object.keys(WORD_FIELD_MAP).sort(function(a,b){ return b.length - a.length; });

var FIELD_LABELS = {
  'clen':'šířka','cwid':'výška','p-length':'délka','p-mass':'hmotnost','p-moist':'vlhkost',
  'as1':'A1','as2':'A2','al1':'A3','al2':'A4',
  'bs1':'B1','bs2':'B2','bl1':'B3','bl2':'B4',
  'cs1':'C1','cs2':'C2','cl1':'C3','cl2':'C4',
  'ds1':'D1','ds2':'D2','dl1':'D3','dl2':'D4',
  'cid':'název','p-vg':'vizuál','__screw__':'vrut'
};

// ── Přímý formát "AS1", "as 1", "a s jedna" (fonetická normalizace) ──
function findDirectFieldCode(text){
  var t = ' ' + text.toLowerCase() + ' ';
  t = t.replace(/ á /g, ' a ').replace(/ bé /g, ' b ').replace(/ cé /g, ' c ').replace(/ dé /g, ' d ');
  t = t.replace(/ eska /g, ' s ').replace(/ es /g, ' s ').replace(/ el /g, ' l ');
  t = t.replace(/ jedna /g, ' 1 ').replace(/ jeden /g,' 1 ').replace(/ dva /g, ' 2 ').replace(/ dvě /g, ' 2 ');
  var compact = t.replace(/\s+/g, '');
  var m = compact.match(/([abcd])(s|l)(1|2)/);
  if(m) return m[1] + m[2] + m[3];
  return null;
}

// ── Nalezení "plocha X rozměr Y" ve textu ─────────────────
function findPlochaRozmer(text){
  var t = ' ' + text.toLowerCase() + ' ';
  // Najdi "plocha"
  var plochaIdx = t.indexOf('plocha');
  if(plochaIdx < 0) return null;

  var after = t.substring(plochaIdx + 6).trim();
  // Najdi písmeno plochy (první slovo)
  var words = after.split(/\s+/);
  if(!words.length) return null;
  var plochaLetter = PLOCHA_MAP[words[0]];
  if(!plochaLetter) return null;

  // Najdi "rozměr" nebo přímo číslo po něm
  var rest = words.slice(1).join(' ');
  var rozmerIdx = rest.indexOf('rozměr');
  var rozmerPart;
  if(rozmerIdx >= 0){
    rozmerPart = rest.substring(rozmerIdx + 6).trim();
  } else {
    rozmerPart = rest; // "plocha A jedna" bez slova rozměr
  }

  // Zkus najít rozměr 1-4 ve slovech po "rozměr"
  var rozmerWords = rozmerPart.split(/\s+/);
  var rozmerKey = null;

  if(rozmerWords.length >= 1 && ROZMER_MAP[rozmerWords[0]]){
    rozmerKey = ROZMER_MAP[rozmerWords[0]];
  }
  // Přímá číslice 1-4
  if(!rozmerKey){
    var numMatch = rozmerPart.match(/^[1234]/);
    if(numMatch) rozmerKey = ROZMER_MAP[numMatch[0]];
  }
  if(!rozmerKey) return null;

  return plochaLetter + rozmerKey; // např. "as1", "al2"
}

var FIELD_LABELS_PLOCHA = {
  'as1':'A1','as2':'A2','al1':'A3','al2':'A4',
  'bs1':'B1','bs2':'B2','bl1':'B3','bl2':'B4',
  'cs1':'C1','cs2':'C2','cl1':'C3','cl2':'C4',
  'ds1':'D1','ds2':'D2','dl1':'D3','dl2':'D4'
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

// ── Krátké pípnutí místo TTS (okamžité, žádná prodleva) ───
function beep(freq, dur, vol){
  try{
    if(!audioCtxBeep) audioCtxBeep = new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtxBeep.state === 'suspended') audioCtxBeep.resume();
    var osc = audioCtxBeep.createOscillator();
    var gain = audioCtxBeep.createGain();
    osc.type = 'square'; // výraznější, pronikavější zvuk než sine
    osc.frequency.value = freq;
    osc.connect(gain); gain.connect(audioCtxBeep.destination);
    gain.gain.setValueAtTime(vol||0.35, audioCtxBeep.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtxBeep.currentTime + dur);
    osc.start(); osc.stop(audioCtxBeep.currentTime + dur);
  } catch(e){ console.warn('[Voice] beep failed', e); }
}
function beepOk(){ beep(1000, 0.12, 0.3); }
function beepErr(){
  beep(180, 0.18, 0.4);
  setTimeout(function(){ beep(180, 0.18, 0.4); }, 220);
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

  // Nejdřív zkus přímou číslici s desetinnou čárkou/tečkou (10.5, 10,5)
  var digitMatch = text.match(/-?\d+[.,]\d+/);
  if(digitMatch) return parseFloat(digitMatch[0].replace(',', '.'));

  // "X celá Y" / "X celých Y" — slovní desetinné číslo
  var celaMatch = text.match(/(.+?)\s+cel[áých]+\s+(.+)/);
  if(celaMatch){
    var wholePart = parseIntegerWords(celaMatch[1]);
    var fracPart = parseIntegerWords(celaMatch[2]);
    if(wholePart !== null && fracPart !== null){
      return wholePart + fracPart / Math.pow(10, String(fracPart).length);
    }
  }

  // Celé číslo přímo (bez desetinné části)
  var intMatch = text.match(/-?\d+/);
  if(intMatch) return parseFloat(intMatch[0]);

  // Čistě slovní celé číslo
  return parseIntegerWords(text);
}

function parseIntegerWords(text){
  text = text.trim();
  // Pokud je to číslice, vrať přímo
  var digitMatch = text.match(/^-?\d+$/);
  if(digitMatch) return parseInt(digitMatch[0], 10);

  var words = text.split(/\s+/);
  var total = 0, hasAny = false;
  var hundreds = 0, tens = 0;
  words.forEach(function(w){
    w = w.replace(/[.,]/g,'');
    if(WORD_NUMS.hasOwnProperty(w)){
      hasAny = true;
      var val = WORD_NUMS[w];
      if(val >= 100){ hundreds += val; }
      else if(val >= 20 && val % 10 === 0){ tens = val; }
      else if(tens > 0 && val < 10){ total += tens + val; tens = 0; }
      else { total += val; }
    }
  });
  if(tens > 0) total += tens;
  if(!hasAny) return null;
  return hundreds + total;
}

// ── Rozdělení textu na pole + hodnotu ─────────────────────
var EQUALS_PATTERNS = ['rovná se','rovnáse','rovna se','='];

function parseCommand(text){
  text = text.toLowerCase().trim();

  // 1. Zkus přímý kód "AS1", "as 1", "a s jedna" (nejrychlejší, krátký formát)
  var field = findDirectFieldCode(text);

  // 2. Zkus "plocha X rozměr Y" formát (delší, ale jednoznačný)
  if(!field) field = findPlochaRozmer(text);

  // 3. Pokud ne, zkus slovní pole (šířka, výška, vrut...)
  if(!field){
    for(var i=0;i<WORD_FIELD_KEYS_SORTED.length;i++){
      var key = WORD_FIELD_KEYS_SORTED[i];
      if(text.indexOf(key) >= 0){ field = WORD_FIELD_MAP[key]; break; }
    }
  }
  if(!field) return {field:null, valueText:text};

  // 3. Najdi hodnotu — po oddělovači, nebo poslední číslo ve větě
  var valueText = text;
  var splitIdx = -1, splitLen = 0;
  EQUALS_PATTERNS.forEach(function(p){
    var idx = text.indexOf(p);
    if(idx >= 0 && (splitIdx===-1 || idx < splitIdx)){ splitIdx=idx; splitLen=p.length; }
  });
  if(splitIdx >= 0){
    valueText = text.substring(splitIdx+splitLen).trim();
  } else {
    var allNums = text.match(/-?\d+[.,]?\d*/g);
    if(allNums && allNums.length){
      valueText = allNums[allNums.length-1];
    } else {
      // Zkus slovní čísla na konci věty
      valueText = text;
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

// ── Akční příkazy bez hodnoty (přidat suk, nová deska) ────
function findActionCommand(text){
  text = text.toLowerCase();
  if(text.indexOf('přidat suk')>=0 || text.indexOf('přidej suk')>=0) return {action:'addknot', label:'Přidat suk'};
  if(text.indexOf('nová deska')>=0 || text.indexOf('novou desku')>=0 || text.indexOf('nova deska')>=0) return {action:'newboard', label:'Nová deska'};
  return null;
}

function executeAction(action){
  if(action === 'addknot'){
    var btn = document.getElementById('btn-add');
    if(btn) btn.click();
  } else if(action === 'newboard'){
    var btn2 = document.getElementById('btn-new');
    if(btn2) btn2.click();
  }
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
    beepOk();
    runRecognitionCycle('listen', cycleGeneration);
  });
}

function stopVoiceSession(){
  sessionActive = false;
  cycleGeneration++;
  clearAllTimers();
  if(recognition){ try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){} }
  voicePhase = 'idle';
  updateVoiceUI('idle','');
}

function clearAllTimers(){
  if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
  if(watchdogTimer){ clearTimeout(watchdogTimer); watchdogTimer=null; }
}

// ── JEDNOTNÁ smyčka rozpoznávání — minimální zpoždění ─────
function runRecognitionCycle(mode, gen){
  if(!sessionActive || gen !== cycleGeneration) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  clearAllTimers();
  if(recognition){
    try{ recognition.onend=null; recognition.onerror=null; recognition.onresult=null; recognition.abort(); }catch(e){}
    recognition = null;
  }

  // Vždy minimální zpoždění (i na desktopu) — okamžité restartování recognition
  // bez pauzy způsobuje na řadě platforem tiché InvalidStateError a zamrznutí cyklu
  var startDelay = isIOSDevice() ? 120 : 60;
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
  dlog('▶ start recognition mode='+mode+' gen='+gen+' (current='+cycleGeneration+')');
  updateVoiceUI(voicePhase, mode==='confirm'
    ? ((FIELD_LABELS[pendingField]||pendingField) + ' = ' + pendingValue + ' — ano/ne?')
    : '🎤 plocha A rozměr 1 = 20');

  var gotResult = false;

  recognition.onresult = function(event){
    if(gen !== cycleGeneration){
      dlog('⚠ onresult IGNOROVÁN — gen mismatch ('+gen+' vs '+cycleGeneration+')','err');
      return;
    }
    gotResult = true;
    clearAllTimers();
    var transcript = event.results[0][0].transcript;
    dlog('📥 onresult [' + mode + ']: "' + transcript + '"');
    if(mode === 'confirm') processConfirmation(transcript, gen);
    else processFieldValue(transcript, gen);
  };

  recognition.onerror = function(event){
    dlog('⚠ onerror: '+event.error+' (mode='+mode+')', event.error==='no-speech'?'':'err');
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
    dlog('⏹ onend (mode='+mode+' gotResult='+gotResult+')');
    if(!sessionActive || gen !== cycleGeneration) return;
    if(!gotResult) runRecognitionCycle(mode, gen);
  };

  watchdogTimer = setTimeout(function(){
    if(sessionActive && gen===cycleGeneration && !gotResult){
      dlog('⏱ watchdog timeout — abort','err');
      try{ recognition.abort(); }catch(e){}
    }
  }, 6000);

  try{ recognition.start(); dlog('✓ recognition.start() OK'); }
  catch(e){ dlog('❌ recognition.start() THREW: '+e.message,'err'); if(sessionActive && gen===cycleGeneration) runRecognitionCycle(mode, gen); }
}


function processFieldValue(transcript, gen){
  dlog('🎤 slyšel: "'+transcript+'"');
  if(isStopCommand(transcript)){ dlog('stop příkaz'); stopVoiceSession(); return; }

  // Akční příkazy (přidat suk, nová deska) — bez hodnoty, jen potvrzení
  var actionCmd = findActionCommand(transcript);
  if(actionCmd){
    dlog('✓ akce rozpoznána: '+actionCmd.label,'ok');
    pendingField = '__action__';
    pendingValue = actionCmd.action;
    pendingKind = 'action';
    updateVoiceUI('speaking', '🔊 '+actionCmd.label+'…');
    speak(actionCmd.label, function(){
      runRecognitionCycle('confirm', gen);
    });
    return;
  }

  var parsed = parseCommand(transcript);
  dlog('→ pole='+parsed.field+' hodnotaText="'+parsed.valueText+'"');
  if(!parsed.field){
    dlog('❌ pole nerozpoznáno', 'err');
    beepErr();
    showVoiceToast('Nerozpoznáno: "'+transcript+'"');
    if(sessionActive) runRecognitionCycle('listen', gen);
    return;
  }

  var field = parsed.field;
  var kind, value;

  if(field === '__screw__'){
    kind = 'bool';
    value = parseBoolFromText(parsed.valueText);
    if(value === null){ dlog('❌ vrut ano/ne nenalezeno','err'); beepErr(); showVoiceToast('Vrut: ano nebo ne'); if(sessionActive) runRecognitionCycle('listen', gen); return; }
  } else if(field === 'p-vg'){
    kind = 'vg';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || value<1 || value>4){ dlog('❌ vizuál mimo 1-4','err'); beepErr(); showVoiceToast('Vizuál: 1 až 4'); if(sessionActive) runRecognitionCycle('listen', gen); return; }
    value = Math.round(value);
  } else {
    kind = 'number';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || isNaN(value)){ dlog('❌ hodnota nerozpoznána z "'+parsed.valueText+'"','err'); beepErr(); showVoiceToast('Nerozpoznána hodnota'); if(sessionActive) runRecognitionCycle('listen', gen); return; }
  }

  dlog('✓ připraveno: '+field+' = '+value+' (čekám potvrzení)','ok');
  pendingField = field;
  pendingValue = value;
  pendingKind = kind;

  // Přečti zpět "pole hodnota" — uživatel musí slyšet co appka rozpoznala
  // Teprve PO dokončení řeči spusť poslech na ano/ne
  var label = (FIELD_LABELS_PLOCHA[field] || FIELD_LABELS[field] || field);
  var spokenValue = kind==='bool' ? (value?'ano':'ne') : value;
  dlog('🔊 říkám: "'+label+' '+spokenValue+'"');
  updateVoiceUI('speaking', '🔊 '+label+' '+spokenValue+'…');
  speak(label + ' ' + spokenValue, function(){
    dlog('🔊 řeč dokončena, spouštím poslech na ano/ne');
    runRecognitionCycle('confirm', gen);
  });
}

function processConfirmation(transcript, gen){
  dlog('🎤 potvrzení: "'+transcript+'"');
  var text = transcript.toLowerCase();
  var positive = /\bano\b/.test(text) || /\bjo\b/.test(text) || text.indexOf('jasn')>=0 || text.indexOf('okej')>=0 || text.indexOf('ok')>=0;
  var negative = !positive && /\bne\b/.test(text);

  if(positive){
    dlog('→ ANO, zapisuji','ok');
    applyVoiceValue(gen);
  } else if(negative){
    dlog('→ NE, zrušeno');
    beepErr();
    showVoiceToast('Zrušeno');
    pendingField=null; pendingValue=null; pendingKind=null;
    if(sessionActive) runRecognitionCycle('listen', gen);
  } else {
    dlog('→ nerozpoznáno ano/ne, čekám znovu');
    if(sessionActive) runRecognitionCycle('confirm', gen);
  }
}

function applyVoiceValue(gen){
  dlog('💾 ZAPISUJI: '+pendingField+' = '+pendingValue,'ok');
  if(pendingField === '__action__'){
    dlog('▶ provádím akci: '+pendingValue,'ok');
    executeAction(pendingValue);
  } else if(pendingField === '__screw__'){
    var cb = document.getElementById('cb-screw');
    if(cb){
      var want = !!pendingValue;
      var has = cb.classList.contains('checked');
      if(want !== has) cb.click();
    } else {
      dlog('❌ element cb-screw nenalezen v DOM','err');
    }
  } else {
    var el = document.getElementById(pendingField);
    if(el){
      el.value = pendingValue;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      dlog('✅ input#'+pendingField+'.value nyní = "'+el.value+'"','ok');
      if(pendingField === 'p-vg'){
        var vgBtn = document.querySelector('[data-act="setvg"][data-vg="'+pendingValue+'"]');
        if(vgBtn) vgBtn.click();
      }
    } else {
      dlog('❌ element #'+pendingField+' NEEXISTUJE v DOM','err');
      beepErr();
      showVoiceToast('Chyba: pole '+pendingField+' neexistuje');
      pendingField=null; pendingValue=null; pendingKind=null;
      if(sessionActive) runRecognitionCycle('listen', gen);
      return;
    }
  }

  if(pendingKind === 'action'){
    var actionLabels = {addknot:'Přidat suk', newboard:'Nová deska'};
    showVoiceToast((actionLabels[pendingValue]||pendingValue)+' ✓ provedeno');
  } else {
    var label = (FIELD_LABELS_PLOCHA[pendingField] || FIELD_LABELS[pendingField] || pendingField);
    var shown = pendingKind==='bool' ? (pendingValue?'ano':'ne') : pendingValue;
    showVoiceToast(label+' = '+shown+' ✓');
  }

  pendingField=null; pendingValue=null; pendingKind=null;
  // Okamžitě poslouchej další pole, pípnutí pošli až poté
  if(sessionActive) runRecognitionCycle('listen', gen);
  setTimeout(beepOk, 30);
}

// ── UI feedback ───────────────────────────────────────────
function updateVoiceUI(state, msg){
  var btn = document.getElementById('btn-voice');
  var indicator = document.getElementById('voice-status');
  if(btn){
    // Zelené blikání = appka AKTIVNĚ poslouchá, je čas mluvit
    btn.classList.toggle('voice-listening', state==='listening'||state==='confirming');
    // Červené pulzování = příprava/mluvení appky (uživatel by neměl mluvit)
    btn.classList.toggle('voice-active', state==='requesting'||state==='speaking');
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
  setTimeout(function(){t.classList.remove('show');},1600);
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

  // Dlouhé podržení (800ms) na mikrofonu = zobrazit/skrýt debug panel
  var pressTimer = null;
  document.addEventListener('touchstart', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    pressTimer = setTimeout(function(){
      var panel = document.getElementById('voice-debug');
      if(panel) panel.classList.toggle('show');
      pressTimer = null;
    }, 800);
  });
  document.addEventListener('touchend', function(){
    if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; }
  });
  document.addEventListener('mousedown', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    pressTimer = setTimeout(function(){
      var panel = document.getElementById('voice-debug');
      if(panel) panel.classList.toggle('show');
      pressTimer = null;
    }, 800);
  });
  document.addEventListener('mouseup', function(){
    if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; }
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
