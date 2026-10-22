/**
 * Import.gs: Import-Werkzeug für bestehende Sammlungen (Assistent, Erkennung, Prüfliste, Vorschau, Zurücknehmen).
 * Teilt sich den globalen Bereich mit Code.gs und nutzt dessen Helfer (withLock_, rowObj_, appendDataRows_ ...).
 * Wichtig: Auf oberster Ebene nur reine Literale, keine Konstanten aus Code.gs (Ladereihenfolge der Dateien).
 */

/* =========================================================================
 * 0. Gemeinsame Konstanten und Zustände des Imports
 * ========================================================================= */

const IMP_SHEETS = {
  imports: 'Importe',
  terms: 'Import-Begriffe',
  cmsets: 'Import-Sets',
  templates: 'Import-Vorlagen',
  source: 'Import-Quelle',
  review: 'Import-Prüfung',
  answers: 'Import-Antworten'
};

const IMPORTE_HEADERS = ['Nr', 'Datum', 'Quelle', 'Quelle-ID', 'Tab', 'Vorlage', 'Modus', 'Status', 'Neu', 'Mehr',
  'Weniger', 'Übersprungen', 'Prüfliste offen', 'Wertänderung (EUR)', 'Zurückgenommen am', 'Bericht'];
const TERMS_HEADERS = ['Begriff', 'Bedeutung', 'Wert', 'Wo'];
const CMSETS_HEADERS = ['Cardmarket-Name', 'Kürzel', 'tcgdex-Sets', 'Herkunft'];
const TEMPLATE_HEADERS = ['Name', 'Konfiguration', 'Kopfzeilen', 'Zuletzt benutzt'];
const REVIEW_HEADERS = ['Quellzeile', 'Quellzeilen', 'Werte', 'Menge', 'Status', 'Grund', 'Kandidaten', 'Entscheidung',
  'Karte', 'Vorbelegt', 'Bestätigt'];
const ANSWER_HEADERS = ['Quelle-ID', 'Quellzeile', 'Entscheidung', 'Karte', 'Datum'];

/** Modus-Codes im Entwurf und ihre Anzeige in "Importe". */
const IMPORT_MODES = { neu: 'Nur Neues', alle: 'Alles addieren', abgleich: 'Mit Quelle abgleichen' };
/** Status in "Import-Prüfung". */
const REVIEW_STATUS = {
  open: 'offen', clear: 'eindeutig', unclear: 'unklar', notFound: 'nicht gefunden', skipped: 'übersprungen', known: 'bekannt'
};
/** Ein Lauf (Import oder Zurücknehmen) gilt nach 6 Minuten ohne Lebenszeichen als abgebrochen. */
const IMPORT_RUN_MAX_MS = 6 * 60 * 1000;

/* ---------- Modus ---------- */

function importModeCode_(x) {
  const s = String(x || '').trim();
  if (IMPORT_MODES[s]) return s;
  for (const k in IMPORT_MODES) if (IMPORT_MODES[k].toLowerCase() === s.toLowerCase()) return k;
  return 'neu';
}

function importModeLabel_(code) {
  return IMPORT_MODES[importModeCode_(code)];
}

/* ---------- Entwurf (Script-Property IMPORT_DRAFT) ---------- */

/** Aktueller Entwurf oder null. */
function importDraft_() {
  const raw = PropertiesService.getScriptProperties().getProperty('IMPORT_DRAFT');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function importSaveDraft_(draft) {
  PropertiesService.getScriptProperties().setProperty('IMPORT_DRAFT', JSON.stringify(draft));
  return draft;
}

/** Entwurf ganz verwerfen: Property, Import-Quelle, Import-Prüfung leeren, temporäre Kopie in den Papierkorb. */
function importResetDraft_() {
  const draft = importDraft_();
  if (draft && draft.tmpId) {
    try { DriveApp.getFileById(draft.tmpId).setTrashed(true); } catch (e) { /* schon weg */ }
  }
  PropertiesService.getScriptProperties().deleteProperty('IMPORT_DRAFT');
  const ss = ss_();
  [IMP_SHEETS.source, IMP_SHEETS.review].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (name === IMP_SHEETS.source) {
      if (last > 0) sh.getRange(1, 1, last, Math.max(1, sh.getLastColumn())).clearContent();
    } else if (last > 1) {
      sh.getRange(2, 1, last - 1, Math.max(REVIEW_HEADERS.length, sh.getLastColumn())).clearContent();
    }
  });
}

/* ---------- Laufender Import / laufendes Zurücknehmen (Script-Property IMPORT_RUN) ---------- */

/** {nr, phase: 'commit'|'undo'|'resume', at} solange jünger als 6 Minuten, sonst null. */
function importRunState_() {
  const raw = PropertiesService.getScriptProperties().getProperty('IMPORT_RUN');
  if (!raw) return null;
  let run;
  try { run = JSON.parse(raw); } catch (e) { return null; }
  if (!run || !run.at || (new Date().getTime() - Number(run.at)) > IMPORT_RUN_MAX_MS) return null;
  return run;
}

function importSetRun_(nr, phase) {
  PropertiesService.getScriptProperties().setProperty('IMPORT_RUN',
    JSON.stringify({ nr: nr, phase: phase, at: new Date().getTime() }));
}

function importClearRun_() {
  PropertiesService.getScriptProperties().deleteProperty('IMPORT_RUN');
}

/** Wirft, wenn gerade ein anderer Import oder ein Zurücknehmen läuft. */
function importAssertNoRun_() {
  if (importRunState_()) throw new Error('Gerade läuft schon ein Import oder Zurücknehmen. Bitte kurz warten.');
}

/* ---------- JSON-Zellen ---------- */

function jsonCell_(v) {
  if (v === null || v === undefined || v === '') return '';
  return JSON.stringify(v);
}

function parseJsonCell_(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(String(s)); } catch (e) { return fallback; }
}

function truthyCell_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v).toUpperCase() === 'WAHR';
}

/* ---------- Blatt "Import-Prüfung" ---------- */

/**
 * Alle Zeilen der Prüfung als Objekte:
 * {row (1-basiert), fp, srcRows: [], values: {} (extrahierte Felder inkl. raw), qty, status, reason,
 *  candidates: [], decision: {type, id?, lang?, variant?} | null, card: {} | null, prefilled, confirmed}
 */
function reviewRead_() {
  const sh = ss_().getSheetByName(IMP_SHEETS.review);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, REVIEW_HEADERS.length).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (r[0] === '' || r[0] === null) return;
    const dec = parseJsonCell_(r[7], null);
    out.push({
      row: i + 2,
      fp: String(r[0]),
      srcRows: parseJsonCell_(r[1], []),
      values: parseJsonCell_(r[2], {}),
      qty: Number(r[3]) || 0,
      status: String(r[4] || ''),
      reason: String(r[5] || ''),
      candidates: parseJsonCell_(r[6], []),
      decision: dec && dec.type ? dec : null,
      card: parseJsonCell_(r[8], null),
      prefilled: truthyCell_(r[9]),
      confirmed: truthyCell_(r[10])
    });
  });
  return out;
}

function reviewItemToRow_(it) {
  return [it.fp, jsonCell_(it.srcRows || []), jsonCell_(it.values || {}), Number(it.qty) || 0, it.status || '',
    it.reason || '', jsonCell_(it.candidates && it.candidates.length ? it.candidates : ''),
    jsonCell_(it.decision && it.decision.type ? it.decision : ''), jsonCell_(it.card || ''),
    it.prefilled ? true : false, it.confirmed ? true : false];
}

/** Ganze Prüfung neu schreiben (eine Schreiboperation). Innerhalb des Locks aufrufen. */
function reviewWriteAll_(items) {
  const ss = ss_();
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.review);
  if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== REVIEW_HEADERS[0]) writeHeaders_(sh, REVIEW_HEADERS);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, REVIEW_HEADERS.length).clearContent();
  if (!items.length) return;
  if (sh.getMaxRows() < items.length + 1) sh.insertRowsAfter(sh.getMaxRows(), items.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, items.length, REVIEW_HEADERS.length).setNumberFormat('@');
  sh.getRange(2, 1, items.length, REVIEW_HEADERS.length).setValues(items.map(reviewItemToRow_));
}

/** Einzelne Zeilen (mit .row aus reviewRead_) zurückschreiben. */
function reviewWriteItems_(items) {
  const sh = ss_().getSheetByName(IMP_SHEETS.review);
  if (!sh) return;
  items.forEach(function (it) {
    sh.getRange(it.row, 1, 1, REVIEW_HEADERS.length).setValues([reviewItemToRow_(it)]);
  });
}

/**
 * Was aus einem Prüfungs-Eintrag wird:
 * {kind: 'card'|'free'|'skip'|'open'|'known'|'skipRow', card}
 *  - 'card' / 'free': wird importiert (card = Karten-JSON bzw. {free:true, ...})
 *  - 'skip': von Eric übersprungen, zählt als vorhanden, fügt nichts hinzu
 *  - 'open': unklar / nicht gefunden ohne Entscheidung, zählt als vorhanden, fügt nichts hinzu ("Prüfliste offen")
 *  - 'known': Modus Nur Neues, schon vollständig importiert
 *  - 'skipRow': übersprungene Quellzeile (z. B. nicht angehakt, Menge 0)
 * Vorbelegte Entscheidungen (prefilled) gelten auch ohne Bestätigung.
 */
