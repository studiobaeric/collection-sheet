'use strict';
/**
 * Ende-zu-Ende-Test der Serverseite: echtes Code.gs + gebautes Import.gs (harness2, ohne Netz).
 * Erfundene Sammlung im Aufbau von Erics alter Excel-Datei (Karte Name | Setnummer | Cardmarket | Set |
 * 30 Tage Preistrend | Datum Preis-Daten | Spalte 1), dazu passende erfundene tcgdex-Daten.
 * Start: node test_import_e2e.js   (Exit-Code 1 bei Fehlern)
 */
const H = require('./harness2');
const t = H.runner('import-e2e');

/* ---------------------------------------------------------------------------
 * Erfundene tcgdex-Welt
 * ------------------------------------------------------------------------- */

const SETS = {
  dp1: { en: 'Diamond & Pearl', de: 'Diamant & Perl', official: 130, total: 130, date: '2007-05-23' },
  dpp: { en: 'DP Black Star Promos', de: 'DP Black Star Promos', official: 56, total: 56, date: '2007-05-01' },
  ex11: { en: 'Delta Species', de: 'EX Delta Species', official: 113, total: 114, date: '2005-10-31' },
  hgss1: { en: 'HeartGold & SoulSilver', de: 'HeartGold & SoulSilver', official: 123, total: 124, date: '2010-02-10', abbr: 'HS' },
  hgss2: { en: 'Unleashed', de: 'Entfesselt', official: 95, total: 96, date: '2010-05-12', abbr: 'UL' },
  hgss3: { en: 'Undaunted', de: 'Unerschrocken', official: 90, total: 91, date: '2010-08-18' },
  hgssp: { en: 'HGSS Black Star Promos', de: 'HGSS Black Star Promos', official: 25, total: 25, date: '2010-02-01' },
  pl3: { en: 'Supreme Victors', de: 'Ultimative Sieger', official: 147, total: 153, date: '2009-08-19' },
  swsh3: { en: 'Darkness Ablaze', de: 'Flammende Finsternis', official: 189, total: 201, date: '2020-08-14' },
  base1: { en: 'Base Set', de: 'Grundset', official: 102, total: 102, date: '1999-01-09' }
};

const NORMAL = { normal: true, reverse: true, holo: false, firstEdition: false };
const HOLO = { normal: false, reverse: true, holo: true, firstEdition: false };

/** [id, de-Name, en-Name, Varianten, Preise ({trend, holo} | null = tcgdex hat keinen Preis)] */
const CARDS = [
  ['dp1-16', 'Panferno', 'Infernape', HOLO, { trend: 2, holo: 2.4 }],
  ['dpp-DP12', 'Plaudagei', 'Chatot', HOLO, null],
  ['dpp-DP16', 'Lucario', 'Lucario', HOLO, { trend: 4, holo: 4 }],
  ['ex11-12', 'Dragoran', 'Dragonite', HOLO, { trend: 10, holo: 10 }],
  ['ex11-62', 'Ditto', 'Ditto', NORMAL, { trend: 6.5, holo: 7 }],
  ['hgss1-5', 'Gengar', 'Gengar', HOLO, { trend: 8, holo: 9 }],
  ['hgss1-59', 'Endivie', 'Chikorita', NORMAL, null],
  ['hgss1-61', 'Feurigel', 'Cyndaquil', NORMAL, { trend: 0.3, holo: 0.9 }],
  ['hgss1-78', 'Pikachu', 'Pikachu', NORMAL, { trend: 0.5, holo: 1.5 }],
  ['hgss1-81', 'Karnimani', 'Totodile', NORMAL, { trend: 0.25, holo: 0.75 }],
  ['hgss1-111', 'Lugia', 'Lugia', HOLO, { trend: 15, holo: 15 }],
  ['hgss2-40', 'Kramurx', 'Murkrow', NORMAL, { trend: 0.2, holo: 0.6 }],
  ['hgss2-88', 'Despotar', 'Tyranitar', HOLO, { trend: 3.5, holo: 4 }],
  ['hgss3-20', 'Starmie', 'Starmie', NORMAL, { trend: 0.4, holo: 1.2 }],
  ['hgss3-60', 'Mampfaxo', 'Munchlax', NORMAL, { trend: 0.3, holo: 0.8 }],
  ['hgss3-82', 'Hundemon', 'Houndoom', NORMAL, { trend: 0.8, holo: 1.6 }],
  ['hgssp-HGSS01', 'Ho-Oh', 'Ho-Oh', HOLO, { trend: 5, holo: 5 }],
  ['pl3-50', 'Galagladi', 'Gallade', NORMAL, { trend: 1, holo: 2 }],
  ['pl3-148', 'Arktos', 'Articuno', HOLO, { trend: 2.2, holo: 2.2 }]
];

function localIdOf(id) { return id.slice(id.indexOf('-') + 1); }
function setOf(id) { return id.slice(0, id.indexOf('-')); }

function tcgCard(row, lang) {
  const [id, de, en, variants, price] = row;
  const s = SETS[setOf(id)];
  const c = {
    id, localId: localIdOf(id), name: lang === 'de' ? de : en, image: 'https://assets.tcgdex.net/' + lang + '/x/' + setOf(id) + '/' + localIdOf(id),
    category: 'Pokemon', rarity: 'Rare', illustrator: 'Erfundene Zeichnerin',
    set: { id: setOf(id), name: s[lang], cardCount: { official: s.official, total: s.total } },
    variants: Object.assign({}, variants)
  };
  if (price) c.pricing = { cardmarket: { trend: price.trend, 'trend-holo': price.holo, updated: '2026-10-13T00:00:00Z' } };
  return c;
}

function makeDb() {
  const db = H.defaultDb(); // Glurak-Kandidaten (swsh3, base1) bleiben
  db['de/sets'] = [];
  db['en/sets'] = [];
  Object.keys(SETS).forEach((id) => {
    const s = SETS[id];
    ['de', 'en'].forEach((lang) => {
      db[lang + '/sets'].push({ id, name: s[lang], logo: 'L', cardCount: { official: s.official, total: s.total } });
      const cards = CARDS.filter((c) => setOf(c[0]) === id)
        .map((c) => ({ id: c[0], localId: localIdOf(c[0]), name: lang === 'de' ? c[1] : c[2] }));
      if (id === 'swsh3') cards.push({ id: 'swsh3-025', localId: '025', name: lang === 'de' ? 'Glurak' : 'Charizard' }, { id: 'swsh3-136', localId: '136', name: lang === 'de' ? 'Glurak' : 'Charizard' });
      if (id === 'base1') cards.push({ id: 'base1-4', localId: '4', name: lang === 'de' ? 'Glurak' : 'Charizard' });
      const full = { id, name: s[lang], releaseDate: s.date, cardCount: { official: s.official, total: s.total }, cards };
      if (s.abbr && lang === 'en') full.abbreviation = { official: s.abbr };
      db[lang + '/sets/' + id] = full;
    });
  });
  CARDS.forEach((c) => {
    db['de/cards/' + c[0]] = tcgCard(c, 'de');
    db['en/cards/' + c[0]] = tcgCard(c, 'en');
  });
  // Übersetzungsliste (Paare über die ID)
  db['de/cards'] = CARDS.map((c) => ({ id: c[0], name: c[1] })).concat([{ id: 'swsh3-025', name: 'Glurak' }]);
  db['en/cards'] = CARDS.map((c) => ({ id: c[0], name: c[2] })).concat([{ id: 'swsh3-025', name: 'Charizard' }]);
  db['de/cards?name=Evoli'] = [{ id: 'sv8-75', localId: '75', name: 'Evoli' }, { id: 'swsh7-125', localId: '125', name: 'Evoli' }];
  db['en/cards?name=Eevee'] = [];
  return db;
}

/* ---------------------------------------------------------------------------
 * Erfundene Quelle im Aufbau von Erics Datei
 * ------------------------------------------------------------------------- */

