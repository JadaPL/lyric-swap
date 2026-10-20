/* ===== Scanned pages: find staves and lyric syllables in the image, let Claude read them ===== */

/** Pure image analysis on a grayscale buffer. Returns staves, candidate rows with syllable boxes (pixel space). */
function analyzeScanImage(gray, W, H) {
  // Otsu threshold
  const hist = new Uint32Array(256); for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = gray.length - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF; const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  const bin = new Uint8Array(W * H); for (let i = 0; i < bin.length; i++) bin[i] = gray[i] < thr ? 1 : 0;
  // background = median of light pixels
  let cnt = 0, acc = 0; for (let i = 0; i < gray.length; i += 7) if (gray[i] >= thr) { acc += gray[i]; cnt++; }
  const bgLevel = cnt ? acc / cnt : 255;
  // skew: maximise projection sharpness over small angles
  // (sample every row: skipping rows biases the search toward zero tilt)
  const pts = []; for (let y = 0; y < H; y++) for (let x = (y * 7) % 3; x < W; x += 3) if (bin[y * W + x]) pts.push(x, y);
  const sharp = (a) => {
    const t = Math.tan(a * Math.PI / 180); const proj = new Float32Array(H + 1);
    for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] - (pts[i] - W / 2) * t); if (yy >= 0 && yy < H) proj[yy]++; }
    let s = 0; for (let y = 0; y < H; y++) s += proj[y] * proj[y];
    return s;
  };
  let bestA = 0, bestS = -1;
  for (let a = -2; a <= 2.0001; a += 0.1) { const s = sharp(a); if (s > bestS) { bestS = s; bestA = a; } }
  for (let a = bestA - 0.08; a <= bestA + 0.0801; a += 0.02) { const s = sharp(a); if (s > bestS) { bestS = s; bestA = a; } }
  const tanA = Math.tan(bestA * Math.PI / 180);
  const dy = (x, y) => y - (x - W / 2) * tanA;
  // staff lines from deskewed projection
  const proj = new Float32Array(H + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bin[y * W + x]) { const yy = Math.round(dy(x, y)); if (yy >= 0 && yy < H) proj[yy]++; }
  const lines = [];
  for (let y = 1; y < H - 1; y++) {
    if (proj[y] >= 0.3 * W && proj[y] >= proj[y - 1] && proj[y] >= proj[y + 1]) {
      const last = lines[lines.length - 1];
      if (last && y - last.y <= 2) { if (proj[y] > last.v) { last.y = y; last.v = proj[y]; } }
      else lines.push({ y, v: proj[y] });
    }
  }
  const staves = [];
  for (let i = 0; i + 4 < lines.length; i++) {
    const g = lines.slice(i, i + 5).map((l) => l.y);
    const gaps = g.slice(1).map((v, k) => v - g[k]);
    const m = gaps.reduce((a, b) => a + b, 0) / 4;
    if (m < 5 || m > 45) continue;
    if (gaps.every((d) => Math.abs(d - m) < 0.22 * m)) { staves.push({ top: g[0], bottom: g[4], space: m }); i += 4; }
  }
  // staff horizontal extent: columns where at least two of three staff lines are dark
  for (const s of staves) {
    const lineYs = [s.top, s.top + 2 * s.space, s.bottom];
    let x0 = -1, x1 = -1;
    for (let x = 0; x < W; x++) {
      let hits = 0;
      for (const ly of lineYs) {
        const y = Math.round(ly + (x - W / 2) * tanA); let dark = false;
        for (let d = -1; d <= 1 && !dark; d++) if (y + d >= 0 && y + d < H && bin[(y + d) * W + x]) dark = true;
        if (dark) hits++;
      }
      if (hits >= 2) { if (x0 < 0) x0 = x; x1 = x; }
    }
    s.x0 = x0; s.x1 = x1;
  }
  const sp = staves.length ? staves.map((s) => s.space).sort((a, b) => a - b)[Math.floor(staves.length / 2)] : 12;
  // connected components (4-connectivity)
  const lab = new Int32Array(W * H); const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  let next = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!bin[i]) continue;
    const up = y ? lab[i - W] : 0, lf = x ? lab[i - 1] : 0;
    if (!up && !lf) { lab[i] = next; parent.push(next); next++; }
    else if (up && lf) { const a = find(up), b = find(lf); lab[i] = Math.min(a, b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    else lab[i] = up || lf;
  }
  const box = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lab[y * W + x]; if (!l) continue; const r = find(l);
    let b = box.get(r); if (!b) { b = { x0: x, x1: x, y0: y, y1: y, n: 0 }; box.set(r, b); }
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; b.n++;
  }
  const ccs = [...box.values()].map((b) => ({ ...b, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, cy: dy((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), by: dy((b.x0 + b.x1) / 2, b.y1), ty: dy((b.x0 + b.x1) / 2, b.y0) }));
  const inStaff = (c) => staves.some((s) => c.by > s.top - 0.4 * s.space && c.ty < s.bottom + 0.4 * s.space && c.x1 > s.x0 && c.x0 < s.x1);
  const letters = ccs.filter((c) => c.h >= 0.45 * sp && c.h <= 2.4 * sp && c.w <= 4 * sp && c.w >= 0.12 * sp && !inStaff(c) && !(c.n / (c.w * c.h) > 0.72 && c.w > 0.8 * sp && c.w < 1.8 * sp && c.h < 1.4 * sp));
  const smalls = ccs.filter((c) => c.h < 0.45 * sp && c.w < 4 * sp && !inStaff(c) && c.n >= 3);
  const thin = ccs.filter((c) => c.h <= 0.35 * sp && c.w >= Math.max(3, 1.3 * c.h) && !inStaff(c));
  // rows by vertical centre
  letters.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const c of letters) {
    let r = rows.find((R) => Math.abs(R.cy - c.cy) < 0.55 * Math.max(R.h, c.h) && Math.abs(R.h - c.h) < 1.2 * R.h);
    if (!r) { r = { cy: c.cy, h: c.h, ccs: [] }; rows.push(r); }
    r.ccs.push(c); r.cy = r.ccs.reduce((a, b) => a + b.cy, 0) / r.ccs.length; r.h = r.ccs.map((q) => q.h).sort((a, b) => a - b)[Math.floor(r.ccs.length / 2)];
  }
  // merge rows that are really one line (tall and short letters clustered apart)
  rows.sort((a, b) => a.cy - b.cy);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i], B = rows[j];
      if (!A.ccs.length || !B.ccs.length) continue;
      const bA = A.ccs.map((c) => c.by).sort((p, q) => p - q)[Math.floor(A.ccs.length * 0.4)];
      const bB = B.ccs.map((c) => c.by).sort((p, q) => p - q)[Math.floor(B.ccs.length * 0.4)];
      const hh = Math.max(A.h, B.h);
      if (Math.abs(bA - bB) < 0.45 * hh || Math.abs(A.cy - B.cy) < 0.5 * hh) { A.ccs.push(...B.ccs); B.ccs = []; A.cy = A.ccs.reduce((p, c) => p + c.cy, 0) / A.ccs.length; A.h = Math.max(A.h, B.h); }
    }
  }
  const out = [];
  for (const r of rows) {
    if (r.ccs.length < 2) continue;
    r.ccs.sort((a, b) => a.x0 - b.x0);
    const hs = r.ccs.map((c) => c.h).sort((a, b) => a - b);
    const xh = hs[Math.floor(hs.length * 0.35)], capH = hs[Math.floor(hs.length * 0.85)];
    const bottoms = r.ccs.map((c) => c.by).sort((a, b) => a - b);
    const base = bottoms[Math.floor(bottoms.length * 0.4)];
    const em = Math.max(capH / 0.7, xh / 0.47);
    // staff above
    let staff = null, d = 1e9;
    for (const s of staves) { const dd = base - s.bottom; if (dd > 0 && dd < d && r.ccs[0].x0 > s.x0 - 3 * s.space) { d = dd; staff = s; } }
    if (!staff || d > 14 * staff.space) continue;
    // marks in this row band
    const marks = thin.filter((c) => c.cy > base - 0.75 * em && c.cy < base + 0.2 * em && c.x0 >= r.ccs[0].x0 - 8 * em && c.x1 <= r.ccs[r.ccs.length - 1].x1 + 20 * em)
      .map((c) => ({ ...c, kind: (base - c.cy) > 0.14 * em && c.w < 1.4 * em ? 'hy' : 'ext' }));
    // syllable groups
    const groups = []; let cur = null;
    for (const c of r.ccs) {
      const gap = cur ? c.x0 - cur.x1 : 1e9;
      const hyIn = cur && marks.some((m) => m.kind === 'hy' && m.x0 >= cur.x1 - 1 && m.x1 <= c.x0 + 1);
      if (!cur || gap > 0.2 * em || hyIn) { cur = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, ccs: [c] }; groups.push(cur); }
      else { cur.ccs.push(c); cur.x1 = Math.max(cur.x1, c.x1); cur.y0 = Math.min(cur.y0, c.y0); cur.y1 = Math.max(cur.y1, c.y1); }
    }
    // punctuation / dots attach to nearest group
    for (const s of smalls) {
      if (s.cy < base - 1.0 * em || s.cy > base + 0.35 * em) continue;
      if (marks.some((m) => m.x0 === s.x0 && m.y0 === s.y0)) continue;
      let g = null, gd = 1e9;
      for (const q of groups) { const dd = Math.max(q.x0 - s.x1, s.x0 - q.x1, 0); if (dd < gd) { gd = dd; g = q; } }
      if (g && gd < 0.6 * em) { g.ccs.push(s); g.x0 = Math.min(g.x0, s.x0); g.x1 = Math.max(g.x1, s.x1); g.y0 = Math.min(g.y0, s.y0); g.y1 = Math.max(g.y1, s.y1); }
    }
    const units = [...new Set(groups.flatMap((g) => g.ccs))].sort((a, b) => a.x0 - b.x0);
    out.push({ staff, base, em, xh, capH, groups, marks, ccs: r.ccs, units, x0: r.ccs[0].x0, x1: r.ccs[r.ccs.length - 1].x1 });
  }
  out.sort((a, b) => a.base - b.base);
  return { staves, rows: out, bgLevel, thr, skew: bestA, sp };
}

