/**
 * Pokémon-Sammlung – Google Sheets + tcgdex (https://tcgdex.dev)
 *
 * Abschnitte in dieser Datei:
 *   1. Konstanten und Hilfsfunktionen
 *   2. Menü, Sidebar, Web-App, onEdit
 *   3. Einrichtung (Blätter, Ansicht, Trigger)
 *   4. tcgdex-API
 *   5. Suche und Hinzufügen
 *   6. Sammlung (Entfernen, -1/+1, Rückgängig)
 *   7. Übersetzung und Set-Cache
 *   8. Preislauf und Wertverlauf
 *   9. API-Prüfung ("Beim Bau zu prüfen")
 *
 * Erste Schritte: Funktion `einrichtung` einmal im Apps-Script-Editor ausführen.
 */

// ---------------------------------------------------------------------------
// 1. Konstanten und Hilfsfunktionen
// ---------------------------------------------------------------------------

const API = 'https://api.tcgdex.net/v2/';

const SHEETS = {
  view: 'Sammlung',
  data: 'Daten',
  sets: 'Sets',
  tr: 'Übersetzung',
  hist: 'Verlauf',
  check: 'API-Check'
};

const DATA_HEADERS = [
  'Schlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer',
  'Nummer normalisiert', 'Setgröße', 'Name', 'Name englisch', 'Quelle', 'Variante',
  'Zustand', 'Anzahl', 'Trendpreis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit',
  'Kartentyp', 'Illustrator', 'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar'
];

// 0-basierte Spaltenindizes im Blatt Daten
const COL = {
  key: 0, id: 1, setId: 2, setName: 3, setDate: 4, localId: 5, normNum: 6, setSize: 7,
  name: 8, nameEn: 9, source: 10, variant: 11, cond: 12, count: 13, price: 14,
  priceDate: 15, img: 16, rarity: 17, category: 18, illustrator: 19, added: 20,
  changed: 21, numSort: 22
};
const NCOL = DATA_HEADERS.length;
const TEXT_COLS = [COL.key, COL.id, COL.setId, COL.setName, COL.setDate, COL.localId, COL.normNum,
  COL.name, COL.nameEn, COL.source, COL.variant, COL.cond, COL.priceDate, COL.img, COL.rarity,
  COL.category, COL.illustrator];

const SET_HEADERS = ['Sprache', 'Set-ID', 'Name', 'Logo', 'Symbol', 'Karten offiziell', 'Karten gesamt', 'Erscheinungsdatum'];
const TR_HEADERS = ['Deutsch', 'Englisch', 'Belege', 'Eigene Übersetzung'];
const HIST_HEADERS = ['Datum', 'Gesamtwert (EUR)', 'Kartenanzahl', 'Einträge ohne Preis', 'Fehlgeschlagene Abrufe'];
const VIEW_HEADERS = ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Zustand', 'Anzahl',
  'Trendpreis (EUR)', 'Wert (EUR)', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand'];

const MAX_CANDIDATES = 24;
// TCG Pocket (digital, kein Cardmarket-Preis): A1, A1a, A2b, B1, P-A, P-B …
const POCKET_SET_RE = /^(?:[AB]\d+[a-z]?|P-[A-Z])$/;
const CONDITIONS = ['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const SORT_OPTIONS = ['Set und Nummer', 'Name', 'Wert', 'Zuletzt hinzugefügt'];
const VARIANT_LABELS = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1. Edition' };
const SUFFIX_RE = /^(.*?)[\s\-]+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Lv\.X|δ|☆|◇)$/;
const EUR_FORMAT = '#,##0.00 "€"';

const PRICE_BATCH = 20;
const PRICE_TIME_LIMIT_MS = 5 * 60 * 1000;

let ssCache_ = null;

/** Das Sheet – auch aus der Web-App und aus Zeit-Triggern heraus. */
function ss_() {
  if (ssCache_) return ssCache_;
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('Tabellen-ID fehlt. Bitte im Sheet einmal „Pokémon > Einrichtung" ausführen.');
    ss = SpreadsheetApp.openById(id);
  }
  ssCache_ = ss;
  return ss;
}

function tz_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Blatt „' + name + '" fehlt. Bitte „Pokémon > Einrichtung" ausführen.');
  return sh;
}

function normalizeNumber_(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/^([A-Z]*)0+(\d)/, '$1$2');
}

function numSortOf_(localId) {
  const m = String(localId).match(/\d+/);
  return m ? Number(m[0]) : '';
}

/** "025/165" -> {raw:"025", norm:"25", size:165}; "TG05" -> {raw:"TG05", norm:"TG5", size:null} */
function parseNumberInput_(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  const parts = s.split('/');
  const raw = parts[0].trim();
  const size = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
  return { raw: raw, norm: normalizeNumber_(raw), size: isNaN(size) ? null : size };
}

function isPocketSet_(id) {
  return POCKET_SET_RE.test(String(id || ''));
}

function splitSuffix_(name) {
  const m = String(name || '').trim().match(SUFFIX_RE);
  if (!m || !m[1]) return { base: String(name || '').trim(), suffix: '' };
  return { base: m[1].trim(), suffix: m[2] };
}

function toNum_(x) {
  if (typeof x === 'number') return isFinite(x) && x > 0 ? x : null;
  if (x == null || x === '') return null;
  const n = Number(x);
  return isFinite(n) && n > 0 ? n : null;
}

function dateText_(x) {
  if (x == null || x === '') return '';
  let d = x instanceof Date ? x : new Date(typeof x === 'number' && x < 1e12 ? x * 1000 : x);
  if (isNaN(d.getTime())) return String(x);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function cmp_(a, b) {
  a = a == null ? '' : a; b = b == null ? '' : b;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'de');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Das Sheet ist gerade beschäftigt. Bitte gleich noch einmal versuchen.');
  try {
    const result = fn();
    SpreadsheetApp.flush(); // Schreibvorgänge festschreiben, solange die Sperre noch gilt
    return result;
  } finally {
    lock.releaseLock();
  }
}

function notify_(msg, title) {
  Logger.log(msg);
  try { ss_().toast(msg, title || 'Pokémon', 10); } catch (e) { /* kein UI */ }
}

function alert_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { notify_(msg); }
}

// ---------------------------------------------------------------------------
// 2. Menü, Sidebar, Web-App, onEdit
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pokémon')
    .addItem('Karten erfassen', 'kartenErfassen')
    .addItem('Preise jetzt aktualisieren', 'preiseJetztAktualisieren')
    .addItem('Übersetzung und Sets aktualisieren', 'uebersetzungUndSetsAktualisieren')
    .addSeparator()
    .addItem('Einrichtung', 'einrichtung')
    .addItem('Ansicht neu aufbauen', 'ansichtNeuAufbauen')
    .addItem('API prüfen', 'apiPruefen')
    .addItem('Web-App-Link anzeigen', 'webAppLinkAnzeigen')
    .addToUi();
}

function kartenErfassen() {
  const html = HtmlService.createHtmlOutputFromFile('Ui').setTitle('Pokémon-Karten');
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Ui')
    .setTitle('Pokémon-Sammlung')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Zeigt den Web-App-Link. ScriptApp.getService().getUrl() liefert aus dem Sheet heraus
 * den Link der Test-Bereitstellung, nicht den der echten. Deshalb wird der echte Link
 * einmal eingefügt und in den Script Properties gespeichert.
 */
function webAppLinkAnzeigen() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('WEBAPP_URL');
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Web-App fürs Handy',
    (saved ? 'Gespeicherter Link:\n' + saved + '\n\nZum Ändern einen neuen Link einfügen, sonst einfach OK.'
      : 'Noch kein Link gespeichert. Im Apps-Script-Editor unter Bereitstellen > Bereitstellungen verwalten den Web-App-Link (endet auf /exec) kopieren und hier einfügen.') +
    '\n\nNach Code-Änderungen: Bereitstellungen verwalten > Bearbeiten > Version „Neue Version" > Bereitstellen, damit die Web-App sie übernimmt.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const url = res.getResponseText().trim();
  if (!url) return;
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { ui.alert('Das sieht nicht nach einem Web-App-Link aus (https://script.google.com/…/exec).'); return; }
  props.setProperty('WEBAPP_URL', url);
  ui.alert('Gespeichert:\n' + url + '\n\nAm Handy öffnen und „Zum Startbildschirm hinzufügen".');
}

function preiseJetztAktualisieren() {
  notify_('Preislauf gestartet …');
  notify_(startPriceRun_());
}

