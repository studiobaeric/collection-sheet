
/* =========================================================================
 * 3. Abdeckung, Vorschau, Übernehmen, Liste, Zurücknehmen (Teil „Protokoll“)
 *
 * Grundsätze:
 *  - Jede Daten-Zeile eines Imports hat Herkunft 'Import <n>' und die Quellzeile (fp). Sie wird nie mit
 *    anderen Herkünften zusammengelegt.
 *  - Übernehmen schreibt zuerst alle Protokolleinträge als 'geplant', dann Daten, dann 'erledigt'.
 *    Bricht der Lauf ab, setzt importResume(nr) die geplanten Einträge idempotent fort.
 *  - Zurücknehmen schreibt alle Änderungen an Daten in einem einzigen rewriteData_.
 * ========================================================================= */

/** Spalten von „Importe“ (Kopfzeile -> Feld im Objekt). */
const PR_IMPORT_FIELDS = [
  ['Nr', 'nr'], ['Datum', 'date'], ['Quelle', 'sourceName'], ['Quelle-ID', 'sourceId'], ['Tab', 'tab'],
  ['Vorlage', 'template'], ['Modus', 'mode'], ['Status', 'status'], ['Neu', 'neu'], ['Mehr', 'mehr'],
  ['Weniger', 'weniger'], ['Übersprungen', 'uebersprungen'], ['Prüfliste offen', 'pruefOffen'],
  ['Wertänderung (EUR)', 'valueChange'], ['Zurückgenommen am', 'undoneAt'], ['Bericht', 'report']
];
const PR_NUMBER_FIELDS = { nr: true, neu: true, mehr: true, weniger: true, uebersprungen: true, pruefOffen: true };
const PR_ST_RUNNING = 'läuft';
const PR_ST_ACTIVE = 'aktiv';
const PR_ST_UNDONE = 'zurückgenommen';
const PR_ST_BROKEN = 'unterbrochen';
/**
 * Protokolltyp beim Zurücknehmen: ein 'abgleich'-Eintrag wird zurückgesetzt. Daten = {log (Log-ID des
 * Abgleichs), target (Anzahl der Zeile danach)}. Erst 'geplant', nach dem Schreiben von Daten 'erledigt'.
 * So setzt ein zweiter Versuch nach einem Abbruch nichts doppelt zurück.
 */
const PR_RESTORE_TYPE = 'abgleich-zurück';
/**
 * Protokolltyp beim Import: eine schon importierte Quellzeile hat sich in der Quelle geändert (neuer Fingerabdruck,
 * z. B. Set ergänzt, Link nachgetragen, neuer Begriff), ist aber dieselbe Karte. Quellzeile = neuer fp,
 * Daten = {from: alter fp}. Solange der Import aktiv ist, zählt alles vom alten fp für den neuen.
 */
const PR_MOVE_TYPE = 'umgezogen';

/* ---------- kleine Helfer ---------- */

function prNum_(x) {
  if (typeof x === 'number') return isFinite(x) ? x : 0;
  const p = parsePrice_(x);
  return typeof p === 'number' && isFinite(p) ? p : 0;
}

function prRound_(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

function prPad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Zeitstempel als Text 'yyyy-MM-dd HH:mm'. */
function prStamp_(d) {
  return Utilities.formatDate(d || new Date(), tz_(), 'yyyy-MM-dd HH:mm');
}

/** Zellwert als Zeitstempel-Text (Datum -> 'yyyy-MM-dd HH:mm', Text bleibt). */
function prTimeText_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : prStamp_(v);
  return String(v);
}

/** Preisdatum aus der Quelle -> 'yyyy-MM-dd' oder '' (unlesbar). */
function prDateText_(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? '' : dateText_(x);
  const s = String(x == null ? '' : x).trim();
  if (!s) return '';
  const ymd = function (y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return '';
    return y + '-' + prPad2_(mo) + '-' + prPad2_(d);
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return ymd(y, Number(m[2]), Number(m[1]));
  }
  return '';
}

/** Anzeige-Titel einer Daten-Zeile: Name (+ ' · ' Sonderversion). */
function prTitle_(r) {
  const v = versionText_(r[COL.version]);
  return String(r[COL.name] || '') + (v ? ' · ' + v : '');
}

/** Unterzeile: Set · Nummer · Variante · Sprache Zustand. */
function prSub_(r) {
  const parts = [];
  if (r[COL.setName]) parts.push(String(r[COL.setName]));
  const num = String(r[COL.localId] == null ? '' : r[COL.localId]).trim();
  const size = r[COL.setSize];
  if (num) parts.push(num + (size !== '' && size != null && Number(size) ? '/' + Number(size) : ''));
  const v = String(r[COL.variant] || '');
  if (v) parts.push(VARIANT_LABELS[v] || v);
  const cond = String(r[COL.cond] || '');
  parts.push(langCode_(r[COL.lang]) + (cond ? ' ' + cond : ''));
  return parts.join(' · ');
}

/** Titel aus den Werten einer Quellzeile (für Übersprungenes). */
function prValuesTitle_(it) {
  const v = (it && it.values) || {};
  const name = String(v.nameClean || v.name || '').trim();
  const num = String(v.number || '').trim();
  const set = String(v.set || '').trim();
  const head = name || (v.cmUrl ? String(v.cmUrl) : '') || (v.tcgdexId ? String(v.tcgdexId) : '');
  const tail = [set, num].filter(Boolean).join(' ');
  const out = [head, tail].filter(Boolean).join(', ');
  if (out) return out;
  const rows = (it && it.srcRows) || [];
  return rows.length ? 'Zeile ' + rows[0] : 'Zeile ohne Namen';
}

/* ---------- Blatt „Importe“ ---------- */

/** Blatt „Importe“ zum Lesen (null, wenn es fehlt). Schreibt nie. */
function prImportsSheet_() {
  return ss_().getSheetByName(IMP_SHEETS.imports);
}

/** Blatt „Importe“ zum Schreiben: anlegen bzw. Kopfzeile ergänzen, wenn nötig. Innerhalb der Sperre. */
function prEnsureImportsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(IMP_SHEETS.imports);
  if (!sh || sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()).trim() !== IMPORTE_HEADERS[0]) sh = quSetupImporte_(ss);
  return sh;
}

/** Kopfzeile -> {Feld: 0-basierte Spalte}. Fehlt die Kopfzeile ganz, gilt die Standardreihenfolge. */
function prImportCols_(sh) {
  const width = Math.min(Math.max(sh.getLastColumn(), IMPORTE_HEADERS.length), sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  const cols = {};
  let found = 0;
  PR_IMPORT_FIELDS.forEach(function (f) {
    const c = head.indexOf(f[0]);
    if (c >= 0) { cols[f[1]] = c; found++; }
  });
  if (!found) PR_IMPORT_FIELDS.forEach(function (f, i) { cols[f[1]] = i; });
  return cols;
}

/** Alle Importe als flache Objekte {nr, row, date, ..., status (gespeichert), neu, ..., report}. */
function prImportRows_() {
  const sh = prImportsSheet_();
  if (!sh || sh.getLastRow() < 2) return [];
  const cols = prImportCols_(sh);
  const width = Math.min(Math.max(sh.getLastColumn(), IMPORTE_HEADERS.length), sh.getMaxColumns());
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    const nr = Number(cols.nr != null ? r[cols.nr] : '');
    if (!nr) return;
    const o = { row: i + 2 };
    PR_IMPORT_FIELDS.forEach(function (f) {
      const c = cols[f[1]];
      const v = c == null ? '' : r[c];
      if (PR_NUMBER_FIELDS[f[1]]) o[f[1]] = Math.round(prNum_(v));
      else if (f[1] === 'valueChange') o[f[1]] = prRound_(prNum_(v));
      else if (f[1] === 'date' || f[1] === 'undoneAt') o[f[1]] = prTimeText_(v);
      else o[f[1]] = v == null ? '' : String(v).trim();
    });
    o.nr = nr;
    out.push(o);
  });
  return out;
}

/** Import-Zeile schreiben (o.row gesetzt: ersetzen, sonst unten anhängen). Innerhalb der Sperre. */
function prWriteImport_(o) {
  const sh = prEnsureImportsSheet_();
  const cols = prImportCols_(sh);
  let width = IMPORTE_HEADERS.length;
  Object.keys(cols).forEach(function (k) { width = Math.max(width, cols[k] + 1); });
  ensureCols_(sh, width);
  let row = o.row;
  let vals;
  if (row) {
    vals = sh.getRange(row, 1, 1, width).getValues()[0];
  } else {
    row = Math.max(2, sh.getLastRow() + 1);
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows() + 20);
    vals = new Array(width).fill('');
  }
  const fmts = new Array(width).fill('@');
  PR_IMPORT_FIELDS.forEach(function (f) {
    const c = cols[f[1]];
    if (c == null) return;
    const v = o[f[1]];
    if (PR_NUMBER_FIELDS[f[1]]) { vals[c] = Math.round(Number(v) || 0); fmts[c] = '0'; }
    else if (f[1] === 'valueChange') { vals[c] = prRound_(v); fmts[c] = EUR_FORMAT; }
    else vals[c] = v == null ? '' : String(v);
  });
  const range = sh.getRange(row, 1, 1, width);
  range.setNumberFormats([fmts]);
  range.setValues([vals]);
  o.row = row;
  return o;
}

/** Gespeicherter Status -> angezeigter Status ('läuft' ohne lebenden Lauf = 'unterbrochen'). */
function prEffStatus_(imp, run) {
  const s = String(imp.status || '');
  if (s === PR_ST_UNDONE) return PR_ST_UNDONE;
  if (s === PR_ST_RUNNING) return run && Number(run.nr) === Number(imp.nr) ? PR_ST_RUNNING : PR_ST_BROKEN;
  return PR_ST_ACTIVE;
}

/** Aktiv im Sinne der Abdeckung: alles außer 'zurückgenommen'. */
function prIsActive_(imp) {
  return !!imp && String(imp.status || '') !== PR_ST_UNDONE;
}

