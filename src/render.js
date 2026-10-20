/* ===== Layout of new syllables and writing the output PDF ===== */

/** Find font dictionaries by BaseFont name anywhere in the document (pages and form XObjects). */
function indexFonts(PDFLib, pdfDoc) {
  const { PDFName, PDFDict, PDFRef, PDFStream } = PDFLib;
  const out = new Map(); const seen = new Set();
  const walkRes = (res) => {
    if (!res || seen.has(res)) return; seen.add(res);
    const fonts = res.lookup(PDFName.of('Font'));
    if (fonts instanceof PDFDict) for (const [, v] of fonts.entries()) {
      const fd = pdfDoc.context.lookup(v);
      if (!(fd instanceof PDFDict)) continue;
      const bf = fd.get(PDFName.of('BaseFont')); if (!bf) continue;
      const name = bf.decodeText ? bf.decodeText() : bf.toString().replace(/^\//, '');
      const enc = fd.get(PDFName.of('Encoding'));
      const sub = fd.get(PDFName.of('Subtype'));
      if (!out.has(name) && v instanceof PDFRef) out.set(name, { ref: v, subtype: sub ? sub.toString() : '', encoding: enc ? enc.toString() : '' });
    }
    const xo = res.lookup(PDFName.of('XObject'));
    if (xo instanceof PDFDict) for (const [, v] of xo.entries()) {
      const x = pdfDoc.context.lookup(v);
      const d = x && x.dict;
      if (d && d.get(PDFName.of('Subtype'))?.toString() === '/Form') walkRes(d.lookup(PDFName.of('Resources')));
    }
  };
  for (const p of pdfDoc.getPages()) { try { walkRes(p.node.Resources()); } catch (e) { /* ignore */ } }
  return out;
}

function makeFontKit(PDFLib, pdfDoc, glyphMaps) {
  const { StandardFonts } = PDFLib;
  const fontIdx = indexFonts(PDFLib, pdfDoc);
  const std = {};
  const embedded = typeof TINOS !== 'undefined' && typeof fontkit !== 'undefined';
  if (embedded) pdfDoc.registerFontkit(fontkit);
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const getStd = async (italic, bold) => {
    const key = (bold ? 'b' : '') + (italic ? 'i' : '') || 'r';
    if (!std[key]) {
      if (embedded) std[key] = await pdfDoc.embedFont(b64(TINOS[key]), { subset: true });
      else std[key] = await pdfDoc.embedFont(bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman);
    }
    return std[key];
  };
  const reuse = new Map(); // fontName -> {ref, map} usable for drawing
  for (const [name, gm] of glyphMaps) {
    const fi = fontIdx.get(name);
    if (!fi || !gm.map.size) continue;
    if (fi.subtype === '/Type0' && /Identity-H/.test(fi.encoding)) reuse.set(name, { ref: fi.ref, map: gm.map, bytes: 2 });
    else if ((fi.subtype === '/TrueType' || fi.subtype === '/Type1') && [...gm.map.values()].every((g) => g.code < 256)) reuse.set(name, { ref: fi.ref, map: gm.map, bytes: 1 });
  }
  return { getStd, reuse };
}

function sanitizeFor(font, text) {
  let cs; try { cs = new Set(font.getCharacterSet()); } catch (e) { cs = null; }
  const repl = { '‿': ' ', ' ': ' ', '‐': '-', '‑': '-', '−': '-', 'ʼ': '’' };
  let out = '';
  for (const ch of text) {
    const c = repl[ch] ?? ch;
    if (!cs || cs.has(c.codePointAt(0))) out += c;
    else { const base = c.normalize('NFKD').replace(/[̀-ͯ]/g, ''); out += (cs && [...base].every((b) => cs.has(b.codePointAt(0)))) ? base : '?'; }
  }
  return out;
}

/** Split text into runs drawable with the original font (when available) or a fallback font. */
async function shapeText(kit, slot, text, size) {
  const fb = await kit.getStd(slot.italic, slot.bold);
  const ru = kit.reuse.get(slot.fontName);
  const runs = [];
  let width = 0;
  const push = (kind, ch, w, code) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) { last.text += ch; last.w += w; if (code != null) last.codes.push(code); }
    else runs.push({ kind, text: ch, w, codes: code != null ? [code] : [] });
    width += w;
  };
  for (const ch0 of text) {
    const ch = ch0 === ' ' ? ' ' : ch0;
    const g = ru && (ru.map.get(ch) || (ch === "'" ? ru.map.get('’') : null));
    if (g) push('orig', ch, g.w * size / 1000, g.code);
    else if (ch === ' ' && ru) push('space', ch, 0.25 * size, null);
    else { const t = sanitizeFor(fb, ch); push('std', t, fb.widthOfTextAtSize(t, size), null); }
  }
  return { runs, width, fb, ru };
}

/**
 * Plan geometry for every row that has replaced syllables.
 * plan: Map slotId -> {text, cont, start, hold}
 */
