'use strict';
/**
 * Tests für Teil „Erkennung“ (parts/20_erkennung.gs): Begriffe, Felder, Fingerabdruck, Set-Zuordnung,
 * Cardmarket-Links, Set + Nummer, Erkennungsstufen, Schritte, Prüfliste, Antworten, Set-Vorbelegung.
 * Nur erfundene Testdaten (Layout wie eine Sammlungsliste mit Name | Setnummer | Cardmarket | Set | Preis | Datum).
 *
 *   node test_import_erkennung.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./harness2');

const PARTS = path.join(__dirname, '..', 'parts');
const t = H.runner('import-erkennung');

// ---------------------------------------------------------------------------
// tcgdex-Attrappe
// ---------------------------------------------------------------------------

// [id, englischer Name, deutscher Name | null, Karten offiziell]
const SETS = [
  ['base1', 'Base Set', 'Grundset', 102],
  ['base3', 'Fossil', 'Fossil', 62],
  ['swsh3', 'Darkness Ablaze', 'Flammende Finsternis', 189],
  ['ex10', 'Unseen Forces', null, 115],
  ['ex11', 'Delta Species', null, 113],
  ['dp1', 'Diamond & Pearl', 'Diamant & Perl', 130],
  ['dpp', 'DP Black Star Promos', 'DP Black Star Promos', 56],
  ['pl3', 'Supreme Victors', null, 147],
  ['hgss1', 'HeartGold & SoulSilver', 'HeartGold & SoulSilver', 123],
  ['hgss2', 'Unleashed', 'Entfesselt', 95],
  ['hgssp', 'HGSS Black Star Promos', null, 25],
  ['sv03.5', '151', 'Karmesin & Purpur: 151', 165],
  ['mep', 'MEP Black Star Promos', null, 100],
  ['swshp', 'SWSH Black Star Promos', 'SWSH Black Star Promos', 300],
  ['swsh10', 'Astral Radiance', 'Astralglanz', 189],
  ['xx1', 'Test Doppel', null, 10],
  ['old9', 'Old Set', null, 50]
];

// [id, localId, englischer Name, deutscher Name | null (keine de-Daten), Extras für die Kartendetails]
const CARDS = [
  ['base1-4', '4', 'Charizard', 'Glurak', { variants: { holo: true, normal: false, reverse: false, firstEdition: true } }],
  ['base3-5', '5', 'Gengar', 'Gengar', { variants: { holo: true, normal: true, reverse: true, firstEdition: true } }],
  ['swsh3-025', '025', 'Charizard', 'Glurak', {}],
  ['swsh3-136', '136', 'Charizard', 'Glurak', {}],
  ['ex10-X', 'X', 'Unown', null, {}],
  ['ex11-62', '62', 'Ditto', null, {}],
  ['dp1-16', '16', 'Pachirisu', 'Pachirisu', {}],
  ['dpp-DP12', 'DP12', 'Riolu', null, {}],
  ['dpp-DP16', 'DP16', 'Pikachu', null, {}],
  ['pl3-148', '148', 'Articuno', null, {}],
  ['hgss1-78', '78', 'Pikachu', 'Pikachu', {}],
  ['hgss2-88', '88', 'Tyranitar', 'Despotar', {}],
  ['hgssp-HGSS01', 'HGSS01', 'Ho-Oh', null, {}],
  ['sv03.5-132', '132', 'Ditto', 'Ditto', {}],
  ['mep-091', '091', 'Pikachu', null, {}],
  ['mep-099', '099', 'Mega Charizard X ex', null, {}],
  ['swshp-SWSH001', 'SWSH001', 'Grookey', 'Chimpep', {}],
  ['swsh10-001', '001', 'Alpha', null, {}],
  ['swsh10-TG01', 'TG01', 'Beta', null, {}],
  ['xx1-A1', 'A1', 'Foo', null, {}],
  ['xx1-B1', 'B1', 'Bar', null, {}]
];

const ABBR = {
  'sv03.5': { abbreviation: { official: 'MEW', normal: 'MEW' } },
  hgss2: { abbreviation: 'UL' },
  mep: { tcgOnline: 'MEP' },
  swsh3: { abbreviation: { official: 'DAA' } }
};

function setInfo(id) {
  return SETS.find(s => s[0] === id);
}

function buildDb() {
  const db = H.defaultDb();
  const de = [], en = [];
  SETS.forEach(([id, nameEn, nameDe, off]) => {
    en.push({ id, name: nameEn, cardCount: { official: off, total: off } });
    if (nameDe) de.push({ id, name: nameDe, cardCount: { official: off, total: off } });
  });
  db['en/sets'] = en;
  db['de/sets'] = de;
  const lists = {};
  CARDS.forEach(([id, lid, nameEn, nameDe, extra]) => {
    const setId = id.slice(0, id.lastIndexOf('-'));
    const s = setInfo(setId);
    const mk = (lang, name, setName) => H.card(id, lang, Object.assign({
      localId: lid, name,
      set: { id: setId, name: setName, cardCount: { official: s[3], total: s[3] } }
    }, extra));
    db['en/cards/' + id] = mk('en', nameEn, s[1]);
    (lists['en/' + setId] = lists['en/' + setId] || []).push({ id, localId: lid, name: nameEn, image: 'https://assets.tcgdex.net/en/x/' + id });
    if (nameDe) {
      db['de/cards/' + id] = mk('de', nameDe, s[2] || s[1]);
      (lists['de/' + setId] = lists['de/' + setId] || []).push({ id, localId: lid, name: nameDe });
    } else {
      delete db['de/cards/' + id];
    }
  });
  // alte de-Karte ohne Bild (Bild kommt aus en)
  delete db['de/cards/base1-4'].image;
  SETS.forEach(([id, nameEn, nameDe, off]) => {
    const full = (lang, name) => Object.assign({ id, name, releaseDate: '20' + String(10 + SETS.findIndex(s => s[0] === id)) + '-01-01',
      cardCount: { official: off, total: off }, cards: lists[lang + '/' + id] || [] }, lang === 'en' ? (ABBR[id] || {}) : {});
    if (lists['en/' + id] || id === 'old9') db['en/sets/' + id] = full('en', nameEn);
    else db['en/sets/' + id] = full('en', nameEn);
    if (nameDe && lists['de/' + id]) db['de/sets/' + id] = full('de', nameDe);
    else delete db['de/sets/' + id];
  });
  db['en/sets/old9'].cards = [{ id: 'old9-007', localId: '007', name: 'Mewtwo' }];
  // Namenssuche
  db['de/cards?name=Glurak'] = [{ id: 'swsh3-025', localId: '025', name: 'Glurak' }, { id: 'swsh3-136', localId: '136', name: 'Glurak' },
    { id: 'base1-4', localId: '4', name: 'Glurak' }];
  const pika = [{ id: 'dpp-DP16', localId: 'DP16', name: 'Pikachu' }, { id: 'mep-091', localId: '091', name: 'Pikachu' },
    { id: 'hgss1-78', localId: '78', name: 'Pikachu' }];
  for (let i = 1; i <= 30; i++) pika.push({ id: 'pkx-' + i, localId: String(i), name: 'Pikachu' });
  db['de/cards?name=Pikachu'] = pika;
  db['de/cards?name=Gengar'] = [{ id: 'base3-5', localId: '5', name: 'Gengar' }];
  db['de/cards?name=Despotar'] = [{ id: 'hgss2-88', localId: '88', name: 'Despotar' }];
  db['de/cards?name=Ditto'] = [{ id: 'sv03.5-132', localId: '132', name: 'Ditto' }];
  db['en/cards?name=Ditto'] = [{ id: 'sv03.5-132', localId: '132', name: 'Ditto' }, { id: 'ex11-62', localId: '62', name: 'Ditto' }];
  db['de/cards?name=Mewtu'] = [];
  db['en/cards?name=Mewtwo'] = [{ id: 'old9-007', localId: '007', name: 'Mewtwo' }];
  db['de/cards?name=Unbekannt'] = [];
  db['en/cards?name=Unbekannt'] = [];
  // Übersetzungstabelle (rebuildTranslation_)
  // Arktos und Icognito: wie bei tcgdex aus neueren Sets mit deutschen Daten (die Erkennung prüft seit Review RECOG-2 den
  // Namen der Zeile auch gegen den englischen Kartennamen alter Sets ohne deutsche Daten)
  db['de/cards'] = [{ id: 'swsh3-025', name: 'Glurak' }, { id: 'old9-7', name: 'Mewtu' }, { id: 'hgss2-88', name: 'Despotar' },
    { id: 'tr-1', name: 'Arktos' }, { id: 'tr-2', name: 'Icognito' }];
  db['en/cards'] = [{ id: 'swsh3-025', name: 'Charizard' }, { id: 'old9-7', name: 'Mewtwo' }, { id: 'hgss2-88', name: 'Tyranitar' },
    { id: 'tr-1', name: 'Articuno' }, { id: 'tr-2', name: 'Unown' }];
  return db;
}

// ---------------------------------------------------------------------------
// Umgebung: Code.gs + 00_shared + (10_quelle, wenn ladbar) + 20_erkennung, sonst Attrappen
// ---------------------------------------------------------------------------

let QUELLE_OK = null;

function makeEnv(opts) {
  opts = opts || {};
  const base = ['Code.gs', '../parts/00_shared.gs'];
  const mine = '../parts/20_erkennung.gs';
  let env = null;
  if (QUELLE_OK !== false && fs.existsSync(path.join(PARTS, '10_quelle.gs')) && !opts.noQuelle) {
    try {
      env = H.createEnv({ files: base.concat(['../parts/10_quelle.gs', mine]), db: buildDb() });
      if (typeof env.ctx.parseSourceRecords_ !== 'function') throw new Error('parseSourceRecords_ fehlt');
      QUELLE_OK = true;
    } catch (e) {
      if (QUELLE_OK === null) console.log('Hinweis: 10_quelle.gs nicht nutzbar (' + e.message + '), Attrappe aktiv');
      QUELLE_OK = false;
      env = null;
    }
  }
  if (!env) env = H.createEnv({ files: base.concat([mine]), db: buildDb() });
  const c = env.ctx;
  // Attrappe parseSourceRecords_ (Liste/Checkliste), nur wenn Teil „Quelle“ fehlt
  if (typeof c.parseSourceRecords_ !== 'function') {
    c.parseSourceRecords_ = function (cfg) {
      const sh = env.ss.getSheetByName('Import-Quelle');
      if (!sh || !sh.getLastRow()) return [];
      const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues();
      const out = [];
      const fields = ['name', 'number', 'set', 'qty', 'variant', 'cond', 'lang', 'version', 'cmLink', 'tcgdexId', 'price', 'priceDate', 'check'];
      for (let r = cfg.firstRow; r <= vals.length; r++) {
        const raw = {};
        fields.forEach(f => { const ci = cfg.cols[f]; raw[f] = ci >= 0 ? String(vals[r - 1][ci] || '') : ''; });
        const extrasRaw = {};
        (cfg.extras || []).forEach(x => { extrasRaw[x.name] = String(vals[r - 1][x.col] || ''); });
        out.push({ srcRows: [r], raw, extrasRaw });
      }
      return out;
    };
  }
  // Attrappe coverageFor_ (Teil „Protokoll“): Tests setzen env.coverage
  env.coverage = {};
  env.coverageCalls = 0;
  if (typeof c.coverageFor_ !== 'function') {
    c.coverageFor_ = function (sourceId) { env.coverageCalls++; return env.coverage[sourceId] || {}; };
  }
  // Attrappen aus Teil „Quelle“, nur wenn er fehlt: Import-Blätter (Import-Begriffe kommt unten), Normalform der Zuordnung
  if (typeof c.setupImportSheets_ !== 'function') c.setupImportSheets_ = function () {};
  if (typeof c.quNormCfg_ !== 'function') c.quNormCfg_ = function (cfg) { return cfg; };
  // Abrufe innerhalb der Sperre zählen
  env.fetchInLock = [];
  const fa = c.UrlFetchApp.fetchAll, f1 = c.UrlFetchApp.fetch;
  env.fetchAllSizes = [];
  c.UrlFetchApp.fetchAll = rs => { if (env.lock.depth > 0) env.fetchInLock.push(rs.length); env.fetchAllSizes.push(rs.length); return fa(rs); };
  c.UrlFetchApp.fetch = u => { if (env.lock.depth > 0) env.fetchInLock.push(u); return f1(u); };
  c.setupAll_();
  if (!env.ss.getSheetByName('Import-Begriffe')) {
    const sh = c.getOrCreateSheet_(env.ss, 'Import-Begriffe');
    c.writeHeaders_(sh, c.TERMS_HEADERS ? env.run('TERMS_HEADERS') : ['Begriff', 'Bedeutung', 'Wert', 'Wo']);
    const rows = c.erDefaultTermRows_();
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }
  env.fetchLog.length = 0;
  return env;
}

/** Liste in "Import-Quelle" schreiben und einen Entwurf anlegen. */
function setSource(env, values, sourceId) {
  const c = env.ctx;
  const sh = c.getOrCreateSheet_(env.ss, 'Import-Quelle');
  if (sh.getLastRow()) sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).clearContent();
  const w = Math.max(...values.map(r => r.length));
  const rows = values.map(r => { const x = r.slice(); while (x.length < w) x.push(''); return x; });
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  sh.getRange(1, 1, rows.length, w).setNumberFormat('@');
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  c.importSaveDraft_({ sourceId: sourceId || 'SRC1', sourceName: 'Testordner', sourceUrl: '', kind: 'sheet', tmpId: '',
    tab: 'Tabellenblatt1', cfg: null, templateName: '', mode: 'neu', stage: 'zuordnung', recognizePos: 0, total: 0,
    startedAt: '2026-10-15' });
}

