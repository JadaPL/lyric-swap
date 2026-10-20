/* ===== App: files, analysis, review, build, preview ===== */
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const capability = (name) => (window.claude && typeof window.claude.use === 'function' ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const samplePromise = capability('sample');
const downloadsPromise = capability('downloads');

const state = { score: null, table: null, cols: null, lines: [], notFound: [], model: null, glyphMaps: null, followers: new Map(), output: null, filter: null, scan: null };
const deps = { normChars, isExpressionToken, normLabel, isSubsequence, INSTRUMENT_RE, fitLine };

/* ---------- step navigation ---------- */
function showStep(n) {
  [1, 2, 3].forEach((i) => {
    $('step' + i).hidden = i !== n;
    const li = $('st-' + i);
    li.toggleAttribute('aria-current', i === n); if (i === n) li.setAttribute('aria-current', 'step');
    li.classList.toggle('done', i < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('back-1').onclick = () => showStep(1);
$('back-2').onclick = () => showStep(2);

/* ---------- file inputs ---------- */
function wireDrop(zoneId, inputId, onFiles) {
  const z = $(zoneId), inp = $(inputId);
  ['dragenter', 'dragover'].forEach((e) => z.addEventListener(e, (ev) => { ev.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => z.addEventListener(e, () => z.classList.remove('over')));
  z.addEventListener('drop', (ev) => { ev.preventDefault(); if (ev.dataTransfer.files.length) onFiles([...ev.dataTransfer.files]); });
  inp.addEventListener('change', () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ''; });
}
const readBuf = (f) => f.arrayBuffer();
const readText = async (f) => { const b = new Uint8Array(await f.arrayBuffer()); let t = new TextDecoder('utf-8').decode(b); if (t.includes('\uFFFD')) t = new TextDecoder('windows-1252').decode(b); return t.replace(/^﻿/, ''); };

wireDrop('drop-score', 'file-score', async (files) => {
  try {
    const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
    if (pdfs.length) {
      const bytes = new Uint8Array(await readBuf(pdfs[0]));
      state.score = { name: pdfs[0].name, bytes, fromImages: false };
    } else if (imgs.length) {
      state.score = { name: imgs.length > 1 ? `${imgs.length} images` : imgs[0].name, bytes: await imagesToPdf(imgs), fromImages: true };
    } else { flash('step1-msg', 'That file isn’t a PDF or an image. Choose a PDF, JPG or PNG of the score.'); return; }
    $('score-name').textContent = state.score.name;
    $('score-hint').textContent = state.score.fromImages ? 'Photos are read as scanned pages.' : `${(state.score.bytes.length / 1024).toFixed(0)} KB PDF`;
    $('drop-score').classList.add('filled');
    updateGo();
  } catch (e) { flash('step1-msg', 'Couldn’t open that file: ' + (e.message || e)); }
});
wireDrop('drop-lyrics', 'file-lyrics', async (files) => {
  const f = files[0];
  try {
    const rows = await readLyricsFile(f);
    setTable(rows, f.name);
  } catch (e) { flash('step1-msg', 'Couldn’t read that lyrics file: ' + (e.message || e)); }
});
$('paste-use').onclick = () => {
  const t = $('paste-text').value;
  if (!t.trim()) return;
  const rows = t.split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t') : l.includes('|') ? l.split('|') : [l]).map((c) => c.trim()));
  setTable(rows, 'Pasted lyrics');
};

async function readLyricsFile(f) {
  const name = f.name.toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    const wb = XLSX.read(new Uint8Array(await readBuf(f)), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((r) => r.map((c) => String(c ?? '')));
  }
  if (/\.docx$/.test(name)) {
    const res = await mammoth.convertToHtml({ arrayBuffer: await readBuf(f) });
    const doc = new DOMParser().parseFromString(res.value, 'text/html');
    const tbl = [...doc.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0];
    if (tbl && tbl.rows.length > 1) return [...tbl.rows].map((tr) => [...tr.cells].map((td) => [...td.querySelectorAll('p')].map((p) => p.textContent).join('\n') || td.textContent));
    return [...doc.querySelectorAll('p, li, h1, h2, h3')].map((p) => [p.textContent]).filter((r) => r[0].trim());
  }
  const text = await readText(f);
  if (/\.(csv|tsv)$/.test(name) || /[,\t]/.test(text.split('\n')[0] || '')) return parseCSV(text);
  return text.split(/\r?\n/).map((l) => (l.includes('|') ? l.split('|').map((c) => c.trim()) : [l]));
}

function setTable(rows, name) {
  rows = rows.filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) { flash('step1-msg', 'That file has no text in it.'); return; }
  state.table = rows; state.tableName = name;
  const cols = detectColumns(rows);
  const maxCols = Math.max(...rows.map((r) => r.length));
  const labelFor = (c) => { const h = cols.header >= 0 ? (rows[cols.header][c] || '').trim() : ''; return `Column ${String.fromCharCode(65 + c)}${h ? ' – ' + h.slice(0, 30) : ''}`; };
  const fill = (sel, val, allowNone) => {
    sel.innerHTML = '';
    if (allowNone) sel.append(el('option', { value: '-1', text: 'None (only new lyrics)' }));
    for (let c = 0; c < maxCols; c++) sel.append(el('option', { value: String(c), text: labelFor(c) }));
    sel.value = String(val);
  };
  fill($('col-orig'), maxCols < 2 ? -1 : cols.origCol, true);
  fill($('col-new'), maxCols < 2 ? 0 : (cols.newCol >= 0 ? cols.newCol : Math.min(1, maxCols - 1)), false);
  const st = $('col-start'); st.innerHTML = '';
  rows.slice(0, 10).forEach((r, i) => st.append(el('option', { value: String(i), text: `Row ${i + 1}: ${r.filter(Boolean).join(' · ').slice(0, 50)}` })));
  st.value = String(Math.max(0, cols.dataStart));
  $('colpick').hidden = false;
  $('lyrics-name').textContent = name;
  $('lyrics-hint').textContent = `${rows.length} rows`;
  $('drop-lyrics').classList.add('filled');
  renderPeek(); updateGo();
}
['col-orig', 'col-new', 'col-start'].forEach((id) => $(id).addEventListener('change', () => { renderPeek(); updateGo(); }));
function currentCols() { return { origCol: +$('col-orig').value, newCol: +$('col-new').value, dataStart: +$('col-start').value, header: +$('col-start').value - 1 }; }
function renderPeek() {
  const t = $('peek'); t.innerHTML = '';
  const c = currentCols(); const rows = state.table;
  const show = [];
  if (c.origCol >= 0) show.push([c.origCol, 'Original', 'c-orig']);
  show.push([c.newCol, 'New', 'c-new']);
  t.append(el('tr', {}, ...show.map(([, h, cl]) => el('th', { class: cl, text: h }))));
  rows.slice(c.dataStart, c.dataStart + 8).forEach((r) => t.append(el('tr', {}, ...show.map(([ci, , cl]) => el('td', { class: cl, text: r[ci] || '' })))));
}
function updateGo() {
  const ok = !!(state.score && state.table);
  $('go-match').disabled = !ok;
  $('go-help').textContent = ok ? (currentCols().origCol < 0 ? 'Without an original column, Claude will need to pair the lines (you’ll be asked).' : 'Matching takes a few seconds.') : 'Add both files to continue.';
}
function flash(id, msg) { const n = $(id); n.textContent = msg; n.hidden = !msg; }
function progress(frac, text) { $('prog').hidden = frac == null; if (frac != null) { $('prog-bar').style.width = Math.round(frac * 100) + '%'; $('prog-text').textContent = text || ''; } }

async function imagesToPdf(files) {
  const doc = await PDFLib.PDFDocument.create();
  for (const f of files) {
    let bytes = new Uint8Array(await f.arrayBuffer()); let img;
    if (/png$/i.test(f.type) || /\.png$/i.test(f.name)) img = await doc.embedPng(bytes);
    else if (/jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name)) img = await doc.embedJpg(bytes);
    else { // webp etc: convert via canvas
      const bm = await createImageBitmap(new Blob([bytes]));
      const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0);
      const b = await new Promise((r) => c.toBlob(r, 'image/png')); img = await doc.embedPng(new Uint8Array(await b.arrayBuffer()));
    }
    // fit to a letter-width page, keeping aspect
    const w = 612, h = w * img.height / img.width;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return new Uint8Array(await doc.save());
}

/* ---------- analysis ---------- */
// On a regular web host pdf.js can fetch its standard fonts (for PDFs that don't embed them);
// inside a Claude artifact the page can't fetch, so it falls back to drawing without them.
const PDFJS_ASSETS = window.claude ? {} : {
  standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
  cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true,
};
function loadPdfjs(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, ...PDFJS_ASSETS }).promise;
}
$('go-match').onclick = async () => {
  $('go-match').disabled = true; flash('step1-msg', '');
  try { await analyze(); } catch (e) { console.error(e); flash('step1-msg', 'Something went wrong while reading the score: ' + (e.message || e)); progress(null); }
  $('go-match').disabled = false;
};

async function analyze() {
  progress(0.02, 'Opening the score…');
  const pdf = await loadPdfjs(state.score.bytes);
  state.pdf = pdf;
  const pages = []; const glyphMaps = new Map(); const pageInfo = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    progress(0.05 + 0.6 * (p - 1) / pdf.numPages, `Reading page ${p} of ${pdf.numPages}…`);
    await tick();
    const page = await pdf.getPage(p);
    const raw = await extractVectorPage(pdfjsLib, page, glyphMaps);
    const an = analyzeVectorPage(raw, p - 1);
    pages.push(an);
    const [vx0, vy0, vx1, vy1] = page.view;
    const area = (vx1 - vx0) * (vy1 - vy0);
    const imgArea = raw.images.reduce((s, im) => s + Math.max(0, (im.x1 - im.x0) * (im.y1 - im.y0)), 0);
    const letterGlyphs = raw.glyphs.filter((g) => /\p{L}/u.test(g.ch)).length;
    pageInfo.push({ index: p - 1, view: page.view, scanned: imgArea > 0.4 * area && letterGlyphs < 20, staves: an.staves.length });
  }
  state.pageInfo = pageInfo; state.glyphMaps = glyphMaps;
  progress(0.68, 'Finding the lyric lines…'); await tick();
  const model = buildDocModel(pages, deps);
  state.model = model;
  const scannedPages = pageInfo.filter((p) => p.scanned);
  if (scannedPages.length) {
    progress(0.7, 'Some pages are scanned images. Looking for lyric lines on them…'); await tick();
    const ok = await scanPages(scannedPages);
    if (!ok) { progress(null); return; }
  }
  if (!model.slots.length) {
    progress(null);
    flash('step1-msg', 'No lyrics were found in this score. If it is a scan, make sure the image is sharp and upright; if it is a PDF from notation software, check that the lyrics are real text (they can be selected in a PDF viewer).');
    return;
  }
  const cols = currentCols();
  if (cols.origCol < 0) { const paired = await pairWithoutOriginal(); if (!paired) { progress(null); return; } }
  else state.entries = buildEntries(state.table, cols);
  progress(0.78, 'Matching your lines to the score…'); await tick();
  runMatching();
  cropCache.clear();
  progress(0.95, 'Preparing previews…'); await tick();
  progress(null);
  showStep(2);
  renderReview();
  renderCrops();
}

function runMatching() {
  const model = state.model; const entries = state.entries;
  const G = buildGraph(model.slots, model.rows);
  const cands = new Map();
  for (const e of entries) cands.set(e.id, matchLine(e, G));
  const slotById = new Map(model.slots.map((s) => [s.id, s]));
  state.slotById = slotById;
  const chosen = chooseOccurrences(entries, cands, slotById);
  applyGuidedSplits(chosen, entries);
  const lines = buildLines(model, entries, chosen, deps).map((L) => ({ ...L, kind: 'table' }));
  const usedEntries = new Set(chosen.map((o) => o.entryId));
  state.notFound = entries.filter((e) => !usedEntries.has(e.id) && e.norm.length >= 2 && e.replacement && normChars(e.replacement).chars !== e.norm);
  state.followers = findFollowers(model.rows, state.slotById, chosen);
  // leftovers: score lyrics that no table line covers
  const covered = new Set(); chosen.forEach((o) => o.slots.forEach((x) => covered.add(x)));
  for (const f of state.followers.keys()) covered.add(f);
  const groups = [];
  for (const r of model.rows) {
    let cur = [];
    for (const id of r.slotIds) {
      const s = state.slotById.get(id);
      if (!covered.has(id) && s.norm) cur.push(id); else { if (cur.length) groups.push(cur); cur = []; }
    }
    if (cur.length) groups.push(cur);
  }
  for (const g of groups) {
    const ss = g.map((id) => state.slotById.get(id));
    const text = ss.map((s) => s.norm).join('');
    const sys = ss[0].sys;
    // which nearby table line does it belong to?
    let best = null;
    for (const L of lines) {
      if (Math.abs(L.sys - sys) > 3) continue;
      const e = entries.find((x) => x.id === L.entryId);
      if (!e || !e.norm.includes(text.slice(0, Math.max(2, Math.floor(text.length * 0.6))))) continue;
      if (!best || Math.abs(L.sys - sys) < Math.abs(best.sys - sys)) best = L;
    }
    const nearUnchanged = entries.find((e) => e.replacement && normChars(e.replacement).chars === e.norm && e.norm.includes(text) && Math.abs((lines.find((L) => L.entryId === e.id)?.sys ?? sys) - sys) <= 3)
      || (!best && entries.find((e) => e.replacement && normChars(e.replacement).chars === e.norm && lev(e.norm, text) <= Math.max(1, e.norm.length * 0.5) && e.norm.length <= text.length * 3));
    const line = {
      id: lines.length, kind: 'score', entryId: best ? best.entryId : null, slotIds: g, q: 0, page: ss[0].page, sys,
      scoreText: ss.map((s, i) => s.text + (s.hyphenAfter && i < ss.length - 1 ? '-' : '')).join(' ').replace(/- /g, '-'),
      csvOriginal: best ? best.csvOriginal : '', csvNew: '', syls: null,
      status: nearUnchanged ? 'unchanged' : 'unmatched',
      partOf: best ? best.csvOriginal : (nearUnchanged ? nearUnchanged.original : ''),
    };
    lines.push(line);
  }
  for (const L of lines) {
    L.lane = state.slotById.get(L.slotIds[0]).lane;
    L.decision = null;
    L.typed = L.syls ? sylsToTyped(L.syls) : '';
    if (L.status === 'unchanged') L.decision = 'keep';
  }
  lines.sort((a, b) => a.sys - b.sys || state.slotById.get(a.slotIds[0]).x0 - state.slotById.get(b.slotIds[0]).x0);
  lines.forEach((L, i) => { L.id = i; });
  state.lines = lines;
}

/** Split score tokens that hold two words (e.g. "takesa") where the matched table line has a word break. */
function applyGuidedSplits(chosen, entries) {
  const model = state.model; const byId = state.slotById;
  const G = buildGraph(model.slots, model.rows);
  for (const o of chosen) {
    const e = entries.find((x) => x.id === o.entryId);
    if (!e || !o.align) continue;
    const splitAt = new Map(); // slotId -> [char index]
    for (const [li, nodeIdx] of o.align) {
      const nd = G.nodes[nodeIdx]; if (!nd || nd.k === 0) continue;
      if (e.wordStart[li]) { if (!splitAt.has(nd.slot)) splitAt.set(nd.slot, []); splitAt.get(nd.slot).push(nd.k); }
    }
    for (const [sid, ks] of splitAt) {
      const s = byId.get(sid); if (!s || !s.glyphs) continue;
      // map normalized index k to glyph index
      const k = ks[0]; let count = 0, gi = -1;
      for (let i = 0; i < s.glyphs.length; i++) { if (/[\p{L}\p{N}]/u.test(s.glyphs[i].ch)) { if (count === k) { gi = i; break; } count++; } }
      if (gi <= 0) continue;
      // only where the printed letters don't touch (a real gap between two words)
      if (s.glyphs[gi].x0 - s.glyphs[gi - 1].x1 < 0.03 * s.size) continue;
      const A = s.glyphs.slice(0, gi), B = s.glyphs.slice(gi);
      const mk = (gl, after) => {
        const text = gl.map((g) => g.ch).join('').normalize('NFKC');
        return { ...s, id: model.slots.length, text, norm: normChars(text).chars, x0: Math.min(...gl.map((g) => g.x0)), x1: Math.max(...gl.map((g) => g.x1)), glyphs: gl, after, hyphenAfter: after.some((m) => m.kind === 'hy'), extenderAfter: after === s.after ? s.extenderAfter : null };
      };
      const sA = mk(A, []); s.text = B.map((g) => g.ch).join('').normalize('NFKC');
      // keep original slot object as the right half so other references stay valid
      Object.assign(s, { text: s.text, norm: normChars(s.text).chars, x0: Math.min(...B.map((g) => g.x0)), glyphs: B });
      sA.id = model.slots.length; model.slots.push(sA); byId.set(sA.id, sA);
      const row = model.rows.find((r) => r.id === s.rowId);
      row.slotIds.splice(row.slotIds.indexOf(sid), 0, sA.id);
      for (const oc of chosen) { const i = oc.slots.indexOf(sid); if (i >= 0) oc.slots.splice(i, 0, sA.id); }
    }
  }
}

/* ---------- lines without an original column ---------- */
async function pairWithoutOriginal() {
  const sample = await samplePromise;
  const c = currentCols();
  const newLines = [];
  state.table.slice(c.dataStart).forEach((r) => String(r[c.newCol] || '').split('\n').forEach((l) => { if (l.trim()) newLines.push(l.trim()); }));
  if (!sample) {
    flash('step1-msg', 'Your lyrics file has only the new words. To know which original line each new line replaces, add the original lines as a second column (one row per line), then try again.');
    return false;
  }
  progress(0.75, 'Asking Claude to pair your new lines with the score’s lyrics…');
  const rowsTxt = state.model.rows.map((r) => `[${r.id}] page ${r.page + 1}, ${r.lane}${r.verse ? ' (line ' + (r.verse + 1) + ')' : ''}: ` + r.slotIds.map((id) => state.model.slots.find((s) => s.id === id).text).join(' ')).join('\n');
  const prompt = `A choir score's lyrics are listed below, one printed lyric row per line (syllables separated by spaces). Below them is a list of NEW lyric lines meant to replace the original words, in performance order.\n\nFor each new line, give the original words it replaces, copied from the score rows (join syllables into words). Pair them in order; a new line usually replaces one original phrase of similar length and rhythm.\n\nReply with only a JSON array of {"new": <the new line exactly>, "original": <original words>} objects.\n\nSCORE ROWS:\n${rowsTxt}\n\nNEW LINES:\n${newLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
  try {
    const res = await sample.json(prompt, { modelTier: 'default' });
    if (!Array.isArray(res)) throw new Error('unexpected reply');
    const rows = [['ORIGINAL', 'NEW'], ...res.filter((x) => x && x.new).map((x) => [String(x.original || ''), String(x.new)])];
    state.entries = buildEntries(rows, { origCol: 0, newCol: 1, dataStart: 1 });
    return true;
  } catch (e) {
    flash('step1-msg', e && e.code === 'not_granted' ? 'Claude wasn’t allowed to help, so the lines couldn’t be paired. Add the original lines as a second column and try again.' : 'Claude couldn’t pair the lines this time. Add the original lines as a second column, or try again.');
    return false;
  }
}

/* ---------- review ---------- */
const BUCKETS = [
  ['need', 'Need your input', 'need'],
  ['check', 'Worth a look', 'chk'],
  ['ok', 'Ready', 'ok'],
  ['keep', 'Unchanged', ''],
];
function bucketOf(L) {
  if (L.decision === 'keep' || L.decision === 'blank') return 'keep';
  if (L.decision === 'new') return L.confirmed || !L.claude ? 'ok' : 'check';
  if (['mismatch', 'missing', 'unmatched'].includes(L.status)) return 'need';
  if (L.status === 'check' && !L.confirmed) return 'check';
  if (L.claude && !L.confirmed) return 'check';
  if (L.status === 'unchanged') return 'keep';
  return 'ok';
}
function renderReview() {
  const counts = { need: 0, check: 0, ok: 0, keep: 0 };
  for (const L of state.lines) counts[bucketOf(L)]++;
  if (!state.filter || (!counts[state.filter] && state.filter !== 'ok')) state.filter = counts.need ? 'need' : counts.check ? 'check' : 'ok';
  const t = $('tally'); t.innerHTML = '';
  for (const [k, label, cls] of BUCKETS) {
    t.append(el('button', { class: cls, 'aria-pressed': String(state.filter === k), onclick: () => { state.filter = k; renderReview(); renderCrops(); } },
      el('span', { class: 'n', text: String(counts[k]) }), el('span', { class: 'small', text: label })));
  }
  if (state.notFound.length) {
    t.append(el('button', { class: '', 'aria-pressed': String(state.filter === 'missing'), onclick: () => { state.filter = 'missing'; renderReview(); } },
      el('span', { class: 'n', text: String(state.notFound.length) }), el('span', { class: 'small', text: 'Not found in score' })));
  }
  samplePromise.then((s) => { $('claude-box').hidden = !s; });
  const cards = $('cards'); cards.innerHTML = '';
  if (state.filter === 'missing') {
    cards.append(el('div', { class: 'notice warn' }, el('div', {},
      el('strong', { text: 'These spreadsheet lines weren’t found in the score.' }),
      el('p', { class: 'small', text: 'Their original words didn’t match any lyrics in the PDF closely enough. Nothing is changed for them. If they should be in the score, check the spelling in the original column, or find the lyrics in the other lists and type the new words there.' }))));
    for (const e of state.notFound) cards.append(el('div', { class: 'card s-keep' }, el('header', {}, el('span', { class: 'where', text: `Spreadsheet row ${e.row}` })), el('p', { class: 'why' }, el('strong', { text: e.original }), e.replacement ? ` → ${e.replacement}` : '')));
  } else {
    const list = state.lines.filter((L) => bucketOf(L) === state.filter);
    if (!list.length) cards.append(el('p', { class: 'muted', text: state.filter === 'need' ? 'Nothing needs your input. 🎶' : 'No lines here.' }));
    for (const L of list) cards.append(renderCard(L));
  }
  const need = counts.need;
  $('build-help').textContent = need ? `${need} line${need > 1 ? 's' : ''} still need${need > 1 ? '' : 's'} your input. If you build now, they keep their original words.` : 'All lines are decided.';
}

function statusText(L) {
  const n = L.slotIds.length;
  if (L.decision === 'keep') return L.status === 'unchanged' ? ['Same words as the original', ''] : ['Keeping the original words', ''];
  if (L.decision === 'blank') return ['These notes will have no lyrics', ''];
  if (L.decision === 'new' && !L.claude) return ['Your edit', 'ok'];
  switch (L.status) {
    case 'mismatch': return [`${L.fitCount ?? (L.syls ? L.syls.length : '?')} syllables for ${n} notes`, 'need'];
    case 'missing': return ['No new words in your spreadsheet', 'need'];
    case 'unmatched': return [L.partOf ? 'Not covered by your spreadsheet' : 'Not in your spreadsheet', 'need'];
    case 'check': return [L.claude ? 'Claude’s suggestion' : 'Syllables adjusted to fit', 'check'];
    default: return [L.claude ? 'Claude’s suggestion' : 'Fits', L.claude ? 'check' : 'ok'];
  }
}

function renderCard(L) {
  const b = bucketOf(L);
  const [stText, stCls] = statusText(L);
  const ss = L.slotIds.map((id) => state.slotById.get(id));
  const n = ss.length;
  const card = el('article', { class: 'card s-' + b, id: 'line-' + L.id });
  card.append(el('header', {},
    el('span', { class: 'pill ' + stCls, text: stText }),
    el('span', { class: 'where', text: `Page ${L.page + 1} · ${L.lane}${L.kind === 'table' ? ` · spreadsheet row ${L.row}` : ''}` })));
  // explanation
  let why = null;
  if (L.status === 'mismatch' && !L.decision) why = `Your new line has ${L.fitCount ?? '?'} syllables, but the original has ${n} notes here. Type the line with hyphens so it has exactly ${n} syllables, use _ to hold a syllable over an extra note, or ask Claude.`;
  else if (L.status === 'missing' && !L.decision) why = `The spreadsheet row “${L.csvOriginal}” has no new words. Keep the original words, leave the notes blank, or type new words.`;
  else if (L.status === 'unmatched' && !L.decision) why = L.partOf ? `These notes sing part of “${L.partOf}”, but on a different staff or in a shorter form than your spreadsheet line. What should they sing?` : 'These lyrics aren’t in your spreadsheet. Keep them, leave the notes blank, or type new words.';
  else if (L.status === 'check' && !L.claude && !L.decision) why = 'The syllable count only fit after choosing a less common split. Check that it sounds right.';
  if (why) card.append(el('p', { class: 'why', text: why }));
  if (L.note) card.append(el('p', { class: 'claude-note', text: 'Claude: ' + L.note }));
  const crop = el('div', { class: 'crop', 'data-line': String(L.id) });
  card.append(crop);
  // syllable grid
  const grid = el('div', { class: 'syl-grid' });
  const drawGrid = (syls) => {
    grid.innerHTML = '';
    const m = Math.max(n, syls ? syls.length : 0);
    for (let i = 0; i < m; i++) {
      const s = ss[i]; const ns = syls ? syls[i] : null;
      const show = ns ? (ns.hold ? '—' : (ns.text || '∅') + (ns.cont ? '-' : '')) : (L.decision === 'blank' ? '∅' : '');
      grid.append(el('div', { class: 'syl' + (i >= n ? ' extra' : '') },
        el('span', { class: 'o', text: s ? s.text + (s.hyphenAfter ? '-' : '') : 'no note' }),
        el('span', { class: 'n' + (!ns || !ns.text ? ' empty' : ''), text: show || '·' })));
    }
  };
  const currentSyls = () => (L.decision === 'keep' ? null : L.decision === 'blank' ? ss.map(() => ({ text: '', cont: false })) : L.syls);
  drawGrid(currentSyls());
  card.append(grid);
  // editor
  const inp = el('input', { class: 'input', type: 'text', id: 'edit-' + L.id, value: L.typed || '', placeholder: L.status === 'missing' || L.status === 'unmatched' ? 'Type new words, e.g. Won-der-ful the morn-ing' : '', 'aria-label': 'New syllables for this line', spellcheck: 'false' });
  const cnt = el('span', { class: 'count' });
  const setCount = () => {
    const syls = parseTyped(inp.value);
    const k = syls.length;
    cnt.textContent = `${k} / ${n} notes`;
    cnt.className = 'count ' + (k === n ? 'good' : 'bad');
    return syls;
  };
  setCount();
  inp.addEventListener('input', () => {
    const syls = setCount();
    drawGrid(syls.length ? syls : currentSyls());
  });
  const commit = () => {
    const syls = parseTyped(inp.value);
    if (!inp.value.trim()) return;
    if (syls.length !== n) { cnt.textContent = `${syls.length} / ${n} notes — needs exactly ${n}`; inp.focus(); return; }
    Object.assign(L, { syls, typed: inp.value, decision: 'new', claude: false, confirmed: true, note: L.note });
    renderReview(); renderCrops();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  card.append(el('div', { class: 'edit' }, inp, cnt));
  card.append(el('p', { class: 'help' }, 'Space = next note · ', el('kbd', { text: '-' }), ' = same word continues · ', el('kbd', { text: '_' }), ' = hold the previous syllable · ', el('kbd', { text: '~' }), ' = two words on one note. Press ', el('kbd', { text: 'Enter' }), ' to use it.'));
  const acts = el('div', { class: 'actions' });
  const isNeed = b === 'need'; const isCheck = b === 'check';
  acts.append(el('button', { class: 'btn sm primary', onclick: commit, text: 'Use these syllables' }));
  if (isCheck) acts.append(el('button', { class: 'btn sm', text: 'Looks right', onclick: () => { L.confirmed = true; if (L.syls) L.decision = 'new'; renderReview(); renderCrops(); } }));
  if (L.decision !== 'keep') acts.append(el('button', { class: 'btn sm', text: L.status === 'unchanged' ? 'Keep original' : 'Keep original words', onclick: () => { L.decision = 'keep'; renderReview(); renderCrops(); } }));
  if (L.decision !== 'blank') acts.append(el('button', { class: 'btn sm', text: 'Leave notes blank', onclick: () => { L.decision = 'blank'; renderReview(); renderCrops(); } }));
  if ((L.decision === 'keep' || L.decision === 'blank') && L.status !== 'unchanged') acts.append(el('button', { class: 'btn sm ghost', text: 'Undo', onclick: () => { L.decision = null; renderReview(); renderCrops(); } }));
  const csvNew = L.csvNew;
  if (csvNew && (L.status === 'mismatch' || L.status === 'check' || isNeed)) {
    const ask = el('button', { class: 'btn sm ghost', text: 'Ask Claude', hidden: true });
    samplePromise.then((s) => { if (s) ask.hidden = false; });
    ask.onclick = async () => { ask.disabled = true; ask.textContent = 'Thinking…'; await claudeFit([L]); ask.disabled = false; ask.textContent = 'Ask Claude'; };
    acts.append(ask);
  }
  card.append(acts);
  if (L.csvNew) card.append(el('p', { class: 'small muted' }, 'Spreadsheet: ', el('em', { text: L.csvNew })));
  return card;
}

/* crop previews: render each needed page once, cut out the lyric rows */
let cropJob = 0;
const cropCache = new Map();
async function renderCrops() {
  const job = ++cropJob;
  for (const h of document.querySelectorAll('.crop[data-line]')) { const c = cropCache.get(+h.dataset.line); if (c && !h.firstChild) h.append(...c); }
  const holders = [...document.querySelectorAll('.crop[data-line]')].filter((h) => !h.firstChild);
  const byPage = new Map();
  for (const h of holders) {
    const L = state.lines[+h.dataset.line]; if (!L) continue;
    if (!byPage.has(L.page)) byPage.set(L.page, []);
    byPage.get(L.page).push([h, L]);
  }
  for (const [pi, list] of byPage) {
    if (job !== cropJob) return;
    const page = await state.pdf.getPage(pi + 1);
    const scale = 2;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    for (const [h, L] of list) {
      const ss = L.slotIds.map((id) => state.slotById.get(id));
      const rowIds = [...new Set(ss.map((s) => s.rowId))];
      for (const rid of rowIds) {
        const row = state.model.rows.find((r) => r.id === rid);
        const mine = ss.filter((s) => s.rowId === rid);
        const x0 = Math.max(row.staff.x0 - 4, Math.min(...mine.map((s) => s.x0)) - 30), x1 = Math.min(row.staff.x1 + 4, Math.max(...mine.map((s) => s.x1)) + 30);
        const yTop = row.staff.top + row.staff.space * 2.5, yBot = row.y - row.size * 0.6;
        const [ax, ay] = vp.convertToViewportPoint(x0, yTop), [bx, by] = vp.convertToViewportPoint(x1, yBot);
        const cx = Math.min(ax, bx), cy = Math.min(ay, by), cw = Math.abs(bx - ax), ch = Math.abs(by - ay);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cw)); c.height = Math.max(1, Math.round(ch));
        const g = c.getContext('2d');
        g.drawImage(canvas, cx, cy, cw, ch, 0, 0, c.width, c.height);
        g.fillStyle = 'rgba(45, 74, 138, 0.16)';
        for (const s of mine) {
          const [p, q] = vp.convertToViewportPoint(s.x0, s.top), [r, t] = vp.convertToViewportPoint(s.x1, s.bot);
          g.fillRect(Math.min(p, r) - cx - 2, Math.min(q, t) - cy - 2, Math.abs(r - p) + 4, Math.abs(t - q) + 4);
        }
        c.style.width = Math.min(c.width * 0.75, 980) + 'px'; c.style.maxWidth = '100%';
        h.append(c);
        if (!cropCache.has(L.id)) cropCache.set(L.id, []);
        cropCache.get(L.id).push(c);
      }
    }
    await tick();
  }
}

/* ---------- Claude ---------- */
function lineForClaude(L) {
  const ss = L.slotIds.map((id) => state.slotById.get(id));
  const orig = ss.map((s, i) => s.text + (s.hyphenAfter && i < ss.length - 1 ? '-' : '') + (s.extenderAfter ? ' (held)' : '')).join(' | ');
  return `id ${L.id} · ${ss.length} notes · original: ${orig} · new: "${L.csvNew}"`;
}
async function claudeFit(list, mode = 'fit') {
  const sample = await samplePromise;
  if (!sample || !list.length) return;
  const st = $('claude-status');
  const chunks = []; for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
  let changed = 0, failed = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    st.textContent = `Claude is working${chunks.length > 1 ? ` (part ${ci + 1} of ${chunks.length})` : ''}…`;
    const prompt = `You are fitting new (parody) lyrics onto existing choral sheet music. Each line below lists the original syllables, one per note, and the new words that replace them.\n\nFor each line return exactly as many syllables as it has notes, in order, one per note.\nRules:\n- Split words into sung syllables the way a choral score hyphenates them (won-der-ful, car-ry-ing, the-a-tre). End a syllable with "-" when the same word continues on the next note, e.g. ["won-", "der-", "ful"].\n- Keep the new words exactly: same words, spelling, capitalization and punctuation. Never add, drop or change words.\n- If there are more syllables than notes, combine two short syllables or words on one note where a singer naturally would (write them with a space, e.g. "the a"), choosing unstressed spots.\n- If there are fewer syllables than notes, hold a syllable over the next note by writing "_" for that note (prefer notes marked "(held)" or long vowels), or use a natural extra syllable split.\n- Match stressed syllables to the original's stressed syllables where you can.\n${mode === 'check' ? '- These lines already fit; only improve the hyphenation if it is wrong. Return the line unchanged if it is fine.\n' : ''}\nReply with only a JSON array: [{"id": number, "syllables": [string, ...], "note": "one short sentence if you had to combine or hold syllables, else empty"}]\n\nLines:\n${chunks[ci].map(lineForClaude).join('\n')}`;
    try {
      const res = await sample.json(prompt, { modelTier: 'default' });
      for (const r of Array.isArray(res) ? res : []) {
        const L = state.lines[Number(r.id)]; if (!L || !Array.isArray(r.syllables)) continue;
        const syls = r.syllables.map((x) => String(x)).map((x) => (/^_+$/.test(x.trim()) ? { text: '', cont: false, hold: true } : { text: x.replace(/-$/, '').trim(), cont: /-$/.test(x.trim()) }));
        if (syls.length !== L.slotIds.length) { failed++; continue; }
        const before = L.syls ? sylsToTyped(L.syls) : '';
        const after = sylsToTyped(syls);
        if (mode === 'check' && before === after) continue;
        Object.assign(L, { syls, typed: after, claude: true, confirmed: false, decision: 'new', note: String(r.note || '') });
        changed++;
      }
    } catch (e) {
      st.textContent = e && e.code === 'not_granted' ? 'Claude wasn’t allowed to help.' : e && e.code === 'rate_limited' ? 'Claude is busy or you’ve hit a usage limit. Try again later.' : 'Claude couldn’t answer this time. Try again.';
      renderReview(); renderCrops();
      return;
    }
  }
  st.textContent = `${changed} line${changed === 1 ? '' : 's'} updated${failed ? `, ${failed} couldn’t be fitted` : ''}. Claude’s changes are under “Worth a look”.`;
  renderReview(); renderCrops();
}
$('claude-all').onclick = async () => {
  const list = state.lines.filter((L) => L.csvNew && (L.status === 'mismatch' || L.status === 'check') && !L.confirmed && L.decision !== 'keep' && L.decision !== 'blank');
  if (!list.length) { $('claude-status').textContent = 'No flagged lines have new words to fit.'; return; }
  $('claude-all').disabled = true; await claudeFit(list); $('claude-all').disabled = false;
};
$('claude-every').onclick = async () => {
  const list = state.lines.filter((L) => L.csvNew && L.syls && L.syls.length === L.slotIds.length && L.decision !== 'keep' && L.decision !== 'blank');
  $('claude-every').disabled = true; await claudeFit(list, 'check'); $('claude-every').disabled = false;
};

