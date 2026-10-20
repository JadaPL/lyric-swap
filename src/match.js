/* ===== Lyrics table parsing, normalisation, and matching table lines to score slots ===== */

function normChars(s) {
  // returns { chars: string, wordStart: boolean[] } — lowercase letters/digits only, word starts flagged,
  // runs of 3+ identical letters collapsed to one ("Ahhhhh" -> "ah")
  const t = String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cs = []; const ws = []; let newWord = true;
  for (const ch of t) {
    if (/[\p{L}\p{N}]/u.test(ch)) { cs.push(ch); ws.push(newWord); newWord = false; }
    else if (/['’‘`]/.test(ch)) { /* apostrophe: same word */ }
    else newWord = true;
  }
  const oc = []; const ow = [];
  for (let i = 0; i < cs.length;) {
    let j = i; while (j < cs.length && cs[j] === cs[i] && (j === i || !ws[j])) j++;
    const n = j - i;
    const keep = n >= 3 ? 1 : n;
    for (let k = 0; k < keep; k++) { oc.push(cs[i]); ow.push(k === 0 ? ws[i] : false); }
    i = j;
  }
  return { chars: oc.join(''), wordStart: ow };
}

/* ---------- CSV ---------- */
function parseCSV(text, delim) {
  if (!delim) {
    const first = text.split(/\r?\n/).slice(0, 5).join('\n');
    const counts = { ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length, ';': (first.match(/;/g) || []).length };
    delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!counts[delim]) delim = ',';
  }
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"' && f === '') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const ORIG_HDR = /\b(orig|original|old|source|current|existing|score|from)\b/i;
const NEW_HDR = /\b(new|parody|alt|alternat\w*|replace\w*|revised|rewrite|rewritten|translation|translated|to|our|updated|lyrics?)\b/i;

/** Work out which columns hold original and new lyrics. Returns {header, origCol, newCol, notesCols, dataStart} */
function detectColumns(rows) {
  const maxCols = Math.max(0, ...rows.map((r) => r.length));
  let header = -1, origCol = -1, newCol = -1;
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const cells = rows[r].map((c) => (c || '').trim());
    if (cells.filter(Boolean).length < 2) continue;
    const o = cells.findIndex((c) => c.length < 40 && ORIG_HDR.test(c));
    const n = cells.findIndex((c, i) => i !== o && c.length < 40 && NEW_HDR.test(c) && !/suggest|note|comment|rhyme/i.test(c));
    if (o >= 0 && n >= 0) { header = r; origCol = o; newCol = n; break; }
  }
  if (header < 0) {
    // fall back: the two columns with the most text
    const fill = [];
    for (let c = 0; c < maxCols; c++) fill.push(rows.reduce((s, r) => s + ((r[c] || '').trim() ? 1 : 0), 0));
    const order = fill.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    origCol = Math.min(order[0], order[1] ?? order[0]); newCol = Math.max(order[0], order[1] ?? order[0]);
    if (origCol === newCol) newCol = -1;
  }
  return { header, origCol, newCol, dataStart: header + 1, maxCols };
}

/** Turn table rows into lyric entries (splitting multi-line cells). */
function buildEntries(rows, cols) {
  const entries = [];
  for (let r = Math.max(0, cols.dataStart); r < rows.length; r++) {
    const o = (rows[r][cols.origCol] || '').replace(/\r/g, '');
    const n = cols.newCol >= 0 ? (rows[r][cols.newCol] || '').replace(/\r/g, '') : '';
    if (!o.trim() && !n.trim()) continue;
    const ol = o.split('\n').map((s) => s.trim()).filter(Boolean);
    const nl = n.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ol.length > 1 && ol.length === nl.length) {
      ol.forEach((line, k) => entries.push({ id: entries.length, row: r + 1, sub: k + 1, original: line, replacement: nl[k] }));
    } else if (ol.length > 1 && nl.length === 0) {
      ol.forEach((line, k) => entries.push({ id: entries.length, row: r + 1, sub: k + 1, original: line, replacement: '' }));
    } else {
      entries.push({ id: entries.length, row: r + 1, sub: 0, original: ol.join(' '), replacement: nl.join(' ') });
    }
  }
  for (const e of entries) { const n = normChars(e.original); e.norm = n.chars; e.wordStart = n.wordStart; }
  return entries.filter((e) => e.norm.length > 0 || e.replacement);
}

