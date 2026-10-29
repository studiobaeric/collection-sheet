'use strict';
/**
 * Tests für Code.gs (Datenmodell v2, Gruppen, Sammlungs-API, Preislauf, Web-App, API-Prüfung).
 * Start: node test_core.js   (Exit-Code 1 bei Fehlern)
 */
const H = require('./harness2');
const t = H.runner('test_core');
const ok = t.ok, eq = t.eq;

const TODAY = H.formatDate(new Date(), '', 'yyyy-MM-dd');
const TODAY_DMY = H.formatDate(new Date(), '', 'dd.MM.yyyy');

/** Frische Umgebung mit allen .gs-Dateien (ohne Import.gs oder Update.gs läuft das Tool nicht, #36 B2). */
function fresh(opts) {
  return H.createEnv(opts || {});
}

function setup(opts) {
  const env = fresh(opts);
  env.ctx.setupAll_();
  return env;
}

/** Kartenzusammenfassung wie Import.gs sie für buildCardRow_ liefert. */
function glurakCard(extra) {
  return Object.assign({
    dataLang: 'de', id: 'swsh3-025', name: 'Glurak', nameEn: '', setId: 'swsh3', setName: 'Flammende Finsternis',
    setDate: '2020-08-14', localId: '025', setSize: 189, img: 'https://assets.tcgdex.net/de/x/swsh3-025',
    rarity: 'Rare', category: 'Pokemon', illustrator: 'X', baseVariant: 'normal', price: 1.5, priceDate: '2026-10-13'
  }, extra || {});
}

/** Zeile wie ein Import anlegen (origin 'Import <nr>', fp). */
function addImportRow(env, card, opts) {
  const c = env.ctx;
  return c.withLock_(function () {
    const row = c.buildCardRow_(card, Object.assign({ origin: c.originOf_(opts.nr || 3), fp: opts.fp || 'fp1' }, opts));
    c.appendDataRows_([row]);
    c.afterDataChange_();
    return row;
  });
}

function eidOfRow(row, env) { return row[env.run('COL.eid')]; }

function importeSheet(env, rows) {
  const sh = env.ss.getSheetByName('Importe') || env.ss.insertSheet('Importe');
  const head = ['Nr', 'Datum', 'Quelle', 'Quelle-ID', 'Tab', 'Vorlage', 'Modus', 'Status', 'Neu', 'Mehr', 'Weniger',
    'Übersprungen', 'Prüfliste offen', 'Wertänderung (EUR)', 'Zurückgenommen am', 'Bericht'];
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  rows.forEach((r, i) => sh.getRange(i + 2, 1, 1, 4).setValues([[r.nr, new Date(2026, 9, 1), r.name, r.id]]));
  return sh;
}

function groupBy(env, gkey) { return env.groups().find(g => g['Gruppenschlüssel'] === gkey); }

// ---------------------------------------------------------------------------
t.section('Migration v1 -> v2');
{
  const env = fresh();
  const sh = env.ss.insertSheet('Daten');
  const V1 = ['Schlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer', 'Nummer normalisiert', 'Setgröße',
    'Name', 'Name englisch', 'Quelle', 'Variante', 'Zustand', 'Anzahl', 'Trendpreis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit',
    'Kartentyp', 'Illustrator', 'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar'];
  const d1 = new Date(2026, 8, 1), d2 = new Date(2026, 8, 2);
  const rows = [
    V1,
    ['swsh3-025|normal|NM', 'swsh3-025', 'swsh3', 'Flammende Finsternis', '2020-08-14', '025', '25', 189, 'Glurak', '', 'de', 'normal', 'NM', 2, 1.5, '2026-10-13', 'https://img/a', 'Rare', 'Pokemon', 'X', d1, d1, 25],
    [],
    ['base1-4|holo|', 'base1-4', 'base1', 'Grundset', '1999-01-09', '4', '4', 102, 'Glurak', '', 'de', 'holo', '', 1, 300, '2026-10-13', '', 'Rare Holo', 'Pokemon', 'Mitsuhiro Arita', d2, d2, 4],
    ['old9-007|normal|LP', 'old9-007', 'old9', 'Old Set', '', '007', '7', 50, 'Mewtu', 'Mewtwo', 'en-Ersatz', 'normal', 'LP', 0, '', '', 'https://img/m', 'Rare', 'Pokemon', 'Y', d2, d2, 7]
  ];
  rows.forEach((r, i) => r.forEach((v, j) => sh.setCell(i + 1, j + 1, v))); // Rohdaten wie im echten Blatt
  env.ctx.ensureSchema_();
  const v = env.values('Daten');
  eq('v2 headers (30)', v[0].slice(0, 30), env.run('DATA_HEADERS'));
  const data = env.data();
  ok('3 rows, blank row dropped', data.length === 3, data.length);
  ok('eids E + 10 hex, unique', data.every(r => /^E[0-9a-f]{10}$/.test(r.eid)) && new Set(data.map(r => r.eid)).size === 3, data.map(r => r.eid));
  ok('lang DE, origin Hand, fp/version/ownPrice empty', data.every(r => r.lang === 'DE' && r.origin === 'Hand' && r.fp === '' && r.version === '' && r.ownPrice === '' && r.ownPriceDate === ''));
  eq('new keys', data.map(r => r.key), ['swsh3-025|normal||NM|DE', 'base1-4|holo|||DE', 'old9-007|normal||LP|DE']);
  ok('number text kept', data[0].localId === '025' && data[2].localId === '007', data.map(r => r.localId));
  ok('dates kept', data[0].added instanceof Date && data[0].added.getTime() === d1.getTime());
  ok('SCHEMA_VERSION = 2', env.setting('SCHEMA_VERSION') === '2');
  ok('Gruppen built (3)', env.groups().length === 3, env.groups().length);
  const before = JSON.stringify(env.data().map(r => [r.eid, r.key, r.count]));
  env.ctx.settingSet_('SCHEMA_VERSION', '');
  env.ctx.migrateSchema_();
  ok('second run idempotent', JSON.stringify(env.data().map(r => [r.eid, r.key, r.count])) === before);
  // Zusatzspalte überlebt setupAll_
  env.ctx.withLock_(() => env.ctx.ensureExtraColumn_('Notiz'));
  env.sheet('Daten').getRange(2, 31).setValue('Lieblingskarte');
  env.ctx.setupAll_();
  const v2 = env.values('Daten');
  ok('setupAll_ keeps extra header + value', v2[0][30] === 'Notiz' && v2[1][30] === 'Lieblingskarte', v2[0].slice(28));
  ok('setupAll_ keeps data', JSON.stringify(env.data().map(r => [r.eid, r.key, r.count])) === before);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}
{
  // leeres v1-Blatt, fehlendes Blatt, alte Zusatzspalte hinter Spalte W
  const env = fresh();
  const sh = env.ss.insertSheet('Daten');
  sh.getRange(1, 1, 1, 3).setValues([['Schlüssel', 'Karten-ID', 'Set-ID']]);
  env.ctx.ensureSchema_();
  ok('empty v1 sheet migrated', env.values('Daten')[0][23] === 'Eintrag-ID' && env.data().length === 0 && env.setting('SCHEMA_VERSION') === '2');

  const env2 = fresh();
  env2.ctx.ensureSchema_();
  ok('missing Daten created with v2 headers', env2.sheet('Daten') && env2.values('Daten')[0][29] === 'Quellzeile' && env2.setting('SCHEMA_VERSION') === '2');
  ok('Gruppen exists after migrate', !!env2.sheet('Gruppen'));

  const env3 = fresh();
  const s3 = env3.ss.insertSheet('Daten');
  const head = env3.run('DATA_HEADERS').slice(0, 23).concat(['Meine Notiz']);
  s3.getRange(1, 1, 1, 24).setValues([head]);
  const r = ['base1-4|holo|', 'base1-4', 'base1', 'Grundset', '', '4', '4', 102, 'Glurak', '', 'de', 'holo', '', 1, '', '', '', '', '', '', '', '', 4, 'alt'];
  r.forEach((x, j) => s3.setCell(2, j + 1, x));
  env3.ctx.ensureSchema_();
  const d3 = env3.data();
  ok('old extra column moved to extras', d3[0].extras['Meine Notiz'] === 'alt' && d3[0].eid && d3[0].origin === 'Hand', d3[0]);
}