function prByNr_(imports) {
  const out = {};
  imports.forEach(function (i) { out[i.nr] = i; });
  return out;
}

function prFindImport_(imports, nr) {
  for (let i = 0; i < imports.length; i++) if (imports[i].nr === nr) return imports[i];
  return null;
}

/** Nächste Import-Nummer: höher als alles in Importe, Protokoll und Daten. */
function prNextNr_(imports, proto, rows) {
  let max = 0;
  imports.forEach(function (i) { max = Math.max(max, i.nr); });
  proto.forEach(function (e) { if (e.nr) max = Math.max(max, e.nr); });
  (rows || []).forEach(function (r) {
    const n = importNrOf_(r[COL.origin]);
    if (n) max = Math.max(max, n);
  });
  return max + 1;
}

/* ---------- Abdeckung ---------- */

/** Tab-Name zum Vergleichen. */
function prTabKey_(tab) {
  return String(tab == null ? '' : tab).trim();
}

/**
 * Gehört Import nr zur Quelle? Quelle = Datei (Quelle-ID) und, wenn tab angegeben ist, derselbe Tab: Zwei Tabs
 * derselben Datei sind zwei Listen (z. B. „Tabellenblatt1“ und „Bulk + Sammlung“). tab undefined/null: alle Tabs.
 * Ohne Zeile in „Importe“ ist der Tab unbekannt, dann zählt nur die Datei.
 */
function prSourceMatcher_(byNr, sourceId, tab) {
  sourceId = String(sourceId == null ? '' : sourceId);
  const byTab = tab !== undefined && tab !== null;
  const tk = prTabKey_(tab);
  return function (nr, fallbackSourceId) {
    const imp = byNr[nr];
    const src = imp ? String(imp.sourceId) : String(fallbackSourceId || '');
    if (src !== sourceId) return false;
    return !byTab || !imp || prTabKey_(imp.tab) === tk;
  };
}

/**
 * Umzüge geänderter Quellzeilen ('umgezogen' aktiver Importe dieser Quelle, der Reihe nach, dann extra = {alt: neu}
 * aus dem laufenden Plan). -> resolve(fp): der fp, für den eine Quellzeile heute zählt.
 */
function prAliasResolver_(proto, mine, active, extra) {
  const alias = {};
  const set = function (from, to) {
    if (!from || !to || from === to) return;
    delete alias[to]; // zurück umgezogen: der neue fp zählt wieder für sich
    alias[from] = to;
  };
  proto.forEach(function (e) {
    if (e.type !== PR_MOVE_TYPE || e.status === 'übersprungen' || e.nr == null || !e.fp || !e.data || !e.data.from) return;
    if (!active(e.nr) || !mine(e.nr, e.sourceId)) return;
    set(String(e.data.from), String(e.fp));
  });
  Object.keys(extra || {}).forEach(function (from) { set(String(from), String(extra[from])); });
  return function (fp) {
    fp = String(fp == null ? '' : fp);
    const seen = {};
    while (alias[fp] && !seen[fp]) { seen[fp] = true; fp = alias[fp]; }
    return fp;
  };
}

/**
 * Abdeckung je Quellzeile (fp) einer Quelle (Datei + Tab, siehe prSourceMatcher_):
 *  D       = Menge der 'neu' + 'gleich' aktiver Importe + (negative) 'abgleich' aktiver Importe auf Zeilen aktiver Importe
 *  G       = Anteil 'gleich' an D
 *  Rundone = 'handentfernt' von zurückgenommenen Importen, Rall = alle 'handentfernt'
 *  held    = aktuelle Anzahl in Daten-Zeilen aktiver Importe dieser Quelle, rows = diese Zeilen
 *  gleichEids = {Eintrag-ID der Hand-Zeile: Menge 'gleich'} (für den Abgleich: diese Exemplare sind noch da)
 *  revived = mit „trotzdem übernehmen“ zurückgeholte Exemplare: sie zählen nicht mehr als „von dir entfernt“
 *            und nicht doppelt als importiert (sonst würde ein später wirklich neues Exemplar zurückgehalten)
 */
function prCoverage_(sourceId, imports, proto, rows, tab, extraAlias) {
  sourceId = String(sourceId == null ? '' : sourceId);
  const byNr = prByNr_(imports);
  const active = function (nr) { return prIsActive_(byNr[nr]); };
  const mine = prSourceMatcher_(byNr, sourceId, tab);
  // geänderte Quellzeilen ('umgezogen'): alles vom alten fp zählt für den neuen
  const resolve = prAliasResolver_(proto, mine, active, extraAlias);
  const cov = {};
  const get = function (fp) {
    if (!cov[fp]) cov[fp] = { D: 0, G: 0, Rundone: 0, Rall: 0, held: 0, rows: [], gleichEids: {}, revived: 0 };
    return cov[fp];
  };
  proto.forEach(function (e) {
    if (!e.fp || e.status === 'übersprungen' || e.nr == null) return;
    if (!mine(e.nr, e.sourceId)) return;
    const q = Number(e.qty) || 0;
    const efp = resolve(e.fp);
    if (e.type === 'neu' || e.type === 'gleich') {
      if (!active(e.nr)) return;
      const c = get(efp);
      c.D += q;
      if (e.type === 'gleich') {
        c.G += q;
        if (e.eid) c.gleichEids[e.eid] = (c.gleichEids[e.eid] || 0) + q;
      }
      if (e.type === 'neu' && e.data && Number(e.data.revived) > 0) c.revived += Math.min(q, Number(e.data.revived));
    } else if (e.type === 'abgleich') {
      const from = Number(e.data && e.data.fromImport);
      if (active(e.nr) && active(from)) get(efp).D += q;
    } else if (e.type === 'handentfernt') {
      const c = get(efp);
      c.Rall += q;
      if (!active(e.nr)) c.Rundone += q;
    }
  });
  (rows || []).forEach(function (r, i) {
    if (!isDataRow_(r)) return;
    const nr = importNrOf_(r[COL.origin]);
    if (nr == null || !active(nr) || !mine(nr)) return;
    const fp = String(r[COL.fp] || '');
    if (!fp) return;
    const n = Number(r[COL.count]) || 0;
    const c = get(resolve(fp));
    c.held += n;
    c.rows.push({ eid: String(r[COL.eid] || ''), nr: nr, count: n, idx: i });
  });
  // zurückgeholte Exemplare heben je ein „von dir entfernt“ auf und zählen nur einmal als importiert
  Object.keys(cov).forEach(function (fp) {
    const c = cov[fp];
    const rv = Math.min(c.revived, c.Rall);
    if (rv <= 0) return;
    c.Rall -= rv;
    // abgedeckt (D + Rundone) zählt das zurückgeholte Exemplar sonst zweimal: erst aus Rundone, sonst aus D abziehen
    const fromUndone = Math.min(rv, c.Rundone);
    c.Rundone -= fromUndone;
    c.D -= rv - fromUndone;
  });
  return cov;
}

/**
 * Öffentlich für andere Teile: {fp: {D, G, Rundone, Rall, held, rows: [{eid, nr, count}]}} einer Quelle.
 * tab (optional): nur Importe aus diesem Tab der Datei.
 */
function coverageFor_(sourceId, tab) {
  const sh = ss_().getSheetByName(SHEETS.data);
  const rows = sh ? readData_(sh) : [];
  return prCoverage_(sourceId, prImportRows_(), readProto_(), rows, tab);
}

/* ---------- Plan eines Imports ---------- */

/** Kartenangaben aus einer Daten-Zeile (für Nachträge ohne Karte in der Prüfung). */
function prCardFromRow_(r) {
  if (!String(r[COL.id] || '')) {
    const size = Number(r[COL.setSize]) || 0;
    return {
      free: true, name: String(r[COL.name] || ''), setName: String(r[COL.setName] || ''),
      localId: String(r[COL.localId] == null ? '' : r[COL.localId]) + (size ? '/' + size : ''), variant: String(r[COL.variant] || '')
    };
  }
  const en = String(r[COL.source] || '') === 'en-Ersatz';
  return {
    dataLang: en ? 'en' : 'de', id: String(r[COL.id]), name: String(en ? (r[COL.nameEn] || r[COL.name]) : r[COL.name]),
    inputName: en ? String(r[COL.name] || '') : '', nameEn: String(r[COL.nameEn] || ''), setId: String(r[COL.setId] || ''),
    setName: String(r[COL.setName] || ''), setDate: cellText_(r[COL.setDate]), localId: String(r[COL.localId] == null ? '' : r[COL.localId]),
    setSize: Number(r[COL.setSize]) || null, img: String(r[COL.img] || ''), rarity: String(r[COL.rarity] || ''),
    category: String(r[COL.category] || ''), illustrator: String(r[COL.illustrator] || ''), baseVariant: String(r[COL.variant] || ''),
    variant: String(r[COL.variant] || ''), price: typeof r[COL.price] === 'number' ? r[COL.price] : null,
    priceDate: cellText_(r[COL.priceDate])
  };
}

/**
 * Karte für eine Quellzeile ohne Karte in der Prüfung (z. B. „bekannt“, aber „Von dir entfernt“ angehakt):
 * zuerst aus dem jüngsten 'neu'-Eintrag dieser Quelle (auch zurückgenommener Importe), sonst aus einer Daten-Zeile.
 */
function prFallbackCard_(fp, mine, proto, st, cov, resolve) {
  for (let k = proto.length - 1; k >= 0; k--) {
    const e = proto[k];
    if (e.type !== 'neu' || !e.data || !e.data.card) continue;
    if ((resolve ? resolve(e.fp) : e.fp) !== fp) continue;
    if (!mine(e.nr, e.sourceId)) continue;
    const card = Object.assign({}, e.data.card);
    if (e.data.variant) card.variant = e.data.variant;
    return card;
  }
  const c = cov[fp];
  if (c && c.rows.length) {
    const r = st.rows[c.rows[c.rows.length - 1].idx];
    if (r) return prCardFromRow_(r);
  }
  return null;
}

