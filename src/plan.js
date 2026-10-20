/* ===== Turning matches into editable lines and a slot plan ===== */
function sameWords(a, b, normChars) { return normChars(a).chars === normChars(b).chars; }

/**
 * Build editable line records from chosen occurrences.
 * Each line: {id, entryId, slotIds, scoreText, csvOriginal, csvNew, status, syls, source}
 */
function buildLines(model, entries, chosen, deps) {
  const { fitLine, normChars } = deps;
  const slotById = new Map(model.slots.map((s) => [s.id, s]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const lines = [];
  for (const o of chosen) {
    const e = entryById.get(o.entryId);
    const ss = o.slots.map((id) => slotById.get(id));
    const line = {
      id: lines.length, entryId: e.id, row: e.row, slotIds: o.slots.slice(), q: o.q, duplicate: !!o.duplicate,
      scoreText: ss.map((s, i) => s.text + (s.hyphenAfter && i < ss.length - 1 ? '-' : '')).join(' ').replace(/- /g, '-'),
      csvOriginal: e.original, csvNew: e.replacement || '', page: ss[0].page, sys: ss[0].sys,
    };
    if (!e.replacement || !e.replacement.trim()) { line.status = 'missing'; line.syls = null; }
    else if (sameWords(e.replacement, e.original, normChars)) { line.status = 'unchanged'; line.syls = null; }
    else {
      let rep = e.replacement.trim();
      // "(echo line)" written in parentheses in the table but not in the score
      if (/^\(.*\)$/.test(rep) && /^\(.*\)$/.test(e.original.trim()) && !/^\(/.test(ss[0].text)) rep = rep.slice(1, -1).trim();
      line.csvNew = rep;
      const f = fitLine(rep, ss.length);
      line.syls = f.syls; line.status = f.status === 'ok' ? 'ok' : f.status === 'adjusted' ? 'check' : 'mismatch';
      line.fitCount = f.count;
    }
    lines.push(line);
  }
  return lines;
}

/** Slot plan from lines: only lines whose syllable count matches their slots are applied. */
function buildPlan(lines) {
  const plan = new Map();
  for (const L of lines) {
    if (L.skip) continue;
    if (!L.syls || L.syls.length !== L.slotIds.length) continue;
    if (L.status === 'unchanged' || L.status === 'keep') continue;
    L.slotIds.forEach((id, i) => {
      const s = L.syls[i];
      const prev = L.syls[i - 1];
      plan.set(id, { text: s.text || '', cont: !!s.cont && i < L.slotIds.length - 1 ? true : !!s.cont, start: !prev || !prev.cont, hold: !!s.hold });
    });
  }
  return plan;
}

if (typeof module !== 'undefined') module.exports = { buildLines, buildPlan };
