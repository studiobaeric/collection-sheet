'use strict';
/**
 * Tests für Teil „Quelle“ (parts/10_quelle.gs): Blätter, Entwurf, Quelle öffnen, Tab lesen, Spalten raten,
 * Datensätze (Liste, Checkliste, Raster), Vorschau, Vorlagen. Nur erfundene Daten.
 *   node test_import_quelle.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./harness2');

const t = H.runner('import-quelle');
const FILES = ['Code.gs', '../parts/00_shared.gs', '../parts/10_quelle.gs'];
const J = x => JSON.stringify(x);

// ---------------------------------------------------------------------------
// Stubs für Teil „Erkennung“ (wird parallel gebaut; hier nur, was importPreviewRows braucht)
// ---------------------------------------------------------------------------
function stubExtract(rec, cfg) {
  const raw = rec.raw || {};
  const name = String(raw.name || '').trim();
  const number = String(raw.number || '').trim();
  const cm = (String(raw.cmLink || '').match(/https?:\/\/\S*cardmarket\.com\S*/) || [''])[0];
  let qty = parseInt(raw.qty, 10);
  if (!isFinite(qty)) qty = 1;
  let skip = null;
  if (/^(summe|gesamt|total|sum)\b/i.test(name || rec.first || '')) skip = 'summe';
  else if (!name && !number && !cm && !String(raw.tcgdexId || '').trim()) skip = 'leer';
  else if (cfg.form === 'checkliste') {
    const checked = /^(true|wahr|x|ja|yes|1|✓|✔)$/i.test(String(raw.check || '').trim());
    if (!checked) { qty = 0; skip = 'nichtAngehakt'; }
  }
  return {
    name, nameClean: name, number, set: String(raw.set || '').trim(), qty, variant: '', cond: '', lang: 'DE', version: '',
    cmUrl: cm, tcgdexId: '', price: null, priceDate: String(raw.priceDate || ''), extras: Object.assign({}, rec.extrasRaw), skip
  };
}

function mkEnv(opts) {
  const env = H.createEnv(Object.assign({ files: FILES }, opts || {}));
  const c = env.ctx;
  if (typeof c.loadTerms_ !== 'function') c.loadTerms_ = () => [];
  if (typeof c.extractRow_ !== 'function') c.extractRow_ = stubExtract;
  return env;
}

// ---------------------------------------------------------------------------
// Erfundene Quellen (Aufbau wie Erics Ordner-Liste, Inhalte ausgedacht)
// ---------------------------------------------------------------------------
const SHEET_ID = '1SheetAbcdefghijklmnopQRSTUV';
const XLSX_ID = '1XlsxAbcdefghijklmnopQRSTUVW';
const XLSX2_ID = '1Xlsx2bcdefghijklmnopQRSTUV';
const PDF_ID = '1PdfAbcdefghijklmnopQRSTUVWX';
const CM = 'https://www.cardmarket.com/de/Pokemon/Products/Singles/';
const U_GLURAK = CM + 'Base-Set/Charizard-BS4';
const U_TURTOK = CM + 'Base-Set/Blastoise-BS2';
const U_GENGAR = CM + 'Fossil/Gengar-FO5?isReverseHolo=Y';
const U_PC = 'https://www.pricecharting.com/game/pokemon-fossil/gengar-5';
const ERIC_HEADER = ['Karte Name', 'Setnummer', 'Cardmarket', 'Set', '30 Tage Preistrend', 'Datum Preis-Daten', 'Spalte 1'];

