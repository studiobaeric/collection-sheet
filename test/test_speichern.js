'use strict';
/**
 * Leichtes Speichern und Einsortieren (#41), Sammlung im Browser (#30), Zwischenspeicher der Suche (#38 S3), Serverseite:
 * - Jede Änderung aus Seitenleiste und Web-App schreibt nur das Blatt Daten (lightSave_). Gruppen, Pokédex-Daten,
 *   Seltenheiten und Dashboard ziehen erst beim Einsortieren nach; das Ergebnis muss dem vollen Neuaufbau
 *   (rebuildGroups_) entsprechen, geprüft mit vielen zufälligen Änderungen.
 * - pending (noch nicht einsortiert) zählt wie die Hinweis-Formel in den Blättern.
 * - Jede Änderung liefert delta mit genau den Gruppen, die getCollection danach liefern würde.
 * - Karten von tcgdex kommen eine halbe Stunde aus dem Zwischenspeicher (fetchCard_), Namenslisten drei Stunden,
 *   die Sets sechs Stunden.
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

/** Wie die Hinweis-Formel in den Blättern (pendingFormula_): Daten-Zeilen, die nach dem spätesten Stand in Gruppen geändert wurden. */
function pendingByFormula(env) {
  const C = env.run('COL.changed'), G = env.run("GCOL['Zuletzt geändert']") - 1;
  const isDate = v => Object.prototype.toString.call(v) === '[object Date]'; // Datum aus dem Skript (anderer Kontext)
  const times = env.values('Gruppen').slice(1).map(r => r[G]).filter(isDate).map(v => v.getTime());
  const max = times.length ? Math.max(...times) : 0;
  return env.values('Daten').slice(1).filter(r => isDate(r[C]) && r[C].getTime() > max).length;
}

/** Blätter, die nur das Einsortieren schreibt */
const DERIVED = ['Gruppen', 'Pokédex-Daten', 'Pokédex', 'Seltenheiten', 'Dashboard', 'Sammlung', 'Pokédex-Nummern', 'Sets'];
const writes = env => Object.assign({}, env.writesBy);
const derivedWrites = (env, before) => DERIVED.filter(n => (env.writesBy[n] || 0) !== (before[n] || 0));

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
t.section('Leichtes Speichern: nur Daten, Einsortieren = alles neu bauen (nach jeder Änderung)');
{
  const env = setup();
  env.ctx.setViewExtras(['Ordner']);
  const bad = [], deltaBad = [], pendBad = [], wroteBad = [];
  let n = 0, w0 = writes(env);
  const done = randomOps(env, 7, 90, (label, res) => {
    const wrote = derivedWrites(env, w0);
    if (wrote.length) wroteBad.push([label, wrote]);
    if (res && res.pending !== pendingByFormula(env)) pendBad.push([label, res.pending, pendingByFormula(env)]);
    checkDelta(env, label, res, deltaBad);
    const r = env.sortIn();
    if (r.pending !== 0 || pendingByFormula(env) !== 0) pendBad.push([label, 'nach dem Einsortieren', r.pending, pendingByFormula(env)]);
    const a = snap(env);
    env.ctx.rebuildGroups_();
    const d = diff(a, snap(env));
    if (d.length) bad.push([label, d]);
    n++;
    w0 = writes(env);
  });
  ok('alle Arten von Änderungen kamen vor', ['addCard', 'addFreeCard', 'adjustEntry', 'revertAdjust', 'editEntry', 'setGroupOwnPrice', 'linkFreeGroup']
    .every(k => done[k] > 0), done);
  eq('Änderungen schreiben nur Daten, nie Gruppen, Pokédex, Seltenheiten, Dashboard oder Sammlung', wroteBad.slice(0, 3), []);
  eq('pending wie die Formel im Blatt, nach dem Einsortieren 0', pendBad.slice(0, 3), []);
  eq('Einsortieren = voller Neuaufbau (' + n + ' Änderungen)', bad.slice(0, 2), []);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
}

