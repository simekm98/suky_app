// ═══════════════════════════════════════════════════════════
//  HLASOVÉ ZADÁVÁNÍ — WoodGrader 26 — REAL-TIME VERZE
//  Formát: "plocha A rozměr 1 = 20" nebo "A1 20"
//  Vizuální potvrzení (2s) — bez TTS, bez druhého hlasového kola
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

var recognition = null;
var sessionActive = false;
var voicePhase = 'idle';
var lastField = null;   // pro možnost vrácení "zpět"
var lastValue = null;
var lastKind = null;
var lastElement = null;
var lastPrevValue = null; // hodnota PŘED zápisem, pro vrácení
var micPermissionGranted = false;
var restartTimer = null;
var watchdogTimer = null;
var cycleGeneration = 0;
var successfulCyclesCount = 0; // periodický refresh session po N úspěších proti degradaci
var audioCtxBeep = null;
var confirmOverlayTimer = null;

// ── Viditelný debug panel (funguje i na telefonu bez připojení k PC) ──
var debugPanelEnabled = false; // řídí VIDITELNOST, logování běží vždy na pozadí

function dlog(msg, cls){
  console.log('[Voice]', msg);
  var panel = document.getElementById('voice-debug');
  if(!panel) return;
  // Logujeme vždy (pro historii), ale 'show' class řídíme výhradně přes debugPanelEnabled
  panel.classList.toggle('show', debugPanelEnabled);
  var line = document.createElement('div');
  if(cls) line.className = cls;
  line.textContent = new Date().toLocaleTimeString('cs-CZ').slice(0,8) + '  ' + msg;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  // Omez na posledních 40 řádků
  while(panel.children.length > 40) panel.removeChild(panel.firstChild);
}

// ── Mapování "plocha X rozměr Y" ──────────────────────────
// Čeština hláskuje písmena různě: "á"/"áá" pro A, "bé" pro B, "cé"/"cé" pro C, "dé" pro D
// STT může vrátit i zdvojené/protažené varianty
var PLOCHA_MAP = {
  'a':'a','á':'a','áá':'a','aa':'a','ah':'a','ahá':'a',
  'b':'b','bé':'b','béé':'b','be':'b',
  'c':'c','cé':'c','céé':'c','ce':'c','cé.':'c',
  'd':'d','dé':'d','déé':'d','de':'d'
};
// Rozměr 1=S1, 2=S2, 3=L1, 4=L2 — odpovídá novému zobrazení A1/A2/A3/A4 v UI
var ROZMER_MAP = {
  '1':'s1','jedna':'s1','jeden':'s1','první':'s1',
  '2':'s2','dva':'s2','dvě':'s2','druhý':'s2',
  '3':'l1','tři':'l1','třetí':'l1',
  '4':'l2','čtyři':'l2','čtvrtý':'l2'
};

// ── Slovní mapování ostatních polí ───────────────────────
var WORD_FIELD_MAP = {
  'šířka b':'clen','šířka':'clen','šíře':'clen','sirka':'clen','širka':'clen',
  'výška d':'cwid','výška':'cwid','výšku':'cwid','vyska':'cwid','výsku':'cwid',
  'délka':'p-length','délku':'p-length','delka':'p-length','delku':'p-length',
  'hmotnost':'p-mass','hmotnosti':'p-mass','hmotnost je':'p-mass',
  'vlhkost w':'p-moist','vlhkost':'p-moist','vlhkosti':'p-moist','vlhko':'p-moist','vlhkostí':'p-moist',
  'název':'cid','nazev':'cid','id':'cid','ajdý':'cid','aj dý':'cid','ajdí':'cid','idy':'cid',
  'vizuál':'p-vg','vizual':'p-vg','vizuální':'p-vg','vizualni':'p-vg','vizuálně':'p-vg',
  'vrut':'__screw__','vruty':'__screw__','vrutu':'__screw__','vrutem':'__screw__',
  'trhlina':'p-trhlina','trhliny':'p-trhlina','trhlinu':'p-trhlina',
  'hniloba':'p-hniloba','hnilobu':'p-hniloba','zbarvení':'p-hniloba','zbarveni':'p-hniloba',
  'reakční dřevo':'p-reakcni','reakcni drevo':'p-reakcni','tlakové dřevo':'p-reakcni','tlakove drevo':'p-reakcni',
  'oblina':'p-oblina','oblinu':'p-oblina'
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

  // Nejdřív ošetři SLITÉ varianty písmeno+číslovka bez mezery (STT to často spojí):
  // "ádva"→"á dva", "déčtyři"→"dé čtyři", "ajedna"→"a jedna" apod.
  // Zkusíme všechny kombinace plocha-klíčů + číslovek a vložíme mezeru.
  var plochaKeys = Object.keys(PLOCHA_MAP).sort(function(a,b){return b.length-a.length;});
  var numWords = ['jedna','jeden','dva','dvě','tři','čtyři'];
  plochaKeys.forEach(function(pk){
    numWords.forEach(function(nw){
      var glued = pk + nw;
      // \b nefunguje spolehlivě s diakritikou (á,é) v JS regexu — používáme
      // explicitní mezery jako hranice místo \b.
      var re = new RegExp('( |^)' + glued + '( |$)', 'g');
      t = t.replace(re, '$1' + pk + ' ' + nw + '$2');
    });
    // i slité s číslicí: "a1"→ponecháme (řeší se case B níže), ale "a 1" již má mezeru
  });

  t = t.replace(/ jedna /g, ' 1 ').replace(/ jeden /g,' 1 ').replace(/ dva /g, ' 2 ').replace(/ dvě /g, ' 2 ')
       .replace(/ tři /g, ' 3 ').replace(/ čtyři /g, ' 4 ');

  // Hledáme kód pole na ZAČÁTKU textu (první 1-3 tokeny), ne kdekoli ve zhuštěném stringu
  // — jinak by se "a1 30" zhustilo na "a130" a kolidovalo s hodnotou
  var words = t.trim().split(/\s+/);

  // Nový krátký formát "A1"-"D4" (bez S/L) — odpovídá UI labelům A1/A2/A3/A4
  // 1=S1, 2=S2, 3=L1, 4=L2. Použijeme PLOCHA_MAP lookup (tolerantní k "áá","bé","cé"
  // výslovnosti) místo striktního regexu [abcd] — STT často přepíše hláskovaná
  // písmena foneticky, a slovní číslovky (dva/čtyři) až výše ošetřeny rozdělením.
  var m4 = null;

  // Pomocná: vytáhne VEDOUCÍ číslici 1-4 ze slova, i když STT přepsal "2" jako
  // čas "2:30", desetinné "2,5" nebo s interpunkcí "2." — typický problém,
  // kdy uživatel zaváhá nebo udělá pauzu po číslu plochy.
  function leadingDigit1to4(w){
    var m = w.match(/^([1234])(?:[:.,]|$)/);
    return m ? m[1] : null;
  }

  // Případ A: písmeno a číslo jsou oddělená slova: "á", "2:30", "30" → words[0]="á", words[1]="2:30"
  if(words.length >= 2 && PLOCHA_MAP.hasOwnProperty(words[0])){
    var dig = leadingDigit1to4(words[1]);
    if(dig) m4 = [PLOCHA_MAP[words[0]], dig];
  }
  // Případ B: písmeno a číslo slita v jednom slově: "a1", "30" → words[0]="a1"
  // Případ B2: slita varianta s dvojtečkou (STT interpretoval jako čas): "a2:30"
  else if(words.length >= 1 && /^[abcd][1234]$/.test(words[0])){
    m4 = [words[0][0], words[0][1]];
  }
  else if(words.length >= 1 && /^[abcd][1234]:/.test(words[0])){
    m4 = [words[0][0], words[0][1]];
  }
  if(m4){
    var plocha = m4[0];
    var numMap = {'1':'s1','2':'s2','3':'l1','4':'l2'};
    return plocha + numMap[m4[1]];
  }

  // Starý formát "AS1"/"AL1" (s/l explicitně) — hledáme v prefixu, ne v celém textu
  var prefix = words.slice(0, 3).join('');
  var compactPrefix = prefix;
  var m = compactPrefix.match(/^([abcd])(s|l)(1|2)/);
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
  beep(180, 0.25, 0.4); // jedno delší pípnutí místo dvou — žádný zpožděný timer co kolidoval s mikrofonem
}