// ---------------------------------------------------------------------------
t.section('Hilfsfunktionen');
{
  const env = setup();
  const c = env.ctx;
  eq('entryKey_ tcgdex', c.entryKey_({ id: 'x-1', variant: 'holo', version: 'Snowflake', cond: 'NM', lang: 'en' }), 'x-1|holo|Snowflake|NM|EN');
  eq('entryKey_ free', c.entryKey_({ id: '', name: ' Mew ', setName: 'Black Star', localId: '012/50', variant: 'normal', version: '', cond: '', lang: 'DE' }), 'frei:mew~black star~12|normal|||DE');
  eq('groupKey_ free', c.groupKey_({ name: 'Mew', setName: 'Black Star', normNum: '12', variant: 'normal', version: 'Staff' }), 'frei:mew~black star~12|normal|Staff');
  eq('originOf_/importNrOf_', [c.originOf_(4), c.importNrOf_('Import 4'), c.importNrOf_('Hand'), c.importNrOf_('')], ['Import 4', 4, null, null]);
  eq('ORIGIN_HAND', env.run('ORIGIN_HAND'), 'Hand');
  eq('LANGS first/last', [env.run('LANGS')[0], env.run('LANGS')[10]], [['DE', 'Deutsch'], ['ZH', 'Chinesisch']]);
  ok('newEid_ format', /^E[0-9a-f]{10}$/.test(c.newEid_()));
  const free = c.buildCardRow_({ free: true, name: 'Mew', setName: 'Black Star', localId: '012/50' }, { count: 2, variant: 'holo', lang: 'EN', ownPrice: '1,50' });
  const o = c.rowObj_(free);
  ok('buildCardRow_ free card', o.source === 'frei' && o.id === '' && o.localId === '012' && o.setSize === 50 && o.normNum === '12' && o.count === 2 &&
    o.ownPrice === 1.5 && o.ownPriceDate === TODAY && o.key === 'frei:mew~black star~12|holo|||EN' && o.origin === 'Hand' && o.img === '', o);
  const tc = c.buildCardRow_(glurakCard({ dataLang: 'en', name: 'Charizard', inputName: 'Glurak' }), { variant: 'base', cond: 'nm', count: 3, origin: 'Import 2', fp: 'abc' });
  const to = c.rowObj_(tc);
  ok('buildCardRow_ en card', to.name === 'Glurak' && to.nameEn === 'Charizard' && to.source === 'en-Ersatz' && to.variant === 'normal' && to.cond === 'NM' &&
    to.count === 3 && to.price === 1.5 && to.origin === 'Import 2' && to.fp === 'abc' && to.lang === 'DE', to);
  c.withLock_(() => c.ensureExtraColumn_('Fach'));
  eq('extraNames_/dataHeaders_', [c.extraNames_(), c.dataHeaders_().length], [['Fach'], 31]);
  ok('ensureExtraColumn_ idempotent', c.withLock_(() => c.ensureExtraColumn_('Fach')) === 30);
  t.throws('ensureExtraColumn_ rejects fixed name', () => c.withLock_(() => c.ensureExtraColumn_('Name')), /feste Spalte/);
  const withExtra = c.buildCardRow_(glurakCard(), { extras: { Fach: 'A3', Unbekannt: 'x' } });
  ok('objToRow_ places extras', withExtra.length === 31 && withExtra[30] === 'A3', withExtra.length);
  ok('rowObj_ extras', c.rowObj_(withExtra).extras.Fach === 'A3');
  c.withLock_(() => c.appendDataRows_([free, tc, withExtra]));
  ok('appendDataRows_ keeps text formats', env.data().length === 3 && env.data()[0].localId === '012' && env.data()[2].localId === '025', env.data().map(r => r.localId));
  c.withLock_(() => c.rewriteData_([tc]));
  ok('rewriteData_ replaces block, clears rest', env.data().length === 1 && env.data()[0].fp === 'abc', env.data().length);
  eq('parsePrice_', [c.parsePrice_('1,50 €'), c.parsePrice_('1.50'), c.parsePrice_('€ 1,5'), c.parsePrice_('1.234,56'), c.parsePrice_(''), isNaN(c.parsePrice_('abc'))], [1.5, 1.5, 1.5, 1234.56, null, true]);
}

// ---------------------------------------------------------------------------
t.section('Import-Protokoll');
{
  const env = setup();
  const c = env.ctx;
  const ids = c.withLock_(() => c.appendProto_([
    { nr: 1, type: 'neu', eid: 'E1', fp: 'f1', qty: 2, data: { id: 'x', extras: {} }, status: 'geplant', sourceId: 'S' },
    { nr: 1, type: 'spalte', data: { name: 'Fach' }, sourceId: 'S' }
  ]));
  ok('appendProto_ returns L-ids', ids.length === 2 && ids.every(id => /^L[0-9a-f]{10}$/.test(id)), ids);
  const sh = env.sheet('Import-Protokoll');
  ok('proto sheet hidden with headers', sh.hidden && env.values('Import-Protokoll')[0].join('|') === env.run('PROTO_HEADERS').join('|'));
  let p = c.readProto_();
  ok('readProto_ parses', p.length === 2 && p[0].nr === 1 && p[0].qty === 2 && p[0].data.id === 'x' && p[0].status === 'geplant' && p[1].status === 'erledigt' && p[0].row === 2 && p[1].data.name === 'Fach', p);
  c.withLock_(() => c.setProtoStatus_([ids[0]], 'erledigt'));
  ok('setProtoStatus_', c.readProto_()[0].status === 'erledigt');
  const many = c.withLock_(() => c.appendProto_(Array.from({ length: 8 }, (_, i) => ({ nr: 2, type: 'neu', eid: 'E' + i, fp: 'g' + i, qty: 1 }))));
  c.withLock_(() => c.deleteProtoByIds_([ids[1]]));
  ok('deleteProtoByIds_ small', c.readProto_().length === 9 && !c.readProto_().some(x => x.logId === ids[1]));
  c.withLock_(() => c.deleteProtoByIds_(many.slice(0, 7)));
  p = c.readProto_();
  ok('deleteProtoByIds_ rewrite path', p.length === 2 && p[1].logId === many[7] && p[1].row === 3, p.map(x => x.logId));
}