/**
 * Eintragsschlüssel (Karte, Variante, Version, Zustand, Sprache) einer schon importierten Quellzeile, '' wenn unbekannt:
 * aus dem jüngsten 'neu'-Eintrag (neu = dieser Eintrag), sonst aus 'Dieselbe Karte', sonst aus ihrer Daten-Zeile.
 */
function prFpKey_(fp, neu, proto, resolve, mine, c, st, now) {
  if (neu) {
    const d = neu.data;
    try {
      return entryKey_(buildCardRow_(d.card, {
        variant: d.variant, cond: d.cond, lang: d.lang, version: d.version, count: 1, origin: originOf_(0), fp: fp,
        eid: 'E-key', headers: st.headers, width: st.width, now: now
      }));
    } catch (e) { /* weiter unten */ }
  }
  for (let k = proto.length - 1; k >= 0; k--) {
    const e = proto[k];
    if (e.type === 'gleich' && e.fp && e.data && e.data.key && resolve(e.fp) === fp && mine(e.nr, e.sourceId)) return String(e.data.key);
  }
  if (c && c.rows.length && st.rows[c.rows[0].idx]) return entryKey_(st.rows[c.rows[0].idx]);
  return '';
}

/** Variante, Zustand, Sprache, Sonderversion einer neuen Zeile aus Karte und Quellwerten. */
function prRowOpts_(card, values) {
  const v = values || {};
  let variant;
  if (VARIANT_LABELS[card.variant]) variant = card.variant;
  else if (VARIANT_LABELS[v.variant]) variant = v.variant;
  else variant = card.free ? 'normal' : 'base';
  return { variant: variant, cond: condCode_(v.cond) || '', lang: langCode_(v.lang), version: versionText_(v.version) };
}

function prNewPlan_(mode, sourceId) {
  return {
    mode: mode, sourceId: sourceId, newRows: [], gleich: [], abgleich: [], spalten: [], answers: [],
    handMatch: [], removedByYou: [], added: [], decreased: [], skipped: [],
    counts: { neu: 0, mehr: 0, weniger: 0, uebersprungen: 0, pruefOffen: 0, bekannt: 0, kopien: 0, gleich: 0, entfernt: 0 },
    valueBefore: 0, valueChange: 0, absent: 0, autoFree: 0, notes: [], warnings: [], moves: []
  };
}

/**
 * Plan aus Entwurf, Prüfung, Protokoll und Daten. Schreibt nichts.
 * choices = {hand: {fp: 'same'|'extra'}, removed: {fp: true}}; st = dataStore_().
 */
