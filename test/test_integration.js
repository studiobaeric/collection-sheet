'use strict';
/**
 * Integrationstest: echte Code.gs (harness2.js) + echte Ui.html (jsdom) zusammen.
 *
 * - Ui.html wird über kartenErfassen() / doGet() als Vorlage geholt und mit den echten
 *   Scriptlets ausgewertet (mode, include('ImportUi') -> Platzhalter).
 * - google.script.run ruft die ECHTEN Serverfunktionen im vm-Kontext asynchron auf.
 *   Argumente und Ergebnisse laufen durch JSON wie bei Apps Script; ein Date im Ergebnis
 *   wird (wie bei Apps Script) zu null und zählt als Fehler, undefined-Felder ebenso.
 * - Nach jedem Schritt: Blätter Daten, Gruppen, Import-Protokoll prüfen und die Liste im UI
 *   mit einer frischen getCollection-Antwort vergleichen (auch die Such- und Sortierwerte k).
 *
 * Aufruf: node test_integration.js   (IMPORTUI=1 bindet das echte src/ImportUi.html statt des Platzhalters ein)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness2');

const t = H.runner('test_integration');
const J = x => JSON.stringify(x);
const noRid = o => { const c = Object.assign({}, o); delete c.rid; return c; };
const SRC = path.join(__dirname, '..', 'src');
const FILES = ['Code.gs', 'Import.gs', 'Update.gs']; // ohne Import.gs oder Update.gs läuft das Tool nicht (#36 B2)
const REAL_IMPORTUI = !!process.env.IMPORTUI;
const TODAY = H.formatDate(new Date(), '', 'yyyy-MM-dd');
const TODAY_DMY = H.formatDate(new Date(), '', 'dd.MM.yyyy');
const IMPORT_STUB = '<div id="paneImport" class="panel hidden">IMPORT-STUB</div>' +
  '<script>var impFileVersion = \'' + /var UI_FILE_VERSION = '([^']*)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'Ui.html'), 'utf8'))[1] +
  '\'; var impInitCalls = 0; function impInit() { impInitCalls++; }</script>';

// ---------------------------------------------------------------------------
// Vorlage auswerten wie HtmlService (nur druckende Scriptlets kommen vor)
// ---------------------------------------------------------------------------
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function evaluateTemplate(env, tpl, includeImpl) {
  const content = tpl.__content;
  const seen = [];
  const html = content.replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, kind, expr) => {
    seen.push(m);
    if (!kind) throw new Error('Scriptlet ohne Ausgabe wird hier nicht unterstützt: ' + m);
    // Vorlagen-Eigenschaften (mode, start) + globale Serverfunktionen (include)
    const val = new Function('mode', 'start', 'include', 'return (' + expr + ');')(tpl.mode, tpl.start, includeImpl);
    return kind === '!=' ? String(val) : escHtml(val);
  });
  return { html, scriptlets: seen };
}

// ---------------------------------------------------------------------------
// Ergebnisse prüfen wie google.script.run
// ---------------------------------------------------------------------------
function leaks(x, where, out) {
  out = out || [];
  if (x instanceof Date || Object.prototype.toString.call(x) === '[object Date]') out.push(where + ': Date');
  else if (typeof x === 'function') out.push(where + ': Funktion');
  else if (typeof x === 'number' && !isFinite(x)) out.push(where + ': ' + x);
  else if (Array.isArray(x)) x.forEach((v, i) => leaks(v, where + '[' + i + ']', out));
  else if (x && typeof x === 'object') {
    Object.keys(x).forEach(k => {
      if (x[k] === undefined) out.push(where + '.' + k + ': undefined');
      else leaks(x[k], where + '.' + k, out);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seite starten: echte Vorlage + echter Server
// ---------------------------------------------------------------------------
function boot(env, mode) {
  let tpl;
  if (mode === 'sidebar') {
    const before = env.ui.sidebars.length;
    env.ctx.kartenErfassen();
    const out = env.ui.sidebars[before];
    t.ok('kartenErfassen: Sidebar mit Titel „Pokémon-Karten“', out && out.title === 'Pokémon-Karten', out && out.title);
    tpl = out.template;
  } else {
    const out = env.ctx.doGet();
    t.ok('doGet: Titel und viewport', out.title === 'Pokémon-Sammlung' && out.meta.some(m => m[0] === 'viewport'), out.meta);
    tpl = out.template;
  }
  t.ok(mode + ': Vorlage Ui mit mode=' + mode, tpl && tpl.__file === 'Ui' && tpl.mode === mode, tpl && tpl.mode);
  const includeCalls = [];
  const includeImpl = name => {
    includeCalls.push(name);
    const real = env.ctx.include(name); // echte Funktion: '' solange ImportUi.html fehlt
    if (typeof real !== 'string') throw new Error('include liefert keinen Text');
    return name === 'ImportUi' && !(REAL_IMPORTUI && real) ? IMPORT_STUB : real;
  };
  const ev = evaluateTemplate(env, tpl, includeImpl);
  t.ok(mode + ': genau drei Scriptlets ausgewertet (mode, start, include)', ev.scriptlets.length === 3, ev.scriptlets);
  t.ok(mode + ': START ist leer', /var START = '';/.test(ev.html));
  // die Handy-Seite hat keinen Import-Teil (#36 A3)
  t.ok(mode + ': include(ImportUi) ' + (mode === 'sidebar' ? 'aufgerufen' : 'nicht aufgerufen'), J(includeCalls) === J(mode === 'sidebar' ? ['ImportUi'] : []), includeCalls);
  t.ok(mode + ': kein "<?" mehr im fertigen HTML', ev.html.indexOf('<?') < 0);

  const pending = [];
  const errors = [];
  const callLog = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', e => errors.push(String(e)));
  function makeRun() {
    let okH = null, failH = null;
    const base = {
      withSuccessHandler(f) { okH = f; return px; },
      withFailureHandler(f) { failH = f; return px; },
      withUserObject() { return px; }
    };
    const px = new Proxy(base, {
      get: (o, p) => (p in o ? o[p] : (...args) => {
        pending.push({ fn: String(p), args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH });
      })
    });
    return px;
  }
  const dom = new JSDOM(ev.html, {
    runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(win) {
      const timers = []; let tid = 0, now = 0;
      win.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: now + (ms || 0), fn }); return id; };
      win.clearTimeout = id => { const k = timers.findIndex(x => x.id === id); if (k >= 0) timers.splice(k, 1); };
      win.__advance = ms => {
        now += ms;
        for (;;) {
          const due = timers.filter(x => x.at <= now).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          timers.splice(timers.indexOf(due), 1);
          due.fn();
        }
      };
      win.google = { script: { get run() { return makeRun(); } } };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); };

  const E = {
    env, win, doc, pending, errors, callLog, mode,
    $: id => doc.getElementById(id),
    /** Einen offenen Aufruf an den echten Server geben. */
    async serve(p) {
      callLog.push({ fn: p.fn, args: p.args });
      let res, err = null;
      try {
        if (/_$/.test(p.fn)) throw new Error(p.fn + ' ist privat');
        if (typeof env.ctx[p.fn] !== 'function') throw new Error('Serverfunktion fehlt: ' + p.fn);
        res = env.ctx[p.fn].apply(null, JSON.parse(JSON.stringify(p.args)));
      } catch (e) { err = e; }
      if (err) {
        callLog[callLog.length - 1].error = err.message;
        if (p.fail) p.fail(new win.Error(err.message));
      } else {
        const l = leaks(res, p.fn);
        t.ok('Antwort von ' + p.fn + ' ist reines JSON', l.length === 0, l.slice(0, 5));
        const plain = l.some(x => /Date|Funktion/.test(x)) ? null : (res === undefined ? null : JSON.parse(JSON.stringify(res)));
        callLog[callLog.length - 1].res = plain;
        if (p.ok) p.ok(plain);
      }
      await flush();
    },
    /** Alle offenen (und dabei neu entstehenden) Aufrufe abarbeiten. */
    async settle(max) {
      max = max || 50;
      await flush();
      while (pending.length && max-- > 0) await E.serve(pending.shift());
      if (pending.length) throw new Error('settle: zu viele Aufrufe');
    },
    calls: fn => callLog.filter(c => c.fn === fn),
    lastCall: fn => { const l = callLog.filter(c => c.fn === fn); return l[l.length - 1] || null; },
    btn(el, text) { return [...(el || doc).querySelectorAll('button')].find(b => b.textContent.trim() === text) || null; },
    btns(el, re) { return [...(el || doc).querySelectorAll('button')].filter(b => re.test(b.textContent.trim())); },
    click(el) { if (!el) throw new Error('Element fehlt'); el.click(); },
    type(el, v) { if (!el) throw new Error('Feld fehlt'); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    pick(el, v) { if (!el) throw new Error('Auswahl fehlt'); el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); },
    gIdx(gkey) { return win.state.groups.findIndex(g => g.gkey === gkey); },
    group(gkey) { return win.state.groups.find(g => g.gkey === gkey) || null; },
    expand(i) { E.click(E.$('gh' + i).querySelector('.info')); },
    async clickSettle(el) { E.click(el); await E.settle(); },
    /** Den ersten offenen Aufruf dieser Funktion bedienen (Reihenfolge selbst bestimmen). */
    async serveFn(fn) {
      const k = pending.findIndex(p => p.fn === fn);
      if (k < 0) throw new Error('kein offener Aufruf ' + fn + ' (offen: ' + pending.map(p => p.fn).join(',') + ')');
      const p = pending.splice(k, 1)[0];
      await E.serve(p);
    }
  };
  return E;
}

// ---------------------------------------------------------------------------
// Prüfungen der Blätter
// ---------------------------------------------------------------------------
function dataRows(env) {
  return env.data();
}