const CM = 'https://www.cardmarket.com/de/Pokemon/Products/Singles/';
const HEAD = ['Karte Name', 'Setnummer', 'Cardmarket', 'Set', '30 Tage Preistrend', 'Datum Preis-Daten', 'Spalte 1'];
const ROWS_V1 = [
  ['Ditto', 'DS 62', '', '', '6,50 €', '01.10.2026', 'Ordner A'],
  ['Despotar', '88', CM + 'Unleashed/Tyranitar-UL88', 'Entfesselt', '3,50 €', '01.10.2026', 'Ordner A'],
  ['Hundemon', '82', CM + 'Undaunted/Houndoom-UD82', 'Unerschrocken', '0,80 €', '01.10.2026', ''],
  ['Hundemon', '82', CM + 'Undaunted/Houndoom-UD82', 'Unerschrocken', '0,80 €', '01.10.2026', ''],
  ['Arktos', '148', CM + 'Supreme-Victors/Articuno-Lv34-SV148', 'Ultimative Sieger', '2,20 €', '01.10.2026', ''],
  ['Pikachu Snowflake', '78', CM + 'HeartGold-SoulSilver/Pikachu-V3-HS78', 'HeartGold & SoulSilver', '12,00 €', '01.10.2026', 'Ordner B'],
  ['Gengar Rev Holo', '5', '', 'HeartGold & SoulSilver', '9,00 €', '01.10.2026', ''],
  ['Starmie', '20', CM + 'Undaunted/Starmie-UD20?isReverseHolo=Y', 'Unerschrocken', '1,20 €', '01.10.2026', ''],
  ['Ho-Oh', 'HGSS 01', '', '', '5,00 €', '01.10.2026', ''],
  ['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', ''],
  ['Plaudagei', 'DP12', '', 'DP Black Star Promos', '1,10 €', '28.09.2026', ''],
  ['Lugia', '111', 'https://www.pricecharting.com/game/pokemon-heartgold-soulsilver/lugia-111', 'HeartGold & SoulSilver', '15,00 €', '01.10.2026', ''],
  ['Fantasiemon', '999', '', 'Fantasie-Set', '5,00 €', '02.10.2026', 'Ordner C'],
  ['Glurak', '', '', '', '', '', ''],
  ['Evoli', '', '', '', '0,50 €', '', ''],
  ['Feurigel', '61', CM + 'HeartGold-SoulSilver/Cyndaquil-HS61', 'HeartGold & SoulSilver', '0,30 €', '01.10.2026', ''],
  ['Karnimani', '81', '', 'HeartGold & SoulSilver', '0,25 €', '01.10.2026', ''],
  ['Endivie', '59', '', 'HeartGold & SoulSilver', '0,20 €', '30.09.2026', ''],
  ['', '', '', '', '', '', ''],
  ['Kramurx', '40', CM + 'Unleashed/Murkrow-UL40', 'Entfesselt', '0,20 €', '01.10.2026', ''],
  ['Mampfaxo', '60', '', 'Unerschrocken', '0,30 €', '01.10.2026', ''],
  ['Galagladi', '50', '', 'Ultimative Sieger', '1,00 €', '01.10.2026', ''],
  ['Dragoran', '12', CM + 'Delta-Species/Dragonite-DS12', 'EX Delta Species', '10,00 €', '01.10.2026', 'Ordner A'],
  ['Panferno', '16', '', 'Diamant & Perl', '2,00 €', '01.10.2026', ''],
  ['Feurigel', '61', CM + 'HeartGold-SoulSilver/Cyndaquil-HS61', 'HeartGold & SoulSilver', '0,30 €', '01.10.2026', ''],
  ['SUMME', '', '', '', '123,45 €', '', '']
];
/** Zweite Fassung: ein Ditto mehr, Starmie fehlt. */
const ROWS_V2 = ROWS_V1.filter((r) => r[0] !== 'Starmie');
ROWS_V2.splice(1, 0, ['Ditto', 'DS 62', '', '', '6,50 €', '01.10.2026', 'Ordner A']);

const XLSX_ID = 'XLSXORDNER01';
const XLSX_NAME = 'Pokemon Ordner.xlsx';
const XLSX_URL = 'https://drive.google.com/file/d/' + XLSX_ID + '/view?usp=sharing';

function addXlsx(env, rows) {
  env.addSource({
    id: XLSX_ID, name: XLSX_NAME, mime: 'xlsx', tabs: {
      Tabellenblatt1: [HEAD].concat(rows),
      Pokedex: [['Nr', 'Pokémon', 'Vorhanden'], ['1', 'Bisasam', 'WAHR'], ['2', 'Bisaknosp', 'FALSCH']]
    }
  });
}

/** Altes Datenblatt (Version 1, 23 Spalten) mit drei Karten von Hand. */
function addV1Sheet(env) {
  const sh = env.ss.insertSheet('Daten');
  const V1 = ['Schlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer', 'Nummer normalisiert', 'Setgröße',
    'Name', 'Name englisch', 'Quelle', 'Variante', 'Zustand', 'Anzahl', 'Trendpreis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit',
    'Kartentyp', 'Illustrator', 'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar'];
  const d = new Date(2026, 8, 20);
  const rows = [
    V1,
    ['pl3-148|holo|NM', 'pl3-148', 'pl3', 'Ultimative Sieger', '2009-08-19', '148', '148', 147, 'Arktos', 'Articuno', 'de', 'holo', 'NM', 1, 2.2, '2026-10-13', 'https://img/arktos', 'Rare', 'Pokemon', 'Z', d, d, 148],
    ['pl2-12|normal|', 'pl2-12', 'pl2', 'Rising Rivals', '2009-05-16', '12', '12', 111, 'Celebi', 'Celebi', 'de', 'normal', '', 1, 0.5, '2026-10-13', 'https://img/celebi', 'Rare', 'Pokemon', 'Z', d, d, 12],
    ['hgss2-10|holo|LP', 'hgss2-10', 'hgss2', 'Entfesselt', '2010-05-12', '10', '10', 95, 'Nachtara', 'Umbreon', 'de', 'holo', 'LP', 2, 3, '2026-10-13', 'https://img/nachtara', 'Rare Holo', 'Pokemon', 'Z', d, d, 10]
  ];
  rows.forEach((r, i) => r.forEach((v, j) => sh.setCell(i + 1, j + 1, v)));
}

/* ---------------------------------------------------------------------------
 * Hilfen
 * ------------------------------------------------------------------------- */

const IMPORT_PUBLIC = ['importState', 'importOpenSource', 'importSelectTab', 'importPreviewRows', 'importListTemplates',
  'importSaveTemplate', 'importDiscardDraft', 'importStartRecognition', 'importRecognizeStep',
  'importReviewList', 'importReviewSearch', 'importReviewDecide', 'importReviewAcceptPrefilled', 'importSetsVorbelegen',
  'importBuildPreview', 'importCommit', 'importResume', 'importList', 'importUndoPreview', 'importUndo'];

/**
 * Wächter: Schreibzugriffe auf das Haupt-Sheet und die Entwurfs-/Lauf-Properties während eines öffentlichen
 * Import-Aufrufs müssen innerhalb der Sperre passieren. Ausnahme: der Set-Cache „Sets“ (setReleaseDate_ aus Code.gs).
 */
function guard(env) {
  const g = { violations: [], calls: {}, current: '' };
  let depth = 0;
  const sheet0 = env.ss.getSheets()[0];
  const SheetP = Object.getPrototypeOf(sheet0);
  const RangeP = Object.getPrototypeOf(sheet0.getRange(1, 1));
  const SsP = Object.getPrototypeOf(env.ss);
  function check(what, sh) {
    if (depth > 0 && env.lock.depth === 0 && sh && sh.ss === env.ss && sh.name !== 'Sets') {
      g.violations.push(g.current + ': ' + what + ' auf „' + sh.name + '“ ohne Sperre');
    }
  }
  function wrap(P, names, sheetOf) {
    names.forEach((m) => {
      const orig = P[m];
      if (typeof orig !== 'function' || orig.__guarded) return;
      const w = function (...a) { check(m, sheetOf(this)); return orig.apply(this, a); };
      w.__guarded = true;
      P[m] = w;
    });
  }
  wrap(RangeP, ['setValues', 'setNumberFormat', 'setNumberFormats', 'clearContent', 'clear', 'setFormula', 'setFormulas',
    'insertCheckboxes', 'setDataValidation'], (r) => r.sh);
  wrap(SheetP, ['insertRowsAfter', 'deleteRows', 'deleteColumns', 'insertColumnsAfter', 'appendRow', 'clear', 'clearContents',
    'hideSheet', 'showSheet'], (s) => s);
  wrap(SsP, ['insertSheet', 'deleteSheet'], (s) => ({ ss: s, name: '(Blatt anlegen/löschen)' }));
  const PS = env.ctx.PropertiesService;
  const origGet = PS.getScriptProperties;
  PS.getScriptProperties = function () {
    const store = origGet.call(PS);
    const set = store.setProperty, del = store.deleteProperty;
    store.setProperty = function (k, v) {
      if (depth > 0 && env.lock.depth === 0 && /^IMPORT_/.test(k)) g.violations.push(g.current + ': Property ' + k + ' ohne Sperre gesetzt');
      return set.call(store, k, v);
    };
    store.deleteProperty = function (k) {
      if (depth > 0 && env.lock.depth === 0 && /^IMPORT_/.test(k)) g.violations.push(g.current + ': Property ' + k + ' ohne Sperre gelöscht');
      return del.call(store, k);
    };
    return store;
  };
  IMPORT_PUBLIC.forEach((name) => {
    const fn = env.ctx[name];
    if (typeof fn !== 'function') return;
    env.ctx[name] = function (...a) {
      const prev = g.current;
      if (!depth) g.current = name;
      depth++;
      g.calls[name] = (g.calls[name] || 0) + 1;
      try { return fn.apply(this, a); } finally { depth--; g.current = prev; }
    };
  });
  return g;
}

function newEnv(opts) {
  const env = H.createEnv(Object.assign({ db: makeDb() }, opts || {}));
  env.guard = guard(env);
  return env;
}

