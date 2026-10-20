/* ===== Layout analysis: glyphs -> tokens -> staves -> lyric rows -> slots ===== */
const EXPRESSION_WORDS = new Set(('cresc crescendo decresc decrescendo dim diminuendo unis unison div divisi rit ritard ritardando rall rallentando ' +
  'accel accelerando tempo a poco molto piu più meno sub subito sempre simile solo soli tutti opt optional legato staccato marcato ' +
  'mp mf p pp ppp f ff fff fp sf sfz sfp rf rfz fz n niente al fine coda segno dc ds da capo dal to tacet hum humming oo ooh aah ' +
  'soprano sopranos alto altos tenor tenors bass basses baritone baritones treble mezzo descant women men all ' +
  'gliss glissando arco pizz pizzicato con sord senza ped pedal colla voce ad lib libitum rubato fermata breath spoken ' +
  'freely slowly moderato allegro andante adagio largo lento presto vivace swing straight driving ballad').split(/\s+/));
const INSTRUMENT_RE = /^(pno|piano|pianoforte|pf|org|organ|kbd|keyboard|keys|synth|harp|hp|gtr|guitar|gt|vln|vl|violin|vla|viola|vc|vlc|cello|violoncello|cb|db|contrabass|fl|flute|ob|oboe|cl|clar|clarinet|bsn|bassoon|hn|horn|tpt|trumpet|tbn|trombone|tba|tuba|perc|percussion|drums?|dr|timp|timpani|bass guitar|e\.? ?bass|bs gtr|accomp|acc|accompaniment|rehearsal|reduction|cembalo|celesta|vib|marimba|xyl)$/;

function normLabel(s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function isSubsequence(a, b) { let i = 0; for (const c of b) if (c === a[i]) i++; return i === a.length; }

function buildTokens(glyphs) {
  const gs = glyphs.filter((g) => g.upright && g.ch && g.x1 > g.x0 - 0.01);
  // bucket by baseline & size
  gs.sort((a, b) => (b.y - a.y) || (a.x0 - b.x0));
  const lines = [];
  for (const g of gs) {
    let line = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 40; i--) {
      const L = lines[i];
      if (Math.abs(L.y - g.y) < 0.15 * g.size && Math.abs(L.size - g.size) < 0.6) { line = L; break; }
    }
    if (!line) { line = { y: g.y, size: g.size, gl: [] }; lines.push(line); }
    line.gl.push(g);
  }
  const tokens = [];
  for (const L of lines) {
    L.gl.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    const flush = () => { if (cur && cur.gl.length) tokens.push(finishToken(cur)); cur = null; };
    for (const g of L.gl) {
      const isSpace = /^\s+$/.test(g.ch);
      if (isSpace) { flush(); continue; }
      const music = /[-]/.test(g.ch);
      if (cur) {
        const gap = g.x0 - cur.x1;
        const sameKind = cur.music === music;
        if (!sameKind || gap > 0.065 * g.size || gap < -0.5 * g.size || Math.abs(g.size - cur.size) > 0.6) flush();
      }
      if (!cur) cur = { gl: [], x1: -1e9, size: g.size, music };
      cur.gl.push(g); cur.x1 = Math.max(cur.x1, g.x1);
    }
    flush();
  }
  // split tokens like "ey,what" at punctuation directly followed by a letter
  const out = [];
  for (const t of tokens) {
    let cur = t;
    for (;;) {
      const m = cur.music ? null : /[,;:!?.)\]](?=[\p{L}])/u.exec(cur.text);
      if (!m || !cur.glyphs || cur.glyphs.length !== [...cur.text].length) { out.push(cur); break; }
      const k = [...cur.text.slice(0, m.index + 1)].length;
      const a = finishToken({ gl: cur.gl.slice(0, k), music: false }), b = finishToken({ gl: cur.gl.slice(k), music: false });
      out.push(a); cur = b;
    }
  }
  return out;
}
function finishToken(c) {
  const gl = c.gl;
  const text = gl.map((g) => g.ch).join('').normalize('NFKC');
  const fonts = {}; for (const g of gl) fonts[g.fontId] = (fonts[g.fontId] || 0) + 1;
  const fontId = +Object.keys(fonts).sort((a, b) => fonts[b] - fonts[a])[0];
  return {
    text, x0: Math.min(...gl.map((g) => g.x0)), x1: Math.max(...gl.map((g) => g.x1)),
    y: gl[0].y, top: Math.max(...gl.map((g) => g.top)), bot: Math.min(...gl.map((g) => g.bot)),
    size: gl[0].size, fontId, italic: gl.some((g) => g.italic), bold: gl.some((g) => g.bold), music: c.music,
    glyphs: gl.map((g) => ({ ch: g.ch, x0: g.x0, x1: g.x1 })), fontName: gl[0].fontName, gl,
  };
}

