// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština)
//  Kontinuální režim: nahrávání běží dál po celou dobu zadávání
//  Pole + hodnota → "okej?" → ano/ne → pokračuje dál
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var sessionActive = false;       // true = celá session hlasového zadávání běží
var voicePhase = 'idle';         // idle | listening | confirming | speaking
var pendingField = null;
var pendingValue = null;
var czechVoice = null;
var micPermissionGranted = false;
var restartTimer = null;

// ── Mapování hlasových příkazů na pole formuláře ──────────
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
  'název':'cid','jméno':'cid','identifikace':'cid'
};

var FIELD_LABELS = {
  'clen':'šířka','cwid':'výška','p-length':'délka','p-mass':'hmotnost','p-moist':'vlhkost',
  'as1':'AS1','as2':'AS2','al1':'AL1','al2':'AL2',
  'bs1':'BS1','bs2':'BS2','bl1':'BL1','bl2':'BL2',
  'cs1':'CS1','cs2':'CS2','cl1':'CL1','cl2':'CL2',
  'ds1':'DS1','ds2':'DS2','dl1':'DL1','dl2':'DL2',
  'cid':'název'
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
      return {ok:false, reason:'iOS blokuje rozpoznávání řeči v aplikacích přidaných na plochu. Otevři tuto stránku v Safari (ne přes ikonu na ploše) a hlasové zadávání tam bude fungovat.', critical:true};
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
    u.onend = function(){ if(onEnd) onEnd(); };
    u.onerror = function(){ if(onEnd) onEnd(); };
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
  var bestMatch=null, bestLen=0;
  Object.keys(FIELD_MAP).forEach(function(key){
    if(text.indexOf(key)>=0 && key.length>bestLen){ bestMatch=FIELD_MAP[key]; bestLen=key.length; }
  });
  return bestMatch;
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

// ── Spuštění / zastavení celé session ─────────────────────
function toggleVoiceSession(){
  if(sessionActive){
    stopVoiceSession();
  } else {
    startVoiceSession();
  }
}

function startVoiceSession(){
  var support = checkVoiceSupport();
  if(!support.ok){
    showVoiceToast(support.reason);
    if(support.critical){
      // Zobraz trvalejší upozornění v indikátoru
      updateVoiceUI('error', support.reason);
      setTimeout(function(){ updateVoiceUI('idle',''); }, 6000);
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
      listenLoop();
    });
  });
}

function stopVoiceSession(){
  sessionActive = false;
  if(recognition){ try{ recognition.abort(); }catch(e){} }
  if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
  voicePhase = 'idle';
  updateVoiceUI('idle','');
  speak('Hlasové zadávání ukončeno.');
}

// ── Kontinuální smyčka poslechu ────────────────────────────
function listenLoop(){
  if(!sessionActive) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  recognition = new SR();
  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  voicePhase = 'listening';
  updateVoiceUI('listening', '🎤 Poslouchám…');

  var gotResult = false;

  recognition.onresult = function(event){
    gotResult = true;
    var transcript = event.results[0][0].transcript;
    handleVoiceCommand(transcript);
  };
  recognition.onerror = function(event){
    if(event.error === 'no-speech' || event.error === 'aborted'){
      // Tichý restart smyčky
      if(sessionActive) restartTimer = setTimeout(listenLoop, 400);
      return;
    }
    if(event.error === 'not-allowed'){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast('Mikrofon zablokován — povol v nastavení prohlížeče');
      return;
    }
    // Jiná chyba — zkus restart po chvíli
    if(sessionActive) restartTimer = setTimeout(listenLoop, 800);
  };
  recognition.onend = function(){
    if(voicePhase==='listening' && !gotResult && sessionActive){
      // Žádný výsledek — restart smyčky (uživatel mlčel)
      restartTimer = setTimeout(listenLoop, 300);
    }
  };

  try{
    recognition.start();
  } catch(e){
    if(sessionActive) restartTimer = setTimeout(listenLoop, 800);
  }
}

function handleVoiceCommand(transcript){
  if(isStopCommand(transcript)){
    stopVoiceSession();
    return;
  }

  var field = parseFieldFromText(transcript);
  var value = parseSpokenNumber(transcript);

  if(!field || value===null || isNaN(value)){
    // Nerozpoznáno — krátké upozornění, ale smyčka pokračuje
    showVoiceToast('Nerozpoznáno: "'+transcript+'" — zkus znovu');
    speak('Nerozuměla jsem.', function(){
      if(sessionActive) listenLoop();
    });
    return;
  }

  pendingField = field;
  pendingValue = value;
  voicePhase = 'confirming';
  var label = FIELD_LABELS[field] || field;
  updateVoiceUI('confirming', label+' = '+value+' — okej?');

  speak(label + ' ' + value + '. Okej?', function(){
    listenForConfirmation();
  });
}

function listenForConfirmation(){
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }
  var confirmRec = new SR();
  confirmRec.lang = 'cs-CZ';
  confirmRec.continuous = false;
  confirmRec.interimResults = false;

  voicePhase = 'confirming';
  updateVoiceUI('confirming', (FIELD_LABELS[pendingField]||pendingField)+' = '+pendingValue+' — řekni ano/ne');

  confirmRec.onresult = function(event){
    var text = event.results[0][0].transcript.toLowerCase();
    if(text.indexOf('ano')>=0 || text.indexOf('jo')>=0 || text.indexOf('jasn')>=0 || text.indexOf('okej')>=0 || text.indexOf('ok')>=0){
      applyVoiceValue();
    } else if(text.indexOf('ne')>=0){
      speak('Dobře, zkus znovu.', function(){
        if(sessionActive) listenLoop();
      });
      showVoiceToast('Zrušeno — řekni hodnotu znovu');
    } else {
      // Nerozuměla potvrzení — zkus se zeptat znovu
      speak('Řekni ano nebo ne.', function(){
        if(sessionActive) listenForConfirmation();
      });
    }
  };
  confirmRec.onerror = function(event){
    if(event.error==='no-speech' && sessionActive){
      restartTimer = setTimeout(listenForConfirmation, 300);
      return;
    }
    if(sessionActive) restartTimer = setTimeout(listenLoop, 600);
  };
  try{ confirmRec.start(); }catch(e){
    if(sessionActive) restartTimer = setTimeout(listenLoop, 600);
  }
}

function applyVoiceValue(){
  var el = document.getElementById(pendingField);
  if(el){
    el.value = pendingValue;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  var label = FIELD_LABELS[pendingField] || pendingField;
  showVoiceToast(label+' = '+pendingValue+' ✓ zapsáno');
  speak('Zapsáno. Další?', function(){
    pendingField=null; pendingValue=null;
    if(sessionActive) listenLoop();
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
  // Pokud opustíme entry screen během session, zastav ji
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
