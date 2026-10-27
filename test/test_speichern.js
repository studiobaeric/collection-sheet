'use strict';
/**
 * Schneller speichern (#31) und die Sammlung im Browser (#30), Serverseite:
 * - Nach einer Änderung einzelner Karten schreibt das Tool nur die betroffenen Zeilen in Gruppen, Pokédex-Daten,
 *   Seltenheiten und Dashboard (afterDataChange_). Das Ergebnis muss dem vollen Neuaufbau (rebuildGroups_) entsprechen,
 *   geprüft mit vielen zufälligen Änderungen.
 * - Jede Änderung liefert delta mit genau den Gruppen, die getCollection danach liefern würde.
 * - Karten von tcgdex kommen eine halbe Stunde aus dem Zwischenspeicher (fetchCard_).
 * Start: node test_speichern.js
 */
const H = require('./harness2');
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

/** Stand der abgeleiteten Blätter: Gruppen ohne Lücken und Reihenfolge, Pokédex-Daten, Seltenheiten, Dashboard-Zahlen. */
function snap(env) {
  const g = env.values('Gruppen');
  const helper = env.run('DASH_HELPER_COL');
  const dash = env.sheet('Dashboard');
  return {
    gHead: J(g[0]),
    groups: g.slice(1).filter(r => r.some(x => x !== '')).map(r => J(r.map(norm))).sort(),
    dex: env.values('Pokédex-Daten').map(r => J(r.map(norm))),
    rarity: env.values('Seltenheiten').map(r => J(r)),
    dash: J(dash.getRange('C5:K7').getValues()) + J(dash.getRange(2, helper, 40, 3).getValues())
  };
}

function diff(a, b) {
  const out = [];
  if (a.gHead !== b.gHead) out.push(['Kopf Gruppen', a.gHead, b.gHead]);
  const ga = a.groups.filter(x => b.groups.indexOf(x) < 0), gb = b.groups.filter(x => a.groups.indexOf(x) < 0);
  if (ga.length || gb.length || a.groups.length !== b.groups.length) out.push(['Gruppen', ga.slice(0, 2), gb.slice(0, 2)]);
  const dx = [];
  for (let i = 0; i < Math.max(a.dex.length, b.dex.length); i++) if (a.dex[i] !== b.dex[i]) dx.push([i + 1, a.dex[i], b.dex[i]]);
  if (dx.length) out.push(['Pokédex-Daten', dx.slice(0, 3)]);
  if (J(a.rarity) !== J(b.rarity)) out.push(['Seltenheiten', a.rarity, b.rarity]);
  if (a.dash !== b.dash) out.push(['Dashboard', a.dash, b.dash]);
  return out;
}

/** delta einer Änderung = was getCollection danach für diese Gruppen liefert */
function checkDelta(env, label, res, bad) {
  if (!res || !res.delta) return;
  const all = env.uiCall('getCollection').groups;
  const byKey = {};
  all.forEach(g => { byKey[g.gkey] = g; });
  res.delta.groups.forEach(g => { if (J(g) !== J(byKey[g.gkey])) bad.push([label, 'delta-Gruppe', g.gkey]); });
  res.delta.gone.forEach(k => { if (byKey[k]) bad.push([label, 'gone, aber da', k]); });
}

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
t.section('Gezielt nachziehen = alles neu bauen (nach jeder Änderung)');
{
  const env = setup();
  env.ctx.setViewExtras(['Ordner']);
  const bad = [], deltaBad = [];
  let full = 0;
  const done = randomOps(env, 7, 90, (label, res) => {
    checkDelta(env, label, res, deltaBad);
    const a = snap(env);
    env.ctx.rebuildGroups_();
    const d = diff(a, snap(env));
    if (d.length) bad.push([label, d]);
    full++;
  });
  ok('alle Arten von Änderungen kamen vor', ['addCard', 'addFreeCard', 'adjustEntry', 'revertAdjust', 'editEntry', 'setGroupOwnPrice', 'linkFreeGroup']
    .every(k => done[k] > 0), done);
  eq('Gruppen, Pokédex, Seltenheiten, Dashboard wie neu gebaut (' + full + ' Änderungen)', bad.slice(0, 2), []);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
}

