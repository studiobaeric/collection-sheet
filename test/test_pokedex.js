'use strict';
/**
 * Tests für Pokédex, Seltenheiten und die Sortierung der Sammlung (Code.gs Abschnitt 10 + Ui.html).
 * Start: node test_pokedex.js   (Exit-Code 1 bei Fehlern; jsdom liegt in ./node_modules)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness2');
const t = H.runner('test_pokedex');
const ok = t.ok, eq = t.eq;
const J = x => JSON.stringify(x);

// ---------------------------------------------------------------------------
// tcgdex-Attrappe: Karten mit dexId, Tag Team, Trainer, Karte ohne dexId
// ---------------------------------------------------------------------------
function db() {
  const d = H.defaultDb();
  const set = (id, name, official) => ({ id, name, cardCount: { official, total: official } });
  const add = (id, lang, extra) => { d[lang + '/cards/' + id] = H.card(id, lang, extra); };
  ['de', 'en'].forEach(lang => {
    add('swsh3-025', lang, { dexId: [6], rarity: lang === 'de' ? 'Selten' : 'Rare' });
    add('swsh3-136', lang, { dexId: [6], rarity: lang === 'de' ? 'Selten, besondere Illustration' : 'Special illustration rare', pricing: lang === 'de' ? undefined : H.card('x-1', 'en').pricing });
    add('sm9-33', lang, { name: lang === 'de' ? 'Pikachu & Zekrom-GX' : 'Pikachu & Zekrom-GX', dexId: [25, 644], rarity: lang === 'de' ? 'Holografisch Selten GX' : 'Rare Holo GX',
      set: set('sm9', lang === 'de' ? 'Teams sind Trumpf' : 'Team Up', 181),
      pricing: { cardmarket: { trend: 12, 'trend-holo': 0, updated: '2026-10-13T00:00:00Z' } } });
    add('swsh1-178', lang, { name: lang === 'de' ? 'Professorin Magnolia' : 'Professor Magnolia', category: 'Trainer', rarity: lang === 'de' ? 'Ungewöhnlich' : 'Uncommon',
      set: set('swsh1', lang === 'de' ? 'Schwert & Schild' : 'Sword & Shield', 202),
      pricing: { cardmarket: { trend: 0.2, 'trend-holo': 0.5, updated: '2026-10-13T00:00:00Z' } } });
    add('sv1-1', lang, { name: lang === 'de' ? 'Mewtu' : 'Mewtwo', rarity: lang === 'de' ? 'Häufig' : 'Common', set: set('sv1', lang === 'de' ? 'Karmesin & Purpur' : 'Scarlet & Violet', 198),
      pricing: { cardmarket: { trend: 0.1, 'trend-holo': 0.3, updated: '2026-10-13T00:00:00Z' } } }); // ohne dexId
    d[lang + '/sets/sm9'] = { id: 'sm9', name: lang === 'de' ? 'Teams sind Trumpf' : 'Team Up', releaseDate: '2019-02-01', cards: [] };
    d[lang + '/sets/swsh1'] = { id: 'swsh1', name: 'Schwert & Schild', releaseDate: '2020-02-07', cards: [] };
    d[lang + '/sets/sv1'] = { id: 'sv1', name: 'Karmesin & Purpur', releaseDate: '2023-03-31', cards: [] };
  });
  return d;
}

function setup() {
  const env = H.createEnv({ db: db() });
  env.ctx.setupAll_();
  return env;
}

const add = (env, id, extra) => env.ctx.addCard(Object.assign({ id, lang: 'de', variant: 'base', condition: 'NM', qty: 1 }, extra || {}));
const dexRow = (env, nr) => env.objects('Pokédex-Daten').find(o => o['Nr.'] === nr);
/** Kartenliste im Pokédex (H6:P) für die Auswahl sel in I4: [Bild, Name, Set, Nummer, Variante, Seltenheit, Anzahl, Preis, Wert] */
const dexCards = (env, sel) => {
  env.sheet('Pokédex').getRange('I4').setValue(sel);
  return env.values('Pokédex').slice(5).map(r => r.slice(7, 16)).filter(r => r[1] !== '' && r[1] != null);
};
/** Gemerkte Nummern (Pokédex-Nummern A:C) als [Karten-ID, Nummern] */
const knownDex = env => env.objects('Pokédex-Nummern').filter(o => o['Karten-ID'] !== '').map(o => [o['Karten-ID'], String(o['Pokédex-Nr.'])]);