function ordnerTab() {
  const values = [
    ERIC_HEADER.slice(),
    ['Glurak', 4, U_GLURAK, 'Grundset', '350,00 €', '01.10.2026', ''],
    ['Turtok', '2', 'Cardmarket', 'Grundset', '120,00 €', '01.10.2026', ''],
    ['Gengar Rev Holo', '5', 'Gengar (CM) / PC', 'Fossil', '12,00 €', '01.10.2026', ''],
    ['Pikachu Snowflake', 'DP 16', 'siehe ' + U_GLURAK + ' dort', '', '3,50 €', '', ''],
    ['', '', '', '', '', '', ''],
    ['Bisasam', '025', '', 'Grundset', '', '', ''],
    ['Mewtu', 'X', 'Link', '', '', '', ''],
    ['SUMME', '', '', '', '486,50 €', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['   ', '', '', '', '', '', '', '', '']
  ];
  return {
    values,
    links: {
      '2,3': U_GLURAK, // Text ist schon der Link: nichts anhängen
      '3,3': U_TURTOK, // Text "Cardmarket" mit Link
      '4,3': [{ text: 'Gengar ', url: null }, { text: '(CM)', url: U_GENGAR }, { text: ' / ', url: null }, { text: 'PC', url: U_PC }],
      '5,3': U_GLURAK, // Link steht schon im Text
      '8,3': [{ text: 'Li', url: U_TURTOK }, { text: 'nk', url: U_TURTOK }] // zwei Abschnitte, derselbe Link
    }
  };
}

function addSources(env) {
  env.addSource({
    id: SHEET_ID, name: 'Meine Liste', mime: 'sheet',
    tabs: {
      Tabellenblatt1: ordnerTab(),
      'Nur Kopf': [['Name', 'Nummer', 'Set']],
      Leer: [],
      Checkliste: [
        ['Nr', 'Pokémon', 'Vorhanden'],
        ['1', 'Bisasam', 'WAHR'], ['2', 'Bisaknosp', 'FALSCH'], ['3', 'Bisaflor', 'WAHR'], ['4', 'Glumanda', '']
      ]
    }
  });
  env.addSource({ id: XLSX_ID, name: 'Pokemon Ordner.xlsx', mime: 'xlsx', tabs: { Tabellenblatt1: ordnerTab(), Pokedex: [['Nr', 'Pokémon', 'Vorhanden'], ['1', 'Bisasam', 'WAHR']], Leer: [] } });
  env.addSource({ id: XLSX2_ID, name: 'Zweite.xlsx', mime: 'xls', tabs: { Daten: [['Name', 'Anzahl'], ['Pikachu', '2']] } });
  env.addSource({ id: PDF_ID, name: 'Rechnung.pdf', mime: 'application/pdf', tabs: {} });
}

function lockClean(env, label) {
  t.ok(label + ': keine verschachtelte Sperre und Sperre frei', env.lock.nested === 0 && env.lock.depth === 0, env.lock);
}

function srcValues(env) {
  return env.values('Import-Quelle').map(r => r.map(String));
}

// ===========================================================================
t.section('setupImportSheets_ über setupAll_');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  const vis = n => env.sheet(n) && !env.sheet(n).isSheetHidden();
  const hid = n => env.sheet(n) && env.sheet(n).isSheetHidden();
  t.ok('sichtbar: Importe, Import-Begriffe, Import-Sets', vis('Importe') && vis('Import-Begriffe') && vis('Import-Sets'));
  t.ok('versteckt: Vorlagen, Quelle, Prüfung, Antworten, Protokoll',
    ['Import-Vorlagen', 'Import-Quelle', 'Import-Prüfung', 'Import-Antworten', 'Import-Protokoll'].every(hid));
  t.eq('Kopfzeile Importe', env.values('Importe')[0], env.run('IMPORTE_HEADERS'));
  t.eq('Kopfzeile Import-Begriffe', env.values('Import-Begriffe')[0], ['Begriff', 'Bedeutung', 'Wert', 'Wo']);
  t.eq('Kopfzeile Import-Sets', env.values('Import-Sets')[0], ['Cardmarket-Name', 'Kürzel', 'tcgdex-Sets', 'Herkunft']);
  t.eq('Kopfzeile Import-Vorlagen', env.values('Import-Vorlagen')[0], ['Name', 'Konfiguration', 'Kopfzeilen', 'Zuletzt benutzt']);
  t.eq('Kopfzeile Import-Prüfung', env.values('Import-Prüfung')[0], env.run('REVIEW_HEADERS'));
  t.eq('Kopfzeile Import-Antworten', env.values('Import-Antworten')[0], ['Quelle-ID', 'Quellzeile', 'Entscheidung', 'Karte', 'Datum']);
  t.eq('Kopfzeile Import-Protokoll', env.values('Import-Protokoll')[0], env.run('PROTO_HEADERS'));
  t.eq('Import-Quelle ohne eigene Kopfzeile, leer', env.values('Import-Quelle'), []);
  t.ok('Kopfzeilen fixiert', ['Importe', 'Import-Begriffe', 'Import-Sets', 'Import-Vorlagen', 'Import-Prüfung', 'Import-Antworten']
    .every(n => env.sheet(n).getFrozenRows() === 1));
  const imp = env.sheet('Importe');
  t.eq('Importe Formate (Nr, Datum, Quelle-ID, Neu, Wertänderung, Zurückgenommen am, Bericht)',
    [1, 2, 4, 9, 14, 15, 16].map(col => imp.getRange(5, col).getNumberFormat()),
    ['0', '@', '@', '0', env.run('EUR_FORMAT'), '@', '@']);
  t.ok('Textformat in Begriffe/Vorlagen/Antworten/Prüfung/Quelle',
    ['Import-Begriffe', 'Import-Vorlagen', 'Import-Antworten', 'Import-Prüfung', 'Import-Sets'].every(n => env.sheet(n).getRange(50, 2).getNumberFormat() === '@') &&
    env.sheet('Import-Quelle').getRange(7, 3).getNumberFormat() === '@');

  const terms = env.values('Import-Begriffe').slice(1);
  t.eq('38 Begriffe vorbelegt', terms.length, 38);
  const count = m => terms.filter(r => r[1] === m).length;
  t.eq('je Bedeutung: Variante 12, Zustand 14, Sonderversion 3, Sprache 9, Ignorieren 0',
    [count('Variante'), count('Zustand'), count('Sonderversion'), count('Sprache'), count('Ignorieren')], [12, 14, 3, 9, 0]);
  const find = term => terms.find(r => r[0] === term);
  t.eq('Reverse Holo / RH / Holo / Normal / 1. Edition',
    [find('Reverse Holo'), find('RH'), find('Holo'), find('Normal'), find('1. Edition')],
    [['Reverse Holo', 'Variante', 'reverse', 'Name und Spalten'], ['RH', 'Variante', 'reverse', 'nur Spalten'],
      ['Holo', 'Variante', 'holo', 'nur Spalten'], ['Normal', 'Variante', 'normal', 'nur Spalten'],
      ['1. Edition', 'Variante', 'firstEdition', 'Name und Spalten']]);
  t.eq('Near Mint / NM / Snowflake / Japanese / DE',
    [find('Near Mint'), find('NM'), find('Snowflake'), find('Japanese'), find('DE')],
    [['Near Mint', 'Zustand', 'NM', 'Name und Spalten'], ['NM', 'Zustand', 'NM', 'nur Spalten'],
      ['Snowflake', 'Sonderversion', 'Snowflake', 'Name und Spalten'], ['Japanese', 'Sprache', 'JP', 'nur Spalten'],
      ['DE', 'Sprache', 'DE', 'nur Spalten']]);
  t.ok('alle Werte sind Text (keine Zahlen/Daten)', terms.every(r => r.every(v => typeof v === 'string')));
  t.eq('Import-Sets leer', env.values('Import-Sets').length, 1);
  lockClean(env, 'setupAll_');

  // Eric ändert etwas, dann zweite Einrichtung
  const bg = env.sheet('Import-Begriffe');
  bg.getRange(2, 3).setValue('holo');
  bg.getRange(40, 1, 1, 4).setValues([['Gold Star', 'Sonderversion', 'Gold Star', 'Name und Spalten']]);
  env.sheet('Import-Sets').getRange(2, 1, 1, 4).setValues([['Unleashed', 'UL', 'hgss2', 'Hand']]);
  env.sheet('Importe').getRange(2, 1, 1, 8).setValues([[1, '2026-10-01', 'Meine Liste', SHEET_ID, 'Tabellenblatt1', '', 'Nur Neues', 'aktiv']]);
  env.sheet('Import-Vorlagen').getRange(2, 1, 1, 4).setValues([['Alt', '{"form":"liste","mode":"alle"}', 'a|b', '2026-01-01 10:00']]);
  env.sheet('Import-Antworten').getRange(2, 1, 1, 5).setValues([['S1', 'abc', '{"type":"skip"}', '', '2026-10-01']]);
  c.setupAll_();
  const terms2 = env.values('Import-Begriffe').slice(1);
  t.eq('zweite Einrichtung: 39 Begriffe, keine doppelte Vorbelegung', terms2.length, 39);
  t.eq('zweite Einrichtung: Erics Änderung bleibt', terms2[0], ['Reverse Holo', 'Variante', 'holo', 'Name und Spalten']);
  t.eq('zweite Einrichtung: eigener Begriff bleibt', terms2[38], ['Gold Star', 'Sonderversion', 'Gold Star', 'Name und Spalten']);
  t.eq('zweite Einrichtung: Import-Sets bleibt', env.values('Import-Sets')[1], ['Unleashed', 'UL', 'hgss2', 'Hand']);
  t.eq('zweite Einrichtung: Importe bleibt', env.values('Importe')[1].slice(0, 8), [1, '2026-10-01', 'Meine Liste', SHEET_ID, 'Tabellenblatt1', '', 'Nur Neues', 'aktiv']);
  t.eq('zweite Einrichtung: Vorlage und Antwort bleiben', [env.values('Import-Vorlagen')[1][0], env.values('Import-Antworten')[1][1]], ['Alt', 'abc']);
  c.setupImportSheets_(env.ss);
  c.setupImportSheets_();
  t.eq('setupImportSheets_ direkt (zweimal): nichts verdoppelt', env.values('Import-Begriffe').length, 40);
  lockClean(env, 'zweite Einrichtung');

  // Alle Begriffe gelöscht -> Vorbelegung kommt wieder
  bg.getRange(2, 1, 39, 4).clearContent();
  c.setupImportSheets_(env.ss);
  t.eq('leeres Begriffe-Blatt wird wieder vorbelegt', env.values('Import-Begriffe').length, 39);

  // Versteckte Blätter, die jemand eingeblendet hat, werden wieder versteckt
  env.sheet('Import-Prüfung').showSheet();
  c.setupImportSheets_(env.ss);
  t.ok('Import-Prüfung wieder versteckt', env.sheet('Import-Prüfung').isSheetHidden());
}

