'use strict';
/**
 * Speichern, wenn die Tabelle selbst rechnet (#43), Sammlung im Browser (#30), Zwischenspeicher der Suche (#38 S3):
 * - Jede Änderung aus Seitenleiste und Web-App schreibt das Blatt Daten, dazu nur, was keine Formel weiß (Pokédex-Nummern
 *   neuer Karten, neue Seltenheiten, Set-Daten). Gruppen, Sammlung, Pokédex und Dashboard rechnen ihre Formeln selbst und
 *   müssen nach jeder Änderung der Rechnung von 1.1.3 entsprechen (test/ref_groups.js), geprüft mit vielen zufälligen
 *   Änderungen.
 * - Jede Änderung liefert delta mit genau den Gruppen, die getCollection danach liefern würde.
 * - Karten von tcgdex kommen eine halbe Stunde aus dem Zwischenspeicher (fetchCard_), Namenslisten drei Stunden,
 *   die Sets sechs Stunden.
 * Start: node test_speichern.js
 */
const H = require('./harness2');
const R = require('./ref_groups');
const t = H.runner('test_speichern');
const ok = t.ok, eq = t.eq;
const J = x => JSON.stringify(x);

function db() {
  const d = H.defaultDb();
  const set = (id, name, official) => ({ id, name, cardCount: { official, total: official } });
  const add = (id, lang, extra) => { d[lang + '/cards/' + id] = H.card(id, lang, extra); };
  ['de', 'en'].forEach(lang => {
    add('swsh3-025', lang, { dexId: [6], rarity: lang === 'de' ? 'Selten' : 'Rare' });
    add('swsh3-136', lang, { dexId: [6], rarity: lang === 'de' ? 'Selten, besondere Illustration' : 'Special illustration rare', pricing: lang === 'de' ? undefined : H.card('x-1', 'en').pricing });
    add('sm9-33', lang, { name: 'Pikachu & Zekrom-GX', dexId: [25, 644], rarity: lang === 'de' ? 'Holografisch Selten GX' : 'Rare Holo GX',
      set: set('sm9', lang === 'de' ? 'Teams sind Trumpf' : 'Team Up', 181), pricing: { cardmarket: { trend: 12, 'trend-holo': 0, updated: '2026-10-13T00:00:00Z' } } });
    add('swsh1-178', lang, { name: lang === 'de' ? 'Professorin Magnolia' : 'Professor Magnolia', category: 'Trainer', rarity: lang === 'de' ? 'Ungewöhnlich' : 'Uncommon',
      set: set('swsh1', 'Schwert & Schild', 202), pricing: { cardmarket: { trend: 0.2, 'trend-holo': 0.5, updated: '2026-10-13T00:00:00Z' } } });
    add('sv1-1', lang, { name: lang === 'de' ? 'Mewtu' : 'Mewtwo', rarity: lang === 'de' ? 'Häufig' : 'Common', set: set('sv1', 'Karmesin & Purpur', 198),
      pricing: { cardmarket: { trend: 0.1, 'trend-holo': 0.3, updated: '2026-10-13T00:00:00Z' } } }); // ohne dexId: Nummer aus dem Namen
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

const IDS = ['swsh3-025', 'swsh3-136', 'sm9-33', 'swsh1-178', 'sv1-1', 'base1-4'];
const norm = v => (v instanceof Date ? v.toISOString() : v);

/** delta einer Änderung = was getCollection danach für diese Gruppen liefert */
function checkDelta(env, label, res, bad) {
  if (!res || !res.delta) return;
  const all = env.uiCall('getCollection').groups;
  const byKey = {};
  all.forEach(g => { byKey[g.gkey] = g; });
  res.delta.groups.forEach(g => { if (J(g) !== J(byKey[g.gkey])) bad.push([label, 'delta-Gruppe', g.gkey]); });
  res.delta.gone.forEach(k => { if (byKey[k]) bad.push([label, 'gone, aber da', k]); });
}

/** Blätter mit Formeln: Speichern schreibt sie nie (Gruppen nur, wenn Daten eine neue Spalte bekommt) */
const FORMULA_SHEETS = ['Gruppen', 'Pokédex-Daten', 'Pokédex', 'Dashboard', 'Sammlung'];
const writes = env => Object.assign({}, env.writesBy);
const formulaWrites = (env, before, newCol) => FORMULA_SHEETS.filter(n => (env.writesBy[n] || 0) !== (before[n] || 0) && !(newCol && n === 'Gruppen'));

/** Zufällige Änderungen wie aus der Seitenleiste (fester Startwert, damit Fehler nachstellbar sind). */
function randomOps(env, seed, n, after) {
  let x = seed;
  const rnd = k => { x = (x * 1103515245 + 12345) % 2147483648; return Math.floor(x / 2147483648 * k); };
  const pick = list => list[rnd(list.length)];
  const c = env.ctx;
  let token = null;
  const done = {};
  for (let i = 0; i < n; i++) {
    const live = env.data().filter(d => d.eid);
    const kind = rnd(10);
    let label = '', res = null;
    try {
      if (kind <= 1 || !live.length) {
        label = 'addCard';
        res = c.addCard({ id: pick(IDS), lang: 'de', variant: pick(['base', 'base', 'reverse']), condition: pick(['', 'NM', 'LP']), qty: 1 + rnd(2),
          version: pick(['', '', 'Snowflake']), ownPrice: rnd(6) ? null : 2.5 });
      } else if (kind === 2) {
        label = 'addFreeCard';
        res = c.addFreeCard({ name: pick(['Glurak', 'Pikachu', 'Fantasiemon', 'Mewtu']), setName: pick(['Ordner', 'Alt']), number: String(1 + rnd(3)), qty: 1 });
      } else if (kind <= 4) {
        label = 'adjustEntry';
        res = c.adjustEntry(pick(live).eid, pick([1, -1]));
        token = res.token;
      } else if (kind === 5 && token) {
        label = 'revertAdjust';
        res = c.revertAdjust(token);
        token = null;
      } else if (kind === 6) {
        label = 'editEntry';
        const r = pick(live);
        const ch = pick([{ cond: pick(['', 'NM', 'EX', 'LP']) }, { version: pick(['', 'Snowflake', 'Staff']) }, { cardLang: pick(['DE', 'EN']) }, { extras: { Ordner: pick(['A', 'B', '']) } }]);
        res = c.editEntry(r.eid, ch, r.count > 1 ? 1 + rnd(r.count) : null);
      } else if (kind === 7) {
        label = 'setGroupOwnPrice';
        const r = pick(live);
        const ce = env.run('COL.eid');
        res = c.setGroupOwnPrice(c.groupKey_(env.run('readData_(sheet_(SHEETS.data))').find(d => d[ce] === r.eid)), pick([null, 3.3, 0.5]));
      } else {
        const free = live.filter(d => !d.id);
        if (!free.length) continue;
        label = 'linkFreeGroup';
        const fe = pick(free).eid, ce = env.run('COL.eid');
        const raw = env.run('readData_(sheet_(SHEETS.data))').find(d => d[ce] === fe);
        res = c.linkFreeGroup(c.groupKey_(raw), pick(IDS), 'de', 'base');
      }
    } catch (e) {
      if (!/schon mit tcgdex|nicht gefunden|nicht erreichbar/.test(e.message)) throw e;
      continue;
    }
    done[label] = (done[label] || 0) + 1;
    if (after) after(label + ' #' + i, res);
  }
  return done;
}

// ---------------------------------------------------------------------------
t.section('Speichern schreibt Daten, die Formeln rechnen wie 1.1.3 (nach jeder Änderung)');
{
  const env = setup();
  env.ctx.settingSet_('VIEW_EXTRAS', J(['Ordner'])); // gezeigt, bevor es die Spalte in Daten gibt: kommt mit dem ersten Wert
  env.ctx.ansichtNeuAufbauen();
  const bad = [], deltaBad = [], wroteBad = [];
  let n = 0, w0 = writes(env), h0 = env.values('Daten')[0].length;
  const done = randomOps(env, 7, 90, (label, res) => {
    const h1 = env.values('Daten')[0].length;
    const wrote = formulaWrites(env, w0, h1 !== h0);
    if (wrote.length) wroteBad.push([label, wrote]);
    if (res && 'pending' in res) wroteBad.push([label, 'pending in der Antwort']);
    checkDelta(env, label, res, deltaBad);
    const d = R.compareSheets(env);
    if (d.length) bad.push([label, d.slice(0, 3)]);
    n++;
    w0 = writes(env);
    h0 = h1;
  });
  ok('alle Arten von Änderungen kamen vor', ['addCard', 'addFreeCard', 'adjustEntry', 'revertAdjust', 'editEntry', 'setGroupOwnPrice', 'linkFreeGroup']
    .every(k => done[k] > 0), done);
  eq('Änderungen schreiben nie in Gruppen, Pokédex, Dashboard oder Sammlung', wroteBad.slice(0, 3), []);
  eq('Formeln = Rechnung von 1.1.3 nach jeder Änderung (' + n + ' Änderungen)', bad.slice(0, 2), []);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
  ok('Spalte Ordner kam beim Speichern dazu, Gruppen zeigt ihre Werte', env.values('Daten')[0].indexOf('Ordner') > 0 &&
    env.groups().some(g => /^[AB]/.test(g['Ordner'] || '')), env.values('Gruppen')[0]);
}

t.section('Viele Änderungen hintereinander');
{
  const env = setup();
  const deltaBad = [];
  const w0 = writes(env);
  randomOps(env, 2024, 120, (label, res) => checkDelta(env, label, res, deltaBad));
  eq('danach: Formeln = Rechnung von 1.1.3', R.compareSheets(env).slice(0, 3), []);
  eq('und nichts davon vom Skript geschrieben', formulaWrites(env, w0), []);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
  const view = env.sheet('Sammlung').getRange('A6').getFormula();
  ok('Sammlung filtert leere Zeilen aus Gruppen', /FILTER\(VSTACK\('Gruppen'!A2:[A-Z]+, ""\), VSTACK\('Gruppen'!A2:A<>"", FALSE\)\)/.test(view), view);
}

t.section('Was geschrieben wird');
{
  const env = setup();
  IDS.forEach(id => env.ctx.addCard({ id, lang: 'de', variant: 'base', qty: 1 }));
  for (let k = 0; k < 20; k++) env.ctx.addFreeCard({ name: 'Karte ' + k, setName: 'Ordner', number: String(k), qty: 1 });
  const count = name => {
    const sh = env.sheet(name);
    let n = 0;
    const orig = sh.put.bind(sh);
    sh.put = (...a) => { n++; return orig(...a); };
    return () => { sh.put = orig; return n; };
  };
  const eid = env.data().find(d => d.id === 'swsh3-025').eid;
  const g = count('Gruppen'), p = count('Pokédex-Daten'), d = count('Daten'), x = count('Pokédex-Nummern');
  const f0 = env.flushes;
  const res = env.ctx.adjustEntry(eid, 1);
  const cellsG = g(), cellsP = p(), cellsD = d(), cellsX = x();
  const dWidth = env.values('Daten')[0].length;
  ok('+1: in Daten nur die eine Zeile, nichts in Gruppen, Pokédex und Pokédex-Nummern', cellsD === dWidth && cellsG === 0 && cellsP === 0 && cellsX === 0,
    [cellsD, dWidth, cellsG, cellsP, cellsX]);
  ok('+1: ein flush (die Sperre)', env.flushes - f0 === 1, env.flushes - f0);
  ok('+1: delta mit genau der Gruppe', res.delta && J(res.delta.groups.map(y => y.gkey)) === J(['swsh3-025|normal|']) && res.delta.gone.length === 0, res);
  eq('+1: Gruppen und Dashboard zeigen es gleich', [env.groups().find(y => y['Gruppenschlüssel'] === 'swsh3-025|normal|')['Anzahl'],
    R.compareSheets(env)], [2, []]);
  // neue Karte: ihre Pokédex-Nummer kommt als ein Eintrag dazu
  const y = count('Pokédex-Nummern');
  env.ctx.addCard({ id: 'sm9-33', lang: 'de', variant: 'reverse', qty: 1 });
  ok('neue Gruppe derselben Karte: Pokédex-Nummern unverändert', y() === 0);
  const z = count('Pokédex-Nummern');
  env.DB['de/cards/swsh3-002'] = H.card('swsh3-002', 'de', { dexId: [1] });
  env.ctx.addCard({ id: 'swsh3-002', lang: 'de', variant: 'base', qty: 1 });
  ok('neue Karte: Pokédex-Nummern bekommt sie (A:C gemerkt, D:E für die Formel)', z() > 0 && env.objects('Pokédex-Nummern').some(o => o['Sammlung: Karte'] === 'swsh3-002' &&
    String(o['Sammlung: Pokédex-Nr.']) === '1'), env.objects('Pokédex-Nummern').slice(-2));
  eq('und der Pokédex zeigt sie gleich', R.compareSheets(env), []);
}

t.section('Set-Daten und Pokédex-Nummern gleich beim Hinzufügen, nachts der Rest');
{
  const env = setup();
  const c = env.ctx;
  env.cache.clear();
  env.fetchLog.length = 0;
  env.fetchInLock = [];
  const fa = c.UrlFetchApp.fetchAll, f1 = c.UrlFetchApp.fetch;
  c.UrlFetchApp.fetchAll = (rs, ...x) => { if (env.lock.depth > 0) env.fetchInLock.push(rs.length); return fa(rs, ...x); };
  c.UrlFetchApp.fetch = (u, ...x) => { if (env.lock.depth > 0) env.fetchInLock.push(u); return f1(u, ...x); };
  c.addCard({ id: 'sm9-33', lang: 'de', variant: 'base', qty: 1 });
  c.addCard({ id: 'sv1-1', lang: 'de', variant: 'base', qty: 1 });
  c.addCard({ id: 'sm9-33', lang: 'de', variant: 'reverse', qty: 1 });
  c.UrlFetchApp.fetchAll = fa; c.UrlFetchApp.fetch = f1;
  eq('Set-Daten gleich da', ['sm9-33', 'sv1-1'].map(id => env.data().find(x => x.id === id).setDate), ['2019-02-01', '2023-03-31']);
  eq('Pokédex-Nummern gleich gemerkt (sv1-1 ohne dexId: leer)', env.objects('Pokédex-Nummern').filter(o => o['Karten-ID']).map(o => [o['Karten-ID'], String(o['Pokédex-Nr.'])]).sort(),
    [['sm9-33', '25 644'], ['sv1-1', '']]);
  ok('Abrufe: je Set einmal, keiner in der Sperre', ['/sets/sm9', '/sets/sv1'].every(u => env.fetchLog.filter(x => x.indexOf(u) >= 0).length === 1) &&
    env.fetchInLock.length === 0, [env.fetchLog, env.fetchInLock]);
  ok('Sets-Blatt kennt die Daten jetzt', c.knownSetDate_('de', 'sm9') === '2019-02-01' && c.knownSetDate_('de', 'sv1') === '2023-03-31');
  // Import-Zeilen ohne Set-Datum und ohne gemerkte Nummer: der Preislauf holt beides
  const rows = ['swsh1-178', 'swsh3-136'].map(id => c.buildCardRow_({ dataLang: 'de', id, name: id === 'swsh3-136' ? 'Glurak' : 'Professorin Magnolia',
    setId: id.split('-')[0], setName: 'X', category: id === 'swsh3-136' ? 'Pokemon' : 'Trainer' }, { origin: 'Import 1' }));
  c.withLock_(() => { c.appendDataRows_(rows); c.afterDataChange_(); });
  ok('Import: Set-Datum fehlt noch, Nummer aus dem Namen', env.data().find(x => x.id === 'swsh1-178').setDate === '' &&
    env.groups().find(g => g['Karten-ID'] === 'swsh3-136')['Pokédex-Nr.'] === '6');
  c.preiseJetztAktualisieren();
  eq('nach dem Preislauf: Set-Daten nachgetragen', ['swsh1-178', 'swsh3-136'].map(id => env.data().find(x => x.id === id).setDate), ['2020-02-07', '2020-08-14']);
  ok('und die Nummern gemerkt', env.objects('Pokédex-Nummern').some(o => o['Karten-ID'] === 'swsh3-136' && String(o['Pokédex-Nr.']) === '6'));
  eq('alles wie die Rechnung von 1.1.3', R.compareSheets(env), []);
  ok('keine verschachtelte Sperre', env.lock.nested === 0 && env.lock.depth === 0, env.lock);
  // der alte Knopf Einsortieren (Tabellen, deren Dashboard noch nicht neu aufgebaut ist)
  env.ss.toastLog = [];
  c.einsortieren();
  ok('einsortieren(): nur ein Hinweis', env.ss.toastLog.length === 1 && /^Einsortieren ist nicht mehr nötig/.test(env.ss.toastLog[0].msg), env.ss.toastLog);
}

t.section('Keine Hinweise „noch nicht einsortiert“ mehr, Formeln mit Semikolons (#43)');
{
  const env = setup();
  const f = (sheet, a1) => env.sheet(sheet).getRange(a1).getFormula();
  eq('Sammlung A2, Pokédex A2: Text statt Formel; Dashboard C9 leer', [f('Sammlung', 'A2'), f('Pokédex', 'A2'), f('Dashboard', 'C9'), env.sheet('Dashboard').getRange('C9').getValue()],
    ['', '', '', '']);
  ok('Sammlung A2: die Hilfe', /^Summen gelten für die aktuelle Suche/.test(env.sheet('Sammlung').getRange('A2').getValue()), env.sheet('Sammlung').getRange('A2').getValue());
  const warn = sheet => env.sheet(sheet).getConditionalFormatRules().some(r => r.arg('whenFormulaSatisfied') === '=LEFT($A$2)="⚠"');
  ok('keine rote Zeile 2 mehr', !warn('Sammlung') && !warn('Pokédex'));
  // deutsches Gebietsschema: jede Formel mit Semikolons, und sie rechnen trotzdem
  env.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 2 });
  env.setFormulaDisplay((sheet, a1, formula) => (/,/.test(formula.replace(/"[^"]*"/g, '')) ? '#ERROR!' : ''));
  env.ctx.ansichtNeuAufbauen();
  const cells = ['Gruppen!A2', 'Sammlung!A6', 'Pokédex!A6', 'Pokédex!H6', 'Pokédex!D1', 'Pokédex-Daten!E2', 'Dashboard!C6', 'Dashboard!C7', 'Dashboard!R2'];
  const semi = cells.filter(x => { const [sh, a1] = x.split('!'); const g = f(sh, a1); return g && !/,/.test(g.replace(/"[^"]*"/g, '')); });
  eq('keine Kommas mehr außerhalb von Texten', semi, cells);
  eq('und alles rechnet wie 1.1.3', R.compareSheets(env), []);
  eq('Sammlung zeigt die Karte', env.sheet('Sammlung').getRange('B6').getValue(), 'Glurak');
}

t.section('Zeilenhöhen ohne flush, nur am Bilder-Schalter (#39 V1)');
{
  const env = setup();
  env.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  const view = env.sheet('Sammlung');
  // ein flush kommt immer aus withLock_ (Schreiben festschreiben, solange die Sperre gilt)
  const flushes = fn => { const f0 = env.flushes; fn(); return env.flushes - f0; };
  const add = id => () => env.ctx.addCard({ id, lang: 'de', variant: 'base', qty: 1 });
  eq('gleiche Karte noch einmal: nur der flush der Sperre', flushes(add('swsh3-025')), 1);
  eq('neue Karte ohne Bilder: auch nur der', flushes(add('sm9-33')), 1);
  view.getRange('H4').setValue(true);
  eq('neue Karte mit Bildern: auch nur der flush der Sperre', flushes(add('sv1-1')), 1);
  eq('gleiche Karte mit Bildern: nur der flush der Sperre', flushes(add('sv1-1')), 1);
  // Bilder an: alle Zeilen ab 6 hoch, ohne auf die Formel zu warten
  const f1 = env.flushes;
  env.ctx.onEdit({ range: view.getRange('H4') });
  const hs = Object.keys(view.rowHeights).filter(r => +r >= 6).map(r => view.rowHeights[r]);
  ok('H4 an: alle Zeilen ab 6 auf 90 px, kein flush', hs.length === view.getMaxRows() - 5 && hs.every(h => h === 90) && env.flushes === f1, [hs.length, env.flushes - f1]);
  view.getRange('H4').setValue(false);
  env.ctx.onEdit({ range: view.getRange('H4') });
  ok('H4 aus: wieder 21 px', Object.keys(view.rowHeights).filter(r => +r >= 6).every(r => view.rowHeights[r] === 21));
  // Suche, Set, Sortierung und 0er zeigen starten kein Skript für die Zeilenhöhen
  let calls = 0;
  const orig = env.ctx.applyRowHeights_;
  env.ctx.applyRowHeights_ = function () { calls++; };
  ['B4', 'C4', 'E4', 'G4'].forEach(a1 => env.ctx.onEdit({ range: view.getRange(a1) }));
  env.ctx.onEdit({ range: view.getRange('B4:H4') });
  env.ctx.applyRowHeights_ = orig;
  eq('nur ein Bereich mit H4 ruft applyRowHeights_', calls, 1);
}

t.section('Karten von tcgdex zwischenspeichern');
{
  const env = setup();
  const n0 = env.fetchLog.length;
  env.uiCall('getCardDetail', 'sm9-33', 'de');
  const n1 = env.fetchLog.length;
  ok('Antippen holt die Karte', n1 > n0 && env.fetchLog.slice(n0).some(u => /cards\/sm9-33$/.test(u)));
  env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1 });
  ok('Hinzufügen gleich danach: kein zweiter Abruf der Karte', !env.fetchLog.slice(n1).some(u => /cards\/sm9-33$/.test(u)), env.fetchLog.slice(n1));
  ok('gemerkt für 30 Minuten', env.cachePuts.some(p => p.k === 'tcg:de:sm9-33' && p.ttl === 1800));
  // deutsche Karte ohne Bild: die englischen Daten kommen auch aus dem Zwischenspeicher
  env.uiCall('getCardDetail', 'base1-4', 'de');
  const n2 = env.fetchLog.length;
  env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1 });
  ok('Bild aus den englischen Daten: auch kein zweiter Abruf', !env.fetchLog.slice(n2).some(u => /cards\/base1-4$/.test(u)), env.fetchLog.slice(n2));
  ok('Bild trotzdem gesetzt', /en\/x\/base1-4|base1-4/.test(env.data().find(d => d.id === 'base1-4').img));
  // nicht gefundene Karte wird nicht gemerkt
  let threw = '';
  try { env.uiCall('getCardDetail', 'gibts-1', 'de'); } catch (e) { threw = e.message; }
  ok('404: Fehler, nichts gemerkt', /nicht gefunden/.test(threw) && !env.cache.has('tcg:de:gibts-1'));
  // Zwischenspeicher kaputt: geht trotzdem
  env.cache.set('tcg:de:swsh1-178', '{kaputt');
  let res = null;
  try { res = env.uiCall('getCardDetail', 'swsh1-178', 'de'); } catch (e) { res = e.message; }
  ok('kaputter Eintrag: lädt neu', res && res.id === 'swsh1-178', res);
}

t.section('Suchtreffer gleich im Zwischenspeicher (#36 A1)');
{
  const env = setup();
  const res = env.uiCall('searchCards', { name: 'Glurak' });
  eq('drei deutsche Treffer', res.cards.map(c => c.id), ['swsh3-025', 'swsh3-136', 'base1-4']);
  ok('alle drei gemerkt, dazu die englischen Daten fürs Bild', ['tcg:de:swsh3-025', 'tcg:de:swsh3-136', 'tcg:de:base1-4', 'tcg:en:base1-4']
    .every(k => env.cachePuts.some(p => p.k === k && p.ttl === 1800)), env.cachePuts.map(p => p.k));
  const n0 = env.fetchLog.length;
  const d = env.uiCall('getCardDetail', 'swsh3-025', 'de');
  ok('Antippen ohne Abruf', env.fetchLog.length === n0 && d.prices.base === 1.5, env.fetchLog.slice(n0));
  const old = env.uiCall('getCardDetail', 'base1-4', 'de');
  ok('deutsche Karte ohne Bild: Bild und Preis auch ohne Abruf', env.fetchLog.length === n0 && /base1-4/.test(old.image), env.fetchLog.slice(n0));
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  ok('Hinzufügen holt die Karte auch nicht', !env.fetchLog.slice(n0).some(u => /cards\/swsh3-025$/.test(u)), env.fetchLog.slice(n0));
  // englischer Ersatz: die englischen Daten liegen bereit (die deutsche Abfrage war 404, nichts gemerkt)
  env.uiCall('searchCards', { name: 'Mewtu' });
  ok('englischer Treffer gemerkt, 404 nicht', env.cache.has('tcg:en:old9-007') && !env.cache.has('tcg:de:old9-007'));
  const n1 = env.fetchLog.length;
  env.uiCall('getCardDetail', 'old9-007', 'en');
  eq('englische Karte antippen ohne Abruf', env.fetchLog.slice(n1), []);
  // Zwischenspeicher wirft: Suche geht trotzdem
  const putAll = env.ctx.CacheService.getScriptCache().putAll;
  env.ctx.CacheService.getScriptCache().putAll = () => { throw new Error('Cache voll'); };
  let again = null;
  try { again = env.uiCall('searchCards', { name: 'Glurak' }); } catch (e) { again = e.message; }
  env.ctx.CacheService.getScriptCache().putAll = putAll;
  ok('Cache-Fehler: Suche trotzdem', again && again.cards && again.cards.length === 3, again);
}

t.section('Suche ohne Blatt Sets, Namenslisten gemerkt (#38 S3)');
{
  const env = setup();
  const c = env.ctx;
  let reads = 0;
  const orig = c.loadSets_;
  c.loadSets_ = function () { reads++; return orig.apply(null, arguments); };
  env.uiCall('searchCards', { name: 'Glurak' });
  ok('nur ein Name: die Suche braucht die Sets gar nicht (#43)', reads === 0, reads);
  const SIZED = { name: 'Glurak', number: '25/189' }; // die Kartenzahl hinter der Nummer braucht die Sets
  env.uiCall('searchCards', SIZED);
  const r1 = reads;
  env.uiCall('searchCards', { name: 'Pikachu', set: 'Teams sind Trumpf' });
  env.uiCall('getSetSuggestions');
  ok('Blatt Sets höchstens einmal gelesen, danach aus dem Zwischenspeicher', r1 <= 1 && reads === r1, [r1, reads]);
  ok('Sets 6 Stunden gemerkt, in Stücken', env.cachePuts.some(p => p.k === 'sets' && p.ttl === 21600) && env.cachePuts.some(p => p.k === 'sets:0' && p.ttl === 21600));
  ok('Namensliste 3 Stunden gemerkt', env.cachePuts.some(p => p.k === 'tcgl:de:glurak' && p.ttl === 10800), env.cachePuts.map(p => p.k));
  const n0 = env.fetchLog.length;
  const again = env.uiCall('searchCards', { name: 'glurak ' });
  ok('gleicher Name noch einmal (Groß/klein, Leerzeichen): ohne Namenssuche bei tcgdex', again.cards.length === 3 && !env.fetchLog.slice(n0).some(u => /cards\?name=/.test(u)), env.fetchLog.slice(n0));
  // Sets geändert: Zwischenspeicher verworfen, die nächste Suche liest das Blatt wieder
  env.uiCall('searchCards', SIZED);
  c.onEdit({ range: env.sheet('Sets').getRange(2, 3) });
  ok('Änderung im Blatt Sets verwirft die Sets', !env.cache.has('sets'));
  env.uiCall('searchCards', SIZED);
  ok('danach einmal neu gelesen', reads === r1 + 1, reads);
  c.rebuildSets_();
  ok('Übersetzung und Sets aktualisieren verwirft sie auch', !env.cache.has('sets'));
  // kaputter oder unvollständiger Zwischenspeicher: aus dem Blatt
  env.uiCall('searchCards', SIZED);
  env.cache.delete('sets:0');
  const r2 = reads;
  ok('fehlt ein Stück: aus dem Blatt', env.uiCall('searchCards', SIZED).cards.length === 1 && reads === r2 + 1);
  env.cache.set('sets', '1'); env.cache.set('sets:0', '{kaputt');
  ok('kaputter Inhalt: aus dem Blatt', env.uiCall('searchCards', SIZED).cards.length === 1 && reads === r2 + 2);
  // großer Wert: in Stücken unter der Grenze von 100 KB
  const big = { x: 'y'.repeat(70000) };
  c.cachePutJson_('gross', big, 60);
  ok('großer Wert in drei Stücken, zurück wie vorher', env.cache.get('gross') === '3' && J(c.cacheGetJson_('gross')) === J(big));
  c.loadSets_ = orig;
}

t.section('getCollection');
{
  const env = setup();
  env.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  env.ctx.addCard({ id: 'sm9-33', lang: 'de', variant: 'base', qty: 1 });
  const f = env.ctx.addFreeCard({ name: 'Fantasiemon', setName: 'Ordner', number: '007/100', version: 'Staff', qty: 1 });
  const res = env.uiCall('getCollection');
  eq('alle Gruppen, ohne Grenze, in der Reihenfolge der Daten', res.groups.map(g => g.gkey), ['swsh3-025|normal|', 'sm9-33|normal|', f.gkey]);
  ok('ohne pending (#43)', !('pending' in res));
  const g = res.groups.find(x => x.gkey === 'swsh3-025|normal|');
  eq('k: Suchwerte', [g.k.words, g.k.num, g.k.size, g.k.setId, g.k.sets], [['glurak', '', '', 'x'], '25', 189, 'swsh3', ['flammende finsternis', 'darkness ablaze']]);
  ok('k: Sortierwerte', g.k.setDate === '2020-08-14' && g.k.numSort === 25 && g.k.localId === '025' && g.k.variant === 'normal' && g.k.name === 'Glurak' &&
    g.k.rank === 3 && typeof g.k.added === 'number', g.k);
  eq('dex', [g.dex, res.groups.find(x => x.gkey === 'sm9-33|normal|').dex], [[6], [25, 644]]);
  const fg = res.groups.find(x => x.gkey === f.gkey);
  eq('freie Karte: Nummer und Sonderversion', [fg.k.num, fg.k.size, fg.k.words[2], fg.k.setId, fg.k.rank], ['7', 100, 'staff', '', null]);
  ok('reines JSON (keine Datumsobjekte)', J(res) === J(JSON.parse(J(res))) && !/"\d{4}-\d\d-\d\dT/.test(J(res.groups.map(x => x.k))));
}

t.section('Hinzufügen im Hintergrund: delta und Anfrage-ID (#33)');
{
  const env = setup();
  const bad = [];
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2, rid: 'r1' });
  ok('addCard liefert delta mit der neuen Gruppe', a.delta && a.delta.groups.length === 1 && a.delta.groups[0].gkey === a.gkey && a.delta.groups[0].count === 2, a.delta);
  checkDelta(env, 'addCard', a, bad);
  const total = () => env.uiCall('getCollection').groups.reduce((n, g) => n + g.count, 0);
  const again = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2, rid: 'r1' });
  ok('gleiche Anfrage-ID: nicht doppelt gezählt', total() === 2 && again.repeat === true && again.eid === a.eid && again.count === 2 && !again.delta, again);
  eq('gleiche Anfrage-ID: dieselbe Meldung', again.message, a.message);
  const b = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1, rid: 'r2' });
  ok('neue Anfrage-ID zählt', total() === 3 && b.count === 3 && !b.repeat);
  checkDelta(env, 'addCard 2', b, bad);
  const c = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  const d = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  ok('ohne Anfrage-ID wie bisher: jedes Mal', total() === 5 && c.count === 4 && d.count === 5);
  const f = env.uiCall('addFreeCard', { name: 'Fantasiemon', setName: 'Ordner', number: '7', qty: 1, rid: 'f1' });
  checkDelta(env, 'addFreeCard', f, bad);
  const f2 = env.uiCall('addFreeCard', { name: 'Fantasiemon', setName: 'Ordner', number: '7', qty: 1, rid: 'f1' });
  ok('freie Karte: gleiche Anfrage-ID nicht doppelt', total() === 6 && f2.repeat === true && f2.count === 1);
  ok('Antworten ohne pending (#43)', [a, again, d, f, f2].every(x => !('pending' in x)));
  const odd = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  const odd2 = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  ok('Anfrage-ID mit Sonderzeichen', odd2.repeat === true && odd2.count === odd.count);
  eq('delta = getCollection', bad, []);
}

t.done();