t.section('Viele Änderungen, einmal einsortiert');
{
  const env = setup();
  const deltaBad = [], seen = [];
  const before = snap(env), w0 = writes(env);
  randomOps(env, 2024, 120, (label, res) => { checkDelta(env, label, res, deltaBad); if (res) seen.push(res.pending); });
  eq('ohne Einsortieren: Gruppen, Pokédex, Seltenheiten und Dashboard wie vorher', diff(before, snap(env)), []);
  eq('und nichts davon geschrieben', derivedWrites(env, w0), []);
  const open = pendingByFormula(env);
  ok('pending wächst mit und steht zuletzt wie die Formel', open > 10 && seen[seen.length - 1] === open && seen.every(x => typeof x === 'number'), [open, seen.slice(-3)]);
  eq('getCollection und getUiConfig melden dieselbe Zahl', [env.uiCall('getCollection').pending, env.uiCall('getUiConfig').pending], [open, open]);
  const r = env.sortIn();
  eq('Einsortieren: Zahl, Meldung, danach 0', [r.sorted, r.pending, pendingByFormula(env), r.message.indexOf(open + ' Änderungen einsortiert.') === 0], [open, 0, 0, true]);
  const a = snap(env);
  env.ctx.rebuildGroups_();
  eq('danach wie neu gebaut', diff(a, snap(env)), []);
  eq('delta = getCollection', deltaBad.slice(0, 3), []);
  const w1 = writes(env), f0 = env.fetchLog.length;
  const again = env.sortIn();
  ok('noch einmal: nichts zu tun, nichts geschrieben', again.sorted === 0 && again.filled === 0 && again.message === 'Alles war schon einsortiert.' &&
    derivedWrites(env, w1).length === 0, [again, derivedWrites(env, w1), env.fetchLog.slice(f0)]);
  const view = env.sheet('Sammlung').getRange('A6').getFormula();
  ok('Sammlung filtert leere Zeilen aus Gruppen', /FILTER\(Gruppen!A2:[A-Z]+, Gruppen!A2:A<>""\)/.test(view), view);
}

t.section('Was geschrieben wird');
{
  const env = setup();
  IDS.forEach(id => env.ctx.addCard({ id, lang: 'de', variant: 'base', qty: 1 }));
  for (let k = 0; k < 20; k++) env.ctx.addFreeCard({ name: 'Karte ' + k, setName: 'Ordner', number: String(k), qty: 1 });
  env.sortIn();
  const count = name => {
    const sh = env.sheet(name);
    let n = 0;
    const orig = sh.put.bind(sh);
    sh.put = (...a) => { n++; return orig(...a); };
    return () => { sh.put = orig; return n; };
  };
  const eid = env.data().find(d => d.id === 'swsh3-025').eid;
  let g = count('Gruppen'), p = count('Pokédex-Daten'), d = count('Daten');
  const f0 = env.flushes;
  const res = env.ctx.adjustEntry(eid, 1);
  const cellsG = g(), cellsP = p(), cellsD = d();
  const dWidth = env.values('Daten')[0].length, width = env.values('Gruppen')[0].length;
  ok('+1: in Daten nur die eine Zeile, nichts in Gruppen und Pokédex', cellsD === dWidth && cellsG === 0 && cellsP === 0, [cellsD, dWidth, cellsG, cellsP]);
  ok('+1: ein flush (die Sperre)', env.flushes - f0 === 1, env.flushes - f0);
  ok('+1: delta mit genau der Gruppe, pending 1', res.delta && J(res.delta.groups.map(x => x.gkey)) === J(['swsh3-025|normal|']) && res.delta.gone.length === 0 && res.pending === 1, res);
  g = count('Gruppen'); p = count('Pokédex-Daten');
  env.sortIn();
  const fullG = g(), fullP = p();
  ok('Einsortieren baut alles neu', fullG >= 25 * width && fullP > 1000 * 8, [fullG, fullP]);
  // Gruppen passt nicht (z. B. von einer alten Version): Änderungen gehen trotzdem, Einsortieren baut es richtig neu
  env.sheet('Gruppen').getRange(1, 1).setValue('Alter Kopf');
  const r2 = env.ctx.adjustEntry(eid, 1);
  ok('anderer Kopf in Gruppen: Änderung nur in Daten, delta wie immer', env.values('Gruppen')[0][0] === 'Alter Kopf' && r2.delta.groups.length === 1 && r2.pending === 1, r2);
  env.sortIn();
  ok('Einsortieren: Kopf wieder richtig', env.values('Gruppen')[0][0] === 'Gruppenschlüssel');
  const a = snap(env);
  env.ctx.rebuildGroups_();
  eq('danach stimmt alles', diff(a, snap(env)), []);
}

