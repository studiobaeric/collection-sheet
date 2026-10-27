
/* =========================================================================
 * 2. Erkennung: Begriffe, Felder aus Quellzeilen, Fingerabdruck, Set-Zuordnung,
 *    Kartenerkennung in Stufen und Prüfliste (Teil „Erkennung“)
 * ========================================================================= */

/** Höchstens so viele Einträge pro Erkennungsschritt (danach ruft das UI den nächsten Schritt auf). */
const ER_STEP_MAX = 40;
/** Zeitbudget eines Erkennungsschritts (Apps Script bricht nach 6 Minuten ab). */
const ER_STEP_MS = 4 * 60 * 1000;
/** Zeitbudget für importSetsVorbelegen. */
const ER_PREFILL_MS = 4 * 60 * 1000;
/** Set-Kartenlisten im CacheService: 6 Stunden, nur bis 90 KB. */
const ER_CACHE_TTL = 21600;
const ER_CACHE_MAX_BYTES = 90 * 1024;
/** Höchstens so viele Sets werden für eine Nummer durchsucht. */
const ER_MAX_SETS = 8;

/** Kürzel alter Sets, wenn tcgdex keins liefert (Set-ID -> Kürzel). */
const ER_CODE_SEED = {
  ex1: 'RS', ex2: 'SS', ex3: 'DR', ex4: 'MA', ex5: 'HL', ex6: 'RG', ex7: 'TRR', ex8: 'DX', ex9: 'EM', ex10: 'UF',
  ex11: 'DS', ex12: 'LM', ex13: 'HP', ex14: 'CG', ex15: 'DF', ex16: 'PK', dp1: 'DP', dp2: 'MT', dp3: 'SW', dp4: 'GE',
  dp5: 'MD', dp6: 'LA', dp7: 'SF', pl1: 'PL', pl2: 'RR', pl3: 'SV', pl4: 'AR', hgss1: 'HS', hgss2: 'UL', hgss3: 'UD',
  hgss4: 'TM', col1: 'CL', dpp: 'DPPR', hgssp: 'HGSS', mep: 'MEP'
};

/** Gründe in der Prüfliste, wenn Set + Nummer bzw. ein Link eine Karte mit anderem Namen ergeben. */
const ER_NAME_MISMATCH = 'Name passt nicht zu Set und Nummer.';
const ER_LINK_MISMATCH = 'Name passt nicht zum Cardmarket-Link.';

/** Rahmenzeichen für ganze Wörter in Namen und Zellen (zusätzlich Anfang und Ende). */
const ER_WORD_EDGE = '\\s\\-_/,;:()\\[\\]|+';

/* ---------- kleine Hilfen ---------- */

/** Uhr (in Tests ersetzbar). */
function erNow_() {
  return new Date().getTime();
}

function erText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return cellText_(v);
  return String(v).replace(/\u00a0/g, ' ').trim();
}

/** Kleinbuchstaben, ohne Akzente und ohne alles außer a-z und 0-9 ("Diamond & Pearl" -> "diamondpearl"). */
function erSquash_(s) {
  let t = String(s == null ? '' : s);
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* ohne normalize */ }
  return t.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
}

function erEscRe_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Schon gebaute Begriffs-Regexe (je Begriff und Flags). */
let erTermReMemo_ = {};

/** Regex für einen Begriff als ganzes Wort (auch mit '-' drumherum). Gruppe 1 = Rand davor, Gruppe 2 = Begriff. */
function erTermRe_(term, flags) {
  const k = (flags || 'i') + '|' + String(term);
  const hit = erTermReMemo_[k];
  if (hit) { hit.lastIndex = 0; return hit; }
  const body = String(term).trim().split(/\s+/).map(erEscRe_).join('[\\s\\-]*');
  const re = new RegExp('(^|[' + ER_WORD_EDGE + '])(' + body + ')(?=$|[' + ER_WORD_EDGE + '.!])', flags || 'i');
  erTermReMemo_[k] = re;
  return re;
}