function uebersetzungUndSetsAktualisieren() {
  notify_('Lade Sets und Kartenlisten von tcgdex …');
  notify_(buildTranslationAndSets_());
}

/** Einfacher Trigger: Zeilenhöhe an den Bilder-Schalter anpassen. */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEETS.view || e.range.getRow() !== 4) return;
    applyRowHeights_(sh);
  } catch (err) { /* nie den Edit stören */ }
}

function applyRowHeights_(sh) {
  sh = sh || ss_().getSheetByName(SHEETS.view);
  if (!sh) return;
  SpreadsheetApp.flush();
  const show = sh.getRange('H4').getValue() === true;
  const max = sh.getMaxRows();
  if (max < 6) return;
  if (!show) { sh.setRowHeights(6, max - 5, 21); return; }
  const names = sh.getRange(6, 2, max - 5, 1).getValues();
  let last = 5;
  for (let i = names.length - 1; i >= 0; i--) { if (names[i][0] !== '') { last = i + 6; break; } }
  if (last >= 6) sh.setRowHeights(6, last - 5, 90);
  if (max > last) sh.setRowHeights(last + 1, max - last, 21);
}

// ---------------------------------------------------------------------------
// 3. Einrichtung
// ---------------------------------------------------------------------------

function einrichtung() {
  const ss = ss_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  setupDataSheet_(ss);
  setupSimpleSheet_(ss, SHEETS.sets, SET_HEADERS, [0, 1, 2, 3, 4, 7], true);
  setupSimpleSheet_(ss, SHEETS.tr, TR_HEADERS, [0, 1, 3], true);
  setupHistorySheet_(ss);
  setupViewSheet_(ss);
  removeDefaultSheet_(ss);
  setupTriggers_();
  let msg = 'Einrichtung fertig.';
  try {
    msg += ' ' + buildTranslationAndSets_();
  } catch (e) {
    msg += ' Sets und Übersetzung konnten nicht geladen werden (' + e.message + '). Bitte später „Pokémon > Übersetzung und Sets aktualisieren" starten.';
  }
  alert_(msg);
}

/** Baut nur das Blatt Sammlung neu auf (keine API-Abrufe, Daten bleiben). */
function ansichtNeuAufbauen() {
  setupViewSheet_(ss_());
  const err = sheet_(SHEETS.view).getRange('A6').getDisplayValue();
  alert_(err === '#ERROR!'
    ? 'Die Ansichtsformel hat noch einen Fehler. Details stehen im Blatt „Diagnose" – bitte Claude Bescheid geben.'
    : 'Ansicht neu aufgebaut.');
}

/**
 * Formel setzen und selbst prüfen: erst in der Apps-Script-Standardschreibweise (Kommas),
 * zeigt die Zelle #ERROR!, mit Semikolons. Scheitert beides, landen Formel und ein
 * Funktionstest im Blatt „Diagnose".
 */
function setFormulaLocal_(range, formula) {
  range.setFormula(formula);
  SpreadsheetApp.flush();
  const first = range.getDisplayValue();
  if (first !== '#ERROR!') return;
  range.setFormula(toSemicolons_(formula));
  SpreadsheetApp.flush();
  const second = range.getDisplayValue();
  if (second !== '#ERROR!') return;
  range.setFormula(formula);
  writeDiagnosis_(range, formula);
}

const FORMULA_PROBES = [
  ['=SUM(1,2)', '3'],
  ['=IFERROR(1/0,"x")', 'x'],
  ['=LET(aa,1,aa+1)', '2'],
  ['=LET(ff,LAMBDA(xx,xx+1),ff(1))', '2'],
  ['=SUM(BYROW(SEQUENCE(2,2),LAMBDA(rw,INDEX(rw,1,2))))', '6'],
  ['=REDUCE(TRUE,"",LAMBDA(acc,ww,AND(acc,ww="")))', 'TRUE'],
  ['=COUNTA(SPLIT("§a §25"," "))', '2'],
  ['=ROWS(HSTACK(SEQUENCE(3),SEQUENCE(3)))', '3'],
  ['=SUM(CHOOSECOLS(SEQUENCE(2,3),2))', '7'],
  ['=SUM(MAP(SEQUENCE(2),SEQUENCE(2),LAMBDA(aa,bb,aa*bb)))', '5'],
  ['=ROWS(MAP(SEQUENCE(2),LAMBDA(ul,IMAGE("https://assets.tcgdex.net/de/swsh/swsh3/136/low.png"))))', '2'],
  ['=REGEXREPLACE("TG05","^([A-Z]*)0+([0-9])","$1$2")', 'TG5'],
  ['=SUM(SORT(SEQUENCE(3),1,FALSE))', '6'],
  ['=ROWS(FILTER(Daten!A1:W,Daten!A1:A<>""))', '>=1'],
  ['=IF(G4=TRUE,1,0)', '0']
];

/** Schreibt die fehlerhafte Formel und einen Funktionstest ins Blatt „Diagnose". */
function writeDiagnosis_(range, formula) {
  const ss = ss_();
  const sh = getOrCreateSheet_(ss, 'Diagnose');
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Test', 'Erwartet', 'Ergebnis Kommas', 'Ergebnis Semikolons']]).setFontWeight('bold');
  const probeSheet = sh;
  FORMULA_PROBES.forEach(function (p, i) {
    const r = i + 2;
    probeSheet.getRange(r, 1).setValue("'" + p[0]);
    probeSheet.getRange(r, 2).setValue("'" + p[1]);
    probeSheet.getRange(r, 3).setFormula(p[0]);
    probeSheet.getRange(r, 4).setFormula(toSemicolons_(p[0]));
  });
  SpreadsheetApp.flush();
  // Ergebnisse als Text festhalten, damit sie auch über Drive lesbar sind
  const n = FORMULA_PROBES.length;
  const shown = sh.getRange(2, 3, n, 2).getDisplayValues();
  sh.getRange(2, 3, n, 2).setValues(shown.map(function (r) { return ["'" + r[0], "'" + r[1]]; }));
  const row = n + 3;
  sh.getRange(row, 1).setValue('Fehlerhafte Formel in ' + range.getSheet().getName() + '!' + range.getA1Notation() + ' (Gebietsschema ' + ss.getSpreadsheetLocale() + '):');
  sh.getRange(row + 1, 1).setValue("'" + formula);
  sh.setColumnWidth(1, 520);
  sh.getRange(1, 1, row + 1, 4).setWrap(true);
}

/** Kommas außerhalb von Textliteralen durch Semikolons ersetzen. */
function toSemicolons_(formula) {
  let out = '', inStr = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') inStr = !inStr;
    out += (!inStr && ch === ',') ? ';' : ch;
  }
  return out;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeHeaders_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
}

function setupDataSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEETS.data);
  writeHeaders_(sh, DATA_HEADERS);
  applyDataFormats_(sh);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sh.protect().setDescription('Wird nur vom Skript beschrieben').setWarningOnly(true);
  sh.hideSheet();
}

function applyDataFormats_(sh) {
  const rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  TEXT_COLS.forEach(function (c) { sh.getRange(2, c + 1, rows, 1).setNumberFormat('@'); });
  sh.getRange(2, COL.setSize + 1, rows, 1).setNumberFormat('0');
  sh.getRange(2, COL.count + 1, rows, 1).setNumberFormat('0');
  sh.getRange(2, COL.price + 1, rows, 1).setNumberFormat(EUR_FORMAT);
  sh.getRange(2, COL.added + 1, rows, 2).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.getRange(2, COL.numSort + 1, rows, 1).setNumberFormat('0');
}

function setupSimpleSheet_(ss, name, headers, textCols, hidden) {
  const sh = getOrCreateSheet_(ss, name);
  writeHeaders_(sh, headers);
  const rows = sh.getMaxRows() - 1;
  textCols.forEach(function (c) { sh.getRange(2, c + 1, rows, 1).setNumberFormat('@'); });
  if (hidden) sh.hideSheet();
  return sh;
}

function setupHistorySheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEETS.hist);
  writeHeaders_(sh, HIST_HEADERS);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, 1, rows, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(2, 2, rows, 1).setNumberFormat(EUR_FORMAT);
  sh.setColumnWidth(1, 100);
  sh.setColumnWidths(2, 4, 140);
  if (!sh.getCharts().length) {
    const chart = sh.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange('A1:B1000'))
      .setNumHeaders(1)
      .setPosition(2, 7, 0, 0)
      .setOption('title', 'Gesamtwert der Sammlung (EUR)')
      .setOption('legend', { position: 'none' })
      .setOption('width', 640)
      .setOption('height', 360)
      .build();
    sh.insertChart(chart);
  }
}

function setupViewSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEETS.view);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  if (sh.getMaxColumns() < 26) sh.insertColumnsAfter(sh.getMaxColumns(), 26 - sh.getMaxColumns());

  // Kopf und Summen
  sh.getRange('A1').setValue('Pokémon-Sammlung').setFontSize(16).setFontWeight('bold');
  sh.getRange('E1:J1').setValues([['Gesamtwert', '=SUM(I6:I)', 'Karten', '=SUM(G6:G)', 'Einträge', '=COUNT(G6:G)']]);
  sh.getRange('E1').setFontWeight('bold'); sh.getRange('G1').setFontWeight('bold'); sh.getRange('I1').setFontWeight('bold');
  sh.getRange('F1').setNumberFormat(EUR_FORMAT);
  sh.getRange('A2').setValue('Summen gelten für die aktuelle Suche. Erfassen und Entfernen über Menü Pokémon > Karten erfassen.')
    .setFontColor('#5f6368').setFontSize(9);

  // Steuerzeile
  sh.getRange('B3:H3').setValues([['Suche (Name oder Nummer, z. B. Glurak 025/165)', 'Set', '', 'Sortierung', '', '0er zeigen', 'Bilder zeigen']])
    .setFontColor('#5f6368').setFontSize(9);
  sh.getRange('B4').setNumberFormat('@').setBackground('#fff8e1');
  sh.getRange('C4').setValue('Alle').setBackground('#fff8e1');
  sh.getRange('E4').setValue(SORT_OPTIONS[0]).setBackground('#fff8e1');
  sh.getRange('G4:H4').insertCheckboxes().setValue(false);
  sh.getRange('B4:H4').setBorder(true, true, true, true, true, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);

  sh.getRange('Z1').setValue('Alle');
  setFormulaLocal_(sh.getRange('Z2'), '=IFERROR(SORT(UNIQUE(FILTER(Daten!D2:D, Daten!D2:D<>""))), "")');
  sh.getRange('C4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange('Z1:Z1000'), true).setAllowInvalid(false).build());
  sh.getRange('E4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(SORT_OPTIONS, true).setAllowInvalid(false).build());
  sh.hideColumns(26);

  // Tabelle
  sh.getRange(5, 1, 1, VIEW_HEADERS.length).setValues([VIEW_HEADERS])
    .setFontWeight('bold').setBackground('#c62828').setFontColor('#ffffff');
  setFormulaLocal_(sh.getRange('A6'), viewFormula_());
  sh.getRange('H6:I').setNumberFormat(EUR_FORMAT);
  sh.getRange('A6:M').setVerticalAlignment('middle');
  sh.setFrozenRows(5);

  const widths = [70, 190, 170, 80, 110, 70, 70, 110, 100, 130, 90, 130, 95];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  const grey = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=($G6<>"")*($G6=0)')
    .setFontColor('#9aa0a6').setBackground('#f5f5f5')
    .setRanges([sh.getRange('A6:M')]).build();
  sh.setConditionalFormatRules([grey]);

  sh.getRange('A5:M').protect().setDescription('Ansicht – Änderungen nur über die Oberfläche').setWarningOnly(true);
  applyRowHeights_(sh);
}

/** Die eine Formel der Sammlungsansicht: filtert, sortiert und gibt die Tabelle aus. */
function viewFormula_() {
  return [
    '=IFERROR(LET(',
    'dat, FILTER(Daten!A2:W, Daten!A2:A<>""),',
    'qry, TRIM(B4),',
    'wrds, IF(qry="", "", SPLIT("§"&REGEXREPLACE(qry, "\\s+", " §"), " ")),',
    'nrm, LAMBDA(xx, REGEXREPLACE(UPPER(TO_TEXT(xx)), "^([A-Z]*)0+([0-9])", "$1$2")),',
    'okay, BYROW(dat, LAMBDA(rw, AND(',
    '  OR(C4="", C4="Alle", INDEX(rw, 1, 4)=C4),',
    '  OR(G4=TRUE, INDEX(rw, 1, 14)>0),',
    '  REDUCE(TRUE, wrds, LAMBDA(acc, wraw, LET(wd, MID(wraw, 2, 200), szw, IFERROR(REGEXEXTRACT(wd, "/(.*)$"), ""), AND(acc, IF(wd="", TRUE,',
    '    IF(REGEXMATCH(wd, "[0-9]"),',
    '      IF(REGEXMATCH(wd, "/"),',
    '        AND(TO_TEXT(INDEX(rw, 1, 7))=nrm(REGEXEXTRACT(wd, "^[^/]*")), IF(REGEXMATCH(szw, "^0*[1-9]"), TO_TEXT(INDEX(rw, 1, 8))=REGEXEXTRACT(REGEXREPLACE(szw, "^0+", ""), "^[0-9]+"), TRUE)),',
    '        TO_TEXT(INDEX(rw, 1, 7))=nrm(wd)),',
    '      OR(ISNUMBER(SEARCH(wd, INDEX(rw, 1, 9))), ISNUMBER(SEARCH(wd, INDEX(rw, 1, 10))))))))))',
    '))),',
    'flt, FILTER(dat, okay),',
    'cnt, CHOOSECOLS(flt, 14),',
    'vals, MAP(CHOOSECOLS(flt, 15), cnt, LAMBDA(pr, cn, IF(ISNUMBER(pr), pr*cn, 0))),',
    'zsort, MAP(cnt, LAMBDA(cn, IF(cn>0, 0, 1))),',
    'msort, MAP(CHOOSECOLS(flt, 9), vals, CHOOSECOLS(flt, 22), CHOOSECOLS(flt, 5), LAMBDA(nm, vl, tm, sd,',
    '  IF(E4="Name", LOWER(nm), IF(E4="Wert", -vl, IF(E4="Zuletzt hinzugefügt", -N(tm), TO_TEXT(sd)))))),',
    'srt, SORT(HSTACK(flt, zsort, msort, vals), 24, TRUE, 25, TRUE, 5, TRUE, 3, TRUE, 23, TRUE, 7, TRUE, 12, TRUE, 13, TRUE),',
    'HSTACK(',
    '  MAP(CHOOSECOLS(srt, 17), LAMBDA(ul, IF(H4=TRUE, IF(ul="", "–", IMAGE(ul&"/low.png")), ""))),',
    '  MAP(CHOOSECOLS(srt, 9), CHOOSECOLS(srt, 11), LAMBDA(nm, src, IF(src="en-Ersatz", nm&" (EN)", nm))),',
    '  CHOOSECOLS(srt, 4),',
    '  MAP(CHOOSECOLS(srt, 6), CHOOSECOLS(srt, 8), LAMBDA(nr, sz, IF(sz="", nr, nr&"/"&sz))),',
    '  MAP(CHOOSECOLS(srt, 12), LAMBDA(vr, IF(vr="reverse", "Reverse Holo", IF(vr="holo", "Holo", IF(vr="firstEdition", "1. Edition", "Normal"))))),',
    '  CHOOSECOLS(srt, 13),',
    '  CHOOSECOLS(srt, 14),',
    '  MAP(CHOOSECOLS(srt, 15), LAMBDA(pr, IF(ISNUMBER(pr), pr, "kein Preis"))),',
    '  CHOOSECOLS(srt, 26),',
    '  CHOOSECOLS(srt, 18), CHOOSECOLS(srt, 19), CHOOSECOLS(srt, 20), CHOOSECOLS(srt, 16)',
    ')), "Keine Einträge gefunden")'
  ].join(' ');
}

function removeDefaultSheet_(ss) {
  ['Sheet1', 'Tabellenblatt1', 'Tabelle1', 'Blatt 1'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function deleteTriggersFor_(fnName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

function setupTriggers_() {
  deleteTriggersFor_('naechtlicherPreislauf');
  ScriptApp.newTrigger('naechtlicherPreislauf').timeBased().everyDays(1).atHour(3)
    .inTimezone(tz_()).create();
}

// ---------------------------------------------------------------------------
// 4. tcgdex-API
// ---------------------------------------------------------------------------

function apiUrl_(lang, path, params) {
  let url = API + lang + '/' + path;
  if (params) {
    const q = Object.keys(params)
      .filter(function (k) { return params[k] !== '' && params[k] != null; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
      .join('&');
    if (q) url += '?' + q;
  }
  return url;
}

/** GET mit einem Wiederholversuch. 404 -> null. */
function fetchJson_(url, attempts) {
  attempts = attempts || 2;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      const code = res.getResponseCode();
      if (code === 404) return null;
      if (code >= 200 && code < 300) return JSON.parse(res.getContentText('UTF-8'));
      lastErr = new Error('HTTP ' + code);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) Utilities.sleep(1000);
  }
  throw new Error('tcgdex nicht erreichbar (' + (lastErr ? lastErr.message : '?') + ')');
}

/** Paralleler GET. Liefert pro URL {ok, data} oder {ok:false, notFound|error}. */
function fetchAllJson_(urls) {
  if (!urls.length) return [];
  let responses;
  try {
    responses = UrlFetchApp.fetchAll(urls.map(function (u) {
      return { url: u, muteHttpExceptions: true, headers: { Accept: 'application/json' } };
    }));
  } catch (e) {
    responses = urls.map(function () { return null; });
  }
  return urls.map(function (u, i) {
    const r = responses[i];
    if (r) {
      const code = r.getResponseCode();
      if (code === 404) return { ok: false, notFound: true };
      if (code >= 200 && code < 300) {
        try { return { ok: true, data: JSON.parse(r.getContentText('UTF-8')) }; } catch (e) { /* unten erneut */ }
      }
    }
    try {
      const d = fetchJson_(u, 1);
      return d ? { ok: true, data: d } : { ok: false, notFound: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

function setIdOf_(brief) {
  const id = String(brief.id || '');
  const lid = String(brief.localId == null ? '' : brief.localId);
  if (lid && id.slice(-(lid.length + 1)) === '-' + lid) return id.slice(0, id.length - lid.length - 1);
  const i = id.lastIndexOf('-');
  return i > 0 ? id.slice(0, i) : id;
}

function cardmarket_(card) {
  const cm = card && card.pricing && card.pricing.cardmarket;
  return cm && typeof cm === 'object' ? cm : null;
}

/** Cardmarket-Trend passend zur Variante (siehe Plan, Abschnitt Preise). */
function priceFor_(cm, variant) {
  if (!cm) return null;
  if (variant === 'reverse') return toNum_(cm['trend-holo']);
  const t = toNum_(cm.trend);
  if (t != null) return t;
  return variant === 'holo' ? toNum_(cm['trend-holo']) : null;
}

function baseVariant_(v) {
  v = v || {};
  if (v.holo && !v.normal) return 'holo';
  if (v.normal) return 'normal';
  if (v.holo) return 'holo';
  if (v.reverse) return 'reverse';
  if (v.firstEdition) return 'firstEdition';
  return 'normal';
}

/**
 * Ergänzt eine deutsche Karte aus den englischen Daten derselben ID:
 * das Bild (alte Sets bis Diamant & Perl haben bei tcgdex keine deutschen Bilder)
 * und, falls er fehlt, den Cardmarket-Preis. Setzt card.image direkt.
 */
function cardmarketWithFallback_(card, lang) {
  let cm = cardmarket_(card);
  if (lang !== 'de' || (cm && card.image)) return { cm: cm, fromEn: false };
  let en = null;
  try { en = fetchJson_(apiUrl_('en', 'cards/' + encodeURIComponent(card.id)), 1); } catch (e) { en = null; }
  if (!en) return { cm: cm, fromEn: false };
  if (!card.image && en.image) card.image = en.image;
  if (cm) return { cm: cm, fromEn: false };
  cm = cardmarket_(en);
  return { cm: cm, fromEn: !!cm };
}

/** Fehlende Bilder deutscher Kandidaten parallel aus den englischen Daten nachladen. */
function fillMissingImages_(cards) {
  const missing = cards.filter(function (c) { return c.lang === 'de' && !c.image; });
  if (!missing.length) return;
  const res = fetchAllJson_(missing.map(function (c) { return apiUrl_('en', 'cards/' + encodeURIComponent(c.id)); }));
  missing.forEach(function (c, i) { if (res[i].ok && res[i].data.image) c.image = res[i].data.image; });
}

// ---------------------------------------------------------------------------
// 5. Suche und Hinzufügen (vom UI aufgerufen)
// ---------------------------------------------------------------------------

function loadSets_() {
  const out = { de: {}, en: {}, order: { de: [], en: [] } };
  const sh = ss_().getSheetByName(SHEETS.sets);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, SET_HEADERS.length).getValues().forEach(function (r, i) {
    const lang = r[0];
    if (!out[lang] || !r[1] || isPocketSet_(r[1])) return;
    out[lang][r[1]] = {
      id: String(r[1]), name: String(r[2]), logo: String(r[3]), symbol: String(r[4]),
      official: Number(r[5]) || null, total: Number(r[6]) || null,
      releaseDate: r[7] instanceof Date ? dateText_(r[7]) : String(r[7] || ''), row: i + 2
    };
    out.order[lang].push(String(r[1]));
  });
  return out;
}

function matchSets_(sets, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return [];
  const ids = {};
  ['de', 'en'].forEach(function (lang) {
    Object.keys(sets[lang]).forEach(function (id) {
      const s = sets[lang][id];
      if (id.toLowerCase() === t || s.name.toLowerCase().indexOf(t) >= 0) ids[id] = true;
    });
  });
  return Object.keys(ids);
}

function sizeOk_(sets, setId, size) {
  const info = sets.de[setId] || sets.en[setId];
  if (!info || !info.official) return true;
  return Number(info.official) === Number(size);
}

function squash_(s) {
  return String(s || '').toLowerCase().replace(/[\s\-.]/g, '');
}

/** Kandidaten (Kurzform) aus tcgdex holen und lokal exakt filtern. */
function findCandidates_(lang, name, num, setIds, sets, suffix) {
  let list = [];
  if (name) {
    const res = fetchJson_(apiUrl_(lang, 'cards', { name: name }));
    list = Array.isArray(res) ? res : [];
  } else {
    (setIds || []).slice(0, 5).forEach(function (id) {
      const set = fetchJson_(apiUrl_(lang, 'sets/' + encodeURIComponent(id)));
      if (set && Array.isArray(set.cards)) list = list.concat(set.cards);
    });
  }
  let cands = list.map(function (c) {
    return { id: String(c.id), localId: String(c.localId), name: String(c.name || ''), image: c.image || '', setId: setIdOf_(c), lang: lang };
  }).filter(function (c) {
    if (isPocketSet_(c.setId)) return false;
    if (num && normalizeNumber_(c.localId) !== num.norm) return false;
    if (setIds && setIds.indexOf(c.setId) < 0) return false;
    if (num && num.size && !sizeOk_(sets, c.setId, num.size)) return false;
    return true;
  });
  if (suffix) {
    const sfx = squash_(suffix);
    const withSuffix = cands.filter(function (c) { return squash_(c.name).slice(-sfx.length) === sfx; });
    if (withSuffix.length) cands = withSuffix;
  }
  return cands;
}

function summarizeCard_(card, lang) {
  const set = card.set || {};
  const v = card.variants || {};
  const base = baseVariant_(v);
  return {
    id: String(card.id), lang: lang, name: String(card.name || ''), localId: String(card.localId),
    setId: String(set.id || setIdOf_(card)), setName: String(set.name || ''),
    setSize: set.cardCount && set.cardCount.official ? Number(set.cardCount.official) : null,
    image: card.image || '', rarity: card.rarity || '', category: card.category || '',
    illustrator: card.illustrator || '', baseVariant: base, baseLabel: VARIANT_LABELS[base],
    canReverse: !!v.reverse && base !== 'reverse', canFirstEdition: !!v.firstEdition && base !== 'firstEdition'
  };
}

function finishCandidates_(lang, cands, notes, inputName, enNote) {
  if (cands.length > MAX_CANDIDATES) {
    notes.push(cands.length + ' Treffer – bitte Nummer oder Set ergänzen.');
    return { stage: lang, tooMany: cands.length, cards: [], notes: notes, inputName: inputName };
  }
  const details = fetchAllJson_(cands.map(function (c) { return apiUrl_(lang, 'cards/' + encodeURIComponent(c.id)); }));
  const langs = cands.map(function () { return lang; });
  if (lang === 'en' && cands.length) {
    // IDs sind in de und en gleich: gibt es die Karte auf Deutsch, ist sie kein Ersatz
    const de = fetchAllJson_(cands.map(function (c) { return apiUrl_('de', 'cards/' + encodeURIComponent(c.id)); }));
    de.forEach(function (d, i) { if (d.ok) { details[i] = d; langs[i] = 'de'; } });
  }
  const sets = loadSets_();
  const cards = cands.map(function (c, i) {
    if (details[i].ok) return summarizeCard_(details[i].data, langs[i]);
    const s = sets[langs[i]][c.setId];
    return { id: c.id, lang: langs[i], name: c.name, localId: c.localId, setId: c.setId, setName: s ? s.name : c.setId, image: c.image };
  });
  if (enNote && langs.indexOf('en') >= 0) notes.push(enNote);
  fillMissingImages_(cards);
  return { stage: lang, cards: cards, notes: notes, inputName: inputName };
}

/**
 * Suche in bis zu drei Stufen: deutsch, englisch mit übersetztem Namen, Set-Auswahl.
 * input = {name, number, set}
 */
function searchCards(input) {
  input = input || {};
  const name = String(input.name || '').trim();
  const num = parseNumberInput_(input.number);
  const setText = String(input.set || '').trim();
  if (!name && !(num && setText)) throw new Error('Bitte einen Namen eingeben – oder Set und Nummer.');

  const sets = loadSets_();
  const notes = [];
  let setIds = null;
  if (setText) {
    const ids = matchSets_(sets, setText);
    if (ids.length) setIds = ids;
    else notes.push('Set „' + setText + '" ist nicht im Set-Cache, der Set-Filter wird ignoriert. Evtl. „Übersetzung und Sets aktualisieren" ausführen.');
  }
  if (!name && !setIds) throw new Error('Set „' + setText + '" nicht gefunden. Bitte einen Namen eingeben.');

  // Stufe 1: deutsch (auch „Glurak ex" statt „Glurak-ex")
  let cands = findCandidates_('de', name, num, setIds, sets, null);
  if (!cands.length && name) {
    const sp = splitSuffix_(name);
    if (sp.suffix) {
      cands = findCandidates_('de', sp.base, num, setIds, sets, sp.suffix)
        .filter(function (c) { return squash_(c.name).indexOf(squash_(name)) >= 0; });
    }
  }
  if (cands.length) return finishCandidates_('de', cands, notes, name);

  // Stufe 2: englisch mit übersetztem Namen
  if (name) {
    const tries = [];
    const tr = translateName_(name);
    if (tr) tries.push({ q: tr.base, suffix: tr.suffix, label: tr.en });
    tries.push({ q: name, suffix: '', label: name });
    const seen = {};
    for (let i = 0; i < tries.length; i++) {
      const t = tries[i];
      if (seen[t.q.toLowerCase()]) continue;
      seen[t.q.toLowerCase()] = true;
      cands = findCandidates_('en', t.q, num, setIds, sets, t.suffix);
      if (cands.length) {
        return finishCandidates_('en', cands, notes, name, 'Keine deutsche Karte gefunden – englische Daten für „' + t.label + '".');
      }
    }
  } else {
    cands = findCandidates_('en', '', num, setIds, sets, null);
    if (cands.length) return finishCandidates_('en', cands, notes, name, 'Keine deutsche Karte gefunden – englische Daten.');
  }

  // Stufe 3: Set-Auswahl (braucht eine Nummer)
  if (!num) {
    notes.push('Keine Karte gefunden. Mit Nummer (z. B. 025/165) kannst du das Set aus einer Liste wählen.');
    return { stage: 'none', cards: [], notes: notes, inputName: name };
  }
  notes.push('Keine Karte gefunden. Wähle das Set, dann wird Nummer ' + num.raw + ' darin gesucht.');
  return { stage: 'pickSet', cards: [], notes: notes, inputName: name, number: input.number, sets: setPickerList_(sets, num, setIds) };
}

function setPickerList_(sets, num, setIds) {
  const lang = sets.order.en.length ? 'en' : 'de';
  const list = sets.order[lang].map(function (id) {
    const s = sets[lang][id];
    const de = sets.de[id];
    return { id: id, name: de ? de.name : s.name, nameEn: s.name, logo: s.logo || (de && de.logo) || '',
      official: s.official, releaseDate: s.releaseDate, preferred: false };
  }).reverse(); // tcgdex liefert alt nach neu; neue zuerst
  let pref = list;
  if (setIds) {
    const pre = pref.filter(function (s) { return setIds.indexOf(s.id) >= 0; });
    if (pre.length) pref = pre;
  }
  if (num && num.size) {
    const bySize = pref.filter(function (s) { return Number(s.official) === num.size; });
    if (bySize.length) pref = bySize;
  }
  if (pref.length < list.length) pref.forEach(function (s) { s.preferred = true; });
  return list; // volle Liste, die Vorauswahl ist nur markiert
}

/** Einzelkarte mit Preis für die Bestätigung. */
function getCardDetail(id, lang) {
  const card = fetchJson_(apiUrl_(lang, 'cards/' + encodeURIComponent(id)));
  if (!card) throw new Error('Karte ' + id + ' nicht gefunden.');
  const p = cardmarketWithFallback_(card, lang);
  const s = summarizeCard_(card, lang);
  s.priceFromEn = p.fromEn;
  s.prices = {
    base: priceFor_(p.cm, s.baseVariant),
    reverse: priceFor_(p.cm, 'reverse'),
    firstEdition: priceFor_(p.cm, 'firstEdition')
  };
  s.priceUpdated = p.cm ? dateText_(p.cm.updated) : '';
  return s;
}

/** Letzte Stufe: Karte über Set + Nummer (erst deutsch, dann englisch). */
function getCardBySetNumber(setId, number) {
  const num = parseNumberInput_(number);
  if (!num) throw new Error('Bitte eine Nummer angeben.');
  const langs = ['de', 'en'];
  for (let i = 0; i < langs.length; i++) {
    const set = fetchJson_(apiUrl_(langs[i], 'sets/' + encodeURIComponent(setId)));
    if (!set || !Array.isArray(set.cards)) continue;
    const c = set.cards.filter(function (x) { return normalizeNumber_(x.localId) === num.norm; })[0];
    if (c) return getCardDetail(c.id, langs[i]);
  }
  throw new Error('Nummer ' + num.raw + ' gibt es in diesem Set nicht.');
}

/** Erscheinungsdatum eines Sets: aus dem Cache, sonst einmal holen und speichern. */
function setReleaseDate_(lang, setId, setBrief) {
  const sets = loadSets_();
  const hit = sets[lang][setId] || sets[lang === 'de' ? 'en' : 'de'][setId];
  if (hit && hit.releaseDate) return hit.releaseDate;
  let date = '';
  try {
    const full = fetchJson_(apiUrl_(lang, 'sets/' + encodeURIComponent(setId)));
    date = full && full.releaseDate ? String(full.releaseDate).slice(0, 10) : '';
  } catch (e) { date = ''; }
  if (!date) return '';
  const sh = ss_().getSheetByName(SHEETS.sets);
  if (sh) {
    const own = sets[lang][setId];
    if (own) {
      sh.getRange(own.row, 8).setValue(date);
    } else {
      const b = setBrief || {};
      const cc = b.cardCount || {};
      sh.appendRow([lang, setId, b.name || setId, b.logo || '', b.symbol || '', cc.official || '', cc.total || '', date]);
    }
  }
  return date;
}

function readData_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, NCOL).getValues();
}

function ensureRows_(sh, rowNeeded) {
  if (rowNeeded <= sh.getMaxRows()) return;
  sh.insertRowsAfter(sh.getMaxRows(), Math.max(200, rowNeeded - sh.getMaxRows()));
  applyDataFormats_(sh);
}

/**
 * Karte speichern. req = {id, lang, variant: 'base'|'reverse'|'firstEdition', condition, qty, inputName}
 */
function addCard(req) {
  req = req || {};
  const lang = req.lang === 'en' ? 'en' : 'de';
  const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
  const card = fetchJson_(apiUrl_(lang, 'cards/' + encodeURIComponent(req.id)));
  if (!card) throw new Error('Karte ' + req.id + ' nicht gefunden – nichts gespeichert.');

  const v = card.variants || {};
  let variant = baseVariant_(v);
  if (req.variant === 'reverse') variant = 'reverse';
  if (req.variant === 'firstEdition') variant = 'firstEdition';
  const cond = CONDITIONS.indexOf(String(req.condition || '')) >= 0 ? String(req.condition || '') : '';

  const p = cardmarketWithFallback_(card, lang);
  const price = priceFor_(p.cm, variant);
  const set = card.set || {};
  const setId = String(set.id || setIdOf_(card));
  const setDate = setReleaseDate_(lang, setId, set);
  const isEn = lang === 'en';
  const inputName = String(req.inputName || '').trim();
  const displayName = isEn && inputName ? inputName : String(card.name);
  const key = [card.id, variant, cond].join('|');
  const now = new Date();

  const result = withLock_(function () {
    const sh = sheet_(SHEETS.data);
    const rows = readData_(sh);
    if (setDate) {
      // ältere Einträge dieses Sets ohne Datum nachtragen
      rows.forEach(function (r, i) {
        if (String(r[COL.setId]) === setId && r[COL.key] && !r[COL.setDate]) sh.getRange(i + 2, COL.setDate + 1).setValue(setDate);
      });
    }
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][COL.key] === key) {
        const count = (Number(rows[i][COL.count]) || 0) + qty;
        const r = i + 2;
        sh.getRange(r, COL.count + 1).setValue(count);
        sh.getRange(r, COL.changed + 1).setValue(now);
        if (price != null) sh.getRange(r, COL.price + 1, 1, 2).setValues([[price, dateText_(p.cm.updated)]]);
        return { count: count };
      }
    }
    const row = new Array(NCOL).fill('');
    row[COL.key] = key;
    row[COL.id] = String(card.id);
    row[COL.setId] = setId;
    row[COL.setName] = String(set.name || setId);
    row[COL.setDate] = setDate;
    row[COL.localId] = String(card.localId);
    row[COL.normNum] = normalizeNumber_(card.localId);
    row[COL.setSize] = set.cardCount && set.cardCount.official ? Number(set.cardCount.official) : '';
    row[COL.name] = displayName;
    row[COL.nameEn] = isEn ? String(card.name) : '';
    row[COL.source] = isEn ? 'en-Ersatz' : 'de';
    row[COL.variant] = variant;
    row[COL.cond] = cond;
    row[COL.count] = qty;
    row[COL.price] = price == null ? '' : price;
    row[COL.priceDate] = p.cm ? dateText_(p.cm.updated) : '';
    row[COL.img] = card.image || '';
    row[COL.rarity] = card.rarity || '';
    row[COL.category] = card.category || '';
    row[COL.illustrator] = card.illustrator || '';
    row[COL.added] = now;
    row[COL.changed] = now;
    row[COL.numSort] = numSortOf_(card.localId);
    const target = sh.getLastRow() + 1;
    ensureRows_(sh, target);
    sh.getRange(target, 1, 1, NCOL).setValues([row]);
    return { count: qty };
  });

  try { applyRowHeights_(); } catch (e) { /* egal */ }
  const parts = [displayName, VARIANT_LABELS[variant]];
  if (cond) parts.push(cond);
  return {
    key: key,
    count: result.count,
    message: parts.join(', ') + ' hinzugefügt, jetzt ' + result.count + ' Stück.' + (price == null ? ' (kein Preis)' : '')
  };
}

// ---------------------------------------------------------------------------
// 6. Sammlung: Suche, -1/+1, Rückgängig
// ---------------------------------------------------------------------------

/** Anzahl ändern (+1, -1, Rückgängig). Nie unter 0, Eintrag bleibt erhalten. */
function adjustCount(key, delta) {
  delta = Math.round(Number(delta) || 0);
  const res = withLock_(function () {
    const sh = sheet_(SHEETS.data);
    const keys = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) {
        const r = i + 2;
        const cur = Number(sh.getRange(r, COL.count + 1).getValue()) || 0;
        const next = Math.max(0, cur + delta);
        if (next !== cur) {
          sh.getRange(r, COL.count + 1).setValue(next);
          sh.getRange(r, COL.changed + 1).setValue(new Date());
        }
        return { key: key, count: next, applied: next - cur };
      }
    }
    throw new Error('Eintrag nicht gefunden.');
  });
  // Die Zeilenzahl der Sammlung ändert sich nur, wenn die Anzahl über 0 springt
  if (res.applied && (res.count === 0 || res.count === res.applied)) {
    try { applyRowHeights_(); } catch (e) { /* egal */ }
  }
  return res;
}

function matchWord_(r, w) {
  if (/\d/.test(w)) {
    const p = parseNumberInput_(w);
    if (normalizeNumber_(r[COL.localId]) !== p.norm) return false;
    if (p.size && Number(r[COL.setSize]) !== p.size) return false;
    return true;
  }
  const lw = w.toLowerCase();
  return String(r[COL.name]).toLowerCase().indexOf(lw) >= 0 || String(r[COL.nameEn]).toLowerCase().indexOf(lw) >= 0;
}

/** Suche im Datenblatt für den Tab Entfernen. */
function searchCollection(query, setText) {
  const rows = readData_(sheet_(SHEETS.data));
  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  const st = String(setText || '').trim().toLowerCase();
  const stIds = st ? matchSets_(loadSets_(), st) : [];
  const res = rows.filter(function (r) {
    if (!r[COL.key]) return false;
    if (st && String(r[COL.setName]).toLowerCase().indexOf(st) < 0 &&
        String(r[COL.setId]).toLowerCase() !== st &&
        stIds.indexOf(String(r[COL.setId])) < 0) return false;
    return words.every(function (w) { return matchWord_(r, w); });
  });
  res.sort(function (a, b) {
    return ((Number(a[COL.count]) > 0 ? 0 : 1) - (Number(b[COL.count]) > 0 ? 0 : 1)) ||
      cmp_(String(a[COL.setDate]), String(b[COL.setDate])) ||
      cmp_(String(a[COL.setId]), String(b[COL.setId])) ||
      cmp_(Number(a[COL.numSort]) || 0, Number(b[COL.numSort]) || 0) ||
      cmp_(String(a[COL.localId]), String(b[COL.localId])) ||
      cmp_(String(a[COL.variant]), String(b[COL.variant])) ||
      cmp_(String(a[COL.cond]), String(b[COL.cond]));
  });
  return {
    total: res.length,
    items: res.slice(0, 60).map(function (r) {
      return {
        key: String(r[COL.key]), name: String(r[COL.name]), nameEn: String(r[COL.nameEn]),
        source: String(r[COL.source]), setName: String(r[COL.setName]), localId: String(r[COL.localId]),
        setSize: r[COL.setSize] === '' ? null : Number(r[COL.setSize]), variant: String(r[COL.variant]),
        variantLabel: VARIANT_LABELS[r[COL.variant]] || String(r[COL.variant]), cond: String(r[COL.cond]),
        count: Number(r[COL.count]) || 0, image: String(r[COL.img]),
        price: typeof r[COL.price] === 'number' ? r[COL.price] : null
      };
    })
  };
}

/** Vorschlagsliste fürs Setfeld. */
function getSetSuggestions() {
  const sets = loadSets_();
  const names = {};
  ['de', 'en'].forEach(function (lang) {
    Object.keys(sets[lang]).forEach(function (id) { names[sets[lang][id].name] = true; });
  });
  return Object.keys(names).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'de'); });
}