t.section('Gezielt nachziehen über viele Änderungen (mit Lücken in Gruppen)');
{
  const env = setup();
  const deltaBad = [];
  randomOps(env, 2024, 120, (label, res) => checkDelta(env, label, res, deltaBad));
  const holes = env.values('Gruppen').slice(1).filter(r => r.every(x => x === '')).length;
  const a = snap(env);
  env.ctx.rebuildGroups_();
  eq('am Ende wie neu gebaut', diff(a, snap(env)), []);
  ok('Lücken in Gruppen entstehen und stören nicht (' + holes + ')', holes >= 0);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
  const view = env.sheet('Sammlung').getRange('A6').getFormula();
  ok('Sammlung filtert leere Zeilen aus Gruppen', /FILTER\(Gruppen!A2:[A-Z]+, Gruppen!A2:A<>""\)/.test(view), view);
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
  let g = count('Gruppen'), p = count('Pokédex-Daten');
  const res = env.ctx.adjustEntry(eid, 1);
  const cellsG = g(), cellsP = p();
  const width = env.values('Gruppen')[0].length;
  ok('+1: in Gruppen nur die eine Zeile', cellsG === width, [cellsG, width]);
  ok('+1: im Pokédex nur Glurak und der Kartenblock', cellsP <= 8 + 10 * 8, cellsP);
  ok('+1: delta mit genau der Gruppe', res.delta && J(res.delta.groups.map(x => x.gkey)) === J(['swsh3-025|normal|']) && res.delta.gone.length === 0, res.delta);
  g = count('Gruppen'); p = count('Pokédex-Daten');
  env.ctx.rebuildGroups_();
  const fullG = g(), fullP = p();
  ok('zum Vergleich alles neu: viel mehr', fullG >= 25 * width && fullP > 1000 * 8, [fullG, fullP]);
  // Gruppen passt nicht (z. B. von einer alten Version): alles neu wie bisher
  env.sheet('Gruppen').getRange(1, 1).setValue('Alter Kopf');
  const r2 = env.ctx.adjustEntry(eid, 1);
  ok('anderer Kopf in Gruppen: voller Neuaufbau, Kopf wieder richtig', env.values('Gruppen')[0][0] === 'Gruppenschlüssel' && r2.delta.groups.length === 1);
  const a = snap(env);
  env.ctx.rebuildGroups_();
  eq('danach stimmt alles', diff(a, snap(env)), []);
}

t.section('Zeilenhöhen nur bei neuer Zeile, flush nur mit Bildern');
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
  eq('neue Karte mit Bildern: dazu der flush für die Zeilenhöhen', flushes(add('sv1-1')), 2);
  eq('gleiche Karte mit Bildern: nur der flush der Sperre', flushes(add('sv1-1')), 1);
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

t.section('getCollection');
{
  const env = setup();
  env.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  env.ctx.addCard({ id: 'sm9-33', lang: 'de', variant: 'base', qty: 1 });
  const f = env.ctx.addFreeCard({ name: 'Fantasiemon', setName: 'Ordner', number: '007/100', version: 'Staff', qty: 1 });
  const res = env.uiCall('getCollection');
  eq('alle Gruppen, ohne Grenze, in der Reihenfolge der Daten', res.groups.map(g => g.gkey), ['swsh3-025|normal|', 'sm9-33|normal|', f.gkey]);
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
  const odd = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  const odd2 = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  ok('Anfrage-ID mit Sonderzeichen', odd2.repeat === true && odd2.count === odd.count);
  eq('delta = getCollection', bad, []);
}

t.done();