function reviewResolve_(it) {
  if (it.status === REVIEW_STATUS.known) return { kind: 'known', card: null };
  if (it.status === REVIEW_STATUS.skipped) return { kind: 'skipRow', card: null };
  const d = it.decision;
  if (d && d.type === 'skip') return { kind: 'skip', card: null };
  if (d && d.type === 'frei' && it.card) return { kind: 'free', card: it.card };
  if (d && d.type === 'karte' && it.card) return { kind: 'card', card: it.card };
  if (it.status === REVIEW_STATUS.clear && it.card) return { kind: it.card.free ? 'free' : 'card', card: it.card };
  return { kind: 'open', card: null };
}

/* ---------- Blatt "Import-Antworten" (Entscheidungen je Quelle und Quellzeile, überleben Zurücknehmen) ---------- */

/** {fp: {decision, card, date}} für eine Quelle. */
function answersLoad_(sourceId) {
  const sh = ss_().getSheetByName(IMP_SHEETS.answers);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, ANSWER_HEADERS.length).getValues().forEach(function (r) {
    if (String(r[0]) !== String(sourceId) || !r[1]) return;
    const dec = parseJsonCell_(r[2], null);
    if (!dec || !dec.type) return;
    out[String(r[1])] = { decision: dec, card: parseJsonCell_(r[3], null), date: cellText_(r[4]) };
  });
  return out;
}

/**
 * Antworten einfügen oder ersetzen. list = [{fp, decision ({type:''} oder null löscht), card}].
 * Innerhalb des Locks aufrufen.
 */
function answersUpsert_(sourceId, list) {
  if (!list || !list.length) return;
  const ss = ss_();
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.answers);
  if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== ANSWER_HEADERS[0]) writeHeaders_(sh, ANSWER_HEADERS);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, ANSWER_HEADERS.length).getValues() : [];
  const index = {};
  rows.forEach(function (r, i) { if (String(r[0]) === String(sourceId)) index[String(r[1])] = i; });
  const today = todayText_();
  list.forEach(function (a) {
    const del = !a.decision || !a.decision.type;
    const i = index[a.fp];
    if (del) {
      if (i !== undefined) rows[i] = null;
      return;
    }
    const row = [String(sourceId), a.fp, jsonCell_(a.decision), jsonCell_(a.card || ''), today];
    if (i !== undefined && rows[i]) rows[i] = row;
    else { index[a.fp] = rows.length; rows.push(row); }
  });
  const keep = rows.filter(Boolean);
  if (last > 1) sh.getRange(2, 1, last - 1, ANSWER_HEADERS.length).clearContent();
  if (!keep.length) return;
  if (sh.getMaxRows() < keep.length + 1) sh.insertRowsAfter(sh.getMaxRows(), keep.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, keep.length, ANSWER_HEADERS.length).setNumberFormat('@');
  sh.getRange(2, 1, keep.length, ANSWER_HEADERS.length).setValues(keep);
}

/* =========================================================================
 * 1. Quelle: Blätter, Entwurf, Datei öffnen, Tab lesen, Spalten raten, Vorlagen
 * ========================================================================= */

/** Felder, die einer Spalte (Liste) oder einer Zelle im Block (Raster) zugeordnet werden können. */
const QU_FIELDS = ['name', 'number', 'set', 'qty', 'variant', 'cond', 'lang', 'version', 'cmLink', 'tcgdexId',
  'price', 'priceDate', 'check'];

/** Überschriften-Synonyme je Feld (klein geschrieben). */
const QU_SYNONYMS = {
  name: ['name', 'kartenname', 'karte name', 'karte', 'pokémon', 'pokemon', 'card', 'card name'],
  number: ['setnummer', 'nummer', 'nr', 'nr.', 'kartennummer', 'number', 'no', '#', 'card number', 'localid'],
  set: ['set', 'setname', 'edition', 'serie', 'expansion'],
  qty: ['anzahl', 'menge', 'stück', 'stk', 'qty', 'quantity', 'count'],
  variant: ['variante', 'variant', 'holo', 'reverse'],
  cond: ['zustand', 'condition', 'cond'],
  lang: ['sprache', 'language', 'lang'],
  version: ['sonderversion', 'version'],
  cmLink: ['cardmarket', 'cardmarket link', 'link', 'url'],
  tcgdexId: ['tcgdex', 'tcgdex-id', 'karten-id', 'id'],
  price: ['preis', 'price', 'preistrend', 'trend', '30 tage preistrend', 'wert'],
  priceDate: ['datum preis', 'datum preis-daten', 'preisstand', 'preisdatum', 'datum'],
  check: ['vorhanden', 'besitze', 'habe', 'owned', 'gesammelt', 'check']
};

/** Allgemeine Wörter, die nur als ganze Überschrift zählen ("Anzahl Karten" ist keine Namensspalte). */
const QU_EXACT_ONLY = { karte: true, card: true, edition: true };
/** Synonyme, die nur als ganzes Wort zählen ("Kaufdatum" ist kein Preisdatum). */
const QU_NO_SUBSTRING = { datum: true };