// ---------------------------------------------------------------------------
t.section('Namen und Nummern');
{
  const env = H.createEnv({ files: ['Code.gs'] });
  const c = env.ctx;
  const n = c.dexNames_();
  eq('1025 deutsche und englische Namen', [n.de.length, n.en.length], [1025, 1025]);
  eq('Stichproben', [n.de[0], n.de[5], n.de[24], n.de[1024], n.en[5], n.en[121]], ['Bisasam', 'Glurak', 'Pikachu', 'Infamomo', 'Charizard', 'Mr. Mime']);
  eq('Generationen', [c.dexGen_(1), c.dexGen_(151), c.dexGen_(152), c.dexGen_(809), c.dexGen_(810), c.dexGen_(1025), c.dexGen_(1026)], [1, 1, 2, 7, 8, 9, '']);
  const f = s => J(c.dexFromName_(s));
  eq('Glurak-ex', f('Glurak-ex'), '[6]');
  eq('Glurak ex (Leerzeichen)', f('Glurak ex'), '[6]');
  eq('Charizard VMAX (englisch)', f('Charizard VMAX'), '[6]');
  eq('Alola-Vulpix', f('Alola-Vulpix'), '[37]');
  eq('Brocks Onix', f('Brocks Onix'), '[95]');
  eq('Dunkles Ho-Oh', f('Dunkles Ho-Oh'), '[250]');
  eq('Ho-Oh', f('Ho-Oh'), '[250]');
  eq('Porygon-Z', f('Porygon-Z'), '[474]');
  eq('Mr. Mime', f('Pantimos'), '[122]');
  eq('Typ:Null', f('Typ:Null'), '[772]');
  eq('Nidoran ♀ mit Leerzeichen', f('Nidoran ♀'), '[29]');
  eq('Tag Team: beide', f('Pikachu & Zekrom-GX'), '[25,644]');
  eq('Tag Team mit drei', f('Mewtu & Mew-GX'), '[150,151]');
  eq('Trainer: nichts', f('Professorin Magnolia'), '[]');
  eq('leer', f(''), '[]');
  eq('dexIdsOf_: Liste, Zahl, fehlt, Unsinn', [J(c.dexIdsOf_({ dexId: [25, 644, 25] })), J(c.dexIdsOf_({ dexId: 6 })), J(c.dexIdsOf_({})), J(c.dexIdsOf_({ dexId: ['x', 0] }))],
    ['[25,644]', '[6]', '[]', '[]']);
  eq('parseDexText_', [J(c.parseDexText_('25 644')), J(c.parseDexText_(6)), J(c.parseDexText_(''))], ['[25,644]', '[6]', '[]']);
  ok('Kartentyp', c.isPokemonCategory_('Pokémon') && c.isPokemonCategory_('') && !c.isPokemonCategory_('Trainer') && !c.isPokemonCategory_('Energie') && !c.isPokemonCategory_('Energy'));
}