// ===========================================================================
t.section('Links und Datei-IDs');
{
  const env = mkEnv();
  const c = env.ctx;
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-09';
  const shapes = [
    'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=0',
    'https://docs.google.com/spreadsheets/u/1/d/' + id + '/edit?usp=sharing',
    'https://drive.google.com/file/d/' + id + '/view?usp=sharing',
    'https://drive.google.com/open?id=' + id,
    'https://drive.google.com/uc?export=download&id=' + id,
    '  ' + id + '  '
  ];
  t.eq('alle Linkformen und nackte ID', shapes.map(s => c.quParseFileId_(s)), shapes.map(() => id));
  t.throws('leer', () => c.quParseFileId_('  '), /Bitte füge den Link/);
  t.throws('Unsinn', () => c.quParseFileId_('hallo welt'), /Den Link kenne ich nicht/);
  t.throws('Veröffentlichungs-Link', () => c.quParseFileId_('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijk/pubhtml'), /Veröffentlichungs-Link/);
  t.eq('Dateiarten', ['application/vnd.google-apps.spreadsheet', H.MIME.MICROSOFT_EXCEL, H.MIME.MICROSOFT_EXCEL_LEGACY, 'application/pdf']
    .map(m => c.quKindOf_(m)), ['sheet', 'xlsx', 'xlsx', '']);
}

