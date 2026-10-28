/* ==========================================================================
 *  Pokémon-Sammlung · Version 1.1.3
 *  https://github.com/studiobaeric/collection-sheet
 * ========================================================================== */

/**
 * Pokémon-Sammlung – Google Sheets + tcgdex (https://tcgdex.dev)
 *
 * Abschnitte in dieser Datei:
 *   1. Konstanten und Hilfsfunktionen
 *   1a. Datenmodell (Daten-Zeilen, Schlüssel, Umstellung auf Version 2)
 *   1b. Import-Protokoll (gemeinsam mit Import.gs)
 *   1c. Einstellungen (Blatt „Tool-Einstellungen“) und Stilllegen nach einer Übernahme
 *   2. Menü, Sidebar, Web-App, onEdit
 *   3. Einrichtung (Blätter, Gruppen, leichtes Speichern, Ansicht, Trigger)
 *   4. tcgdex-API
 *   5. Suche und Hinzufügen
 *   6. Sammlung (Gruppen, -1/+1, Rückgängig, Bearbeiten, eigener Preis, Verknüpfen)
 *   6a. Einsortieren (Gruppen, Pokédex und Dashboard nachziehen)
 *   7. Übersetzung und Set-Cache
 *   8. Preislauf und Wertverlauf
 *   9. API-Prüfung ("Beim Bau zu prüfen")
 *  10. Pokédex, Seltenheiten und Sortierung der Sammlung
 *  11. Dashboard (Kennzahlen und Knöpfe)
 *
 * Erste Schritte: in der Tabelle „Pokémon > Karten erfassen“ öffnen. Das richtet beim ersten Mal alles ein und legt
 * später fehlende Blätter oder den nächtlichen Preislauf wieder an (repairSetup_).
 * Das Import-Werkzeug steht in Import.gs / ImportUi.html und nutzt die Hilfsfunktionen hier.
 * Versionsprüfung, „Neue Version holen“ und Übernahme aus einer alten Tabelle stehen in Update.gs.
 */

// ---------------------------------------------------------------------------
// 1. Konstanten und Hilfsfunktionen
// ---------------------------------------------------------------------------

const API = 'https://api.tcgdex.net/v2/';

// Version dieses Codes (Releases auf GitHub, siehe Update.gs). Vorabversionen z. B. '1.1.0-beta.1'.
const TOOL_VERSION = '1.1.3';

const SHEETS = {
  dash: 'Dashboard',
  view: 'Sammlung',
  data: 'Daten',
  groups: 'Gruppen',
  sets: 'Sets',
  tr: 'Übersetzung',
  hist: 'Verlauf',
  cardHist: 'Kartenverlauf',
  check: 'API-Check',
  imports: 'Importe',
  proto: 'Import-Protokoll',
  dex: 'Pokédex',
  dexData: 'Pokédex-Daten',
  dexIds: 'Pokédex-Nummern',
  rarity: 'Seltenheiten',
  settings: 'Tool-Einstellungen',
  takenOver: 'Übernommen'
};

const DATA_HEADERS = [
  'Schlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer',
  'Nummer normalisiert', 'Setgröße', 'Name', 'Name englisch', 'Quelle', 'Variante',
  'Zustand', 'Anzahl', 'Trendpreis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit',
  'Kartentyp', 'Illustrator', 'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar',
  'Eintrag-ID', 'Sprache', 'Sonderversion', 'Eigener Preis (EUR)', 'Eigener Preis Stand',
  'Herkunft', 'Quellzeile'
];

// 0-basierte Spaltenindizes im Blatt Daten (ab Index 30 folgen die freien Zusatzspalten)
const COL = {
  key: 0, id: 1, setId: 2, setName: 3, setDate: 4, localId: 5, normNum: 6, setSize: 7,
  name: 8, nameEn: 9, source: 10, variant: 11, cond: 12, count: 13, price: 14,
  priceDate: 15, img: 16, rarity: 17, category: 18, illustrator: 19, added: 20,
  changed: 21, numSort: 22, eid: 23, lang: 24, version: 25, ownPrice: 26,
  ownPriceDate: 27, origin: 28, fp: 29
};
const NCOL = DATA_HEADERS.length; // 30 feste Spalten
const V1_NCOL = 23; // Breite des alten Datenblatts (Version 1)
const TEXT_COLS = [COL.key, COL.id, COL.setId, COL.setName, COL.setDate, COL.localId, COL.normNum,
  COL.name, COL.nameEn, COL.source, COL.variant, COL.cond, COL.priceDate, COL.img, COL.rarity,
  COL.category, COL.illustrator, COL.eid, COL.lang, COL.version, COL.ownPriceDate, COL.origin, COL.fp];
const SCHEMA_VERSION = '2';
const ORIGIN_HAND = 'Hand';

// Gruppen: eine Zeile pro Karte + Variante + Sonderversion. Die Ansichtsformel liest die Spalten über GCOL.
// Die letzten Spalten (ab Suchtext) sind Hilfsspalten nur für die Ansichtsformel (#39 V2): Sie rechnet damit
// über ganze Spalten statt Zeile für Zeile.
const GROUP_HEADERS = [
  'Gruppenschlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer',
  'Nummer normalisiert', 'Setgröße', 'Name', 'Name englisch', 'Quelle', 'Variante', 'Exemplare',
  'Anzahl', 'Preis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit', 'Kartentyp', 'Illustrator',
  'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar',
  'Veränderung 30 Tage (EUR)', 'Veränderung 30 Tage (%)', 'Verlauf seit',
  'Suchtext', 'Wert (EUR)', 'Name Anzeige', 'Nummer Anzeige', 'Variante Anzeige', 'Preis Anzeige'
];
// Spaltennummer (1-basiert) im Blatt Gruppen nach Name, z. B. GCOL['Anzahl'] (#36 C4)
const GCOL = GROUP_HEADERS.reduce(function (m, h, i) { m[h] = i + 1; return m; }, {});

const PROTO_HEADERS = ['Log-ID', 'Import-Nr', 'Typ', 'Eintrag-ID', 'Quellzeile', 'Menge', 'Daten', 'Status', 'Zeitpunkt', 'Quelle-ID'];
const PROTO_FORMATS = ['@', '0', '@', '@', '@', '0', '@', '@', 'dd.mm.yyyy hh:mm', '@'];

const SET_HEADERS = ['Sprache', 'Set-ID', 'Name', 'Logo', 'Symbol', 'Karten offiziell', 'Karten gesamt', 'Erscheinungsdatum'];
const TR_HEADERS = ['Deutsch', 'Englisch', 'Belege', 'Eigene Übersetzung'];
const HIST_HEADERS = ['Datum', 'Gesamtwert (EUR)', 'Kartenanzahl', 'Einträge ohne Preis', 'Fehlgeschlagene Abrufe'];
const VIEW_HEADERS = ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Exemplare', 'Anzahl',
  'Preis (EUR)', 'Wert (EUR)', '± 30 Tage (EUR)', '± 30 Tage (%)', 'Verlauf seit', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand'];
// Preisverlauf pro Karte (Blatt Kartenverlauf): eine Zeile pro Karten-ID + Variante, Vergleichspreise je Zeitraum
const CARD_HIST_HEADERS = ['Karten-ID', 'Variante', 'Stand', 'Vergleich 7 Tage', 'Seit (7 Tage)', 'Vergleich 30 Tage', 'Seit (30 Tage)',
  'Vergleich 90 Tage', 'Seit (90 Tage)', 'Verlauf'];
const CHANGE_DAYS = [7, 30, 90];  // Zeiträume der Veränderung (Seitenleiste und Web-App schalten um)
const VIEW_CHANGE_DAYS = 30;      // Zeitraum im Blatt Sammlung
const CARD_HIST_MAX_CHARS = 45000; // eine Zelle fasst 50.000 Zeichen; darüber fallen die ältesten Einträge weg
const SIGNED_EUR_FORMAT = '+#,##0.00 "€";-#,##0.00 "€";#,##0.00 "€"';
const SIGNED_PCT_FORMAT = '+0 %;-0 %;0 %';

const MAX_CANDIDATES = 24;
const MAX_GROUPS = 60;
const CARD_CACHE_SECS = 1800; // Karten von tcgdex zwischenspeichern (fetchCard_)
// TCG Pocket (digital, kein Cardmarket-Preis): A1, A1a, A2b, B1, P-A, P-B …
const POCKET_SET_RE = /^(?:[AB]\d+[a-z]?|P-[A-Z])$/;
const CONDITIONS = ['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const CONDITION_LABELS = { '': 'ohne Angabe', MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
// Kartensprachen (die Sprache der echten Karte, nicht die der tcgdex-Daten)
const LANGS = [['DE', 'Deutsch'], ['EN', 'Englisch'], ['FR', 'Französisch'], ['IT', 'Italienisch'],
  ['ES', 'Spanisch'], ['PT', 'Portugiesisch'], ['NL', 'Niederländisch'], ['PL', 'Polnisch'],
  ['JP', 'Japanisch'], ['KO', 'Koreanisch'], ['ZH', 'Chinesisch']];
const SORT_OPTIONS = ['Set und Nummer', 'Name', 'Wert', 'Zuletzt hinzugefügt'];
const VARIANT_LABELS = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1. Edition' };
const SUFFIX_RE = /^(.*?)[\s\-]+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Lv\.X|δ|☆|◇)$/;
const EUR_FORMAT = '#,##0.00 "€"';
const DATE_TIME_FORMAT = 'dd.mm.yyyy hh:mm';

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
    if (!id) throw new Error('Tabellen-ID fehlt. Bitte die Tabelle am Computer öffnen und einmal „Pokémon > Karten erfassen“ starten.');
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
  if (!sh) throw new Error('Blatt „' + name + '“ fehlt. Bitte am Computer „Pokémon > Karten erfassen“ neu öffnen, dann legt das Tool es wieder an.');
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

/**
 * Preistext -> Zahl. "1,50 €", "1.50", "€ 1,5", "1.234,56" -> 1.5 / 1234.56.
 * Leer -> null, unlesbar -> NaN.
 */
function parsePrice_(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return isFinite(x) ? x : NaN;
  let s = String(x).replace(/EUR/gi, '').replace(/[€\s ]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return s !== '' && isFinite(n) ? n : NaN;
}

function dateText_(x) {
  if (x == null || x === '') return '';
  let d = x instanceof Date ? x : new Date(typeof x === 'number' && x < 1e12 ? x * 1000 : x);
  if (isNaN(d.getTime())) return String(x);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' (Text oder Datum) -> 'dd.MM.yyyy'; anderes bleibt, wie es ist. */
function dmyText_(x) {
  if (x == null || x === '') return '';
  if (x instanceof Date) return isNaN(x.getTime()) ? '' : Utilities.formatDate(x, tz_(), 'dd.MM.yyyy');
  const m = String(x).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(x);
}

function todayText_() {
  return dateText_(new Date());
}

/** Zellwert als Text für das UI (Datum -> yyyy-MM-dd). */
function cellText_(v) {
  if (v == null) return '';
  if (v instanceof Date) return dateText_(v);
  return String(v);
}

function cmp_(a, b) {
  a = a == null ? '' : a; b = b == null ? '' : b;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'de');
}

/** Spaltennummer (1-basiert) -> Buchstaben: 1 -> A, 27 -> AA. */
function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
  if (busyNotes_) busyNotes_.push(String(msg)); // die nächste Laufmeldung ersetzt sie gleich, notifyDone_ zeigt sie wieder
  try { ss_().toast(msg, title || 'Pokémon', 10); } catch (e) { /* kein UI */ }
}

/** Hinweise (notify_), die während einer Laufmeldung kamen; notifyDone_ hängt sie an die Fertig-Meldung. */
let busyNotes_ = null;

/**
 * Meldung unten rechts, die stehen bleibt, bis die nächste sie ersetzt: So sieht man, dass das Skript noch läuft (#29).
 * Am Ende immer mit notifyDone_ abschließen, auch bei einem Fehler.
 */
function notifyBusy_(msg) {
  Logger.log(msg);
  if (!busyNotes_) busyNotes_ = [];
  try { ss_().toast(msg, 'Pokémon · läuft …', -1); } catch (e) { /* kein UI */ }
}

/** Ersetzt die Laufmeldung durch eine normale Meldung, mit den Hinweisen, die unterwegs kamen. */
function notifyDone_(msg) {
  const notes = busyNotes_ || [];
  busyNotes_ = null;
  notify_([msg].concat(notes).join(' '));
}

/** Zählt Schritte für notifyBusy_: busySteps_('Einrichtung', 5)('Sammlung aufbauen') -> „Einrichtung läuft (1 von 5): Sammlung aufbauen …“ */
function busySteps_(what, total) {
  let n = 0;
  return function (step) {
    n = Math.min(n + 1, total);
    notifyBusy_(what + ' läuft (' + n + ' von ' + total + '): ' + step + ' …');
  };
}

/** Das Dashboard zeigen (Start, nach Einrichtung und Übernahme); ein verstecktes bleibt versteckt. */
function showDashboard_() {
  try {
    const dash = ss_().getSheetByName(SHEETS.dash);
    if (dash && !dash.isSheetHidden()) ss_().setActiveSheet(dash);
  } catch (e) { /* wie bisher */ }
}

/** Wieder das Blatt zeigen, das vor einem Umbau offen war (#28). Gibt es das nicht mehr, das Dashboard. */
function restoreActiveSheet_(ss, prevName) {
  try {
    const sh = prevName ? ss.getSheetByName(prevName) : null;
    if (sh && !sh.isSheetHidden()) ss.setActiveSheet(sh);
    else showDashboard_();
  } catch (e) { /* nur Komfort */ }
}

function alert_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { notify_(msg); }
}

// Zwischenspeicher (CacheService) für Werte über 100 KB: in Stücken, unter dem Schlüssel selbst steht deren Zahl.
// 30.000 Zeichen sind höchstens 90 KB, auch wenn jedes Zeichen drei Bytes braucht.
const CACHE_CHUNK = 30000;

/** Wert als JSON merken (höchstens 6 Stunden). Geht es nicht, bleibt es ohne Zwischenspeicher. */
function cachePutJson_(key, obj, secs) {
  try {
    const text = JSON.stringify(obj);
    const n = Math.max(1, Math.ceil(text.length / CACHE_CHUNK));
    const put = {};
    for (let i = 0; i < n; i++) put[key + ':' + i] = text.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    put[key] = String(n);
    CacheService.getScriptCache().putAll(put, secs);
  } catch (e) { /* ohne Zwischenspeicher weiter */ }
}

/** Gemerkten Wert lesen; fehlt ein Stück oder ist er kaputt: null. */
function cacheGetJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key));
    if (!(n >= 1)) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + ':' + i);
    const got = cache.getAll(keys);
    let text = '';
    for (let i = 0; i < n; i++) {
      if (typeof got[keys[i]] !== 'string') return null;
      text += got[keys[i]];
    }
    return JSON.parse(text);
  } catch (e) { return null; }
}

/** Vergessen (die Stücke laufen von selbst ab). */
function cacheDrop_(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) { /* läuft von selbst ab */ }
}

// ---------------------------------------------------------------------------
// 1a. Datenmodell: eine Daten-Zeile = Exemplare EINES Eintrags aus EINER Herkunft
// ---------------------------------------------------------------------------

function hex10_() {
  return Utilities.getUuid().replace(/-/g, '').slice(-10).toLowerCase();
}

/** Neue, stabile Eintrag-ID ('E' + 10 Hex-Zeichen). */
function newEid_() {
  return 'E' + hex10_();
}

/** Neue Log-ID fürs Import-Protokoll ('L' + 10 Hex-Zeichen). */
function newLogId_() {
  return 'L' + hex10_();
}

function originOf_(nr) {
  return 'Import ' + nr;
}

/** 'Import 3' -> 3, alles andere -> null. */
function importNrOf_(origin) {
  const m = String(origin == null ? '' : origin).trim().match(/^Import\s+(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Leere Herkunft gilt als „von Hand“ (z. B. direkt im Blatt Daten eingetippte Zeilen). */
function isHandOrigin_(origin) {
  const o = String(origin == null ? '' : origin).trim();
  return o === '' || o === ORIGIN_HAND;
}

function normOrigin_(origin) {
  return isHandOrigin_(origin) ? ORIGIN_HAND : String(origin).trim();
}

/** Sprachcode der echten Karte: 'de', 'Deutsch', 'DE' -> 'DE'; leer -> 'DE'. */
function langCode_(x) {
  const s = String(x == null ? '' : x).trim();
  if (!s) return 'DE';
  const up = s.toUpperCase();
  for (let i = 0; i < LANGS.length; i++) {
    if (LANGS[i][0] === up || LANGS[i][1].toUpperCase() === up) return LANGS[i][0];
  }
  return up;
}

function langLabel_(code) {
  for (let i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return LANGS[i][1];
  return String(code || '');
}

function condCode_(x) {
  const s = String(x == null ? '' : x).trim().toUpperCase();
  return CONDITIONS.indexOf(s) >= 0 ? s : null;
}

function versionText_(x) {
  return String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
}

/** Nummer einer freien Karte ohne "/Setgröße". */
function freeNum_(s) {
  return String(s == null ? '' : s).split('/')[0].trim();
}

/** Die Felder für Schlüssel aus einer Daten-Zeile (Array). */
function keyFields_(r) {
  return {
    id: r[COL.id], name: r[COL.name], setName: r[COL.setName], localId: r[COL.localId], normNum: r[COL.normNum],
    variant: r[COL.variant], version: r[COL.version], cond: r[COL.cond], lang: r[COL.lang]
  };
}

/** Erster Teil von Eintrags- und Gruppenschlüssel: tcgdex-ID oder 'frei:name~set~nummer'. */
function keyHead_(o) {
  const id = String(o.id == null ? '' : o.id).trim();
  if (id) return id;
  const num = o.localId != null && String(o.localId).trim() !== '' ? o.localId : (o.normNum || '');
  return 'frei:' + String(o.name == null ? '' : o.name).trim().toLowerCase() + '~' +
    String(o.setName == null ? '' : o.setName).trim().toLowerCase() + '~' + normalizeNumber_(freeNum_(num));
}

/**
 * Eintragsschlüssel: [id, variant, version, cond, lang].join('|'), bei freien Karten statt id
 * 'frei:name~set~nummer'. o = Objekt {id, name, setName, localId|normNum, variant, version, cond, lang}
 * oder eine Daten-Zeile (Array).
 */
function entryKey_(o) {
  if (Array.isArray(o)) o = keyFields_(o);
  return [keyHead_(o), String(o.variant || ''), versionText_(o.version), String(o.cond || '').trim(), langCode_(o.lang)].join('|');
}

/** Gruppenschlüssel (eine Zeile in Sammlung/Gruppen): [id oder frei-Teil, variant, version].join('|'). */
function groupKey_(o) {
  if (Array.isArray(o)) o = keyFields_(o);
  return [keyHead_(o), String(o.variant || ''), versionText_(o.version)].join('|');
}

/** Zeile mit Inhalt? (leere Zeilen im Blatt zählen nicht) */
function isDataRow_(r) {
  return !!(r && (String(r[COL.key] || '') || String(r[COL.id] || '') || String(r[COL.name] || '') || String(r[COL.eid] || '')));
}

/** Volle Kopfzeile des Blatts Daten: feste Spalten + Zusatzspalten (ab Index 30). */
function dataHeaders_() {
  const sh = ss_().getSheetByName(SHEETS.data);
  if (!sh) return DATA_HEADERS.slice();
  const lastCol = Math.min(sh.getLastColumn(), sh.getMaxColumns());
  if (lastCol <= NCOL) return DATA_HEADERS.slice();
  // Anzeigetext: eine Kopfzeile, die Sheets als Datum oder Zahl gelesen hat, zählt so, wie sie zu sehen ist
  const extras = sh.getRange(1, NCOL + 1, 1, lastCol - NCOL).getDisplayValues()[0]
    .map(function (h) { return String(h == null ? '' : h).trim(); });
  while (extras.length && !extras[extras.length - 1]) extras.pop();
  return DATA_HEADERS.concat(extras);
}

/** Namen der Zusatzspalten (Kopfzeilen ab Index 30, nicht leer). */
function extraNames_() {
  return dataHeaders_().slice(NCOL).filter(Boolean);
}

function ensureCols_(sh, n) {
  const max = sh.getMaxColumns();
  if (max < n) sh.insertColumnsAfter(max, n - max);
}

/**
 * 0-basierter Spaltenindex der Zusatzspalte `name`; legt Kopfzeile und Textformat an, wenn sie fehlt.
 * Nur innerhalb der Sperre aufrufen.
 */
function ensureExtraColumn_(name) {
  name = String(name == null ? '' : name).trim();
  if (!name) throw new Error('Der Name der Zusatzspalte fehlt.');
  if (DATA_HEADERS.indexOf(name) >= 0) throw new Error('„' + name + '“ ist schon eine feste Spalte im Blatt Daten. Bitte einen anderen Namen wählen.');
  const headers = dataHeaders_();
  const idx = headers.indexOf(name, NCOL);
  if (idx >= 0) return idx;
  const sh = sheet_(SHEETS.data);
  const col = headers.length; // 0-basiert, hinten anhängen
  ensureCols_(sh, col + 1);
  // erst Textformat, dann der Name: sonst macht Sheets aus „01.10.2025“, „1,5“ oder „WAHR“ ein Datum, eine Zahl
  // oder einen Wahrheitswert, und der Name passt beim Lesen nicht mehr
  sh.getRange(1, col + 1).setNumberFormat('@').setValue(name).setFontWeight('bold').setBackground('#f1f3f4');
  if (sh.getMaxRows() > 1) sh.getRange(2, col + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  return col;
}

/**
 * Löscht eine Zusatzspalte samt Inhalt (z. B. beim Zurücknehmen eines Imports).
 * Achtung: Zeilen, die vorher gelesen wurden, sind danach verschoben. Nur innerhalb der Sperre.
 * Liefert true, wenn gelöscht.
 */
function deleteExtraColumn_(name) {
  const headers = dataHeaders_();
  const idx = headers.indexOf(String(name == null ? '' : name).trim(), NCOL);
  if (idx < NCOL) return false;
  sheet_(SHEETS.data).deleteColumn(idx + 1);
  return true;
}

/** Objektansicht einer Daten-Zeile: alle COL-Felder plus extras {Name: Wert}. */
function rowObj_(r, headers) {
  headers = headers || dataHeaders_();
  const o = {};
  Object.keys(COL).forEach(function (k) {
    const v = r[COL[k]];
    o[k] = v === undefined || v === null ? '' : v;
  });
  o.extras = {};
  for (let c = NCOL; c < headers.length; c++) {
    if (headers[c]) o.extras[headers[c]] = r[c] === undefined || r[c] === null ? '' : r[c];
  }
  return o;
}

/** Gegenstück zu rowObj_: Objekt -> Zeile (Array) mit Breite max(width, Kopfzeile). */
function objToRow_(o, width, headers) {
  headers = headers || dataHeaders_();
  width = Math.max(width || 0, NCOL, headers.length);
  const r = new Array(width).fill('');
  Object.keys(COL).forEach(function (k) {
    if (o[k] !== undefined && o[k] !== null) r[COL[k]] = o[k];
  });
  const ex = o.extras || {};
  Object.keys(ex).forEach(function (name) {
    const c = headers.indexOf(name, NCOL);
    if (c >= 0) r[c] = ex[name] == null ? '' : ex[name];
  });
  return r;
}

function padRow_(r, width) {
  const out = r.slice(0, Math.max(width, r.length));
  while (out.length < width) out.push('');
  return out;
}

/**
 * Volle Daten-Zeile aus einer Kartenzusammenfassung.
 * card: Form von summarizeCard_ plus {price, priceDate, setDate, dataLang 'de'|'en', inputName, nameEn?, img?, variant?}
 *       oder freie Karte {free: true, name, setName, localId}.
 * opts: {variant ('base' = Grundvariante), cond, lang, version, count (Standard 1), origin (Standard 'Hand'), fp,
 *        ownPrice, ownPriceDate, extras {Name: Wert}, now, eid, headers, width}
 * Zusatzspalten müssen vorher mit ensureExtraColumn_ angelegt sein (sonst wird der Wert ignoriert).
 */
function buildCardRow_(card, opts) {
  card = card || {};
  opts = opts || {};
  const headers = opts.headers || dataHeaders_();
  const now = opts.now || new Date();
  const o = { extras: opts.extras || {} };
  if (card.free) {
    const num = String(card.localId == null ? '' : card.localId).trim();
    const m = num.match(/^(.*?)\s*\/\s*(\d+)$/);
    const lid = m ? m[1].trim() : num;
    o.id = ''; o.setId = ''; o.setDate = '';
    o.setName = String(card.setName == null ? '' : card.setName).trim();
    o.localId = lid;
    o.normNum = normalizeNumber_(lid);
    o.setSize = m ? Number(m[2]) : (Number(card.setSize) || '');
    o.name = String(card.name == null ? '' : card.name).trim();
    o.nameEn = '';
    o.source = 'frei';
    o.price = ''; o.priceDate = ''; o.img = ''; o.rarity = ''; o.category = ''; o.illustrator = '';
    o.numSort = numSortOf_(lid);
  } else {
    const dataLang = (card.dataLang || card.lang) === 'en' ? 'en' : 'de';
    const inputName = String(card.inputName || '').trim();
    o.id = String(card.id || '');
    o.setId = String(card.setId || '');
    o.setName = String(card.setName || card.setId || '');
    o.setDate = card.setDate ? String(card.setDate) : '';
    o.localId = String(card.localId == null ? '' : card.localId);
    o.normNum = normalizeNumber_(o.localId);
    o.setSize = card.setSize ? Number(card.setSize) : '';
    o.name = dataLang === 'en' && inputName ? inputName : String(card.name || '');
    o.nameEn = card.nameEn ? String(card.nameEn) : (dataLang === 'en' ? String(card.name || '') : '');
    o.source = dataLang === 'en' ? 'en-Ersatz' : 'de';
    o.price = typeof card.price === 'number' && isFinite(card.price) ? card.price : '';
    o.priceDate = card.priceDate ? String(card.priceDate) : '';
    o.img = String(card.img || card.image || '');
    o.rarity = String(card.rarity || '');
    o.category = String(card.category || '');
    o.illustrator = String(card.illustrator || '');
    o.numSort = numSortOf_(o.localId);
  }
  let variant = String(opts.variant || card.variant || '');
  if (!variant || variant === 'base' || !VARIANT_LABELS[variant]) variant = VARIANT_LABELS[card.baseVariant] ? card.baseVariant : 'normal';
  o.variant = variant;
  o.cond = condCode_(opts.cond) || '';
  o.lang = langCode_(opts.lang);
  o.version = versionText_(opts.version);
  o.count = opts.count == null || opts.count === '' ? 1 : Math.max(0, Math.floor(Number(opts.count) || 0));
  const own = parsePrice_(opts.ownPrice);
  o.ownPrice = own != null && !isNaN(own) && own > 0 ? Math.round(own * 100) / 100 : '';
  o.ownPriceDate = o.ownPrice === '' ? '' : String(opts.ownPriceDate || todayText_());
  o.origin = opts.origin ? String(opts.origin) : ORIGIN_HAND;
  o.fp = opts.fp ? String(opts.fp) : '';
  o.eid = opts.eid || newEid_();
  o.added = now;
  o.changed = now;
  o.key = entryKey_(o);
  return objToRow_(o, opts.width, headers);
}

/** Zahlenformate einer Daten-Zeile (für setNumberFormats). */
function dataFormatRow_(width) {
  const f = new Array(width).fill('@');
  f[COL.setSize] = '0';
  f[COL.count] = '0';
  f[COL.price] = EUR_FORMAT;
  f[COL.ownPrice] = EUR_FORMAT;
  f[COL.added] = DATE_TIME_FORMAT;
  f[COL.changed] = DATE_TIME_FORMAT;
  f[COL.numSort] = '0';
  return f;
}

function readData_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(NCOL, sh.getLastColumn());
  const readable = Math.min(width, sh.getMaxColumns());
  const rows = sh.getRange(2, 1, last - 1, readable).getValues();
  if (readable < width) rows.forEach(function (r) { while (r.length < width) r.push(''); });
  return rows;
}

function ensureRows_(sh, rowNeeded) {
  if (rowNeeded <= sh.getMaxRows()) return;
  sh.insertRowsAfter(sh.getMaxRows(), Math.max(200, rowNeeded - sh.getMaxRows()));
  applyDataFormats_(sh);
}

/** Viele Zeilen in einem Rutsch anhängen (innerhalb der Sperre). */
function appendDataRows_(rows) {
  if (!rows || !rows.length) return;
  const sh = sheet_(SHEETS.data);
  let width = Math.max(NCOL, dataHeaders_().length);
  rows.forEach(function (r) { width = Math.max(width, r.length); });
  ensureCols_(sh, width);
  const start = Math.max(2, sh.getLastRow() + 1);
  ensureRows_(sh, start + rows.length - 1);
  const block = rows.map(function (r) { return padRow_(r, width); });
  const fmt = dataFormatRow_(width);
  const range = sh.getRange(start, 1, block.length, width);
  range.setNumberFormats(block.map(function () { return fmt; }));
  range.setValues(block);
}

/**
 * Ersetzt alle Datenzeilen (unter der Kopfzeile) durch `rows` und leert, was darunter übrig bleibt.
 * Ein einziges setValues über den ganzen alten und neuen Bereich (übrige Zeilen werden mit leeren Zeilen
 * überschrieben): Bricht der Lauf ab, steht entweder alles Alte oder alles Neue da, nie beides.
 * Für Löschungen (z. B. Import zurücknehmen). Innerhalb der Sperre.
 */
function rewriteData_(rows) {
  rows = (rows || []).filter(isDataRow_);
  const sh = sheet_(SHEETS.data);
  let width = Math.max(NCOL, dataHeaders_().length, sh.getLastColumn());
  rows.forEach(function (r) { width = Math.max(width, r.length); });
  ensureCols_(sh, width);
  const n = Math.max(rows.length, sh.getLastRow() - 1);
  if (n <= 0) return;
  ensureRows_(sh, n + 1);
  const block = rows.map(function (r) { return padRow_(r, width); });
  while (block.length < n) block.push(new Array(width).fill(''));
  const fmt = dataFormatRow_(width);
  const range = sh.getRange(2, 1, n, width);
  range.setNumberFormats(block.map(function () { return fmt; }));
  range.setValues(block);
}

/**
 * Arbeitskopie des Datenblatts für Änderungen in der Sperre:
 * {sh, headers, width, rows, base (Anzahl gelesener Zeilen), dirty: {i}, removed: {i}, gk0: [Gruppenschlüssel beim Lesen]}.
 * Neue Zeilen werden mit storeAdd_ hinten an rows gehängt; storeSave_ schreibt alles zurück.
 */
function dataStore_() {
  const sh = sheet_(SHEETS.data);
  const headers = dataHeaders_();
  const rows = readData_(sh);
  let width = Math.max(NCOL, headers.length);
  rows.forEach(function (r) { width = Math.max(width, r.length); });
  rows.forEach(function (r) { while (r.length < width) r.push(''); });
  const gk0 = rows.map(function (r) { return isDataRow_(r) ? groupKey_(r) : ''; });
  return { sh: sh, headers: headers, width: width, rows: rows, base: rows.length, dirty: {}, removed: {}, gk0: gk0 };
}

/** Zeilen, die sich in der Arbeitskopie geändert haben (geändert, neu, gelöscht): Indizes aufsteigend. */
function storeTouchedIdx_(st) {
  const out = {};
  Object.keys(st.dirty).forEach(function (i) { out[i] = true; });
  Object.keys(st.removed).forEach(function (i) { out[i] = true; });
  for (let i = st.base; i < st.rows.length; i++) out[i] = true;
  return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
}

/** Gruppen, die eine Änderung betrifft: alter und neuer Gruppenschlüssel jeder geänderten Zeile. */
function storeTouchedGroups_(st) {
  const keys = {};
  storeTouchedIdx_(st).forEach(function (i) {
    if (st.gk0 && i < st.base && st.gk0[i]) keys[st.gk0[i]] = true;
    if (storeLive_(st, i)) keys[groupKey_(st.rows[i])] = true;
  });
  return Object.keys(keys);
}

/** Lebende Zeilen der Arbeitskopie (ohne gelöschte), wie sie nach storeSave_ im Blatt stehen. */
function storeLiveRows_(st) {
  return st.rows.filter(function (r, i) { return storeLive_(st, i); });
}

function storeAdd_(st, row) {
  st.rows.push(padRow_(row, st.width));
  return st.rows.length - 1;
}

function storeTouch_(st, i) {
  if (i < st.base) st.dirty[i] = true;
}

function storeRemove_(st, i) {
  st.removed[i] = true;
}

function storeLive_(st, i) {
  return !st.removed[i] && isDataRow_(st.rows[i]);
}

/** Zusatzspalte anlegen und die Arbeitskopie verbreitern. */
function storeEnsureExtra_(st, name) {
  const idx = ensureExtraColumn_(name);
  st.headers = dataHeaders_();
  const width = Math.max(st.width, st.headers.length, idx + 1);
  if (width > st.width) {
    st.width = width;
    st.rows.forEach(function (r) { while (r.length < width) r.push(''); });
  }
  return idx;
}

function storeFindEid_(st, eid) {
  eid = String(eid == null ? '' : eid).trim();
  if (!eid) return -1;
  for (let i = 0; i < st.rows.length; i++) {
    if (storeLive_(st, i) && String(st.rows[i][COL.eid]) === eid) return i;
  }
  return -1;
}

/** Zeile „von Hand“ mit diesem Eintragsschlüssel (berechnet aus den Feldern), außer `except`. */
function storeFindHand_(st, key, except) {
  for (let i = 0; i < st.rows.length; i++) {
    if (i === except || !storeLive_(st, i)) continue;
    const r = st.rows[i];
    if (isHandOrigin_(r[COL.origin]) && entryKey_(r) === key) return i;
  }
  return -1;
}

function storeGroupIdx_(st, gkey) {
  const out = [];
  for (let i = 0; i < st.rows.length; i++) {
    if (storeLive_(st, i) && groupKey_(st.rows[i]) === gkey) out.push(i);
  }
  return out;
}

function storeGroupCount_(st, gkey) {
  return storeGroupIdx_(st, gkey).reduce(function (s, i) { return s + (Number(st.rows[i][COL.count]) || 0); }, 0);
}

/** Schreibt die Arbeitskopie zurück: mit Löschungen in einem Rutsch, sonst nur geänderte und neue Zeilen. */
function storeSave_(st) {
  const anyRemoved = Object.keys(st.removed).some(function (i) { return Number(i) < st.base; });
  if (anyRemoved) {
    rewriteData_(st.rows.filter(function (r, i) { return !st.removed[i]; }));
    return;
  }
  ensureCols_(st.sh, st.width);
  const idx = Object.keys(st.dirty).map(Number).sort(function (a, b) { return a - b; });
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const block = [];
    for (let t = k; t <= j; t++) block.push(padRow_(st.rows[idx[t]], st.width));
    st.sh.getRange(idx[k] + 2, 1, block.length, st.width).setValues(block);
    k = j + 1;
  }
  const added = [];
  for (let i = st.base; i < st.rows.length; i++) if (!st.removed[i]) added.push(st.rows[i]);
  appendDataRows_(added);
}

/** Zeilen einer Gruppe ordnen: „von Hand“ zuerst, dann nach Hinzufügedatum. */
function timeOf_(x) {
  if (x instanceof Date) return x.getTime();
  if (x == null || x === '') return Infinity;
  const t = new Date(x).getTime();
  return isNaN(t) ? Infinity : t;
}

function orderGroupRows_(rows) {
  return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
    const ha = isHandOrigin_(a.r[COL.origin]) ? 0 : 1, hb = isHandOrigin_(b.r[COL.origin]) ? 0 : 1;
    return (ha - hb) || (timeOf_(a.r[COL.added]) - timeOf_(b.r[COL.added])) || (a.i - b.i);
  }).map(function (x) { return x.r; });
}

/**
 * Preis einer Gruppe: eigener Preis (erste Zahl, „von Hand“ zuerst, dann nach Hinzufügedatum),
 * sonst Trendpreis. -> {price, manual, ownPrice, ownDate, date}
 */
function groupPrice_(rows) {
  const ordered = orderGroupRows_(rows);
  for (let i = 0; i < ordered.length; i++) {
    const own = ordered[i][COL.ownPrice];
    if (typeof own === 'number' && isFinite(own)) {
      return { price: own, manual: true, ownPrice: own, ownDate: cellText_(ordered[i][COL.ownPriceDate]), date: '' };
    }
  }
  for (let i = 0; i < ordered.length; i++) {
    const pr = ordered[i][COL.price];
    if (typeof pr === 'number' && isFinite(pr)) {
      return { price: pr, manual: false, ownPrice: null, ownDate: '', date: cellText_(ordered[i][COL.priceDate]) };
    }
  }
  return { price: null, manual: false, ownPrice: null, ownDate: '', date: ordered.length ? cellText_(ordered[0][COL.priceDate]) : '' };
}

function langPos_(code) {
  for (let i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return i;
  return LANGS.length;
}

function condPos_(code) {
  const p = CONDITIONS.indexOf(String(code || ''));
  return p < 0 ? CONDITIONS.length : p;
}

/** "1× DE NM, 1× EN LP" (cond leer -> "2× DE"); leer, wenn keine Exemplare. */
function exemplareText_(rows) {
  const sums = {};
  const keys = [];
  rows.forEach(function (r) {
    const n = Number(r[COL.count]) || 0;
    if (n <= 0) return;
    const k = langCode_(r[COL.lang]) + '|' + String(r[COL.cond] || '');
    if (!(k in sums)) { sums[k] = 0; keys.push(k); }
    sums[k] += n;
  });
  keys.sort(function (a, b) {
    const pa = a.split('|'), pb = b.split('|');
    return (langPos_(pa[0]) - langPos_(pb[0])) || cmp_(pa[0], pb[0]) || (condPos_(pa[1]) - condPos_(pb[1])) || cmp_(pa[1], pb[1]);
  });
  return keys.map(function (k) {
    const p = k.split('|');
    return sums[k] + '× ' + p[0] + (p[1] ? ' ' + p[1] : '');
  }).join(', ');
}

/** Datenzeilen nach Gruppenschlüssel: [{gkey, idx: [Zeilenindizes]}] in der Reihenfolge des ersten Auftretens. */
function groupRows_(rows, skip) {
  const byKey = {};
  const list = [];
  rows.forEach(function (r, i) {
    if (!isDataRow_(r) || (skip && skip[i])) return;
    const g = groupKey_(r);
    if (!byKey[g]) { byKey[g] = { gkey: g, idx: [] }; list.push(byKey[g]); }
    byKey[g].idx.push(i);
  });
  return list;
}

/**
 * Variante als Code: Codes in beliebiger Schreibweise und Anzeigenamen ('Reverse Holo', '1. Edition',
 * 'Non Holo' …) -> normal/holo/reverse/firstEdition. Unbekannter Text bleibt, wie er ist.
 */
function variantCode_(x) {
  const raw = x == null ? '' : x;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return raw;
  const map = {
    'normal': 'normal', 'non holo': 'normal', 'non-holo': 'normal', 'nonholo': 'normal',
    'holo': 'holo',
    'reverse': 'reverse', 'reverse holo': 'reverse', 'reverse-holo': 'reverse', 'reverseholo': 'reverse', 'rev holo': 'reverse',
    'firstedition': 'firstEdition', 'first edition': 'firstEdition', '1. edition': 'firstEdition', '1.edition': 'firstEdition',
    '1st edition': 'firstEdition', 'erste edition': 'firstEdition'
  };
  return map[s] || raw;
}

/** Braucht Daten eine Reparatur (fehlende/doppelte Eintrag-ID, Variante als Anzeigename, veralteter Schlüssel)? */
function needsRepair_(rows) {
  const seen = {};
  return (rows || []).some(function (r) {
    if (!isDataRow_(r)) return false;
    const e = String(r[COL.eid] == null ? '' : r[COL.eid]).trim();
    if (!e || seen[e]) return true;
    seen[e] = true;
    if (variantCode_(r[COL.variant]) !== (r[COL.variant] == null ? '' : r[COL.variant])) return true;
    return String(r[COL.key]) !== entryKey_(r);
  });
}

/**
 * Repariert Zeilen nach Änderungen direkt im Blatt Daten: fehlende oder doppelte Eintrag-ID (z. B. kopierte Zeile)
 * -> neue ID; Sprache als Code ('' / 'de' / 'Deutsch' -> 'DE'); Zustand in Großbuchstaben ('nm' -> 'NM');
 * Variante als Code ('Reverse Holo' -> 'reverse'); leere Herkunft -> 'Hand'; veralteter Schlüssel -> neu berechnet.
 * Eine Zeile „von Hand“, die hier erst eine Eintrag-ID bekommt (z. B. von einer alten Web-App-Bereitstellung
 * angehängt oder von Hand kopiert), wird in die vorhandene Hand-Zeile mit demselben Schlüssel eingerechnet
 * (höchstens eine Hand-Zeile pro Eintrag). Dann wird Daten in einem Rutsch neu geschrieben und die
 * eingerechneten Zeilen fallen aus `rows` heraus.
 * Sonst schreibt es nur die betroffenen Zellen (bei vielen Korrekturen in einer Spalte als ein Block, z. B. nach
 * dem Einfügen vieler Zeilen; das hält onEdit schnell). Liefert die Anzahl der Korrekturen.
 */
function repairRows_(sh, rows) {
  const seen = {};
  const byCol = {};
  const fresh = {};
  let n = 0;
  function fix(i, c, v) {
    rows[i][c] = v;
    (byCol[c] = byCol[c] || []).push(i);
    n++;
  }
  rows.forEach(function (r, i) {
    if (!isDataRow_(r)) return;
    let e = String(r[COL.eid] == null ? '' : r[COL.eid]).trim();
    if (!e || seen[e]) { e = newEid_(); fix(i, COL.eid, e); fresh[i] = true; }
    seen[e] = true;
    const lang = r[COL.lang] == null ? '' : r[COL.lang];
    const lc = langCode_(lang);
    if (String(lang) !== lc) fix(i, COL.lang, lc);
    const cond = r[COL.cond] == null ? '' : r[COL.cond];
    const cc = condCode_(cond);
    if (cc != null && String(cond) !== cc) fix(i, COL.cond, cc);
    const variant = r[COL.variant] == null ? '' : r[COL.variant];
    const vc = variantCode_(variant);
    if (vc !== variant) fix(i, COL.variant, vc);
    if (String(r[COL.origin] == null ? '' : r[COL.origin]).trim() === '') fix(i, COL.origin, ORIGIN_HAND);
    const key = entryKey_(r);
    if (String(r[COL.key]) !== key) fix(i, COL.key, key);
  });
  // neue Hand-Zeilen in die vorhandene Hand-Zeile desselben Schlüssels einrechnen (ältere Zeilen zuerst als Ziel)
  const handAt = {};
  const merged = {};
  rows.forEach(function (r, i) {
    if (!isDataRow_(r) || fresh[i] || !isHandOrigin_(r[COL.origin])) return;
    if (!(r[COL.key] in handAt)) handAt[r[COL.key]] = i;
  });
  const now = new Date();
  rows.forEach(function (r, i) {
    if (!isDataRow_(r) || !fresh[i] || !isHandOrigin_(r[COL.origin])) return;
    const j = handAt[r[COL.key]];
    if (j == null) { handAt[r[COL.key]] = i; return; }
    const tgt = rows[j];
    tgt[COL.count] = (Number(tgt[COL.count]) || 0) + (Number(r[COL.count]) || 0);
    tgt[COL.changed] = now;
    if (typeof tgt[COL.ownPrice] !== 'number' && typeof r[COL.ownPrice] === 'number') {
      tgt[COL.ownPrice] = r[COL.ownPrice];
      tgt[COL.ownPriceDate] = r[COL.ownPriceDate];
    }
    for (let c = NCOL; c < Math.max(tgt.length, r.length); c++) {
      if (cellText_(tgt[c] == null ? '' : tgt[c]).trim() === '' && cellText_(r[c] == null ? '' : r[c]).trim() !== '') tgt[c] = r[c];
    }
    merged[i] = true;
    n++;
  });
  if (Object.keys(merged).length) {
    const keep = rows.filter(function (r, i) { return !merged[i]; });
    rewriteData_(keep);
    rows.length = 0;
    keep.forEach(function (r) { rows.push(r); });
    return n;
  }
  Object.keys(byCol).forEach(function (k) {
    const c = Number(k);
    const idx = byCol[c];
    if (idx.length <= 10) {
      idx.forEach(function (i) { sh.getRange(i + 2, c + 1).setValue(rows[i][c]); });
      return;
    }
    const lo = idx[0], hi = idx[idx.length - 1]; // aufsteigend gesammelt
    sh.getRange(lo + 2, c + 1, hi - lo + 1, 1).setValues(rows.slice(lo, hi + 1).map(function (r) { return [r[c]]; }));
  });
  return n;
}

/** Infos aus dem Blatt „Importe“: {Nr: {nr, sourceName, sourceId, status}}. */
function importInfo_() {
  const out = {};
  const sh = ss_().getSheetByName(SHEETS.imports);
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues();
  const h = vals[0].map(function (x) { return String(x).trim(); });
  const cNr = h.indexOf('Nr'), cSrc = h.indexOf('Quelle'), cId = h.indexOf('Quelle-ID'), cSt = h.indexOf('Status');
  if (cNr < 0) return out;
  for (let i = 1; i < vals.length; i++) {
    const nr = Number(vals[i][cNr]);
    if (!nr) continue;
    out[nr] = {
      nr: nr,
      sourceName: cSrc >= 0 ? String(vals[i][cSrc] || '') : '',
      sourceId: cId >= 0 ? String(vals[i][cId] || '') : '',
      status: cSt >= 0 ? String(vals[i][cSt] || '') : ''
    };
  }
  return out;
}

/** 'von Hand' oder '<Quelle>, Import <n>' (ohne Quellname: 'Import <n>'). */
function originLabel_(origin, info) {
  if (isHandOrigin_(origin)) return 'von Hand';
  const nr = importNrOf_(origin);
  if (nr == null) return String(origin);
  const i = info && info[nr];
  return i && i.sourceName ? i.sourceName + ', Import ' + nr : 'Import ' + nr;
}

// ---------------------------------------------------------------------------
// Umstellung des Datenblatts auf Version 2 (Eintrag-ID, Sprache, Herkunft …)
// ---------------------------------------------------------------------------

/**
 * Günstige Prüfung am Anfang jeder öffentlichen Funktion, die Daten liest oder schreibt. Eine stillgelegte Tabelle
 * nimmt nichts mehr an (z. B. aus einer Seite, die vor der Übernahme schon offen war), und älterer Code fasst Daten
 * in einem neueren Format nicht an.
 */
function ensureSchema_() {
  if (takenOverBy_()) throw new Error(takenOverText_());
  const stored = settingGet_('SCHEMA_VERSION');
  if (stored === SCHEMA_VERSION) return;
  if (Number(stored) > Number(SCHEMA_VERSION)) {
    throw new Error('Diese Seite läuft mit älterem Code als die Tabelle. Am Handy: am Computer die Web-App neu bereitstellen ' +
      '(Erweiterungen > Apps Script > Bereitstellen > Bereitstellungen verwalten > Bearbeiten > Neue Version). ' +
      'In der Seitenleiste: Bitte füge den Code der neueren Version wieder ein (Erweiterungen > Apps Script).');
  }
  migrateSchema_();
}

/**
 * Stellt das Blatt Daten auf Version 2 um (idempotent). Alte Zeilen bekommen Eintrag-ID, Sprache DE,
 * Herkunft 'Hand' und den neuen Schlüssel id|variant||cond|DE. Danach werden die Gruppen neu berechnet.
 */
function migrateSchema_() {
  const ss = ss_();
  withLock_(function () {
    let sh = ss.getSheetByName(SHEETS.data);
    let migrated = false;
    if (!sh) {
      setupDataSheet_(ss);
    } else {
      const lastCol = Math.min(sh.getLastColumn(), sh.getMaxColumns());
      const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); }) : [];
      if (head[COL.eid] === DATA_HEADERS[COL.eid]) {
        // schon Version 2: nur fehlende feste Kopfzeilen ergänzen, Zusatzspalten bleiben
        if (DATA_HEADERS.some(function (h, i) { return head[i] !== h; })) {
          ensureCols_(sh, NCOL);
          writeHeaders_(sh, DATA_HEADERS);
        }
      } else {
        // alte Spalten hinter den 23 festen (falls jemand welche angelegt hat) werden zu Zusatzspalten
        const oldExtras = [];
        for (let c = V1_NCOL; c < head.length; c++) if (head[c]) oldExtras.push({ c: c, name: head[c] });
        const last = sh.getLastRow();
        const readW = Math.min(Math.max(lastCol, V1_NCOL), sh.getMaxColumns());
        const old = last >= 2 ? sh.getRange(2, 1, last - 1, readW).getValues() : [];
        const headers = DATA_HEADERS.concat(oldExtras.map(function (x) { return x.name; }));
        const rows = [];
        old.forEach(function (r) {
          const fixed = r.slice(0, V1_NCOL);
          while (fixed.length < V1_NCOL) fixed.push('');
          if (!fixed.some(function (v) { return v !== '' && v != null; })) return; // leere Zeile
          const row = fixed.concat([newEid_(), 'DE', '', '', '', ORIGIN_HAND, '']);
          oldExtras.forEach(function (x) { row.push(r[x.c] === undefined ? '' : r[x.c]); });
          row[COL.key] = entryKey_(row);
          rows.push(row);
        });
        ensureCols_(sh, Math.max(headers.length, lastCol));
        // erst die Zeilen, dann die Kopfzeile: bricht es dazwischen ab, gilt das Blatt weiter als Version 1
        // und die Umstellung läuft beim nächsten Aufruf noch einmal
        rewriteData_(rows);
        sh.getRange(1, 1, 1, Math.max(headers.length, lastCol)).clearContent();
        writeHeaders_(sh, headers);
        applyDataFormats_(sh);
        migrated = true;
      }
    }
    settingSet_('SCHEMA_VERSION', SCHEMA_VERSION);
    rebuildGroups_();
    // Die alte Ansichtsformel las Daten!A2:W. Wird zum ersten Mal umgestellt (beim ersten Öffnen nach dem Einfügen
    // neuen Codes), gleich auf die neue Formel mit Gruppen wechseln. Suchfelder bleiben.
    if (migrated && ss.getSheetByName(SHEETS.view)) setupViewSheet_(ss, true);
  });
}