/** cfg für die Testliste: Name | Nummer | Set | Cardmarket | Preis | Datum | tcgdex | Ordner */
function listCfg(extra) {
  return Object.assign({
    form: 'liste', headerRow: 1, firstRow: 2, lastRow: 0,
    cols: { name: 0, number: 1, set: 2, cmLink: 3, price: 4, priceDate: 5, tcgdexId: 6, qty: -1, variant: -1, cond: -1,
      lang: -1, version: -1, check: -1 },
    fixed: { lang: 'DE', cond: '', variant: '', version: '' },
    extras: [{ col: 7, name: 'Ordner', show: false }],
    grid: { startRow: 2, startCol: 0, blockRows: 2, blockCols: 1, gapRows: 0, gapCols: 0, perRow: 0, cells: { name: [0, 0], number: [1, 0] } }
  }, extra || {});
}

const HEAD = ['Karte Name', 'Setnummer', 'Set', 'Cardmarket', '30 Tage Preistrend', 'Datum Preis-Daten', 'tcgdex', 'Ordner'];
const CM = 'https://www.cardmarket.com/de/Pokemon/Products/Singles/';

/** Erkennung bis zum Ende laufen lassen. */
function recognizeAll(env) {
  let r, guard = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && guard++ < 50);
  return r;
}

function reviewByName(env, name) {
  return env.ctx.reviewRead_().filter(it => it.values.name === name);
}

// ---------------------------------------------------------------------------
// A. Begriffe und Felder
// ---------------------------------------------------------------------------
t.section('Begriffe und Felder');
{
  const env = makeEnv();
  const c = env.ctx;
  const terms = c.loadTerms_();
  t.ok('Begriffe geladen', terms.length >= 30, terms.length);
  t.ok('längste Begriffe zuerst', terms[0].term.length >= terms[terms.length - 1].term.length);
  const rh = terms.find(x => x.term === 'Rev Holo');
  t.eq('Rev Holo = reverse, Name und Spalten', [rh.meaning, rh.value, rh.scope], ['Variante', 'reverse', 'Name und Spalten']);
  t.eq('Rev nur Spalten', terms.find(x => x.term === 'Rev').scope, 'nur Spalten');
  const cfg = listCfg({ cols: Object.assign({}, listCfg().cols, { variant: 8, cond: 9, lang: 10, version: 11, qty: 12 }) });
  const ex = (raw, cf, extrasRaw) => c.extractRow_({ srcRows: [2], raw, extrasRaw: extrasRaw || {} }, cf || cfg, terms);

  let f = ex({ name: 'Gengar Rev Holo', number: '5' });
  t.eq('"Gengar Rev Holo" -> Gengar, reverse', [f.nameClean, f.variant, f.name], ['Gengar', 'reverse', 'Gengar Rev Holo']);
  f = ex({ name: 'Pikachu Snowflake', number: '78' });
  t.eq('"Pikachu Snowflake" -> Version Snowflake', [f.nameClean, f.version, f.variant], ['Pikachu', 'Snowflake', '']);
  f = ex({ name: 'Glurak 1. Edition', number: '4' });
  t.eq('"Glurak 1. Edition" -> firstEdition', [f.nameClean, f.variant], ['Glurak', 'firstEdition']);
  f = ex({ name: 'Glurak - Reverse Holo (Near Mint)', number: '4' });
  t.eq('Bindestrich und Klammern', [f.nameClean, f.variant, f.cond], ['Glurak', 'reverse', 'NM']);
  f = ex({ name: 'Glurak-Snowflake', number: '4' });
  t.eq('Begriff mit Bindestrich davor', [f.nameClean, f.version], ['Glurak', 'Snowflake']);
  f = ex({ name: 'Revolver Holo', number: '1' });
  t.eq('"Revolver" bleibt, "Holo" nur Spalten', [f.nameClean, f.variant], ['Revolver Holo', '']);
  f = ex({ name: 'Snowflakes Dream', number: '1' });
  t.eq('"Snowflakes" ist nicht "Snowflake"', [f.nameClean, f.version], ['Snowflakes Dream', '']);
  f = ex({ name: 'Pikachu', number: '1', variant: 'Revolver' });
  t.eq('Spalte "Revolver" passt nicht zu "Rev"', f.variant, '');
  f = ex({ name: 'Pikachu', number: '1', variant: 'Rev' });
  t.eq('Spalte "Rev" -> reverse', f.variant, 'reverse');
  f = ex({ name: 'Pikachu', number: '1', variant: 'RH' });
  t.eq('Spalte "RH" -> reverse', f.variant, 'reverse');
  f = ex({ name: 'Pikachu', number: '1', variant: 'Holo' });
  t.eq('Spalte "Holo" -> holo', f.variant, 'holo');
  f = ex({ name: 'Pikachu', number: '1', variant: '1. Edition' });
  t.eq('Spalte "1. Edition" -> firstEdition (Anzeigename)', f.variant, 'firstEdition');
  f = ex({ name: 'Pikachu', number: '1', variant: 'firstEdition' });
  t.eq('Spalte mit Code', f.variant, 'firstEdition');
  f = ex({ name: 'Pikachu', number: '1', variant: 'Holo, Near Mint' });
  t.eq('Spalte mit zwei Begriffen', [f.variant, f.cond], ['holo', 'NM']);
  f = ex({ name: 'Pikachu Rev Holo', number: '1', variant: 'Holo' });
  t.eq('Spalte schlägt Name', f.variant, 'holo');
  f = ex({ name: 'Pikachu', number: '1', cond: 'nm' });
  t.eq('Zustand "nm"', f.cond, 'NM');
  f = ex({ name: 'Pikachu', number: '1', cond: 'Light Played' });
  t.eq('Zustand "Light Played"', f.cond, 'LP');
  f = ex({ name: 'Pikachu', number: '1', cond: 'Excellent' });
  t.eq('Zustand Anzeigename', f.cond, 'EX');
  f = ex({ name: 'Pikachu', number: '1', lang: 'Englisch' });
  t.eq('Sprache "Englisch"', f.lang, 'EN');
  f = ex({ name: 'Pikachu', number: '1', lang: 'en' });
  t.eq('Sprache "en"', f.lang, 'EN');
  f = ex({ name: 'Pikachu', number: '1', lang: 'Japanese' });
  t.eq('Sprache "Japanese"', f.lang, 'JP');
  f = ex({ name: 'Pikachu', number: '1', lang: 'Französisch' });
  t.eq('Sprache aus LANGS', f.lang, 'FR');
  f = ex({ name: 'Pikachu', number: '1' });
  t.eq('Sprache fest DE', f.lang, 'DE');
  f = ex({ name: 'Pikachu', number: '1', version: 'Staff' });
  t.eq('Version per Begriff', f.version, 'Staff');
  f = ex({ name: 'Pikachu', number: '1', version: '  Pokémon Center  Stempel ' });
  t.eq('unbekannte Version bleibt Text', f.version, 'Pokémon Center Stempel');
  const cfgFixed = listCfg({ fixed: { lang: 'EN', cond: 'NM', variant: 'holo', version: 'Staff' } });
  f = ex({ name: 'Pikachu', number: '1' }, cfgFixed);
  t.eq('feste Werte füllen Leeres', [f.lang, f.cond, f.variant, f.version], ['EN', 'NM', 'holo', 'Staff']);
  f = ex({ name: 'Pikachu Rev Holo', number: '1' }, cfgFixed);
  t.eq('Name schlägt festen Wert', f.variant, 'reverse');
  f = ex({ name: 'Pikachu', number: '1' }, listCfg({ fixed: { lang: '', cond: '', variant: '', version: '' } }));
  t.eq('Sprache Standard DE', f.lang, 'DE');

  // Menge
  f = ex({ name: 'Pikachu', number: '1', qty: '' });
  t.eq('leere Menge -> 1', f.qty, 1);
  f = ex({ name: 'Pikachu', number: '1', qty: '3' });
  t.eq('Menge 3', f.qty, 3);
  f = ex({ name: 'Pikachu', number: '1', qty: '2x' });
  t.eq('Menge "2x"', f.qty, 2);
  f = ex({ name: 'Pikachu', number: '1', qty: '0' });
  t.eq('Menge 0 bleibt 0 (Liste)', [f.qty, f.skip], [0, null]);
  t.eq('Menge "nein" -> 0', ex({ name: 'Pikachu', number: '1', qty: 'nein' }).qty, 0);
  t.eq('Menge "x" -> 1', ex({ name: 'Pikachu', number: '1', qty: 'x' }).qty, 1);

  // Preis
  const pr = p => ex({ name: 'Pikachu', number: '1', price: p }).price;
  t.eq('Preis "1,50 €"', pr('1,50 €'), 1.5);
  t.eq('Preis "1.234,56"', pr('1.234,56'), 1234.56);
  t.eq('Preis "€ 1,5"', pr('€ 1,5'), 1.5);
  t.eq('Preis "1.50"', pr('1.50'), 1.5);
  t.eq('Preis Unsinn -> null', pr('ca. zwei Euro'), null);
  t.eq('Preis leer -> null', pr(''), null);
  f = ex({ name: 'Pikachu', number: '1', priceDate: '13.10.2026' });
  t.eq('Preisdatum als Text', f.priceDate, '13.10.2026');

  // Links
  f = ex({ name: 'Despotar', number: '', cmLink: 'siehe ' + CM + 'Unleashed/Tyranitar-UL88 (gekauft)' });
  t.eq('Cardmarket-URL aus Text', f.cmUrl, CM + 'Unleashed/Tyranitar-UL88');
  f = ex({ name: 'Despotar', cmLink: 'https://www.pricecharting.com/game/pokemon-unleashed/tyranitar-88' });
  t.eq('pricecharting -> cmUrl leer', f.cmUrl, '');
  f = ex({ name: 'X', cmLink: 'Tyranitar' });
  t.eq('kein Link -> leer', f.cmUrl, '');

  // Überspringen
  f = ex({ name: 'SUMME', number: '', price: '123,45 €' });
  t.eq('SUMME übersprungen', f.skip, 'summe');
  f = ex({ name: 'Gesamt:', price: '5' });
  t.eq('Gesamt übersprungen', f.skip, 'summe');
  f = ex({ name: '', number: '', price: '99,00 €' });
  t.eq('nur Preis -> summe', f.skip, 'summe');
  f = ex({ name: '', number: '', set: 'Total', price: '' });
  t.eq('erste Zelle "Total" -> summe', f.skip, 'summe');
  f = ex({ name: 'Sumpex', number: '12' });
  t.eq('"Sumpex" ist keine Summe', f.skip, null);
  f = ex({ name: '', number: '', set: 'Grundset' });
  t.eq('leer', f.skip, 'leer');
  f = ex({ name: '', number: '62', set: '' });
  t.eq('nur Nummer ist nicht leer', f.skip, null);

  // Checkliste
  const ck = listCfg({ form: 'checkliste', cols: Object.assign({}, listCfg().cols, { check: 8, qty: 9 }) });
  const exk = raw => c.extractRow_({ srcRows: [3], raw, extrasRaw: {} }, ck, terms);
  t.eq('Checkliste angehakt (WAHR)', exk({ name: 'Bisasam', number: '1', check: 'WAHR' }).qty, 1);
  t.eq('Checkliste angehakt (x) mit Menge 3', exk({ name: 'Bisasam', number: '1', check: 'x', qty: '3' }).qty, 3);
  t.eq('Checkliste angehakt (✓)', exk({ name: 'Bisasam', number: '1', check: '✓' }).qty, 1);
  t.eq('Checkliste "ja"', exk({ name: 'Bisasam', number: '1', check: 'ja' }).qty, 1);
  const nk = exk({ name: 'Bisasam', number: '1', check: 'FALSE' });
  t.eq('Checkliste nicht angehakt', [nk.qty, nk.skip], [0, 'nichtAngehakt']);
  t.eq('Checkliste leer -> nicht angehakt', exk({ name: 'Bisasam', number: '1', check: '' }).skip, 'nichtAngehakt');

  // eigene Begriffe aus dem Blatt
  const sh = env.ss.getSheetByName('Import-Begriffe');
  const n = sh.getLastRow();
  sh.getRange(n + 1, 1, 3, 4).setValues([['Rev', 'Variante', 'reverse', 'Name und Spalten'], ['PSA 10', 'Ignorieren', '', 'Name und Spalten'],
    ['Kaputt', 'Gibtsnicht', 'x', 'nur Spalten']]);
  // „Rev“ steht jetzt doppelt (nur Spalten + Name und Spalten)
  const terms2 = c.loadTerms_();
  t.ok('unbrauchbare Zeile ignoriert', !terms2.some(x => x.term === 'Kaputt'));
  const f2 = c.extractRow_({ srcRows: [2], raw: { name: 'Revolver Gengar Rev PSA 10', number: '5' }, extrasRaw: {} }, cfg, terms2);
  t.eq('"Rev" im Namen, "Revolver" bleibt, "PSA 10" entfernt', [f2.nameClean, f2.variant], ['Revolver Gengar', 'reverse']);

  // Zusatzspalten
  const fx = ex({ name: 'Pikachu', number: '1' }, cfg, { Ordner: '  Ordner 2 ', Notiz: '' });
  t.eq('Zusatzspalten getrimmt', fx.extras, { Ordner: 'Ordner 2', Notiz: '' });
  // fixedFields (Review RECOG-3): welche Werte nur aus den festen Werten kommen (zählen nicht im Fingerabdruck)
  t.eq('extractRow_-Felder', Object.keys(fx).sort(), ['cmUrl', 'cond', 'extras', 'fixedFields', 'lang', 'name', 'nameClean', 'number', 'price',
    'priceDate', 'qty', 'set', 'skip', 'tcgdexId', 'variant', 'version'].sort());
  // Spaltenbuchstaben in cfg
  const fl = c.extractRow_({ srcRows: [2], raw: { name: 'Pikachu', check: '' }, extrasRaw: {} },
    { form: 'checkliste', cols: { name: 'A', check: 'C' } }, terms);
  t.eq('Spalte als Buchstabe', fl.skip, 'nichtAngehakt');
}