// ===========================================================================
t.section('importOpenSource / importSelectTab: Google Sheet');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  const shapes = ['https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit#gid=0', 'https://drive.google.com/file/d/' + SHEET_ID + '/view',
    'https://drive.google.com/open?id=' + SHEET_ID, SHEET_ID];
  const opened = shapes.map(s => env.uiCall('importOpenSource', s));
  t.ok('vier Formen öffnen dieselbe Datei', opened.every(o => o.sourceId === SHEET_ID && o.sourceName === 'Meine Liste' && o.kind === 'sheet'), opened);
  const o = opened[0];
  t.eq('Tabs mit Zeilen/Spalten', o.tabs.map(x => [x.name, x.rows, x.cols]),
    [['Tabellenblatt1', 11, 7], ['Nur Kopf', 1, 3], ['Leer', 0, 0], ['Checkliste', 5, 3]]);
  let d = c.importDraft_();
  t.eq('Entwurf nach Öffnen', [d.sourceId, d.sourceName, d.kind, d.tmpId, d.stage, d.mode, d.tab, d.sourceUrl],
    [SHEET_ID, 'Meine Liste', 'sheet', '', 'tab', 'neu', '', SHEET_ID.length ? 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit' : '']);
  t.ok('Entwurf: startedAt Text, Tabs gemerkt', /^\d{4}-\d{2}-\d{2}$/.test(d.startedAt) && d.tabs.length === 4);
  t.eq('keine Drive-Kopie für Google Sheets', env.driveCopies.length, 0);

  const res = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('nRows/nCols ohne leere Ränder', [res.nRows, res.nCols], [9, 7]);
  const q = srcValues(env);
  t.eq('Import-Quelle: Größe', [q.length, q[0].length], [9, 7]);
  t.eq('Kopfzeile in Import-Quelle', q[0], ERIC_HEADER);
  t.eq('Zahl als Anzeigetext', q[1][1], '4');
  t.eq('Text-URL mit gleichem Link: nichts angehängt', q[1][2], U_GLURAK);
  t.eq('Text "Cardmarket" mit Link: einmal angehängt', q[2][2], 'Cardmarket ' + U_TURTOK);
  t.eq('mehrere Abschnitte mit Links: beide angehängt', q[3][2], 'Gengar (CM) / PC ' + U_GENGAR + ' ' + U_PC);
  t.eq('Link steht schon im Text: nichts angehängt', q[4][2], 'siehe ' + U_GLURAK + ' dort');
  t.eq('zwei Abschnitte, derselbe Link: einmal', q[7][2], 'Link ' + U_TURTOK);
  t.eq('führende Null bleibt (Textformat)', q[6][1], '025');
  t.eq('leere Zeile in der Mitte bleibt', q[5], ['', '', '', '', '', '', '']);
  t.eq('SUMME-Zeile ist letzte Zeile', q[8][0], 'SUMME');
  t.ok('Import-Quelle als Text formatiert', env.sheet('Import-Quelle').getRange(2, 2).getNumberFormat() === '@');
  t.ok('sample: höchstens 25 Zeilen, Zellen höchstens 60 Zeichen', res.sample.length === 9 && res.sample.every(r => r.length === 7 && r.every(x => x.length <= 60)));
  t.ok('sample: lange URL gekürzt mit …', res.sample[1][2].length === 60 && /…$/.test(res.sample[1][2]));
  t.eq('guess für Erics Kopfzeile', res.guess, { headerRow: 1, firstRow: 2, cols: {
    name: 0, number: 1, set: 3, qty: -1, variant: -1, cond: -1, lang: -1, version: -1, cmLink: 2, tcgdexId: -1, price: 4, priceDate: 5, check: -1 } });
  t.eq('ohne Vorlagen: templates [] und suggested null', [res.templates, res.suggested], [[], null]);
  t.eq('cfg-Vorschlag aus guess', [res.cfg.form, res.cfg.headerRow, res.cfg.firstRow, res.cfg.lastRow, res.cfg.cols.cmLink, res.cfg.fixed.lang],
    ['liste', 1, 2, 0, 2, 'DE']);
  d = c.importDraft_();
  t.eq('Entwurf nach Tab: stage zuordnung', [d.stage, d.tab, d.tmpId], ['zuordnung', 'Tabellenblatt1', '']);

  // Vorschau mit Stub-Erkennung
  const pv = env.uiCall('importPreviewRows', res.cfg);
  t.eq('Vorschau: 8 Datensätze (Kopf übersprungen, leere Ränder weg)', pv.total, 8);
  t.eq('Vorschau: übersprungen (summe 1, leer 1)', pv.skippedCounts, { summe: 1, leer: 1, nichtAngehakt: 0 });
  t.eq('Vorschau: Zeilen mit srcRows und skip', pv.rows.map(r => [r.srcRows[0], r.skip]),
    [[2, null], [3, null], [4, null], [5, null], [6, 'leer'], [7, null], [8, null], [9, 'summe']]);
  t.eq('Vorschau: importable', pv.importable, 6);
  t.eq('Vorschau: Felder aus extractRow_', [pv.rows[0].fields.name, pv.rows[0].fields.cmUrl], ['Glurak', U_GLURAK]);
  t.ok('Vorschau merkt cfg im Entwurf', c.importDraft_().cfg && c.importDraft_().cfg.cols.name === 0);

  // Tab mit nur Kopfzeile
  const hk = env.uiCall('importSelectTab', 'Nur Kopf');
  t.eq('nur Kopfzeile: nRows 1, guess', [hk.nRows, hk.nCols, hk.guess.headerRow, hk.guess.firstRow, hk.guess.cols.name, hk.guess.cols.number, hk.guess.cols.set],
    [1, 3, 1, 2, 0, 1, 2]);
  t.ok('anderer Tab: cfg im Entwurf zurückgesetzt', c.importDraft_().cfg === null && c.importDraft_().tab === 'Nur Kopf');
  t.eq('nur Kopfzeile: keine Datensätze', c.parseSourceRecords_(hk.cfg).length, 0);
  const pv2 = env.uiCall('importPreviewRows', hk.cfg);
  t.eq('nur Kopfzeile: Vorschau leer', [pv2.rows.length, pv2.total], [0, 0]);

  t.throws('leerer Tab', () => c.importSelectTab('Leer'), /Der Tab „Leer“ ist leer/);
  t.throws('unbekannter Tab', () => c.importSelectTab('Gibtsnicht'), /Den Tab „Gibtsnicht“ gibt es/);
  t.throws('kein Tab', () => c.importSelectTab(''), /Bitte wähle einen Tab/);
  t.throws('PDF', () => c.importOpenSource(PDF_ID), /kein Google Sheet und keine \.xlsx-Datei/);
  t.throws('unbekannte Datei', () => c.importOpenSource('1Unbekanntabcdefghijklmnop'), /nicht gefunden/);
  // Verknüpfung (Drive-Shortcut) zeigt auf die Liste
  const SHORT = '1ShortcutAbcdefghijklmnopQR';
  const origGet = c.DriveApp.getFileById;
  c.DriveApp.getFileById = fid => fid === SHORT
    ? { getName: () => 'Verknüpfung', getMimeType: () => 'application/vnd.google-apps.shortcut', getTargetId: () => SHEET_ID }
    : origGet(fid);
  const sc = env.uiCall('importOpenSource', 'https://drive.google.com/file/d/' + SHORT + '/view');
  t.eq('Verknüpfung: Zieldatei geöffnet', [sc.sourceId, sc.sourceName, sc.kind], [SHEET_ID, 'Meine Liste', 'sheet']);
  c.DriveApp.getFileById = origGet;
  env.uiCall('importOpenSource', SHEET_ID);
  env.uiCall('importSelectTab', 'Tabellenblatt1');

  // Lauf aktiv -> kein neuer Import
  c.importSetRun_(3, 'commit');
  t.throws('läuft gerade ein Import: Öffnen verweigert', () => c.importOpenSource(SHEET_ID), /Gerade läuft schon ein Import/);
  c.importClearRun_();

  // Zurück in den Assistenten nach der Erkennung: Prüfung wird geleert
  c.reviewWriteAll_([{ fp: 'f1', srcRows: [2], values: {}, qty: 1, status: 'unklar' }]);
  d = c.importDraft_(); d.stage = 'pruefung'; c.importSaveDraft_(d);
  env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('nach Erkennung zurück zum Tab: Prüfung leer, stage zuordnung', [c.reviewRead_().length, c.importDraft_().stage], [0, 'zuordnung']);

  // Neue Quelle ersetzt den Entwurf und leert Prüfung/Quelle
  c.reviewWriteAll_([{ fp: 'f2', srcRows: [3], values: {}, qty: 1, status: 'unklar' }]);
  env.uiCall('importOpenSource', 'https://drive.google.com/file/d/' + XLSX2_ID + '/view');
  d = c.importDraft_();
  t.eq('neue Quelle ersetzt Entwurf', [d.sourceId, d.kind, d.stage, d.tab], [XLSX2_ID, 'xlsx', 'tab', '']);
  t.eq('neue Quelle: Prüfung und Import-Quelle geleert', [c.reviewRead_().length, env.values('Import-Quelle').length], [0, 0]);
  lockClean(env, 'Google Sheet');
}

// ===========================================================================
t.section('xlsx über Drive-API v3: temporäre Kopie');
{
  const env = mkEnv({ drive: 'v3' });
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  const o = env.uiCall('importOpenSource', 'https://drive.google.com/file/d/' + XLSX_ID + '/view?usp=drive_link');
  t.eq('xlsx geöffnet', [o.sourceId, o.sourceName, o.kind, o.tabs.map(x => x.name)], [XLSX_ID, 'Pokemon Ordner.xlsx', 'xlsx', ['Tabellenblatt1', 'Pokedex', 'Leer']]);
  t.eq('v3-Kopie: name + mimeType, ohne convert, mit supportsAllDrives', [env.driveCopies.length, J(env.driveCopies[0].resource), env.driveCopies[0].extra],
    [1, J({ name: 'Pokémon-Import (temporär) Pokemon Ordner.xlsx', mimeType: H.MIME.GOOGLE_SHEETS }), { supportsAllDrives: true }]);
  const tmp1 = env.driveCopies[0].to;
  let d = c.importDraft_();
  t.eq('Entwurf: tmpId, kind xlsx', [d.tmpId, d.kind, d.stage], [tmp1, 'xlsx', 'tab']);
  t.ok('Kopie noch nicht im Papierkorb', !env.driveFiles[tmp1].trashed);

  t.throws('leerer Tab (xlsx)', () => c.importSelectTab('Leer'), /ist leer/);
  t.ok('nach Fehler: Kopie bleibt für einen anderen Tab', !env.driveFiles[tmp1].trashed && c.importDraft_().tmpId === tmp1);

  const res = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.ok('Tab gelesen', res.nRows === 9 && srcValues(env)[2][2] === 'Cardmarket ' + U_TURTOK);
  t.ok('Kopie nach Tab-Auswahl im Papierkorb', env.driveFiles[tmp1].trashed === true);
  d = c.importDraft_();
  t.eq('Entwurf: tmpId leer, stage zuordnung', [d.tmpId, d.stage, d.tab], ['', 'zuordnung', 'Tabellenblatt1']);

  const again = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.ok('derselbe Tab noch einmal: aus Import-Quelle, keine neue Kopie', env.driveCopies.length === 1 && again.nRows === 9 && J(again.guess) === J(res.guess));

  const other = env.uiCall('importSelectTab', 'Pokedex');
  t.ok('anderer Tab: neue Kopie, danach im Papierkorb', env.driveCopies.length === 2 && env.driveFiles[env.driveCopies[1].to].trashed === true);
  t.eq('Pokedex geraten', [other.guess.cols.number, other.guess.cols.name, other.guess.cols.check, other.cfg.form], [0, 1, 2, 'checkliste']);
  t.eq('Entwurf nach anderem Tab', [c.importDraft_().tab, c.importDraft_().tmpId], ['Pokedex', '']);

  // Abbrechen vor der Tab-Auswahl: Kopie in den Papierkorb
  env.uiCall('importOpenSource', XLSX_ID);
  const tmp3 = env.driveCopies[2].to;
  t.ok('neue Kopie für neuen Entwurf', c.importDraft_().tmpId === tmp3 && !env.driveFiles[tmp3].trashed);
  const disc = env.uiCall('importDiscardDraft');
  t.ok('importDiscardDraft: Kopie im Papierkorb, Entwurf weg', disc.ok === true && disc.discarded === true && env.driveFiles[tmp3].trashed === true && c.importDraft_() === null);
  t.eq('importDiscardDraft: Import-Quelle leer', env.values('Import-Quelle').length, 0);
  t.eq('importDiscardDraft ohne Entwurf', env.uiCall('importDiscardDraft'), { ok: true, discarded: false });

  // Neue Quelle, während ein Entwurf mit Kopie offen ist: alte Kopie in den Papierkorb
  env.uiCall('importOpenSource', XLSX_ID);
  const tmp4 = c.importDraft_().tmpId;
  env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit');
  t.ok('neue Quelle: alte Kopie im Papierkorb', env.driveFiles[tmp4].trashed === true && c.importDraft_().sourceId === SHEET_ID && c.importDraft_().tmpId === '');
  env.uiCall('importOpenSource', XLSX_ID);
  const tmp5 = c.importDraft_().tmpId;
  env.uiCall('importOpenSource', XLSX_ID);
  t.ok('dieselbe xlsx noch einmal: alte Kopie weg, neue da', env.driveFiles[tmp5].trashed === true && c.importDraft_().tmpId !== tmp5 && !env.driveFiles[c.importDraft_().tmpId].trashed);
  lockClean(env, 'xlsx v3');
}

// ===========================================================================
t.section('xlsx über Drive-API v2 und ohne Drive-Dienst');
{
  const env = mkEnv({ drive: 'v2' });
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  const o = env.uiCall('importOpenSource', 'https://drive.google.com/open?id=' + XLSX2_ID);
  t.eq('v2-Kopie: title + mimeType, convert true, supportsAllDrives', [o.kind, J(env.driveCopies[0].resource), J(env.driveCopies[0].extra)],
    ['xlsx', J({ title: 'Pokémon-Import (temporär) Zweite.xlsx', mimeType: H.MIME.GOOGLE_SHEETS }), J({ convert: true, supportsAllDrives: true })]);
  const r = env.uiCall('importSelectTab', 'Daten');
  t.ok('v2: Tab gelesen, Kopie im Papierkorb', r.nRows === 2 && env.driveFiles[env.driveCopies[0].to].trashed === true);
  t.eq('importState: driveService v2', [env.uiCall('importState').driveService, env.uiCall('importState').driveVersion], [true, 'v2']);

  const env2 = mkEnv({ drive: false });
  const c2 = env2.ctx;
  c2.setupAll_();
  addSources(env2);
  t.throws('ohne Drive-Dienst: genaue Meldung', () => c2.importOpenSource(XLSX_ID),
    /^Für \.xlsx-Dateien bitte im Apps-Script-Editor links unter „Dienste“ die „Drive API“ hinzufügen\.$/);
  t.ok('ohne Drive-Dienst: kein Entwurf angelegt', c2.importDraft_() === null);
  const st = env2.uiCall('importState');
  t.eq('importState: driveService false', [st.driveService, st.driveVersion], [false, '']);
  const gs = env2.uiCall('importOpenSource', SHEET_ID);
  t.ok('ohne Drive-Dienst: Google Sheet geht trotzdem', gs.kind === 'sheet' && c2.importDraft_().stage === 'tab');
  lockClean(env2, 'ohne Drive');
}

// ===========================================================================
t.section('HYPERLINK-Formel und Rich-Text ohne Text');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  const id = '1FormelAbcdefghijklmnopQRST';
  env.addSource({ id, name: 'Formeln', mime: 'sheet', tabs: { T: { values: [['Name', 'Link'], ['Glurak', ''], ['Turtok', 7]], display: [['Name', 'Link'], ['Glurak', 'zur Karte'], ['Turtok', '7']] } } });
  env.sources[id].getSheetByName('T').formulas['2,2'] = '=HYPERLINK("' + U_GLURAK + '";"zur Karte")';
  env.uiCall('importOpenSource', id);
  const r = env.uiCall('importSelectTab', 'T');
  t.eq('HYPERLINK-Formel: Link angehängt', srcValues(env)[1][1], 'zur Karte ' + U_GLURAK);
  t.eq('Zahl ohne Rich-Text', srcValues(env)[2][1], '7');
  t.eq('cmLink nach Inhalt (Kopf "Link" + cardmarket)', r.guess.cols.cmLink, 1);
}