// ---------------------------------------------------------------------------
// 1b. Import-Protokoll (Blatt „Import-Protokoll“, versteckt) – gemeinsam mit Import.gs
// ---------------------------------------------------------------------------

/** Blatt holen oder mit Kopfzeile anlegen (versteckt). */
function protoSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.proto);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.proto);
    writeHeaders_(sh, PROTO_HEADERS);
    const n = sh.getMaxRows() - 1;
    if (n > 0) sh.getRange(2, 1, n, PROTO_HEADERS.length).setNumberFormats(
      Array.from({ length: n }, function () { return PROTO_FORMATS; }));
    sh.hideSheet();
  } else if (sh.getLastRow() === 0) {
    writeHeaders_(sh, PROTO_HEADERS);
  }
  return sh;
}

/**
 * Hängt Protokolleinträge an. entries: [{nr, type, eid, fp, qty, data, status ('erledigt' wenn leer), sourceId, logId?}].
 * Liefert die Log-IDs (in derselben Reihenfolge). Innerhalb der Sperre.
 */
function appendProto_(entries) {
  if (!entries || !entries.length) return [];
  const sh = protoSheet_();
  const now = new Date();
  const ids = [];
  const rows = entries.map(function (e) {
    const id = e.logId || newLogId_();
    ids.push(id);
    return [id, e.nr == null || e.nr === '' ? '' : Number(e.nr), String(e.type || ''), String(e.eid || ''),
      String(e.fp || ''), Number(e.qty) || 0, JSON.stringify(e.data == null ? {} : e.data),
      String(e.status || 'erledigt'), e.time || now, String(e.sourceId || '')];
  });
  const start = Math.max(2, sh.getLastRow() + 1);
  const needed = start + rows.length - 1;
  if (needed > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(500, needed - sh.getMaxRows()));
  const range = sh.getRange(start, 1, rows.length, PROTO_HEADERS.length);
  range.setNumberFormats(rows.map(function () { return PROTO_FORMATS; }));
  range.setValues(rows);
  return ids;
}

/** Alle Einträge: [{logId, nr, type, eid, fp, qty, data (Objekt), status, time, sourceId, row (1-basiert)}]. */
function readProto_() {
  const sh = ss_().getSheetByName(SHEETS.proto);
  if (!sh || sh.getLastRow() < 2) return [];
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, PROTO_HEADERS.length).getValues().forEach(function (r, i) {
    if (!r[0]) return;
    let data = {};
    try { data = r[6] ? JSON.parse(String(r[6])) : {}; } catch (e) { data = {}; }
    out.push({
      logId: String(r[0]), nr: r[1] === '' || r[1] == null ? null : Number(r[1]), type: String(r[2] || ''),
      eid: String(r[3] || ''), fp: String(r[4] || ''), qty: Number(r[5]) || 0, data: data,
      status: String(r[7] || ''), time: r[8], sourceId: String(r[9] || ''), row: i + 2
    });
  });
  return out;
}

/** Einträge mit diesen Log-IDs löschen. Liefert die Anzahl. Innerhalb der Sperre. */
function deleteProtoByIds_(ids) {
  if (!ids || !ids.length) return 0;
  const sh = ss_().getSheetByName(SHEETS.proto);
  if (!sh || sh.getLastRow() < 2) return 0;
  const want = {};
  ids.forEach(function (id) { want[String(id)] = true; });
  const n = sh.getLastRow() - 1;
  const w = PROTO_HEADERS.length;
  const vals = sh.getRange(2, 1, n, w).getValues();
  const hit = [];
  vals.forEach(function (r, i) { if (want[String(r[0])]) hit.push(i); });
  if (!hit.length) return 0;
  if (hit.length <= 5) {
    hit.slice().reverse().forEach(function (i) { sh.deleteRow(i + 2); });
    return hit.length;
  }
  const keep = vals.filter(function (r) { return !want[String(r[0])]; });
  if (keep.length) {
    const range = sh.getRange(2, 1, keep.length, w);
    range.setNumberFormats(keep.map(function () { return PROTO_FORMATS; }));
    range.setValues(keep);
  }
  sh.getRange(keep.length + 2, 1, n - keep.length, w).clearContent();
  return hit.length;
}

/** Status ('geplant' | 'erledigt' | 'übersprungen') für diese Log-IDs setzen. Innerhalb der Sperre. */
function setProtoStatus_(ids, status) {
  if (!ids || !ids.length) return 0;
  const sh = ss_().getSheetByName(SHEETS.proto);
  if (!sh || sh.getLastRow() < 2) return 0;
  const want = {};
  ids.forEach(function (id) { want[String(id)] = true; });
  const n = sh.getLastRow() - 1;
  const idCol = sh.getRange(2, 1, n, 1).getValues();
  const stRange = sh.getRange(2, 8, n, 1);
  const st = stRange.getValues();
  let changed = 0;
  idCol.forEach(function (r, i) {
    if (want[String(r[0])] && st[i][0] !== status) { st[i][0] = status; changed++; }
  });
  if (changed) stRange.setValues(st);
  return changed;
}

// ---------------------------------------------------------------------------
// 1c. Einstellungen (verstecktes Blatt „Tool-Einstellungen“) und Stilllegen nach einer Übernahme
// ---------------------------------------------------------------------------
// Dauerhafte Einstellungen gehören zur Tabelle, nicht zum Skript: Eine Kopie (Vorlage, neue Version) bringt sie mit,
// und ein späteres Add-on kann sie lesen. In den Skript-Eigenschaften bleiben nur laufende Vorgänge (Preislauf,
// Import) und SPREADSHEET_ID, die die Web-App braucht, bevor sie die Tabelle kennt.

const SETTINGS_HEADERS = ['Schlüssel', 'Wert'];
const SETTING_SHEET_ID = 'Tabellen-ID';
/** Gelten nur für genau diese Tabelle. In einer Kopie lesen sie sich leer und werden beim ersten Schreiben gelöscht. */
const SETTINGS_LOCAL = ['WEBAPP_URL', 'NEW_COPY_URL', 'NEW_COPY_VERSION', 'TAKE_FROM', 'TAKE_RUN',
  'TAKEN_OVER_BY', 'TAKEN_OVER_AT', 'TAKEN_OVER_SHEET', 'TAKEN_FROM', 'TAKEN_AT', 'SETUP_AT', 'NIGHTLY_AT', 'FILE_VERSIONS'];
/** Standen früher in den Skript-Eigenschaften; settingGet_ liest dort weiter, bis sie im Blatt stehen. */
const SETTINGS_FROM_PROPS = ['SCHEMA_VERSION', 'WEBAPP_URL', 'VIEW_EXTRAS'];
/** Auslöser des Tools. Die Namen bleiben über alle Versionen gleich, sonst laufen alte Auslöser ins Leere. */
const TRIGGER_HANDLERS = ['naechtlicherPreislauf', 'continuePriceRun', 'beiStrukturAenderung'];

let settingsCache_ = null;

/** Einstellungen dieser Ausführung: {map, exists, copy}. copy = das Blatt stammt aus einer anderen Tabelle. */
function settingsAll_() {
  if (settingsCache_) return settingsCache_;
  const ss = ss_();
  const sh = ss.getSheetByName(SHEETS.settings);
  const map = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = String(r[0] == null ? '' : r[0]).trim();
      if (k && !(k in map)) map[k] = r[1] == null ? '' : String(r[1]);
    });
  }
  const stored = map[SETTING_SHEET_ID] || '';
  settingsCache_ = { map: map, exists: !!sh, copy: !!(stored && stored !== ss.getId()) };
  return settingsCache_;
}

/** Wert als Text, '' wenn er fehlt. */
function settingGet_(key) {
  const all = settingsAll_();
  if (all.copy && SETTINGS_LOCAL.indexOf(key) >= 0) return '';
  if (key in all.map) return all.map[key];
  if (!all.copy && SETTINGS_FROM_PROPS.indexOf(key) >= 0) {
    return PropertiesService.getScriptProperties().getProperty(key) || '';
  }
  return '';
}

function settingSet_(key, value) {
  const o = {};
  o[key] = value;
  settingsSetMany_(o);
}

/** Mehrere Einstellungen schreiben ('' leert einen Wert). Eine Kopie wird dabei zu einer eigenen Tabelle. */
function settingsSetMany_(obj) {
  const ss = ss_();
  const wasCopy = writeSettings_(ss, obj || {});
  if (wasCopy) PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  settingsCache_ = null;
}

/** Diese Tabelle ist eine Kopie (Vorlage, neue Version, „Kopie erstellen“): lokale Einstellungen der alten löschen. */
function adoptCopy_() {
  settingsSetMany_({});
}

function settingsSheet_(ss) {
  let sh = ss.getSheetByName(SHEETS.settings);
  if (sh) return sh;
  sh = ss.insertSheet(SHEETS.settings);
  writeHeaders_(sh, SETTINGS_HEADERS);
  sh.getRange(2, 1, 1, 2).setNumberFormat('@').setValues([[SETTING_SHEET_ID, ss.getId()]]);
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 420);
  sh.protect().setDescription('Wird nur vom Skript beschrieben').setWarningOnly(true);
  sh.hideSheet();
  return sh;
}

/**
 * Einstellungen in eine Tabelle schreiben (auch eine andere, z. B. neue Kopie oder alte Tabelle). Setzt dabei die
 * Tabellen-ID; stammte das Blatt aus einer anderen Tabelle, werden dessen lokale Werte geleert. -> war es eine Kopie
 */
function writeSettings_(ss, obj) {
  const sh = settingsSheet_(ss);
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  const idx = {};
  vals.forEach(function (r, i) {
    const k = String(r[0] == null ? '' : r[0]).trim();
    if (k && !(k in idx)) idx[k] = i;
  });
  const id = ss.getId();
  const isCopy = idx[SETTING_SHEET_ID] !== undefined && String(vals[idx[SETTING_SHEET_ID]][1]) !== id;
  if (isCopy) SETTINGS_LOCAL.forEach(function (k) { if (idx[k] !== undefined) vals[idx[k]][1] = ''; });
  const put = function (k, v) {
    v = v == null ? '' : String(v);
    if (idx[k] === undefined) { idx[k] = vals.length; vals.push([k, v]); } else vals[idx[k]][1] = v;
  };
  put(SETTING_SHEET_ID, id);
  Object.keys(obj).forEach(function (k) { put(k, obj[k]); });
  if (sh.getMaxRows() < vals.length + 1) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, vals.length, 2).setNumberFormat('@').setValues(vals);
  return isCopy;
}

/**
 * Werte aus den alten Skript-Eigenschaften ins Blatt übernehmen (Einrichtung, Update). Legt das Blatt an.
 * prevId: SPREADSHEET_ID, bevor setupAll_ sie überschrieben hat (sonst die gespeicherte).
 */
function migrateSettingsFromProps_(prevId) {
  const all = settingsAll_();
  if (all.copy) { adoptCopy_(); return; }
  const props = PropertiesService.getScriptProperties();
  const pid = prevId != null ? String(prevId) : (props.getProperty('SPREADSHEET_ID') || '');
  // „Kopie erstellen“ einer Tabelle vor 1.0: Die Skript-Eigenschaften kommen mit und nennen die andere Tabelle.
  // Deren lokale Werte (Web-App-Link) gelten hier nicht, und eingerichtet ist die Kopie auch nicht (keine Auslöser).
  const foreign = !!pid && pid !== ss_().getId();
  const add = {};
  SETTINGS_FROM_PROPS.forEach(function (k) {
    const v = props.getProperty(k);
    if (foreign && SETTINGS_LOCAL.indexOf(k) >= 0) return;
    if (v && !(k in all.map)) add[k] = v;
  });
  if (foreign && !('WEBAPP_URL' in all.map)) add.WEBAPP_URL = ''; // sonst liest settingGet_ weiter den alten Link
  // Code vor 1.0 kannte CODE_VERSION nicht; hat seine Einrichtung hier SPREADSHEET_ID oder SCHEMA_VERSION
  // hinterlassen, ist diese Tabelle schon eingerichtet (Auslöser und Sets nicht noch einmal)
  const legacy = !foreign && !all.map.CODE_VERSION && (props.getProperty('SCHEMA_VERSION') || pid === ss_().getId());
  if (legacy && !all.map.SETUP_AT) add.SETUP_AT = 'vor 1.0';
  if (Object.keys(add).length || !all.exists) settingsSetMany_(add);
}

/** Link der neuen Tabelle, wenn diese hier übernommen und stillgelegt wurde, sonst ''. */
function takenOverBy_() {
  try { return settingGet_('TAKEN_OVER_BY'); } catch (e) { return ''; }
}

/** Stilllegen: die Auslöser des Tools löschen (die des eigenen Kontos; fremde hören beim nächsten Lauf hier auf). */
function stopTriggers_() {
  TRIGGER_HANDLERS.forEach(function (fn) { deleteTriggersFor_(fn); });
}

function htmlEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function takenOverText_() {
  const at = settingGet_('TAKEN_OVER_AT');
  return 'Diese Tabelle wurde ' + (at ? 'am ' + at + ' ' : '') + 'in eine neue Tabelle übernommen. ' +
    'Bitte mach nur noch dort weiter. Die Daten hier bleiben zum Nachsehen.';
}

/** Menüpunkt einer stillgelegten Tabelle. */
function uebernommenHinweis() {
  alert_(takenOverText_() + '\n\n' + takenOverBy_());
}

/** Seite für Seitenleiste und Web-App (web) einer stillgelegten Tabelle. Die Web-App verlinkt die neue Handy-Seite. */
function takenOverPage_(web) {
  const url = takenOverBy_();
  let more = '';
  if (web) {
    let app = '', closed = false;
    try { app = updReadSettings_(SpreadsheetApp.openByUrl(url)).map.WEBAPP_URL || ''; } catch (e) { closed = true; }
    more = /^https:\/\/script\.google\.com\//.test(app)
      ? '<br><br><a target="_top" href="' + htmlEsc_(app) + '">Zur neuen Handy-Seite</a> (bitte als Lesezeichen speichern)'
      : closed
        ? '<br><br>Die neue Tabelle lässt sich von hier nicht öffnen. Hast du noch keinen Zugriff, frag bitte die Person, der sie gehört, ob sie sie mit dir teilt.'
        : '<br><br>Die neue Tabelle hat noch keine Handy-Seite. Am Computer in der neuen Tabelle: Erweiterungen > Apps Script > Bereitstellen > Neue Bereitstellung > Web-App, dann Pokémon > Web-App-Link anzeigen.';
  }
  return HtmlService.createHtmlOutput('<div style="font-family:Roboto,Arial,sans-serif;font-size:15px;padding:16px;line-height:1.5">' +
    htmlEsc_(takenOverText_()) + '<br><br><a target="_top" href="' + htmlEsc_(url) + '">Zur neuen Tabelle</a>' + more + '</div>')
    .setTitle('Pokémon-Sammlung');
}

/**
 * Nach einem Update von Hand (oder nach Einfügen älteren Codes) einmal die Blätter auf den Stand dieses Codes bringen, ohne Auslöser
 * und ohne tcgdex-Abruf. onlyUpgrade (Web-App): nie auf eine ältere Version zurückbauen. Eine Web-App-Bereitstellung
 * läuft mit fester Version, Seitenleiste und Auslöser immer mit dem neuesten Code. -> true, wenn etwas lief
 */
function upgradeIfNeeded_(onlyUpgrade) {
  const code = settingGet_('CODE_VERSION');
  if (code === TOOL_VERSION) return false;
  if (onlyUpgrade && codeIsNewer_(code)) return false;
  const what = 'Update auf Version ' + TOOL_VERSION;
  const step = onlyUpgrade ? null : busySteps_(what, 5); // die Web-App zeigt keine Meldungen
  try {
    if (step) step('Daten prüfen');
    ensureSchema_();
    migrateSettingsFromProps_();
    setupSheets_(ss_(), true, step);
  } catch (e) {
    if (step) notifyDone_(what + ' abgebrochen: ' + e.message);
    throw e;
  }
  settingsSetMany_({ CODE_VERSION: TOOL_VERSION, TOOL_SHEETS: JSON.stringify(toolSheetNames_()) });
  if (step) notifyDone_(what + ' fertig.');
  return true;
}

/** Läuft in der Tabelle schon neuerer Code als dieser (z. B. eine Web-App, die noch nicht neu bereitgestellt ist)? */
function codeIsNewer_(version) {
  return !!version && updCompare_(version, TOOL_VERSION) > 0;
}

/**
 * Wurde diese Tabelle noch nie eingerichtet (Auslöser, Sets)? SETUP_AT gilt nur für diese Tabelle: Wird eine frische
 * Kopie schon vor der Seitenleiste zu einer eigenen Tabelle (z. B. Web-App-Link gespeichert), bleibt es leer.
 */
function needsSetup_() {
  return !settingGet_('SETUP_AT');
}

/** Eine frische Kopie (Vorlage oder „Kopie erstellen“), die noch keine eigene Tabelle ist. */
function isFreshCopy_() {
  return settingsAll_().copy;
}

/**
 * Alle Blätter, die dieser Code anlegt (ohne das Hinweisblatt einer Übernahme). Steht als TOOL_SHEETS in den
 * Einstellungen: Eine spätere Version erkennt daran bei der Übernahme, welche Blätter dem Nutzer gehören, auch wenn
 * sie selbst ein neues Blatt mit gleichem Namen hat.
 */
function toolSheetNames_() {
  const out = [];
  const add = function (n) { if (n && out.indexOf(n) < 0) out.push(n); };
  Object.keys(SHEETS).forEach(function (k) { if (k !== 'takenOver') add(SHEETS[k]); });
  Object.keys(IMP_SHEETS).forEach(function (k) { add(IMP_SHEETS[k]); });
  add('Diagnose');
  return out;
}

// ---------------------------------------------------------------------------
// 2. Menü, Sidebar, Web-App, onEdit
// ---------------------------------------------------------------------------

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  if (takenOverBy_()) {
    ui.createMenu('Pokémon').addItem('Diese Tabelle wurde übernommen', 'uebernommenHinweis')
      .addItem('Diese Tabelle wieder benutzen', 'wiederBenutzen').addToUi();
    return;
  }
  const menu = ui.createMenu('Pokémon')
    .addItem('Karten erfassen', 'kartenErfassen')
    .addItem('Einsortieren', 'einsortieren')
    .addItem('Dashboard', 'zumDashboard')
    .addItem('Preise jetzt aktualisieren', 'preiseJetztAktualisieren')
    .addItem('Übersetzung und Sets aktualisieren', 'uebersetzungUndSetsAktualisieren')
    .addSeparator();
  menu.addSubMenu(ui.createMenu('Updates')
    .addItem('Nach Updates suchen', 'updatesAnzeigen')
    .addItem('Aus alter Tabelle übernehmen', 'uebernahmeAnzeigen'));
  menu
    .addItem('Ansicht neu aufbauen', 'ansichtNeuAufbauen')
    .addItem('API prüfen', 'apiPruefen')
    .addItem('Web-App-Link anzeigen', 'webAppLinkAnzeigen')
    .addToUi();
  // Startseite ist das Dashboard (Google öffnet sonst das zuletzt offene Blatt); ein verstecktes bleibt versteckt
  showDashboard_();
  try { fileVersionToast_(); } catch (e) { /* nur ein Hinweis */ }
}