// ---------------------------------------------------------------------------
t.section('Einrichtung');
{
  const env = setup();
  const names = env.ss.list.map(s => s.name);
  ok('Blätter angelegt', ['Pokédex', 'Pokédex-Daten', 'Seltenheiten'].every(n => names.indexOf(n) >= 0), names);
  eq('Dashboard vorne, dann Sammlung und Pokédex', names.slice(0, 3), ['Dashboard', 'Sammlung', 'Pokédex']);
  ok('Pokédex-Daten versteckt, Pokédex und Seltenheiten sichtbar',
    env.sheet('Pokédex-Daten').hidden && !env.sheet('Pokédex').hidden && !env.sheet('Seltenheiten').hidden);
  ok('nach der Einrichtung: Dashboard offen (#28)', env.ss.getActiveSheet().getName() === 'Dashboard', env.ss.getActiveSheet().getName());
  const list = env.objects('Pokédex-Daten');
  eq('1025 Pokémon, alle fehlend', [list.length, list.filter(o => o['Exemplare'] > 0).length], [1025, 0]);
  eq('Zeile 25', J(Object.fromEntries(Object.entries(dexRow(env, 25)).slice(0, 8))), J({ 'Nr.': 25, Name: 'Pikachu', 'Name englisch': 'Pikachu', Generation: 1, Karten: 0, Exemplare: 0, 'Wert (EUR)': 0, Auswahl: '#25 Pikachu' }));
  const sh = env.sheet('Pokédex');
  const a6 = sh.getRange('A6').getFormula(), h6 = sh.getRange('H6').getFormula(), d1 = sh.getRange('D1').getFormula();
  ok('Listenformel liest Pokédex-Daten mit Filtern', /'Pokédex-Daten'!A2:G/.test(a6) && /B4="Fehlend"/.test(a6) && /C4/.test(a6) && /TRIM\(D4\)/.test(a6), a6);
  ok('Kartenformel liest Gruppen und I4 (#43)', /'Gruppen'!A2:AG/.test(h6) && /'Gruppen'!AG2:AG/.test(h6) && /TRIM\(I4\)/.test(h6) &&
    /IMAGE\(url & "\/low.png"\)/.test(h6), h6);
  ok('Zähler oben', /COUNTIF\('Pokédex-Daten'!F2:F, ">0"\)/.test(d1), d1);
  eq('Kopfzeilen', [sh.getRange('A5:F5').getValues()[0], sh.getRange('H5:P5').getValues()[0]],
    [['Nr.', 'Name', 'Generation', 'Karten', 'Exemplare', 'Wert (EUR)'], ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Seltenheit', 'Anzahl', 'Preis (EUR)', 'Wert (EUR)']]);
  eq('Startwerte der Filter', sh.getRange('B4:D4').getValues()[0], ['Alle', 'Alle', '']);
  const s = env.objects('Seltenheiten');
  const rank = n => (s.find(o => o['Seltenheit'] === n) || {})['Stufe'];
  ok('Seltenheiten vorbelegt', s.length > 40 && rank('Häufig') === 1 && rank('Selten') === 3 && rank('Hyperselten') === 9 && rank('Promo') === '', s.length);
  eq('keine doppelten Seltenheiten', s.length, new Set(s.map(o => o['Seltenheit'].toLowerCase())).size);

  // Einrichtung noch einmal: Filter und eigene Stufen bleiben
  sh.getRange('B4').setValue('Fehlend'); sh.getRange('C4').setValue(2); sh.getRange('D4').setValue('Pi'); sh.getRange('I4').setValue('#25 Pikachu');
  const ssh = env.sheet('Seltenheiten');
  const r = s.findIndex(o => o['Seltenheit'] === 'Selten') + 2;
  ssh.getRange(r, 2).setValue(7);
  env.ctx.setupAll_();
  eq('Filter bleiben bei erneuter Einrichtung', [sh.getRange('B4:D4').getValues()[0], sh.getRange('I4').getValue()], [['Fehlend', 2, 'Pi'], '#25 Pikachu']);
  eq('eigene Stufe bleibt', ssh.getRange(r, 2).getValue(), 7);
  eq('Reihenfolge bleibt bei erneuter Einrichtung', env.ss.list.map(x => x.name).slice(0, 3), ['Dashboard', 'Sammlung', 'Pokédex']);
}

// ---------------------------------------------------------------------------
t.section('Hinzufügen merkt die Nummern, der Pokédex rechnet gleich mit (#43)');
{
  const env = setup();
  add(env, 'swsh3-025', { qty: 2 });
  eq('erste Karte: gleich im Pokédex (eine Gruppe, eine Nummer)', [dexRow(env, 6).Exemplare, dexCards(env, '#6 Glurak').length], [2, 1]);
  add(env, 'sm9-33');
  add(env, 'swsh1-178');
  eq('Nummern beim Hinzufügen gemerkt (Trainer leer)', knownDex(env), [['swsh3-025', '6'], ['sm9-33', '25 644'], ['swsh1-178', '']]);
  ok('Pokédex-Nummern versteckt', env.sheet('Pokédex-Nummern').hidden);
  const g = dexRow(env, 6), p = dexRow(env, 25), z = dexRow(env, 644);
  eq('Glurak: 1 Karte, 2 Exemplare, 3 €', [g.Karten, g.Exemplare, g['Wert (EUR)']], [1, 2, 3]);
  eq('Tag Team zählt bei Pikachu und Zekrom', [p.Exemplare, z.Exemplare, p['Wert (EUR)'], z['Wert (EUR)']], [1, 1, 12, 12]);
  eq('vorhanden gesamt', env.objects('Pokédex-Daten').filter(o => o.Exemplare > 0).length, 3);
  const cards = dexCards(env, '#6 Glurak');
  eq('Kartenliste #6: Glurak', cards.map(r => [r[1], r[2], r[3], r[6]]), [['Glurak', 'Flammende Finsternis', '025/189', 2]]);
  eq('Kartenliste: Bild, Variante, Seltenheit, Preis, Wert', [cards[0][0]].concat(cards[0].slice(4)),
    ['IMAGE:https://assets.tcgdex.net/de/x/swsh3-025/low.png', 'Normal', 'Selten', 2, 1.5, 3]);
  eq('Tag Team bei #25 und bei Zekrom (Name)', [dexCards(env, '#25 Pikachu'), dexCards(env, 'Zekrom')].map(l => l.map(r => [r[1], r[3], r[6]])),
    [[['Pikachu & Zekrom-GX', '33/181', 1]], [['Pikachu & Zekrom-GX', '33/181', 1]]]);
  ok('neue Seltenheit unten angehängt', env.objects('Seltenheiten').some(o => o['Seltenheit'] === 'Holografisch Selten GX' && o['Stufe'] === ''));

  // −2 bis 0: Pokémon fehlt gleich wieder, Kartenliste für Nr. 6 leer
  const eids = env.data().filter(r => r.id === 'swsh3-025').map(r => r.eid);
  env.ctx.adjustEntry(eids[0], -2);
  eq('0 Exemplare: Glurak fehlt gleich wieder', [dexRow(env, 6).Exemplare, dexCards(env, '#6 Glurak').length], [0, 0]);
  eq('ohne Karten: Hinweis in H6', env.sheet('Pokédex').getRange('H6').getValue(), 'Keine Karten von diesem Pokémon');

  // getPokedex fürs UI
  const res = env.uiCall('getPokedex');
  eq('getPokedex: 1025 Einträge, Pikachu', [res.entries.length, J(res.entries[24])], [1025, J([25, 'Pikachu', 'Pikachu', 1, 1, 1, 12])]);
}

// ---------------------------------------------------------------------------
t.section('Ohne gemerkte Nummer: Name; Preislauf holt sie nach');
{
  const env = setup();
  // wie ein Import: Zeilen direkt, ohne Pokédex-Nummern
  const rows = [
    env.ctx.buildCardRow_({ dataLang: 'de', id: 'swsh3-136', name: 'Glurak', setId: 'swsh3', setName: 'Flammende Finsternis', setDate: '2020-08-14',
      localId: '136', setSize: 189, rarity: 'Selten, besondere Illustration', category: 'Pokemon', baseVariant: 'normal', price: 80 }, { origin: 'Import 1', ownPrice: 99 }),
    env.ctx.buildCardRow_({ dataLang: 'de', id: 'sv1-1', name: 'Mewtu', setId: 'sv1', setName: 'Karmesin & Purpur', setDate: '2023-03-31',
      localId: '1', setSize: 198, rarity: 'Häufig', category: 'Pokemon', baseVariant: 'normal', price: 0.1 }, {}),
    env.ctx.buildCardRow_({ free: true, name: 'Glurak-ex', setName: 'Irgendwas', localId: '5/10' }, {})
  ];
  env.ctx.appendDataRows_(rows);
  env.ctx.withLock_(() => env.ctx.afterDataChange_());
  eq('Glurak aus dem Namen (2 Karten), Mewtu aus dem Namen', [dexRow(env, 6).Karten, dexRow(env, 150).Karten], [2, 1]);
  eq('noch nichts gemerkt', knownDex(env), []);
  const targets = env.ctx.priceTargets_().map(x => x.id);
  ok('Preislauf: Karte mit eigenem Preis wird für die Nummer trotzdem abgerufen', targets.indexOf('swsh3-136') >= 0, targets);
  env.ctx.startPriceRun_();
  eq('nach dem Preislauf gemerkt (sv1-1 ohne dexId bei tcgdex: leer)', knownDex(env).sort(),
    [['sv1-1', ''], ['swsh3-136', '6']]);
  eq('Mewtu weiter über den Namen', dexRow(env, 150).Karten, 1);
  eq('zweiter Preislauf: Karte mit eigenem Preis weiter abgerufen (für ihre Preiskurve)', env.ctx.priceTargets_().map(x => x.id), ['sv1-1', 'swsh3-136']);
  eq('eigener Preis zählt im Wert', dexRow(env, 6)['Wert (EUR)'], 99);
}

// ---------------------------------------------------------------------------
t.section('Sortierung der Sammlung');
/** Sammlung mit sieben Karten für die Sortierungen (auch für den Vergleich Browser = Server unten) */
function sortEnv() {
  const env = setup();
  add(env, 'swsh3-025', { qty: 1 });              // Glurak, Selten (3), 1,50 €, 2020
  add(env, 'swsh3-136', { qty: 1 });              // Glurak, besondere Illustration (8), Preis aus en 1,50 €
  add(env, 'sm9-33', { qty: 1 });                 // Pikachu & Zekrom, Holografisch Selten GX (ohne Stufe), 12 €, 2019
  add(env, 'swsh1-178', { qty: 1 });              // Trainer, Ungewöhnlich (2), 0,20 €
  add(env, 'sv1-1', { qty: 1 });                  // Mewtu, Häufig (1), 0,10 €, 2023
  add(env, 'base1-4', { qty: 1 });                // Glurak Grundset, Rare (3), 1999
  const zero = env.ctx.addFreeCard({ name: 'Bisasam', setName: 'Alt', number: '1/1', qty: 1 });
  env.ctx.adjustEntry(zero.eid, -1);              // 0 Exemplare: immer am Ende
  return env;
}
{
  const env = sortEnv();
  const ids = opts => env.uiCall('searchCollection', '', '', opts).groups.map(g => g.id || g.name);
  const res0 = env.uiCall('searchCollection', '', '');
  eq('Standard = Set aufsteigend (wie bisher)', [res0.sort, res0.desc], ['set', false]);
  eq('Set', ids(), ['base1-4', 'sm9-33', 'swsh1-178', 'swsh3-025', 'swsh3-136', 'sv1-1', 'Bisasam']);
  eq('Set absteigend: neueste zuerst, 0 Exemplare bleibt hinten', ids({ sort: 'set', desc: true }), ['sv1-1', 'swsh3-136', 'swsh3-025', 'swsh1-178', 'sm9-33', 'base1-4', 'Bisasam']);
  // Pokédex: base1-4 hat keine dexId in der Attrappe -> Name „Glurak“ -> 6
  eq('Pokédex-Nr.: 6, 6, 6, 25, 150, Trainer am Ende', ids({ sort: 'dex' }), ['base1-4', 'swsh3-025', 'swsh3-136', 'sm9-33', 'sv1-1', 'swsh1-178', 'Bisasam']);
  eq('Pokédex-Nr. absteigend: Trainer trotzdem am Ende', ids({ sort: 'dex', desc: true }), ['sv1-1', 'sm9-33', 'base1-4', 'swsh3-025', 'swsh3-136', 'swsh1-178', 'Bisasam']);
  const rr = env.uiCall('searchCollection', '', '', { sort: 'rarity' });
  eq('Seltenheit: Standard absteigend', rr.desc, true);
  eq('Seltenheit: seltenste zuerst, ohne Stufe am Ende', rr.groups.map(g => g.id || g.name), ['swsh3-136', 'base1-4', 'swsh3-025', 'swsh1-178', 'sv1-1', 'sm9-33', 'Bisasam']);
  eq('Seltenheit im UI-Objekt', rr.groups[0].rarity, 'Selten, besondere Illustration');
  eq('Seltenheit aufsteigend', ids({ sort: 'rarity', desc: false }), ['sv1-1', 'swsh1-178', 'base1-4', 'swsh3-025', 'swsh3-136', 'sm9-33', 'Bisasam']);
  // Stufe im Blatt ändern wirkt sofort: die Änderung von Hand löst onEdit aus, das die Nachschlagewerte vergisst (#43)
  const ssh = env.sheet('Seltenheiten');
  const s = env.objects('Seltenheiten');
  const cellGx = ssh.getRange(s.findIndex(o => o['Seltenheit'] === 'Holografisch Selten GX') + 2, 2);
  cellGx.setValue(10);
  env.ctx.onEdit({ range: cellGx });
  eq('eigene Stufe 10 für die GX-Karte', ids({ sort: 'rarity' })[0], 'sm9-33');
  eq('Preis: teuerste zuerst', ids({ sort: 'price' }).slice(0, 2), ['sm9-33', 'base1-4']);
  eq('Preis aufsteigend: günstigste zuerst', ids({ sort: 'price', desc: false })[0], 'sv1-1');
  eq('Name A bis Z', ids({ sort: 'name' }), ['base1-4', 'swsh3-025', 'swsh3-136', 'sv1-1', 'sm9-33', 'swsh1-178', 'Bisasam']);
  eq('Neueste zuerst', ids({ sort: 'added' })[0], 'base1-4');
  eq('unbekannte Sortierung = Set', ids({ sort: 'quatsch' }), ids());
  eq('desc als Text', ids({ sort: 'set', desc: 'true' })[0], 'sv1-1');
  // Pokédex-Filter
  const d6 = env.uiCall('searchCollection', '', '', { dex: 6 });
  eq('nur Glurak', d6.groups.map(g => g.id), ['base1-4', 'swsh3-025', 'swsh3-136']);
  eq('dex im Ergebnis', [d6.dex, J(d6.groups[0].dex)], [6, '[6]']);
  eq('Zekrom findet das Tag Team', ids({ dex: 644 }), ['sm9-33']);
  eq('Filter mit Suche kombiniert', env.uiCall('searchCollection', 'Glurak 025', '', { dex: 6 }).groups.map(g => g.id), ['swsh3-025']);
  eq('Bisasam: nur die freie Karte mit 0 Exemplaren', ids({ dex: 1 }), ['Bisasam']);
  eq('Filter ohne Treffer', env.uiCall('searchCollection', '', '', { dex: 4 }).total, 0);
}

// ---------------------------------------------------------------------------
t.section('Ansicht neu aufbauen und onEdit');
{
  const env = H.createEnv({ db: db() });
  env.ctx.setupAll_();
  env.ss.deleteSheet(env.sheet('Pokédex'));
  env.ss.deleteSheet(env.sheet('Seltenheiten'));
  env.ctx.ansichtNeuAufbauen();
  ok('Ansicht neu aufbauen legt Pokédex und Seltenheiten wieder an', !!env.sheet('Pokédex') && !!env.sheet('Seltenheiten'));
  add(env, 'swsh3-025');
  const sh = env.sheet('Pokédex');
  // Zeilenhöhe nach Inhalt von Spalte I (Kartenname aus der Formel in H6)
  sh.getRange('I4').setValue('#6 Glurak');
  env.ctx.onEdit({ range: sh.getRange('I4') });
  eq('Bildzeile hoch, Rest normal', [sh.getRange('I6').getValue(), sh.rowHeights[6], sh.rowHeights[7]], ['Glurak', 90, 21]);
  sh.getRange('I4').setValue('#1 Bisasam');
  env.ctx.onEdit({ range: sh.getRange('I4') });
  eq('ohne Karten wieder normal', sh.rowHeights[6], 21);
  ok('onEdit im Pokédex baut keine Gruppen', env.lock.depth === 0);
}

// ---------------------------------------------------------------------------
t.section('Fehler im Pokédex verhindern das Speichern nicht');
{
  const env = setup();
  env.run('syncDexMap_ = function () { throw new Error("kaputt"); }');
  const r = add(env, 'swsh3-025');
  ok('Karte trotzdem gespeichert', r && r.count === 1 && env.data().length === 1);
}

// ---------------------------------------------------------------------------
// UI mit echtem Server (jsdom)
// ---------------------------------------------------------------------------
function boot(env, mode, storage) {
  const raw = fs.readFileSync(path.join(H.SRC_DIR, 'Ui.html'), 'utf8')
    .replace("<?!= mode ?>", mode)
    .replace(/<\?!= typeof start[^?]*\?>/, '')
    .replace("<?!= include('ImportUi') ?>", '<div id="paneImport" class="panel hidden"></div><script>function impInit() {}</script>');
  const pending = [], errors = [], log = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  const dom = new JSDOM(raw, {
    runScripts: 'dangerously', virtualConsole: vc, url: 'https://script.google.com/x',
    beforeParse(win) {
      if (storage) Object.keys(storage).forEach(k => win.localStorage.setItem(k, storage[k]));
      win.setTimeout = (fn) => { fn(); return 1; };
      win.clearTimeout = () => {};
      win.google = { script: { get run() {
        let okH = null, failH = null;
        const base = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; } };
        const px = new Proxy(base, { get: (o, p) => (p in o ? o[p] : (...args) => { pending.push({ fn: String(p), args: JSON.parse(J(args)), ok: okH, fail: failH }); }) });
        return px;
      } } };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); };
  const E = {
    win, doc, errors, log, $: id => doc.getElementById(id),
    async settle() {
      await flush();
      let n = 0;
      while (pending.length && n++ < 50) {
        const p = pending.shift();
        log.push(p);
        try { p.ok(env.uiCall(p.fn, ...p.args)); } catch (e) { p.fail(new win.Error(e.message)); }
        await flush();
      }
    },
    calls: fn => log.filter(p => p.fn === fn),
    btn: (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text) || null,
    async click(el) { if (!el) throw new Error('Element fehlt'); el.click(); await E.settle(); },
    async pick(el, v) { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); await E.settle(); },
    async type(el, v) { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); await E.settle(); }
  };
  return E;
}