// ---------------------------------------------------------------------------
// B. Fingerabdruck und Zusammenfassen
// ---------------------------------------------------------------------------
t.section('Fingerabdruck');
{
  const env = makeEnv();
  const c = env.ctx;
  const terms = c.loadTerms_();
  const cfg = listCfg();
  const ex = raw => c.extractRow_({ srcRows: [2], raw, extrasRaw: {} }, cfg, terms);
  const a = ex({ name: 'Hundemon', number: 'UD 82', set: 'Undaunted', price: '1,50 €', priceDate: '01.10.2026' });
  const b = ex({ name: 'Hundemon', number: 'UD82', set: 'undaunted', price: '9,99 €', priceDate: '02.10.2026' });
  const fa = c.fingerprint_(a);
  t.ok('12 Hex-Zeichen', /^[0-9a-f]{12}$/.test(fa), fa);
  t.eq('gleich trotz Preis, Datum, Leerzeichen, Groß/klein', fa, c.fingerprint_(b));
  t.eq('Menge und Zusatzspalten zählen nicht', c.fingerprint_(Object.assign({}, a, { qty: 5, extras: { Ordner: 'X' } })), fa);
  t.ok('Variante zählt', c.fingerprint_(Object.assign({}, a, { variant: 'reverse' })) !== fa);
  t.ok('Zustand zählt', c.fingerprint_(Object.assign({}, a, { cond: 'NM' })) !== fa);
  t.ok('Sprache zählt', c.fingerprint_(Object.assign({}, a, { lang: 'EN' })) !== fa);
  t.ok('Version zählt', c.fingerprint_(Object.assign({}, a, { version: 'Staff' })) !== fa);
  t.eq('Nummer 025 = 25', c.fingerprint_(Object.assign({}, a, { number: '025' })), c.fingerprint_(Object.assign({}, a, { number: '25' })));
  const u1 = c.fingerprint_(Object.assign({}, a, { cmUrl: CM + 'Undaunted/Houndoom-UD82?language=3&minCondition=2' }));
  const u2 = c.fingerprint_(Object.assign({}, a, { cmUrl: 'https://cardmarket.com/de/pokemon/products/singles/undaunted/houndoom-ud82' }));
  const u3 = c.fingerprint_(Object.assign({}, a, { cmUrl: CM + 'Undaunted/Houndoom-UD82?isReverseHolo=Y' }));
  t.eq('Link: Abfrage und Host egal', u1, u2);
  t.ok('Link: isReverseHolo zählt', u3 !== u1);
  t.eq('erCmKey_', c.erCmKey_(CM + 'Undaunted/Houndoom-UD82?language=3&isReverseHolo=Y'), '/de/pokemon/products/singles/undaunted/houndoom-ud82?isreverseholo=y');

  const recs = [
    { rec: { srcRows: [5], raw: { name: 'Hundemon' } }, fields: Object.assign({}, a, { extras: { Ordner: 'A' } }) },
    { rec: { srcRows: [9], raw: { name: 'Hundemon' } }, fields: Object.assign({}, b, { extras: { Ordner: 'B' } }) },
    { rec: { srcRows: [11], raw: { name: 'Hundemon' } }, fields: Object.assign({}, b, { extras: { Ordner: 'A' } }) },
    { rec: { srcRows: [12], raw: { name: 'Hundemon' } }, fields: Object.assign({}, a, { variant: 'reverse', extras: {} }) }
  ];
  const agg = c.erAggregate_(recs);
  t.eq('zwei Einträge', agg.length, 2);
  t.eq('Menge summiert, Zeilen verbunden', [agg[0].qty, agg[0].srcRows], [3, [5, 9, 11]]);
  t.eq('Zusatzwerte verbunden', agg[0].values.extras, { Ordner: 'A / B' });
  t.eq('Werte der ersten Zeile', [agg[0].values.price, agg[0].values.priceDate, agg[0].values.raw.name], [1.5, '01.10.2026', 'Hundemon']);
}

