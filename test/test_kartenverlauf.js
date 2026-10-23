'use strict';
/**
 * Tests für die Künstlersuche (#15) und den Preisverlauf pro Karte (#14): Blatt Kartenverlauf, Veränderung in Gruppen
 * und Sammlung, Preislauf, Übernahme, Seitenleiste mit Umschalter 7/30/90 Tage und aufklappbarer Kurve.
 * Start: node test/test_kartenverlauf.js   (jsdom über NODE_PATH oder ./node_modules)
 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness2');
const t = H.runner('test_kartenverlauf');
const ok = t.ok, eq = t.eq;
const TODAY = H.formatDate(new Date(), '', 'yyyy-MM-dd');

function setup() {
  const env = H.createEnv();
  env.DB['de/cards/swsh3-025'].illustrator = 'Mitsuhiro Arita';
  env.DB['de/cards/base1-4'].illustrator = 'Ken Sugimori';
  env.ctx.setupAll_();
  return env;
}

function groupBy(env, gkey) { return env.groups().find(g => g['Gruppenschlüssel'] === gkey); }
function histRows(env) { return env.objects('Kartenverlauf'); }
function histOf(env, id, variant) { return histRows(env).find(r => r['Karten-ID'] === id && r['Variante'] === variant); }

/** Ein Preislauf an einem bestimmten Tag: prices {'de|id': [trend, trendHolo]}. */
function runDay(env, ymd, prices) {
  const c = env.ctx;
  const cm = {};
  Object.keys(prices).forEach(k => { cm[k] = { trend: prices[k][0], 'trend-holo': prices[k][1], updated: ymd + 'T00:00:00Z' }; });
  c.writePrices_(cm, false);
  c.withLock_(() => { c.writeCardHistory_(c.readData_(c.sheet_('Daten')), ymd); c.rebuildGroups_(); });
}