// ===========================================================================
t.section('guessLayout_');
{
  const env = mkEnv();
  const c = env.ctx;
  const G = (rows) => c.guessLayout_(rows);
  const cols = (g) => Object.keys(g.cols).filter(k => g.cols[k] >= 0).reduce((o, k) => { o[k] = g.cols[k]; return o; }, {});

  const eric = G([ERIC_HEADER, ['Glurak', '4', U_GLURAK, 'Grundset', '1,50 €', '01.10.2026', '']]);
  t.eq('Erics Kopfzeile', cols(eric), { name: 0, number: 1, set: 3, cmLink: 2, price: 4, priceDate: 5 });
  t.ok('"Spalte 1" bleibt frei', Object.values(eric.cols).indexOf(6) < 0);

  const data = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const cmContent = G([['Name', 'Nr', 'Info']].concat(data(10, i => ['K' + i, String(i + 1), i < 4 ? CM + 'Set/K-' + i : 'egal'])));
  t.eq('cmLink nach Inhalt (40 %)', cmContent.cols.cmLink, 2);
  const cmLow = G([['Name', 'Nr', 'Info']].concat(data(10, i => ['K' + i, String(i + 1), i < 2 ? CM + 'Set/K-' + i : 'egal'])));
  t.eq('unter 30 %: kein cmLink', cmLow.cols.cmLink, -1);
  const cmOther = G([['Name', 'Link', 'Notiz']].concat(data(10, i => ['K' + i, U_PC, CM + 'Set/K-' + i])));
  t.eq('Kopf "Link" ohne cardmarket, Inhalt in "Notiz": Inhalt gewinnt', cmOther.cols.cmLink, 2);
  const cmName = G([['Karte', 'Nr']].concat(data(5, i => [CM + 'Set/K-' + i, String(i)])));
  t.eq('Spalte "Karte" voller Links: cmLink statt name', [cmName.cols.cmLink, cmName.cols.name], [0, -1]);

  t.eq('"Datum" und "Datum Preis-Daten": genauere gewinnt', G([['Datum', 'Name', 'Datum Preis-Daten'], ['01.01.2026', 'A', '02.01.2026']]).cols.priceDate, 2);
  t.eq('"Datum Preis-Daten" vor "Datum" (andere Reihenfolge)', G([['Datum Preis-Daten', 'Name', 'Datum'], ['x', 'A', 'y']]).cols.priceDate, 0);
  t.eq('"Nr" und "Setnummer": Setnummer', G([['Nr', 'Name', 'Setnummer'], ['1', 'A', '25']]).cols.number, 2);
  t.eq('"Setnummer" und "Nr" (andere Reihenfolge)', G([['Setnummer', 'Name', 'Nr'], ['25', 'A', '1']]).cols.number, 0);
  const setNr = G([['Set Nr', 'Name', 'Set'], ['25', 'A', 'Base']]);
  t.eq('"Set Nr" ist Nummer, "Set" ist Set', [setNr.cols.number, setNr.cols.set], [0, 2]);
  const misc = G([['Kartenzustand', 'Anzahl Karten', 'Preistrend Datum', 'Kaufdatum', 'Card #', 'Karten-ID', 'Pokémon', 'Vorhanden?', 'Sprache der Karte', 'Preis in €'],
    ['NM', '2', '01.01.2026', '01.01.2020', '4', 'base1-4', 'Glurak', 'x', 'DE', '3']]);
  t.eq('unscharfe Überschriften', cols(misc), { name: 6, number: 4, qty: 1, cond: 0, lang: 8, tcgdexId: 5, price: 9, priceDate: 2, check: 7 });
  t.eq('"ID" mit tcgdex-IDs', G([['ID', 'Name'], ['swsh3-136', 'A'], ['sv03.5-025', 'B']]).cols.tcgdexId, 0);
  t.eq('"ID" mit laufenden Nummern: keine tcgdex-ID', G([['ID', 'Name'], ['1', 'A'], ['2', 'B']]).cols.tcgdexId, -1);
  const eng = G([['Card Name', 'Number', 'Expansion', 'Qty', 'Condition', 'Language', 'Price', 'Variant', 'Version', 'URL']]);
  t.eq('englische Überschriften', cols(eng), { name: 0, number: 1, set: 2, qty: 3, variant: 7, cond: 4, lang: 5, version: 8, cmLink: 9, price: 6 });
  t.eq('zwei "Name"-Spalten: die linke', G([['Name', 'Name', 'Nr']]).cols.name, 0);
  const poke = G([['Pokémon-Nr.', 'Pokémon', 'Pokémon Zustand', 'Pokémon (deutsch)']]);
  t.eq('"Pokémon-Nr." ist Nummer, "Pokémon Zustand" Zustand, "Pokémon" Name', [poke.cols.number, poke.cols.name, poke.cols.cond], [0, 1, 2]);
  t.eq('"Pokémon (deutsch)" allein ist Name', G([['Pokémon (deutsch)', 'Nr']]).cols.name, 0);

  const titled = G([['Meine Sammlung', '', ''], ['', '', ''], ['Name', 'Nummer', 'Set'], ['', '', ''], ['Glurak', '4', 'Base']]);
  t.eq('Titelzeile, Kopf in Zeile 3, Leerzeile davor', [titled.headerRow, titled.firstRow, titled.cols.name], [3, 5, 0]);
  const sub = G([['Pokémon-Ordner von mir', 'Stand Oktober'], ['Name', 'Nummer'], ['Glurak', '4']]);
  const sub2 = G([['Meine Karten', 'Stand Oktober'], ['Name', 'Nummer'], ['Glurak', '4']]);
  t.eq('Titel ohne Treffer: Kopf in Zeile 2', [sub2.headerRow, sub2.firstRow], [2, 3]);
  t.eq('Titel mit einem Treffer (Pokémon): Kopf in Zeile 2', [sub.headerRow, sub.firstRow, sub.cols.number], [2, 3, 1]);
  const custom = G([['Pokemonkarte', 'Kürzel'], ['Glurak', 'BS4'], ['Turtok Holo', 'Reverse Holo']]);
  t.eq('eigene Überschriften ohne bekannte Wörter: erste Zeile bleibt Kopf', custom.headerRow, 1);
  const numeric = G([['1', '2', '3'], ['4', '5,50 €', '01.10.2026']]);
  t.eq('nur Zahlen: keine Kopfzeile', [numeric.headerRow, numeric.firstRow], [0, 1]);
  t.eq('leere Werte', J(G([])), J({ headerRow: 0, firstRow: 1, cols: c.quEmptyCols_() }));
  t.eq('nur Kopfzeile', [G([['Name', 'Nr']]).headerRow, G([['Name', 'Nr']]).firstRow], [1, 2]);
}