async function layoutRows(kit, model, plan) {
  const { rows, slots, style } = model;
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const results = []; // per row: {row, items, marks:{white:[], hy:[], ext:[]}, warn}
  for (const row of rows) {
    const ss = row.slotIds.map((id) => slotById.get(id));
    if (!ss.some((s) => plan.has(s.id))) continue;
    const size = row.size;
    const hyLen = Math.min(style.hyphen.len, 0.45 * size), hyW = style.hyphen.w, hyOff = style.hyphen.off;
    const items = [];
    for (const s of ss) {
      const p = plan.get(s.id);
      if (!p) { items.push({ s, kept: true, x: s.x0, w: s.x1 - s.x0, cont: s.hyphenAfter, scale: 1 }); continue; }
      const text = p.text || '';
      const sh = text ? await shapeText(kit, s, text, s.size) : { runs: [], width: 0 };
      const anchorLeft = !!s.extenderAfter;
      const pref = anchorLeft ? s.x0 : (s.x0 + s.x1) / 2 - sh.width / 2;
      items.push({ s, kept: false, text, sh, w: sh.width, w0: sh.width, x: pref, pref, cont: !!p.cont, start: p.start !== false, hold: !!p.hold, scale: 1 });
    }
    // constraints
    const leftBound = Math.max(row.staff.x0 + 0.3 * size, ss[0].x0 - 0.6 * size);
    const rightBound = row.staff.x1 + 0.2 * size;
    const maxShift = 0.8 * size;
    const gapAfter = (i) => {
      const a = items[i], b = items[i + 1];
      if (!b) return 0;
      if (!a.text && !a.kept) return 0;
      const hy = a.kept ? (a.cont && (b.kept || !b.start)) : a.cont;
      return hy ? hyLen + 0.3 * size : 0.3 * size;
    };
    const clampShift = (it, x) => (it.kept ? it.x : Math.max(it.pref - maxShift, Math.min(it.pref + maxShift, x)));
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i + 1 < items.length; i++) {
        const a = items[i], b = items[i + 1];
        const aw = a.kept ? a.w : (a.text ? a.w : 0);
        const need = a.x + aw + gapAfter(i) - b.x;
        if (need <= 0.01) continue;
        if (!a.kept && !b.kept) { const na = clampShift(a, a.x - need / 2), nb = clampShift(b, b.x + need / 2); if (na !== a.x || nb !== b.x) moved = true; a.x = na; b.x = nb; }
        else if (!a.kept) { const na = clampShift(a, a.x - need); if (na !== a.x) moved = true; a.x = na; }
        else if (!b.kept) { const nb = clampShift(b, b.x + need); if (nb !== b.x) moved = true; b.x = nb; }
        const rem = a.x + (a.kept ? a.w : a.w) + gapAfter(i) - b.x;
        if (rem > 0.01) {
          // shrink the replaced one(s)
          const shrinkables = [a, b].filter((it) => !it.kept && it.text);
          const tot = shrinkables.reduce((t, it) => t + it.w, 0);
          if (tot > 0) {
            const f = Math.max(0.75, (tot - rem) / tot);
            for (const it of shrinkables) { const ns = Math.max(0.75, it.scale * f); if (ns < it.scale - 1e-3) { it.scale = ns; const oldC = it.x + it.w / 2; it.w = it.w0 * it.scale; if (!it.s.extenderAfter) it.x = oldC - it.w / 2; moved = true; } }
          }
        }
      }
      // bounds
      const f0 = items[0]; if (!f0.kept && f0.x < leftBound) { f0.x = leftBound; moved = true; }
      const lN = items[items.length - 1];
      if (!lN.kept && lN.x + lN.w > rightBound) {
        const over = lN.x + lN.w - rightBound; lN.x -= Math.min(over, maxShift); moved = true;
        if (lN.x + lN.w > rightBound && lN.w0) { lN.scale = Math.max(0.75, (rightBound - lN.x) / lN.w0); lN.w = lN.w0 * lN.scale; }
      }
      if (!moved) break;
    }
    // warnings
    let warn = null;
    for (let i = 0; i + 1 < items.length; i++) {
      const a = items[i], b = items[i + 1];
      if (a.kept && b.kept) continue;
      const over = a.x + a.w + (gapAfter(i) * 0.5) - b.x;
      if (over > 0.05 * size) { warn = 'crowded'; a.crowded = b.crowded = true; }
    }
    for (const it of items) if (!it.kept && it.scale < 0.86) { it.small = true; warn = warn || 'small'; }
    // marks: which gaps to clean and what to redraw
    const white = [], hy = [], ext = [];
    const extY = (s) => (s.extenderAfter ? s.extenderAfter.y : row.y + style.extender.off * size);
    for (let i = 0; i < items.length; i++) {
      const a = items[i], b = items[i + 1] || null;
      const touched = !a.kept || (b && !b.kept);
      if (!touched) continue;
      for (const mk of a.s.after) white.push(padBox(mk.box, (mk.w || 0.5) / 2 + 0.35, 0.4));
      if (!a.kept) white.push(slotBox(a.s));
      const aEnd = a.x + (a.text || a.kept ? a.w : 0);
      if (a.kept && !a.cont && !a.s.extenderAfter) continue;
      const hasText = a.kept || !!a.text;
      if (!hasText) continue;
      // hold: following empty "hold" slots extend this syllable
      let holdTo = null; let j = i + 1;
      while (items[j] && !items[j].kept && !items[j].text && items[j].hold) { holdTo = items[j].s.x1; j++; }
      const nextDrawn = items[j] || null;
      const contHy = a.kept ? (a.cont && (b ? (b.kept || !b.start) : true)) : a.cont;
      if (contHy) {
        if (nextDrawn) {
          const gx0 = aEnd, gx1 = nextDrawn.x;
          const room = gx1 - gx0;
          if (room > 0.12 * size) {
            const L = Math.max(0.12 * size, Math.min(hyLen, room - 0.2 * size));
            const cx = (gx0 + gx1) / 2;
            hy.push({ x0: cx - L / 2, x1: cx + L / 2, y: row.y + hyOff * size, w: hyW });
          }
        } else {
          hy.push({ x0: aEnd + 0.22 * size, x1: aEnd + 0.22 * size + hyLen, y: row.y + hyOff * size, w: hyW });
        }
      } else if (a.s.extenderAfter || holdTo != null) {
        let x1 = Math.max(a.s.extenderAfter ? a.s.extenderAfter.x1 : 0, holdTo ?? 0);
        if (nextDrawn) x1 = Math.min(x1, nextDrawn.x - 0.3 * size);
        const x0 = aEnd + 0.12 * size;
        if (x1 - x0 > 0.3 * size) ext.push({ x0, x1, y: extY(a.s), w: a.s.extenderAfter ? a.s.extenderAfter.w : style.extender.w });
      }
    }
    results.push({ row, items, white, hy, ext, warn });
  }
  return results;
}
function padBox(b, px, py) { return [b[0] - px, b[1] - py, b[2] + px, b[3] + py]; }
function slotBox(s) { return [s.x0 - 0.3 - 0.06 * s.size, s.bot - 0.35, s.x1 + 0.3 + 0.14 * s.size, s.top + 0.35 + 0.04 * s.size]; }