const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const by = (list, k) => { const o = {}; list.forEach((x) => { o[x[k]] = x; }); return o; };
const handOf = (env) => env.data().filter((d) => d.origin === 'Hand');
const handSnap = (env, eids) => JSON.stringify(env.data().filter((d) => eids.indexOf(d.eid) >= 0)
  .map((d) => [d.eid, d.key, d.count, d.cond, d.lang, d.origin, d.fp, d.ownPrice, d.version, d.variant]));
function rowsOf(env, nr) { return env.data().filter((d) => d.origin === 'Import ' + nr); }
function importe(env) { return by(env.objects('Importe'), 'Nr'); }
function protoOf(env, nr) { return env.proto().filter((p) => Number(p['Import-Nr']) === nr); }
function value(env) {
  const c = env.ctx;
  const rows = c.readData_(env.sheet('Daten')).filter(c.isDataRow_);
  return c.collectionValue_(rows).total;
}
function recognize(env) {
  let r, guardN = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && guardN++ < 100);
  return r;
}
function itemByName(list, name) { return list.find((i) => (i.values.nameClean || i.values.name) === name); }
function dataByName(env, name, nr) {
  return env.data().filter((d) => d.name === name && (nr === undefined || d.origin === (nr ? 'Import ' + nr : 'Hand')));
}

/* ===========================================================================
 * Hauptablauf
 * ========================================================================= */

const env = newEnv();
const c = env.ctx;
const D = {}; // gemerkte Werte zwischen den Schritten

t.section('1. Einrichtung auf einem alten Blatt mit drei Karten von Hand');
{
  addV1Sheet(env);
  c.setupAll_();
  const hand = handOf(env);
  t.eq('drei Karten von Hand umgestellt', hand.map((d) => [d.name, d.count, d.key]),
    [['Arktos', 1, 'pl3-148|holo||NM|DE'], ['Celebi', 1, 'pl2-12|normal|||DE'], ['Nachtara', 2, 'hgss2-10|holo||LP|DE']]);
  D.handEids = hand.map((d) => d.eid);
  D.handSnap = handSnap(env, D.handEids);
  ['Importe', 'Import-Begriffe', 'Import-Sets'].forEach((n) => t.ok('Blatt ' + n + ' sichtbar', env.sheet(n) && !env.sheet(n).isSheetHidden()));
  ['Import-Vorlagen', 'Import-Quelle', 'Import-Prüfung', 'Import-Antworten', 'Import-Protokoll'].forEach((n) =>
    t.ok('Blatt ' + n + ' versteckt', env.sheet(n) && env.sheet(n).isSheetHidden()));
  t.eq('Importe-Kopfzeile', env.values('Importe')[0], env.run('IMPORTE_HEADERS'));
  t.eq('Begriffe vorbelegt (38)', env.objects('Import-Begriffe').length, 38);
  const st = env.uiCall('importState');
  t.eq('importState leer', [st.draft, st.imports, st.busy, st.driveService, st.driveVersion, st.needsSetup], [null, [], null, true, 'v3', false]);
  t.ok('Sets geladen', env.objects('Sets').length === 2 * Object.keys(SETS).length, env.objects('Sets').length);
  D.value0 = value(env);
  // zweite Einrichtung ändert nichts an Erics Begriffen
  env.sheet('Import-Begriffe').getRange(2, 3).setValue('reverse');
  c.setupAll_();
  t.eq('zweite Einrichtung: Begriffe bleiben', env.objects('Import-Begriffe').length, 38);
  t.eq('zweite Einrichtung: Hand-Karten unverändert', handSnap(env, D.handEids), D.handSnap);
}

t.section('2. Set-Zuordnung vorbelegen');
{
  // eine eigene Zeile von Eric bleibt
  const sh = env.sheet('Import-Sets');
  sh.getRange(2, 1, 1, 4).setValues([['Fantasie-Set', 'FS', 'base1', 'Hand']]);
  const msg = env.uiCall('importSetsVorbelegen');
  t.ok('Meldung', /^\d+ Sets vorbelegt, \d+ davon mit Kürzel\./.test(msg) && / von Hand bleiben/.test(msg), msg);
  const rows = env.objects('Import-Sets');
  const byId = by(rows.filter((r) => r.Herkunft === 'auto'), 'tcgdex-Sets');
  t.eq('Kürzel aus tcgdex und alter Liste', ['ex11', 'dp1', 'dpp', 'hgss1', 'hgss2', 'hgss3', 'hgssp', 'pl3'].map((id) => byId[id] && byId[id]['Kürzel']),
    ['DS', 'DP', 'DPPR', 'HS', 'UL', 'UD', 'HGSS', 'SV']);
  t.eq('Hand-Zeile zuerst und unverändert', [rows[0]['Cardmarket-Name'], rows[0]['Kürzel'], rows[0].Herkunft], ['Fantasie-Set', 'FS', 'Hand']);
  t.eq('englische Namen', byId.hgss2['Cardmarket-Name'], 'Unleashed');
  // Fantasie-Set wieder entfernen (sonst wird Fantasiemon nicht „nicht gefunden“)
  const all = env.values('Import-Sets');
  const keep = all.slice(1).filter((r) => r[0] !== 'Fantasie-Set');
  sh.getRange(2, 1, all.length - 1, 4).clearContent();
  sh.getRange(2, 1, keep.length, 4).setValues(keep);
}

t.section('3. Quelle öffnen (.xlsx über Drive v3), Tab wählen, Vorlage');
{
  addXlsx(env, ROWS_V1);
  const o = env.uiCall('importOpenSource', XLSX_URL);
  t.eq('importOpenSource', [o.sourceId, o.sourceName, o.kind, o.tabs.map((x) => [x.name, x.rows, x.cols])],
    [XLSX_ID, XLSX_NAME, 'xlsx', [['Tabellenblatt1', ROWS_V1.length + 1, 7], ['Pokedex', 3, 3]]]);
  const copy = env.driveCopies[env.driveCopies.length - 1];
  t.eq('temporäre Kopie (v3)', [copy.from, copy.resource.name, copy.resource.mimeType], [XLSX_ID, 'Pokémon-Import (temporär) ' + XLSX_NAME, H.MIME.GOOGLE_SHEETS]);
  D.tmp1 = copy.to;
  t.ok('Kopie noch nicht im Papierkorb', !env.driveFiles[D.tmp1].trashed);
  const st = env.uiCall('importState');
  t.eq('Entwurf: Stufe tab', [st.draft.stage, st.draft.kind, st.draft.mode, st.draft.tmpId], ['tab', 'xlsx', 'neu', D.tmp1]);

  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.ok('Kopie im Papierkorb', env.driveFiles[D.tmp1].trashed === true);
  t.eq('Größe', [s.tab, s.nRows, s.nCols], ['Tabellenblatt1', ROWS_V1.length + 1, 7]);
  t.eq('Spalten geraten', [s.guess.headerRow, s.guess.firstRow, s.guess.cols.name, s.guess.cols.number, s.guess.cols.cmLink,
    s.guess.cols.set, s.guess.cols.price, s.guess.cols.priceDate, s.guess.cols.qty], [1, 2, 0, 1, 2, 3, 4, 5, -1]);
  t.eq('keine Vorlage passt', [s.templates.length, s.suggested], [0, null]);
  t.eq('Import-Quelle ist Text', env.values('Import-Quelle')[2], ROWS_V1[1]);
  t.eq('Entwurf: Stufe zuordnung, ohne Kopie', [env.uiCall('importState').draft.stage, env.uiCall('importState').draft.tmpId], ['zuordnung', '']);

  D.cfg = Object.assign({}, s.cfg, { extras: [{ col: 6, name: 'Notiz', show: true }] });
  const pv = env.uiCall('importPreviewRows', D.cfg);
  t.eq('Vorschau: Zahlen', [pv.total, pv.importable, pv.skippedCounts], [ROWS_V1.length, ROWS_V1.length - 2, { summe: 1, leer: 1, nichtAngehakt: 0 }]);
  t.eq('Vorschau: erste Zeile', [pv.rows[0].fields.name, pv.rows[0].fields.number, pv.rows[0].fields.price, pv.rows[0].extras.Notiz], ['Ditto', 'DS 62', 6.5, 'Ordner A']);
  const pika = pv.rows[5].fields;
  t.eq('Vorschau: Snowflake', [pika.nameClean, pika.version, pika.cmUrl !== ''], ['Pikachu', 'Snowflake', true]);
  t.eq('Vorschau: Rev Holo', [pv.rows[6].fields.nameClean, pv.rows[6].fields.variant], ['Gengar', 'reverse']);

  const tp = env.uiCall('importSaveTemplate', 'Pokemon Ordner', D.cfg, 'neu');
  t.eq('Vorlage gespeichert', [tp.name, tp.mode, tp.signature], ['Pokemon Ordner', 'neu', 'karte name|setnummer|cardmarket|set|30 tage preistrend|datum preis-daten|spalte 1']);
  const again = env.uiCall('importSelectTab', 'Tabellenblatt1'); // gleicher Tab ohne Kopie: aus Import-Quelle
  t.eq('Vorlage passt jetzt', [again.suggested, again.templates[0].matches, again.cfg.extras], ['Pokemon Ordner', true, [{ col: 6, name: 'Notiz', show: true }]]);
  t.eq('keine neue Umwandlung', env.driveCopies.length, 1);
}