// ---------------------------------------------------------------------------
// 7. Übersetzung und Set-Cache
// ---------------------------------------------------------------------------

function buildTranslationAndSets_() {
  const nSets = rebuildSets_();
  const nTr = rebuildTranslation_();
  return nSets + ' Sets und ' + nTr + ' Namenspaare geladen.';
}

function rebuildSets_() {
  const sh = sheet_(SHEETS.sets);
  const old = loadSets_();
  const rows = [];
  const pocket = {};
  try {
    const se = fetchJson_(apiUrl_('en', 'series/tcgp'), 1);
    ((se && se.sets) || []).forEach(function (s) { pocket[s.id] = true; });
  } catch (e) { /* dann nur über das Muster */ }
  ['de', 'en'].forEach(function (lang) {
    const list = fetchJson_(apiUrl_(lang, 'sets')) || [];
    list.forEach(function (s) {
      if (pocket[s.id] || isPocketSet_(s.id)) return;
      const cc = s.cardCount || {};
      const prev = old[lang][s.id];
      rows.push([lang, String(s.id), String(s.name || ''), s.logo || '', s.symbol || '',
        cc.official || '', cc.total || '', prev ? prev.releaseDate : '']);
    });
  });
  if (!rows.length) throw new Error('tcgdex lieferte keine Sets.');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SET_HEADERS.length).clearContent();
  if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, SET_HEADERS.length).setNumberFormats(
    rows.map(function () { return ['@', '@', '@', '@', '@', '0', '0', '@']; }));
  sh.getRange(2, 1, rows.length, SET_HEADERS.length).setValues(rows);
  return rows.length;
}

