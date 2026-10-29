'use strict';
/**
 * Kartensuche (#43, #38 S1 und S2): ein Suchablauf für Server und Browser.
 * - searchJs_ gibt der Seite den Quelltext des Ablaufs. Er läuft in einer leeren Umgebung (ohne Apps-Script-Dienste)
 *   und liefert dasselbe wie searchCards, getCardDetail und getCardBySetNumber auf dem Server.
 * - Runden zu tcgdex: eine Namenssuche braucht zwei (Liste, Details), die Treffer kommen mit Preisen.
 * - fetchAllJson_ holt Fehlgeschlagenes ein zweites Mal, wieder parallel.
 * - addCard und linkFreeGroup nehmen die Karten, die die Seite mitschickt, ohne tcgdex.
 * Start: node test/test_suche.js
 */
const vm = require('vm');
const H = require('./harness2');
const t = H.runner('test_suche');
const ok = t.ok, eq = t.eq;
const J = x => JSON.stringify(x);
const plain = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function db() {
  const d = H.defaultDb();
  // wie bei tcgdex: die Namensliste trägt das Bild, wenn die Karte eins hat (base1-4 hat deutsch keins)
  d['de/cards?name=Glurak'].forEach(c => { if (c.id !== 'base1-4') c.image = 'https://assets.tcgdex.net/de/x/' + c.id; });
  // „Pikachu V“: tcgdex schreibt „Pikachu-V“, gefunden über die Liste „Pikachu“ und den Zusatz
  d['de/cards?name=Pikachu V'] = [];
  d['de/cards?name=Pikachu'] = [{ id: 'swsh4-43', localId: '043', name: 'Pikachu-V', image: 'https://assets.tcgdex.net/de/swsh/swsh4/43' },
    { id: 'base1-58', localId: '58', name: 'Pikachu' }];
  ['de', 'en'].forEach(lang => {
    d[lang + '/cards/swsh4-43'] = H.card('swsh4-43', lang, { name: lang === 'de' ? 'Pikachu-V' : 'Pikachu V', set: { id: 'swsh4', name: 'Farbenschock', cardCount: { official: 185 } } });
    d[lang + '/cards/base1-58'] = H.card('base1-58', lang, { name: 'Pikachu', image: lang === 'de' ? undefined : 'https://assets.tcgdex.net/en/base/base1/58',
      set: { id: 'base1', name: lang === 'de' ? 'Grundset' : 'Base Set', cardCount: { official: 102 } } });
  });
  d['de/sets/base1'].cards.push({ id: 'base1-58', localId: '58', name: 'Pikachu' });
  // zu viele Treffer
  d['de/cards?name=Pika'] = Array.from({ length: 30 }, (x, i) => ({ id: 'p' + i + '-1', localId: '1', name: 'Pika ' + i }));
  return d;
}

function setup() {
  const env = H.createEnv({ db: db() });
  env.ctx.setupAll_();
  return env;
}

/** Der Suchablauf aus searchJs_ in einer leeren Umgebung: nur, was JavaScript selbst mitbringt. */
function browserCode(env) {
  const src = env.ctx.searchJs_();
  const box = vm.createContext({});
  return { src, S: vm.runInContext(src, box) };
}

/** Ablauf wie im Browser ausführen: tcgdex aus der Attrappe, Sets aus den tcgdex-Listen, Übersetzung vom Server. */
function runBrowser(env, S, flow) {
  const urls = [], rounds = [];
  const get = url => {
    urls.push(url);
    const body = env.DB[decodeURIComponent(url.slice(H.API.length))];
    return body === undefined ? { ok: false, notFound: true } : { ok: true, data: plain(body) };
  };
  let step = flow.next();
  while (!step.done) {
    rounds.push(step.value.map(n => n[0]));
    const answers = step.value.map(n => {
      if (n[0] === 'sets') {
        const de = get(S.url(['sets', 'de'])), en = get(S.url(['sets', 'en']));
        return { ok: true, data: S.sets(de.data, en.data) };
      }
      if (n[0] === 'tr') return { ok: true, data: env.uiCall('translateCardName', n[1]) };
      return get(S.url(n));
    });
    step = flow.next(answers);
  }
  return { value: plain(step.value), urls, rounds };
}