t.section('4. Erkennung (Nur Neues)');
{
  const r0 = env.uiCall('importStartRecognition', D.cfg, 'Pokemon Ordner', 'neu');
  t.eq('importStartRecognition', r0, { total: 22, skipped: { summe: 1, leer: 1, nichtAngehakt: 0 } });
  const r = recognize(env);
  t.eq('Erkennung fertig', [r.done, r.pos, r.total], [true, 22, 22]);
  t.eq('Zählung', r.counts, { eindeutig: 18, unklar: 3, nichtGefunden: 1, uebersprungen: 0, bekannt: 0 });
  t.eq('Entwurf: Stufe pruefung', env.uiCall('importState').draft.stage, 'pruefung');
  const rv = c.reviewRead_();
  const card = (n) => (itemByName(rv, n) || {}).card || {};
  t.eq('DS 62 -> Ditto ex11-62', card('Ditto').id, 'ex11-62');
  t.eq('UL88-Link -> hgss2-88', card('Despotar').id, 'hgss2-88');
  t.eq('Hundemon zweimal -> Menge 2', [itemByName(rv, 'Hundemon').qty, itemByName(rv, 'Hundemon').srcRows], [2, [4, 5]]);
  t.eq('Snowflake: Karte + Version', [card('Pikachu').id, itemByName(rv, 'Pikachu').values.version], ['hgss1-78', 'Snowflake']);
  t.eq('Rev Holo -> reverse', [card('Gengar').id, card('Gengar').variant, card('Gengar').price], ['hgss1-5', 'reverse', 9]);
  t.eq('isReverseHolo=Y -> reverse', [card('Starmie').id, card('Starmie').variant], ['hgss3-20', 'reverse']);
  t.eq('HGSS 01 -> Promo', card('Ho-Oh').id, 'hgssp-HGSS01');
  t.eq('DP12 + Set-Name -> Promo', card('Plaudagei').id, 'dpp-DP12');
  t.eq('pricecharting-Link: Set + Nummer', [card('Lugia').id, itemByName(rv, 'Lugia').values.cmUrl], ['hgss1-111', '']);
  t.eq('Lv34 im Link', card('Arktos').id, 'pl3-148');
  t.eq('Kartenangaben vollständig', Object.keys(card('Despotar')).sort(),
    ['baseVariant', 'category', 'dataLang', 'id', 'illustrator', 'img', 'localId', 'name', 'nameEn', 'price', 'priceDate', 'rarity',
      'setDate', 'setId', 'setName', 'setSize', 'variant'].sort());
  t.eq('Set-Datum aus der Kartenliste', card('Despotar').setDate, '2010-05-12');
  const rl = env.uiCall('importReviewList');
  t.eq('Prüfliste', rl.items.map((i) => [i.values.nameClean, i.status]).sort(),
    [['Evoli', 'unklar'], ['Fantasiemon', 'nicht gefunden'], ['Glurak', 'unklar'], ['Lucario Promo', 'unklar']]);
  t.eq('Prüfliste offen', [rl.open, rl.total], [4, 4]);
  const luc = itemByName(rl.items, 'Lucario Promo');
  t.eq('DP 16 mehrdeutig', [luc.candidates.map((x) => x.id).sort(), /Kürzel „DP“ passt zu mehreren Sets/.test(luc.reason)],
    [['dp1-16', 'dpp-DP16'], true]);
  t.ok('Kandidaten mit Bild und Set', luc.candidates.every((x) => x.image && x.setName && x.localId), luc.candidates);
  D.fp = {};
  rv.forEach((i) => { D.fp[i.values.nameClean] = i.fp; });
}

t.section('5. Prüfliste: Karte, frei, überspringen, einer bleibt offen');
{
  const s1 = env.uiCall('importReviewSearch', D.fp['Lucario Promo'], { name: '', number: 'DP16', set: 'DP Black Star Promos' });
  t.ok('Suche in der Prüfliste', s1.cards && s1.cards.some((x) => x.id === 'dpp-DP16'), s1);
  let d = env.uiCall('importReviewDecide', D.fp['Lucario Promo'], { type: 'karte', id: 'dpp-DP16', lang: 'de' });
  t.eq('Karte gewählt', [d.item.card.id, d.item.card.name, d.item.decision, d.item.confirmed, d.open], ['dpp-DP16', 'Lucario', { type: 'karte', id: 'dpp-DP16', lang: 'de' }, true, 3]);
  d = env.uiCall('importReviewDecide', D.fp.Fantasiemon, { type: 'frei' });
  t.eq('freie Karte', [d.item.card, d.open], [{ free: true, name: 'Fantasiemon', setName: 'Fantasie-Set', localId: '999' }, 2]);
  d = env.uiCall('importReviewDecide', D.fp.Evoli, { type: 'skip' });
  t.eq('übersprungen', [d.item.decision.type, d.item.card, d.open], ['skip', null, 1]);
  // Wahl ändern und zurücksetzen
  env.uiCall('importReviewDecide', D.fp.Glurak, { type: 'skip' });
  d = env.uiCall('importReviewDecide', D.fp.Glurak, { type: '' });
  t.eq('Wahl aufgehoben', [d.item.decision, d.item.confirmed, d.open], [null, false, 1]);
  const ans = env.objects('Import-Antworten');
  t.eq('Antworten sofort gespeichert', ans.map((a) => [a['Quelle-ID'], a.Quellzeile, JSON.parse(a.Entscheidung).type]).sort(),
    [[XLSX_ID, D.fp.Evoli, 'skip'], [XLSX_ID, D.fp.Fantasiemon, 'frei'], [XLSX_ID, D.fp['Lucario Promo'], 'karte']].sort());
}