/* ---------- build ---------- */
function currentPlan() {
  const plan = new Map();
  for (const L of state.lines) {
    let syls = null;
    if (L.decision === 'keep') continue;
    if (L.decision === 'blank') syls = L.slotIds.map(() => ({ text: '', cont: false }));
    else if (L.decision === 'new' || ['ok', 'check'].includes(L.status)) syls = L.syls;
    if (!syls || syls.length !== L.slotIds.length) continue;
    L.slotIds.forEach((id, i) => plan.set(id, { text: syls[i].text || '', cont: !!syls[i].cont, start: i === 0 || !syls[i - 1].cont, hold: !!syls[i].hold }));
  }
  for (const [f, l] of state.followers) if (plan.has(l) && !plan.has(f)) plan.set(f, { ...plan.get(l) });
  return plan;
}
$('go-build').onclick = async () => {
  const btn = $('go-build'); btn.disabled = true; btn.textContent = 'Building…';
  try {
    await buildOutput();
    showStep(3); renderPreview();
  } catch (e) { console.error(e); $('build-help').textContent = 'Building failed: ' + (e.message || e); }
  btn.disabled = false; btn.textContent = 'Build the new score';
};
async function buildOutput() {
  const plan = currentPlan();
  const pdfDoc = await PDFLib.PDFDocument.load(state.score.bytes, { ignoreEncryption: true });
  const kit = makeFontKit(PDFLib, pdfDoc, state.glyphMaps);
  const model = state.model;
  const layouts = await layoutRows(kit, model, plan);
  const pageBg = state.scan ? state.scan.bg : {};
  await drawOutput(PDFLib, pdfDoc, kit, layouts, pageBg);
  const bytes = new Uint8Array(await pdfDoc.save());
  const warn = layouts.filter((l) => l.warn).map((l) => ({ page: l.row.page, warn: l.warn, words: l.items.filter((i) => i.crowded || i.small).map((i) => i.text).filter(Boolean) }));
  const undecided = state.lines.filter((L) => bucketOf(L) === 'need').length;
  state.output = { bytes, warn, undecided, pdf: await loadPdfjs(bytes) };
  const msgs = [];
  if (undecided) msgs.push(`${undecided} line${undecided > 1 ? 's' : ''} you didn’t decide on kept the original words.`);
  if (warn.length) msgs.push(`Some new words are wider than the space under their notes, so they were nudged or printed slightly smaller: ${warn.slice(0, 6).map((w) => `page ${w.page + 1} (${w.words.slice(0, 3).join(', ')})`).join('; ')}${warn.length > 6 ? '…' : ''}.`);
  const bw = $('build-warn'); bw.textContent = msgs.join(' '); bw.hidden = !msgs.length;
}