// ── Parsování čísla ──────────────────────────────────────────
var WORD_NUMS = {
  'nula':0,'jedna':1,'jeden':1,'dva':2,'dvě':2,'tři':3,'čtyři':4,'pět':5,
  'šest':6,'sedm':7,'osm':8,'devět':9,'deset':10,
  'jedenáct':11,'dvanáct':12,'třináct':13,'čtrnáct':14,'patnáct':15,
  'šestnáct':16,'sedmnáct':17,'osmnáct':18,'devatenáct':19,'dvacet':20,
  'třicet':30,'čtyřicet':40,'padesát':50,'šedesát':60,'sedmdesát':70,
  'osmdesát':80,'devadesát':90,'sto':100,'dvěstě':200,'třista':300,
  'čtyřista':400,'pětset':500,'šestset':600,'sedmset':700,'osmset':800,'devětset':900,
  'tisíc':1000,'tisíce':1000,'tisícù':1000
};

// Fonetické vyslovení písmen latinky (pro ID typu "20L" = "dvacet el")
var LETTER_PHONETIC = {
  'á':'A','a':'A','bé':'B','cé':'C','dé':'D','é':'E','ef':'F','gé':'G','há':'H',
  'í':'I','jé':'J','ká':'K','el':'L','em':'M','en':'N','ó':'O','pé':'P',
  'kvé':'Q','er':'R','es':'S','té':'T','ú':'U','vé':'V','iks':'X',
  'ypsilon':'Y','zet':'Z'
};

// Parsuje alfanumerický kód desky ("dvacet el" → "20L", "sedm pé" → "7P")
function parseAlphaNumericId(text){
  text = text.toLowerCase().trim();
  var words = text.split(/\s+/);
  var result = '';
  var numBuf = 0, hasNum = false;
  words.forEach(function(w){
    w = w.replace(/[.,]/g,'');
    if(WORD_NUMS.hasOwnProperty(w)){
      numBuf += WORD_NUMS[w]; hasNum = true;
    } else if(LETTER_PHONETIC.hasOwnProperty(w)){
      if(hasNum){ result += numBuf; numBuf=0; hasNum=false; }
      result += LETTER_PHONETIC[w];
    } else if(/^\d+$/.test(w)){
      if(hasNum){ result += numBuf; numBuf=0; hasNum=false; }
      result += w;
    } else if(/^[a-z]$/.test(w)){
      if(hasNum){ result += numBuf; numBuf=0; hasNum=false; }
      result += w.toUpperCase();
    } else {
      // Neznámé slovo — připoj jak je (zachová diakritiku pro plně textové názvy)
      if(hasNum){ result += numBuf; numBuf=0; hasNum=false; }
      result += w;
    }
  });
  if(hasNum) result += numBuf;
  return result || text.toUpperCase().replace(/\s+/g,'');
}