/** Draw everything onto the loaded pdf-lib document. pageInfo[pageIndex] = {mode:'vector'|'image', bg:[r,g,b]} */
async function drawOutput(PDFLib, pdfDoc, kit, layouts, pageInfo) {
  const { rgb, PDFName, PDFHexString, PDFNumber, PDFOperator, PDFOperatorNames, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, showText, setFillingGrayscaleColor } = PDFLib;
  const pages = pdfDoc.getPages();
  const fontNames = new Map(); // page index -> Map(fontName -> resource name)
  const resName = (pi, fontName) => {
    if (!fontNames.has(pi)) fontNames.set(pi, new Map());
    const m = fontNames.get(pi);
    if (!m.has(fontName)) {
      const nm = 'LyR' + (m.size + 1);
      pages[pi].node.setFontDictionary(PDFName.of(nm), kit.reuse.get(fontName).ref);
      m.set(fontName, nm);
    }
    return m.get(fontName);
  };
  for (const L of layouts) {
    const pi = L.row.page; const page = pages[pi];
    const info = pageInfo[pi] || {};
    const bg = info.bg ? rgb(info.bg[0], info.bg[1], info.bg[2]) : rgb(1, 1, 1);
    for (const b of L.white) page.drawRectangle({ x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], color: bg, borderWidth: 0 });
  }
  for (const L of layouts) {
    const pi = L.row.page; const page = pages[pi];
    for (const it of L.items) {
      if (it.kept || !it.text) continue;
      const size = it.s.size * it.scale;
      const k = it.scale;
      let x = it.x; const y = L.row.y;
      for (const r of it.sh.runs) {
        const w = r.w * k;
        if (r.kind === 'orig') {
          const ru = it.sh.ru; const nm = resName(pi, it.s.fontName);
          const hex = r.codes.map((c) => c.toString(16).padStart(ru.bytes * 2, '0')).join('');
          page.pushOperators(
            pushGraphicsState(), setFillingGrayscaleColor(0), beginText(), setFontAndSize(nm, size),
            PDFOperator.of(PDFOperatorNames.SetTextMatrix, [1, 0, 0, 1, x, y].map((n) => PDFNumber.of(n))),
            showText(PDFHexString.of(hex)), endText(), popGraphicsState(),
          );
        } else if (r.kind === 'std') {
          page.drawText(r.text, { x, y, size, font: it.sh.fb, color: rgb(0, 0, 0) });
        }
        x += w;
      }
    }
    for (const h of L.hy) page.drawLine({ start: { x: h.x0, y: h.y }, end: { x: h.x1, y: h.y }, thickness: h.w, color: rgb(0, 0, 0) });
    for (const e of L.ext) page.drawLine({ start: { x: e.x0, y: e.y }, end: { x: e.x1, y: e.y }, thickness: e.w, color: rgb(0, 0, 0) });
  }
}

if (typeof module !== 'undefined') module.exports = { indexFonts, makeFontKit, layoutRows, drawOutput, shapeText };