/** Seitenleiste (mit Import-Tab). Ui.html ist eine Vorlage: `mode` steuert, was sie zeigt, `start` den ersten Tab. */
function kartenErfassen(start) {
  const ui = SpreadsheetApp.getUi();
  const gone = missingFilesText_();
  if (gone) { alert_(gone); return; }
  if (takenOverBy_()) { ui.showSidebar(takenOverPage_()); return; }
  if (isFreshCopy_()) {
    // frische Kopie der Vorlage: einmal alles einrichten, auch die Auslöser
    if (!setupAll_()) return;
  } else {
    upgradeIfNeeded_();
    if (needsSetup_()) {
      if (!setupAll_()) return;
    } else {
      repairSetup_();
    }
  }
  const t = HtmlService.createTemplateFromFile('Ui');
  t.mode = 'sidebar';
  t.start = ['upd', 'takeover', 'import'].indexOf(start) >= 0 ? start : ''; // Menü und Knöpfe rufen ohne Argument auf
  // von „Neue Version holen“ angelegt und noch leer (oder eine Übernahme brach ab): gleich die Übernahme zeigen
  if (!t.start || t.start === 'import') {
    try { if (updPendingTake_()) t.start = 'takeover'; } catch (e) { /* normaler Start */ }
  }
  ui.showSidebar(t.evaluate().setTitle('Pokémon-Karten'));
}

/** Menü Updates: Seitenleiste mit dem Bereich Updates. */
function updatesAnzeigen() {
  kartenErfassen('upd');
}

/** Menü Updates: Seitenleiste mit der Übernahme aus einer alten Tabelle. */
function uebernahmeAnzeigen() {
  kartenErfassen('takeover');
}

/** Knopf „Importieren“ im Dashboard: Seitenleiste gleich im Bereich Import. */
function importAnzeigen() {
  kartenErfassen('import');
}

function doGet() {
  const gone = missingFilesText_();
  if (gone) return infoPage_(gone);
  if (takenOverBy_()) return takenOverPage_(true).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // Einrichten (mit Auslösern) nur über die Seitenleiste, sonst fehlt der nächtliche Preislauf
  if (isFreshCopy_()) return newSheetPage_();
  upgradeIfNeeded_(true);
  if (needsSetup_()) return newSheetPage_();
  const t = HtmlService.createTemplateFromFile('Ui');
  t.mode = 'web';
  t.start = '';
  return t.evaluate()
    .setTitle('Pokémon-Sammlung')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function newSheetPage_() {
  return infoPage_('Diese Tabelle ist neu. Bitte öffne sie einmal am Computer und klicke auf Pokémon > Karten erfassen. Danach funktioniert die Handy-Seite.');
}

/** Handy-Seite mit nur einem Hinweis (Text, wird escaped) */
function infoPage_(text) {
  return HtmlService.createHtmlOutput('<div style="font-family:Roboto,Arial,sans-serif;font-size:15px;padding:16px;line-height:1.5">' +
    htmlEsc_(text) + '</div>').setTitle('Pokémon-Sammlung').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Versionen der Script-Dateien (#35): Wer von Hand aktualisiert, fügt fünf Dateien ein. Bleibt eine alt oder fehlt sie,
// passen die Teile nicht mehr zusammen. Jede Datei trägt ihre Version (Code.gs: TOOL_VERSION, sonst *_FILE_VERSION;
// tools/release.js schreibt sie mit dem Kopf). Die .gs-Dateien liest Code.gs hier, die HTML-Dateien meldet die Seite
// selbst (getFileVersions). Version 'alt': Datei da, aber älter als 1.1.2 (ohne Konstante); null: Datei fehlt.
const FILE_NAMES = ['Code.gs', 'Update.gs', 'Import.gs', 'Ui.html', 'ImportUi.html'];

/** Versionen der .gs-Dateien -> {'Code.gs': .., 'Update.gs': .., 'Import.gs': ..} */
function gsFileVersions_() {
  return {
    'Code.gs': TOOL_VERSION,
    'Update.gs': typeof UPDATE_FILE_VERSION !== 'undefined' ? UPDATE_FILE_VERSION : (typeof getUpdateInfo === 'function' ? 'alt' : null),
    'Import.gs': typeof IMPORT_FILE_VERSION !== 'undefined' ? IMPORT_FILE_VERSION : (typeof importState === 'function' ? 'alt' : null)
  };
}

/**
 * Fehlt eine .gs-Datei ganz, läuft das Tool nicht: Statt vieler Abfragen „gibt es Import.gs?“ im Code prüfen Seitenleiste
 * und Handy-Seite das einmal beim Start (#36 B2). -> Hinweis für den Nutzer oder ''
 */
function missingFilesText_() {
  const gs = gsFileVersions_();
  const gone = Object.keys(gs).filter(function (n) { return gs[n] === null; });
  if (!gone.length) return '';
  return (gone.length === 1 ? 'Die Script-Datei ' + gone[0] + ' fehlt.' : 'Die Script-Dateien ' + gone.join(' und ') + ' fehlen.') +
    ' Bitte am Computer unter Erweiterungen > Apps Script alle Dateien aus Version ' + TOOL_VERSION + ' einfügen und speichern.';
}

/** Versionsangabe aus der Seite: Versionsnummer, 'alt' oder null */
function fileVersionOf_(v) {
  if (v === 'alt') return 'alt';
  return typeof v === 'string' && /^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/.test(v) && v.length <= 30 ? v : null;
}

/** 1.1.2 vor 1.1.10, eine Vorabversion (1.2.0-beta.1) vor ihrer fertigen Version */
function fileVerCmp_(a, b) {
  const p = function (v) { const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v); return m ? [+m[1], +m[2], +m[3], m[4]] : null; };
  const x = p(a), y = p(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (!x[3] || !y[3]) return x[3] ? -1 : 1;
  return x[3] < y[3] ? -1 : 1;
}

/**
 * Alle Dateien mit Version; ui: Versionen der HTML-Dateien aus der Seite (ohne ui nur die .gs-Dateien). Fehlt
 * ImportUi.html in ui (die Handy-Seite hat den Import-Teil nicht, #36 A3), liest der Server die Datei selbst.
 * -> {files: [{name, version}], newest, odd: [Namen, die nicht die neueste Version haben oder fehlen]}
 */
function fileVersionReport_(ui) {
  const gs = gsFileVersions_();
  const names = FILE_NAMES.filter(function (n) { return ui || n in gs; });
  const files = names.map(function (n) {
    const v = n in gs ? gs[n] : n === 'ImportUi.html' && !(n in ui) ? importUiFileVersion_() : fileVersionOf_(ui[n]);
    return { name: n, version: v };
  });
  let newest = '';
  files.forEach(function (f) { if (f.version && f.version !== 'alt' && fileVerCmp_(f.version, newest) > 0) newest = f.version; });
  const odd = files.filter(function (f) { return f.version !== newest; }).map(function (f) { return f.name; });
  return { files: files, newest: newest, odd: odd };
}

/** Version von ImportUi.html aus der Datei selbst: Versionsnummer, 'alt' (ohne impFileVersion) oder null (fehlt) */
function importUiFileVersion_() {
  const text = include('ImportUi');
  if (!text) return null;
  const m = /\bimpFileVersion\s*=\s*'([^']*)'/.exec(text); // so geschrieben, dass tools/release.js hier nichts stempelt
  return m ? fileVersionOf_(m[1]) : 'alt';
}

/** 'Code.gs 1.1.2, Update.gs älter als 1.1.2, Import.gs fehlt' */
function fileVersionText_(files) {
  return files.map(function (f) {
    return f.name + ' ' + (f.version === 'alt' ? 'älter als 1.1.2' : f.version || 'fehlt');
  }).join(', ');
}

/**
 * Für die Seitenleiste und die Handy-Seite (#35). ui = {'Ui.html': Version, 'ImportUi.html': Version|'alt'|null}.
 * Merkt sich das Ergebnis in Tool-Einstellungen (FILE_VERSIONS), so sieht man es auch ohne Seitenleiste.
 * -> fileVersionReport_
 */
function getFileVersions(ui) {
  const rep = fileVersionReport_(ui && typeof ui === 'object' ? ui : {});
  const text = fileVersionText_(rep.files) + (rep.odd.length ? ' – passt nicht zusammen' : '');
  try {
    if (!settingsAll_().copy && settingGet_('FILE_VERSIONS') !== text) settingSet_('FILE_VERSIONS', text);
  } catch (e) { /* nur zur Info */ }
  return rep;
}

/** Beim Öffnen der Tabelle: passen die .gs-Dateien nicht zusammen, eine Meldung unten rechts. */
function fileVersionToast_() {
  const rep = fileVersionReport_(null);
  if (!rep.odd.length) return;
  SpreadsheetApp.getActive().toast('Die Script-Dateien passen nicht zusammen: ' + fileVersionText_(rep.files) +
    '. Bitte alle Dateien aus derselben Version einfügen (Erweiterungen > Apps Script).', 'Pokémon · Versionen', 30);
}

/** Für den Aufruf include('ImportUi') in der Vorlage Ui.html. Fehlt die Datei noch, bleibt die Stelle leer. */
function include(name) {
  try {
    return HtmlService.createHtmlOutputFromFile(name).getContent();
  } catch (e) {
    return '';
  }
}

/**
 * Zeigt den Web-App-Link. ScriptApp.getService().getUrl() liefert aus dem Sheet heraus
 * den Link der Test-Bereitstellung, nicht den der echten. Deshalb wird der echte Link
 * einmal eingefügt und in den Script Properties gespeichert.
 */
function webAppLinkAnzeigen() {
  const saved = settingGet_('WEBAPP_URL');
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
  settingSet_('WEBAPP_URL', url);
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

/**
 * Einfacher Trigger: Zeilenhöhe an den Bilder-Schalter anpassen (Sammlung) bzw. an die gewählten Karten (Pokédex);
 * nach Änderungen im Blatt Daten die Gruppen (und damit die Sammlung) neu berechnen, nach Änderungen im Blatt Sets
 * dessen Zwischenspeicher vergessen. Ist das Sheet gerade beschäftigt, passiert nichts.
 */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    const name = sh.getName();
    if (name === SHEETS.data) { rebuildAfterEdit_(); return; }
    if (name === SHEETS.sets) { dropSetsCache_(); return; }
    if (name === SHEETS.dex) { if (e.range.getRow() === 4) applyDexRowHeights_(sh); return; }
    if (name !== SHEETS.view || e.range.getRow() !== 4) return;
    // nur der Bilder-Schalter (H4) ändert die Zeilenhöhen; Suche, Set, Sortierung und 0er zeigen starten kein Skript (#39 V1)
    if (e.range.getColumn() <= 8 && e.range.getLastColumn() >= 8) applyRowHeights_(sh);
  } catch (err) { /* nie den Edit stören */ }
}

/**
 * Installierbarer Trigger „bei Änderung“ (legt Einrichtung an): Zeilen oder Spalten löschen bzw. einfügen
 * löst kein onEdit aus. Damit die Sammlung nach „Zeile löschen“ im Blatt Daten trotzdem stimmt, werden die
 * Gruppen neu berechnet. Ein leeres Einfügen von Zeilen ändert nichts und wird übergangen.
 */
function beiStrukturAenderung(e) {
  try {
    if (takenOverBy_()) { stopTriggers_(); return; }
    const type = String((e && e.changeType) || '');
    if (['REMOVE_ROW', 'REMOVE_COLUMN', 'INSERT_COLUMN', 'OTHER'].indexOf(type) < 0) return;
    rebuildAfterEdit_();
  } catch (err) { /* nie die Änderung stören */ }
}

function rebuildAfterEdit_() {
  if (settingGet_('SCHEMA_VERSION') !== SCHEMA_VERSION) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    rebuildGroups_();
    SpreadsheetApp.flush();
  } catch (err) {
    /* nie den Edit stören */
  } finally {
    lock.releaseLock();
  }
}

/**
 * Zeilenhöhen der Sammlung: mit Bildern alle Zeilen ab 6 hoch (90 px), sonst normal. Hängt nur am Bilder-Schalter,
 * nicht an den Treffern, und wartet deshalb nicht auf die Formel (#39 V1, #36 A7). Unter den Treffern stehen mit
 * Bildern leere, hohe Zeilen.
 */
function applyRowHeights_(sh) {
  sh = sh || ss_().getSheetByName(SHEETS.view);
  if (!sh) return;
  const show = sh.getRange('H4').getValue() === true;
  const max = sh.getMaxRows();
  if (max < 6) return;
  sh.setRowHeights(6, max - 5, show ? 90 : 21);
}

// ---------------------------------------------------------------------------
// 3. Einrichtung
// ---------------------------------------------------------------------------

/**
 * Alles einrichten: Datenformat, Einstellungen, Blätter, Auslöser, Sets und Übersetzung. Für eine frische Kopie der
 * Vorlage und eine Tabelle, die noch nie eingerichtet wurde (kartenErfassen). Zeigt das Ergebnis kurz unten rechts.
 * -> Text der Meldung, '' bei Abbruch
 */
function setupAll_() {
  const ss = ss_();
  if (Number(settingGet_('SCHEMA_VERSION')) > Number(SCHEMA_VERSION)) {
    // älterer Code als die Daten (z. B. eine alte Version von Hand eingefügt): nichts umbauen
    alert_('Diese Tabelle wurde schon mit einer neueren Version des Tools benutzt. Damit keine Daten verloren gehen, richtet dieser ältere Code hier nichts ein. ' +
      'Bitte füge den Code der neueren Version wieder ein (Erweiterungen > Apps Script).');
    return '';
  }
  const step = busySteps_('Einrichtung', 6);
  let dashMissing;
  try {
    step('Tabelle vorbereiten');
    const props = PropertiesService.getScriptProperties();
    const prevId = props.getProperty('SPREADSHEET_ID') || ''; // nennt sie eine andere Tabelle, ist das hier eine Kopie
    props.setProperty('SPREADSHEET_ID', ss.getId());
    if (settingsAll_().copy) adoptCopy_();
    try {
      migrateSchema_(); // vor setupDataSheet_, das die Kopfzeile neu schreibt
    } catch (e) {
      notifyDone_('Einrichtung abgebrochen.');
      alert_('Das Datenblatt konnte nicht auf das neue Format umgestellt werden (' + e.message + '). Es wurde nichts geändert.');
      return '';
    }
    migrateSettingsFromProps_(prevId);
    dashMissing = setupSheets_(ss, false, step);
    showDashboard_(); // eine neue Tabelle startet im Dashboard (#28)
    setupTriggers_();
  } catch (e) {
    notifyDone_('Einrichtung abgebrochen: ' + e.message);
    throw e;
  }
  settingsSetMany_({ CODE_VERSION: TOOL_VERSION, TOOL_SHEETS: JSON.stringify(toolSheetNames_()), SETUP_AT: Utilities.formatDate(new Date(), tz_(), 'dd.MM.yyyy HH:mm') });
  let msg = 'Einrichtung fertig.';
  if (dashMissing) msg += ' ' + DASH_LOAD_FAILED;
  try {
    step('Sets und Übersetzung von tcgdex laden');
    msg += ' ' + buildTranslationAndSets_();
  } catch (e) {
    msg += ' Sets und Übersetzung konnten nicht geladen werden (' + e.message + '). Bitte später „Pokémon > Übersetzung und Sets aktualisieren" starten.';
  }
  notifyDone_(msg);
  return msg;
}

/**
 * Alle Blätter des Tools anlegen bzw. auf den Stand dieses Codes bringen (ohne Auslöser, ohne tcgdex-Abruf).
 * keepControls: Suchfelder in Sammlung und Pokédex stehen lassen (Update); sonst wie bisher bei der Einrichtung.
 * step (optional, busySteps_): meldet die 4 Schritte unten rechts. Das Blatt, das vorher offen war, bleibt offen (#28).
 */
function setupSheets_(ss, keepControls, step) {
  step = step || function () {};
  let prevName = '';
  try { prevName = ss.getActiveSheet().getName(); } catch (e) { prevName = ''; }
  step('Blätter anlegen');
  setupDataSheet_(ss);
  setupSimpleSheet_(ss, SHEETS.sets, SET_HEADERS, [0, 1, 2, 3, 4, 7], true);
  setupSimpleSheet_(ss, SHEETS.tr, TR_HEADERS, [0, 1, 3], true);
  setupHistorySheet_(ss);
  setupCardHistSheet_(ss);
  setupRaritySheet_(ss);
  setupPokedexDataSheet_(ss);
  setupImportSheets_(ss);
  step('Sammlung aufbauen');
  withLock_(function () { rebuildGroups_(); });
  setupViewSheet_(ss, !!keepControls);
  step('Pokédex aufbauen');
  setupPokedexSheet_(ss, true);
  step('Dashboard aufbauen');
  const missing = setupDashboardSheet_(ss);
  removeDefaultSheet_(ss);
  restoreActiveSheet_(ss, prevName);
  return missing;
}

/**
 * Beim Öffnen der Seitenleiste in einer eingerichteten Tabelle (statt eines Menüpunkts „Einrichtung“): fehlende Blätter
 * (ohne tcgdex-Abruf, Suchfelder bleiben) und einen fehlenden nächtlichen Preislauf wieder anlegen.
 */
function repairSetup_() {
  try {
    const ss = ss_();
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('SPREADSHEET_ID') !== ss.getId()) props.setProperty('SPREADSHEET_ID', ss.getId());
    const missing = missingToolSheets_();
    if (missing.length) {
      notifyBusy_('Lege fehlende Blätter wieder an: ' + missing.join(', ') + ' …');
      ensureSchema_();
      setupSheets_(ss, true, busySteps_('Reparatur', 4));
      notifyDone_('Fehlende Blätter wieder angelegt: ' + missing.join(', ') + '.');
    }
    if (triggersMissing_()) {
      setupTriggers_();
      notify_('Die Auslöser für den nächtlichen Preislauf und für Änderungen im Blatt Daten sind wieder eingerichtet.');
    }
  } catch (e) {
    notifyDone_('Reparatur ging nicht: ' + e.message); // die Seitenleiste öffnet trotzdem
  }
}

/** Blätter, die die Einrichtung immer anlegt und die hier fehlen (API-Check, Pokédex-Nummern, Kartenverlauf und Diagnose entstehen bei Bedarf). */
function missingToolSheets_() {
  const later = [SHEETS.check, SHEETS.dexIds, SHEETS.settings, SHEETS.cardHist, 'Diagnose'];
  const have = {};
  ss_().getSheets().forEach(function (sh) { have[sh.getName()] = true; });
  return toolSheetNames_().filter(function (n) { return !have[n] && later.indexOf(n) < 0; });
}

/**
 * Fehlen die Auslöser? Sie gehören dem Konto, das sie angelegt hat, und jedes Konto sieht nur seine eigenen. Hat dieses
 * Konto den nächtlichen Preislauf, fehlt höchstens der Auslöser „bei Änderung“. Sonst fehlt der Preislauf erst, wenn die
 * Tabelle Karten hat und es seit drei Tagen weder eine Einrichtung noch einen Preislauf gab (Stempel NIGHTLY_AT oder ein
 * Tag im Verlauf). So legt ein zweites Konto mit Zugriff keinen doppelten Preislauf an, und die Vorlage bleibt ohne.
 */
function triggersMissing_() {
  const own = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (own.indexOf('naechtlicherPreislauf') >= 0) return own.indexOf('beiStrukturAenderung') < 0;
  const since = Date.now() - 3 * 24 * 3600 * 1000;
  if (dayStampTime_(settingGet_('SETUP_AT')) > since || dayStampTime_(settingGet_('NIGHTLY_AT')) > since) return false;
  const data = ss_().getSheetByName(SHEETS.data);
  if (!data || data.getLastRow() < 2) return false;
  const sh = ss_().getSheetByName(SHEETS.hist);
  const last = sh ? sh.getLastRow() : 0;
  const dates = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  return !dates.some(function (r) { return r[0] instanceof Date && r[0].getTime() > since; });
}

/** Zeitpunkt eines Stempels 'dd.MM.yyyy HH:mm' (Tag genügt), sonst 0 (leer oder 'vor 1.0'). */
function dayStampTime_(text) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(text || ''));
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : 0;
}

/** Baut Gruppen und die Blätter Sammlung, Pokédex und Dashboard neu auf (keine tcgdex-Abrufe, Daten bleiben). */
function ansichtNeuAufbauen() {
  ensureSchema_();
  setupRaritySheet_(ss_());
  setupPokedexDataSheet_(ss_());
  withLock_(function () { rebuildGroups_(); });
  setupViewSheet_(ss_(), true);
  setupPokedexSheet_(ss_(), true);
  const missing = setupDashboardSheet_(ss_());
  const err = sheet_(SHEETS.view).getRange('A6').getDisplayValue();
  alert_(err === '#ERROR!'
    ? 'Die Ansichtsformel hat noch einen Fehler. Details stehen im Blatt „Diagnose" – bitte Claude Bescheid geben.'
    : 'Ansicht neu aufgebaut.' + (missing ? ' ' + DASH_LOAD_FAILED : ''));
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
  ['=ROWS(FILTER(Gruppen!A1:Z,Gruppen!A1:A<>""))', '>=1'],
  ['=IF(G4=TRUE,1,0)', '0'],
  // Bausteine der Ansichtsformel ohne LAMBDA (#39 V2): Spalte × Zeile ergibt eine Matrix, MMULT zählt, IMAGE über eine Spalte
  ['=SUM(ARRAYFORMULA(SEQUENCE(3)*SEQUENCE(1,2)))', '18'],
  ['=SUM(MMULT(ARRAYFORMULA(SIGN(ISNUMBER(SEARCH(SPLIT("a b"," "),TRANSPOSE(SPLIT("ab a c"," ")))))),SEQUENCE(2,1,1,0)))', '3'],
  ['=ROWS(ARRAYFORMULA(IMAGE(TRANSPOSE(SPLIT("https://assets.tcgdex.net/de/swsh/swsh3/136/low.png https://assets.tcgdex.net/de/swsh/swsh3/136/low.png"," ")))))', '2']
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
  ensureCols_(sh, headers.length);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
}

/** Kopfzeile der 30 festen Spalten schreiben; Zusatzspalten dahinter bleiben unberührt. */
function setupDataSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEETS.data);
  ensureCols_(sh, NCOL);
  writeHeaders_(sh, DATA_HEADERS);
  applyDataFormats_(sh);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sh.protect().setDescription('Wird nur vom Skript beschrieben').setWarningOnly(true);
  sh.hideSheet();
}

function applyDataFormats_(sh) {
  const rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  ensureCols_(sh, NCOL);
  TEXT_COLS.forEach(function (c) { sh.getRange(2, c + 1, rows, 1).setNumberFormat('@'); });
  sh.getRange(2, COL.setSize + 1, rows, 1).setNumberFormat('0');
  sh.getRange(2, COL.count + 1, rows, 1).setNumberFormat('0');
  sh.getRange(2, COL.price + 1, rows, 1).setNumberFormat(EUR_FORMAT);
  sh.getRange(2, COL.ownPrice + 1, rows, 1).setNumberFormat(EUR_FORMAT);
  sh.getRange(2, COL.added + 1, rows, 2).setNumberFormat(DATE_TIME_FORMAT);
  sh.getRange(2, COL.numSort + 1, rows, 1).setNumberFormat('0');
  const lastCol = Math.min(sh.getLastColumn(), sh.getMaxColumns());
  if (lastCol > NCOL) sh.getRange(2, NCOL + 1, rows, lastCol - NCOL).setNumberFormat('@');
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

// ---------------------------------------------------------------------------
// Gruppen (verstecktes Hilfsblatt): eine Zeile pro Karte + Variante + Sonderversion
// ---------------------------------------------------------------------------

/** Namen der Zusatzspalten, die die Sammlung zeigt (Einstellung VIEW_EXTRAS). */
function getViewExtras_() {
  const raw = settingGet_('VIEW_EXTRAS');
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  const seen = {};
  return list.map(function (n) { return String(n == null ? '' : n).trim(); })
    .filter(function (n) { if (!n || seen[n]) return false; seen[n] = true; return true; });
}

/**
 * Zusatzspalten für die Sammlung festlegen (nur vorhandene). Baut Gruppen, Kopfzeile und Formel neu,
 * Suchfelder bleiben stehen. Ohne Sperre (für Import.gs innerhalb seiner Sperre). -> Liste der Namen
 */
function setViewExtras_(names) {
  const existing = extraNames_();
  const seen = {};
  const list = (Array.isArray(names) ? names : []).map(function (n) { return String(n == null ? '' : n).trim(); })
    .filter(function (n) { if (!n || seen[n] || existing.indexOf(n) < 0) return false; seen[n] = true; return true; });
  settingSet_('VIEW_EXTRAS', JSON.stringify(list));
  rebuildGroups_();
  setupViewSheet_(ss_(), true);
  return list;
}

/** Öffentlich (Import-Tab, Einstellungen): names = Array der Zusatzspalten. -> {viewExtras} */
function setViewExtras(names) {
  ensureSchema_();
  const list = withLock_(function () { return setViewExtras_(names); });
  return { viewExtras: list };
}

function groupFormatRow_(width) {
  const f = new Array(width).fill('@');
  const set = function (name, fmt) { f[GCOL[name] - 1] = fmt; };
  set('Setgröße', '0');
  set('Anzahl', '0');
  set('Preis (EUR)', EUR_FORMAT);
  set('Hinzugefügt am', DATE_TIME_FORMAT);
  set('Zuletzt geändert', DATE_TIME_FORMAT);
  set('Nummer sortierbar', '0');
  set('Veränderung 30 Tage (EUR)', SIGNED_EUR_FORMAT);
  set('Veränderung 30 Tage (%)', SIGNED_PCT_FORMAT);
  set('Wert (EUR)', EUR_FORMAT);
  set('Preis Anzeige', EUR_FORMAT);
  return f;
}

/**
 * Eine Zeile fürs Blatt Gruppen aus den Daten-Zeilen einer Gruppe.
 * refs: Vergleichspreise aus dem Kartenverlauf (loadCardHistRefs_); Gruppen mit eigenem Preis bekommen keine Veränderung.
 */
function groupSheetRow_(gkey, rows, dHeaders, extras, refs) {
  const ordered = orderGroupRows_(rows);
  const p = ordered[0];
  const first = function (c) {
    for (let i = 0; i < ordered.length; i++) if (ordered[i][c] !== '' && ordered[i][c] != null) return ordered[i][c];
    return '';
  };
  const maxDate = function (c) {
    let best = null;
    ordered.forEach(function (r) { if (r[c] instanceof Date && (!best || r[c].getTime() > best.getTime())) best = r[c]; });
    return best || first(c);
  };
  const count = rows.reduce(function (s, r) { return s + (Number(r[COL.count]) || 0); }, 0);
  const gp = groupPrice_(rows);
  const version = versionText_(p[COL.version]);
  const setSize = p[COL.setSize] === '' || p[COL.setSize] == null ? '' : Number(p[COL.setSize]) || '';
  const out = [
    gkey, String(p[COL.id] || ''), String(p[COL.setId] || ''), String(p[COL.setName] || ''), cellText_(first(COL.setDate)),
    String(p[COL.localId] == null ? '' : p[COL.localId]), String(p[COL.normNum] == null ? '' : p[COL.normNum]), setSize,
    String(p[COL.name] || '') + (version ? ' · ' + version : ''), String(p[COL.nameEn] || ''), String(p[COL.source] || ''),
    String(p[COL.variant] || ''), exemplareText_(rows), count,
    gp.price == null ? '' : gp.price,
    gp.manual ? 'manuell' + (gp.ownDate ? ' ' + dmyText_(gp.ownDate) : '') : gp.date,
    String(first(COL.img) || ''), String(p[COL.rarity] || ''), String(p[COL.category] || ''), String(p[COL.illustrator] || ''),
    maxDate(COL.added), maxDate(COL.changed), p[COL.numSort] === '' || p[COL.numSort] == null ? '' : Number(p[COL.numSort]) || ''
  ];
  const ch = gp.manual ? null : (groupChanges_(rows, refs) || {})[VIEW_CHANGE_DAYS];
  out.push(ch ? ch.eur : '', ch && ch.pct != null ? ch.pct / 100 : '', ch && ch.since ? dmyText_(ch.since) : '');
  // Hilfsspalten für die Ansichtsformel (#39 V2)
  const name = out[GCOL['Name'] - 1], nr = out[GCOL['Nummer'] - 1], price = out[GCOL['Preis (EUR)'] - 1];
  out.push(
    [name, out[GCOL['Name englisch'] - 1], out[GCOL['Illustrator'] - 1]].join('\n'),
    typeof price === 'number' ? price * count : 0,
    String(p[COL.source] || '') === 'en-Ersatz' ? name + ' (EN)' : name,
    setSize === '' ? nr : nr + '/' + setSize,
    VARIANT_LABELS[String(p[COL.variant] || '')] || VARIANT_LABELS.normal,
    typeof price === 'number' ? price : 'kein Preis'
  );
  extras.forEach(function (name) {
    const c = dHeaders.indexOf(name, NCOL);
    const vals = [];
    if (c >= 0) {
      ordered.forEach(function (r) {
        const v = cellText_(r[c]).trim();
        if (v && vals.indexOf(v) < 0) vals.push(v);
      });
    }
    out.push(vals.join(' / '));
  });
  return out;
}

/**
 * Berechnet das Blatt „Gruppen“ aus dem Blatt Daten neu (idempotent), dazu Seltenheiten, Pokédex und Dashboard. Das
 * ist das Einsortieren (#41): nach dem Import, nachts, beim Knopf Einsortieren und nach Änderungen direkt im Blatt
 * Daten. Innerhalb der Sperre. Repariert nebenbei Zeilen, die direkt im Blatt geändert wurden (repairRows_).
 */
function rebuildGroups_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.groups);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.groups);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  const extras = getViewExtras_();
  const headers = GROUP_HEADERS.concat(extras);
  const width = headers.length;
  const dsh = ss.getSheetByName(SHEETS.data);
  const dHeaders = dsh ? dataHeaders_() : DATA_HEADERS.slice();
  const rows = dsh ? readData_(dsh) : [];
  if (dsh && rows.length) repairRows_(dsh, rows);
  const refs = loadCardHistRefs_();
  const out = groupRows_(rows).map(function (g) {
    return groupSheetRow_(g.gkey, g.idx.map(function (i) { return rows[i]; }), dHeaders, extras, refs);
  });
  const all = [headers].concat(out);
  const oldLastRow = sh.getLastRow();
  const oldLastCol = sh.getLastColumn();
  if (all.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), all.length - sh.getMaxRows() + 100);
  ensureCols_(sh, width);
  const fmt = groupFormatRow_(width);
  const range = sh.getRange(1, 1, all.length, width);
  range.setNumberFormats(all.map(function (r, i) { return i === 0 ? headers.map(function () { return '@'; }) : fmt; }));
  range.setValues(all);
  if (oldLastRow > all.length) sh.getRange(all.length + 1, 1, oldLastRow - all.length, Math.max(width, oldLastCol)).clearContent();
  if (oldLastCol > width) sh.getRange(1, width + 1, all.length, oldLastCol - width).clearContent();
  rememberSortedAt_(changedMax_(rows)); // alles einsortiert (#41)
  // Pokédex, Seltenheiten und Dashboard nachziehen; ein Fehler dort darf das Speichern nie verhindern
  let dex = null;
  try {
    syncRarities_(rows);
    dex = rebuildPokedex_(rows) || null;
  } catch (e) { /* beim nächsten Neuaufbau wieder */ }
  try { refreshDashboard_(rows, dex); } catch (e) { /* beim nächsten Neuaufbau wieder */ }
  return out.length;
}

// ---------------------------------------------------------------------------
// Leichtes Speichern und „noch nicht einsortiert“ (#41)
// ---------------------------------------------------------------------------
// Hinzufügen und jede Änderung aus Seitenleiste und Web-App schreiben nur das Blatt Daten (lightSave_). Gruppen (und
// damit das Blatt Sammlung), Pokédex, Seltenheiten und Dashboard ziehen erst beim Einsortieren nach (Knopf, Menü,
// nachts nach dem Preislauf), in einem vollen Neuaufbau (rebuildGroups_). So wartet die nächste Suche nicht darauf.
// Noch nicht einsortiert ist jede Daten-Zeile, die nach dem letzten Neuaufbau geändert wurde: Ihr „Zuletzt geändert“
// liegt nach dem spätesten in Gruppen. So rechnen das Skript (pendingCount_) und die Hinweise in den Blättern
// (pendingFormula_). Jede Änderung setzt „Zuletzt geändert“ erst in der Sperre: Ein Neuaufbau, der sie nicht gesehen
// hat, liegt dann immer davor.

const SORTED_AT_KEY = 'sorted-at';

/** Spätestes „Zuletzt geändert“ der Daten-Zeilen (ms), 0 ohne. Gleich dem spätesten in Gruppen nach rebuildGroups_. */
function changedMax_(rows) {
  let max = 0;
  (rows || []).forEach(function (r) {
    const t = r[COL.changed];
    if (isDataRow_(r) && t instanceof Date && t.getTime() > max) max = t.getTime();
  });
  return max;
}

/** Stand des letzten Neuaufbaus (ms): aus dem Zwischenspeicher, sonst aus der Spalte „Zuletzt geändert“ in Gruppen. */
function sortedAt_() {
  try {
    const hit = CacheService.getScriptCache().get(SORTED_AT_KEY);
    if (hit !== null && hit !== '' && isFinite(Number(hit))) return Number(hit);
  } catch (e) { /* aus dem Blatt */ }
  let max = 0;
  const sh = ss_().getSheetByName(SHEETS.groups);
  const col = GCOL['Zuletzt geändert'];
  if (sh && sh.getLastRow() >= 2 && sh.getLastColumn() >= col) {
    sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0] instanceof Date && r[0].getTime() > max) max = r[0].getTime();
    });
  }
  rememberSortedAt_(max);
  return max;
}

function rememberSortedAt_(ms) {
  try { CacheService.getScriptCache().put(SORTED_AT_KEY, String(ms), 21600); } catch (e) { /* dann aus Gruppen */ }
}