t.section('Einsortieren: Zeitstempel, fehlende Daten, Menü, nachts');
{
  const env = setup();
  const c = env.ctx;
  // jede Änderung liegt nach dem letzten Einsortieren, auch in derselben Millisekunde oder bei abweichender Uhr
  c.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  env.sortIn();
  const sorted = c.sortedAt_();
  env.cache.set('sorted-at', String(sorted + 60000)); // die letzte einsortierte Änderung „in der Zukunft“
  const r = c.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  const ch = env.data().find(x => x.eid === r.eid).changed.getTime();
  ok('Zeitstempel mindestens 1 s nach dem letzten Einsortieren, zählt als offen', ch >= sorted + 61000 && r.pending === 1, [ch - sorted, r.pending]);
  env.cache.delete('sorted-at');
  ok('ohne Zwischenspeicher: Stand aus Gruppen', c.sortedAt_() === sorted && c.pendingCount_(c.readData_(c.sheet_('Daten'))) === 1);
  // fehlende Set-Daten und Pokédex-Nummern holt das Einsortieren, parallel und ohne Sperre
  c.addCard({ id: 'sm9-33', lang: 'de', variant: 'base', qty: 1 });
  c.addCard({ id: 'sv1-1', lang: 'de', variant: 'base', qty: 1 });
  ok('leicht gespeichert: Set-Datum fehlt noch', ['sm9-33', 'sv1-1'].every(id => env.data().find(x => x.id === id).setDate === ''));
  env.cache.clear(); // Karten nicht mehr im Zwischenspeicher: die Nummern kommen von tcgdex
  env.fetchLog.length = 0;
  env.fetchInLock = [];
  const fa = c.UrlFetchApp.fetchAll, f1 = c.UrlFetchApp.fetch;
  c.UrlFetchApp.fetchAll = (rs, ...x) => { if (env.lock.depth > 0) env.fetchInLock.push(rs.length); return fa(rs, ...x); };
  c.UrlFetchApp.fetch = (u, ...x) => { if (env.lock.depth > 0) env.fetchInLock.push(u); return f1(u, ...x); };
  const res = env.sortIn();
  c.UrlFetchApp.fetchAll = fa; c.UrlFetchApp.fetch = f1;
  eq('Set-Daten nachgetragen', ['sm9-33', 'sv1-1'].map(id => env.data().find(x => x.id === id).setDate), ['2019-02-01', '2023-03-31']);
  eq('Pokédex-Nummern gemerkt (sv1-1 ohne dexId: leer)', env.objects('Pokédex-Nummern').map(o => [o['Karten-ID'], String(o['Pokédex-Nr.'])]).sort(),
    [['sm9-33', '25 644'], ['sv1-1', ''], ['swsh3-025', '6']]);
  ok('Abrufe: je neues Set und neue Karte einmal, keiner in der Sperre', env.fetchLog.length === 4 && ['/sets/sm9', '/sets/sv1', '/cards/sm9-33', '/cards/sv1-1']
    .every(u => env.fetchLog.filter(x => x.indexOf(u) >= 0).length === 1) && env.fetchInLock.length === 0, [env.fetchLog, env.fetchInLock]);
  ok('Meldung, filled: zwei Set-Daten, zwei Nummern', res.sorted === 3 && res.filled === 4 && /^3 Änderungen einsortiert\./.test(res.message), res);
  ok('neues Set-Datum: Sets im Zwischenspeicher verworfen', !env.cache.has('sets'));
  ok('Sets-Blatt kennt die Daten jetzt', c.knownSetDate_('de', 'sm9') === '2019-02-01' && c.knownSetDate_('de', 'sv1') === '2023-03-31');
  // höchstens SORT_IN_DEX_MAX Karten pro Lauf von tcgdex
  const max = env.run('SORT_IN_DEX_MAX');
  const rows = [];
  for (let k = 0; k < max + 5; k++) env.DB['de/cards/zz-' + k] = H.card('zz-' + k, 'de', { dexId: [1] });
  for (let k = 0; k < max + 5; k++) rows.push(c.buildCardRow_({ dataLang: 'de', id: 'zz-' + k, name: 'Bisasam', setId: 'swsh3', setName: 'Flammende Finsternis', setDate: '2020-08-14' }, { origin: 'Hand' }));
  c.withLock_(() => c.appendDataRows_(rows));
  env.sortIn();
  const known = env.objects('Pokédex-Nummern').filter(o => /^zz-/.test(o['Karten-ID'])).length;
  ok('Pokédex-Nummern: höchstens ' + max + ' pro Lauf, der Rest beim nächsten', known === max, known);
  env.sortIn();
  ok('beim nächsten Lauf der Rest', env.objects('Pokédex-Nummern').filter(o => /^zz-/.test(o['Karten-ID'])).length === max + 5);
  // Menü und Dashboard-Knopf: Laufmeldung, dann Ergebnis unten rechts; Fehler: Meldung und weiterwerfen
  c.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  env.ss.toastLog = [];
  c.einsortieren();
  ok('Menü: Laufmeldung, dann Ergebnis', env.ss.toastLog.length === 2 && env.ss.toastLog[0].msg === 'Sortiere ein …' && env.ss.toastLog[0].timeout === -1 &&
    /^1 Änderung einsortiert\. Sammlung, Pokédex und Dashboard sind auf dem neuesten Stand\.$/.test(env.ss.toastLog[1].msg), env.ss.toastLog);
  env.ss.toastLog = [];
  ok('aus Seitenleiste und Web-App ohne Meldung unten rechts', c.einsortieren({ ui: true }).message === 'Alles war schon einsortiert.' && env.ss.toastLog.length === 0);
  const orig = c.rebuildGroups_;
  c.rebuildGroups_ = () => { throw new Error('Blatt kaputt'); };
  c.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  let threw = '';
  try { c.einsortieren(); } catch (e) { threw = e.message; }
  c.rebuildGroups_ = orig;
  ok('Fehler: Meldung unten rechts, weitergeworfen, bleibt offen', threw === 'Blatt kaputt' && /^Einsortieren ging nicht: Blatt kaputt/.test(env.ss.toastLog.slice(-1)[0].msg) &&
    pendingByFormula(env) === 1, [threw, env.ss.toastLog.slice(-1)[0]]);
  ok('keine verschachtelte Sperre', env.lock.nested === 0 && env.lock.depth === 0, env.lock);
  // nachts: der Preislauf sortiert am Ende ein, auch wenn nur freie Karten dazukamen
  c.addFreeCard({ name: 'Nachtkarte', setName: 'Ordner', number: '1', qty: 1 });
  c.preiseJetztAktualisieren();
  eq('nach dem Preislauf: alles einsortiert', [pendingByFormula(env), env.groups().some(g => g['Name'] === 'Nachtkarte')], [0, true]);
  const a = snap(env);
  c.rebuildGroups_();
  eq('und wie neu gebaut', diff(a, snap(env)), []);
}