function prPlan_(draft, items, choices, st, imports, proto) {
  choices = choices || {};
  const handCh = choices.hand || {};
  const remCh = choices.removed || {};
  const mode = importModeCode_(draft.mode);
  const sourceId = String(draft.sourceId || '');
  const cfg = draft.cfg || {};
  const byNr = prByNr_(imports);
  const tab = prTabKey_(draft.tab);
  const mine = prSourceMatcher_(byNr, sourceId, tab);
  const activeNr = function (nr) { return prIsActive_(byNr[nr]); };
  let cov = prCoverage_(sourceId, imports, proto, st.rows, tab);
  let resolve = prAliasResolver_(proto, mine, activeNr, null);
  const now = new Date();
  const plan = prNewPlan_(mode, sourceId);
  // Hinweis: aus derselben Datei wurde bisher nur aus anderen Tabs importiert (z. B. Tab umbenannt?)
  const otherTabs = [];
  let sameTab = false;
  imports.forEach(function (i) {
    if (!prIsActive_(i) || String(i.sourceId) !== sourceId) return;
    if (prTabKey_(i.tab) === tab) sameTab = true;
    else if (otherTabs.indexOf(prTabKey_(i.tab)) < 0) otherTabs.push(prTabKey_(i.tab));
  });
  if (!sameTab && otherTabs.length) {
    plan.warnings.push('Aus dieser Datei hast du bisher nur ' + (otherTabs.length === 1 ? 'den Tab' : 'die Tabs') + ' „' +
      otherTabs.join('“, „') + '“ importiert. Jeder Tab zählt als eigene Liste, darum gilt hier alles als neu. ' +
      'Hast du den Tab nur umbenannt, gib ihm wieder den alten Namen und starte den Import neu.');
  }
  const show = {};
  (Array.isArray(cfg.extras) ? cfg.extras : []).forEach(function (x) {
    if (x && x.name && x.show) show[String(x.name).trim()] = true;
  });
  plan.showNames = Object.keys(show);

  // Bestand vor dem Import
  const groupCount = {}, groupOwn = {}, handByGroup = {};
  st.rows.forEach(function (r, i) {
    if (!storeLive_(st, i)) return;
    const g = groupKey_(r);
    const n = Number(r[COL.count]) || 0;
    groupCount[g] = (groupCount[g] || 0) + n;
    if (typeof r[COL.ownPrice] === 'number' && isFinite(r[COL.ownPrice])) groupOwn[g] = true;
    if (isHandOrigin_(r[COL.origin]) && n > 0) (handByGroup[g] = handByGroup[g] || []).push(i);
  });
  // Exemplare von Hand, die frühere Importe schon als „Dieselbe Karte“ gezählt haben
  const claimed = {};
  proto.forEach(function (e) {
    if (e.type !== 'gleich' || e.status === 'übersprungen' || !prIsActive_(byNr[e.nr])) return;
    claimed[e.eid] = (claimed[e.eid] || 0) + (Number(e.qty) || 0);
  });
  const avail = {};
  const availOf = function (i) {
    const eid = String(st.rows[i][COL.eid]);
    if (!(eid in avail)) avail[eid] = Math.max(0, (Number(st.rows[i][COL.count]) || 0) - (claimed[eid] || 0));
    return avail[eid];
  };
  const empty = { D: 0, G: 0, Rundone: 0, Rall: 0, held: 0, rows: [], gleichEids: {}, revived: 0 };
  const liveCount = {};
  st.rows.forEach(function (r, i) {
    if (storeLive_(st, i)) liveCount[String(r[COL.eid])] = (liveCount[String(r[COL.eid])] || 0) + (Number(r[COL.count]) || 0);
  });
  /**
   * Abgleich: so viele Exemplare dieser Quellzeile sind noch da: Import-Zeilen (held) plus die als „Dieselbe Karte“
   * gezählten Hand-Exemplare, soweit die Hand-Zeile sie noch hat. Weggenommen wird nur aus Import-Zeilen.
   */
  function syncNeed(c, S) {
    let g = 0;
    Object.keys(c.gleichEids || {}).forEach(function (eid) { g += Math.min(c.gleichEids[eid], liveCount[eid] || 0); });
    g = Math.min(g, c.G);
    return Math.max(0, Math.min(c.held, c.held + g - S));
  }
  /** Probezeile wie die spätere neue Daten-Zeile (für Schlüssel, Titel, Bild). -> {cardIn, probe} */
  function probeFor(card, values, fp) {
    let cardIn = card;
    if (!card.free && card.dataLang === 'en' && !card.inputName) {
      const nm = String(values.nameClean || values.name || '').trim();
      if (nm) cardIn = Object.assign({}, card, { inputName: nm });
    }
    const ro = prRowOpts_(cardIn, values);
    const probe = buildCardRow_(cardIn, {
      variant: ro.variant, cond: ro.cond, lang: ro.lang, version: ro.version, count: 1, origin: originOf_(0), fp: fp,
      eid: 'E-plan', headers: st.headers, width: st.width, now: now
    });
    return { cardIn: cardIn, probe: probe };
  }

  // Geänderte Quellzeilen: Eine schon importierte Zeile fehlt in der Quelle, dafür gibt es eine Zeile mit neuem
  // Fingerabdruck und derselben Karte (gleiche Variante, Version, Zustand, Sprache). Dann ist es dieselbe Zeile
  // (z. B. Set ergänzt, Link nachgetragen, neuer Begriff): ihre Abdeckung zieht mit um, sie kommt nicht doppelt dazu
  // und was Eric davon verkauft hat, bleibt weg.
  const itemFps = {};
  items.forEach(function (it) { if (it.fp) itemFps[String(it.fp)] = true; });
  const goneByKey = {};
  let goneN = 0;
  const lastNeu = {};
  proto.forEach(function (e) {
    if (e.type === 'neu' && e.fp && e.data && e.data.card && e.status !== 'übersprungen' && mine(e.nr, e.sourceId)) lastNeu[resolve(e.fp)] = e;
  });
  Object.keys(cov).forEach(function (fp) {
    const c = cov[fp];
    if (itemFps[fp] || !(c.D + c.Rundone > 0 || c.Rall > 0 || c.held > 0)) return;
    const k = prFpKey_(fp, lastNeu[fp], proto, resolve, mine, c, st, now);
    if (!k) return;
    (goneByKey[k] = goneByKey[k] || []).push(fp);
    goneN++;
  });
  if (goneN) {
    const freshByKey = {};
    const seen0 = {};
    items.forEach(function (it) {
      const fp = String(it.fp || '');
      if (!fp || seen0[fp] || cov[fp]) return;
      seen0[fp] = true;
      const r0 = reviewResolve_(it);
      if ((r0.kind !== 'card' && r0.kind !== 'free') || !r0.card || !(Number(it.qty) > 0)) return;
      const pr = probeFor(r0.card, it.values || {}, fp).probe;
      const k = entryKey_(pr);
      if (goneByKey[k]) (freshByKey[k] = freshByKey[k] || []).push({ fp: fp, title: prTitle_(pr) });
    });
    const extra = {}, titles = [];
    Object.keys(freshByKey).forEach(function (k) {
      const fresh = freshByKey[k];
      goneByKey[k].forEach(function (g, i) {
        const to = fresh[Math.min(i, fresh.length - 1)];
        extra[g] = to.fp;
        plan.moves.push({ from: g, to: to.fp });
      });
      fresh.forEach(function (f, i) { if (i < goneByKey[k].length) titles.push(f.title); });
    });
    if (plan.moves.length) {
      cov = prCoverage_(sourceId, imports, proto, st.rows, tab, extra);
      resolve = prAliasResolver_(proto, mine, activeNr, extra);
      const n = titles.length;
      plan.notes.push((n === 1 ? 'Eine Zeile in deiner Liste hat sich seit dem letzten Import geändert, ist aber dieselbe Karte: ' :
        n + ' Zeilen in deiner Liste haben sich seit dem letzten Import geändert, sind aber dieselben Karten: ') + titles.join(', ') +
        (n === 1 ? '. Sie zählt als schon importiert und kommt nicht doppelt dazu.' : '. Sie zählen als schon importiert und kommen nicht doppelt dazu.'));
    }
  }

  const newCols = {};
  const newGroups = {};
  const seen = {};

  /** Abgleich: need Exemplare von den Zeilen dieser Quellzeile wegnehmen, jüngster Import zuerst. */
  function decrease(fp, need) {
    const c = cov[fp];
    if (!c || need <= 0) return 0;
    let rest = need;
    c.rows.filter(function (x) { return x.count > 0; })
      .sort(function (a, b) { return (b.nr - a.nr) || (b.idx - a.idx); })
      .forEach(function (x) {
        if (rest <= 0) return;
        const k = Math.min(rest, x.count);
        const r = st.rows[x.idx];
        // mit dem fp der Zeile (nach einem Umzug kann das der alte sein)
        plan.abgleich.push({ eid: x.eid, fp: String(r[COL.fp] || fp), qty: -k, countBefore: x.count, fromImport: x.nr, idx: x.idx, title: prTitle_(r) });
        plan.decreased.push({ eid: x.eid, title: prTitle_(r), sub: prSub_(r), qty: k, fromImport: x.nr });
        plan.counts.weniger += k;
        rest -= k;
      });
    return need - rest;
  }

  items.forEach(function (it) {
    const fp = String(it.fp || '');
    if (!fp || seen[fp]) return;
    seen[fp] = true;
    const res = reviewResolve_(it);
    const d = it.decision;
    if (d && (d.type === 'karte' || d.type === 'frei' || d.type === 'skip')) {
      plan.answers.push({ fp: fp, decision: d, card: d.type === 'skip' ? null : it.card });
    }
    const S = Math.max(0, Math.floor(Number(it.qty) || 0));
    const c = cov[fp] || empty;
    if (res.kind === 'open') {
      // unklar oder nicht gefunden: zählt als vorhanden, fügt nichts hinzu, nimmt nichts weg
      plan.counts.pruefOffen++;
      plan.skipped.push({ fp: fp, title: prValuesTitle_(it), reason: 'In der Prüfliste noch offen' });
      return;
    }
    if (res.kind === 'free' && d && d.auto) plan.autoFree++;
    if (res.kind === 'skip') {
      plan.counts.uebersprungen++;
      plan.skipped.push({ fp: fp, title: prValuesTitle_(it), reason: 'Von dir übersprungen' });
      return;
    }
    if (res.kind === 'skipRow') {
      // z. B. nicht angehakt: beim Abgleich heißt das „nicht mehr da“
      if (mode === 'abgleich') decrease(fp, syncNeed(c, S));
      return;
    }

    // 'card', 'free' oder 'known'
    let add, blocked;
    if (mode === 'alle') {
      blocked = Math.min(S, c.Rall);
      add = S - blocked;
    } else {
      add = Math.max(0, S - (c.D + c.Rundone));
      blocked = Math.min(c.Rall, Math.max(0, S - add - c.held - c.G));
    }
    let dec = 0;
    if (mode === 'abgleich') dec = decrease(fp, syncNeed(c, S));

    let card = res.card;
    if (!card && (add > 0 || blocked > 0)) card = prFallbackCard_(fp, mine, proto, st, cov, resolve);
    if (!card) {
      if (add > 0) {
        plan.counts.pruefOffen++;
        plan.skipped.push({ fp: fp, title: prValuesTitle_(it), reason: 'Karte unbekannt, bitte die Erkennung neu starten' });
      } else if (S > 0 && !dec) plan.counts.bekannt++;
      return;
    }

    const values = it.values || {};
    const pf = probeFor(card, values, fp);
    const cardIn = pf.cardIn;
    const probe = pf.probe;
    const gkey = groupKey_(probe);
    const ekey = entryKey_(probe);
    const title = prTitle_(probe);
    const sub = prSub_(probe);
    const image = String(probe[COL.img] || '');

    const tick = blocked > 0 && remCh[fp] === true;
    if (blocked > 0) plan.removedByYou.push({ fp: fp, title: title, sub: sub, image: image, qty: blocked, ticked: tick });
    const total = add + (tick ? blocked : 0);
    if (total <= 0) {
      if (blocked > 0) plan.counts.entfernt += blocked;
      else if (S > 0 && !dec) plan.counts.bekannt++;
      return;
    }

    // „Schon von Hand erfasst“: nur für Exemplare, die neu dazukommen. Mit dem Haken bei „Von dir entfernt“
    // zurückgeholte Exemplare kommen immer dazu (sie waren schon einmal importiert, Eric holt sie bewusst zurück).
    let handCovered = 0;
    const hidx = add > 0 ? (handByGroup[gkey] || []).filter(function (i) { return availOf(i) > 0; }) : [];
    if (hidx.length) {
      const handCount = hidx.reduce(function (s, i) { return s + availOf(i); }, 0);
      const choice = handCh[fp] === 'extra' ? 'extra' : 'same';
      plan.handMatch.push({ fp: fp, title: title, sub: sub, image: image, qty: add, handCount: handCount, choice: choice });
      if (choice === 'same') {
        handCovered = Math.min(add, handCount);
        let rest = handCovered;
        hidx.slice().sort(function (a, b) {
          const sa = entryKey_(st.rows[a]) === ekey ? 0 : 1, sb = entryKey_(st.rows[b]) === ekey ? 0 : 1;
          return (sa - sb) || (availOf(b) - availOf(a)) || (a - b);
        }).forEach(function (i) {
          if (rest <= 0) return;
          const k = Math.min(rest, availOf(i));
          if (k <= 0) return;
          const r = st.rows[i];
          const eid = String(r[COL.eid]);
          plan.gleich.push({ eid: eid, fp: fp, qty: k, count: Number(r[COL.count]) || 0, key: entryKey_(r), title: title });
          avail[eid] -= k;
          rest -= k;
        });
        plan.counts.gleich += handCovered;
      }
    }
    const qty = total - handCovered;
    if (qty <= 0) return;

    // Eigener Preis nur, wenn die Karte keinen Trendpreis hat und die Gruppe noch keinen eigenen Preis
    const trendless = !!card.free || typeof card.price !== 'number' || !isFinite(card.price);
    let sp = values.price;
    if (typeof sp !== 'number') sp = parsePrice_(sp);
    let ownPrice = '', ownPriceDate = '';
    if (trendless && typeof sp === 'number' && isFinite(sp) && sp > 0 && !groupOwn[gkey]) {
      ownPrice = prRound_(sp);
      ownPriceDate = prDateText_(values.priceDate) || todayText_();
      groupOwn[gkey] = true;
    }

    // Zusatzspalten
    const ex = {};
    const vx = values.extras && typeof values.extras === 'object' ? values.extras : {};
    Object.keys(vx).forEach(function (name) {
      const n = String(name).trim();
      const v = String(vx[name] == null ? '' : vx[name]).trim();
      if (!n || !v || DATA_HEADERS.indexOf(n) >= 0) return;
      ex[n] = v;
      if (st.headers.indexOf(n, NCOL) < 0 && !newCols[n]) {
        newCols[n] = true;
        plan.spalten.push({ name: n, show: !!show[n] });
      }
    });

    probe[COL.count] = qty;
    probe[COL.ownPrice] = ownPrice;
    probe[COL.ownPriceDate] = ownPriceDate;
    const existed = (groupCount[gkey] || 0) > 0;
    if (!existed && !newGroups[gkey]) { newGroups[gkey] = true; plan.counts.neu++; }
    if (existed) plan.counts.mehr += qty;
    plan.counts.kopien += qty;
    plan.newRows.push({
      fp: fp, card: cardIn, id: String(probe[COL.id] || ''), variant: String(probe[COL.variant]), cond: String(probe[COL.cond] || ''),
      lang: String(probe[COL.lang]), version: String(probe[COL.version] || ''), qty: qty, ownPrice: ownPrice,
      ownPriceDate: ownPriceDate, extras: ex, title: title, row: probe, revived: tick ? Math.min(blocked, qty) : 0
    });
    plan.added.push({ fp: fp, title: title, sub: sub, image: image, qty: qty, newGroup: !existed });
  });

  // Abgleich: Quellzeilen, die es in der Quelle nicht mehr gibt -> alles weg
  if (mode === 'abgleich') {
    Object.keys(cov).forEach(function (fp) {
      if (seen[fp] || cov[fp].held <= 0) return;
      plan.absent++;
      decrease(fp, cov[fp].held);
    });
  }

  // Wertänderung: Sammlungswert nachher minus vorher (wie in der Sammlung gerechnet)
  const live = [], after = [];
  const decBy = {};
  plan.abgleich.forEach(function (a) { decBy[a.idx] = (decBy[a.idx] || 0) - a.qty; });
  st.rows.forEach(function (r, i) {
    if (!storeLive_(st, i)) return;
    live.push(r);
    if (decBy[i]) {
      const cp = r.slice();
      cp[COL.count] = Math.max(0, (Number(r[COL.count]) || 0) - decBy[i]);
      after.push(cp);
    } else after.push(r);
  });
  plan.newRows.forEach(function (n) { after.push(n.row); });
  plan.valueBefore = collectionValue_(live).total;
  plan.valueChange = prRound_(collectionValue_(after).total - plan.valueBefore);
  return plan;
}

/** Zahl mit Einzahl/Mehrzahl: prN_(1, 'Eintrag', 'Einträge') -> '1 Eintrag'. */
function prN_(n, one, many) {
  return n + ' ' + (Number(n) === 1 ? one : many);
}