function checkSheets(env, label) {
  const COL = env.run('COL');
  const raw = env.run('readData_(sheet_(SHEETS.data))').filter(r => env.ctx.isDataRow_(r));
  const eids = raw.map(r => String(r[COL.eid]));
  t.ok(label + ': Eintrag-IDs eindeutig und gesetzt', eids.every(e => /^E[0-9a-f]{10}$/.test(e)) && new Set(eids).size === eids.length, eids);
  const badKey = raw.filter(r => String(r[COL.key]) !== env.ctx.entryKey_(r));
  t.ok(label + ': Schlüssel passen zu den Feldern', badKey.length === 0, badKey.map(r => [r[COL.key], env.ctx.entryKey_(r)]));
  const hand = {};
  let dupHand = [];
  raw.forEach(r => {
    if (!env.ctx.isHandOrigin_(r[COL.origin])) return;
    const k = env.ctx.entryKey_(r);
    if (hand[k]) dupHand.push(k);
    hand[k] = true;
  });
  t.ok(label + ': höchstens eine Zeile „von Hand“ pro Schlüssel', dupHand.length === 0, dupHand);
  t.ok(label + ': Herkunft Hand oder Import n', raw.every(r => r[COL.origin] === 'Hand' || /^Import \d+$/.test(r[COL.origin])), raw.map(r => r[COL.origin]));
  t.ok(label + ': Zählungen ganze Zahlen >= 0', raw.every(r => Number.isInteger(r[COL.count]) && r[COL.count] >= 0), raw.map(r => r[COL.count]));
  // Gruppen = Neuberechnung aus Daten
  const want = {};
  raw.forEach(r => {
    const g = env.ctx.groupKey_(r);
    (want[g] = want[g] || []).push(r);
  });
  const groups = env.groups();
  const gk = groups.map(g => g['Gruppenschlüssel']);
  t.ok(label + ': Gruppen hat jede Gruppe genau einmal', gk.length === Object.keys(want).length && gk.every(k => want[k]) && new Set(gk).size === gk.length,
    { gruppen: gk, daten: Object.keys(want) });
  const wrong = [];
  groups.forEach(g => {
    const rs = want[g['Gruppenschlüssel']];
    if (!rs) return;
    const cnt = rs.reduce((s, r) => s + r[COL.count], 0);
    const ex = env.ctx.exemplareText_(rs);
    const gp = env.ctx.groupPrice_(rs);
    if (g['Anzahl'] !== cnt) wrong.push([g['Gruppenschlüssel'], 'Anzahl', g['Anzahl'], cnt]);
    if (g['Exemplare'] !== ex) wrong.push([g['Gruppenschlüssel'], 'Exemplare', g['Exemplare'], ex]);
    if ((g['Preis (EUR)'] === '' ? null : g['Preis (EUR)']) !== gp.price) wrong.push([g['Gruppenschlüssel'], 'Preis', g['Preis (EUR)'], gp.price]);
  });
  t.ok(label + ': Gruppen-Anzahl, Exemplare und Preis stimmen', wrong.length === 0, wrong);
  t.ok(label + ': Sperre nie verschachtelt', env.lock.nested === 0 && env.lock.depth === 0, env.lock);
}

/** Die Liste im UI (nach Änderungen nur der betroffenen Karten) muss dem Server entsprechen. */
function checkUiMatchesServer(E, label) {
  const res = E.env.uiCall('getCollection');
  const byG = {};
  res.groups.forEach(g => { byG[g.gkey] = g; });
  const diffs = [];
  const all = E.win.coll.all || [];
  if (all.length !== res.groups.length) diffs.push(['Anzahl Gruppen', all.length, res.groups.length]);
  (E.win.state.groups || []).filter(g => !g.gone).forEach(g => {
    const s = byG[g.gkey];
    if (!s) { diffs.push([g.gkey, 'fehlt am Server']); return; }
    if (J(g.k) !== J(s.k) || J(g.dex) !== J(s.dex)) diffs.push([g.gkey, 'k/dex', g.k, s.k]);
    if (E.win.coll.byKey[g.gkey] !== g) diffs.push([g.gkey, 'nicht in coll.byKey']);
    if (g.count !== s.count) diffs.push([g.gkey, 'count', g.count, s.count]);
    if ((g.exemplare || '') !== (s.exemplare || '')) diffs.push([g.gkey, 'exemplare', g.exemplare, s.exemplare]);
    const ue = g.rows.map(r => r.eid + ':' + r.count).sort();
    const se = s.rows.map(r => r.eid + ':' + r.count).sort();
    if (J(ue) !== J(se)) diffs.push([g.gkey, 'rows', ue, se]);
    if ((g.price == null ? null : Number(g.price)) !== s.price) diffs.push([g.gkey, 'price', g.price, s.price]);
    if (!!g.priceManual !== !!s.priceManual) diffs.push([g.gkey, 'priceManual', g.priceManual, s.priceManual]);
  });
  t.ok(label + ': Liste im UI = Server', diffs.length === 0, diffs);
}

function headText(E, i) { return E.$('gh' + i).textContent.replace(/\s+/g, ' '); }

// ---------------------------------------------------------------------------
// Testdaten (tcgdex-Attrappe)
// ---------------------------------------------------------------------------
function makeEnv() {
  const env = H.createEnv({ files: FILES.slice() });
  // Grundset-Glurak mit echtem Set (defaultDb hängt jeder Karte swsh3-Setdaten an)
  const set1 = { id: 'base1', name: 'Grundset', cardCount: { official: 102, total: 102 } };
  env.DB['de/cards/base1-4'] = Object.assign({}, env.DB['de/cards/base1-4'], { set: set1 });
  env.DB['en/cards/base1-4'] = Object.assign({}, env.DB['en/cards/base1-4'], { set: Object.assign({}, set1, { name: 'Base Set' }) });
  // Mewtu ist in defaultDb nur englisch; für „Unbekannt“ gibt es nichts
  return env;
}