// ===========================================================================
t.section('cfg normalisieren');
{
  const env = mkEnv();
  const c = env.ctx;
  const n = c.quNormCfg_({ form: 'quatsch', headerRow: '2', cols: { name: 'C', number: '1', set: -5, qty: null }, fixed: { lang: 'Englisch', cond: 'nm', variant: 'holo', version: '  Snow  flake ' },
    extras: [{ col: 4, name: ' Notiz ', show: true }, { col: 5, name: 'notiz' }, { col: -1, name: 'X' }, { col: 'G', name: 'Lagerort', show: 'true' }, { cell: [1, 0], name: 'Fach' }] });
  t.eq('form, Zeilen', [n.form, n.headerRow, n.firstRow, n.lastRow], ['liste', 2, 3, 0]);
  t.eq('Spalten (Buchstaben/Text/ungültig)', [n.cols.name, n.cols.number, n.cols.set, n.cols.qty, n.cols.check], [2, 1, -1, -1, -1]);
  t.eq('fixed normalisiert', n.fixed, { lang: 'EN', cond: 'NM', variant: 'holo', version: 'Snow flake' });
  t.eq('extras ohne Dubletten/ungültige', n.extras, [{ col: 4, name: 'Notiz', show: true }, { col: 6, name: 'Lagerort', show: true }, { col: -1, name: 'Fach', show: false, cell: [1, 0] }]);
  t.eq('Raster-Standard', n.grid, { startRow: 3, startCol: 0, blockRows: 2, blockCols: 1, gapRows: 0, gapCols: 0, perRow: 0, cells: { name: [0, 0], number: [1, 0] } });
  const e = c.quNormCfg_(null);
  t.eq('leere cfg', [e.form, e.headerRow, e.firstRow, e.fixed.lang, e.fixed.cond], ['liste', 1, 2, '', '']);
  const z = c.quNormCfg_({ headerRow: 0, fixed: { cond: 'super' } });
  t.eq('ohne Kopfzeile: erste Zeile 1, ungültiger Zustand leer', [z.headerRow, z.firstRow, z.fixed.cond], [0, 1, '']);
  const dc = c.quDefaultCfg_({ headerRow: 1, firstRow: 2, cols: Object.assign(c.quEmptyCols_(), { name: 1, check: 2 }) });
  t.eq('Standard aus guess mit Häkchen: checkliste', [dc.form, dc.fixed.lang, dc.grid.startRow], ['checkliste', 'DE', 2]);
}

// ===========================================================================
t.section('parseSourceRecords_: Liste und Checkliste');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  c.importOpenSource(SHEET_ID);
  c.importSelectTab('Tabellenblatt1');
  const base = c.quDefaultCfg_(c.guessLayout_(srcValues(env)));
  base.extras = [{ col: 6, name: 'Spalte 1', show: false }];
  const recs = c.parseSourceRecords_(base);
  t.eq('Liste: 8 Datensätze ab Zeile 2', recs.map(r => r.srcRows[0]), [2, 3, 4, 5, 6, 7, 8, 9]);
  t.ok('raw hat alle Felder, nicht zugeordnete leer', J(Object.keys(recs[0].raw)) === J(env.run('QU_FIELDS')) && recs[0].raw.qty === '' && recs[0].raw.check === '');
  t.eq('raw-Werte', [recs[0].raw.name, recs[0].raw.number, recs[0].raw.set, recs[0].raw.price, recs[0].raw.priceDate],
    ['Glurak', '4', 'Grundset', '350,00 €', '01.10.2026']);
  t.eq('extrasRaw', recs[0].extrasRaw, { 'Spalte 1': '' });
  t.eq('first: erste nicht leere zugeordnete Zelle', [recs[0].first, recs[4].first, recs[7].first], ['Glurak', '', 'SUMME']);
  const lim = c.parseSourceRecords_(Object.assign({}, base, { firstRow: 4, lastRow: 6 }));
  t.eq('firstRow/lastRow', lim.map(r => r.srcRows[0]), [4, 5, 6]);
  const big = c.parseSourceRecords_(Object.assign({}, base, { lastRow: 500 }));
  t.eq('lastRow hinter Datenende', big.length, 8);
  const hdr = c.parseSourceRecords_(Object.assign({}, base, { headerRow: 3, firstRow: 2 }));
  t.ok('Kopfzeile wird nie zum Datensatz', hdr.every(r => r.srcRows[0] !== 3) && hdr.length === 7);

  c.importSelectTab('Checkliste');
  const g = c.guessLayout_(srcValues(env));
  const cfg = c.quDefaultCfg_(g);
  t.eq('Checkliste geraten', [cfg.form, cfg.cols.number, cfg.cols.name, cfg.cols.check], ['checkliste', 0, 1, 2]);
  const cr = c.parseSourceRecords_(cfg);
  t.eq('Checkliste: raw.check', cr.map(r => [r.raw.name, r.raw.check]), [['Bisasam', 'WAHR'], ['Bisaknosp', 'FALSCH'], ['Bisaflor', 'WAHR'], ['Glumanda', '']]);
  const pv = c.importPreviewRows(cfg);
  t.eq('Checkliste: nichtAngehakt gezählt', [pv.total, pv.skippedCounts.nichtAngehakt], [4, 2]);
  t.eq('Vorschau ohne geladene Quelle', (() => { c.importDiscardDraft(); try { c.importPreviewRows(cfg); return 'kein Fehler'; } catch (e) { return e.message; } })(),
    'Es sind noch keine Daten geladen. Bitte wähle zuerst einen Tab.');
}