t.section('6. Vorschau und Übernehmen (Import 1)');
{
  const pv = env.uiCall('importBuildPreview');
  t.eq('Modus', [pv.mode, pv.modeLabel, pv.sourceName, pv.tab], ['neu', 'Nur Neues', XLSX_NAME, 'Tabellenblatt1']);
  t.eq('Schon von Hand erfasst: Arktos', pv.handMatch.map((h) => [h.title, h.qty, h.handCount, h.choice]), [['Arktos', 1, 1, 'same']]);
  t.eq('Zählung', [pv.counts.neu, pv.counts.mehr, pv.counts.kopien, pv.counts.gleich, pv.counts.pruefOffen, pv.counts.uebersprungen, pv.counts.weniger],
    [19, 0, 21, 1, 1, 1, 0]);
  t.eq('neue Zusatzspalte', pv.newColumns, ['Notiz']);
  t.eq('Quelle: ausgelassen', pv.sourceSkipped, { summe: 1, leer: 1, nichtAngehakt: 0 });
  t.eq('Übersprungen-Liste', pv.skipped.map((s) => s.reason).sort(), ['In der Prüfliste noch offen', 'Von dir übersprungen']);
  t.eq('removedByYou leer', pv.removedByYou, []);
  const pvExtra = env.uiCall('importBuildPreview', { hand: { [D.fp.Arktos]: 'extra' } });
  t.eq('Zusätzliches Exemplar: Arktos kommt dazu', [pvExtra.counts.kopien, pvExtra.counts.gleich, pvExtra.counts.mehr], [22, 0, 1]);
  D.pv1 = pv;

  const before = value(env);
  const res = env.uiCall('importCommit', { hand: { [D.fp.Arktos]: 'same' }, removed: {} });
  t.eq('Import 1', [res.nr, res.counts.kopien, res.counts.neu], [1, 21, 19]);
  t.ok('Meldung', /^Import 1 ist fertig: 21 Exemplare übernommen \(19 neue Karten\)\. Wert \+/.test(res.message) &&
    /1 Zeile aus der Prüfliste ist noch offen/.test(res.message) && res.message.indexOf('—') < 0, res.message);
  const after = value(env);
  t.eq('Wertänderung = Sammlungswert nachher - vorher', res.valueChange, Math.round((after - before) * 100) / 100);
  t.eq('Wertänderung wie in der Vorschau', res.valueChange, pv.valueChange);

  const rows = rowsOf(env, 1);
  t.eq('19 Import-Zeilen, 21 Exemplare', [rows.length, sum(rows, (d) => d.count)], [19, 21]);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
  t.eq('Summe Daten', sum(env.data(), (d) => d.count), 4 + 21);
  t.ok('jede Import-Zeile hat fp und eigene eid', rows.every((d) => /^[0-9a-f]{12}$/.test(d.fp) && /^E[0-9a-f]{10}$/.test(d.eid)) &&
    new Set(rows.map((d) => d.eid)).size === 19);
  t.eq('kein Arktos aus dem Import (gleich)', dataByName(env, 'Arktos').map((d) => d.origin), ['Hand']);
  const one = (n) => dataByName(env, n, 1)[0] || {};
  t.eq('Hundemon 2', [one('Hundemon').count, one('Hundemon').id], [2, 'hgss3-82']);
  t.eq('Pikachu Snowflake', [one('Pikachu').version, one('Pikachu').variant, one('Pikachu').extras.Notiz], ['Snowflake', 'normal', 'Ordner B']);
  t.eq('Gengar reverse mit Preis', [one('Gengar').variant, one('Gengar').price], ['reverse', 9]);
  t.eq('Starmie reverse', one('Starmie').variant, 'reverse');
  t.eq('Lucario aus der Prüfliste', [one('Lucario').id, one('Lucario').localId], ['dpp-DP16', 'DP16']);
  t.eq('freie Karte mit eigenem Preis aus der Quelle', [one('Fantasiemon').source, one('Fantasiemon').id, one('Fantasiemon').setName,
    one('Fantasiemon').localId, one('Fantasiemon').ownPrice, one('Fantasiemon').ownPriceDate, one('Fantasiemon').extras.Notiz],
    ['frei', '', 'Fantasie-Set', '999', 5, '2026-10-02', 'Ordner C']);
  t.eq('ohne Trendpreis: eigener Preis aus der Quelle', [one('Plaudagei').ownPrice, one('Plaudagei').ownPriceDate, one('Endivie').ownPrice, one('Endivie').ownPriceDate],
    [1.1, '2026-09-28', 0.2, '2026-09-30']);
  t.eq('mit Trendpreis: kein eigener Preis', [one('Ditto').ownPrice, one('Ditto').price], ['', 6.5]);
  t.eq('Sprache DE, Zustand leer', [one('Ditto').lang, one('Ditto').cond], ['DE', '']);
  t.eq('Glurak/Evoli nicht übernommen', [dataByName(env, 'Glurak').length, dataByName(env, 'Evoli').length], [0, 0]);
  t.eq('Zusatzspalte Notiz angelegt und in der Sammlung', [c.extraNames_(), c.getViewExtras_()], [['Notiz'], ['Notiz']]);

  // Gruppen
  const groups = env.groups();
  t.eq('Gruppen: Summe = Daten', sum(groups, (g) => g.Anzahl), sum(env.data(), (d) => d.count));
  const gArk = groups.find((g) => g['Karten-ID'] === 'pl3-148');
  t.eq('Arktos-Gruppe nur von Hand', [gArk.Anzahl, gArk.Exemplare], [1, '1× DE NM']);
  t.ok('Pikachu-Gruppe mit Version', groups.some((g) => g.Name === 'Pikachu · Snowflake'), groups.map((g) => g.Name));
  t.ok('Notiz in Gruppen', groups.some((g) => g.Notiz === 'Ordner B'));

  // Importe
  const imp = importe(env)[1];
  t.eq('Importe-Zeile', [imp.Quelle, imp['Quelle-ID'], imp.Tab, imp.Vorlage, imp.Modus, imp.Status, imp.Neu, imp.Mehr, imp.Weniger,
    imp['Übersprungen'], imp['Prüfliste offen']], [XLSX_NAME, XLSX_ID, 'Tabellenblatt1', 'Pokemon Ordner', 'Nur Neues', 'aktiv', 19, 0, 0, 1, 1]);
  t.ok('Datum als Text', typeof imp.Datum === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(imp.Datum), imp.Datum);
  t.eq('Wertänderung im Blatt', imp['Wertänderung (EUR)'], res.valueChange);
  t.ok('Bericht', /21 Exemplare übernommen/.test(imp.Bericht) && /1 Summenzeile, 1 leere Zeile/.test(imp.Bericht), imp.Bericht);

  // Protokoll
  const pr = protoOf(env, 1);
  const types = {};
  pr.forEach((p) => { types[p.Typ] = (types[p.Typ] || 0) + 1; });
  t.eq('Protokoll-Typen', types, { spalte: 1, neu: 19, gleich: 1 });
  t.ok('alles erledigt', pr.every((p) => p.Status === 'erledigt'), pr.map((p) => p.Status));
  t.ok('neu: eid = Daten-Zeile', pr.filter((p) => p.Typ === 'neu').every((p) => rows.some((d) => d.eid === p['Eintrag-ID'] && d.fp === p.Quellzeile && d.count === p.Menge)));
  const gl = pr.find((p) => p.Typ === 'gleich');
  t.eq('gleich zeigt auf Erics Arktos', [gl['Eintrag-ID'], gl.Quellzeile, gl.Menge], [D.handEids[0], D.fp.Arktos, 1]);
  t.ok('Quelle-ID im Protokoll', pr.every((p) => p['Quelle-ID'] === XLSX_ID));

  // aufgeräumt
  const st = env.uiCall('importState');
  t.eq('Entwurf weg, kein Lauf', [st.draft, st.busy, env.props.IMPORT_RUN], [null, null, undefined]);
  t.eq('Import-Quelle und Import-Prüfung leer', [env.sheet('Import-Quelle').getLastRow(), env.sheet('Import-Prüfung').getLastRow()], [0, 1]);
  t.eq('importList', st.imports.map((i) => [i.nr, i.status, i.mode, i.counts.neu, i.date.length]), [[1, 'aktiv', 'Nur Neues', 19, 16]]);

  // Sammlung (Tab „Sammlung“)
  const sc = env.uiCall('searchCollection', 'Hundemon', '');
  t.eq('searchCollection: Herkunft', sc.groups.map((g) => [g.name, g.count, g.rows.map((r) => [r.originLabel, r.isImport, r.importNr])]),
    [['Hundemon', 2, [[XLSX_NAME + ', Import 1', true, 1]]]]);
  const sa = env.uiCall('searchCollection', 'Arktos', '');
  t.eq('searchCollection: Arktos von Hand', sa.groups[0].rows.map((r) => r.originLabel), ['von Hand']);
  const sf = env.uiCall('searchCollection', 'Fantasiemon', '');
  t.eq('searchCollection: freie Karte', [sf.groups[0].isFree, sf.groups[0].price, sf.groups[0].priceManual], [true, 5, true]);
  D.value1 = after;
}

t.section('7. −1 auf ein importiertes Exemplar (verkauft)');
{
  const h = dataByName(env, 'Hundemon', 1)[0];
  const r = env.uiCall('adjustEntry', h.eid, -1);
  t.eq('adjustEntry', [r.count, r.applied, r.token.logIds.length], [1, -1, 1]);
  const he = env.proto().find((p) => p.Typ === 'handentfernt');
  t.eq('handentfernt im Protokoll', [he['Import-Nr'], he.Quellzeile, he.Menge, he['Quelle-ID']], [1, D.fp.Hundemon, 1, XLSX_ID]);
  D.hundemonEid = h.eid;
}

t.section('8. Dieselbe Quelle noch einmal (Nur Neues)');
{
  env.uiCall('importOpenSource', XLSX_URL);
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('Vorlage vorgeschlagen', [s.suggested, s.cfg.extras.length], ['Pokemon Ordner', 1]);
  env.uiCall('importStartRecognition', s.cfg, 'Pokemon Ordner', 'neu');
  const r = recognize(env);
  t.eq('alles bekannt bis auf Glurak und Evoli', r.counts, { eindeutig: 0, unklar: 2, nichtGefunden: 0, uebersprungen: 0, bekannt: 20 });
  const rl = env.uiCall('importReviewList');
  const ev = itemByName(rl.items, 'Evoli');
  t.eq('Evoli vorbelegt (überspringen)', [ev.prefilled, ev.confirmed, ev.decision && ev.decision.type], [true, false, 'skip']);
  t.eq('Glurak offen, ohne Vorbelegung', [itemByName(rl.items, 'Glurak').prefilled, itemByName(rl.items, 'Glurak').decision], [false, null]);
  t.eq('offen zählt vorbelegte mit', rl.open, 2);
  t.eq('Alle übernehmen', env.uiCall('importReviewAcceptPrefilled'), { open: 1 });
  const pv = env.uiCall('importBuildPreview');
  t.eq('nichts Neues', [pv.counts.kopien, pv.counts.neu, pv.counts.mehr, pv.added], [0, 0, 0, []]);
  t.eq('Von dir entfernt: Hundemon', pv.removedByYou.map((x) => [x.title, x.qty, x.ticked]), [['Hundemon', 1, false]]);
  const pvT = env.uiCall('importBuildPreview', { removed: { [D.fp.Hundemon]: true } });
  t.eq('angehakt: kommt zurück', [pvT.counts.kopien, pvT.counts.mehr, pvT.removedByYou[0].ticked], [1, 1, true]);
  t.eq('Verwerfen', env.uiCall('importDiscardDraft'), { ok: true, discarded: true });
  t.eq('Entwurf weg', env.uiCall('importState').draft, null);
  t.eq('Daten unverändert', sum(env.data(), (d) => d.count), 4 + 20);
}

