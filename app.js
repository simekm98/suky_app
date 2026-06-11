'use strict';

// ── Config ──────────────────────────────────────────────
const API_BASE = window.API_BASE || '';   // set in index.html or env
const DB_KEY   = 'suk_boards_v1';
const FIDS     = ['as1','as2','bs1','bs2','cs1','cs2','ds1','ds2'];

// ── State ───────────────────────────────────────────────
let allBoards      = [];   // [{id, b, d, knots:[], savedAt}]
let knots          = [];   // current board knots
let editState      = null; // {bi, ki}
let emptyEnterCount = 0;
let isOnline       = navigator.onLine;

// ── Geometry ────────────────────────────────────────────
function knotPoints(k, b, d) {
  const p = [];
  if (k.as1 != null && k.as2 != null) { p.push([b - k.as1, d]); p.push([b - k.as2, d]); }
  if (k.bs1 != null && k.bs2 != null) { p.push([0, d - k.bs1]); p.push([0, d - k.bs2]); }
  if (k.cs1 != null && k.cs2 != null) { p.push([k.cs1, 0]);     p.push([k.cs2, 0]); }
  if (k.ds1 != null && k.ds2 != null) { p.push([b, k.ds1]);     p.push([b, k.ds2]); }
  return p.length > 2 ? p : null;
}

function polyArea(pts) {
  let s = 0, n = pts.length;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  return Math.abs(s) / 2;
}

function knotIntervalOnB(k, b) {
  const iv = [];
  if (k.as1 != null && k.as2 != null) {
    const lo = b - Math.max(k.as1, k.as2), hi = b - Math.min(k.as1, k.as2);
    if (hi > lo) iv.push([Math.max(0, lo), Math.min(b, hi)]);
  }
  if (k.cs1 != null && k.cs2 != null) {
    const lo = Math.min(k.cs1, k.cs2), hi = Math.max(k.cs1, k.cs2);
    if (hi > lo) iv.push([Math.max(0, lo), Math.min(b, hi)]);
  }
  return iv;
}

function unionLength(intervals) {
  if (!intervals.length) return 0;
  const s = [...intervals].sort((a, b) => a[0] - b[0]);
  let tot = 0, lo = s[0][0], hi = s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (s[i][0] <= hi) hi = Math.max(hi, s[i][1]);
    else { tot += hi - lo; lo = s[i][0]; hi = s[i][1]; }
  }
  return tot + (hi - lo);
}

function knotAi(k, b)       { return unionLength(knotIntervalOnB(k, b)); }
function computeDAB(ks, b)  {
  if (!ks.length) return 0;
  const all = [];
  for (const k of ks) for (const iv of knotIntervalOnB(k, b)) all.push(iv);
  return unionLength(all) / (2 * b);
}

function computeUnionArea(polys, b, d) {
  if (!polys.length) return 0;
  const R = 4, W = Math.round(b * R) + 1, H = Math.round(d * R) + 1;
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  const ctx = oc.getContext('2d'); ctx.fillStyle = '#000';
  for (const pts of polys) {
    if (!pts || pts.length < 3) continue;
    ctx.beginPath(); ctx.moveTo(pts[0][0] * R, H - 1 - pts[0][1] * R);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * R, H - 1 - pts[i][1] * R);
    ctx.closePath(); ctx.fill();
  }
  const data = oc.getContext('2d').getImageData(0, 0, W, H).data;
  let f = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 128) f++;
  return f / (R * R);
}

function getAllPolys(ks, b, d) { return ks.map(k => knotPoints(k, b, d)).filter(Boolean); }

function classifyBoard(kar, dab) {
  const r = kar / 100;
  if (r <= 1/5 && dab <= 1/5) return 'S13';
  if (r <= 1/3 && dab <= 1/3) return 'S10';
  if (r <= 1/2 && dab <= 1/2) return 'S7';
  return 'Reject';
}

function gradeClass(g) {
  return { S13: 'grade-s13', S10: 'grade-s10', S7: 'grade-s7', Reject: 'grade-rej' }[g] || 'grade-na';
}