function rebuildTranslation_() {
  const sh = sheet_(SHEETS.tr);
  const de = fetchJson_(apiUrl_('de', 'cards')) || [];
  const en = fetchJson_(apiUrl_('en', 'cards')) || [];
  if (!de.length || !en.length) throw new Error('tcgdex lieferte keine Kartenlisten.');
  const enById = {};
  en.forEach(function (c) { enById[c.id] = c.name; });

  const pairs = {};
  function add(d, e) {
    if (!d || !e) return;
    pairs[d] = pairs[d] || {};
    pairs[d][e] = (pairs[d][e] || 0) + 1;
  }
  de.forEach(function (c) {
    const e = enById[c.id];
    if (!e) return;
    add(c.name, e);
    const bd = splitSuffix_(c.name), be = splitSuffix_(e);
    if (bd.suffix && be.suffix) add(bd.base, be.base);
  });

  // eigene Übersetzungen behalten
  const custom = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (r[0] && r[3]) custom[String(r[0])] = [String(r[0]), String(r[3])];
    });
  }

  const rows = Object.keys(pairs).sort(function (a, b) { return a.localeCompare(b, 'de'); }).map(function (d) {
    let best = '', bestN = 0;
    Object.keys(pairs[d]).forEach(function (e) { if (pairs[d][e] > bestN) { best = e; bestN = pairs[d][e]; } });
    const c = custom[d];
    if (c) delete custom[d];
    return [d, best, bestN, c ? c[1] : ''];
  });
  Object.keys(custom).forEach(function (k) { rows.push([custom[k][0], '', 0, custom[k][1]]); });

  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, 4).setNumberFormats(rows.map(function () { return ['@', '@', '0', '@']; }));
  sh.getRange(2, 1, rows.length, 4).setValues(rows);
  return rows.length;
}

