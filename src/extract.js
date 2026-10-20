/* ===== Vector extraction: walk pdf.js operator list, collect glyphs, lines, images ===== */
function mmul(m, n) { // m × n  (pdf.js convention: apply n first? -> Util.transform(m, n))
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function xform(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

async function extractVectorPage(pdfjsLib, page, glyphMaps = new Map()) {
  const OPS = pdfjsLib.OPS;
  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray, argsArray = opList.argsArray;
  const glyphs = [];   // {ch, x0, x1, y (baseline), size, fontId, italic, bold, ascent, descent, runId}
  const segs = [];     // horizontal-ish segments {x0,x1,y0,y1,w,kind}
  const vsegs = [];    // vertical segments
  const images = [];   // {x0,y0,x1,y1}
  let st = {
    ctm: [1, 0, 0, 1, 0, 0], font: null, fontSize: 0, fontDir: 1, fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, tm: [1, 0, 0, 1, 0, 0],
    x: 0, y: 0, lineX: 0, lineY: 0, lineWidth: 1, renderMode: 0,
  };
  const stack = [];
  let pendingPath = null;
  let runId = 0;
  const fontCache = new Map();
  const getFont = (name) => {
    if (fontCache.has(name)) return fontCache.get(name);
    let f = null;
    try { f = page.commonObjs.get(name); } catch (e) { try { f = page.objs.get(name); } catch (e2) { f = null; } }
    fontCache.set(name, f);
    return f;
  };
  const fontIds = new Map();
  const fontId = (f) => { const k = f ? (f.loadedName || f.name) : 'none'; if (!fontIds.has(k)) fontIds.set(k, fontIds.size); return fontIds.get(k); };

  function showText(arr) {
    const f = st.font; const size = st.fontSize;
    if (!f || !size) return;
    const fm = st.fontMatrix;
    const widthAdvanceScale = size * fm[0];
    const textHScale = st.hScale * st.fontDir;
    const m = mmul(st.ctm, st.tm);
    let x = 0;
    const id = runId++;
    const invisible = st.renderMode === 3 || st.renderMode === 7;
    const asc = (typeof f.ascent === 'number' && f.ascent > 0.7 && f.ascent < 1.1) ? f.ascent : 0.8;
    const desc = (typeof f.descent === 'number' && f.descent < -0.15 && f.descent > -0.4) ? -f.descent : 0.24;
    const fname = f.name || f.loadedName || '';
    let gmap = glyphMaps.get(fname);
    if (!gmap) { gmap = { type: f.type || '', map: new Map() }; glyphMaps.set(fname, gmap); }
    const fid = fontId(f);
    const nameStr = (f.name || '') + ' ' + (f.fallbackName || '');
    const italic = !!f.italic || /italic|oblique/i.test(nameStr);
    const bold = !!f.bold || /bold|black|heavy/i.test(nameStr);
    for (const g of arr) {
      if (typeof g === 'number') { x += -g * size / 1000; continue; }
      const spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing;
      const w = (g.width || 0) * widthAdvanceScale;
      const ox = st.x + x * textHScale, oy = st.y + st.rise;
      const ex = st.x + (x + w) * textHScale;
      const p0 = xform(m, ox, oy), p1 = xform(m, ex, oy);
      const pTop = xform(m, ox, oy + asc * size);
      const pBot = xform(m, ox, oy - desc * size);
      const scaleY = Math.hypot(m[2], m[3]);
      if (g.unicode && g.unicode.length === 1 && typeof g.originalCharCode === 'number' && !gmap.map.has(g.unicode)) gmap.map.set(g.unicode, { code: g.originalCharCode, w: g.width || 0 });
      if (!invisible) glyphs.push({
        ch: g.unicode || '', x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y: p0[1],
        top: Math.max(pTop[1], pBot[1]), bot: Math.min(pTop[1], pBot[1]),
        size: size * scaleY, fontId: fid, fontName: fname, italic, bold, runId: id,
        upright: Math.abs(m[1]) < 1e-3 * Math.abs(m[0]) && m[0] > 0,
      });
      x += w + spacing * st.fontDir;
    }
    st.x += x * textHScale;
  }

  function flushPath(paint) {
    if (!pendingPath) return;
    const { ops, args } = pendingPath; pendingPath = null;
    if (paint === 'none') return;
    const m = st.ctm;
    const lw = st.lineWidth * Math.hypot(m[0], m[1]) || 0.1;
    // break into subpaths of points
    let ai = 0; let cur = []; const subs = [];
    for (const op of ops) {
      if (op === OPS.moveTo) { if (cur.length) subs.push(cur); cur = [xform(m, args[ai], args[ai + 1])]; ai += 2; }
      else if (op === OPS.lineTo) { cur.push(xform(m, args[ai], args[ai + 1])); ai += 2; }
      else if (op === OPS.curveTo) { cur.push(null); cur.push(xform(m, args[ai + 4], args[ai + 5])); ai += 6; }
      else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur.push(null); cur.push(xform(m, args[ai + 2], args[ai + 3])); ai += 4; }
      else if (op === OPS.closePath) { /* keep */ }
      else if (op === OPS.rectangle) {
        if (cur.length) subs.push(cur);
        const [x, y, w, h] = [args[ai], args[ai + 1], args[ai + 2], args[ai + 3]]; ai += 4;
        subs.push([xform(m, x, y), xform(m, x + w, y), xform(m, x + w, y + h), xform(m, x, y + h), 'rect']);
        cur = [];
      }
    }
    if (cur.length) subs.push(cur);
    for (const s of subs) {
      const isRect = s[s.length - 1] === 'rect';
      const pts = s.filter((p) => p && p !== 'rect');
      const hasCurve = s.includes(null);
      if (pts.length < 2) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (paint === 'stroke' && !hasCurve && pts.length === 2) {
        if (y1 - y0 < 0.6 && x1 - x0 > 0.3) segs.push({ x0, x1, y0: y0 - lw / 2, y1: y1 + lw / 2, y: (y0 + y1) / 2, w: lw, kind: 'stroke' });
        else if (x1 - x0 < 0.6 && y1 - y0 > 2) vsegs.push({ x: (x0 + x1) / 2, y0, y1, w: lw });
      } else if (paint === 'fill' && !hasCurve && (isRect || pts.length === 4 || pts.length === 5)) {
        if (y1 - y0 < 1.6 && x1 - x0 > 0.5 && (x1 - x0) > 1.5 * (y1 - y0)) segs.push({ x0, x1, y0, y1, y: (y0 + y1) / 2, w: y1 - y0, kind: 'fill' });
        else if (x1 - x0 < 1.6 && y1 - y0 > 2) vsegs.push({ x: (x0 + x1) / 2, y0, y1, w: x1 - x0 });
      }
    }
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ...st, ctm: st.ctm.slice(), tm: st.tm.slice() }); break;
      case OPS.restore: if (stack.length) st = stack.pop(); break;
      case OPS.transform: st.ctm = mmul(st.ctm, a); break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...st, ctm: st.ctm.slice(), tm: st.tm.slice() });
        if (a && Array.isArray(a[0]) && a[0].length === 6) st.ctm = mmul(st.ctm, a[0]);
        break;
      case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
      case OPS.setLineWidth: st.lineWidth = a[0]; break;
      case OPS.beginText: st.tm = [1, 0, 0, 1, 0, 0]; st.x = st.y = st.lineX = st.lineY = 0; break;
      case OPS.setFont: {
        const f = getFont(a[0]); let size = a[1];
        st.fontDir = size < 0 ? -1 : 1; size = Math.abs(size);
        st.font = f; st.fontSize = size; st.fontMatrix = (f && f.fontMatrix) || [0.001, 0, 0, 0.001, 0, 0];
        break;
      }
      case OPS.setTextMatrix: st.tm = Array.from(a.length === 6 ? a : a[0]); st.x = st.y = st.lineX = st.lineY = 0; break;
      case OPS.moveText: st.lineX += a[0]; st.lineY += a[1]; st.x = st.lineX; st.y = st.lineY; break;
      case OPS.setLeadingMoveText: st.leading = a[1]; st.lineX += a[0]; st.lineY += a[1]; st.x = st.lineX; st.y = st.lineY; break;
      case OPS.setLeading: st.leading = -a[0]; break;
      case OPS.nextLine: st.lineY += st.leading; st.x = st.lineX; st.y = st.lineY; break;
      case OPS.setCharSpacing: st.charSpacing = a[0]; break;
      case OPS.setWordSpacing: st.wordSpacing = a[0]; break;
      case OPS.setHScale: st.hScale = a[0] / 100; break;
      case OPS.setTextRise: st.rise = a[0]; break;
      case OPS.setTextRenderingMode: st.renderMode = a[0]; break;
      case OPS.showText: case OPS.showSpacedText: showText(a[0]); break;
      case OPS.nextLineShowText: st.lineY += st.leading; st.x = st.lineX; st.y = st.lineY; showText(a[0]); break;
      case OPS.nextLineSetSpacingShowText: st.wordSpacing = a[0]; st.charSpacing = a[1]; st.lineY += st.leading; st.x = st.lineX; st.y = st.lineY; showText(a[2]); break;
      case OPS.constructPath: pendingPath = { ops: a[0], args: a[1] }; break;
      case OPS.stroke: case OPS.closeStroke: flushPath('stroke'); break;
      case OPS.fill: case OPS.eoFill: flushPath('fill'); break;
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: flushPath('fill'); break;
      case OPS.endPath: flushPath('none'); break;
      case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageMaskXObject: case OPS.paintJpegXObject: {
        const p = [xform(st.ctm, 0, 0), xform(st.ctm, 1, 0), xform(st.ctm, 0, 1), xform(st.ctm, 1, 1)];
        const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
        images.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        break;
      }
      default: break;
    }
  }
  return { glyphs, segs, vsegs, images, glyphMaps };
}

if (typeof module !== 'undefined') module.exports = { extractVectorPage, mmul, xform };