/**
 * Zeitstempel einer Änderung, in der Sperre: jetzt, aber mindestens eine Sekunde nach dem letzten Einsortieren, sonst
 * zählte sie nicht als offen (gleiche Millisekunde, Uhren verschiedener Server, Zeiten ohne Millisekunden im Blatt).
 * -> {now, since (sortedAt_, für lightSave_)}
 */
function changeTime_() {
  const since = sortedAt_();
  return { now: new Date(Math.max(Date.now(), since + 1000)), since: since };
}

/**
 * Wie viele Daten-Zeilen sind geändert, aber noch nicht einsortiert? rows: die lebenden Zeilen (storeLiveRows_),
 * since: sortedAt_, wenn schon gelesen.
 */
function pendingCount_(rows, since) {
  if (since == null) since = sortedAt_();
  let n = 0;
  (rows || []).forEach(function (r) {
    const t = r[COL.changed];
    if (isDataRow_(r) && t instanceof Date && t.getTime() > since) n++;
  });
  return n;
}

/** pendingCount_ als Formel für die Hinweise in den Blättern Sammlung, Pokédex und Dashboard. */
function pendingFormula_() {
  const d = colLetter_(COL.changed + 1), g = colLetter_(GCOL['Zuletzt geändert']);
  const col = SHEETS.data + '!' + d + '2:' + d;
  return 'SUMPRODUCT(ISNUMBER(' + col + ')*(' + col + '>MAX(' + SHEETS.groups + '!' + g + '2:' + g + ')))';
}

/**
 * Hinweis „noch nicht einsortiert“ als Formel: solange etwas fehlt, ein Satz mit der Zahl, der mit ⚠ anfängt (daran
 * hängt die rote Farbe, pendingRule_) und mit tail endet, sonst rest. Beide Texte ohne Anführungszeichen.
 */
function pendingHintFormula_(tail, rest) {
  return '=LET(offen, ' + pendingFormula_() + ', IF(offen>0, "⚠ "&offen&IF(offen=1, " Änderung ist", " Änderungen sind")&' +
    '" noch nicht einsortiert, ' + tail + '", "' + (rest || '') + '"))';
}

/** Bedingte Formatierung für eine Zeile mit pendingHintFormula_ in Spalte A: rot, solange etwas fehlt. */
function pendingRule_(range, row) {
  return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($A$' + row + ')="⚠"')
    .setFontColor('#a50e0e').setBackground('#fce8e6').setBold(true).setRanges([range]).build();
}

/**
 * Leichtes Speichern: schreibt die Arbeitskopie zurück, sonst nichts (#41). Innerhalb der Sperre, since aus changeTime_.
 * -> Zahl der Einträge, die noch nicht einsortiert sind (für die Leiste in Seitenleiste und Web-App)
 */
function lightSave_(st, since) {
  storeSave_(st);
  return pendingCount_(storeLiveRows_(st), since);
}

// ---------------------------------------------------------------------------
// Blatt Sammlung
// ---------------------------------------------------------------------------