// ===========================================================================
t.section('parseSourceRecords_: Raster');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  const id = '1RasterAbcdefghijklmnopQRSTU';
  // Blöcke 2x1 (Name, Nummer), Abstand 1 Zeile / 1 Spalte, Start Zeile 2 Spalte A
  const W = 15;
  const rows = Array.from({ length: 20 }, () => Array(W).fill(''));
  const put = (r, col, v) => { rows[r - 1][col] = v; };
  put(1, 0, 'Ordner Seite 1');
  put(2, 0, 'Bisasam'); put(3, 0, '1'); put(2, 2, 'Glumanda'); put(3, 2, '4'); put(2, 4, 'Schiggy'); put(3, 4, '7');
  // drei leere Blöcke (G, I, K), dann Mauzi in M: ohne perRow wird M nicht mehr gelesen
  put(2, 12, 'Mauzi'); put(3, 12, '52');
  put(5, 0, 'Pikachu'); put(6, 0, '25');
  put(5, 1, 'Notiz neben dem Block'); // Lücke rechts neben Pikachu
  put(5, 3, 'Notiz in leerem Block'); // Block C5 ist leer (kein Name, keine Nummer): kein Datensatz
  put(5, 4, ''); put(6, 4, '26'); // nur Nummer: zählt
  put(6, 6, ''); // leer
  // Zeilen 8, 11, 14: drei leere Blockzeilen, Mew in Zeile 17 wird nicht mehr gelesen
  put(17, 0, 'Mew'); put(18, 0, '151');
  env.addSource({ id, name: 'Raster', mime: 'sheet', tabs: { Seite: rows } });
  c.importOpenSource(id);
  c.importSelectTab('Seite');
  const cfg = { form: 'raster', headerRow: 0, grid: { startRow: 2, startCol: 'A', blockRows: 2, blockCols: 1, gapRows: 1, gapCols: 1, perRow: 0,
    cells: { name: [0, 0], number: [1, 0] } }, extras: [{ name: 'Daneben', cell: [0, 1] }] };
  const recs = c.parseSourceRecords_(cfg);
  t.eq('Raster: Blöcke in Reihenfolge, Lücken übersprungen, Stopp-Regeln', recs.map(r => [r.srcRows[0], r.raw.name, r.raw.number]),
    [['r2c1', 'Bisasam', '1'], ['r2c3', 'Glumanda', '4'], ['r2c5', 'Schiggy', '7'], ['r5c1', 'Pikachu', '25'], ['r5c5', '', '26']]);
  t.eq('Raster: Zusatzfeld per Zelle relativ zum Block', recs.map(r => r.extrasRaw.Daneben), ['', '', '', 'Notiz neben dem Block', '']);
  t.ok('Raster: raw hat alle Felder', J(Object.keys(recs[0].raw)) === J(env.run('QU_FIELDS')) && recs[0].raw.check === '');
  const per7 = c.parseSourceRecords_(Object.assign({}, cfg, { grid: Object.assign({}, cfg.grid, { perRow: 7 }) }));
  t.ok('perRow 7: Mauzi (7. Block) wird gelesen', per7.some(r => r.raw.name === 'Mauzi' && r.srcRows[0] === 'r2c13'), per7.map(r => r.raw.name));
  const per2 = c.parseSourceRecords_(Object.assign({}, cfg, { grid: Object.assign({}, cfg.grid, { perRow: 2 }) }));
  t.eq('perRow 2: nur zwei Blöcke je Reihe', per2.map(r => r.raw.name), ['Bisasam', 'Glumanda', 'Pikachu']);
  const toEnd = c.parseSourceRecords_(Object.assign({}, cfg, { grid: Object.assign({}, cfg.grid, { startRow: 11 }) }));
  t.eq('Start nach den leeren Reihen: Mew wird gelesen', toEnd.map(r => r.raw.name), ['Mew']);
  const last = c.parseSourceRecords_(Object.assign({}, cfg, { lastRow: 4 }));
  t.eq('lastRow begrenzt die Blockreihen', last.map(r => r.raw.name), ['Bisasam', 'Glumanda', 'Schiggy']);
  const pv = env.uiCall('importPreviewRows', cfg);
  t.eq('Raster-Vorschau', [pv.total, pv.rows[0].srcRows[0], pv.rows[4].fields.number], [5, 'r2c1', '26']);
}

// ===========================================================================
t.section('Vorlagen');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  c.importOpenSource(SHEET_ID);
  const first = c.importSelectTab('Tabellenblatt1');
  const cfg = first.cfg;
  cfg.extras = [{ col: 6, name: 'Notiz', show: true }];
  const s1 = env.uiCall('importSaveTemplate', '  Ordner  Liste ', cfg, 'abgleich');
  t.eq('gespeichert: Name, Modus, Signatur', [s1.name, s1.mode, s1.signature],
    ['Ordner Liste', 'abgleich', 'karte name|setnummer|cardmarket|set|30 tage preistrend|datum preis-daten|spalte 1']);
  const row = env.values('Import-Vorlagen')[1];
  t.ok('Blatt: Konfiguration als JSON mit Modus, Zuletzt benutzt als Text',
    row[0] === 'Ordner Liste' && JSON.parse(row[1]).mode === 'abgleich' && JSON.parse(row[1]).cols.cmLink === 2 &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row[3]), row);
  t.eq('Entwurf: Vorlage und Modus gemerkt', [c.importDraft_().templateName, c.importDraft_().mode], ['Ordner Liste', 'abgleich']);
  const list = env.uiCall('importListTemplates');
  t.eq('importListTemplates', list.map(x => [x.name, x.mode, x.modeLabel, x.cfg.extras[0].name, x.signature.split('|').length]),
    [['Ordner Liste', 'abgleich', 'Mit Quelle abgleichen', 'Notiz', 7]]);
  env.uiCall('importSaveTemplate', 'ordner liste', cfg, 'alle');
  t.eq('gleicher Name (anders geschrieben): ersetzt, keine Dublette', env.uiCall('importListTemplates').map(x => [x.name, x.mode]), [['ordner liste', 'alle']]);
  t.throws('ohne Namen', () => c.importSaveTemplate('  ', cfg, 'neu'), /Bitte gib der Vorlage einen Namen/);

  // passende Vorlage beim nächsten Tab-Lesen
  const again = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('passende Vorlage vorgeschlagen', [again.templates.map(x => [x.name, x.matches, x.mode]), again.suggested],
    [[['ordner liste', true, 'alle']], 'ordner liste']);
  t.eq('cfg kommt aus der Vorlage', again.cfg.extras, [{ col: 6, name: 'Notiz', show: true }]);

  // zweite passende Vorlage, die ältere wird nicht vorgeschlagen
  env.uiCall('importSaveTemplate', 'Zweite', cfg, 'neu');
  env.sheet('Import-Vorlagen').getRange(2, 4).setValue('2026-01-01 10:00');
  const two = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('zwei passende: zuletzt benutzte zuerst und vorgeschlagen', [two.templates.map(x => x.name), two.suggested], [['Zweite', 'ordner liste'], 'Zweite']);
  t.eq('importState.templates [{name, mode}]', env.uiCall('importState').templates, [{ name: 'Zweite', mode: 'neu' }, { name: 'ordner liste', mode: 'alle' }]);

  // anderer Tab: keine passt
  const ck = env.uiCall('importSelectTab', 'Checkliste');
  t.eq('andere Kopfzeile: keine passt', [ck.templates.every(x => !x.matches), ck.suggested], [true, null]);
  // Vorlage mit Kopfzeile 0: Signatur aus der ersten nicht leeren Zeile
  const s0 = env.uiCall('importSaveTemplate', 'Ohne Kopf', Object.assign({}, ck.cfg, { headerRow: 0 }), 'neu');
  t.eq('Kopfzeile 0: erste Zeile als Signatur', s0.signature, 'nr|pokémon|vorhanden');
  // Speichern ohne geladene Quelle behält die alte Signatur
  c.importDiscardDraft();
  const keep = env.uiCall('importSaveTemplate', 'Zweite', cfg, 'abgleich');
  t.eq('ohne Quelle: alte Signatur bleibt', keep.signature.split('|')[0], 'karte name');

  t.eq('drei Vorlagen', env.uiCall('importListTemplates').map(x => x.name).sort(), ['Ohne Kopf', 'Zweite', 'ordner liste']);
  lockClean(env, 'Vorlagen');
}

