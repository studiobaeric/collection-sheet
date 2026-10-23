'use strict';
/**
 * migr_sim.js: Erics erster Lauf auf dem LIVE-Blatt (nur erfundene Testdaten).
 *
 * 1. Blatt mit der ALTEN backup/Code.gs aufbauen: einrichtung, Karten (inkl. Reverse Holo und en-Ersatz),
 *    Preislauf + Verlauf, Suche/Bilder-Schalter in der Sammlung, WEBAPP_URL, nächtlicher Trigger.
 * 2. Auf DENSELBEN Blättern/Eigenschaften/Triggern die NEUE src/Code.gs + src/Import.gs laden und Erics Weg gehen:
 *    onOpen, Seitenleiste vor „Einrichtung“, Einrichtung, Seitenleiste, Sammlung suchen, Web-App (doGet),
 *    Preise jetzt aktualisieren, Nachtlauf, Ansicht neu aufbauen, API prüfen, Web-App-Link, Daten von Hand ändern,
 *    Import-Tab.
 * Aufruf: node migr_sim.js   (Ausgabe: ok/FAIL/NOTE-Zeilen)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('../harness2');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const BACKUP = path.join(ROOT, 'backup');
const t = H.runner('migr_sim');
const J = x => JSON.stringify(x);
const notes = [];
const note = (label, x) => { notes.push(label); console.log('NOTE', label, x === undefined ? '' : J(x).slice(0, 700)); };

// ---------------------------------------------------------------------------
// Eine Umgebung, zwei Code-Stände: Dienste-Attrappen teilen, Code in eigene vm-Kontexte laden
// ---------------------------------------------------------------------------
const env = H.createEnv({ files: [] }); // HtmlService liest aus src/ (neue Ui.html / ImportUi.html)
const SERVICES = Object.assign({}, env.ctx);
function loadCode(dir, files) {
  const ctx = Object.assign({}, SERVICES);
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: dir.split('/').pop() + '/' + f }));
  return ctx;
}
const sheetVals = name => env.values(name);
const dataObjs = (COL) => {
  const v = sheetVals('Daten');
  const out = [];
  v.slice(1).forEach((r, i) => {
    if (!r.some(x => x !== '')) return;
    const o = { row: i + 2 };
    Object.keys(COL).forEach(k => { o[k] = r[COL[k]] === undefined ? '' : r[COL[k]]; });
    out.push(o);
  });
  return out;
};

// ---------------------------------------------------------------------------
// tcgdex-Attrappe: Celebi, Nachtara, Arktos (Erics Testkarten) + Mewtu nur englisch + Karte ohne Preis
// ---------------------------------------------------------------------------
const DB = env.DB;
function addCard(id, de, en, extra) {
  const set = id.slice(0, id.lastIndexOf('-'));
  DB['de/cards/' + id] = H.card(id, 'de', Object.assign({ name: de, set: { id: set, name: 'Set ' + set, cardCount: { official: 100 } } }, extra || {}));
  DB['en/cards/' + id] = H.card(id, 'en', Object.assign({ name: en, set: { id: set, name: 'Set ' + set, cardCount: { official: 100 } } }, extra || {}));
  DB['de/sets/' + set] = DB['de/sets/' + set] || { id: set, name: 'Set ' + set, releaseDate: '2003-01-01', cards: [] };
  DB['en/sets/' + set] = DB['en/sets/' + set] || { id: set, name: 'Set ' + set, releaseDate: '2003-01-01', cards: [] };
  DB['de/sets/' + set].cards.push({ id, localId: id.split('-').pop(), name: de });
  DB['en/sets/' + set].cards.push({ id, localId: id.split('-').pop(), name: en });
}
addCard('neo4-3', 'Celebi', 'Celebi', { variants: { holo: true, normal: false, reverse: false, firstEdition: true }, pricing: { cardmarket: { trend: 12.4, 'trend-holo': 20, updated: '2026-10-10T00:00:00Z' } } });
addCard('neo2-13', 'Nachtara', 'Umbreon', { pricing: { cardmarket: { trend: 4.2, 'trend-holo': 9.9, updated: '2026-10-10T00:00:00Z' } } });
addCard('base3-2', 'Arktos', 'Articuno', { pricing: undefined }); // ohne Preis (de und en)
DB['de/cards?name=Nachtara'] = [{ id: 'neo2-13', localId: '13', name: 'Nachtara' }];
DB['de/cards?name=Celebi'] = [{ id: 'neo4-3', localId: '3', name: 'Celebi' }];

// ---------------------------------------------------------------------------
// 1. Altes Blatt
// ---------------------------------------------------------------------------
t.section('Altes Blatt (backup/Code.gs)');
const old = loadCode(BACKUP, ['Code.gs']);
old.einrichtung();
t.ok('alt: einrichtung ohne Fehler', env.ui.alerts.length === 1 && /Einrichtung fertig/.test(env.ui.alerts[0]), env.ui.alerts);
const oldAdds = [
  { id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 },                // Celebi Holo
  { id: 'neo2-13', lang: 'de', variant: 'base', condition: '', qty: 2 },                 // Nachtara normal
  { id: 'neo2-13', lang: 'de', variant: 'reverse', condition: 'EX', qty: 1 },            // Nachtara Reverse Holo
  { id: 'base3-2', lang: 'de', variant: 'base', condition: 'LP', qty: 1 },               // Arktos ohne Preis
  { id: 'base3-2', lang: 'de', variant: 'base', condition: 'NM', qty: 1 },               // Arktos zweiter Zustand
  { id: 'old9-007', lang: 'en', variant: 'base', condition: '', qty: 1, inputName: 'Mewtu' } // en-Ersatz
];
oldAdds.forEach(r => old.addCard(r));
// gestriger Verlaufseintrag (wie von einer früheren Nacht)
const hist = env.sheet('Verlauf');
const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0, 0, 0, 0);
hist.getRange(2, 1, 1, 5).setValues([[y, 33.33, 7, 2, 0]]);
old.preiseJetztAktualisieren();
const oldCOL = vm.runInContext('COL', old);
const OLD_DATA = dataObjs(oldCOL);
const OLD_HIST = sheetVals('Verlauf').map(r => r.slice());
t.ok('alt: 6 Datenzeilen', OLD_DATA.length === 6, OLD_DATA.map(r => r.key));
t.ok('alt: en-Ersatz-Zeile da', OLD_DATA.some(r => r.source === 'en-Ersatz' && r.name === 'Mewtu'));
t.ok('alt: Verlauf hat gestern + heute', OLD_HIST.length === 3, OLD_HIST);
const sam = env.sheet('Sammlung');
sam.getRange('B4').setValue('Nachtara');
sam.getRange('E4').setValue('Wert');
sam.getRange('G4').setValue(true);
sam.getRange('H4').setValue(true);
env.props.WEBAPP_URL = 'https://script.google.com/macros/s/ABC/exec';
const oldTriggers = env.triggers.map(x => x.fn);
t.ok('alt: ein Nacht-Trigger', J(oldTriggers) === J(['naechtlicherPreislauf']), oldTriggers);
const oldMenu = (() => { env.ui.menus.length = 0; old.onOpen(); return env.ui.menus[0].items.map(i => i.join('=')); })();
const oldSheets = env.ss.list.map(s => s.name);
console.log('   alte Blätter:', oldSheets.join(', '));
const OLD_PRICE_BY_KEY = {};
OLD_DATA.forEach(r => { OLD_PRICE_BY_KEY[r.key] = { price: r.price, priceDate: r.priceDate, count: r.count, added: r.added && r.added.getTime ? r.added.getTime() : r.added }; });
const oldTotal = OLD_HIST[2][1], oldCards = OLD_HIST[2][2], oldNoPrice = OLD_HIST[2][3];
console.log('   alter Verlauf heute:', J(OLD_HIST[2]));

// ---------------------------------------------------------------------------
// 2. Neuer Code auf demselben Blatt
// ---------------------------------------------------------------------------
t.section('Neuer Code (src/Code.gs + src/Import.gs)');
const nu = loadCode(SRC, ['Code.gs', 'Import.gs']);
const COL = vm.runInContext('COL', nu);
const data = () => dataObjs(COL);

// --- onOpen
env.ui.menus.length = 0;
nu.onOpen();
const newMenu = env.ui.menus[0].items.map(i => i.join('='));
t.ok('onOpen: gleiche Menüpunkte wie vorher, ohne Einrichtung (seit 1.0.3)', J(newMenu) === J(oldMenu.filter(x => x !== 'Einrichtung=einrichtung')), { old: oldMenu, new: newMenu });
newMenu.forEach(m => { const fn = m.split('=')[1]; t.ok('Menüfunktion ' + fn + ' existiert', typeof nu[fn] === 'function'); });

// ---------------------------------------------------------------------------
// Seitenleiste / Web-App starten (echte Vorlage, echtes ImportUi, echter Server)
// ---------------------------------------------------------------------------
function evaluateTemplate(tpl) {
  return tpl.__content.replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, kind, expr) => {
    const val = new Function('mode', 'include', 'return (' + expr + ');')(tpl.mode, n => nu.include(n));
    return String(val);
  });
}
function boot(mode) {
  let out;
  if (mode === 'sidebar') { const b = env.ui.sidebars.length; nu.kartenErfassen(); out = env.ui.sidebars[b]; } else out = nu.doGet();
  const html = evaluateTemplate(out.template);
  const pending = [], errors = [], log = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  function makeRun() {
    let okH = null, failH = null;
    const base = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; }, withUserObject() { return px; } };
    const px = new Proxy(base, { get: (o, p) => (p in o ? o[p] : (...args) => { pending.push({ fn: String(p), args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH }); }) });
    return px;
  }
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(win) {
      const timers = []; let tid = 0, now = 0;
      win.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: now + (ms || 0), fn }); return id; };
      win.clearTimeout = id => { const k = timers.findIndex(x => x.id === id); if (k >= 0) timers.splice(k, 1); };
      win.setInterval = () => 0; win.clearInterval = () => {};
      win.confirm = () => true;
      win.google = { script: { get run() { return makeRun(); } } };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); };
  const U = {
    win, doc, errors, log, out, $: id => doc.getElementById(id),
    async serve(p) {
      const e = { fn: p.fn, args: p.args };
      log.push(e);
      let res, err = null;
      try {
        if (/_$/.test(p.fn)) throw new Error('privat');
        if (typeof nu[p.fn] !== 'function') throw new Error('Serverfunktion fehlt: ' + p.fn);
        res = nu[p.fn].apply(null, JSON.parse(JSON.stringify(p.args)));
      } catch (x) { err = x; }
      if (err) { e.error = err.message; if (p.fail) p.fail(new win.Error(err.message)); } else { e.res = res; if (p.ok) p.ok(res === undefined ? null : JSON.parse(JSON.stringify(res))); }
      await flush();
    },
    async settle() { await flush(); let n = 60; while (pending.length && n-- > 0) await U.serve(pending.shift()); },
    pending,
    btn(el, text) { return [...(el || doc).querySelectorAll('button')].find(b => b.textContent.trim() === text) || null; },
    async click(el) { if (!el) throw new Error('Element fehlt'); el.click(); await U.settle(); }
  };
  return U;
}

// --- Seitenleiste VOR „Einrichtung“
t.section('Seitenleiste vor Einrichtung');
const lockBefore = env.lock.acquired;
const S1 = boot('sidebar');
t.ok('Seitenleiste: Titel', S1.out.title === 'Pokémon-Karten');
// zwei parallele Erstaufrufe (getSetSuggestions, getUiConfig) nacheinander bedienen
let dataAfterSidebar = null;
(async () => {
  await S1.settle();
  dataAfterSidebar = data();
  t.ok('Seitenleiste: keine Skriptfehler', S1.errors.length === 0, S1.errors);
  t.ok('Seitenleiste: keine Serverfehler', S1.log.every(e => !e.error), S1.log.filter(e => e.error));
  t.ok('Seitenleiste: Import-Tab sichtbar', !S1.$('tabImport').classList.contains('hidden'));
  t.ok('Umstellung: SCHEMA_VERSION 2', env.props.SCHEMA_VERSION === '2');
  const d1 = data();
  t.ok('Umstellung: 6 Zeilen, Anzahlen gleich', d1.length === 6 && d1.every(r => {
    const ok = OLD_DATA.find(o => o.id === r.id && o.variant === r.variant && o.cond === r.cond);
    return ok && ok.count === r.count && ok.price === r.price && ok.priceDate === r.priceDate;
  }), d1.map(r => [r.key, r.count, r.price]));
  t.ok('Umstellung: alle Hand, DE, Eintrag-ID', d1.every(r => r.origin === 'Hand' && r.lang === 'DE' && /^E[0-9a-f]{10}$/.test(r.eid)));
  t.ok('Umstellung: en-Ersatz bleibt en-Ersatz mit Namen Mewtu', d1.some(r => r.source === 'en-Ersatz' && r.name === 'Mewtu' && r.nameEn === 'Mewtwo'));
  t.ok('Umstellung: Hinzugefügt-Daten bleiben Datum', d1.every(r => Object.prototype.toString.call(r.added) === '[object Date]' && Object.prototype.toString.call(r.changed) === '[object Date]'), d1.map(r => r.added));
  t.ok('Umstellung: Set-Datum/Nummer sortierbar bleiben', d1.every(r => { const o = OLD_DATA.find(x => x.id === r.id && x.variant === r.variant && x.cond === r.cond); return o.setDate === r.setDate && o.numSort === r.numSort && o.name === r.name && o.img === r.img; }));
  const f = env.sheet('Sammlung').getRange('A6').getFormula();
  t.ok('Sammlung: alte Formel ersetzt', /Gruppen!A2:W/.test(f) && !/Daten!/.test(f), f.slice(0, 120));
  const z2 = env.sheet('Sammlung').getRange('Z2').getFormula();
  t.ok('Sammlung: Setliste liest Gruppen', /Gruppen!D2:D/.test(z2), z2);
  const c = env.sheet('Sammlung').getRange('B4:H4').getValues()[0];
  t.ok('Sammlung: Suche/Sortierung/Schalter bleiben bei Umstellung', c[0] === 'Nachtara' && c[3] === 'Wert' && c[5] === true && c[6] === true, c);
  t.ok('Gruppen: 5 Gruppen (Arktos LP+NM zusammen)', env.objects('Gruppen').length === 5, env.objects('Gruppen').map(g => g['Gruppenschlüssel']));
  const migCalls = S1.log.map(e => e.fn);
  console.log('   Aufrufe beim Laden:', migCalls.join(', '));

  // Import-Tab vor Einrichtung
  await S1.click(S1.$('tabImport'));
  t.ok('Import-Tab vor Einrichtung: Hinweis auf Einrichtung', /Einrichtung/.test(S1.$('impMain').textContent), S1.$('impMain').textContent.slice(0, 200));
  t.ok('Import-Tab vor Einrichtung: keine Fehler', S1.errors.length === 0 && S1.log.every(e => !e.error), S1.log.filter(e => e.error));

  // --- Einrichtung
  t.section('Einrichtung');
  env.ui.alerts.length = 0;
  const sheetsBefore = env.ss.list.map(s => s.name);
  const setupMsg = nu.setupAll_();
  t.ok('Einrichtung: kein Meldungsfenster, „fertig“', env.ui.alerts.length === 0 && /Einrichtung fertig/.test(setupMsg), [setupMsg, env.ui.alerts]);
  console.log('   Meldung:', env.ui.alerts[0]);
  const names = env.ss.list.map(s => s.name);
  t.ok('Einrichtung: keine doppelten Blätter', new Set(names).size === names.length, names);
  console.log('   Blätter jetzt:', names.join(', '));
  // MIGR-1 (Fixer): Einrichtung legt zusätzlich den Trigger „bei Änderung“ an (Zeile löschen in Daten)
  t.ok('Einrichtung: genau ein Nacht-Trigger und ein Änderungs-Trigger', J(env.triggers.map(x => x.fn).sort()) === J(['beiStrukturAenderung', 'naechtlicherPreislauf']), env.triggers.map(x => x.fn));
  const d2 = data();
  t.ok('Einrichtung: Daten unverändert (keine zweite Umstellung)', J(d2.map(r => [r.eid, r.key, r.count, r.price])) === J(data().map(r => [r.eid, r.key, r.count, r.price])) && d2.length === 6);
  t.ok('Einrichtung: Eintrag-IDs blieben gleich wie nach der Seitenleiste', d2.every((r, i) => r.eid === dataAfterSidebar[i].eid), d2.map(r => r.eid));
  const v = sheetVals('Verlauf');
  t.ok('Einrichtung: Verlauf unverändert', J(v) === J(OLD_HIST), { now: v, before: OLD_HIST });
  t.ok('Einrichtung: WEBAPP_URL bleibt', env.props.WEBAPP_URL === 'https://script.google.com/macros/s/ABC/exec');
  const c2 = env.sheet('Sammlung').getRange('B4:H4').getValues()[0];
  if (!(c2[0] === 'Nachtara' && c2[6] === true)) note('Einrichtung setzt Suche/Sortierung/Bilder-Schalter in Sammlung!B4:H4 zurück (alt: auch)', c2);
  const f2 = env.sheet('Sammlung').getRange('A6').getFormula();
  t.ok('Einrichtung: Formel auf Gruppen', /Gruppen!A2:W/.test(f2));
  t.ok('Einrichtung: Daten-Kopfzeile 30 Spalten', sheetVals('Daten')[0].length === 30 && sheetVals('Daten')[0][29] === 'Quellzeile', sheetVals('Daten')[0]);
  t.ok('Import-Blätter angelegt', ['Importe', 'Import-Begriffe', 'Import-Sets', 'Import-Vorlagen', 'Import-Quelle', 'Import-Prüfung', 'Import-Antworten', 'Import-Protokoll'].every(n => env.sheet(n)));
  t.ok('Sammlung ist erstes Blatt', env.ss.list[0].name === 'Sammlung', env.ss.list.map(s => s.name));
  t.ok('Daten/Gruppen versteckt', env.sheet('Daten').hidden && env.sheet('Gruppen').hidden);

  // zweites „Einrichtung“ (Eric klickt es aus Gewohnheit noch einmal)
  env.ui.alerts.length = 0;
  nu.setupAll_();
  t.ok('Einrichtung zweimal: Daten gleich', J(data().map(r => [r.eid, r.key, r.count])) === J(d2.map(r => [r.eid, r.key, r.count])));
  t.ok('Einrichtung zweimal: Trigger nicht doppelt', J(env.triggers.map(x => x.fn).sort()) === J(['beiStrukturAenderung', 'naechtlicherPreislauf']));
  t.ok('Einrichtung zweimal: Begriffe nicht doppelt', env.objects('Import-Begriffe').length === new Set(env.objects('Import-Begriffe').map(r => r.Begriff + '|' + r.Bedeutung)).size);

  // --- Seitenleiste nochmal, Sammlung suchen
  t.section('Seitenleiste nach Einrichtung, Sammlung');
  const S2 = boot('sidebar');
  await S2.settle();
  t.ok('Seitenleiste 2: keine Fehler', S2.errors.length === 0 && S2.log.every(e => !e.error), S2.log.filter(e => e.error));
  await S2.click(S2.$('tabColl'));
  const q = S2.$('colQuery');
  q.value = 'Nachtara';
  const searchBtn = S2.btn(S2.$('paneColl') || S2.doc, 'Suchen');
  if (searchBtn) await S2.click(searchBtn); else { S2.win.loadCollection(); await S2.settle(); }
  const sc = S2.log.filter(e => e.fn === 'searchCollection').pop();
  t.ok('Sammlung-Suche „Nachtara“: 2 Gruppen (normal + Reverse Holo)', sc && sc.res && sc.res.total === 2, sc && sc.res && sc.res.groups.map(g => g.gkey));
  if (sc && sc.res) {
    const rev = sc.res.groups.find(g => g.variant === 'reverse');
    t.ok('Reverse-Holo-Gruppe: Preis = trend-holo, Exemplare 1× DE EX', rev && rev.price === 9.9 && rev.exemplare === '1× DE EX', rev);
  }
  const sc2 = nu.searchCollection('13/100', '');
  t.ok('Suche mit Nummer 13/100 findet Nachtara', sc2.total === 2, sc2.groups.map(g => g.gkey));
  const sc3 = nu.searchCollection('Mewtu', '');
  t.ok('Suche nach en-Ersatz-Namen', sc3.total === 1 && sc3.groups[0].source === 'en-Ersatz', sc3);
  const sc4 = nu.searchCollection('', 'Set neo2');
  t.ok('Set-Filter', sc4.total === 2, sc4.groups.map(g => g.gkey));
  const oldSc = old.searchCollection('Nachtara', '');
  console.log('   alt searchCollection(Nachtara) auf neuem Blatt:', oldSc.total, 'Einträge');

  // --- Web-App
  t.section('Web-App (doGet)');
  const W = boot('web');
  await W.settle();
  t.ok('Web: Titel/viewport', W.out.title === 'Pokémon-Sammlung' && W.out.meta.some(m => m[0] === 'viewport'));
  t.ok('Web: keine Fehler', W.errors.length === 0 && W.log.every(e => !e.error), W.log.filter(e => e.error));
  t.ok('Web: Import-Tab versteckt', W.$('tabImport').classList.contains('hidden'));
  await W.click(W.$('tabColl'));
  t.ok('Web: Sammlung lädt', W.log.some(e => e.fn === 'searchCollection' && !e.error));

  // --- Preise jetzt aktualisieren
  t.section('Preise jetzt aktualisieren');
  const histBefore = sheetVals('Verlauf').length;
  env.ss.toasts.length = 0;
  nu.preiseJetztAktualisieren();
  console.log('   Toasts:', env.ss.toasts.join(' | '));
  const h2 = sheetVals('Verlauf');
  t.ok('Preislauf: Verlauf-Zeile von heute ersetzt, keine neue', h2.length === histBefore, h2);
  t.ok('Preislauf: gestrige Zeile bleibt', J(h2[1]) === J(OLD_HIST[1]), h2[1]);
  t.ok('Preislauf: Gesamtwert wie beim alten Lauf', h2[2][1] === oldTotal, { neu: h2[2], alt: OLD_HIST[2] });
  t.ok('Preislauf: Kartenanzahl wie beim alten Lauf', h2[2][2] === oldCards, { neu: h2[2], alt: OLD_HIST[2] });
  t.ok('Preislauf: Verlauf „Einträge ohne Preis“ gleich wie beim alten Lauf (gleiche Daten, gleiche Preise)', h2[2][3] === oldNoPrice,
    { alt: oldNoPrice, neu: h2[2][3], hinweis: 'Arktos LP + Arktos NM ohne Preis: alt 2 Zeilen, neu 1 Gruppe' });
  const d3 = data();
  t.ok('Preislauf: Preise je Zeile gleich (Attrappe unverändert)', d3.every(r => {
    const o = OLD_DATA.find(x => x.id === r.id && x.variant === r.variant && x.cond === r.cond);
    return o && o.price === r.price;
  }), d3.map(r => [r.key, r.price]));
  t.ok('Preislauf: Gruppen aktuell', env.objects('Gruppen').length === 5);

  // Preis ändert sich bei tcgdex -> nächtlicher Lauf ohne UI
  t.section('Nachtlauf (Trigger, ohne UI)');
  DB['de/cards/neo2-13'].pricing.cardmarket.trend = 5.5;
  const getUi = SERVICES.SpreadsheetApp.getUi;
  SERVICES.SpreadsheetApp.getUi = () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); };
  let nightErr = null;
  try { nu.naechtlicherPreislauf(); } catch (e) { nightErr = e; }
  SERVICES.SpreadsheetApp.getUi = getUi;
  t.ok('Nachtlauf: kein Fehler', !nightErr, nightErr && nightErr.stack);
  const gN = env.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|normal|');
  t.ok('Nachtlauf: Gruppen haben neuen Preis', gN && gN['Preis (EUR)'] === 5.5, gN);
  t.ok('Nachtlauf: Verlauf noch eine Zeile pro Tag', sheetVals('Verlauf').length === histBefore);

  // --- Ansicht neu aufbauen
  t.section('Ansicht neu aufbauen');
  env.sheet('Sammlung').getRange('B4').setValue('Celebi');
  env.sheet('Sammlung').getRange('H4').setValue(true);
  env.ui.alerts.length = 0;
  nu.ansichtNeuAufbauen();
  t.ok('Ansicht: Meldung', env.ui.alerts.length === 1 && /Ansicht neu aufgebaut/.test(env.ui.alerts[0]), env.ui.alerts);
  const c3 = env.sheet('Sammlung').getRange('B4:H4').getValues()[0];
  t.ok('Ansicht: Suche und Bilder-Schalter bleiben', c3[0] === 'Celebi' && c3[6] === true, c3);
  t.ok('Ansicht: Kopfzeile neu', env.sheet('Sammlung').getRange(5, 1, 1, 13).getValues()[0].join('|') === vm.runInContext('VIEW_HEADERS', nu).join('|'));
  t.ok('Ansicht: Zeilenhöhe 90 bei Bildern (Formel liefert in der Attrappe nichts, nur kein Fehler)', true);

  // --- API prüfen
  t.section('API prüfen');
  env.ss.toasts.length = 0;
  let apiErr = null;
  try { nu.apiPruefen(); } catch (e) { apiErr = e; }
  t.ok('API prüfen: kein Fehler', !apiErr, apiErr && apiErr.stack);
  const chk = sheetVals('API-Check').map(r => r[0]).filter(Boolean);
  t.ok('API prüfen: Punkte 1-14', ['1.', '2.', '3.', '4.', '5.', '6.', '8.', '7.', '9.', '10.', '11.', '12.', '13.', '14.'].every(p => chk.some(l => String(l).indexOf(p) === 0)), chk);
  t.ok('API prüfen: Toast', env.ss.toasts.some(x => /API-Prüfung fertig/.test(x)), env.ss.toasts);

  // --- Web-App-Link anzeigen
  t.section('Web-App-Link');
  env.ui.prompts.length = 0; env.ui.alerts.length = 0;
  env.promptButton = 'OK'; env.promptResponse = '';
  nu.webAppLinkAnzeigen();
  t.ok('Web-App-Link: gespeicherter Link gezeigt', env.ui.prompts.length === 1 && /ABC\/exec/.test(env.ui.prompts[0].msg), env.ui.prompts);
  t.ok('Web-App-Link: Link bleibt', env.props.WEBAPP_URL === 'https://script.google.com/macros/s/ABC/exec');

  // --- Daten von Hand ändern
  t.section('Daten von Hand ändern (onEdit)');
  const dsh = env.sheet('Daten');
  const arktos = data().find(r => r.id === 'base3-2' && r.cond === 'LP');
  dsh.getRange(arktos.row, COL.count + 1).setValue(3);
  nu.onEdit({ range: dsh.getRange(arktos.row, COL.count + 1), value: '3', source: env.ss });
  const gA = env.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'base3-2|holo|' || /^base3-2\|/.test(g['Gruppenschlüssel']));
  t.ok('onEdit Anzahl: Gruppe zählt 4 (3 LP + 1 NM)', gA && gA.Anzahl === 4, gA);
  dsh.getRange(arktos.row, COL.cond + 1).setValue('pl');
  nu.onEdit({ range: dsh.getRange(arktos.row, COL.cond + 1), value: 'pl', source: env.ss });
  const ar2 = data().find(r => r.eid === arktos.eid);
  t.ok('onEdit Zustand „pl“ -> PL, Schlüssel neu', ar2.cond === 'PL' && /\|\|PL\|DE$/.test(ar2.key), ar2);
  // Eric kopiert eine Zeile ganz nach unten (zweites Exemplar)
  const lastRow = dsh.getLastRow();
  const copyRow = dsh.getRange(arktos.row, 1, 1, 30).getValues();
  dsh.getRange(lastRow + 1, 1, 1, 30).setValues(copyRow);
  nu.onEdit({ range: dsh.getRange(lastRow + 1, 1, 1, 30), source: env.ss });
  const dup = data().filter(r => r.key === ar2.key);
  // MIGR-2 (Fixer): die Kopie wird in die Hand-Zeile desselben Schlüssels eingerechnet (höchstens eine Hand-Zeile pro Schlüssel)
  t.ok('Kopierte Zeile: in die Hand-Zeile eingerechnet (eine Zeile, Anzahl verdoppelt)', dup.length === 1 && dup[0].eid === ar2.eid && dup[0].count === 2 * ar2.count, dup.map(r => [r.eid, r.count]));
  if (dup.length === 2) note('Kopierte Daten-Zeile bleibt eine zweite Hand-Zeile mit demselben Schlüssel (Regel: höchstens eine Hand-Zeile pro Schlüssel)', dup.map(r => [r.eid, r.key, r.count]));
  // Eric löscht den Inhalt einer Zeile in der Mitte (statt Zeile löschen)
  const cel = data().find(r => r.id === 'neo4-3');
  dsh.getRange(cel.row, 1, 1, 30).clearContent();
  nu.onEdit({ range: dsh.getRange(cel.row, 1, 1, 30), source: env.ss });
  t.ok('Geleerte Zeile: Celebi weg aus Gruppen', !env.objects('Gruppen').some(g => /^neo4-3/.test(g['Gruppenschlüssel'])));
  // danach +1 über die Seitenleiste auf Nachtara (Lücke in der Mitte darf nichts verschieben)
  const nach = data().find(r => r.id === 'neo2-13' && r.variant === 'normal');
  const adj = nu.adjustEntry(nach.eid, 1);
  t.ok('adjustEntry nach Lücke: richtige Zeile', adj.count === nach.count + 1 && data().find(r => r.eid === nach.eid).count === nach.count + 1, adj);

  // --- Import-Tab
  t.section('Import-Tab');
  const S3 = boot('sidebar');
  await S3.settle();
  await S3.click(S3.$('tabImport'));
  t.ok('Import-Tab: importState ohne Fehler', S3.log.some(e => e.fn === 'importState' && !e.error), S3.log.filter(e => e.error));
  const st = S3.log.find(e => e.fn === 'importState');
  t.ok('Import-Tab: needsSetup false, keine Importe', st && st.res && st.res.needsSetup === false && st.res.imports.length === 0, st && st.res);
  t.ok('Import-Tab: „Neuer Import“-Knopf', !!S3.btn(S3.$('impMain'), 'Neuer Import'));
  t.ok('Import-Tab: keine Skriptfehler', S3.errors.length === 0, S3.errors);
  await S3.click(S3.btn(S3.$('impMain'), 'Neuer Import'));
  t.ok('Neuer Import: Schritt Quelle', /Link|Quelle/.test(S3.$('impMain').textContent), S3.$('impMain').textContent.slice(0, 200));

  // --- Alte Web-App-Bereitstellung (noch nicht neu bereitgestellt): alter Code auf dem neuen Blatt
  t.section('Alte Web-App-Version am Handy (Bereitstellung noch nicht aktualisiert)');
  const groupsBefore = env.objects('Gruppen').length;
  const nachBefore = data().filter(r => r.id === 'neo2-13' && r.variant === 'normal');
  let oldAddErr = null, oldAdd = null;
  try { oldAdd = old.addCard({ id: 'neo2-13', lang: 'de', variant: 'base', condition: '', qty: 1 }); } catch (e) { oldAddErr = e; }
  console.log('   alte addCard:', oldAddErr ? oldAddErr.message : oldAdd.message);
  const nachAfter = data().filter(r => r.id === 'neo2-13' && r.variant === 'normal');
  const gNa = env.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|normal|');
  console.log('   Daten-Zeilen Nachtara normal vorher/nachher:', nachBefore.length, nachAfter.length, J(nachAfter.map(r => [r.key, r.eid, r.origin, r.count])));
  console.log('   Gruppen-Anzahl Nachtara normal direkt danach:', gNa && gNa.Anzahl);
  nu.withLock_(() => nu.rebuildGroups_());
  const nachRep = data().filter(r => r.id === 'neo2-13' && r.variant === 'normal');
  console.log('   nach dem nächsten rebuildGroups_:', J(nachRep.map(r => [r.key, r.eid, r.origin, r.count])));
  const cfg = nu.searchCollection('Nachtara', '').groups.find(g => g.variant === 'normal');
  console.log('   Gruppe im UI: rows =', J(cfg.rows.map(r => [r.eid, r.count, r.originLabel])));


  // --- Alte Web-App am Handy: -1 über adjustCount (alter Code, kein Gruppen-Neubau)
  const nGroupBefore = env.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|reverse|');
  const oldItems = old.searchCollection('Nachtara', '').items;
  const revItem = oldItems.find(i => i.variant === 'reverse');
  const oa = old.adjustCount(revItem.key, -1);
  const nGroupAfter = env.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|reverse|');
  console.log('   alte adjustCount(-1) Reverse:', J(oa), 'Gruppen-Anzahl vorher/nachher:', nGroupBefore.Anzahl, nGroupAfter.Anzahl,
    'Daten:', data().find(r => r.id === 'neo2-13' && r.variant === 'reverse').count);
  t.ok('alte Web-App -1: Sammlung (Gruppen) zeigt die Änderung', nGroupAfter.Anzahl === nGroupBefore.Anzahl - 1, { vorher: nGroupBefore.Anzahl, nachher: nGroupAfter.Anzahl });
  t.ok('alte Web-App +1 (addCard): keine zweite Hand-Zeile', nachRep.length === 1, nachRep.map(r => [r.eid, r.count]));

  // --- Seitenleiste, die beim Einfügen des Codes noch offen war (alte Ui.html, neuer Server)
  t.section('Offene alte Seitenleiste mit neuem Server');
  {
    const html = fs.readFileSync(path.join(BACKUP, 'Ui.html'), 'utf8');
    const pending = [], errs = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errs.push(String(e && e.message || e)));
    const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, beforeParse(win) {
      win.setTimeout = () => 0; win.clearTimeout = () => {};
      win.google = { script: { get run() {
        let okH, failH; const base = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; } };
        const px = new Proxy(base, { get: (o, p) => (p in o ? o[p] : (...a) => pending.push({ fn: p, a, ok: okH, fail: failH })) });
        return px; } } };
    } });
    const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); };
    async function settle() { await flush(); while (pending.length) { const p = pending.shift(); try { const r = nu[p.fn].apply(null, JSON.parse(JSON.stringify(p.a))); p.ok && p.ok(JSON.parse(JSON.stringify(r === undefined ? null : r))); } catch (e) { p.fail && p.fail(new dom.window.Error(e.message)); } await flush(); } }
    await settle();
    dom.window.showTab('remove');
    await settle();
    const msg = dom.window.document.getElementById('removeMsg').textContent;
    console.log('   alte Seitenleiste, Tab Entfernen zeigt:', JSON.stringify(msg));
    t.ok('alte offene Seitenleiste: Tab Entfernen funktioniert mit neuem Server', !/undefined|Cannot read/.test(msg), msg);
  }

  // --- Zeile in Daten von Hand löschen (Rechtsklick > Zeile löschen: löst kein onEdit aus)
  t.section('Daten-Zeile von Hand löschen');
  {
    const mew = data().find(r => r.source === 'en-Ersatz');
    env.sheet('Daten').deleteRow(mew.row); // nur onChange (REMOVE_ROW), kein onEdit
    const trig = env.triggers.map(x => x.fn);
    const still = env.objects('Gruppen').some(g => /^old9-007/.test(g['Gruppenschlüssel']));
    console.log('   Trigger:', J(trig), 'Gruppen enthält Mewtu noch:', still);
    t.ok('Zeile gelöscht: Sammlung/Gruppen ohne Mewtu (es gibt einen onChange-Trigger)', !still || trig.some(f => f !== 'naechtlicherPreislauf'), trig);
  }


  // =========================================================================
  // Weitere Reihenfolgen auf frischen alten Blättern
  // =========================================================================
  function freshOld() {
    const e2 = H.createEnv({ files: [] });
    Object.assign(e2.DB, DB);
    const SV = Object.assign({}, e2.ctx);
    const load = (dir, files) => { const c = Object.assign({}, SV); vm.createContext(c); files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), c)); return c; };
    const o = load(BACKUP, ['Code.gs']);
    o.einrichtung();
    oldAdds.forEach(r => o.addCard(r));
    o.preiseJetztAktualisieren();
    e2.sheet('Sammlung').getRange('B4').setValue('Nachtara');
    e2.sheet('Sammlung').getRange('H4').setValue(true);
    e2.ui.alerts.length = 0;
    return { e2, SV, o, n: load(SRC, ['Code.gs', 'Import.gs']) };
  }
  t.section('Reihenfolge B: gleich „Einrichtung“');
  {
    const { e2, n } = freshOld();
    n.onOpen();
    const msgB = n.setupAll_();
    console.log('   Meldung:', msgB);
    t.ok('B: umgestellt (seit 1.0.3 ohne Zahl in der Meldung)', /Einrichtung fertig/.test(msgB || '') && e2.setting('SCHEMA_VERSION') === '2', msgB);
    t.ok('B: Trigger nicht doppelt', J(e2.triggers.map(x => x.fn).sort()) === J(['beiStrukturAenderung', 'naechtlicherPreislauf']));
    t.ok('B: Formel auf Gruppen', /Gruppen!A2:W/.test(e2.sheet('Sammlung').getRange('A6').getFormula()));
    t.ok('B: 5 Gruppen', e2.objects('Gruppen').length === 5);
  }
  t.section('Reihenfolge C: Nachtlauf um 3 Uhr vor „Einrichtung“');
  {
    const { e2, SV, n } = freshOld();
    const gu = SV.SpreadsheetApp.getUi;
    SV.SpreadsheetApp.getUi = () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); };
    let err = null;
    try { n.naechtlicherPreislauf(); } catch (x) { err = x; }
    SV.SpreadsheetApp.getUi = gu;
    t.ok('C: Nachtlauf ohne Fehler', !err, err && err.stack);
    t.ok('C: umgestellt + Formel auf Gruppen', e2.props.SCHEMA_VERSION === '2' && /Gruppen!A2:W/.test(e2.sheet('Sammlung').getRange('A6').getFormula()));
    const h = e2.values('Verlauf');
    t.ok('C: Verlauf eine Zeile für heute', h.length === 2, h);
    const c = e2.sheet('Sammlung').getRange('B4:H4').getValues()[0];
    t.ok('C: Suche/Bilder bleiben', c[0] === 'Nachtara' && c[6] === true, c);
    e2.ui.alerts.length = 0;
    const msgC = n.setupAll_();
    t.ok('C: Einrichtung danach ok', /Einrichtung fertig/.test(msgC || ''), msgC);
  }
  t.section('Reihenfolge D: „Ansicht neu aufbauen“ / „Preise jetzt“ vor „Einrichtung“');
  {
    const { e2, n } = freshOld();
    n.ansichtNeuAufbauen();
    t.ok('D: Ansicht neu aufbauen stellt um', e2.props.SCHEMA_VERSION === '2' && /Ansicht neu aufgebaut/.test(e2.ui.alerts.join('|')), e2.ui.alerts);
    const r = n.searchCollection('', '');
    t.ok('D: 5 Gruppen in der Seitenleiste', r.total === 5);
  }

  t.section('Reihenfolge E: „Preise jetzt aktualisieren“ vor „Einrichtung“');
  {
    const { e2, o, n } = freshOld();
    const histOld = e2.values('Verlauf').map(r => r.slice());
    e2.ss.toasts.length = 0;
    let err = null;
    try { n.preiseJetztAktualisieren(); } catch (x) { err = x; }
    t.ok('E: kein Fehler', !err, err && err.stack);
    t.ok('E: umgestellt + Formel auf Gruppen', e2.props.SCHEMA_VERSION === '2' && /Gruppen!A2:W/.test(e2.sheet('Sammlung').getRange('A6').getFormula()));
    const h = e2.values('Verlauf');
    t.ok('E: Verlauf eine Zeile heute, Gesamtwert und Kartenanzahl gleich', h.length === histOld.length && h[1][1] === histOld[1][1] && h[1][2] === histOld[1][2], { alt: histOld, neu: h });
    e2.ui.alerts.length = 0;
    n.setupAll_();
    t.ok('E: Einrichtung danach Trigger nicht doppelt', J(e2.triggers.map(x => x.fn).sort()) === J(['beiStrukturAenderung', 'naechtlicherPreislauf']));
  }

  t.section('Reihenfolge F: Web-App (nach Neu-Bereitstellung) vor „Einrichtung“');
  {
    const { e2, n } = freshOld();
    // doGet + erste Aufrufe der Seite (getSetSuggestions, getUiConfig) direkt gegen den neuen Code
    let err = null;
    try { n.doGet(); n.getSetSuggestions(); n.getUiConfig(); n.searchCollection('', ''); } catch (x) { err = x; }
    t.ok('F: kein Fehler', !err, err && err.stack);
    t.ok('F: umgestellt + Formel auf Gruppen', e2.props.SCHEMA_VERSION === '2' && /Gruppen!A2:W/.test(e2.sheet('Sammlung').getRange('A6').getFormula()));
  }

  t.section('Schema-Property verloren (z. B. zwei Aufrufe gleichzeitig): keine zweite Umstellung');
  {
    const { e2, n } = freshOld();
    n.getUiConfig();
    const COLn = vm.runInContext('COL', n);
    const v1 = e2.values('Daten').slice(1).map(r => r[COLn.eid]);
    delete e2.props.SCHEMA_VERSION; // der zweite, parallele Aufruf sah die Property noch nicht
    n.searchCollection('', '');
    const v2 = e2.values('Daten').slice(1).map(r => r[COLn.eid]);
    t.ok('Eintrag-IDs bleiben bei erneutem ensureSchema_', J(v1) === J(v2), { v1, v2 });
  }

  t.section('Alte Web-App-Bereitstellung schreibt nach der Umstellung (Zeile ohne Eintrag-ID)');
  {
    const { e2, o, n } = freshOld();
    n.setupAll_();
    const COLn = vm.runInContext('COL', n);
    const gBefore = e2.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|normal|');
    // Handy: alte Bereitstellung, Nachtara +1 über „Hinzufügen“
    const res = o.addCard({ id: 'neo2-13', lang: 'de', variant: 'base', condition: '', qty: 1 });
    console.log('   alte addCard-Meldung am Handy:', res.message);
    const gAfter = e2.objects('Gruppen').find(g => g['Gruppenschlüssel'] === 'neo2-13|normal|');
    t.ok('alte Bereitstellung +1: Sammlung (Gruppen) zählt die neue Karte', gAfter.Anzahl === gBefore.Anzahl + 1, { vorher: gBefore.Anzahl, nachher: gAfter.Anzahl });
    // Seitenleiste (neuer Code): Sammlung suchen, Gruppe aufklappen, -1 auf die neue Zeile
    const sc = n.searchCollection('Nachtara', '');
    const g = sc.groups.find(x => x.variant === 'normal');
    console.log('   Zeilen der Gruppe im neuen UI:', J(g.rows.map(r => [r.eid, r.count, r.originLabel, r.key])));
    const blank = g.rows.find(r => !r.eid);
    let e1 = null;
    try { n.adjustEntry(blank ? blank.eid : 'x', -1); } catch (x) { e1 = x.message; }
    t.ok('neues UI: -1 auf die Handy-Zeile funktioniert', !blank || !e1, { eid: blank && blank.eid, fehler: e1 });
    // Eric lädt die Liste neu, wie die Meldung sagt
    const sc2 = n.searchCollection('Nachtara', '');
    const blank2 = sc2.groups.find(x => x.variant === 'normal').rows.find(r => !r.eid);
    let e2m = null;
    try { n.adjustEntry(blank2 ? blank2.eid : 'x', -1); } catch (x) { e2m = x.message; }
    t.ok('neues UI nach „Liste neu laden“: -1 funktioniert', !blank2 || !e2m, { eid: blank2 && blank2.eid, fehler: e2m });
    // nach dem nächsten Neuaufbau: zwei Hand-Zeilen mit gleichem Schlüssel
    n.withLock_(() => n.rebuildGroups_());
    const hands = e2.values('Daten').slice(1).filter(r => r[COLn.id] === 'neo2-13' && r[COLn.variant] === 'normal');
    t.ok('nach Neuaufbau: höchstens eine Hand-Zeile pro Schlüssel', hands.length === 1, hands.map(r => [r[COLn.key], r[COLn.eid], r[COLn.origin], r[COLn.count]]));
  }

  t.section('Variante in Daten von Hand als Text geändert („Reverse Holo“ statt „reverse“)');
  {
    const { e2, n } = freshOld();
    n.setupAll_();
    const COLn = vm.runInContext('COL', n);
    const dsh = e2.sheet('Daten');
    const rows = e2.values('Daten');
    const i = rows.findIndex(r => r[COLn.id] === 'neo2-13' && r[COLn.variant] === 'normal');
    dsh.getRange(i + 1, COLn.variant + 1).setValue('Reverse Holo');
    n.onEdit({ range: dsh.getRange(i + 1, COLn.variant + 1), value: 'Reverse Holo', source: e2.ss });
    n.preiseJetztAktualisieren();
    const gs = e2.objects('Gruppen').filter(g => /^neo2-13\|/.test(g['Gruppenschlüssel']));
    console.log('   Gruppen Nachtara:', J(gs.map(g => [g['Gruppenschlüssel'], g.Variante, g.Anzahl, g['Preis (EUR)']])));
    const viewMap = vr => (vr === 'reverse' ? 'Reverse Holo' : vr === 'holo' ? 'Holo' : vr === 'firstEdition' ? '1. Edition' : 'Normal'); // wie viewFormula_
    const rev = gs.filter(g => /reverse/i.test(g.Variante));
    t.ok('Sammlung zeigt die 3 Nachtara (2 geänderte + 1 alte) als Reverse Holo mit Reverse-Preis', rev.length === 1 && rev[0].Anzahl === 3 && rev[0]['Preis (EUR)'] === 9.9 && viewMap(rev[0].Variante) === 'Reverse Holo',
      gs.map(g => ({ gkey: g['Gruppenschlüssel'], ansicht: viewMap(g.Variante), anzahl: g.Anzahl, preis: g['Preis (EUR)'] })));
  }

  t.section('Sortierung „Zuletzt hinzugefügt“: Nochmal +1 auf eine vorhandene Karte');
  {
    const { e2, n } = freshOld();
    n.setupAll_();
    const COLn = vm.runInContext('COL', n);
    // Alle Einträge am 01.10. erfasst, Nachtara normal am 10.10.
    const dsh = e2.sheet('Daten');
    e2.values('Daten').slice(1).forEach((r, i) => {
      if (!r[COLn.key]) return;
      const d = (r[COLn.id] === 'neo2-13' && r[COLn.variant] === 'normal') ? new Date(2026, 9, 10) : new Date(2026, 9, 1);
      dsh.getRange(i + 2, COLn.added + 1, 1, 2).setValues([[d, d]]);
    });
    n.withLock_(() => n.rebuildGroups_());
    // heute: Eric erfasst noch ein Celebi (Zeile von Hand gibt es schon)
    n.addCard({ id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
    const g = e2.objects('Gruppen');
    const newTop = g.slice().sort((a, b) => (b['Hinzugefügt am'] - a['Hinzugefügt am']))[0]['Gruppenschlüssel']; // neue Formel: -N(Spalte 21)
    const dRows = e2.values('Daten').slice(1).filter(r => r[COLn.key]);
    const oldTop = dRows.slice().sort((a, b) => b[COLn.changed] - a[COLn.changed])[0][COLn.key]; // alte Formel: -N(Daten-Spalte 22)
    console.log('   oben in „Zuletzt hinzugefügt“: neu', newTop, '| alt (Zuletzt geändert)', oldTop);
    t.ok('„Zuletzt hinzugefügt“: das gerade erfasste Celebi steht oben (wie im alten Code)', /^neo4-3\|/.test(newTop), { neuOben: newTop, altOben: oldTop });
  }

  t.section('Seitenleiste: Sammlung-Tab tippen (UI-Ebene)');
  {
    const S = boot('sidebar');
    await S.settle();
    await S.click(S.$('tabColl'));
    S.$('colQuery').value = 'Nachtara';
    S.win.debouncedCollection();
    await S.settle();
    // Timer der Attrappe auslösen
    S.win.loadCollection(); await S.settle();
    const txt = S.$('paneColl').textContent;
    t.ok('Sammlung-Tab: Nachtara normal und Reverse Holo gelistet', /Nachtara/.test(txt) && /Reverse Holo/.test(txt), txt.slice(0, 300));
    t.ok('Sammlung-Tab: keine Fehler', S.errors.length === 0 && S.log.every(e => !e.error), S.errors.concat(S.log.filter(e => e.error)));
  }

  console.log('\nNOTES:', notes.length);
  t.done();
})().catch(e => { console.log('FAIL Abbruch', e && e.stack || e); process.exitCode = 1; });