/** Kurzer Bericht für die Spalte „Bericht“. */
function prReport_(c, skippedSrc) {
  const parts = [];
  parts.push(prN_(c.kopien, 'Exemplar', 'Exemplare') + ' übernommen (' + prN_(c.neu, 'neue Karte', 'neue Karten') + ', ' +
    prN_(c.mehr, 'Exemplar', 'Exemplare') + ' bei vorhandenen Karten)');
  if (c.gleich) parts.push(c.gleich + ' schon von Hand erfasst');
  if (c.weniger) parts.push(c.weniger + ' weniger durch Abgleich');
  if (c.bekannt) parts.push(c.bekannt + ' schon bekannt');
  if (c.entfernt) parts.push(c.entfernt + ' von dir entfernt und weggelassen');
  if (c.uebersprungen) parts.push(c.uebersprungen + ' übersprungen');
  if (c.pruefOffen) parts.push(c.pruefOffen + ' in der Prüfliste offen');
  const s = skippedSrc || {};
  const src = [];
  if (s.summe) src.push(prN_(s.summe, 'Summenzeile', 'Summenzeilen'));
  if (s.leer) src.push(prN_(s.leer, 'leere Zeile', 'leere Zeilen'));
  if (s.nichtAngehakt) src.push(s.nichtAngehakt + ' nicht angehakt');
  if (src.length) parts.push('In der Quelle ausgelassen: ' + src.join(', '));
  return parts.join('. ') + '.';
}

function prEuroSigned_(n) {
  n = prRound_(n);
  return (n > 0 ? '+' : n < 0 ? '-' : '') + eurText_(Math.abs(n));
}

function prMessage_(nr, c, valueChange, notes) {
  let msg = 'Import ' + nr + ' ist fertig: ' + prN_(c.kopien, 'Exemplar', 'Exemplare') + ' übernommen';
  const bits = [];
  if (c.neu) bits.push(prN_(c.neu, 'neue Karte', 'neue Karten'));
  if (c.mehr) bits.push(c.mehr + ' mehr bei vorhandenen');
  if (bits.length) msg += ' (' + bits.join(', ') + ')';
  if (c.weniger) msg += ', ' + c.weniger + ' weniger';
  msg += '. Wert ' + prEuroSigned_(valueChange) + '.';
  if (c.pruefOffen) {
    msg += ' ' + (c.pruefOffen === 1 ? '1 Zeile aus der Prüfliste ist noch offen und wurde' :
      c.pruefOffen + ' Zeilen aus der Prüfliste sind noch offen und wurden') + ' nicht übernommen.';
  }
  if (notes && notes.length) msg += ' ' + notes.join(' ');
  return msg;
}

/** Vorschau fürs UI (nur JSON-fähige Werte). */
function prPreviewOut_(plan, draft) {
  const s = (draft && draft.skipped) || {};
  return {
    mode: plan.mode,
    modeLabel: importModeLabel_(plan.mode),
    sourceName: String((draft && draft.sourceName) || ''),
    tab: String((draft && draft.tab) || ''),
    counts: plan.counts,
    handMatch: plan.handMatch,
    removedByYou: plan.removedByYou,
    added: plan.added,
    decreased: plan.decreased,
    skipped: plan.skipped,
    newColumns: plan.spalten.map(function (x) { return x.name; }),
    sourceSkipped: { summe: Number(s.summe) || 0, leer: Number(s.leer) || 0, nichtAngehakt: Number(s.nichtAngehakt) || 0 },
    valueChange: plan.valueChange,
    autoFree: plan.autoFree,
    notes: plan.notes.slice(),
    warnings: plan.warnings.slice()
  };
}

/* ---------- Übernehmen: Einträge -> Protokoll -> Daten ---------- */

/** Protokolleinträge (alle 'geplant') aus dem Plan. 'neu' bekommt die neue Eintrag-ID schon hier. */
function prEntries_(plan, nr, sourceId) {
  const out = [];
  const base = function (type, eid, fp, qty, data) {
    return { nr: nr, type: type, eid: eid, fp: fp, qty: qty, data: data, status: 'geplant', sourceId: sourceId };
  };
  plan.spalten.forEach(function (s) { out.push(base('spalte', '', '', 0, { name: s.name, show: !!s.show })); });
  plan.newRows.forEach(function (n) {
    const d = {
      id: n.id, variant: n.variant, version: n.version, cond: n.cond, lang: n.lang, ownPrice: n.ownPrice,
      ownPriceDate: n.ownPriceDate, extras: n.extras, title: n.title, card: n.card
    };
    if (n.revived > 0) d.revived = n.revived; // mit „trotzdem übernehmen“ zurückgeholt
    out.push(base('neu', newEid_(), n.fp, n.qty, d));
  });
  plan.gleich.forEach(function (g) {
    out.push(base('gleich', g.eid, g.fp, g.qty, { count: g.count, key: g.key, title: g.title }));
  });
  (plan.moves || []).forEach(function (m) { out.push(base(PR_MOVE_TYPE, '', m.to, 0, { from: m.from })); });
  plan.abgleich.forEach(function (a) {
    out.push(base('abgleich', a.eid, a.fp, a.qty, { countBefore: a.countBefore, fromImport: a.fromImport, fp: a.fp, title: a.title }));
  });
  return out;
}

/**
 * Wendet 'geplant'e Einträge eines Imports auf Daten an (idempotent) und setzt ihren Status.
 * resume: nach einem Abbruch (eine Abgleich-Zeile, die schon auf countBefore − k steht, gilt als erledigt).
 * -> {done, skipped, notes, weniger, added}. Innerhalb der Sperre.
 */
function prApply_(nr, entries, resume) {
  const st = dataStore_();
  const now = new Date();
  const done = [], skipped = [], notes = [];
  const changedTitles = [], goneTitles = [];
  let weniger = 0, added = 0;
  entries.forEach(function (e) {
    if (e.type === 'spalte' && e.data && e.data.name) {
      storeEnsureExtra_(st, String(e.data.name));
      done.push(e.logId);
    }
  });
  entries.forEach(function (e) {
    if (e.type !== 'neu') return;
    if (storeFindEid_(st, e.eid) >= 0) { done.push(e.logId); return; }
    const d = e.data || {};
    if (!d.card) { skipped.push(e.logId); return; }
    const row = buildCardRow_(d.card, {
      variant: d.variant, cond: d.cond, lang: d.lang, version: d.version, count: e.qty, origin: originOf_(nr), fp: e.fp,
      ownPrice: d.ownPrice, ownPriceDate: d.ownPriceDate, extras: d.extras || {}, eid: e.eid, now: now,
      headers: st.headers, width: st.width
    });
    storeAdd_(st, row);
    added++;
    done.push(e.logId);
  });
  entries.forEach(function (e) {
    if (e.type === 'gleich' || e.type === PR_MOVE_TYPE) { done.push(e.logId); return; }
    if (e.type !== 'abgleich') return;
    const k = -(Number(e.qty) || 0);
    const before = Number(e.data && e.data.countBefore);
    const title = (e.data && e.data.title) || '';
    const i = storeFindEid_(st, e.eid);
    if (i < 0 || k <= 0) { skipped.push(e.logId); goneTitles.push(title); return; }
    const r = st.rows[i];
    const cur = Number(r[COL.count]) || 0;
    if (cur === before) {
      r[COL.count] = before - k;
      r[COL.changed] = now;
      storeTouch_(st, i);
      weniger += k;
      done.push(e.logId);
    } else if (resume && cur === before - k) {
      weniger += k;
      done.push(e.logId);
    } else {
      skipped.push(e.logId);
      changedTitles.push(title + ' (' + prSub_(r) + ')');
    }
  });
  storeSave_(st);
  setProtoStatus_(done, 'erledigt');
  setProtoStatus_(skipped, 'übersprungen');
  if (changedTitles.length) {
    notes.push('Beim Abgleich übersprungen, weil du die Anzahl inzwischen geändert hast: ' + changedTitles.join(', ') + '.');
  }
  if (goneTitles.length) {
    notes.push('Beim Abgleich übersprungen, weil der Eintrag nicht mehr da ist: ' + goneTitles.filter(Boolean).join(', ') + '.');
  }
  const live = st.rows.filter(function (r, i) { return storeLive_(st, i); });
  return { done: done, skipped: skipped, notes: notes, weniger: weniger, added: added, value: collectionValue_(live).total };
}

/**
 * Abschluss nach prApply_: Antworten sichern, Entwurf leeren, Import 'aktiv', Lauf beenden, Gruppen und
 * Zusatzspalten der Sammlung. opt = {draft (zu leerender Entwurf oder null), answers, valueChange, showNames}.
 */
function prFinish_(imp, ap, opt) {
  opt = opt || {};
  if (opt.answers && opt.answers.length) answersUpsert_(imp.sourceId, opt.answers);
  if (opt.draft) importResetDraft_();
  imp.status = PR_ST_ACTIVE;
  imp.weniger = opt.weniger != null ? opt.weniger : ap.weniger;
  if (opt.valueChange != null) imp.valueChange = prRound_(opt.valueChange);
  if (ap.notes.length) imp.report = [imp.report, ap.notes.join(' ')].filter(Boolean).join(' ');
  prWriteImport_(imp);
  importClearRun_();
  const existing = extraNames_();
  const cur = getViewExtras_();
  const addNames = [];
  (opt.showNames || []).forEach(function (n) {
    n = String(n == null ? '' : n).trim();
    if (n && existing.indexOf(n) >= 0 && cur.indexOf(n) < 0 && addNames.indexOf(n) < 0) addNames.push(n);
  });
  // Der Import ist hier schon fertig: scheitert nur das Nachziehen der Ansicht, bleibt er trotzdem 'aktiv'
  try {
    if (addNames.length) setViewExtras_(cur.concat(addNames));
    afterDataChange_();
  } catch (e) {
    ap.notes.push('Die Sammlung konnte nicht neu aufgebaut werden (' + e.message + '). Bitte im Menü „Ansicht neu aufbauen“ wählen.');
  }
  return addNames;
}

