/* ===== English syllable splitting and fitting new lyrics onto note slots ===== */
const SYL_DICT = {
  // word: default split (hyphens), optional alternatives separated by |
  every: 'ev-ery|ev-er-y', everything: 'ev-ery-thing|ev-er-y-thing', everyone: 'ev-ery-one|ev-er-y-one', everybody: 'ev-ery-bod-y',
  fire: 'fire|fi-re', hire: 'hire|hi-re', tired: 'tired|ti-red', desire: 'de-sire|de-si-re', choir: 'choir|cho-ir',
  our: 'our|ou-r', hour: 'hour|hou-r', hours: 'hours|hou-rs', flower: 'flow-er|flower', power: 'pow-er|power', tower: 'tow-er|tower', shower: 'show-er|shower',
  heaven: 'heav-en|heaven', heavens: 'heav-ens', being: 'be-ing', seeing: 'see-ing', doing: 'do-ing', going: 'go-ing', ruin: 'ru-in', ruins: 'ru-ins',
  theatre: 'the-a-tre|thea-tre', theater: 'the-a-ter|thea-ter', idea: 'i-de-a', ideas: 'i-de-as', real: 'real|re-al', really: 're-al-ly|real-ly',
  create: 'cre-ate', created: 'cre-at-ed', quiet: 'qui-et', science: 'sci-ence', lion: 'li-on', poem: 'po-em', poet: 'po-et', area: 'ar-e-a',
  family: 'fam-i-ly|fam-ly', different: 'dif-fer-ent|dif-frent', evening: 'eve-ning', chocolate: 'choc-o-late|choc-late', camera: 'cam-er-a',
  beautiful: 'beau-ti-ful', people: 'peo-ple', little: 'lit-tle', world: 'world', girl: 'girl', there: 'there', where: 'where', here: 'here',
  were: 'were', more: 'more', some: 'some', come: 'come', done: 'done', gone: 'gone', one: 'one', once: 'once', love: 'love', above: 'a-bove',
  have: 'have', give: 'give', live: 'live', lives: 'lives', move: 'move', prove: 'prove', whose: 'whose', those: 'those', these: 'these',
  the: 'the', be: 'be', he: 'he', me: 'me', we: 'we', she: 'she', ye: 'ye', recipe: 're-ci-pe', karaoke: 'kar-a-o-ke', acapella: 'a-ca-pel-la',
  acappella: 'a-cap-pel-la', cappella: 'cap-pel-la', alumni: 'a-lum-ni', alumnae: 'a-lum-nae', psets: 'p-sets', choreo: 'cho-re-o|chor-eo',
  choreos: 'cho-re-os|chor-eos', 'choreo’s': 'cho-re-o’s|chor-eo’s', "choreo's": "cho-re-o's|chor-eo's", rehearsal: 're-hears-al', rehearsals: 're-hears-als',
  audition: 'au-di-tion', competition: 'com-pe-ti-tion', semester: 'se-mes-ter', harmonies: 'har-mo-nies', parody: 'par-o-dy', dominos: 'dom-i-nos',
  dominoes: 'dom-i-noes', boba: 'bo-ba', schmancy: 'schman-cy', fancy: 'fan-cy', thespians: 'thes-pi-ans', thespian: 'thes-pi-an', groovy: 'groov-y',
  noteafine: 'note-a-fine', homemade: 'home-made', someone: 'some-one', something: 'some-thing', sometimes: 'some-times', somewhere: 'some-where', lovely: 'love-ly', lonely: 'lone-ly', safety: 'safe-ty', careful: 'care-ful', hopeless: 'hope-less', movement: 'move-ment', statement: 'state-ment', lifetime: 'life-time', guarantee: 'guar-an-tee', guaranteed: 'guar-an-teed', between: 'be-tween', before: 'be-fore', because: 'be-cause', believe: 'be-lieve', become: 'be-come', begin: 'be-gin', behind: 'be-hind', below: 'be-low', beyond: 'be-yond', remember: 're-mem-ber', forever: 'for-ev-er', together: 'to-geth-er', never: 'nev-er', ever: 'ev-er', over: 'o-ver', every: 'ev-ery|ev-er-y', lover: 'lov-er', lovers: 'lov-ers', river: 'riv-er', even: 'e-ven', easy: 'eas-y', busy: 'bus-y', pretty: 'pret-ty', city: 'cit-y', money: 'mon-ey', honey: 'hon-ey', journey: 'jour-ney', lady: 'la-dy', baby: 'ba-by', body: 'bod-y', story: 'sto-ry', glory: 'glo-ry', sorry: 'sor-ry', worry: 'wor-ry', hurry: 'hur-ry', carry: 'car-ry', carrying: 'car-ry-ing', marry: 'mar-ry', merry: 'mer-ry', very: 'ver-y', many: 'man-y', any: 'an-y', only: 'on-ly', lowell: 'Low-ell', banker: 'bank-er', poster: 'post-er', posters: 'post-ers', wicked: 'wick-ed', crooked: 'crook-ed', naked: 'nak-ed', learned: 'learn-ed|learned', aged: 'ag-ed|aged', notea: 'note-a', 'notea-day': 'note-a-day', blessed: 'bless-ed|blessed', beloved: 'be-lov-ed|be-loved', cookies: 'cook-ies',
  brownies: 'brown-ies', business: 'bus-i-ness|busi-ness', cruel: 'cru-el|cruel', fuel: 'fu-el|fuel', jewel: 'jew-el|jewel', towel: 'tow-el',
  usual: 'u-su-al', actually: 'ac-tu-al-ly', naturally: 'nat-u-ral-ly', vibin: 'vib-in', tryin: 'try-in', tryouts: 'try-outs', doin: 'do-in', goin: 'go-in',
};

