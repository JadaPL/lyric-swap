/* ===== Document model: accepted lyric rows, slots, hyphens & extenders, lanes ===== */
function buildDocModel(pages, deps) {
  const { normChars, isExpressionToken, normLabel, isSubsequence, INSTRUMENT_RE } = deps;
  // 1. dominant lyric size
  const sizeVotes = new Map();
  for (const pg of pages) for (const r of pg.rows) {
    const toks = r.tokens.filter((t) => !isExpressionToken(t) && /\p{L}/u.test(t.text));
    if (toks.length >= 3) { const k = Math.round(r.size * 2) / 2; sizeVotes.set(k, (sizeVotes.get(k) || 0) + toks.length); }
  }
  const lyricSize = [...sizeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  // 2. canonical lane labels across the document
  const canon = []; // {key, names:Set}
  const laneOf = (label, idx) => {
    const n = normLabel(label || '');
    if (!n) return '#' + idx;
    for (const c of canon) {
      for (const nm of c.names) if (nm === n || (nm[0] === n[0] && (isSubsequence(n, nm) || isSubsequence(nm, n)))) { c.names.add(n); return c.key; }
    }
    const c = { key: label.trim(), names: new Set([n]) }; canon.push(c); return c.key;
  };
  const rows = [], slots = [];
  let sysBase = 0;
  const lineStyle = { hy: [], ext: [] };
  for (const pg of pages) {
    // lyric font on this page: the font with most tokens in good rows
    const fontVotes = new Map();
    for (const r of pg.rows) {
      if (Math.abs(r.size - lyricSize) > 0.12 * lyricSize) continue;
      const toks = r.tokens.filter((t) => !isExpressionToken(t) && /\p{L}/u.test(t.text));
      if (toks.length >= 3) for (const t of toks) fontVotes.set(t.fontId, (fontVotes.get(t.fontId) || 0) + 1);
    }
    const lyricFont = [...fontVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const pageRows = [];
    for (const r of pg.rows) {
      if (!lyricSize || Math.abs(r.size - lyricSize) > 0.12 * lyricSize) continue;
      if (r.staff.label && INSTRUMENT_RE.test(normLabel(r.staff.label).replace(/\d+$/, ''))) continue;
      const toks = r.tokens.filter((t) => !/^\d+$/.test(t.text.trim()));
      const words = toks.filter((t) => /\p{L}/u.test(t.text));
      if (!words.length) continue;
      const exprShare = words.filter(isExpressionToken).length / words.length;
      if (exprShare > 0.5) continue;
      const inFont = words.filter((t) => t.fontId === lyricFont).length;
      if (lyricFont != null && inFont === 0 && words.length < 3) continue;
      if (lyricFont != null && inFont / words.length < 0.5 && (words.length < 3 || /^\(/.test(words[0].text))) continue;
      pageRows.push({ r, toks });
    }
    // verse index per staff
    const byStaff = new Map();
    for (const pr of pageRows) { if (!byStaff.has(pr.r.staff)) byStaff.set(pr.r.staff, []); byStaff.get(pr.r.staff).push(pr); }
    for (const [staff, list] of byStaff) {
      list.sort((a, b) => b.r.y - a.r.y);
      list.forEach((pr, vi) => { pr.verse = vi; });
    }
    const musicToks = pg.tokens.filter((t) => t.music);
    for (const pr of pageRows) {
      const r = pr.r; const size = r.size;
      const row = {
        id: rows.length, page: pg.pageIndex, sys: sysBase + r.staff.system, lane: laneOf(r.staff.label, r.staff.idxInSystem),
        verse: pr.verse, y: r.y, size, slotIds: [], staffLabel: r.staff.label || '', lead: [], trail: [],
        staff: { x0: r.staff.x0, x1: r.staff.x1, top: r.staff.top, bottom: r.staff.bottom, space: r.staff.space },
      };
      rows.push(row);
      // text hyphen/underscore tokens are separators
      const real = [];
      const marks = [];
      for (const t of pr.toks) {
        const tx = t.text.trim();
        if (/^[-–‐]+$/.test(tx)) marks.push({ x0: t.x0, x1: t.x1, y0: t.y + 0.15 * size, y1: t.y + 0.45 * size, y: t.y + 0.3 * size, w: 0.06 * size, glyph: true, kind: 'hy', box: [t.x0, t.bot, t.x1, t.top] });
        else if (/^[_]+$/.test(tx)) marks.push({ x0: t.x0, x1: t.x1, y0: t.y - 0.1 * size, y1: t.y + 0.05 * size, y: t.y, w: 0.06 * size, glyph: true, kind: 'ext', box: [t.x0, t.bot, t.x1, t.top] });
        else if (/[\p{L}\p{N}]/u.test(tx)) real.push(t);
      }
      // vector lines in the lyric band
      for (const s of pg.segs) {
        const off = s.y - r.y;
        if (off < -0.32 * size || off > 0.6 * size) continue;
        if (s.x1 - s.x0 > 0.85 * (r.staff.x1 - r.staff.x0)) continue;
        if (s.x0 < r.staff.x0 - 2 || s.x1 > r.staff.x1 + 2) continue;
        if (real.some((t) => s.x0 < t.x1 - 0.3 && s.x1 > t.x0 + 0.3)) continue;
        if (musicToks.some((m) => s.x0 < m.x1 && s.x1 > m.x0 && s.y0 < m.top && s.y1 > m.bot)) continue;
        const kind = off > 0.12 * size && (s.x1 - s.x0) < 1.6 * size ? 'hy' : 'ext';
        marks.push({ ...s, kind, box: [s.x0, s.y0, s.x1, s.y1] });
      }
      real.sort((a, b) => a.x0 - b.x0);
      const slotObjs = real.map((t) => {
        const n = normChars(t.text);
        const sl = {
          id: slots.length, rowId: row.id, page: pg.pageIndex, sys: row.sys, lane: row.lane, verse: row.verse,
          text: t.text, norm: n.chars, x0: t.x0, x1: t.x1, y: t.y, top: t.top, bot: t.bot, size: t.size,
          italic: t.italic, bold: t.bold, fontId: t.fontId, fontName: t.fontName, after: [], glyphs: t.glyphs || null,
        };
        slots.push(sl); return sl;
      });
      for (const mk of marks) {
        const cx = (mk.x0 + mk.x1) / 2;
        let k = 0; while (k < slotObjs.length && slotObjs[k].x1 <= cx) k++;
        if (k === 0) row.lead.push(mk); else slotObjs[k - 1].after.push(mk);
        if (!mk.glyph) (mk.kind === 'hy' ? lineStyle.hy : lineStyle.ext).push({ len: mk.x1 - mk.x0, w: mk.w, off: (mk.y - r.y) / size });
      }
      for (const sl of slotObjs) {
        sl.hyphenAfter = sl.after.some((m) => m.kind === 'hy');
        const ex = sl.after.filter((m) => m.kind === 'ext');
        sl.extenderAfter = ex.length ? { x0: Math.min(...ex.map((m) => m.x0)), x1: Math.max(...ex.map((m) => m.x1)), y: ex[0].y, w: ex[0].w } : null;
        row.slotIds.push(sl.id);
      }
      if (row.lead.length) { row.leadExt = row.lead.filter((m) => m.kind === 'ext'); }
    }
    sysBase += Math.max(1, pg.systems.length);
  }
  const med = (a, f) => { const v = a.map(f).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const style = {
    lyricSize,
    hyphen: { len: med(lineStyle.hy, (h) => h.len) ?? 0.3 * lyricSize, w: med(lineStyle.hy, (h) => h.w) ?? 0.05 * lyricSize, off: med(lineStyle.hy, (h) => h.off) ?? 0.25 },
    extender: { w: med(lineStyle.ext, (h) => h.w) ?? 0.05 * lyricSize, off: med(lineStyle.ext, (h) => h.off) ?? 0 },
  };
  return { rows, slots, style, lanes: canon.map((c) => c.key) };
}

if (typeof module !== 'undefined') module.exports = { buildDocModel };