/** Links (http/https) aus einem Text entfernen und Leerraum zusammenziehen. */
function erStripUrls_(s) {
  return String(s || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function erUniq_(arr) {
  const seen = {};
  const out = [];
  (arr || []).forEach(function (x) {
    const k = String(x);
    if (!x && x !== 0) return;
    if (seen[k]) return;
    seen[k] = true;
    out.push(x);
  });
  return out;
}

/** Häkchen-Texte: TRUE, WAHR, x, ✓, ✔, ja, yes, 1, true (und andere positive Zahlen). */
function erChecked_(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  const s = erText_(v).toLowerCase();
  if (!s) return false;
  if (['true', 'wahr', 'x', '✓', '✔', '☑', '✅', 'ja', 'yes', 'y', 'j', '1'].indexOf(s) >= 0) return true;
  return /^\d+$/.test(s) && Number(s) > 0;
}

/** UTF-8-Länge eines Textes (für die 90-KB-Grenze des Caches). */
function erUtf8Len_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Variantencode aus Code oder Anzeigename ('Reverse Holo' -> 'reverse'); sonst ''. */
function erVariantCode_(x) {
  const s = erText_(x).toLowerCase();
  if (!s) return '';
  const codes = ['normal', 'holo', 'reverse', 'firstEdition'];
  for (let i = 0; i < codes.length; i++) {
    if (codes[i].toLowerCase() === s || String(VARIANT_LABELS[codes[i]]).toLowerCase() === s) return codes[i];
  }
  return '';
}

/** Zustandscode aus Code oder Anzeigename ('Near Mint' -> 'NM'); sonst ''. */
function erCondCode_(x) {
  const s = erText_(x);
  if (!s) return '';
  const c = condCode_(s);
  if (c) return c;
  const low = s.toLowerCase();
  for (let i = 0; i < CONDITIONS.length; i++) {
    const code = CONDITIONS[i];
    if (code && String(CONDITION_LABELS[code]).toLowerCase() === low) return code;
  }
  return '';
}

/** Sprachcode nur für bekannte Sprachen (Code oder Name aus LANGS); sonst ''. */
function erLangCode_(x) {
  const s = erText_(x).toUpperCase();
  if (!s) return '';
  for (let i = 0; i < LANGS.length; i++) {
    if (LANGS[i][0] === s || LANGS[i][1].toUpperCase() === s) return LANGS[i][0];
  }
  return '';
}

/* ---------- Begriffe ("Import-Begriffe") ---------- */

/** Die Vorbelegung als Zeilen (für setupImportSheets_ bzw. wenn das Blatt fehlt). */
function erDefaultTermRows_() {
  return TERMS_SEED.map(function (r) { return r.slice(); });
}

function erMeaning_(x) {
  const s = erText_(x).toLowerCase();
  if (/^varian/.test(s)) return 'Variante';
  if (/^(zustand|cond)/.test(s)) return 'Zustand';
  if (/^(sonder|version)/.test(s)) return 'Sonderversion';
  if (/^(sprache|lang)/.test(s)) return 'Sprache';
  if (/^(ignor|weg|entfern)/.test(s)) return 'Ignorieren';
  return '';
}

/** Begriffszeile -> {term, meaning, value, scope} oder null (unbrauchbar). */
function erTermFromRow_(r) {
  const term = erText_(r[0]);
  const meaning = erMeaning_(r[1]);
  if (!term || !meaning) return null;
  let value = erText_(r[2]);
  if (meaning === 'Variante') value = erVariantCode_(value);
  else if (meaning === 'Zustand') value = erCondCode_(value);
  else if (meaning === 'Sprache') value = erLangCode_(value) || (value ? value.toUpperCase() : '');
  else if (meaning === 'Sonderversion') value = versionText_(value || term);
  else value = '';
  if (meaning !== 'Ignorieren' && !value) return null;
  const scope = /name/i.test(erText_(r[3])) ? 'Name und Spalten' : 'nur Spalten';
  return { term: term, meaning: meaning, value: value, scope: scope };
}

/**
 * Begriffe aus „Import-Begriffe“: [{term, meaning, value, scope}], längste zuerst
 * (damit „Reverse Holo“ vor „Holo“ greift). Fehlt das Blatt, gilt die Vorbelegung.
 */
function loadTerms_() {
  const sh = ss_().getSheetByName(IMP_SHEETS.terms);
  let rows;
  if (!sh) rows = erDefaultTermRows_();
  else rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, TERMS_HEADERS.length).getValues();
  const out = [];
  rows.forEach(function (r) {
    const t = erTermFromRow_(r);
    if (t) out.push(t);
  });
  out.sort(function (a, b) { return b.term.length - a.term.length; });
  return out;
}

/** Feldname zu einer Bedeutung. */
function erFieldOf_(meaning) {
  return { Variante: 'variant', Zustand: 'cond', Sonderversion: 'version', Sprache: 'lang' }[meaning] || '';
}

/**
 * Begriffe aus einem Text holen. scopeNameOnly: nur Begriffe mit „Name und Spalten“.
 * -> {text (ohne die gefundenen Begriffe), found: {variant, cond, lang, version}, hit (bool)}
 */
function erApplyTerms_(text, terms, nameOnly) {
  let t = String(text || '');
  const found = {};
  let hit = false;
  (terms || []).forEach(function (term) {
    if (nameOnly && term.scope !== 'Name und Spalten') return;
    const re = erTermRe_(term.term, 'i');
    let guard = 0;
    let m;
    while ((m = re.exec(t)) && guard++ < 5) {
      hit = true;
      const f = erFieldOf_(term.meaning);
      if (f && !found[f]) found[f] = term.value;
      t = t.slice(0, m.index) + m[1] + ' ' + t.slice(m.index + m[0].length);
    }
  });
  return { text: t, found: found, hit: hit };
}

/** Rest eines Namens nach dem Entfernen von Begriffen aufräumen. */
function erTidyName_(s) {
  let t = String(s || '').replace(/\(\s*\)|\[\s*\]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s\-_/,;:|+]+|[\s\-_/,;:|+]+$/g, '').trim();
  return t.replace(/\s+-\s+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- Felder einer Quellzeile ---------- */

const ER_FIELD_ORDER = ['name', 'number', 'set', 'qty', 'variant', 'cond', 'lang', 'version', 'cmLink', 'tcgdexId',
  'price', 'priceDate', 'check'];

/** Spalte als 0-basierter Index aus Zahl, Zahltext oder Buchstaben ("C" -> 2); sonst -1. */
function erColIdx_(x) {
  if (x === null || x === undefined || x === '') return -1;
  if (typeof x === 'number') return isFinite(x) && x >= 0 ? Math.floor(x) : -1;
  const s = String(x).trim();
  if (/^-?\d+$/.test(s)) return Math.max(-1, parseInt(s, 10));
  if (/^[A-Za-z]{1,3}$/.test(s)) {
    return s.toUpperCase().split('').reduce(function (n, ch) { return n * 26 + ch.charCodeAt(0) - 64; }, 0) - 1;
  }
  return -1;
}

/** Ist ein Feld in der Konfiguration zugeordnet? (Liste/Checkliste: cols, Raster: grid.cells) */
function erMapped_(cfg, field) {
  if (!cfg) return false;
  if (cfg.form === 'raster') {
    const cell = cfg.grid && cfg.grid.cells && cfg.grid.cells[field];
    return !!(Array.isArray(cell) && cell.length >= 2 && cell[0] !== '' && cell[0] != null && Number(cell[0]) >= 0);
  }
  return erColIdx_(cfg.cols && cfg.cols[field]) >= 0;
}

/** Position eines Felds für „erste nicht leere zugeordnete Zelle“. */
function erFieldPos_(cfg, field) {
  if (cfg && cfg.form === 'raster') {
    const cell = cfg.grid && cfg.grid.cells && cfg.grid.cells[field];
    return Array.isArray(cell) ? Number(cell[0]) * 1000 + erColIdx_(cell[1]) : 1e9;
  }
  const c = erColIdx_(cfg && cfg.cols ? cfg.cols[field] : -1);
  return c < 0 ? 1e9 + ER_FIELD_ORDER.indexOf(field) : c;
}

/** Erste Cardmarket-URL in einem Text oder ''. */
function erCmUrlIn_(text) {
  const urls = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (let i = 0; i < urls.length; i++) {
    if (/cardmarket\.com/i.test(urls[i])) return urls[i].replace(/[),.;]+$/, '');
  }
  return '';
}

/** Menge aus einem Text: Zahl >= 0, „nein“/„FALSE“/„-“ -> 0, leer -> null. */
function erQty_(text) {
  const s = erText_(text);
  if (!s) return null;
  const m = s.match(/\d+/);
  if (m) return Math.max(0, parseInt(m[0], 10));
  if (/^(false|falsch|nein|no|n|-|–)$/i.test(s)) return 0;
  return erChecked_(s) ? 1 : null;
}

/**
 * Felder einer Quellzeile. rec = {srcRows, raw: {feld: text}, extrasRaw: {name: text}}.
 * -> {name, nameClean, number, set, qty, variant, cond, lang, version, cmUrl, tcgdexId, price, priceDate,
 *     extras, skip: null|'summe'|'leer'|'nichtAngehakt'}
 */
function extractRow_(rec, cfg, terms) {
  cfg = cfg || {};
  rec = rec || {};
  const raw = rec.raw || {};
  const form = cfg.form || 'liste';
  if (!terms) terms = loadTerms_();
  // Links, die der Teil „Quelle“ an Zelltexte hängt, gehören nicht in Name, Nummer, Set usw.
  const get = function (f) { return erStripUrls_(erText_(raw[f])); };

  const name = get('name');
  const fromName = erApplyTerms_(name, terms, true);
  const nameClean = erTidyName_(fromName.text);

  // Spalten Variante, Zustand, Sprache, Sonderversion
  const fromCols = {};
  const direct = {
    variant: erVariantCode_, cond: erCondCode_, lang: erLangCode_,
    version: function () { return ''; }
  };
  ['variant', 'cond', 'lang', 'version'].forEach(function (f) {
    const t = get(f);
    if (!t) return;
    let exact = null;
    for (let i = 0; i < terms.length; i++) {
      if (terms[i].term.toLowerCase() === t.toLowerCase()) { exact = terms[i]; break; }
    }
    if (exact) {
      const ef = erFieldOf_(exact.meaning);
      if (ef && !fromCols[ef]) fromCols[ef] = exact.value;
      return;
    }
    const d = direct[f](t);
    if (d) { if (!fromCols[f]) fromCols[f] = d; return; }
    const scan = erApplyTerms_(t, terms, false);
    Object.keys(scan.found).forEach(function (k) { if (!fromCols[k]) fromCols[k] = scan.found[k]; });
    if (f === 'version' && !scan.hit && !fromCols.version) fromCols.version = versionText_(t);
  });

  const fixed = cfg.fixed || {};
  // Felder, deren Wert nur aus den festen Werten der Vorlage kommt: sie gehören nicht zur Zeile selbst und
  // zählen darum nicht im Fingerabdruck (sonst wäre nach einer Änderung der festen Werte jede Zeile „neu“).
  const fixedFields = {};
  const pick = function (f, norm) {
    const own = fromCols[f] || fromName.found[f];
    if (own) return own;
    const fx = norm(fixed[f]) || '';
    if (fx) fixedFields[f] = fx;
    return fx;
  };
  const variant = pick('variant', erVariantCode_);
  const cond = pick('cond', erCondCode_);
  const lang = pick('lang', function (x) { return erLangCode_(x) || (erText_(x) ? langCode_(x) : ''); }) || 'DE';
  const version = versionText_(pick('version', versionText_));
  if (fixedFields.version !== undefined) fixedFields.version = version;

  // Menge
  const qtyNum = erQty_(raw.qty);
  let qty;
  if (form === 'checkliste') {
    let checked;
    if (erMapped_(cfg, 'check')) checked = erChecked_(raw.check);
    else if (erMapped_(cfg, 'qty')) checked = qtyNum != null && qtyNum > 0;
    else checked = true;
    qty = checked ? Math.max(1, qtyNum == null ? 1 : qtyNum) : 0;
  } else {
    qty = qtyNum == null ? 1 : qtyNum;
  }

  // Preis
  let price = null;
  const pText = get('price');
  if (pText) {
    const p = parsePrice_(pText);
    price = typeof p === 'number' && isFinite(p) ? Math.round(p * 100) / 100 : null;
  }

  // Cardmarket-Link: aus der Link-Spalte, sonst aus einer anderen zugeordneten Zelle (z. B. verlinkter Name)
  let cmUrl = erCmUrlIn_(raw.cmLink);
  if (!cmUrl) {
    const others = ER_FIELD_ORDER.filter(function (k) { return k !== 'cmLink'; });
    for (let i = 0; i < others.length && !cmUrl; i++) cmUrl = erCmUrlIn_(raw[others[i]]);
  }
  const tcgdexId = get('tcgdexId').split(/\s+/)[0] || '';
  const number = get('number');
  const set = get('set');

  // Zusatzspalten
  const extras = {};
  const ex = rec.extrasRaw || {};
  Object.keys(ex).forEach(function (k) {
    const v = erText_(ex[k]);
    extras[k] = v;
  });

  // Überspringen?
  let skip = null;
  let first = name;
  if (!first && rec.first !== undefined) first = erText_(rec.first);
  if (!first) {
    const mapped = Object.keys(raw).filter(function (f) { return erText_(raw[f]) !== ''; })
      .sort(function (a, b) { return erFieldPos_(cfg, a) - erFieldPos_(cfg, b); });
    first = mapped.length ? erText_(raw[mapped[0]]) : '';
  }
  if (/^(summe|gesamt|total|sum)\b/i.test(first) || (!name && pText && !number && !cmUrl && !tcgdexId)) skip = 'summe';
  else if (!name && !number && !cmUrl && !tcgdexId) skip = 'leer';
  else if (form === 'checkliste' && qty === 0) skip = 'nichtAngehakt';

  return {
    name: name, nameClean: nameClean, number: number, set: set, qty: qty, variant: variant, cond: cond, lang: lang,
    version: version, cmUrl: cmUrl, tcgdexId: tcgdexId, price: price, priceDate: get('priceDate'), extras: extras,
    skip: skip, fixedFields: fixedFields
  };
}

/* ---------- Fingerabdruck und Zusammenfassen ---------- */

/** Cardmarket-Link für den Fingerabdruck: Pfad klein, ohne Abfrage außer isReverseHolo/isFirstEd. */
function erCmKey_(url) {
  const m = String(url || '').trim().match(/^https?:\/\/[^\/?#]+([^?#]*)(\?[^#]*)?/i);
  if (!m) return String(url || '').trim().toLowerCase();
  const path = m[1].toLowerCase().replace(/\/+$/, '');
  const flags = [];
  (m[2] || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    const p = kv.split('=');
    const k = String(p[0] || '').toLowerCase();
    if ((k === 'isreverseholo' || k === 'isfirsted') && /^(y|yes|true|1)$/i.test(String(p[1] || ''))) flags.push(k + '=y');
  });
  flags.sort();
  return path + (flags.length ? '?' + flags.join('&') : '');
}

/**
 * 12 Hex-Zeichen MD5 über die erkennungsrelevanten Felder (nicht Preis, Preisdatum, Zusatzspalten, Menge).
 * Werte, die nur aus den festen Werten der Vorlage kommen (f.fixedFields = {Feld: Wert}), zählen nicht:
 * Sprache dann wie ohne Angabe 'DE'.
 */
function fingerprint_(f) {
  f = f || {};
  const low = function (x) { return erText_(x).toLowerCase(); };
  const fx = f.fixedFields && typeof f.fixedFields === 'object' ? f.fixedFields : {};
  const own = function (k) {
    const fixedOnly = Object.prototype.hasOwnProperty.call(fx, k) && erText_(fx[k]) === erText_(f[k]);
    return fixedOnly ? (k === 'lang' ? 'DE' : '') : f[k];
  };
  const parts = [
    low(f.nameClean),
    normalizeNumber_(erText_(f.number).replace(/\s+/g, '')),
    low(f.set),
    erText_(own('variant')),
    erText_(own('cond')),
    erText_(own('lang')),
    low(own('version')),
    f.cmUrl ? erCmKey_(f.cmUrl) : '',
    erText_(f.tcgdexId)
  ];
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(parts), Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < bytes.length && hex.length < 12; i++) {
    const b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex.slice(0, 12);
}

/**
 * Datensätze mit gleichem Fingerabdruck zusammenfassen.
 * list = [{rec, fields}] -> [{fp, srcRows, values, qty}] (values = Felder + raw, Reihenfolge der ersten Zeile).
 */
function erAggregate_(list) {
  const byFp = {};
  const out = [];
  list.forEach(function (x) {
    const f = x.fields;
    const fp = fingerprint_(f);
    const src = (x.rec && x.rec.srcRows) || [];
    let e = byFp[fp];
    if (!e) {
      const values = JSON.parse(JSON.stringify(f));
      values.raw = JSON.parse(JSON.stringify((x.rec && x.rec.raw) || {}));
      e = { fp: fp, srcRows: src.slice(), values: values, qty: Number(f.qty) || 0 };
      byFp[fp] = e;
      out.push(e);
      return;
    }
    e.qty += Number(f.qty) || 0;
    e.srcRows = e.srcRows.concat(src);
    const ex = f.extras || {};
    Object.keys(ex).forEach(function (k) {
      const v = erText_(ex[k]);
      const cur = erText_(e.values.extras[k]);
      if (!v) return;
      if (!cur) { e.values.extras[k] = v; return; }
      if (cur.split(' / ').indexOf(v) < 0) e.values.extras[k] = cur + ' / ' + v;
    });
  });
  out.forEach(function (e) { e.values.qty = e.qty; });
  return out;
}

/* ---------- Set-Zuordnung ("Import-Sets") ---------- */

function erAddIds_(map, key, ids) {
  if (!key) return;
  const cur = map[key] || [];
  ids.forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
  map[key] = cur;
}

/** Ist das Set ein Promo-Set? (Name enthält „Promo“) */
function erIsPromo_(sets, id) {
  const n = ((sets.en[id] && sets.en[id].name) || '') + ' ' + ((sets.de[id] && sets.de[id].name) || '');
  return /promo/i.test(n);
}

/**
 * Set-Zuordnung: {byName: {gequetschter Name: [Set-IDs]}, byCode: {KÜRZEL: [Set-IDs]}} aus „Import-Sets“
 * (Zeilen „Hand“ haben Vorrang) plus alle Namen aus dem Set-Cache (de + en). Sets im Cache ohne Kürzel bekommen
 * das Kürzel aus ER_CODE_SEED (wie beim Vorbelegen), auch wenn „Set-Zuordnung vorbelegen“ nie geklickt wurde.
 * Zusätzlich: byId {kleine id: id}, codesBySet {id: [Kürzel]}, codes (längste zuerst), promo {id: true}, sets (loadSets_).
 */
function loadCmSets_() {
  const sets = loadSets_();
  const autoName = {}, autoCode = {}, handName = {}, handCode = {}, handIds = {};
  const sh = ss_().getSheetByName(IMP_SHEETS.cmsets);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CMSETS_HEADERS.length).getValues().forEach(function (r) {
      const ids = erText_(r[2]).split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!ids.length) return;
      const hand = erText_(r[3]).toLowerCase() !== 'auto';
      const nm = erSquash_(r[0]);
      const codes = erText_(r[1]).split(/[,;\/\s]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
      erAddIds_(hand ? handName : autoName, nm, ids);
      codes.forEach(function (c) { erAddIds_(hand ? handCode : autoCode, c, ids); });
      if (hand) ids.forEach(function (id) { handIds[id] = true; });
    });
  }
  const byName = {}, byCode = {}, byId = {}, promo = {};
  Object.keys(autoName).forEach(function (k) { erAddIds_(byName, k, autoName[k]); });
  ['de', 'en'].forEach(function (lang) {
    Object.keys(sets[lang]).forEach(function (id) {
      erAddIds_(byName, erSquash_(sets[lang][id].name), [id]);
      byId[id.toLowerCase()] = id;
      if (erIsPromo_(sets, id)) promo[id] = true;
    });
  });
  Object.keys(handName).forEach(function (k) { byName[k] = handName[k].slice(); });
  Object.keys(autoCode).forEach(function (k) { erAddIds_(byCode, k, autoCode[k]); });
  Object.keys(handCode).forEach(function (k) { byCode[k] = handCode[k].slice(); });
  const bySetOf = function () {
    const m = {};
    Object.keys(byCode).forEach(function (c) {
      byCode[c].forEach(function (id) { (m[id] = m[id] || []).push(c); });
    });
    return m;
  };
  // Kürzel alter Sets ohne Vorbelegen (kostet keinen Abruf); Zeilen „Hand“ (Set oder Kürzel) haben Vorrang
  const have = bySetOf();
  Object.keys(ER_CODE_SEED).forEach(function (id) {
    const code = ER_CODE_SEED[id];
    // auch zusätzlich zu einem Kürzel von tcgdex, denn Cardmarket nutzt bei alten Sets oft ein anderes
    if ((have[id] && have[id].indexOf(code) >= 0) || handIds[id] || handCode[code] || (!sets.en[id] && !sets.de[id])) return;
    erAddIds_(byCode, code, [id]);
  });
  const codesBySet = bySetOf();
  const codes = Object.keys(byCode).sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
  return { byName: byName, byCode: byCode, byId: byId, codesBySet: codesBySet, codes: codes, promo: promo, sets: sets };
}