/** Server-Aufruf mit gezählten Runden (fetchAll) */
function onServer(env, fn, ...args) {
  const c = env.ctx;
  const fa = c.UrlFetchApp.fetchAll;
  const batches = [];
  c.UrlFetchApp.fetchAll = rs => { batches.push(rs.map(r => r.url)); return fa(rs); };
  const logs = env.logs.length;
  let value, error = null;
  try { value = env.uiCall(fn, ...args); } catch (e) { error = e.message; }
  c.UrlFetchApp.fetchAll = fa;
  return { value, error, batches, log: env.logs.slice(logs).join('\n') };
}

const QUERIES = [
  ['nur Name, drei deutsche Treffer', { name: 'Glurak' }],
  ['Name und Nummer', { name: 'Glurak', number: '025' }],
  ['Name und Nummer mit Kartenzahl', { name: 'Glurak', number: '25/189' }],
  ['Name und Set', { name: 'Glurak', set: 'Grundset' }],
  ['Zusatz „V“ (tcgdex: Pikachu-V)', { name: 'Pikachu V' }],
  ['deutsch ohne Bild: Bild aus den englischen Daten', { name: 'Pikachu', number: '58' }],
  ['englischer Ersatz über die Übersetzung', { name: 'Mewtu' }],
  ['nur Set und Nummer', { name: '', number: '4', set: 'Grundset' }],
  ['nichts gefunden, mit Nummer: Set-Auswahl', { name: 'Unbekannt', number: '7/50' }],
  ['nichts gefunden, ohne Nummer', { name: 'Unbekannt' }],
  ['zu viele Treffer', { name: 'Pika' }],
  ['Set unbekannt: Filter ignoriert', { name: 'Glurak', number: '4', set: 'Gibtsnicht' }]
];