const VOWELS = 'aeiouy';
const HIATUS_STRONG = ['ia', 'io', 'iu', 'eo', 'ua', 'uo', 'ii', 'oe'];
const HIATUS_WEAK = ['ea', 'ie', 'ue', 'ui', 'oa', 'ya', 'ye', 'yo', 'eu', 'ao', 'ae'];

const isV = (c) => 'aeiou'.includes(c);

/** Vowel groups with 'y' handled: vowel after a consonant or at the end; a glide after a vowel. */
function vowelGroups(w) {
  const n = w.length; const groups = [];
  let i = 0;
  while (i < n) {
    const c = w[i];
    const yVowel = c === 'y' && i > 0 && !isV(w[i - 1]);
    if (isV(c) || yVowel) {
      let j = i + 1;
      if (!yVowel) {
        while (j < n && isV(w[j])) j++;
        // diphthong ay/ey/oy/uy (not before a vowel)
        if (j < n && w[j] === 'y' && !(j + 1 < n && isV(w[j + 1]))) j++;
      }
      groups.push([i, j]); i = j;
    } else i++;
  }
  // split hiatus inside groups ("li-on", "the-o-ry"), but not after q/g ("quad", "guard")
  const out = [];
  for (const [a, b] of groups) {
    let s = a;
    for (let k = a; k + 1 < b; k++) {
      const pair = w.slice(k, k + 2);
      if (k === a && pair[0] === 'u' && a > 0 && 'qg'.includes(w[a - 1])) continue;
      if (HIATUS_STRONG.includes(pair)) { out.push([s, k + 1]); s = k + 1; }
    }
    out.push([s, b]);
  }
  return out;
}

