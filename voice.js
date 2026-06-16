// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 (čeština)
//  Uživatel řekne pole + hodnotu → app zopakuje "OK?" → ano/ne
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var synth = window.speechSynthesis;
var voiceState = 'idle'; // idle | requesting | listening | confirming
var pendingField = null;
var pendingValue = null;
var czechVoice = null;
var micPermissionGranted = false;

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

function checkVoiceSupport(){
  var SR = getSR();
  if(!SR){
    var isStandalone = window.navigator.standalone === true;
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if(isIOS && isStandalone){
      return {ok:false, reason:'iOS nepodporuje rozpoznávání řeči v PWA přidané na plochu. Otevři aplikaci v Safari (ne z plochy) a hlasové zadávání tam bude fungovat.'};
    }
    if(isIOS){
      return {ok:false, reason:'Tento prohlížeč nepodporuje rozpoznávání řeči. Zkus to v Safari.'};
    }
    return {ok:false, reason:'Rozpoznávání řeči není v tomto prohlížeči podporováno. Zkus Chrome.'};
  }
  return {ok:true};
}

// ── Inicializace TTS ────────────────────────────────────────
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
    u.rate = 1.0;
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

// ── Žádost o mikrofon (explicitní, nutné pro iOS/Android) ───
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

// ── Hlavní workflow ───────────────────────────────────────
function startVoiceInput(){
  if(voiceState !== 'idle') return;

  var support = checkVoiceSupport();
  if(!support.ok){
    showVoiceToast(support.reason);
    speak(support.reason.indexOf('Safari')>=0 ? 'Otevři aplikaci v Safari.' : 'Rozpoznávání řeči není podporováno.');
    return;
  }

  voiceState = 'requesting';
  updateVoiceUI('requesting', 'Žádám o přístup k mikrofonu…');

  requestMicPermission(function(granted, errMsg){
    if(!granted){
      voiceState='idle'; updateVoiceUI('idle','');
      showVoiceToast(errMsg || 'Mikrofon nedostupný');
      return;
    }
    runRecognition();
  });
}

function runRecognition(){
  var SR = getSR();
  recognition = new SR();
  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  voiceState = 'listening';
  updateVoiceUI('listening', '🎤 Poslouchám… řekni pole a hodnotu');

  var gotResult = false;

  recognition.onresult = function(event){
    gotResult = true;
    var transcript = event.results[0][0].transcript;
    handleVoiceCommand(transcript);
  };
  recognition.onerror = function(event){
    voiceState='idle'; updateVoiceUI('idle','');
    var msg = 'Chyba rozpoznávání';
    if(event.error==='not-allowed') msg='Mikrofon zablokován — povol v nastavení prohlížeče';
    else if(event.error==='no-speech') msg='Nic jsem neslyšela, zkus znovu';
    else if(event.error==='network') msg='Chyba sítě — rozpoznávání potřebuje internet';
    else if(event.error==='aborted'){ return; }
    else msg='Chyba: '+event.error;
    showVoiceToast(msg);
  };
  recognition.onend = function(){
    if(voiceState==='listening' && !gotResult){
      voiceState='idle'; updateVoiceUI('idle','');
    }
  };

  try{
    recognition.start();
  } catch(e){
    voiceState='idle'; updateVoiceUI('idle','');
    showVoiceToast('Nelze spustit mikrofon: '+e.message);
  }
}

function stopVoiceInput(){
  if(recognition){ try{ recognition.abort(); }catch(e){} }
  voiceState='idle'; updateVoiceUI('idle','');
}

function handleVoiceCommand(transcript){
  var field = parseFieldFromText(transcript);
  var value = parseSpokenNumber(transcript);

  if(!field){
    voiceState='idle'; updateVoiceUI('idle','');
    speak('Nerozpoznala jsem políčko.');
    showVoiceToast('Nerozpoznáno pole: "'+transcript+'"');
    return;
  }
  if(value===null || isNaN(value)){
    voiceState='idle'; updateVoiceUI('idle','');
    speak('Nerozpoznala jsem hodnotu.');
    showVoiceToast('Nerozpoznána hodnota: "'+transcript+'"');
    return;
  }

  pendingField = field;
  pendingValue = value;
  voiceState = 'confirming';
  var label = FIELD_LABELS[field] || field;
  updateVoiceUI('confirming', label+' = '+value+' — OK?');

  speak(label + ' ' + value + '. OK?', function(){
    listenForConfirmation();
  });
}

function listenForConfirmation(){
  var SR = getSR();
  if(!SR){ voiceState='idle'; updateVoiceUI('idle',''); return; }
  var confirmRec = new SR();
  confirmRec.lang = 'cs-CZ';
  confirmRec.continuous = false;
  confirmRec.interimResults = false;

  confirmRec.onresult = function(event){
    var text = event.results[0][0].transcript.toLowerCase();
    if(text.indexOf('ano')>=0 || text.indexOf('jo')>=0 || text.indexOf('ok')>=0 || text.indexOf('okej')>=0){
      applyVoiceValue();
    } else if(text.indexOf('ne')>=0){
      speak('OK, zkus znovu.', function(){
        voiceState='idle'; updateVoiceUI('idle','');
        showVoiceToast('Zrušeno — zkus znovu');
      });
    } else {
      speak('Nerozuměla jsem.', function(){
        voiceState='idle'; updateVoiceUI('idle','');
      });
    }
  };
  confirmRec.onerror = function(){ voiceState='idle'; updateVoiceUI('idle',''); };
  try{ confirmRec.start(); }catch(e){ voiceState='idle'; updateVoiceUI('idle',''); }
}

function applyVoiceValue(){
  var el = document.getElementById(pendingField);
  if(el){
    el.value = pendingValue;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  var label = FIELD_LABELS[pendingField] || pendingField;
  speak('Uloženo.', function(){
    voiceState='idle'; updateVoiceUI('idle','');
  });
  showVoiceToast(label+' = '+pendingValue+' ✓ zapsáno');
  pendingField=null; pendingValue=null;
}

// ── UI feedback ───────────────────────────────────────────
function updateVoiceUI(state, msg){
  var btn = document.getElementById('btn-voice');
  var indicator = document.getElementById('voice-status');
  if(btn){
    btn.classList.toggle('voice-active', state==='listening'||state==='confirming'||state==='requesting');
  }
  if(indicator){
    if(state==='idle'){ indicator.style.display='none'; }
    else { indicator.style.display=''; indicator.textContent=msg; }
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
}

// ── Init ─────────────────────────────────────────────────
function initVoice(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    if(voiceState==='idle') startVoiceInput();
    else stopVoiceInput();
  });
  updateVoiceFabVisibility();
  setInterval(updateVoiceFabVisibility, 400);

  // Diagnostika při startu — zobraz info pokud nepodporováno
  var support = checkVoiceSupport();
  if(!support.ok){
    console.warn('[Voice] '+support.reason);
  }
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', initVoice);
} else {
  initVoice();
}

})();