// ---------------------------------------------------------------------------
t.section('addCard / addFreeCard');
{
  const env = setup();
  let r = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  ok('addCard creates Hand row', r.count === 1 && /^E/.test(r.eid) && r.key === 'swsh3-025|normal||NM|DE' && r.gkey === 'swsh3-025|normal|', r);
  const r2 = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  ok('addCard merges into Hand row', r2.eid === r.eid && r2.count === 3 && env.data().length === 1, r2);
  ok('message without language/version', !/Deutsch|Englisch/.test(r2.message) && /jetzt 3 Stück/.test(r2.message), r2.message);
  const r3 = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'LP', qty: 1, cardLang: 'EN' });
  ok('cardLang EN -> own row, same group', r3.eid !== r.eid && r3.key === 'swsh3-025|normal||LP|EN' && r3.gkey === r.gkey && /Englisch/.test(r3.message), r3);
  const r4 = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, version: ' Snowflake ' });
  ok('version -> own group, message mentions it', r4.gkey === 'swsh3-025|normal|Snowflake' && /Snowflake/.test(r4.message), r4);
  // Import-Zeile mit gleichem Schlüssel: addCard bleibt bei der Zeile von Hand
  addImportRow(env, glurakCard(), { nr: 3, fp: 'fpA', cond: 'NM', count: 4 });
  const r5 = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  const imp = env.data().find(x => x.origin === 'Import 3');
  ok('addCard ignores import row', r5.eid === r.eid && r5.count === 4 && imp.count === 4, [r5, imp.count]);
  // eigener Preis gilt für die ganze Gruppe
  const r6 = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'GD', qty: 1, ownPrice: 2.5 });
  const grp = env.data().filter(x => x.id === 'swsh3-025' && x.variant === 'normal' && x.version === '');
  ok('ownPrice set on all rows of group', grp.length === 4 && grp.every(x => x.ownPrice === 2.5 && x.ownPriceDate === TODAY), grp.map(x => [x.origin, x.ownPrice]));
  ok('ownPrice message', /Eigener Preis: 2,50 €/.test(r6.message), r6.message);
  const snow = env.data().find(x => x.version === 'Snowflake');
  ok('other group untouched', snow.ownPrice === '');
  // en-Ersatz
  const r7 = env.uiCall('addCard', { id: 'old9-007', lang: 'en', variant: 'base', qty: 1, inputName: 'Mewtu' });
  const mew = env.data().find(x => x.eid === r7.eid);
  ok('en card stored with input name', mew.name === 'Mewtu' && mew.nameEn === 'Mewtwo' && mew.source === 'en-Ersatz' && mew.lang === 'DE', mew);
  t.throws('addCard invalid ownPrice', () => env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', ownPrice: 'abc' }), /gültigen Preis/);

  const f1 = env.uiCall('addFreeCard', { name: 'Pikachu Promo', setName: 'Black Star', number: '012/50', variant: 'holo', condition: 'LP', qty: 2, cardLang: 'en', ownPrice: '1,50' });
  const fr = env.data().find(x => x.eid === f1.eid);
  ok('addFreeCard row', fr.source === 'frei' && fr.id === '' && fr.img === '' && fr.price === '' && fr.localId === '012' && fr.setSize === 50 &&
    fr.variant === 'holo' && fr.cond === 'LP' && fr.lang === 'EN' && fr.count === 2 && fr.ownPrice === 1.5 && fr.origin === 'Hand', fr);
  ok('addFreeCard shape', f1.key === 'frei:pikachu promo~black star~12|holo||LP|EN' && f1.gkey === 'frei:pikachu promo~black star~12|holo|' && f1.count === 2 && /Pikachu Promo/.test(f1.message), f1);
  const f2 = env.uiCall('addFreeCard', { name: 'pikachu promo', setName: 'black star', number: '12', variant: 'holo', condition: 'LP', qty: 1, cardLang: 'EN' });
  ok('addFreeCard merges', f2.eid === f1.eid && f2.count === 3, f2);
  const f3 = env.uiCall('addFreeCard', { name: 'Ohne Set' });
  ok('addFreeCard defaults', f3.count === 1 && /\|normal\|\|\|DE$/.test(f3.key), f3);
  t.throws('addFreeCard needs name', () => env.uiCall('addFreeCard', { name: '  ' }), /Namen/);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('searchCollection');
{
  const env = setup();
  importeSheet(env, [{ nr: 3, name: 'Pokemon Ordner', id: 'SRC1' }]);
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'LP', qty: 1, cardLang: 'EN' });
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  addImportRow(env, glurakCard(), { nr: 3, fp: 'fpA', cond: '', count: 2 });
  addImportRow(env, glurakCard(), { nr: 7, fp: 'fpB', cond: 'EX', count: 1 });
  env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1 });
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, version: 'Snowflake' });
  ok('Set-Daten gleich beim Hinzufügen, auch neuer Sets (#43)', env.data().every(r => /^\d{4}-\d\d-\d\d$/.test(r.setDate)), env.data().map(r => [r.id, r.setDate]));
  let res = env.uiCall('searchCollection', '', '');
  ok('groups total', res.total === 3 && res.groups.length === 3, res.total);
  eq('sort by set date (base1 first)', res.groups.map(g => g.gkey), ['base1-4|holo|', 'swsh3-025|normal|', 'swsh3-025|normal|Snowflake']);
  const g = res.groups[1];
  const keys = ['gkey', 'name', 'nameEn', 'source', 'isFree', 'setName', 'localId', 'setSize', 'variant', 'variantLabel', 'version', 'count', 'image', 'price', 'priceManual', 'ownPrice', 'exemplare', 'rows'];
  ok('group shape', keys.every(k => k in g), Object.keys(g));
  ok('group values', g.name === 'Glurak' && g.count === 5 && g.price === 1.5 && g.priceManual === false && g.ownPrice === null && g.isFree === false && g.localId === '025' && g.setSize === 189 && g.variantLabel === 'Normal', g);
  eq('exemplare text', g.exemplare, '2× DE, 1× DE NM, 1× DE EX, 1× EN LP');
  eq('rows: Hand first, then import nr, then lang', g.rows.map(r => [r.origin, r.lang, r.cond]), [['Hand', 'DE', 'NM'], ['Hand', 'EN', 'LP'], ['Import 3', 'DE', ''], ['Import 7', 'DE', 'EX']]);
  eq('origin labels', g.rows.map(r => r.originLabel), ['von Hand', 'von Hand', 'Pokemon Ordner, Import 3', 'Import 7']);
  ok('row shape', g.rows.every(r => ['eid', 'key', 'cond', 'lang', 'count', 'origin', 'originLabel', 'isImport', 'importNr', 'extras'].every(k => k in r)) &&
    g.rows[2].isImport === true && g.rows[2].importNr === 3 && g.rows[0].isImport === false && g.rows[0].importNr === null, g.rows);
  ok('row eid matches addCard', g.rows[1].eid === a.eid);
  res = env.uiCall('searchCollection', 'snow', '');
  ok('text matches version', res.total === 1 && res.groups[0].version === 'Snowflake', res.groups.map(x => x.gkey));
  res = env.uiCall('searchCollection', '25/189', '');
  ok('number with set size', res.total === 2, res.total);
  res = env.uiCall('searchCollection', 'glurak 4', '');
  ok('name + number', res.total === 1 && res.groups[0].gkey === 'base1-4|holo|', res.groups.map(x => x.gkey));
  res = env.uiCall('searchCollection', '', 'Darkness Ablaze');
  ok('set filter via English set name', res.total === 2, res.total);
  // count-0-Gruppen ans Ende
  const b = env.uiCall('searchCollection', 'glurak 4', '').groups[0].rows[0];
  env.uiCall('adjustEntry', b.eid, -1);
  res = env.uiCall('searchCollection', '', '');
  ok('count 0 group last', res.groups[res.groups.length - 1].gkey === 'base1-4|holo|' && res.groups[res.groups.length - 1].count === 0, res.groups.map(x => [x.gkey, x.count]));
  // höchstens 60 Gruppen
  const c = env.ctx;
  c.withLock_(() => {
    const rows = [];
    for (let i = 0; i < 65; i++) rows.push(c.buildCardRow_({ free: true, name: 'Karte ' + i, setName: 'Ordner', localId: String(i + 1) }, { count: 1 }));
    c.appendDataRows_(rows);
    c.afterDataChange_();
  });
  res = env.uiCall('searchCollection', '', '');
  ok('60-group cap', res.total === 68 && res.groups.length === 60, [res.total, res.groups.length]);
  const fg = env.uiCall('searchCollection', 'Karte', 'Ordner').groups.find(x => x.name === 'Karte 7');
  ok('free group flags', fg && fg.isFree && fg.image === '' && fg.price === null && fg.source === 'frei', fg);
}