t.section('Hinweise in den Blättern (#41)');
{
  const env = setup();
  const f = env.run('pendingFormula_()');
  eq('Formel: Daten-Zeilen nach dem spätesten Stand in Gruppen', f, 'SUMPRODUCT(ISNUMBER(Daten!V2:V)*(Daten!V2:V>MAX(Gruppen!V2:V)))');
  eq('Spalte V ist in beiden Blättern „Zuletzt geändert“', [env.values('Daten')[0][21], env.values('Gruppen')[0][21]], ['Zuletzt geändert', 'Zuletzt geändert']);
  const hint = (sheet, a1) => env.sheet(sheet).getRange(a1).getFormula();
  const tail = (sheet, a1) => (hint(sheet, a1).match(/noch nicht einsortiert, ([^"]*)", "([^"]*)"\)\)$/) || []).slice(1);
  ok('Sammlung A2: Formel mit der Zahl', hint('Sammlung', 'A2').indexOf('=LET(offen, ' + f + ', IF(offen>0, "⚠ "&offen&IF(offen=1, " Änderung ist", " Änderungen sind")&') === 0, hint('Sammlung', 'A2'));
  eq('Sammlung A2: Hinweis und sonst die Hilfe', tail('Sammlung', 'A2'), ['die Sammlung zeigt den alten Stand. Menü Pokémon > Einsortieren',
    'Summen gelten für die aktuelle Suche. Erfassen, Bearbeiten und Entfernen über Menü Pokémon > Karten erfassen.']);
  eq('Pokédex A2: Hinweis', tail('Pokédex', 'A2')[0], 'der Pokédex zeigt den alten Stand. Menü Pokémon > Einsortieren');
  eq('Dashboard C9: Hinweis, sonst leer', tail('Dashboard', 'C9'), ['die Zahlen zeigen den alten Stand. Knopf Einsortieren unten', '']);
  const rule = sheet => env.sheet(sheet).getConditionalFormatRules().find(r => r.arg('whenFormulaSatisfied') === '=LEFT($A$2)="⚠"');
  ok('Sammlung und Pokédex: Zeile 2 rot, solange etwas fehlt', ['Sammlung', 'Pokédex'].every(n => rule(n) && rule(n).arg('setFontColor') === '#a50e0e' &&
    rule(n).arg('setBackground') === '#fce8e6' && rule(n).arg('setBold') === true), ['Sammlung', 'Pokédex'].map(n => rule(n) && rule(n).calls));
  ok('kein Komma außerhalb von Texten in den Regeln', ['Sammlung', 'Pokédex'].every(n => !/,/.test(rule(n).arg('whenFormulaSatisfied').replace(/"[^"]*"/g, ''))));
  // deutsches Gebietsschema: Semikolons
  env.setFormulaDisplay((sheet, a1, formula) => (/,/.test(formula.replace(/"[^"]*"/g, '')) ? '#ERROR!' : ''));
  env.ctx.ansichtNeuAufbauen();
  ok('Semikolon-Rückfall auch für die Hinweise', ['Sammlung!A2', 'Pokédex!A2', 'Dashboard!C9'].every(x => {
    const [sh, a1] = x.split('!');
    const g = hint(sh, a1);
    return /^=LET\(offen; SUMPRODUCT\(ISNUMBER\(Daten!V2:V\)\*\(Daten!V2:V>MAX\(Gruppen!V2:V\)\)\); IF\(offen>0;/.test(g) && /einsortiert, /.test(g);
  }), hint('Pokédex', 'A2').slice(0, 120));
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
  const r1 = reads;
  env.uiCall('searchCards', { name: 'Glurak', number: '25/189' });
  env.uiCall('searchCards', { name: 'Pikachu', set: 'Teams sind Trumpf' });
  env.uiCall('getSetSuggestions');
  ok('Blatt Sets höchstens einmal gelesen, danach aus dem Zwischenspeicher', r1 <= 1 && reads === r1, [r1, reads]);
  ok('Sets 6 Stunden gemerkt, in Stücken', env.cachePuts.some(p => p.k === 'sets' && p.ttl === 21600) && env.cachePuts.some(p => p.k === 'sets:0' && p.ttl === 21600));
  ok('Namensliste 3 Stunden gemerkt', env.cachePuts.some(p => p.k === 'tcgl:de:glurak' && p.ttl === 10800), env.cachePuts.map(p => p.k));
  const n0 = env.fetchLog.length;
  const again = env.uiCall('searchCards', { name: 'glurak ' });
  ok('gleicher Name noch einmal (Groß/klein, Leerzeichen): ohne Namenssuche bei tcgdex', again.cards.length === 3 && !env.fetchLog.slice(n0).some(u => /cards\?name=/.test(u)), env.fetchLog.slice(n0));
  // Sets geändert: Zwischenspeicher verworfen, die nächste Suche liest das Blatt wieder
  env.uiCall('searchCards', { name: 'Glurak' });
  c.onEdit({ range: env.sheet('Sets').getRange(2, 3) });
  ok('Änderung im Blatt Sets verwirft die Sets', !env.cache.has('sets'));
  env.uiCall('searchCards', { name: 'Glurak' });
  ok('danach einmal neu gelesen', reads === r1 + 1, reads);
  c.rebuildSets_();
  ok('Übersetzung und Sets aktualisieren verwirft sie auch', !env.cache.has('sets'));
  // kaputter oder unvollständiger Zwischenspeicher: aus dem Blatt
  env.uiCall('searchCards', { name: 'Glurak' });
  env.cache.delete('sets:0');
  const r2 = reads;
  ok('fehlt ein Stück: aus dem Blatt', env.uiCall('searchCards', { name: 'Glurak' }).cards.length === 3 && reads === r2 + 1);
  env.cache.set('sets', '1'); env.cache.set('sets:0', '{kaputt');
  ok('kaputter Inhalt: aus dem Blatt', env.uiCall('searchCards', { name: 'Glurak' }).cards.length === 3 && reads === r2 + 2);
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
  const res0 = env.uiCall('getCollection');
  ok('vor dem Einsortieren: pending 3, Set-Datum noch leer', res0.pending === 3 && res0.groups[0].k.setDate === '', [res0.pending, res0.groups[0].k]);
  env.sortIn();
  const res = env.uiCall('getCollection');
  eq('alle Gruppen, ohne Grenze, in der Reihenfolge der Daten', res.groups.map(g => g.gkey), ['swsh3-025|normal|', 'sm9-33|normal|', f.gkey]);
  eq('nach dem Einsortieren: pending 0', res.pending, 0);
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
  ok('pending: 1, bei der Wiederholung neu gezählt', a.pending === 1 && again.pending === 1, [a.pending, again.pending]);
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
  ok('pending zählt Einträge, nicht Karten', d.pending === 1 && f.pending === 2 && f2.pending === 2, [d.pending, f.pending, f2.pending]);
  env.sortIn();
  const f3 = env.uiCall('addFreeCard', { name: 'Fantasiemon', setName: 'Ordner', number: '7', qty: 1, rid: 'f1' });
  ok('Wiederholung nach dem Einsortieren: pending neu gezählt (0)', f3.repeat === true && f3.pending === 0, f3);
  const odd = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  const odd2 = env.uiCall('addCard', { id: 'sm9-33', lang: 'de', variant: 'base', qty: 1, rid: 'a b/c' });
  ok('Anfrage-ID mit Sonderzeichen', odd2.repeat === true && odd2.count === odd.count);
  eq('delta = getCollection', bad, []);
}

t.done();