(async () => {
  t.section('UI: Sortierung in der Sammlung');
  {
    const env = setup();
    add(env, 'swsh3-025'); add(env, 'sm9-33'); add(env, 'swsh1-178');
    const E = boot(env, 'web');
    await E.settle();
    ok('Tab Pokédex in der Web-App', !E.$('tabDex').classList.contains('hidden'));
    eq('Sortieroptionen', [...E.$('colSort').options].map(o => o.textContent), ['Set', 'Pokédex-Nr.', 'Seltenheit', 'Name', 'Preis', 'Neueste']);
    await E.click(E.$('tabColl'));
    const ids = () => E.win.state.groups.map(g => g.id);
    eq('Start: Set aufsteigend', [E.calls('getCollection').length, E.$('colDirHint').textContent, J(ids())], [1, 'Älteste Sets zuerst', J(['sm9-33', 'swsh1-178', 'swsh3-025'])]);
    await E.pick(E.$('colSort'), 'price');
    eq('Preis: Standard teuerste zuerst, im Browser', [E.log.length, E.$('colDir').textContent, E.$('colDirHint').textContent, J(ids())],
      [E.log.length, '↓', 'Teuerste zuerst', J(['sm9-33', 'swsh3-025', 'swsh1-178'])]);
    const nCalls = E.log.length;
    await E.click(E.$('colDir'));
    eq('Richtung umgedreht, ohne Server', [E.log.length, E.$('colDirHint').textContent, J(ids())], [nCalls, 'Günstigste zuerst', J(['swsh1-178', 'swsh3-025', 'sm9-33'])]);
    eq('gemerkt', [E.win.localStorage.getItem('pkmSort'), E.win.localStorage.getItem('pkmSortDesc')], ['price', '0']);
    await E.pick(E.$('colSort'), 'rarity');
    ok('Seltenheit steht in der Zeile', /Holografisch Selten GX|Selten|Ungewöhnlich/.test(E.$('collResults').textContent));
    await E.pick(E.$('colSort'), 'dex');
    ok('Pokédex-Nr. steht in der Zeile', /#25, #644/.test(E.$('collResults').textContent), E.$('collResults').textContent.slice(0, 300));
    ok('keine Skriptfehler', E.errors.length === 0, E.errors);

    const E2 = boot(env, 'sidebar', { pkmSort: 'rarity', pkmSortDesc: '0' });
    await E2.settle();
    eq('Seitenleiste übernimmt die gemerkte Sortierung', [E2.$('colSort').value, E2.$('colDirHint').textContent], ['rarity', 'Häufigste zuerst']);
    ok('Seitenleiste: Pokédex-Tab und Import-Tab', !E2.$('tabDex').classList.contains('hidden') && !E2.$('tabImport').classList.contains('hidden'));
    const E3 = boot(env, 'web', { pkmSort: 'quatsch' });
    await E3.settle();
    eq('unbekannte gemerkte Sortierung: Set', E3.$('colSort').value, 'set');
  }

  t.section('UI: Suche und Sortierung im Browser = searchCollection');
  {
    const env = sortEnv();
    env.ctx.addFreeCard({ name: 'Glurak Fake', setName: 'Flammende Finsternis', number: '025/189', version: 'Snowflake', qty: 2 });
    const E = boot(env, 'sidebar');
    await E.settle();
    await E.click(E.$('tabColl'));
    const bad = [];
    const queries = [['', ''], ['glurak', ''], ['025/189', ''], ['25', ''], ['Glurak 4', ''], ['snowflake', ''], ['arita', ''], ['', 'flammende'],
      ['', 'swsh3'], ['', 'Darkness'], ['glurak', 'Grundset'], ['zekrom', ''], ['xyz', '']];
    for (const [q, setText] of queries) {
      for (const sort of ['set', 'dex', 'rarity', 'name', 'price', 'added']) {
        for (const desc of [false, true]) {
          for (const dex of [null, 6]) {
            E.win.collSort.sort = sort; E.win.collSort.desc = desc;
            E.win.collSort.dex = dex ? { nr: dex, name: 'Glurak' } : null;
            E.$('colQuery').value = q; E.$('colSet').value = setText;
            E.win.refilter();
            const ui = E.win.state.groups.map(g => g.gkey);
            const srv = env.uiCall('searchCollection', q, setText, { sort, desc, dex }).groups.map(g => g.gkey);
            if (J(ui) !== J(srv)) bad.push({ q, setText, sort, desc, dex, ui, srv });
          }
        }
      }
    }
    eq('alle Kombinationen gleich (' + queries.length * 24 + ')', bad.slice(0, 3), []);
    ok('dabei kein weiterer Serveraufruf', E.calls('getCollection').length === 1 && !E.log.some(p => p.fn === 'searchCollection'));
    ok('keine Skriptfehler', E.errors.length === 0, E.errors);
  }

  t.section('UI: Pokédex-Tab');
  {
    const env = setup();
    add(env, 'swsh3-025', { qty: 2 }); add(env, 'sm9-33'); add(env, 'swsh1-178');
    const E = boot(env, 'web');
    await E.settle();
    ok('Pokédex lädt erst beim Öffnen', E.calls('getPokedex').length === 0);
    await E.click(E.$('tabDex'));
    ok('Pokédex-Tab aktiv', E.$('tabDex').classList.contains('active') && !E.$('paneDex').classList.contains('hidden'));
    const rows = () => [...E.$('dexList').querySelectorAll('.dex')];
    eq('alle 1025', rows().length, 1025);
    eq('Zusammenfassung', E.$('dexSummary').textContent, 'Vorhanden: 3 von 1025.');
    const r6 = rows()[5];
    ok('Glurak vorhanden mit Zahlen', /#006/.test(r6.textContent) && /Glurak/.test(r6.textContent) && /1 Karte · 2 Exemplare · 3,00/.test(r6.textContent) && !r6.classList.contains('miss'), r6.textContent);
    ok('Bisasam fehlt', rows()[0].classList.contains('miss') && /fehlt noch/.test(rows()[0].textContent));
    await E.click(E.$('dexOwned'));
    eq('Vorhanden', rows().map(r => r.querySelector('.t').textContent), ['Glurak', 'Pikachu', 'Zekrom']);
    await E.click(E.$('dexMissing'));
    eq('Fehlend', rows().length, 1022);
    await E.pick(E.$('dexGen'), '5');
    eq('Fehlend in Generation 5', [rows().length, E.$('dexSummary').textContent], [155, 'Vorhanden: 1 von 156 in Generation 5.']);
    await E.click(E.$('dexAll'));
    await E.pick(E.$('dexGen'), '');
    await E.type(E.$('dexQuery'), 'pika');
    eq('Suche nach Name', rows().map(r => r.querySelector('.t').textContent), ['Pikachu']);
    await E.type(E.$('dexQuery'), '#644');
    eq('Suche nach Nummer', rows().map(r => r.querySelector('.t').textContent), ['Zekrom']);
    await E.type(E.$('dexQuery'), 'charizard');
    eq('Suche englisch', rows().map(r => r.querySelector('.t').textContent), ['Glurak']);
    await E.click(rows()[0]);
    const box = E.$('dx6');
    ok('Glurak aufgeklappt mit Karte', box && !box.classList.contains('hidden') && /Glurak/.test(box.textContent) && /025\/189/.test(box.textContent) && /2× · 1,50/.test(box.textContent), box && box.textContent);
    eq('Aufruf mit Pokédex-Filter', J(E.calls('searchCollection').pop().args), J(['', '', { dex: 6, sort: 'set', desc: false }]));
    ok('Bild der Karte', !!box.querySelector('img'));
    await E.click(E.btn(box, 'In Sammlung öffnen'));
    ok('Sammlung offen mit Chip', E.$('tabColl').classList.contains('active') && /Nur #6 Glurak/.test(E.$('colDex').textContent));
    eq('Sammlung gefiltert (einmal geladen, dann im Browser)', [E.calls('getCollection').length, E.win.state.groups.map(g => g.id)], [1, ['swsh3-025']]);
    await E.click(E.$('colDex').querySelector('button'));
    eq('Chip weg, ganze Sammlung', [E.$('colDex').textContent, E.win.state.groups.length], ['', 3]);
    // fehlendes Pokémon: suchen
    await E.click(E.$('tabDex'));
    await E.type(E.$('dexQuery'), '1');
    await E.click(rows()[0]);
    ok('fehlendes Pokémon: Hinweis und Knopf', /Noch keine Karte von Bisasam/.test(E.$('dx1').textContent));
    await E.click(E.btn(E.$('dx1'), 'Karte von Bisasam suchen'));
    ok('Hinzufügen mit Name', E.$('tabAdd').classList.contains('active') && E.$('fName').value === 'Bisasam');
    // nach dem Hinzufügen frisch geladen
    add(env, 'sv1-1');
    await E.click(E.$('tabDex'));
    await E.type(E.$('dexQuery'), '');
    eq('neu geladen', E.$('dexSummary').textContent, 'Vorhanden: 4 von 1025.');
    ok('keine Skriptfehler', E.errors.length === 0, E.errors);
  }

  t.done();
})();