/**
 * Partition a row's ink (letters and punctuation, left to right) into one group per read syllable,
 * matching each group's width to its text length and preferring wide gaps as boundaries.
 */
function regroup(row, words) {
  const U = row.units && row.units.length ? row.units : row.ccs;
  const k = words.length, n = U.length;
  if (!k || n < k) return null;
  const clean = words.map((w) => w.replace(/-$/, ''));
  const chars = clean.map((w) => Math.max(1, [...w].length));
  const inkW = U.reduce((a, c) => a + c.w, 0);
  const cw = inkW / chars.reduce((a, b) => a + b, 0);
  const T = 0.22 * row.em;
  const gap = (i) => U[i + 1].x0 - U[i].x1; // gap after unit i
  const hyAfter = (i) => row.marks.some((m) => m.kind === 'hy' && m.x0 >= U[i].x1 - 2 && m.x1 <= U[i + 1].x0 + 2);
  const INF = 1e18;
  const f = Array.from({ length: n + 1 }, () => new Float64Array(k + 1).fill(INF));
  const bk = Array.from({ length: n + 1 }, () => new Int32Array(k + 1).fill(-1));
  f[0][0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n - (k - j); i++) {
      let inner = 0; let blocked = false;
      for (let a = i - 1; a >= j - 1; a--) {
        // group = units a..i-1
        if (a < i - 1) { const g = gap(a); if (hyAfter(a)) { blocked = true; } inner += g > T ? (g - T) / T * 2 : 0; }
        if (blocked) break;
        if (f[a][j - 1] >= INF) continue;
        const W = U[i - 1].x1 - U[a].x0;
        let c = Math.abs(W - chars[j - 1] * cw) / cw + inner;
        if (a > 0) { const g = gap(a - 1); c += g < T ? (T - g) / T * 3 : 0; }
        const v = f[a][j - 1] + c;
        if (v < f[i][j]) { f[i][j] = v; bk[i][j] = a; }
      }
    }
  }
  if (f[n][k] >= INF) return null;
  const groups = []; let i = n;
  for (let j = k; j >= 1; j--) {
    const a = bk[i][j]; const cc = U.slice(a, i);
    groups.unshift({ x0: Math.min(...cc.map((c) => c.x0)), x1: Math.max(...cc.map((c) => c.x1)), y0: Math.min(...cc.map((c) => c.y0)), y1: Math.max(...cc.map((c) => c.y1)), ccs: cc });
    i = a;
  }
  return groups;
}