// ---------------------------------------------------------------------------
// C. Set-Zuordnung vorbelegen und laden
// ---------------------------------------------------------------------------
t.section('Set-Zuordnung');
{
  const env = makeEnv();
  const c = env.ctx;
  // 25 weitere englische Sets, damit es mehr als ein Paket gibt
  const extraSets = [];
  for (let i = 1; i <= 25; i++) {
    extraSets.push({ id: 'fill' + i, name: 'Filler ' + i, cardCount: { official: 10 } });
    env.DB['en/sets/fill' + i] = { id: 'fill' + i, name: 'Filler ' + i, cards: [] };
  }
  env.DB['en/sets'] = env.DB['en/sets'].concat(extraSets);
  c.rebuildSets_();
  // Zeilen von Hand vorab
  const sh = env.ss.getSheetByName('Import-Sets') || (() => { const s = c.getOrCreateSheet_(env.ss, 'Import-Sets'); c.writeHeaders_(s, ['Cardmarket-Name', 'Kürzel', 'tcgdex-Sets', 'Herkunft']); return s; })();
  sh.getRange(2, 1, 3, 4).setValues([
    ['Supreme Victors', 'SVX', 'pl3', 'Hand'],
    ['Alte Liste', 'AL', 'base1, base3', ''],
    ['Weg damit', 'WD', 'base1', 'auto']
  ]);
  env.fetchAllSizes.length = 0;
  const msg = env.uiCall('importSetsVorbelegen');
  t.ok('Meldung', /Sets vorbelegt/.test(msg) && /2 Zeilen von Hand/.test(msg), msg);
  t.ok('Pakete zu höchstens 20', env.fetchAllSizes.length >= 3 && env.fetchAllSizes.every(n => n <= 20), env.fetchAllSizes);
  const rows = env.objects('Import-Sets');
  const by = id => rows.filter(r => String(r['tcgdex-Sets']) === id);
  t.eq('Hand-Zeilen bleiben unverändert', rows.slice(0, 2).map(r => [r['Cardmarket-Name'], r['Kürzel'], r['tcgdex-Sets'], r.Herkunft]),
    [['Supreme Victors', 'SVX', 'pl3', 'Hand'], ['Alte Liste', 'AL', 'base1, base3', '']]);
  t.ok('alte auto-Zeile ersetzt', !rows.some(r => r['Cardmarket-Name'] === 'Weg damit'));
  t.ok('kein auto-Duplikat zur Hand-Zeile', by('pl3').length === 1);
  t.eq('Kürzel aus abbreviation.official', by('sv03.5')[0]['Kürzel'], 'MEW');
  t.eq('Kürzel aus abbreviation (Text)', by('hgss2')[0]['Kürzel'], 'UL');
  t.eq('Kürzel aus tcgOnline', by('mep')[0]['Kürzel'], 'MEP');
  t.eq('Kürzel-Liste: ex11 DS', by('ex11')[0]['Kürzel'], 'DS');
  t.eq('Kürzel-Liste: dp1 DP, dpp DPPR, hgssp HGSS', [by('dp1')[0]['Kürzel'], by('dpp')[0]['Kürzel'], by('hgssp')[0]['Kürzel']], ['DP', 'DPPR', 'HGSS']);
  t.ok('Kürzel-Liste nur für Sets im Cache (ex1 fehlt)', !by('ex1').length && !rows.some(r => r['Kürzel'] === 'RS'));
  t.eq('Herkunft auto, Name englisch', [by('dp1')[0].Herkunft, by('dp1')[0]['Cardmarket-Name']], ['auto', 'Diamond & Pearl']);
  t.ok('Filler-Sets drin', by('fill25').length === 1);
  t.ok('Set-Liste nebenbei im Cache', env.cache.has('set:en:dpp'));
  t.eq('keine Abrufe in der Sperre', env.fetchInLock, []);

  const idx = c.loadCmSets_();
  t.eq('byCode DS', idx.byCode.DS, ['ex11']);
  t.eq('byCode SVX (Hand)', idx.byCode.SVX, ['pl3']);
  t.eq('byCode MEW', idx.byCode.MEW, ['sv03.5']);
  t.eq('byName Cardmarket-Name', idx.byName.unleashed, ['hgss2']);
  t.eq('byName deutscher Name aus dem Cache', idx.byName.grundset, ['base1']);
  t.eq('byName "Diamond & Pearl" gequetscht', idx.byName.diamondpearl, ['dp1']);
  t.eq('Hand-Zeile ohne Herkunft gilt', idx.byName.alteliste, ['base1', 'base3']);
  t.ok('Promo-Sets erkannt', idx.promo.dpp && idx.promo.hgssp && idx.promo.mep && !idx.promo.dp1);
  // Hand überschreibt auto beim Kürzel
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([['Mein DS', 'DS', 'base3', 'Hand']]);
  t.eq('Hand-Kürzel hat Vorrang', c.loadCmSets_().byCode.DS, ['base3']);
  // zweiter Lauf: Hand-Zeilen weiter da
  env.uiCall('importSetsVorbelegen');
  const rows2 = env.objects('Import-Sets');
  t.eq('zweiter Lauf: Hand-Zeilen bleiben', rows2.filter(r => r.Herkunft !== 'auto').length, 3);
  t.eq('zweiter Lauf: keine doppelten auto-Zeilen', rows2.filter(r => r['tcgdex-Sets'] === 'ex11').length, 1);
  t.eq('Sperre nie verschachtelt', env.lock.nested, 0);

  // leerer Set-Cache
  const env2 = makeEnv();
  env2.ss.getSheetByName('Sets').getRange(2, 1, 200, 8).clearContent();
  t.throws('leerer Set-Cache -> Fehler', () => env2.uiCall('importSetsVorbelegen'), /Set-Cache ist leer/);
}

// ---------------------------------------------------------------------------
// D. Cardmarket-Links, Set + Nummer, Nummern im Set, Cache
// ---------------------------------------------------------------------------
t.section('Cardmarket-Links');
{
  const env = makeEnv();
  const c = env.ctx;
  env.uiCall('importSetsVorbelegen');
  const idx = c.loadCmSets_();
  const pu = u => { const r = c.parseCardmarketUrl_(u, idx); return r && JSON.parse(JSON.stringify(r)); };
  t.eq('Articuno-Lv34-SV148', pu(CM + 'Supreme-Victors/Articuno-Lv34-SV148'),
    { setIds: ['pl3'], code: 'SV', number: '148', nameEn: 'Articuno', variant: '' });
  t.eq('Tyranitar-UL88', pu(CM + 'Unleashed/Tyranitar-UL88'),
    { setIds: ['hgss2'], code: 'UL', number: '88', nameEn: 'Tyranitar', variant: '' });
  t.eq('Ho-Oh-HGSSHGSS01', pu(CM + 'HGSS-Black-Star-Promos/Ho-Oh-HGSSHGSS01'),
    { setIds: ['hgssp'], code: 'HGSS', number: 'HGSS01', nameEn: 'Ho Oh', variant: '' });
  t.eq('DPPRDP12', pu(CM + 'DP-Black-Star-Promos/Riolu-DPPRDP12'),
    { setIds: ['dpp'], code: 'DPPR', number: 'DP12', nameEn: 'Riolu', variant: '' });
  t.eq('DPPR16', pu(CM + 'DP-Black-Star-Promos/Pikachu-DPPR16'),
    { setIds: ['dpp'], code: 'DPPR', number: '16', nameEn: 'Pikachu', variant: '' });
  t.eq('MEP099', pu(CM + 'MEP-Black-Star-Promos/Mega-Charizard-X-ex-MEP099'),
    { setIds: ['mep'], code: 'MEP', number: '099', nameEn: 'Mega Charizard X ex', variant: '' });
  t.eq('DS62', pu(CM + 'Delta-Species/Ditto-DS62'),
    { setIds: ['ex11'], code: 'DS', number: '62', nameEn: 'Ditto', variant: '' });
  t.eq('V3 fällt aus dem Namen, isReverseHolo', pu(CM + 'HeartGold-SoulSilver/Pikachu-V3-HS78?isReverseHolo=Y&language=3'),
    { setIds: ['hgss1'], code: 'HS', number: '78', nameEn: 'Pikachu', variant: 'reverse' });
  t.eq('isFirstEd', pu(CM + 'Base-Set/Charizard-BS4?isFirstEd=Y').variant, 'firstEdition');
  t.eq('unbekannter Set-Name, Kürzel bekannt', pu(CM + 'Unbekannt-Neu/Ditto-DS62').setIds, ['ex11']);
  t.eq('ohne Nummer: nur Name', pu(CM + 'Unleashed/Tyranitar'), { setIds: ['hgss2'], code: '', number: '', nameEn: 'Tyranitar', variant: '' });
  t.eq('pricecharting -> null', pu('https://www.pricecharting.com/game/pokemon-unleashed/tyranitar-88'), null);
  t.eq('Kodierte Zeichen', pu(CM + 'Unleashed/Ho%2DOh-UL88').nameEn, 'Ho Oh');
  t.eq('"-V1" am Ende ist keine Nummer', pu(CM + 'HeartGold-SoulSilver/Pikachu-V1'),
    { setIds: ['hgss1'], code: '', number: '', nameEn: 'Pikachu', variant: '' });
  t.eq('"-Lv34" am Ende ist keine Nummer', pu(CM + 'Supreme-Victors/Articuno-Lv34'),
    { setIds: ['pl3'], code: '', number: '', nameEn: 'Articuno', variant: '' });
  t.eq('Kürzel unbekannt, Set aus dem Namen', pu(CM + 'Fossil/Gengar-FO5'), { setIds: ['base3'], code: 'FO', number: '5', nameEn: 'Gengar', variant: '' });
  t.eq('Link ohne Kartenteil -> null', pu(CM + 'Unleashed'), null);
}

t.section('Set + Nummer');
{
  const env = makeEnv();
  const c = env.ctx;
  env.uiCall('importSetsVorbelegen');
  const idx = c.loadCmSets_();
  const ps = (s, n) => { const r = c.parseSetNumber_(s, n, idx); return JSON.parse(JSON.stringify(r)); };
  let r = ps('', 'DS 62');
  t.eq('"DS 62"', [r.setIds, r.number, r.ambiguous], [['ex11'], '62', false]);
  r = ps('', 'MEW 132');
  t.eq('"MEW 132" (Kürzel von sv03.5)', [r.setIds, r.number, r.ambiguous], [['sv03.5'], '132', false]);
  r = ps('', 'DP 16');
  t.eq('"DP 16" ohne Set: mehrdeutig', [r.setIds.slice().sort(), r.number, r.ambiguous, r.numbers], [['dp1', 'dpp'], 'DP16', true, { dp1: '16', dpp: 'DP16' }]);
  r = ps('Diamant & Perl', 'DP 16');
  t.eq('"DP 16" mit Set Diamant & Perl', [r.setIds, r.number, r.ambiguous], [['dp1'], '16', false]);
  r = ps('DP Black Star Promos', 'DP 16');
  t.eq('"DP 16" mit Promo-Set', [r.setIds, r.number, r.ambiguous], [['dpp'], 'DP16', false]);
  r = ps('', 'DP12');
  t.eq('"DP12" ohne Leerzeichen', [r.setIds.slice().sort(), r.ambiguous], [['dp1', 'dpp'], true]);
  r = ps('', 'HGSS 01');
  t.eq('"HGSS 01"', [r.setIds, r.number, r.ambiguous], [['hgssp'], 'HGSS01', false]);
  r = ps('', 'MEP 091');
  t.eq('"MEP 091"', [r.setIds, r.number], [['mep'], 'MEP091']);
  r = ps('Unseen Forces', 'X');
  t.eq('"X" (Icognito)', [r.setIds, r.number], [['ex10'], 'X']);
  r = ps('Flammende Finsternis', '025/189');
  t.eq('deutscher Setname, Nummer mit Setgröße', [r.setIds, r.number], [['swsh3'], '025']);
  t.eq('englischer Setname', ps('Darkness Ablaze', '25').setIds, ['swsh3']);
  t.eq('Set als Kürzel', ps('UL', '88').setIds, ['hgss2']);
  t.eq('Set als ID', ps('swsh3', '25').setIds, ['swsh3']);
  t.eq('"EX Delta Species" -> Delta Species', ps('EX Delta Species', '62').setIds, ['ex11']);
  t.eq('Teil des Namens', ps('Supreme', '148').setIds, ['pl3']);
  t.eq('"151"', ps('151', '132').setIds, ['sv03.5']);
  r = ps('Astral Radiance', 'TG01');
  t.eq('TG01 im Set', [r.setIds, r.number], [['swsh10'], 'TG01']);
  r = ps('Astral Radiance', 'DS 05');
  // Review RECOG-1: widersprechen sich Set-Text und Kürzel, gewinnt der Set-Text nicht still; im Set des Textes bleiben
  // die Buchstaben Teil der Nummer (nur genau), das Set des Kürzels kommt dazu und der Name entscheidet
  t.eq('Kürzel eines anderen Sets: Buchstaben bleiben Teil der Nummer', [r.setIds, r.number, r.numbers, r.exact, r.ambiguous],
    [['swsh10', 'ex11'], 'DS05', { swsh10: 'DS05', ex11: '05' }, { swsh10: true }, true]);
  r = ps('', '62');
  t.eq('nur Nummer', [r.setIds, r.number], [[], '62']);
  r = ps('Gibt es nicht', '62');
  t.eq('unbekanntes Set', [r.setIds, r.setTextIds], [[], []]);
}

