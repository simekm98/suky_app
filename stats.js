// ═══════════════════════════════════════════════════════════
//  STATISTIKY SLOŽKY — KAR, DAB, Hustota, MOED + korelace
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

function getBoards(){ return window.wgGetAllBoards ? window.wgGetAllBoards() : []; }

function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

// ── Sběr dat pro statistiku ────────────────────────────────
function collectStats(folderId){
  var boards = getBoards();
  var mkPolys  = window.mkPolys   || function(){ return []; };
  var calcUA   = window.calcUA    || function(){ return 0; };
  var calcDAB  = window.calcDAB   || function(){ return 0; };
  var calcDen  = window.calcDensity|| function(){ return null; };
  var calcMOED = window.calcMOED  || function(){ return {}; };
  var grade    = window.grade     || function(){ return '?'; };

  var filtered = boards.filter(function(b){
    if(folderId==='__all') return true;
    if(folderId==='__none') return !b.folderId;
    return b.folderId === folderId;
  });

  var rows = filtered.map(function(bd){
    var knots = bd.knots||[];
    var ps  = mkPolys(knots,bd.b||0,bd.d||0);
    var ua  = calcUA(ps,bd.b||0,bd.d||0);
    var kar = (bd.b&&bd.d) ? (ua/(bd.b*bd.d))*100 : 0;
    var dab = calcDAB(knots,bd.b||0);
    var den = calcDen(bd.mass,bd.length,bd.b,bd.d);
    var mr  = calcMOED(bd);
    var gr  = grade(kar,dab,knots.length);
    return { id:bd.id, kar:kar, dab:dab, density:den, moedL:mr.moedL, moedB:mr.moedB, grade:gr, savedAt:bd.savedAt, knotCount:knots.length };
  });

  return rows;
}

// ── Statistické funkce ─────────────────────────────────────
function mean(arr){ if(!arr.length) return null; return arr.reduce(function(a,b){return a+b;},0)/arr.length; }
function median(arr){
  if(!arr.length) return null;
  var s=arr.slice().sort(function(a,b){return a-b;});
  var n=s.length;
  return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}
function stdDev(arr){
  if(arr.length<2) return null;
  var m=mean(arr);
  var v=arr.reduce(function(a,x){return a+(x-m)*(x-m);},0)/(arr.length-1);
  return Math.sqrt(v);
}
function minMax(arr){
  if(!arr.length) return {min:null,max:null};
  return {min:Math.min.apply(null,arr), max:Math.max.apply(null,arr)};
}
function pearsonCorr(x,y){
  // x, y musí být stejně dlouhé, bez null hodnot (filtrováno před voláním)
  var n=x.length;
  if(n<3) return null;
  var mx=mean(x), my=mean(y);
  var num=0, dx2=0, dy2=0;
  for(var i=0;i<n;i++){
    var dx=x[i]-mx, dy=y[i]-my;
    num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy;
  }
  if(dx2===0||dy2===0) return null;
  return num/Math.sqrt(dx2*dy2);
}

// ── Histogram (canvas) ──────────────────────────────────────
function drawHistogram(cv, values, opts){
  opts = opts||{};
  var color = opts.color || '#111111';
  var label = opts.label || '';
  var unit  = opts.unit  || '';
  if(!cv) return;
  var wrap = cv.parentElement;
  var W = wrap.getBoundingClientRect().width;
  var H = 140;
  var dpr = window.devicePixelRatio||1;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  cv.style.width=W+'px'; cv.style.height=H+'px';
  var ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);

  if(!values.length){
    ctx.fillStyle='#999'; ctx.font='12px -apple-system,sans-serif'; ctx.textAlign='center';
    ctx.fillText('Žádná data', W/2, H/2);
    return;
  }

  var PL=32,PR=10,PT=10,PB=22,PW=W-PL-PR,PH=H-PT-PB;
  var mm = minMax(values);
  var range = mm.max-mm.min;
  if(range===0) range=1;
  var nBins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(values.length))));
  var binW = range/nBins;
  var bins = new Array(nBins).fill(0);
  values.forEach(function(v){
    var idx = Math.min(nBins-1, Math.floor((v-mm.min)/binW));
    bins[idx]++;
  });
  var maxCount = Math.max.apply(null,bins);

  // Osy
  ctx.strokeStyle='rgba(0,0,0,.15)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PL,PT); ctx.lineTo(PL,PT+PH); ctx.lineTo(PL+PW,PT+PH); ctx.stroke();

  // Sloupce
  var gap=2;
  var barW=(PW/nBins)-gap;
  bins.forEach(function(cnt,i){
    var bh = maxCount>0 ? (cnt/maxCount)*PH : 0;
    var x = PL + i*(PW/nBins) + gap/2;
    var y = PT+PH-bh;
    ctx.fillStyle=color;
    ctx.fillRect(x,y,barW,bh);
    if(cnt>0){
      ctx.fillStyle='#666'; ctx.font='9px -apple-system,sans-serif'; ctx.textAlign='center';
      ctx.fillText(cnt, x+barW/2, y-3);
    }
  });

  // X popisky (min, max)
  ctx.fillStyle='#888'; ctx.font='9px -apple-system,sans-serif'; ctx.textAlign='left';
  ctx.fillText(mm.min.toFixed(1), PL, H-6);
  ctx.textAlign='right';
  ctx.fillText(mm.max.toFixed(1), PL+PW, H-6);
}