const SUFFIXES = ['ings', 'ing', 'in', 'ins'];
/** Split lowercase letters-only core into syllables (array of [start,end) index pairs). */
function splitCore(w) {
  const n = w.length;
  if (!n) return [];
  let G = vowelGroups(w);
  // silent final e / es / ed
  if (G.length > 1) {
    const last = G[G.length - 1];
    const tail = w.slice(last[0]);
    const before = w.slice(0, last[0]);
    const cle = before.length >= 2 && before.endsWith('l') && !isV(before[before.length - 2]) && before[before.length - 2] !== 'y';
    if (tail === 'e') { if (!cle) G = G.slice(0, -1); }
    else if (tail === 'es') { if (!cle && !/(s|x|z|ch|sh|c|g)$/.test(before)) G = G.slice(0, -1); }
    else if (tail === 'ed') { if (!cle && !/[td]$/.test(before) && !/[^aeiouyr]r$/.test(before)) G = G.slice(0, -1); }
  }
  if (G.length <= 1) return [[0, n]];
  // suffix -ing / -in' : cut right before it ("wash-ing", "sweat-in'", "freez-ing")
  let sufCut = -1;
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && n - suf.length >= 2) {
      const at = n - suf.length;
      const lastG = G[G.length - 1];
      if (lastG[0] === at && !isV(w[at - 1]) && w[at - 1] !== 'y') { sufCut = at; break; }
      if (lastG[0] === at && (isV(w[at - 1]) || w[at - 1] === 'y')) { sufCut = at; break; }
    }
  }
  if (sufCut < 0) {
    const lastG = G[G.length - 1]; const tail = w.slice(lastG[0]);
    if ((tail === 'es' && /(sh|ch|ss|x|z)$/.test(w.slice(0, lastG[0]))) || (tail === 'ed' && /[^aeiouy][td]$/.test(w.slice(0, lastG[0])))) sufCut = lastG[0];
  }
  const cuts = [];
  for (let k = 0; k + 1 < G.length; k++) {
    const endV = G[k][1], nextV = G[k + 1][0];
    const cons = w.slice(endV, nextV);
    let cut;
    if (k + 2 === G.length && sufCut > 0) cut = sufCut;
    else if (cons.length === 0) cut = endV;
    else if (cons.length === 1) cut = (cons === 'x' || ((cons === 'w' || cons === 'y') && isV(w[endV - 1]))) ? nextV : endV;
    else if (cons.length === 2) {
      if (['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'qu', 'tw', 'dw', 'sw'].includes(cons)) cut = endV;
      else if (cons === 'ck' || cons === 'ng' || cons === 'nk' && nextV + 1 >= n) cut = nextV;
      else if (/^(bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|tr)$/.test(cons) && !(k + 2 === G.length && w.endsWith('le'))) cut = endV;
      else cut = endV + 1;
    } else {
      const rest = cons.slice(1);
      if (/^(ch|sh|th|ph|wh|tw)/.test(rest) || /^(bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|tr)/.test(rest) || /^s[ptkc][lr]?$/.test(rest)) cut = endV + 1;
      else if (/^(ch|sh|th|ck|ng|nk)/.test(cons)) cut = endV + 2;
      else cut = endV + 2;
    }
    // consonant + le / les / led ending: "bot-tle", "ta-ble", "sprin-kled"
    if (k + 2 === G.length && /[^aeiouy](le|les|led)$/.test(w)) {
      const L = w.lastIndexOf('l');
      if (L - 1 > G[k][0]) cut = L - 1;
    }
    cuts.push(Math.max(G[k][0] + 1, Math.min(cut, G[k + 1][0])));
  }
  const parts = []; let s = 0;
  for (const c of cuts) { if (c > s && c < n) { parts.push([s, c]); s = c; } }
  parts.push([s, n]);
  return parts;
}

/** Split one display word (may carry punctuation, apostrophes, user hyphens) into syllable options. */
function syllabifyWord(word) {
  const m = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  const lead = m ? m[1] : '', core = m ? m[2] : word, trail = m ? m[3] : '';
  if (!core) return { options: [[word]] };
  // user hyphens split explicitly
  if (/[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(core)) {
    const pieces = core.split('-');
    let combos = [[]];
    for (const p of pieces) {
      const o = syllabifyWord(p).options;
      const next = [];
      for (const c of combos) for (const opt of o.slice(0, 3)) next.push(c.concat(opt));
      combos = next.slice(0, 8);
    }
    combos = combos.map((c) => { const x = c.slice(); x[0] = lead + x[0]; x[x.length - 1] += trail; return x; });
    return { options: dedupe(combos) };
  }
  const key = core.toLowerCase().replace(/[’']/g, '’');
  const keyPlain = key.replace(/’/g, '');
  const dictHit = SYL_DICT[key] || SYL_DICT[keyPlain] || SYL_DICT[key.replace(/’s$/, '')] && SYL_DICT[key.replace(/’s$/, '')].split('|').map((v) => v + '’s').join('|')
    || SYL_DICT[keyPlain.replace(/s$/, '')] && /[^s]s$/.test(keyPlain) && SYL_DICT[keyPlain.replace(/s$/, '')].split('|').map((v) => v + 's').join('|');
  let options = [];
  if (dictHit) {
    for (const alt of dictHit.split('|')) options.push(mapCase(core, alt.split('-')));
  } else {
    // acronyms: all caps without vowels -> letters
    if (/^[A-Z]{2,}$/.test(core) && !/[AEIOUY]/.test(core)) options.push(core.split(''));
    // camel prefix like "PSets" -> "P" + "Sets"
    if (/^[A-Z][A-Z][a-z]/.test(core)) { const rest = syllabifyWord(core.slice(1)).options[0]; options.push([core[0], ...rest]); }
    // internal apostrophe between syllables ("have’ta")
    const ap = core.match(/^(.*[aeiouy].*?)[’'](.*[aeiouy].*)$/i);
    if (ap && !options.length) {
      const pa = syllabifyWord(ap[1]).options[0], pb = syllabifyWord(ap[2]).options[0];
      const sep = core[ap[1].length];
      options.push([...pa.slice(0, -1), pa[pa.length - 1] + sep, ...pb]);
    }
    const letters = core;
    const lower = letters.toLowerCase();
    const map = []; let clean = '';
    for (let i = 0; i < lower.length; i++) { if (/\p{L}/u.test(lower[i])) { map.push(i); clean += lower[i]; } }
    const cs = splitCore(clean);
    const heur = cs.map(([a, b], idx) => {
      const s0 = idx === 0 ? 0 : map[a];
      const e0 = idx === cs.length - 1 ? letters.length : map[b];
      return letters.slice(s0, e0);
    }).filter(Boolean);
    options.push(heur.length ? heur : [core]);
    const more = splitWeakHiatus(core);
    if (more && more.length === heur.length + 1) options.push(more);
    if (heur.length > 1) {
      const last = heur[heur.length - 1];
      if (/^[^aeiouy]*(ed|es|en|er|el|ered|ering)[^\p{L}]*$/iu.test(last) || /[aeiou]y$/i.test(heur[heur.length - 2])) {
        options.push([...heur.slice(0, -2), heur[heur.length - 2] + last]);
      }
    }
  }
  options = options.map((o) => { const x = o.slice(); x[0] = lead + x[0]; x[x.length - 1] += trail; return x; });
  return { options: dedupe(options) };
}
function mapCase(core, parts) {
  // keep the user's capitalisation/apostrophes by consuming core chars in order
  const out = []; let pos = 0; const plain = core;
  for (const p of parts) {
    let take = '';
    let need = p.replace(/[’']/g, '').length;
    while (pos < plain.length && need > 0) { const ch = plain[pos++]; take += ch; if (/\p{L}|\p{N}/u.test(ch)) need--; }
    while (pos < plain.length && /[’']/.test(plain[pos])) take += plain[pos++];
    out.push(take);
  }
  if (pos < plain.length) out[out.length - 1] += plain.slice(pos);
  return out.filter((x) => x.length);
}
function splitWeakHiatus(core) {
  const lower = core.toLowerCase();
  for (const pair of HIATUS_WEAK) {
    const i = lower.indexOf(pair);
    if (i > 0 && i + 2 < lower.length + 1) {
      const a = core.slice(0, i + 1), b = core.slice(i + 1);
      if (!/[aeiouy]/i.test(b)) continue;
      const pa = syllabifyWord(a).options[0], pb = syllabifyWord(b).options[0];
      return [...pa, ...pb];
    }
  }
  return null;
}
function dedupe(list) { const seen = new Set(); return list.filter((o) => { const k = o.join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); }

/** Tokenize a lyric line into words, keeping punctuation attached. */
function lineWords(text) {
  const raw = String(text || '').replace(/[\u2013\u2014]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    if (/[\p{L}\p{N}]/u.test(w)) out.push(w);
    else if (out.length) out[out.length - 1] += w;
  }
  return out;
}

/**
 * Fit text onto k slots. Returns {syls:[{text, cont}], status: 'ok'|'adjusted'|'mismatch', count}.
 * cont = next syllable continues the same word (draw a hyphen).
 */
function fitLine(text, k) {
  const words = lineWords(text);
  const wopts = words.map((w) => syllabifyWord(w).options);
  const def = wopts.map((o) => {
    // default = heuristic or dictionary first option
    return o[0];
  });
  const total = def.reduce((s, o) => s + o.length, 0);
  let chosen = def, status = 'ok';
  if (total !== k && k > 0) {
    // search over options to hit k, minimal number of changed words
    const best = searchFit(wopts, k);
    if (best) { chosen = best; status = 'adjusted'; } else status = 'mismatch';
  }
  const syls = [];
  chosen.forEach((parts) => parts.forEach((p, i) => syls.push({ text: p, cont: i < parts.length - 1 })));
  return { syls, status, count: syls.length };
}
function searchFit(wopts, k) {
  // DP: dp[i][c] = min changes using first i words with total c syllables
  const n = wopts.length; const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Map());
  dp[0].set(0, { cost: 0, pick: null });
  for (let i = 0; i < n; i++) {
    for (const [c, st] of dp[i]) {
      wopts[i].forEach((opt, j) => {
        const nc = c + opt.length; if (nc > k) return;
        const cost = st.cost + (j === 0 ? 0 : 1);
        const cur = dp[i + 1].get(nc);
        if (!cur || cur.cost > cost) dp[i + 1].set(nc, { cost, pick: j, prev: c });
      });
    }
  }
  const end = dp[n].get(k);
  if (!end || end.cost > Math.max(2, Math.ceil(n / 3))) return null;
  const picks = []; let c = k;
  for (let i = n; i > 0; i--) { const st = dp[i].get(c); picks.unshift(wopts[i - 1][st.pick]); c = st.prev; }
  return picks;
}

/** Parse a user-typed syllable line: spaces separate notes, '-' joins syllables of a word, '_' or '*' leaves a note empty. */
function parseTyped(text) {
  const out = [];
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (/^[_*]+$/.test(tok)) { for (let i = 0; i < tok.length; i++) out.push({ text: '', cont: false, hold: true }); continue; }
    const parts = tok.split(/(?<=[\p{L}\p{N}’'.,!?;:)\]"”])-(?=[\p{L}\p{N}‘'"“(\[]|$)/u).filter((p) => p !== '');
    parts.forEach((p, i) => out.push({ text: p.replace(/~/g, ' '), cont: i < parts.length - 1 || /-$/.test(tok) && i === parts.length - 1 }));
  }
  return out;
}
function sylsToTyped(syls) {
  let s = '';
  syls.forEach((x, i) => {
    const t = x.hold || !x.text ? '_' : x.text.replace(/ /g, '~');
    s += t + (x.cont ? '-' : (i < syls.length - 1 ? ' ' : ''));
  });
  return s;
}

if (typeof module !== 'undefined') module.exports = { syllabifyWord, fitLine, parseTyped, sylsToTyped, lineWords, splitCore };