/**
 * Set-IDs zu einem Set-Text: Name (gequetscht), Kürzel, Set-ID, sonst eindeutiger Teiltext.
 * info (optional): info.weak = true, wenn nur ein Set-Name im Text steckt („Diamant & Perl Promos“ -> dp1).
 * Das ist nur ein Hinweis, keine sichere Zuordnung.
 */
function erSetIdsForText_(text, idx, info) {
  const t = erText_(text);
  if (!t) return [];
  const s = erSquash_(t);
  if (s && idx.byName[s]) return idx.byName[s].slice();
  const code = t.toUpperCase().replace(/\s+/g, '');
  if (idx.byCode[code]) return idx.byCode[code].slice();
  if (idx.byId[t.toLowerCase()]) return [idx.byId[t.toLowerCase()]];
  if (s.length < 3) return [];
  // Teiltext: "Delta Species" -> "EX Delta Species"; "Pokémon EX Delta Species" -> "EX Delta Species"
  let ids = [];
  Object.keys(idx.byName).forEach(function (k) { if (k.indexOf(s) >= 0) ids = ids.concat(idx.byName[k]); });
  ids = erUniq_(ids);
  if (ids.length && ids.length <= ER_MAX_SETS) return ids;
  if (ids.length) return [];
  let best = 0;
  Object.keys(idx.byName).forEach(function (k) {
    if (k.length >= 4 && s.indexOf(k) >= 0) {
      if (k.length > best) { best = k.length; ids = idx.byName[k].slice(); }
      else if (k.length === best) ids = erUniq_(ids.concat(idx.byName[k]));
    }
  });
  if (ids.length && ids.length <= ER_MAX_SETS && info) info.weak = true;
  return ids.length <= ER_MAX_SETS ? ids : [];
}

/** Promo-Sets, deren Kürzel oder ID mit den Buchstaben beginnt (z. B. "DP" -> dpp mit Kürzel DPPR). */
function erPromoIdsFor_(letters, idx) {
  const L = String(letters || '').toUpperCase();
  if (L.length < 2) return [];
  return Object.keys(idx.promo).filter(function (id) {
    if (id.toUpperCase().indexOf(L) === 0) return true;
    return (idx.codesBySet[id] || []).some(function (c) { return c.indexOf(L) === 0; });
  });
}

/**
 * Cardmarket-Link lesen: .../Products/Singles/<SetSlug>/<CardSlug>[?query]
 * -> {setIds, code, number, nameEn, variant} oder null.
 */