/** Vorbelegung "Import-Begriffe": [Begriff, Bedeutung, Wert, Wo]. */
const QU_TERMS_SEED = [
  ['Reverse Holo', 'Variante', 'reverse', 'Name und Spalten'],
  ['Rev Holo', 'Variante', 'reverse', 'Name und Spalten'],
  ['Reverse', 'Variante', 'reverse', 'Name und Spalten'],
  ['RH', 'Variante', 'reverse', 'nur Spalten'],
  ['Rev', 'Variante', 'reverse', 'nur Spalten'],
  ['Holo', 'Variante', 'holo', 'nur Spalten'],
  ['Non Holo', 'Variante', 'normal', 'nur Spalten'],
  ['Normal', 'Variante', 'normal', 'nur Spalten'],
  ['1st Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['1. Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['Erste Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['First Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['Mint', 'Zustand', 'MT', 'Name und Spalten'],
  ['Near Mint', 'Zustand', 'NM', 'Name und Spalten'],
  ['Excellent', 'Zustand', 'EX', 'Name und Spalten'],
  ['Good', 'Zustand', 'GD', 'Name und Spalten'],
  ['Light Played', 'Zustand', 'LP', 'Name und Spalten'],
  ['Played', 'Zustand', 'PL', 'Name und Spalten'],
  ['Poor', 'Zustand', 'PO', 'Name und Spalten'],
  ['MT', 'Zustand', 'MT', 'nur Spalten'],
  ['NM', 'Zustand', 'NM', 'nur Spalten'],
  ['EX', 'Zustand', 'EX', 'nur Spalten'],
  ['GD', 'Zustand', 'GD', 'nur Spalten'],
  ['LP', 'Zustand', 'LP', 'nur Spalten'],
  ['PL', 'Zustand', 'PL', 'nur Spalten'],
  ['PO', 'Zustand', 'PO', 'nur Spalten'],
  ['Snowflake', 'Sonderversion', 'Snowflake', 'Name und Spalten'],
  ['Staff', 'Sonderversion', 'Staff', 'Name und Spalten'],
  ['Prerelease', 'Sonderversion', 'Prerelease', 'Name und Spalten'],
  ['Deutsch', 'Sprache', 'DE', 'nur Spalten'],
  ['Englisch', 'Sprache', 'EN', 'nur Spalten'],
  ['Japanisch', 'Sprache', 'JP', 'nur Spalten'],
  ['Japanese', 'Sprache', 'JP', 'nur Spalten'],
  ['English', 'Sprache', 'EN', 'nur Spalten'],
  ['German', 'Sprache', 'DE', 'nur Spalten'],
  ['JP', 'Sprache', 'JP', 'nur Spalten'],
  ['EN', 'Sprache', 'EN', 'nur Spalten'],
  ['DE', 'Sprache', 'DE', 'nur Spalten']
];

const QU_TERM_MEANINGS = ['Variante', 'Zustand', 'Sonderversion', 'Sprache', 'Ignorieren'];
const QU_TERM_SCOPES = ['Name und Spalten', 'nur Spalten'];
const QU_SAMPLE_ROWS = 25;
const QU_SAMPLE_CHARS = 60;
const QU_TMP_PREFIX = 'Pokémon-Import (temporär) ';

/* ---------- 1a. Blätter anlegen (aus einrichtung) ---------- */

/**
 * Legt alle Import-Blätter an (idempotent): "Importe", "Import-Begriffe" (vorbelegt, nur wenn leer),
 * "Import-Sets" sichtbar; "Import-Vorlagen", "Import-Quelle", "Import-Prüfung", "Import-Antworten",
 * "Import-Protokoll" versteckt. Einträge von Eric bleiben bei jedem weiteren Lauf erhalten.
 * Wird von einrichtung() außerhalb der Sperre aufgerufen und nimmt die Sperre selbst.
 */
function setupImportSheets_(ss) {
  ss = ss || ss_();
  return withLock_(function () { return quSetupSheets_(ss, false); });
}

/** Wie setupImportSheets_, aber ohne Sperre (für Aufrufe innerhalb von withLock_). onlyMissing: nur fehlende Blätter. */
function quSetupSheets_(ss, onlyMissing) {
  const created = [];
  function want(name) {
    const exists = !!ss.getSheetByName(name);
    if (!exists) created.push(name);
    return !onlyMissing || !exists;
  }
  if (want(IMP_SHEETS.imports)) quSetupImporte_(ss);
  if (want(IMP_SHEETS.terms)) quSetupTerms_(ss);
  if (want(IMP_SHEETS.cmsets)) quSetupCmSets_(ss);
  if (want(IMP_SHEETS.templates)) quSetupTextSheet_(ss, IMP_SHEETS.templates, TEMPLATE_HEADERS, [200, 400, 300, 130]);
  if (want(IMP_SHEETS.source)) quSetupSourceSheet_(ss);
  if (want(IMP_SHEETS.review)) quSetupTextSheet_(ss, IMP_SHEETS.review, REVIEW_HEADERS,
    [110, 120, 300, 60, 100, 200, 300, 200, 300, 80, 80]);
  if (want(IMP_SHEETS.answers)) quSetupTextSheet_(ss, IMP_SHEETS.answers, ANSWER_HEADERS, [160, 110, 200, 300, 100]);
  const proto = protoSheet_();
  if (!proto.isSheetHidden()) proto.hideSheet();
  return created;
}

/** Spaltenformate ab Zeile 2 (formats: ein Zahlenformat je Spalte, gleiche Nachbarn in einem Aufruf). */
function quColumnFormats_(sh, formats) {
  const rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  ensureCols_(sh, formats.length);
  let start = 0;
  for (let c = 1; c <= formats.length; c++) {
    if (c === formats.length || formats[c] !== formats[start]) {
      sh.getRange(2, start + 1, rows, c - start).setNumberFormat(formats[start]);
      start = c;
    }
  }
}

function quColumnWidths_(sh, widths) {
  widths.forEach(function (w, i) { if (w) sh.setColumnWidth(i + 1, w); });
}

/** Kopfzeile nur schreiben, wenn sie fehlt oder abweicht (Breiten/Formate bleiben sonst, wie Eric sie hat). */
function quHeaders_(sh, headers) {
  const lastCol = Math.min(Math.max(sh.getLastColumn(), 1), sh.getMaxColumns());
  const have = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const same = headers.every(function (h, i) { return have[i] === h; });
  if (!same) writeHeaders_(sh, headers);
  else sh.setFrozenRows(1);
}

function quListRule_(list, help) {
  try {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false)
      .setHelpText(help).build();
  } catch (e) {
    return null;
  }
}

function quSetupImporte_(ss) {
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.imports);
  quHeaders_(sh, IMPORTE_HEADERS);
  quColumnFormats_(sh, ['0', '@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '0', '0', EUR_FORMAT, '@', '@']);
  quColumnWidths_(sh, [45, 120, 200, 120, 130, 140, 150, 110, 55, 55, 65, 95, 105, 130, 140, 420]);
  try {
    sh.getRange(1, 4).setNote('Drive-ID der Quelldatei, damit spätere Importe derselben Datei erkannt werden.');
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    sh.protect().setDescription('Wird vom Import-Werkzeug beschrieben').setWarningOnly(true);
  } catch (e) { /* Schutz ist nur ein Hinweis */ }
  return sh;
}

function quSetupTerms_(ss) {
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.terms);
  quHeaders_(sh, TERMS_HEADERS);
  quColumnFormats_(sh, ['@', '@', '@', '@']);
  quColumnWidths_(sh, [170, 130, 130, 150]);
  // nur vorbelegen, wenn noch kein einziger Begriff drinsteht (Erics Änderungen bleiben)
  const last = sh.getLastRow();
  const hasTerms = last >= 2 && sh.getRange(2, 1, last - 1, 1).getValues().some(function (r) { return String(r[0]).trim() !== ''; });
  if (!hasTerms) {
    if (last >= 2) sh.getRange(2, 1, last - 1, TERMS_HEADERS.length).clearContent();
    const rows = QU_TERMS_SEED.map(function (r) { return r.slice(); });
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    const range = sh.getRange(2, 1, rows.length, TERMS_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues(rows);
  }
  const n = sh.getMaxRows() - 1;
  const r1 = quListRule_(QU_TERM_MEANINGS, 'Variante, Zustand, Sonderversion, Sprache oder Ignorieren');
  const r2 = quListRule_(QU_TERM_SCOPES, '„Name und Spalten“: auch im Kartennamen suchen. „nur Spalten“: nur in eigenen Spalten.');
  if (n > 0 && r1) sh.getRange(2, 2, n, 1).setDataValidation(r1);
  if (n > 0 && r2) sh.getRange(2, 4, n, 1).setDataValidation(r2);
  try {
    sh.getRange(1, 1).setNote('Wort oder Kürzel aus deiner Liste, z. B. „Rev Holo“ oder „Near Mint“. Groß- und Kleinschreibung egal.');
    sh.getRange(1, 2).setNote('Variante, Zustand, Sonderversion, Sprache oder Ignorieren (das Wort wird dann nur aus dem Namen entfernt).');
    sh.getRange(1, 3).setNote('Variante: normal, holo, reverse oder firstEdition. Zustand: MT, NM, EX, GD, LP, PL, PO. ' +
      'Sprache: DE, EN, JP … Sonderversion: der Text, der in der Sammlung erscheinen soll.');
    sh.getRange(1, 4).setNote('„Name und Spalten“: wird auch im Kartennamen erkannt und dort entfernt. „nur Spalten“: nur in eigenen Spalten wie Zustand oder Variante.');
  } catch (e) { /* Notizen sind nur Hilfe */ }
  return sh;
}

function quSetupCmSets_(ss) {
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.cmsets);
  quHeaders_(sh, CMSETS_HEADERS);
  quColumnFormats_(sh, ['@', '@', '@', '@']);
  quColumnWidths_(sh, [240, 90, 170, 80]);
  const n = sh.getMaxRows() - 1;
  const rule = quListRule_(['auto', 'Hand'], '„Hand“: wird beim Vorbelegen nie überschrieben.');
  if (n > 0 && rule) sh.getRange(2, 4, n, 1).setDataValidation(rule);
  try {
    sh.getRange(1, 1).setNote('Setname, wie er in Cardmarket-Links steht (z. B. „Unleashed“).');
    sh.getRange(1, 2).setNote('Kürzel aus Cardmarket-Links oder deiner Liste, z. B. „UL“ oder „DS“.');
    sh.getRange(1, 3).setNote('tcgdex-Set-IDs, mehrere mit Komma (dann fragt der Import nach).');
    sh.getRange(1, 4).setNote('„auto“ kommt aus „Set-Zuordnung vorbelegen“, „Hand“ hast du selbst eingetragen und bleibt immer.');
  } catch (e) { /* Notizen sind nur Hilfe */ }
  return sh;
}

/** Verstecktes Blatt mit Kopfzeile, alle Spalten als Text. */
function quSetupTextSheet_(ss, name, headers, widths) {
  const sh = getOrCreateSheet_(ss, name);
  quHeaders_(sh, headers);
  quColumnFormats_(sh, headers.map(function () { return '@'; }));
  if (widths) quColumnWidths_(sh, widths);
  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}

/** "Import-Quelle": nur die Rohwerte des Entwurf-Tabs, ohne eigene Kopfzeile, alles Text. */
function quSetupSourceSheet_(ss) {
  const sh = getOrCreateSheet_(ss, IMP_SHEETS.source);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}

/* ---------- 1b. Entwurf ---------- */

/** Entwurf speichern; ist er zu groß für eine Property, ohne Tab-Liste. */
function quSaveDraft_(draft) {
  try {
    return importSaveDraft_(draft);
  } catch (e) {
    const d = Object.assign({}, draft);
    delete d.tabs;
    return importSaveDraft_(d);
  }
}

/** Entwurf für das UI: ohne große Teile. */
function quDraftForUi_(draft) {
  if (!draft) return null;
  const out = {};
  Object.keys(draft).forEach(function (k) {
    const v = draft[k];
    if (v === undefined || typeof v === 'function') return;
    let size = 0;
    try { size = JSON.stringify(v === null ? '' : v).length; } catch (e) { return; }
    if (size <= 6000) out[k] = v;
  });
  out.modeLabel = importModeLabel_(draft.mode);
  return out;
}

/**
 * Entwurf ganz verwerfen: Property, Import-Quelle, Import-Prüfung leeren, temporäre Kopie in den Papierkorb.
 * Öffentlich (Import-Tab: "Abbrechen", "verwerfen").
 */
function importDiscardDraft() {
  ensureSchema_();
  const had = !!importDraft_();
  withLock_(function () { importResetDraft_(); });
  return { ok: true, discarded: had };
}

/* ---------- 1c. Zustand für den Import-Tab ---------- */

/**
 * {draft | null, imports: importList(), busy: null | {nr, phase}, driveService, driveVersion, templates: [{name, mode}],
 *  needsSetup}. Schlägt nie wegen fehlender Blätter oder Teile fehl.
 */
function importState() {
  ensureSchema_();
  let draft = null;
  try { draft = quDraftForUi_(importDraft_()); } catch (e) { draft = null; }
  let imports = [];
  if (typeof importList === 'function') {
    try { imports = importList() || []; } catch (e) { imports = []; }
  }
  let busy = null;
  try {
    const run = importRunState_();
    if (run) busy = { nr: run.nr == null ? null : Number(run.nr), phase: String(run.phase || '') };
  } catch (e) { busy = null; }
  let templates = [];
  try {
    templates = quTemplateList_().map(function (t) { return { name: t.name, mode: t.mode }; });
  } catch (e) { templates = []; }
  let needsSetup = false;
  try {
    const ss = ss_();
    needsSetup = [IMP_SHEETS.imports, IMP_SHEETS.terms, IMP_SHEETS.cmsets].some(function (n) { return !ss.getSheetByName(n); });
  } catch (e) { needsSetup = true; }
  return {
    draft: draft,
    imports: imports,
    busy: busy,
    driveService: typeof Drive !== 'undefined',
    driveVersion: quDriveVersion_(),
    templates: templates,
    needsSetup: needsSetup
  };
}

/** 'v3' | 'v2' | '' (kein erweiterter Dienst Drive). */
function quDriveVersion_() {
  if (typeof Drive === 'undefined' || !Drive || !Drive.Files) return '';
  return typeof Drive.Files.create === 'function' ? 'v3' : 'v2';
}

/* ---------- 1d. Quelle öffnen ---------- */

/**
 * Datei-ID aus einem Link oder einer nackten ID:
 * docs.google.com/spreadsheets/d/<id>/..., drive.google.com/file/d/<id>/..., drive.google.com/open?id=<id>, <id>.
 */
function quParseFileId_(url) {
  const s = String(url == null ? '' : url).trim();
  if (!s) throw new Error('Bitte füge den Link zu deiner Tabelle ein.');
  if (/\/spreadsheets\/d\/e\//.test(s)) {
    throw new Error('Das ist ein Veröffentlichungs-Link. Bitte nimm den normalen Link aus der Adresszeile, wenn die Datei offen ist.');
  }
  let m = s.match(/\/(?:spreadsheets|file|document)(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&#](?:id|key)=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  throw new Error('Den Link kenne ich nicht. Bitte füge den Link zu einem Google Sheet oder einer .xlsx-Datei in deinem Drive ein.');
}

/** 'sheet' (Google Sheet), 'xlsx' (Excel und andere umwandelbare Tabellen) oder ''. */
function quKindOf_(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'application/vnd.google-apps.spreadsheet') return 'sheet';
  if (m.indexOf('spreadsheetml') >= 0 || m.indexOf('ms-excel') >= 0 || m.indexOf('opendocument.spreadsheet') >= 0 ||
    m === 'text/csv') return 'xlsx';
  return '';
}

/** Wandelt eine .xlsx-Datei per Drive-API (v3 oder v2) in ein temporäres Google Sheet um. Liefert dessen ID. */
function quConvert_(id, name) {
  if (typeof Drive === 'undefined' || !Drive || !Drive.Files) {
    throw new Error('Für .xlsx-Dateien bitte im Apps-Script-Editor links unter „Dienste“ die „Drive API“ hinzufügen.');
  }
  const title = QU_TMP_PREFIX + name;
  let res;
  try {
    // supportsAllDrives: sonst meldet die Drive API für Dateien in geteilten Ablagen „File not found“
    if (typeof Drive.Files.create === 'function') {
      res = Drive.Files.copy({ name: title, mimeType: MimeType.GOOGLE_SHEETS }, id, { supportsAllDrives: true });
    } else {
      res = Drive.Files.copy({ title: title, mimeType: MimeType.GOOGLE_SHEETS }, id, { convert: true, supportsAllDrives: true });
    }
  } catch (e) {
    throw new Error('Die Datei „' + name + '“ konnte nicht in ein Google Sheet umgewandelt werden (' + e.message + ').');
  }
  if (!res || !res.id) throw new Error('Die Datei „' + name + '“ konnte nicht in ein Google Sheet umgewandelt werden.');
  return String(res.id);
}

/** Temporäre Kopie in den Papierkorb (Fehler werden ignoriert). */
function quTrash_(id) {
  if (!id) return false;
  try {
    DriveApp.getFileById(id).setTrashed(true);
    return true;
  } catch (e) {
    return false;
  }
}

/** Tabelle per ID öffnen; frisch umgewandelte Dateien sind manchmal erst nach einem Moment da. */
function quOpenById_(id) {
  let err = null;
  for (let i = 0; i < 3; i++) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      err = e;
      if (i < 2) Utilities.sleep(1000 * (i + 1));
    }
  }
  throw new Error('Die Tabelle konnte nicht geöffnet werden (' + (err && err.message) + ').');
}