t.section('Nummern im Set und Cache');
{
  const env = makeEnv();
  const c = env.ctx;
  const nums = (set, n) => c.erFindInSets_([set], n, null).map(x => x.id);
  t.eq('025 = 25', nums('swsh3', '25'), ['swsh3-025']);
  t.eq('25 = 025', nums('swsh3', '025'), ['swsh3-025']);
  t.eq('TG1 = TG01', nums('swsh10', 'TG1'), ['swsh10-TG01']);
  t.eq('1 im Set mit 001 und TG01: genau 001', nums('swsh10', '1'), ['swsh10-001']);
  t.eq('Ziffern-Ersatz: 1 -> SWSH001 (eindeutig)', nums('swshp', '1'), ['swshp-SWSH001']);
  t.eq('Ziffern-Ersatz nicht eindeutig -> nichts', nums('xx1', '1'), []);
  t.eq('X', nums('ex10', 'X'), ['ex10-X']);
  t.eq('deutsche Liste zuerst', c.erFindInSets_(['hgss2'], '88', null)[0].lang, 'de');
  t.eq('nur englisch vorhanden', c.erFindInSets_(['pl3'], '148', null)[0].lang, 'en');
  const put = env.cachePuts.find(p => p.k === 'set:de:swsh3');
  t.ok('Kartenliste im Cache (6 h)', put && put.ttl === 21600, env.cachePuts);
  t.ok('fehlendes de-Set gemerkt', env.cache.get('set:de:pl3') === '{"none":1}');
  // zweiter Lauf: aus dem Cache, ohne Abruf
  c.erResetMemo_();
  env.fetchLog.length = 0;
  t.eq('aus dem Cache', nums('swsh3', '136'), ['swsh3-136']);
  t.eq('kein Abruf dank Cache', env.fetchLog.filter(u => /sets\/swsh3/.test(u)).length, 0);
  // großes Set (> 90 KB) nicht im Cache
  const big = [];
  for (let i = 1; i <= 1500; i++) big.push({ id: 'big1-' + i, localId: String(i), name: 'Sehr langer Kartenname Nummer ' + i + ' mit Zusatz', image: 'https://assets.tcgdex.net/de/big/big1/' + i });
  env.DB['de/sets/big1'] = { id: 'big1', name: 'Groß', cards: big };
  t.eq('großes Set: Nummer gefunden', nums('big1', '1234'), ['big1-1234']);
  t.ok('großes Set nicht im Cache', !env.cache.has('set:de:big1'));
  c.erResetMemo_();
  env.fetchLog.length = 0;
  nums('big1', '7');
  t.eq('großes Set wird neu geholt', env.fetchLog.filter(u => /sets\/big1/.test(u)).length, 1);
}

// ---------------------------------------------------------------------------
// E. Erkennungsstufen
// ---------------------------------------------------------------------------
const CARD_KEYS = ['dataLang', 'id', 'name', 'nameEn', 'setId', 'setName', 'setDate', 'localId', 'setSize', 'img', 'rarity',
  'category', 'illustrator', 'baseVariant', 'variant', 'price', 'priceDate'].sort();

t.section('Erkennungsstufen');
{
  const env = makeEnv();
  const c = env.ctx;
  env.uiCall('importSetsVorbelegen');
  const rows = [
    HEAD,
    // 1 tcgdex-ID gewinnt vor allem anderen
    ['Falscher Name', '999', 'Fossil', CM + 'Unleashed/Tyranitar-UL88', '1,00 €', '01.10.2026', 'swsh3-136', 'Ordner 1'],
    ['Glurak ID', '', '', CM + 'Darkness-Ablaze/Charizard-DAA136?isReverseHolo=Y', '', '', 'swsh3-136', ''],
    // 2 Cardmarket-Links
    ['Despotar', '', '', CM + 'Unleashed/Tyranitar-UL88', '2,50 €', '01.10.2026', '', ''],
    ['Arktos', 'SV148', 'Supreme Victors', CM + 'Supreme-Victors/Articuno-Lv34-SV148', '', '', '', ''],
    ['Ho-Oh', 'HGSS01', '', CM + 'HGSS-Black-Star-Promos/Ho-Oh-HGSSHGSS01', '', '', '', ''],
    ['Riolu', 'DP12', '', CM + 'DP-Black-Star-Promos/Riolu-DPPRDP12', '', '', '', ''],
    ['Pikachu Promo', '', '', CM + 'DP-Black-Star-Promos/Pikachu-DPPR16', '', '', '', ''],
    ['Glurak', '', '', CM + 'Darkness-Ablaze/Charizard-DAA025?isReverseHolo=Y', '', '', '', ''],
    ['Despotar Name', '', '', CM + 'Unleashed/Tyranitar', '', '', '', ''],
    // 3 Set + Nummer (Link von pricecharting zählt nicht)
    ['Glurak', '4', 'Base Set', 'https://www.pricecharting.com/game/pokemon-base-set/charizard-4', '350,00 €', '', '', ''],
    ['Ditto', 'DS 62', '', '', '', '', '', 'Ordner 2'],
    ['Ditto', 'MEW 132', '', '', '', '', '', ''],
    ['Ho-Oh', 'HGSS 01', '', '', '', '', '', ''],
    ['Icognito', 'X', 'Unseen Forces', '', '', '', '', ''],
    ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', ''],
    ['Chimpep', '1', 'SWSH Black Star Promos', '', '', '', '', ''],
    ['Gengar Rev Holo', '5', 'Fossil', '', '', '', '', ''],
    // 3 mehrdeutig, 4 Name entscheidet
    ['Pikachu', 'DP 16', '', '', '', '', '', ''],
    ['', 'DP 16', '', '', '', '', '', ''],
    // 4 Name
    ['Glurak', '', '', '', '', '', '', ''],
    ['Mewtu', '', '', '', '', '', '', ''],
    ['Despotar', '88', '', '', '', '', '', ''],
    ['Unbekannt', '', '', '', '', '', '', ''],
    ['Pikachu', '', '', '', '', '', '', ''],
    ['Glurak', '77', 'Flammende Finsternis', '', '', '', '', ''],
    ['Glurak', '4', 'Gibt es nicht', '', '', '', '', ''],
    // falsche tcgdex-ID, Set + Nummer greifen
    ['Glurak', '136', 'Darkness Ablaze', '', '', '', 'nope-1', ''],
    // Summe, leer, doppelt
    ['Ditto', 'DS 62', '', '', '', '', '', 'Ordner 3'],
    ['', '', '', '', '', '', '', ''],
    ['SUMME', '', '', '', '412,00 €', '', '', '']
  ];
  setSource(env, rows, 'SRC1');
  const st = env.uiCall('importStartRecognition', listCfg(), 'Ordner-Vorlage', 'Nur Neues');
  t.eq('Start: Summe und Leer nur gezählt', st.skipped, { summe: 1, leer: 1, nichtAngehakt: 0 });
  t.eq('Start: Einträge (Ditto DS 62 zusammengefasst)', st.total, 27);
  const d0 = c.importDraft_();
  t.eq('Entwurf: Stufe, Modus, Vorlage', [d0.stage, d0.mode, d0.templateName, d0.recognizePos, d0.total], ['erkennung', 'neu', 'Ordner-Vorlage', 0, 27]);
  t.eq('Entwurf: skipped', d0.skipped, { summe: 1, leer: 1, nichtAngehakt: 0 });
  t.ok('alle offen', c.reviewRead_().every(it => it.status === 'offen'));
  const res = recognizeAll(env);
  t.ok('fertig', res.done && res.pos === 27 && res.total === 27, res);
  const items = c.reviewRead_();
  const get = (name, i) => items.filter(it => it.values.name === name)[i || 0];
  const idOf = (name, i) => { const it = get(name, i); return it && it.card ? it.card.id : (it ? it.status : 'fehlt'); };

  t.eq('1: tcgdex-ID gewinnt', idOf('Falscher Name'), 'swsh3-136');
  t.eq('1: Variante aus der Cardmarket-Abfrage gilt auch bei Stufe 1', [get('Glurak ID').card.id, get('Glurak ID').card.variant], ['swsh3-136', 'reverse']);
  t.eq('2: Tyranitar-UL88', idOf('Despotar'), 'hgss2-88');
  t.eq('2: Articuno-Lv34-SV148', idOf('Arktos'), 'pl3-148');
  t.eq('2: Ho-Oh-HGSSHGSS01', idOf('Ho-Oh'), 'hgssp-HGSS01');
  t.eq('2: DPPRDP12', idOf('Riolu'), 'dpp-DP12');
  t.eq('2: DPPR16 (Ziffern-Ersatz)', idOf('Pikachu Promo'), 'dpp-DP16');
  t.eq('2: Link ohne Nummer, englischer Name im Set', idOf('Despotar Name'), 'hgss2-88');
  const rev = get('Glurak', 0);
  t.eq('2: isReverseHolo -> reverse mit Holo-Preis', [rev.card.id, rev.card.variant, rev.card.price], ['swsh3-025', 'reverse', 3.25]);
  const g4 = items.find(it => it.values.name === 'Glurak' && it.values.number === '4' && it.values.set === 'Base Set');
  t.eq('3: Set + Nummer (pricecharting ignoriert)', [g4.card.id, g4.values.cmUrl], ['base1-4', '']);
  t.eq('3: DS 62', items.find(it => it.values.number === 'DS 62').card.id, 'ex11-62');
  t.eq('3: MEW 132', items.find(it => it.values.number === 'MEW 132').card.id, 'sv03.5-132');
  t.eq('3: HGSS 01', items.find(it => it.values.number === 'HGSS 01').card.id, 'hgssp-HGSS01');
  t.eq('3: X', idOf('Icognito'), 'ex10-X');
  t.eq('3: 25 -> 025', items.find(it => it.values.number === '25').card.id, 'swsh3-025');
  t.eq('3: 1 -> SWSH001', idOf('Chimpep'), 'swshp-SWSH001');
  const gen = get('Gengar Rev Holo');
  t.eq('3: Variante aus dem Namen', [gen.card.id, gen.card.variant, gen.values.nameClean], ['base3-5', 'reverse', 'Gengar']);
  const pdp = items.find(it => it.values.name === 'Pikachu' && it.values.number === 'DP 16');
  t.eq('3+4: DP 16 mehrdeutig, Name entscheidet', [pdp.status, pdp.card && pdp.card.id], ['eindeutig', 'dpp-DP16']);
  const ndp = items.find(it => it.values.name === '' && it.values.number === 'DP 16');
  t.eq('3: DP 16 ohne Name -> unklar mit beiden', [ndp.status, ndp.candidates.map(x => x.id).sort()], ['unklar', ['dp1-16', 'dpp-DP16']]);
  t.ok('Grund nennt das Kürzel', /Kürzel „DP“/.test(ndp.reason), ndp.reason);
  const gl = items.find(it => it.values.name === 'Glurak' && !it.values.number && !it.values.cmUrl);
  t.eq('4: Name ohne Nummer, mehrere -> unklar', [gl.status, gl.candidates.length], ['unklar', 3]);
  t.eq('Kandidat: Form', Object.keys(gl.candidates[0]).sort(), ['id', 'image', 'lang', 'localId', 'name', 'setName', 'setSize']);
  const cb = gl.candidates.find(x => x.id === 'base1-4');
  t.eq('Kandidat: Setname, Größe, Bild aus en', [cb.setName, cb.setSize, cb.lang, !!cb.image], ['Grundset', 102, 'de', true]);
  t.ok('Grund ohne Nummer', /nicht eindeutig/.test(gl.reason), gl.reason);
  t.eq('4: Mewtu -> englisch übersetzt', [idOf('Mewtu'), get('Mewtu').card.dataLang], ['old9-007', 'en']);
  t.eq('4: Name + Nummer ohne Set', items.find(it => it.values.name === 'Despotar' && it.values.number === '88').card.id, 'hgss2-88');
  t.eq('4: nichts gefunden', [get('Unbekannt').status, get('Unbekannt').candidates.length], ['nicht gefunden', 0]);
  const pk = items.find(it => it.values.name === 'Pikachu' && !it.values.number);
  t.ok('4: zu viele Treffer', pk.status === 'nicht gefunden' && /zu viele Treffer/i.test(pk.reason), pk);
  const g77 = items.find(it => it.values.number === '77');
  t.ok('falsche Nummer -> unklar mit Namenstreffern im Set', g77.status === 'unklar' && g77.candidates.length === 2 && /Nummer/.test(g77.reason), g77);
  const gx = items.find(it => it.values.set === 'Gibt es nicht');
  t.ok('unbekanntes Set: Name + Nummer reichen', gx.card && gx.card.id === 'base1-4', gx);
  const nope = items.find(it => it.values.tcgdexId === 'nope-1');
  t.eq('falsche tcgdex-ID, Set + Nummer greifen', nope.card && nope.card.id, 'swsh3-136');
  const dit = items.find(it => it.values.number === 'DS 62');
  t.eq('doppelte Zeile zusammengefasst', [dit.qty, dit.srcRows, dit.values.extras], [2, [12, 29], { Ordner: 'Ordner 2 / Ordner 3' }]);

  // Karten-JSON
  const f1 = get('Falscher Name');
  t.eq('Karten-JSON: genau die Felder', Object.keys(f1.card).sort(), CARD_KEYS);
  t.eq('Karten-JSON: Inhalt', [f1.card.dataLang, f1.card.name, f1.card.nameEn, f1.card.setId, f1.card.setName, f1.card.localId,
    f1.card.setSize, f1.card.baseVariant, f1.card.variant, f1.card.price, f1.card.priceDate],
    ['de', 'Glurak', 'Charizard', 'swsh3', 'Flammende Finsternis', '136', 189, 'normal', 'normal', 1.5, '2026-10-13']);
  t.ok('Karten-JSON: Erscheinungsdatum', /^\d{4}-\d{2}-\d{2}$/.test(f1.card.setDate), f1.card.setDate);
  t.eq('Werte: Preis, Datum, Zusatz, roh', [f1.values.price, f1.values.priceDate, f1.values.extras.Ordner, f1.values.raw.name],
    [1, '01.10.2026', 'Ordner 1', 'Falscher Name']);
  t.eq('alte Karte: Bild aus en, Holo', [g4.card.img, g4.card.variant, g4.card.price], ['https://assets.tcgdex.net/en/x/base1-4', 'holo', 1.5]);
  t.eq('nur englische Daten', [get('Arktos').card.dataLang, get('Arktos').card.name, get('Arktos').card.nameEn], ['en', 'Articuno', 'Articuno']);

  // Zähler und Stufe
  t.eq('Zähler', res.counts, { eindeutig: 22, unklar: 3, nichtGefunden: 2, uebersprungen: 0, bekannt: 0 });
  t.eq('Stufe nach Erkennung: Prüfung', c.importDraft_().stage, 'pruefung');
  const again = env.uiCall('importRecognizeStep');
  t.eq('weiterer Schritt ändert nichts', [again.done, again.pos], [true, 27]);
  t.eq('keine Abrufe in der Sperre', env.fetchInLock, []);
  t.eq('Sperre nie verschachtelt', env.lock.nested, 0);

  // gleiche Namen im selben Schritt: tcgdex-Namenssuche nur einmal
  setSource(env, [HEAD, ['Glurak', '', '', '', '', '', '', 'A'], ['Glurak', '77', 'Flammende Finsternis', '', '', '', '', ''],
    ['Glurak', '78', 'Flammende Finsternis', '', '', '', '', '']], 'SRC9');
  env.uiCall('importStartRecognition', listCfg(), '', 'alle');
  env.fetchLog.length = 0;
  recognizeAll(env);
  t.eq('Namenssuche Glurak (de) einmal', env.fetchLog.filter(u => /\/de\/cards\?name=Glurak/.test(u)).length, 1);
  t.ok('Namenssuche Glurak (en) höchstens einmal', env.fetchLog.filter(u => /\/en\/cards\?name=Glurak/.test(u)).length <= 1);
}