t.section('9. Quelle geändert (ein Ditto mehr, Starmie weg), Mit Quelle abgleichen (Import 2)');
{
  addXlsx(env, ROWS_V2);
  env.uiCall('importOpenSource', XLSX_URL);
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  env.uiCall('importStartRecognition', s.cfg, 'Pokemon Ordner', 'abgleich');
  const r = recognize(env);
  t.eq('Abgleich erkennt alles neu', r.counts, { eindeutig: 17, unklar: 3, nichtGefunden: 1, uebersprungen: 0, bekannt: 0 });
  const rl = env.uiCall('importReviewList');
  t.eq('alle früheren Antworten vorbelegt', rl.items.map((i) => [i.values.nameClean, i.prefilled, i.decision && i.decision.type]).sort(),
    [['Evoli', true, 'skip'], ['Fantasiemon', true, 'frei'], ['Glurak', false, null], ['Lucario Promo', true, 'karte']]);
  t.eq('vorbelegte Karte vollständig', itemByName(rl.items, 'Lucario Promo').card.id, 'dpp-DP16');
  const pv = env.uiCall('importBuildPreview');
  t.eq('Abgleich: Zählung', [pv.mode, pv.counts.neu, pv.counts.mehr, pv.counts.weniger, pv.counts.kopien, pv.counts.pruefOffen, pv.counts.uebersprungen],
    ['abgleich', 0, 1, 1, 1, 1, 1]);
  t.eq('Abgleich: Ditto +1', pv.added.map((a) => [a.title, a.qty, a.newGroup]), [['Ditto', 1, false]]);
  t.eq('Abgleich: Starmie −1 aus Import 1', pv.decreased.map((x) => [x.title, x.qty, x.fromImport]), [['Starmie', 1, 1]]);
  t.eq('Abgleich: verkaufter Hundemon bleibt weg', pv.removedByYou.map((x) => [x.title, x.qty]), [['Hundemon', 1]]);
  t.eq('Abgleich: Arktos von Hand nicht angefasst', pv.handMatch, []);
  const before = value(env);
  const res = env.uiCall('importCommit', {});
  t.eq('Import 2', [res.nr, res.counts.weniger, res.counts.mehr], [2, 1, 1]);
  t.eq('Wert', res.valueChange, Math.round((value(env) - before) * 100) / 100);
  t.eq('Ditto: zwei Zeilen (Import 1 und 2)', dataByName(env, 'Ditto').map((d) => [d.origin, d.count, d.fp === D.fp.Ditto]),
    [['Import 1', 1, true], ['Import 2', 1, true]]);
  t.eq('Starmie auf 0, Zeile bleibt', dataByName(env, 'Starmie').map((d) => [d.origin, d.count]), [['Import 1', 0]]);
  t.eq('Hundemon bleibt 1', dataByName(env, 'Hundemon').map((d) => d.count), [1]);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
  const ab = protoOf(env, 2).find((p) => p.Typ === 'abgleich');
  t.eq('abgleich im Protokoll', [ab.Menge, JSON.parse(ab.Daten).countBefore, JSON.parse(ab.Daten).fromImport, ab.Status], [-1, 1, 1, 'erledigt']);
  const imp = importe(env)[2];
  t.eq('Importe 2', [imp.Modus, imp.Status, imp.Neu, imp.Mehr, imp.Weniger], ['Mit Quelle abgleichen', 'aktiv', 0, 1, 1]);
  t.eq('Summe', sum(env.data(), (d) => d.count), 4 + 20 + 1 - 1);
  const sc = env.uiCall('searchCollection', 'Ditto', '');
  t.eq('Ditto in der Sammlung: zwei Herkünfte', sc.groups.map((g) => [g.count, g.rows.map((x) => x.originLabel)]),
    [[2, [XLSX_NAME + ', Import 1', XLSX_NAME + ', Import 2']]]);
}

t.section('10. Zurücknehmen von Import 1 nach Änderungen von Hand');
{
  const desp = dataByName(env, 'Despotar', 1)[0];
  const pika = dataByName(env, 'Pikachu', 1)[0];
  const feu = dataByName(env, 'Feurigel', 1)[0];
  env.uiCall('editEntry', desp.eid, { cond: 'LP' });
  env.uiCall('editEntry', pika.eid, { extras: { Notiz: 'verliehen' } });
  const split = env.uiCall('editEntry', feu.eid, { cardLang: 'EN' }, 1);
  t.ok('Feurigel aufgeteilt', split.eid !== feu.eid && dataByName(env, 'Feurigel', 1).length === 2);
  t.throws('Zurücknehmen ohne Vorschau-Entscheidungen', () => env.uiCall('importUndo', 1, {}), /noch offen: 3/);
  t.eq('nichts geändert nach dem Fehler', [importe(env)[1].Status, rowsOf(env, 1).length, env.props.IMPORT_RUN], ['aktiv', 20, undefined]);
  const up = env.uiCall('importUndoPreview', 1);
  t.eq('Vorschau: Zahlen', [up.counts, up.laterSameSource, up.status], [{ loeschen: 17, zurueck: 0, fehlt: 0, bleiben: 0 }, [2], 'aktiv']); // bleiben: Review DATA-6
  const ch = by(up.changed, 'eid');
  t.eq('Despotar: Zustand', ch[desp.eid] && ch[desp.eid].changes, ['Zustand ohne → LP']);
  t.eq('Pikachu: Zusatzwert', ch[pika.eid] && ch[pika.eid].changes, ['Zusatzwert Notiz: Ordner B → verliehen']);
  t.eq('Feurigel: aufgeteilt', ch[split.eid] && ch[split.eid].changes, ['Aufgeteilt', 'Sprache DE → EN']);
  t.ok('unveränderte Hälfte nicht gefragt', !ch[feu.eid]);
  const res = env.uiCall('importUndo', 1, { [desp.eid]: 'keep', [pika.eid]: 'remove', [split.eid]: 'keep' });
  t.eq('importUndo', [res.deleted, res.kept, res.restored, res.skipped, res.droppedColumns], [18, 2, 0, 0, []]);
  t.ok('Meldung', /^Import 1 ist zurückgenommen: 18 Einträge gelöscht, 2 behalten \(jetzt von Hand\)\./.test(res.message), res.message);
  t.eq('keine Zeile von Import 1 mehr', rowsOf(env, 1).length, 0);
  t.eq('behaltene sind jetzt von Hand', [dataByName(env, 'Despotar').map((d) => [d.origin, d.fp, d.cond, d.count]),
    dataByName(env, 'Feurigel').map((d) => [d.origin, d.lang, d.count])],
    [[['Hand', '', 'LP', 1]], [['Hand', 'EN', 1]]]);
  t.eq('Import 2 bleibt', rowsOf(env, 2).map((d) => [d.name, d.count]), [['Ditto', 1]]);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
  t.eq('Summe', sum(env.data(), (d) => d.count), 4 + 2 + 1);
  t.eq('Notiz bleibt (noch benutzt)', c.extraNames_(), ['Notiz']);
  const imp = importe(env)[1];
  t.ok('Importe 1 zurückgenommen', imp.Status === 'zurückgenommen' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(imp['Zurückgenommen am']) &&
    /Zurückgenommen am .*18 Einträge gelöscht, 2 behalten/.test(imp.Bericht), imp);
  t.eq('Protokoll bleibt vollständig (21 + handentfernt)', protoOf(env, 1).map((p) => p.Typ).sort().join(','), ['gleich', 'handentfernt'].concat(Array(19).fill('neu'), ['spalte']).join(','));
  t.throws('zweimal zurücknehmen', () => env.uiCall('importUndoPreview', 1), /schon zurückgenommen/);
  const sc = env.uiCall('searchCollection', 'Despotar', '');
  t.eq('Despotar in der Sammlung von Hand', sc.groups[0].rows.map((r) => r.originLabel), ['von Hand']);
  t.eq('Gruppen = Daten', sum(env.groups(), (g) => g.Anzahl), sum(env.data(), (d) => d.count));
}

t.section('11. Wieder importieren (Nur Neues, Import 3)');
{
  env.uiCall('importOpenSource', XLSX_URL);
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  env.uiCall('importStartRecognition', s.cfg, s.suggested, 'neu');
  const r = recognize(env);
  t.eq('vergessen bis auf Import 2', [r.counts.bekannt, r.counts.unklar, r.counts.nichtGefunden], [0, 3, 1]);
  const rl = env.uiCall('importReviewList');
  t.eq('wieder vorbelegt', rl.items.filter((i) => i.prefilled).map((i) => i.values.nameClean).sort(), ['Evoli', 'Fantasiemon', 'Lucario Promo']);
  const pv = env.uiCall('importBuildPreview');
  t.eq('von Hand erfasst: Despotar, Feurigel, Arktos', pv.handMatch.map((h) => [h.title, h.qty, h.handCount]).sort(),
    [['Arktos', 1, 1], ['Despotar', 1, 1], ['Feurigel', 2, 1]]);
  t.eq('verkaufter Hundemon bleibt weg', pv.removedByYou.map((x) => [x.title, x.qty, x.ticked]), [['Hundemon', 1, false]]);
  t.eq('Zählung', [pv.counts.neu, pv.counts.mehr, pv.counts.kopien, pv.counts.gleich], [15, 2, 17, 3]);
  const res = env.uiCall('importCommit', {});
  t.eq('Import 3', [res.nr, res.counts.kopien], [3, 17]);
  t.eq('Hundemon nur 1 (das verkaufte nicht)', dataByName(env, 'Hundemon').map((d) => [d.origin, d.count]), [['Import 3', 1]]);
  t.eq('Feurigel: Hand EN + Import 3', dataByName(env, 'Feurigel').map((d) => [d.origin, d.lang, d.count]), [['Hand', 'EN', 1], ['Import 3', 'DE', 1]]);
  t.eq('Despotar nicht doppelt', dataByName(env, 'Despotar').map((d) => d.origin), ['Hand']);
  t.eq('Lucario aus der vorbelegten Antwort', dataByName(env, 'Lucario', 3).map((d) => d.id), ['dpp-DP16']);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
  t.eq('Summe', sum(env.data(), (d) => d.count), 4 + 2 + 1 + 17);
  const gl = protoOf(env, 3).filter((p) => p.Typ === 'gleich');
  t.eq('gleich-Einträge', gl.length, 3);
  D.import3 = JSON.stringify(rowsOf(env, 3).map((d) => [d.eid, d.count, d.key]));
}

