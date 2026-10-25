/* ==========================================================================
 *  Pokémon-Sammlung · Version 1.1.2
 *  https://github.com/studiobaeric/collection-sheet
 * ========================================================================== */

/**
 * Import.gs: Import-Werkzeug für bestehende Sammlungen (Assistent, Erkennung, Prüfliste, Vorschau, Zurücknehmen).
 * Teilt sich den globalen Bereich mit Code.gs und nutzt dessen Helfer (withLock_, rowObj_, appendDataRows_ ...).
 * Wichtig: Auf oberster Ebene nur reine Literale, keine Konstanten aus Code.gs (Ladereihenfolge der Dateien).
 */

/* =========================================================================
 * 0. Gemeinsame Konstanten und Zustände des Imports
 * ========================================================================= */

/** Version dieser Datei; Code.gs vergleicht sie mit den anderen Dateien (#35). tools/release.js schreibt sie. */
const IMPORT_FILE_VERSION = '1.1.2';

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
 *  candidates: [], decision: {type, id?, lang?, variant?, auto?} | null, card: {} | null, prefilled, confirmed}
 * decision.auto: vom Tool vorausgewählt (freie Karte), nicht von dir
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
 * Vorauswahlen (decision.auto) werden nicht gespeichert und lassen eine gespeicherte Antwort stehen.
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
    if (a.decision && a.decision.auto) return; // Vorauswahl ist keine Antwort von dir
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