function quTabsOf_(src) {
  return src.getSheets().map(function (sh) {
    let hidden = false;
    try { hidden = sh.isSheetHidden(); } catch (e) { hidden = false; }
    let ext = { rows: 0, cols: 0 };
    try { ext = quUsedExtent_(sh); } catch (e) { ext = { rows: sh.getLastRow(), cols: sh.getLastColumn() }; }
    return { name: sh.getName(), rows: ext.rows, cols: ext.cols, hidden: hidden };
  });
}

/**
 * Öffnet die Quelldatei (Link oder ID) und startet einen neuen Entwurf (ein alter wird ersetzt, seine
 * temporäre Kopie gelöscht). Google Sheet direkt, .xlsx über eine temporäre Kopie (Drive-API).
 * Liefert {sourceId, sourceName, kind: 'sheet'|'xlsx', tabs: [{name, rows, cols, hidden}]}. Entwurf: stage 'tab'.
 */
function importOpenSource(url) {
  ensureSchema_();
  importAssertNoRun_();
  let id = quParseFileId_(url);
  let name = '', mime = '', file = null;
  try {
    file = DriveApp.getFileById(id);
    name = String(file.getName() || '');
    mime = String(file.getMimeType() || '');
    if (mime === 'application/vnd.google-apps.shortcut' && typeof file.getTargetId === 'function' && file.getTargetId()) {
      // Verknüpfung im Drive: die eigentliche Datei nehmen
      id = String(file.getTargetId());
      file = DriveApp.getFileById(id);
      name = String(file.getName() || '');
      mime = String(file.getMimeType() || '');
    }
  } catch (e) {
    file = null;
  }
  let kind, src = null, tmpId = '';
  if (!file) {
    // ohne Drive-Zugriff klappt wenigstens ein Google Sheet
    try { src = SpreadsheetApp.openById(id); } catch (e) { src = null; }
    if (!src) throw new Error('Die Datei wurde nicht gefunden, oder du hast keinen Zugriff darauf. Bitte prüfe den Link.');
    kind = 'sheet';
    name = src.getName();
  } else {
    kind = quKindOf_(mime);
    if (!kind) {
      throw new Error('„' + name + '“ ist kein Google Sheet und keine .xlsx-Datei. Bitte wähle eine Tabelle aus.');
    }
  }
  let tabs;
  try {
    if (!src) {
      if (kind === 'sheet') {
        src = quOpenById_(id);
      } else {
        tmpId = quConvert_(id, name);
        src = quOpenById_(tmpId);
      }
    }
    tabs = quTabsOf_(src);
    if (!tabs.length) throw new Error('Die Datei „' + name + '“ hat keine Tabs.');
  } catch (e) {
    quTrash_(tmpId);
    throw e;
  }
  const s = String(url == null ? '' : url).trim();
  const draft = {
    sourceId: id,
    sourceName: name,
    sourceUrl: /^https?:\/\//i.test(s) ? s : (kind === 'sheet'
      ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : 'https://drive.google.com/file/d/' + id + '/view'),
    kind: kind,
    tmpId: tmpId,
    tab: '',
    tabs: tabs.slice(0, 100),
    cfg: null,
    templateName: '',
    mode: 'neu',
    stage: 'tab',
    recognizePos: 0,
    total: 0,
    startedAt: todayText_()
  };
  try {
    withLock_(function () {
      quSetupSheets_(ss_(), true);
      importResetDraft_(); // alter Entwurf: Property, Import-Quelle, Import-Prüfung, alte temporäre Kopie
      quSaveDraft_(draft);
    });
  } catch (e) {
    quTrash_(tmpId);
    throw e;
  }
  return { sourceId: id, sourceName: name, kind: kind, tabs: tabs };
}

/* ---------- 1e. Tab lesen ---------- */