// ---------------------------------------------------------------------------
// F. Schritte: 40 Einträge, 4 Minuten, Fortsetzen, Ausfall von tcgdex
// ---------------------------------------------------------------------------
t.section('Schritte');
{
  const env = makeEnv();
  const c = env.ctx;
  const rows = [HEAD];
  for (let i = 1; i <= 95; i++) rows.push(['Karte ' + i, '', '', '', '', '', i % 2 ? 'swsh3-025' : 'base1-4', '']);
  setSource(env, rows, 'SRC2');
  const st = env.uiCall('importStartRecognition', listCfg(), '', 'alle');
  t.eq('95 Einträge', st.total, 95);
  t.eq('Modus alle', c.importDraft_().mode, 'alle');
  let r = env.uiCall('importRecognizeStep');
  t.eq('Schritt 1: 40', [r.done, r.pos, r.total, r.counts.eindeutig], [false, 40, 95, 40]);
  t.eq('Entwurf merkt die Position', c.importDraft_().recognizePos, 40);
  t.eq('Kartendetails in Paketen zu 20', env.fetchAllSizes.filter(n => n > 2).every(n => n <= 20), true);
  // Uhr: jede Abfrage 30 Sekunden später -> nach 4 Minuten Schluss
  let now = 1e12;
  c.erNow_ = function () { now += 30000; return now; };
  r = env.uiCall('importRecognizeStep');
  t.ok('Schritt 2 stoppt nach 4 Minuten', !r.done && r.pos > 40 && r.pos < 80, r);
  const p2 = r.pos;
  c.erNow_ = function () { return Date.now(); };
  r = env.uiCall('importRecognizeStep');
  t.eq('Schritt 3 macht weiter', r.pos, Math.min(95, p2 + 40));
  // tcgdex fällt aus
  env.fetchFail = () => 'throw';
  const before = c.importDraft_().recognizePos;
  t.ok('noch Einträge übrig für den Ausfall-Test', r.pos < 95, r.pos);
  t.throws('Ausfall: deutscher Fehler', () => env.uiCall('importRecognizeStep'), /tcgdex ist gerade nicht erreichbar/);
  t.eq('Ausfall: Position bleibt', c.importDraft_().recognizePos, before);
  env.fetchFail = null;
  r = recognizeAll(env);
  t.eq('am Ende fertig', [r.done, r.pos, r.counts.eindeutig], [true, 95, 95]);
  t.eq('ohne Unklares direkt zur Vorschau', c.importDraft_().stage, 'vorschau');
  t.ok('alle mit Karte', c.reviewRead_().every(it => it.status === 'eindeutig' && it.card && it.card.id));
  t.eq('Modus alle: kein coverageFor_', env.coverageCalls, 0);
  t.eq('keine Abrufe in der Sperre', env.fetchInLock, []);

  // Ausfall erst beim Abruf der Kartendetails (Set-Listen kommen noch)
  setSource(env, [HEAD, ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', ''], ['Despotar', '88', 'Entfesselt', '', '', '', '', '']], 'SRC2');
  env.uiCall('importStartRecognition', listCfg(), '', 'alle');
  env.fetchFail = u => (/\/cards\//.test(u) ? 'throw' : null);
  t.throws('Ausfall bei den Details: deutscher Fehler', () => env.uiCall('importRecognizeStep'), /tcgdex ist gerade nicht erreichbar/);
  t.eq('Ausfall bei den Details: nichts gespeichert', [c.importDraft_().recognizePos, c.reviewRead_().map(x => x.status)], [0, ['offen', 'offen']]);
  env.fetchFail = null;
  t.eq('danach klappt es', recognizeAll(env).counts.eindeutig, 2);

  // veralteter Schritt (Position hat sich inzwischen geändert) schreibt nichts
  setSource(env, [HEAD, ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', ''], ['Mewtu', '', '', '', '', '', '', '']], 'SRC2');
  env.uiCall('importStartRecognition', listCfg(), '', 'alle');
  const origSave = c.importSaveDraft_;
  let hijack = true;
  const origRead = c.reviewRead_;
  c.reviewRead_ = function () {
    const out = origRead();
    if (hijack) { hijack = false; const d = c.importDraft_(); d.recognizePos = 2; d.stage = 'vorschau'; origSave(d); }
    return out;
  };
  r = env.uiCall('importRecognizeStep');
  c.reviewRead_ = origRead;
  t.ok('veralteter Schritt: nichts geschrieben', origRead().every(it => it.status === 'offen'), origRead().map(i => i.status));
  t.eq('veralteter Schritt: meldet den aktuellen Stand', [r.done, r.pos], [true, 2]);
}

// ---------------------------------------------------------------------------
// G. Nur Neues: 'bekannt' über coverageFor_; Checkliste
// ---------------------------------------------------------------------------
t.section('Bekannt und Checkliste');
{
  const env = makeEnv();
  const c = env.ctx;
  const rows = [HEAD,
    ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', ''],
    ['Glurak', '136', 'Flammende Finsternis', '', '', '', '', ''],
    ['Glurak', '136', 'Flammende Finsternis', '', '', '', '', ''],
    ['Glurak', '4', 'Grundset', '', '', '', '', ''],
    ['Despotar', '88', 'Entfesselt', '', '', '', '', '']];
  setSource(env, rows, 'SRC3');
  env.uiCall('importStartRecognition', listCfg(), '', 'neu');
  const it = c.reviewRead_();
  const fp = n => it.find(x => x.values.number === n).fp;
  env.coverage.SRC3 = {};
  env.coverage.SRC3[fp('25')] = { D: 1, Rundone: 0, Rall: 0, held: 1, rows: [] };      // 1 >= 1 -> bekannt
  env.coverage.SRC3[fp('136')] = { D: 1, Rundone: 0, Rall: 0, held: 1, rows: [] };     // 1 < 2 -> erkennen
  env.coverage.SRC3[fp('4')] = { D: 0, Rundone: 1, Rall: 1, held: 0, rows: [] };       // von Hand entfernt -> bekannt
  env.fetchLog.length = 0;
  const r = recognizeAll(env);
  const after = c.reviewRead_();
  const st = n => after.find(x => x.values.number === n).status;
  t.eq('bekannt: D deckt Menge', st('25'), 'bekannt');
  t.eq('nicht bekannt: Menge 2, D 1', st('136'), 'eindeutig');
  t.eq('bekannt: Rundone zählt', st('4'), 'bekannt');
  t.eq('nicht in coverage -> erkannt', st('88'), 'eindeutig');
  t.eq('Zähler bekannt', r.counts.bekannt, 2);
  t.ok('bekannte Zeilen ohne API-Abruf', !env.fetchLog.some(u => /swsh3-025|base1-4|sets\/base1/.test(u)), env.fetchLog);
  t.eq('coverageFor_ einmal pro Schritt', env.coverageCalls, 1);

  // Checkliste: nicht angehakte Zeilen als 'übersprungen' (Menge 0) in der Prüfung
  const ck = listCfg({ form: 'checkliste', cols: Object.assign({}, listCfg().cols, { check: 8 }) });
  setSource(env, [HEAD.concat(['Vorhanden']),
    ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', '', 'WAHR'],
    ['Glurak', '136', 'Flammende Finsternis', '', '', '', '', '', 'FALSCH'],
    ['Glurak', '136', 'Flammende Finsternis', '', '', '', '', '', ''],
    ['Glurak', '4', 'Grundset', '', '', '', '', '', 'FALSE'],
    ['Glurak', '4', 'Grundset', '', '', '', '', '', 'x']], 'SRC4');
  const s2 = env.uiCall('importStartRecognition', ck, 'Checkliste', 'abgleich');
  t.eq('Checkliste: Zähler', s2.skipped, { summe: 0, leer: 0, nichtAngehakt: 3 });
  const rv = c.reviewRead_();
  const sk = rv.filter(x => x.status === 'übersprungen');
  t.eq('nicht angehakt: ein Eintrag (136), Menge 0, Grund', sk.map(x => [x.values.number, x.qty, x.reason, x.srcRows]),
    [['136', 0, 'nicht angehakt', [3, 4]]]);
  t.eq('angehakt schlägt nicht angehakt bei gleichem Fingerabdruck', rv.filter(x => x.values.number === '4').map(x => [x.status, x.qty]), [['offen', 1]]);
  const r2 = recognizeAll(env);
  t.eq('Checkliste erkannt', r2.counts, { eindeutig: 2, unklar: 0, nichtGefunden: 0, uebersprungen: 1, bekannt: 0 });
  t.eq('übersprungen bleibt übersprungen', c.reviewRead_().find(x => x.values.number === '136').status, 'übersprungen');
}

// ---------------------------------------------------------------------------
// H. Prüfliste, Entscheidungen, Antworten, Vorbelegung
// ---------------------------------------------------------------------------
t.section('Prüfliste und Antworten');
{
  const env = makeEnv();
  const c = env.ctx;
  env.uiCall('importSetsVorbelegen');
  const rows = [HEAD,
    ['Glurak', '', '', '', '', '', '', ''],                      // unklar (3)
    ['', 'DP 16', '', '', '', '', '', ''],                       // unklar (2)
    ['Unbekannt', '12', 'Selbstgemacht', '', '3,00 €', '', '', ''], // nicht gefunden
    ['Pikachu', '', '', '', '', '', '', ''],                     // zu viele Treffer
    ['Despotar', '88', 'Entfesselt', '', '', '', '', '']];       // eindeutig
  setSource(env, rows, 'SRC5');
  env.uiCall('importStartRecognition', listCfg(), '', 'neu');
  recognizeAll(env);
  let list = env.uiCall('importReviewList');
  t.eq('Liste: nur unklar / nicht gefunden', [list.total, list.open, list.items.length], [4, 4, 4]);
  t.eq('Liste: Form eines Eintrags', Object.keys(list.items[0]).sort(),
    ['candidates', 'card', 'confirmed', 'decision', 'fp', 'prefilled', 'qty', 'reason', 'srcRows', 'status', 'values']);
  const fpOf = name => list.items.find(x => x.values.name === name).fp;
  const fpDp = list.items.find(x => x.values.number === 'DP 16').fp;

  // Karte wählen
  let d = env.uiCall('importReviewDecide', fpOf('Glurak'), { type: 'karte', id: 'swsh3-025', lang: 'de' });
  t.eq('Karte: Karten-JSON', Object.keys(d.item.card).sort(), CARD_KEYS);
  t.eq('Karte: Inhalt', [d.item.card.id, d.item.card.variant, d.item.card.price, d.item.confirmed, d.item.prefilled, d.open],
    ['swsh3-025', 'normal', 1.5, true, false, 3]);
  t.eq('Karte: Entscheidung', d.item.decision, { type: 'karte', id: 'swsh3-025', lang: 'de' });
  let ans = c.answersLoad_('SRC5');
  t.eq('Antwort sofort gespeichert', [ans[fpOf('Glurak')].decision.id, ans[fpOf('Glurak')].card.id], ['swsh3-025', 'swsh3-025']);
  // Variante wählen
  d = env.uiCall('importReviewDecide', fpDp, { type: 'karte', id: 'dpp-DP16', lang: 'en', variant: 'reverse' });
  t.eq('Karte mit Variante reverse', [d.item.card.variant, d.item.card.price, d.item.card.dataLang, d.item.decision.variant], ['reverse', 3.25, 'en', 'reverse']);
  // frei
  d = env.uiCall('importReviewDecide', fpOf('Unbekannt'), { type: 'frei' });
  t.eq('frei: Karten-JSON', d.item.card, { free: true, name: 'Unbekannt', setName: 'Selbstgemacht', localId: '12' });
  t.eq('frei: auflösbar', c.reviewResolve_(c.reviewRead_().find(x => x.fp === fpOf('Unbekannt'))).kind, 'free');
  // überspringen
  d = env.uiCall('importReviewDecide', fpOf('Pikachu'), { type: 'skip' });
  t.eq('skip', [d.item.decision, d.item.card, d.open], [{ type: 'skip' }, null, 0]);
  t.eq('skip: auflösbar', c.reviewResolve_(c.reviewRead_().find(x => x.fp === fpOf('Pikachu'))).kind, 'skip');
  // zurücksetzen
  d = env.uiCall('importReviewDecide', fpOf('Pikachu'), { type: '' });
  t.eq('zurückgesetzt', [d.item.decision, d.item.confirmed, d.open], [null, false, 1]);
  t.ok('Antwort gelöscht', !c.answersLoad_('SRC5')[fpOf('Pikachu')]);
  env.uiCall('importReviewDecide', fpOf('Pikachu'), { type: 'skip' });
  t.throws('unbekannte Zeile', () => env.uiCall('importReviewDecide', 'ffffffffffff', { type: 'skip' }), /Prüfliste/);
  t.throws('unbekannte Karte', () => env.uiCall('importReviewDecide', fpOf('Glurak'), { type: 'karte', id: 'gibts-nicht' }), /nicht gefunden/);
  t.throws('unbekannte Entscheidung', () => env.uiCall('importReviewDecide', fpOf('Glurak'), { type: 'vielleicht' }), /Unbekannte Entscheidung/);
  list = env.uiCall('importReviewList');
  t.eq('alles entschieden', list.open, 0);

  // Suche
  const s1 = env.uiCall('importReviewSearch', fpOf('Glurak'), { name: 'Glurak', number: '4' });
  const s2 = c.searchCards({ name: 'Glurak', number: '4' });
  t.eq('Suche = searchCards', JSON.parse(JSON.stringify(s1)), JSON.parse(JSON.stringify(s2)));
  const s3 = env.uiCall('importReviewSearch', fpOf('Glurak'), {});
  t.eq('Suche ohne Eingabe: Werte der Zeile', s3.cards.length, 3);

  // gleiche Quelle noch einmal: Vorbelegung
  env.uiCall('importStartRecognition', listCfg(), '', 'neu');
  recognizeAll(env);
  list = env.uiCall('importReviewList');
  const pre = list.items.filter(x => x.prefilled);
  t.eq('vorbelegt: alle vier', pre.length, 4);
  t.ok('vorbelegt: nicht bestätigt, offen', pre.every(x => !x.confirmed) && list.open === 4, list.open);
  const pg = list.items.find(x => x.values.name === 'Glurak');
  t.eq('vorbelegt: Entscheidung und Karte kopiert', [pg.decision.id, pg.card.id, pg.status], ['swsh3-025', 'swsh3-025', 'unklar']);
  t.eq('vorbelegt: frei', list.items.find(x => x.values.name === 'Unbekannt').card.free, true);
  t.eq('eindeutige nicht vorbelegt', c.reviewRead_().find(x => x.values.name === 'Despotar').prefilled, false);
  t.eq('vorbelegte Entscheidung gilt (reviewResolve_)', c.reviewResolve_(c.reviewRead_().find(x => x.values.name === 'Glurak')).kind, 'card');
  const acc = env.uiCall('importReviewAcceptPrefilled');
  t.eq('alle übernommen', acc.open, 0);
  t.ok('jetzt bestätigt', env.uiCall('importReviewList').items.every(x => x.confirmed && x.prefilled));
  // andere Quelle bekommt die Antworten nicht
  setSource(env, rows, 'SRC6');
  env.uiCall('importStartRecognition', listCfg(), '', 'neu');
  recognizeAll(env);
  t.eq('andere Quelle: keine Vorbelegung', env.uiCall('importReviewList').items.filter(x => x.prefilled && !x.decision.auto).length, 0);

  // Antworten überleben das Verwerfen des Entwurfs
  c.importResetDraft_();
  t.ok('Antworten bleiben nach dem Verwerfen', Object.keys(c.answersLoad_('SRC5')).length === 4);
  t.throws('ohne Entwurf: deutscher Fehler', () => env.uiCall('importRecognizeStep'), /kein Import in Arbeit/);
  t.throws('ohne Entwurf: Entscheidung', () => env.uiCall('importReviewDecide', 'x', { type: 'skip' }), /kein Import in Arbeit/);
  t.eq('keine Abrufe in der Sperre', env.fetchInLock, []);
  t.eq('Sperre nie verschachtelt', env.lock.nested, 0);
}

// ---------------------------------------------------------------------------
// I. ensureSchema_ zuerst, Quelle-Attrappe auch ohne Teil „Quelle“
// ---------------------------------------------------------------------------
t.section('Rahmen');
{
  const env = makeEnv();
  const c = env.ctx;
  let calls = 0;
  const orig = c.ensureSchema_;
  c.ensureSchema_ = function () { calls++; t.eq('ensureSchema_ außerhalb der Sperre', env.lock.depth, 0); return orig(); };
  setSource(env, [HEAD, ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', '']], 'SRC7');
  env.uiCall('importStartRecognition', listCfg(), '', '');
  env.uiCall('importRecognizeStep');
  env.uiCall('importReviewList');
  env.uiCall('importReviewAcceptPrefilled');
  t.eq('ensureSchema_ in jeder öffentlichen Funktion', calls, 4);
  t.eq('leerer Modus -> neu', c.importDraft_().mode, 'neu');
  c.importSetRun_(5, 'commit');
  t.throws('während eines Imports kein Neustart der Erkennung', () => env.uiCall('importStartRecognition', listCfg(), '', 'neu'), /Gerade läuft schon/);
  c.importClearRun_();
  t.throws('ohne Zuordnung', () => { const d = c.importDraft_(); d.cfg = null; c.importSaveDraft_(d); env.uiCall('importStartRecognition', null, '', 'neu'); }, /Zuordnung/);

  // Teil ohne „Quelle“ (Attrappe) lädt und erkennt
  const env2 = makeEnv({ noQuelle: true });
  setSource(env2, [HEAD, ['Glurak', '25', 'Flammende Finsternis', '', '', '', '', ''], ['SUMME', '', '', '', '1,50 €', '', '', '']], 'SRC8');
  const s = env2.uiCall('importStartRecognition', listCfg(), '', 'neu');
  const r = recognizeAll(env2);
  t.eq('ohne Teil Quelle: erkannt', [s.total, s.skipped.summe, r.counts.eindeutig], [1, 1, 1]);
  // Begriffe ohne Blatt: Vorbelegung
  env2.ss.deleteSheet(env2.ss.getSheetByName('Import-Begriffe'));
  t.ok('ohne Blatt: Standard-Begriffe', env2.ctx.loadTerms_().some(x => x.term === 'Rev Holo'));
}

// ---------------------------------------------------------------------------
// J. Weitere Fälle: Reihenfolge der Stufen, Set als Kürzel, gleichnamige Karten, 24/25 Kandidaten,
//    verlinkte Namen, Snowflake und 1. Edition, Suche in der Prüfliste
// ---------------------------------------------------------------------------
t.section('Weitere Fälle');
{
  const env = makeEnv();
  const c = env.ctx;
  env.uiCall('importSetsVorbelegen');
  // Namenssuche „Despotar“ findet auch „Despotar-ex“ mit derselben Nummer in einem anderen Set
  env.DB['de/cards?name=Despotar'] = [{ id: 'hgss2-88', localId: '88', name: 'Despotar' }, { id: 'sv9-88', localId: '88', name: 'Despotar-ex' }];
  // genau 24 und 25 Treffer
  env.DB['de/cards?name=Evoli'] = Array.from({ length: 24 }, (_, i) => ({ id: 'evx-' + (i + 1), localId: String(i + 1), name: 'Evoli' }));
  env.DB['de/cards?name=Flegmon'] = Array.from({ length: 25 }, (_, i) => ({ id: 'flx-' + (i + 1), localId: String(i + 1), name: 'Flegmon' }));
  env.DB['en/cards?name=Evoli'] = [];
  env.DB['en/cards?name=Flegmon'] = [];
  const terms = c.loadTerms_();
  const cfg = listCfg();

  // verlinkte Zellen: der Link gehört nicht zum Namen
  const exr = raw => c.extractRow_({ srcRows: [2], raw, extrasRaw: {} }, cfg, terms);
  let f = exr({ name: 'Glurak ' + CM + 'Darkness-Ablaze/Charizard-DAA136', cmLink: '' });
  t.eq('Link im Namen: Name ohne Link, Link als Cardmarket-Link', [f.name, f.nameClean, f.cmUrl], ['Glurak', 'Glurak', CM + 'Darkness-Ablaze/Charizard-DAA136']);
  f = exr({ name: 'Glurak https://www.pricecharting.com/game/x/charizard-4', number: '4 https://example.org/x' });
  t.eq('fremder Link im Namen: entfernt, kein Cardmarket-Link', [f.nameClean, f.number, f.cmUrl], ['Glurak', '4', '']);
  f = exr({ name: 'Glurak ' + CM + 'Base-Set/Charizard-BS4', cmLink: CM + 'Darkness-Ablaze/Charizard-DAA136' });
  t.eq('Link-Spalte hat Vorrang', f.cmUrl, CM + 'Darkness-Ablaze/Charizard-DAA136');
  f = exr({ name: CM + 'Darkness-Ablaze/Charizard-DAA136' });
  t.eq('nur ein Link im Namen: nicht leer', [f.name, f.skip, !!f.cmUrl], ['', null, true]);
  t.eq('Fingerabdruck unabhängig vom Link-Text im Namen',
    c.fingerprint_(exr({ name: 'Glurak', number: '4', set: 'Grundset' })),
    c.fingerprint_(exr({ name: 'Glurak https://www.pricecharting.com/x', number: '4', set: 'Grundset' })));

  const rows = [HEAD,
    // Review RECOG-2: Link zeigt auf Despotar, Name + Set + Nummer auf Gengar -> Widerspruch, Prüfliste (Gengar zuerst)
    ['Gengar', '5', 'Fossil', CM + 'Unleashed/Tyranitar-UL88', '', '', '', ''],
    // Review RECOG-2: Set + Nummer ergeben Despotar, die Zeile heißt Pikachu -> Prüfliste, nur Despotar als Kandidat
    // (der Name allein hätte viel zu viele Treffer)
    ['Pikachu', '88', 'Entfesselt', '', '', '', '', ''],
    // Set als Kürzel
    ['Despotar', '88', 'UL', '', '', '', '', ''],
    // Name + Nummer ohne Set: „Despotar-ex“ hat dieselbe Nummer, der genaue Name gewinnt
    ['Despotar', '88', '', '', '', '', '', ''],
    // ohne Nummer gibt es keinen Vorzug: unklar
    ['Despotar', '', '', '', '', '', '', ''],
    // 24 Treffer: unklar mit allen; 25: nicht gefunden
    ['Evoli', '', '', '', '', '', '', ''],
    ['Flegmon', '', '', '', '', '', '', ''],
    // Snowflake (Cardmarket V3) und 1. Edition
    ['Pikachu Snowflake', '78', 'HeartGold & SoulSilver', CM + 'HeartGold-SoulSilver/Pikachu-V3-HS78', '0,80 €', '13.10.2026', '', ''],
    ['Glurak 1. Edition', '4', 'Grundset', '', '', '', '', ''],
    // Link nur im (verlinkten) Namen
    ['Glurak ' + CM + 'Darkness-Ablaze/Charizard-DAA136', '', '', '', '', '', '', ''],
    // isReverseHolo=Y, Kürzel unbekannt (FO), Set aus dem Link-Namen
    ['Gengar', '', '', CM + 'Fossil/Gengar-FO5?isReverseHolo=Y', '', '', '', ''],
    // nur Kürzel und Nummer
    ['', 'DS 62', '', '', '', '', '', '']
  ];
  setSource(env, rows, 'SRC10');
  const st = env.uiCall('importStartRecognition', listCfg(), '', 'Alles addieren');
  t.eq('Modus aus dem Anzeigenamen', c.importDraft_().mode, 'alle');
  t.eq('alle Zeilen einzeln', st.total, 12);
  const res = recognizeAll(env);
  const items = c.reviewRead_();
  const row = n => items.find(it => it.srcRows[0] === n);
  t.eq('Link widerspricht Name: unklar, passende Karte zuerst', [row(2).status, row(2).candidates.map(x => x.id), row(2).reason],
    ['unklar', ['base3-5', 'hgss2-88'], 'Name passt nicht zum Cardmarket-Link.']);
  t.eq('Set + Nummer widersprechen Name: unklar mit dem Treffer', [row(3).status, row(3).candidates.map(x => x.id), /^Name passt nicht zu Set und Nummer\./.test(row(3).reason)],
    ['unklar', ['hgss2-88'], true]);
  t.eq('Set als Kürzel (UL)', row(4).card && row(4).card.id, 'hgss2-88');
  t.eq('gleiche Nummer: genauer Name gewinnt', [row(5).status, row(5).card && row(5).card.id], ['eindeutig', 'hgss2-88']);
  t.eq('ohne Nummer kein Vorzug', [row(6).status, row(6).candidates.map(x => x.id).sort()], ['unklar', ['hgss2-88', 'sv9-88']]);
  t.eq('24 Treffer: unklar mit 24 Kandidaten', [row(7).status, row(7).candidates.length], ['unklar', 24]);
  t.ok('24 Treffer: Grund', /nicht eindeutig/.test(row(7).reason), row(7).reason);
  t.eq('25 Treffer: nicht gefunden, zu viele Treffer', [row(8).status, row(8).candidates.length, /zu viele Treffer \(25\)/i.test(row(8).reason)],
    ['nicht gefunden', 0, true]);
  const sn = row(9);
  t.eq('Snowflake: Karte, Version, Name', [sn.card && sn.card.id, sn.values.version, sn.values.nameClean, sn.card && sn.card.variant],
    ['hgss1-78', 'Snowflake', 'Pikachu', 'normal']);
  t.eq('Snowflake: Preis der Quelle in den Werten', [sn.values.price, sn.values.priceDate], [0.8, '13.10.2026']);
  const fe = row(10);
  t.eq('1. Edition: Karte, Variante, Preis', [fe.card && fe.card.id, fe.card && fe.card.variant, fe.card && fe.card.price], ['base1-4', 'firstEdition', 1.5]);
  t.eq('verlinkter Name: erkannt über den Link', [row(11).values.nameClean, row(11).card && row(11).card.id], ['Glurak', 'swsh3-136']);
  t.eq('isReverseHolo mit unbekanntem Kürzel', [row(12).card && row(12).card.id, row(12).card && row(12).card.variant], ['base3-5', 'reverse']);
  t.eq('nur Kürzel und Nummer', row(13).card && row(13).card.id, 'ex11-62');
  t.eq('Zähler', res.counts, { eindeutig: 7, unklar: 4, nichtGefunden: 1, uebersprungen: 0, bekannt: 0 });
  t.eq('Werte: rohe Texte bleiben', row(11).values.raw.name, 'Glurak ' + CM + 'Darkness-Ablaze/Charizard-DAA136');

  // Suche in der Prüfliste: Kürzel + Nummer und Cardmarket-Setnamen
  const sDs = env.uiCall('importReviewSearch', row(13).fp, {});
  t.eq('Suche ohne Eingabe: "DS 62" -> Set ex11, Nummer 62', sDs.cards.map(x => x.id), ['ex11-62']);
  const sEx = env.uiCall('importReviewSearch', row(13).fp, { name: 'Ditto', number: '62', set: 'EX Delta Species' });
  t.eq('Suche: "EX Delta Species" -> ex11', sEx.cards.map(x => x.id), ['ex11-62']);
  const sUl = env.uiCall('importReviewSearch', row(4).fp, { name: '', number: 'UL88', set: 'Unleashed' });
  t.eq('Suche: Kürzel in der Nummer', sUl.cards.map(x => x.id), ['hgss2-88']);
  t.eq('erSearchInput_: nur Name bleibt', JSON.parse(JSON.stringify(c.erSearchInput_({ name: 'Glurak' }, c.loadCmSets_()))),
    { name: 'Glurak', number: '', set: '' });
  // Review RECOG-5: mehrdeutig bleibt mehrdeutig (kein Set), die Nummer wird aber zusammen geschrieben wie bei tcgdex
  t.eq('erSearchInput_: mehrdeutig bleibt', JSON.parse(JSON.stringify(c.erSearchInput_({ name: 'Pikachu', number: 'DP 16' }, c.loadCmSets_()))),
    { name: 'Pikachu', number: 'DP16', set: '' });
  t.eq('erSearchInput_: bekannter Set-Text bleibt', JSON.parse(JSON.stringify(c.erSearchInput_({ name: 'Glurak', number: '4', set: 'Grundset' }, c.loadCmSets_()))),
    { name: 'Glurak', number: '4', set: 'Grundset' });
  t.eq('keine Abrufe in der Sperre', env.fetchInLock, []);
  t.eq('Sperre nie verschachtelt', env.lock.nested, 0);

  // keine einzige Karte in der Zuordnung: deutscher Fehler, Entwurf und Prüfung bleiben
  const before = JSON.stringify(c.importDraft_());
  const nRev = c.reviewRead_().length;
  setSource(env, [HEAD, ['', '', '', '', '', '', '', ''], ['SUMME', '', '', '', '3,00 €', '', '', '']], 'SRC11');
  const draftNow = JSON.stringify(c.importDraft_());
  t.throws('nichts Importierbares -> Fehler', () => env.uiCall('importStartRecognition', listCfg(), '', 'abgleich'),
    /keine Karte gefunden \(2 Zeilen gelesen, 1 Summen, 1 leer\)/);
  t.eq('Fehler ändert Entwurf und Prüfung nicht', [JSON.stringify(c.importDraft_()), c.reviewRead_().length], [draftNow, nRev]);
  t.ok('vorheriger Entwurf war ein anderer', before !== draftNow);
}

t.done();