// ---------------------------------------------------------------------------
t.section('adjustEntry / revertAdjust');
{
  const env = setup();
  importeSheet(env, [{ nr: 3, name: 'Pokemon Ordner', id: 'SRC1' }]);
  const c = env.ctx;
  c.withLock_(() => c.ensureExtraColumn_('Fach'));
  const imp = addImportRow(env, glurakCard(), { nr: 3, fp: 'fpA', cond: 'NM', count: 2, extras: { Fach: 'A1' }, ownPrice: 3 });
  const impEid = eidOfRow(imp, env);
  // +1 auf Import-Zeile -> neue Zeile von Hand
  let r = env.uiCall('adjustEntry', impEid, 1);
  const hand = env.data().find(x => x.origin === 'Hand');
  ok('+1 on import row creates Hand row', hand && r.eid === hand.eid && r.token.createdEid === hand.eid && r.count === 1 && r.applied === 1 && r.groupCount === 3, r);
  ok('created Hand row copies card, extras, own price', hand.id === 'swsh3-025' && hand.cond === 'NM' && hand.fp === '' && hand.extras.Fach === 'A1' && hand.ownPrice === 3 && hand.key === 'swsh3-025|normal||NM|DE', hand);
  ok('import row unchanged', env.data().find(x => x.eid === impEid).count === 2);
  ok('token shape', r.token.eid === hand.eid && r.token.applied === 1 && Array.isArray(r.token.logIds) && r.token.logIds.length === 0 && r.gkey === 'swsh3-025|normal|', r.token);
  const tokCreate = r.token;
  r = env.uiCall('adjustEntry', impEid, 1);
  ok('second +1 uses existing Hand row', r.eid === hand.eid && r.count === 2 && r.token.createdEid === '' && env.data().length === 2, r);
  // -1 auf Import-Zeile -> handentfernt
  r = env.uiCall('adjustEntry', impEid, -1);
  let p = c.readProto_();
  ok('-1 on import row logs handentfernt', r.count === 1 && r.applied === -1 && r.token.logIds.length === 1 && p.length === 1 &&
    p[0].type === 'handentfernt' && p[0].nr === 3 && p[0].fp === 'fpA' && p[0].qty === 1 && p[0].eid === impEid && p[0].sourceId === 'SRC1' && p[0].status === 'erledigt', [r, p]);
  const tokMinus = r.token;
  // Rückgängig
  r = env.uiCall('revertAdjust', tokMinus);
  ok('revert -1 restores count, deletes log', r.count === 2 && r.eid === impEid && c.readProto_().length === 0 && r.groupCount === 4 && r.gkey === 'swsh3-025|normal|', r);
  // Untergrenze 0
  r = env.uiCall('adjustEntry', impEid, -5);
  p = c.readProto_();
  ok('floor at 0, Menge = removed', r.count === 0 && r.applied === -2 && p.length === 1 && p[0].qty === 2, [r, p]);
  r = env.uiCall('adjustEntry', impEid, -1);
  ok('no log when nothing removed', r.applied === 0 && r.count === 0 && r.token.logIds.length === 0 && c.readProto_().length === 1, r);
  // -1 auf Hand-Zeile: kein Protokoll
  r = env.uiCall('adjustEntry', hand.eid, -1);
  ok('-1 on Hand row: no log', r.count === 1 && c.readProto_().length === 1, r);
  // Rückgängig des +1, das die Zeile angelegt hat: Zeile ist wieder 0 -> gelöscht
  r = env.uiCall('revertAdjust', tokCreate);
  ok('revert of creating +1 deletes Hand row at 0', r.count === 0 && !env.data().some(x => x.eid === hand.eid) && env.data().length === 1, [r, env.data().length]);
  ok('Gruppen rechnet gleich mit (#43)', groupBy(env, 'swsh3-025|normal|')['Anzahl'] === 0, groupBy(env, 'swsh3-025|normal|')['Anzahl']);
  t.throws('unknown eid', () => env.uiCall('adjustEntry', 'Exxxxxxxxxx', 1), /nicht gefunden/);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('editEntry');
{
  const env = setup();
  const c = env.ctx;
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 3 });
  const added = env.data()[0].added.getTime();
  let r = env.uiCall('editEntry', a.eid, { cond: 'LP' }, 1);
  let d = env.data();
  const split = d.find(x => x.eid === r.eid);
  ok('split: new row with qty and change', r.ok && r.eid !== a.eid && split.count === 1 && split.cond === 'LP' && split.origin === 'Hand' && split.added.getTime() === added && split.key === 'swsh3-025|normal||LP|DE', split);
  ok('split: original keeps rest', d.find(x => x.eid === a.eid).count === 2 && d.find(x => x.eid === a.eid).cond === 'NM');
  r = env.uiCall('editEntry', split.eid, { cond: 'NM' });
  d = env.data();
  ok('merge back into same key + origin', r.eid === a.eid && d.length === 1 && d[0].count === 3, d.map(x => [x.eid, x.count]));
  // Sprache: zwei Hand-Zeilen werden zusammengelegt
  const en = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1, cardLang: 'EN' });
  r = env.uiCall('editEntry', en.eid, { cardLang: 'DE' });
  d = env.data();
  ok('Hand merge on language change', r.eid === a.eid && d.length === 1 && d[0].count === 4, d.map(x => [x.lang, x.count]));
  // Import-Zeilen: Teilen behält Herkunft + Quellzeile, Zusammenlegen nur mit gleicher Quellzeile
  const imp = addImportRow(env, glurakCard(), { nr: 2, fp: 'fpX', cond: 'NM', count: 2 });
  const impEid = eidOfRow(imp, env);
  r = env.uiCall('editEntry', impEid, { cardLang: 'EN' }, 1);
  const child = env.data().find(x => x.eid === r.eid);
  ok('import split keeps origin and fp', child.origin === 'Import 2' && child.fp === 'fpX' && child.lang === 'EN' && child.count === 1, child);
  r = env.uiCall('editEntry', child.eid, { cardLang: 'DE' });
  d = env.data();
  ok('import child merges back (same key+origin+fp), not into Hand', r.eid === impEid && d.find(x => x.eid === impEid).count === 2 && d.find(x => x.eid === a.eid).count === 4 && d.length === 2, d.map(x => [x.origin, x.count]));
  // Zusatzwerte
  c.withLock_(() => c.ensureExtraColumn_('Fach'));
  r = env.uiCall('editEntry', a.eid, { extras: { Fach: ' B2 ' } }, 1);
  d = env.data();
  ok('extras change on split (no merge back)', r.eid !== a.eid && d.find(x => x.eid === r.eid).extras.Fach === 'B2' && d.find(x => x.eid === a.eid).count === 3, d.map(x => [x.eid, x.count, x.extras.Fach]));
  r = env.uiCall('editEntry', a.eid, { extras: { 'Neue Spalte': 'x' } });
  ok('unknown extra creates column', c.extraNames_().indexOf('Neue Spalte') >= 0 && env.data().find(x => x.eid === a.eid).extras['Neue Spalte'] === 'x');
  // Sonderversion wechselt die Gruppe
  r = env.uiCall('editEntry', a.eid, { version: 'Snowflake' });
  ok('version moves to other group', r.gkey === 'swsh3-025|normal|Snowflake' && groupBy(env, 'swsh3-025|normal|Snowflake')['Anzahl'] === 3, r);
  r = env.uiCall('editEntry', a.eid, {});
  ok('no change -> ok', r.ok && r.eid === a.eid);
  t.throws('invalid condition', () => env.uiCall('editEntry', a.eid, { cond: 'XX' }), /Zustand/);
  t.throws('qty 0', () => env.uiCall('editEntry', a.eid, { cond: 'LP' }, 0), /Anzahl/);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('setGroupOwnPrice / Gruppen');
{
  const env = setup();
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'LP', qty: 1, cardLang: 'EN' });
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  addImportRow(env, glurakCard(), { nr: 1, fp: 'f', cond: '', count: 2 });
  let g = groupBy(env, a.gkey);
  eq('Exemplare ordered by LANGS then CONDITIONS', g['Exemplare'], '2× DE, 1× DE NM, 1× EN LP');
  ok('Gruppen trend price', g['Preis (EUR)'] === 1.5 && g['Preisstand'] === '2026-10-13' && g['Anzahl'] === 4, g);
  let r = env.uiCall('setGroupOwnPrice', a.gkey, 4.2);
  ok('set own price', r.gkey === a.gkey && r.price === 4.2 && r.priceManual === true, r);
  ok('own price on all rows', env.data().every(x => x.ownPrice === 4.2 && x.ownPriceDate === TODAY));
  g = groupBy(env, a.gkey);
  ok('Gruppen effective price + manuell date', g['Preis (EUR)'] === 4.2 && g['Preisstand'] === 'manuell ' + TODAY_DMY, g['Preisstand']);
  const s = env.uiCall('searchCollection', '', '').groups[0];
  ok('search shows manual price', s.price === 4.2 && s.priceManual && s.ownPrice === 4.2);
  r = env.uiCall('setGroupOwnPrice', a.gkey, null);
  ok('clear own price', r.price === 1.5 && r.priceManual === false && env.data().every(x => x.ownPrice === '' && x.ownPriceDate === ''), r);
  env.uiCall('setGroupOwnPrice', a.gkey, '3,10');
  ok('price as text', env.data().every(x => x.ownPrice === 3.1));
  r = env.uiCall('setGroupOwnPrice', a.gkey, 0);
  ok('0 clears', r.priceManual === false && env.data().every(x => x.ownPrice === ''));
  env.uiCall('setGroupOwnPrice', a.gkey, 2);
  r = env.uiCall('setGroupOwnPrice', a.gkey, '');
  ok("'' clears", r.priceManual === false);
  t.throws('invalid price', () => env.uiCall('setGroupOwnPrice', a.gkey, 'abc'), /gültigen Preis/);
  t.throws('unknown group', () => env.uiCall('setGroupOwnPrice', 'x|normal|', 2), /nicht gefunden/);
  // Name mit Sonderversion, leere Gruppe, freie Karte
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, version: 'Snowflake' });
  ok('Gruppen name with version', groupBy(env, 'swsh3-025|normal|Snowflake')['Name'] === 'Glurak · Snowflake');
  {
    // Hilfsspalten für die Ansichtsformel (#39 V2)
    const gv = groupBy(env, 'swsh3-025|normal|Snowflake');
    const num = gv['Preis (EUR)'] === '' ? 0 : gv['Preis (EUR)'] * gv['Anzahl'];
    ok('Gruppen helper columns', gv['Suchtext'] === ['Glurak · Snowflake', gv['Name englisch'], gv['Illustrator']].join('\n') &&
      gv['Wert (EUR)'] === num && gv['Name Anzeige'] === 'Glurak · Snowflake' && gv['Nummer Anzeige'] === gv['Nummer'] + (gv['Setgröße'] === '' ? '' : '/' + gv['Setgröße']) &&
      gv['Variante Anzeige'] === 'Normal' && (gv['Preis Anzeige'] === gv['Preis (EUR)'] || (gv['Preis (EUR)'] === '' && gv['Preis Anzeige'] === 'kein Preis')), gv);
  }
  const b = env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1 });
  env.uiCall('adjustEntry', b.eid, -1);
  g = groupBy(env, b.gkey);
  ok('empty group: Exemplare empty, Anzahl 0', g['Exemplare'] === '' && g['Anzahl'] === 0, g);
  // Zusatzspalten in der Ansicht
  const c = env.ctx;
  c.withLock_(() => c.ensureExtraColumn_('Fach'));
  const rows = env.data().filter(x => x.id === 'swsh3-025' && x.version === '');
  env.uiCall('editEntry', rows[0].eid, { extras: { Fach: 'A1' } });
  env.uiCall('editEntry', rows[1].eid, { extras: { Fach: 'B2' } });
  env.uiCall('editEntry', rows[2].eid, { extras: { Fach: 'A1' } });
  const ve = env.uiCall('setViewExtras', ['Fach', 'Gibtsnicht', 'Fach']);
  eq('setViewExtras keeps existing names only', ve, { viewExtras: ['Fach'] });
  g = groupBy(env, a.gkey);
  ok('Gruppen extra column values joined', env.values('Gruppen')[0][env.run('GROUP_HEADERS').length] === 'Fach' && (g['Fach'] === 'A1 / B2' || g['Fach'] === 'B2 / A1'), g['Fach']);
  const view = env.values('Sammlung');
  ok('view header has extra', view[4][16] === 'Fach', view[4]);
  const f = env.sheet('Sammlung').formulas['6,1'];
  ok('view formula reads Gruppen with extra', /'Gruppen'!A2:AH,/.test(f) && /CHOOSECOLS\(srt, 34\)\s*\)\)\), IF\(ISERROR\(INDEX\(lst, 1, 2\)\), "Keine Einträge gefunden", IFERROR\(lst, ""\)\)\)$/.test(f) && !/Daten'?!/.test(f), f.slice(0, 120));
  env.sheet('Sammlung').getRange('B4').setValue('glurak');
  env.uiCall('setViewExtras', []);
  ok('view controls kept on layout change', env.sheet('Sammlung').getRange('B4').getValue() === 'glurak');
  ok('extra removed from view', env.values('Gruppen')[0].length === env.run('GROUP_HEADERS').length && env.values('Sammlung')[4][15] === 'Preisstand' && env.values('Sammlung')[4][16] === '', env.values('Sammlung')[4]);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('viewFormula_ / Ansicht');
{
  const env = setup();
  const c = env.ctx;
  const f0 = c.viewFormula_(0), f2 = c.viewFormula_(2);
  const G = env.run('GCOL');
  ok('GCOL matches GROUP_HEADERS', env.run('GROUP_HEADERS').every((h, i) => G[h] === i + 1) && G['Anzahl'] === 14 && G['Suchtext'] === 27);
  ok('formula 0 extras', /FILTER\(VSTACK\('Gruppen'!A2:AG, ""\), VSTACK\('Gruppen'!A2:A<>"", FALSE\)\)/.test(f0) && /HSTACK\(flt, zsort, msort\), 34, TRUE, 35, TRUE, 5, TRUE, 3, TRUE, 23, TRUE, 7, TRUE, 12, TRUE, 9, TRUE\)/.test(f0), f0);
  ok('formula 2 extras', /'Gruppen'!A2:AI,/.test(f2) && /, 36, TRUE, 37, TRUE,/.test(f2) && /CHOOSECOLS\(srt, 16\), CHOOSECOLS\(srt, 34\), CHOOSECOLS\(srt, 35\) \)\)\)/.test(f2), f2);
  ok('no LAMBDA, BYROW, MAP or REDUCE (#39 V2)', !/LAMBDA|BYROW|MAP\(|REDUCE/.test(f0) && /^=LET\(lst, ARRAYFORMULA\(LET\(/.test(f0) && /MMULT\(SIGN\(hit\)/.test(f0));
  ok('Zuletzt hinzugefügt uses column 21', /tm, CHOOSECOLS\(flt, 21\)/.test(f0));
  // Ausgabe: Spalten der Ansicht in der Reihenfolge von VIEW_HEADERS (Bild zuerst, aus der Bild-URL)
  const outCols = (f0.match(/IMAGE\(url&"\/low\.png"\), IF\(H4=TRUE, "–", ""\)\),\s+(.*?) \)\)\)/) || [])[1] || '';
  const want = ['Name Anzeige', 'Setname', 'Nummer Anzeige', 'Variante Anzeige', 'Exemplare', 'Anzahl', 'Preis Anzeige', 'Wert (EUR)',
    'Veränderung 30 Tage (EUR)', 'Veränderung 30 Tage (%)', 'Verlauf seit', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand'];
  eq('view columns by name', (outCols.match(/CHOOSECOLS\(srt, \d+\)/g) || []).map(x => +x.replace(/\D/g, '')), want.map(h => G[h]));
  ok('url from Bild-URL, search in Suchtext, number and set size', /url, CHOOSECOLS\(srt, 17\)/.test(f0) && /SEARCH\(wd, CHOOSECOLS\(dat, 27\)\)/.test(f0) &&
    /TO_TEXT\(CHOOSECOLS\(dat, 7\)\)=wnr/.test(f0) && /TO_TEXT\(CHOOSECOLS\(dat, 8\)\)=wsz/.test(f0) && /CHOOSECOLS\(dat, 4\)=C4/.test(f0) && /wert, CHOOSECOLS\(flt, 28\)/.test(f0));
  ok('no <? in formula', f0.indexOf('<?') < 0);
  eq('VIEW_HEADERS', env.run('VIEW_HEADERS'), ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Exemplare', 'Anzahl', 'Preis (EUR)', 'Wert (EUR)', '± 30 Tage (EUR)', '± 30 Tage (%)', 'Verlauf seit', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand']);
  ok('Daten probe now Gruppen', env.run('FORMULA_PROBES').some(p => /Gruppen!A1:Z/.test(p[0])) && !env.run('FORMULA_PROBES').some(p => /Daten!/.test(p[0])));
  const z = env.sheet('Sammlung').formulas['2,26'];
  ok('set list from Gruppen!D2:D', /'Gruppen'!D2:D/.test(z), z);
  // Semikolon-Rückfall der Selbstprüfung
  env.setFormulaDisplay((sheet, a1, formula) => (/,/.test(formula.replace(/"[^"]*"/g, '')) ? '#ERROR!' : ''));
  c.ansichtNeuAufbauen();
  const a6 = env.sheet('Sammlung').formulas['6,1'];
  ok('setFormulaLocal_ falls back to semicolons', /VSTACK\('Gruppen'!A2:AG; ""\); VSTACK\('Gruppen'!A2:A<>""; FALSE\)/.test(a6), a6.slice(0, 80));
  ok('ansichtNeuAufbauen message', /Ansicht neu aufgebaut/.test(env.ui.alerts[env.ui.alerts.length - 1]));
}

// ---------------------------------------------------------------------------
t.section('linkFreeGroup');
{
  const env = setup();
  importeSheet(env, [{ nr: 3, name: 'Ordner', id: 'SRC1' }]);
  const existing = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  const free = env.uiCall('addFreeCard', { name: 'Glurak alt', setName: 'Flammende', number: '25', condition: 'NM', qty: 1, ownPrice: 9 });
  const c = env.ctx;
  const imp = addImportRow(env, { free: true, name: 'Glurak alt', setName: 'Flammende', localId: '25' }, { nr: 3, fp: 'fz', cond: 'LP', count: 1, ownPrice: 9 });
  ok('free group has hand + import row', env.uiCall('searchCollection', 'Glurak alt', '').groups[0].rows.length === 2);
  const r = env.uiCall('linkFreeGroup', free.gkey, 'swsh3-025', 'de', 'base');
  ok('link returns new gkey', r.gkey === 'swsh3-025|normal|', r);
  const d = env.data();
  const hand = d.find(x => x.eid === existing.eid);
  ok('free Hand row merged into existing Hand row', hand.count === 3 && !d.some(x => x.eid === free.eid), d.map(x => [x.eid, x.origin, x.count]));
  ok('own price carried to merge target', hand.ownPrice === 9, hand.ownPrice);
  const li = d.find(x => x.eid === eidOfRow(imp, env));
  ok('import row linked, keeps origin/fp/cond/ownPrice', li.id === 'swsh3-025' && li.origin === 'Import 3' && li.fp === 'fz' && li.cond === 'LP' && li.ownPrice === 9 &&
    li.source === 'de' && li.name === 'Glurak' && li.setName === 'Flammende Finsternis' && li.localId === '025' && li.img && li.price === 1.5 && li.key === 'swsh3-025|normal||LP|DE', li);
  ok('one group now', env.groups().length === 1 && env.groups()[0]['Anzahl'] === 4);
  // englische Daten: freier Name bleibt
  const f2 = env.uiCall('addFreeCard', { name: 'Mewtu Spezial', number: '7' });
  const r2 = env.uiCall('linkFreeGroup', f2.gkey, 'old9-007', 'en', 'base');
  const m = env.data().find(x => x.eid === f2.eid);
  ok('en link keeps free name', r2.gkey === 'old9-007|normal|' && m.name === 'Mewtu Spezial' && m.nameEn === 'Mewtwo' && m.source === 'en-Ersatz', m);
  t.throws('linking a linked group fails', () => env.uiCall('linkFreeGroup', 'old9-007|normal|', 'old9-007', 'en', 'base'), /nicht gefunden|schon/);
  t.throws('unknown card', () => env.uiCall('linkFreeGroup', 'frei:x~~|normal|', 'nope-1', 'de', 'base'), /nicht gefunden/);
}

// ---------------------------------------------------------------------------
t.section('Preislauf und Verlauf');
{
  const env = setup();
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 2 });
  const b = env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1, ownPrice: 10 });
  env.uiCall('addFreeCard', { name: 'Frei', qty: 2, ownPrice: 1.5 });
  env.uiCall('addFreeCard', { name: 'Ohne Preis', qty: 1 });
  const targets = env.ctx.priceTargets_().map(x => x.key);
  eq('price targets: own-price ids too (for the curve), never free cards', targets, ['de|base1-4', 'de|swsh3-025']);
  // Preisänderung bei tcgdex
  env.DB['de/cards/swsh3-025'].pricing.cardmarket.trend = 2;
  env.fetchLog.length = 0;
  env.ctx.preiseJetztAktualisieren();
  ok('base1-4 (own price) fetched', env.fetchLog.some(u => /cards\/base1-4/.test(u)), env.fetchLog);
  ok('trend written + Gruppen rebuilt', env.data().find(x => x.eid === a.eid).price === 2 && groupBy(env, a.gkey)['Preis (EUR)'] === 2);
  const hist = env.values('Verlauf');
  const last = hist[hist.length - 1];
  ok('history uses effective price (2*2 + 10 + 2*1.5)', last[1] === 17 && last[2] === 6 && last[3] === 1, last);
  ok('PRICE_RUN cleared', !env.props.PRICE_RUN);
  ok('own price untouched by price run', env.data().find(x => x.eid === b.eid).ownPrice === 10);
  // Verlauf wächst über die letzte Zeile hinaus (alter Test)
  const hs = env.sheet('Verlauf');
  hs.clearContents();
  hs.getRange(1, 1, 3, 5).setValues([env.run('HIST_HEADERS'), [new Date(2026, 9, 1), 1, 1, 0, 0], [new Date(2026, 9, 2), 1, 1, 0, 0]]);
  hs.maxRows = 3;
  env.ctx.writeHistory_(0);
  ok('Verlauf adds rows when full', hs.maxRows === 369 && hs.get(4, 2) === 17, [hs.maxRows, hs.get(4, 2)]);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('getUiConfig / Web-App / onEdit / API-Prüfung');
{
  const env = setup();
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, version: 'Snowflake' });
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, version: 'Staff' });
  env.ctx.withLock_(() => env.ctx.ensureExtraColumn_('Fach'));
  env.uiCall('setViewExtras', ['Fach']);
  const cfg = env.uiCall('getUiConfig');
  ok('getUiConfig shape', Array.isArray(cfg.conditions) && cfg.conditions.some(x => x.code === 'NM' && x.label) && cfg.conditions.length === 8 &&
    cfg.langs.length === 11 && cfg.langs[0].code === 'DE' && cfg.langs[0].label === 'Deutsch', cfg);
  eq('getUiConfig versions/extras/viewExtras', [cfg.versions, cfg.extras, cfg.viewExtras], [['Snowflake', 'Staff'], ['Fach'], ['Fach']]);

  const out = env.ctx.doGet();
  ok('doGet: template mode web', out.template && out.template.mode === 'web' && out.template.__file === 'Ui' && out.title === 'Pokémon-Sammlung' && out.meta.some(m => m[0] === 'viewport'), out.template);
  env.ctx.kartenErfassen();
  const sb = env.ui.sidebars[0];
  ok('kartenErfassen: sidebar mode', sb && sb.template.mode === 'sidebar' && sb.title === 'Pokémon-Karten');
  ok('include returns file content', /<script>/.test(env.ctx.include('Ui')));
  ok('include of missing file returns empty text', env.ctx.include('GibtEsNicht') === '');

  // onEdit im Blatt Daten berechnet Gruppen neu
  const sh = env.sheet('Daten');
  const gk = 'swsh3-025|normal|Snowflake';
  sh.getRange(2, 14).setValue(5);
  env.ctx.onEdit({ range: sh.getRange(2, 14) });
  ok('onEdit on Daten rebuilds Gruppen', groupBy(env, gk)['Anzahl'] === 5, groupBy(env, gk));
  sh.getRange(2, 14).setValue(6);
  env.lock.busy = true;
  let threw = false;
  try { env.ctx.onEdit({ range: sh.getRange(2, 14) }); } catch (e) { threw = true; }
  env.lock.busy = false;
  ok('onEdit when busy: no error, Gruppen rechnet trotzdem (#43)', !threw && groupBy(env, gk)['Anzahl'] === 6);
  // kopierte Zeile mit gleicher Eintrag-ID bekommt eine neue
  const row2 = sh.getRange(2, 1, 1, 30).getValues()[0];
  sh.getRange(4, 1, 1, 30).setValues([row2]);
  env.ctx.onEdit({ range: sh.getRange(4, 1) });
  const eids = env.data().map(x => x.eid);
  // Fixer (MIGR-2): eine kopierte Hand-Zeile wird in die Hand-Zeile desselben Schlüssels eingerechnet
  // (höchstens eine Hand-Zeile pro Eintrag), statt als zweite Hand-Zeile mit neuer ID stehen zu bleiben
  ok('duplicate eid repaired (copied Hand row merged, count added)', new Set(eids).size === eids.length && eids.length === 2 &&
    env.data()[0].count === 12 && env.data()[0].eid === row2[23] && env.data()[0].origin === 'Hand', env.data().map(x => [x.eid, x.origin, x.count]));
  // onEdit Sammlung H4 wie bisher
  let heights = 0;
  const orig = env.ctx.applyRowHeights_;
  env.ctx.applyRowHeights_ = function () { heights++; };
  env.ctx.onEdit({ range: env.sheet('Sammlung').getRange('H4') });
  env.ctx.applyRowHeights_ = orig;
  ok('onEdit H4 still adjusts row heights', heights === 1);

  // API-Prüfung mit Attrappe
  env.DB['de/sets/dpp'] = { id: 'dpp', name: 'DP Black Star Promos', cards: [{ id: 'dpp-DP16', localId: 'DP16', name: 'Pikachu' }, { id: 'dpp-DP01', localId: 'DP01', name: 'Turtwig' }] };
  env.DB['en/sets/dpp'] = { id: 'dpp', name: 'DP Black Star Promos', abbreviation: { official: 'DPP' }, cards: [{ id: 'dpp-DP16', localId: 'DP16', name: 'Pikachu' }] };
  env.DB['en/sets/hgss2'] = { id: 'hgss2', name: 'HS Unleashed', tcgOnline: 'UL', cards: [] };
  env.DB['ja/sets'] = [{ id: 'SV1a', name: 'Triplet Beat' }];
  env.DB['ja/sets/SV1a'] = { id: 'SV1a', cards: [{ id: 'SV1a-001', localId: '001', name: 'ピカチュウ' }] };
  env.DB['ja/cards/SV1a-001'] = { id: 'SV1a-001', localId: '001', name: 'ピカチュウ', set: { name: 'Triplet Beat' } };
  env.DB['en/sets'].push({ id: 'mep', name: 'MEP Black Star Promos' });
  env.DB['en/sets/mep'] = { id: 'mep', name: 'MEP Black Star Promos', cards: [{ id: 'mep-001', localId: '001', name: 'X' }] };
  threw = false;
  try { env.ctx.apiPruefen(); } catch (e) { threw = e; }
  ok('apiPruefen does not throw', !threw, threw && threw.message);
  const chk = env.values('API-Check').map(r => r.join(' | '));
  ok('steps 1-9 kept', ['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. '].every(p => chk.some(l => l.indexOf(p) === 0)), chk.slice(0, 5));
  ok('step 10 Pikachu dpp', chk.some(l => /^10\. Pikachu in dpp \(de\) \| 1 Karten \| DP16 Pikachu/.test(l)), chk.filter(l => /^10/.test(l)));
  ok('step 11 abbreviations', chk.some(l => /^11\. Set dpp \| abbreviation: \{"official":"DPP"\}/.test(l)) && chk.some(l => /^11\. Set hgss2 .*tcgOnline: "UL"/.test(l)) && chk.some(l => /^11\. Set me01 \| Set fehlt/.test(l)), chk.filter(l => /^11/.test(l)));
  ok('step 12 promo numbers incl. mep', chk.some(l => /^12\. Promo dpp/.test(l)) && chk.some(l => /^12\. Promo mep/.test(l)), chk.filter(l => /^12/.test(l)));
  ok('step 13 Japanese', chk.some(l => /^13\. \/ja\/sets \| 1 Sets/.test(l)) && chk.some(l => /^13\. \/ja\/cards\/SV1a-001 \| ja/.test(l)), chk.filter(l => /^13/.test(l)));
  ok('step 14 Drive v3', chk.some(l => /^14\. .*vorhanden, v3/.test(l)), chk.filter(l => /^14/.test(l)));
  const env2 = setup({ drive: false });
  env2.ctx.apiPruefen();
  ok('step 14 without Drive', env2.values('API-Check').some(r => /^14\./.test(r[0]) && r[1] === 'fehlt'));
  const env3 = setup({ drive: 'v2' });
  env3.ctx.apiPruefen();
  ok('step 14 Drive v2', env3.values('API-Check').some(r => /^14\./.test(r[0]) && /v2/.test(r[1])));
}