// ── Getters ─────────────────────────────────────────────
const gn  = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
const getB  = () => parseFloat(document.getElementById('clen').value) || 156;
const getD  = () => parseFloat(document.getElementById('cwid').value) || 48;
const getId = () => document.getElementById('cid').value || '?';
const getCurK = () => ({ as1:gn('as1'), as2:gn('as2'), bs1:gn('bs1'), bs2:gn('bs2'),
                          cs1:gn('cs1'), cs2:gn('cs2'), ds1:gn('ds1'), ds2:gn('ds2') });
function getCurPoly() {
  if (editState) return null;
  return knotPoints(getCurK(), getB(), getD());
}

// ── Canvas ──────────────────────────────────────────────
const CV_H = 80, PAD = { l: 5, r: 5, t: 5, b: 16 };

function initCv(id) {
  const cv = document.getElementById(id);
  const W = cv.parentElement.clientWidth - 16 || 150;
  cv.width = W * devicePixelRatio; cv.height = CV_H * devicePixelRatio;
  cv.style.width = W + 'px'; cv.style.height = CV_H + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
  return { ctx, W };
}

function makeTF(W, b, d) {
  const PW = W - PAD.l - PAD.r, PH = CV_H - PAD.t - PAD.b;
  return { tx: x => PAD.l + (x / b) * PW, ty: y => PAD.t + PH - (y / d) * PH, PW, PH };
}

function drawScene(ctx, W, tf, b, d) {
  ctx.clearRect(0, 0, W, CV_H);
  ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 0.5;
  ctx.font = '7px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.4)';
  for (let v = 0; v <= b; v += 20) {
    const x = tf.tx(v);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + tf.PH); ctx.stroke();
    ctx.fillText(v, x, CV_H - 2);
  }
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.5;
  ctx.strokeRect(tf.tx(0), tf.ty(d), tf.PW, tf.PH);
}