/** Entwurf prüfen: Erkennung muss fertig sein. */
function prCheckDraft_(draft) {
  if (!draft || !draft.sourceId) throw new Error('Gerade ist kein Import in Arbeit. Bitte starte einen neuen Import.');
  const stage = String(draft.stage || '');
  if (stage === 'erkennung') throw new Error('Die Erkennung ist noch nicht fertig. Bitte warte, bis alle Zeilen erkannt sind.');
  if (stage !== 'pruefung' && stage !== 'vorschau') throw new Error('Bitte zuerst die Erkennung starten.');
}

/** Wirft, wenn ein Import unterbrochen ist (außer except). */
function prAssertNoBroken_(imports, except, forUndo) {
  const run = importRunState_();
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (imp.nr === except || prEffStatus_(imp, run) !== PR_ST_BROKEN) continue;
    throw new Error('Import ' + imp.nr + ' wurde unterbrochen. Bitte ihn zuerst in der Liste mit „Fortsetzen“ fertig machen oder mit „Zurücknehmen“ entfernen' +
      (forUndo ? ', dann geht das hier.' : ', dann kannst du neu importieren.'));
  }
}

/**
 * Vorschau des aktuellen Entwurfs. choices (optional) wie bei importCommit.
 * -> {mode, modeLabel, sourceName, tab, counts: {neu, mehr, weniger, uebersprungen, pruefOffen, bekannt, kopien, gleich, entfernt},
 *     handMatch, removedByYou, added, decreased, skipped, newColumns, sourceSkipped, valueChange}
 */
function importBuildPreview(choices) {
  ensureSchema_();
  const draft = importDraft_();
  prCheckDraft_(draft);
  const items = reviewRead_();
  const plan = prPlan_(draft, items, choices || {}, dataStore_(), prImportRows_(), readProto_());
  return prPreviewOut_(plan, draft);
}

/**
 * Entwurf übernehmen. choices = {hand: {fp: 'same'|'extra'}, removed: {fp: true}}.
 * Der Plan wird hier neu berechnet (Zahlen aus dem UI zählen nicht). -> {nr, counts, valueChange, message}
 */
function importCommit(choices) {
  ensureSchema_();
  importAssertNoRun_();
  prCheckDraft_(importDraft_());
  return withLock_(function () {
    importAssertNoRun_();
    const imports = prImportRows_();
    prAssertNoBroken_(imports, null, false);
    const draft = importDraft_();
    prCheckDraft_(draft);
    if (draft.committingNr) {
      const prev = prFindImport_(imports, Number(draft.committingNr));
      if (prev && prev.status === PR_ST_ACTIVE) {
        importResetDraft_();
        throw new Error('Dieser Import wurde schon als Import ' + prev.nr + ' übernommen. Der Entwurf ist jetzt verworfen.');
      }
    }
    const items = reviewRead_();
    if (!items.length) throw new Error('In der Quelle wurden keine Karten gefunden. Es wurde nichts übernommen.');
    const st = dataStore_();
    const proto = readProto_();
    const plan = prPlan_(draft, items, choices || {}, st, imports, proto);
    const nr = prNextNr_(imports, proto, st.rows);
    const sourceId = String(draft.sourceId);
    const imp = prWriteImport_({
      nr: nr, date: prStamp_(new Date()), sourceName: String(draft.sourceName || ''), sourceId: sourceId,
      tab: String(draft.tab || ''), template: String(draft.templateName || ''), mode: importModeLabel_(plan.mode),
      status: PR_ST_RUNNING, neu: plan.counts.neu, mehr: plan.counts.mehr, weniger: plan.counts.weniger,
      uebersprungen: plan.counts.uebersprungen, pruefOffen: plan.counts.pruefOffen, valueChange: plan.valueChange,
      undoneAt: '', report: prReport_(plan.counts, draft.skipped)
    });
    importSetRun_(nr, 'commit');
    try {
      draft.committingNr = nr;
      importSaveDraft_(draft);
      // 1. alles als 'geplant' ins Protokoll, 2. Daten, 3. 'erledigt'
      const entries = prEntries_(plan, nr, sourceId);
      const ids = appendProto_(entries);
      entries.forEach(function (e, i) { e.logId = ids[i]; });
      const ap = prApply_(nr, entries, false);
      const valueChange = ap.value - plan.valueBefore;
      prFinish_(imp, ap, {
        draft: draft, answers: plan.answers, valueChange: valueChange,
        showNames: plan.showNames
      });
      const counts = Object.assign({}, plan.counts, { weniger: ap.weniger });
      return { nr: nr, counts: counts, valueChange: prRound_(valueChange), message: prMessage_(nr, counts, valueChange, ap.notes) };
    } catch (e) {
      // noch in der Sperre: Lauf beenden, damit der Import sofort als „unterbrochen“ erscheint
      try { importClearRun_(); } catch (e2) { /* egal */ }
      throw new Error('Der Import wurde unterbrochen (' + prCauseText_(e) + '). Du kannst ihn in der Liste fortsetzen oder zurücknehmen.');
    }
  });
}

/**
 * Ursache eines Abbruchs für die Meldung: typische englische Google-Fehler auf Deutsch,
 * sonst der Text ohne „Exception:“ und ohne Datei-IDs.
 */
function prCauseText_(e) {
  const m = String((e && e.message) || e || '').replace(/^\s*(Exception|Error):\s*/i, '').trim();
  if (/exceeded maximum execution time/i.test(m)) return 'die erlaubten 6 Minuten waren um';
  if (/timed out|timeout/i.test(m)) return 'Google Tabellen hat zu lange gebraucht';
  if (/service unavailable|server error|internal error|try again later/i.test(m)) return 'Google Tabellen war kurz nicht erreichbar';
  const t = m.replace(/\s*(with|for)\s+id\s+[\w-]+/gi, '').trim();
  return t || 'unbekannter Fehler';
}

/** Unterbrochenen Import fertig machen (idempotent). -> {nr, counts, valueChange, message} */
function importResume(nr) {
  ensureSchema_();
  nr = Number(nr);
  importAssertNoRun_();
  return withLock_(function () {
    importAssertNoRun_();
    const imports = prImportRows_();
    const imp = prFindImport_(imports, nr);
    if (!imp) throw new Error('Import ' + nr + ' gibt es nicht.');
    if (imp.status === PR_ST_UNDONE) throw new Error('Import ' + nr + ' ist zurückgenommen und kann nicht fortgesetzt werden.');
    const counts0 = { neu: imp.neu, mehr: imp.mehr, weniger: imp.weniger, uebersprungen: imp.uebersprungen, pruefOffen: imp.pruefOffen };
    if (imp.status !== PR_ST_RUNNING) {
      return { nr: nr, counts: counts0, valueChange: imp.valueChange, message: 'Import ' + nr + ' ist schon fertig.' };
    }
    prAssertNoBroken_(imports, nr, false);
    importSetRun_(nr, 'resume');
    try {
      const mine = readProto_().filter(function (e) { return e.nr === nr; });
      // Abbruch, bevor das Protokoll geschrieben war: es gibt nichts fortzusetzen. Nicht als fertig melden,
      // sondern als „nichts übernommen“ vermerken und den Entwurf behalten, damit Importieren wieder geht.
      if (!mine.length) return prAbortEmpty_(imp);
      const open = mine.filter(function (e) { return e.status === 'geplant'; });
      let wenigerBefore = 0;
      mine.forEach(function (e) {
        if (e.type === 'abgleich' && e.status === 'erledigt') wenigerBefore += -(Number(e.qty) || 0);
      });
      const ap = prApply_(nr, open, true);
      const draft = importDraft_();
      const own = draft && Number(draft.committingNr) === nr ? draft : null;
      let answers = [];
      const showNames = [];
      mine.forEach(function (e) { if (e.type === 'spalte' && e.data && e.data.show && e.data.name) showNames.push(e.data.name); });
      if (own) {
        reviewRead_().forEach(function (it) {
          const d = it.decision;
          if (d && (d.type === 'karte' || d.type === 'frei' || d.type === 'skip')) {
            answers.push({ fp: it.fp, decision: d, card: d.type === 'skip' ? null : it.card });
          }
        });
        ((own.cfg && own.cfg.extras) || []).forEach(function (x) { if (x && x.show && x.name) showNames.push(String(x.name).trim()); });
      }
      const weniger = wenigerBefore + ap.weniger;
      prFinish_(imp, ap, { draft: own, answers: answers, weniger: weniger, showNames: showNames });
      const counts = Object.assign({}, counts0, { weniger: weniger });
      let msg = 'Import ' + nr + ' ist jetzt fertig' + (ap.added ? ': ' + prN_(ap.added, 'Eintrag', 'Einträge') + ' nachgetragen.' : '.');
      if (ap.notes.length) msg += ' ' + ap.notes.join(' ');
      return { nr: nr, counts: counts, valueChange: imp.valueChange, message: msg };
    } catch (e) {
      try { importClearRun_(); } catch (e2) { /* egal */ }
      throw e;
    }
  });
}

/**
 * Unterbrochener Import ohne einen einzigen Protokolleintrag (z. B. Abbruch beim Schreiben des Protokolls):
 * Daten wurden nicht angefasst. Import als zurückgenommen vermerken, Entwurf behalten (committingNr weg).
 * Innerhalb der Sperre. -> Ergebnis wie importResume, mit nothingDone: true
 */