/** Links einer Zelle: ganzer Link, Links einzelner Abschnitte, HYPERLINK-Formel. */
function quCellLinks_(rt, formula) {
  const links = [];
  // nur Links nach außen (http/https): interne Links („#gid=…&range=A5“ auf einen anderen Tab) und
  // „mailto:“ würden sonst an Name oder Nummer hängen und die Erkennung stören
  function add(u) {
    u = String(u == null ? '' : u).trim();
    if (u && /^https?:\/\//i.test(u) && links.indexOf(u) < 0) links.push(u);
  }
  if (rt) {
    try { add(rt.getLinkUrl()); } catch (e) { /* kein Link */ }
    try {
      const runs = typeof rt.getRuns === 'function' ? rt.getRuns() : [];
      (runs || []).forEach(function (run) {
        try { add(run.getLinkUrl()); } catch (e) { /* kein Link */ }
      });
    } catch (e) { /* keine Abschnitte */ }
  }
  if (formula) {
    const m = String(formula).match(/^=\s*HYPERLINK\(\s*"([^"]+)"/i);
    if (m) add(m[1]);
  }
  return links;
}

/** Text der Zelle plus jeden Link, der nicht schon im Text steht (je einmal, mit Leerzeichen getrennt). */
function quWithLinks_(text, links) {
  let t = String(text == null ? '' : text);
  links.forEach(function (u) {
    if (!u || t.trim() === u || t.indexOf(u) >= 0) return;
    t = t.trim() ? t + ' ' + u : u;
  });
  return t;
}

/** Leere Zeilen und Spalten am Ende abschneiden (nur Leerzeichen zählt als leer). Liefert neue Arrays. */
function quTrimValues_(values) {
  const rows = (values || []).map(function (r) {
    return (r || []).map(function (v) { return v == null ? '' : String(v); });
  });
  while (rows.length && rows[rows.length - 1].every(function (v) { return v.trim() === ''; })) rows.pop();
  let width = 0;
  rows.forEach(function (r) {
    for (let j = r.length - 1; j >= width; j--) {
      if (r[j].trim() !== '') { width = j + 1; break; }
    }
  });
  return rows.map(function (r) {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
}

/** Ab so vielen Zellen wird der benutzte Bereich eines Tabs erst abgetastet statt ganz gelesen. */
const QU_SCAN_CELLS = 100000;
/** So viele leere Zeilen am Stück nach der letzten Zeile mit Inhalt beenden das Abtasten. */
const QU_SCAN_GAP = 5000;

/** true, wenn die Zelle echten Inhalt hat (leerer Text und nicht angehakte Kästchen zählen nicht). */
function quRealCell_(v) {
  if (v === '' || v == null || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * Bereich eines Tabs, in dem wirklich etwas steht: {rows, cols}. Aus .xlsx umgewandelte Tabs melden oft
 * 1048576 Zeilen (Kästchen oder Formeln bis ganz unten); alles zu lesen sprengt den Speicher. Große Tabs
 * werden darum stückweise abgetastet; nach QU_SCAN_GAP leeren Zeilen am Stück ist Schluss.
 */
function quUsedExtent_(sheet) {
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (!lr || !lc) return { rows: 0, cols: 0 };
  if (lr * lc <= QU_SCAN_CELLS) return { rows: lr, cols: lc };
  const chunk = Math.max(50, Math.floor(QU_SCAN_CELLS / lc));
  let lastRow = 0, lastCol = 0;
  for (let start = 1; start <= lr; start += chunk) {
    const n = Math.min(chunk, lr - start + 1);
    const vals = sheet.getRange(start, 1, n, lc).getValues();
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      for (let j = r.length - 1; j >= 0; j--) {
        if (quRealCell_(r[j])) {
          lastRow = start + i;
          if (j + 1 > lastCol) lastCol = j + 1;
          break;
        }
      }
    }
    if (start + n - 1 - lastRow >= QU_SCAN_GAP) break;
  }
  return { rows: lastRow, cols: lastCol };
}

/** Anzeigewerte eines Tabs mit angehängten Links, Ränder abgeschnitten. */
function quReadTab_(sheet) {
  const ext = quUsedExtent_(sheet);
  if (!ext.rows || !ext.cols) return [];
  const range = sheet.getRange(1, 1, ext.rows, ext.cols);
  const shown = range.getDisplayValues();
  let rich = null, formulas = null;
  try { rich = range.getRichTextValues(); } catch (e) { rich = null; }
  try { formulas = range.getFormulas(); } catch (e) { formulas = null; }
  const vals = shown.map(function (row, i) {
    return row.map(function (v, j) {
      const rt = rich && rich[i] ? rich[i][j] : null;
      const f = formulas && formulas[i] ? formulas[i][j] : '';
      const links = quCellLinks_(rt, f);
      return links.length ? quWithLinks_(v, links) : String(v == null ? '' : v);
    });
  });
  return quTrimValues_(vals);
}

/** Inhalt von "Import-Quelle" als Text (Ränder abgeschnitten); [] wenn leer oder nicht da. */
function quSourceValues_() {
  const sh = ss_().getSheetByName(IMP_SHEETS.source);
  if (!sh) return [];
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (!lr || !lc) return [];
  return quTrimValues_(sh.getRange(1, 1, lr, lc).getDisplayValues());
}

/** "Import-Quelle" leeren und mit values füllen (eine Schreiboperation). Innerhalb der Sperre. */
function quWriteSource_(values) {
  const ss = ss_();
  const sh = ss.getSheetByName(IMP_SHEETS.source) || quSetupSourceSheet_(ss);
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr && lc) sh.getRange(1, 1, lr, lc).clearContent();
  if (!values.length || !values[0].length) return;
  const n = values.length, m = values[0].length;
  if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows());
  ensureCols_(sh, m);
  const range = sh.getRange(1, 1, n, m);
  range.setNumberFormat('@');
  range.setValues(values);
}

function quSample_(values, nCols) {
  return values.slice(0, QU_SAMPLE_ROWS).map(function (r) {
    const out = [];
    for (let j = 0; j < nCols; j++) {
      const s = String(r[j] == null ? '' : r[j]);
      out.push(s.length > QU_SAMPLE_CHARS ? s.slice(0, QU_SAMPLE_CHARS - 1) + '…' : s);
    }
    return out;
  });
}

/**
 * Liest den Tab der Quelle (Anzeigewerte, Links angehängt) nach "Import-Quelle" und löscht danach die
 * temporäre Kopie. Liefert {tab, nRows, nCols, sample (25 Zeilen, Zellen max. 60 Zeichen), guess,
 * templates: [{name, matches, mode, cfg, lastUsed}], suggested: name | null, cfg (Vorschlag)}. Entwurf: stage 'zuordnung'.
 */
function importSelectTab(tab) {
  ensureSchema_();
  const draft = importDraft_();
  if (!draft || !draft.sourceId) throw new Error('Gerade ist kein Import offen. Bitte starte mit „Neuer Import“.');
  tab = String(tab == null ? '' : tab);
  if (!tab) throw new Error('Bitte wähle einen Tab aus.');
  let values = null, newTmp = '', tmpToTrash = draft.tmpId || '';
  if (draft.kind === 'xlsx' && !draft.tmpId && draft.tab === tab) {
    // Kopie schon gelöscht, derselbe Tab: die Werte stehen noch in "Import-Quelle"
    values = quSourceValues_();
    if (!values.length) values = null;
  }
  if (!values) {
    let src = null;
    try {
      if (draft.kind === 'sheet') {
        src = quOpenById_(draft.sourceId);
      } else {
        if (draft.tmpId) {
          try { src = SpreadsheetApp.openById(draft.tmpId); } catch (e) { src = null; }
        }
        if (!src) {
          newTmp = quConvert_(draft.sourceId, draft.sourceName || draft.sourceId);
          src = quOpenById_(newTmp);
        }
      }
      const sheet = src.getSheetByName(tab);
      if (!sheet) throw new Error('Den Tab „' + tab + '“ gibt es in „' + (draft.sourceName || 'der Datei') + '“ nicht.');
      values = quReadTab_(sheet);
      if (!values.length) throw new Error('Der Tab „' + tab + '“ ist leer. Bitte wähle einen anderen Tab.');
    } catch (e) {
      quTrash_(newTmp); // die alte Kopie bleibt für einen anderen Tab
      throw e;
    }
  }
  const nRows = values.length, nCols = values[0].length;
  const guess = guessLayout_(values);
  const sameTab = draft.tab === tab;
  withLock_(function () {
    quSetupSheets_(ss_(), true);
    quWriteSource_(values);
    const cur = importDraft_() || draft;
    if (cur.stage !== 'tab' && cur.stage !== 'zuordnung') {
      // zurück in den Assistenten: alte Erkennung gilt nicht mehr (Antworten bleiben in "Import-Antworten")
      reviewWriteAll_([]);
    }
    cur.tab = tab;
    cur.tmpId = '';
    cur.stage = 'zuordnung';
    cur.recognizePos = 0;
    cur.total = 0;
    if (!sameTab) cur.cfg = null;
    quSaveDraft_(cur);
  });
  quTrash_(tmpToTrash);
  quTrash_(newTmp);
  const tpls = quTemplateList_();
  const templates = tpls.map(function (t) {
    return {
      name: t.name, mode: t.mode, cfg: t.cfg, lastUsed: t.lastUsed,
      matches: !!t.signature && t.signature === quHeaderSig_(values, t.cfg.headerRow)
    };
  });
  let suggested = null;
  for (let i = 0; i < templates.length; i++) {
    if (templates[i].matches) { suggested = templates[i].name; break; }
  }
  let cfg;
  if (suggested) cfg = templates.filter(function (t) { return t.name === suggested; })[0].cfg;
  else if (sameTab && draft.cfg) cfg = quNormCfg_(draft.cfg);
  else cfg = quDefaultCfg_(guess);
  return {
    tab: tab, nRows: nRows, nCols: nCols, sample: quSample_(values, nCols), guess: guess,
    templates: templates, suggested: suggested, cfg: cfg
  };
}

/* ---------- 1f. Spalten raten ---------- */

/** Überschrift vergleichbar machen: klein, Leerzeichen zusammengefasst, Satzzeichen am Rand weg. */
function quNormHeader_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s:?!*]+|[\s:?!*]+$/g, '');
}

function quSquashHeader_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s\-._:()\/?!*]+/g, '');
}