function fillPoly(ctx, pts, tf, fill, stroke, lw) {
  if (!pts || pts.length < 3) return;
  ctx.beginPath(); ctx.moveTo(tf.tx(pts[0][0]), tf.ty(pts[0][1]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(tf.tx(pts[i][0]), tf.ty(pts[i][1]));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = lw || 0.8; ctx.stroke();
}

function draw() {
  const b = getB(), d = getD();
  const { ctx: ctx1, W: W1 } = initCv('cv1');
  const { ctx: ctx2, W: W2 } = initCv('cv2');
  const tf1 = makeTF(W1, b, d), tf2 = makeTF(W2, b, d);
  drawScene(ctx1, W1, tf1, b, d); drawScene(ctx2, W2, tf2, b, d);

  const saved = getAllPolys(knots, b, d);
  const cur   = getCurPoly();
  const all   = cur ? [...saved, cur] : saved;
  const allK  = cur ? [...knots, getCurK()] : knots;

  saved.forEach((p, i) => {
    const isEd = editState && editState.bi === allBoards.length && editState.ki === i;
    fillPoly(ctx1, p, tf1, isEd ? 'rgba(55,138,221,.2)' : 'rgba(216,90,48,.18)',
                           isEd ? 'rgba(24,95,165,.7)'  : 'rgba(180,50,20,.45)', isEd ? 1.5 : 0.8);
  });
  if (editState) { const ep = knotPoints(getCurK(), b, d); if (ep) fillPoly(ctx1, ep, tf1, 'rgba(55,138,221,.38)', 'rgba(24,95,165,.9)', 1.5); }
  if (cur) fillPoly(ctx1, cur, tf1, 'rgba(216,90,48,.38)', 'rgba(216,90,48,.85)', 0.8);

  if (all.length) {
    const oc = document.createElement('canvas'); oc.width = W2; oc.height = CV_H;
    const oct = oc.getContext('2d');
    for (const p of all) {
      if (!p || p.length < 3) continue;
      oct.beginPath(); oct.moveTo(tf2.tx(p[0][0]), tf2.ty(p[0][1]));
      for (let i = 1; i < p.length; i++) oct.lineTo(tf2.tx(p[i][0]), tf2.ty(p[i][1]));
      oct.closePath(); oct.fillStyle = 'rgb(40,150,80)'; oct.fill();
      oct.strokeStyle = 'rgba(25,110,55,.8)'; oct.lineWidth = 0.8; oct.stroke();
    }
    ctx2.globalAlpha = 0.38; ctx2.drawImage(oc, 0, 0, W2, CV_H); ctx2.globalAlpha = 1;
    for (const p of all) {
      if (!p || p.length < 3) continue;
      ctx2.beginPath(); ctx2.moveTo(tf2.tx(p[0][0]), tf2.ty(p[0][1]));
      for (let i = 1; i < p.length; i++) ctx2.lineTo(tf2.tx(p[i][0]), tf2.ty(p[i][1]));
      ctx2.closePath(); ctx2.strokeStyle = 'rgba(25,110,55,.65)'; ctx2.lineWidth = 0.8; ctx2.stroke();
    }
  }

  const uArea = computeUnionArea(all, b, d);
  const kar   = b * d > 0 ? (uArea / (b * d)) * 100 : 0;
  const dab   = computeDAB(allK, b);
  const sumU  = dab * (2 * b);
  const grade = allK.length ? classifyBoard(kar, dab) : '—';

  document.getElementById('kar-val').textContent   = kar.toFixed(2) + '%';
  document.getElementById('dab-val').textContent   = dab.toFixed(3);
  document.getElementById('dab-sub').textContent   = `${sumU.toFixed(1)} / (2×${b})`;
  document.getElementById('knot-count').textContent = String(knots.length + (cur ? 1 : 0));
  const gw = document.getElementById('grade-wrap');
  gw.innerHTML = grade === '—'
    ? '<span class="grade-pill grade-na">—</span>'
    : `<span class="grade-pill ${gradeClass(grade)}">${grade}</span>`;
}

// ── Edit mode ────────────────────────────────────────────
function enterEditMode(bi, ki) {
  const k = bi === allBoards.length ? knots[ki] : allBoards[bi].knots[ki];
  editState = { bi, ki };
  FIDS.forEach(f => document.getElementById(f).value = k[f] != null ? k[f] : '');
  document.getElementById('edit-banner').classList.add('on');
  const bid = bi === allBoards.length ? getId() : allBoards[bi].id;
  document.getElementById('edit-label').textContent = `${bid} / suk ${ki + 1}`;
  document.getElementById('btn-add').textContent   = 'Uložit změny';
  document.getElementById('btn-add').classList.add('save-mode');
  ['card-a','card-b','card-c','card-d'].forEach(id => document.getElementById(id).classList.add('editing'));
  renderTable(); draw(); document.getElementById('as1').focus();
}

function cancelEdit() {
  editState = null; FIDS.forEach(f => document.getElementById(f).value = '');
  document.getElementById('edit-banner').classList.remove('on');
  document.getElementById('btn-add').textContent = '+ Přidat suk';
  document.getElementById('btn-add').classList.remove('save-mode');
  ['card-a','card-b','card-c','card-d'].forEach(id => document.getElementById(id).classList.remove('editing'));
  renderTable(); draw();
}

function saveEdit() {
  if (!editState) return;
  const k = getCurK();
  const b = editState.bi === allBoards.length ? getB() : (allBoards[editState.bi]?.b || getB());
  const d = editState.bi === allBoards.length ? getD() : (allBoards[editState.bi]?.d || getD());
  if (!knotPoints(k, b, d)) { showToast('Suk nemá dostatek bodů'); return; }
  if (editState.bi === allBoards.length) knots[editState.ki] = k;
  else allBoards[editState.bi].knots[editState.ki] = k;
  saveLocal(); cancelEdit();
}

// ── Add / New board ──────────────────────────────────────
function addKnot() {
  const k = getCurK();
  if (!knotPoints(k, getB(), getD())) { showToast('Zadej alespoň 3 body suku'); return; }
  knots.push(k); emptyEnterCount = 0;
  FIDS.forEach(f => document.getElementById(f).value = '');
  saveLocal(); renderTable(); draw();
  document.getElementById('as1').focus();
}

function newBoard() {
  if (knots.length) {
    allBoards.push({ id: getId(), b: getB(), d: getD(), knots: [...knots], savedAt: new Date().toISOString() });
  }
  knots = []; emptyEnterCount = 0;
  FIDS.forEach(f => document.getElementById(f).value = '');
  ['kar-val','dab-val','knot-count'].forEach(id => document.getElementById(id).textContent = '—');
  document.getElementById('dab-sub').textContent = '';
  document.getElementById('grade-wrap').innerHTML = '<span class="grade-pill grade-na">—</span>';
  saveLocal(); renderTable(); draw(); showToast('Nová deska');
  document.getElementById('as1').focus();
}

// ── Render table ─────────────────────────────────────────
function renderTable() {
  const wrap  = document.getElementById('tbl-wrap');
  const empty = document.getElementById('empty-state');
  const boards = [...allBoards];
  if (knots.length) boards.push({ id: getId(), b: getB(), d: getD(), knots: [...knots] });

  if (!boards.length) { wrap.style.display = 'none'; empty.style.display = ''; return; }
  wrap.style.display = ''; empty.style.display = 'none';

  let html = '';
  boards.forEach((board, bi) => {
    const { id, b, d, knots: bk } = board;
    const polys  = getAllPolys(bk, b, d);
    const uArea  = computeUnionArea(polys, b, d);
    const kar    = uArea / (b * d) * 100;
    const dab    = computeDAB(bk, b);
    const grade  = bk.length ? classifyBoard(kar, dab) : '—';
    bk.forEach((k, ki) => {
      const pts    = knotPoints(k, b, d);
      const area   = pts ? polyArea(pts) : 0;
      const ai     = knotAi(k, b);
      const vs     = FIDS.map(f => k[f] != null ? k[f] : '—');
      const isEd   = editState && editState.bi === bi && editState.ki === ki;
      const rc     = isEd ? ' class="erow"' : (ki === 0 && bi > 0 ? ' class="bsep"' : '');
      const isLast = ki === bk.length - 1;
      html += `<tr${rc}>
        <td>${id}</td><td>${ki + 1}</td>
        ${vs.map(v => `<td>${v}</td>`).join('')}
        <td>${area.toFixed(1)}</td>
        <td>${ai > 0 ? ai.toFixed(1) : '—'}</td>
        <td>${isLast ? `<b style="color:#185FA5">${kar.toFixed(2)}</b>` : ''}</td>
        <td>${isLast ? `<b style="color:#854F0B">${dab.toFixed(3)}</b>` : ''}</td>
        <td>${isLast ? `<span class="grade-pill ${gradeClass(grade)}" style="font-size:11px;padding:2px 8px">${grade}</span>` : ''}</td>
        <td>
          <button class="act-btn" onclick="enterEditMode(${bi},${ki})" aria-label="Upravit"><i class="ti ti-edit"></i></button>
          <button class="act-btn del" onclick="delKnot(${bi},${ki})" aria-label="Smazat"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    });
  });
  document.getElementById('tbody').innerHTML = html;
}

function delKnot(bi, ki) {
  if (editState && editState.bi === bi && editState.ki === ki) cancelEdit();
  if (bi < allBoards.length) {
    allBoards[bi].knots.splice(ki, 1);
    if (!allBoards[bi].knots.length) allBoards.splice(bi, 1);
  } else knots.splice(ki, 1);
  saveLocal(); renderTable(); draw();
}

// ── Local storage ────────────────────────────────────────
function saveLocal() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify({ allBoards, knots, boardId: getId(), b: getB(), d: getD() }));
  } catch(e) { console.warn('localStorage full', e); }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    allBoards = data.allBoards || [];
    knots     = data.knots     || [];
    if (data.boardId) document.getElementById('cid').value  = data.boardId;
    if (data.b)       document.getElementById('clen').value = data.b;
    if (data.d)       document.getElementById('cwid').value = data.d;
  } catch(e) { console.warn('loadLocal error', e); }
}

// ── Server sync ──────────────────────────────────────────
async function syncToServer() {
  if (!API_BASE) { showToast('API není nakonfigurováno'); return; }
  const boards = [...allBoards];
  if (knots.length) boards.push({ id: getId(), b: getB(), d: getD(), knots: [...knots], savedAt: new Date().toISOString() });
  if (!boards.length) { showToast('Žádná data k synchronizaci'); return; }

  const btn = document.getElementById('sync-btn');
  btn.innerHTML = '<i class="ti ti-loader"></i>';
  try {
    const res = await fetch(`${API_BASE}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boards })
    });
    if (!res.ok) throw new Error(res.statusText);
    setSyncStatus('ok', 'Synchronizováno ' + new Date().toLocaleTimeString('cs'));
    showToast('Synchronizováno ✓');
  } catch(e) {
    setSyncStatus('err', 'Chyba synchronizace');
    showToast('Synchronizace selhala');
  } finally {
    btn.innerHTML = '<i class="ti ti-cloud-upload"></i>';
  }
}

async function exportFromServer() {
  if (!API_BASE) { exportLocalExcel(); return; }
  try {
    const res = await fetch(`${API_BASE}/api/export`);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'suky_export.xlsx'; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { exportLocalExcel(); }
}

function exportLocalExcel() {
  const boards = [...allBoards];
  if (knots.length) boards.push({ id: getId(), b: getB(), d: getD(), knots: [...knots] });
  if (!boards.length) { showToast('Žádná data'); return; }
  const hdrs = ['board','b_mm','d_mm','knot','AS1','AS2','BS1','BS2','CS1','CS2','DS1','DS2','area_mm2','a_i_mm','KAR_%','DAB','třída'];
  const rows = [];
  boards.forEach(({ id, b, d, knots: bk }) => {
    const polys = getAllPolys(bk, b, d);
    const uArea = computeUnionArea(polys, b, d);
    const kar   = uArea / (b * d) * 100;
    const dab   = computeDAB(bk, b);
    const grade = bk.length ? classifyBoard(kar, dab) : '';
    bk.forEach((k, i) => {
      const pts  = knotPoints(k, b, d); const area = pts ? polyArea(pts) : 0;
      const ai   = knotAi(k, b);       const isLast = i === bk.length - 1;
      rows.push([id, b, d, i + 1, ...FIDS.map(f => k[f] != null ? k[f] : ''),
        +area.toFixed(1), ai > 0 ? +ai.toFixed(1) : '',
        isLast ? +kar.toFixed(2) : '', isLast ? +dab.toFixed(4) : '', isLast ? grade : '']);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Suky');
  XLSX.writeFile(wb, 'suky_export.xlsx');
}

// ── UI helpers ───────────────────────────────────────────
function setSyncStatus(type, msg) {
  const el = document.getElementById('sync-status');
  el.textContent = msg; el.className = 'sync-status ' + (type || '');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Event binding ────────────────────────────────────────
function bindEvents() {
  ['cid','clen','cwid'].forEach(id => document.getElementById(id).addEventListener('input', () => { saveLocal(); renderTable(); draw(); }));
  FIDS.forEach(id => document.getElementById(id).addEventListener('input', draw));

  document.getElementById('btn-add').addEventListener('click', () => { editState ? saveEdit() : addKnot(); });
  document.getElementById('btn-new').addEventListener('click', newBoard);
  document.getElementById('btn-cancel').addEventListener('click', cancelEdit);
  document.getElementById('sync-btn').addEventListener('click', syncToServer);
  document.getElementById('btn-export').addEventListener('click', exportFromServer);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editState) { cancelEdit(); return; }
    if (e.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
      if (editState) { saveEdit(); return; }
      const emp = FIDS.every(f => !document.getElementById(f).value.trim());
      if (emp) { emptyEnterCount++; if (emptyEnterCount >= 4) newBoard(); }
      else addKnot();
    }
  });

  window.addEventListener('online',  () => { isOnline = true;  document.getElementById('offline-bar').classList.remove('show'); setSyncStatus('ok', 'Online'); });
  window.addEventListener('offline', () => { isOnline = false; document.getElementById('offline-bar').classList.add('show'); setSyncStatus('err', 'Offline'); });
  window.addEventListener('resize', draw);
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
  loadLocal();
  bindEvents();
  renderTable();
  draw();
  if (!navigator.onLine) document.getElementById('offline-bar').classList.add('show');
});