t.section('Quelltext für die Seite (searchJs_)');
{
  const env = setup();
  const { src, S } = browserCode(env);
  ok('Hülle mit allen Funktionen, ohne „</script>“', /^\(function \(\) \{\n/.test(src) && !/<\/script/i.test(src) && src.length > 5000, src.slice(0, 60));
  ok('liefert search, card, setNumber, url, sets, split', ['search', 'card', 'setNumber', 'url', 'sets', 'split'].every(k => typeof S[k] === 'function'), Object.keys(S));
  ok('keine Apps-Script-Dienste im Quelltext', !/\b(SpreadsheetApp|UrlFetchApp|CacheService|PropertiesService|LockService|Utilities|Session|HtmlService|Logger)\b/.test(src));
  eq('Adressen wie auf dem Server', [S.url(['card', 'de', 'swsh3-025']), S.url(['name', 'en', 'Mr. Mime']), S.url(['set', 'de', 'sv03.5']), S.url(['sets', 'en'])],
    [H.API + 'de/cards/swsh3-025', H.API + 'en/cards?name=Mr.%20Mime', H.API + 'de/sets/sv03.5', H.API + 'en/sets']);
  // Werte wie im Server
  const c = env.ctx;
  ok('Konstanten aus Code.gs', src.indexOf('var MAX_CANDIDATES = ' + c.MAX_CANDIDATES) >= 0 || /var MAX_CANDIDATES = 24;/.test(src));
  // Fällt etwas aus, bekommt die Seite null
  const orig = c.searchFlow_;
  c.searchFlow_ = function () { throw new Error('x'); };
  Object.defineProperty(c.searchFlow_, 'name', { value: 'anders' });
  eq('Quelltext unstimmig: null', c.searchJs_(), 'null');
  c.searchFlow_ = orig;
}

t.section('Gleiches Ergebnis auf Server und im Browser');
{
  const env = setup();
  const { S } = browserCode(env);
  QUERIES.forEach(([label, q]) => {
    const srv = onServer(env, 'searchCards', q);
    let br, brErr = null;
    try { br = runBrowser(env, S, S.search(plain(q))); } catch (e) { brErr = e.message; }
    if (srv.error || brErr) ok(label + ': gleicher Fehler', srv.error === brErr, [srv.error, brErr]);
    else eq(label + ': gleiches Ergebnis', br.value, srv.value);
  });
  // Fehler bei leerer Eingabe: derselbe Text
  const e1 = onServer(env, 'searchCards', { name: '' });
  let e2 = null;
  try { runBrowser(env, S, S.search({ name: '' })); } catch (e) { e2 = e.message; }
  ok('leere Eingabe: gleicher Fehlertext', e1.error && e1.error === e2 && /Bitte einen Namen eingeben/.test(e2), [e1.error, e2]);
  // Einzelkarte und Set-Auswahl
  [['swsh3-136', 'de'], ['base1-4', 'de'], ['old9-007', 'en']].forEach(([id, lang]) => {
    eq('getCardDetail ' + id + ': gleich', runBrowser(env, S, S.card(id, lang)).value, onServer(env, 'getCardDetail', id, lang).value);
  });
  [['swsh3', '136'], ['base1', '4'], ['old9', '7']].forEach(([set, nr]) => {
    eq('getCardBySetNumber ' + set + ' ' + nr + ': gleich', runBrowser(env, S, S.setNumber(set, nr)).value, onServer(env, 'getCardBySetNumber', set, nr).value);
  });
  let e3 = null;
  try { runBrowser(env, S, S.setNumber('swsh3', '999')); } catch (e) { e3 = e.message; }
  ok('Nummer fehlt im Set: gleicher Fehler', e3 === onServer(env, 'getCardBySetNumber', 'swsh3', '999').error && /999 gibt es in diesem Set nicht/.test(e3), e3);
}

t.section('Treffer mit Preisen (#38 S1), wenige Runden (#38 S2)');
{
  const env = setup();
  const { S } = browserCode(env);
  let r = runBrowser(env, S, S.search({ name: 'Glurak' }));
  // Runde 2: drei deutsche Karten und die englische von base1-4 (ohne Bild); Runde 3: englischer Preis für swsh3-136
  eq('Glurak: Liste, alle Details gleichzeitig, englischer Preis', r.rounds.map(x => x.join(',')), ['name', 'card,card,card,card', 'card']);
  const byId = {};
  r.value.cards.forEach(c => { byId[c.id] = c; });
  ok('jeder Treffer mit Preisen und Stand', r.value.cards.every(c => c.prices && 'base' in c.prices && 'reverse' in c.prices && 'firstEdition' in c.prices), r.value.cards);
  ok('swsh3-025: Trend 1,50, Reverse 3,25, Stand', byId['swsh3-025'].prices.base === 1.5 && byId['swsh3-025'].prices.reverse === 3.25 &&
    byId['swsh3-025'].priceUpdated === '2026-10-13', byId['swsh3-025']);
  ok('base1-4 (deutsch ohne Bild): Bild aus den englischen Daten derselben Runde', /en\/x\/base1-4/.test(byId['base1-4'].image), byId['base1-4'].image);
  // deutscher Preis fehlt: eine Runde mehr für die englischen Daten
  ok('swsh3-136 (deutsch ohne Preis): Preis aus den englischen Daten', byId['swsh3-136'].priceFromEn === true && byId['swsh3-136'].prices.base === 1.5, byId['swsh3-136']);
  r = runBrowser(env, S, S.search({ name: 'Glurak', number: '136' }));
  eq('Glurak 136: Liste, Details, dann englischer Preis', r.rounds.map(x => x.join(',')), ['name', 'card', 'card']);
  r = runBrowser(env, S, S.search({ name: 'Glurak', number: '25/189' }));
  eq('mit Kartenzahl: Sets und Liste in derselben Runde', r.rounds.map(x => x.join(',')), ['sets,name', 'card']);
  r = runBrowser(env, S, S.search({ name: 'Pikachu V' }));
  eq('Pikachu V: beide Listen in derselben Runde', r.rounds.map(x => x.join(',')), ['name,name', 'card']);
  eq('Pikachu V: Treffer Pikachu-V', r.value.cards.map(c => c.id + ' ' + c.name), ['swsh4-43 Pikachu-V']);
  r = runBrowser(env, S, S.search({ name: 'Mewtu' }));
  eq('Mewtu: deutsche Liste, Übersetzung, englische Listen, Details englisch und deutsch', r.rounds.map(x => x.join(',')),
    ['name', 'tr', 'name,name', 'card,card']);
  ok('Mewtu: englischer Ersatz mit Preis und Hinweis', r.value.stage === 'en' && r.value.cards[0].lang === 'en' && r.value.cards[0].prices.base === 1.5 &&
    /englische Daten für „Mewtwo"/.test(r.value.notes.join(' ')), r.value);
  r = runBrowser(env, S, S.search({ name: '', number: '4', set: 'Grundset' }));
  eq('nur Set und Nummer: Sets, beide Kartenlisten des Sets, Details', r.rounds.map(x => x.join(',')), ['sets', 'set,set', 'card,card']);
  r = runBrowser(env, S, S.search({ name: 'Pika' }));
  ok('zu viele Treffer: keine Details geholt', r.value.tooMany === 30 && r.rounds.length === 1 && !r.urls.some(u => /\/cards\/p\d/.test(u)), r.rounds);
  r = runBrowser(env, S, S.setNumber('swsh3', '136'));
  eq('Set-Auswahl: beide Kartenlisten in einer Runde, dann die Karte (ohne Bild in der Liste: gleich mit den englischen Daten)',
    r.rounds.map(x => x.join(',')), ['set,set', 'card,card']);
}

t.section('Server: Runden, Zwischenspeicher, Zeitprotokoll');
{
  const env = setup();
  let s = onServer(env, 'searchCards', { name: 'Glurak' });
  eq('Glurak: Liste, Details, englischer Preis', s.batches.map(b => b.length), [1, 4, 1]);
  ok('Zeitprotokoll mit Runden', /^searchCards \d+ ms: Runde 1 \d+, Runde 2 \d+, Runde 3 \d+$/m.test(s.log), s.log);
  ok('Treffer mit Preisen, Antippen ohne Abruf', s.value.cards.every(c => c.prices), s.value.cards);
  s = onServer(env, 'searchCards', { name: 'Glurak' });
  eq('noch einmal: alles aus dem Zwischenspeicher', s.batches, []);
  s = onServer(env, 'searchCards', { name: 'Mewtu' });
  ok('Mewtu: Übersetzung ohne Abruf, beide englischen Listen und die Details je in einer Runde', J(s.batches.map(b => b.length)) === J([1, 2, 2]) &&
    /en\/cards\?name=Mewtwo/.test(s.batches[1][0]), s.batches);
  s = onServer(env, 'getCardBySetNumber', 'swsh3', '025');
  // die Kartenliste des Sets hat keine Bilder: die englischen Daten kommen gleich mit, die deutsche Karte kennt der Zwischenspeicher
  ok('Set und Nummer: beide Listen in einer Runde, dann nur die englische Karte', J(s.batches.map(b => b.length)) === J([2, 1]) &&
    /en\/cards\/swsh3-025$/.test(s.batches[1][0]), s.batches);
  s = onServer(env, 'getCardDetail', 'swsh3-025', 'de');
  ok('getCardDetail mit Zeitprotokoll', /^getCardDetail \d+ ms: Runde 1 \d+$/m.test(s.log) && s.batches.length === 0, s);
}

t.section('fetchAllJson_: zweiter Versuch parallel');
{
  const env = setup();
  const c = env.ctx;
  const u = id => H.API + 'de/cards/' + id;
  let fails = { 'swsh3-025': 1 };
  env.fetchFail = url => { const id = url.split('/').pop(); if (fails[id]) { fails[id]--; return 500; } return null; };
  const fa = c.UrlFetchApp.fetchAll;
  const batches = [];
  c.UrlFetchApp.fetchAll = rs => { batches.push(rs.map(r => r.url.split('/').pop())); return fa(rs); };
  let res = c.fetchAllJson_([u('swsh3-025'), u('swsh3-136'), u('gibts-1')]);
  ok('500 einmal: zweiter Versuch nur für diese Adresse, Ergebnis da', J(batches) === J([['swsh3-025', 'swsh3-136', 'gibts-1'], ['swsh3-025']]) &&
    res[0].ok && res[1].ok && res[2].notFound, [batches, res.map(x => Object.keys(x))]);
  batches.length = 0;
  fails = { 'swsh3-025': 5 };
  res = c.fetchAllJson_([u('swsh3-025'), u('swsh3-136')]);
  ok('500 zweimal: Fehler mit HTTP-Code, die andere da', res[0].ok === false && res[0].error === 'HTTP 500' && res[1].ok && batches.length === 2, res);
  // fetchAll wirft (eine Adresse gar nicht erreichbar): jede Adresse einzeln
  batches.length = 0;
  env.fetchFail = url => (/gibts-2$/.test(url) ? 'throw' : null);
  res = c.fetchAllJson_([u('swsh3-025'), u('gibts-2')]);
  ok('fetchAll wirft: einzeln geholt, die gute kommt an', res[0].ok && res[1].ok === false && /Address unavailable/.test(res[1].error), res);
  env.fetchFail = null;
  c.UrlFetchApp.fetchAll = fa;
  // Suche bei einem Ausfall der Namensliste: deutscher Fehler wie bisher
  env.fetchFail = url => (/cards\?name=/.test(url) ? 503 : null);
  const s = onServer(env, 'searchCards', { name: 'Glurak' });
  ok('Namensliste fällt aus: „tcgdex nicht erreichbar (HTTP 503)“', s.error === 'tcgdex nicht erreichbar (HTTP 503)', s.error);
  env.fetchFail = null;
}

t.section('Nummer im Namensfeld (#51), Set-Symbol (#47)');
{
  const env = setup();
  const { S } = browserCode(env);
  const cases = [
    [['Pikachu 12', ''], { name: 'Pikachu', number: '12' }],
    [['12 Pikachu', ''], { name: 'Pikachu', number: '12' }],
    [['Glurak 025/165', ''], { name: 'Glurak', number: '025/165' }],
    [['Pikachu SWSH050', ''], { name: 'Pikachu', number: 'SWSH050' }],
    [['Pikachu TG05/TG30', ''], { name: 'Pikachu', number: 'TG05/TG30' }],
    [['Pikachu ex 12/40', ''], { name: 'Pikachu ex', number: '12/40' }],
    [['Porygon2', ''], { name: 'Porygon2', number: '' }],
    [['Porygon2 12', ''], { name: 'Porygon2', number: '12' }],
    [['Pikachu V', ''], { name: 'Pikachu V', number: '' }],
    [['Mr. Mime', ''], { name: 'Mr. Mime', number: '' }],
    [['Pikachu 12', '25'], { name: 'Pikachu', number: '25' }],
    [['  Pikachu   12 ', ' '], { name: 'Pikachu', number: '12' }],
    [['12', ''], { name: '12', number: '' }],
    [['', '4'], { name: '', number: '4' }]
  ];
  cases.forEach(([args, want]) => eq('„' + args[0] + '“ und Nummer „' + args[1] + '“', plain(env.ctx.splitNameNumber_(args[0], args[1])), want));
  ok('die Seite trennt genauso (SEARCH.split)', cases.every(([args, want]) => J(S.split(args[0], args[1])) === J(want)));
  const a = onServer(env, 'searchCards', { name: 'Glurak 025' }).value;
  eq('Server: „Glurak 025“ im Namensfeld wie Name Glurak und Nummer 025', a, onServer(env, 'searchCards', { name: 'Glurak', number: '025' }).value);
  ok('Name ohne Nummer zurück (inputName)', a.inputName === 'Glurak' && a.cards.length === 1 && a.cards[0].id === 'swsh3-025', a);
  eq('Browser: gleich wie der Server', runBrowser(env, S, S.search({ name: 'Glurak 025' })).value, a);
  const u = onServer(env, 'searchCards', { name: 'Unbekannt 7/50' }).value;
  ok('Set-Auswahl mit der Nummer aus dem Namen', u.stage === 'pickSet' && u.number === '7/50' && u.inputName === 'Unbekannt', u);
  // Set-Symbol: Treffer bringen es von tcgdex mit, Karten der Sammlung bekommen es aus dem Blatt Sets
  const SYM = 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol';
  const g = onServer(env, 'searchCards', { name: 'Glurak' }).value.cards;
  ok('Treffer mit Set-Symbol, ohne Symbol leer', g.filter(c => c.setId === 'swsh3').every(c => c.setSymbol === SYM) &&
    g.filter(c => c.setId === 'base1').every(c => c.setSymbol === '') && g.length === 3, g.map(c => [c.id, c.setSymbol]));
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1 });
  env.uiCall('addFreeCard', { name: 'Pikachu', setName: 'SWSH Black Star Promos', number: 'SWSH020', qty: 1 });
  const groups = env.uiCall('getCollection').groups;
  const by = id => groups.find(x => x.id === id) || {};
  const promo = groups.find(x => x.isFree) || {};
  ok('Sammlung: Set-ID und Symbol aus dem Blatt Sets', by('swsh3-025').setId === 'swsh3' && by('swsh3-025').setSymbol === SYM && by('swsh3-025').setPromo === false, by('swsh3-025'));
  ok('Sammlung: Set ohne Symbol', by('base1-4').setId === 'base1' && by('base1-4').setSymbol === '' && by('base1-4').setPromo === false, by('base1-4'));
  ok('Sammlung: freie Karte aus einem Promo-Set zeigt den Stern (setPromo)', promo.setId === '' && promo.setSymbol === '' && promo.setPromo === true, promo);
}

t.section('Speichern mit den Karten aus der Seite');
{
  const env = setup();
  const card = id => ({ lang: 'de', id, data: plain(env.DB['de/cards/' + id]) });
  const en = id => ({ lang: 'en', id, data: plain(env.DB['en/cards/' + id]) });
  let n0 = env.fetchLog.length;
  let res = env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1, cards: [card('base1-4'), en('base1-4')] });
  ok('addCard: keine Karte bei tcgdex geholt', !env.fetchLog.slice(n0).some(u => /\/cards\//.test(u)) && res.count === 1, env.fetchLog.slice(n0));
  const row = env.data().find(d => d.id === 'base1-4');
  ok('Bild aus den mitgeschickten englischen Daten, Holo als Grundvariante, Preis', /en\/x\/base1-4/.test(row.img) && row.variant === 'holo' && row.price === 1.5, row);
  // nicht passende Daten zählen nicht
  n0 = env.fetchLog.length;
  const wrong = { lang: 'de', id: 'swsh3-025', data: plain(env.DB['de/cards/swsh3-136']) };
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1, cards: [wrong, { lang: 'fr', id: 'swsh3-025', data: {} }, 'Unsinn', null] });
  ok('falsche ID oder Sprache: holt die Karte selbst', env.fetchLog.slice(n0).some(u => /de\/cards\/swsh3-025$/.test(u)), env.fetchLog.slice(n0));
  eq('givenCards_: höchstens vier, nur passende', Object.keys(env.ctx.givenCards_([card('swsh3-025'), en('swsh3-025'), wrong, card('base1-4'), card('swsh3-136')])),
    ['tcg:de:swsh3-025', 'tcg:en:swsh3-025', 'tcg:de:base1-4']);
  // Verknüpfen: freie Karte mit mitgeschickter Karte
  const free = env.uiCall('addFreeCard', { name: 'Pikachu', setName: 'Farbenschock', number: '43', qty: 1 });
  n0 = env.fetchLog.length;
  const linked = env.uiCall('linkFreeGroup', free.gkey, 'swsh4-43', 'de', 'base', [card('swsh4-43')]);
  ok('linkFreeGroup: ohne Abruf der Karte', linked.gkey === 'swsh4-43|normal|' && !env.fetchLog.slice(n0).some(u => /cards\/swsh4-43/.test(u)), [linked.gkey, env.fetchLog.slice(n0)]);
}

t.done();