// ── Scatter plot pro korelace ────────────────────────────────
function drawScatter(cv, xVals, yVals, opts){
  opts=opts||{};
  if(!cv) return;
  var wrap=cv.parentElement;
  var W=wrap.getBoundingClientRect().width, H=160;
  var dpr=window.devicePixelRatio||1;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  cv.style.width=W+'px'; cv.style.height=H+'px';
  var ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);

  if(xVals.length<3){
    ctx.fillStyle='#999'; ctx.font='12px -apple-system,sans-serif'; ctx.textAlign='center';
    ctx.fillText('Nedostatek dat (min. 3 desky)', W/2, H/2);
    return;
  }

  var PL=36,PR=10,PT=10,PB=24,PW=W-PL-PR,PH=H-PT-PB;
  var xmm=minMax(xVals), ymm=minMax(yVals);
  var xr=xmm.max-xmm.min||1, yr=ymm.max-ymm.min||1;
  function fx(v){ return PL+((v-xmm.min)/xr)*PW; }
  function fy(v){ return PT+PH-((v-ymm.min)/yr)*PH; }

  ctx.strokeStyle='rgba(0,0,0,.15)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PL,PT); ctx.lineTo(PL,PT+PH); ctx.lineTo(PL+PW,PT+PH); ctx.stroke();

  // Body
  ctx.fillStyle=opts.color||'#111111';
  for(var i=0;i<xVals.length;i++){
    ctx.beginPath();
    ctx.arc(fx(xVals[i]), fy(yVals[i]), 4, 0, 2*Math.PI);
    ctx.globalAlpha=0.65;
    ctx.fill();
  }
  ctx.globalAlpha=1;

  // Regresní přímka (lineární)
  var n=xVals.length, mx=mean(xVals), my=mean(yVals);
  var num=0, den=0;
  for(var i=0;i<n;i++){ num+=(xVals[i]-mx)*(yVals[i]-my); den+=(xVals[i]-mx)*(xVals[i]-mx); }
  if(den>0){
    var slope=num/den, intercept=my-slope*mx;
    var x1=xmm.min, x2=xmm.max;
    ctx.strokeStyle='#C0392B'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(fx(x1),fy(slope*x1+intercept)); ctx.lineTo(fx(x2),fy(slope*x2+intercept)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Labely
  ctx.fillStyle='#888'; ctx.font='9px -apple-system,sans-serif'; ctx.textAlign='left';
  ctx.fillText(xmm.min.toFixed(1), PL, H-8);
  ctx.textAlign='right';
  ctx.fillText(xmm.max.toFixed(1), PL+PW, H-8);
}

// ── Render statistik do modalu ───────────────────────────────
function renderStatsModal(folderId){
  var rows = collectStats(folderId);
  var folderName = folderId==='__all' ? 'Všechny desky' : (folderId==='__none' ? 'Bez složky' : (window.getFolderNameSafe?window.getFolderNameSafe(folderId):'Složka'));

  var titleEl = document.getElementById('stats-folder-name');
  if(titleEl) titleEl.textContent = folderName;

  var body = document.getElementById('stats-body');
  if(!body) return;

  if(!rows.length){
    body.innerHTML = '<div style="text-align:center;padding:30px;color:#999">Žádná data k zobrazení</div>';
    return;
  }

  var karVals = rows.map(function(r){return r.kar;}).filter(function(v){return v!=null && !isNaN(v);});
  var dabVals = rows.map(function(r){return r.dab;}).filter(function(v){return v!=null && !isNaN(v);});
  var denVals = rows.filter(function(r){return r.density!=null;}).map(function(r){return r.density;});
  var moedLVals = rows.filter(function(r){return r.moedL!=null;}).map(function(r){return r.moedL;});
  var moedBVals = rows.filter(function(r){return r.moedB!=null;}).map(function(r){return r.moedB;});

  function statRow(label,arr,unit){
    if(!arr.length) return '<div class="stat-summary-row"><span>'+label+'</span><span style="color:#999">— bez dat</span></div>';
    var m=mean(arr), md=median(arr), sd=stdDev(arr), mm=minMax(arr);
    return '<div class="stat-summary-row"><span>'+label+'</span>'
      +'<span>Ø '+m.toFixed(2)+unit+' · med '+md.toFixed(2)+' · σ '+(sd!=null?sd.toFixed(2):'—')+' · ['+mm.min.toFixed(1)+'–'+mm.max.toFixed(1)+']</span></div>';
  }

  var html = '';
  html += '<div class="stats-section-title">Přehled ('+rows.length+' desek)</div>';
  html += '<div class="stat-summary-box">';
  html += statRow('KAR', karVals, '%');
  html += statRow('DAB', dabVals, '');
  html += statRow('Hustota', denVals, ' kg/m³');
  html += statRow('MOED_L', moedLVals, ' MPa');
  html += statRow('MOED_B', moedBVals, ' MPa');
  html += '</div>';

  // Histogramy
  html += '<div class="stats-section-title">Histogramy</div>';
  html += '<div class="stats-chart-card"><div class="stats-chart-label">KAR (%)</div><canvas id="hist-kar"></canvas></div>';
  html += '<div class="stats-chart-card"><div class="stats-chart-label">DAB</div><canvas id="hist-dab"></canvas></div>';
  if(denVals.length) html += '<div class="stats-chart-card"><div class="stats-chart-label">Hustota (kg/m³)</div><canvas id="hist-den"></canvas></div>';
  if(moedLVals.length) html += '<div class="stats-chart-card"><div class="stats-chart-label">MOED_L (MPa)</div><canvas id="hist-moedl"></canvas></div>';
  if(moedBVals.length) html += '<div class="stats-chart-card"><div class="stats-chart-label">MOED_B (MPa)</div><canvas id="hist-moedb"></canvas></div>';

  // Korelace
  html += '<div class="stats-section-title">Korelace</div>';
  var pairs = [
    {a:'kar', b:'dab', la:'KAR', lb:'DAB'},
    {a:'kar', b:'density', la:'KAR', lb:'Hustota'},
    {a:'density', b:'moedL', la:'Hustota', lb:'MOED_L'},
    {a:'kar', b:'moedL', la:'KAR', lb:'MOED_L'},
    {a:'density', b:'moedB', la:'Hustota', lb:'MOED_B'}
  ];
  pairs.forEach(function(p,pi){
    var xs=[], ys=[];
    rows.forEach(function(r){
      var xv=r[p.a], yv=r[p.b];
      if(xv!=null && yv!=null && !isNaN(xv) && !isNaN(yv)){ xs.push(xv); ys.push(yv); }
    });
    if(xs.length<3) return;
    var corr = pearsonCorr(xs,ys);
    var corrStr = corr!=null ? corr.toFixed(2) : '—';
    var corrColor = corr==null ? '#999' : (Math.abs(corr)>0.6?'#27AE60':(Math.abs(corr)>0.3?'#E67E22':'#999'));
    html += '<div class="stats-chart-card">'
      +'<div class="stats-chart-label" style="display:flex;justify-content:space-between">'
      +'<span>'+p.la+' vs '+p.lb+'</span><span style="color:'+corrColor+';font-weight:800">r = '+corrStr+'</span></div>'
      +'<canvas id="scat-'+pi+'"></canvas></div>';
  });

  body.innerHTML = html;

  // Vykresli grafy po renderu (potřebují DOM layout)
  setTimeout(function(){
    drawHistogram(document.getElementById('hist-kar'), karVals, {color:'#185FA5'});
    drawHistogram(document.getElementById('hist-dab'), dabVals, {color:'#854F0B'});
    if(denVals.length) drawHistogram(document.getElementById('hist-den'), denVals, {color:'#111111'});
    if(moedLVals.length) drawHistogram(document.getElementById('hist-moedl'), moedLVals, {color:'#111111'});
    if(moedBVals.length) drawHistogram(document.getElementById('hist-moedb'), moedBVals, {color:'#185FA5'});

    pairs.forEach(function(p,pi){
      var xs=[], ys=[];
      rows.forEach(function(r){
        var xv=r[p.a], yv=r[p.b];
        if(xv!=null && yv!=null && !isNaN(xv) && !isNaN(yv)){ xs.push(xv); ys.push(yv); }
      });
      if(xs.length<3) return;
      drawScatter(document.getElementById('scat-'+pi), xs, ys, {color:'#111111'});
    });
  }, 50);
}

// ── Modal open/close ──────────────────────────────────────
function openStatsModal(folderId){
  renderStatsModal(folderId||'__all');
  var m=document.getElementById('modal-stats');
  if(m) m.classList.add('open');
}
function closeStatsModal(){
  var m=document.getElementById('modal-stats');
  if(m) m.classList.remove('open');
}

window.openStatsModal = openStatsModal;
window.closeStatsModal = closeStatsModal;

// ── Event delegation ───────────────────────────────────────
document.addEventListener('click', function(e){
  var btn = e.target.closest('[data-act]');
  if(!btn) return;
  var act = btn.getAttribute('data-act');
  if(act==='openstats'){
    var fid = window.getCurrentFilterFolderId ? window.getCurrentFilterFolderId() : '__all';
    openStatsModal(fid);
  }
  else if(act==='closestats'){ closeStatsModal(); }
});

})();
