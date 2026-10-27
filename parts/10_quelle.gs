
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

const QU_TERM_MEANINGS = ['Variante', 'Zustand', 'Sonderversion', 'Sprache', 'Ignorieren'];
const QU_TERM_SCOPES = ['Name und Spalten', 'nur Spalten'];
const QU_SAMPLE_ROWS = 25;
const QU_SAMPLE_CHARS = 60;
const QU_TMP_PREFIX = 'Pokémon-Import (temporär) ';

/* ---------- 1a. Blätter anlegen (aus setupSheets_ in Code.gs) ---------- */

/**
 * Legt alle Import-Blätter an (idempotent): "Importe", "Import-Begriffe" (vorbelegt, nur wenn leer),
 * "Import-Sets" sichtbar; "Import-Vorlagen", "Import-Quelle", "Import-Prüfung", "Import-Antworten",
 * "Import-Protokoll" versteckt. Einträge von Eric bleiben bei jedem weiteren Lauf erhalten.
 * Wird von setupSheets_ (Einrichtung, Update, Reparatur) außerhalb der Sperre aufgerufen und nimmt die Sperre selbst.
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
    const rows = TERMS_SEED.map(function (r) { return r.slice(); });
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
  try { imports = importList() || []; } catch (e) { imports = []; }
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