function prAbortEmpty_(imp) {
  const nr = imp.nr;
  const stamp = prStamp_(new Date());
  imp.status = PR_ST_UNDONE;
  imp.undoneAt = stamp;
  imp.neu = 0; imp.mehr = 0; imp.weniger = 0; imp.uebersprungen = 0; imp.pruefOffen = 0; imp.valueChange = 0;
  imp.report = 'Abgebrochen, bevor etwas übernommen wurde (' + stamp + '). Es wurde nichts geändert.';
  prWriteImport_(imp);
  const draft = importDraft_();
  const own = draft && Number(draft.committingNr) === nr;
  if (own) {
    delete draft.committingNr;
    importSaveDraft_(draft);
  }
  importClearRun_();
  return {
    nr: nr, counts: { neu: 0, mehr: 0, weniger: 0, uebersprungen: 0, pruefOffen: 0 }, valueChange: 0, nothingDone: true,
    message: 'Import ' + nr + ' wurde abgebrochen, bevor etwas übernommen wurde. Es wurde nichts geändert, er steht jetzt als ' +
      'zurückgenommen in der Liste. ' + (own ? 'Dein Entwurf ist noch da: Mit „Weitermachen“ kommst du zur Vorschau und kannst noch einmal importieren.' :
      'Bitte starte den Import neu.')
  };
}

/**
 * Alle Importe, neueste zuerst:
 * [{nr, date, sourceName, sourceId, tab, template, mode, modeCode, status ('aktiv'|'unterbrochen'|'läuft'|'zurückgenommen'),
 *   counts: {neu, mehr, weniger, uebersprungen, pruefOffen}, valueChange, undoneAt, report}]
 */
function importList() {
  ensureSchema_();
  const run = importRunState_();
  return prImportRows_().map(function (i) {
    return {
      nr: i.nr, date: i.date, sourceName: i.sourceName, sourceId: i.sourceId, tab: i.tab, template: i.template,
      mode: i.mode, modeCode: importModeCode_(i.mode), status: prEffStatus_(i, run),
      counts: { neu: i.neu, mehr: i.mehr, weniger: i.weniger, uebersprungen: i.uebersprungen, pruefOffen: i.pruefOffen },
      valueChange: i.valueChange, undoneAt: i.undoneAt, report: i.report
    };
  }).sort(function (a, b) { return b.nr - a.nr; });
}

/* ---------- Zurücknehmen ---------- */

function prOwnPriceOf_(v) {
  if (typeof v === 'number' && isFinite(v)) return prRound_(v);
  const p = parsePrice_(v);
  return typeof p === 'number' && isFinite(p) && p > 0 ? prRound_(p) : null;
}

/** Was hat sich an einer Import-Zeile seit dem Import geändert? snap = Daten des 'neu'-Eintrags, o = rowObj_. */
function prDiff_(snap, o) {
  const out = [];
  const sid = String(snap.id || '');
  const oid = String(o.id || '');
  if (!sid && oid) out.push('Mit tcgdex-Karte verknüpft');
  else if (sid !== oid) out.push('Karte geändert');
  else if (String(snap.variant || '') !== String(o.variant || '')) {
    out.push('Variante ' + (VARIANT_LABELS[snap.variant] || snap.variant || 'ohne') + ' → ' + (VARIANT_LABELS[o.variant] || o.variant || 'ohne'));
  }
  const c1 = String(snap.cond || ''), c2 = String(o.cond || '');
  if (c1 !== c2) out.push('Zustand ' + (c1 || 'ohne') + ' → ' + (c2 || 'ohne'));
  const l1 = langCode_(snap.lang), l2 = langCode_(o.lang);
  if (l1 !== l2) out.push('Sprache ' + l1 + ' → ' + l2);
  const v1 = versionText_(snap.version), v2 = versionText_(o.version);
  if (v1 !== v2) out.push('Sonderversion ' + (v1 || 'ohne') + ' → ' + (v2 || 'ohne'));
  const p1 = prOwnPriceOf_(snap.ownPrice), p2 = prOwnPriceOf_(o.ownPrice);
  if (p1 !== p2) out.push('Eigener Preis ' + (p1 == null ? 'ohne' : eurText_(p1)) + ' → ' + (p2 == null ? 'ohne' : eurText_(p2)));
  const e1 = snap.extras || {}, e2 = o.extras || {};
  const names = [];
  Object.keys(e1).concat(Object.keys(e2)).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
  names.forEach(function (n) {
    const a = cellText_(e1[n] == null ? '' : e1[n]).trim();
    const b = cellText_(e2[n] == null ? '' : e2[n]).trim();
    if (a !== b) out.push('Zusatzwert ' + n + ': ' + (a || 'leer') + ' → ' + (b || 'leer'));
  });
  return out;
}

/**
 * Was Zurücknehmen mit Import nr macht (schreibt nichts):
 * {del: [i] (unverändert, wird gelöscht), changed: [{i, eid, title, sub, count, changes}],
 *  restore: [{i, k, eid, fp, log}], restoreMissing: [Einträge], restoreDone: [Log-IDs von Vormerkungen, die schon
 *  geschrieben sind], staleMarkers: [Log-IDs nicht geschriebener Vormerkungen], fehlt, spalten: [Namen], mine: [Einträge],
 *  surplus: [{fp, k}] (von Hand in Daten dazugetippte Exemplare), bleiben (Summe davon), rowsByFp: {fp: [i]}}
 */
function prUndoAnalyze_(nr, st, proto, imports) {
  const byNr = prByNr_(imports || []);
  const mine = proto.filter(function (e) { return e.nr === nr; });
  const byEid = {}, byFp = {};
  mine.forEach(function (e) {
    if (e.type !== 'neu') return;
    byEid[e.eid] = e;
    if (!byFp[e.fp]) byFp[e.fp] = e;
  });
  const origin = originOf_(nr);
  const a = { del: [], changed: [], restore: [], restoreMissing: [], restoreDone: [], staleMarkers: [], fehlt: 0, spalten: [],
    mine: mine, surplus: [], bleiben: 0, rowsByFp: {} };
  const liveEids = {};
  const curByFp = {}, eidFp = {};
  st.rows.forEach(function (r, i) {
    if (!storeLive_(st, i)) return;
    liveEids[String(r[COL.eid])] = true;
    if (normOrigin_(r[COL.origin]) !== origin) return;
    const eid = String(r[COL.eid]);
    const rfp = String(r[COL.fp] || '');
    (a.rowsByFp[rfp] = a.rowsByFp[rfp] || []).push(i);
    curByFp[rfp] = (curByFp[rfp] || 0) + (Number(r[COL.count]) || 0);
    eidFp[eid] = rfp;
    const own = byEid[eid];
    const snap = own || byFp[String(r[COL.fp] || '')];
    const changes = [];
    if (!snap) changes.push('Nicht im Protokoll');
    else {
      if (!own) changes.push('Aufgeteilt');
      prDiff_(snap.data || {}, rowObj_(r, st.headers)).forEach(function (c) { changes.push(c); });
    }
    const count = Number(r[COL.count]) || 0;
    if (changes.length && count > 0) {
      a.changed.push({ i: i, eid: eid, title: prTitle_(r), sub: prSub_(r), count: count, changes: changes });
    } else a.del.push(i);
  });
  // Vormerkungen eines früheren, abgebrochenen Versuchs (je Abgleich-Eintrag die jüngste)
  const marker = {}, reversed = {};
  proto.forEach(function (e) {
    if (e.type !== PR_RESTORE_TYPE || e.status === 'übersprungen' || !e.data || !e.data.log) return;
    if (e.nr === nr) marker[e.data.log] = e;
    if (e.status === 'erledigt') reversed[e.data.log] = true;
  });
  mine.forEach(function (e) {
    if (e.type === 'neu' && e.status === 'erledigt' && !liveEids[e.eid]) a.fehlt++;
    if (e.type === 'spalte' && e.status !== 'übersprungen' && e.data && e.data.name) a.spalten.push(String(e.data.name));
    if (e.type !== 'abgleich') return;
    const k = -(Number(e.qty) || 0);
    if (k <= 0) return;
    const i = storeFindEid_(st, e.eid);
    let applied = e.status === 'erledigt';
    if (e.status === 'geplant') {
      // unterbrochener Import: nur, was schon geschrieben wurde
      applied = i >= 0 && (Number(st.rows[i][COL.count]) || 0) === Number(e.data && e.data.countBefore) - k;
    }
    if (!applied) return;
    const m = marker[e.logId];
    if (m && m.status === 'erledigt') return; // schon beim letzten Versuch zurückgesetzt
    if (i < 0) { a.restoreMissing.push(e); a.fehlt++; return; }
    if (m) {
      // letzter Versuch abgebrochen: steht die Zeile schon auf dem Ziel, wurde Daten geschrieben
      if ((Number(st.rows[i][COL.count]) || 0) === Number(m.data.target)) { a.restoreDone.push(m.logId); return; }
      a.staleMarkers.push(m.logId);
    }
    a.restore.push({ i: i, k: k, eid: e.eid, fp: e.fp, log: e.logId });
  });
  // Von Hand in Daten dazugetippte Exemplare (Anzahl einer Import-Zeile erhöht): Was du von Hand hinzufügst,
  // bleibt immer. Erwartet je Quellzeile: 'neu' minus „von dir entfernt“ minus Abgleich späterer Importe.
  const expected = {};
  mine.forEach(function (e) {
    if (e.type !== 'neu' || !e.fp) return;
    if (e.status === 'erledigt' || (e.status === 'geplant' && liveEids[e.eid])) expected[e.fp] = (expected[e.fp] || 0) + (Number(e.qty) || 0);
  });
  proto.forEach(function (e) {
    if (e.type === 'handentfernt' && e.nr === nr && e.fp in expected) expected[e.fp] -= Number(e.qty) || 0;
    if (e.type !== 'abgleich' || e.status !== 'erledigt' || Number(e.data && e.data.fromImport) !== nr) return;
    const by = byNr[e.nr];
    if ((by && by.status === PR_ST_UNDONE) || reversed[e.logId]) return; // schon zurückgesetzt
    const fp = eidFp[e.eid] || String((e.data && e.data.fp) || e.fp || '');
    if (fp in expected) expected[fp] += Number(e.qty) || 0; // Menge ist negativ
  });
  Object.keys(expected).forEach(function (fp) {
    const k = (curByFp[fp] || 0) - Math.max(0, expected[fp]);
    if (k > 0) { a.surplus.push({ fp: fp, k: k }); a.bleiben += k; }
  });
  return a;
}

