#!/usr/bin/env node
'use strict';
/*
 * kar.js — samostatný výpočet KAR (Knot Area Ratio) a DAB, stejně jako ve WoodGrader 26.
 * Bez závislostí, stačí Node.js 14+.
 *
 * POUŽITÍ
 *   node kar.js deska.json          # jedna deska nebo celá JSON záloha z aplikace
 *   node kar.js --b 156 --d 48 --knot "as1=20,as2=45,cs1=30,cs2=60" [--knot ...]
 *   node kar.js deska.json --json   # výstup jako JSON
 *
 * VSTUP (mm)
 *   b = šířka průřezu, d = výška (tloušťka) průřezu
 *   suk = souřadnice hran suku na jednotlivých plochách průřezu:
 *     as1, as2  plocha A (horní, měřeno od pravé hrany)
 *     bs1, bs2  plocha B (levá, měřeno od horní hrany)
 *     cs1, cs2  plocha C (spodní, měřeno od levé hrany)
 *     ds1, ds2  plocha D (pravá, měřeno od spodní hrany)
 *   Suk musí mít zadané aspoň 2 plochy (≥ 3 body), jinak se do KAR nepočítá.
 *
 *   JSON soubor může být:
 *     { "b":156, "d":48, "knots":[ {"as1":20,"as2":45,"cs1":30,"cs2":60}, ... ] }
 *     [ deska, deska, ... ]
 *     záloha z aplikace { "allBoards":[ ... ] }
 *
 * VÝSTUP
 *   KAR [%] = plocha sjednocení průmětů suků / (b·d) · 100
 *   DAB     = Σ šířek suků na všech plochách / (2·b)
 *   třída   = S13 / S10 / S7 / Reject, určuje se jen z DAB (DAB ≤ 1/5 → S13, ≤ 1/3 → S10,
 *             ≤ 1/2 → S7, jinak Reject). KAR se jen vypisuje. Plné hodnocení dle ČSN 73 2824-1
 *             s dalšími znaky zůstává v aplikaci.
 */

// Polygon suku v průřezu (souřadnice x ∈ [0,b], y ∈ [0,d], počátek vlevo dole)
function knotPolygon(k, b, d) {
  const p = [];
  const has = (a, c) => k[a] != null && k[c] != null;
  if (has('as1', 'as2')) { p.push([b - k.as1, d]); p.push([b - k.as2, d]); }
  if (has('bs1', 'bs2')) { p.push([0, d - k.bs1]); p.push([0, d - k.bs2]); }
  if (has('cs1', 'cs2')) { p.push([k.cs1, 0]); p.push([k.cs2, 0]); }
  if (has('ds1', 'ds2')) { p.push([b, k.ds1]); p.push([b, k.ds2]); }
  return p.length > 2 ? p : null;
}

// Plocha sjednocení polygonů [mm²]. Rastr s rozlišením R px/mm (aplikace používá R = 4),
// vyplnění pravidlem nonzero jako <canvas>, vzorkuje se ve středu pixelu.
function unionArea(polys, b, d, R = 4) {
  if (!polys.length) return 0;
  const W = Math.round(b * R) + 1, H = Math.round(d * R) + 1;
  const grid = new Uint8Array(W * H);
  for (const pts of polys) {
    const P = pts.map(([x, y]) => [x * R, H - 1 - y * R]); // stejná transformace jako v aplikaci
    for (let py = 0; py < H; py++) {
      const cy = py + 0.5;
      const xs = []; // průsečíky řádku s hranami + směr (pro nonzero)
      for (let i = 0; i < P.length; i++) {
        const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
        if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) {
          xs.push([x1 + (cy - y1) * (x2 - x1) / (y2 - y1), y2 > y1 ? 1 : -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, c) => a[0] - c[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1];
        if (wind === 0) continue;
        const from = Math.max(0, Math.ceil(xs[i][0] - 0.5));
        const to = Math.min(W - 1, Math.ceil(xs[i + 1][0] - 0.5) - 1);
        for (let px = from; px <= to; px++) grid[py * W + px] = 1;
      }
    }
  }
  let filled = 0;
  for (let i = 0; i < grid.length; i++) filled += grid[i];
  return filled / (R * R);
}

function calcDAB(knots, b) {
  if (!knots.length) return 0;
  let sum = 0;
  for (const k of knots) {
    for (const f of ['a', 'b', 'c', 'd']) {
      const s1 = k[f + 's1'], s2 = k[f + 's2'];
      if (s1 != null && s2 != null) sum += Math.abs(s2 - s1);
    }
  }
  return sum / (2 * b);
}

// Třída se určuje pouze z DAB.
function grade(dab, nKnots) {
  if (nKnots === 0) return 'OK';
  if (dab <= 1 / 5) return 'S13';
  if (dab <= 1 / 3) return 'S10';
  if (dab <= 1 / 2) return 'S7';
  return 'Reject';
}

function evaluateBoard(board) {
  const b = Number(board.b), d = Number(board.d), knots = board.knots || [];
  if (!(b > 0) || !(d > 0)) throw new Error(`Deska ${board.id ?? '?'}: chybí b nebo d`);
  const polys = knots.map(k => knotPolygon(k, b, d)).filter(Boolean);
  const area = unionArea(polys, b, d);
  const kar = (area / (b * d)) * 100;
  const dab = calcDAB(knots, b);
  return { id: board.id ?? null, b, d, knots: knots.length, unionArea_mm2: +area.toFixed(2),
           KAR_pct: +kar.toFixed(2), DAB: +dab.toFixed(4), grade: grade(dab, knots.length) };
}

// ── CLI ───────────────────────────────────────────────
function parseArgs(argv) {
  const o = { knots: [], json: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--b') o.b = parseFloat(argv[++i]);
    else if (a === '--d') o.d = parseFloat(argv[++i]);
    else if (a === '--knot') {
      const k = {};
      for (const part of argv[++i].split(',')) {
        const [key, val] = part.split('=').map(s => s.trim());
        k[key.toLowerCase()] = parseFloat(val.replace(',', '.'));
      }
      o.knots.push(k);
    } else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o.file = a;
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.file && o.b == null)) {
    console.log('Použití: node kar.js deska.json [--json]\n' +
                '         node kar.js --b 156 --d 48 --knot "as1=20,as2=45,cs1=30,cs2=60"');
    process.exit(o.help ? 0 : 1);
  }
  let boards;
  if (o.file) {
    const data = JSON.parse(require('fs').readFileSync(o.file, 'utf8'));
    boards = Array.isArray(data) ? data : (data.allBoards || [data]);
  } else {
    boards = [{ id: 'cli', b: o.b, d: o.d, knots: o.knots }];
  }
  const res = boards.map(evaluateBoard);
  if (o.json) { console.log(JSON.stringify(res, null, 2)); return; }
  for (const r of res) {
    console.log(`Deska ${r.id ?? '?'}  ${r.b}×${r.d} mm  suků: ${r.knots}  ` +
                `KAR = ${r.KAR_pct.toFixed(2)} %  DAB = ${r.DAB.toFixed(3)}  třída: ${r.grade}`);
  }
}

if (require.main === module) main();
module.exports = { knotPolygon, unionArea, calcDAB, grade, evaluateBoard };