/** keepControls: Suche, Set, Sortierung und Schalter (B4:H4) bleiben erhalten. */
function setupViewSheet_(ss, keepControls) {
  const sh = getOrCreateSheet_(ss, SHEETS.view);
  const extras = getViewExtras_();
  const headers = VIEW_HEADERS.concat(extras);
  const lastCol = headers.length;
  const lastL = colLetter_(lastCol);
  const listCol = Math.max(26, lastCol + 2); // verstecke Spalte mit der Setliste (meist Z)
  const listL = colLetter_(listCol);
  let keep = null;
  if (keepControls) {
    try { keep = sh.getRange('B4:H4').getValues()[0]; } catch (e) { keep = null; }
  }
  const prev = ss.getActiveSheet();
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(frontPos_(ss, SHEETS.view));
  if (prev && prev.getName() !== SHEETS.view) ss.setActiveSheet(prev); // das aktive Blatt bleibt (#28)
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxColumns() < listCol) sh.insertColumnsAfter(sh.getMaxColumns(), listCol - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.showColumns(1, sh.getMaxColumns());

  // Kopf und Summen
  sh.getRange('A1').setValue('Pokémon-Sammlung').setFontSize(16).setFontWeight('bold');
  sh.getRange('E1:J1').setValues([['Gesamtwert', '=SUM(I6:I)', 'Karten', '=SUM(G6:G)', 'Einträge', '=COUNT(G6:G)']]);
  sh.getRange('E1').setFontWeight('bold'); sh.getRange('G1').setFontWeight('bold'); sh.getRange('I1').setFontWeight('bold');
  sh.getRange('F1').setNumberFormat(EUR_FORMAT);
  // solange Änderungen nicht einsortiert sind, steht hier rot der Hinweis darauf (#41), sonst die Hilfe
  setFormulaLocal_(sh.getRange('A2'), pendingHintFormula_('die Sammlung zeigt den alten Stand. Menü Pokémon > Einsortieren',
    'Summen gelten für die aktuelle Suche. Erfassen, Bearbeiten und Entfernen über Menü Pokémon > Karten erfassen.'));
  sh.getRange('A2').setFontColor('#5f6368').setFontSize(9);

  // Steuerzeile
  sh.getRange('B3:H3').setValues([['Suche (Name, Nummer oder Künstler, z. B. Glurak 025/165 oder Arita)', 'Set', '', 'Sortierung', '', '0er zeigen', 'Bilder zeigen']])
    .setFontColor('#5f6368').setFontSize(9);
  sh.getRange('B4').setNumberFormat('@').setBackground('#fff8e1');
  sh.getRange('C4').setValue('Alle').setBackground('#fff8e1');
  sh.getRange('E4').setValue(SORT_OPTIONS[0]).setBackground('#fff8e1');
  sh.getRange('G4:H4').insertCheckboxes().setValue(false);
  if (keep) {
    sh.getRange('B4').setValue(keep[0] == null ? '' : keep[0]);
    if (keep[1] !== '' && keep[1] != null) sh.getRange('C4').setValue(keep[1]);
    if (SORT_OPTIONS.indexOf(keep[3]) >= 0) sh.getRange('E4').setValue(keep[3]);
    sh.getRange('G4').setValue(keep[5] === true);
    sh.getRange('H4').setValue(keep[6] === true);
  }
  sh.getRange('B4:H4').setBorder(true, true, true, true, true, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);

  sh.getRange(listL + '1').setValue('Alle');
  setFormulaLocal_(sh.getRange(listL + '2'), '=IFERROR(SORT(UNIQUE(FILTER(Gruppen!D2:D, Gruppen!D2:D<>""))), "")');
  sh.getRange('C4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(listL + '1:' + listL + '1000'), true).setAllowInvalid(false).build());
  sh.getRange('E4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(SORT_OPTIONS, true).setAllowInvalid(false).build());
  sh.hideColumns(listCol);

  // Tabelle
  sh.getRange(5, 1, 1, lastCol).setValues([headers])
    .setFontWeight('bold').setBackground('#c62828').setFontColor('#ffffff');
  setFormulaLocal_(sh.getRange('A6'), viewFormula_(extras.length));
  sh.getRange('H6:I').setNumberFormat(EUR_FORMAT);
  sh.getRange('J6:J').setNumberFormat(SIGNED_EUR_FORMAT);
  sh.getRange('K6:K').setNumberFormat(SIGNED_PCT_FORMAT);
  sh.getRange('J5').setNote('Veränderung des Trendpreises einer Karte in den letzten ' + VIEW_CHANGE_DAYS + ' Tagen (der Preis einer Karte, nicht mal Anzahl). ' +
    'Karten mit eigenem Preis haben keine. Seitenleiste und Web-App zeigen auch 7 und 90 Tage.');
  sh.getRange('L5').setNote('Leer: Die Veränderung gilt für die ganzen ' + VIEW_CHANGE_DAYS + ' Tage. Sonst steht hier, seit wann sich das Tool den Preis der Karte merkt.');
  sh.getRange('A6:' + lastL).setVerticalAlignment('middle');
  sh.setFrozenRows(5);

  const widths = [70, 190, 170, 80, 110, 150, 70, 110, 100, 105, 90, 95, 130, 90, 130, 110];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  extras.forEach(function (n, i) { sh.setColumnWidth(VIEW_HEADERS.length + i + 1, 130); });

  const grey = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=($G6<>"")*($G6=0)')
    .setFontColor('#9aa0a6').setBackground('#f5f5f5')
    .setRanges([sh.getRange('A6:' + lastL)]).build();
  // Veränderung: Plus grün, Minus rot (ohne Kommas in der Formel, sonst stolpert die deutsche Tabelle)
  const up = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=N($J6)>0')
    .setFontColor('#137333').setRanges([sh.getRange('J6:K')]).build();
  const down = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=N($J6)<0')
    .setFontColor('#c5221f').setRanges([sh.getRange('J6:K')]).build();
  sh.setConditionalFormatRules([grey, up, down, pendingRule_(sh.getRange('A2:' + lastL + '2'), 2)]);

  sh.getRange('A5:' + lastL).protect().setDescription('Ansicht – Änderungen nur über die Oberfläche').setWarningOnly(true);
  applyRowHeights_(sh);
}

/**
 * Die eine Formel der Sammlungsansicht: liest das Blatt Gruppen, filtert, sortiert und gibt die Tabelle aus.
 * nExtras = Anzahl der gezeigten Zusatzspalten (Gruppen-Spalten nach GROUP_HEADERS).
 * Ohne LAMBDA (#39 V2): Alle Schritte rechnen über ganze Spalten. Mehrere Suchwörter ergeben eine Matrix
 * Einträge × Wörter, MMULT zählt je Eintrag die passenden Wörter. Anzeige, Wert und Suchtext kommen fertig aus
 * den Hilfsspalten von Gruppen (groupSheetRow_).
 */
function viewFormula_(nExtras) {
  const n = Math.max(0, Math.floor(Number(nExtras) || 0));
  const w = GROUP_HEADERS.length + n;
  const zc = w + 1, mc = w + 2;
  const gc = function (name) {
    if (!GCOL[name]) throw new Error('Spalte fehlt in GROUP_HEADERS: ' + name);
    return GCOL[name];
  };
  const col = function (arr, name) { return 'CHOOSECOLS(' + arr + ', ' + gc(name) + ')'; };
  const extraCols = [];
  for (let i = 0; i < n; i++) extraCols.push('CHOOSECOLS(srt, ' + (GROUP_HEADERS.length + 1 + i) + ')');
  const sortBy = ['Set-Erscheinungsdatum', 'Set-ID', 'Nummer sortierbar', 'Nummer normalisiert', 'Variante', 'Name']
    .map(function (h) { return gc(h) + ', TRUE'; }).join(', ');
  const show = ['Name Anzeige', 'Setname', 'Nummer Anzeige', 'Variante Anzeige', 'Exemplare', 'Anzahl', 'Preis Anzeige',
    'Wert (EUR)', 'Veränderung 30 Tage (EUR)', 'Veränderung 30 Tage (%)', 'Verlauf seit',
    'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand'].map(function (h) { return col('srt', h); });
  return [
    '=IFERROR(ARRAYFORMULA(LET(',
    'dat, FILTER(Gruppen!A2:' + colLetter_(w) + ', Gruppen!A2:A<>""),',
    'qry, TRIM(B4),',
    'wrds, IF(qry="", "", SPLIT("§"&REGEXREPLACE(qry, "\\s+", " §"), " ")),',
    'wd, MID(wrds, 2, 200),',
    'isnr, REGEXMATCH(wd, "[0-9]"),',
    'wnr, REGEXREPLACE(UPPER(IFERROR(REGEXEXTRACT(wd, "^[^/]*"), "")), "^([A-Z]*)0+([0-9])", "$1$2"),',
    'szw, IFERROR(REGEXEXTRACT(wd, "/(.*)$"), ""),',
    'szon, REGEXMATCH(wd, "/")*REGEXMATCH(szw, "^0*[1-9]"),',
    'wsz, IFERROR(REGEXEXTRACT(REGEXREPLACE(szw, "^0+", ""), "^[0-9]+"), ""),',
    'hit, (wd="") + isnr*(TO_TEXT(' + col('dat', 'Nummer normalisiert') + ')=wnr)*(1-szon+szon*(TO_TEXT(' + col('dat', 'Setgröße') + ')=wsz))' +
      ' + (1-isnr)*ISNUMBER(SEARCH(wd, ' + col('dat', 'Suchtext') + ')),',
    'okay, ((C4="")+(C4="Alle")+(' + col('dat', 'Setname') + '=C4))*((G4=TRUE)+(' + col('dat', 'Anzahl') + '>0))' +
      '*(MMULT(SIGN(hit), SEQUENCE(COLUMNS(wrds), 1, 1, 0))=COLUMNS(wrds)),',
    'flt, FILTER(dat, okay>0),',
    'wert, ' + col('flt', 'Wert (EUR)') + ',',
    'tm, ' + col('flt', 'Hinzugefügt am') + ',',
    'zsort, 1-(' + col('flt', 'Anzahl') + '>0),',
    'msort, IF(E4="Name", LOWER(' + col('flt', 'Name') + '), IF(E4="Wert", -wert, IF(E4="Zuletzt hinzugefügt", IF(ISNUMBER(tm), -tm, 0), 0*wert))),',
    'srt, SORT(HSTACK(flt, zsort, msort), ' + zc + ', TRUE, ' + mc + ', TRUE, ' + sortBy + '),',
    'url, ' + col('srt', 'Bild-URL') + ',',
    'HSTACK(',
    '  IF((H4=TRUE)*(url<>""), IMAGE(url&"/low.png"), IF(H4=TRUE, "–", "")),',
    '  ' + show.concat(extraCols).join(', '),
    '))), "Keine Einträge gefunden")'
  ].join(' ');
}

/** Platz eines Blatts vorne (1-basiert): Dashboard, Sammlung, Pokédex, jeweils nur, wenn es die davor gibt. */
function frontPos_(ss, name) {
  const order = [SHEETS.dash, SHEETS.view, SHEETS.dex];
  let pos = 1;
  for (let i = 0; i < order.length && order[i] !== name; i++) if (ss.getSheetByName(order[i])) pos++;
  return Math.min(pos, ss.getSheets().length);
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
  // Zeilen löschen im Blatt Daten löst kein onEdit aus, nur diesen Trigger
  deleteTriggersFor_('beiStrukturAenderung');
  ScriptApp.newTrigger('beiStrukturAenderung').forSpreadsheet(ss_()).onChange().create();
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

/**
 * Eine Karte von tcgdex, eine halbe Stunde zwischengespeichert (#31): getCardDetail holt sie beim Antippen,
 * addCard gleich danach noch einmal, das spart einen Abruf. Die Suche legt ihre Treffer schon hinein (#36 A1),
 * dann kommt das Antippen ganz ohne Abruf aus. 404 -> null (wird nicht gemerkt).
 */
function fetchCard_(lang, id, attempts) {
  try {
    const hit = CacheService.getScriptCache().get(cardCacheKey_(lang, id));
    if (hit) return JSON.parse(hit);
  } catch (e) { /* ohne Zwischenspeicher weiter */ }
  const card = fetchJson_(apiUrl_(lang, 'cards/' + encodeURIComponent(id)), attempts);
  if (card) cacheCards_([{ lang: lang, id: id, data: card }]);
  return card;
}

function cardCacheKey_(lang, id) { return 'tcg:' + lang + ':' + id; }

/** Karten [{lang, id, data}] in einem Aufruf zwischenspeichern; ohne data oder zu groß (Grenze 100 KB) nicht. */
function cacheCards_(list) {
  try {
    const put = {};
    list.forEach(function (x) {
      if (!x.data) return;
      const text = JSON.stringify(x.data);
      if (text.length < 90000) put[cardCacheKey_(x.lang, x.id)] = text;
    });
    if (Object.keys(put).length) CacheService.getScriptCache().putAll(put, CARD_CACHE_SECS);
  } catch (e) { /* ohne Zwischenspeicher weiter */ }
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
  try { en = fetchCard_('en', card.id, 1); } catch (e) { en = null; }
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
  // beim Antippen braucht cardmarketWithFallback_ dieselben englischen Daten
  cacheCards_(missing.map(function (c, i) { return { lang: 'en', id: c.id, data: res[i].ok ? res[i].data : null }; }));
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

// Sets im Zwischenspeicher (#38 S3): Suche, Set-Vorschläge und Sammlung lesen das Blatt Sets nicht bei jedem Aufruf.
// So wartet eine Suche nicht auf das Speichern der vorigen Karte (#41). Wer das Blatt Sets schreibt, vergisst den
// Zwischenspeicher (dropSetsCache_), eine Änderung von Hand ebenso (onEdit).
const SETS_CACHE_KEY = 'sets';
const SETS_CACHE_SECS = 21600; // 6 Stunden, mehr erlaubt CacheService nicht

/** Wie loadSets_, aus dem Zwischenspeicher (row stimmt dann nicht immer, zum Schreiben loadSets_ nehmen). */
function cachedSets_() {
  const hit = cacheGetJson_(SETS_CACHE_KEY);
  if (hit && hit.de && hit.en && hit.order) return hit;
  const sets = loadSets_();
  if (sets.order.de.length || sets.order.en.length) cachePutJson_(SETS_CACHE_KEY, sets, SETS_CACHE_SECS);
  return sets;
}

function dropSetsCache_() {
  cacheDrop_(SETS_CACHE_KEY);
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

// Trefferlisten nach Name (cards?name=…) merkt sich das Tool ein paar Stunden (#38 S3): „Glurak“ (zu viele Treffer) und
// gleich danach „Glurak 4“ holen dieselbe Liste nur einmal. Neue Karten kommen mit neuen Sets, selten am selben Tag.
const NAME_LIST_SECS = 3 * 3600;

/** Kurzform aller Karten mit diesem Namen von tcgdex: [{id, localId, name, image}], gemerkt für NAME_LIST_SECS. */
function cardsByName_(lang, name) {
  const key = 'tcgl:' + lang + ':' + String(name).trim().toLowerCase().slice(0, 200);
  const hit = cacheGetJson_(key);
  if (Array.isArray(hit)) return hit;
  const res = fetchJson_(apiUrl_(lang, 'cards', { name: name }));
  const list = (Array.isArray(res) ? res : []).map(function (c) {
    return { id: c.id, localId: c.localId, name: c.name, image: c.image };
  });
  cachePutJson_(key, list, NAME_LIST_SECS);
  return list;
}

/** Kandidaten (Kurzform) aus tcgdex holen und lokal exakt filtern. */
function findCandidates_(lang, name, num, setIds, sets, suffix) {
  let list = [];
  if (name) {
    list = cardsByName_(lang, name);
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

function finishCandidates_(lang, cands, notes, inputName, enNote, sets) {
  if (cands.length > MAX_CANDIDATES) {
    notes.push(cands.length + ' Treffer – bitte Nummer oder Set ergänzen.');
    return { stage: lang, tooMany: cands.length, cards: [], notes: notes, inputName: inputName };
  }
  const details = fetchAllJson_(cands.map(function (c) { return apiUrl_(lang, 'cards/' + encodeURIComponent(c.id)); }));
  const langs = cands.map(function () { return lang; });
  // Treffer zwischenspeichern: Antippen (getCardDetail) und Hinzufügen brauchen dieselben Daten (#36 A1)
  const toCache = details.map(function (d, i) { return { lang: lang, id: cands[i].id, data: d.ok ? d.data : null }; });
  if (lang === 'en' && cands.length) {
    // IDs sind in de und en gleich: gibt es die Karte auf Deutsch, ist sie kein Ersatz
    const de = fetchAllJson_(cands.map(function (c) { return apiUrl_('de', 'cards/' + encodeURIComponent(c.id)); }));
    de.forEach(function (d, i) {
      if (!d.ok) return;
      details[i] = d; langs[i] = 'de';
      toCache.push({ lang: 'de', id: cands[i].id, data: d.data });
    });
  }
  cacheCards_(toCache);
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

  const sets = cachedSets_(); // einmal pro Suche, ohne das Blatt zu lesen (#38 S3)
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
  if (cands.length) return finishCandidates_('de', cands, notes, name, '', sets);

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
        return finishCandidates_('en', cands, notes, name, 'Keine deutsche Karte gefunden – englische Daten für „' + t.label + '".', sets);
      }
    }
  } else {
    cands = findCandidates_('en', '', num, setIds, sets, null);
    if (cands.length) return finishCandidates_('en', cands, notes, name, 'Keine deutsche Karte gefunden – englische Daten.', sets);
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
  const card = fetchCard_(lang, id);
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

/**
 * Letzte Stufe: Karte über Set + Nummer (erst deutsch, dann englisch). „DP 16“ zählt wie „DP16“. Passt keine
 * Nummer genau, zählen nur die Ziffern, wenn genau eine Karte des Sets sie hat („DS 62“ im Set Delta Species -> 62).
 */
function getCardBySetNumber(setId, number) {
  const num = parseNumberInput_(number);
  if (!num) throw new Error('Bitte eine Nummer angeben.');
  const joined = normalizeNumber_(num.raw.replace(/\s+/g, ''));
  const langs = ['de', 'en'];
  const lists = [];
  for (let i = 0; i < langs.length; i++) {
    const set = fetchJson_(apiUrl_(langs[i], 'sets/' + encodeURIComponent(setId)));
    if (!set || !Array.isArray(set.cards)) continue;
    const c = set.cards.filter(function (x) {
      const n = normalizeNumber_(x.localId);
      return n === num.norm || n === joined;
    })[0];
    if (c) return getCardDetail(c.id, langs[i]);
    lists.push({ lang: langs[i], cards: set.cards });
  }
  const digits = joined.replace(/\D/g, '');
  for (let i = 0; digits && i < lists.length; i++) {
    const d = lists[i].cards.filter(function (x) {
      const cd = String(x.localId == null ? '' : x.localId).replace(/\D/g, '');
      return cd !== '' && Number(cd) === Number(digits);
    });
    if (d.length === 1) return getCardDetail(d[0].id, lists[i].lang);
  }
  throw new Error('Nummer ' + num.raw + ' gibt es in diesem Set nicht.');
}

/** Erscheinungsdatum eines Sets: aus dem Blatt Sets, sonst einmal holen und speichern (setReleaseDates_). */
function setReleaseDate_(lang, setId, setBrief) {
  const need = {};
  need[setId] = { lang: lang, brief: setBrief };
  return setReleaseDates_(need)[setId] || '';
}

/**
 * Erscheinungsdaten mehrerer Sets: aus dem Blatt Sets, die übrigen parallel von tcgdex holen und im Blatt Sets merken.
 * need = {Set-ID: {lang: 'de'|'en', brief (Set aus den Kartendaten, optional)}} -> {Set-ID: 'yyyy-MM-dd' oder ''}
 */
function setReleaseDates_(need) {
  const out = {};
  const ids = Object.keys(need || {});
  if (!ids.length) return out;
  const sets = loadSets_();
  const langOf = function (id) { return need[id].lang === 'en' ? 'en' : 'de'; };
  const missing = ids.filter(function (id) {
    const lang = langOf(id);
    const hit = sets[lang][id] || sets[lang === 'de' ? 'en' : 'de'][id];
    out[id] = hit && hit.releaseDate ? hit.releaseDate : '';
    return !out[id];
  });
  if (!missing.length) return out;
  const res = fetchAllJson_(missing.map(function (id) { return apiUrl_(langOf(id), 'sets/' + encodeURIComponent(id)); }));
  const sh = ss_().getSheetByName(SHEETS.sets);
  let wrote = false;
  missing.forEach(function (id, i) {
    const full = res[i].ok ? res[i].data : null;
    const date = full && full.releaseDate ? String(full.releaseDate).slice(0, 10) : '';
    out[id] = date;
    if (!date || !sh) return;
    const own = sets[langOf(id)][id];
    if (own) {
      sh.getRange(own.row, 8).setValue(date);
    } else {
      const b = need[id].brief || full;
      const cc = b.cardCount || {};
      sh.appendRow([langOf(id), id, b.name || id, b.logo || '', b.symbol || '', cc.official || '', cc.total || '', date]);
    }
    wrote = true;
  });
  if (wrote) dropSetsCache_();
  return out;
}

/** Erscheinungsdatum eines Sets nur aus dem Zwischenspeicher (leichtes Speichern, #41); fehlt es: '' (Einsortieren holt es). */
function knownSetDate_(lang, setId) {
  const sets = cachedSets_();
  const hit = sets[lang][setId] || sets[lang === 'de' ? 'en' : 'de'][setId];
  return hit && hit.releaseDate ? hit.releaseDate : '';
}

/** Eigener Preis aus einer Anfrage: Zahl > 0 oder null (leer/0). Unlesbar -> Fehler. */
function ownPriceOf_(x) {
  const p = parsePrice_(x);
  if (p == null) return null;
  if (isNaN(p) || p < 0) throw new Error('Bitte einen gültigen Preis eingeben, z. B. 1,50.');
  return p > 0 ? Math.round(p * 100) / 100 : null;
}

function eurText_(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
}

/** Eigenen Preis auf alle Zeilen der Gruppe schreiben (price null = entfernen). */
function storeSetGroupOwnPrice_(st, gkey, price, now) {
  const idx = storeGroupIdx_(st, gkey);
  const date = price == null ? '' : todayText_();
  idx.forEach(function (i) {
    const r = st.rows[i];
    r[COL.ownPrice] = price == null ? '' : price;
    r[COL.ownPriceDate] = date;
    r[COL.changed] = now || new Date();
    storeTouch_(st, i);
  });
  return idx.length;
}

/**
 * Zeile in die Zeile „von Hand“ desselben Eintrags einrechnen oder neu anlegen; optional eigener Preis
 * für die ganze Gruppe. Innerhalb der Sperre. -> {eid, key, gkey, count}
 */
function storeAddHand_(st, row, qty, ownPrice, now, trend) {
  const key = row[COL.key];
  const gkey = groupKey_(row);
  let i = storeFindHand_(st, key, -1);
  if (i >= 0) {
    const r = st.rows[i];
    r[COL.count] = (Number(r[COL.count]) || 0) + qty;
    r[COL.changed] = now;
    r[COL.key] = key;
    storeTouch_(st, i);
  } else {
    i = storeAdd_(st, row);
  }
  if (trend && trend.price != null) {
    // Trendpreis ist pro Karte und Variante: alle Zeilen dieser Karte nachziehen
    st.rows.forEach(function (r, j) {
      if (!storeLive_(st, j) || String(r[COL.id]) !== String(row[COL.id]) || r[COL.variant] !== row[COL.variant]) return;
      if (r[COL.price] === trend.price && r[COL.priceDate] === trend.date) return;
      r[COL.price] = trend.price;
      r[COL.priceDate] = trend.date;
      storeTouch_(st, j);
    });
  }
  if (ownPrice != null) storeSetGroupOwnPrice_(st, gkey, ownPrice, now);
  return { eid: String(st.rows[i][COL.eid]), key: key, gkey: gkey, count: Number(st.rows[i][COL.count]) || 0 };
}

function addMessage_(name, variant, cond, cardLang, version, count, priceInfo) {
  const parts = [name + (version ? ' · ' + version : ''), VARIANT_LABELS[variant] || variant];
  if (cond) parts.push(cond);
  if (cardLang !== 'DE') parts.push(langLabel_(cardLang));
  return parts.join(', ') + ' hinzugefügt, jetzt ' + count + ' Stück.' + priceInfo;
}

/**
 * Hinzufügen im Hintergrund (#33): Die Seitenleiste schickt jede Karte mit einer eigenen Anfrage-ID (rid) und
 * wiederholt sie bei einem Fehler. Ist die Karte unter dieser ID schon gespeichert, kommt die gemerkte Antwort
 * zurück, statt sie noch einmal einzurechnen. Gemerkt wird 6 Stunden im Skript-Zwischenspeicher.
 */
const ADD_RID_PREFIX = 'add-rid:';
function addRid_(req) { return String((req && req.rid) || '').replace(/[^\w-]/g, '').slice(0, 64); }
function addRidGet_(rid) {
  if (!rid) return null;
  try {
    const s = CacheService.getScriptCache().get(ADD_RID_PREFIX + rid);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function addRidPut_(rid, res) {
  if (!rid) return;
  const keep = {};
  Object.keys(res).forEach(function (k) { if (k !== 'delta') keep[k] = res[k]; });
  keep.repeat = true;
  try { CacheService.getScriptCache().put(ADD_RID_PREFIX + rid, JSON.stringify(keep), 21600); } catch (e) { /* ohne Schutz weiter */ }
}
/** Gemerkte Antwort für eine Wiederholung, pending neu gezählt (die gemerkte Zahl kann inzwischen veraltet sein) */
function addRepeat_(prev) {
  try { prev.pending = pendingCount_(readData_(sheet_(SHEETS.data))); } catch (e) { delete prev.pending; }
  return prev;
}

/**
 * Karte speichern, nur ins Blatt Daten (lightSave_, #41). req = {id, lang ('de'|'en' Datensprache),
 * variant: 'base'|'reverse'|'firstEdition', condition, qty, inputName, cardLang (Sprache der Karte, Standard 'DE'),
 * version (Sonderversion, Standard ''), ownPrice (Zahl|null|''), rid (Anfrage-ID, optional)}
 * -> {eid, key, gkey, count, message, delta (collDelta_), pending (noch nicht einsortiert)}; schon gespeicherte rid:
 * dieselbe Antwort mit repeat: true, ohne delta und mit neu gezähltem pending
 */
function addCard(req) {
  req = req || {};
  const rid = addRid_(req);
  const prev = addRidGet_(rid);
  if (prev) return addRepeat_(prev);
  ensureSchema_();
  const lang = req.lang === 'en' ? 'en' : 'de';
  const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
  const cardLang = langCode_(req.cardLang);
  const version = versionText_(req.version);
  const ownPrice = ownPriceOf_(req.ownPrice);
  const card = fetchCard_(lang, req.id);
  if (!card) throw new Error('Karte ' + req.id + ' nicht gefunden – nichts gespeichert.');

  const v = card.variants || {};
  let variant = baseVariant_(v);
  if (req.variant === 'reverse') variant = 'reverse';
  if (req.variant === 'firstEdition') variant = 'firstEdition';
  const cond = condCode_(req.condition) || '';

  const p = cardmarketWithFallback_(card, lang);
  const price = priceFor_(p.cm, variant);
  const priceDate = p.cm ? dateText_(p.cm.updated) : '';
  const set = card.set || {};
  const setId = String(set.id || setIdOf_(card));
  const setDate = knownSetDate_(lang, setId); // fehlt es (neues Set), holt es das Einsortieren
  const summary = summarizeCard_(card, lang);
  summary.dataLang = lang;
  summary.setName = String(set.name || setId);
  summary.setDate = setDate;
  summary.price = price;
  summary.priceDate = priceDate;
  summary.inputName = String(req.inputName || '').trim();

  const result = withLock_(function () {
    const again = addRidGet_(rid); // dieselbe Anfrage lief inzwischen durch
    if (again) return { prev: again };
    const ct = changeTime_(), now = ct.now; // erst in der Sperre
    const st = dataStore_();
    if (setDate) {
      // ältere Einträge dieses Sets ohne Datum nachtragen
      st.rows.forEach(function (r, i) {
        if (String(r[COL.setId]) === setId && isDataRow_(r) && !r[COL.setDate]) { r[COL.setDate] = setDate; storeTouch_(st, i); }
      });
    }
    const row = buildCardRow_(summary, {
      variant: variant, cond: cond, lang: cardLang, version: version, count: qty, origin: ORIGIN_HAND, fp: '',
      now: now, headers: st.headers, width: st.width
    });
    const res = storeAddHand_(st, row, qty, ownPrice, now, { price: price, date: priceDate });
    res.pending = lightSave_(st, ct.since);
    res.delta = collDelta_(st);
    const name = summary.dataLang === 'en' && summary.inputName ? summary.inputName : String(card.name);
    let priceInfo = '';
    if (ownPrice != null) priceInfo = ' Eigener Preis: ' + eurText_(ownPrice) + '.';
    else if (price == null) priceInfo = ' (kein Preis)';
    const out = addResult_(res, addMessage_(name, variant, cond, cardLang, version, res.count, priceInfo));
    addRidPut_(rid, out); // noch in der Sperre: eine Wiederholung wartet darauf und bekommt diese Antwort
    return out;
  });
  return result.prev ? addRepeat_(result.prev) : result;
}

/** Antwort von addCard / addFreeCard */
function addResult_(res, message) {
  return { eid: res.eid, key: res.key, gkey: res.gkey, count: res.count, message: message, delta: res.delta || null, pending: res.pending };
}

/**
 * Freie Karte (tcgdex kennt sie nicht): ohne Bild und ohne automatischen Preis.
 * req = {name (Pflicht), setName, number, variant ('normal'), condition, qty, cardLang, version, ownPrice, rid}
 * -> wie addCard
 */
function addFreeCard(req) {
  req = req || {};
  const rid = addRid_(req);
  const prev = addRidGet_(rid);
  if (prev) return addRepeat_(prev);
  ensureSchema_();
  const name = String(req.name || '').trim();
  if (!name) throw new Error('Bitte einen Namen eingeben.');
  const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
  const variant = VARIANT_LABELS[req.variant] ? req.variant : 'normal';
  const cond = condCode_(req.condition) || '';
  const cardLang = langCode_(req.cardLang);
  const version = versionText_(req.version);
  const ownPrice = ownPriceOf_(req.ownPrice);
  const card = { free: true, name: name, setName: String(req.setName || '').trim(), localId: String(req.number || '').trim() };

  const result = withLock_(function () {
    const again = addRidGet_(rid);
    if (again) return { prev: again };
    const ct = changeTime_(), now = ct.now;
    const st = dataStore_();
    const row = buildCardRow_(card, {
      variant: variant, cond: cond, lang: cardLang, version: version, count: qty, origin: ORIGIN_HAND, fp: '',
      now: now, headers: st.headers, width: st.width
    });
    const res = storeAddHand_(st, row, qty, ownPrice, now, null);
    res.pending = lightSave_(st, ct.since);
    res.delta = collDelta_(st);
    const priceInfo = ownPrice != null ? ' Eigener Preis: ' + eurText_(ownPrice) + '.' : ' (freie Karte, kein Preis)';
    const out = addResult_(res, addMessage_(name, variant, cond, cardLang, version, res.count, priceInfo));
    addRidPut_(rid, out);
    return out;
  });
  return result.prev ? addRepeat_(result.prev) : result;
}

// ---------------------------------------------------------------------------
// 6. Sammlung: Gruppen, -1/+1, Rückgängig, Bearbeiten, eigener Preis, Verknüpfen
// ---------------------------------------------------------------------------

/** Auswahllisten fürs UI, dazu pending: Einträge, die noch nicht einsortiert sind (#41). */
function getUiConfig() {
  ensureSchema_();
  const sh = ss_().getSheetByName(SHEETS.data);
  const versions = {};
  const rows = sh ? readData_(sh) : [];
  rows.forEach(function (r) {
    const v = versionText_(r[COL.version]);
    if (v && isDataRow_(r)) versions[v] = true;
  });
  return {
    conditions: CONDITIONS.map(function (c) { return { code: c, label: CONDITION_LABELS[c] || c }; }),
    langs: LANGS.map(function (l) { return { code: l[0], label: l[1] }; }),
    versions: Object.keys(versions).sort(function (a, b) { return a.localeCompare(b, 'de'); }),
    extras: sh ? extraNames_() : [],
    viewExtras: getViewExtras_(),
    pending: pendingCount_(rows)
  };
}

/** Passt ein Suchwort zur Karte? Zahlen: Nummer (025/165), sonst Teil von Name, Name englisch, Sonderversion oder Künstler. */
function matchWord_(r, w) {
  if (/\d/.test(w)) {
    const p = parseNumberInput_(w);
    if (normalizeNumber_(r[COL.localId]) !== p.norm) return false;
    if (p.size && Number(r[COL.setSize]) !== p.size) return false;
    return true;
  }
  const lw = w.toLowerCase();
  return String(r[COL.name]).toLowerCase().indexOf(lw) >= 0 || String(r[COL.nameEn]).toLowerCase().indexOf(lw) >= 0 ||
    String(r[COL.version]).toLowerCase().indexOf(lw) >= 0 || String(r[COL.illustrator]).toLowerCase().indexOf(lw) >= 0;
}

/** Eine Exemplar-Zeile fürs UI. */
function rowForUi_(r, headers, info) {
  const extras = {};
  for (let c = NCOL; c < headers.length; c++) if (headers[c]) extras[headers[c]] = cellText_(r[c]);
  const nr = importNrOf_(r[COL.origin]);
  return {
    eid: String(r[COL.eid]), key: entryKey_(r), cond: String(r[COL.cond] || ''), lang: langCode_(r[COL.lang]),
    count: Number(r[COL.count]) || 0, origin: normOrigin_(r[COL.origin]), originLabel: originLabel_(r[COL.origin], info),
    isImport: nr != null, importNr: nr, extras: extras
  };
}

/**
 * Eine Gruppe fürs UI (Form wie searchCollection().groups[i]). refs (optional): Vergleichspreise aus dem Kartenverlauf.
 * chg: Veränderung des Trendpreises {7|30|90: {eur, pct, since} oder null}, auch bei eigenem Preis (das UI zeigt sie dann nicht).
 */
function groupForUi_(gkey, rows, headers, info, refs) {
  const ordered = orderGroupRows_(rows);
  const p = ordered[0];
  const gp = groupPrice_(rows);
  let image = '';
  for (let i = 0; i < ordered.length && !image; i++) image = String(ordered[i][COL.img] || '');
  const variant = String(p[COL.variant] || '');
  const uiRows = rows.slice().sort(function (a, b) {
    const ha = isHandOrigin_(a[COL.origin]) ? 0 : 1, hb = isHandOrigin_(b[COL.origin]) ? 0 : 1;
    const na = importNrOf_(a[COL.origin]), nb = importNrOf_(b[COL.origin]);
    return (ha - hb) || ((na == null ? 0 : na) - (nb == null ? 0 : nb)) ||
      (langPos_(langCode_(a[COL.lang])) - langPos_(langCode_(b[COL.lang]))) || (condPos_(a[COL.cond]) - condPos_(b[COL.cond]));
  }).map(function (r) { return rowForUi_(r, headers, info); });
  return {
    gkey: gkey, id: String(p[COL.id] || ''), name: String(p[COL.name] || ''), nameEn: String(p[COL.nameEn] || ''),
    source: String(p[COL.source] || ''), isFree: !String(p[COL.id] || ''), setName: String(p[COL.setName] || ''),
    localId: String(p[COL.localId] == null ? '' : p[COL.localId]),
    setSize: p[COL.setSize] === '' || p[COL.setSize] == null ? null : Number(p[COL.setSize]) || null,
    variant: variant, variantLabel: VARIANT_LABELS[variant] || variant, version: versionText_(p[COL.version]),
    count: rows.reduce(function (s, r) { return s + (Number(r[COL.count]) || 0); }, 0),
    image: image, price: gp.price, priceManual: gp.manual, ownPrice: gp.ownPrice,
    priceDate: gp.manual ? gp.ownDate : gp.date, exemplare: exemplareText_(rows), rarity: String(p[COL.rarity] || ''),
    illustrator: String(p[COL.illustrator] || ''), chg: groupChanges_(rows, refs),
    rows: uiRows
  };
}

/**
 * Suche im Datenblatt für den Tab Sammlung. -> {total, groups: [...], sort, desc, dex} (höchstens 60 Gruppen).
 * Gruppe = Karte + Variante + Sonderversion, mit allen Exemplar-Zeilen (rows).
 * opts (optional): {sort: Schlüssel aus COLL_SORTS (Standard 'set'), desc: true/false (Standard je Sortierung),
 *   dex: nur Karten dieses Pokémon (Pokédex-Nummer)}. Karten mit 0 Exemplaren stehen immer am Ende.
 */
function searchCollection(query, setText, opts) {
  ensureSchema_();
  opts = opts || {};
  const sort = COLL_SORTS.hasOwnProperty(opts.sort) ? String(opts.sort) : 'set';
  const desc = opts.desc == null || opts.desc === '' ? COLL_SORTS[sort].desc : opts.desc === true || opts.desc === 'true';
  const dexNr = Math.max(0, Math.floor(Number(opts.dex) || 0));
  let st = dataStore_();
  // Zeilen ohne Eintrag-ID oder mit altem Schlüssel (z. B. von einer alten Web-App-Bereitstellung): erst
  // reparieren, sonst zeigt die Liste Exemplare, die sich nicht ändern lassen
  if (needsRepair_(st.rows)) {
    withLock_(function () { rebuildGroups_(); });
    st = dataStore_();
  }
  const rows = st.rows;
  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  const stx = String(setText || '').trim().toLowerCase();
  const stIds = stx ? matchSets_(cachedSets_(), stx) : [];
  let groups = groupRows_(rows).map(function (g) {
    return { gkey: g.gkey, rows: g.idx.map(function (i) { return rows[i]; }) };
  }).filter(function (g) {
    const r = orderGroupRows_(g.rows)[0];
    if (stx && String(r[COL.setName]).toLowerCase().indexOf(stx) < 0 &&
        String(r[COL.setId]).toLowerCase() !== stx &&
        stIds.indexOf(String(r[COL.setId])) < 0) return false;
    return words.every(function (w) { return matchWord_(r, w); });
  });
  const needDex = dexNr > 0 || sort === 'dex';
  const cache = needDex ? loadDexIds_() : null;
  groups.forEach(function (g) {
    g.p = orderGroupRows_(g.rows)[0];
    g.count = g.rows.reduce(function (s, r) { return s + (Number(r[COL.count]) || 0); }, 0);
    g.setDate = groupSetDate_(g.rows);
    if (needDex) g.dex = dexOfRow_(g.p, cache);
  });
  if (dexNr) groups = groups.filter(function (g) { return g.dex.indexOf(dexNr) >= 0; });
  const ranks = sort === 'rarity' ? rarityRanks_() : null;
  groups.forEach(function (g) { g.sortVal = collSortValue_(g, sort, ranks); });
  groups.sort(function (a, b) { return collCompare_(a, b, sort, desc); });
  const info = importInfo_();
  const refs = loadCardHistRefs_();
  return {
    total: groups.length,
    sort: sort,
    desc: desc,
    dex: dexNr || null,
    groups: groups.slice(0, MAX_GROUPS).map(function (g) {
      const o = groupForUi_(g.gkey, g.rows, st.headers, info, refs);
      if (needDex) o.dex = g.dex;
      return o;
    })
  };
}

/**
 * Die ganze Sammlung für den Tab Sammlung (#30): alle Gruppen wie in searchCollection, ohne Grenze und unsortiert
 * (Reihenfolge wie im Blatt Daten). Suchen, Filtern und Sortieren macht der Browser mit den Werten in k, ohne weitere
 * Aufrufe. -> {groups: [collGroup_], total, pending (noch nicht einsortiert, #41)}
 */
function getCollection() {
  ensureSchema_();
  let st = dataStore_();
  if (needsRepair_(st.rows)) { // wie searchCollection: erst reparieren, sonst lassen sich Exemplare nicht ändern
    withLock_(function () { rebuildGroups_(); });
    st = dataStore_();
  }
  const ctx = collCtx_();
  const groups = groupRows_(st.rows).map(function (g) {
    return collGroup_(g.gkey, g.idx.map(function (i) { return st.rows[i]; }), st.headers, ctx);
  });
  return { groups: groups, total: groups.length, pending: pendingCount_(st.rows) };
}

/** Nachschlagewerte für collGroup_, einmal pro Aufruf gelesen. */
function collCtx_() {
  return { info: importInfo_(), refs: loadCardHistRefs_(), dexIds: loadDexIds_(), ranks: rarityRanks_(), sets: cachedSets_() };
}

/**
 * Eine Gruppe fürs UI (groupForUi_) mit dex (Pokédex-Nummern) und k: Werte zum Suchen (words, num, size), für den
 * Set-Filter (setId, sets: Setnamen deutsch und englisch) und zum Sortieren (wie setOrder_ und collSortValue_).
 * Der Browser vergleicht damit genau wie searchCollection.
 */
function collGroup_(gkey, rows, headers, ctx) {
  const o = groupForUi_(gkey, rows, headers, ctx.info, ctx.refs);
  const p = orderGroupRows_(rows)[0];
  const low = function (x) { return String(x == null ? '' : x).toLowerCase(); };
  const setId = String(p[COL.setId] || '');
  const sets = [low(p[COL.setName])];
  ['de', 'en'].forEach(function (lang) {
    const info = ctx.sets[lang] && ctx.sets[lang][setId];
    if (info && info.name && sets.indexOf(low(info.name)) < 0) sets.push(low(info.name));
  });
  const rk = rarityKey_(p[COL.rarity]);
  let added = null;
  rows.forEach(function (r) { const x = timeOf_(r[COL.added]); if (isFinite(x) && (added == null || x > added)) added = x; });
  o.dex = dexOfRow_(p, ctx.dexIds);
  o.k = {
    words: [low(p[COL.name]), low(p[COL.nameEn]), low(p[COL.version]), low(p[COL.illustrator])],
    num: normalizeNumber_(p[COL.localId]), size: Number(p[COL.setSize]) || 0,
    setId: setId, sets: sets,
    setDate: groupSetDate_(rows), numSort: Number(p[COL.numSort]) || 0, localId: String(p[COL.localId] == null ? '' : p[COL.localId]),
    variant: String(p[COL.variant] == null ? '' : p[COL.variant]), version: versionText_(p[COL.version]), name: String(p[COL.name] || ''),
    rank: rk && ctx.ranks[rk] != null ? ctx.ranks[rk] : null, added: added
  };
  return o;
}

/**
 * Nach einer Änderung in der Sperre: die betroffenen Gruppen fürs UI, damit es nur diese Karten austauscht statt neu
 * zu laden (#30). -> {groups: [collGroup_], gone: [Schlüssel ohne Zeilen]}
 */
function collDelta_(st) {
  const keys = storeTouchedGroups_(st);
  const want = {};
  keys.forEach(function (k) { want[k] = []; });
  st.rows.forEach(function (r, i) {
    if (!storeLive_(st, i)) return;
    const g = groupKey_(r);
    if (g in want) want[g].push(r);
  });
  const ctx = collCtx_();
  const out = { groups: [], gone: [] };
  keys.forEach(function (k) {
    if (want[k].length) out.groups.push(collGroup_(k, want[k], st.headers, ctx));
    else out.gone.push(k);
  });
  return out;
}

/**
 * Anzahl einer Exemplar-Zeile ändern (eid = Eintrag-ID). Nie unter 0, die Zeile bleibt.
 * +1 auf eine Import-Zeile landet in der Zeile „von Hand“ desselben Eintrags (wird bei Bedarf angelegt).
 * -1 auf eine Import-Zeile wird als 'handentfernt' im Import-Protokoll vermerkt.
 * -> {token: {eid, applied, logIds, createdEid}, eid, count, groupCount, applied, gkey, delta (collDelta_, null ohne Änderung),
 *     pending (noch nicht einsortiert, #41)}
 */
function adjustEntry(eid, delta) {
  ensureSchema_();
  delta = Math.round(Number(delta) || 0);
  return withLock_(function () {
    const st = dataStore_();
    const i0 = storeFindEid_(st, eid);
    if (i0 < 0) throw new Error('Eintrag nicht gefunden. Bitte die Liste neu laden.');
    const ct = changeTime_(), now = ct.now;
    let i = i0;
    let createdEid = '';
    if (delta > 0 && !isHandOrigin_(st.rows[i0][COL.origin])) {
      const src = st.rows[i0];
      const key = entryKey_(src);
      i = storeFindHand_(st, key, -1);
      if (i < 0) {
        const copy = src.slice();
        copy[COL.eid] = newEid_();
        copy[COL.origin] = ORIGIN_HAND;
        copy[COL.fp] = '';
        copy[COL.count] = 0;
        copy[COL.key] = key;
        copy[COL.added] = now;
        copy[COL.changed] = now;
        i = storeAdd_(st, copy);
        createdEid = copy[COL.eid];
      }
    }
    const r = st.rows[i];
    const cur = Number(r[COL.count]) || 0;
    const next = Math.max(0, cur + delta);
    const applied = next - cur;
    let logIds = [];
    if (applied !== 0) {
      r[COL.count] = next;
      r[COL.changed] = now;
      storeTouch_(st, i);
    }
    const nr = importNrOf_(r[COL.origin]);
    if (applied < 0 && nr != null) {
      const inf = importInfo_()[nr];
      logIds = appendProto_([{
        nr: nr, type: 'handentfernt', eid: String(r[COL.eid]), fp: String(r[COL.fp] || ''), qty: -applied,
        data: { countBefore: cur }, status: 'erledigt', sourceId: inf ? inf.sourceId : ''
      }]);
    }
    const pending = applied !== 0 || createdEid ? lightSave_(st, ct.since) : pendingCount_(storeLiveRows_(st), ct.since);
    const diff = applied !== 0 ? collDelta_(st) : null;
    const gkey = groupKey_(r);
    const eidNow = String(r[COL.eid]);
    return {
      token: { eid: eidNow, applied: applied, logIds: logIds, createdEid: createdEid },
      eid: eidNow, count: next, groupCount: storeGroupCount_(st, gkey), applied: applied, gkey: gkey, delta: diff, pending: pending
    };
  });
}

/**
 * Macht adjustEntry genau rückgängig (token aus adjustEntry): Anzahl zurück, Protokolleinträge weg,
 * eine dabei angelegte Zeile „von Hand“ wird wieder gelöscht, wenn sie leer ist.
 * -> {eid, count, groupCount, gkey, delta (collDelta_; fehlt, wenn der Eintrag nicht mehr da ist), pending}
 */
function revertAdjust(token) {
  ensureSchema_();
  token = token || {};
  const applied = Math.round(Number(token.applied) || 0);
  return withLock_(function () {
    const st = dataStore_();
    const i = storeFindEid_(st, token.eid);
    if (token.logIds && token.logIds.length) deleteProtoByIds_(token.logIds);
    if (i < 0) {
      return { eid: String(token.eid || ''), count: 0, groupCount: 0, gkey: '', pending: pendingCount_(storeLiveRows_(st)) };
    }
    const r = st.rows[i];
    const ct = changeTime_(), now = ct.now;
    const cur = Number(r[COL.count]) || 0;
    const next = Math.max(0, cur - applied);
    if (next !== cur) {
      r[COL.count] = next;
      r[COL.changed] = now;
      storeTouch_(st, i);
    }
    const gkey = groupKey_(r);
    if (token.createdEid) {
      const k = storeFindEid_(st, token.createdEid);
      if (k >= 0 && (Number(st.rows[k][COL.count]) || 0) === 0) {
        storeRemove_(st, k);
        // Die gelöschte Zeile zählt nicht mehr als geändert: eine andere Zeile der Karte trägt die Änderung, falls die
        // Sammlung das +1 schon einsortiert hat (#41)
        const other = storeGroupIdx_(st, gkey)[0];
        if (other != null) { st.rows[other][COL.changed] = now; storeTouch_(st, other); }
      }
    }
    const pending = lightSave_(st, ct.since);
    const diff = collDelta_(st);
    return { eid: String(r[COL.eid]), count: next, groupCount: storeGroupCount_(st, gkey), gkey: gkey, delta: diff, pending: pending };
  });
}

/**
 * Exemplar-Zeile bearbeiten. changes = {cond?, cardLang?, version?, extras?: {Name: Wert}} (nur Angegebenes ändert sich),
 * qty = wie viele Exemplare dieser Zeile (Standard: alle). Bei qty < Anzahl wird die Zeile geteilt.
 * Hat danach eine andere Zeile denselben Schlüssel, dieselbe Herkunft und dieselbe Quellzeile, wird zusammengelegt.
 * -> {ok, eid (Ergebniszeile), gkey, delta (collDelta_: alte und neue Gruppe; fehlt, wenn sich nichts änderte), pending}
 */
function editEntry(eid, changes, qty) {
  ensureSchema_();
  changes = changes || {};
  let cond = null, lang = null, version = null;
  if (changes.cond !== undefined && changes.cond !== null) {
    cond = condCode_(changes.cond);
    if (cond == null) throw new Error('Unbekannter Zustand „' + changes.cond + '“.');
  }
  const langIn = changes.cardLang !== undefined ? changes.cardLang : changes.lang;
  if (langIn !== undefined && langIn !== null) lang = langCode_(langIn);
  if (changes.version !== undefined && changes.version !== null) version = versionText_(changes.version);
  const extras = changes.extras && typeof changes.extras === 'object' ? changes.extras : {};
  const extraNames = Object.keys(extras).map(function (n) { return String(n).trim(); }).filter(Boolean);

  return withLock_(function () {
    const st = dataStore_();
    const i0 = storeFindEid_(st, eid);
    if (i0 < 0) throw new Error('Eintrag nicht gefunden. Bitte die Liste neu laden.');
    const extraCols = {};
    extraNames.forEach(function (n) { extraCols[n] = storeEnsureExtra_(st, n); });
    const src = st.rows[i0];
    const count = Number(src[COL.count]) || 0;
    let n = count;
    if (qty !== undefined && qty !== null && qty !== '') {
      n = Math.floor(Number(qty));
      if (!(n >= 1)) throw new Error('Bitte eine Anzahl ab 1 angeben.');
      n = Math.min(n, count);
    }
    const whole = count === 0 || n >= count;
    const ct = changeTime_(), now = ct.now;
    const oldKey = entryKey_(src);
    const next = src.slice();
    if (cond != null) next[COL.cond] = cond;
    if (lang != null) next[COL.lang] = lang;
    if (version != null) next[COL.version] = version;
    Object.keys(extras).forEach(function (name) {
      const c = extraCols[String(name).trim()];
      if (c != null) next[c] = extras[name] == null ? '' : String(extras[name]).trim();
    });
    const changed = next.some(function (v, c) { return c !== COL.changed && String(v) !== String(src[c]); });
    if (!changed) return { ok: true, eid: String(src[COL.eid]), gkey: groupKey_(src), pending: pendingCount_(storeLiveRows_(st), ct.since) };
    const newKey = entryKey_(next);
    next[COL.key] = newKey;
    next[COL.changed] = now;
    let t;
    if (whole) {
      st.rows[i0] = next;
      storeTouch_(st, i0);
      t = i0;
    } else {
      src[COL.count] = count - n;
      src[COL.changed] = now;
      storeTouch_(st, i0);
      next[COL.eid] = newEid_();
      next[COL.count] = n;
      t = storeAdd_(st, next);
    }
    // zusammenlegen: gleicher Schlüssel, gleiche Herkunft, gleiche Quellzeile
    if (newKey !== oldKey) {
      const origin = normOrigin_(next[COL.origin]);
      const fp = String(next[COL.fp] || '');
      for (let j = 0; j < st.rows.length; j++) {
        if (j === t || !storeLive_(st, j)) continue;
        const r = st.rows[j];
        if (normOrigin_(r[COL.origin]) !== origin || String(r[COL.fp] || '') !== fp || entryKey_(r) !== newKey) continue;
        r[COL.count] = (Number(r[COL.count]) || 0) + (Number(st.rows[t][COL.count]) || 0);
        r[COL.changed] = now;
        r[COL.key] = newKey;
        storeTouch_(st, j);
        storeRemove_(st, t);
        t = j;
        break;
      }
    }
    const pending = lightSave_(st, ct.since);
    const diff = collDelta_(st);
    return { ok: true, eid: String(st.rows[t][COL.eid]), gkey: groupKey_(st.rows[t]), delta: diff, pending: pending };
  });
}

/**
 * Eigener Preis für eine ganze Gruppe (alle Zeilen). price > 0 setzt ihn mit heutigem Datum,
 * null/''/0 entfernt ihn. -> {gkey, price (Preis der Gruppe danach oder null), priceManual, delta (collDelta_), pending}
 */
function setGroupOwnPrice(gkey, price) {
  ensureSchema_();
  const p = ownPriceOf_(price);
  return withLock_(function () {
    const st = dataStore_();
    const ct = changeTime_();
    const n = storeSetGroupOwnPrice_(st, String(gkey), p, ct.now);
    if (!n) throw new Error('Diese Karte wurde nicht gefunden. Bitte die Liste neu laden.');
    const pending = lightSave_(st, ct.since);
    const diff = collDelta_(st);
    const gp = groupPrice_(storeGroupIdx_(st, String(gkey)).map(function (i) { return st.rows[i]; }));
    return { gkey: String(gkey), price: gp.price, priceManual: gp.manual, delta: diff, pending: pending };
  });
}

/**
 * Freie Gruppe mit einer tcgdex-Karte verknüpfen. dataLang 'de'|'en', variant 'base'|'reverse'|'firstEdition'
 * (auch 'normal'/'holo'). Zustand, Sprache, Sonderversion, Anzahl, Herkunft, Zusatzwerte und eigener Preis bleiben.
 * Zeilen „von Hand“ mit nun gleichem Schlüssel werden zusammengelegt. Fehlen Set-Datum oder Pokédex-Nummern, holt sie das
 * Einsortieren. -> {gkey (neu), delta (collDelta_), pending}
 */
function linkFreeGroup(gkey, cardId, dataLang, variant) {
  ensureSchema_();
  gkey = String(gkey == null ? '' : gkey);
  const lang = dataLang === 'en' ? 'en' : 'de';
  const card = fetchCard_(lang, cardId);
  if (!card) throw new Error('Karte ' + cardId + ' nicht gefunden, nichts geändert.');
  const p = cardmarketWithFallback_(card, lang); // ergänzt auch das Bild aus den englischen Daten
  const s = summarizeCard_(card, lang);
  const v = VARIANT_LABELS[variant] ? variant : s.baseVariant;
  const price = priceFor_(p.cm, v);
  const priceDate = p.cm ? dateText_(p.cm.updated) : '';
  const set = card.set || {};
  const setId = String(set.id || setIdOf_(card));
  const setDate = knownSetDate_(lang, setId); // fehlt es (neues Set), holt es das Einsortieren

  return withLock_(function () {
    const st = dataStore_();
    const idx = storeGroupIdx_(st, gkey);
    if (!idx.length) throw new Error('Diese Karte wurde nicht gefunden. Bitte die Liste neu laden.');
    if (idx.some(function (i) { return String(st.rows[i][COL.id] || ''); })) throw new Error('Diese Karte ist schon mit tcgdex verknüpft.');
    const ct = changeTime_(), now = ct.now;
    const inGroup = {};
    idx.forEach(function (i) { inGroup[i] = true; });
    idx.forEach(function (i) {
      const r = st.rows[i];
      r[COL.id] = String(card.id);
      r[COL.setId] = setId;
      r[COL.setName] = String(set.name || setId);
      r[COL.setDate] = setDate;
      r[COL.localId] = String(card.localId);
      r[COL.normNum] = normalizeNumber_(card.localId);
      r[COL.setSize] = s.setSize || '';
      if (lang === 'de') r[COL.name] = String(card.name || '');
      r[COL.nameEn] = lang === 'en' ? String(card.name || '') : '';
      r[COL.source] = lang === 'en' ? 'en-Ersatz' : 'de';
      r[COL.variant] = v;
      r[COL.price] = price == null ? '' : price;
      r[COL.priceDate] = priceDate;
      r[COL.img] = card.image || '';
      r[COL.rarity] = card.rarity || '';
      r[COL.category] = card.category || '';
      r[COL.illustrator] = card.illustrator || '';
      r[COL.numSort] = numSortOf_(card.localId);
      r[COL.key] = entryKey_(r);
      r[COL.changed] = now;
      storeTouch_(st, i);
    });
    // Zeilen „von Hand“ mit jetzt gleichem Schlüssel zusammenlegen (bestehende Zeile bleibt)
    idx.forEach(function (i) {
      const r = st.rows[i];
      if (st.removed[i] || !isHandOrigin_(r[COL.origin])) return;
      let target = -1;
      for (let j = 0; j < st.rows.length; j++) {
        if (j === i || inGroup[j] || !storeLive_(st, j)) continue;
        if (isHandOrigin_(st.rows[j][COL.origin]) && entryKey_(st.rows[j]) === r[COL.key]) { target = j; break; }
      }
      if (target < 0) {
        for (let k = 0; k < idx.length && idx[k] < i; k++) {
          const j = idx[k];
          if (storeLive_(st, j) && isHandOrigin_(st.rows[j][COL.origin]) && st.rows[j][COL.key] === r[COL.key]) { target = j; break; }
        }
      }
      if (target < 0) return;
      const t = st.rows[target];
      t[COL.count] = (Number(t[COL.count]) || 0) + (Number(r[COL.count]) || 0);
      t[COL.changed] = now;
      if (typeof t[COL.ownPrice] !== 'number' && typeof r[COL.ownPrice] === 'number') {
        t[COL.ownPrice] = r[COL.ownPrice];
        t[COL.ownPriceDate] = r[COL.ownPriceDate];
      }
      storeTouch_(st, target);
      storeRemove_(st, i);
    });
    const pending = lightSave_(st, ct.since);
    const diff = collDelta_(st);
    const first = idx.filter(function (i) { return !st.removed[i]; })[0];
    const keyRow = first != null ? st.rows[first] : st.rows[idx[0]];
    return { gkey: groupKey_(keyRow), delta: diff, pending: pending };
  });
}

/** Vorschlagsliste fürs Setfeld. */
function getSetSuggestions() {
  const sets = cachedSets_();
  const names = {};
  ['de', 'en'].forEach(function (lang) {
    Object.keys(sets[lang]).forEach(function (id) { names[sets[lang][id].name] = true; });
  });
  return Object.keys(names).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'de'); });
}

// ---------------------------------------------------------------------------
// 6a. Einsortieren (#41)
// ---------------------------------------------------------------------------

const SORT_IN_DEX_MAX = 100; // Pokédex-Nummern von höchstens so vielen Karten pro Lauf von tcgdex, den Rest holt die Nacht

/**
 * Knopf „Einsortieren“ (Seitenleiste, Web-App, Dashboard) und Menü Pokémon > Einsortieren: alles, was seit dem letzten
 * Mal nur gespeichert wurde, in Sammlung, Pokédex, Seltenheiten und Dashboard bringen (sortIn_).
 * opts.ui (Seitenleiste und Web-App): ohne Meldung unten rechts, dort zeigt die Leiste das Ergebnis.
 * -> {message, pending (danach 0), sorted (einsortierte Einträge), filled (von tcgdex ergänzte Werte)}
 */
function einsortieren(opts) {
  const ui = !!(opts && opts.ui === true);
  ensureSchema_();
  if (!ui) notifyBusy_('Sortiere ein …');
  let res;
  try {
    res = sortIn_();
  } catch (e) {
    if (!ui) notifyDone_('Einsortieren ging nicht: ' + e.message);
    throw e;
  }
  if (!ui) notifyDone_(res.message);
  return res;
}

/**
 * Einsortieren: Erscheinungsdaten neuer Sets und Pokédex-Nummern neuer Karten von tcgdex holen (parallel, ohne Sperre),
 * dann in der Sperre die Daten ergänzen und Gruppen, Seltenheiten, Pokédex und Dashboard einmal neu aufbauen
 * (rebuildGroups_). Ist nichts offen und fehlt nichts, bleibt alles, wie es ist. Läuft auch am Ende des Preislaufs.
 * -> {message, pending, sorted, filled}
 */
function sortIn_() {
  const rows = readData_(sheet_(SHEETS.data));
  const need = {};
  rows.forEach(function (r) {
    if (!isDataRow_(r) || r[COL.setDate] || !r[COL.setId]) return;
    const id = String(r[COL.setId]);
    if (!need[id]) need[id] = { lang: langOfRow_(r) };
  });
  const dates = setReleaseDates_(need);
  const dexMap = missingDexIds_(rows);
  const res = withLock_(function () {
    const st = dataStore_();
    let dated = 0;
    st.rows.forEach(function (r, i) {
      if (!isDataRow_(r) || r[COL.setDate] || !r[COL.setId]) return;
      const d = dates[String(r[COL.setId])];
      if (d) { r[COL.setDate] = d; storeTouch_(st, i); dated++; }
    });
    if (dated) storeSave_(st);
    const dexed = storeDexIds_(dexMap);
    const sorted = pendingCount_(storeLiveRows_(st));
    if (sorted || dated || dexed) rebuildGroups_();
    return { sorted: sorted, filled: dated + dexed };
  });
  // Die Sammlung kann jetzt mehr Zeilen haben (früher nach dem Hinzufügen)
  if (res.sorted || res.filled) { try { applyRowHeights_(); } catch (e) { /* egal */ } }
  let msg;
  if (res.sorted) msg = res.sorted + (res.sorted === 1 ? ' Änderung' : ' Änderungen') + ' einsortiert.';
  else if (res.filled) msg = 'Fehlende Daten von tcgdex ergänzt.';
  else msg = 'Alles war schon einsortiert.';
  if (res.sorted || res.filled) msg += ' Sammlung, Pokédex und Dashboard sind auf dem neuesten Stand.';
  return { message: msg, pending: 0, sorted: res.sorted, filled: res.filled };
}

/**
 * Pokédex-Nummern der Karten, die das Blatt Pokédex-Nummern noch nicht kennt (das leichte Speichern merkt sie nicht):
 * aus dem Zwischenspeicher der Suche, sonst parallel von tcgdex, höchstens SORT_IN_DEX_MAX Karten.
 * -> {Karten-ID: [Nummern]} für storeDexIds_ (leere Liste: tcgdex kennt keine)
 */
function missingDexIds_(rows) {
  const known = loadDexIds_();
  const want = {};
  rows.forEach(function (r) {
    const id = String(r[COL.id] || '');
    if (id && isDataRow_(r) && !(id in known) && !(id in want)) want[id] = langOfRow_(r);
  });
  const ids = Object.keys(want).slice(0, SORT_IN_DEX_MAX);
  const out = {};
  if (!ids.length) return out;
  let cached = {};
  try {
    cached = CacheService.getScriptCache().getAll(ids.map(function (id) { return cardCacheKey_(want[id], id); })) || {};
  } catch (e) { cached = {}; }
  const fetch = ids.filter(function (id) {
    let card = null;
    try { card = JSON.parse(cached[cardCacheKey_(want[id], id)] || 'null'); } catch (e) { card = null; }
    if (card) out[id] = dexIdsOf_(card);
    return !card;
  });
  for (let k = 0; k < fetch.length; k += PRICE_BATCH) {
    const part = fetch.slice(k, k + PRICE_BATCH);
    const res = fetchAllJson_(part.map(function (id) { return apiUrl_(want[id], 'cards/' + encodeURIComponent(id)); }));
    part.forEach(function (id, i) {
      if (res[i].ok) out[id] = dexIdsOf_(res[i].data);
      else if (res[i].notFound) out[id] = [];
    });
  }
  return out;
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
  dropSetsCache_();
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

/** Zeit-Trigger (täglich 3–4 Uhr). Schaut danach auch nach einer neuen Version (nur Hinweis, kein Update). */
function naechtlicherPreislauf() {
  if (takenOverBy_()) { stopTriggers_(); return; }
  // Lebenszeichen für triggersMissing_: Dieser Auslöser läuft, auch wenn der Preislauf danach scheitert
  try { settingSet_('NIGHTLY_AT', Utilities.formatDate(new Date(), tz_(), 'dd.MM.yyyy HH:mm')); } catch (e) { /* weiter */ }
  startPriceRun_();
  try { checkForUpdate_(); } catch (e) { /* ohne Netz oder GitHub weiter */ }
  // eine neue Version gleich im Dashboard zeigen (der Preislauf hat es vor der Prüfung geschrieben)
  try { refreshDashboard_(readData_(sheet_(SHEETS.data))); } catch (e) { /* beim nächsten Neuaufbau */ }
}

function startPriceRun_() {
  ensureSchema_();
  deleteTriggersFor_('continuePriceRun');
  PropertiesService.getScriptProperties().setProperty('PRICE_RUN', JSON.stringify({ pos: 0, failed: 0 }));
  return continuePriceRun();
}

function langOfRow_(r) {
  return r[COL.source] === 'en-Ersatz' ? 'en' : 'de';
}

/**
 * Karten für den Preislauf (lang|id). Freie Karten (ohne ID) nie. Karten mit eigenem Preis schon (seit 1.1.0): Ihr
 * Trendpreis kommt in den Kartenverlauf, damit die Kurve ihn zeigt; in der Sammlung zählt weiter der eigene Preis.
 */
function priceTargets_() {
  const rows = readData_(sheet_(SHEETS.data));
  const seen = {};
  rows.forEach(function (r) {
    const id = String(r[COL.id] || '');
    if (id && isDataRow_(r)) seen[langOfRow_(r) + '|' + id] = true;
  });
  return Object.keys(seen).sort().map(function (k) {
    const i = k.indexOf('|');
    return { lang: k.slice(0, i), id: k.slice(i + 1), key: k };
  });
}

/** Läuft in Paketen; nach ~5 Minuten Pause und Fortsetzung per Einmal-Trigger. */
function continuePriceRun() {
  deleteTriggersFor_('continuePriceRun');
  if (takenOverBy_()) { stopTriggers_(); return 'Diese Tabelle wurde übernommen.'; }
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('PRICE_RUN');
  if (!raw) return 'Kein Preislauf aktiv.';
  ensureSchema_();
  const state = JSON.parse(raw);
  const t0 = Date.now();
  const targets = priceTargets_();

  while (state.pos < targets.length) {
    if (Date.now() - t0 > PRICE_TIME_LIMIT_MS) {
      props.setProperty('PRICE_RUN', JSON.stringify(state));
      try { withLock_(function () { rebuildGroups_(); }); } catch (e) { /* beim nächsten Paket */ }
      ScriptApp.newTrigger('continuePriceRun').timeBased().after(60 * 1000).create();
      return 'Preislauf bei ' + state.pos + ' von ' + targets.length + ' Karten pausiert, geht in einer Minute weiter.';
    }
    const batch = targets.slice(state.pos, state.pos + PRICE_BATCH);
    const res = fetchAllJson_(batch.map(function (t) { return apiUrl_(t.lang, 'cards/' + encodeURIComponent(t.id)); }));
    const cmByKey = {};
    const dexById = {};
    const needEn = [];
    batch.forEach(function (t, i) {
      if (!res[i].ok) { state.failed++; return; }
      dexById[t.id] = dexIdsOf_(res[i].data);
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
    const isLast = state.pos + batch.length >= targets.length;
    writePrices_(cmByKey, isLast, dexById);
    state.pos += batch.length;
    props.setProperty('PRICE_RUN', JSON.stringify(state));
    if (state.pos < targets.length) Utilities.sleep(1000);
  }

  // Set-Daten, Pokédex-Nummern und alles, was seit dem letzten Paket gespeichert wurde, einsortieren (#41)
  try { sortIn_(); } catch (e) { /* nächste Nacht wieder */ }
  writeHistory_(state.failed);
  props.deleteProperty('PRICE_RUN');
  return 'Preise für ' + targets.length + ' Karten aktualisiert' +
    (state.failed ? ', ' + state.failed + ' Abrufe fehlgeschlagen (alter Preis bleibt)' : '') + '.';
}

/**
 * Trendpreise schreiben (auch bei Karten mit eigenem Preis, der eigene Preis hat in der Ansicht Vorrang).
 * rebuild: nach dem letzten Paket; schreibt den Kartenverlauf und berechnet die Gruppen neu (bei einer Pause baut
 * continuePriceRun nur die Gruppen neu). dexById (optional): Pokédex-Nummern der abgerufenen Karten {Karten-ID: [Nummern]}.
 */
function writePrices_(cmByKey, rebuild, dexById) {
  withLock_(function () {
    if (dexById) storeDexIds_(dexById);
    const sh = sheet_(SHEETS.data);
    const rows = readData_(sh);
    if (!rows.length) return;
    let changed = false;
    const out = rows.map(function (r) {
      const k = langOfRow_(r) + '|' + r[COL.id];
      if (!r[COL.id] || !(k in cmByKey)) return [r[COL.price], r[COL.priceDate]];
      changed = true;
      const cm = cmByKey[k];
      const p = priceFor_(cm, r[COL.variant]);
      return [p == null ? '' : p, cm ? dateText_(cm.updated) : ''];
    });
    if (changed) sh.getRange(2, COL.price + 1, out.length, 2).setValues(out);
    if (rebuild) {
      out.forEach(function (o, i) { rows[i][COL.price] = o[0]; });
      try { writeCardHistory_(rows); } catch (e) { /* nächster Preislauf; die Preise sind geschrieben */ }
      rebuildGroups_();
    }
  });
}

/** Gesamtwert wie in der Sammlung: pro Gruppe Preis (eigener Preis vor Trendpreis) mal Anzahl. */
function collectionValue_(rows) {
  let total = 0, cards = 0, noPrice = 0;
  groupRows_(rows).forEach(function (g) {
    const rs = g.idx.map(function (i) { return rows[i]; });
    const n = rs.reduce(function (s, r) { return s + (Number(r[COL.count]) || 0); }, 0);
    if (n <= 0) return;
    cards += n;
    const gp = groupPrice_(rs);
    if (gp.price != null) total += gp.price * n;
    else noPrice++;
  });
  return { total: Math.round(total * 100) / 100, cards: cards, noPrice: noPrice };
}

function writeHistory_(failed) {
  const rows = readData_(sheet_(SHEETS.data));
  const v = collectionValue_(rows);
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
  sh.getRange(target, 1, 1, 5).setValues([[d, v.total, v.cards, v.noPrice, failed]]);
  try { refreshDashboard_(rows); } catch (e) { /* beim nächsten Neuaufbau wieder */ }
}

// ---------- Preisverlauf pro Karte (Blatt Kartenverlauf, versteckt) ----------
// Eine Zeile pro Karten-ID + Variante. „Verlauf“ hält die Trendpreise als Text „2026-10-23=1.5;2026-10-30=1.75“, mit
// einem Eintrag nur, wenn sich der Preis geändert hat (an einem Tag zählt der letzte Preislauf). Die Spalten davor
// rechnet jeder Preislauf für alle Zeilen neu: der Vergleichspreis vor 7, 30 und 90 Tagen und „Seit“ (leer beim ganzen
// Zeitraum, sonst der erste Tag des Verlaufs). Sammlung und Seitenleiste lesen nur diese Spalten, die Kurve „Verlauf“.

function histKey_(id, variant) {
  return String(id == null ? '' : id).trim() + '|' + String(variant == null ? '' : variant).trim();
}

/** Auf Cent runden, ohne -0. */
function round2_(n) {
  return Math.round(n * 100) / 100 || 0;
}

/** 'yyyy-MM-dd=Preis;…' -> [{d, p}] nach Tag sortiert, ein Eintrag pro Tag (der letzte im Text gilt). */
function parseHistSeries_(text) {
  const byDay = {};
  String(text == null ? '' : text).split(';').forEach(function (part) {
    const m = /^\s*(\d{4}-\d{2}-\d{2})=(-?\d+(?:\.\d+)?)\s*$/.exec(part);
    if (m) byDay[m[1]] = Number(m[2]);
  });
  return Object.keys(byDay).sort().map(function (d) { return { d: d, p: byDay[d] }; });
}

/** [{d, p}] -> Text für die Zelle; ist er zu lang, fallen die ältesten Einträge weg. */
function histSeriesText_(series) {
  const parts = series.map(function (e) { return e.d + '=' + e.p; });
  let len = parts.join(';').length;
  let from = 0;
  while (len > CARD_HIST_MAX_CHARS && from < parts.length - 1) { len -= parts[from].length + 1; from++; }
  return parts.slice(from).join(';');
}

/** Preis von heute anhängen, nur wenn er sich geändert hat; ein zweiter Lauf am selben Tag ersetzt den von heute. */
function addHistPrice_(series, today, price) {
  let last = series[series.length - 1];
  if (last && last.d >= today) { series.pop(); last = series[series.length - 1]; }
  if (!last || last.p !== price) series.push({ d: today, p: price });
  return series;
}

/**
 * Vergleichspreis days Tage vor today: der letzte Eintrag bis dahin ({p, since: ''}), sonst der erste Eintrag, wenn er
 * vor today liegt ({p, since: sein Tag}, der Verlauf ist kürzer als der Zeitraum). null: kein Verlauf oder erst seit today.
 */
function histRef_(series, today, days) {
  if (!series.length) return null;
  const refDay = dashDayShift_(today, -days);
  let ref = null;
  for (let i = 0; i < series.length && series[i].d <= refDay; i++) ref = series[i];
  if (ref) return { p: ref.p, since: '' };
  return series[0].d < today ? { p: series[0].p, since: series[0].d } : null;
}

/**
 * Ein vorhandenes Blatt name, das nicht vom Tool ist (nicht in TOOL_SHEETS dieser Tabelle, andere Kopfzeile, nicht
 * leer), heißt danach „name (alt)“: Das Tool legt dann sein eigenes an, ohne fremde Daten zu überschreiben.
 */
function keepForeignSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return;
  let stored = [];
  try { stored = JSON.parse(settingGet_('TOOL_SHEETS') || '[]'); } catch (e) { stored = []; }
  if (Array.isArray(stored) && stored.indexOf(name) >= 0) return;
  const got = sh.getRange(1, 1, 1, 2).getValues()[0].map(function (v) { return String(v == null ? '' : v).trim(); });
  if (got[0] === headers[0] && got[1] === headers[1]) return;
  let alt = name + ' (alt)';
  for (let i = 2; ss.getSheetByName(alt); i++) alt = name + ' (alt ' + i + ')';
  sh.setName(alt);
  notify_('Dein Blatt „' + name + '“ heißt jetzt „' + alt + '“. Das Tool braucht den Namen für sein eigenes Blatt.');
}

function setupCardHistSheet_(ss) {
  keepForeignSheet_(ss, SHEETS.cardHist, CARD_HIST_HEADERS);
  return setupSimpleSheet_(ss, SHEETS.cardHist, CARD_HIST_HEADERS, [0, 1, 2, 4, 6, 8, 9], true);
}

/**
 * Nach dem letzten Paket des Preislaufs (in der Sperre): Trendpreise der Daten-Zeilen rows in den Kartenverlauf,
 * Vergleichspreise aller Zeilen neu. Karten, die nicht mehr in der Sammlung sind, behalten ihren Verlauf.
 * today: 'yyyy-MM-dd' (Standard heute). -> Anzahl Zeilen im Kartenverlauf
 */
function writeCardHistory_(rows, today) {
  today = today || todayText_();
  const now = {};
  rows.forEach(function (r) {
    const id = String(r[COL.id] || '').trim();
    const p = r[COL.price];
    if (!id || !isDataRow_(r) || typeof p !== 'number' || !isFinite(p)) return;
    const k = histKey_(id, r[COL.variant]);
    if (!(k in now)) now[k] = round2_(p);
  });
  const ss = ss_();
  const sh = ss.getSheetByName(SHEETS.cardHist) || setupCardHistSheet_(ss);
  const w = CARD_HIST_HEADERS.length;
  const last = sh.getLastRow();
  const byKey = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, w).getValues().forEach(function (r) {
      const id = String(r[0] == null ? '' : r[0]).trim();
      if (!id) return;
      const k = histKey_(id, r[1]);
      if (byKey[k]) byKey[k].text += ';' + r[w - 1]; // doppelte Zeile (von Hand kopiert): zusammenlegen
      else byKey[k] = { id: id, variant: String(r[1] == null ? '' : r[1]).trim(), text: String(r[w - 1] == null ? '' : r[w - 1]) };
    });
  }
  Object.keys(now).forEach(function (k) {
    if (byKey[k]) return;
    const i = k.indexOf('|');
    byKey[k] = { id: k.slice(0, i), variant: k.slice(i + 1), text: '' };
  });
  const out = Object.keys(byKey).sort().map(function (k) {
    const e = byKey[k];
    const series = parseHistSeries_(e.text);
    if (k in now) addHistPrice_(series, today, now[k]);
    const cells = [e.id, e.variant, today];
    CHANGE_DAYS.forEach(function (days) {
      const ref = histRef_(series, today, days);
      cells.push(ref ? ref.p : '', ref ? ref.since : '');
    });
    cells.push(histSeriesText_(series));
    return cells;
  });
  const all = [CARD_HIST_HEADERS].concat(out);
  growRows_(sh, all.length);
  ensureCols_(sh, w);
  const fmt = ['@', '@', '@', EUR_FORMAT, '@', EUR_FORMAT, '@', EUR_FORMAT, '@', '@'];
  const range = sh.getRange(1, 1, all.length, w);
  range.setNumberFormats(all.map(function (r, i) { return i === 0 ? CARD_HIST_HEADERS.map(function () { return '@'; }) : fmt; }));
  range.setValues(all);
  if (last > all.length) sh.getRange(all.length + 1, 1, last - all.length, w).clearContent();
  return out.length;
}

/** Vergleichspreise: {'id|variant': {7: {p, since}|null, 30: …, 90: …}}. Liest die Spalte Verlauf nicht. */
function loadCardHistRefs_() {
  const sh = ss_().getSheetByName(SHEETS.cardHist);
  if (!sh || sh.getLastRow() < 2) return {};
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3 + 2 * CHANGE_DAYS.length).getValues().forEach(function (r) {
    const id = String(r[0] == null ? '' : r[0]).trim();
    if (!id) return;
    const e = {};
    CHANGE_DAYS.forEach(function (days, j) {
      const p = r[3 + 2 * j], since = r[4 + 2 * j];
      e[days] = typeof p === 'number' && isFinite(p) ? { p: p, since: since instanceof Date ? dateText_(since) : String(since == null ? '' : since).trim() } : null;
    });
    out[histKey_(id, r[1])] = e;
  });
  return out;
}

/** Trendpreis einer Gruppe (der eigene Preis zählt hier nicht): die erste Zahl, „von Hand“ zuerst. */
function groupTrend_(rows) {
  const ordered = orderGroupRows_(rows);
  for (let i = 0; i < ordered.length; i++) {
    const pr = ordered[i][COL.price];
    if (typeof pr === 'number' && isFinite(pr)) return pr;
  }
  return null;
}

/**
 * Veränderung des Trendpreises einer Gruppe: {7: {eur, pct, since}|null, 30: …, 90: …}; null ohne Karten-ID, Trendpreis
 * oder Vergleichspreis. eur auf Cent, pct in ganzen Prozent (null bei Vergleichspreis 0), since 'yyyy-MM-dd' oder ''
 * (ganzer Zeitraum). refs aus loadCardHistRefs_.
 */
function groupChanges_(rows, refs) {
  if (!refs || !rows || !rows.length) return null;
  const p = orderGroupRows_(rows)[0];
  const id = String(p[COL.id] || '').trim();
  const e = id ? refs[histKey_(id, p[COL.variant])] : null;
  const cur = e ? groupTrend_(rows) : null;
  if (cur == null) return null;
  const out = {};
  let any = false;
  CHANGE_DAYS.forEach(function (days) {
    const ref = e[days];
    if (!ref) { out[days] = null; return; }
    any = true;
    const diff = cur - ref.p;
    out[days] = { eur: round2_(diff), pct: ref.p > 0 ? Math.round(diff / ref.p * 100) || 0 : null, since: ref.since };
  });
  return any ? out : null;
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

  // Punkte fürs Import-Werkzeug
  step('10. Snowflake / Cardmarket-Versionen', function () {
    ['dpp', 'hgss1'].forEach(function (id) {
      ['de', 'en'].forEach(function (lang) {
        const s = fetchJson_(apiUrl_(lang, 'sets/' + id));
        if (!s) { add('10. Pikachu in ' + id + ' (' + lang + ')', 'Set fehlt', ''); return; }
        const hits = (s.cards || []).filter(function (c) { return /pikachu/i.test(String(c.name || '')); });
        add('10. Pikachu in ' + id + ' (' + lang + ')', hits.length + ' Karten',
          hits.map(function (c) { return c.localId + ' ' + c.name + ' (' + c.id + ')'; }).join(', '));
      });
    });
  });

  step('11. Set-Kürzel', function () {
    ['sv03.5', 'ex11', 'hgss2', 'dpp', 'hgssp', 'me01'].forEach(function (id) {
      const en = fetchJson_(apiUrl_('en', 'sets/' + id));
      const de = fetchJson_(apiUrl_('de', 'sets/' + id));
      if (!en && !de) { add('11. Set ' + id, 'Set fehlt', ''); return; }
      const s = en || de;
      add('11. Set ' + id, 'abbreviation: ' + JSON.stringify(s.abbreviation === undefined ? null : s.abbreviation) +
        ', tcgOnline: ' + JSON.stringify(s.tcgOnline === undefined ? null : s.tcgOnline),
        'Name de: ' + (de ? de.name : '-') + ', Name en: ' + (en ? en.name : '-'));
    });
  });

  step('12. Promo-Nummern', function () {
    const ids = ['dpp', 'hgssp'];
    const sets = fetchJson_(apiUrl_('en', 'sets')) || [];
    sets.forEach(function (s) {
      const sid = String(s.id || '');
      if ((/^mep/i.test(sid) || /MEP/.test(String(s.name || ''))) && ids.indexOf(sid) < 0) ids.push(sid);
    });
    ids.forEach(function (id) {
      const s = fetchJson_(apiUrl_('en', 'sets/' + id)) || fetchJson_(apiUrl_('de', 'sets/' + id));
      if (!s) { add('12. Promo ' + id, 'Set fehlt', ''); return; }
      const lids = (s.cards || []).map(function (c) { return c.localId; });
      add('12. Promo ' + id + ' (' + (s.name || '') + ')', lids.length + ' Karten',
        'erste: ' + lids.slice(0, 8).join(', ') + ' / letzte: ' + lids.slice(-8).join(', '));
    });
  });

  step('13. Japanische Daten', function () {
    const sets = fetchJson_(apiUrl_('ja', 'sets'));
    const list = Array.isArray(sets) ? sets : [];
    add('13. /ja/sets', sets ? list.length + ' Sets' : 'nicht vorhanden', list.slice(0, 5).map(function (s) { return s.id + ' ' + s.name; }).join(', '));
    let cardId = '';
    for (let i = 0; i < list.length && !cardId && i < 3; i++) {
      const s = fetchJson_(apiUrl_('ja', 'sets/' + encodeURIComponent(list[i].id)));
      if (s && s.cards && s.cards.length) cardId = s.cards[0].id;
    }
    if (!cardId) { add('13. /ja/cards', 'keine Karte gefunden', ''); return; }
    const c = fetchJson_(apiUrl_('ja', 'cards/' + encodeURIComponent(cardId)));
    add('13. /ja/cards/' + cardId, c ? 'ja' : 'nicht gefunden',
      c ? { name: c.name, localId: c.localId, set: c.set && c.set.name, pricing: c.pricing ? Object.keys(c.pricing) : null } : '');
  });

  step('14. Drive-API für .xlsx', function () {
    const has = typeof Drive !== 'undefined';
    let ver = '';
    if (has) ver = Drive.Files && typeof Drive.Files.create === 'function' ? 'v3' : 'v2';
    add('14. Drive-API (Dienst „Drive“)', has ? 'vorhanden, ' + ver : 'fehlt',
      has ? 'xlsx-Dateien können umgewandelt werden.' : 'Für .xlsx-Dateien im Apps-Script-Editor links unter „Dienste“ die „Drive API“ hinzufügen.');
  });

  step('15. Pokédex-Nummern (dexId)', function () {
    const ids = ['base1-4', 'swsh3-136', 'sv03.5-006', 'swsh3-170'];
    const tag = fetchJson_(apiUrl_('en', 'cards', { name: 'Pikachu & Zekrom' })) || [];
    if (tag.length) ids.push(String(tag[0].id));
    ids.forEach(function (id) {
      const c = fetchJson_(apiUrl_('de', 'cards/' + encodeURIComponent(id))) || fetchJson_(apiUrl_('en', 'cards/' + encodeURIComponent(id)));
      if (!c) { add('15. dexId ' + id, 'Karte fehlt', ''); return; }
      add('15. dexId ' + id + ' ' + c.name, JSON.stringify(c.dexId === undefined ? null : c.dexId),
        'Kartentyp: ' + c.category + ', Seltenheit: ' + c.rarity + ', aus dem Namen: ' + JSON.stringify(dexFromName_(c.name)));
    });
  });

  step('16. Seltenheiten bei tcgdex', function () {
    const ranks = rarityRanks_();
    ['de', 'en'].forEach(function (lang) {
      const list = fetchJson_(apiUrl_(lang, 'rarities')) || [];
      const unknown = list.filter(function (x) { return !(rarityKey_(x) in ranks); });
      add('16. /' + lang + '/rarities', list.length + ' Seltenheiten, ' + unknown.length + ' nicht im Blatt „' + SHEETS.rarity + '“',
        'neu: ' + unknown.join(' | ') + ' / alle: ' + list.join(' | '));
    });
  });

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

// ---------------------------------------------------------------------------
// 10. Pokédex, Seltenheiten und Sortierung der Sammlung
// ---------------------------------------------------------------------------
//
// Pokédex-Nummern: tcgdex liefert sie als `dexId` (Liste) nur in der vollen Karte. Das Skript merkt sie sich
// pro Karten-ID im versteckten Blatt „Pokédex-Nummern“ (beim Hinzufügen, Verknüpfen und im Preislauf).
// Solange eine Karte dort fehlt (z. B. aus dem Import), gilt der Kartenname: „Glurak-ex“ -> 6.
// Trainer- und Energiekarten haben keine Nummer. Tag-Team-Karten zählen bei jedem ihrer Pokémon.
//
// Blatt „Pokédex-Daten“ (versteckt, vom Skript geschrieben): A:H je Pokémon eine Zeile, J:S je Pokémon und
// Karte (nur Karten mit Exemplaren). Das Blatt „Pokédex“ filtert beides per Formel.

const DEX_IDS_HEADERS = ['Karten-ID', 'Pokédex-Nr.', 'Abgerufen am'];
const DEX_LIST_HEADERS = ['Nr.', 'Name', 'Name englisch', 'Generation', 'Karten', 'Exemplare', 'Wert (EUR)', 'Auswahl'];
const DEX_CARD_HEADERS = ['Pokédex-Nr.', 'Karte', 'Set', 'Nummer', 'Variante', 'Seltenheit', 'Anzahl', 'Preis (EUR)', 'Kartenwert (EUR)', 'Bild-URL'];
const DEX_CARD_COL = 10; // Spalte J
const DEX_VIEW_HEADERS = ['Nr.', 'Name', 'Generation', 'Karten', 'Exemplare', 'Wert (EUR)'];
const DEX_VIEW_CARD_HEADERS = ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Seltenheit', 'Anzahl', 'Preis (EUR)', 'Wert (EUR)'];
const DEX_STATUS = ['Alle', 'Fehlend', 'Vorhanden'];
// letzte Nummer jeder Generation (1 bis 9)
const DEX_GEN_ENDS = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
const RARITY_HEADERS = ['Seltenheit', 'Stufe'];
// Startreihenfolge fürs Blatt „Seltenheiten“ (deutsche und englische tcgdex-Texte). Leere Stufe: beim Sortieren am Ende.
const RARITY_SEED = [
  ['Häufig', 1], ['Common', 1],
  ['Ungewöhnlich', 2], ['Uncommon', 2],
  ['Selten', 3], ['Rare', 3],
  ['Holografisch Selten', 4], ['Selten, Holografisch', 4], ['Holo Rare', 4], ['Rare Holo', 4],
  ['Doppelselten', 5], ['Double rare', 5], ['Holografisch Selten V', 5], ['Holo Rare V', 5],
  ['Holografisch Selten VMAX', 5], ['Holo Rare VMAX', 5], ['Holografisch Selten VSTAR', 5], ['Holo Rare VSTAR', 5],
  ['Selten, Holografisch LV.X', 5], ['Rare Holo LV.X', 5], ['selten, Primus', 5], ['Rare PRIME', 5],
  ['LEGENDE', 5], ['LEGEND', 5], ['Selten, Strahlend', 5], ['Radiant Rare', 5], ['Atemberaubend', 5], ['Amazing Rare', 5],
  ['ASS-KLASSE', 5], ['ACE SPEC Rare', 5],
  ['Ultra Selten', 6], ['Ultra Rare', 6], ['Vollkunsttrainer', 6], ['Full Art Trainer', 6], ['Mega Attack Rare', 6],
  ['Selten, Illustration', 7], ['Illustration rare', 7], ['Shiny rare', 7], ['Shiny rare V', 7], ['Shiny rare VMAX', 7],
  ['ultraselten, Schillernd', 7], ['Shiny Ultra Rare', 7],
  ['Selten, besondere Illustration', 8], ['Special illustration rare', 8],
  ['Versteckt Selten', 9], ['Secret Rare', 9], ['Hyperselten', 9], ['Hyper rare', 9], ['Mega Hyper Selten', 9],
  ['Mega Hyper Rare', 9], ['Schwarz-Weiß Selten', 9], ['Black White Rare', 9],
  ['Promo', ''], ['Klassische Kollektion', ''], ['Classic Collection', ''], ['Keine', ''], ['None', '']
];
// Sortierungen der Sammlung in Seitenleiste und Web-App; desc = Standardrichtung beim Auswählen
const COLL_SORTS = {
  set: { label: 'Set', desc: false },
  dex: { label: 'Pokédex-Nr.', desc: false },
  rarity: { label: 'Seltenheit', desc: true },
  name: { label: 'Name', desc: false },
  price: { label: 'Preis', desc: true },
  added: { label: 'Neueste', desc: true }
};

// Namen aller Pokémon nach Pokédex-Nummer (Quelle: PokeAPI, pokemon_species_names), durch | getrennt
const DEX_NAMES_DE = [
  'Bisasam|Bisaknosp|Bisaflor|Glumanda|Glutexo|Glurak|Schiggy|Schillok|Turtok|Raupy|Safcon|Smettbo|Hornliu|',
  'Kokuna|Bibor|Taubsi|Tauboga|Tauboss|Rattfratz|Rattikarl|Habitak|Ibitak|Rettan|Arbok|Pikachu|Raichu|Sandan|',
  'Sandamer|Nidoran♀|Nidorina|Nidoqueen|Nidoran♂|Nidorino|Nidoking|Piepi|Pixi|Vulpix|Vulnona|Pummeluff|',
  'Knuddeluff|Zubat|Golbat|Myrapla|Duflor|Giflor|Paras|Parasek|Bluzuk|Omot|Digda|Digdri|Mauzi|Snobilikat|Enton|',
  'Entoron|Menki|Rasaff|Fukano|Arkani|Quapsel|Quaputzi|Quappo|Abra|Kadabra|Simsala|Machollo|Maschock|Machomei|',
  'Knofensa|Ultrigaria|Sarzenia|Tentacha|Tentoxa|Kleinstein|Georok|Geowaz|Ponita|Gallopa|Flegmon|Lahmus|',
  'Magnetilo|Magneton|Porenta|Dodu|Dodri|Jurob|Jugong|Sleima|Sleimok|Muschas|Austos|Nebulak|Alpollo|Gengar|Onix|',
  'Traumato|Hypno|Krabby|Kingler|Voltobal|Lektrobal|Owei|Kokowei|Tragosso|Knogga|Kicklee|Nockchan|Schlurp|Smogon|',
  'Smogmog|Rihorn|Rizeros|Chaneira|Tangela|Kangama|Seeper|Seemon|Goldini|Golking|Sterndu|Starmie|Pantimos|',
  'Sichlor|Rossana|Elektek|Magmar|Pinsir|Tauros|Karpador|Garados|Lapras|Ditto|Evoli|Aquana|Blitza|Flamara|',
  'Porygon|Amonitas|Amoroso|Kabuto|Kabutops|Aerodactyl|Relaxo|Arktos|Zapdos|Lavados|Dratini|Dragonir|Dragoran|',
  'Mewtu|Mew|Endivie|Lorblatt|Meganie|Feurigel|Igelavar|Tornupto|Karnimani|Tyracroc|Impergator|Wiesor|Wiesenior|',
  'Hoothoot|Noctuh|Ledyba|Ledian|Webarak|Ariados|Iksbat|Lampi|Lanturn|Pichu|Pii|Fluffeluff|Togepi|Togetic|Natu|',
  'Xatu|Voltilamm|Waaty|Ampharos|Blubella|Marill|Azumarill|Mogelbaum|Quaxo|Hoppspross|Hubelupf|Papungha|Griffel|',
  'Sonnkern|Sonnflora|Yanma|Felino|Morlord|Psiana|Nachtara|Kramurx|Laschoking|Traunfugil|Icognito|Woingenau|',
  'Girafarig|Tannza|Forstellka|Dummisel|Skorgla|Stahlos|Snubbull|Granbull|Baldorfish|Scherox|Pottrott|Skaraborn|',
  'Sniebel|Teddiursa|Ursaring|Schneckmag|Magcargo|Quiekel|Keifel|Corasonn|Remoraid|Octillery|Botogel|Mantax|',
  'Panzaeron|Hunduster|Hundemon|Seedraking|Phanpy|Donphan|Porygon2|Damhirplex|Farbeagle|Rabauz|Kapoera|Kussilla|',
  'Elekid|Magby|Miltank|Heiteira|Raikou|Entei|Suicune|Larvitar|Pupitar|Despotar|Lugia|Ho-Oh|Celebi|Geckarbor|',
  'Reptain|Gewaldro|Flemmli|Jungglut|Lohgock|Hydropi|Moorabbel|Sumpex|Fiffyen|Magnayen|Zigzachs|Geradaks|Waumpel|',
  'Schaloko|Papinella|Panekon|Pudox|Loturzel|Lombrero|Kappalores|Samurzel|Blanas|Tengulist|Schwalbini|Schwalboss|',
  'Wingull|Pelipper|Trasla|Kirlia|Guardevoir|Gehweiher|Maskeregen|Knilz|Kapilz|Bummelz|Muntier|Letarking|Nincada|',
  'Ninjask|Ninjatom|Flurmel|Krakeelo|Krawumms|Makuhita|Hariyama|Azurill|Nasgnet|Eneco|Enekoro|Zobiris|Flunkifer|',
  'Stollunior|Stollrak|Stolloss|Meditie|Meditalis|Frizelbliz|Voltenso|Plusle|Minun|Volbeat|Illumise|Roselia|',
  'Schluppuck|Schlukwech|Kanivanha|Tohaido|Wailmer|Wailord|Camaub|Camerupt|Qurtel|Spoink|Groink|Pandir|Knacklion|',
  'Vibrava|Libelldra|Tuska|Noktuska|Wablu|Altaria|Sengo|Vipitis|Lunastein|Sonnfel|Schmerbe|Welsar|Krebscorps|',
  'Krebutack|Puppance|Lepumentas|Liliep|Wielie|Anorith|Armaldo|Barschwa|Milotic|Formeo|Kecleon|Shuppet|Banette|',
  'Zwirrlicht|Zwirrklop|Tropius|Palimpalim|Absol|Isso|Schneppke|Firnontor|Seemops|Seejong|Walraisa|Perlu|',
  'Aalabyss|Saganabyss|Relicanth|Liebiskus|Kindwurm|Draschel|Brutalanda|Tanhel|Metang|Metagross|Regirock|Regice|',
  'Registeel|Latias|Latios|Kyogre|Groudon|Rayquaza|Jirachi|Deoxys|Chelast|Chelcarain|Chelterrar|Panflam|Panpyro|',
  'Panferno|Plinfa|Pliprin|Impoleon|Staralili|Staravia|Staraptor|Bidiza|Bidifas|Zirpurze|Zirpeise|Sheinux|Luxio|',
  'Luxtra|Knospi|Roserade|Koknodon|Rameidon|Schilterus|Bollterus|Burmy|Burmadame|Moterpel|Wadribie|Honweisel|',
  'Pachirisu|Bamelin|Bojelin|Kikugi|Kinoso|Schalellos|Gastrodon|Ambidiffel|Driftlon|Drifzepeli|Haspiror|Schlapor|',
  'Traunmagil|Kramshef|Charmian|Shnurgarst|Klingplim|Skunkapuh|Skuntank|Bronzel|Bronzong|Mobai|Pantimimi|',
  'Wonneira|Plaudagei|Kryppuk|Kaumalat|Knarksel|Knakrack|Mampfaxo|Riolu|Lucario|Hippopotas|Hippoterus|Pionskora|',
  'Piondragi|Glibunkel|Toxiquak|Venuflibis|Finneon|Lumineon|Mantirps|Shnebedeck|Rexblisar|Snibunna|Magnezone|',
  'Schlurplek|Rihornior|Tangoloss|Elevoltek|Magbrant|Togekiss|Yanmega|Folipurba|Glaziola|Skorgro|Mamutel|',
  'Porygon-Z|Galagladi|Voluminas|Zwirrfinst|Frosdedje|Rotom|Selfe|Vesprit|Tobutz|Dialga|Palkia|Heatran|Regigigas|',
  'Giratina|Cresselia|Phione|Manaphy|Darkrai|Shaymin|Arceus|Victini|Serpifeu|Efoserp|Serpiroyal|Floink|Ferkokel|',
  'Flambirex|Ottaro|Zwottronin|Admurai|Nagelotz|Kukmarda|Yorkleff|Terribark|Bissbark|Felilou|Kleoparda|Vegimak|',
  'Vegichita|Grillmak|Grillchita|Sodamak|Sodachita|Somniam|Somnivora|Dusselgurr|Navitaub|Fasasnob|Elezeba|',
  'Zebritz|Kiesling|Sedimantur|Brockoloss|Fleknoil|Fletiamo|Rotomurf|Stalobor|Ohrdoch|Praktibalk|Strepoli|',
  'Meistagrif|Schallquap|Mebrana|Branawarz|Jiutesto|Karadonis|Strawickl|Folikon|Matrifol|Toxiped|Rollum|',
  'Cerapendra|Waumboll|Elfun|Lilminip|Dressella|Barschuft|Ganovil|Rokkaiman|Rabigator|Flampion|Flampivian|',
  'Maracamba|Lithomith|Castellith|Zurrokex|Irokex|Symvolara|Makabaja|Echnatoll|Galapaflos|Karippas|Flapteryx|',
  'Aeropteryx|Unratütox|Deponitox|Zorua|Zoroark|Picochilla|Chillabell|Mollimorba|Hypnomorba|Morbitesse|Monozyto|',
  'Mitodos|Zytomega|Piccolente|Swaroness|Gelatini|Gelatroppo|Gelatwino|Sesokitz|Kronjuwild|Emolga|Laukaps|',
  'Cavalanzas|Tarnpignon|Hutsassa|Quabbel|Apoquallyp|Mamolida|Wattzapf|Voltula|Kastadur|Tentantel|Klikk|Kliklak|',
  'Klikdiklak|Zapplardin|Zapplalek|Zapplarang|Pygraulon|Megalon|Lichtel|Laternecto|Skelabra|Milza|Sharfax|Maxax|',
  'Petznief|Siberio|Frigometri|Schnuthelm|Hydragil|Flunschlik|Lin-Fu|Wie-Shu|Shardrago|Golbit|Golgantes|',
  'Gladiantri|Caesurio|Bisofank|Geronimatz|Washakwil|Skallyk|Grypheldis|Furnifraß|Fermicula|Kapuno|Duodino|',
  'Trikephalo|Ignivor|Ramoth|Kobalium|Terrakium|Viridium|Boreos|Voltolos|Reshiram|Zekrom|Demeteros|Kyurem|Keldeo|',
  'Meloetta|Genesect|Igamaro|Igastarnish|Brigaron|Fynx|Rutena|Fennexis|Froxy|Amphizel|Quajutsu|Scoppel|Grebbit|',
  'Dartiri|Dartignis|Fiaro|Purmel|Puponcho|Vivillon|Leufeo|Pyroleo|Flabébé|Floette|Florges|Mähikel|Chevrumm|',
  'Pam-Pam|Pandagro|Coiffwaff|Psiau|Psiaugon|Gramokles|Duokles|Durengard|Parfi|Parfinesse|Flauschling|Sabbaione|',
  'Iscalar|Calamanero|Bithora|Thanathora|Algitt|Tandrak|Scampisto|Wummer|Eguana|Elezard|Balgoras|Monargoras|',
  'Amarino|Amagarga|Feelinara|Resladero|Dedenne|Rocara|Viscora|Viscargot|Viscogon|Clavion|Paragoni|Trombork|',
  'Irrbis|Pumpdjinn|Arktip|Arktilas|eF-eM|UHaFnir|Xerneas|Yveltal|Zygarde|Diancie|Hoopa|Volcanion|Bauz|',
  'Arboretoss|Silvarro|Flamiau|Miezunder|Fuegro|Robball|Marikeck|Primarene|Peppeck|Trompeck|Tukanon|Mangunior|',
  'Manguspektor|Mabula|Akkup|Donarion|Krabbox|Krawell|Choreogel|Wommel|Bandelby|Wuffels|Wolwerock|Lusardin|',
  'Garstella|Aggrostella|Pampuli|Pampross|Araqua|Aranestro|Imantis|Mantidea|Bubungus|Lamellux|Molunk|Amfira|',
  'Velursi|Kosturso|Frubberl|Frubaila|Fruyal|Curelei|Kommandutan|Quartermak|Reißlaus|Tectass|Sankabuh|Colossand|',
  'Gufa|Typ:Null|Amigento|Meteno|Koalelu|Tortunator|Togedemaru|Mimigma|Knirfish|Sen-Long|Moruda|Miniras|Mediras|',
  'Grandiras|Kapu-Riki|Kapu-Fala|Kapu-Toro|Kapu-Kime|Cosmog|Cosmovum|Solgaleo|Lunala|Anego|Masskito|Schabelle|',
  'Voltriant|Kaguron|Katagami|Schlingking|Necrozma|Magearna|Marshadow|Venicro|Agoyon|Muramura|Kopplosio|Zeraora|',
  'Meltan|Melmetal|Chimpep|Chimstix|Gortrom|Hopplo|Kickerlo|Liberlo|Memmeon|Phlegleon|Intelleon|Raffel|',
  'Schlaraffel|Meikro|Kranoviz|Krarmor|Sensect|Keradar|Maritellit|Kleptifux|Gaunux|Cottini|Cottomi|Wolly|',
  'Zwollock|Kamehaps|Kamalm|Voldi|Bellektro|Klonkett|Wagong|Montecarbo|Knapfel|Drapfel|Schlapfel|Salanga|',
  'Sanaconda|Urgl|Pikuda|Barrakiefa|Toxel|Riffex|Thermopod|Infernopod|Klopptopus|Kaocto|Fatalitee|Mortipot|',
  'Brimova|Brimano|Silembrim|Bähmon|Pelzebub|Olangaar|Barrikadax|Mauzinger|Gorgasonn|Lauchzelot|Pantifrost|',
  'Oghnatoll|Hokumil|Pokusan|Legios|Britzigel|Snomnom|Mottineva|Humanolith|Kubuin|Servol|Morpeko|Kupfanti|',
  'Patinaraja|Lectragon|Lecryodon|Pescragon|Pescryodon|Duraludon|Grolldra|Phandra|Katapuldra|Zacian|Zamazenta|',
  'Endynalos|Dakuma|Wulaosu|Zarude|Regieleki|Regidrago|Polaross|Phantoross|Coronospa|Damythir|Axantor|Ursaluna|',
  'Salmagnis|Snieboss|Myriador|Cupidos|Felori|Feliospa|Maskagato|Krokel|Lokroko|Skelokrok|Kwaks|Fuentente|',
  'Bailonda|Ferkuli|Fragrunz|Tarundel|Spinsidias|Micrick|Lextremo|Pamo|Pamamo|Pamomamo|Zwieps|Famieps|Hefel|',
  'Backel|Olini|Olivinio|Olithena|Krawalloro|Geosali|Sedisal|Saltigant|Knarbon|Crimanzo|Azugladis|Blipp|Wampitz|',
  'Voltrel|Voltrean|Mobtiff|Mastifioso|Sproxi|Affiti|Weherba|Horrerba|Tentagra|Tenterra|Klibbe|Chilingel|',
  'Halupenjo|Relluk|Skarabaks|Flattutu|Psiopatra|Forgita|Tafforgita|Granforgita|Schligda|Schligdri|Adebom|',
  'Normifin|Delfinator|Knattox|Knattatox|Mopex|Schlurm|Lumispross|Lumiflora|Gruff|Friedwuff|Flaminkno|Flaniwal|',
  'Kolowal|Agiluza|Heerashai|Nigiragi|Epitaff|Suelord|Farigiraf|Dummimisel|Gladimperio|Riesenzahn|Brüllschweif|',
  'Wutpilz|Flatterhaar|Kriechflügel|Sandfell|Eisenrad|Eisenbündel|Eisenhand|Eisenhals|Eisenfalter|Eisendorn|',
  'Frospino|Cryospino|Espinodon|Gierspenst|Monetigo|Chongjian|Baojian|Dinglu|Yuyu|Donnersichel|Eisenkrieger|',
  'Koraidon|Miraidon|Windewoge|Eisenblatt|Sirapfel|Mortcha|Fatalitcha|Boninu|Benesaru|Beatori|Ogerpon|Briduradon|',
  'Hydrapfel|Keilflamme|Furienblitz|Eisenfels|Eisenhaupt|Terapagos|Infamomo'
].join('');
const DEX_NAMES_EN = [
  'Bulbasaur|Ivysaur|Venusaur|Charmander|Charmeleon|Charizard|Squirtle|Wartortle|Blastoise|Caterpie|Metapod|',
  'Butterfree|Weedle|Kakuna|Beedrill|Pidgey|Pidgeotto|Pidgeot|Rattata|Raticate|Spearow|Fearow|Ekans|Arbok|',
  'Pikachu|Raichu|Sandshrew|Sandslash|Nidoran♀|Nidorina|Nidoqueen|Nidoran♂|Nidorino|Nidoking|Clefairy|Clefable|',
  'Vulpix|Ninetales|Jigglypuff|Wigglytuff|Zubat|Golbat|Oddish|Gloom|Vileplume|Paras|Parasect|Venonat|Venomoth|',
  'Diglett|Dugtrio|Meowth|Persian|Psyduck|Golduck|Mankey|Primeape|Growlithe|Arcanine|Poliwag|Poliwhirl|Poliwrath|',
  'Abra|Kadabra|Alakazam|Machop|Machoke|Machamp|Bellsprout|Weepinbell|Victreebel|Tentacool|Tentacruel|Geodude|',
  'Graveler|Golem|Ponyta|Rapidash|Slowpoke|Slowbro|Magnemite|Magneton|Farfetch’d|Doduo|Dodrio|Seel|Dewgong|',
  'Grimer|Muk|Shellder|Cloyster|Gastly|Haunter|Gengar|Onix|Drowzee|Hypno|Krabby|Kingler|Voltorb|Electrode|',
  'Exeggcute|Exeggutor|Cubone|Marowak|Hitmonlee|Hitmonchan|Lickitung|Koffing|Weezing|Rhyhorn|Rhydon|Chansey|',
  'Tangela|Kangaskhan|Horsea|Seadra|Goldeen|Seaking|Staryu|Starmie|Mr. Mime|Scyther|Jynx|Electabuzz|Magmar|',
  'Pinsir|Tauros|Magikarp|Gyarados|Lapras|Ditto|Eevee|Vaporeon|Jolteon|Flareon|Porygon|Omanyte|Omastar|Kabuto|',
  'Kabutops|Aerodactyl|Snorlax|Articuno|Zapdos|Moltres|Dratini|Dragonair|Dragonite|Mewtwo|Mew|Chikorita|Bayleef|',
  'Meganium|Cyndaquil|Quilava|Typhlosion|Totodile|Croconaw|Feraligatr|Sentret|Furret|Hoothoot|Noctowl|Ledyba|',
  'Ledian|Spinarak|Ariados|Crobat|Chinchou|Lanturn|Pichu|Cleffa|Igglybuff|Togepi|Togetic|Natu|Xatu|Mareep|',
  'Flaaffy|Ampharos|Bellossom|Marill|Azumarill|Sudowoodo|Politoed|Hoppip|Skiploom|Jumpluff|Aipom|Sunkern|',
  'Sunflora|Yanma|Wooper|Quagsire|Espeon|Umbreon|Murkrow|Slowking|Misdreavus|Unown|Wobbuffet|Girafarig|Pineco|',
  'Forretress|Dunsparce|Gligar|Steelix|Snubbull|Granbull|Qwilfish|Scizor|Shuckle|Heracross|Sneasel|Teddiursa|',
  'Ursaring|Slugma|Magcargo|Swinub|Piloswine|Corsola|Remoraid|Octillery|Delibird|Mantine|Skarmory|Houndour|',
  'Houndoom|Kingdra|Phanpy|Donphan|Porygon2|Stantler|Smeargle|Tyrogue|Hitmontop|Smoochum|Elekid|Magby|Miltank|',
  'Blissey|Raikou|Entei|Suicune|Larvitar|Pupitar|Tyranitar|Lugia|Ho-Oh|Celebi|Treecko|Grovyle|Sceptile|Torchic|',
  'Combusken|Blaziken|Mudkip|Marshtomp|Swampert|Poochyena|Mightyena|Zigzagoon|Linoone|Wurmple|Silcoon|Beautifly|',
  'Cascoon|Dustox|Lotad|Lombre|Ludicolo|Seedot|Nuzleaf|Shiftry|Taillow|Swellow|Wingull|Pelipper|Ralts|Kirlia|',
  'Gardevoir|Surskit|Masquerain|Shroomish|Breloom|Slakoth|Vigoroth|Slaking|Nincada|Ninjask|Shedinja|Whismur|',
  'Loudred|Exploud|Makuhita|Hariyama|Azurill|Nosepass|Skitty|Delcatty|Sableye|Mawile|Aron|Lairon|Aggron|Meditite|',
  'Medicham|Electrike|Manectric|Plusle|Minun|Volbeat|Illumise|Roselia|Gulpin|Swalot|Carvanha|Sharpedo|Wailmer|',
  'Wailord|Numel|Camerupt|Torkoal|Spoink|Grumpig|Spinda|Trapinch|Vibrava|Flygon|Cacnea|Cacturne|Swablu|Altaria|',
  'Zangoose|Seviper|Lunatone|Solrock|Barboach|Whiscash|Corphish|Crawdaunt|Baltoy|Claydol|Lileep|Cradily|Anorith|',
  'Armaldo|Feebas|Milotic|Castform|Kecleon|Shuppet|Banette|Duskull|Dusclops|Tropius|Chimecho|Absol|Wynaut|',
  'Snorunt|Glalie|Spheal|Sealeo|Walrein|Clamperl|Huntail|Gorebyss|Relicanth|Luvdisc|Bagon|Shelgon|Salamence|',
  'Beldum|Metang|Metagross|Regirock|Regice|Registeel|Latias|Latios|Kyogre|Groudon|Rayquaza|Jirachi|Deoxys|',
  'Turtwig|Grotle|Torterra|Chimchar|Monferno|Infernape|Piplup|Prinplup|Empoleon|Starly|Staravia|Staraptor|Bidoof|',
  'Bibarel|Kricketot|Kricketune|Shinx|Luxio|Luxray|Budew|Roserade|Cranidos|Rampardos|Shieldon|Bastiodon|Burmy|',
  'Wormadam|Mothim|Combee|Vespiquen|Pachirisu|Buizel|Floatzel|Cherubi|Cherrim|Shellos|Gastrodon|Ambipom|Drifloon|',
  'Drifblim|Buneary|Lopunny|Mismagius|Honchkrow|Glameow|Purugly|Chingling|Stunky|Skuntank|Bronzor|Bronzong|',
  'Bonsly|Mime Jr.|Happiny|Chatot|Spiritomb|Gible|Gabite|Garchomp|Munchlax|Riolu|Lucario|Hippopotas|Hippowdon|',
  'Skorupi|Drapion|Croagunk|Toxicroak|Carnivine|Finneon|Lumineon|Mantyke|Snover|Abomasnow|Weavile|Magnezone|',
  'Lickilicky|Rhyperior|Tangrowth|Electivire|Magmortar|Togekiss|Yanmega|Leafeon|Glaceon|Gliscor|Mamoswine|',
  'Porygon-Z|Gallade|Probopass|Dusknoir|Froslass|Rotom|Uxie|Mesprit|Azelf|Dialga|Palkia|Heatran|Regigigas|',
  'Giratina|Cresselia|Phione|Manaphy|Darkrai|Shaymin|Arceus|Victini|Snivy|Servine|Serperior|Tepig|Pignite|Emboar|',
  'Oshawott|Dewott|Samurott|Patrat|Watchog|Lillipup|Herdier|Stoutland|Purrloin|Liepard|Pansage|Simisage|Pansear|',
  'Simisear|Panpour|Simipour|Munna|Musharna|Pidove|Tranquill|Unfezant|Blitzle|Zebstrika|Roggenrola|Boldore|',
  'Gigalith|Woobat|Swoobat|Drilbur|Excadrill|Audino|Timburr|Gurdurr|Conkeldurr|Tympole|Palpitoad|Seismitoad|',
  'Throh|Sawk|Sewaddle|Swadloon|Leavanny|Venipede|Whirlipede|Scolipede|Cottonee|Whimsicott|Petilil|Lilligant|',
  'Basculin|Sandile|Krokorok|Krookodile|Darumaka|Darmanitan|Maractus|Dwebble|Crustle|Scraggy|Scrafty|Sigilyph|',
  'Yamask|Cofagrigus|Tirtouga|Carracosta|Archen|Archeops|Trubbish|Garbodor|Zorua|Zoroark|Minccino|Cinccino|',
  'Gothita|Gothorita|Gothitelle|Solosis|Duosion|Reuniclus|Ducklett|Swanna|Vanillite|Vanillish|Vanilluxe|Deerling|',
  'Sawsbuck|Emolga|Karrablast|Escavalier|Foongus|Amoonguss|Frillish|Jellicent|Alomomola|Joltik|Galvantula|',
  'Ferroseed|Ferrothorn|Klink|Klang|Klinklang|Tynamo|Eelektrik|Eelektross|Elgyem|Beheeyem|Litwick|Lampent|',
  'Chandelure|Axew|Fraxure|Haxorus|Cubchoo|Beartic|Cryogonal|Shelmet|Accelgor|Stunfisk|Mienfoo|Mienshao|',
  'Druddigon|Golett|Golurk|Pawniard|Bisharp|Bouffalant|Rufflet|Braviary|Vullaby|Mandibuzz|Heatmor|Durant|Deino|',
  'Zweilous|Hydreigon|Larvesta|Volcarona|Cobalion|Terrakion|Virizion|Tornadus|Thundurus|Reshiram|Zekrom|Landorus|',
  'Kyurem|Keldeo|Meloetta|Genesect|Chespin|Quilladin|Chesnaught|Fennekin|Braixen|Delphox|Froakie|Frogadier|',
  'Greninja|Bunnelby|Diggersby|Fletchling|Fletchinder|Talonflame|Scatterbug|Spewpa|Vivillon|Litleo|Pyroar|',
  'Flabébé|Floette|Florges|Skiddo|Gogoat|Pancham|Pangoro|Furfrou|Espurr|Meowstic|Honedge|Doublade|Aegislash|',
  'Spritzee|Aromatisse|Swirlix|Slurpuff|Inkay|Malamar|Binacle|Barbaracle|Skrelp|Dragalge|Clauncher|Clawitzer|',
  'Helioptile|Heliolisk|Tyrunt|Tyrantrum|Amaura|Aurorus|Sylveon|Hawlucha|Dedenne|Carbink|Goomy|Sliggoo|Goodra|',
  'Klefki|Phantump|Trevenant|Pumpkaboo|Gourgeist|Bergmite|Avalugg|Noibat|Noivern|Xerneas|Yveltal|Zygarde|Diancie|',
  'Hoopa|Volcanion|Rowlet|Dartrix|Decidueye|Litten|Torracat|Incineroar|Popplio|Brionne|Primarina|Pikipek|',
  'Trumbeak|Toucannon|Yungoos|Gumshoos|Grubbin|Charjabug|Vikavolt|Crabrawler|Crabominable|Oricorio|Cutiefly|',
  'Ribombee|Rockruff|Lycanroc|Wishiwashi|Mareanie|Toxapex|Mudbray|Mudsdale|Dewpider|Araquanid|Fomantis|Lurantis|',
  'Morelull|Shiinotic|Salandit|Salazzle|Stufful|Bewear|Bounsweet|Steenee|Tsareena|Comfey|Oranguru|Passimian|',
  'Wimpod|Golisopod|Sandygast|Palossand|Pyukumuku|Type: Null|Silvally|Minior|Komala|Turtonator|Togedemaru|',
  'Mimikyu|Bruxish|Drampa|Dhelmise|Jangmo-o|Hakamo-o|Kommo-o|Tapu Koko|Tapu Lele|Tapu Bulu|Tapu Fini|Cosmog|',
  'Cosmoem|Solgaleo|Lunala|Nihilego|Buzzwole|Pheromosa|Xurkitree|Celesteela|Kartana|Guzzlord|Necrozma|Magearna|',
  'Marshadow|Poipole|Naganadel|Stakataka|Blacephalon|Zeraora|Meltan|Melmetal|Grookey|Thwackey|Rillaboom|',
  'Scorbunny|Raboot|Cinderace|Sobble|Drizzile|Inteleon|Skwovet|Greedent|Rookidee|Corvisquire|Corviknight|Blipbug|',
  'Dottler|Orbeetle|Nickit|Thievul|Gossifleur|Eldegoss|Wooloo|Dubwool|Chewtle|Drednaw|Yamper|Boltund|Rolycoly|',
  'Carkol|Coalossal|Applin|Flapple|Appletun|Silicobra|Sandaconda|Cramorant|Arrokuda|Barraskewda|Toxel|Toxtricity|',
  'Sizzlipede|Centiskorch|Clobbopus|Grapploct|Sinistea|Polteageist|Hatenna|Hattrem|Hatterene|Impidimp|Morgrem|',
  'Grimmsnarl|Obstagoon|Perrserker|Cursola|Sirfetch’d|Mr. Rime|Runerigus|Milcery|Alcremie|Falinks|Pincurchin|',
  'Snom|Frosmoth|Stonjourner|Eiscue|Indeedee|Morpeko|Cufant|Copperajah|Dracozolt|Arctozolt|Dracovish|Arctovish|',
  'Duraludon|Dreepy|Drakloak|Dragapult|Zacian|Zamazenta|Eternatus|Kubfu|Urshifu|Zarude|Regieleki|Regidrago|',
  'Glastrier|Spectrier|Calyrex|Wyrdeer|Kleavor|Ursaluna|Basculegion|Sneasler|Overqwil|Enamorus|Sprigatito|',
  'Floragato|Meowscarada|Fuecoco|Crocalor|Skeledirge|Quaxly|Quaxwell|Quaquaval|Lechonk|Oinkologne|Tarountula|',
  'Spidops|Nymble|Lokix|Pawmi|Pawmo|Pawmot|Tandemaus|Maushold|Fidough|Dachsbun|Smoliv|Dolliv|Arboliva|',
  'Squawkabilly|Nacli|Naclstack|Garganacl|Charcadet|Armarouge|Ceruledge|Tadbulb|Bellibolt|Wattrel|Kilowattrel|',
  'Maschiff|Mabosstiff|Shroodle|Grafaiai|Bramblin|Brambleghast|Toedscool|Toedscruel|Klawf|Capsakid|Scovillain|',
  'Rellor|Rabsca|Flittle|Espathra|Tinkatink|Tinkatuff|Tinkaton|Wiglett|Wugtrio|Bombirdier|Finizen|Palafin|Varoom|',
  'Revavroom|Cyclizar|Orthworm|Glimmet|Glimmora|Greavard|Houndstone|Flamigo|Cetoddle|Cetitan|Veluza|Dondozo|',
  'Tatsugiri|Annihilape|Clodsire|Farigiraf|Dudunsparce|Kingambit|Great Tusk|Scream Tail|Brute Bonnet|',
  'Flutter Mane|Slither Wing|Sandy Shocks|Iron Treads|Iron Bundle|Iron Hands|Iron Jugulis|Iron Moth|Iron Thorns|',
  'Frigibax|Arctibax|Baxcalibur|Gimmighoul|Gholdengo|Wo-Chien|Chien-Pao|Ting-Lu|Chi-Yu|Roaring Moon|Iron Valiant|',
  'Koraidon|Miraidon|Walking Wake|Iron Leaves|Dipplin|Poltchageist|Sinistcha|Okidogi|Munkidori|Fezandipiti|',
  'Ogerpon|Archaludon|Hydrapple|Gouging Fire|Raging Bolt|Iron Boulder|Iron Crown|Terapagos|Pecharunt'
].join('');

let dexNamesCache_ = null;
let dexNameIdxCache_ = null;

/** {de: [...], en: [...]}; Index 0 = Nr. 1 */
function dexNames_() {
  if (!dexNamesCache_) dexNamesCache_ = { de: DEX_NAMES_DE.split('|'), en: DEX_NAMES_EN.split('|') };
  return dexNamesCache_;
}

/** Generation (1 bis 9) einer Pokédex-Nummer; '' für Nummern nach 1025. */
function dexGen_(nr) {
  for (let i = 0; i < DEX_GEN_ENDS.length; i++) if (nr <= DEX_GEN_ENDS[i]) return i + 1;
  return '';
}

/** Vergleichsform eines Namens: klein, ohne Leer- und Satzzeichen („Ho-Oh“ -> „hooh“, „Typ:Null“ -> „typnull“). */
function dexSquash_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s.\-:'’`´]/g, '');
}

/** {Vergleichsform des deutschen oder englischen Namens: Nummer} */
function dexNameIdx_() {
  if (dexNameIdxCache_) return dexNameIdxCache_;
  const idx = {};
  const n = dexNames_();
  [n.de, n.en].forEach(function (list) {
    list.forEach(function (name, i) {
      const k = dexSquash_(name);
      if (k && !(k in idx)) idx[k] = i + 1;
    });
  });
  dexNameIdxCache_ = idx;
  return idx;
}

/** Pokédex-Nummern einer tcgdex-Karte (Feld dexId: Liste, selten eine Zahl). */
function dexIdsOf_(card) {
  const d = card ? card.dexId : null;
  const list = Array.isArray(d) ? d : (d == null || d === '' ? [] : [d]);
  const out = [];
  list.forEach(function (x) {
    const n = Math.floor(Number(x));
    if (n > 0 && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/** {Karten-ID: [Nummern]} aus einer vollen tcgdex-Karte, für storeDexIds_. */
function dexMapOf_(card) {
  const m = {};
  if (card && card.id) m[String(card.id)] = dexIdsOf_(card);
  return m;
}

/** '25 644' (oder Zahl) -> [25, 644] */
function parseDexText_(s) {
  const out = [];
  String(s == null ? '' : s).split(/[^0-9]+/).forEach(function (x) {
    const n = Number(x);
    if (x && n > 0 && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/** Trainer- und Energiekarten haben keine Pokédex-Nummer. Leerer Kartentyp (z. B. freie Karte) zählt als Pokémon. */
function isPokemonCategory_(category) {
  return !/trainer|energ/i.test(String(category || ''));
}

/**
 * Pokédex-Nummern aus dem Kartennamen, solange tcgdex-Daten fehlen: „Glurak-ex“, „Alola-Vulpix“, „Brocks Onix“,
 * „Dunkles Ho-Oh“, „Pikachu & Zekrom-GX“ (beide). Ein Namensteil zählt nur, wenn genau ein Pokémon passt.
 */
function dexFromName_(name) {
  const idx = dexNameIdx_();
  const out = [];
  String(name == null ? '' : name).split(/\s*&\s*/).forEach(function (part) {
    const base = splitSuffix_(part).base;
    let nr = idx[dexSquash_(base)] || idx[dexSquash_(part)];
    if (!nr) {
      const hits = [];
      const hit = function (s) {
        const k = dexSquash_(s);
        if (k.length >= 3 && idx[k] && hits.indexOf(idx[k]) < 0) hits.push(idx[k]);
      };
      const words = base.split(/\s+/);
      for (let i = 1; i < words.length; i++) hit(words.slice(i).join(' ')); // „Dunkles Ho-Oh“ -> „Ho-Oh“
      base.split(/[\s\-]+/).forEach(hit); // „Alola-Vulpix“ -> „Vulpix“
      if (hits.length === 1) nr = hits[0];
    }
    if (nr && out.indexOf(nr) < 0) out.push(nr);
  });
  return out;
}

/** Gemerkte Pokédex-Nummern: {Karten-ID: [Nummern]}; leere Liste = tcgdex kennt keine. */
function loadDexIds_() {
  const out = {};
  const sh = ss_().getSheetByName(SHEETS.dexIds);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const id = String(r[0] == null ? '' : r[0]).trim();
    if (id) out[id] = parseDexText_(r[1]);
  });
  return out;
}

/** Zeilen anhängen, falls das Blatt zu kurz ist (ohne die Formate des Datenblatts wie ensureRows_). */
function growRows_(sh, rowNeeded) {
  if (rowNeeded > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(100, rowNeeded - sh.getMaxRows()));
}

/**
 * Pokédex-Nummern merken: map {Karten-ID: [Nummern]}. Schreibt nur neue oder geänderte Einträge.
 * Innerhalb der Sperre. -> Anzahl geschriebener Einträge
 */
function storeDexIds_(map) {
  const ids = Object.keys(map || {}).filter(function (id) { return id && Array.isArray(map[id]); });
  if (!ids.length) return 0;
  const ss = ss_();
  const sh = ss.getSheetByName(SHEETS.dexIds) || setupSimpleSheet_(ss, SHEETS.dexIds, DEX_IDS_HEADERS, [0, 1, 2], true);
  const last = Math.max(1, sh.getLastRow());
  const old = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  const rowOf = {};
  old.forEach(function (r, i) {
    const id = String(r[0] == null ? '' : r[0]).trim();
    if (id && !(id in rowOf)) rowOf[id] = i;
  });
  const today = todayText_();
  const append = [];
  let n = 0;
  ids.forEach(function (id) {
    const txt = map[id].join(' ');
    if (id in rowOf) {
      const i = rowOf[id];
      if (i < 0 || String(old[i][1] == null ? '' : old[i][1]) === txt) return;
      sh.getRange(i + 2, 2, 1, 2).setNumberFormat('@').setValues([[txt, today]]);
      n++;
    } else {
      append.push([id, txt, today]);
      rowOf[id] = -1;
    }
  });
  if (append.length) {
    growRows_(sh, last + append.length);
    sh.getRange(last + 1, 1, append.length, 3).setNumberFormat('@').setValues(append);
  }
  return n + append.length;
}

/** Pokédex-Nummern einer Daten-Zeile: gemerkte tcgdex-Nummern, sonst aus dem Namen. cache = loadDexIds_() */
function dexOfRow_(r, cache) {
  if (!r || !isPokemonCategory_(r[COL.category])) return [];
  const id = String(r[COL.id] || '');
  if (id && cache[id] && cache[id].length) return cache[id].slice();
  const n = dexFromName_(r[COL.name]);
  return n.length ? n : dexFromName_(r[COL.nameEn]);
}

/** Set-Erscheinungsdatum einer Gruppe (erste Zeile, die eins hat). */
function groupSetDate_(rows) {
  for (let i = 0; i < rows.length; i++) if (rows[i][COL.setDate]) return cellText_(rows[i][COL.setDate]);
  return '';
}

/** Reihenfolge „Set“: Erscheinungsdatum, Set, Nummer, Variante, Sonderversion, Name. a, b = {p: Daten-Zeile, setDate} */
function setOrder_(a, b) {
  const x = a.p, y = b.p;
  return cmp_(a.setDate, b.setDate) ||
    cmp_(String(x[COL.setId]), String(y[COL.setId])) ||
    cmp_(Number(x[COL.numSort]) || 0, Number(y[COL.numSort]) || 0) ||
    cmp_(String(x[COL.localId]), String(y[COL.localId])) ||
    cmp_(String(x[COL.variant]), String(y[COL.variant])) ||
    cmp_(versionText_(x[COL.version]), versionText_(y[COL.version])) ||
    cmp_(String(x[COL.name]), String(y[COL.name]));
}

/**
 * Pokédex aus den Daten-Zeilen.
 * -> {entries: [{nr, name, nameEn, gen, cards, copies, value}] für 1 bis 1025 (oder weiter, wenn tcgdex neuere
 *     Nummern liefert), owned: [{nr, gkey, rows, p, setDate, count, price}] (Gruppen mit Exemplaren, je Nummer)}
 * Karten = Gruppen (Karte + Variante + Sonderversion) mit mindestens einem Exemplar.
 */
function pokedexIndex_(rows) {
  const cache = loadDexIds_();
  const names = dexNames_();
  const stats = {};
  const owned = [];
  let max = names.de.length;
  groupRows_(rows).forEach(function (g) {
    const rs = g.idx.map(function (i) { return rows[i]; });
    const count = rs.reduce(function (s, r) { return s + (Number(r[COL.count]) || 0); }, 0);
    if (count <= 0) return;
    const p = orderGroupRows_(rs)[0];
    const nums = dexOfRow_(p, cache);
    if (!nums.length) return;
    const gp = groupPrice_(rs);
    const setDate = groupSetDate_(rs);
    nums.forEach(function (nr) {
      const e = stats[nr] || (stats[nr] = { cards: 0, copies: 0, value: 0, name: '' });
      e.cards++;
      e.copies += count;
      if (gp.price != null) e.value += gp.price * count;
      if (!e.name) e.name = String(p[COL.name] || '');
      if (nr > max) max = nr;
      owned.push({ nr: nr, gkey: g.gkey, rows: rs, p: p, setDate: setDate, count: count, price: gp.price });
    });
  });
  const entries = [];
  for (let nr = 1; nr <= max; nr++) {
    const e = stats[nr] || { cards: 0, copies: 0, value: 0, name: '' };
    entries.push({
      nr: nr, name: names.de[nr - 1] || e.name || 'Nr. ' + nr, nameEn: names.en[nr - 1] || '', gen: dexGen_(nr),
      cards: e.cards, copies: e.copies, value: Math.round(e.value * 100) / 100
    });
  }
  return { entries: entries, owned: owned };
}

/**
 * Schreibt das versteckte Blatt „Pokédex-Daten“ neu. Ohne das Blatt passiert nichts (es entsteht bei der
 * Einrichtung), außer mit create. Nach jeder Änderung an Daten (aus rebuildGroups_), innerhalb der Sperre.
 * -> der Index ({entries, owned}) für das Dashboard, false ohne Blatt
 */
function rebuildPokedex_(rows, create) {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.dexData);
  if (!sh) {
    if (!create) return false;
    sh = ss.insertSheet(SHEETS.dexData);
    sh.hideSheet();
  }
  const idx = pokedexIndex_(rows || []);
  const list = [DEX_LIST_HEADERS].concat(idx.entries.map(dexListRow_));
  const oldLast = sh.getLastRow();
  const cards = dexCardRows_(idx);
  growRows_(sh, Math.max(list.length, cards.length));
  ensureCols_(sh, DEX_CARD_COL - 1 + DEX_CARD_HEADERS.length);
  const lw = DEX_LIST_HEADERS.length;
  sh.getRange(1, 1, list.length, lw)
    .setNumberFormats(list.map(function (r, i) { return i === 0 ? r.map(function () { return '@'; }) : DEX_LIST_FMT; }))
    .setValues(list);
  writeDexCards_(sh, cards, oldLast);
  if (oldLast > list.length) sh.getRange(list.length + 1, 1, oldLast - list.length, lw).clearContent();
  return idx;
}

const DEX_LIST_FMT = ['0', '@', '@', '0', '0', '0', EUR_FORMAT, '@'];
const DEX_CARD_FMT = ['0', '@', '@', '@', '@', '@', '0', EUR_FORMAT, EUR_FORMAT, '@'];

function dexListRow_(e) {
  return [e.nr, e.name, e.nameEn, e.gen, e.cards, e.copies, e.value, '#' + e.nr + ' ' + e.name];
}

/** Rechte Seite von „Pokédex-Daten“: Kopf und je eigene Karte eine Zeile, nach Nummer und Set. */
function dexCardRows_(idx) {
  const owned = idx.owned.slice().sort(function (a, b) { return (a.nr - b.nr) || setOrder_(a, b); });
  return [DEX_CARD_HEADERS].concat(owned.map(function (o) {
    const p = o.p;
    const version = versionText_(p[COL.version]);
    const lid = String(p[COL.localId] == null ? '' : p[COL.localId]);
    const size = p[COL.setSize] === '' || p[COL.setSize] == null ? '' : Number(p[COL.setSize]) || '';
    const variant = String(p[COL.variant] || '');
    let img = '';
    for (let i = 0; i < o.rows.length && !img; i++) img = String(o.rows[i][COL.img] || '');
    return [
      o.nr, String(p[COL.name] || '') + (version ? ' · ' + version : '') + (p[COL.source] === 'en-Ersatz' ? ' (EN)' : ''),
      String(p[COL.setName] || ''), size ? lid + '/' + size : lid, VARIANT_LABELS[variant] || variant,
      String(p[COL.rarity] || ''), o.count, o.price == null ? '' : o.price,
      o.price == null ? '' : Math.round(o.price * o.count * 100) / 100, img
    ];
  }));
}

/** Kartenblock schreiben; oldLast = letzte Zeile vorher (darunter wird geleert). */
function writeDexCards_(sh, cards, oldLast) {
  const cw = DEX_CARD_HEADERS.length;
  sh.getRange(1, DEX_CARD_COL, cards.length, cw)
    .setNumberFormats(cards.map(function (r, i) { return i === 0 ? r.map(function () { return '@'; }) : DEX_CARD_FMT; }))
    .setValues(cards);
  if (oldLast > cards.length) sh.getRange(cards.length + 1, DEX_CARD_COL, oldLast - cards.length, cw).clearContent();
}

/** Leeres verstecktes Blatt „Pokédex-Daten“ anlegen (gefüllt wird es von rebuildGroups_). */
function setupPokedexDataSheet_(ss) {
  if (ss.getSheetByName(SHEETS.dexData)) return;
  ss.insertSheet(SHEETS.dexData).hideSheet();
}

/**
 * Blatt „Pokédex“: Filter in Zeile 4, links alle Pokémon (A:F), rechts die Karten des in I4 gewählten Pokémon (H:P).
 * keepControls: Status, Generation, Suche und Auswahl bleiben stehen.
 */
function setupPokedexSheet_(ss, keepControls) {
  const prev = ss.getActiveSheet();
  const sh = getOrCreateSheet_(ss, SHEETS.dex);
  let keep = null;
  if (keepControls) {
    try { keep = sh.getRange('B4:I4').getValues()[0]; } catch (e) { keep = null; }
  }
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(frontPos_(ss, SHEETS.dex));
  if (prev && prev.getName() !== SHEETS.dex) ss.setActiveSheet(prev);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  sh.clear();
  sh.clearConditionalFormatRules();
  ensureCols_(sh, 16);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();

  sh.getRange('A1').setValue('Pokédex').setFontSize(16).setFontWeight('bold');
  sh.getRange('C1').setValue('Vorhanden').setFontWeight('bold');
  setFormulaLocal_(sh.getRange('D1'), "=COUNTIF('" + SHEETS.dexData + "'!F2:F, \">0\")&\" von \"&COUNT('" + SHEETS.dexData + "'!A2:A)");
  setFormulaLocal_(sh.getRange('A2'), pendingHintFormula_('der Pokédex zeigt den alten Stand. Menü Pokémon > Einsortieren',
    'Filter in Zeile 4. Unter „Karten von“ (I4) ein Pokémon wählen oder Name bzw. Nummer eintippen, ' +
    'dann stehen rechts deine Karten davon. Tag-Team-Karten zählen bei jedem ihrer Pokémon.'));
  sh.getRange('A2').setFontColor('#5f6368').setFontSize(9);

  sh.getRange('B3:D3').setValues([['Status', 'Generation', 'Suche (Name oder Nummer)']]).setFontColor('#5f6368').setFontSize(9);
  sh.getRange('I3').setValue('Karten von (Pokémon wählen oder eintippen)').setFontColor('#5f6368').setFontSize(9);
  sh.getRange('B4').setValue(DEX_STATUS[0]);
  sh.getRange('C4').setValue('Alle');
  sh.getRange('D4').setNumberFormat('@');
  sh.getRange('I4').setNumberFormat('@');
  if (keep) {
    if (DEX_STATUS.indexOf(keep[0]) >= 0) sh.getRange('B4').setValue(keep[0]);
    if (keep[1] !== '' && keep[1] != null) sh.getRange('C4').setValue(keep[1]);
    sh.getRange('D4').setValue(keep[2] == null ? '' : keep[2]);
    sh.getRange('I4').setValue(keep[7] == null ? '' : keep[7]);
  }
  ['B4', 'C4', 'D4', 'I4'].forEach(function (a) {
    sh.getRange(a).setBackground('#fff8e1').setBorder(true, true, true, true, false, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(DEX_STATUS, true).setAllowInvalid(false).build());
  const gens = ['Alle'];
  for (let i = 1; i <= DEX_GEN_ENDS.length; i++) gens.push(String(i));
  sh.getRange('C4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(gens, true).setAllowInvalid(false).build());
  const dsh = ss.getSheetByName(SHEETS.dexData);
  if (dsh) {
    sh.getRange('I4').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(dsh.getRange('H2:H'), true).setAllowInvalid(true).build());
  }

  const head = function (col, headers) {
    sh.getRange(5, col, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#c62828').setFontColor('#ffffff');
  };
  head(1, DEX_VIEW_HEADERS);
  head(8, DEX_VIEW_CARD_HEADERS);
  setFormulaLocal_(sh.getRange('A6'), dexListFormula_());
  setFormulaLocal_(sh.getRange('H6'), dexCardFormula_());
  sh.getRange('F6:F').setNumberFormat(EUR_FORMAT);
  sh.getRange('O6:P').setNumberFormat(EUR_FORMAT);
  sh.getRange('A6:P').setVerticalAlignment('middle');
  sh.setFrozenRows(5);
  [60, 160, 90, 70, 90, 100, 24, 70, 210, 170, 80, 110, 170, 70, 100, 100]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  const grey = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=($A6<>"")*($E6=0)')
    .setFontColor('#9aa0a6')
    .setRanges([sh.getRange('A6:F')]).build();
  sh.setConditionalFormatRules([grey, pendingRule_(sh.getRange('A2:P2'), 2)]);
  sh.getRange('A5:F').protect().setDescription('Pokédex – wird per Formel berechnet').setWarningOnly(true);
  sh.getRange('H5:P').protect().setDescription('Pokédex – wird per Formel berechnet').setWarningOnly(true);
  applyDexRowHeights_(sh);
}

/** Formel der Pokémon-Liste (A6): liest Pokédex-Daten A:G, filtert nach Status (B4), Generation (C4) und Suche (D4). */
function dexListFormula_() {
  const d = "'" + SHEETS.dexData + "'!";
  return [
    '=IFERROR(LET(',
    'dat, FILTER(' + d + 'A2:G, ' + d + 'A2:A<>""),',
    'qry, TRIM(D4),',
    'nq, REGEXREPLACE(qry, "^#?0*", ""),',
    'okay, BYROW(dat, LAMBDA(rw, AND(',
    '  OR(B4="", B4="Alle", AND(B4="Vorhanden", INDEX(rw, 1, 6)>0), AND(B4="Fehlend", INDEX(rw, 1, 6)=0)),',
    '  OR(C4="", C4="Alle", TO_TEXT(INDEX(rw, 1, 4))=TO_TEXT(C4)),',
    '  OR(qry="", TO_TEXT(INDEX(rw, 1, 1))=nq, ISNUMBER(SEARCH(qry, INDEX(rw, 1, 2))), ISNUMBER(SEARCH(qry, INDEX(rw, 1, 3))))',
    '))),',
    'CHOOSECOLS(FILTER(dat, okay), 1, 2, 4, 5, 6, 7)',
    '), "Keine Pokémon gefunden")'
  ].join(' ');
}

/** Formel der Kartenliste (H6): Karten des Pokémon aus I4 (Auswahl „#25 Pikachu“, Name oder Nummer). */
function dexCardFormula_() {
  const d = "'" + SHEETS.dexData + "'!";
  return [
    '=IFERROR(LET(',
    'selx, TRIM(I4),',
    'pnr, IFERROR(INDEX(' + d + 'A2:A, MATCH(selx, ' + d + 'B2:B, 0)), IFERROR(INDEX(' + d + 'A2:A, MATCH(selx, ' + d + 'C2:C, 0)),',
    '  VALUE(REGEXEXTRACT(selx, "[0-9]+")))),',
    'crd, FILTER(' + d + 'J2:S, ' + d + 'J2:J=pnr),',
    'HSTACK(',
    '  MAP(CHOOSECOLS(crd, 10), LAMBDA(ul, IF(ul="", "–", IMAGE(ul&"/low.png")))),',
    '  CHOOSECOLS(crd, 2, 3, 4, 5, 6, 7, 8, 9)',
    ')), IF(TRIM(I4)="", "Oben in I4 ein Pokémon wählen", "Keine Karten von diesem Pokémon"))'
  ].join(' ');
}

/** Zeilen mit Kartenbildern im Blatt Pokédex hoch machen, die übrigen normal. */
function applyDexRowHeights_(sh) {
  sh = sh || ss_().getSheetByName(SHEETS.dex);
  if (!sh) return;
  SpreadsheetApp.flush();
  const max = sh.getMaxRows();
  if (max < 6) return;
  const names = sh.getRange(6, 9, max - 5, 1).getValues(); // Spalte I: Kartenname
  let last = 5;
  for (let i = names.length - 1; i >= 0; i--) { if (names[i][0] !== '') { last = i + 6; break; } }
  if (last >= 6) sh.setRowHeights(6, last - 5, 90);
  if (max > last) sh.setRowHeights(last + 1, max - last, 21);
}

/** Öffentlich (Tab Pokédex): {entries: [[Nr, Name, Name englisch, Generation, Karten, Exemplare, Wert]], gens} */
function getPokedex() {
  ensureSchema_();
  const sh = ss_().getSheetByName(SHEETS.data);
  const idx = pokedexIndex_(sh ? readData_(sh) : []);
  return {
    entries: idx.entries.map(function (e) { return [e.nr, e.name, e.nameEn, e.gen, e.cards, e.copies, e.value]; }),
    gens: DEX_GEN_ENDS.length
  };
}

// ---------- Seltenheiten ----------

function rarityKey_(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stufen aus dem Blatt „Seltenheiten“ (fehlt es: Startreihenfolge): {Schlüssel: Zahl oder null} */
function rarityRanks_() {
  const out = {};
  const sh = ss_().getSheetByName(SHEETS.rarity);
  const rows = !sh ? RARITY_SEED : (sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : []);
  rows.forEach(function (r) {
    const k = rarityKey_(r[0]);
    if (!k || k in out) return;
    const raw = String(r[1] == null ? '' : r[1]).trim().replace(',', '.');
    const n = Number(raw);
    out[k] = raw === '' || !isFinite(n) ? null : n;
  });
  return out;
}

/** Blatt „Seltenheiten“ anlegen und beim ersten Mal mit der Startreihenfolge füllen. Änderungen von Hand bleiben. */
function setupRaritySheet_(ss) {
  let sh = ss.getSheetByName(SHEETS.rarity);
  if (!sh) sh = ss.insertSheet(SHEETS.rarity);
  writeHeaders_(sh, RARITY_HEADERS);
  if (sh.getLastRow() < 2) {
    const seen = {};
    const rows = RARITY_SEED.filter(function (r) {
      const k = rarityKey_(r[0]);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).map(function (r) { return [r[0], r[1]]; });
    growRows_(sh, rows.length + 1);
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  sh.getRange('D1:D3').setValues([
    ['So sortiert „Seltenheit“ in der Sammlung: Stufe 1 = häufig, höhere Zahl = seltener, gleiche Zahl = gleich selten.'],
    ['Leere Stufe: kommt beim Sortieren ans Ende (z. B. Promo).'],
    ['Neue Seltenheiten aus deiner Sammlung trägt das Skript unten mit leerer Stufe ein. Stufen hier einfach ändern.']
  ]).setFontColor('#5f6368');
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 70);
  return sh;
}

/** Seltenheiten aus Daten, die im Blatt fehlen, mit leerer Stufe anhängen. Innerhalb der Sperre. -> Anzahl */
function syncRarities_(rows) {
  const sh = ss_().getSheetByName(SHEETS.rarity);
  if (!sh) return 0;
  const last = Math.max(1, sh.getLastRow());
  const known = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { known[rarityKey_(r[0])] = true; });
  const add = [];
  (rows || []).forEach(function (r) {
    if (!isDataRow_(r)) return;
    const t = String(r[COL.rarity] == null ? '' : r[COL.rarity]).trim();
    const k = rarityKey_(t);
    if (!k || known[k]) return;
    known[k] = true;
    add.push([t, '']);
  });
  if (!add.length) return 0;
  growRows_(sh, last + add.length);
  sh.getRange(last + 1, 1, add.length, 1).setNumberFormat('@');
  sh.getRange(last + 1, 1, add.length, 2).setValues(add);
  return add.length;
}

// ---------- Sortierung der Sammlung (Seitenleiste und Web-App) ----------

/** Sortierwert einer Gruppe g = {p, rows, count, dex} für COLL_SORTS-Schlüssel sort; null = ans Ende. */
function collSortValue_(g, sort, ranks) {
  if (sort === 'dex') return g.dex && g.dex.length ? g.dex[0] : null;
  if (sort === 'rarity') {
    const k = rarityKey_(g.p[COL.rarity]);
    return k && ranks[k] != null ? ranks[k] : null;
  }
  if (sort === 'name') return String(g.p[COL.name] || '').toLowerCase() || null;
  if (sort === 'price') return groupPrice_(g.rows).price;
  if (sort === 'added') {
    let t = null;
    g.rows.forEach(function (r) { const x = timeOf_(r[COL.added]); if (isFinite(x) && (t == null || x > t)) t = x; });
    return t;
  }
  return null;
}

/**
 * Vergleich zweier Gruppen: Karten mit 0 Exemplaren immer am Ende, dann Gruppen ohne Sortierwert, dann der Wert
 * in der gewählten Richtung, bei Gleichstand nach Set und Nummer. Für „Set“ dreht desc die Set-Reihenfolge.
 */
function collCompare_(a, b, sort, desc) {
  const dir = desc ? -1 : 1;
  const z = (a.count > 0 ? 0 : 1) - (b.count > 0 ? 0 : 1);
  if (z) return z;
  if (sort === 'set') return dir * setOrder_(a, b);
  const x = a.sortVal, y = b.sortVal;
  if (x == null || y == null) {
    if (x != null || y != null) return x == null ? 1 : -1;
    return setOrder_(a, b);
  }
  return dir * cmp_(x, y) || setOrder_(a, b);
}

// ---------------------------------------------------------------------------
// 11. Dashboard: Kennzahlen und Knöpfe
// ---------------------------------------------------------------------------
// Ein Blatt ganz vorne mit vier Kacheln (Gesamtwert, Karten, Pokédex, Wertverlauf) und Bild-Knöpfen. Die Knöpfe sind
// Bilder mit zugewiesener Funktion (Sheet.insertImage + assignScript), die Einrichtung legt sie selbst an. Die Bilder
// kommen aus assets/dashboard/ im Repo (gezeichnet mit tools/dashboard-knoepfe.js). In der Sheets-App am Handy
// reagieren Bilder nicht auf Antippen, dort zeigt das Dashboard nur die Zahlen. Die Kacheln rechnet refreshDashboard_
// bei jedem Einsortieren (aus rebuildGroups_, #41) und nach jedem Preislauf (aus writeHistory_) neu.

/**
 * Knöpfe in Lesereihenfolge: Aktionen (bis zu 8, je 4 in einer Reihe), dann die Blätter (nav, eine Reihe).
 * fn: öffentliche Funktion; ihr Name steht in jeder Tabelle am Bild und darf sich nicht ändern.
 */
const DASH_BUTTONS = [
  { key: 'erfassen', label: 'Karten erfassen', fn: 'kartenErfassen' },
  { key: 'einsortieren', label: 'Einsortieren', fn: 'einsortieren' },
  { key: 'preise', label: 'Preise aktualisieren', fn: 'preiseJetztAktualisieren' },
  { key: 'import', label: 'Importieren', fn: 'importAnzeigen' },
  { key: 'updates', label: 'Updates', fn: 'updatesAnzeigen' },
  { key: 'sets', label: 'Sets und Übersetzung', fn: 'uebersetzungUndSetsAktualisieren' },
  { key: 'ansicht', label: 'Ansicht neu aufbauen', fn: 'ansichtNeuAufbauen' },
  { key: 'handy', label: 'Handy-Link', fn: 'webAppLinkAnzeigen' },
  { key: 'sammlung', label: 'Sammlung', fn: 'zurSammlung', nav: true },
  { key: 'pokedex', label: 'Pokédex', fn: 'zumPokedex', nav: true },
  { key: 'verlauf', label: 'Verlauf', fn: 'zumVerlauf', nav: true },
  { key: 'seltenheiten', label: 'Seltenheiten', fn: 'zuSeltenheiten', nav: true }
];
/**
 * Bilder der Knöpfe, fest auf den Commit mit den Dateien: Sie gehen so schon vor dem Mergen und bleiben für diese
 * Version gleich. Neue Bilder: Commit hier eintragen und DASH_ASSET_VERSION erhöhen, dann ersetzt das Update der
 * Tabelle (upgradeIfNeeded_) oder „Ansicht neu aufbauen“ die alten Knöpfe.
 */
const DASH_ASSETS = 'https://raw.githubusercontent.com/studiobaeric/collection-sheet/9a3c8ea9774f452de13ed9df18f18f90bf3193eb/assets/dashboard/';
const DASH_ASSET_VERSION = '1';
const DASH_ALT_RE = /^Dashboard-Knopf ([\w-]+) v(\S+)$/;
const DASH_META = 'pokemonToolDashboard'; // Entwickler-Metadaten am Blatt: das Dashboard des Tools
const DASH_BTN_W = 276;
const DASH_BTN_H = 52;
// Look „Rot-weiß“ (Eric, 22.10.2026), gleich dem aktiven Look in docs/dashboard/looks.json; dort sind auch die
// anderen Looks als Konzept gespeichert
const DASH_COLORS = {
  page: '#ffffff', banner: '#c62828', title: '#ffffff', bannerSub: '#ffcdd2', tile: '#f8f9fa', tileBorder: '#e0e0e0',
  label: '#5f6368', value: '#202124', sub: '#5f6368', up: '#137333', down: '#a50e0e', section: '#202124',
  line: '#dadce0', accent: '#c62828', track: '#e8eaed', warn: '#a50e0e'
};
const DASH_FONT = 'Inter';
const DASH_HELP = 'Die Knöpfe funktionieren am Computer. In der Sheets-App am Handy zeigt das Dashboard nur die Zahlen.';
const DASH_LOAD_FAILED = 'Einige Knöpfe ließen sich nicht laden (keine Verbindung zu GitHub). Bitte später Pokémon > Ansicht neu aufbauen.';
const DASH_DAYS = 90;   // Wertverlauf: so viele Tage zurück
const DASH_CHANGE = 7;  // Veränderung des Gesamtwerts: seit so vielen Tagen
// Raster (Pixel): Rand, je Kachel Innenrand + Inhalt + Innenrand, dazwischen Lücken (zusammen 1184 px); Zeilenhöhen
const DASH_COL_WIDTHS = [16, 10, 256, 10, 16, 10, 256, 10, 16, 10, 256, 10, 16, 10, 256, 10, 16];
const DASH_ROW_HEIGHTS = { 1: 16, 2: 46, 3: 26, 4: 16, 5: 26, 6: 40, 7: 22, 8: 10, 9: 22, 10: 30, 11: 8, 12: 58, 13: 58, 14: 22,
  15: 30, 16: 8, 17: 58, 18: 14, 19: 22 };
// Hilfsspalten (versteckt): R Werte für die Mini-Diagramme, S:T deren Einstellungen
const DASH_HELPER_COL = 18;
const DASH_NCOLS = 26;
const DASH_NROWS = 40;

/** Zelle, an der Knopf i hängt: Aktionen in Zeile 12 und 13, Blätter in Zeile 17, je Kachel-Spalte B, F, J, N. */
function dashButtonCell_(i) {
  const nav = !!DASH_BUTTONS[i].nav;
  const k = DASH_BUTTONS.slice(0, i).filter(function (b) { return !!b.nav === nav; }).length;
  return { row: nav ? 17 : 12 + Math.floor(k / 4), col: 2 + (k % 4) * 4 };
}

/**
 * Blatt „Dashboard“ aufbauen (ganz vorne, das aktive Blatt bleibt) und die Knöpfe setzen. Läuft mit setupSheets_
 * (Einrichtung, Update, Reparatur) und bei „Ansicht neu aufbauen“. -> Anzahl Knöpfe, die sich nicht laden ließen
 */
function setupDashboardSheet_(ss) {
  const c = DASH_COLORS;
  const prev = ss.getActiveSheet();
  dashKeepForeign_(ss);
  const sh = getOrCreateSheet_(ss, SHEETS.dash);
  if (!dashMarked_(sh)) sh.addDeveloperMetadata(DASH_META);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  if (prev && prev.getName() !== SHEETS.dash) ss.setActiveSheet(prev);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  ensureCols_(sh, DASH_NCOLS);
  if (sh.getMaxRows() < DASH_NROWS) sh.insertRowsAfter(sh.getMaxRows(), DASH_NROWS - sh.getMaxRows());
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart();
  sh.clear();
  sh.clearConditionalFormatRules();
  all.clearDataValidations();
  sh.showColumns(1, sh.getMaxColumns());
  sh.setHiddenGridlines(true);
  sh.setTabColor(c.accent);
  all.setBackground(c.page).setFontFamily(DASH_FONT).setFontColor(c.value).setVerticalAlignment('middle');

  DASH_COL_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  Object.keys(DASH_ROW_HEIGHTS).forEach(function (r) { sh.setRowHeight(Number(r), DASH_ROW_HEIGHTS[r]); });

  // Kopf
  sh.getRange('B2:P3').setBackground(c.banner);
  sh.getRange('C2').setValue('Pokémon-Sammlung').setFontSize(20).setFontWeight('bold').setFontColor(c.title).setVerticalAlignment('bottom');
  sh.getRange('O2').setFontSize(9).setFontColor(c.bannerSub).setHorizontalAlignment('right').setVerticalAlignment('bottom');
  sh.getRange('C3').setFontSize(10).setFontColor(c.bannerSub).setVerticalAlignment('top');

  // Kacheln
  [2, 6, 10, 14].forEach(function (col) {
    sh.getRange(5, col, 4, 3).setBackground(c.tile)
      .setBorder(true, true, true, true, false, false, c.tileBorder, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(5, col + 1).setFontSize(8).setFontWeight('bold').setFontColor(c.label).setVerticalAlignment('bottom');
    sh.getRange(6, col + 1).setFontSize(20).setFontWeight('bold').setFontColor(c.value).setHorizontalAlignment('left');
    sh.getRange(7, col + 1).setFontSize(10).setFontColor(c.sub).setVerticalAlignment('top');
  });
  sh.getRange('C6').setNumberFormat(EUR_FORMAT);
  sh.getRange('G6').setNumberFormat('0');
  sh.getRange('K6').setNumberFormat('@');
  sh.getRange('O6:O7').merge();

  // Mini-Diagramme: Werte und Einstellungen stehen in den Hilfsspalten (schreibt refreshDashboard_)
  const hc = DASH_HELPER_COL;
  const hl = colLetter_(hc), ol = colLetter_(hc + 1), vl = colLetter_(hc + 2);
  const hist = hl + '2:' + hl + (DASH_DAYS + 1);
  setFormulaLocal_(sh.getRange('O6'), '=IF(COUNT(' + hist + ')<2, "Noch zu wenig Verlauf", SPARKLINE(FILTER(' + hist + ', ' + hist + '<>""), ' +
    ol + '2:' + vl + '4))');
  sh.getRange('O6').setFontSize(10).setFontWeight('normal').setFontColor(c.sub);
  setFormulaLocal_(sh.getRange('K7'), '=SPARKLINE(' + hl + (DASH_DAYS + 3) + ':' + hl + (DASH_DAYS + 4) + ', ' + ol + '7:' + vl + '10)');
  sh.hideColumns(hc, 3);

  // Unter den Kacheln, solange Änderungen nicht einsortiert sind (#41); sonst leer
  setFormulaLocal_(sh.getRange('C9'), pendingHintFormula_('die Zahlen zeigen den alten Stand. Knopf Einsortieren unten', ''));
  sh.getRange('C9').setFontSize(10).setFontWeight('bold').setFontColor(c.warn);

  // Abschnitte und Hinweis
  [[10, 'Aktionen'], [15, 'Blätter']].forEach(function (x) {
    sh.getRange(x[0], 3).setValue(x[1]).setFontSize(12).setFontWeight('bold').setFontColor(c.section);
    sh.getRange(x[0], 2, 1, 15).setBorder(false, false, true, false, false, false, c.line, SpreadsheetApp.BorderStyle.SOLID);
  });

  const missing = dashPlaceButtons_(sh);
  sh.getRange('C19').setValue(missing ? DASH_LOAD_FAILED : DASH_HELP).setFontSize(9).setFontColor(missing ? c.warn : c.label);
  sh.protect().setDescription('Dashboard – wird vom Skript aufgebaut').setWarningOnly(true);
  const dsh = ss.getSheetByName(SHEETS.data);
  refreshDashboard_(dsh ? readData_(dsh) : []);
  return missing;
}

/**
 * Ein Blatt „Dashboard“, das nicht vom Tool stammt (vor 1.1.0 selbst angelegt), heißt danach „Dashboard (alt)“, statt
 * dass der Aufbau es leert. Vom Tool ist es mit der Markierung DASH_META oder wenn es in TOOL_SHEETS der Tabelle steht.
 */
function dashKeepForeign_(ss) {
  const sh = ss.getSheetByName(SHEETS.dash);
  if (!sh || dashMarked_(sh)) return;
  let stored = [];
  try { stored = JSON.parse(settingGet_('TOOL_SHEETS') || '[]'); } catch (e) { stored = []; }
  if (Array.isArray(stored) && stored.indexOf(SHEETS.dash) >= 0) return;
  let name = SHEETS.dash + ' (alt)';
  for (let i = 2; ss.getSheetByName(name); i++) name = SHEETS.dash + ' (alt ' + i + ')';
  sh.setName(name);
  notify_('Dein Blatt „' + SHEETS.dash + '“ heißt jetzt „' + name + '“. Das Tool legt sein eigenes Dashboard an.');
}

function dashMarked_(sh) {
  try { return sh.getDeveloperMetadata().some(function (m) { return m.getKey() === DASH_META; }); } catch (e) { return false; }
}

/**
 * Knöpfe setzen: vorhandene Knöpfe dieser Bild-Version bleiben (nur Lage, Größe und Funktion werden neu gesetzt),
 * fehlende werden von GitHub geladen, alte Versionen und doppelte entfernt. Fremde Bilder bleiben, wie sie sind.
 * -> Anzahl Knöpfe, die sich nicht laden ließen
 */
function dashPlaceButtons_(sh) {
  const want = {};
  DASH_BUTTONS.forEach(function (b) { want[b.key] = true; });
  const have = {};
  sh.getImages().forEach(function (img) {
    let m = null;
    try { m = DASH_ALT_RE.exec(img.getAltTextDescription() || ''); } catch (e) { m = null; }
    if (!m) return;
    if (!want[m[1]] || m[2] !== DASH_ASSET_VERSION || have[m[1]]) { img.remove(); return; }
    have[m[1]] = img;
  });
  const missing = DASH_BUTTONS.filter(function (b) { return !have[b.key]; });
  if (missing.length) {
    let res = [];
    try {
      res = UrlFetchApp.fetchAll(missing.map(function (b) { return { url: DASH_ASSETS + b.key + '.png', muteHttpExceptions: true }; }));
    } catch (e) { res = []; }
    missing.forEach(function (b, i) {
      const r = res[i];
      if (!r || r.getResponseCode() !== 200) return;
      const cell = dashButtonCell_(DASH_BUTTONS.indexOf(b));
      try {
        have[b.key] = sh.insertImage(r.getBlob().setContentType('image/png').setName(b.key + '.png'), cell.col, cell.row, 0, 3);
      } catch (e) { /* zählt unten als fehlend */ }
    });
  }
  let failed = 0;
  DASH_BUTTONS.forEach(function (b, i) {
    const img = have[b.key];
    if (!img) { failed++; return; }
    const cell = dashButtonCell_(i);
    img.setAnchorCell(sh.getRange(cell.row, cell.col)).setAnchorCellXOffset(0).setAnchorCellYOffset(3)
      .setWidth(DASH_BTN_W).setHeight(DASH_BTN_H)
      .setAltTextTitle(b.label).setAltTextDescription('Dashboard-Knopf ' + b.key + ' v' + DASH_ASSET_VERSION)
      .assignScript(b.fn);
  });
  return failed;
}

/**
 * Kacheln, Kopfzeile und Mini-Diagramme neu schreiben. Ohne Blatt passiert nichts. rows: Daten-Zeilen,
 * dex: Pokédex-Index aus rebuildPokedex_ (fehlt er, wird er hier berechnet).
 */
function refreshDashboard_(rows, dex) {
  const sh = ss_().getSheetByName(SHEETS.dash);
  if (!sh) return false;
  rows = rows || [];
  const c = DASH_COLORS;
  const now = new Date();
  const today = dateText_(now);
  const value = collectionValue_(rows);
  let distinct = 0;
  groupRows_(rows).forEach(function (g) {
    if (g.idx.reduce(function (s, i) { return s + (Number(rows[i][COL.count]) || 0); }, 0) > 0) distinct++;
  });
  if (!dex) { try { dex = pokedexIndex_(rows); } catch (e) { dex = null; } }
  const dexTotal = dex ? dex.entries.length : 0;
  const dexOwned = dex ? dex.entries.filter(function (e) { return e.copies > 0; }).length : 0;
  const hist = dashHistory_();
  const last = hist.length ? hist[hist.length - 1] : null;

  // Veränderung: Eintrag von vor DASH_CHANGE Tagen, fehlt der Tag, der nächstältere
  const target = dashDayShift_(today, -DASH_CHANGE);
  let ref = null;
  hist.forEach(function (h) { if (h.day <= target) ref = h; });
  let change, color = c.sub;
  if (ref) {
    const d = Math.round((value.total - ref.total) * 100) / 100;
    change = (d > 0 ? '+' : d < 0 ? '−' : '±') + dashEur_(Math.abs(d)) + ' seit ' + dashShortDate_(ref.day, today);
    color = d > 0 ? c.up : d < 0 ? c.down : c.sub;
  } else {
    change = hist.length ? 'Vergleich ab ' + dashShortDate_(dashDayShift_(hist[0].day, DASH_CHANGE), today) : 'Noch kein Verlauf';
  }

  const upd = dashUpdateText_();
  const pct = dexTotal ? (Math.round(dexOwned / dexTotal * 1000) / 10).toFixed(1).replace('.', ',') : '0,0';
  // Zeilen C:O in einem Rutsch; die Zellen dazwischen (Innenränder, Lücken) bleiben leer, K7 und O6:O7 sind Formeln
  // und werden nicht überschrieben
  const line = function (cells) {
    const out = new Array(13).fill('');
    Object.keys(cells).forEach(function (k) { out['CDEFGHIJKLMNO'.indexOf(k)] = cells[k]; });
    return out;
  };
  sh.getRange('C2:O3').setValues([
    line({ C: 'Pokémon-Sammlung', O: 'Version ' + TOOL_VERSION + (upd ? ' · ' + upd : '') }),
    line({ C: 'Stand ' + Utilities.formatDate(now, tz_(), 'dd.MM.yyyy HH:mm') +
      (last ? ' · Preise vom ' + dmyText_(last.day) : ' · noch kein Preislauf') })
  ]);
  sh.getRange('C5:O5').setValues([line({ C: 'GESAMTWERT', G: 'KARTEN', K: 'POKÉDEX · ' + pct + ' %', O: 'WERTVERLAUF · ' + DASH_DAYS + ' TAGE' })]);
  sh.getRange('C6:K6').setValues([line({ C: value.total, G: value.cards, K: dexTotal ? dexOwned + ' von ' + dexTotal : '–' }).slice(0, 9)]);
  sh.getRange('C7:G7').setValues([line({ C: change, G: value.cards > 1
    ? (distinct === value.cards ? 'alle verschieden' : 'davon ' + distinct + ' verschiedene') : '' }).slice(0, 5)]);
  sh.getRange('C7').setFontColor(color);

  // Hilfsspalten: R = Wertverlauf der letzten DASH_DAYS Tage, darunter der Pokédex-Balken (vorhanden, fehlend);
  // S:T = Einstellungen der beiden Mini-Diagramme (Linie ab Zeile 2, Balken ab Zeile 7)
  const since = dashDayShift_(today, -(DASH_DAYS - 1));
  const vals = hist.filter(function (h) { return h.day >= since; }).map(function (h) { return h.total; }).slice(-DASH_DAYS);
  const opts = [['charttype', 'line'], ['color', c.accent], ['linewidth', 2], ['', ''], ['', ''],
    ['charttype', 'bar'], ['color1', c.accent], ['color2', c.track], ['max', Math.max(1, dexTotal)]];
  const block = [];
  for (let i = 0; i < DASH_DAYS + 3; i++) {
    const v = i < DASH_DAYS ? (i < vals.length ? vals[i] : '') : i === DASH_DAYS + 1 ? dexOwned : i === DASH_DAYS + 2 ? Math.max(0, dexTotal - dexOwned) : '';
    block.push([v].concat(opts[i] || ['', '']));
  }
  sh.getRange(2, DASH_HELPER_COL, block.length, 3).setValues(block);
  return true;
}

/** Einträge im Blatt Verlauf, nach Datum: [{day: 'yyyy-MM-dd', total}] (ein Eintrag pro Tag, der letzte zählt). */
function dashHistory_() {
  const sh = ss_().getSheetByName(SHEETS.hist);
  if (!sh || sh.getLastRow() < 2) return [];
  const byDay = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const day = typeof r[0] === 'string' ? r[0].trim() : r[0] && typeof r[0] === 'object' ? dateText_(r[0]) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof r[1] === 'number' && isFinite(r[1])) byDay[day] = r[1];
  });
  return Object.keys(byDay).sort().map(function (d) { return { day: d, total: byDay[d] }; });
}

/** 'yyyy-MM-dd' um days Tage verschieben (Kalendertage, ohne Zeitzone). */
function dashDayShift_(ymd, days) {
  const p = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}

/** 'yyyy-MM-dd' -> '15.10.' im selben Jahr wie today, sonst '15.10.2025'. */
function dashShortDate_(ymd, today) {
  const p = String(ymd).split('-');
  return p[2] + '.' + p[1] + '.' + (p[0] === String(today).slice(0, 4) ? '' : p[0]);
}

/** 1234.5 -> '1.234,50 €' */
function dashEur_(n) {
  const parts = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + parts[1] + ' €';
}

/** Hinweis auf eine neue Version aus dem Zwischenspeicher der Update-Prüfung (ohne Abruf), sonst ''. */
function dashUpdateText_() {
  try {
    const hit = CacheService.getScriptCache().get(UPD_CACHE_KEY);
    if (!hit) return '';
    const newer = updNewer_(JSON.parse(hit));
    return newer.length ? 'Version ' + newer[0].version + ' ist da' : '';
  } catch (e) { return ''; }
}

/**
 * Ein Blatt öffnen (Knöpfe und Menü). Ein verstecktes Blatt wird wieder sichtbar. Fehlt es, legt das Tool die fehlenden
 * Blätter wieder an wie beim Öffnen von „Karten erfassen“ (eine stillgelegte Tabelle zeigt nur den Hinweis).
 */
function dashOpenSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    if (takenOverBy_()) { uebernommenHinweis(); return; }
    if (isFreshCopy_() || needsSetup_()) setupAll_();
    else { upgradeIfNeeded_(); repairSetup_(); }
    sh = ss.getSheetByName(name);
    if (!sh) { alert_('Das Blatt „' + name + '“ fehlt und ließ sich nicht wieder anlegen.'); return; }
  }
  if (sh.isSheetHidden()) sh.showSheet();
  ss.setActiveSheet(sh);
}

function zumDashboard() { dashOpenSheet_(SHEETS.dash); }

function zurSammlung() { dashOpenSheet_(SHEETS.view); }
function zumPokedex() { dashOpenSheet_(SHEETS.dex); }
function zumVerlauf() { dashOpenSheet_(SHEETS.hist); }
function zuSeltenheiten() { dashOpenSheet_(SHEETS.rarity); }