/* ---------- Graph of syllable slots ---------- */
function buildGraph(slots, rows) {
  // slots must have: id, sys (global system index), rowId, x0, x1, norm; rows: {id, sys, lane, verse, slotIds}
  const order = slots.slice().sort((a, b) => (a.sys - b.sys) || (a.x0 - b.x0) || (b.y - a.y));
  const nodes = []; // {slot, k, ch}
  const slotStart = new Map(), slotEnd = new Map();
  for (const s of order) {
    if (!s.norm) continue;
    slotStart.set(s.id, nodes.length);
    for (let k = 0; k < s.norm.length; k++) nodes.push({ slot: s.id, k, ch: s.norm[k] });
    slotEnd.set(s.id, nodes.length - 1);
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const rowsBySys = new Map();
  for (const r of rows) { if (!rowsBySys.has(r.sys)) rowsBySys.set(r.sys, []); rowsBySys.get(r.sys).push(r); }
  const sysList = [...rowsBySys.keys()].sort((a, b) => a - b);
  const nextSys = new Map(); sysList.forEach((s, i) => nextSys.set(s, sysList[i + 1]));
  const firstNormSlot = (r, fromX = -1e9) => { for (const id of r.slotIds) { const s = slotById.get(id); if (s.norm && s.x0 > fromX) return s; } return null; };
  const lastNormSlot = (r) => { for (let i = r.slotIds.length - 1; i >= 0; i--) { const s = slotById.get(r.slotIds[i]); if (s.norm) return s; } return null; };
  // predecessor edges into slot-start nodes: preds[nodeIndex] = [[u, cost], ...]
  const preds = new Map();
  const addEdge = (fromSlot, toSlot, cost) => {
    const u = slotEnd.get(fromSlot.id), v = slotStart.get(toSlot.id);
    if (u == null || v == null || v <= u) return;
    if (!preds.has(v)) preds.set(v, []);
    const L = preds.get(v); const ex = L.find((p) => p[0] === u);
    if (ex) ex[1] = Math.min(ex[1], cost); else L.push([u, cost]);
  };
  for (const r of rows) {
    const ss = r.slotIds.map((id) => slotById.get(id)).filter((s) => s.norm);
    for (let i = 0; i + 1 < ss.length; i++) addEdge(ss[i], ss[i + 1], 0);
    const peers = (rowsBySys.get(r.sys) || []).filter((o) => o !== r && o.lane === r.lane);
    for (let i = 0; i < ss.length; i++) {
      for (const o of peers) { const t = firstNormSlot(o, ss[i].x1 + 0.2); if (t) addEdge(ss[i], t, 1.0); }
    }
    const last = lastNormSlot(r);
    const ns = nextSys.get(r.sys);
    if (last && ns != null) {
      for (const o of rowsBySys.get(ns)) {
        const t = firstNormSlot(o); if (!t) continue;
        const cost = o.lane === r.lane ? (o.verse === r.verse ? 0 : 0.4) : 1.2;
        addEdge(last, t, cost);
      }
    }
  }
  return { nodes, preds, slotStart, slotEnd, slotById, rowById };
}

/** Approximate matching of one line against the slot graph. Returns candidate occurrences. */
function matchLine(entry, G, opts = {}) {
  const c = entry.norm, m = c.length;
  const N = G.nodes.length;
  if (!m || !N) return [];
  const W = m + 1, INF = 1e9;
  const D = new Float32Array(N * W).fill(INF);
  const OP = new Int8Array(N * W);
  const PU = new Int32Array(N * W).fill(-1);
  const isStart = new Uint8Array(N), isEnd = new Uint8Array(N);
  for (const v of G.slotStart.values()) isStart[v] = 1;
  for (const v of G.slotEnd.values()) isEnd[v] = 1;
  const INS = 1, DEL = 1;
  for (let v = 0; v < N; v++) {
    const ch = G.nodes[v].ch;
    const delC = v > 0 && G.nodes[v - 1].ch === ch ? 0.25 : DEL;
    const pl = isStart[v] ? (G.preds.get(v) || []) : [[v - 1, 0]];
    for (let i = 0; i <= m; i++) {
      let best = INF, op = 0, pu = -1;
      if (i >= 1) {
        const sub = c[i - 1] === ch ? 0 : 1;
        if (isStart[v]) { const sc = (i - 1) * INS + sub + (i - 1 > 0 ? 1.5 : 0); if (sc < best) { best = sc; op = 1; pu = -1; } }
        for (const [u, e] of pl) { const val = D[u * W + i - 1] + e + sub; if (val < best) { best = val; op = 2; pu = u; } }
        const ins = D[v * W + i - 1] + (i >= 2 && c[i - 1] === c[i - 2] ? 0.25 : INS); if (ins < best) { best = ins; op = 4; pu = -1; }
      }
      for (const [u, e] of pl) { const val = D[u * W + i] + e + delC; if (val < best) { best = val; op = 3; pu = u; } }
      D[v * W + i] = best; OP[v * W + i] = op; PU[v * W + i] = pu;
    }
  }
  const minQ = m <= 6 ? 0.74 : m <= 12 ? 0.66 : 0.6;
  const ends = [];
  for (let v = 0; v < N; v++) if (isEnd[v]) { const cost = D[v * W + m]; const q = 1 - cost / m; if (q >= minQ) ends.push([cost, v]); }
  ends.sort((a, b) => a[0] - b[0]);
  const out = [];
  const K = opts.K || 14;
  for (const [cost, vEnd] of ends) {
    if (out.length >= K) break;
    // traceback
    let v = vEnd, i = m; const slotSeq = []; const align = []; // align: [lineIdx, nodeIdx]
    let guard = 0;
    while (guard++ < 100000) {
      const op = OP[v * W + i], pu = PU[v * W + i];
      const sid = G.nodes[v].slot;
      if (slotSeq[slotSeq.length - 1] !== sid) slotSeq.push(sid);
      if (op === 1) { align.push([i - 1, v]); break; }
      if (op === 2) { align.push([i - 1, v]); v = pu; i -= 1; continue; }
      if (op === 3) { v = pu; continue; }
      if (op === 4) { i -= 1; continue; }
      break;
    }
    slotSeq.reverse(); align.reverse();
    const set = new Set(slotSeq);
    if (out.some((o) => { let ov = 0; for (const s of o.slots) if (set.has(s)) ov++; return ov > 0.4 * Math.min(set.size, o.slots.length); })) continue;
    const first = G.slotById.get(slotSeq[0]), last = G.slotById.get(slotSeq[slotSeq.length - 1]);
    out.push({ entryId: entry.id, slots: slotSeq, cost, q: 1 - cost / m, align, t0: first.sys + first.x0 / 10000, t1: last.sys + last.x1 / 10000, sys0: first.sys, sys1: last.sys });
  }
  return out;
}

/** Choose a consistent set of occurrences across all entries (Viterbi over table order). */
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
/** Drop already-used syllables from the ends of a candidate and re-score it. */
function trimCandidate(cd, used, entry, slotById) {
  let a = 0, b = cd.slots.length;
  while (a < b && used.has(cd.slots[a])) a++;
  while (b > a && used.has(cd.slots[b - 1])) b--;
  const slots = cd.slots.slice(a, b);
  if (!slots.length || slots.some((x) => used.has(x))) return null;
  if (a === 0 && b === cd.slots.length) return cd;
  const text = slots.map((id) => slotById.get(id).norm).join('');
  const q = 1 - lev(entry.norm, text) / entry.norm.length;
  const first = slotById.get(slots[0]), last = slotById.get(slots[slots.length - 1]);
  return { ...cd, slots, q, t0: first.sys + first.x0 / 10000, t1: last.sys + last.x1 / 10000, sys0: first.sys, sys1: last.sys, trimmed: true };
}

function chooseOccurrences(entries, candsByEntry, slotById) {
  const items = entries.filter((e) => (candsByEntry.get(e.id) || []).length);
  const states = []; // {item index, cand}
  items.forEach((e, ii) => (candsByEntry.get(e.id) || []).forEach((cd) => states.push({ ii, cd, m: e.norm.length })));
  const gain = (s) => s.m * (s.cd.q - 0.45) * 2;
  const overlap = (a, b) => { const S = new Set(a.slots); return b.slots.some((x) => S.has(x)); };
  const trans = (a, b) => {
    const dt = b.t0 - a.t0;
    if (dt < -8) return null;
    if (overlap(a, b)) return null;
    let p = 0;
    if (dt < -0.05) p += 1 + (-dt) * 0.6;
    const gap = b.sys0 - a.sys1;
    if (gap > 1) p += 0.9 * (gap - 1);
    if (gap > 8) p += 2 * (gap - 8);
    return p;
  };
  const SKIP = 1.5, WINDOW = 14;
  const best = new Float64Array(states.length).fill(-1e18), back = new Int32Array(states.length).fill(-1);
  const byItem = new Map(); states.forEach((s, k) => { if (!byItem.has(s.ii)) byItem.set(s.ii, []); byItem.get(s.ii).push(k); });
  for (let k = 0; k < states.length; k++) {
    const s = states[k];
    let b = gain(s) - SKIP * s.ii * 0.15 - s.cd.sys0 * 0.05, bk = -1;
    for (let jj = Math.max(0, s.ii - WINDOW); jj < s.ii; jj++) {
      for (const kp of byItem.get(jj) || []) {
        if (best[kp] <= -1e17) continue;
        const t = trans(states[kp].cd, s.cd); if (t == null) continue;
        const val = best[kp] + gain(s) - t - SKIP * (s.ii - jj - 1);
        if (val > b) { b = val; bk = kp; }
      }
    }
    best[k] = b; back[k] = bk;
  }
  // best final state: allow trailing skips
  let fk = -1, fv = -1e18;
  for (let k = 0; k < states.length; k++) { const v = best[k] - SKIP * (items.length - 1 - states[k].ii); if (v > fv) { fv = v; fk = k; } }
  const chosen = [];
  for (let k = fk; k >= 0; k = back[k]) chosen.push(states[k]);
  chosen.reverse();
  // keep earlier table lines when two picks share syllables
  const result = [];
  const used = new Set();
  for (const st of chosen) {
    if (st.cd.slots.some((x) => used.has(x))) continue;
    result.push({ ...st.cd }); st.cd.slots.forEach((x) => used.add(x));
  }
  const free = (o) => o.slots.every((x) => !used.has(x));
  const chosenIdx = new Map(); result.forEach((o) => chosenIdx.set(o.entryId, o));
  const order = entries.map((e) => e.id);
  // second chance for unplaced lines, inside the time window of their neighbours, nearest first
  for (let i = 0; i < order.length; i++) {
    const id = order[i]; if (chosenIdx.has(id)) continue;
    let prev = null, next = null;
    for (let j = i - 1; j >= 0 && !prev; j--) prev = chosenIdx.get(order[j]) || null;
    for (let j = i + 1; j < order.length && !next; j++) next = chosenIdx.get(order[j]) || null;
    const lo = prev ? prev.t0 - 2.5 : -1e9;
    const hi = Math.max(next ? next.t0 : -1e9, prev ? prev.t1 : -1e9) + 3;
    const expect = prev ? prev.t1 : (next ? next.t0 : 0);
    const entry = entries.find((e) => e.id === id);
    const pool = (candsByEntry.get(id) || []).map((cd) => (slotById ? trimCandidate(cd, used, entry, slotById) : (free(cd) ? cd : null)))
      .filter((cd) => cd && cd.t0 >= lo && (hi < -1e8 || cd.t0 <= hi) && cd.q >= 0.66);
    pool.sort((a, b) => (b.q - 0.12 * Math.abs(b.t0 - expect)) - (a.q - 0.12 * Math.abs(a.t0 - expect)));
    const c = pool[0];
    if (c) { const o = { ...c, late: true }; result.push(o); c.slots.forEach((x) => used.add(x)); chosenIdx.set(id, o); }
  }
  // simultaneous duplicates (same words sung on another staff or verse at the same time)
  for (const o of result.slice()) {
    for (const cd of candsByEntry.get(o.entryId) || []) {
      if (!free(cd)) continue;
      if (cd.q >= Math.max(0.8, o.q - 0.12) && Math.abs(cd.t0 - o.t0) <= 1.3) { result.push({ ...cd, duplicate: true }); cd.slots.forEach((x) => used.add(x)); }
    }
  }
  result.sort((a, b) => a.t0 - b.t0);
  return result;
}

/**
 * Uncovered syllables that repeat a nearby matched line (an echo on another staff, or the second half of it)
 * follow that line's syllables. Returns Map(followerSlotId -> leaderSlotId).
 */
function findFollowers(rows, slotById, chosen) {
  const used = new Set(); chosen.forEach((o) => o.slots.forEach((x) => used.add(x)));
  const runs = [];
  for (const r of rows) {
    let cur = [];
    for (const id of r.slotIds) {
      const s = slotById.get(id);
      if (!used.has(id) && s.norm) cur.push(id); else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }
  const follow = new Map();
  const simS = (a, b) => (a === b ? 2 : (a.length >= 3 && b.length >= 3 && lev(a, b) <= 1) ? 1 : -1);
  for (const run of runs) {
    let remaining = run.slice();
    for (let guard = 0; guard < 4 && remaining.length; guard++) {
      const t0 = slotById.get(remaining[0]).sys;
      let best = null;
      for (const o of chosen) {
        if (Math.abs(o.sys0 - t0) > 2.5 && Math.abs(o.sys1 - t0) > 2.5) continue;
        const A = remaining.map((id) => slotById.get(id).norm), B = o.slots.map((id) => slotById.get(id).norm);
        // Smith-Waterman on syllables
        const H = Array.from({ length: A.length + 1 }, () => new Float32Array(B.length + 1));
        let bv = 0, bi = 0, bj = 0;
        for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) {
          const v = Math.max(0, H[i - 1][j - 1] + simS(A[i - 1], B[j - 1]), H[i - 1][j] - 1.5, H[i][j - 1] - 1.5);
          H[i][j] = v; if (v > bv) { bv = v; bi = i; bj = j; }
        }
        if (bv < 3.5) continue;
        const pairs = []; let i = bi, j = bj;
        while (i > 0 && j > 0 && H[i][j] > 0) {
          if (Math.abs(H[i][j] - (H[i - 1][j - 1] + simS(A[i - 1], B[j - 1]))) < 1e-4) { if (simS(A[i - 1], B[j - 1]) > 0) pairs.push([remaining[i - 1], o.slots[j - 1]]); i--; j--; }
          else if (Math.abs(H[i][j] - (H[i - 1][j] - 1.5)) < 1e-4) i--; else j--;
        }
        if (!best || bv > best.bv) best = { bv, pairs, o };
      }
      if (!best || best.pairs.length < 2) break;
      for (const [f, l] of best.pairs) follow.set(f, l);
      remaining = remaining.filter((id) => !follow.has(id));
    }
  }
  return follow;
}

if (typeof module !== 'undefined') module.exports = { normChars, parseCSV, detectColumns, buildEntries, buildGraph, matchLine, chooseOccurrences, findFollowers, lev };