/* ---------- preview ---------- */
let showOriginal = false; let io = null;
$('v-new').onclick = () => { showOriginal = false; $('v-new').setAttribute('aria-pressed', 'true'); $('v-old').setAttribute('aria-pressed', 'false'); renderPreview(); };
$('v-old').onclick = () => { showOriginal = true; $('v-new').setAttribute('aria-pressed', 'false'); $('v-old').setAttribute('aria-pressed', 'true'); renderPreview(); };
function renderPreview() {
  const doc = showOriginal ? state.pdf : state.output.pdf;
  const box = $('pages'); box.innerHTML = '';
  if (io) io.disconnect();
  io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); drawPage(doc, +en.target.dataset.p, en.target); } }, { rootMargin: '600px' });
  for (let p = 1; p <= doc.numPages; p++) {
    const v = state.pageInfo[p - 1]?.view || [0, 0, 612, 792];
    const d = el('div', { class: 'page', 'data-p': String(p), style: `--ar:${(v[2] - v[0]) / (v[3] - v[1])}` }, el('span', { class: 'pno', text: `${p} / ${doc.numPages}` }));
    box.append(d); io.observe(d);
  }
}
async function drawPage(doc, p, holder) {
  const page = await doc.getPage(p);
  const w = holder.clientWidth || 800;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, (w * (window.devicePixelRatio || 1)) / base.width);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
  holder.prepend(c);
}