/** Sammlung mit Glurak normal (2×) und reverse, Grundset-Glurak mit eigenem Preis, einer freien Karte. */
function scenario() {
  const env = setup();
  const u = env.uiCall.bind(env);
  const a = u('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 2 });
  const r = u('addCard', { id: 'swsh3-025', lang: 'de', variant: 'reverse', qty: 1 });
  const b = u('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1, ownPrice: 10 });
  const f = u('addFreeCard', { name: 'Frei', qty: 1 });
  return { env, a, r, b, f };
}

// ---------------------------------------------------------------------------
t.section('Hilfen: Verlaufstext, Einträge, Vergleichspreis');
{
  const env = H.createEnv();
  const c = env.ctx;
  const P = x => JSON.parse(JSON.stringify(x));
  eq('parseHistSeries_: sortiert, ein Eintrag pro Tag, Unsinn fällt weg',
    P(c.parseHistSeries_('2026-10-03=2;kaputt;2026-10-01=1.5;2026-10-03=2.25; 2026-10-02=0.1 ;=3;2026-1-1=4')),
    [{ d: '2026-10-01', p: 1.5 }, { d: '2026-10-02', p: 0.1 }, { d: '2026-10-03', p: 2.25 }]);
  eq('parseHistSeries_: leer und null', [P(c.parseHistSeries_('')), P(c.parseHistSeries_(null))], [[], []]);

  let s = [];
  c.addHistPrice_(s, '2026-10-01', 1.5);
  c.addHistPrice_(s, '2026-10-02', 1.5);
  eq('addHistPrice_: gleicher Preis am nächsten Tag kein Eintrag', P(s), [{ d: '2026-10-01', p: 1.5 }]);
  c.addHistPrice_(s, '2026-10-03', 1.75);
  c.addHistPrice_(s, '2026-10-03', 1.8);
  eq('addHistPrice_: zweiter Lauf am selben Tag ersetzt den von heute', P(s), [{ d: '2026-10-01', p: 1.5 }, { d: '2026-10-03', p: 1.8 }]);
  c.addHistPrice_(s, '2026-10-03', 1.5);
  eq('addHistPrice_: zurück auf den alten Preis am selben Tag: Eintrag von heute fällt weg', P(s), [{ d: '2026-10-01', p: 1.5 }]);

  s = c.parseHistSeries_('2026-09-01=1.5;2026-09-02=1.6;2026-09-27=1.9;2026-10-05=2');
  eq('histRef_ 30 Tage: letzter Eintrag bis 05.09., ganzer Zeitraum', P(c.histRef_(s, '2026-10-05', 30)), { p: 1.6, since: '' });
  eq('histRef_ 7 Tage', P(c.histRef_(s, '2026-10-05', 7)), { p: 1.9, since: '' });
  eq('histRef_ 90 Tage: Verlauf kürzer, erster Tag', P(c.histRef_(s, '2026-10-05', 90)), { p: 1.5, since: '2026-09-01' });
  eq('histRef_ genau am Rand (Eintrag vor genau 7 Tagen zählt voll)', P(c.histRef_(c.parseHistSeries_('2026-09-28=3'), '2026-10-05', 7)), { p: 3, since: '' });
  eq('histRef_: erst seit heute -> nichts', P(c.histRef_(c.parseHistSeries_('2026-10-05=2'), '2026-10-05', 30)), null);
  eq('histRef_: ohne Verlauf -> nichts', P(c.histRef_([], '2026-10-05', 30)), null);

  const many = [];
  for (let i = 0; i < 4000; i++) many.push({ d: c.dashDayShift_('2015-01-01', i), p: 1000 + i / 100 });
  const txt = c.histSeriesText_(many);
  ok('histSeriesText_: passt in eine Zelle, neuester Eintrag bleibt', txt.length <= env.run('CARD_HIST_MAX_CHARS') && txt.endsWith(many[3999].d + '=' + many[3999].p) &&
    !txt.startsWith(many[0].d), [txt.length, txt.slice(0, 30)]);
  eq('round2_ ohne -0', [c.round2_(0.1 + 0.2), Object.is(c.round2_(-0.001), 0), c.round2_(-1.005 + 0.004)], [0.3, true, -1]);
}

// ---------------------------------------------------------------------------
t.section('Kartenverlauf über mehrere Preisläufe');
const S = scenario();
{
  const { env, a, r, b, f } = S;
  const c = env.ctx;
  ok('Blatt Kartenverlauf angelegt, versteckt, Kopfzeile', env.sheet('Kartenverlauf') && env.sheet('Kartenverlauf').hidden &&
    JSON.stringify(env.values('Kartenverlauf')[0]) === JSON.stringify(env.run('CARD_HIST_HEADERS')));
  eq('Gruppen: drei neue Spalten nach „Nummer sortierbar“', env.values('Gruppen')[0].slice(22, 26),
    ['Nummer sortierbar', 'Veränderung 30 Tage (EUR)', 'Veränderung 30 Tage (%)', 'Verlauf seit']);

  runDay(env, '2026-09-01', { 'de|swsh3-025': [1.5, 3.25], 'de|base1-4': [1.5, 3] });
  eq('Tag 1: je Karte und Variante ein Eintrag (freie Karte nie)', histRows(env).map(x => [x['Karten-ID'], x['Variante'], x['Verlauf']]),
    [['base1-4', 'holo', '2026-09-01=1.5'], ['swsh3-025', 'normal', '2026-09-01=1.5'], ['swsh3-025', 'reverse', '2026-09-01=3.25']]);
  const h1 = histOf(env, 'swsh3-025', 'normal');
  ok('Tag 1: Stand gesetzt, noch keine Vergleichspreise', h1['Stand'] === '2026-09-01' && h1['Vergleich 7 Tage'] === '' && h1['Vergleich 30 Tage'] === '' &&
    h1['Vergleich 90 Tage'] === '', h1);
  const g1 = groupBy(env, a.gkey);
  ok('Tag 1: keine Veränderung in Gruppen', g1['Veränderung 30 Tage (EUR)'] === '' && g1['Veränderung 30 Tage (%)'] === '' && g1['Verlauf seit'] === '', g1);
  ok('Tag 1: searchCollection ohne chg', env.uiCall('searchCollection', 'glurak', '').groups.every(g => g.chg === null));

  runDay(env, '2026-09-02', { 'de|swsh3-025': [1.6, 3.25], 'de|base1-4': [1.5, 3] });
  const g2 = groupBy(env, a.gkey);
  ok('Tag 2: +0,10 € (+7 %) seit 01.09.2026', g2['Veränderung 30 Tage (EUR)'] === 0.1 && g2['Veränderung 30 Tage (%)'] === 0.07 && g2['Verlauf seit'] === '01.09.2026', g2);
  eq('Tag 2: reverse unverändert, kein neuer Eintrag', histOf(env, 'swsh3-025', 'reverse')['Verlauf'], '2026-09-01=3.25');
  const gr2 = groupBy(env, r.gkey);
  ok('Tag 2: reverse ±0 seit 01.09.', gr2['Veränderung 30 Tage (EUR)'] === 0 && gr2['Veränderung 30 Tage (%)'] === 0 && gr2['Verlauf seit'] === '01.09.2026', gr2);
  const gb2 = groupBy(env, b.gkey);
  ok('eigener Preis: keine Veränderung in Gruppen, Trend trotzdem im Verlauf', gb2['Veränderung 30 Tage (EUR)'] === '' && gb2['Preis (EUR)'] === 10 &&
    histOf(env, 'base1-4', 'holo')['Verlauf'] === '2026-09-01=1.5', gb2);

  // zweiter Lauf am selben Tag
  runDay(env, '2026-09-02', { 'de|swsh3-025': [1.5, 3.25], 'de|base1-4': [1.5, 3] });
  eq('zweiter Lauf am Tag 2 wieder 1,50 €: Eintrag von Tag 2 weg', histOf(env, 'swsh3-025', 'normal')['Verlauf'], '2026-09-01=1.5');
  runDay(env, '2026-09-02', { 'de|swsh3-025': [1.6, 3.25], 'de|base1-4': [1.5, 3] });
  runDay(env, '2026-09-27', { 'de|swsh3-025': [1.9, 3.25], 'de|base1-4': [1.5, 3] });
  runDay(env, '2026-10-05', { 'de|swsh3-025': [2, 3.25], 'de|base1-4': [1.5, 3] });
  const h5 = histOf(env, 'swsh3-025', 'normal');
  eq('Verlauf nach fünf Läufen', h5['Verlauf'], '2026-09-01=1.5;2026-09-02=1.6;2026-09-27=1.9;2026-10-05=2');
  eq('Vergleichspreise 7/30/90 mit Seit', [h5['Vergleich 7 Tage'], h5['Seit (7 Tage)'], h5['Vergleich 30 Tage'], h5['Seit (30 Tage)'], h5['Vergleich 90 Tage'], h5['Seit (90 Tage)']],
    [1.9, '', 1.6, '', 1.5, '2026-09-01']);
  const g5 = groupBy(env, a.gkey);
  ok('Gruppen: 30 Tage +0,40 € (+25 %), ganzer Zeitraum', g5['Veränderung 30 Tage (EUR)'] === 0.4 && g5['Veränderung 30 Tage (%)'] === 0.25 && g5['Verlauf seit'] === '', g5);
  const ui = env.uiCall('searchCollection', '', '');
  const ga = ui.groups.find(x => x.gkey === a.gkey);
  eq('searchCollection: chg für 7, 30 und 90 Tage', ga.chg, { 7: { eur: 0.1, pct: 5, since: '' }, 30: { eur: 0.4, pct: 25, since: '' }, 90: { eur: 0.5, pct: 33, since: '2026-09-01' } });
  const gbu = ui.groups.find(x => x.gkey === b.gkey);
  ok('searchCollection: eigener Preis behält chg (das UI blendet es aus), priceManual', gbu.priceManual === true && gbu.chg && gbu.chg[30].eur === 0, gbu);
  ok('searchCollection: freie Karte ohne chg', ui.groups.find(x => x.gkey === f.gkey).chg === null);

  // Verlauf bleibt für Karten, die nicht mehr in der Sammlung sind
  c.withLock_(() => c.writeCardHistory_([], '2026-10-06'));
  const h6 = histOf(env, 'swsh3-025', 'normal');
  ok('ohne Zeilen: Verlauf bleibt, Vergleich neu gerechnet', h6 && h6['Verlauf'] === h5['Verlauf'] && h6['Stand'] === '2026-10-06' && h6['Vergleich 7 Tage'] === 1.9, h6);
  ok('Kartenverlauf in der Liste der Tool-Blätter, Pokédex & Co. unverändert', c.toolSheetNames_().indexOf('Kartenverlauf') >= 0);
  ok('fehlender Kartenverlauf gilt nicht als kaputte Einrichtung', c.missingToolSheets_().indexOf('Kartenverlauf') < 0);
}

// ---------------------------------------------------------------------------
t.section('getPriceHistory');
{
  const { env, a, f } = S;
  eq('Glurak normal', env.uiCall('getPriceHistory', a.gkey),
    { series: [['2026-09-01', 1.5], ['2026-09-02', 1.6], ['2026-09-27', 1.9], ['2026-10-05', 2]], until: '2026-10-06' });
  eq('Sonderversion nutzt denselben Verlauf', env.uiCall('getPriceHistory', 'swsh3-025|normal|Snowflake').series.length, 4);
  eq('freie Karte und Unbekanntes: leer', [env.uiCall('getPriceHistory', f.gkey), env.uiCall('getPriceHistory', 'nix-1|normal|'), env.uiCall('getPriceHistory', '')],
    [{ series: [], until: '' }, { series: [], until: '' }, { series: [], until: '' }]);
  const env2 = setup();
  eq('ohne Kartenverlauf: leer', env2.uiCall('getPriceHistory', 'swsh3-025|normal|'), { series: [], until: '' });
}

// ---------------------------------------------------------------------------
t.section('Blatt Sammlung');
{
  const { env } = S;
  const view = env.sheet('Sammlung');
  eq('Kopf: Veränderung nach Wert, Preisstand am Ende', env.values('Sammlung')[4].slice(7, 16),
    ['Preis (EUR)', 'Wert (EUR)', '± 30 Tage (EUR)', '± 30 Tage (%)', 'Verlauf seit', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand']);
  eq('Formate: Euro und Prozent mit Vorzeichen', [view.getRange('J6').getNumberFormat(), view.getRange('K6').getNumberFormat()],
    [env.run('SIGNED_EUR_FORMAT'), env.run('SIGNED_PCT_FORMAT')]);
  ok('drei Regeln: grau bei 0 Exemplaren, grün, rot', view.getConditionalFormatRules().length === 3);
  ok('Suche im Blatt: Hinweis nennt den Künstler', /Künstler/.test(view.getRange('B3').getValue()), view.getRange('B3').getValue());
  const f = view.getRange('A6').getFormula();
  ok('Formel: Suche auch im Illustrator (Gruppen-Spalte 20)', /ISNUMBER\(SEARCH\(wd, INDEX\(rw, 1, 20\)\)\)/.test(f));
  ok('Formel: Spalten 24 bis 26 nach dem Wert', /CHOOSECOLS\(srt, 29\),\s+CHOOSECOLS\(srt, 24\), CHOOSECOLS\(srt, 25\), CHOOSECOLS\(srt, 26\),/.test(f), f.slice(-400));
  ok('Formel ohne Komma-Fallen in den neuen Regeln (deutsche Tabelle)', env.run('SIGNED_PCT_FORMAT').indexOf(',') < 0);
}

// ---------------------------------------------------------------------------
t.section('Künstlersuche (Seitenleiste und Web-App)');
{
  const { env, a, r, b } = S;
  const keys = res => res.groups.map(g => g.gkey).sort();
  eq('„arita“ findet beide Glurak aus Flammende Finsternis', keys(env.uiCall('searchCollection', 'arita', '')), [a.gkey, r.gkey].sort());
  eq('„Sugimori“ findet das Grundset-Glurak', keys(env.uiCall('searchCollection', 'Sugimori', '')), [b.gkey]);
  eq('Künstler und Nummer zusammen', keys(env.uiCall('searchCollection', 'arita 025', '')), [a.gkey, r.gkey].sort());
  eq('Künstler, der nicht passt', env.uiCall('searchCollection', 'arita 4', '').groups.length, 0);
  const g = env.uiCall('searchCollection', 'arita', '').groups[0];
  eq('Gruppe hat den Künstler', g.illustrator, 'Mitsuhiro Arita');
  const COL = env.run('COL');
  ok('matchWord_ prüft den Künstler', env.ctx.matchWord_(Object.assign(new Array(30).fill(''), { [COL.illustrator]: 'Atsuko Nishida' }), 'nishida'));
}

// ---------------------------------------------------------------------------
t.section('Preislauf: Kartenverlauf mit dem heutigen Tag, eigene Preise abgerufen');
{
  const env = setup();
  const a = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', qty: 1 });
  env.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', qty: 1, ownPrice: 10 });
  eq('Preisziele mit der Karte mit eigenem Preis', env.ctx.priceTargets_().map(x => x.key), ['de|base1-4', 'de|swsh3-025']);
  env.ctx.preiseJetztAktualisieren();
  eq('nach dem Preislauf: heute, Trendpreise', histRows(env).map(x => [x['Karten-ID'], x['Stand'], x['Verlauf']]),
    [['base1-4', TODAY, TODAY + '=1.5'], ['swsh3-025', TODAY, TODAY + '=1.5']]);
  env.DB['de/cards/swsh3-025'].pricing.cardmarket.trend = 1.7;
  env.ctx.preiseJetztAktualisieren();
  eq('zweiter Lauf am selben Tag: ein Eintrag mit dem neuen Preis', histOf(env, 'swsh3-025', 'normal')['Verlauf'], TODAY + '=1.7');
  ok('am ersten Tag keine Veränderung', groupBy(env, a.gkey)['Veränderung 30 Tage (EUR)'] === '');
  ok('keine verschachtelten Sperren', env.lock.nested === 0, env.lock);
  // ein Fehler beim Kartenverlauf hält den Preislauf nicht auf
  env.DB['de/cards/swsh3-025'].pricing.cardmarket.trend = 1.8;
  const orig = env.ctx.writeCardHistory_;
  env.ctx.writeCardHistory_ = () => { throw new Error('kaputt'); };
  env.ctx.preiseJetztAktualisieren();
  env.ctx.writeCardHistory_ = orig;
  ok('Fehler im Kartenverlauf: Preise trotzdem geschrieben, Gruppen neu', env.data().find(x => x.eid === a.eid).price === 1.8 &&
    groupBy(env, a.gkey)['Preis (EUR)'] === 1.8);
}

// ---------------------------------------------------------------------------
t.section('Fremdes Blatt „Kartenverlauf“, Übernahme, alte Sammlung');
{
  const env = H.createEnv();
  const own = env.ss.insertSheet('Kartenverlauf');
  own.getRange(1, 1, 2, 1).setValues([['Meine Notizen'], ['Glurak verkaufen']]);
  env.ctx.setupAll_();
  const alt = env.sheet('Kartenverlauf (alt)');
  ok('fremdes Blatt heißt jetzt „Kartenverlauf (alt)“, Inhalt bleibt', alt && alt.getRange(2, 1).getValue() === 'Glurak verkaufen');
  ok('Tool-Blatt neu angelegt', env.sheet('Kartenverlauf') && env.values('Kartenverlauf')[0][0] === 'Karten-ID');
  ok('Hinweis unten rechts', env.ss.toasts.some(x => /Kartenverlauf \(alt\)/.test(x)), env.ss.toasts);
  env.ctx.setupSheets_(env.ss, true);
  ok('zweite Einrichtung: Tool-Blatt bleibt (steht in TOOL_SHEETS)', !env.sheet('Kartenverlauf (alt 2)') && env.values('Kartenverlauf')[0][0] === 'Karten-ID');
  const c = env.ctx;
  ok('Übernahme kopiert den Kartenverlauf', c.updTakeoverSheets_().indexOf('Kartenverlauf') === 2);
  eq('Kopfzeile für alte Tabellen bekannt', c.updTakeoverHeads_()['Kartenverlauf'], env.run('CARD_HIST_HEADERS'));

  // Zusatzspalten einer alten Sammlung (13 feste Spalten) und einer neuen (16)
  const mk = (name, head) => {
    const e = H.createEnv();
    const sh = e.ss.insertSheet('Sammlung');
    sh.getRange(5, 1, 1, head.length).setValues([head]);
    return e;
  };
  const old13 = ['Bild', 'Name', 'Set', 'Nummer', 'Variante', 'Exemplare', 'Anzahl', 'Preis (EUR)', 'Wert (EUR)', 'Seltenheit', 'Kartentyp', 'Illustrator', 'Preisstand', 'Ordner'];
  const e1 = mk('alt', old13);
  eq('alte Sammlung: Zusatzspalte hinter Preisstand', e1.ctx.updOldViewExtras_(e1.ss), ['Ordner']);
  const e2 = mk('neu', env.run('VIEW_HEADERS').concat(['Fach', 'Box']));
  eq('neue Sammlung: Zusatzspalten hinter Preisstand', e2.ctx.updOldViewExtras_(e2.ss), ['Fach', 'Box']);
}

// ---------------------------------------------------------------------------
// Seitenleiste mit echtem Server (jsdom)
// ---------------------------------------------------------------------------
function evaluate(tpl, env) {
  return tpl.__content.replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, kind, expr) =>
    String(new Function('mode', 'start', 'include', 'return (' + expr + ');')(tpl.mode, tpl.start,
      name => (name === 'ImportUi' ? '<div id="paneImport" class="panel hidden"></div>' : env.ctx.include(name)))));
}

async function boot(env) {
  env.ctx.kartenErfassen();
  const tpl = env.ui.sidebars[env.ui.sidebars.length - 1].template;
  const pending = [], errors = [], log = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  const makeRun = () => {
    let okH = null, failH = null;
    const px = new Proxy({
      withSuccessHandler(fn) { okH = fn; return px; }, withFailureHandler(fn) { failH = fn; return px; }, withUserObject() { return px; }
    }, { get: (o, p) => (p in o ? o[p] : (...args) => { pending.push({ fn: String(p), args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH }); }) });
    return px;
  };
  const dom = new JSDOM(evaluate(tpl, env), {
    url: 'https://example.org/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(win) {
      win.setTimeout = fn => { fn(); return 0; }; // Entprellen sofort
      win.clearTimeout = () => {};
      win.google = { script: { get run() { return makeRun(); } } };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(res => setImmediate(res)); };
  const E = {
    win, doc, errors, log, pending, $: id => doc.getElementById(id),
    async settle() {
      await flush();
      for (let n = 0; pending.length && n < 60; n++) {
        const p = pending.shift();
        log.push(p.fn);
        let res, err = null;
        try { res = env.uiCall(p.fn, ...p.args); } catch (e) { err = e; }
        if (err) { if (p.fail) p.fail(new win.Error(err.message)); } else if (p.ok) p.ok(res === undefined ? null : res);
        await flush();
      }
    },
    idx: gkey => win.state.groups.findIndex(g => g.gkey === gkey),
    head: i => doc.getElementById('gh' + i).textContent.replace(/\s+/g, ' ')
  };
  await E.settle();
  return E;
}

(async () => {
  t.section('Seitenleiste: Künstler, Veränderung, Umschalter, Kurve');
  const { env, a, r, b, f } = S;
  // eine Karte ohne Verlauf (nach dem letzten Preislauf erfasst)
  const n = env.uiCall('addCard', { id: 'swsh3-136', lang: 'de', variant: 'base', qty: 1 });
  const E = await boot(env);
  ok('Suchfeld nennt den Künstler', /Künstler/.test(E.doc.querySelector('label[for=colQuery]').textContent) && /Arita/.test(E.$('colQuery').placeholder));
  ok('Umschalter: 30 Tage gewählt', E.$('chg30').classList.contains('on') && E.$('chg30').getAttribute('aria-pressed') === 'true' && !E.$('chg7').classList.contains('on'));
  E.win.showTab('coll');
  await E.settle();
  const ia = E.idx(a.gkey), ir = E.idx(r.gkey), ib = E.idx(b.gkey), iff = E.idx(f.gkey), inn = E.idx(n.gkey);
  ok('alle Gruppen da', [ia, ir, ib, iff, inn].every(i => i >= 0), E.win.state.groups.map(g => g.gkey));
  ok('Glurak: +0,40 € (+25 %) grün', /\+0,40\s€ \(\+25 %\)/.test(E.head(ia)) && E.$('gh' + ia).querySelector('.chg.up'), E.head(ia));
  ok('Künstler unter der Karte', /Illus\. Mitsuhiro Arita/.test(E.head(ia)), E.head(ia));
  ok('reverse: ±0,00 € (±0 %) grau', /±0,00\s€ \(±0 %\)/.test(E.head(ir)) && E.$('gh' + ir).querySelector('.chg.flat'), E.head(ir));
  ok('eigener Preis: keine Veränderung', !E.$('gh' + ib).querySelector('.chg') && /10,00\s€ manuell/.test(E.head(ib)), E.head(ib));
  ok('freie Karte und Karte ohne Verlauf: keine Veränderung', !E.$('gh' + iff).querySelector('.chg') && !E.$('gh' + inn).querySelector('.chg'));
  E.win.setChgDays(7);
  ok('7 Tage: +0,10 € (+5 %)', /\+0,10\s€ \(\+5 %\)/.test(E.head(ia)) && E.$('chg7').classList.contains('on'), E.head(ia));
  E.win.setChgDays(90);
  ok('90 Tage: +0,50 € (+33 %) seit 01.09.', /\+0,50\s€ \(\+33 %\) seit 01\.09\./.test(E.head(ia)), E.head(ia));
  ok('Zeitraum gemerkt', E.win.localStorage.getItem('pkmChgDays') === '90');
  ok('kein Serveraufruf beim Umschalten', E.pending.length === 0);

  // Kurve aufklappen
  E.win.toggleGroup(ia);
  ok('Aufklappen lädt den Verlauf', E.pending.some(p => p.fn === 'getPriceHistory' && p.args[0] === a.gkey) && /wird geladen/.test(E.$('gv' + ia).textContent));
  await E.settle();
  const box = E.$('gv' + ia);
  const svg = box.querySelector('svg');
  ok('Kurve: SVG mit Stufenlinie und Endpunkt', svg && svg.querySelector('path') && /H.*V/.test(svg.querySelector('path').getAttribute('d')) && svg.querySelectorAll('circle').length === 2, box.innerHTML.slice(0, 300));
  ok('Kurve: Endwert und Datum unten', /2,00\s€/.test(svg.textContent) && /01\.09\.2026/.test(svg.textContent) && /06\.10\.2026/.test(svg.textContent), svg.textContent);
  const plot = E.$('cvp' + ia);
  ok('Kurve: Beschreibung für Screenreader', plot.getAttribute('role') === 'img' && plot.tabIndex === 0 &&
    /jetzt 2,00\s€, tiefster 1,50\s€, höchster 2,00\s€/.test(plot.getAttribute('aria-label')), plot.getAttribute('aria-label'));
  ok('Unterzeile: seit, tiefster, höchster', /Seit 01\.09\.2026 · tiefster 1,50\s€ · höchster 2,00\s€/.test(box.textContent), box.textContent);
  ok('Liste aller Preisänderungen, neueste zuerst', box.querySelectorAll('details li').length === 4 && /05\.10\.2026: 2,00/.test(box.querySelector('details li').textContent));
  plot.dispatchEvent(new E.win.Event('focus'));
  const tip = E.$('cvt' + ia);
  ok('Fokus: Fadenkreuz und Wert am letzten Punkt', !tip.classList.contains('hidden') && /2,00\s€/.test(tip.textContent) && /Stand 06\.10\.2026/.test(tip.textContent) &&
    E.$('cvx' + ia).getAttribute('visibility') === 'visible', tip.textContent);
  plot.dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  ok('Pfeil links: vorige Preisänderung', /2,00\s€/.test(tip.textContent) && /ab 05\.10\.2026/.test(tip.textContent), tip.textContent);
  plot.dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  ok('Pos1: erster Preis', /1,50\s€/.test(tip.textContent) && /ab 01\.09\.2026/.test(tip.textContent), tip.textContent);
  plot.dispatchEvent(new E.win.Event('blur'));
  ok('Fokus weg: Fadenkreuz weg', tip.classList.contains('hidden') && E.$('cvx' + ia).getAttribute('visibility') === 'hidden');

  E.win.toggleGroup(ib);
  await E.settle();
  ok('eigener Preis: Kurve mit Hinweis auf den Trend', /eigener Preis \(10,00\s€\)/.test(E.$('gv' + ib).textContent) && E.$('gv' + ib).querySelector('svg') &&
    /Seit 01\.09\.2026 unverändert bei 1,50\s€/.test(E.$('gv' + ib).textContent), E.$('gv' + ib).textContent);
  E.win.toggleGroup(inn);
  await E.settle();
  ok('ohne Verlauf: Hinweis statt Kurve', /Noch kein Verlauf/.test(E.$('gv' + inn).textContent) && !E.$('gv' + inn).querySelector('svg'));
  const before = E.log.filter(x => x === 'getPriceHistory').length;
  E.win.toggleGroup(iff);
  await E.settle();
  ok('freie Karte: keine Kurve, kein Abruf', E.$('gv' + iff).innerHTML === '' && E.log.filter(x => x === 'getPriceHistory').length === before);
  // neu laden: Verlauf aus dem Zwischenspeicher, aufgeklappte Gruppen bleiben offen
  E.win.loadCollection();
  await E.settle();
  ok('neu geladen: kein zweiter Abruf für dieselbe Karte', E.log.filter(x => x === 'getPriceHistory').length === before &&
    E.$('gv' + E.idx(a.gkey)).querySelector('svg'));
  // Künstlersuche im Tab
  E.$('colQuery').value = 'Sugimori';
  E.win.loadCollection();
  await E.settle();
  eq('Tab Sammlung: Suche nach Künstler', E.win.state.groups.map(g => g.gkey), [b.gkey]);
  ok('keine Skriptfehler', E.errors.length === 0, E.errors);
  t.done();
})().catch(e => { console.log('FAIL Ausnahme', e && e.stack || e); process.exitCode = 1; t.done(); });