function loadTranslation_() {
  const map = {};
  const sh = ss_().getSheetByName(SHEETS.tr);
  if (!sh || sh.getLastRow() < 2) return map;
  const own = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    const k = String(r[0] || '').trim().toLowerCase();
    if (!k) return;
    const c = String(r[3] || '').trim(), g = String(r[1] || '').trim();
    if (c) { map[k] = c; own[k] = true; } // eigene Übersetzung hat Vorrang
    else if (g && !own[k]) map[k] = g;
  });
  return map;
}

/** Deutscher Name -> {en, base, suffix} oder null. Erst exakt, sonst Grundname plus Zusatz. */
function translateName_(name) {
  const map = loadTranslation_();
  const lower = String(name).trim().toLowerCase();
  if (map[lower]) {
    const s = splitSuffix_(map[lower]);
    return { en: map[lower], base: s.base, suffix: s.suffix };
  }
  const sp = splitSuffix_(name);
  if (sp.suffix && map[sp.base.toLowerCase()]) {
    const b = map[sp.base.toLowerCase()];
    return { en: b + ' ' + sp.suffix, base: b, suffix: sp.suffix };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 8. Preislauf und Wertverlauf
// ---------------------------------------------------------------------------

/** Zeit-Trigger (täglich 3–4 Uhr). */
function naechtlicherPreislauf() {
  startPriceRun_();
}

function startPriceRun_() {
  deleteTriggersFor_('continuePriceRun');
  PropertiesService.getScriptProperties().setProperty('PRICE_RUN', JSON.stringify({ pos: 0, failed: 0 }));
  return continuePriceRun();
}

function langOfRow_(r) {
  return r[COL.source] === 'en-Ersatz' ? 'en' : 'de';
}

function priceTargets_() {
  const rows = readData_(sheet_(SHEETS.data));
  const seen = {};
  rows.forEach(function (r) { if (r[COL.id]) seen[langOfRow_(r) + '|' + r[COL.id]] = true; });
  return Object.keys(seen).sort().map(function (k) {
    const i = k.indexOf('|');
    return { lang: k.slice(0, i), id: k.slice(i + 1), key: k };
  });
}

/** Läuft in Paketen; nach ~5 Minuten Pause und Fortsetzung per Einmal-Trigger. */
function continuePriceRun() {
  deleteTriggersFor_('continuePriceRun');
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('PRICE_RUN');
  if (!raw) return 'Kein Preislauf aktiv.';
  const state = JSON.parse(raw);
  const t0 = Date.now();
  const targets = priceTargets_();

  while (state.pos < targets.length) {
    if (Date.now() - t0 > PRICE_TIME_LIMIT_MS) {
      props.setProperty('PRICE_RUN', JSON.stringify(state));
      ScriptApp.newTrigger('continuePriceRun').timeBased().after(60 * 1000).create();
      return 'Preislauf bei ' + state.pos + ' von ' + targets.length + ' Karten pausiert, geht in einer Minute weiter.';
    }
    const batch = targets.slice(state.pos, state.pos + PRICE_BATCH);
    const res = fetchAllJson_(batch.map(function (t) { return apiUrl_(t.lang, 'cards/' + encodeURIComponent(t.id)); }));
    const cmByKey = {};
    const needEn = [];
    batch.forEach(function (t, i) {
      if (!res[i].ok) { state.failed++; return; }
      const cm = cardmarket_(res[i].data);
      if (cm) cmByKey[t.key] = cm;
      else if (t.lang === 'de') needEn.push(t);
      else cmByKey[t.key] = null;
    });
    if (needEn.length) {
      const enRes = fetchAllJson_(needEn.map(function (t) { return apiUrl_('en', 'cards/' + encodeURIComponent(t.id)); }));
      needEn.forEach(function (t, i) {
        if (enRes[i].ok) cmByKey[t.key] = cardmarket_(enRes[i].data);
        else if (enRes[i].notFound) cmByKey[t.key] = null;
        else state.failed++;
      });
    }
    writePrices_(cmByKey);
    state.pos += batch.length;
    props.setProperty('PRICE_RUN', JSON.stringify(state));
    if (state.pos < targets.length) Utilities.sleep(1000);
  }

  try { backfillSetDates_(); } catch (e) { /* nächste Nacht wieder */ }
  writeHistory_(state.failed);
  props.deleteProperty('PRICE_RUN');
  return 'Preise für ' + targets.length + ' Karten aktualisiert' +
    (state.failed ? ', ' + state.failed + ' Abrufe fehlgeschlagen (alter Preis bleibt)' : '') + '.';
}

/** Fehlende Set-Erscheinungsdaten nachtragen (sonst stehen diese Karten beim Sortieren oben). */
function backfillSetDates_() {
  const rows = readData_(sheet_(SHEETS.data));
  const dates = {};
  rows.forEach(function (r) {
    if (!r[COL.key] || r[COL.setDate]) return;
    const sid = String(r[COL.setId]);
    if (!(sid in dates)) dates[sid] = setReleaseDate_(langOfRow_(r), sid, null);
  });
  if (!Object.keys(dates).some(function (k) { return dates[k]; })) return;
  withLock_(function () {
    const sh = sheet_(SHEETS.data);
    readData_(sh).forEach(function (r, i) {
      const d = dates[String(r[COL.setId])];
      if (r[COL.key] && !r[COL.setDate] && d) sh.getRange(i + 2, COL.setDate + 1).setValue(d);
    });
  });
}

function writePrices_(cmByKey) {
  withLock_(function () {
    const sh = sheet_(SHEETS.data);
    const rows = readData_(sh);
    if (!rows.length) return;
    let changed = false;
    const out = rows.map(function (r) {
      const k = langOfRow_(r) + '|' + r[COL.id];
      if (!(k in cmByKey)) return [r[COL.price], r[COL.priceDate]];
      changed = true;
      const cm = cmByKey[k];
      const p = priceFor_(cm, r[COL.variant]);
      return [p == null ? '' : p, cm ? dateText_(cm.updated) : ''];
    });
    if (changed) sh.getRange(2, COL.price + 1, out.length, 2).setValues(out);
  });
}

function writeHistory_(failed) {
  const rows = readData_(sheet_(SHEETS.data));
  let total = 0, cards = 0, noPrice = 0;
  rows.forEach(function (r) {
    const n = Number(r[COL.count]) || 0;
    if (n <= 0) return;
    cards += n;
    if (typeof r[COL.price] === 'number') total += r[COL.price] * n;
    else noPrice++;
  });
  const sh = sheet_(SHEETS.hist);
  const today = dateText_(new Date());
  const last = sh.getLastRow();
  let target = last + 1;
  if (last >= 2) {
    const dates = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (dateText_(dates[i][0]) === today) { target = i + 2; break; }
    }
  }
  const parts = today.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (target > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), 366); // hinten anhängen, bestehende Zeilen bleiben
    const max = sh.getMaxRows();
    sh.getRange(2, 1, max - 1, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(2, 2, max - 1, 1).setNumberFormat(EUR_FORMAT);
    const ch = sh.getCharts()[0];
    if (ch) sh.updateChart(ch.modify().clearRanges().addRange(sh.getRange(1, 1, max, 2)).setNumHeaders(1).build());
  }
  sh.getRange(target, 1, 1, 5).setValues([[d, Math.round(total * 100) / 100, cards, noPrice, failed]]);
}