t.section('12. Älteren Import 2 zurücknehmen, Import 3 bleibt');
{
  const up = env.uiCall('importUndoPreview', 2);
  t.eq('Vorschau', [up.counts, up.changed, up.laterSameSource], [{ loeschen: 1, zurueck: 0, fehlt: 1, bleiben: 0 }, [], [3]]); // bleiben: Review DATA-6
  const res = env.uiCall('importUndo', 2, {});
  t.eq('importUndo 2', [res.deleted, res.kept, res.restored, res.skipped], [1, 0, 0, 1]);
  t.ok('Meldung nennt den fehlenden Eintrag', /1 Eintrag aus dem Abgleich gab es nicht mehr/.test(res.message), res.message);
  t.eq('Import 3 unberührt', JSON.stringify(rowsOf(env, 3).map((d) => [d.eid, d.count, d.key])), D.import3);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
  t.eq('Summe', sum(env.data(), (d) => d.count), 4 + 2 + 17);
  t.eq('Liste', env.uiCall('importList').map((i) => [i.nr, i.status]), [[3, 'aktiv'], [2, 'zurückgenommen'], [1, 'zurückgenommen']]);
  t.eq('Gruppen = Daten', sum(env.groups(), (g) => g.Anzahl), sum(env.data(), (d) => d.count));
  const sc = env.uiCall('searchCollection', 'Ditto', '');
  t.eq('Ditto nur noch aus Import 3', sc.groups.map((g) => [g.count, g.rows.map((x) => x.originLabel)]), [[1, [XLSX_NAME + ', Import 3']]]);
}

t.section('13. Google Sheet mit Links im Text (Alles addieren), Abbruch und Fortsetzen (Import 4)');
{
  const SHEET_ID = 'GSHEETLISA0001';
  env.addSource({
    id: SHEET_ID, name: 'Lisas Karten', mime: 'sheet', tabs: {
      Karten: {
        values: [['Name', 'Nr.', 'Set', 'Anzahl'], ['Despotar', '88', 'Entfesselt', '1'], ['Hundemon', '', '', '2'],
          ['Kramurx', '40', 'Entfesselt', '1'], ['Summe', '', '', '4']],
        links: {
          '2,1': CM + 'Unleashed/Tyranitar-UL88',
          '3,1': [{ text: 'Hunde', url: CM + 'Undaunted/Houndoom-UD82' }, { text: 'mon' }]
        }
      }
    }
  });
  const o = env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/u/0/d/' + SHEET_ID + '/edit#gid=0');
  t.eq('Google Sheet direkt, ohne Kopie', [o.kind, o.sourceName, env.driveCopies.length, env.uiCall('importState').draft.tmpId], ['sheet', 'Lisas Karten', 4, '']);
  const s = env.uiCall('importSelectTab', 'Karten');
  t.eq('Links an den Text gehängt', [env.values('Import-Quelle')[1][0], env.values('Import-Quelle')[2][0]],
    ['Despotar ' + CM + 'Unleashed/Tyranitar-UL88', 'Hundemon ' + CM + 'Undaunted/Houndoom-UD82']);
  t.eq('Spalten geraten', [s.guess.cols.name, s.guess.cols.number, s.guess.cols.set, s.guess.cols.qty, s.guess.cols.cmLink], [0, 1, 2, 3, -1]);
  t.eq('andere Vorlage passt nicht', [s.suggested, s.templates.map((x) => x.matches)], [null, [false]]);
  const pr = env.uiCall('importPreviewRows', s.cfg);
  t.eq('Link aus dem Namen wird Cardmarket-Link, Name ohne Link', [pr.rows[0].fields.name, pr.rows[0].fields.cmUrl, pr.rows[1].fields.qty, pr.rows[3].skip],
    ['Despotar', CM + 'Unleashed/Tyranitar-UL88', 2, 'summe']);
  env.uiCall('importStartRecognition', s.cfg, '', 'alle');
  const r = recognize(env);
  t.eq('alles eindeutig (auch ohne Nummer über den Link)', r.counts, { eindeutig: 3, unklar: 0, nichtGefunden: 0, uebersprungen: 0, bekannt: 0 });
  t.eq('Stufe vorschau', env.uiCall('importState').draft.stage, 'vorschau');
  const pv = env.uiCall('importBuildPreview');
  t.eq('Alles addieren', [pv.modeLabel, pv.counts.kopien, pv.counts.mehr, pv.handMatch], ['Alles addieren', 4, 4, []]);
  const sumBefore = sum(env.data(), (d) => d.count);
  const dataBefore = JSON.stringify(env.data().map((d) => [d.eid, d.count]));
  // Abbruch mitten im Übernehmen (Daten werden nicht geschrieben)
  const realSave = c.storeSave_;
  c.storeSave_ = function () { throw new Error('Zeitlimit'); };
  t.throws('Übernehmen bricht ab', () => env.uiCall('importCommit', {}), /^Der Import wurde unterbrochen \(Zeitlimit\)\. Du kannst ihn in der Liste fortsetzen oder zurücknehmen\.$/);
  c.storeSave_ = realSave;
  t.eq('Daten unverändert', JSON.stringify(env.data().map((d) => [d.eid, d.count])), dataBefore);
  const st = env.uiCall('importState');
  t.eq('Import 4 unterbrochen, kein Lauf', [st.imports[0].nr, st.imports[0].status, st.busy], [4, 'unterbrochen', null]);
  t.ok('Protokoll: geplant', protoOf(env, 4).every((p) => p.Status === 'geplant') && protoOf(env, 4).length === 3, protoOf(env, 4).map((p) => p.Status));
  t.throws('neues Übernehmen gesperrt', () => env.uiCall('importCommit', {}), /Import 4 wurde unterbrochen\. Bitte ihn zuerst in der Liste mit „Fortsetzen“/);
  t.throws('anderen Import zurücknehmen gesperrt', () => env.uiCall('importUndo', 3, {}), /Import 4 wurde unterbrochen/);
  const rs = env.uiCall('importResume', 4);
  t.ok('Fortsetzen', /^Import 4 ist jetzt fertig: 3 Einträge nachgetragen\./.test(rs.message), rs.message);
  t.eq('Import 4 aktiv, Entwurf weg', [importe(env)[4].Status, env.uiCall('importState').draft], ['aktiv', null]);
  t.eq('Summe +4', sum(env.data(), (d) => d.count), sumBefore + 4);
  t.ok('Protokoll: erledigt', protoOf(env, 4).every((p) => p.Status === 'erledigt'));
  t.eq('Fortsetzen ist idempotent', env.uiCall('importResume', 4).message, 'Import 4 ist schon fertig.');
  t.eq('Herkunft Lisa', env.uiCall('searchCollection', 'Kramurx', '').groups[0].rows.map((x) => x.originLabel),
    [XLSX_NAME + ', Import 3', 'Lisas Karten, Import 4']);
  const u = env.uiCall('importUndo', 4, {});
  t.eq('Import 4 zurückgenommen', [u.deleted, sum(env.data(), (d) => d.count)], [3, sumBefore]);
  t.eq('Hand-Karten unberührt', handSnap(env, D.handEids), D.handSnap);
}

t.section('14. Regeln über den ganzen Ablauf');
{
  t.eq('nie verschachtelte Sperren', env.lock.nested, 0);
  t.eq('Sperre am Ende frei', env.lock.depth, 0);
  t.eq('keine Schreibzugriffe ohne Sperre', env.guard.violations, []);
  t.eq('alle temporären Kopien im Papierkorb', env.driveCopies.filter((x) => !env.driveFiles[x.to].trashed).map((x) => x.to), []);
  t.ok('jede öffentliche Import-Funktion aufgerufen', IMPORT_PUBLIC.filter((n) => !env.guard.calls[n] && ['importResume', 'importListTemplates'].indexOf(n) < 0).length === 0,
    IMPORT_PUBLIC.filter((n) => !env.guard.calls[n]));
}