function parseSpokenNumber(text){
  text = text.toLowerCase().trim();

  // Nejdřív zkus přímou číslici s desetinnou čárkou/tečkou (10.5, 10,5)
  var digitMatch = text.match(/-?\d+[.,]\d+/);
  if(digitMatch) return parseFloat(digitMatch[0].replace(',', '.'));

  // "X a půl" — slovní polovina, např. "dvacet a půl" = 20.5
  var halfMatch = text.match(/(.+?)\s+a\s+půl\s*$/);
  if(halfMatch){
    var wholeH = parseIntegerWords(halfMatch[1]);
    if(wholeH !== null) return wholeH + 0.5;
  }

  // "X celá Y" / "X celých Y" — slovní desetinné číslo
  var celaMatch = text.match(/(.+?)\s+cel[áých]+\s+(.+)/);
  if(celaMatch){
    var wholePart = parseIntegerWords(celaMatch[1]);
    var fracPart = parseIntegerWords(celaMatch[2]);
    if(wholePart !== null && fracPart !== null){
      return wholePart + fracPart / Math.pow(10, String(fracPart).length);
    }
  }

  // "X a Y" — desetinné číslo bez slova "celá", např. "dvacet a čtyři" = 20.4
  // (jen pokud Y je jednociferné číslo 1-9, jinak by "dvacet a deset" = 30 dávalo nesmysl)
  var andMatch = text.match(/(.+?)\s+a\s+(.+)\s*$/);
  if(andMatch){
    var wholeA = parseIntegerWords(andMatch[1]);
    var fracA = parseIntegerWords(andMatch[2]);
    if(wholeA !== null && fracA !== null && fracA >= 0 && fracA <= 9){
      return wholeA + fracA / 10;
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
  var thousands = 0, hundreds = 0, tens = 0, ones = 0, hasAny = false;
  var pendingThousandMultiplier = 0; // číslo těsně před "tisíc" (např. "dva" v "dva tisíce")

  words.forEach(function(w){
    w = w.replace(/[.,]/g,'');
    if(!WORD_NUMS.hasOwnProperty(w)) return;
    hasAny = true;
    var val = WORD_NUMS[w];

    if(val === 1000){
      // "tisíc" samo o sobě = 1000; "dva tisíce" = předchozí číslo × 1000
      var mult = pendingThousandMultiplier > 0 ? pendingThousandMultiplier : 1;
      thousands += mult * 1000;
      pendingThousandMultiplier = 0;
      hundreds = 0; tens = 0; ones = 0; // reset nižších řádů, začínáme od stovek dál
    }
    else if(val >= 100){ hundreds += val; }
    else if(val >= 20 && val % 10 === 0){ tens = val; }
    else if(tens > 0 && val < 10){ ones += val; }
    else if(val < 10 && val > 0){
      // Může to být buď jednotka, NEBO multiplikátor před "tisíc" (zjistíme později)
      pendingThousandMultiplier = val;
      ones += val;
    }
    else { ones += val; }
  });

  if(!hasAny) return null;
  return thousands + hundreds + tens + ones;
}

// ── Rozdělení textu na pole + hodnotu ─────────────────────
var EQUALS_PATTERNS = ['rovná se','rovnáse','rovna se','='];

// ── Fuzzy matching — tolerantní k drobným odchylkám STT ──
function levenshtein(a, b){
  var m = a.length, n = b.length;
  var dp = [];
  for(var i=0;i<=m;i++) dp.push([i]);
  for(var j=0;j<=n;j++) dp[0][j]=j;
  for(var i=1;i<=m;i++){
    for(var j=1;j<=n;j++){
      if(a[i-1]===b[j-1]) dp[i][j]=dp[i-1][j-1];
      else dp[i][j]=1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Klíčová slova pro fuzzy fallback — jen základní tvary, ne všechny varianty
var FUZZY_BASE_WORDS = [
  {word:'šířka', field:'clen'}, {word:'sirka', field:'clen'},
  {word:'výška', field:'cwid'}, {word:'vyska', field:'cwid'},
  {word:'délka', field:'p-length'}, {word:'delka', field:'p-length'},
  {word:'hmotnost', field:'p-mass'},
  {word:'vlhkost', field:'p-moist'},
  {word:'vizuál', field:'p-vg'}, {word:'vizual', field:'p-vg'},
  {word:'vrut', field:'__screw__'}
];

function fuzzyFindField(text){
  var words = text.toLowerCase().trim().split(/\s+/);
  var bestField = null, bestDist = 3; // tolerance max 2 znaky odchylka
  words.forEach(function(w){
    if(w.length < 3) return; // krátká slova přeskoč (čísla, spojky)
    FUZZY_BASE_WORDS.forEach(function(fw){
      var dist = levenshtein(w, fw.word);
      var threshold = Math.max(1, Math.floor(fw.word.length * 0.3)); // tolerance ~30% délky slova
      if(dist <= threshold && dist < bestDist){
        bestDist = dist;
        bestField = fw.field;
      }
    });
  });
  return bestField;
}

function parseCommand(text){
  text = text.toLowerCase().trim();

  // 1. Zkus přímý kód "AS1", "as 1", "a s jedna" (nejrychlejší, krátký formát)
  var field = findDirectFieldCode(text);

  // 2. Zkus "plocha X rozměr Y" formát (delší, ale jednoznačný)
  if(!field) field = findPlochaRozmer(text);

  // 3. Pokud ne, zkus slovní pole (šířka, výška, vrut...) — přesná shoda
  if(!field){
    for(var i=0;i<WORD_FIELD_KEYS_SORTED.length;i++){
      var key = WORD_FIELD_KEYS_SORTED[i];
      if(text.indexOf(key) >= 0){ field = WORD_FIELD_MAP[key]; break; }
    }
  }

  // 4. Fuzzy fallback — STT mohlo slovo zkomolit (vizuál→vyzuál apod.)
  if(!field){
    field = fuzzyFindField(text);
  }

  if(!field) return {field:null, valueText:text};

  // 3. Najdi hodnotu — po oddělovači, nebo poslední číslo ve větě
  var valueText = text;
  var splitIdx = -1, splitLen = 0;
  EQUALS_PATTERNS.forEach(function(p){
    var idx = text.indexOf(p);
    if(idx >= 0 && (splitIdx===-1 || idx < splitIdx)){ splitIdx=idx; splitLen=p.length; }
  });

  // Pro ID pole (cid) potřebujeme CELÝ text za klíčovým slovem, ne jen čísla —
  // jinak by se "id 20 pé" zkrátilo na pouhé "20" a písmeno "pé" by se ztratilo.
  if(field === 'cid' && splitIdx < 0){
    var idKeyIdx = -1, idKeyLen = 0;
    WORD_FIELD_KEYS_SORTED.forEach(function(key){
      if(WORD_FIELD_MAP[key] !== 'cid') return;
      var idx2 = text.indexOf(key);
      if(idx2 >= 0 && (idKeyIdx===-1 || idx2 < idKeyIdx)){ idKeyIdx = idx2; idKeyLen = key.length; }
    });
    if(idKeyIdx >= 0){
      valueText = text.substring(idKeyIdx + idKeyLen).trim();
    }
  } else if(splitIdx >= 0){
    valueText = text.substring(splitIdx+splitLen).trim();
  } else {
    // Speciální případ: STT přepsal "A2 30" jako "a 2:30" (interpretoval jako čas),
    // nebo "a2 30" jako "a2:30" (slitě). Vytáhneme číslo PO dvojtečce.
    var timeLike = text.match(/[1234]:(\d+)/);
    if(timeLike){
      valueText = timeLike[1]; // číslo PO dvojtečce je skutečná hodnota
    } else {
      // KLÍČOVÉ: odstraň ze textu část, která byla použita jako KÓD POLE
      // (např. "a1" v "a1 nula" nebo "a1" v "a1 0") — jinak by se z "a1 nula"
      // omylem vzala číslice "1" patřící kódu pole, a slovní hodnota "nula"
      // (která neobsahuje žádnou číslici) by se úplně ztratila.
      var textForValue = text;
      var directCodeMatch = text.match(/^[abcd][1234](?::\d+)?\s*/);
      if(directCodeMatch){
        textForValue = text.substring(directCodeMatch[0].length).trim();
      } else {
        // Formát "á 1 30" nebo "plocha a rozměr 1 30" — odstraň jen vedoucí
        // písmeno+číslo jako samostatná slova, ne celý zbytek věty.
        var words0 = text.split(/\s+/);
        if(words0.length>=2 && PLOCHA_MAP.hasOwnProperty(words0[0]) && /^[1234]/.test(words0[1])){
          textForValue = words0.slice(2).join(' ');
        }
      }
      var allNums = textForValue.match(/-?\d+[.,]?\d*/g);
      if(allNums && allNums.length){
        valueText = allNums[allNums.length-1];
      } else if(textForValue.trim()){
        // Žádná číslice nezbyla — hodnota je čistě slovní (např. "nula", "pět").
        // Předáme celý zbytek textu dál; parseSpokenNumber zkusí slovní číslovku.
        valueText = textForValue.trim();
      } else {
        valueText = text;
      }
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
  return text.indexOf('konec')>=0 || text.indexOf('hotovo')>=0 || text.indexOf('stop')>=0
      || text.indexOf('ukončit')>=0 || text.indexOf('ukoncit')>=0
      || text.indexOf('znovu')>=0 || text.indexOf('opakovat')>=0 || text.indexOf('opakuj')>=0;
}

// ── Akční příkazy bez hodnoty (přidat suk, nová deska) ────
function findActionCommand(text){
  text = text.toLowerCase();
  if(text.indexOf('přidat suk')>=0 || text.indexOf('přidej suk')>=0) return {action:'addknot', label:'Přidat suk'};
  if(text.indexOf('nová deska')>=0 || text.indexOf('novou desku')>=0 || text.indexOf('nova deska')>=0) return {action:'newboard', label:'Nová deska'};
  return null;
}

// ── "upravit suk N" / "uprav suk N" — vrátí 1-indexované číslo suku ──
function findEditKnotCommand(text){
  var t = text.toLowerCase();
  if(t.indexOf('upravit suk')<0 && t.indexOf('uprav suk')<0 && t.indexOf('upravit suka')<0) return null;
  var afterIdx = t.indexOf('suk');
  var rest = t.substring(afterIdx+3).trim();
  var num = parseSpokenNumber(rest);
  if(num!==null && !isNaN(num) && num>=1) return Math.round(num);
  return null;
}

// ── "vyhledat X" / "najdi X" / "otevři desku X" — vyhledá desku podle ID ──
function findSearchBoardCommand(text){
  var t = text.toLowerCase();
  var patterns = ['vyhledat','vyhledej','najdi desku','najít desku','otevři desku','otevřit desku'];
  for(var i=0;i<patterns.length;i++){
    var idx = t.indexOf(patterns[i]);
    if(idx >= 0){
      var rest = text.substring(idx+patterns[i].length).trim();
      // ID může být alfanumerické (jako "20L") — použij stejný parser jako pro ID pole
      var parsed = parseAlphaNumericId(rest);
      if(parsed) return parsed;
    }
  }
  return null;
}

// ── "nová složka NÁZEV" / "vytvoř složku NÁZEV" — extrahuje název za klíčovým slovem ──
function findCreateFolderCommand(text){
  var t = text.toLowerCase();
  var patterns = ['nová složka','novou složku','vytvoř složku','vytvořit složku','založ složku'];
  for(var i=0;i<patterns.length;i++){
    var idx = t.indexOf(patterns[i]);
    if(idx >= 0){
      var name = text.substring(idx + patterns[i].length).trim();
      // Odstraň případné spojky na začátku ("s názvem", "jménem")
      name = name.replace(/^(s názvem|s jménem|název|jméno)\s+/i, '').trim();
      if(name) return name;
    }
  }
  return null;
}

// ── "vyber složku X" / "změna složky X" / "změň složku X" — aktivuje
// existující složku. Bez jména pouze otevře výběr (modal).
function findSelectFolderCommand(text){
  var t = text.toLowerCase();
  var patterns = ['vyber složku','vyber slozku','výběr složky','vyber folder','změna složky','zmena slozky','změň složku','zmen slozku'];
  for(var i=0;i<patterns.length;i++){
    var idx = t.indexOf(patterns[i]);
    if(idx >= 0){
      var name = text.substring(idx + patterns[i].length).trim();
      name = name.replace(/^(na|s názvem|s jménem|název|jméno)\s+/i, '').trim();
      return {name: name || null};
    }
  }
  return null;
}

// ── Druh dřeva hlasem: "smrk", "buk", "borovice", "modřín" (i kódy SM/BK/BO/MD) ──
var WOOD_VOICE_MAP = {
  'smrk':'SM','sm':'SM',
  'buk':'BK','bk':'BK',
  'borovice':'BO','borovici':'BO','bo':'BO',
  'modřín':'MD','modrin':'MD','md':'MD'
};
function findWoodSpeciesCommand(text){
  var t = text.toLowerCase();
  if(t.indexOf('dřevo')<0 && t.indexOf('drevo')<0 && t.indexOf('druh dřeva')<0) return null;
  for(var key in WOOD_VOICE_MAP){
    if(t.indexOf(key)>=0) return WOOD_VOICE_MAP[key];
  }
  return null;
}

// ── Druh produktu hlasem: "trám"/"hranol", "lať", "řezivo na plochu/na hranu" ──
function findProductTypeCommand(text){
  var t = text.toLowerCase();
  if(t.indexOf('produkt')<0 && t.indexOf('hranol')<0 && t.indexOf('trám')<0 && t.indexOf('tram')<0
     && t.indexOf('lať')<0 && t.indexOf('lat')<0 && t.indexOf('řezivo')<0 && t.indexOf('rezivo')<0) return null;
  if(t.indexOf('na plochu')>=0) return 'rezivo-plocha';
  if(t.indexOf('na hranu')>=0) return 'rezivo-hrana';
  if(t.indexOf('hranol')>=0 || t.indexOf('trám')>=0 || t.indexOf('tram')>=0) return 'tram';
  if(t.indexOf('lať')>=0 || t.indexOf('lat')>=0) return 'lat';
  if(t.indexOf('automatick')>=0) return 'auto';
  return null;
}

// ── "FFT podél" / "FFT ohyb" (i foneticky "efefté") — spustí test ────
function findFftCommand(text){
  var t = text.toLowerCase();
  // Fonetické varianty pro "FFT": efefté, ef ef té, eféfté, samotné "ft" (často přeslechne první f)
  // Plus alternativní názvy: akustické testy, měření frekvencí, frekvence, akustika
  var isFft = t.indexOf('fft') >= 0 || t.indexOf('efefté') >= 0 || t.indexOf('ef ef té') >= 0
            || t.indexOf('eféfté') >= 0 || t.indexOf('ef ef te') >= 0 || t.indexOf('efefte') >= 0
            || /\bft\b/.test(t)
            || t.indexOf('akustick') >= 0 || t.indexOf('akustika') >= 0
            || t.indexOf('měření frekven') >= 0 || t.indexOf('mereni frekven') >= 0
            || t.indexOf('frekvence') >= 0 || t.indexOf('frekvenci') >= 0;
  if(!isFft) return null;

  var isBending = t.indexOf('ohyb') >= 0;
  var isLong = t.indexOf('podél') >= 0 || t.indexOf('podel') >= 0;
  var isCombo = t.indexOf('kombinac') >= 0 || t.indexOf('kombinovan') >= 0 || (isBending && isLong);

  if(isCombo) return {type:'combo', label:'FFT kombinace'};
  if(isBending) return {type:'bending', label:'FFT ohyb'};
  if(isLong) return {type:'longitudinal', label:'FFT podél'};
  // Typ nezazněl — vrátíme akci bez typu, appka jen otevře obrazovku a počká na volbu
  return {type:null, label:'FFT'};
}

function executeFftCommand(type){
  if(type===null){
    // Jen otevři obrazovku a nech appku poslouchat volbu typu (podélné/ohybové/kombinace)
    if(window.wgFFTOpenTypeSelect) window.wgFFTOpenTypeSelect();
    return;
  }
  if(window.wgFFTOpen) window.wgFFTOpen();
  if(type==='combo'){
    if(window.wgFFTSetCombo) window.wgFFTSetCombo(true);
    setTimeout(function(){
      if(window.wgFFTStartRecording) window.wgFFTStartRecording();
    }, 300);
    return;
  }
  if(window.wgFFTSetCombo) window.wgFFTSetCombo(false);
  if(window.setFftType) window.setFftType(type);
  // Krátké zpoždění aby se FFT screen stihl vykreslit před spuštěním nahrávání
  setTimeout(function(){
    if(window.wgFFTStartRecording) window.wgFFTStartRecording();
  }, 300);
}

// ── Volba typu kmitání hlasem, KDYŽ appka čeká na obrazovce FFT ──
// (po příkazu "FFT" bez typu — uživatel řekne "podélné", "ohybové" nebo "kombinace")
var awaitingFftTypeChoice = false;
var awaitingFolderName = false;
var awaitingFreqConfirm = false; // appka nabídla detekovanou frekvenci 1. módu k potvrzení

function findFftTypeChoice(text){
  var t = text.toLowerCase();
  var isBending = t.indexOf('ohyb') >= 0;
  var isLong = t.indexOf('podél') >= 0 || t.indexOf('podel') >= 0;
  if(t.indexOf('kombinac') >= 0 || t.indexOf('kombinovan') >= 0 || (isBending && isLong)) return 'combo';
  if(isLong) return 'longitudinal';
  if(isBending) return 'bending';
  return null;
}

function executeAction(action){
  try{
    if(action === 'addknot'){
      if(window.wgAddKnot) window.wgAddKnot();
      else { var btn = document.getElementById('btn-add'); if(btn) btn.click(); }
    } else if(action === 'newboard'){
      if(window.wgNewBoard) window.wgNewBoard(); // přeskočí blokující confirm() dialog
      else { var btn2 = document.getElementById('btn-new'); if(btn2) btn2.click(); }
    }
  } catch(err){
    dlog('💥 executeAction('+action+') selhal: '+err.message,'err');
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
  successfulCyclesCount = 0;
  updateVoiceUI('requesting','Připravuji mikrofon…');

  requestMicPermission(function(granted, errMsg){
    if(!granted){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast(errMsg || 'Mikrofon nedostupný');
      return;
    }
    beepOk();
    startSessionHeartbeat(cycleGeneration);
    runRecognitionCycle(cycleGeneration);
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
function runRecognitionCycle(gen){
  if(!sessionActive || gen !== cycleGeneration) return;
  var SR = getSR();
  if(!SR){ stopVoiceSession(); return; }

  clearAllTimers();
  if(recognition){
    // Odstraň handlery, ale NEvolej abort() na objekt který už dokončil
    // svou práci (měl onresult) — agresivní abort na "umírající" instanci
    // na mobilních platformách postupně degraduje nativní audio subsystém.
    try{
      recognition.onend=null; recognition.onerror=null; recognition.onresult=null;
      if(recognition._wgActive) recognition.abort();
    }catch(e){}
    recognition = null;
  }

  // Delší pauza mezi cykly — uvolní audio session prohlížeče dřív než
  // vytvoříme novou instanci. Krátké zpoždění (60-120ms) bylo nedostatečné
  // a způsobovalo postupnou degradaci po několika cyklech.
  var startDelay = isIOSDevice() ? 350 : 220;
  restartTimer = setTimeout(function(){
    if(!sessionActive || gen !== cycleGeneration) return;
    actuallyStartRecognition(gen);
  }, startDelay);
}

// ── Session-level watchdog — pokud cyklus "zamrzne" (žádný onend/onerror
// dlouho po sobě), restartuje celou session od nuly. Záchranná síť proti
// platformovým bugům, kdy recognition.start() přestane fungovat ─────────
var sessionHeartbeat = null;
function startSessionHeartbeat(gen){
  if(sessionHeartbeat) clearInterval(sessionHeartbeat);
  sessionHeartbeat = setInterval(function(){
    if(!sessionActive || gen !== cycleGeneration){ clearInterval(sessionHeartbeat); return; }
    if(!recognition){
      dlog('💔 heartbeat: recognition chybí, restartuji cyklus','err');
      runRecognitionCycle(gen);
    }
  }, 15000);
}

function actuallyStartRecognition(gen){
  var SR = getSR();
  recognition = new SR();
  recognition._wgActive = true; // true = ještě poslouchá, abort() je bezpečný
  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;

  voicePhase = 'listening';
  dlog('▶ start recognition gen='+gen+' (current='+cycleGeneration+')');
  updateVoiceUI('listening', 'A1 20 / Delka 1500 / Vrut ano');

  var gotResult = false;

  recognition.onresult = function(event){
    recognition._wgActive = false; // dokončil svou práci přirozeně
    if(gen !== cycleGeneration){
      dlog('⚠ onresult IGNOROVÁN — gen mismatch ('+gen+' vs '+cycleGeneration+')','err');
      return;
    }
    gotResult = true;
    clearAllTimers();
    var transcript = event.results[0][0].transcript;
    dlog('📥 onresult: "' + transcript + '"');
    try{
      processCommand(transcript, gen);
    } catch(err){
      dlog('💥 processCommand selhal: '+err.message,'err');
      if(sessionActive) runRecognitionCycle(gen);
    }
  };

  recognition.onerror = function(event){
    recognition._wgActive = false;
    dlog('⚠ onerror: '+event.error, event.error==='no-speech'?'':'err');
    if(!sessionActive || gen !== cycleGeneration) return;
    if(event.error === 'no-speech' || event.error === 'aborted'){
      runRecognitionCycle(gen); return;
    }
    if(event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      sessionActive = false;
      updateVoiceUI('idle','');
      showVoiceToast('Mikrofon zablokován v nastavení prohlížeče');
      return;
    }
    runRecognitionCycle(gen);
  };

  recognition.onend = function(){
    recognition._wgActive = false;
    dlog('⏹ onend (gotResult='+gotResult+')');
    if(!sessionActive || gen !== cycleGeneration) return;
    if(!gotResult) runRecognitionCycle(gen);
  };

  watchdogTimer = setTimeout(function(){
    if(sessionActive && gen===cycleGeneration && !gotResult){
      dlog('⏱ watchdog timeout — abort','err');
      try{ recognition.abort(); }catch(e){}
    }
  }, 12000);

  try{ recognition.start(); dlog('✓ recognition.start() OK'); }
  catch(e){ dlog('❌ recognition.start() THREW: '+e.message,'err'); if(sessionActive && gen===cycleGeneration) runRecognitionCycle(gen); }
}

// ── Jednofázové zpracování příkazu — okamžitý zápis + vizuální potvrzení ──
// ── Pokračuj v poslechu, ale po N cyklech udělej plný refresh session
// (nový getUserMedia handshake) jako preventivní opatření proti
// postupné degradaci nativního audio subsystému na mobilních platformách.
function continueOrRefresh(gen){
  if(!sessionActive) return;
  successfulCyclesCount++;
  // Limit zvýšen na 30 — původních 12 bylo příliš nízké a způsobovalo
  // nečekaný plný restart mikrofonu uprostřed běžného používání (vypadalo
  // to jako "appka po pár zadáních zkolabuje").
  if(successfulCyclesCount >= 30){
    dlog('🔄 periodický refresh session (30 cyklů) — obnovuji mikrofon','ok');
    successfulCyclesCount = 0;
    var wasActive = sessionActive;
    stopVoiceSession();
    if(wasActive){
      setTimeout(function(){ startVoiceSession(); }, 400);
    }
    return;
  }
  runRecognitionCycle(gen);
}

function processCommand(transcript, gen){
  dlog('🎤 slyšel: "'+transcript+'"');

  // "domů" / "hlavní stránka" — VŽDY zastaví vše a vrátí na hlavní stránku,
  // bez ohledu na to, co appka právě dělá (i uprostřed FFT nahrávání).
  if(/hlavní stránka|hlavni stranka|\bdomů\b|\bdomu\b/.test(transcript.toLowerCase())){
    dlog('✓ návrat na hlavní stránku','ok');
    if(window.wgFFTStopRecording) window.wgFFTStopRecording();
    if(window.wgGoHome) window.wgGoHome();
    showConfirmOverlay('Hlavní stránka', '✓');
    beepOk();
    stopVoiceSession();
    return;
  }

  // "konec" / "stop" / "ukončit" / "znovu" / "opakovat":
  // - Pokud appka právě nahrává/odpočítává FFT → zastaví nahrávání a SPUSTÍ HO ZNOVU
  // - Jinak (běžné zadávání polí) → ukončí hlasovou session jako dřív
  if(isStopCommand(transcript)){
    if(window.wgFFTIsRecording && window.wgFFTIsRecording()){
      dlog('🔄 restart FFT nahrávání','ok');
      if(window.wgFFTRestartRecording) window.wgFFTRestartRecording();
      showConfirmOverlay('Nahravani', 'znovu...');
      beepOk();
      if(sessionActive) continueOrRefresh(gen);
      return;
    }
    dlog('stop příkaz — konec session');
    stopVoiceSession();
    return;
  }

  // "zpět" — vrátí poslední zapsanou hodnotu
  if(/\bzpět\b/.test(transcript.toLowerCase()) || /\bzpátky\b/.test(transcript.toLowerCase())){
    undoLastValue();
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "dřevo smrk" / "druh dřeva buk" — nastaví výchozí druh dřeva
  var woodCmd = findWoodSpeciesCommand(transcript);
  if(woodCmd){
    var woodOk = window.wgSetWoodSpecies ? window.wgSetWoodSpecies(woodCmd) : false;
    if(woodOk){
      dlog('✓ druh dřeva: '+woodCmd,'ok');
      showConfirmOverlay('Druh dřeva', woodCmd);
      beepOk();
    } else {
      beepErr();
      showVoiceToast('Nerozpoznán druh dřeva');
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "produkt hranol" / "řezivo na plochu" — nastaví výchozí druh produktu
  var productCmd = findProductTypeCommand(transcript);
  if(productCmd){
    var prodOk = window.wgSetProductType ? window.wgSetProductType(productCmd) : false;
    if(prodOk){
      dlog('✓ druh produktu: '+productCmd,'ok');
      showConfirmOverlay('Druh produktu', productCmd);
      beepOk();
    } else {
      beepErr();
      showVoiceToast('Nerozpoznán druh produktu');
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "vyber složku X" / "změna složky X" — aktivuje EXISTUJÍCÍ složku (ne vytváří novou)
  var selectFolderCmd = findSelectFolderCommand(transcript);
  if(selectFolderCmd){
    if(selectFolderCmd.name){
      var actFid = window.wgActivateFolderByName ? window.wgActivateFolderByName(selectFolderCmd.name) : null;
      if(actFid){
        dlog('✓ aktivována složka: "'+selectFolderCmd.name+'"','ok');
        showConfirmOverlay('Složka', selectFolderCmd.name);
        beepOk();
      } else {
        dlog('❌ složka "'+selectFolderCmd.name+'" nenalezena','err');
        beepErr();
        showVoiceToast('Složka "'+selectFolderCmd.name+'" nenalezena');
      }
    } else {
      // Bez jména — otevři výběr složky manuálně
      if(window.wgOpenFolderPicker) window.wgOpenFolderPicker();
      showConfirmOverlay('Výběr složky', 'otevřeno');
      beepOk();
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "nová složka NÁZEV" — vytvoří a aktivuje složku pro ukládání desek
  // Pokud zazní jen "nová složka" bez názvu, appka čeká na pojmenování dalším povelem
  var folderName = findCreateFolderCommand(transcript);
  if(folderName){
    dlog('✓ vytvářím složku: "'+folderName+'"','ok');
    var fid = window.wgCreateAndActivateFolder ? window.wgCreateAndActivateFolder(folderName) : null;
    if(fid){
      showConfirmOverlay('Složka', folderName);
      beepOk();
    } else {
      dlog('❌ vytvoření složky selhalo','err');
      beepErr();
      showVoiceToast('Nepodařilo se vytvořit složku');
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }
  if(/^nová složka\s*$|^novou složku\s*$|^založ složku\s*$/.test(transcript.toLowerCase().trim())){
    dlog('✓ čekám na název složky','ok');
    awaitingFolderName = true;
    showConfirmOverlay('Nová složka', 'řekni název…');
    beepOk();
    if(sessionActive) continueOrRefresh(gen);
    return;
  }
  if(awaitingFolderName){
    awaitingFolderName = false;
    var name2 = transcript.trim();
    if(name2){
      dlog('✓ vytvářím složku: "'+name2+'"','ok');
      var fid2 = window.wgCreateAndActivateFolder ? window.wgCreateAndActivateFolder(name2) : null;
      if(fid2){ showConfirmOverlay('Složka', name2); beepOk(); }
      else { beepErr(); showVoiceToast('Nepodařilo se vytvořit složku'); }
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "statistika" — zobrazí přehled statistiky aktuální složky
  if(/statistik/.test(transcript.toLowerCase())){
    dlog('✓ otevírám statistiku','ok');
    var statFid = window.getCurrentFilterFolderId ? window.getCurrentFilterFolderId() : '__all';
    if(window.openStatsModal) window.openStatsModal(statFid);
    showConfirmOverlay('Statistika', '✓');
    beepOk();
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "export" — spustí export dat z aktuální složky
  if(/^export|exportovat|exportuj/.test(transcript.toLowerCase().trim())){
    dlog('✓ spouštím export','ok');
    if(window.openExportModal) window.openExportModal();
    showConfirmOverlay('Export', '✓');
    beepOk();
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "FFT podél" / "FFT ohyb" — otevře FFT screen, nastaví typ, spustí test
  // Pokud typ nezazněl, jen otevře obrazovku a NADÁLE poslouchá na "podélné"/"ohybové"
  var fftCmd = findFftCommand(transcript);
  if(fftCmd){
    if(fftCmd.type===null){
      dlog('✓ FFT otevřeno, čekám na volbu typu','ok');
      executeFftCommand(null);
      showConfirmOverlay('FFT', 'řekni podélné / ohybové');
      beepOk();
      awaitingFftTypeChoice = true;
      if(sessionActive) continueOrRefresh(gen);
      return;
    }
    dlog('✓ spouštím: '+fftCmd.label,'ok');
    awaitingFftTypeChoice = false;
    executeFftCommand(fftCmd.type);
    showConfirmOverlay(fftCmd.label, 'spoustim...');
    beepOk();
    // Po spuštění testu KONČÍME hlasovou session pro pole — appka teď čeká na
    // fyzické bouchnutí do desky, ne na další hlasový příkaz.
    stopVoiceSession();
    return;
  }

  // Pokud appka čeká na volbu typu kmitání po předchozím "FFT" bez typu
  if(awaitingFftTypeChoice){
    var chosenType = findFftTypeChoice(transcript);
    if(chosenType){
      dlog('✓ vybrán typ: '+chosenType,'ok');
      awaitingFftTypeChoice = false;
      executeFftCommand(chosenType);
      showConfirmOverlay(chosenType==='bending'?'FFT ohyb':(chosenType==='combo'?'FFT kombinace':'FFT podel'), 'spoustim...');
      beepOk();
      stopVoiceSession();
      return;
    }
    // Nerozpoznáno — appka zůstává v čekacím stavu, poslouchá dál
    beepErr();
    showVoiceToast('Řekni "podélné" nebo "ohybové"');
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // Appka nabídla frekvenci 1. módu po FFT testu — "ano" potvrdí a uloží do
  // desky, jinak appka zkusí přečíst nové číslo jako opravenou hodnotu.
  if(awaitingFreqConfirm){
    var t2 = transcript.toLowerCase();
    var isYes = /\bano\b/.test(t2) || /\bjo\b/.test(t2) || t2.indexOf('okej')>=0 || t2.indexOf('potvrz')>=0;
    var isNo  = !isYes && /\bne\b/.test(t2);
    if(isYes){
      awaitingFreqConfirm = false;
      if(window.wgFFTSave) window.wgFFTSave();
      showConfirmOverlay('Frekvence', 'uložena');
      beepOk();
      if(sessionActive) continueOrRefresh(gen);
      return;
    }
    if(isNo){
      awaitingFreqConfirm = false;
      showVoiceToast('Zrušeno — uprav frekvenci manuálně nebo zopakuj test');
      beepErr();
      if(sessionActive) continueOrRefresh(gen);
      return;
    }
    // Zkus, zda uživatel řekl novou hodnotu frekvence místo ano/ne
    var newFreq = parseSpokenNumber(transcript);
    if(newFreq!==null && !isNaN(newFreq)){
      if(window.wgSetPrimaryModeFreq) window.wgSetPrimaryModeFreq(newFreq);
      showConfirmOverlay('Frekvence 1. mód', newFreq+' Hz — potvrď ano/ne');
      beepOk();
      if(sessionActive) continueOrRefresh(gen);
      return;
    }
    beepErr();
    showVoiceToast('Řekni "ano" pro uložení, nebo novou hodnotu frekvence');
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "Uložit" — uloží rozpracovanou desku (detail screen) nebo FFT data (FFT screen)
  if(/^ulož|^uloz/.test(transcript.toLowerCase().trim())){
    var isDetailActive = document.getElementById('s-detail') && document.getElementById('s-detail').classList.contains('active');
    if(isDetailActive && window.wgSaveDetailBoard){
      dlog('✓ ukládám desku','ok');
      window.wgSaveDetailBoard();
      showConfirmOverlay('Uloženo', '✓');
      beepOk();
    } else {
      dlog('✓ ukládám FFT','ok');
      if(window.wgFFTSave) window.wgFFTSave();
      showConfirmOverlay('Uloženo', '✓');
      beepOk();
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "upravit suk N" — otevře editaci konkrétního suku z hlavní stránky
  var editKnotNum = findEditKnotCommand(transcript);
  if(editKnotNum !== null){
    var totalKnots = window.wgGetKnotCount ? window.wgGetKnotCount() : 0;
    if(editKnotNum > totalKnots){
      dlog('❌ suk '+editKnotNum+' neexistuje (celkem '+totalKnots+')','err');
      beepErr();
      showVoiceToast('Suk '+editKnotNum+' neexistuje');
    } else {
      var ok = window.wgEnterEditKnot ? window.wgEnterEditKnot(editKnotNum) : false;
      if(ok){
        dlog('✓ upravuji suk '+editKnotNum,'ok');
        showConfirmOverlay('Suk '+editKnotNum, 'upravuji');
        beepOk();
      } else {
        beepErr();
        showVoiceToast('Nepodařilo se otevřít suk');
      }
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // "vyhledat X" — najde desku podle ID a otevře ji k úpravě
  var searchBoardId = findSearchBoardCommand(transcript);
  if(searchBoardId){
    var foundOk = window.wgFindAndOpenBoard ? window.wgFindAndOpenBoard(searchBoardId) : false;
    if(foundOk){
      dlog('✓ otevřena deska: '+searchBoardId,'ok');
      showConfirmOverlay('Deska '+searchBoardId, 'otevřena');
      beepOk();
    } else {
      dlog('❌ deska "'+searchBoardId+'" nenalezena','err');
      beepErr();
      showVoiceToast('Deska "'+searchBoardId+'" nenalezena');
    }
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  // Akční příkazy (přidat suk, nová deska)
  var actionCmd = findActionCommand(transcript);
  if(actionCmd){
    dlog('✓ akce: '+actionCmd.label,'ok');
    executeAction(actionCmd.action);
    showConfirmOverlay(actionCmd.label, '✓ provedeno');
    beepOk();
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  var parsed = parseCommand(transcript);
  dlog('→ pole='+parsed.field+' hodnotaText="'+parsed.valueText+'"');
  if(!parsed.field){
    dlog('❌ pole nerozpoznáno', 'err');
    beepErr();
    showVoiceToast('Nerozpoznáno: "'+transcript+'"');
    if(sessionActive) continueOrRefresh(gen);
    return;
  }

  var field = parsed.field;
  var kind, value;

  if(field === '__screw__'){
    kind = 'bool';
    value = parseBoolFromText(parsed.valueText);
    if(value === null){ dlog('❌ vrut ano/ne nenalezeno','err'); beepErr(); showVoiceToast('Vrut: ano nebo ne'); if(sessionActive) continueOrRefresh(gen); return; }
  } else if(field === 'p-vg'){
    kind = 'vg';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || value<1 || value>4){ dlog('❌ vizuál mimo 1-4','err'); beepErr(); showVoiceToast('Vizuál: 1 až 4'); if(sessionActive) continueOrRefresh(gen); return; }
    value = Math.round(value);
  } else if(field === 'cid'){
    kind = 'text';
    value = parseAlphaNumericId(parsed.valueText);
    if(!value){ dlog('❌ ID prázdné','err'); beepErr(); showVoiceToast('ID: řekni text nebo kód'); if(sessionActive) continueOrRefresh(gen); return; }
  } else {
    kind = 'number';
    value = parseSpokenNumber(parsed.valueText);
    if(value===null || isNaN(value)){ dlog('❌ hodnota nerozpoznána z "'+parsed.valueText+'"','err'); beepErr(); showVoiceToast('Nerozpoznána hodnota'); if(sessionActive) continueOrRefresh(gen); return; }
  }

  // Okamžitý zápis — žádné druhé hlasové kolo
  writeValue(field, value, kind);

  if(sessionActive) continueOrRefresh(gen);
}

// ── Zápis hodnoty + vizuální potvrzení (2s overlay) ───────
function writeValue(field, value, kind){
  var label = (FIELD_LABELS_PLOCHA[field] || FIELD_LABELS[field] || field);
  var shown = kind==='bool' ? (value?'ano':'ne') : value;

  if(field === '__screw__'){
    var cb = document.getElementById('cb-screw');
    if(cb){
      lastElement = cb;
      lastPrevValue = cb.classList.contains('checked');
      var want = !!value;
      if(want !== lastPrevValue) cb.click();
      dlog('✅ vrut nastaven na '+want,'ok');
    } else {
      dlog('❌ element cb-screw nenalezen v DOM','err');
      beepErr();
      return;
    }
  } else {
    var el = document.getElementById(field);
    if(el){
      lastElement = el;
      lastPrevValue = el.value;
      el.value = value;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      dlog('✅ input#'+field+'.value nyní = "'+el.value+'"','ok');
      if(field === 'p-vg'){
        var vgBtn = document.querySelector('[data-act="setvg"][data-vg="'+value+'"]');
        if(vgBtn) vgBtn.click();
      }
    } else {
      dlog('❌ element #'+field+' NEEXISTUJE v DOM','err');
      beepErr();
      showVoiceToast('Chyba: pole '+field+' neexistuje');
      return;
    }
  }

  lastField = field;
  lastValue = value;
  lastKind = kind;

  beepOk();
  showConfirmOverlay(label, shown);
}

// ── Vrácení poslední hodnoty (řekni "zpět") ───────────────
function undoLastValue(){
  if(!lastElement){ showVoiceToast('Nic k vrácení'); beepErr(); return; }
  if(lastField === '__screw__'){
    var cb = document.getElementById('cb-screw');
    if(cb){
      var has = cb.classList.contains('checked');
      if(has !== lastPrevValue) cb.click();
    }
  } else {
    lastElement.value = lastPrevValue;
    lastElement.dispatchEvent(new Event('input', {bubbles:true}));
    lastElement.dispatchEvent(new Event('change', {bubbles:true}));
  }
  showVoiceToast('Vráceno');
  beepOk();
  dlog('↩ vráceno: '+lastField+' = '+lastPrevValue,'ok');
  lastElement = null; lastField = null; lastValue = null; lastPrevValue = null;
}

// ── Vizuální potvrzovací overlay (2s, žádný TTS) ──────────
function showConfirmOverlay(label, value){
  var el = document.getElementById('voice-confirm-overlay');
  if(!el) return;
  el.textContent = label + ': ' + value;
  el.classList.add('show');
  if(confirmOverlayTimer) clearTimeout(confirmOverlayTimer);
  confirmOverlayTimer = setTimeout(function(){
    el.classList.remove('show');
  }, 2000);
}

// ── UI feedback ───────────────────────────────────────────
function updateVoiceUI(state, msg){
  var btn = document.getElementById('btn-voice');
  var indicator = document.getElementById('voice-status');
  if(btn){
    var shouldListen = (state==='listening');
    var shouldActive = (state==='requesting');
    btn.classList.toggle('voice-listening', shouldListen);
    btn.classList.toggle('voice-active', shouldActive);
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
  // Mikrofon je nyní statické tlačítko v bbar na entry screenu (vedle "Nová deska").
  // Hlasová session ale zůstává aktivní i po přepnutí na jiné screeny (detail
  // desky, metodika, statistiky) — appka tak reaguje na hlasové příkazy
  // odkudkoli, jen ovládací tlačítko je viditelné pouze na hlavní stránce.
}

// ── Restart hlasové session po dokončení FFT testu ────────
// Nabídne detekovanou frekvenci 1. módu (primárně) k potvrzení hlasem.
window.wgVoiceRestartAfterFft = function(){
  if(sessionActive) return; // už běží, nic dělat
  var freq = window.wgGetPrimaryModeFreq ? window.wgGetPrimaryModeFreq() : null;
  if(freq){
    awaitingFreqConfirm = true;
    showConfirmOverlay('Frekvence 1. mód', freq+' Hz — potvrď ano/ne');
  }
  startVoiceSession();
};

function initVoice(){
  document.addEventListener('click', function(e){
    // Hlasová session NEukončuje při běžné navigaci (seznam desek, nastavení,
    // metodika) — funguje napříč celou appkou. Ukončuje se jen explicitně
    // přes "konec/domů" nebo automaticky při spuštění FFT nahrávání (mikrofon
    // je potřeba pro samotné nahrávání zvuku desky).
    var fftBtn = e.target.closest('#btn-fft-open');
    if(fftBtn && sessionActive){ stopVoiceSession(); }
  });
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    toggleVoiceSession();
  });

  // Dlouhé podržení (800ms) na mikrofonu = zobrazit/skrýt debug panel
  var pressTimer = null;
  function toggleDebugPanel(){
    debugPanelEnabled = !debugPanelEnabled;
    var panel = document.getElementById('voice-debug');
    if(panel) panel.classList.toggle('show', debugPanelEnabled);
    showVoiceToast(debugPanelEnabled ? 'Debug panel zapnut' : 'Debug panel skryt');
  }
  document.addEventListener('touchstart', function(e){
    var btn = e.target.closest('#btn-voice');
    if(!btn) return;
    pressTimer = setTimeout(function(){
      toggleDebugPanel();
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
      toggleDebugPanel();
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