// ---------------------------------------------------------------------------
// 9. API-Prüfung: beantwortet die Punkte aus „Beim Bau zu prüfen"
// ---------------------------------------------------------------------------

function apiPruefen() {
  const ss = ss_();
  const sh = getOrCreateSheet_(ss, SHEETS.check);
  sh.clear();
  const out = [['Prüfpunkt', 'Ergebnis', 'Details']];
  function add(a, b, c) { out.push([a, String(b), typeof c === 'string' ? c : JSON.stringify(c)]); }
  function step(label, fn) { try { fn(); } catch (e) { add(label, 'FEHLER', e.message); } }

  step('1. Preise bei deutschen Karten', function () {
    const ids = ['swsh3-136', 'sv03.5-006', 'base1-4'];
    ids.forEach(function (id) {
      const de = fetchJson_(apiUrl_('de', 'cards/' + id));
      const en = fetchJson_(apiUrl_('en', 'cards/' + id));
      const cmDe = cardmarket_(de), cmEn = cardmarket_(en);
      add('1. pricing in /de/cards/' + id, de ? (cmDe ? 'ja' : 'nein') : 'Karte fehlt auf Deutsch',
        { de: cmDe ? { trend: cmDe.trend, 'trend-holo': cmDe['trend-holo'], updated: cmDe.updated } : null,
          en: cmEn ? { trend: cmEn.trend, 'trend-holo': cmEn['trend-holo'], updated: cmEn.updated } : null });
    });
  });

  step('2. trend-holo = Reverse Holo?', function () {
    const set = fetchJson_(apiUrl_('de', 'sets/swsh3')) || fetchJson_(apiUrl_('en', 'sets/swsh3'));
    const briefs = (set && set.cards || []).slice(0, 15);
    const det = fetchAllJson_(briefs.map(function (b) { return apiUrl_('en', 'cards/' + b.id); }));
    let shown = 0;
    det.forEach(function (d) {
      if (!d.ok || shown >= 3) return;
      const c = d.data, v = c.variants || {}, cm = cardmarket_(c);
      if (v.normal && v.reverse && cm) {
        shown++;
        add('2. ' + c.id + ' ' + c.name, 'manuell mit Cardmarket vergleichen',
          'trend (Normal) = ' + cm.trend + ' / trend-holo (Reverse?) = ' + cm['trend-holo'] + ' / avg = ' + cm.avg + ' / avg-holo = ' + cm['avg-holo']);
      }
    });
    if (!shown) add('2. trend-holo', 'keine passende Karte gefunden', '');
  });

  step('3. Deutsche Daten bei alten Sets', function () {
    ['base1', 'base2', 'neo1', 'ex1', 'dp1', 'bw1', 'xy1', 'sm1'].forEach(function (id) {
      const de = fetchJson_(apiUrl_('de', 'sets/' + id));
      const en = fetchJson_(apiUrl_('en', 'sets/' + id));
      const deCards = de && de.cards || [], enCards = en && en.cards || [];
      const deImg = deCards.filter(function (c) { return c.image; }).length;
      add('3. Set ' + id, de ? (deCards.length + ' de / ' + enCards.length + ' en Karten') : 'Set fehlt auf Deutsch',
        'de mit Bild: ' + deImg + (de ? ', Name de: ' + de.name : '') + (en ? ', Name en: ' + en.name : '') +
        (de && de.releaseDate ? ', Datum: ' + de.releaseDate : ''));
    });
  });

  step('4. localId-Formate und Filter', function () {
    const sets = fetchJson_(apiUrl_('en', 'sets')) || [];
    const pick = ['base1', 'swsh3'];
    sets.forEach(function (s) { if (/tg|gg|sv03\.5|svp|swshp/i.test(s.id) && pick.length < 8) pick.push(s.id); });
    pick.forEach(function (id) {
      const s = fetchJson_(apiUrl_('en', 'sets/' + id));
      if (!s) return;
      const ids = (s.cards || []).map(function (c) { return c.localId; });
      add('4. localIds ' + id, ids.length + ' Karten', ids.slice(0, 6).concat(['…']).concat(ids.slice(-3)).join(', '));
    });
    const a = fetchJson_(apiUrl_('de', 'cards', { name: 'Pikachu', localId: '25' })) || [];
    const b = fetchJson_(apiUrl_('de', 'cards', { name: 'Pikachu', localId: 'eq:25' })) || [];
    const c = fetchJson_(apiUrl_('de', 'cards', { name: 'Pikachu' })) || [];
    const d = fetchJson_(apiUrl_('de', 'cards', { name: 'pikachu' })) || [];
    add('4. Filter localId=25 / eq:25 / ohne', a.length + ' / ' + b.length + ' / ' + c.length,
      'localId=25: ' + a.slice(0, 8).map(function (x) { return x.id; }).join(', '));
    add('4. Namensfilter Groß/klein (Pikachu / pikachu)', c.length + ' / ' + d.length, '');
  });

  step('5. IDs de = en', function () {
    const deSets = fetchJson_(apiUrl_('de', 'sets')) || [];
    const enSets = fetchJson_(apiUrl_('en', 'sets')) || [];
    const enIds = {};
    enSets.forEach(function (s) { enIds[s.id] = true; });
    const onlyDe = deSets.filter(function (s) { return !enIds[s.id]; }).map(function (s) { return s.id; });
    add('5. Set-IDs nur auf Deutsch', onlyDe.length + ' von ' + deSets.length, onlyDe.slice(0, 20).join(', '));
  });

  step('6. Größe der Kartenlisten', function () {
    ['de', 'en'].forEach(function (lang) {
      const t = Date.now();
      const res = UrlFetchApp.fetch(apiUrl_(lang, 'cards'), { muteHttpExceptions: true });
      const txt = res.getContentText('UTF-8');
      let n = 0;
      try { n = JSON.parse(txt).length; } catch (e) { n = 'kein JSON'; }
      add('6. /' + lang + '/cards', n + ' Karten', Math.round(txt.length / 1024) + ' KB, ' + (Date.now() - t) + ' ms, HTTP ' + res.getResponseCode());
    });
  });

  step('8. UrlFetch-Kontingent', function () {
    add('8. UrlFetch-Kontingent', 'nicht abfragbar', 'Laut Google-Doku 20.000 Abrufe/Tag für private Konten: https://developers.google.com/apps-script/guides/services/quotas');
  });

  add('7. IMAGE() mit WebP', 'manuell: siehe Bilder unten', 'Links WebP, rechts PNG. Wenn links leer ist, kann IMAGE() kein WebP.');
  add('9. onEdit aus der Sheets-App', 'manuell', 'Am Handy in der Sheets-App „Bilder zeigen" umschalten und prüfen, ob die Zeilen höher werden.');

  sh.getRange(1, 1, out.length, 3).setValues(out);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#f1f3f4');
  const imgRow = out.length + 2;
  sh.getRange(imgRow, 1).setValue('Bildtest');
  sh.getRange(imgRow, 2).setFormula('=IMAGE("https://assets.tcgdex.net/de/swsh/swsh3/136/low.webp")');
  sh.getRange(imgRow, 3).setFormula('=IMAGE("https://assets.tcgdex.net/de/swsh/swsh3/136/low.png")');
  sh.setRowHeight(imgRow, 120);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 600);
  sh.getRange(1, 1, out.length, 3).setWrap(true).setVerticalAlignment('top');
  ss.setActiveSheet(sh);
  notify_('API-Prüfung fertig, Ergebnisse im Blatt „' + SHEETS.check + '".');
}