/* ---------- downloads ---------- */
function outName(ext) { const base = (state.score?.name || 'score').replace(/\.[^.]+$/, ''); return `${base} – new lyrics.${ext}`; }
async function offer(filename, data) {
  const msg = $('dl-msg');
  const dl = await downloadsPromise;
  if (dl) {
    try { await dl.save({ filename, data }); msg.textContent = 'Saved ' + filename; }
    catch (e) { msg.textContent = e && e.code === 'declined' ? 'Download cancelled.' : e && e.code === 'rate_limited' ? 'A download prompt is already open.' : 'The file couldn’t be saved here.'; }
    return;
  }
  if (window.claude) { msg.textContent = 'Downloads aren’t available in this view.'; return; }
  // regular web page (e.g. GitHub Pages): plain browser download
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  msg.textContent = 'Downloaded ' + filename;
}
$('dl-pdf').onclick = () => offer(outName('pdf'), new Blob([state.output.bytes], { type: 'application/pdf' }));
$('dl-txt').onclick = () => {
  const out = [];
  let lastPage = -1;
  for (const L of state.lines) {
    if (L.page !== lastPage) { out.push(`\n— Page ${L.page + 1} —`); lastPage = L.page; }
    const syls = L.decision === 'keep' || (!L.decision && !['ok', 'check'].includes(L.status)) ? null : L.decision === 'blank' ? [] : L.syls;
    const text = syls ? sylsToTyped(syls) : L.slotIds.map((id) => state.slotById.get(id).text).join(' ') + '   (original)';
    out.push(`[${L.lane}] ${text}`);
  }
  offer(outName('txt'), out.join('\n').trim() + '\n');
};

/* dev hook for automated testing */
window.__lyricSwap = { state, setTable, analyze, runMatching, buildOutput, currentPlan, renderReview };