function quWords_(s) {
  return String(s == null ? '' : s).toLowerCase().split(/[^a-z0-9äöüßéèáàëï#]+/).filter(Boolean);
}

/** Zahl oder Preis/Datum aus Ziffern ("12", "1,50 €", "15.10.2026") zählt nicht als Überschrift. */
function quIsNumberish_(s) {
  const t = String(s == null ? '' : s).replace(/[€$%\s]/g, '').replace(/eur$/i, '');
  return t !== '' && /^[-+]?[\d.,\/]+$/.test(t);
}

/**
 * Bewertung einer Überschrift für ein Feld: 1000 + Länge (genau), 500 + Länge (ganzes Wort / Wortfolge),
 * 100 + Länge (Teilwort ab 5 Zeichen), 0 = passt nicht.
 */
function quHeaderScore_(header, field) {
  const hn = quNormHeader_(header);
  if (!hn) return 0;
  const hs = quSquashHeader_(hn);
  const hw = quWords_(hn);
  let best = 0;
  QU_SYNONYMS[field].forEach(function (syn) {
    let sc = 0;
    if (hn === syn || hs === quSquashHeader_(syn)) {
      sc = 1000 + syn.length;
    } else if (!QU_EXACT_ONLY[syn]) {
      const sw = quWords_(syn);
      let word = false;
      if (sw.length) {
        for (let i = 0; i + sw.length <= hw.length && !word; i++) {
          word = sw.every(function (w, k) { return hw[i + k] === w; });
        }
      } else if (syn === '#') {
        word = /(^|\s)#(\s|$)/.test(hn);
      }
      if (word) sc = 500 + syn.length;
      else if (syn.length >= 5 && !QU_NO_SUBSTRING[syn] &&
        (hn.indexOf(syn) >= 0 || hs.indexOf(quSquashHeader_(syn)) >= 0)) sc = 100 + syn.length;
    }
    if (sc > best) best = sc;
  });
  return best;
}

/** Bestes Feld einer Überschrift: {field, score} oder null (nichts oder unentschieden). */
function quBestField_(header) {
  const scores = {};
  QU_FIELDS.forEach(function (f) {
    const s = quHeaderScore_(header, f);
    if (s > 0) scores[f] = s;
  });
  // unscharfe Treffer: "Set Nr" ist eine Nummer, "Preistrend Datum" ein Preisdatum, "Pokémon-Nr." keine Namensspalte
  if (scores.number && scores.set && scores.number < 1000 && scores.set < 1000) delete scores.set;
  if (scores.priceDate && scores.price && scores.priceDate < 1000 && scores.price < 1000) delete scores.price;
  if (scores.name && scores.name < 1000 && Object.keys(scores).length > 1) delete scores.name;
  let best = null, tie = false;
  Object.keys(scores).forEach(function (f) {
    if (!best || scores[f] > best.score) { best = { field: f, score: scores[f] }; tie = false; }
    else if (scores[f] === best.score) tie = true;
  });
  return best && !tie ? best : null;
}

function quEmptyCols_() {
  const cols = {};
  QU_FIELDS.forEach(function (f) { cols[f] = -1; });
  return cols;
}

/** Sieht die Zelle wie eine tcgdex-ID aus ("swsh3-136", "sv03.5-025", "base1-4")? */
function quLooksLikeTcgdexId_(s) {
  return /^[a-z][a-z0-9.]*-[a-z0-9]+$/i.test(String(s || '').trim());
}

/**
 * Rät Kopfzeile, erste Datenzeile und Spalten. values: 2D-Text (wie "Import-Quelle").
 * -> {headerRow, firstRow (1-basiert, 0 = keine), cols: {name, number, set, qty, variant, cond, lang, version, cmLink,
 *    tcgdexId, price, priceDate, check} (0-basiert, -1 = keine)}.
 */
function guessLayout_(values) {
  values = (values || []).map(function (r) { return (r || []).map(function (v) { return v == null ? '' : String(v); }); });
  const nRows = values.length;
  let nCols = 0;
  values.forEach(function (r) { nCols = Math.max(nCols, r.length); });
  const cols = quEmptyCols_();
  const nonEmpty = function (r) { return (values[r - 1] || []).some(function (v) { return v.trim() !== ''; }); };

  // Kopfzeile: erste der ersten 10 Zeilen mit >= 2 nicht leeren, nicht numerischen Zellen. Erkennt man in ihr
  // weniger als zwei verschiedene Felder (z. B. Titel und Untertitel oben), gewinnt eine spätere mit mindestens zwei.
  let headerRow = 0;
  for (let r = 1; r <= Math.min(10, nRows); r++) {
    const cells = values[r - 1].filter(function (v) { return v.trim() !== '' && !quIsNumberish_(v); });
    if (cells.length < 2) continue;
    const fields = {};
    cells.forEach(function (v) { const bf = quBestField_(v); if (bf && bf.score >= 500) fields[bf.field] = true; });
    const known = Object.keys(fields).length;
    if (!headerRow) { headerRow = r; if (known >= 2) break; continue; }
    if (known >= 2) { headerRow = r; break; }
  }
  let firstRow = 0;
  for (let r = headerRow + 1; r <= nRows; r++) {
    if (nonEmpty(r)) { firstRow = r; break; }
  }
  if (!firstRow) firstRow = headerRow ? headerRow + 1 : 1;

  // Spalten nach Überschrift: je Feld die Spalte mit der besten Bewertung (gleich gut: die linke)
  const byField = {};
  if (headerRow) {
    const head = values[headerRow - 1];
    for (let c = 0; c < head.length; c++) {
      const b = quBestField_(head[c]);
      if (!b) continue;
      if (!byField[b.field] || b.score > byField[b.field].score) byField[b.field] = { col: c, score: b.score };
    }
  }
  Object.keys(byField).forEach(function (f) { cols[f] = byField[f].col; });

  // Datenzellen für Inhaltsprüfungen: die ersten 30 Datenzeilen
  const dataRows = [];
  for (let r = firstRow; r <= nRows && dataRows.length < 30; r++) if (r !== headerRow) dataRows.push(values[r - 1] || []);
  const ratio = function (c, test) {
    if (!dataRows.length) return 0;
    return dataRows.filter(function (row) { return test(String(row[c] == null ? '' : row[c])); }).length / dataRows.length;
  };

  // "ID" nur, wenn die Zellen wie tcgdex-IDs aussehen
  if (cols.tcgdexId >= 0 && headerRow && dataRows.length && quNormHeader_(values[headerRow - 1][cols.tcgdexId]) === 'id') {
    const filled = dataRows.filter(function (row) { return String(row[cols.tcgdexId] || '').trim() !== ''; });
    const good = filled.filter(function (row) { return quLooksLikeTcgdexId_(row[cols.tcgdexId]); });
    if (filled.length && good.length / filled.length < 0.5) cols.tcgdexId = -1;
  }

  // Cardmarket-Link nach Inhalt: >= 30 % der ersten 30 Datenzellen enthalten cardmarket.com.
  // Ausnahme: verlinkte Namen (Text plus angehängter Link) behalten ihr Feld; die Erkennung holt den Link
  // dann aus dieser Zelle.
  const isCm = function (s) { return s.toLowerCase().indexOf('cardmarket.com') >= 0; };
  const hasText = function (s) { return s.replace(/https?:\/\/\S+/gi, '').trim() !== ''; };
  const ownField = function (c) {
    return QU_FIELDS.some(function (f) { return f !== 'cmLink' && cols[f] === c; });
  };
  let bestCol = -1, bestRatio = 0;
  for (let c = 0; c < nCols; c++) {
    const q = ratio(c, isCm);
    if (q < 0.3 || q <= bestRatio) continue;
    if (ownField(c) && ratio(c, function (s) { return isCm(s) && hasText(s); }) >= q / 2) continue;
    bestCol = c;
    bestRatio = q;
  }
  if (bestCol >= 0 && (cols.cmLink < 0 || ratio(cols.cmLink, isCm) < 0.3)) {
    QU_FIELDS.forEach(function (f) { if (f !== 'cmLink' && cols[f] === bestCol) cols[f] = -1; });
    cols.cmLink = bestCol;
  }
  return { headerRow: headerRow, firstRow: firstRow, cols: cols };
}

/* ---------- 1g. Einstellungen (cfg) ---------- */

/** Spalte als 0-basierter Index aus Zahl, Zahltext oder Buchstaben ("C" -> 2); sonst -1. */
function quColIndex_(x) {
  if (x === null || x === undefined || x === '') return -1;
  if (typeof x === 'number') return isFinite(x) && x >= 0 ? Math.floor(x) : -1;
  const s = String(x).trim();
  if (/^-?\d+$/.test(s)) { const n = parseInt(s, 10); return n >= 0 ? n : -1; }
  if (/^[A-Za-z]{1,3}$/.test(s)) {
    return s.toUpperCase().split('').reduce(function (n, ch) { return n * 26 + ch.charCodeAt(0) - 64; }, 0) - 1;
  }
  return -1;
}

function quInt_(x, def, min) {
  const n = parseInt(x, 10);
  if (!isFinite(n)) return def;
  return Math.max(min, n);
}

function quCellPos_(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const r = parseInt(p[0], 10), c = quColIndex_(p[1]);
  if (!isFinite(r) || r < 0 || c < 0) return null;
  return [r, c];
}

/** Standard-Einstellungen aus einem guess (guessLayout_). */
function quDefaultCfg_(guess) {
  guess = guess || { headerRow: 1, firstRow: 2, cols: quEmptyCols_() };
  const cols = Object.assign(quEmptyCols_(), guess.cols || {});
  return quNormCfg_({
    form: cols.check >= 0 ? 'checkliste' : 'liste',
    headerRow: guess.headerRow,
    firstRow: guess.firstRow,
    lastRow: 0,
    cols: cols,
    fixed: { lang: 'DE', cond: '', variant: '', version: '' },
    extras: [],
    grid: {
      startRow: guess.headerRow ? guess.headerRow + 1 : 1, startCol: 0, blockRows: 2, blockCols: 1,
      gapRows: 0, gapCols: 0, perRow: 0, cells: { name: [0, 0], number: [1, 0] }
    }
  });
}

/**
 * cfg in Normalform: {form: 'liste'|'checkliste'|'raster', headerRow (0 = keine), firstRow (1-basiert),
 *  lastRow (0 = bis Datenende), cols: {feld: Spalte 0-basiert | -1}, fixed: {lang, cond, variant, version},
 *  extras: [{col, name, show, cell?}], grid: {startRow (1-basiert), startCol (0-basiert), blockRows, blockCols,
 *  gapRows, gapCols, perRow (0 = bis leer), cells: {feld: [zeile, spalte] im Block, 0-basiert}}}.
 */
function quNormCfg_(cfg) {
  cfg = cfg || {};
  const form = ['liste', 'checkliste', 'raster'].indexOf(cfg.form) >= 0 ? cfg.form : 'liste';
  const headerRow = cfg.headerRow === undefined || cfg.headerRow === null || cfg.headerRow === '' ? 1 : quInt_(cfg.headerRow, 1, 0);
  let firstRow = quInt_(cfg.firstRow, 0, 0);
  if (!firstRow) firstRow = headerRow + 1;
  const lastRow = quInt_(cfg.lastRow, 0, 0);
  const cols = quEmptyCols_();
  const inCols = cfg.cols || {};
  QU_FIELDS.forEach(function (f) { cols[f] = quColIndex_(inCols[f]); });
  const fx = cfg.fixed || {};
  const fixedLang = String(fx.lang == null ? '' : fx.lang).trim();
  const variants = ['normal', 'holo', 'reverse', 'firstEdition'];
  const fixed = {
    lang: fixedLang ? langCode_(fixedLang) : '',
    cond: condCode_(fx.cond) || '',
    variant: variants.indexOf(String(fx.variant || '').trim()) >= 0 ? String(fx.variant).trim() : '',
    version: versionText_(fx.version)
  };
  const seen = {};
  const extras = [];
  (Array.isArray(cfg.extras) ? cfg.extras : []).forEach(function (x) {
    if (!x) return;
    const name = String(x.name == null ? '' : x.name).replace(/\s+/g, ' ').trim();
    const col = quColIndex_(x.col);
    const cell = quCellPos_(x.cell);
    if (!name || seen[name.toLowerCase()] || (col < 0 && !cell)) return;
    seen[name.toLowerCase()] = true;
    const e = { col: col, name: name, show: x.show === true || x.show === 'true' };
    if (cell) e.cell = cell;
    extras.push(e);
  });
  const g = cfg.grid || {};
  const cells = {};
  if (g.cells && typeof g.cells === 'object') {
    QU_FIELDS.forEach(function (f) { const p = quCellPos_(g.cells[f]); if (p) cells[f] = p; });
  } else {
    cells.name = [0, 0];
    cells.number = [1, 0];
  }
  const startCol = quColIndex_(g.startCol);
  const grid = {
    startRow: quInt_(g.startRow, headerRow ? headerRow + 1 : 1, 1),
    startCol: startCol >= 0 ? startCol : 0,
    blockRows: quInt_(g.blockRows, 2, 1),
    blockCols: quInt_(g.blockCols, 1, 1),
    gapRows: quInt_(g.gapRows, 0, 0),
    gapCols: quInt_(g.gapCols, 0, 0),
    perRow: quInt_(g.perRow, 0, 0),
    cells: cells
  };
  return { form: form, headerRow: headerRow, firstRow: firstRow, lastRow: lastRow, cols: cols, fixed: fixed, extras: extras, grid: grid };
}

/* ---------- 1h. Datensätze aus "Import-Quelle" ---------- */

/**
 * Rohe Datensätze: [{srcRows: [Zeile 1-basiert] | ['r5c3'] (Raster: Block oben links, 1-basiert),
 *  raw: {feld: Text} (alle Felder, nicht zugeordnete ''), extrasRaw: {name: Text}, first: erste nicht leere zugeordnete Zelle}].
 */
function parseSourceRecords_(cfg) {
  cfg = quNormCfg_(cfg);
  const values = quSourceValues_();
  if (!values.length) return [];
  return cfg.form === 'raster' ? quGridRecords_(values, cfg) : quListRecords_(values, cfg);
}

function quCell_(values, r, c) {
  const row = values[r - 1];
  if (!row || c < 0) return '';
  const v = row[c];
  return v == null ? '' : String(v);
}

function quListRecords_(values, cfg) {
  const out = [];
  const last = cfg.lastRow > 0 ? Math.min(cfg.lastRow, values.length) : values.length;
  const mapped = QU_FIELDS.filter(function (f) { return cfg.cols[f] >= 0; })
    .map(function (f) { return cfg.cols[f]; }).sort(function (a, b) { return a - b; });
  const extras = cfg.extras.filter(function (x) { return x.col >= 0; });
  for (let r = Math.max(1, cfg.firstRow); r <= last; r++) {
    if (r === cfg.headerRow) continue;
    const raw = {};
    QU_FIELDS.forEach(function (f) { raw[f] = quCell_(values, r, cfg.cols[f]); });
    const extrasRaw = {};
    extras.forEach(function (x) { extrasRaw[x.name] = quCell_(values, r, x.col); });
    let first = '';
    for (let i = 0; i < mapped.length && !first; i++) first = quCell_(values, r, mapped[i]).trim();
    out.push({ srcRows: [r], raw: raw, extrasRaw: extrasRaw, first: first });
  }
  return out;
}

/**
 * Raster: Block (bi, bj) beginnt in Zeile startRow + bi*(blockRows+gapRows), Spalte startCol + bj*(blockCols+gapCols).
 * Blöcke ohne Name und Nummer (bzw. Link/ID) werden übersprungen. Eine Blockzeile endet bei perRow Blöcken oder
 * (perRow 0) nach 3 leeren Blöcken in Folge; Schluss nach 3 leeren Blockzeilen in Folge.
 */
function quGridRecords_(values, cfg) {
  const g = cfg.grid;
  const out = [];
  let nCols = 0;
  values.forEach(function (r) { nCols = Math.max(nCols, r.length); });
  const last = cfg.lastRow > 0 ? Math.min(cfg.lastRow, values.length) : values.length;
  const stepR = g.blockRows + g.gapRows, stepC = g.blockCols + g.gapCols;
  const fields = QU_FIELDS.filter(function (f) { return !!g.cells[f]; });
  let ident = ['name', 'number', 'cmLink', 'tcgdexId'].filter(function (f) { return !!g.cells[f]; });
  if (!ident.length) ident = fields;
  const extras = cfg.extras.filter(function (x) { return !!x.cell; });
  const at = function (r, c) { return r > last ? '' : quCell_(values, r, c); };
  let emptyRows = 0;
  for (let bi = 0; ; bi++) {
    const r0 = g.startRow + bi * stepR;
    if (r0 > last) break;
    let found = 0, emptyRun = 0;
    for (let bj = 0; ; bj++) {
      if (g.perRow > 0 && bj >= g.perRow) break;
      const c0 = g.startCol + bj * stepC;
      if (c0 >= nCols) break;
      const raw = {};
      QU_FIELDS.forEach(function (f) {
        const p = g.cells[f];
        raw[f] = p ? at(r0 + p[0], c0 + p[1]) : '';
      });
      const empty = !ident.length || ident.every(function (f) { return raw[f].trim() === ''; });
      if (empty) {
        emptyRun++;
        if (g.perRow === 0 && emptyRun >= 3) break;
        continue;
      }
      emptyRun = 0;
      found++;
      const extrasRaw = {};
      extras.forEach(function (x) { extrasRaw[x.name] = at(r0 + x.cell[0], c0 + x.cell[1]); });
      let first = '';
      for (let i = 0; i < fields.length && !first; i++) first = raw[fields[i]].trim();
      out.push({ srcRows: ['r' + r0 + 'c' + (c0 + 1)], raw: raw, extrasRaw: extrasRaw, first: first });
    }
    if (found) emptyRows = 0;
    else if (++emptyRows >= 3) break;
  }
  return out;
}

/**
 * Vorschau der ersten zehn Datensätze (auch übersprungene) mit den erkannten Feldern.
 * -> {rows: [{srcRows, fields, extras, skip}], total, importable, skippedCounts: {summe, leer, nichtAngehakt}}
 */
function importPreviewRows(cfg) {
  ensureSchema_();
  const c = quNormCfg_(cfg);
  if (!quSourceValues_().length) throw new Error('Es sind noch keine Daten geladen. Bitte wähle zuerst einen Tab.');
  const records = parseSourceRecords_(c);
  const terms = loadTerms_();
  const skippedCounts = { summe: 0, leer: 0, nichtAngehakt: 0 };
  const rows = [];
  records.forEach(function (rec) {
    const f = extractRow_(rec, c, terms) || {};
    const skip = f.skip || null;
    if (skip) skippedCounts[skip] = (skippedCounts[skip] || 0) + 1;
    if (rows.length < 10) rows.push({ srcRows: rec.srcRows, fields: f, extras: f.extras || rec.extrasRaw || {}, skip: skip });
  });
  const skipped = Object.keys(skippedCounts).reduce(function (s, k) { return s + skippedCounts[k]; }, 0);
  // Einstellungen im Entwurf merken (zum Weitermachen); nur solange der Assistent läuft
  try {
    const d0 = importDraft_();
    if (d0 && (d0.stage === 'tab' || d0.stage === 'zuordnung')) {
      withLock_(function () {
        const d = importDraft_();
        if (d && (d.stage === 'tab' || d.stage === 'zuordnung')) {
          d.cfg = c;
          quSaveDraft_(d);
        }
      });
    }
  } catch (e) { /* nur Komfort */ }
  return { rows: rows, total: records.length, importable: records.length - skipped, skippedCounts: skippedCounts };
}

/* ---------- 1i. Vorlagen ("Import-Vorlagen") ---------- */

/** Signatur der Kopfzeile: normalisierte Zellen mit '|' verbunden (headerRow 0: erste nicht leere Zeile). */
function quHeaderSig_(values, headerRow) {
  let row = null;
  const hr = Number(headerRow) || 0;
  if (hr > 0) row = values[hr - 1] || null;
  else {
    for (let i = 0; i < values.length && !row; i++) {
      if (values[i].some(function (v) { return String(v).trim() !== ''; })) row = values[i];
    }
  }
  if (!row) return '';
  const cells = row.map(quNormHeader_);
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return cells.join('|');
}

/** Alle Vorlagen: [{row, name, cfg, mode, signature, lastUsed}] in Blattreihenfolge. */
function quTemplateRows_() {
  const sh = ss_().getSheetByName(IMP_SHEETS.templates);
  if (!sh || sh.getLastRow() < 2) return [];
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, TEMPLATE_HEADERS.length).getValues().forEach(function (r, i) {
    const name = String(r[0] == null ? '' : r[0]).trim();
    if (!name) return;
    const raw = parseJsonCell_(r[1], {}) || {};
    out.push({
      row: i + 2, name: name, cfg: quNormCfg_(raw), mode: importModeCode_(raw.mode),
      signature: String(r[2] == null ? '' : r[2]), lastUsed: cellText_(r[3])
    });
  });
  return out;
}

/** Vorlagen fürs UI, zuletzt benutzte zuerst. */
function quTemplateList_() {
  return quTemplateRows_().sort(function (a, b) {
    if (a.lastUsed !== b.lastUsed) return a.lastUsed < b.lastUsed ? 1 : -1;
    return a.name.localeCompare(b.name, 'de');
  }).map(function (t) {
    return { name: t.name, mode: t.mode, modeLabel: importModeLabel_(t.mode), cfg: t.cfg, signature: t.signature, lastUsed: t.lastUsed };
  });
}

/** [{name, mode, modeLabel, cfg, signature, lastUsed ('yyyy-MM-dd HH:mm')}], zuletzt benutzte zuerst. */
function importListTemplates() {
  ensureSchema_();
  return quTemplateList_();
}

/**
 * Vorlage speichern oder ersetzen (gleicher Name, Groß/klein egal). Merkt Modus, Kopfzeilen-Signatur des
 * aktuellen Tabs und "Zuletzt benutzt". -> {name, mode, signature, templates}
 */
function importSaveTemplate(name, cfg, mode) {
  ensureSchema_();
  name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Bitte gib der Vorlage einen Namen.');
  if (name.length > 80) throw new Error('Der Name der Vorlage ist zu lang (höchstens 80 Zeichen).');
  const c = quNormCfg_(cfg);
  const m = importModeCode_(mode);
  const values = quSourceValues_();
  const sig = values.length ? quHeaderSig_(values, c.headerRow) : '';
  const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
  let saved = sig;
  withLock_(function () {
    const ss = ss_();
    const sh = ss.getSheetByName(IMP_SHEETS.templates) ||
      quSetupTextSheet_(ss, IMP_SHEETS.templates, TEMPLATE_HEADERS, [200, 400, 300, 130]);
    const old = quTemplateRows_().filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
    if (!sig && old) saved = old.signature; // ohne geladenen Tab die alte Signatur behalten
    const row = [name, JSON.stringify(Object.assign({}, c, { mode: m })), saved, now];
    const at = old ? old.row : Math.max(2, sh.getLastRow() + 1);
    if (at > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), at - sh.getMaxRows());
    const range = sh.getRange(at, 1, 1, TEMPLATE_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues([row]);
    const d = importDraft_();
    if (d) {
      d.templateName = name;
      d.mode = m;
      if (d.stage === 'tab' || d.stage === 'zuordnung') d.cfg = c;
      quSaveDraft_(d);
    }
  });
  return { name: name, mode: m, signature: saved, templates: quTemplateList_() };
}

/** Vorlage löschen. -> {deleted: bool, templates} */
function importDeleteTemplate(name) {
  ensureSchema_();
  name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  let deleted = false;
  withLock_(function () {
    const sh = ss_().getSheetByName(IMP_SHEETS.templates);
    if (!sh || sh.getLastRow() < 2) return;
    // ohne deleteRow (Sheets löscht die letzte Datenzeile nicht): Rest in einem Rutsch neu schreiben
    const n = sh.getLastRow() - 1, w = TEMPLATE_HEADERS.length;
    const all = sh.getRange(2, 1, n, w).getValues();
    const keep = all.filter(function (r) { return String(r[0] == null ? '' : r[0]).trim().toLowerCase() !== name.toLowerCase(); });
    deleted = keep.length < all.length;
    if (!deleted) return;
    sh.getRange(2, 1, n, w).clearContent();
    if (keep.length) {
      const range = sh.getRange(2, 1, keep.length, w);
      range.setNumberFormat('@');
      range.setValues(keep.map(function (r) { return r.map(cellText_); }));
    }
    const d = importDraft_();
    if (deleted && d && String(d.templateName || '').toLowerCase() === name.toLowerCase()) {
      d.templateName = '';
      quSaveDraft_(d);
    }
  });
  return { deleted: deleted, templates: quTemplateList_() };
}

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

/** Vorbelegung des Blatts „Import-Begriffe“: [Begriff, Bedeutung, Wert, Wo]. */
const ER_TERM_SEED = [
  ['Reverse Holo', 'Variante', 'reverse', 'Name und Spalten'],
  ['Rev Holo', 'Variante', 'reverse', 'Name und Spalten'],
  ['Reverse', 'Variante', 'reverse', 'Name und Spalten'],
  ['RH', 'Variante', 'reverse', 'nur Spalten'],
  ['Rev', 'Variante', 'reverse', 'nur Spalten'],
  ['Holo', 'Variante', 'holo', 'nur Spalten'],
  ['Non Holo', 'Variante', 'normal', 'nur Spalten'],
  ['Normal', 'Variante', 'normal', 'nur Spalten'],
  ['1st Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['1. Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['Erste Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['First Edition', 'Variante', 'firstEdition', 'Name und Spalten'],
  ['Mint', 'Zustand', 'MT', 'Name und Spalten'],
  ['Near Mint', 'Zustand', 'NM', 'Name und Spalten'],
  ['Excellent', 'Zustand', 'EX', 'Name und Spalten'],
  ['Good', 'Zustand', 'GD', 'Name und Spalten'],
  ['Light Played', 'Zustand', 'LP', 'Name und Spalten'],
  ['Played', 'Zustand', 'PL', 'Name und Spalten'],
  ['Poor', 'Zustand', 'PO', 'Name und Spalten'],
  ['MT', 'Zustand', 'MT', 'nur Spalten'],
  ['NM', 'Zustand', 'NM', 'nur Spalten'],
  ['EX', 'Zustand', 'EX', 'nur Spalten'],
  ['GD', 'Zustand', 'GD', 'nur Spalten'],
  ['LP', 'Zustand', 'LP', 'nur Spalten'],
  ['PL', 'Zustand', 'PL', 'nur Spalten'],
  ['PO', 'Zustand', 'PO', 'nur Spalten'],
  ['Snowflake', 'Sonderversion', 'Snowflake', 'Name und Spalten'],
  ['Staff', 'Sonderversion', 'Staff', 'Name und Spalten'],
  ['Prerelease', 'Sonderversion', 'Prerelease', 'Name und Spalten'],
  ['Deutsch', 'Sprache', 'DE', 'nur Spalten'],
  ['Englisch', 'Sprache', 'EN', 'nur Spalten'],
  ['Japanisch', 'Sprache', 'JP', 'nur Spalten'],
  ['Japanese', 'Sprache', 'JP', 'nur Spalten'],
  ['English', 'Sprache', 'EN', 'nur Spalten'],
  ['German', 'Sprache', 'DE', 'nur Spalten'],
  ['JP', 'Sprache', 'JP', 'nur Spalten'],
  ['EN', 'Sprache', 'EN', 'nur Spalten'],
  ['DE', 'Sprache', 'DE', 'nur Spalten']
];

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
  return ER_TERM_SEED.map(function (r) { return r.slice(); });
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
    version: function (x) { return ''; }
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

/** Geänderte Prüfungszeilen zurückschreiben: zusammenhängende Zeilen in einem Rutsch. Innerhalb der Sperre. */
function erWriteReviewRows_(items) {
  if (!items.length) return;
  const sh = ss_().getSheetByName(IMP_SHEETS.review);
  if (!sh) return;
  const list = items.slice().sort(function (a, b) { return a.row - b.row; });
  let k = 0;
  while (k < list.length) {
    let j = k;
    while (j + 1 < list.length && list[j + 1].row === list[j].row + 1) j++;
    sh.getRange(list[k].row, 1, j - k + 1, REVIEW_HEADERS.length).setValues(list.slice(k, j + 1).map(reviewItemToRow_));
    k = j + 1;
  }
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
  if (typeof quNormCfg_ === 'function') cfg = quNormCfg_(cfg); // gleiche Normalform wie im Teil „Quelle“
  if (typeof parseSourceRecords_ !== 'function') throw new Error('Die Import-Quelle kann nicht gelesen werden.');
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
        if (cov === null) cov = typeof coverageFor_ === 'function' ? (coverageFor_(draft.sourceId, String(draft.tab == null ? '' : draft.tab)) || {}) : {};
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
        erApplyAnswer_(it, answers[it.fp]);
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
          erApplyAnswer_(p.it, answers[p.it.fp]);
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
    erWriteReviewRows_(changed);
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
    card = { free: true, name: erText_(v.nameClean) || erText_(v.name), setName: erText_(v.set), localId: erText_(v.number) };
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

/** Alle vorbelegten Antworten („Deine Wahl vom letzten Mal“) bestätigen. -> {open} */
function importReviewAcceptPrefilled() {
  ensureSchema_();
  erNeedDraft_();
  return withLock_(function () {
    const items = reviewRead_().filter(erIsReview_);
    const ch = items.filter(function (it) { return it.prefilled && it.decision && !it.confirmed; });
    ch.forEach(function (it) { it.confirmed = true; });
    erWriteReviewRows_(ch);
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
  let seeded = 0;
  Object.keys(ER_CODE_SEED).forEach(function (id) {
    if (codes[id]) return;
    if (!sets.en[id] && !sets.de[id]) return;
    codes[id] = ER_CODE_SEED[id];
    seeded++;
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
  if (!sh || sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()).trim() !== IMPORTE_HEADERS[0]) {
    if (typeof quSetupImporte_ === 'function') sh = quSetupImporte_(ss);
    else {
      sh = getOrCreateSheet_(ss, IMP_SHEETS.imports);
      writeHeaders_(sh, IMPORTE_HEADERS);
    }
  }
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
    valueBefore: 0, valueChange: 0, absent: 0, notes: [], warnings: [], moves: []
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
  // Der Import ist hier schon fertig: scheitert nur der Neuaufbau der Ansicht, bleibt er trotzdem 'aktiv'
  try {
    if (addNames.length) setViewExtras_(cur.concat(addNames));
    else rebuildGroups_();
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
      } else rebuildGroups_();
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