t.section('15. Ohne Drive-Dienst');
{
  const e = newEnv({ drive: false });
  e.ctx.setupAll_();
  t.eq('importState: kein Drive', [e.uiCall('importState').driveService, e.uiCall('importState').driveVersion], [false, '']);
  addXlsx(e, ROWS_V1);
  t.throws('xlsx ohne Drive API', () => e.uiCall('importOpenSource', XLSX_URL),
    /^Für \.xlsx-Dateien bitte im Apps-Script-Editor links unter „Dienste“ die „Drive API“ hinzufügen\.$/);
  t.eq('kein Entwurf angelegt', e.uiCall('importState').draft, null);
  e.addSource({ id: 'GSHEETOHNEDRIVE', name: 'Liste', mime: 'sheet', tabs: { A: [['Name', 'Nummer', 'Set'], ['Ditto', '62', 'EX Delta Species']] } });
  t.eq('Google Sheet geht trotzdem', e.uiCall('importOpenSource', 'GSHEETOHNEDRIVE').kind, 'sheet');
  t.eq('Regeln', [e.lock.nested, e.guard.violations], [0, []]);
}

t.section('16. Drive v2');
{
  const e = newEnv({ drive: 'v2' });
  e.ctx.setupAll_();
  addXlsx(e, ROWS_V1);
  const o = e.uiCall('importOpenSource', XLSX_ID);
  const cp = e.driveCopies[0];
  t.eq('v2-Kopie mit convert', [o.kind, cp.resource.title, cp.resource.mimeType, cp.extra], ['xlsx', 'Pokémon-Import (temporär) ' + XLSX_NAME, H.MIME.GOOGLE_SHEETS, { convert: true, supportsAllDrives: true }]);
  e.uiCall('importSelectTab', 'Pokedex');
  t.eq('anderer Tab, Kopie im Papierkorb', [e.values('Import-Quelle')[0], e.driveFiles[cp.to].trashed], [['Nr', 'Pokémon', 'Vorhanden'], true]);
  const s2 = e.uiCall('importSelectTab', 'Tabellenblatt1');
  t.eq('Tab wechseln ohne Kopie: neu umgewandelt und wieder gelöscht', [s2.nRows, e.driveCopies.length, e.driveFiles[e.driveCopies[1].to].trashed], [ROWS_V1.length + 1, 2, true]);
  t.eq('Regeln', [e.lock.nested, e.guard.violations], [0, []]);
}

t.section('17. Checkliste (abhaken, später abwählen) und Raster (Ordnerseiten)');
{
  const e = newEnv();
  const ec = e.ctx;
  ec.setupAll_();
  e.uiCall('importSetsVorbelegen');
  t.eq('beide Begriffs-Vorbelegungen gleich', JSON.stringify(e.run('ER_TERM_SEED')), JSON.stringify(e.run('QU_TERMS_SEED')));
  const HG = 'HeartGold & SoulSilver';
  const list = (marks) => [['Nr', 'Name', 'Set', 'Vorhanden']].concat([['5', 'Gengar'], ['59', 'Endivie'], ['61', 'Feurigel'], ['78', 'Pikachu'], ['81', 'Karnimani']]
    .map((r, i) => [r[0], r[1], HG, marks[i]]));
  e.addSource({ id: 'CHECKLISTE001', name: 'Checkliste HGSS', mime: 'sheet', tabs: { HGSS: list(['WAHR', 'FALSCH', '✓', '', 'x']) } });
  e.uiCall('importOpenSource', 'CHECKLISTE001');
  const s = e.uiCall('importSelectTab', 'HGSS');
  t.eq('Checkliste geraten', [s.cfg.form, s.guess.cols.check, s.guess.cols.number, s.guess.cols.name], ['checkliste', 3, 0, 1]);
  const r0 = e.uiCall('importStartRecognition', s.cfg, '', 'neu');
  t.eq('zwei nicht angehakt', [r0.total, r0.skipped.nichtAngehakt], [5, 2]);
  const r = recognize(e);
  t.eq('Erkennung', [r.counts.eindeutig, r.counts.uebersprungen], [3, 2]);
  const res = e.uiCall('importCommit', {});
  t.eq('angehakte übernommen', e.data().map((d) => [d.name, d.count]).sort(), [['Feurigel', 1], ['Gengar', 1], ['Karnimani', 1]]);
  t.ok('Bericht nennt nicht angehakte', /2 nicht angehakt/.test(importe(e)[res.nr].Bericht), importe(e)[res.nr].Bericht);
  // später: Feurigel abgewählt, Endivie angehakt -> Abgleich
  e.addSource({ id: 'CHECKLISTE001', name: 'Checkliste HGSS', mime: 'sheet', tabs: { HGSS: list(['WAHR', 'ja', 'FALSCH', '', 'x']) } });
  e.uiCall('importOpenSource', 'CHECKLISTE001');
  const s2 = e.uiCall('importSelectTab', 'HGSS');
  e.uiCall('importStartRecognition', s2.cfg, '', 'abgleich');
  recognize(e);
  const pv = e.uiCall('importBuildPreview');
  t.eq('Abgleich: Endivie dazu, Feurigel weg', [pv.added.map((a) => a.title), pv.decreased.map((x) => [x.title, x.qty])], [['Endivie'], [['Feurigel', 1]]]);
  e.uiCall('importCommit', {});
  t.eq('nach dem Abgleich', e.data().map((d) => [d.name, d.count]).sort(), [['Endivie', 1], ['Feurigel', 0], ['Gengar', 1], ['Karnimani', 1]]);

  // Raster: Blöcke aus Name, Nummer, Set (3 Zeilen), eine Leerzeile dazwischen
  e.addSource({ id: 'RASTER000001', name: 'Ordnerseiten', mime: 'sheet', tabs: { Seite1: [
    ['Seite 1', '', ''],
    ['Gengar', 'Kramurx', 'Lugia'], ['5', '40', '111'], [HG, 'Entfesselt', HG],
    ['', '', ''],
    ['Despotar', '', 'Ho-Oh'], ['88', '', 'HGSS 01'], ['Entfesselt', '', ''],
    ['', '', '']
  ] } });
  e.uiCall('importOpenSource', 'RASTER000001');
  e.uiCall('importSelectTab', 'Seite1');
  const grid = { form: 'raster', headerRow: 0, firstRow: 2, lastRow: 0, cols: {}, fixed: { lang: 'DE' }, extras: [],
    grid: { startRow: 2, startCol: 'A', blockRows: 3, blockCols: 1, gapRows: 1, gapCols: 0, perRow: 0, cells: { name: [0, 0], number: [1, 0], set: [2, 0] } } };
  const pr = e.uiCall('importPreviewRows', grid);
  t.eq('Raster: Blöcke', pr.rows.map((x) => [x.srcRows[0], x.fields.name, x.fields.number]),
    [['r2c1', 'Gengar', '5'], ['r2c2', 'Kramurx', '40'], ['r2c3', 'Lugia', '111'], ['r6c1', 'Despotar', '88'], ['r6c3', 'Ho-Oh', 'HGSS 01']]);
  e.uiCall('importStartRecognition', grid, '', 'alle');
  const rr = recognize(e);
  t.eq('Raster: alles erkannt', [rr.counts.eindeutig, rr.total], [5, 5]);
  const before = sum(e.data(), (d) => d.count);
  const res3 = e.uiCall('importCommit', {});
  t.eq('Raster: übernommen', [res3.counts.kopien, sum(e.data(), (d) => d.count) - before], [5, 5]);
  t.eq('Raster: Gengar jetzt zweimal (Alles addieren)', e.data().filter((d) => d.name === 'Gengar').map((d) => [d.origin, d.count]),
    [['Import 1', 1], ['Import 3', 1]]);
  // Vorlagen auflisten
  e.uiCall('importSaveTemplate', 'Raster A', grid, 'alle');
  e.uiCall('importSaveTemplate', 'Raster B', grid, 'neu');
  t.eq('Vorlagen', e.uiCall('importListTemplates').map((x) => [x.name, x.mode, x.cfg.form]).sort(), [['Raster A', 'alle', 'raster'], ['Raster B', 'neu', 'raster']]);
  t.eq('Regeln', [e.lock.nested, e.guard.violations], [0, []]);
}

t.section('18. Spalten raten: Links in Zellen');
{
  const e = newEnv();
  const g = (v) => { const r = e.ctx.guessLayout_(v); return [r.cols.name, r.cols.number, r.cols.cmLink]; };
  const u = (s) => CM + 'Unleashed/' + s;
  t.eq('nur Links unter „Karte“ -> Cardmarket-Link', g([['Karte', 'Nr'], [u('Tyranitar-UL88'), '88'], [u('Murkrow-UL40'), '40']]), [-1, 1, 0]);
  t.eq('verlinkte Namen bleiben Namen', g([['Name', 'Nr'], ['Despotar ' + u('Tyranitar-UL88'), '88'], ['Kramurx ' + u('Murkrow-UL40'), '40']]), [0, 1, -1]);
  t.eq('verlinkte Namen + eigene Link-Spalte', g([['Name', 'Nr', 'Spalte 3'], ['Despotar ' + u('Tyranitar-UL88'), '88', u('Tyranitar-UL88')],
    ['Kramurx ' + u('Murkrow-UL40'), '40', u('Murkrow-UL40')]]), [0, 1, 2]);
  t.eq('Link-Spalte ohne passende Überschrift', g([['Name', 'Nr', 'X'], ['Despotar', '88', u('Tyranitar-UL88')], ['Kramurx', '40', '']]), [0, 1, 2]);
}

t.done();