/** Import zum Zurücknehmen holen und Status prüfen. */
function prUndoTarget_(imports, nr) {
  const imp = prFindImport_(imports, nr);
  if (!imp) throw new Error('Import ' + nr + ' gibt es nicht.');
  const status = prEffStatus_(imp, importRunState_());
  if (status === PR_ST_UNDONE) throw new Error('Import ' + nr + ' ist schon zurückgenommen.');
  if (status === PR_ST_RUNNING) throw new Error('Gerade läuft schon ein Import oder Zurücknehmen. Bitte kurz warten.');
  return imp;
}

/**
 * Vorschau fürs Zurücknehmen.
 * -> {nr, sourceName, status, counts: {loeschen, zurueck, fehlt}, changed: [{eid, title, sub, count, changes}],
 *     laterSameSource: [nr], newTerms: []}
 */
function importUndoPreview(nr) {
  ensureSchema_();
  nr = Number(nr);
  const imports = prImportRows_();
  const imp = prUndoTarget_(imports, nr);
  const st = dataStore_();
  const a = prUndoAnalyze_(nr, st, readProto_(), imports);
  return {
    nr: nr,
    sourceName: imp.sourceName,
    status: prEffStatus_(imp, importRunState_()),
    counts: { loeschen: a.del.length, zurueck: a.restore.length, fehlt: a.fehlt, bleiben: a.bleiben },
    changed: a.changed.map(function (c) { return { eid: c.eid, title: c.title, sub: c.sub, count: c.count, changes: c.changes }; }),
    laterSameSource: imports.filter(function (i) {
      return i.nr > nr && i.sourceId === imp.sourceId && prTabKey_(i.tab) === prTabKey_(imp.tab) && prIsActive_(i);
    }).map(function (i) { return i.nr; }).sort(function (x, y) { return x - y; }),
    newTerms: []
  };
}

/**
 * Import zurücknehmen. decisions = {eid: 'keep'|'remove'} für jede geänderte Zeile (Pflicht).
 * Alle Änderungen an Daten in einem rewriteData_. -> {nr, deleted, kept, restored, skipped, message}
 */
function importUndo(nr, decisions) {
  ensureSchema_();
  nr = Number(nr);
  decisions = decisions || {};
  importAssertNoRun_();
  return withLock_(function () {
    importAssertNoRun_();
    const imports = prImportRows_();
    const imp = prUndoTarget_(imports, nr);
    prAssertNoBroken_(imports, nr, true);
    const st = dataStore_();
    const a = prUndoAnalyze_(nr, st, readProto_(), imports);
    const missing = a.changed.filter(function (c) { return decisions[c.eid] !== 'keep' && decisions[c.eid] !== 'remove'; });
    if (missing.length) {
      throw new Error('Bitte entscheide bei jeder geänderten Karte, ob du sie behalten oder entfernen willst (noch offen: ' +
        missing.length + ').');
    }
    importSetRun_(nr, 'undo');
    try {
      const now = new Date();
      let deleted = 0, kept = 0, restored = 0, handKept = 0;
      const keptRow = {};
      a.del.forEach(function (i) { storeRemove_(st, i); deleted++; });
      a.changed.forEach(function (c) {
        if (decisions[c.eid] === 'remove') { storeRemove_(st, c.i); deleted++; return; }
        keptRow[c.i] = true;
        // behalten: wird ein Eintrag „von Hand“ (mit einer vorhandenen Hand-Zeile desselben Schlüssels zusammengelegt)
        const r = st.rows[c.i];
        r[COL.origin] = ORIGIN_HAND;
        r[COL.fp] = '';
        r[COL.key] = entryKey_(r);
        r[COL.changed] = now;
        const j = storeFindHand_(st, r[COL.key], c.i);
        if (j >= 0) {
          const t = st.rows[j];
          t[COL.count] = (Number(t[COL.count]) || 0) + (Number(r[COL.count]) || 0);
          t[COL.changed] = now;
          if (typeof t[COL.ownPrice] !== 'number' && typeof r[COL.ownPrice] === 'number') {
            t[COL.ownPrice] = r[COL.ownPrice];
            t[COL.ownPriceDate] = r[COL.ownPriceDate];
          }
          // Zusatzwerte nur in leere Felder der Hand-Zeile übernehmen
          for (let col = NCOL; col < st.width; col++) {
            if (cellText_(t[col] == null ? '' : t[col]).trim() === '' && cellText_(r[col] == null ? '' : r[col]).trim() !== '') t[col] = r[col];
          }
          storeRemove_(st, c.i);
        }
        kept++;
      });
      // von Hand dazugetippte Exemplare bleiben: in die Hand-Zeile desselben Eintrags (sonst eine neue)
      a.surplus.forEach(function (sp) {
        const idx = a.rowsByFp[sp.fp] || [];
        let rest = sp.k;
        idx.forEach(function (i) { if (keptRow[i]) rest -= Number(st.rows[i][COL.count]) || 0; }); // bleiben ohnehin ganz
        idx.forEach(function (i) {
          if (rest <= 0 || keptRow[i]) return;
          const r = st.rows[i];
          const k = Math.min(rest, Number(r[COL.count]) || 0);
          if (k <= 0) return;
          const key = entryKey_(r);
          let j = storeFindHand_(st, key, i);
          if (j < 0) {
            const h = r.slice();
            h[COL.eid] = newEid_();
            h[COL.origin] = ORIGIN_HAND;
            h[COL.fp] = '';
            h[COL.count] = 0;
            h[COL.added] = now;
            h[COL.key] = key;
            j = storeAdd_(st, h);
          }
          st.rows[j][COL.count] = (Number(st.rows[j][COL.count]) || 0) + k;
          st.rows[j][COL.changed] = now;
          rest -= k;
          handKept += k;
        });
      });
      // Abgleich zurücksetzen: erst mit Ziel-Anzahl vormerken, dann Daten schreiben, dann als erledigt markieren
      if (a.staleMarkers.length) setProtoStatus_(a.staleMarkers, 'übersprungen');
      const markers = a.restore.map(function (x) {
        const cur = Number(st.rows[x.i][COL.count]) || 0;
        return { nr: nr, type: PR_RESTORE_TYPE, eid: x.eid, fp: x.fp || '', qty: x.k, data: { log: x.log, target: cur + x.k },
          status: 'geplant', sourceId: imp.sourceId };
      });
      const markerIds = markers.length ? appendProto_(markers) : [];
      a.restore.forEach(function (x) {
        const r = st.rows[x.i];
        r[COL.count] = (Number(r[COL.count]) || 0) + x.k;
        r[COL.changed] = now;
        restored++;
      });
      restored += a.restoreDone.length;
      const rest = st.rows.filter(function (r, i) { return !st.removed[i]; });
      rewriteData_(rest);
      if (markerIds.length || a.restoreDone.length) setProtoStatus_(markerIds.concat(a.restoreDone), 'erledigt');
      // Zusatzspalten, die dieser Import angelegt hat und die jetzt leer sind
      const dropped = [];
      a.spalten.forEach(function (name) {
        const col = st.headers.indexOf(name, NCOL);
        if (col < 0 || dropped.indexOf(name) >= 0) return;
        const used = rest.some(function (r) { return isDataRow_(r) && cellText_(r[col] == null ? '' : r[col]).trim() !== ''; });
        if (!used && deleteExtraColumn_(name)) dropped.push(name);
      });
      const skipped = a.restoreMissing.length;
      const stamp = prStamp_(now);
      let rep = 'Zurückgenommen am ' + stamp + ': ' + prN_(deleted, 'Eintrag', 'Einträge') + ' gelöscht, ' + kept + ' behalten, ' +
        restored + ' auf den alten Stand gesetzt';
      if (skipped) rep += ', ' + skipped + ' Abgleich-Einträge übersprungen (Eintrag nicht mehr da)';
      if (handKept) rep += ', ' + prN_(handKept, 'von Hand dazugezähltes Exemplar bleibt', 'von Hand dazugezählte Exemplare bleiben');
      if (dropped.length) rep += ', Zusatzspalten entfernt: ' + dropped.join(', ');
      imp.status = PR_ST_UNDONE;
      imp.undoneAt = stamp;
      imp.report = [imp.report, rep + '.'].filter(Boolean).join(' ');
      prWriteImport_(imp);
      importClearRun_();
      const view = getViewExtras_();
      if (dropped.some(function (n) { return view.indexOf(n) >= 0; })) {
        setViewExtras_(view.filter(function (n) { return dropped.indexOf(n) < 0; }));
      }
      afterDataChange_();
      let msg = 'Import ' + nr + ' ist zurückgenommen: ' + prN_(deleted, 'Eintrag', 'Einträge') + ' gelöscht';
      if (kept) msg += ', ' + kept + ' behalten (jetzt von Hand)';
      if (restored) msg += ', ' + restored + ' auf den alten Stand gesetzt';
      msg += '.';
      if (handKept) {
        msg += ' ' + (handKept === 1 ? '1 Exemplar, das du von Hand dazugezählt hast, bleibt' :
          handKept + ' Exemplare, die du von Hand dazugezählt hast, bleiben') + ' (jetzt von Hand).';
      }
      if (skipped) msg += ' ' + (skipped === 1 ? '1 Eintrag aus dem Abgleich gab es nicht mehr, er wurde' : skipped + ' Einträge aus dem Abgleich gab es nicht mehr, sie wurden') + ' übersprungen.';
      return { nr: nr, deleted: deleted, kept: kept, restored: restored, skipped: skipped, handKept: handKept, droppedColumns: dropped, message: msg };
    } catch (e) {
      try { importClearRun_(); } catch (e2) { /* egal */ }
      // ein zweiter Versuch macht dort weiter (vorgemerkte Abgleich-Einträge werden nicht doppelt zurückgesetzt)
      throw new Error('Das Zurücknehmen von Import ' + nr + ' wurde unterbrochen (' + prCauseText_(e) + '). Bitte klick noch einmal auf ' +
        '„Zurücknehmen“, dann wird es fertig gemacht.');
    }
  });
}