function parseCardmarketUrl_(url, idx) {
  const u = erText_(url);
  const m = u.match(/\/Products\/Singles\/([^\/?#\s]+)\/([^\/?#\s]+)(\?[^#\s]*)?/i);
  if (!m) return null;
  idx = idx || loadCmSets_();
  const dec = function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const setSlug = dec(m[1]);
  const cardSlug = dec(m[2]);
  const query = m[3] || '';
  let setIds = (idx.byName[erSquash_(setSlug)] || []).slice();
  const tokens = cardSlug.split('-').filter(function (x) { return x !== ''; });
  let code = '', number = '', nameTokens = tokens.slice();
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : '';
  const looksNum = function (r) { return /^[A-Za-z]*\d+[A-Za-z]?$/.test(r) || /^[A-Za-z]$/.test(r); };
  // „Pikachu-V1“ / „Articuno-Lv34“: Versions- bzw. Level-Zusatz am Ende ist keine Nummer
  if (last && /\d/.test(last) && !/^(V\d+|Lv\.?\d+)$/i.test(last)) {
    const up = last.toUpperCase();
    let tried = [];
    setIds.forEach(function (id) { tried = tried.concat(idx.codesBySet[id] || []); });
    tried = erUniq_(tried.sort(function (a, b) { return b.length - a.length; }).concat(idx.codes));
    for (let i = 0; i < tried.length; i++) {
      const c = tried[i];
      if (c && up.indexOf(c) === 0 && up.length > c.length && looksNum(last.slice(c.length)) && /\d/.test(last.slice(c.length))) {
        code = c;
        number = last.slice(c.length);
        break;
      }
    }
    if (!code) {
      const f = last.match(/^([A-Za-z]+?)(\d+[A-Za-z]?)$/);
      if (f) { code = f[1].toUpperCase(); number = f[2]; }
      else if (/^\d+[A-Za-z]?$/.test(last)) number = last;
    }
    if (number) nameTokens = tokens.slice(0, -1);
  }
  if (!setIds.length && code && idx.byCode[code]) setIds = idx.byCode[code].slice();
  const nameEn = nameTokens.filter(function (t) { return !/^(V\d+|Lv\d+|LVX|Lv\.?X)$/i.test(t); }).join(' ').trim();
  let variant = '';
  if (/[?&]isReverseHolo=(Y|yes|true|1)\b/i.test(query)) variant = 'reverse';
  else if (/[?&]isFirstEd=(Y|yes|true|1)\b/i.test(query)) variant = 'firstEdition';
  return { setIds: setIds, code: code, number: number, nameEn: nameEn, variant: variant };
}

/**
 * Set-Text und Nummer deuten. "DS 62" / "MEW 132": Buchstaben = bekanntes Kürzel -> Sets des Kürzels, Nummer = Ziffern.
 * Promo-Stil "DP 16" / "HGSS 01" / "MEP 091": in Promo-Sets ist "DP16" die Nummer.
 * Passen Set-Text und Kürzel nicht zusammen („HeartGold & SoulSilver“ + „HGSS 01“) oder passt der Set-Text nur
 * ungefähr (weak), zählen beide Möglichkeiten und ambiguous ist true: dann entscheidet der Name (Stufe 4).
 * -> {setIds, number, ambiguous, numbers: {setId: Nummer in diesem Set}, exact: {setId: true}, code, setTextIds,
 *     weak, conflict}. exact: in diesem Set nur genau diese Nummer (Buchstaben behalten, kein Kürzel des Sets).
 */
function parseSetNumber_(setText, numberText, idx) {
  idx = idx || loadCmSets_();
  const st = erText_(setText);
  const info = {};
  const textIds = st ? erSetIdsForText_(st, idx, info) : [];
  const numRaw = erText_(numberText).split('/')[0].trim();
  const out = { setIds: textIds.slice(), number: numRaw.replace(/\s+/g, ''), ambiguous: false, numbers: {}, exact: {}, code: '',
    setTextIds: textIds.slice(), weak: !!(info.weak && textIds.length), conflict: false };
  // ein nur ungefähr erkannter Set-Text ist keine sichere Angabe: der Name muss bestätigen
  if (out.weak) out.ambiguous = true;
  const m = numRaw.match(/^([A-Za-z]{1,8})[\s\-.]*(\d+[A-Za-z]?)$/);
  if (!m) return out;
  const L = m[1].toUpperCase();
  const D = m[2];
  const codeIds = idx.byCode[L] || [];
  const promoIds = erPromoIdsFor_(L, idx);
  const all = erUniq_(codeIds.concat(promoIds));
  if (!all.length) return out;
  out.code = L;
  let ids;
  if (textIds.length) {
    ids = textIds.filter(function (id) { return all.indexOf(id) >= 0; });
    if (!ids.length || out.weak) {
      // Set-Text und Kürzel widersprechen sich (oder der Set-Text ist unsicher): nicht still dem Set-Text folgen
      out.conflict = !ids.length;
      ids = erUniq_(textIds.concat(all));
      out.ambiguous = true;
    }
  } else {
    ids = all;
    out.ambiguous = ids.length > 1;
  }
  // In Promo-Sets heißt die Nummer "DP16", "HGSS01" …; ist das Kürzel nicht das des Sets (z. B. "TG05"),
  // gehören die Buchstaben zur Nummer; sonst zählen nur die Ziffern ("DS 62" -> 62).
  let joined = false;
  ids.forEach(function (id) {
    const keep = !!idx.promo[id] || codeIds.indexOf(id) < 0;
    out.numbers[id] = keep ? L + D : D;
    // kein Promo-Set und nicht sein Kürzel: "HGSS01" ist dort keine Nummer, also nicht auf die Ziffern ausweichen
    if (keep && !idx.promo[id]) out.exact[id] = true;
    if (keep) joined = true;
  });
  out.setIds = ids;
  out.number = joined ? L + D : D;
  return out;
}

/* ---------- Kartenlisten der Sets (CacheService) und Nummern ---------- */

let erSetMemo_ = {};
let erDetailMemo_ = {};
let erNameMemo_ = {};

/** Arbeitsspeicher der Erkennung leeren (am Anfang jedes öffentlichen Aufrufs). */
function erResetMemo_() {
  erSetMemo_ = {};
  erDetailMemo_ = {};
  erNameMemo_ = {};
}

/** Namenssuche bei tcgdex (findCandidates_ ohne Filter), je Aufruf nur einmal pro Sprache und Name. */
function erNameSearch_(lang, q, sets) {
  const k = lang + '|' + q.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(erNameMemo_, k)) erNameMemo_[k] = findCandidates_(lang, q, null, null, sets, null);
  return erNameMemo_[k];
}

/** translateName_ mit Arbeitsspeicher (liest sonst jedes Mal das Blatt Übersetzung). */
function erTranslate_(name) {
  const k = 'tr|' + String(name).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(erNameMemo_, k)) erNameMemo_[k] = translateName_(name);
  return erNameMemo_[k];
}

function erCompactSet_(set) {
  return {
    r: set.releaseDate ? String(set.releaseDate).slice(0, 10) : '',
    n: String(set.name || ''),
    c: (set.cards || []).map(function (c) {
      return [String(c.id), String(c.localId == null ? '' : c.localId), String(c.name || ''), c.image ? String(c.image) : ''];
    })
  };
}

function erCachePutSet_(lang, setId, compact) {
  const key = 'set:' + lang + ':' + setId;
  erSetMemo_[key] = compact;
  try {
    const s = JSON.stringify(compact);
    if (erUtf8Len_(s) <= ER_CACHE_MAX_BYTES) CacheService.getScriptCache().put(key, s, ER_CACHE_TTL);
  } catch (e) { /* Cache ist nur eine Hilfe */ }
}

/**
 * Kartenliste eines Sets in einer Sprache: {r (Erscheinungsdatum), n (Name), c: [[id, localId, name, image]]}
 * oder null (gibt es in dieser Sprache nicht). Erst Arbeitsspeicher, dann CacheService, dann tcgdex.
 */
function erSetCards_(lang, setId) {
  const key = 'set:' + lang + ':' + setId;
  if (Object.prototype.hasOwnProperty.call(erSetMemo_, key)) return erSetMemo_[key];
  let hit = null;
  try { hit = CacheService.getScriptCache().get(key); } catch (e) { hit = null; }
  if (hit) {
    try {
      const o = JSON.parse(hit);
      erSetMemo_[key] = o && o.none ? null : o;
      return erSetMemo_[key];
    } catch (e) { /* neu holen */ }
  }
  const set = fetchJson_(apiUrl_(lang, 'sets/' + encodeURIComponent(setId)));
  if (!set || !Array.isArray(set.cards)) {
    erSetMemo_[key] = null;
    try { CacheService.getScriptCache().put(key, '{"none":1}', ER_CACHE_TTL); } catch (e) { /* egal */ }
    return null;
  }
  const compact = erCompactSet_(set);
  erCachePutSet_(lang, setId, compact);
  return compact;
}

/**
 * Nummer in einer Kartenliste: erst genau (normalizeNumber_), sonst nur Ziffern, wenn genau eine Karte passt.
 * exactOnly: nur genau (z. B. "HGSS01" in einem Set ohne dieses Kürzel).
 */
function erMatchNumber_(cards, number, exactOnly) {
  const n = normalizeNumber_(erText_(number).replace(/\s+/g, ''));
  if (!n) return [];
  const exact = cards.filter(function (c) { return normalizeNumber_(c[1]) === n; });
  if (exact.length || exactOnly) return exact;
  const digits = n.replace(/\D/g, '');
  if (!digits) return [];
  const dn = Number(digits);
  const d = cards.filter(function (c) {
    const cd = String(c[1]).replace(/\D/g, '');
    return cd !== '' && Number(cd) === dn;
  });
  return d.length === 1 ? d : [];
}

function erBrief_(c, lang, setId) {
  return { id: c[0], localId: c[1], name: c[2], image: c[3] || '', setId: setId, lang: lang };
}

/**
 * Karten mit dieser Nummer in den Sets (deutsch, sonst englisch). numbers = {setId: Nummer} (optional),
 * exact = {setId: true} (optional): dort nicht auf die Ziffern ausweichen.
 */
function erFindInSets_(setIds, number, numbers, exact) {
  const out = [];
  (setIds || []).slice(0, ER_MAX_SETS).forEach(function (setId) {
    const num = (numbers && numbers[setId]) || number;
    if (!num) return;
    const langs = ['de', 'en'];
    for (let i = 0; i < langs.length; i++) {
      const list = erSetCards_(langs[i], setId);
      if (!list) continue;
      const hits = erMatchNumber_(list.c, num, !!(exact && exact[setId]));
      if (hits.length) {
        hits.forEach(function (c) { out.push(erBrief_(c, langs[i], setId)); });
        break;
      }
    }
  });
  return out;
}

/** Karten eines englischen Namens in den Sets (lokal über die Kartenlisten): erst gleich, sonst Anfang. */
function erFindNameInSets_(setIds, nameEn) {
  const want = erSquash_(nameEn);
  if (!want) return [];
  const exact = [], prefix = [];
  (setIds || []).slice(0, ER_MAX_SETS).forEach(function (setId) {
    const list = erSetCards_('en', setId) || erSetCards_('de', setId);
    if (!list) return;
    const lang = erSetCards_('en', setId) ? 'en' : 'de';
    list.c.forEach(function (c) {
      const have = erSquash_(c[2]);
      if (have === want) exact.push(erBrief_(c, lang, setId));
      else if (have.indexOf(want) === 0) prefix.push(erBrief_(c, lang, setId));
    });
  });
  return exact.length ? exact : prefix;
}

/* ---------- Kartendaten (fetchAllJson_ in Paketen zu 20) ---------- */

/** Holt de- und en-Daten der Karten (nur, was noch nicht im Arbeitsspeicher ist). Wirft, wenn tcgdex nicht antwortet. */
function erFetchDetails_(ids) {
  const urls = [], keys = [];
  erUniq_(ids).forEach(function (id) {
    ['de', 'en'].forEach(function (lang) {
      const k = lang + '/' + id;
      if (Object.prototype.hasOwnProperty.call(erDetailMemo_, k)) return;
      keys.push(k);
      urls.push(apiUrl_(lang, 'cards/' + encodeURIComponent(id)));
    });
  });
  for (let i = 0; i < urls.length; i += 20) {
    const res = fetchAllJson_(urls.slice(i, i + 20));
    res.forEach(function (r, j) {
      const k = keys[i + j];
      if (r && r.ok) erDetailMemo_[k] = r.data;
      else if (r && r.notFound) erDetailMemo_[k] = null;
      else throw new Error('tcgdex nicht erreichbar (' + ((r && r.error) || '?') + ')');
    });
  }
}

/** Erscheinungsdatum des Sets: aus den geladenen Kartenlisten, sonst setReleaseDate_ (außerhalb der Sperre). */
function erSetDate_(lang, setId, setBrief) {
  const k = 'date:' + setId;
  if (Object.prototype.hasOwnProperty.call(erSetMemo_, k)) return erSetMemo_[k];
  let d = '';
  ['set:de:' + setId, 'set:en:' + setId].forEach(function (key) {
    const s = erSetMemo_[key];
    if (!d && s && s.r) d = s.r;
  });
  if (!d) {
    try { d = setReleaseDate_(lang, setId, setBrief) || ''; } catch (e) { d = ''; }
  }
  erSetMemo_[k] = d;
  return d;
}

/**
 * Karten-JSON für Daten-Zeilen aus den geladenen Kartendaten (deutsch, sonst englisch).
 * variantPrefs: Liste von Wunschvarianten (erste gültige gewinnt), sonst Grundvariante der Karte.
 * -> {dataLang, id, name, nameEn, setId, setName, setDate, localId, setSize, img, rarity, category, illustrator,
 *     baseVariant, variant, price, priceDate} oder null
 */
function erCardJson_(id, variantPrefs) {
  const de = erDetailMemo_['de/' + id] || null;
  const en = erDetailMemo_['en/' + id] || null;
  const d = de || en;
  if (!d) return null;
  const dataLang = de ? 'de' : 'en';
  const set = d.set || {};
  const enSet = (en && en.set) || {};
  const setId = String(set.id || setIdOf_(d));
  let cm = cardmarket_(d);
  if (!cm && de && en) cm = cardmarket_(en);
  const base = baseVariant_(d.variants);
  let variant = '';
  (variantPrefs || []).forEach(function (v) { if (!variant && v && VARIANT_LABELS[v]) variant = v; });
  if (!variant) variant = base;
  const cc = set.cardCount || enSet.cardCount || {};
  return {
    dataLang: dataLang,
    id: String(d.id),
    name: String(d.name || ''),
    nameEn: en ? String(en.name || '') : '',
    setId: setId,
    setName: String(set.name || enSet.name || setId),
    setDate: erSetDate_(dataLang, setId, set),
    localId: String(d.localId == null ? '' : d.localId),
    setSize: cc.official ? Number(cc.official) : null,
    img: String(d.image || (en && en.image) || ''),
    rarity: String(d.rarity || ''),
    category: String(d.category || ''),
    illustrator: String(d.illustrator || ''),
    baseVariant: base,
    variant: variant,
    price: priceFor_(cm, variant),
    priceDate: cm && cm.updated ? dateText_(cm.updated) : ''
  };
}

/** Kandidat für die Prüfliste: {id, lang, name, setName, localId, setSize, image}. */
function erCandOut_(c, sets) {
  const s = (sets[c.lang] && sets[c.lang][c.setId]) || sets.de[c.setId] || sets.en[c.setId] || null;
  return {
    id: String(c.id), lang: c.lang === 'en' ? 'en' : 'de', name: String(c.name || ''),
    setName: s ? s.name : String(c.setId || ''), localId: String(c.localId == null ? '' : c.localId),
    setSize: s && s.official ? Number(s.official) : null, image: String(c.image || '')
  };
}

function erDedupe_(list) {
  const seen = {};
  return (list || []).filter(function (c) {
    if (!c || !c.id || seen[c.id]) return false;
    seen[c.id] = true;
    return true;
  });
}

/* ---------- Stufe 4: Name (+ Nummer, + Set) ---------- */

/**
 * Namenssuche wie searchCards: deutsch, deutsch mit Zusatz (ex, V …), englisch übersetzt, englisch wie geschrieben,
 * englischer Name aus dem Cardmarket-Link.
 * -> {pick: Kandidat|null, precise: [], loose: [], reasons: []}
 */
function erByName_(values, ps, cm, idx) {
  const res = { pick: null, precise: [], loose: [], reasons: [] };
  const name = erText_(values.nameClean || values.name);
  if (!name) return res;
  const sets = idx.sets;
  const setIds = ps.setIds.length ? ps.setIds : (cm && cm.setIds.length ? cm.setIds : null);
  const numText = erText_(values.number);
  const num = numText ? parseNumberInput_(numText) : null;
  const target = function (c) {
    return (ps.numbers && ps.numbers[c.setId]) || ps.number || (cm && cm.number) || '';
  };
  const hasNum = !!(ps.number || (cm && cm.number));
  const numOk = function (c) {
    const t = normalizeNumber_(target(c));
    if (!t) return true;
    if (normalizeNumber_(c.localId) === t) return true;
    if (!setIds || (ps.exact && ps.exact[c.setId])) return false;
    const dg = t.replace(/\D/g, '');
    const cd = String(c.localId).replace(/\D/g, '');
    return dg !== '' && cd !== '' && Number(dg) === Number(cd);
  };

  const search = function (filterIds, useNumber) {
    const seen = {};
    let first = null;
    // full: der ganze gesuchte Name (für den Vorzug gleichnamiger Karten, wenn die Nummer mehrere übrig lässt)
    const run = function (lang, q, suffix, contain, full) {
      q = erText_(q);
      if (!q || seen[lang + '|' + q.toLowerCase()]) return null;
      seen[lang + '|' + q.toLowerCase()] = true;
      // wie findCandidates_(lang, q, null, filterIds, sets, suffix), aber mit gemerkter Suche
      let c = erNameSearch_(lang, q, sets);
      if (filterIds) c = c.filter(function (x) { return filterIds.indexOf(x.setId) >= 0; });
      if (suffix) {
        const sfx = squash_(suffix);
        const withSuffix = c.filter(function (x) { return squash_(x.name).slice(-sfx.length) === sfx; });
        if (withSuffix.length) c = withSuffix;
      }
      if (contain) c = c.filter(function (x) { return squash_(x.name).indexOf(squash_(contain)) >= 0; });
      if (num && num.size) c = c.filter(function (x) { return sizeOk_(sets, x.setId, num.size); });
      if (!c.length) return null;
      if (!first) first = c;
      if (!useNumber || !hasNum) return c;
      const f = c.filter(numOk);
      if (!f.length) return null;
      // tcgdex sucht Namen als Teiltext („Glurak“ findet auch „Dunkles Glurak“): bei gleicher Nummer
      // gewinnen Karten, die genau so heißen
      if (f.length > 1) {
        const want = erSquash_(full || q);
        const same = f.filter(function (x) { return erSquash_(x.name) === want; });
        if (same.length) return same;
      }
      return f;
    };
    let found = run('de', name, '', '', name);
    if (!found) {
      const sp = splitSuffix_(name);
      if (sp.suffix) found = run('de', sp.base, sp.suffix, name, name);
    }
    if (!found) {
      const tr = erTranslate_(name);
      if (tr) found = run('en', tr.base, tr.suffix, '', tr.en);
    }
    if (!found) found = run('en', name, '', '', name);
    if (!found && cm && cm.nameEn) found = run('en', cm.nameEn, '', '', cm.nameEn);
    return { found: found, first: first };
  };

  const r = search(setIds, true);
  if (r.found && r.found.length === 1) { res.pick = r.found[0]; return res; }
  if (r.found && r.found.length > 1) {
    res.precise = r.found;
    res.reasons.push(hasNum ? 'Mehrere Karten passen zu Name und Nummer.' :
      'Mehrere Karten heißen so. Ohne Nummer ist die Karte nicht eindeutig.');
    return res;
  }
  if (r.first) {
    res.loose = r.first;
    res.reasons.push('Keine Karte „' + name + '“ hat die Nummer „' + (numText || target(r.first[0])) + '“.');
    return res;
  }
  if (setIds) {
    const r2 = search(null, false);
    if (r2.first) {
      res.loose = r2.first;
      res.reasons.push('Im angegebenen Set gibt es keine Karte „' + name + '“.');
      return res;
    }
  }
  res.reasons.push('Keine Karte „' + name + '“ gefunden.');
  return res;
}

/* ---------- Erkennung eines Eintrags (Stufen 1 bis 4) ---------- */

/**
 * Passt der Name der Quellzeile zu einer Karte, die Set + Nummer oder ein Link ergeben haben? Ohne Namen in der Zeile
 * zählt der Name aus dem Link (cm.nameEn), ohne beides passt es immer. Gequetscht verglichen mit dem Kartennamen in
 * beiden Sprachen (die andere Sprache aus der Kartenliste des Sets, nur wenn nötig): gleich, Anfang (ab 3 Zeichen)
 * oder enthalten (ab 4 Zeichen). Eigene Namen: Name, Name ohne Zusatz (ex, V …), englische Übersetzung.
 */
function erNameFits_(values, hit, cm) {
  const raw = erText_(values.nameClean || values.name);
  const own = [];
  if (raw) {
    own.push(raw);
    const sp = splitSuffix_(raw);
    if (sp.base && sp.base !== raw) own.push(sp.base);
    const tr = erTranslate_(raw);
    if (tr && tr.en) own.push(tr.en);
  } else if (cm && cm.nameEn) own.push(cm.nameEn);
  const mine = erUniq_(own.map(erSquash_).filter(Boolean));
  if (!mine.length || !hit) return true;
  const fits = function (name) {
    const b = erSquash_(name);
    if (!b) return false;
    return mine.some(function (a) {
      if (a === b) return true;
      const sh = a.length <= b.length ? a : b, lg = a.length <= b.length ? b : a;
      return (sh.length >= 3 && lg.indexOf(sh) === 0) || (sh.length >= 4 && lg.indexOf(sh) >= 0);
    });
  };
  if (fits(hit.name)) return true;
  const list = erSetCards_(hit.lang === 'de' ? 'en' : 'de', hit.setId);
  if (list && list.c) {
    for (let i = 0; i < list.c.length; i++) if (list.c[i][0] === hit.id) return fits(list.c[i][2]);
  }
  return false;
}

/**
 * Erkennt eine zusammengefasste Quellzeile. Die erste Stufe mit genau einer Karte gewinnt:
 * 1. tcgdex-ID, 2. Cardmarket-Link, 3. Set + Nummer, 4. Name (+ Nummer, + Set).
 * -> {pick: id|'', prefs: [Varianten], status, reason, candidates: [roh]}
 */
function erRecognize_(values, idx) {
  values = values || {};
  const reasons = [];
  let precise = [];
  // Variante: Cardmarket-Abfrage (isReverseHolo / isFirstEd) vor der Variante aus der Quelle, sonst Grundvariante
  const cm = erText_(values.cmUrl) ? parseCardmarketUrl_(values.cmUrl, idx) : null;
  const prefs = [cm ? cm.variant : '', values.variant];
  const done = function (id) { return { pick: String(id), prefs: prefs, status: REVIEW_STATUS.clear, reason: '', candidates: [] }; };
  // Treffer aus Link oder Set + Nummer, deren Name nicht zum Namen der Zeile passt: nur Kandidat, nie „eindeutig“.
  // Gab es so einen Widerspruch, wird auch ein passender Treffer einer späteren Stufe nur erster Kandidat (Prüfliste).
  const mismatch = [], preferred = [];
  const checked = function (hit, why) {
    if (erNameFits_(values, hit, cm)) return true;
    mismatch.push(hit);
    if (reasons.indexOf(why) < 0) reasons.push(why);
    return false;
  };
  const win = function (hit) {
    if (!mismatch.length) return done(hit.id);
    preferred.push(hit);
    return null;
  };

  // 1. tcgdex-ID
  const tid = erText_(values.tcgdexId);
  if (tid) {
    erFetchDetails_([tid]);
    if (erDetailMemo_['de/' + tid] || erDetailMemo_['en/' + tid]) return done(tid);
    reasons.push('Die tcgdex-ID „' + tid + '“ gibt es nicht.');
  }

  // 2. Cardmarket-Link
  if (erText_(values.cmUrl)) {
    if (!cm) reasons.push('Der Cardmarket-Link ist nicht lesbar.');
    else {
      let hits = [];
      if (cm.setIds.length && cm.number) {
        hits = erFindInSets_(cm.setIds, cm.number, null);
        if (hits.length === 1 && checked(hits[0], ER_LINK_MISMATCH)) return done(hits[0].id);
      }
      if (cm.setIds.length && cm.nameEn) {
        let named = erFindNameInSets_(cm.setIds, cm.nameEn);
        if (hits.length > 1) {
          const narrowed = named.filter(function (n) { return hits.some(function (h) { return h.id === n.id; }); });
          named = narrowed.length ? narrowed : hits;
        }
        if (named.length === 1) {
          if (checked(named[0], ER_LINK_MISMATCH)) { const w = win(named[0]); if (w) return w; }
        } else precise = precise.concat(named.length ? named : hits);
      } else {
        precise = precise.concat(hits);
      }
      if (!cm.setIds.length) reasons.push('Das Set aus dem Cardmarket-Link ist unbekannt (Blatt „Import-Sets“).');
    }
  }

  // 3. Set + Nummer
  const ps = parseSetNumber_(values.set, values.number, idx);
  if (erText_(values.set) && !ps.setTextIds.length) reasons.push('Set „' + erText_(values.set) + '“ nicht erkannt.');
  if (ps.setIds.length && ps.number) {
    const hits = erFindInSets_(ps.setIds, ps.number, ps.numbers, ps.exact);
    if (hits.length === 1 && !ps.ambiguous) {
      if (checked(hits[0], ER_NAME_MISMATCH)) { const w = win(hits[0]); if (w) return w; }
    } else {
      if (ps.conflict) reasons.push('Set „' + erText_(values.set) + '“ und Nummer „' + erText_(values.number) + '“ passen nicht zusammen.');
      else if (ps.weak) reasons.push('Der Set-Text „' + erText_(values.set) + '“ ist nicht eindeutig.');
      else if (ps.ambiguous) reasons.push('Das Kürzel „' + ps.code + '“ passt zu mehreren Sets.');
      else if (!hits.length) reasons.push('Nummer „' + erText_(values.number) + '“ gibt es in diesem Set nicht.');
      precise = precise.concat(hits);
    }
  }

  // 4. Name (+ Nummer, + Set)
  const nm = erByName_(values, ps, cm, idx);
  if (nm.pick) { const w = win(nm.pick); if (w) return w; }
  nm.reasons.forEach(function (r) { if (reasons.indexOf(r) < 0) reasons.push(r); });
  const isMismatch = function (c) { return mismatch.some(function (m) { return m.id === c.id; }); };
  let cands = erDedupe_(precise.concat(nm.precise).filter(function (c) { return !isMismatch(c); }));
  if (!cands.length) cands = erDedupe_((nm.loose || []).filter(function (c) { return !isMismatch(c); }));
  // passende Treffer zuerst, unpassende zuletzt; sind es sonst zu viele, nur diese beiden
  const sure = erDedupe_(preferred.concat(mismatch));
  if (sure.length && erDedupe_(sure.concat(cands)).length > MAX_CANDIDATES) cands = [];
  cands = erDedupe_(preferred.concat(cands).concat(mismatch));
  if (!erText_(values.nameClean || values.name) && !tid && !cm && !(ps.setIds.length && ps.number)) {
    reasons.push('Zu wenig Angaben: Name, Set und Nummer oder ein Link fehlen.');
  }
  if (!cands.length) {
    return { pick: '', prefs: prefs, status: REVIEW_STATUS.notFound,
      reason: reasons.join(' ') || 'Keine passende Karte gefunden.', candidates: [] };
  }
  if (cands.length > MAX_CANDIDATES) {
    return { pick: '', prefs: prefs, status: REVIEW_STATUS.notFound,
      reason: 'Zu viele Treffer (' + cands.length + '), bitte selbst suchen.', candidates: [] };
  }
  return { pick: '', prefs: prefs, status: REVIEW_STATUS.unclear,
    reason: reasons.join(' ') || 'Mehrere Karten kommen in Frage.', candidates: cands };
}

/* ---------- Prüfliste: Hilfen ---------- */

function erIsReview_(it) {
  return it.status === REVIEW_STATUS.unclear || it.status === REVIEW_STATUS.notFound;
}

/** Offen = unklar / nicht gefunden ohne bestätigte Entscheidung. */
function erOpenCount_(items) {
  return items.filter(function (it) { return erIsReview_(it) && !(it.decision && it.confirmed); }).length;
}

function erReviewOut_(it) {
  return {
    fp: it.fp, srcRows: it.srcRows || [], values: it.values || {}, qty: Number(it.qty) || 0, status: it.status,
    reason: it.reason || '', candidates: it.candidates || [], decision: it.decision || null,
    prefilled: !!it.prefilled, confirmed: !!it.confirmed, card: it.card || null
  };
}

function erCounts_(items) {
  const c = { eindeutig: 0, unklar: 0, nichtGefunden: 0, uebersprungen: 0, bekannt: 0 };
  items.forEach(function (it) {
    if (it.status === REVIEW_STATUS.clear) c.eindeutig++;
    else if (it.status === REVIEW_STATUS.unclear) c.unklar++;
    else if (it.status === REVIEW_STATUS.notFound) c.nichtGefunden++;
    else if (it.status === REVIEW_STATUS.skipped) c.uebersprungen++;
    else if (it.status === REVIEW_STATUS.known) c.bekannt++;
  });
  return c;
}

function erNeedDraft_() {
  const draft = importDraft_();
  if (!draft || !draft.sourceId) throw new Error('Gerade ist kein Import in Arbeit. Bitte den Import neu starten.');
  return draft;
}

/** Gespeicherte Antwort übernehmen (Vorbelegt, nicht bestätigt), wenn sie brauchbar ist. */
function erApplyAnswer_(it, ans) {
  if (!ans || !ans.decision || !ans.decision.type) return false;
  const t = ans.decision.type;
  if (t !== 'skip' && !(ans.card && (t === 'karte' || t === 'frei'))) return false;
  it.decision = ans.decision;
  it.card = t === 'skip' ? null : ans.card;
  it.prefilled = true;
  it.confirmed = false;
  return true;
}

/** Freie Karte aus den Werten der Quellzeile (Name, Set, Nummer; den Preis nimmt der Import aus der Quelle). */
function erFreeCard_(v) {
  v = v || {};
  return { free: true, name: erText_(v.nameClean) || erText_(v.name), setName: erText_(v.set), localId: erText_(v.number) };
}

/**
 * Offene Zeile als freie Karte vorauswählen (vorbelegt, nicht bestätigt, decision.auto). So kommt sie beim
 * Weitergehen in die Sammlung, ohne dass jemand die ganze Prüfliste durchgehen muss. Ohne Namen bleibt sie offen.
 */
function erPreselectFree_(it) {
  if (!erIsReview_(it)) return false;
  const card = erFreeCard_(it.values);
  if (!card.name) return false;
  it.decision = { type: 'frei', auto: true };
  it.card = card;
  it.prefilled = true;
  it.confirmed = false;
  return true;
}

/** Gespeicherte Antwort geht vor, sonst freie Karte vorauswählen. */
function erPrefill_(it, ans) {
  return erApplyAnswer_(it, ans) || erPreselectFree_(it);
}

/* ---------- Öffentlich: Erkennung ---------- */

/**
 * Baut aus der Import-Quelle die zusammengefassten Einträge für „Import-Prüfung“ (Status 'offen').
 * Nicht angehakte Zeilen einer Checkliste kommen als 'übersprungen' mit Menge 0 dazu (wichtig für den Abgleich),
 * Summen- und Leerzeilen werden nur gezählt. -> {total, skipped: {summe, leer, nichtAngehakt}}
 */
function importStartRecognition(cfg, templateName, mode) {
  ensureSchema_();
  erResetMemo_();
  const draft = erNeedDraft_();
  importAssertNoRun_();
  cfg = cfg || draft.cfg;
  if (!cfg) throw new Error('Die Zuordnung der Spalten fehlt. Bitte die Schritte davor noch einmal durchgehen.');
  cfg = quNormCfg_(cfg); // gleiche Normalform wie im Teil „Quelle“
  const records = parseSourceRecords_(cfg) || [];
  const terms = loadTerms_();
  const skipped = { summe: 0, leer: 0, nichtAngehakt: 0 };
  const keep = [], unchecked = [];
  records.forEach(function (rec) {
    const f = extractRow_(rec, cfg, terms);
    if (f.skip === 'summe' || f.skip === 'leer') { skipped[f.skip]++; return; }
    if (f.skip === 'nichtAngehakt') { skipped.nichtAngehakt++; unchecked.push({ rec: rec, fields: f }); return; }
    keep.push({ rec: rec, fields: f });
  });
  const agg = erAggregate_(keep);
  const seen = {};
  agg.forEach(function (e) { seen[e.fp] = true; });
  const items = agg.map(function (e) {
    return { fp: e.fp, srcRows: e.srcRows, values: e.values, qty: e.qty, status: REVIEW_STATUS.open, reason: '',
      candidates: [], decision: null, card: null, prefilled: false, confirmed: false };
  });
  erAggregate_(unchecked).forEach(function (e) {
    if (seen[e.fp]) return;
    e.values.qty = 0;
    items.push({ fp: e.fp, srcRows: e.srcRows, values: e.values, qty: 0, status: REVIEW_STATUS.skipped,
      reason: 'nicht angehakt', candidates: [], decision: null, card: null, prefilled: false, confirmed: false });
  });
  // Ohne eine einzige Karte nicht weitermachen (beim Abgleich hieße das sonst: alles aus dieser Quelle entfernen)
  if (!items.length) {
    throw new Error('In den gewählten Zeilen wurde keine Karte gefunden (' + records.length + ' Zeilen gelesen, ' +
      skipped.summe + ' Summen, ' + skipped.leer + ' leer). Bitte die Zuordnung der Spalten und die erste Datenzeile prüfen.');
  }
  withLock_(function () {
    reviewWriteAll_(items);
    const cur = importDraft_() || draft;
    cur.cfg = cfg;
    cur.templateName = templateName ? String(templateName) : '';
    cur.mode = importModeCode_(mode || cur.mode);
    cur.stage = 'erkennung';
    cur.recognizePos = 0;
    cur.total = items.length;
    cur.skipped = skipped;
    importSaveDraft_(cur);
  });
  return { total: items.length, skipped: skipped };
}

/**
 * Erkennt die nächsten Einträge (höchstens 40 oder 4 Minuten).
 * -> {done, pos, total, counts: {eindeutig, unklar, nichtGefunden, uebersprungen, bekannt}}
 */
function importRecognizeStep() {
  ensureSchema_();
  erResetMemo_();
  const t0 = erNow_();
  const draft = erNeedDraft_();
  const items = reviewRead_();
  const total = items.length;
  const startPos = Math.max(0, Number(draft.recognizePos) || 0);
  if (draft.stage !== 'erkennung') {
    return { done: true, pos: total, total: total, counts: erCounts_(items) };
  }
  let pos = Math.min(startPos, total);
  const changed = [];
  const picks = [];
  let failure = null;
  let n = 0;
  if (pos < total) {
    const idx = loadCmSets_();
    const mode = importModeCode_(draft.mode);
    const answers = answersLoad_(draft.sourceId);
    let cov = null;
    while (pos < total) {
      if (n >= ER_STEP_MAX || erNow_() - t0 > ER_STEP_MS) break;
      const it = items[pos];
      if (it.status !== REVIEW_STATUS.open) { pos++; continue; }
      if (mode === 'neu') {
        // Abdeckung nur aus demselben Tab der Datei (ein anderer Tab ist eine andere Liste)
        if (cov === null) cov = coverageFor_(draft.sourceId, String(draft.tab == null ? '' : draft.tab)) || {};
        const c = cov[it.fp];
        const covered = c ? (Number(c.D) || 0) + (Number(c.Rundone) || 0) : 0;
        if (covered >= (Number(it.qty) || 0)) {
          it.status = REVIEW_STATUS.known;
          it.reason = (Number(it.qty) || 0) > 0 ? 'Schon importiert.' : 'Menge 0.';
          changed.push(it);
          pos++;
          continue;
        }
      }
      let r;
      try {
        r = erRecognize_(it.values, idx);
      } catch (e) {
        failure = e;
        break;
      }
      n++;
      it.status = r.status;
      it.reason = r.reason;
      it.candidates = [];
      it.card = null;
      it.decision = null;
      it.prefilled = false;
      it.confirmed = false;
      if (r.pick) picks.push({ it: it, id: r.pick, prefs: r.prefs });
      else {
        if (r.candidates.length) {
          try { fillMissingImages_(r.candidates); } catch (e) { /* Bilder sind nur eine Hilfe */ }
          it.candidates = r.candidates.map(function (c) { return erCandOut_(c, idx.sets); });
        }
        erPrefill_(it, answers[it.fp]);
      }
      changed.push(it);
      pos++;
    }
    if (picks.length) {
      try {
        erFetchDetails_(picks.map(function (p) { return p.id; }));
      } catch (e) {
        throw new Error('tcgdex ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen. (' + e.message + ')');
      }
      picks.forEach(function (p) {
        const card = erCardJson_(p.id, p.prefs);
        if (card) {
          p.it.card = card;
        } else {
          p.it.status = REVIEW_STATUS.notFound;
          p.it.reason = 'Karte ' + p.id + ' ist bei tcgdex nicht mehr zu finden.';
          erPrefill_(p.it, answers[p.it.fp]);
        }
      });
    }
  }
  if (failure && !changed.length) {
    throw new Error('tcgdex ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen. (' + failure.message + ')');
  }
  const done = pos >= total;
  const saved = withLock_(function () {
    const cur = importDraft_();
    if (!cur || cur.sourceId !== draft.sourceId || cur.stage !== 'erkennung' ||
        (Math.max(0, Number(cur.recognizePos) || 0)) !== startPos) return false; // ein anderer Schritt war schneller
    reviewWriteItems_(changed);
    cur.recognizePos = pos;
    cur.total = total;
    if (done) cur.stage = items.some(erIsReview_) ? 'pruefung' : 'vorschau';
    importSaveDraft_(cur);
    return true;
  });
  if (!saved) {
    const cur = importDraft_() || {};
    const now = reviewRead_();
    const p = Math.min(Number(cur.recognizePos) || 0, now.length);
    return { done: cur.stage !== 'erkennung' || p >= now.length, pos: p, total: now.length, counts: erCounts_(now) };
  }
  return { done: done, pos: pos, total: total, counts: erCounts_(items) };
}

/* ---------- Öffentlich: Prüfliste ---------- */

/** Unklare und nicht gefundene Einträge. -> {items: [...], open, total} */
function importReviewList() {
  ensureSchema_();
  const items = reviewRead_().filter(erIsReview_);
  return { items: items.map(erReviewOut_), open: erOpenCount_(items), total: items.length };
}

/**
 * Eingabe für searchCards aufbereiten, damit Kürzel und Cardmarket-Setnamen auch dort funktionieren:
 * "DS 62" ohne Set -> Set ex11, Nummer 62; ein Set-Text, den searchCards nicht kennt („EX Delta Species“, „UL“),
 * wird durch die Set-ID ersetzt, wenn er genau ein Set meint. Sonst bleibt die Eingabe, wie sie ist.
 */
function erSearchInput_(input, idx) {
  const out = { name: erText_(input.name), number: erText_(input.number), set: erText_(input.set) };
  // „DP 16“ / „HGSS 01“ / „DS 62“ immer zusammen schreiben: so heißen die Nummern bei tcgdex, und „Set wählen“
  // sucht später mit genau dieser Nummer
  out.number = out.number.replace(/^([A-Za-z]{1,8})\s+(\d)/, '$1$2');
  if (!out.number && !out.set) return out;
  let ps;
  try { ps = parseSetNumber_(out.set, out.number, idx); } catch (e) { return out; }
  if (ps.setIds.length !== 1 || ps.ambiguous) return out;
  const id = ps.setIds[0];
  if (ps.code && out.number) out.number = ps.numbers[id] || ps.number;
  if (!out.set || !matchSets_(idx.sets, out.set).length) out.set = id;
  return out;
}

/** Kartensuche für die Prüfliste (wie im Tab „Hinzufügen“). Ohne Eingabe: Werte der Quellzeile. */
function importReviewSearch(fp, input) {
  ensureSchema_();
  erResetMemo_();
  input = input || {};
  if (!erText_(input.name) && !erText_(input.number) && !erText_(input.set) && fp) {
    const it = reviewRead_().filter(function (x) { return x.fp === String(fp); })[0];
    if (it) {
      const v = it.values || {};
      input = { name: v.nameClean || v.name || '', number: v.number || '', set: v.set || '' };
    }
  }
  return searchCards(erSearchInput_(input, loadCmSets_()));
}

/**
 * Entscheidung für einen Eintrag: {type: 'karte', id, lang, variant?} | {type: 'frei'} | {type: 'skip'} | {type: ''}.
 * Wird sofort auch in „Import-Antworten“ gespeichert. -> {item, open}
 */
function importReviewDecide(fp, decision) {
  ensureSchema_();
  erResetMemo_();
  const draft = erNeedDraft_();
  fp = String(fp == null ? '' : fp);
  decision = decision || { type: '' };
  const type = String(decision.type || '');
  const find = function () { return reviewRead_().filter(function (x) { return x.fp === fp; })[0] || null; };
  const before = find();
  if (!before) throw new Error('Diese Zeile gibt es in der Prüfliste nicht mehr. Bitte die Liste neu laden.');
  const v = before.values || {};
  let dec = null, card = null;
  if (type === 'karte') {
    const id = erText_(decision.id);
    if (!id) throw new Error('Bitte eine Karte auswählen.');
    erFetchDetails_([id]);
    let prefs;
    const want = erText_(decision.variant);
    if (want === 'base') prefs = [];
    else if (VARIANT_LABELS[want]) prefs = [want];
    else {
      const cm = v.cmUrl ? parseCardmarketUrl_(v.cmUrl, loadCmSets_()) : null;
      prefs = [cm ? cm.variant : '', v.variant];
    }
    card = erCardJson_(id, prefs);
    if (!card) throw new Error('Karte ' + id + ' nicht gefunden.');
    dec = { type: 'karte', id: card.id, lang: card.dataLang };
    if (want) dec.variant = want;
  } else if (type === 'frei') {
    dec = { type: 'frei' };
    card = erFreeCard_(v);
    if (!card.name) throw new Error('Ohne Namen kann keine freie Karte angelegt werden.');
  } else if (type === 'skip') {
    dec = { type: 'skip' };
  } else if (type !== '') {
    throw new Error('Unbekannte Entscheidung „' + type + '“.');
  }
  const res = withLock_(function () {
    const it = find();
    if (!it) throw new Error('Diese Zeile gibt es in der Prüfliste nicht mehr. Bitte die Liste neu laden.');
    it.decision = dec;
    it.card = card;
    it.confirmed = !!dec;
    it.prefilled = false;
    reviewWriteItems_([it]);
    answersUpsert_(draft.sourceId, [{ fp: fp, decision: dec || { type: '' }, card: card }]);
    return it;
  });
  return { item: erReviewOut_(res), open: erOpenCount_(reviewRead_().filter(erIsReview_)) };
}

/** Alle vorbelegten Antworten („Deine Wahl vom letzten Mal“) bestätigen, nicht die Vorauswahl „Als freie Karte“. -> {open} */
function importReviewAcceptPrefilled() {
  ensureSchema_();
  erNeedDraft_();
  return withLock_(function () {
    const items = reviewRead_().filter(erIsReview_);
    const ch = items.filter(function (it) { return it.prefilled && it.decision && !it.decision.auto && !it.confirmed; });
    ch.forEach(function (it) { it.confirmed = true; });
    reviewWriteItems_(ch);
    return { open: erOpenCount_(items) };
  });
}

/* ---------- Öffentlich: Set-Zuordnung vorbelegen ---------- */

/** Kürzel aus einem vollen tcgdex-Set: abbreviation.official, abbreviation (Text) oder tcgOnline. */
function erAbbrevOf_(set) {
  if (!set) return '';
  const a = set.abbreviation;
  if (a && typeof a === 'object' && a.official) return erText_(a.official).toUpperCase();
  if (typeof a === 'string' && erText_(a)) return erText_(a).toUpperCase();
  // tcgOnline-Werte wie „PR-DPP“ sind keine Cardmarket-Kürzel (dort heißt es DPPR bzw. HGSS)
  if (set.tcgOnline && !/^PR-/i.test(erText_(set.tcgOnline))) return erText_(set.tcgOnline).toUpperCase();
  return '';
}

/**
 * Füllt „Import-Sets“: eine Zeile pro englischem Set im Set-Cache (Cardmarket-Name = englischer Name),
 * Kürzel von tcgdex (Pakete zu 20) oder aus der Liste alter Kürzel. Zeilen mit Herkunft „Hand“ bleiben.
 * -> Text für die Meldung
 */
function importSetsVorbelegen() {
  ensureSchema_();
  erResetMemo_();
  const t0 = erNow_();
  const sets = loadSets_();
  const ids = sets.order.en.length ? sets.order.en.slice() : sets.order.de.slice();
  const lang = sets.order.en.length ? 'en' : 'de';
  if (!ids.length) {
    throw new Error('Der Set-Cache ist leer. Bitte zuerst „Pokémon > Übersetzung und Sets aktualisieren“ ausführen.');
  }
  const codes = {};
  let fetched = 0, stopped = false;
  for (let i = 0; i < ids.length; i += 20) {
    if (erNow_() - t0 > ER_PREFILL_MS) { stopped = true; break; }
    const batch = ids.slice(i, i + 20);
    const res = fetchAllJson_(batch.map(function (id) { return apiUrl_(lang, 'sets/' + encodeURIComponent(id)); }));
    res.forEach(function (r, j) {
      if (!r || !r.ok || !r.data) return;
      fetched++;
      const c = erAbbrevOf_(r.data);
      if (c) codes[batch[j]] = c;
      if (Array.isArray(r.data.cards)) erCachePutSet_(lang, batch[j], erCompactSet_(r.data));
    });
  }
  Object.keys(ER_CODE_SEED).forEach(function (id) {
    if (codes[id]) return;
    if (!sets.en[id] && !sets.de[id]) return;
    codes[id] = ER_CODE_SEED[id];
  });
  const result = withLock_(function () {
    const ss = ss_();
    const sh = getOrCreateSheet_(ss, IMP_SHEETS.cmsets);
    if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== CMSETS_HEADERS[0]) writeHeaders_(sh, CMSETS_HEADERS);
    const last = sh.getLastRow();
    const old = last > 1 ? sh.getRange(2, 1, last - 1, CMSETS_HEADERS.length).getValues() : [];
    const hand = old.filter(function (r) {
      return r.some(function (x) { return erText_(x) !== ''; }) && erText_(r[3]).toLowerCase() !== 'auto';
    }).map(function (r) { return r.map(function (x) { return x instanceof Date ? cellText_(x) : x; }); });
    const handNames = {};
    hand.forEach(function (r) { handNames[erSquash_(r[0])] = true; });
    const auto = [];
    ids.forEach(function (id) {
      const s = sets[lang][id];
      const name = s ? s.name : id;
      if (handNames[erSquash_(name)]) return;
      auto.push([name, codes[id] || '', id, 'auto']);
    });
    // Sets, die nur über die Kürzel-Liste bekannt sind (z. B. nur deutsch im Cache)
    Object.keys(codes).forEach(function (id) {
      if (ids.indexOf(id) >= 0) return;
      const s = sets.en[id] || sets.de[id];
      if (!s || handNames[erSquash_(s.name)]) return;
      auto.push([s.name, codes[id], id, 'auto']);
    });
    const rows = hand.map(function (r) { return [r[0], r[1], r[2], r[3]]; }).concat(auto);
    if (last > 1) sh.getRange(2, 1, last - 1, CMSETS_HEADERS.length).clearContent();
    if (rows.length) {
      if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
      sh.getRange(2, 1, rows.length, CMSETS_HEADERS.length).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, CMSETS_HEADERS.length).setValues(rows);
    }
    return { auto: auto.length, withCode: auto.filter(function (r) { return r[1]; }).length, hand: hand.length };
  });
  let msg = result.auto + ' Sets vorbelegt, ' + result.withCode + ' davon mit Kürzel.';
  if (result.hand) msg += ' ' + result.hand + (result.hand === 1 ? ' Zeile' : ' Zeilen') + ' von Hand bleiben, wie sie sind.';
  if (stopped) msg += ' Nicht alle Kürzel konnten geladen werden, bitte später noch einmal vorbelegen.';
  else if (fetched < ids.length) msg += ' Für ' + (ids.length - fetched) + ' Sets kam keine Antwort von tcgdex.';
  return msg;
}