function findStaves(segs) {
  // merge collinear horizontal stroke/fill segments into long lines
  const hs = segs.filter((s) => s.w < 1.5).map((s) => ({ ...s })).sort((a, b) => (b.y - a.y) || (a.x0 - b.x0));
  const merged = [];
  for (const s of hs) {
    const m = merged.find((L) => Math.abs(L.y - s.y) < 0.3 && s.x0 <= L.x1 + 2.5 && s.x1 >= L.x0 - 2.5);
    if (m) { m.x0 = Math.min(m.x0, s.x0); m.x1 = Math.max(m.x1, s.x1); }
    else merged.push({ x0: s.x0, x1: s.x1, y: s.y, w: s.w });
  }
  const long = merged.filter((L) => L.x1 - L.x0 > 40).sort((a, b) => b.y - a.y);
  const used = new Set();
  const staves = [];
  for (let i = 0; i < long.length; i++) {
    if (used.has(i)) continue;
    const a = long[i];
    // candidate next lines below that overlap horizontally
    const cand = [];
    for (let j = i + 1; j < long.length && cand.length < 12; j++) {
      const b = long[j];
      if (a.y - b.y > 60) break;
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (ov > 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0) && !used.has(j)) cand.push(j);
    }
    for (const j1 of cand) {
      const sp = a.y - long[j1].y;
      if (sp < 2.5 || sp > 14) continue;
      const chain = [i, j1];
      let lastY = long[j1].y;
      for (const j of cand) {
        if (chain.length === 5) break;
        if (chain.includes(j)) continue;
        const d = lastY - long[j].y;
        if (Math.abs(d - sp) < 0.15 * sp) { chain.push(j); lastY = long[j].y; }
      }
      if (chain.length === 5) {
        chain.forEach((k) => used.add(k));
        const ls = chain.map((k) => long[k]);
        staves.push({ x0: Math.min(...ls.map((l) => l.x0)), x1: Math.max(...ls.map((l) => l.x1)), top: a.y, bottom: lastY, space: sp });
        break;
      }
    }
  }
  staves.sort((a, b) => b.top - a.top);
  return staves;
}

function groupSystems(staves, vsegs) {
  const systems = [];
  let cur = null;
  for (let i = 0; i < staves.length; i++) {
    const s = staves[i];
    if (cur) {
      const prev = cur.staves[cur.staves.length - 1];
      const linked = vsegs.some((v) => Math.abs(v.x - s.x0) < 2.5 && v.y0 <= s.top + 1 && v.y1 >= prev.bottom - 1 && (v.y1 - v.y0) > (prev.bottom - s.top) * 0.9);
      const sameEdges = Math.abs(prev.x0 - s.x0) < 3 && Math.abs(prev.x1 - s.x1) < 3;
      if (linked || (sameEdges && !vsegs.length)) { cur.staves.push(s); continue; }
    }
    cur = { staves: [s] }; systems.push(cur);
  }
  systems.forEach((sys, i) => { sys.index = i; sys.staves.forEach((s, k) => { s.system = i; s.idxInSystem = k; }); });
  return systems;
}

function isExpressionToken(t) {
  const w = t.text.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
  if (!w) return true;
  return w.split(' ').every((p) => EXPRESSION_WORDS.has(p));
}

/** Analyse one page's raw extraction into lyric rows. */
function analyzeVectorPage(raw, pageIndex) {
  const tokens = buildTokens(raw.glyphs);
  const staves = findStaves(raw.segs);
  const systems = groupSystems(staves, raw.vsegs);
  // labels
  for (const s of staves) {
    const cands = tokens.filter((t) => !t.music && /\p{L}/u.test(t.text) && t.x1 < s.x0 - 1 && t.x0 < s.x0 - 3);
    let best = null, bd = 1e9;
    for (const t of cands) {
      const cy = (t.top + t.bot) / 2; const mid = (s.top + s.bottom) / 2;
      const d = Math.abs(cy - mid);
      if (d < 2.6 * s.space + (s.top - s.bottom) / 2 && d < bd) { bd = d; best = t; }
    }
    s.label = best ? best.text : '';
    if (best) best.isLabel = true;
  }
  // grand staff label (e.g. "Pno." centred between two staves) -> both staves
  for (const sys of systems) for (let k = 0; k + 1 < sys.staves.length; k++) {
    const a = sys.staves[k], b = sys.staves[k + 1];
    if (!a.label || !b.label || a.label !== b.label) continue;
  }
  // lyric candidates
  const rowsMap = [];
  for (const t of tokens) {
    if (t.music || t.isLabel) continue;
    if (!/[\p{L}\p{N}\-–_‿]/u.test(t.text)) continue;
    // staff directly above
    let above = null, d = 1e9;
    for (const s of staves) {
      if (t.top > s.bottom + 0.2 * s.space) continue; // not below this staff
      if (t.x0 < s.x0 - 2 || t.x1 > s.x1 + 6 * s.space) continue;
      const dd = s.bottom - t.y;
      if (dd >= 0 && dd < d) { d = dd; above = s; }
    }
    if (!above) continue;
    if (d > 14 * above.space) continue;
    let row = rowsMap.find((r) => r.staff === above && Math.abs(r.y - t.y) < 0.3 * t.size && Math.abs(r.size - t.size) < 0.6);
    if (!row) { row = { staff: above, y: t.y, size: t.size, tokens: [] }; rowsMap.push(row); }
    row.tokens.push(t);
  }
  for (const r of rowsMap) r.tokens.sort((a, b) => a.x0 - b.x0);
  return { pageIndex, tokens, staves, systems, rows: rowsMap, segs: raw.segs, vsegs: raw.vsegs, images: raw.images };
}

if (typeof module !== 'undefined') module.exports = { analyzeVectorPage, buildTokens, findStaves, isExpressionToken, normLabel, isSubsequence, INSTRUMENT_RE, EXPRESSION_WORDS };