// ===========================================================================
t.section('importState');
{
  const env = mkEnv();
  const c = env.ctx;
  // ohne Einrichtung, ohne Import-Blätter, ohne importList
  const s0 = env.uiCall('importState');
  t.eq('ohne Blätter und Teile', [s0.draft, s0.imports, s0.busy, s0.driveService, s0.templates, s0.needsSetup], [null, [], null, true, [], true]);
  c.setupAll_();
  t.eq('nach Einrichtung: needsSetup false', env.uiCall('importState').needsSetup, false);
  env.ctx.importList = () => [{ nr: 1, status: 'aktiv' }];
  t.eq('importList wird benutzt', env.uiCall('importState').imports, [{ nr: 1, status: 'aktiv' }]);
  env.ctx.importList = () => { throw new Error('kaputt'); };
  t.eq('importList wirft: imports []', env.uiCall('importState').imports, []);
  delete env.ctx.importList;
  c.importSetRun_(4, 'undo');
  t.eq('busy', env.uiCall('importState').busy, { nr: 4, phase: 'undo' });
  c.importClearRun_();
  addSources(env);
  c.importOpenSource(SHEET_ID);
  c.importSelectTab('Tabellenblatt1');
  const s = env.uiCall('importState');
  t.ok('Entwurf im Zustand (ohne große Teile)', s.draft && s.draft.stage === 'zuordnung' && s.draft.tab === 'Tabellenblatt1' &&
    s.draft.modeLabel === 'Nur Neues' && Array.isArray(s.draft.tabs), s.draft);
  // Import-Vorlagen fehlt: kein Fehler
  env.ss.deleteSheet(env.sheet('Import-Vorlagen'));
  t.eq('fehlendes Vorlagen-Blatt: templates []', env.uiCall('importState').templates, []);
  t.eq('fehlendes Vorlagen-Blatt: importListTemplates []', env.uiCall('importListTemplates'), []);
  env.uiCall('importSaveTemplate', 'Neu', null, 'neu');
  t.ok('Speichern legt Vorlagen-Blatt wieder an (versteckt)', env.sheet('Import-Vorlagen') && env.sheet('Import-Vorlagen').isSheetHidden());
  // kaputter Entwurf
  env.props.IMPORT_DRAFT = '{kaputt';
  t.eq('kaputter Entwurf: draft null', env.uiCall('importState').draft, null);
  lockClean(env, 'importState');
}

// ===========================================================================
t.section('Sperre belegt');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setupAll_();
  addSources(env);
  env.lock.busy = true;
  t.throws('importOpenSource bei belegter Sperre: deutsche Meldung', () => c.importOpenSource(XLSX_ID), /gerade beschäftigt/);
  t.ok('Kopie trotzdem im Papierkorb', env.driveCopies.length === 1 && env.driveFiles[env.driveCopies[0].to].trashed === true);
  t.ok('kein Entwurf', c.importDraft_() === null);
  env.lock.busy = false;
}

// ===========================================================================
// Riesiger benutzter Bereich (.xlsx mit Kästchen bis Zeile 1048576): nur bis zur letzten echten Zeile lesen
{
  const env = mkEnv();
  const c = env.ctx;
  const MAXR = 1048576, W = 6, DATA = 1328;
  let cellsRead = 0, maxBlock = 0;
  const cell = (r, j) => {
    if (j === W) return r === 1 ? 'Vorhanden' : (r <= DATA && r % 2 === 0); // Kästchen bis ganz unten
    if (r === 1) return 'Spalte ' + j;
    if (r <= DATA) return j === 1 ? 'Pokémon ' + r : (j === 2 ? r : '');
    return '';
  };
  const big = {
    getName: () => 'Pokedex', isSheetHidden: () => false,
    getLastRow: () => MAXR, getLastColumn: () => W,
    getDataRange() { throw new Error('getDataRange darf bei großen Tabs nicht benutzt werden'); },
    getRange(r0, c0, n, w) {
      cellsRead += n * w; maxBlock = Math.max(maxBlock, n * w);
      const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => f(cell(r0 + i, c0 + j))));
      return {
        getValues: () => grid(v => v),
        getDisplayValues: () => grid(v => v === true ? 'TRUE' : v === false ? 'FALSE' : String(v)),
        getRichTextValues: () => grid(() => null),
        getFormulas: () => grid(() => '')
      };
    }
  };
  const ext = c.quUsedExtent_(big);
  t.eq('großer Tab: echte Zeilen und Spalten', J(ext), J({ rows: DATA, cols: W }));
  t.ok('großer Tab: nicht bis Zeile 1048576 gelesen', cellsRead < 200000);
  t.ok('großer Tab: Lesestücke klein', maxBlock <= 100000);
  const tabs = c.quTabsOf_({ getSheets: () => [big] });
  t.eq('Tab-Liste zeigt echte Zeilenzahl', J([tabs[0].rows, tabs[0].cols]), J([DATA, W]));
  cellsRead = 0;
  const vals = c.quReadTab_(big);
  t.eq('quReadTab_: Zeilen bis zur letzten echten', vals.length, DATA);
  t.eq('quReadTab_: Kästchenspalte bleibt', vals[1][W - 1], 'TRUE');
  t.ok('quReadTab_: wenig gelesen', cellsRead < 200000);
  const small = c.quUsedExtent_({ getLastRow: () => 10, getLastColumn: () => 3 });
  t.eq('kleiner Tab: wie gemeldet', J(small), J({ rows: 10, cols: 3 }));
  t.eq('leerer Tab', J(c.quUsedExtent_({ getLastRow: () => 0, getLastColumn: () => 0 })), J({ rows: 0, cols: 0 }));
}

// ===========================================================================
// Info: Zusammenspiel mit dem echten Teil „Erkennung“, falls er schon lädt (zählt nicht als Test)
{
  const p = path.join(__dirname, '..', 'parts', '20_erkennung.gs');
  if (fs.existsSync(p)) {
    try {
      const env = H.createEnv({ files: FILES.concat(['../parts/20_erkennung.gs']) });
      const c = env.ctx;
      c.setupAll_();
      addSources(env);
      c.importOpenSource(SHEET_ID);
      const r = c.importSelectTab('Tabellenblatt1');
      const pv = c.importPreviewRows(r.cfg);
      console.log('info  mit echtem 20_erkennung.gs: total', pv.total, 'skipped', J(pv.skippedCounts),
        'erste Zeile', J([pv.rows[0].fields.nameClean, pv.rows[0].fields.cmUrl]), 'Gengar', J([pv.rows[2].fields.nameClean, pv.rows[2].fields.variant]));
    } catch (e) {
      console.log('info  20_erkennung.gs lädt noch nicht sauber:', e.message);
    }
  }
}

t.done();