/** Importe-Blatt + Import-Zeilen direkt anlegen (wie ein Import es täte). */
function seedImport(env) {
  const ss = env.ss;
  const sh = ss.getSheetByName('Importe') || ss.insertSheet('Importe');
  const head = ['Nr', 'Datum', 'Quelle', 'Quelle-ID', 'Tab', 'Vorlage', 'Modus', 'Status', 'Neu', 'Mehr', 'Weniger', 'Übersprungen',
    'Prüfliste offen', 'Wertänderung (EUR)', 'Zurückgenommen am', 'Bericht'];
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(2, 1, 1, 8).setValues([[3, new Date(2026, 9, 14), 'Pokemon Ordner', 'SRC1', 'Karten', 'Ordner', 'Nur Neues', 'aktiv']]);
  const c = env.ctx;
  const sum = (id, extra) => Object.assign(c.summarizeCard_(env.DB['de/cards/' + id], 'de'),
    { dataLang: 'de', setDate: '2020-08-14', price: 1.5, priceDate: '2026-10-13' }, extra || {});
  return c.withLock_(function () {
    c.ensureExtraColumn_('Ordner');
    const rA = c.buildCardRow_(sum('swsh3-025'), { origin: 'Import 3', fp: 'fpaaaaaaaaaa', count: 1, cond: '', lang: 'DE', extras: { Ordner: 'Seite 3' } });
    const rB = c.buildCardRow_(sum('swsh3-136', { price: 2 }), { origin: 'Import 3', fp: 'fpbbbbbbbbbb', count: 2, cond: 'EX', lang: 'DE' });
    c.appendDataRows_([rA, rB]);
    const COL = env.run('COL');
    c.appendProto_([
      { nr: 3, type: 'neu', eid: rA[COL.eid], fp: 'fpaaaaaaaaaa', qty: 1, data: { id: 'swsh3-025' }, sourceId: 'SRC1' },
      { nr: 3, type: 'neu', eid: rB[COL.eid], fp: 'fpbbbbbbbbbb', qty: 2, data: { id: 'swsh3-136' }, sourceId: 'SRC1' }
    ]);
    c.rebuildGroups_();
    return { eidA: String(rA[COL.eid]), eidB: String(rB[COL.eid]) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(async () => {
  // ---- Syntax: Code.gs und jedes <script> in Ui.html (nach Scriptlet-Ersetzung) ----
  t.section('Syntax');
  {
    const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
    let err = null;
    try { new vm.Script(code, { filename: 'Code.gs' }); } catch (e) { err = e.message; }
    t.ok('Code.gs kompiliert', !err, err);
    const raw = fs.readFileSync(path.join(SRC, 'Ui.html'), 'utf8');
    ['sidebar', 'web'].forEach(mode => {
      const html = raw.replace(/<\?!=\s*mode\s*\?>/g, mode).replace(/<\?!= typeof start[^?]*\?>/g, '')
        .replace(/<\?!= mode === 'sidebar' \? include\('ImportUi'\) : '' \?>/g, mode === 'sidebar' ? IMPORT_STUB : '');
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
      let bad = [];
      scripts.forEach((s, i) => { try { new vm.Script(s, { filename: 'Ui.html#' + i }); } catch (e) { bad.push(i + ': ' + e.message); } });
      t.ok('Ui.html (' + mode + '): ' + scripts.length + ' Skriptblöcke kompilieren', scripts.length >= (mode === 'sidebar' ? 2 : 1) && bad.length === 0, bad);
    });
    t.ok('Ui.html: "<?" nur in den drei Scriptlets', (raw.match(/<\?/g) || []).length === 3);
    t.ok('Ui.html: kein Gedankenstrich (—)', raw.indexOf('—') < 0);
  }

  // ---- Server-Vertrag: jede google.script.run-Funktion aus Ui.html gibt es öffentlich ----
  t.section('Vertrag Ui.html -> Code.gs');
  {
    const raw = fs.readFileSync(path.join(SRC, 'Ui.html'), 'utf8');
    const env = makeEnv();
    const names = [...new Set([...raw.matchAll(/call\('([A-Za-z0-9_]+)'/g)].map(m => m[1]))].sort();
    t.ok('Ui.html ruft Serverfunktionen auf', names.length >= 12, names);
    names.forEach(n => t.ok('öffentlich vorhanden: ' + n, typeof env.ctx[n] === 'function' && !/_$/.test(n)));
    const want = ['addCard', 'addFreeCard', 'adjustEntry', 'editEntry', 'getCardBySetNumber', 'getCardDetail', 'getCollection', 'getFileVersions', 'getPokedex', 'getSetSuggestions',
      'getUiConfig', 'getUpdateInfo', 'linkFreeGroup', 'revertAdjust', 'searchCards', 'searchCollection', 'setGroupOwnPrice',
      'setPrereleases', 'takeoverPreview', 'takeoverRun', 'updateCopy'];
    t.eq('genau die erwarteten Aufrufe', names, want);
    // Argumentreihenfolge wie in Code.gs
    const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
    const sig = n => { const m = code.match(new RegExp('function ' + n + '\\(([^)]*)\\)')); return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : null; };
    t.eq('adjustEntry(eid, delta)', sig('adjustEntry'), ['eid', 'delta']);
    t.eq('editEntry(eid, changes, qty)', sig('editEntry'), ['eid', 'changes', 'qty']);
    t.eq('setGroupOwnPrice(gkey, price)', sig('setGroupOwnPrice'), ['gkey', 'price']);
    t.eq('linkFreeGroup(gkey, cardId, dataLang, variant)', sig('linkFreeGroup'), ['gkey', 'cardId', 'dataLang', 'variant']);
    t.eq('searchCollection(query, setText, opts)', sig('searchCollection'), ['query', 'setText', 'opts']);
    t.eq('revertAdjust(token)', sig('revertAdjust'), ['token']);
  }

  // ---- Seitenleiste: kompletter Ablauf mit echtem Server ----
  t.section('Seitenleiste: Start');
  const env = makeEnv();
  env.ctx.onOpen();
  const setupMsg = env.ctx.setupAll_();
  t.ok('Einrichtung ohne Fehlermeldung, Ergebnis unten rechts', env.ui.alerts.length === 0 && /Einrichtung fertig/.test(setupMsg) &&
    env.ss.toasts.slice(-1)[0] === setupMsg, [setupMsg, env.ui.alerts, env.ss.toasts]);
  t.ok('Schema v2', env.setting('SCHEMA_VERSION') === '2');
  t.ok('Daten und Gruppen versteckt, Dashboard und Sammlung vorne', env.sheet('Daten').hidden && env.sheet('Gruppen').hidden &&
    env.ss.list[0].name === 'Dashboard' && env.ss.list[1].name === 'Sammlung', env.ss.list.map(x => x.name));
  t.eq('Sammlung-Kopf', env.values('Sammlung')[4].slice(0, 16), env.run('VIEW_HEADERS'));
  t.ok('Sammlung-Formel liest Gruppen', /Gruppen!A2:AF,/.test(env.sheet('Sammlung').getRange('A6').getFormula()));
  t.ok('nächtlicher Preislauf-Trigger', env.triggers.filter(x => x.fn === 'naechtlicherPreislauf').length === 1);
  t.ok('Menü mit allen Einträgen', env.ui.menus.length === 1 && env.ui.menus[0].items.map(x => x[1]).join(',') ===
    'kartenErfassen,zumDashboard,preiseJetztAktualisieren,uebersetzungUndSetsAktualisieren,ansichtNeuAufbauen,apiPruefen,webAppLinkAnzeigen', env.ui.menus);
  const E = boot(env, 'sidebar');
  const { $ } = E;
  await E.settle();
  t.ok('Start: getSetSuggestions + getUiConfig', E.calls('getSetSuggestions').length === 1 && E.calls('getUiConfig').length === 1, E.callLog.map(c => c.fn));
  t.ok('Setliste aus dem Set-Cache', /Flammende Finsternis/.test($('setList').innerHTML) && /Grundset/.test($('setList').innerHTML));
  t.ok('LANGS vom Server (11, DE zuerst)', E.win.LANGS.length === 11 && E.win.LANGS[0].code === 'DE' && E.win.LANGS[0].label === 'Deutsch');
  t.ok('CONDITIONS vom Server, "" zuerst', J(E.win.CONDITIONS) === J(['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']), E.win.CONDITIONS);
  t.ok('CONDITION_LABELS behalten die UI-Texte', /Near Mint/.test(E.win.CONDITION_LABELS.NM));
  t.ok('Import-Tab sichtbar (Seitenleiste)', !$('tabImport').classList.contains('hidden'));
  E.click($('tabImport'));
  if (REAL_IMPORTUI) await E.settle();
  t.ok('Import-Tab ruft impInit aus ImportUi', (REAL_IMPORTUI || E.win.impInitCalls === 1) && !$('paneImport').classList.contains('hidden'));
  E.click($('tabAdd'));
  t.ok('keine Skriptfehler (Start)', E.errors.length === 0, E.errors);

  // ---- 1. Karte hinzufügen (Grundwerte), dieselbe Karte noch einmal ----
  t.section('Hinzufügen: Grundwerte und dieselbe Karte noch einmal');
  E.type($('fName'), 'Glurak'); E.type($('fNumber'), '025');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  t.ok('Einzeltreffer -> Bestätigung mit echten Details', !!$('cAdd') && /Flammende Finsternis · 025\/189/.test($('addResults').textContent), $('addResults').textContent.slice(0, 200));
  t.ok('Trendpreis aus getCardDetail', /1,50/.test($('cPrice').textContent), $('cPrice').textContent);
  t.ok('Sprache-Auswahl mit Serverliste', $('cLang').options.length === 11 && $('cLang').value === 'DE');
  E.pick($('cCond'), 'NM'); $('cQty').value = '2';
  await E.clickSettle($('cAdd'));
  let addRes = E.lastCall('addCard');
  t.ok('addCard ok', addRes && !addRes.error && addRes.res && /^E[0-9a-f]{10}$/.test(addRes.res.eid), addRes);
  t.ok('Meldung: Glurak, Normal, NM, 2 Stück', /Glurak, Normal, NM hinzugefügt, jetzt 2 Stück\./.test($('addLast').textContent), $('addLast').textContent);
  let D = dataRows(env);
  const handA = D.find(r => r.eid === addRes.res.eid);
  t.ok('Daten: Zeile von Hand', handA && handA.origin === 'Hand' && handA.fp === '' && handA.lang === 'DE' && handA.version === '' && handA.count === 2 &&
    handA.key === 'swsh3-025|normal||NM|DE' && handA.price === 1.5 && handA.ownPrice === '' && handA.setDate === '2020-08-14', handA);
  t.ok('Daten: Datum als Date', handA && handA.added instanceof Date || Object.prototype.toString.call(handA.added) === '[object Date]');
  checkSheets(env, 'nach addCard');
  t.ok('kein Knopf „Nochmal +1“ mehr (#34)', !E.btn($('addLast'), 'Nochmal +1'));
  // dieselbe Karte noch einmal über das Formular: zählt in dieselbe Zeile
  E.type($('fName'), 'Glurak'); E.type($('fNumber'), '025');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  E.pick($('cCond'), 'NM');
  await E.clickSettle($('cAdd'));
  t.ok('noch einmal hinzugefügt -> 3 Stück', /jetzt 3 Stück/.test($('addLast').textContent), $('addLast').textContent);
  t.ok('Daten: 3 Stück in derselben Zeile', dataRows(env).find(r => r.eid === handA.eid).count === 3 && E.lastCall('addCard').res.eid === handA.eid);
  let G = env.groups().find(g => g['Gruppenschlüssel'] === 'swsh3-025|normal|');
  t.ok('Gruppen: 3× DE NM, Preis 1,5, Preisstand Trend', G && G['Exemplare'] === '3× DE NM' && G['Anzahl'] === 3 && G['Preis (EUR)'] === 1.5 && G['Preisstand'] === '2026-10-13', G);
  checkSheets(env, 'nach dem zweiten Hinzufügen');

  // ---- 2. Karte mit Sprache, Sonderversion, eigenem Preis ----
  t.section('Hinzufügen: Sprache, Sonderversion, eigener Preis');
  E.type($('fName'), 'Glurak'); E.type($('fNumber'), '025');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  E.pick($('cLang'), 'EN'); E.pick($('cCond'), 'LP');
  $('cVersion').value = 'Staff';
  $('cOwnPrice').value = '2,50';
  await E.clickSettle($('cAdd'));
  addRes = E.lastCall('addCard');
  t.ok('addCard mit Anfrage-ID', typeof addRes.args[0].rid === 'string');
  t.eq('addCard-Anfrage', noRid(addRes.args[0]), { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'LP', qty: 1, inputName: 'Glurak', cardLang: 'EN', version: 'Staff', ownPrice: 2.5 });
  t.ok('Meldung nennt Version, Sprache, eigenen Preis', /Glurak · Staff, Normal, LP, Englisch hinzugefügt, jetzt 1 Stück\. Eigener Preis: 2,50 €\./.test($('addLast').textContent), $('addLast').textContent);
  D = dataRows(env);
  const staff = D.find(r => r.eid === addRes.res.eid);
  t.ok('Daten: Sprache EN, Version Staff, eigener Preis mit Datum', staff && staff.lang === 'EN' && staff.version === 'Staff' && staff.ownPrice === 2.5 &&
    staff.ownPriceDate === TODAY && staff.key === 'swsh3-025|normal|Staff|LP|EN' && staff.origin === 'Hand', staff);
  t.ok('Version im Vorschlag (datalist)', /value="Staff"/.test($('versionList').innerHTML));
  G = env.groups().find(g => g['Gruppenschlüssel'] === 'swsh3-025|normal|Staff');
  t.ok('Gruppen: eigene Gruppe „Glurak · Staff“, manuell', G && G['Name'] === 'Glurak · Staff' && G['Exemplare'] === '1× EN LP' && G['Preis (EUR)'] === 2.5 &&
    G['Preisstand'] === 'manuell ' + TODAY_DMY, G);
  t.ok('Grundgruppe unverändert (kein eigener Preis)', env.groups().find(g => g['Gruppenschlüssel'] === 'swsh3-025|normal|')['Preis (EUR)'] === 1.5);
  checkSheets(env, 'nach addCard mit Version');

  // ---- 3. Grundset-Glurak von Hand (Ziel der späteren Verknüpfung) ----
  E.type($('fName'), 'Glurak'); E.type($('fNumber'), '4');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  t.ok('Grundset-Glurak: Holo als Grundvariante, Bild aus en', /Holo/.test($('addResults').textContent) && /\/en\/x\/base1-4/.test($('addResults').innerHTML), $('addResults').textContent.slice(0, 200));
  await E.clickSettle($('cAdd'));
  const base1Hand = E.lastCall('addCard').res;
  t.ok('base1-4 von Hand gespeichert', base1Hand && base1Hand.key === 'base1-4|holo|||DE', base1Hand);

  // ---- 4. Freie Karte (Suche ohne Treffer, Set-Auswahl) ----
  t.section('Freie Karte');
  E.type($('fName'), 'Unbekannt'); E.type($('fNumber'), '4/102'); E.type($('fSet'), '');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  t.ok('ohne Treffer: Set-Auswahl + Knopf „Als freie Karte speichern“', !!$('setGrid') && !!E.btn($('addResults'), 'Als freie Karte speichern'), $('addResults').textContent.slice(0, 300));
  E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
  t.ok('Formular vorbelegt', $('frName').value === 'Unbekannt' && $('frNumber').value === '4/102');
  $('frSet').value = 'Grundset';
  $('frOwnPrice').value = '1,50';
  await E.clickSettle($('frSave'));
  const freeRes = E.lastCall('addFreeCard');
  t.eq('addFreeCard-Anfrage', noRid(freeRes.args[0]), { name: 'Unbekannt', setName: 'Grundset', number: '4/102', variant: 'normal', condition: '', qty: 1, cardLang: 'DE', version: '', ownPrice: 1.5 });
  t.ok('addFreeCard ok', freeRes.res && freeRes.res.gkey === 'frei:unbekannt~grundset~4|normal|' && /hinzugefügt/.test($('addLast').textContent), [freeRes.res, $('addLast').textContent]);
  D = dataRows(env);
  const free = D.find(r => r.eid === freeRes.res.eid);
  t.ok('Daten: freie Karte', free && free.id === '' && free.source === 'frei' && free.localId === '4' && free.setSize === 102 && free.normNum === '4' &&
    free.img === '' && free.price === '' && free.ownPrice === 1.5 && free.key === 'frei:unbekannt~grundset~4|normal|||DE', free);
  G = env.groups().find(g => g['Gruppenschlüssel'] === 'frei:unbekannt~grundset~4|normal|');
  t.ok('Gruppen: freie Gruppe mit eigenem Preis', G && G['Quelle'] === 'frei' && G['Preis (EUR)'] === 1.5 && /^manuell /.test(G['Preisstand']) && G['Setgröße'] === 102, G);
  checkSheets(env, 'nach addFreeCard');
  t.ok('keine Skriptfehler (Hinzufügen)', E.errors.length === 0, E.errors);

  // ---- 5. Import-Zeilen direkt anlegen ----
  t.section('Import-Zeilen (direkt angelegt)');
  const imp = seedImport(env);
  t.ok('Import-Zeilen angelegt', dataRows(env).filter(r => r.origin === 'Import 3').length === 2);
  checkSheets(env, 'nach Import-Zeilen');
  await (async () => { E.win.loadUiConfig(); await E.settle(); })();
  t.ok('getUiConfig: Zusatzspalte Ordner, Version Staff', J(E.win.UI_CONFIG.extras) === J(['Ordner']) && E.win.UI_CONFIG.versions.indexOf('Staff') >= 0, E.win.UI_CONFIG);

  // ---- 6. Sammlung öffnen ----
  t.section('Sammlung');
  // die Seitenleiste hat die Sammlung beim Start vorgeladen (#39 V3); Zeilen von außerhalb holt erst „Neu laden“
  t.ok('vorgeladen', !!E.win.coll.all && E.calls('getCollection').length >= 1);
  await E.clickSettle($('tabColl'));
  await E.clickSettle($('collReload'));
  const st = E.win.state;
  const GK = 'swsh3-025|normal|';
  let gi = E.gIdx(GK);
  t.ok('Sammlung: Gruppen statt Zeilen', st.groups.length === 5 && gi >= 0, st.groups.map(g => g.gkey));
  t.ok('Glurak: Exemplare und Anzahl', /1× DE, 3× DE NM/.test(headText(E, gi)) && $('gh' + gi).querySelector('.cnt').textContent === '4', headText(E, gi));
  t.ok('Glurak: Set · Nummer · Variante · Preis', /Flammende Finsternis · 025\/189 · Normal · 1,50\s€/.test(headText(E, gi)), headText(E, gi));
  const si = E.gIdx('swsh3-025|normal|Staff');
  t.ok('Staff: Titel mit Version, Preis manuell', $('gh' + si).querySelector('.t').textContent === 'Glurak · Staff' && /2,50\s€ manuell/.test(headText(E, si)), headText(E, si));
  const fi = E.gIdx('frei:unbekannt~grundset~4|normal|');
  t.ok('freie Karte markiert, ohne Bild', /freie Karte/.test(headText(E, fi)) && $('gh' + fi).querySelector('img').getAttribute('src') === E.win.PLACEHOLDER);
  E.expand(gi);
  let rowsText = [...$('gr' + gi).querySelectorAll('.einfo')].map(e => e.textContent);
  t.ok('Exemplar-Zeilen: Hand zuerst, dann Import mit Quellname', rowsText.length === 2 && rowsText[0].indexOf('3× DE NM · von Hand') === 0 &&
    rowsText[1].indexOf('1× DE · Pokemon Ordner, Import 3') === 0 && /Ordner: Seite 3/.test(rowsText[1]), rowsText);
  checkUiMatchesServer(E, 'Sammlung geöffnet');
  // Suche nach Sonderversion (Server-Suche, entprellt)
  E.type($('colQuery'), 'Staff');
  E.win.__advance(400);
  await E.settle();
  t.ok('Suche „Staff“ findet nur die Staff-Gruppe', st.groups.length === 1 && st.groups[0].gkey === 'swsh3-025|normal|Staff', E.win.state.groups.map(g => g.gkey));
  E.type($('colQuery'), '025/189');
  E.win.__advance(400);
  await E.settle();
  t.ok('Suche „025/189“: beide Glurak-Gruppen', E.win.state.groups.length === 2, E.win.state.groups.map(g => g.gkey));
  E.type($('colQuery'), '');
  E.type($('colSet'), 'Darkness');
  E.win.__advance(400);
  await E.settle();
  t.ok('Set-Filter über en-Setnamen (Set-Cache)', E.win.state.groups.length === 3 && E.win.state.groups.every(g => g.setName === 'Flammende Finsternis'), E.win.state.groups.map(g => g.gkey));
  E.type($('colSet'), '');
  E.win.__advance(400);
  await E.settle();
  t.ok('wieder alle Gruppen, Glurak noch offen', E.win.state.groups.length === 5 && E.group(GK).open);

  // ---- 7. Gruppe -1 mit Auswahl (Hand + Import), Rückgängig ----
  t.section('Gruppe −1 mit Auswahl und Rückgängig');
  gi = E.gIdx(GK);
  E.click(E.btn($('gh' + gi), '−1'));
  await E.settle();
  const opts = [...$('gc' + gi).querySelectorAll('.btn.opt')].map(b => b.textContent);
  t.ok('Auswahl „Welches Exemplar?“ mit beiden Zeilen', /Welches Exemplar\?/.test($('gc' + gi).textContent) && opts.length === 3 &&
    opts[0] === '3× DE NM · von Hand' && opts[1] === '1× DE · Pokemon Ordner, Import 3' && opts[2] === 'Abbrechen', opts);
  t.ok('noch kein Serveraufruf', E.calls('adjustEntry').length === 0);
  await E.clickSettle([...$('gc' + gi).querySelectorAll('.btn.opt')][1]);
  let adj = E.lastCall('adjustEntry');
  t.eq('adjustEntry(Import-Zeile, -1)', adj.args, [imp.eidA, -1]);
  t.ok('Antwort mit Token und handentfernt-Log', adj.res && adj.res.applied === -1 && adj.res.token.logIds.length === 1 && adj.res.token.createdEid === '' && adj.res.groupCount === 3, adj.res);
  D = dataRows(env);
  t.ok('Daten: Import-Zeile 0, Hand-Zeile 3', D.find(r => r.eid === imp.eidA).count === 0 && D.find(r => r.eid === handA.eid).count === 3);
  let P = env.proto();
  let he = P.filter(p => p['Typ'] === 'handentfernt');
  t.ok('Import-Protokoll: handentfernt (Nr 3, fp, Menge 1, Quelle-ID)', he.length === 1 && he[0]['Import-Nr'] === 3 && he[0]['Eintrag-ID'] === imp.eidA &&
    he[0]['Quellzeile'] === 'fpaaaaaaaaaa' && he[0]['Menge'] === 1 && he[0]['Quelle-ID'] === 'SRC1' && he[0]['Status'] === 'erledigt' &&
    J(JSON.parse(he[0]['Daten'])) === J({ countBefore: 1 }) && he[0]['Log-ID'] === adj.res.token.logIds[0], he);
  t.ok('UI: Anzahl 3, Rückgängig sichtbar, Auswahl zu', $('gh' + gi).querySelector('.cnt').textContent === '3' && !!E.btn($('gh' + gi), 'Rückgängig') && $('gc' + gi).innerHTML === '');
  t.ok('UI: Exemplare nur noch 3× DE NM', /· 3× DE NM/.test(headText(E, gi)) && !/1× DE,/.test(headText(E, gi)), headText(E, gi));
  checkSheets(env, 'nach −1 Import');
  checkUiMatchesServer(E, 'nach −1 Import');
  await E.clickSettle(E.btn($('gh' + gi), 'Rückgängig'));
  const rev = E.lastCall('revertAdjust');
  t.eq('revertAdjust bekommt das Token unverändert', rev.args, [adj.res.token]);
  D = dataRows(env);
  t.ok('Daten: Import-Zeile wieder 1', D.find(r => r.eid === imp.eidA).count === 1);
  t.ok('Import-Protokoll: handentfernt wieder weg, neu-Einträge bleiben', env.proto().filter(p => p['Typ'] === 'handentfernt').length === 0 && env.proto().filter(p => p['Typ'] === 'neu').length === 2);
  t.ok('UI: Anzahl 4, kein Rückgängig', $('gh' + gi).querySelector('.cnt').textContent === '4' && !E.btn($('gh' + gi), 'Rückgängig'));
  checkSheets(env, 'nach Rückgängig');
  checkUiMatchesServer(E, 'nach Rückgängig');

  // -1 auf Hand-Zeile über die Auswahl, Rückgängig verfällt nach 5 s
  E.click(E.btn($('gh' + gi), '−1'));
  await E.clickSettle([...$('gc' + gi).querySelectorAll('.btn.opt')][0]);
  t.ok('−1 von Hand: kein Protokolleintrag', E.lastCall('adjustEntry').res.token.logIds.length === 0 && env.proto().filter(p => p['Typ'] === 'handentfernt').length === 0);
  t.ok('Rückgängig da', !!E.btn($('gh' + gi), 'Rückgängig'));
  E.win.__advance(5000);
  t.ok('Rückgängig nach 5 s weg', !E.btn($('gh' + gi), 'Rückgängig'));
  // Gruppe +1 mit einer Zeile von Hand: direkt
  await E.clickSettle(E.btn($('gh' + gi), '+1'));
  t.eq('+1 geht direkt an die Zeile von Hand', E.lastCall('adjustEntry').args, [handA.eid, 1]);
  t.ok('Daten: Hand wieder 3', dataRows(env).find(r => r.eid === handA.eid).count === 3);
  checkUiMatchesServer(E, 'nach −1/+1 von Hand');

  // ---- 8. +1 auf eine Gruppe nur mit Import-Zeile: neue Zeile von Hand, Rückgängig löscht sie ----
  t.section('+1 auf Import-Gruppe legt Zeile von Hand an');
  const GB = 'swsh3-136|normal|';
  let bi = E.gIdx(GB);
  t.ok('Import-Gruppe swsh3-136 da (2× DE EX)', bi >= 0 && /2× DE EX/.test(headText(E, bi)), headText(E, bi));
  await E.clickSettle(E.btn($('gh' + bi), '+1'));
  adj = E.lastCall('adjustEntry');
  t.eq('adjustEntry(Import-Zeile, +1)', adj.args, [imp.eidB, 1]);
  t.ok('Server legt Zeile von Hand an (createdEid)', adj.res.token.createdEid && adj.res.eid === adj.res.token.createdEid && adj.res.count === 1 && adj.res.groupCount === 3, adj.res);
  D = dataRows(env);
  const created = D.find(r => r.eid === adj.res.token.createdEid);
  t.ok('Daten: neue Zeile von Hand, gleicher Schlüssel, Import-Zeile unverändert', created && created.origin === 'Hand' && created.fp === '' && created.count === 1 &&
    created.key === 'swsh3-136|normal||EX|DE' && D.find(r => r.eid === imp.eidB).count === 2, created);
  t.ok('UI: Gruppe 3, neue Zeile im aufgeklappten Bereich', $('gh' + bi).querySelector('.cnt').textContent === '3' && E.group(GB).rows.length === 2 && E.group(GB).rows[0].eid === created.eid);
  checkSheets(env, 'nach +1 Import-Gruppe');
  checkUiMatchesServer(E, 'nach +1 Import-Gruppe');
  await E.clickSettle(E.btn($('gh' + bi), 'Rückgängig'));
  D = dataRows(env);
  t.ok('Rückgängig: neue Zeile von Hand gelöscht', !D.some(r => r.eid === created.eid) && D.find(r => r.eid === imp.eidB).count === 2);
  t.ok('UI: Zeile entfernt, Anzahl 2', E.group(GB).rows.length === 1 && $('gh' + bi).querySelector('.cnt').textContent === '2');
  checkSheets(env, 'nach Rückgängig (angelegte Zeile)');
  checkUiMatchesServer(E, 'nach Rückgängig (angelegte Zeile)');
  // −1 auf die Import-Gruppe (nur eine Zeile): direkt, mit Protokoll
  await E.clickSettle(E.btn($('gh' + bi), '−1'));
  t.eq('−1 mit einer Zeile geht direkt', E.lastCall('adjustEntry').args, [imp.eidB, -1]);
  he = env.proto().filter(p => p['Typ'] === 'handentfernt');
  t.ok('handentfernt für Import-Zeile B', he.length === 1 && he[0]['Eintrag-ID'] === imp.eidB && he[0]['Quellzeile'] === 'fpbbbbbbbbbb' && J(JSON.parse(he[0]['Daten'])) === J({ countBefore: 2 }), he);
  checkUiMatchesServer(E, 'nach −1 Import-Gruppe');

  // ---- 8b. Neu laden, während -1/+1 unterwegs ist: erst nach dem Speichern ----
  t.section('Neu laden während einer Änderung');
  {
    const SK = 'swsh3-025|normal|Staff';
    let k = E.gIdx(SK);
    E.click(E.btn($('gh' + k), '+1'));
    E.click(E.btn($('gh' + k), '+1')); // Doppelklick: Knopf ist gesperrt
    t.ok('Doppelklick: nur ein adjustEntry offen', E.pending.filter(p => p.fn === 'adjustEntry').length === 1, E.pending.map(p => p.fn));
    const nLoad = E.calls('getCollection').length;
    E.click($('collReload'));
    t.ok('Neu laden wartet auf das Speichern', !E.pending.some(p => p.fn === 'getCollection') && /sobald alles gespeichert/.test($('collMsg').textContent), $('collMsg').textContent);
    await E.serveFn('adjustEntry');
    t.ok('danach lädt es neu', E.pending.some(p => p.fn === 'getCollection'), E.pending.map(p => p.fn));
    await E.settle();
    k = E.gIdx(SK);
    t.ok('+1 in der neu geladenen Liste', E.calls('getCollection').length === nLoad + 1 && E.group(SK).count === 2 && $('gh' + k).querySelector('.cnt').textContent === '2', E.group(SK));
    checkUiMatchesServer(E, 'nach Neu laden');
    // Neu laden läuft schon, dann −1: die alte Antwort wird verworfen und noch einmal geladen
    E.click($('collReload'));
    t.ok('Knopf zeigt „Lädt …“', $('collReload').disabled && /Lädt/.test($('collReload').textContent));
    E.click(E.btn($('gh' + k), '−1'));
    await E.serveFn('adjustEntry');
    await E.serveFn('getCollection'); // Stand von vor dem −1? Egal, das UI lädt noch einmal
    await E.settle();
    k = E.gIdx(SK);
    t.ok('−1 während Neu laden: kein doppeltes Abziehen', E.group(SK).count === 1 && $('gh' + k).querySelector('.cnt').textContent === '1' &&
      E.calls('getCollection').length === nLoad + 3 && !$('collReload').disabled, [E.group(SK).count, E.calls('getCollection').length - nLoad]);
    checkUiMatchesServer(E, '−1 während Neu laden');
    t.ok('Daten: Staff wieder 1', dataRows(env).find(r => r.key === 'swsh3-025|normal|Staff|LP|EN').count === 1);
    // Liste wieder in den gewohnten Zustand: Glurak offen lassen
    if (!E.group(GK).open) E.expand(E.gIdx(GK));
    t.ok('keine Skriptfehler (Reihenfolge)', E.errors.length === 0, E.errors);
  }

  // ---- 9. Bearbeiten mit Aufteilen und Zusammenlegen ----
  t.section('Bearbeiten: Aufteilen, Zusammenlegen, Zusatzwerte');
  gi = E.gIdx(GK);
  let g = E.group(GK);
  t.ok('Glurak offen', g.open && !$('gx' + gi).classList.contains('hidden'));
  let j = g.rows.findIndex(r => r.eid === handA.eid);
  E.click(E.btns($('gr' + gi), /^Bearbeiten$/)[j]);
  t.ok('Bearbeiten-Formular mit Zustand, Sprache, Version, Zusatzspalte, Wie viele', !!($('eCond' + gi) && $('eLang' + gi) && $('eVer' + gi) && $('eX' + gi + '_0') && $('eQty' + gi)) &&
    $('eCond' + gi).value === 'NM' && $('eLang' + gi).value === 'DE' && $('eQty' + gi).value === '3', $('ge' + gi).textContent.slice(0, 200));
  E.pick($('eCond' + gi), 'LP');
  E.type($('eQty' + gi), '1');
  const nColl = E.calls('getCollection').length;
  E.click(E.btn($('ge' + gi), 'Speichern'));
  t.ok('Sofort: Formular zu, Karte zeigt die Änderung mit „speichert …“', !$('eCond' + gi) && /speichert/.test($('gh' + gi).textContent) &&
    /2× DE NM · von Hand/.test($('gr' + gi).textContent) && /1× DE LP · von Hand · speichert/.test($('gr' + gi).textContent), $('gr' + gi).textContent);
  await E.settle();
  const ed = E.lastCall('editEntry');
  t.eq('editEntry(eid, {cond}, 1)', ed.args, [handA.eid, { cond: 'LP' }, 1]);
  D = dataRows(env);
  const handNm = D.find(r => r.eid === handA.eid);
  const split = D.find(r => r.eid === ed.res.eid);
  t.ok('Aufgeteilt: NM 2, neue Zeile LP 1 (von Hand, gleiches Hinzufügedatum)', handNm.count === 2 && split && split.eid !== handA.eid && split.count === 1 &&
    split.cond === 'LP' && split.origin === 'Hand' && split.key === 'swsh3-025|normal||LP|DE' && +split.added === +handNm.added, [handNm, split]);
  t.ok('Liste nicht neu geladen, Gruppe bleibt offen, Formular zu', E.calls('getCollection').length === nColl && E.group(GK).open && !$('eCond' + gi) &&
    !/speichert/.test($('gh' + gi).textContent), E.calls('getCollection').length);
  G = env.groups().find(x => x['Gruppenschlüssel'] === GK);
  t.ok('Gruppen: Exemplare 1× DE, 2× DE NM, 1× DE LP', G['Exemplare'] === '1× DE, 2× DE NM, 1× DE LP', G['Exemplare']);
  checkSheets(env, 'nach Aufteilen');
  checkUiMatchesServer(E, 'nach Aufteilen');
  // zurück auf NM: wird mit der NM-Zeile zusammengelegt
  gi = E.gIdx(GK); g = E.group(GK);
  j = g.rows.findIndex(r => r.eid === split.eid);
  E.click(E.btns($('gr' + gi), /^Bearbeiten$/)[j]);
  t.ok('Bei 1 Stück kein „Wie viele davon?“', !$('eQty' + gi));
  E.pick($('eCond' + gi), 'NM');
  await E.clickSettle(E.btn($('ge' + gi), 'Speichern'));
  t.eq('editEntry(eid, {cond: NM}, 1)', E.lastCall('editEntry').args, [split.eid, { cond: 'NM' }, 1]);
  D = dataRows(env);
  t.ok('Zusammengelegt: NM wieder 3, LP-Zeile weg', D.find(r => r.eid === handA.eid).count === 3 && !D.some(r => r.eid === split.eid) &&
    E.lastCall('editEntry').res.eid === handA.eid, D.filter(r => r.id === 'swsh3-025').map(r => [r.eid, r.cond, r.count]));
  checkSheets(env, 'nach Zusammenlegen');
  checkUiMatchesServer(E, 'nach Zusammenlegen');
  // Import-Zeile: Sprache und Zusatzwert ändern, Herkunft bleibt
  gi = E.gIdx(GK); g = E.group(GK);
  j = g.rows.findIndex(r => r.eid === imp.eidA);
  E.click(E.btns($('gr' + gi), /^Bearbeiten$/)[j]);
  t.ok('Zusatzwert vorbelegt', $('eX' + gi + '_0').value === 'Seite 3');
  E.pick($('eLang' + gi), 'EN');
  E.type($('eX' + gi + '_0'), 'Seite 4');
  await E.clickSettle(E.btn($('ge' + gi), 'Speichern'));
  t.eq('editEntry(Import, {cardLang, extras}, 1)', E.lastCall('editEntry').args, [imp.eidA, { cardLang: 'EN', extras: { Ordner: 'Seite 4' } }, 1]);
  D = dataRows(env);
  const impA = D.find(r => r.eid === imp.eidA);
  t.ok('Import-Zeile: EN, Zusatzwert neu, Herkunft und Quellzeile bleiben', impA && impA.lang === 'EN' && impA.extras.Ordner === 'Seite 4' && impA.origin === 'Import 3' &&
    impA.fp === 'fpaaaaaaaaaa' && impA.key === 'swsh3-025|normal|||EN', impA);
  checkSheets(env, 'nach Bearbeiten Import');
  checkUiMatchesServer(E, 'nach Bearbeiten Import');
  // Sonderversion ändern: Exemplar wandert in eine andere Gruppe
  gi = E.gIdx(GK); g = E.group(GK);
  j = g.rows.findIndex(r => r.eid === handA.eid);
  E.click(E.btns($('gr' + gi), /^Bearbeiten$/)[j]);
  E.type($('eVer' + gi), 'Snowflake');
  E.type($('eQty' + gi), '1');
  await E.clickSettle(E.btn($('ge' + gi), 'Speichern'));
  const verRes = E.lastCall('editEntry').res;
  t.ok('Version: neue Gruppe swsh3-025|normal|Snowflake, aufgeklappt', verRes.gkey === 'swsh3-025|normal|Snowflake' && E.group(verRes.gkey) && E.group(verRes.gkey).open, verRes);
  t.ok('Version-Vorschlag gemerkt', /value="Snowflake"/.test($('versionList').innerHTML));
  checkSheets(env, 'nach Versionswechsel');
  checkUiMatchesServer(E, 'nach Versionswechsel');

  // ---- 10. Eigener Preis für die Gruppe ----
  t.section('Eigener Preis');
  gi = E.gIdx(GK);
  E.type($('op' + gi), '3,10');
  await E.clickSettle(E.btn($('gp' + gi), 'Speichern'));
  t.eq('setGroupOwnPrice(gkey, 3.1)', E.lastCall('setGroupOwnPrice').args, [GK, 3.1]);
  D = dataRows(env).filter(r => env.ctx.groupKey_(env.run('readData_(sheet_(SHEETS.data))').find(x => x[23] === r.eid)) === GK);
  t.ok('Daten: alle Zeilen der Gruppe 3,10 mit Datum', D.length === 2 && D.every(r => r.ownPrice === 3.1 && r.ownPriceDate === TODAY), D.map(r => [r.eid, r.ownPrice, r.ownPriceDate]));
  G = env.groups().find(x => x['Gruppenschlüssel'] === GK);
  t.ok('Gruppen: Preis 3,1 manuell', G['Preis (EUR)'] === 3.1 && G['Preisstand'] === 'manuell ' + TODAY_DMY, G);
  t.ok('UI: „3,10 € manuell“, Entfernen aktiv', /3,10\s€ manuell/.test(headText(E, gi)) && !E.btn($('gp' + gi), 'Entfernen').disabled && /Eigener Preis gespeichert/.test($('collMsg').textContent), headText(E, gi));
  t.ok('andere Gruppe derselben Karte unberührt', env.groups().find(x => x['Gruppenschlüssel'] === 'swsh3-025|normal|Snowflake')['Preis (EUR)'] === 1.5);
  checkSheets(env, 'nach eigenem Preis');
  checkUiMatchesServer(E, 'nach eigenem Preis');
  // ungültig: nichts gesendet
  const nPrice = E.calls('setGroupOwnPrice').length;
  E.type($('op' + gi), 'abc');
  await E.clickSettle(E.btn($('gp' + gi), 'Speichern'));
  t.ok('ungültiger Preis: kein Aufruf, Fehlermeldung', E.calls('setGroupOwnPrice').length === nPrice && /Preis größer als 0/.test($('collMsg').textContent));
  await E.clickSettle(E.btn($('gp' + gi), 'Entfernen'));
  t.eq('Entfernen: setGroupOwnPrice(gkey, null)', E.lastCall('setGroupOwnPrice').args, [GK, null]);
  G = env.groups().find(x => x['Gruppenschlüssel'] === GK);
  t.ok('Gruppen: wieder Trendpreis', G['Preis (EUR)'] === 1.5 && G['Preisstand'] === '2026-10-13', G);
  t.ok('UI: kein „manuell“ mehr', !/manuell/.test(headText(E, gi)) && E.btn($('gp' + gi), 'Entfernen').disabled, headText(E, gi));
  checkUiMatchesServer(E, 'nach Preis entfernen');

  // ---- 11. Freie Karte mit tcgdex-Karte verknüpfen (zusammenlegen mit Zeile von Hand) ----
  t.section('Verknüpfen');
  let fkey = 'frei:unbekannt~grundset~4|normal|';
  let fi2 = E.gIdx(fkey);
  E.expand(fi2);
  E.click(E.btn($('gl' + fi2), 'Mit tcgdex-Karte verknüpfen'));
  t.ok('Verknüpfen-Formular vorbelegt', $('lkName' + fi2).value === 'Unbekannt' && $('lkNum' + fi2).value === '4/102' && $('lkSet' + fi2).value === 'Grundset');
  E.type($('lkName' + fi2), 'Glurak');
  await E.clickSettle(E.btn($('gl' + fi2), 'Suchen'));
  t.eq('searchCards mit Name/Nummer/Set', E.lastCall('searchCards').args, [{ name: 'Glurak', number: '4/102', set: 'Grundset' }]);
  const tiles = $('lkRes' + fi2).querySelectorAll('.tile');
  t.ok('eine Kachel base1-4', tiles.length === 1 && /Grundset · 4/.test(tiles[0].textContent), $('lkRes' + fi2).textContent);
  const prevOfFree = $('g' + fi2).previousElementSibling;
  await E.clickSettle(tiles[0]);
  const link = E.lastCall('linkFreeGroup');
  t.eq('linkFreeGroup(gkey, base1-4, de, base)', link.args, [fkey, 'base1-4', 'de', 'base']);
  t.ok('neuer Gruppenschlüssel base1-4|holo|', link.res && link.res.gkey === 'base1-4|holo|', link);
  D = dataRows(env);
  const b1 = D.filter(r => r.id === 'base1-4');
  t.ok('Daten: mit Zeile von Hand zusammengelegt (2 Stück), eigener Preis übernommen', b1.length === 1 && b1[0].eid === base1Hand.eid && b1[0].count === 2 &&
    b1[0].ownPrice === 1.5 && !D.some(r => r.source === 'frei'), b1);
  const bk = E.gIdx('base1-4|holo|');
  t.ok('UI: verknüpfte Gruppe offen an der Stelle der freien Karte, Meldung', bk >= 0 && E.group('base1-4|holo|').open && !$('g' + fi2) &&
    $('gh' + bk).closest('.grp').previousElementSibling === prevOfFree && /Mit tcgdex-Karte verknüpft/.test($('collMsg').textContent));
  checkSheets(env, 'nach Verknüpfen');
  checkUiMatchesServer(E, 'nach Verknüpfen');

  // zweite freie Karte ohne Gegenstück: Felder aus tcgdex, Name bleibt bei en-Daten
  E.click($('tabAdd'));
  E.type($('fName'), 'Unbekannt'); E.type($('fNumber'), ''); E.type($('fSet'), '');
  await E.clickSettle(E.btn($('searchForm'), 'Suchen'));
  t.ok('stage none: freier-Karte-Knopf', !!E.btn($('addResults'), 'Als freie Karte speichern'));
  E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
  $('frName').value = 'Mewtu Spezial'; $('frSet').value = 'Altes Set'; $('frNumber').value = '7';
  E.pick($('frVariant'), 'reverse'); E.pick($('frCond'), 'GD'); E.pick($('frLang'), 'JP');
  $('frQty').value = '2';
  await E.clickSettle($('frSave'));
  const free2 = E.lastCall('addFreeCard').res;
  t.ok('zweite freie Karte', free2 && free2.key === 'frei:mewtu spezial~altes set~7|reverse||GD|JP' && /Japanisch/.test($('addLast').textContent), [free2, $('addLast').textContent]);
  await E.clickSettle($('tabColl'));
  fkey = free2.gkey;
  fi2 = E.gIdx(fkey);
  E.expand(fi2);
  E.click(E.btn($('gl' + fi2), 'Mit tcgdex-Karte verknüpfen'));
  E.type($('lkName' + fi2), 'Mewtu'); E.type($('lkSet' + fi2), '');
  await E.clickSettle(E.btn($('gl' + fi2), 'Suchen'));
  const t2 = $('lkRes' + fi2).querySelectorAll('.tile');
  t.ok('Kachel mit englischen Daten', t2.length === 1 && /englische Daten/.test(t2[0].textContent), $('lkRes' + fi2).textContent);
  await E.clickSettle(t2[0]);
  t.eq('linkFreeGroup(..., en, reverse)', E.lastCall('linkFreeGroup').args, [fkey, 'old9-007', 'en', 'reverse']);
  D = dataRows(env);
  const mw = D.find(r => r.id === 'old9-007');
  t.ok('Daten: en-Ersatz, Name bleibt, Variante reverse, Zustand/Sprache/Anzahl bleiben', mw && mw.source === 'en-Ersatz' && mw.name === 'Mewtu Spezial' &&
    mw.nameEn === 'Mewtwo' && mw.variant === 'reverse' && mw.cond === 'GD' && mw.lang === 'JP' && mw.count === 2 && mw.price === 3.25 && mw.key === 'old9-007|reverse||GD|JP', mw);
  const mi = E.gIdx('old9-007|reverse|');
  t.ok('UI: Titel mit (EN), Gruppe offen', mi >= 0 && /Mewtu Spezial \(EN\)/.test($('gh' + mi).querySelector('.t').textContent) && E.group('old9-007|reverse|').open);
  checkSheets(env, 'nach Verknüpfen (en)');
  checkUiMatchesServer(E, 'nach Verknüpfen (en)');
  // freie Holo-Karte: Holo bleibt beim Verknüpfen erhalten
  const free3 = env.uiCall('addFreeCard', { name: 'Glurak Holo', setName: 'Flammende Finsternis', number: '136', variant: 'holo', qty: 1 });
  E.win.loadCollection();
  await E.settle();
  const f3 = E.gIdx(free3.gkey);
  E.expand(f3);
  E.click(E.btn($('gl' + f3), 'Mit tcgdex-Karte verknüpfen'));
  E.type($('lkName' + f3), 'Glurak'); E.type($('lkNum' + f3), '136'); E.type($('lkSet' + f3), '');
  await E.clickSettle(E.btn($('gl' + f3), 'Suchen'));
  const t3 = $('lkRes' + f3).querySelectorAll('.tile');
  t.ok('Kachel swsh3-136', t3.length === 1, $('lkRes' + f3).textContent);
  await E.clickSettle(t3[0]);
  t.eq('linkFreeGroup(..., de, holo)', E.lastCall('linkFreeGroup').args, [free3.gkey, 'swsh3-136', 'de', 'holo']);
  const h3 = dataRows(env).find(r => r.eid === free3.eid);
  t.ok('Daten: Holo behalten, Preis aus en-Daten', h3 && h3.id === 'swsh3-136' && h3.variant === 'holo' && h3.price === 1.5 && h3.key === 'swsh3-136|holo|||DE', h3);
  checkSheets(env, 'nach Verknüpfen (Holo)');
  checkUiMatchesServer(E, 'nach Verknüpfen (Holo)');
  t.ok('keine Skriptfehler (Sammlung)', E.errors.length === 0, E.errors);

  // ---- 12. Zusatzspalte in der Sammlung zeigen, Ansicht, Preislauf, onEdit ----
  t.section('Ansicht, Zusatzspalten, Preislauf, onEdit');
  const ve = env.uiCall('setViewExtras', ['Ordner', 'Gibtsnicht']);
  t.eq('setViewExtras behält nur vorhandene', ve, { viewExtras: ['Ordner'] });
  const gh = env.values('Gruppen')[0];
  t.ok('Gruppen: Spalte 33 = Ordner (nach den Hilfsspalten)', gh.length === 33 && gh[32] === 'Ordner', gh);
  t.ok('Gruppen: Wert der Gruppe', env.groups().find(x => x['Gruppenschlüssel'] === GK)['Ordner'] === 'Seite 4');
  const view = env.sheet('Sammlung');
  t.ok('Sammlung: Kopf mit Ordner', view.getRange(5, 17).getValue() === 'Ordner' && view.getRange(5, 16).getValue() === 'Preisstand');
  const f = view.getRange('A6').getFormula();
  t.ok('Formel liest Gruppen!A2:AG und zeigt Spalte 33', /Gruppen!A2:AG,/.test(f) && /CHOOSECOLS\(srt, 33\)\s*\)\)/.test(f) && !/Daten!/.test(f));
  t.ok('Setliste aus Gruppen', /Gruppen!D2:D/.test(view.getRange('Z2').getFormula()));
  const before = env.groups().find(x => x['Gruppenschlüssel'] === 'swsh3-025|normal|Snowflake');
  env.DB['de/cards/swsh3-025'] = H.card('swsh3-025', 'de', { pricing: { cardmarket: { trend: 2, 'trend-holo': 4, updated: '2026-10-15T00:00:00Z' } } });
  env.ctx.preiseJetztAktualisieren();
  const after = env.groups().find(x => x['Gruppenschlüssel'] === 'swsh3-025|normal|Snowflake');
  t.ok('Preislauf: Gruppen mit neuem Trendpreis', before['Preis (EUR)'] === 1.5 && after['Preis (EUR)'] === 2 && after['Preisstand'] === '2026-10-15', [before, after]);
  const hist = env.values('Verlauf');
  t.ok('Verlauf: eine Zeile mit Gesamtwert', hist.length === 2 && typeof hist[1][1] === 'number' && hist[1][2] > 0, hist);
  checkSheets(env, 'nach Preislauf');
  // Direkte Änderung im Blatt Daten -> onEdit baut Gruppen neu
  const COL = env.run('COL');
  const dsh = env.sheet('Daten');
  const rowNo = dataRows(env).find(r => r.eid === imp.eidB).row;
  dsh.getRange(rowNo, COL.count + 1).setValue(5);
  env.ctx.onEdit({ range: dsh.getRange(rowNo, COL.count + 1), value: 5 });
  t.ok('onEdit: Gruppen nachgezogen', env.groups().find(x => x['Gruppenschlüssel'] === GB)['Anzahl'] === 5);
  checkSheets(env, 'nach onEdit');
  // Viele Zeilen direkt ins Blatt eingefügt (ohne Eintrag-ID/Herkunft, Kleinschreibung): ein onEdit repariert in Blöcken
  {
    const tmpl = env.sheet('Daten').getRange(dataRows(env).find(r => r.eid === handA.eid).row, 1, 1, 30).getValues()[0];
    const last = dsh.getLastRow();
    const pasted = [];
    for (let k = 0; k < 15; k++) {
      const r = tmpl.slice();
      r[COL.eid] = ''; r[COL.origin] = ''; r[COL.key] = 'alt'; r[COL.lang] = 'de'; r[COL.cond] = 'nm'; r[COL.version] = 'P' + k; r[COL.count] = 1;
      r[COL.ownPrice] = '';
      pasted.push(r);
    }
    dsh.getRange(last + 1, 1, pasted.length, 30).setValues(pasted);
    const w0 = env.writes, d0 = env.writesBy['Dashboard'] || 0;
    env.ctx.onEdit({ range: dsh.getRange(last + 1, 1, pasted.length, 30) });
    const rep = dataRows(env).filter(r => /^P\d+$/.test(r.version));
    t.ok('eingefügte Zeilen repariert (ID, Herkunft, DE, NM, Schlüssel)', rep.length === 15 && rep.every(r => /^E[0-9a-f]{10}$/.test(r.eid) && r.origin === 'Hand' &&
      r.lang === 'DE' && r.cond === 'NM' && r.key === 'swsh3-025|normal|' + r.version + '|NM|DE'), rep.slice(0, 2));
    // ohne die Kennzahlen des Dashboards (die haben eine eigene Prüfung in test_dashboard)
    const dw = (env.writesBy['Dashboard'] || 0) - d0;
    t.ok('Reparatur in Blöcken geschrieben (wenige Schreibvorgänge)', env.writes - w0 - dw <= 8, [env.writes - w0, dw]);
    t.ok('Gruppen: 15 neue Gruppen', env.groups().filter(g => /\|P\d+$/.test(g['Gruppenschlüssel'])).length === 15);
    checkSheets(env, 'nach Einfügen im Blatt');
    // wieder weg (direkt gelöscht), onEdit räumt Gruppen auf
    dsh.getRange(last + 1, 1, pasted.length, 30).clearContent();
    env.ctx.onEdit({ range: dsh.getRange(last + 1, 1) });
    t.ok('Gruppen nach dem Löschen wieder ohne die Zeilen', env.groups().filter(g => /\|P\d+$/.test(g['Gruppenschlüssel'])).length === 0);
    checkSheets(env, 'nach Löschen im Blatt');
  }
  // Liste im UI neu laden: Zusatzwert und neue Anzahl
  E.win.loadCollection();
  await E.settle();
  t.ok('UI nach Neuladen: 5 Stück swsh3-136', E.group(GB).count === 5);
  checkUiMatchesServer(E, 'nach onEdit');
  env.ctx.ansichtNeuAufbauen();
  t.ok('Ansicht neu aufbauen: Meldung', /Ansicht neu aufgebaut/.test(env.ui.alerts[env.ui.alerts.length - 1]), env.ui.alerts);
  t.ok('Ansicht neu aufbauen: Zusatzspalte bleibt', view.getRange(5, 17).getValue() === 'Ordner');
  env.ctx.apiPruefen();
  const chk = env.values('API-Check');
  t.ok('API prüfen läuft (Schritte 1 bis 14)', chk.length > 10 && chk.some(r => /^14\./.test(r[0])), chk.map(r => r[0]));
  t.ok('Sperre nie verschachtelt (gesamt)', env.lock.nested === 0, env.lock);
  env.promptResponse = 'https://script.google.com/macros/s/ABC/exec';
  env.ctx.webAppLinkAnzeigen();
  t.ok('Web-App-Link speichern (unverändert)', env.setting('WEBAPP_URL') === 'https://script.google.com/macros/s/ABC/exec' && /Gespeichert/.test(env.ui.alerts[env.ui.alerts.length - 1]));

  // ---- 13. Web-App (Handy): ohne Import, mit Bearbeiten ----
  t.section('Web-App');
  const W = boot(env, 'web');
  await W.settle();
  t.ok('Web: Import-Tab versteckt', W.$('tabImport').classList.contains('hidden'));
  W.win.showTab('import');
  t.ok('Web: ohne Import-Teil (#36 A3)', !W.$('paneImport') && typeof W.win.impInit === 'undefined');
  t.ok('Web: showTab(import) bleibt bei Hinzufügen', !W.$('paneAdd').classList.contains('hidden') && W.errors.length === 0, W.errors);
  await W.clickSettle(W.$('tabColl'));
  const wi = W.gIdx(GK);
  t.ok('Web: Sammlung lädt dieselben Gruppen', W.win.state.groups.length === E.win.state.groups.length && wi >= 0);
  W.expand(wi);
  const wg = W.group(GK);
  const wj = wg.rows.findIndex(r => r.eid === handA.eid);
  W.click(W.btns(W.$('gr' + wi), /^Bearbeiten$/)[wj]);
  W.pick(W.$('eCond' + wi), 'EX');
  await W.clickSettle(W.btn(W.$('ge' + wi), 'Speichern'));
  t.ok('Web: editEntry für alle (2 Stück, Wie viele = 2)', J(W.lastCall('editEntry').args) === J([handA.eid, { cond: 'EX' }, 2]), W.lastCall('editEntry'));
  t.ok('Web: Daten geändert', dataRows(env).find(r => r.eid === handA.eid).cond === 'EX');
  checkSheets(env, 'Web nach Bearbeiten');
  checkUiMatchesServer(W, 'Web nach Bearbeiten');
  await W.clickSettle(W.btn(W.$('gh' + W.gIdx(GK)), '−1'));
  t.ok('Web: −1 mit Auswahl', /Welches Exemplar\?/.test(W.$('gc' + W.gIdx(GK)).textContent));
  t.ok('keine Skriptfehler (Web)', W.errors.length === 0, W.errors);

  // ---- 13b. Umstieg: Blatt mit der alten Code.gs gebaut, dann neue Code.gs, Seitenleiste vor „Einrichtung“ ----
  t.section('Umstieg von der alten Version');
  {
    const backupDir = path.join(__dirname, '..', 'backup');
    const old = H.createEnv({ srcDir: backupDir, files: ['Code.gs'] });
    old.ctx.einrichtung();
    old.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
    old.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'reverse', condition: '', qty: 1 });
    old.ctx.addCard({ id: 'base1-4', lang: 'de', variant: 'base', condition: 'LP', qty: 1 });
    old.sheet('Sammlung').getRange('B4').setValue('Glurak');
    old.sheet('Sammlung').getRange('H4').setValue(true);
    t.ok('altes Blatt: Formel liest Daten!A2:W', /Daten!A2:W/.test(old.sheet('Sammlung').getRange('A6').getFormula()));
    const nu = makeEnv();
    // Blätter, Formate, Formeln und Eigenschaften übernehmen (wie: Code ersetzt, Tabelle bleibt)
    nu.ss.list.slice().forEach(s => nu.ss.deleteSheet(s));
    const clone = v => (v instanceof Date ? new Date(v.getTime()) : v);
    old.ss.list.forEach(s => {
      const n = nu.ss.insertSheet(s.name, { maxRows: s.maxRows, maxCols: s.maxCols });
      n.d = s.d.map(r => (r ? r.map(clone) : r));
      n.f = s.f.map(r => (r ? r.slice() : r));
      n.formulas = Object.assign({}, s.formulas);
      n.checkboxes = Object.assign({}, s.checkboxes);
      n.hidden = s.hidden; n.frozen = s.frozen;
    });
    Object.assign(nu.props, old.props);
    nu.triggers = old.triggers.slice();
    t.ok('vor dem Öffnen: Schema noch alt', !nu.props.SCHEMA_VERSION && nu.values('Daten')[0].length === 23);
    const U = boot(nu, 'sidebar');
    await U.settle();
    t.ok('Seitenleiste: getUiConfig stellt Daten um', nu.setting('SCHEMA_VERSION') === '2' && nu.values('Daten')[0][23] === 'Eintrag-ID', nu.values('Daten')[0]);
    const nd = nu.data();
    t.ok('alte Einträge: Schlüssel v2, Herkunft Hand', nd.length === 3 && nd.every(r => r.origin === 'Hand' && r.lang === 'DE' && /^E[0-9a-f]{10}$/.test(r.eid)) &&
      nd.map(r => r.key).join(',') === 'swsh3-025|normal||NM|DE,swsh3-025|reverse|||DE,base1-4|holo||LP|DE', nd.map(r => r.key));
    const vf = nu.sheet('Sammlung').getRange('A6').getFormula();
    t.ok('Sammlung: Formel gleich auf Gruppen umgestellt', /Gruppen!A2:AF,/.test(vf) && !/Daten!/.test(vf));
    t.ok('Sammlung: Suchfeld und Bilder-Schalter bleiben', nu.sheet('Sammlung').getRange('B4').getValue() === 'Glurak' && nu.sheet('Sammlung').getRange('H4').getValue() === true);
    t.ok('Sammlung: Spalte Exemplare statt Zustand', nu.sheet('Sammlung').getRange(5, 6).getValue() === 'Exemplare');
    t.ok('Gruppen: 3 Gruppen', nu.groups().length === 3);
    checkSheets(nu, 'nach Umstieg');
    await U.clickSettle(U.$('tabColl'));
    t.ok('Sammlung im UI: 3 Gruppen', U.win.state.groups.length === 3, U.win.state.groups.map(g => g.gkey));
    const ui0 = U.gIdx('swsh3-025|normal|');
    await U.clickSettle(U.btn(U.$('gh' + ui0), '−1'));
    t.ok('−1 auf alte Zeile geht', nu.data().find(r => r.key === 'swsh3-025|normal||NM|DE').count === 1);
    checkUiMatchesServer(U, 'nach Umstieg');
    t.ok('keine Skriptfehler (Umstieg)', U.errors.length === 0, U.errors);
  }

  // ---- 15. Fehlerpfade über die echte Brücke ----
  t.section('Fehlerpfade');
  await (async () => {
    const p = W.win.call('adjustEntry', 'Egibtsnicht', 1).then(() => 'ok', e => e.message);
    await W.settle();
    t.ok('unbekannte Eintrag-ID: deutsche Fehlermeldung', /Eintrag nicht gefunden/.test(await p));
    const p2 = W.win.call('setGroupOwnPrice', GK, '1,2x').then(() => 'ok', e => e.message);
    await W.settle();
    t.ok('ungültiger Preistext: Fehler', /gültigen Preis/.test(await p2));
    const p3 = W.win.call('addFreeCard', { name: '  ' }).then(() => 'ok', e => e.message);
    await W.settle();
    t.ok('freie Karte ohne Namen: Fehler', /Namen/.test(await p3));
  })();

  t.done();
})().catch(e => { console.log('FAIL Abbruch', e && e.stack || e); process.exitCode = 1; });