/** Render scanned pages, find lyric rows, ask Claude to read them, and add them to state.model. */
async function scanPages(pages) {
  const sample = await samplePromise;
  let limits = null; try { limits = sample ? await sample.limits() : null; } catch (e) { limits = null; }
  const testReader = window.__scanReader || null;
  if (testReader) limits = { images: { maxCount: 4 } };
  if (!testReader && (!sample || !limits || !limits.images)) {
    flash('step1-msg', pages.length === state.pdf.numPages
      ? 'This score is a scan. Reading lyrics from an image needs Claude, which is only available when this page is opened in Claude. Use a PDF exported from notation software instead, or open the page in Claude.'
      : `Pages ${pages.map((p) => p.index + 1).join(', ')} are scanned images, so their lyrics can’t be read here. The other pages will still be matched.`);
    return pages.length !== state.pdf.numPages;
  }
  const model = state.model;
  state.scan = { bg: {} };
  let sysBase = model.rows.reduce((m, r) => Math.max(m, r.sys + 1), 0);
  const allMarks = { hy: [], ext: [] };
  const maxImgs = Math.max(1, Math.min(limits.images.maxCount || 1, 4));
  for (const pinfo of pages) {
    const pi = pinfo.index;
    progress(0.7, `Reading scanned page ${pi + 1}…`); await tick();
    const page = await state.pdf.getPage(pi + 1);
    const base = page.getViewport({ scale: 1 });
    const S = Math.min(2.9, 2400 / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale: S });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    const gray = new Uint8Array(cv.width * cv.height);
    let rs = 0, gs = 0, bs = 0, nb = 0;
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      const v = (id.data[j] * 0.299 + id.data[j + 1] * 0.587 + id.data[j + 2] * 0.114) | 0; gray[i] = v;
      if (v > 200 && (i % 13 === 0)) { rs += id.data[j]; gs += id.data[j + 1]; bs += id.data[j + 2]; nb++; }
    }
    if (nb) state.scan.bg[pi] = { bg: [rs / nb / 255, gs / nb / 255, bs / nb / 255] };
    const an = analyzeScanImage(gray, cv.width, cv.height);
    if (!an.rows.length) continue;
    // stacked strips for Claude
    const pad = 6;
    const strips = an.rows.map((r, i) => {
      const y0 = Math.max(0, Math.round(Math.min(...r.ccs.map((c) => c.y0)) - 0.5 * r.em)), y1 = Math.min(cv.height, Math.round(Math.max(...r.ccs.map((c) => c.y1)) + 0.4 * r.em));
      const x0 = Math.max(0, Math.round(r.x0 - 1.2 * r.em)), x1 = Math.min(cv.width, Math.round(r.x1 + 1.2 * r.em));
      return { i, x0, x1, y0, y1 };
    });
    const sc = 0.72;
    const batches = []; let curB = []; let hAcc = 0;
    for (const s of strips) {
      const h = (s.y1 - s.y0) * sc + pad * 2;
      if (curB.length && (hAcc + h > 1100 || curB.length >= 14)) { batches.push(curB); curB = []; hAcc = 0; }
      curB.push(s); hAcc += h;
    }
    if (curB.length) batches.push(curB);
    const reads = new Map();
    for (let bi = 0; bi < batches.length; bi += maxImgs) {
      const group = batches.slice(bi, bi + maxImgs);
      const blobs = [];
      for (const b of group) {
        const wMax = Math.max(...b.map((s) => s.x1 - s.x0)) * sc + 60;
        const hTot = b.reduce((a, s) => a + (s.y1 - s.y0) * sc + pad * 2, 0);
        const c = document.createElement('canvas'); c.width = Math.ceil(wMax); c.height = Math.ceil(hTot);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        let y = 0;
        for (const s of b) {
          const h = (s.y1 - s.y0) * sc;
          g.fillStyle = '#c00'; g.font = 'bold 18px sans-serif'; g.fillText('R' + (s.i + 1), 4, y + pad + Math.min(h, 22));
          g.drawImage(cv, s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, 56, y + pad, (s.x1 - s.x0) * sc, h);
          g.strokeStyle = '#ddd'; g.beginPath(); g.moveTo(0, y + h + pad * 2 - 0.5); g.lineTo(c.width, y + h + pad * 2 - 0.5); g.stroke();
          y += h + pad * 2;
        }
        blobs.push(await new Promise((r) => c.toBlob(r, 'image/png')));
      }
      const labels = group.flat().map((s) => 'R' + (s.i + 1));
      const prompt = `The attached image${blobs.length > 1 ? 's show' : ' shows'} strips cut from a scanned choral score, each labelled in red (${labels.join(', ')}). Most strips are a row of sung lyrics printed under a staff; some may be dynamics, tempo or performance instructions instead.\n\nFor each strip, transcribe the sung lyric syllables from left to right exactly as printed, one array item per syllable as spaced on the page. End a syllable with "-" when a hyphen follows it (the word continues on the next note). Keep punctuation and apostrophes. If a strip is not sung lyrics (for example "cresc.", "mf", "Soprano", "rit.", tempo text), return an empty array for it.\n\nReply with only a JSON object mapping each label to its array, e.g. {"R1": ["From", "Bot-", "tle", "Al-", "ley"], "R2": []}`;
      try {
        const res = testReader ? await testReader({ page: pi, rows: group.flat().map((st) => ({ label: 'R' + (st.i + 1), row: an.rows[st.i], toPt: (x, y) => vp.convertToPdfPoint(x, y) })) }) : await sample.json(prompt, { images: blobs, modelTier: 'default' });
        for (const [k, v] of Object.entries(res || {})) if (Array.isArray(v)) reads.set(+String(k).replace(/\D/g, '') - 1, v.map(String));
      } catch (e) {
        flash('step1-msg', e && e.code === 'not_granted' ? 'Claude wasn’t allowed to look at the scanned pages, so their lyrics can’t be read.' : 'Claude couldn’t read the scanned page this time. Try again in a moment.');
        return false;
      }
    }
    // turn reads into rows and slots
    const toPt = (x, y) => vp.convertToPdfPoint(x, y);
    const staffKey = new Map(); an.staves.forEach((s, i) => staffKey.set(s, i));
    // systems: a big vertical gap between consecutive staves starts a new system
    const gapsS = an.staves.slice(1).map((s, i) => s.top - an.staves[i].bottom);
    const medGap = gapsS.length ? gapsS.slice().sort((a, b) => a - b)[Math.floor(gapsS.length / 2)] : 0;
    let sysI = 0; const sysOf = new Map(); const idxIn = new Map(); let k = 0;
    an.staves.forEach((s, i) => { if (i && gapsS[i - 1] > 1.45 * medGap && gapsS[i - 1] > 6 * s.space) { sysI++; k = 0; } sysOf.set(s, sysI); idxIn.set(s, k++); });
    const verseCount = new Map();
    an.rows.forEach((r, ri) => {
      const words = reads.get(ri);
      if (!words || !words.length) return;
      const groups = regroup(r, words) || (r.groups.length === words.length ? r.groups : null);
      if (!groups || groups.length !== words.length) return;
      const v = verseCount.get(r.staff) || 0; verseCount.set(r.staff, v + 1);
      const [, basePt] = toPt(r.x0, r.base);
      const [, topPt] = toPt(r.x0, r.base - r.capH);
      const size = Math.max(6, Math.min(20, (basePt > topPt ? basePt - topPt : topPt - basePt) / 0.7));
      const [sx0, sTop] = toPt(r.staff.x0, r.staff.top), [sx1, sBot] = toPt(r.staff.x1, r.staff.bottom);
      const row = {
        id: model.rows.length, page: pi, sys: sysBase + sysOf.get(r.staff), lane: '#' + idxIn.get(r.staff), verse: v, y: toPt(r.x0, r.base)[1], size, slotIds: [], staffLabel: '', lead: [], trail: [],
        staff: { x0: Math.min(sx0, sx1), x1: Math.max(sx0, sx1), top: Math.max(sTop, sBot), bottom: Math.min(sTop, sBot), space: r.staff.space / S }, scanned: true,
      };
      model.rows.push(row);
      const marksPt = r.marks.map((m) => {
        const [ax, ay] = toPt(m.x0 - 1, m.y1 + 1), [bx, by] = toPt(m.x1 + 1, m.y0 - 1);
        const mk = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by), kind: m.kind };
        mk.y = (mk.y0 + mk.y1) / 2; mk.w = Math.max(0.3, mk.y1 - mk.y0 - 2 / S); mk.box = [mk.x0, mk.y0, mk.x1, mk.y1];
        (m.kind === 'hy' ? allMarks.hy : allMarks.ext).push({ len: mk.x1 - mk.x0, w: mk.w, off: (mk.y - row.y) / size });
        return mk;
      });
      const slotObjs = groups.map((gq, gi) => {
        const text = words[gi].replace(/-$/, '');
        const [ax, ay] = toPt(gq.x0, gq.y1), [bx, by] = toPt(gq.x1 + 1, gq.y0);
        const sl = {
          id: model.slots.length, rowId: row.id, page: pi, sys: row.sys, lane: row.lane, verse: v, text, norm: normChars(text).chars,
          x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: row.y, top: Math.max(ay, by), bot: Math.min(ay, by), size, italic: false, bold: false,
          fontId: -1, fontName: null, after: [], glyphs: null, hyphenWord: /-$/.test(words[gi]), scanned: true,
        };
        model.slots.push(sl); row.slotIds.push(sl.id); return sl;
      });
      for (const mk of marksPt) {
        const cx = (mk.x0 + mk.x1) / 2; let kq = 0; while (kq < slotObjs.length && slotObjs[kq].x1 <= cx) kq++;
        if (kq === 0) row.lead.push(mk); else slotObjs[kq - 1].after.push(mk);
      }
      for (const sl of slotObjs) {
        sl.hyphenAfter = sl.hyphenWord || sl.after.some((m) => m.kind === 'hy');
        const ex = sl.after.filter((m) => m.kind === 'ext');
        sl.extenderAfter = ex.length ? { x0: Math.min(...ex.map((m) => m.x0)), x1: Math.max(...ex.map((m) => m.x1)), y: ex[0].y, w: ex[0].w } : null;
      }
    });
    sysBase += sysI + 1;
  }
  if (!model.style || !model.style.lyricSize) {
    const med = (a, f, d) => { const v = a.map(f).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : d; };
    const sz = med(model.rows, (r) => r.size, 10);
    model.style = { lyricSize: sz, hyphen: { len: med(allMarks.hy, (h) => h.len, 0.33 * sz), w: med(allMarks.hy, (h) => h.w, 0.06 * sz), off: med(allMarks.hy, (h) => h.off, 0.27) }, extender: { w: med(allMarks.ext, (h) => h.w, 0.06 * sz), off: med(allMarks.ext, (h) => h.off, 0) } };
  }
  return true;
}

if (typeof module !== 'undefined') module.exports = { analyzeScanImage, regroup };