// ---------------------------------------------------------------------------
t.section('Bestehendes Verhalten (Suche, Details, Set-Datum)');
{
  const env = setup();
  let r = env.uiCall('searchCards', { name: 'Glurak' });
  ok('searchCards de', r.stage === 'de' && r.cards.length === 3, r.cards.map(x => x.id));
  r = env.uiCall('searchCards', { name: 'Glurak', number: '25/189' });
  ok('searchCards with number', r.cards.length === 1 && r.cards[0].id === 'swsh3-025');
  const det = env.uiCall('getCardDetail', 'swsh3-136', 'de');
  ok('getCardDetail en price fallback', det.priceFromEn === true && det.prices.base === 1.5, det);
  const bs = env.uiCall('getCardBySetNumber', 'swsh3', '136');
  ok('getCardBySetNumber', bs.id === 'swsh3-136');
  r = env.uiCall('searchCards', { name: 'Mewtu' });
  ok('en fallback via translation', r.stage === 'en' && r.cards[0].id === 'old9-007', r);
  // Set-Datum: ein Set ohne Datum im Blatt Sets holt addCard einmal von tcgdex und merkt es im Blatt Sets
  env.fetchLog.length = 0;
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  ok('addCard holt das Datum eines neuen Sets', env.data()[0].setDate === '2020-08-14' && env.fetchLog.filter(u => /\/sets\/swsh3$/.test(u)).length === 1, [env.data()[0].setDate, env.fetchLog]);
  env.fetchLog.length = 0;
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, condition: 'LP' });
  ok('danach aus dem Blatt Sets, kein zweiter Abruf', !env.fetchLog.some(u => /\/sets\//.test(u)), env.fetchLog);
  const sh = env.sheet('Daten');
  sh.getRange(2, 5).setValue('');
  env.uiCall('addCard', { id: 'swsh3-136', lang: 'de', variant: 'base', qty: 1 });
  ok('addCard backfills set date', env.data()[0].setDate === '2020-08-14' && env.data()[1].setDate === '2020-08-14', env.data().map(x => x.setDate));
  sh.getRange(2, 5).setValue('');
  env.ctx.preiseJetztAktualisieren();
  ok('price run backfills set date', env.data().every(x => x.setDate === '2020-08-14'));
  ok('Web-App link unchanged', typeof env.ctx.webAppLinkAnzeigen === 'function');
  env.promptResponse = 'https://script.google.com/macros/s/abc/exec';
  env.ctx.webAppLinkAnzeigen();
  ok('web app link saved', env.setting('WEBAPP_URL') === 'https://script.google.com/macros/s/abc/exec');
  ok('menu mit Dashboard, ohne Einsortieren und Einrichtung (#43)', env.ctx.onOpen() === undefined && env.ui.menus[0].items.length === 7 &&
    env.ui.menus[0].items[1][1] === 'zumDashboard' && !env.ui.menus[0].items.some(x => x[1] === 'einrichtung' || x[1] === 'einsortieren'), env.ui.menus[0].items);
  ok('getSetSuggestions', env.uiCall('getSetSuggestions').indexOf('Darkness Ablaze') >= 0);
  ok('Hand row count', a.count === 1);
}

// ---------------------------------------------------------------------------
t.section('Direkte Änderungen im Blatt Daten');
{
  const env = setup();
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  ok('Gruppen Nummer stays text', groupBy(env, a.gkey)['Nummer'] === '025' && groupBy(env, a.gkey)['Nummer normalisiert'] === '25');
  const sh = env.sheet('Daten');
  const COL = env.run('COL');
  sh.getRange(2, COL.cond + 1).setValue('LP');
  sh.getRange(2, COL.lang + 1).setValue('');
  env.ctx.onEdit({ range: sh.getRange(2, COL.cond + 1) });
  const d = env.data()[0];
  ok('stale key and empty lang repaired', d.key === 'swsh3-025|normal||LP|DE' && d.lang === 'DE', d);
  eq('Gruppen follows edit', groupBy(env, a.gkey)['Exemplare'], '2× DE LP');
  // neue Zeile von Hand eingetippt (ohne ID und Herkunft)
  const row = sh.getRange(2, 1, 1, 30).getValues()[0];
  row[COL.eid] = ''; row[COL.origin] = ''; row[COL.cond] = 'EX'; row[COL.count] = 1;
  sh.getRange(3, 1, 1, 30).setValues([row]);
  env.ctx.onEdit({ range: sh.getRange(3, 1) });
  const d3 = env.data()[1];
  ok('typed row gets eid, origin Hand, key', /^E[0-9a-f]{10}$/.test(d3.eid) && d3.origin === 'Hand' && d3.key === 'swsh3-025|normal||EX|DE', d3);
  const r = env.uiCall('adjustEntry', d3.eid, 1);
  ok('typed row usable by eid', r.count === 2 && r.groupCount === 4, r);
}

// ---------------------------------------------------------------------------
t.section('Harness (Attrappen für Import.gs)');
{
  const env = fresh();
  const c = env.ctx;
  env.addSource({
    id: 'SRCSHEET', name: 'Meine Sammlung', mime: 'sheet',
    tabs: {
      Liste: { values: [['Name', 'Nr', 'Preis'], ['Glurak', '025/189', 1.5], ['Summe', '', 1.5]], display: [['Name', 'Nr', 'Preis'], ['Glurak', '025/189', '1,50 €'], ['Summe', '', '1,50 €']],
        links: { '2,1': 'https://www.cardmarket.com/de/Pokemon/Products/Singles/Darkness-Ablaze/Charizard-DAA25' } },
      Leer: []
    }
  });
  env.addSource({ id: 'XLSX1', name: 'Ordner.xlsx', mime: 'xlsx', tabs: { Blatt1: [['Karte', 'Anzahl'], ['Pikachu', 2]] } });
  const f = c.DriveApp.getFileById('SRCSHEET');
  ok('DriveApp file', f.getName() === 'Meine Sammlung' && f.getMimeType() === c.MimeType.GOOGLE_SHEETS);
  const src = c.SpreadsheetApp.openById('SRCSHEET');
  const tab = src.getSheetByName('Liste');
  ok('source sheets', src.getSheets().map(x => x.getName()).join(',') === 'Liste,Leer' && tab.getLastRow() === 3 && tab.getLastColumn() === 3);
  const rng = tab.getDataRange();
  eq('getDisplayValues override', rng.getDisplayValues()[1], ['Glurak', '025/189', '1,50 €']);
  const rt = rng.getRichTextValues();
  ok('rich text link + null for numbers', rt[1][0].getLinkUrl().indexOf('cardmarket.com') > 0 && rt[1][0].getText() === 'Glurak' && rt[1][2] === null && rt[1][1].getLinkUrl() === null, rt[1].map(x => x && x.getLinkUrl()));
  t.throws('xlsx cannot be opened directly', () => c.SpreadsheetApp.openById('XLSX1'), /openById/);
  const copy = c.Drive.Files.copy({ name: 'Pokémon-Import (temporär) Ordner.xlsx', mimeType: c.MimeType.GOOGLE_SHEETS }, 'XLSX1');
  ok('Drive v3 copy converts', typeof c.Drive.Files.create === 'function' && c.SpreadsheetApp.openById(copy.id).getSheetByName('Blatt1').getRange(2, 2).getValue() === 2);
  c.DriveApp.getFileById(copy.id).setTrashed(true);
  ok('setTrashed recorded', env.driveFiles[copy.id].trashed === true);
  const env2 = fresh({ drive: 'v2' });
  env2.addSource({ id: 'X', name: 'a.xlsx', mime: 'xlsx', tabs: { T: [['a']] } });
  const c2 = env2.ctx.Drive.Files.copy({ title: 't', mimeType: env2.ctx.MimeType.GOOGLE_SHEETS }, 'X', { convert: true });
  ok('Drive v2 copy (no create)', typeof env2.ctx.Drive.Files.create === 'undefined' && !!env2.ctx.SpreadsheetApp.openById(c2.id));
  ok('no Drive when drive:false', fresh({ drive: false }).run("typeof Drive") === 'undefined');
  const dg = c.Utilities.computeDigest(c.Utilities.DigestAlgorithm.MD5, 'abc');
  ok('computeDigest MD5 signed bytes', dg.length === 16 && dg.some(b => b < 0) && dg.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('') === '900150983cd24fb0d6963f7d28e17f72', dg);
  ok('formatDate patterns', c.Utilities.formatDate(new Date(2026, 0, 5), 'Europe/Berlin', 'yyyy-MM-dd') === '2026-01-05' && c.Utilities.formatDate(new Date(2026, 0, 5), 'x', 'dd.MM.yyyy') === '05.01.2026');
  const cache = c.CacheService.getScriptCache();
  cache.put('set:de:x', '{"a":1}', 21600);
  ok('cache get/remove', cache.get('set:de:x') === '{"a":1}' && (cache.remove('set:de:x'), cache.get('set:de:x') === null));
  t.throws('cache value limit', () => cache.put('big', 'x'.repeat(101 * 1024)), /too large/);
  const u1 = c.Utilities.getUuid(), u2 = c.Utilities.getUuid();
  ok('deterministic uuid', u1 !== u2 && /^[0-9a-f-]{36}$/.test(u1));
  const sh = env.ss.insertSheet('T');
  sh.getRange(1, 1, 3, 2).setValues([['a', 1], ['b', 2], ['c', 3]]);
  sh.deleteRows(2, 1);
  sh.insertColumnsAfter(1, 1);
  ok('deleteRows / insertColumnsAfter shift', sh.getRange(2, 1).getValue() === 'c' && sh.getRange(2, 3).getValue() === 3 && sh.getMaxColumns() === 27);
  t.throws('range out of bounds throws', () => sh.getRange(1, 28), /außerhalb/);
  sh.getRange(5, 1).setValue('007');
  sh.getRange(6, 1).setNumberFormat('@').setValue('007');
  ok('auto-typing like Sheets', sh.getRange(5, 1).getValue() === 7 && sh.getRange(6, 1).getValue() === '007');
  t.throws('uiCall rejects Dates', () => { env.ctx.__d = function () { return { d: new Date() }; }; env.uiCall('__d'); }, /Date/);
}

// ---------------------------------------------------------------------------
t.section('Code-Regeln');
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(H.SRC_DIR, 'Code.gs'), 'utf8');
  ok('no em-dash in Code.gs', src.indexOf('—') < 0);
  ok('no require/import in Code.gs', !/\brequire\(|^\s*import\s/m.test(src));
  const env = fresh();
  const pub = Object.keys(env.ctx).filter(k => typeof env.ctx[k] === 'function' && !/_$/.test(k));
  const want = ['getUiConfig', 'addCard', 'addFreeCard', 'searchCollection', 'adjustEntry', 'revertAdjust', 'editEntry',
    'setGroupOwnPrice', 'linkFreeGroup', 'getSetSuggestions', 'setViewExtras', 'include', 'doGet', 'kartenErfassen', 'searchCards', 'getCardDetail', 'getCardBySetNumber'];
  ok('public API present', want.every(n => pub.indexOf(n) >= 0), want.filter(n => pub.indexOf(n) < 0));
}

t.done();
