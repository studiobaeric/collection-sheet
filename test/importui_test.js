// UI-Test für src/ImportUi.html (Import-Tab) mit jsdom.
// Ui.html wird wie von HtmlService ausgewertet (mode, include('ImportUi') -> echte ImportUi.html),
// google.script.run ist ein Stub, dessen Antworten aus einem Speicher-Server nach SPEC §6 kommen.
// Aufruf: node importui_test.js   (jsdom liegt in ./node_modules)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const UI_RAW = fs.readFileSync(path.join(SRC, 'Ui.html'), 'utf8');
const IMP_RAW = fs.readFileSync(path.join(SRC, 'ImportUi.html'), 'utf8');
const LT_Q = '<' + '?';
const MODE_LET = LT_Q + "!= mode ?>";
const INCLUDE_LET = LT_Q + "!= include('ImportUi') ?>";
const START_LET = LT_Q + '!= typeof start === "string" ? start : "" ?>';

let pass = 0, failCount = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok  ', label); }
  else { failCount++; console.log('FAIL', label, extra === undefined ? '' : String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 900)); }
}
const J = x => JSON.stringify(x);
const flush = async () => { for (let k = 0; k < 6; k++) await new Promise(r => setImmediate(r)); };

// feindliche Texte vom Server
const X1 = '<img src=x onerror="window.__xss=1">';
const X2 = '<script>window.__xss=2</scr' + 'ipt>';
const X3 = '<b id="xssb">fett</b>';

// ---------------------------------------------------------------------------
// Stub-Server (im Speicher), Formen wie SPEC §6 (plus Code.gs-Teile, die der Tab braucht)
// ---------------------------------------------------------------------------
const FIELDS = ['name', 'number', 'set', 'qty', 'variant', 'cond', 'lang', 'version', 'cmLink', 'tcgdexId', 'price', 'priceDate', 'check'];
function emptyCols() { const c = {}; FIELDS.forEach(f => { c[f] = -1; }); return c; }

function sampleRows() {
  const rows = [['Name', 'Nummer', 'Set', 'Anzahl', 'Ordner', X1, '']];
  for (let i = 2; i <= 24; i++) rows.push(['Karte ' + i, String(i) + '/165', 'Basis', '1', 'Seite ' + i, i === 3 ? X2 : 'n' + i, '']);
  rows.push(['Summe', '', '', '23', '', '', '']);
  return rows;
}

function makeServer() {
  const S = {
    driveService: true,
    busy: null,
    draft: null,
    uiCfg: { extras: ['Ordner', 'Notiz', X1 + 'Spalte'], viewExtras: ['Ordner'] },
    imports: [
      { nr: 4, date: '2026-10-14 18:30', sourceName: X1 + 'Ordner', sourceId: 'SRC1', tab: 'Karten', template: 'Ordner-Vorlage', mode: 'Nur Neues',
        status: 'aktiv', counts: { neu: 12, mehr: 3, weniger: 0, uebersprungen: 2, pruefOffen: 1 }, valueChange: 12.5, undoneAt: '' },
      { nr: 3, date: '2026-10-13', sourceName: 'Tauschliste', sourceId: 'SRC2', tab: X3, template: '', mode: 'abgleich',
        status: 'unterbrochen', counts: { neu: 1, mehr: 0, weniger: 1, uebersprungen: 0, pruefOffen: 0 }, valueChange: -2, undoneAt: '' },
      { nr: 2, date: '2026-10-12', sourceName: 'Alt', sourceId: 'SRC3', tab: 'T', template: '', mode: 'Alles addieren',
        status: 'zurückgenommen', counts: { neu: 4, mehr: 0, weniger: 0, uebersprungen: 0, pruefOffen: 0 }, valueChange: 3, undoneAt: '2026-10-13 09:00' },
      { nr: 1, date: '2026-10-11', sourceName: 'Läufer', sourceId: 'SRC4', tab: 'T', template: '', mode: 'neu',
        status: 'läuft', counts: {}, valueChange: 0, undoneAt: '' }
    ],
    tabs: [{ name: 'Karten', rows: 25, cols: 6 }, { name: X3, rows: 3, cols: 2, hidden: true }, { name: 'Leer', rows: 0, cols: 0 }],
    sample: sampleRows(),
    guess: { headerRow: 1, firstRow: 2, cols: Object.assign(emptyCols(), { name: 0, number: 1, set: 2, qty: 3 }) },
    templates: [
      { name: 'Ordner-Vorlage', mode: 'alle', cfg: { form: 'liste', headerRow: 1, firstRow: 2, lastRow: 0,
        cols: Object.assign(emptyCols(), { name: 0, number: 1, set: 2, qty: 3 }), fixed: { lang: 'EN', cond: '', variant: '', version: '' },
        extras: [{ col: 4, name: 'Ordner', show: true }], grid: {} } },
      { name: X2 + 'Alt', mode: 'neu', cfg: { form: 'checkliste', headerRow: 1, firstRow: 2, lastRow: 0,
        cols: Object.assign(emptyCols(), { name: 0, check: 3 }), fixed: {}, extras: [], grid: {} } }
    ],
    implShape: false, // true: importSelectTab liefert cfg mit (wie 10_quelle.gs)
    recog: { pos: 0, total: 5, per: 2, counts: { eindeutig: 2, unklar: 2, nichtGefunden: 1, uebersprungen: 0, bekannt: 0 } },
    review: null,
    searchImpl: null,
    cards: {
      'base1-58': { id: 'base1-58', lang: 'de', name: 'Pikachu', setName: 'Basis-Set', setId: 'base1', localId: '58', setSize: 102, image: 'https://img/p58' },
      'neo1-25': { id: 'neo1-25', lang: 'de', name: 'Pikachu', setName: 'Neo Genesis', setId: 'neo1', localId: '25', setSize: 111, image: 'https://img/neo25' }
    },
    log: []
  };

  S.reviewItems = () => [
    { fp: 'fpA', srcRows: [5, 9], qty: 2, status: 'unklar', reason: 'Mehrere Karten passen.', prefilled: false, confirmed: false, decision: null, card: null,
      values: { name: 'Pikachu Rev Holo', nameClean: 'Pikachu', number: '25', set: 'Basis', raw: { name: 'Pikachu Rev Holo', number: '25', set: 'Basis', cmLink: '' } },
      candidates: [
        { id: 'base1-58', lang: 'de', name: 'Pikachu', setName: 'Basis-Set', localId: '58', setSize: 102, image: 'https://img/p58' },
        { id: 'base2-60', lang: 'en', name: X1 + 'Pikachu', setName: 'Jungle', localId: '60', setSize: 64, image: '' }
      ] },
    { fp: 'fpB', srcRows: ['r3c2'], qty: 1, status: 'nicht gefunden', reason: X1 + 'kein Treffer', prefilled: false, confirmed: false, decision: null, card: null,
      values: { name: X1 + 'Mew', nameClean: X1 + 'Mew', number: '8', set: X3 }, candidates: [] },
    { fp: 'fpC', srcRows: [12], qty: 1, status: 'unklar', reason: 'Zwei Sets möglich.', prefilled: true, confirmed: false,
      decision: { type: 'karte', id: 'sv1-25', lang: 'de' },
      card: { id: 'sv1-25', name: 'Pikachu', setName: 'Karmesin', localId: '025', setSize: 198, variant: 'normal', img: '' },
      values: { name: 'Pikachu', nameClean: 'Pikachu', number: '25', set: 'SV' },
      candidates: [
        { id: 'sv1-25', lang: 'de', name: 'Pikachu', setName: 'Karmesin', localId: '025', setSize: 198, image: '' },
        { id: 'sv2-25', lang: 'de', name: 'Pikachu', setName: 'Entwicklungen', localId: '025', setSize: 193, image: '' }
      ] },
    { fp: 'fpD', srcRows: [14], qty: 1, status: 'nicht gefunden', reason: 'Kein Treffer.', prefilled: true, confirmed: false,
      decision: { type: 'frei' }, card: { free: true, name: 'Promo X', setName: 'Promo', localId: '7' },
      values: { name: 'Promo X', nameClean: 'Promo X', number: '7', set: 'Promo' }, candidates: [] }
  ];
  const openOf = items => items.filter(it => !(it.decision && it.confirmed)).length;

  S.preview = () => ({
    mode: 'neu', sourceName: X1 + 'Ordner', tab: 'Karten',
    counts: { neu: 5, mehr: 2, weniger: 1, uebersprungen: 1, pruefOffen: 1, bekannt: 3 },
    handMatch: [
      { fp: 'fpH1', title: 'Celebi', sub: 'Neo Revelation · 3/64 · Holo · DE', image: 'https://img/celebi', qty: 1, handCount: 1, choice: 'same' },
      { fp: 'fpH2', title: X1 + 'Nachtara', sub: 'Neo Discovery · 4/75 · Holo · DE', image: '', qty: 2, handCount: 1, choice: 'same' }
    ],
    removedByYou: [
      { fp: 'fpR1', title: 'Arktos', sub: 'Fossil · 2/62 · Holo · DE', qty: 1 },
      { fp: 'fpR2', title: X3 + 'Lavados', sub: 'Fossil · 12/62', qty: 2 }
    ],
    added: [
      { fp: 'fpN1', title: 'Pikachu', sub: 'Basis-Set · 58/102 · Normal · DE', image: 'https://img/p58', qty: 2, newGroup: true },
      { fp: 'fpN2', title: X2 + 'Glumanda', sub: 'Basis-Set · 46/102', image: '', qty: 1, newGroup: false }
    ],
    decreased: [{ eid: 'E1', title: 'Glurak', sub: 'Basis-Set · 4/102 · Holo · DE NM', qty: 1, fromImport: 3 }],
    skipped: [{ fp: 'fpS1', title: 'Zeile 9', reason: 'Von dir übersprungen' }],
    valueChange: 7.25
  });

  S.undoPreview = nr => ({
    nr, sourceName: X1 + 'Ordner', counts: { loeschen: 70, zurueck: 5, fehlt: 0 },
    changed: [
      { eid: 'E10', title: X1 + 'Glurak', sub: 'Basis-Set · 4/102', count: 1, changes: ['Zustand NM → LP'] },
      { eid: 'E11', title: 'Turtok', sub: 'Basis-Set · 2/102', count: 2, changes: ['Sonderversion', X3] }
    ],
    laterSameSource: [5], newTerms: []
  });

  // --- Code.gs-Teile ---
  S.getSetSuggestions = () => ['Basis-Set'];
  S.getUiConfig = () => ({
    conditions: ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].map(c => ({ code: c, label: c + ' Label' })),
    langs: [{ code: 'DE', label: 'Deutsch' }, { code: 'EN', label: 'Englisch' }, { code: 'JP', label: 'Japanisch' }],
    versions: ['Snowflake'], extras: S.uiCfg.extras.slice(), viewExtras: S.uiCfg.viewExtras.slice()
  });
  S.setViewExtras = names => { S.uiCfg.viewExtras = names.filter(n => S.uiCfg.extras.indexOf(n) >= 0); return { viewExtras: S.uiCfg.viewExtras.slice() }; };
  S.getCardBySetNumber = (setId, number) => {
    const c = Object.values(S.cards).find(x => x.setId === setId && String(x.localId) === String(number).split('/')[0]);
    if (!c) throw new Error('Nummer ' + number + ' gibt es in diesem Set nicht.');
    return Object.assign({}, c);
  };

  // --- Import, Teil Quelle ---
  S.importState = () => ({
    draft: S.draft ? Object.assign({}, S.draft) : null, imports: S.imports, busy: S.busy, driveService: S.driveService,
    templates: S.templates.map(t => ({ name: t.name, mode: t.mode }))
  });
  S.importOpenSource = url => {
    if (/kaputt/.test(url)) throw new Error('Die Datei wurde nicht gefunden, oder du hast keinen Zugriff darauf. Bitte prüfe den Link.');
    S.draft = { sourceId: 'SRC1', sourceName: X1 + 'Ordner', sourceUrl: url, kind: 'sheet', tmpId: '', tab: '', cfg: null, templateName: '', mode: 'neu', stage: 'tab', recognizePos: 0, total: 0 };
    return { sourceId: 'SRC1', sourceName: X1 + 'Ordner', kind: 'sheet', tabs: S.tabs };
  };
  S.importSelectTab = tab => {
    if (tab === 'Leer') throw new Error('Der Tab „Leer“ ist leer. Bitte wähle einen anderen Tab.');
    const sig = true;
    const templates = S.templates.map((t, i) => {
      const o = { name: t.name, matches: sig && i === 0, mode: t.mode };
      if (S.implShape) o.cfg = t.cfg;
      return o;
    });
    const res = { tab, nRows: S.sample.length, nCols: 6, sample: S.sample, guess: S.guess, templates, suggested: S.noSuggest ? null : 'Ordner-Vorlage' };
    if (S.implShape) res.cfg = S.noSuggest ? null : S.templates[0].cfg;
    return res;
  };
  S.importListTemplates = () => S.templates.map(t => ({ name: t.name, mode: t.mode, modeLabel: t.mode, cfg: t.cfg, signature: '', lastUsed: '' }));
  S.importPreviewRows = cfg => ({
    rows: [
      { srcRows: [2], fields: { name: 'Pikachu Rev Holo', nameClean: 'Pikachu', number: '25/165', set: 'Basis', qty: 2, variant: 'reverse', cond: 'NM', lang: 'DE', version: '', price: 1.5, priceDate: '', cmUrl: '', tcgdexId: '', extras: { Ordner: 'Seite 2' }, skip: null }, extras: { Ordner: 'Seite 2' }, skip: null },
      { srcRows: [3], fields: { name: X1, nameClean: X1, number: '3', set: X3, qty: 1, variant: '', cond: '', lang: 'DE', version: 'Snowflake', price: null, extras: {}, skip: null }, extras: {}, skip: null },
      { srcRows: [25], fields: { name: 'Summe', nameClean: 'Summe', number: '', set: '', qty: 23, extras: {}, skip: 'summe' }, extras: {}, skip: 'summe' }
    ],
    total: 24, skippedCounts: { summe: 1, leer: 0, nichtAngehakt: 0 }, cfgSeen: cfg
  });
  S.importSaveTemplate = (name, cfg, mode) => ({ name, mode, signature: 'x', templates: [] });
  S.importStartRecognition = (cfg, templateName, mode) => {
    S.recog.pos = 0;
    S.draft = Object.assign({}, S.draft || {}, { stage: 'erkennung', cfg, templateName, mode });
    return { total: S.recog.total, skipped: { summe: 1, leer: 2, nichtAngehakt: 0 } };
  };
  S.importDiscardDraft = () => { const had = !!S.draft; S.draft = null; return { ok: true, discarded: had }; };

  // --- Import, Teil Erkennung ---
  S.importRecognizeStep = () => {
    S.recog.pos = Math.min(S.recog.total, S.recog.pos + S.recog.per);
    const done = S.recog.pos >= S.recog.total;
    return { done, pos: S.recog.pos, total: S.recog.total, counts: Object.assign({}, S.recog.counts) };
  };
  S.importReviewList = () => {
    if (!S.review) S.review = S.reviewItems();
    return { items: JSON.parse(JSON.stringify(S.review)), open: openOf(S.review), total: S.review.length };
  };
  S.importReviewSearch = (fp, input) => {
    if (S.searchImpl) return S.searchImpl(fp, input);
    return { stage: 'name', cards: [S.cards['neo1-25']], notes: ['1 Treffer für ' + input.name] };
  };
  S.importReviewDecide = (fp, d) => {
    if (!S.review) S.review = S.reviewItems();
    const it = S.review.find(x => x.fp === fp);
    if (!it) throw new Error('Diese Zeile gibt es in der Prüfliste nicht mehr. Bitte die Liste neu laden.');
    if (d.type === 'karte') {
      const c = S.cards[d.id] || (it.candidates || []).find(x => x.id === d.id);
      if (!c) throw new Error('Karte ' + d.id + ' nicht gefunden.');
      it.decision = { type: 'karte', id: d.id, lang: d.lang || 'de' };
      it.card = { id: c.id, name: c.name, setName: c.setName, localId: c.localId, setSize: c.setSize, variant: 'normal', img: c.image };
    } else if (d.type === 'frei') {
      it.decision = { type: 'frei' }; it.card = { free: true, name: it.values.nameClean, setName: it.values.set, localId: it.values.number };
    } else if (d.type === 'skip') {
      it.decision = { type: 'skip' }; it.card = null;
    } else { it.decision = null; it.card = null; }
    it.confirmed = !!it.decision; it.prefilled = false;
    return { item: JSON.parse(JSON.stringify(it)), open: openOf(S.review) };
  };
  S.importReviewAcceptPrefilled = () => {
    S.review.forEach(it => { if (it.prefilled && it.decision) it.confirmed = true; });
    return { open: openOf(S.review) };
  };
  S.importSetsVorbelegen = () => '120 Sets vorbelegt, 80 davon mit Kürzel. ' + X1;

  // --- Import, Teil Protokoll ---
  S.importBuildPreview = () => S.preview();
  S.importCommit = choices => ({ nr: 5, counts: { neu: 5 }, message: 'Import 5 ist fertig: 7 Exemplare übernommen. ' + X3 });
  S.importResume = nr => ({ nr, counts: {}, message: 'Import ' + nr + ' ist fertig.' });
  S.importUndoPreview = nr => S.undoPreview(nr);
  S.importUndo = (nr, decisions) => {
    S.undoPreview(nr).changed.forEach(x => {
      if (decisions[x.eid] !== 'keep' && decisions[x.eid] !== 'remove') throw new Error('Bitte entscheide für jedes geänderte Exemplar, ob es bleibt.');
    });
    return { nr, deleted: 70, kept: 1, restored: 5, skipped: 0, message: 'Import ' + nr + ' ist zurückgenommen.' };
  };
  return S;
}

// ---------------------------------------------------------------------------
// Seite starten
// ---------------------------------------------------------------------------
function render(mode) {
  return UI_RAW.replace(MODE_LET, mode).replace(START_LET, '').replace(INCLUDE_LET, IMP_RAW);
}

function boot(mode, opts) {
  opts = opts || {};
  const S = opts.server || makeServer();
  if (opts.setup) opts.setup(S);
  const pending = [];
  const errors = [];
  const confirms = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', e => errors.push(String(e)));
  function makeRun() {
    let okH, failH;
    const t = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; } };
    const px = new Proxy(t, { get: (o, p) => p in o ? o[p] : (...args) => { pending.push({ fn: String(p), args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH }); } });
    return px;
  }
  const dom = new JSDOM(render(mode), {
    runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(win) {
      win.google = { script: { get run() { return makeRun(); } } };
      win.__confirmAnswer = true;
      win.confirm = msg => { confirms.push(String(msg)); return win.__confirmAnswer; };
    }
  });
  const win = dom.window, doc = win.document;
  const E = {
    S, win, doc, pending, errors, confirms,
    $: id => doc.getElementById(id),
    calls: fn => pending.filter(p => p.fn === fn),
    names: () => pending.map(p => p.fn),
    async respond(fn, o) {
      o = o || {};
      const list = pending.map((p, k) => [p, k]).filter(([p]) => p.fn === fn);
      if (!list.length) throw new Error('kein offener Aufruf ' + fn + ' (offen: ' + pending.map(p => p.fn).join(',') + ')');
      const [p, k] = o.last ? list[list.length - 1] : list[0];
      pending.splice(k, 1);
      let res, err = null;
      if ('value' in o) res = o.value;
      else if (o.error) err = o.error;
      else { try { res = S[fn].apply(null, p.args); } catch (e) { err = e.message; } }
      S.log.push({ fn, args: p.args });
      if (err != null) p.fail(new Error(err));
      else p.ok(res === undefined ? null : JSON.parse(JSON.stringify(res)));
      await flush();
      return { call: p, res, err };
    },
    async settle(max) {
      for (let n = 0; pending.length && n < (max || 50); n++) await E.respond(pending[0].fn);
    },
    btn(el, text) { return [...(el || doc).querySelectorAll('button')].find(b => b.textContent.trim() === text); },
    btns(el, text) { return [...(el || doc).querySelectorAll('button')].filter(b => b.textContent.trim() === text); },
    click(el) { if (!el) throw new Error('Element fehlt'); el.click(); },
    async clickFlush(el) { E.click(el); await flush(); },
    type(el, v) { if (!el) throw new Error('Feld fehlt'); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    change(el, v) { if (!el) throw new Error('Feld fehlt'); if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); },
    main: () => doc.getElementById('impMain'),
    text: () => doc.getElementById('paneImport').textContent,
    msg: () => doc.getElementById('impMsg').textContent,
    act: () => (doc.getElementById('impAct') || { textContent: '' }).textContent,
    errMsgs: () => [...doc.querySelectorAll('#paneImport .msg.err')].map(e => e.textContent),
    clean() {
      const pane = doc.getElementById('paneImport');
      return !win.__xss && !pane.querySelector('img[src="x"]') && !pane.querySelector('script') && !pane.querySelector('#xssb');
    },
    async startup() { await E.respond('getSetSuggestions'); await E.respond('getUiConfig'); await E.respond('getUpdateInfo', { value: null }); },
    async openImport() { E.click(E.$('tabImport')); await E.respond('importState'); },
    step() { const m = (E.main().querySelector('.imp-sub') || {}).textContent || ''; const r = m.match(/Schritt (\d) von 8/); return r ? Number(r[1]) : 0; },
    radioVal(name) { const r = [...doc.querySelectorAll('input[name="' + name + '"]')].find(x => x.checked); return r ? r.value : null; }
  };
  return E;
}

/**
 * Ende-zu-Ende mit den echten .gs-Dateien (nur mit REAL=1, da die Teile parallel entstehen):
 * erfundene Quelle, Assistent, Erkennung, Prüfliste, Vorschau, Import, Zurücknehmen.
 */
async function realServerFlow() {
  const H = require('./harness2');
  const files = ['Code.gs', '../parts/00_shared.gs', '../parts/10_quelle.gs', '../parts/20_erkennung.gs', '../parts/30_protokoll.gs'];
  let env;
  try {
    if (!files.slice(1).every(f => fs.existsSync(path.join(SRC, f)))) throw new Error('Teile fehlen');
    env = H.createEnv({ files });
  } catch (e) { ok('REAL: Serverteile laden', false, e.message); return; }
  console.log('\n# REAL: echte Serverteile');
  const c = env.ctx;
  c.setupAll_();
  try { c.uebersetzungUndSetsAktualisieren(); } catch (e) { /* Sets-Cache optional */ }
  c.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: '', qty: 1, inputName: 'Glurak' });
  const SID = 'SRCE2E0000001';
  env.addSource({ id: SID, name: 'Testordner', mime: 'sheet', tabs: { Karten: [
    ['Name', 'Nummer', 'Set', 'Anzahl', 'Notiz'],
    ['Glurak', '025/189', 'Flammende Finsternis', '1', 'Seite 1'],
    ['Glurak', '4', 'Grundset', '2', ''],
    ['Glurak', '', '', '1', 'lose'],
    ['Unbekannt', '', '', '1', 'X'],
    ['Summe', '', '', '5', '']
  ] } });
  const server = new Proxy({ log: [] }, { get: (o, fn) => (fn === 'log' ? o.log : (...args) => env.uiCall(String(fn), ...args)) });
  const R = boot('sidebar', { server });
  await R.settle();
  R.click(R.$('tabImport'));
  await R.settle();
  ok('REAL: Übersicht ohne Importe', /Noch keine Importe/.test(R.main().textContent), R.main().textContent.slice(0, 300));
  R.click(R.btn(R.main(), 'Neuer Import'));
  R.type(R.$('impUrl'), 'https://docs.google.com/spreadsheets/d/' + SID + '/edit');
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  ok('REAL: Schritt 2 mit Tab Karten', R.step() === 2 && R.radioVal('impTab') === 'Karten', R.text().slice(0, 300));
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  ok('REAL: Schritt 3', R.step() === 3 && R.$('impTpl').value === '', R.text().slice(0, 300));
  R.click(R.btn(R.main(), 'Weiter')); R.click(R.btn(R.main(), 'Weiter'));
  ok('REAL: Spalten geraten', R.$('impCol_name').value === '0' && R.$('impCol_number').value === '1' && R.$('impCol_set').value === '2' && R.$('impCol_qty').value === '3',
    ['name', 'number', 'set', 'qty'].map(f => R.$('impCol_' + f).value));
  R.click(R.btn(R.main(), 'Weiter'));
  R.click(R.main().querySelector('input[data-k="ex.c4.take"]'));
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  ok('REAL: Vorschau der Zeilen', /Summenzeile, wird übersprungen/.test(R.$('impPrev').textContent) && /Seite 1/.test(R.$('impPrev').textContent), R.$('impPrev').textContent.slice(0, 400));
  R.click(R.btn(R.main(), 'Weiter'));
  R.click(R.btn(R.main(), 'Erkennung starten'));
  await R.settle(200);
  const rvBoxes = [...R.main().querySelectorAll('.imp-rv')];
  ok('REAL: Prüfliste mit unklarem Glurak und Unbekannt', rvBoxes.length === 2 && /Glurak/.test(rvBoxes[0].textContent) && /Unbekannt/.test(rvBoxes[1].textContent),
    R.text().slice(0, 600));
  if (rvBoxes.length === 2) {
    const tile = [...rvBoxes[0].querySelectorAll('.tile')].find(t => /136/.test(t.textContent));
    R.click(tile);
    await R.settle();
    R.click(R.btn(R.main().querySelectorAll('.imp-rv')[1], 'Als freie Karte'));
    await R.settle();
    ok('REAL: 2 von 2 erledigt', R.$('impRvProg').textContent === '2 von 2 erledigt', R.$('impRvProg').textContent);
    R.click(R.btn(R.main(), 'Weiter zur Vorschau'));
    await R.settle();
  }
  ok('REAL: Vorschau mit "Schon von Hand erfasst"', /Schon von Hand erfasst \(1\)/.test(R.main().textContent) && !!R.$('impHmE0'), R.text().slice(0, 800));
  if (R.$('impHmE0')) R.click(R.$('impHmE0'));
  R.click(R.btn(R.main(), 'Importieren'));
  await R.settle();
  ok('REAL: Import fertig', /Import 1 ist fertig/.test(R.msg()) && R.main().querySelectorAll('.imp-imp').length === 1, R.text().slice(0, 600));
  const rows = env.data();
  ok('REAL: Daten mit Hand- und Importzeilen', rows.filter(r => r.origin === 'Import 1').length >= 4 && rows.filter(r => r.origin === 'Hand').length === 1 &&
    rows.some(r => r.extras && r.extras.Notiz === 'Seite 1'), rows.map(r => [r.id || r.name, r.origin, r.count]));
  R.click(R.btn(R.$('impImp0'), 'Zurücknehmen'));
  await R.settle();
  ok('REAL: Zurücknehmen-Vorschau', /Einträge werden gelöscht|Eintrag wird gelöscht/.test(R.$('impUdText') ? R.$('impUdText').textContent : '') && !R.$('impUdGo').disabled, R.text().slice(0, 500));
  R.click(R.$('impUdGo'));
  await R.settle();
  const after = env.data().filter(r => r.count > 0 || r.origin === 'Hand');
  ok('REAL: nach dem Zurücknehmen nur die Handzeile', /zurückgenommen/.test(R.msg()) && after.length === 1 && after[0].origin === 'Hand', env.data().map(r => [r.id || r.name, r.origin, r.count]));
  ok('REAL: Status zurückgenommen in der Liste', /zurückgenommen/.test(R.$('impImp0').textContent));

  // Wieder importieren: Vorlage passt, Weitermachen aus dem Banner, Antworten vom letzten Mal
  R.click(R.btn(R.main(), 'Neuer Import'));
  R.type(R.$('impUrl'), 'https://docs.google.com/spreadsheets/d/' + SID + '/edit');
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  ok('REAL: gespeicherte Vorlage passt und ist gewählt', R.step() === 3 && R.$('impTpl').value === 'Testordner · Karten' && /passt zu diesem Tab/.test(R.$('impTpl').textContent),
    R.$('impTpl') && R.$('impTpl').value);
  R.click(R.btn(R.main(), 'Weiter')); R.click(R.btn(R.main(), 'Weiter'));
  R.click(R.btn(R.main(), 'Zur Übersicht'));
  await R.settle();
  ok('REAL: Banner Import in Arbeit (Spalten zuordnen)', /Import in Arbeit/.test(R.main().textContent) && /Spalten zuordnen/.test(R.main().textContent), R.text().slice(0, 300));
  R.click(R.btn(R.main(), 'Weitermachen'));
  await R.settle();
  ok('REAL: Weitermachen -> Schritt 3 mit Vorlage', R.step() === 3 && R.$('impTpl').value === 'Testordner · Karten');
  for (let k = 0; k < 3; k++) R.click(R.btn(R.main(), 'Weiter'));
  ok('REAL: Zusatzspalte aus der Vorlage angehakt', R.step() === 6 && R.main().querySelector('input[data-k="ex.c4.take"]').checked);
  R.click(R.btn(R.main(), 'Weiter'));
  await R.settle();
  R.click(R.btn(R.main(), 'Weiter'));
  R.click(R.btn(R.main(), 'Erkennung starten'));
  await R.settle(200);
  const rv2 = [...R.main().querySelectorAll('.imp-rv')];
  ok('REAL: Prüfliste kommt vorbelegt zurück', rv2.length === 2 && rv2.every(b => /Deine Wahl vom letzten Mal/.test(b.textContent)) &&
    !!rv2[0].querySelector('.tile.imp-chosen') && !!R.btn(R.$('impRvAll'), 'Alle übernehmen'), R.text().slice(0, 600));
  if (R.btn(R.$('impRvAll'), 'Alle übernehmen')) {
    R.click(R.btn(R.$('impRvAll'), 'Alle übernehmen'));
    await R.settle();
  }
  ok('REAL: Alle übernehmen -> 2 von 2', R.$('impRvProg') && R.$('impRvProg').textContent === '2 von 2 erledigt');
  R.click(R.btn(R.main(), 'Weiter zur Vorschau'));
  await R.settle();
  R.click(R.btn(R.main(), 'Importieren'));
  await R.settle();
  ok('REAL: zweiter Import fertig', /Import 2 ist fertig/.test(R.msg()) && R.main().querySelectorAll('.imp-imp').length === 2, R.msg());

  // Einstellungen gegen getUiConfig/setViewExtras
  R.click(R.btn(R.main(), 'Einstellungen ▼'));
  await R.settle();
  const box = [...R.$('impVx').querySelectorAll('label.check')].find(l => /Notiz/.test(l.textContent));
  ok('REAL: Zusatzspalte Notiz in den Einstellungen', !!box, R.$('impVx').textContent);
  if (box) {
    const was = box.querySelector('input').checked;
    R.click(box.querySelector('input'));
    R.click(R.btn(R.$('impVx'), 'Anzeige speichern'));
    await R.settle();
    const vx = JSON.parse(env.setting('VIEW_EXTRAS') || '[]');
    ok('REAL: setViewExtras gespeichert', (vx.indexOf('Notiz') >= 0) === !was && /Gespeichert/.test(R.$('impSetMsg').textContent), [vx, was]);
  }
  ok('REAL: Sperre nie verschachtelt', env.lock.nested === 0, env.lock);
  ok('REAL: keine Skriptfehler', R.errors.length === 0, R.errors);
}

/** Assistent bis Schritt 3 (Vorlage) durchklicken */
async function toStep3(E) {
  E.click(E.btn(E.main(), 'Neuer Import'));
  E.type(E.$('impUrl'), 'https://docs.google.com/spreadsheets/d/SRC1/edit');
  E.click(E.btn(E.main(), 'Weiter'));
  await E.respond('importOpenSource');
  E.click(E.btn(E.main(), 'Weiter'));
  await E.respond('importSelectTab');
  if (E.calls('importListTemplates').length) await E.respond('importListTemplates');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(async () => {
  // ---- Datei: Aufbau, keine Scriptlets, keine Gedankenstriche, nur imp-Namen ----
  {
    ok('kein Scriptlet-Anfang in ImportUi.html', IMP_RAW.indexOf(LT_Q) < 0);
    ok('kein Gedankenstrich (U+2014) in ImportUi.html', IMP_RAW.indexOf('\u2014') < 0);
    const scripts = [...IMP_RAW.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    ok('genau ein <script>', scripts.length === 1);
    ok('genau ein <style>', (IMP_RAW.match(/<style\b/g) || []).length === 1);
    ok('div#paneImport class="panel hidden"', /<div id="paneImport" class="panel hidden">/.test(IMP_RAW));
    let err = null;
    try { new vm.Script(scripts[0], { filename: 'ImportUi.html' }); } catch (e) { err = e.message; }
    ok('Skript kompiliert', !err, err);
    const names = [...scripts[0].matchAll(/^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)|let\s+([A-Za-z0-9_$]+)|const\s+([A-Za-z0-9_$]+))/gm)]
      .map(m => m[1] || m[2] || m[3] || m[4]);
    ok('alle globalen Namen beginnen mit imp (' + names.length + ')', names.length > 50 && names.every(n => /^imp/.test(n)), names.filter(n => !/^imp/.test(n)));
    const uiGlobals = [...UI_RAW.matchAll(/^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+))/gm)].map(m => m[1] || m[2]);
    ok('keine Namensgleichheit mit Ui.html', names.every(n => uiGlobals.indexOf(n) < 0));
    // Vertrag: jede Serverfunktion, die der Tab aufruft
    const used = [...new Set([...scripts[0].matchAll(/(?:call|impAsk)\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]))].sort();
    const want = ['getCardBySetNumber', 'getUiConfig', 'importBuildPreview', 'importCommit', 'importDiscardDraft', 'importListTemplates',
      'importOpenSource', 'importPreviewRows', 'importRecognizeStep', 'importResume', 'importReviewAcceptPrefilled', 'importReviewDecide',
      'importReviewList', 'importReviewSearch', 'importSaveTemplate', 'importSelectTab', 'importSetsVorbelegen', 'importStartRecognition',
      'importState', 'importUndo', 'importUndoPreview', 'setViewExtras'];
    ok('Serveraufrufe genau wie erwartet', J(used) === J(want), used);
    ok('keine privaten Serverfunktionen (_)', used.every(n => !/_$/.test(n)));
    const parts = ['00_shared.gs', '10_quelle.gs', '20_erkennung.gs', '30_protokoll.gs'].map(f => path.join(__dirname, '..', 'parts', f));
    const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8') + parts.filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const defined = used.filter(n => new RegExp('^function ' + n + '\\(', 'm').test(code));
    console.log('     (schon in Code.gs/parts definiert: ' + defined.length + ' von ' + used.length + ')');
  }

  // ---- Web-Modus: lädt ohne Fehler, kein Import-Tab ----
  {
    const E = boot('web');
    ok('Web: nur Start-Aufrufe aus Ui.html', J(E.names().sort()) === J(['getSetSuggestions', 'getUiConfig', 'getUpdateInfo']), E.names());
    await E.startup();
    ok('Web: Import-Tab versteckt', E.$('tabImport').classList.contains('hidden'));
    ok('Web: paneImport vorhanden und versteckt', !!E.$('paneImport') && E.$('paneImport').classList.contains('hidden'));
    E.win.showTab('import');
    ok('Web: showTab(import) bleibt bei Hinzufügen, kein impInit', !E.$('paneAdd').classList.contains('hidden') &&
      E.$('paneImport').classList.contains('hidden') && E.win.impInitCalls === 0 && E.pending.length === 0, E.names());
    ok('Web: keine Skriptfehler', E.errors.length === 0, E.errors);
  }

  // ---- Seitenleiste: Laden ohne Serveraufrufe aus ImportUi ----
  const E = boot('sidebar', { setup: S => { S.draft = { sourceId: 'SRC1', sourceName: X1 + 'Ordner', sourceUrl: 'https://docs.google.com/spreadsheets/d/SRC1/edit', kind: 'sheet', tab: 'Karten', stage: 'pruefung', mode: 'neu', total: 5, recognizePos: 5 }; } });
  const { $ } = E;
  ok('Sidebar: beim Laden nur getSetSuggestions, getUiConfig, getUpdateInfo', J(E.names().sort()) === J(['getSetSuggestions', 'getUiConfig', 'getUpdateInfo']), E.names());
  await E.startup();
  ok('Sidebar: Import-Tab sichtbar, Bereich noch leer', !$('tabImport').classList.contains('hidden') && $('impMain').innerHTML === '');
  ok('Sidebar: impInit noch nicht aufgerufen', E.win.impInitCalls === 0);

  // ---- Übersicht ----
  E.click($('tabImport'));
  ok('Import-Tab: impInit ruft importState genau einmal', E.calls('importState').length === 1 && E.pending.length === 1, E.names());
  ok('Übersicht: Spinner während des Ladens', /Lade die Importe/.test(E.main().textContent));
  await E.respond('importState');
  ok('Übersicht: 4 Importe', E.main().querySelectorAll('.imp-imp').length === 4);
  const imp0 = $('impImp0'), imp1 = $('impImp1'), imp2 = $('impImp2'), imp3 = $('impImp3');
  ok('aktiv: nur Zurücknehmen', E.btns(imp0, 'Zurücknehmen').length === 1 && !E.btn(imp0, 'Fortsetzen'));
  ok('unterbrochen: Fortsetzen + Zurücknehmen', !!E.btn(imp1, 'Fortsetzen') && !!E.btn(imp1, 'Zurücknehmen') && /nicht fertig/.test(imp1.textContent));
  ok('zurückgenommen: keine Knöpfe, Datum', imp2.querySelectorAll('button').length === 0 && /zurückgenommen am 13\.10\.2026 09:00/.test(imp2.textContent), imp2.textContent);
  ok('läuft: keine Knöpfe', imp3.querySelectorAll('button').length === 0 && /Läuft gerade/.test(imp3.textContent));
  ok('Zeile: Nr, Datum, Quelle, Modus, Zahlen, Wert', /Import 4 · 14\.10\.2026 18:30/.test(imp0.textContent) && imp0.textContent.indexOf(X1 + 'Ordner · Tab Karten · Nur Neues') >= 0 &&
    /12 neu, 3 mehr, 2 übersprungen, 1 in der Prüfliste offen · Wert \+12,50/.test(imp0.textContent), imp0.textContent);
  ok('Modus-Code wird zum Text (abgleich)', /Mit Quelle abgleichen/.test(imp1.textContent) && /Wert −2,00/.test(imp1.textContent), imp1.textContent);
  ok('Banner: Import in Arbeit mit Weitermachen/Verwerfen', /Import in Arbeit:/.test(E.main().textContent) && !!E.btn(E.main(), 'Weitermachen') && !!E.btn(E.main(), 'Verwerfen'));
  ok('Banner: Stand Prüfliste', /Stand: Prüfliste/.test(E.main().querySelector('.imp-banner').textContent));
  ok('Übersicht: Neuer Import, Einstellungen zu', !!E.btn(E.main(), 'Neuer Import') && !!E.btn(E.main(), 'Einstellungen ▼') && !$('impVx'));
  ok('Übersicht: feindliche Namen escaped', E.clean() && E.main().textContent.indexOf(X3) >= 0);

  // Tab-Wechsel auf der Übersicht lädt neu; ältere Antwort zählt nicht
  E.click($('tabAdd'));
  E.click($('tabImport'));
  ok('erneut geöffnet: importState neu', E.calls('importState').length === 1);
  E.click($('tabAdd'));
  E.click($('tabImport'));
  ok('zweimal geöffnet: zwei offene importState', E.calls('importState').length === 2);
  await E.respond('importState', { last: true, value: Object.assign(E.S.importState(), { imports: [E.S.imports[0]] }) });
  await E.respond('importState', { value: E.S.importState() });
  ok('veraltete importState-Antwort verworfen', E.main().querySelectorAll('.imp-imp').length === 1);
  ok('impInit gezählt', E.win.impInitCalls === 3);

  // ---- Einstellungen ----
  E.click(E.btn(E.main(), 'Einstellungen ▼'));
  ok('Einstellungen: getUiConfig geladen', E.calls('getUiConfig').length === 1 && /Lade die Zusatzspalten/.test($('impVx').textContent));
  await E.respond('getUiConfig');
  const vx = [...$('impVx').querySelectorAll('input[type=checkbox]')];
  ok('Einstellungen: Checkbox je Zusatzspalte, Ansicht vorbelegt', vx.length === 3 && vx[0].checked && !vx[1].checked && !vx[2].checked);
  ok('Einstellungen: Spaltennamen escaped, Hinweis auf Blätter', E.clean() && $('impVx').textContent.indexOf(X1 + 'Spalte') >= 0 &&
    /Import-Begriffe/.test(E.main().textContent) && /Import-Sets/.test(E.main().textContent));
  E.click(vx[0]); E.click(vx[1]);
  E.click(E.btn($('impVx'), 'Anzeige speichern'));
  E.click(E.btn($('impVx'), 'Anzeige speichern'));
  ok('Anzeige speichern: setViewExtras(["Notiz"]) einmal', E.calls('setViewExtras').length === 1 && J(E.calls('setViewExtras')[0].args) === J([['Notiz']]), E.calls('setViewExtras').map(c => c.args));
  await E.respond('setViewExtras');
  ok('Anzeige gespeichert: Meldung + loadUiConfig', /Gespeichert\. Die Sammlung zeigt jetzt: Notiz\./.test($('impSetMsg').textContent) && E.calls('getUiConfig').length === 1);
  await E.respond('getUiConfig');
  E.click(E.btn(E.main(), 'Set-Zuordnung vorbelegen'));
  ok('Vorbelegen: importSetsVorbelegen mit Spinner', E.calls('importSetsVorbelegen').length === 1 && /Belege die Set-Zuordnung vor/.test($('impSetMsg').textContent));
  ok('Vorbelegen: Knöpfe gesperrt', E.btn(E.main(), 'Neuer Import').disabled && E.btn(E.main(), 'Set-Zuordnung vorbelegen').disabled);
  await E.respond('importSetsVorbelegen');
  ok('Vorbelegen: Meldung escaped, Knöpfe wieder frei', /120 Sets vorbelegt/.test($('impSetMsg').textContent) && E.clean() && !E.btn(E.main(), 'Neuer Import').disabled);
  E.click(E.btn(E.main(), 'Set-Zuordnung vorbelegen'));
  await E.respond('importSetsVorbelegen', { error: 'Der Set-Cache ist leer. Bitte zuerst „Pokémon > Übersetzung und Sets aktualisieren“ ausführen.' });
  ok('Vorbelegen: Fehler deutsch in den Einstellungen', /Der Set-Cache ist leer/.test($('impSetMsg').textContent) && $('impSetMsg').querySelector('.msg.err'));
  E.click(E.btn(E.main(), 'Einstellungen ▲'));
  ok('Einstellungen zuklappen', !$('impVx'));

  // ---- Banner: Verwerfen ----
  E.win.__confirmAnswer = false;
  E.click(E.btn(E.main(), 'Verwerfen'));
  ok('Verwerfen: Rückfrage, abgelehnt -> kein Aufruf', E.confirms.length === 1 && E.pending.length === 0);
  E.win.__confirmAnswer = true;
  E.click(E.btn(E.main(), 'Verwerfen'));
  E.click(E.btn(E.main(), 'Verwerfen'));
  ok('Verwerfen: importDiscardDraft genau einmal', E.calls('importDiscardDraft').length === 1 && E.confirms.length === 2, E.names());
  await E.respond('importDiscardDraft');
  ok('Verwerfen: zurück zur Übersicht (importState)', E.calls('importState').length === 1 && /verworfen/.test(E.msg()));
  await E.respond('importState');
  ok('kein Banner mehr', !E.main().querySelector('.imp-banner'));

  // ---- Fortsetzen ----
  E.click(E.btn($('impImp1'), 'Fortsetzen'));
  ok('Fortsetzen: importResume(3)', E.calls('importResume').length === 1 && J(E.calls('importResume')[0].args) === J([3]) && /Setze Import 3 fort/.test(E.act()));
  await E.respond('importResume');
  ok('Fortsetzen: loadUiConfig + importState, Meldung', E.calls('getUiConfig').length === 1 && E.calls('importState').length === 1 && /Import 3 ist fertig/.test(E.msg()));
  await E.settle();

  // ---- Assistent ----
  E.click(E.btn(E.main(), 'Neuer Import'));
  ok('ohne Entwurf: keine Rückfrage', E.confirms.length === 2);
  ok('Schritt 1: Quelle', E.step() === 1 && !!$('impUrl') && /Drive API/.test(E.main().textContent));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 1: leerer Link -> Fehler, kein Aufruf', /Bitte füge den Link/.test(E.act()) && E.pending.length === 0);
  E.type($('impUrl'), 'https://drive.google.com/kaputt');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 1: Spinner beim Öffnen', /Öffne die Tabelle/.test(E.act()) && E.btn(E.main(), 'Weiter').disabled);
  await E.respond('importOpenSource');
  ok('Schritt 1: Serverfehler deutsch, Link bleibt', E.step() === 1 && /Datei wurde nicht gefunden/.test(E.act()) && $('impUrl').value === 'https://drive.google.com/kaputt');
  const URL1 = 'https://docs.google.com/spreadsheets/d/SRC1/edit';
  E.type($('impUrl'), URL1);
  E.click(E.btn(E.main(), 'Weiter'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Doppelklick Weiter: importOpenSource einmal mit Link', E.calls('importOpenSource').length === 1 && J(E.calls('importOpenSource')[0].args) === J([URL1]));
  // Tab-Wechsel mitten im Assistenten: Ansicht bleibt
  E.click($('tabAdd')); E.click($('tabImport'));
  ok('Tab-Wechsel während einer Anfrage: kein neues importState', E.calls('importState').length === 0);
  await E.respond('importOpenSource');
  ok('Schritt 2: Tabs mit Zeilen, erster sichtbarer vorausgewählt', E.step() === 2 && E.radioVal('impTab') === 'Karten' &&
    /25 Zeilen, 6 Spalten/.test(E.main().textContent) && /ausgeblendet/.test(E.main().textContent));
  ok('Schritt 2: Datei- und Tabnamen escaped', E.clean() && E.main().textContent.indexOf(X3) >= 0 && E.main().textContent.indexOf(X1 + 'Ordner') >= 0);
  E.click($('tabAdd')); E.click($('tabImport'));
  ok('Tab-Wechsel im Assistenten: Schritt bleibt, kein importState', E.step() === 2 && E.calls('importState').length === 0);
  E.click(E.btn(E.main(), 'Zurück'));
  ok('Zurück zu Schritt 1: Link bleibt', E.step() === 1 && $('impUrl').value === URL1);
  E.click(E.btn(E.main(), 'Weiter'));
  ok('gleicher Link: kein neuer Aufruf', E.step() === 2 && E.pending.length === 0);
  // leerer Tab -> Fehler
  E.click([...E.main().querySelectorAll('input[name=impTab]')].find(r => r.value === 'Leer'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Tab Leer: importSelectTab("Leer")', J(E.calls('importSelectTab')[0].args) === J(['Leer']));
  await E.respond('importSelectTab');
  ok('Tab Leer: Fehler, bleibt in Schritt 2', E.step() === 2 && /ist leer/.test(E.act()));
  E.click([...E.main().querySelectorAll('input[name=impTab]')].find(r => r.value === 'Karten'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Tab Karten: importSelectTab("Karten")', J(E.calls('importSelectTab')[0].args) === J(['Karten']) && /Lese den Tab/.test(E.act()));
  await E.respond('importSelectTab');
  ok('Schritt 3: passende Vorlage vorausgewählt (SPEC-Form ohne cfg -> importListTemplates)', E.step() === 3 && $('impTpl').value === 'Ordner-Vorlage' &&
    E.calls('importListTemplates').length === 1);
  await E.respond('importListTemplates');
  const tplOpts = [...$('impTpl').options].map(o => o.textContent);
  ok('Schritt 3: Optionen Neue Vorlage + Vorlagen, Treffer markiert, escaped', tplOpts.length === 3 && /Neue Vorlage/.test(tplOpts[0]) &&
    /passt zu diesem Tab/.test(tplOpts[1]) && tplOpts[2].indexOf(X2 + 'Alt') === 0 && E.clean(), tplOpts);
  ok('Schritt 3: Modus der Vorlage (Alles addieren)', /Modus der Vorlage: Alles addieren/.test(E.main().textContent));
  ok('Vorlage: cfg übernommen', E.win.impS.wiz.cfg.fixed.lang === 'EN' && E.win.impS.wiz.cfg.extras.length === 1);
  E.change($('impTpl'), '');
  ok('Neue Vorlage: Spalten aus guess, Modus Nur Neues', E.win.impS.wiz.cfg.fixed.lang === 'DE' && E.win.impS.wiz.cfg.extras.length === 0 &&
    E.win.impS.wiz.cfg.cols.name === 0 && E.win.impS.wiz.mode === 'neu' && E.pending.length === 0);
  E.change($('impTpl'), 'Ordner-Vorlage');
  await E.respond('importListTemplates');
  ok('wieder Vorlage gewählt', $('impTpl').value === 'Ordner-Vorlage' && E.win.impS.wiz.cfg.extras[0].name === 'Ordner' && E.win.impS.wiz.mode === 'alle');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 4: Form Liste', E.step() === 4 && E.radioVal('impForm') === 'liste' && !$('impG_blockRows'));
  E.click([...E.main().querySelectorAll('input[name=impForm]')].find(r => r.value === 'raster'));
  ok('Raster: Blockfelder sichtbar', !!$('impG_blockRows') && !!$('impC_name') && !!E.main().querySelector('.imp-tbl'));
  E.change($('impG_blockRows'), '3');
  ok('Raster: 3 Zeilen pro Block -> Zellen bis Zeile 3', [...$('impC_set').options].some(o => /^Zeile 3, Spalte 1/.test(o.textContent)));
  ok('Raster: Beispielwert aus dem ersten Block', [...$('impC_name').options].some(o => /Zeile 1, Spalte 1: Karte 2/.test(o.textContent)), [...$('impC_name').options].map(o => o.textContent));
  E.change($('impC_set'), '2,0');
  ok('Raster: Zelle für Set gemerkt', J(E.win.impS.wiz.cfg.grid.cells.set) === J([2, 0]));
  E.change($('impG_blockRows'), '2');
  ok('Raster: kleinerer Block vergisst Zelle außerhalb', !E.win.impS.wiz.cfg.grid.cells.set && J(E.win.impS.wiz.cfg.grid.cells.name) === J([0, 0]));
  E.change($('impC_name'), '');
  E.change($('impC_number'), '');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Raster ohne Name/Nummer: Fehler', E.step() === 4 && /Name oder Nummer im Block/.test(E.act()));
  E.click([...E.main().querySelectorAll('input[name=impForm]')].find(r => r.value === 'liste'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 5: Zuordnung', E.step() === 5 && !!$('impCol_name') && !$('impCol_check'));
  const nameOpts = [...$('impCol_name').options].map(o => o.textContent);
  ok('Schritt 5: Optionen "– keine –" und "A · Name"', nameOpts[0] === '– keine –' && nameOpts[1] === 'A · Name' && nameOpts[2] === 'B · Nummer', nameOpts);
  ok('Schritt 5: Kopfzeile, erste Datenzeile, letzte Zeile leer', $('impHr').value === '1' && $('impFr').value === '2' && $('impLr').value === '' && /bis zum Ende/.test(E.main().textContent));
  ok('Schritt 5: Werte aus der Vorlage', $('impCol_name').value === '0' && $('impCol_number').value === '1' && $('impCol_qty').value === '3' && $('impCol_cond').value === '-1');
  const tbl = E.main().querySelector('.imp-tbl');
  ok('Schritt 5: Rohdaten-Tabelle mit 25 Zeilen, Kopfzeile markiert', tbl && tbl.querySelectorAll('tr').length === 26 && tbl.querySelector('tr.imp-hr'));
  ok('Schritt 5: Zelltexte escaped', E.clean() && tbl.textContent.indexOf(X2) >= 0);
  E.change($('impCol_cond'), '6');
  E.change($('impHr'), '0');
  ok('Kopfzeile 0: Optionen nur Buchstaben', [...$('impCol_name').options][1].textContent === 'A');
  E.change($('impHr'), '1');
  E.change($('impLr'), '20');
  E.click(E.btn(E.main(), 'Zurück'));
  E.click(E.btn(E.main(), 'Zurück'));
  ok('zurück bis Schritt 3, Vorlage bleibt', E.step() === 3 && $('impTpl').value === 'Ordner-Vorlage' && E.pending.length === 0);
  E.click(E.btn(E.main(), 'Weiter'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('wieder Schritt 5: Eingaben behalten', E.step() === 5 && $('impCol_cond').value === '6' && $('impLr').value === '20' && $('impHr').value === '1');
  // Prüfung: keine Erkennungsspalte
  ['name', 'number', 'cmLink', 'tcgdexId'].forEach(f => E.change($('impCol_' + f), '-1'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('ohne Name/Nummer/Link/ID: Fehler', E.step() === 5 && /mindestens eine Spalte/.test(E.act()));
  E.change($('impCol_name'), '0');
  E.change($('impCol_number'), '1');
  E.change($('impFr'), '1');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('erste Datenzeile über Kopfzeile: Fehler', E.step() === 5 && /unter der Kopfzeile/.test(E.act()));
  E.change($('impFr'), '2');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 6: feste Werte aus der Vorlage', E.step() === 6 && $('impFxLang').value === 'EN' && $('impFxCond').value === '' && $('impFxVar').value === '');
  const exBoxes = [...E.main().querySelectorAll('.box h3')].map(h => h.textContent);
  ok('Schritt 6: Zusatzspalten nur für freie Spalten (E, F)', exBoxes.length === 2 && /^Spalte E · Ordner/.test(exBoxes[0]) && exBoxes[1].indexOf('Spalte F · ' + X1) === 0 && E.clean(), exBoxes);
  ok('Schritt 6: Ordner aus der Vorlage angehakt, gezeigt', $('impExT0').checked && $('impExN0').value === 'Ordner' && $('impExS0').checked && !$('impExT1').checked && $('impExN1').value === X1);
  E.click($('impExT1'));
  E.type($('impExN1'), 'ordner');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('gleiche Namen: Fehler', E.step() === 6 && /Zwei Zusatzspalten heißen/.test(E.act()));
  E.type($('impExN1'), 'Name');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Name einer festen Spalte: Fehler', E.step() === 6 && /feste Spalte/.test(E.act()));
  E.type($('impExN1'), 'Notiz');
  E.change($('impFxCond'), 'NM');
  E.type($('impFxVer'), 'Snowflake');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 7: importPreviewRows mit Spinner', E.step() === 7 && E.calls('importPreviewRows').length === 1 && /Lese die ersten Zeilen/.test($('impPrev').textContent));
  const cfg7 = E.calls('importPreviewRows')[0].args[0];
  ok('cfg: Liste, Zuordnung, letzte Zeile', cfg7.form === 'liste' && cfg7.headerRow === 1 && cfg7.firstRow === 2 && cfg7.lastRow === 20 &&
    cfg7.cols.name === 0 && cfg7.cols.number === 1 && cfg7.cols.cond === 6 && cfg7.cols.qty === 3 && cfg7.cols.check === -1, cfg7);
  ok('cfg: feste Werte', J(cfg7.fixed) === J({ lang: 'EN', cond: 'NM', variant: '', version: 'Snowflake' }), cfg7.fixed);
  ok('cfg: Zusatzspalten (Ordner aus der Vorlage, Notiz neu)', J(cfg7.extras) === J([{ col: 4, name: 'Ordner', show: true }, { col: 5, name: 'Notiz', show: false }]), cfg7.extras);
  await E.respond('importPreviewRows');
  const prevRows = [...$('impPrev').querySelectorAll('tr')];
  ok('Vorschau: 3 Zeilen + Kopf, Felder und Übersprungen-Grund', prevRows.length === 4 && /Pikachu/.test(prevRows[1].textContent) &&
    /Reverse Holo/.test(prevRows[1].textContent) && /Ordner: Seite 2/.test(prevRows[1].textContent) && /Summenzeile, wird übersprungen/.test(prevRows[3].textContent) &&
    prevRows[3].classList.contains('imp-skip'), prevRows.map(r => r.textContent));
  ok('Vorschau: Zusammenfassung', /24 Zeilen gelesen, davon 23 mit Karten\. Übersprungen: 1 Summenzeile\./.test($('impPrev').textContent), $('impPrev').textContent);
  ok('Vorschau: escaped', E.clean() && $('impPrev').textContent.indexOf(X1) >= 0);
  // veraltete Vorschau-Antwort
  E.click(E.btn(E.main(), 'Zurück'));
  ok('zurück zu 6: Eingaben behalten', E.step() === 6 && $('impExT1').checked && $('impExN1').value === 'Notiz' && $('impFxCond').value === 'NM' && $('impFxVer').value === 'Snowflake');
  E.click($('impExS1'));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('geänderte cfg: neue Vorschau', E.calls('importPreviewRows').length === 1 && J(E.calls('importPreviewRows')[0].args[0].extras) ===
    J([{ col: 4, name: 'Ordner', show: true }, { col: 5, name: 'Notiz', show: true }]), E.calls('importPreviewRows').map(c => c.args[0].extras));
  E.click(E.btn(E.main(), 'Zurück'));
  E.change($('impFxVar'), 'holo');
  E.click(E.btn(E.main(), 'Weiter'));
  ok('zwei Vorschauen offen', E.calls('importPreviewRows').length === 2);
  await E.respond('importPreviewRows', { value: { rows: [{ srcRows: [99], fields: { name: 'ALT' }, skip: null }], total: 1, skippedCounts: {} } });
  ok('ältere Vorschau-Antwort verworfen', !/ALT/.test($('impPrev').textContent) && /Lese die ersten Zeilen/.test($('impPrev').textContent));
  await E.respond('importPreviewRows');
  ok('neueste Vorschau gezeigt', /Pikachu/.test($('impPrev').textContent));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('Schritt 8: Name der Vorlage vorbelegt, Modus aus der Vorlage', E.step() === 8 && $('impSaveName').value === 'Ordner-Vorlage' && E.radioVal('impMode') === 'alle');
  ok('Schritt 8: Nur Neues (Standard) und Erklärungen', /Nur Neues \(Standard\)/.test(E.main().textContent) && /Mit Quelle abgleichen/.test(E.main().textContent));
  E.click([...E.main().querySelectorAll('input[name=impMode]')].find(r => r.value === 'abgleich'));
  E.type($('impSaveName'), '  Mein   Ordner ');
  E.click(E.btn(E.main(), 'Zurück'));
  ok('zurück zu 7: Vorschau ohne neuen Aufruf', E.step() === 7 && E.pending.length === 0 && /Pikachu/.test($('impPrev').textContent));
  E.click(E.btn(E.main(), 'Weiter'));
  ok('wieder Schritt 8: Name und Modus behalten', $('impSaveName').value === '  Mein   Ordner ' && E.radioVal('impMode') === 'abgleich');
  E.click(E.btn(E.main(), 'Erkennung starten'));
  E.click(E.btn(E.main(), 'Erkennung starten'));
  ok('Erkennung starten: importSaveTemplate einmal (Name getrimmt, cfg, Modus)', E.calls('importSaveTemplate').length === 1 &&
    E.calls('importSaveTemplate')[0].args[0] === 'Mein Ordner' && E.calls('importSaveTemplate')[0].args[2] === 'abgleich' &&
    E.calls('importSaveTemplate')[0].args[1].fixed.variant === 'holo' && /Speichere die Vorlage/.test(E.act()));
  await E.respond('importSaveTemplate');
  ok('danach importStartRecognition(cfg, name, mode)', E.calls('importStartRecognition').length === 1 &&
    J(E.calls('importStartRecognition')[0].args.slice(1)) === J(['Mein Ordner', 'abgleich']) &&
    J(E.calls('importStartRecognition')[0].args[0]) === J(E.S.log[E.S.log.length - 1].args[1]));
  await E.respond('importStartRecognition', { error: 'In den gewählten Zeilen wurde keine Karte gefunden.' });
  ok('Start-Fehler: bleibt in Schritt 8 mit Meldung, Knopf wieder frei', E.step() === 8 && /keine Karte gefunden/.test(E.act()) && !E.btn(E.main(), 'Erkennung starten').disabled);
  E.type($('impSaveName'), '');
  E.click(E.btn(E.main(), 'Erkennung starten'));
  ok('ohne Namen: keine Vorlage speichern', E.calls('importSaveTemplate').length === 0 && E.calls('importStartRecognition').length === 1 &&
    E.calls('importStartRecognition')[0].args[1] === '');
  await E.respond('importStartRecognition');

  // ---- Erkennung ----
  ok('Erkennung: Ansicht + erster Schritt', /Erkennung/.test(E.main().querySelector('h2').textContent) && E.calls('importRecognizeStep').length === 1 &&
    /0 von 5 Einträgen/.test(E.main().textContent) && /1 Summenzeile, 2 leer/.test(E.main().textContent));
  await E.respond('importRecognizeStep');
  ok('Erkennung: Fortschritt 2 von 5, nächster Schritt läuft', /2 von 5 Einträgen erkannt/.test($('impErkPos').textContent) && E.calls('importRecognizeStep').length === 1 &&
    E.main().querySelector('.imp-bar div').style.width === '40%' && /2 eindeutig, 2 unklar, 1 nicht gefunden/.test(E.main().textContent));
  await E.respond('importRecognizeStep', { error: 'tcgdex ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.' });
  ok('Erkennung: Fehler mit Nochmal versuchen', /tcgdex ist gerade nicht erreichbar/.test(E.act()) && !!E.btn(E.main(), 'Nochmal versuchen') && E.pending.length === 0);
  E.click(E.btn(E.main(), 'Nochmal versuchen'));
  E.click(E.btn(E.main(), 'Nochmal versuchen') || E.main());
  ok('Nochmal versuchen: ein neuer Schritt', E.calls('importRecognizeStep').length === 1);
  await E.respond('importRecognizeStep', { error: 'Exceeded maximum execution time' });
  ok('englischer Zeitfehler wird deutsch', /zu lange gedauert/.test(E.act()));
  E.click(E.btn(E.main(), 'Nochmal versuchen'));
  await E.respond('importRecognizeStep');
  await E.respond('importRecognizeStep');
  ok('Erkennung fertig mit unklaren Zeilen -> Prüfliste', E.calls('importReviewList').length === 1 && /Erkennung fertig: 2 eindeutig, 2 unklar, 1 nicht gefunden\./.test(E.msg()));
  await E.respond('importReviewList');

  // ---- Prüfliste ----
  const rv = () => [...E.main().querySelectorAll('.imp-rv')];
  ok('Prüfliste: 4 Zeilen, 0 von 4 erledigt', rv().length === 4 && $('impRvProg').textContent === '0 von 4 erledigt');
  ok('Prüfliste: Originalwerte, Zeilen, Grund', /Zeilen 5, 9 · 2 Stück/.test(rv()[0].textContent) && /Name: Pikachu Rev Holo · Nummer: 25 · Set: Basis/.test(rv()[0].textContent) &&
    /Mehrere Karten passen/.test(rv()[0].textContent) && /Zeile 3\/B/.test(rv()[1].textContent), rv()[1].textContent);
  ok('Prüfliste: Kandidaten-Kacheln mit Bild', rv()[0].querySelectorAll('.tile').length === 2 && rv()[0].querySelector('.tile img').getAttribute('src') === 'https://img/p58/low.webp' &&
    /englische Daten/.test(rv()[0].querySelectorAll('.tile')[1].textContent));
  ok('Prüfliste: Deine Wahl vom letzten Mal markiert und hervorgehoben', /Deine Wahl vom letzten Mal/.test(rv()[2].textContent) &&
    rv()[2].querySelector('.tile.imp-chosen') && /Karmesin/.test(rv()[2].querySelector('.tile.imp-chosen').textContent) &&
    /Deine Wahl: Pikachu · Karmesin · 025\/198 · Normal/.test(rv()[2].textContent), rv()[2].textContent);
  ok('Prüfliste: vorbelegte freie Karte hervorgehoben', /Deine Wahl vom letzten Mal/.test(rv()[3].textContent) && E.btn(rv()[3], 'Als freie Karte').classList.contains('imp-on'));
  ok('Prüfliste: Alle übernehmen sichtbar (2 Zeilen)', /2 Zeilen hast du beim letzten Mal/.test($('impRvAll').textContent) && !!E.btn($('impRvAll'), 'Alle übernehmen'));
  ok('Prüfliste: escaped', E.clean() && rv()[1].textContent.indexOf(X1 + 'kein Treffer') >= 0 && rv()[1].textContent.indexOf(X3) >= 0);
  // Kandidat wählen: Enter auf der Kachel, danach noch ein Klick (Doppelklick-Schutz)
  rv()[0].querySelectorAll('.tile')[0].dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  ok('Kachel: andere Taste wählt nichts', E.calls('importReviewDecide').length === 0);
  rv()[0].querySelectorAll('.tile')[0].dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  E.click(rv()[0].querySelectorAll('.tile')[0]);
  ok('Kachel per Enter: importReviewDecide einmal (fp, karte, id, lang)', E.calls('importReviewDecide').length === 1 &&
    J(E.calls('importReviewDecide')[0].args) === J(['fpA', { type: 'karte', id: 'base1-58', lang: 'de' }]) && /Speichere/.test($('impRvMsg0').textContent));
  ok('während des Speicherns gesperrt', E.btn(E.main(), 'Weiter zur Vorschau').disabled);
  await E.respond('importReviewDecide');
  ok('Kachel: erledigt, gewählt, 1 von 4', $('impRvProg').textContent === '1 von 4 erledigt' && rv()[0].classList.contains('imp-done') &&
    rv()[0].querySelector('.tile.imp-chosen') && /erledigt/.test(rv()[0].textContent) && !E.btn(E.main(), 'Weiter zur Vorschau').disabled);
  // Überspringen + Wahl aufheben
  E.click(E.btn(rv()[1], 'Überspringen'));
  ok('Überspringen: {type: skip}', J(E.calls('importReviewDecide')[0].args) === J(['fpB', { type: 'skip' }]));
  await E.respond('importReviewDecide');
  ok('Überspringen: hervorgehoben, 2 von 4', E.btn(rv()[1], 'Überspringen').classList.contains('imp-on') && $('impRvProg').textContent === '2 von 4 erledigt');
  E.click(E.btn(rv()[1], 'Wahl aufheben'));
  ok('Wahl aufheben: {type: ""}', J(E.calls('importReviewDecide')[0].args) === J(['fpB', { type: '' }]));
  await E.respond('importReviewDecide');
  ok('aufgehoben: 1 von 4', $('impRvProg').textContent === '1 von 4 erledigt' && !rv()[1].classList.contains('imp-done'));
  E.click(E.btn(rv()[1], 'Als freie Karte'));
  ok('Als freie Karte: {type: frei}', J(E.calls('importReviewDecide')[0].args) === J(['fpB', { type: 'frei' }]));
  await E.respond('importReviewDecide', { error: 'Ohne Namen kann keine freie Karte angelegt werden.' });
  ok('Fehler bei der Zeile, Knöpfe wieder frei', /Ohne Namen/.test($('impRvMsg1').textContent) && !E.btn(rv()[1], 'Als freie Karte').disabled);
  // Neu suchen -> Treffer
  E.click(E.btn(rv()[1], 'Neu suchen'));
  ok('Neu suchen: Formular mit Werten der Zeile', $('impRvN1').value === X1 + 'Mew' && $('impRvNr1').value === '8' && $('impRvSet1').value === X3 && E.clean());
  E.type($('impRvN1'), 'Mew');
  E.click(E.btn(rv()[1], 'Suchen'));
  ok('Suchen: importReviewSearch(fp, {name, number, set})', J(E.calls('importReviewSearch')[0].args) === J(['fpB', { name: 'Mew', number: '8', set: X3 }]) &&
    /Suche bei tcgdex/.test($('impRvRes1').textContent));
  E.type($('impRvN1'), 'Pikachu');
  E.click(E.btn(rv()[1], 'Suchen'));
  ok('zweite Suche offen', E.calls('importReviewSearch').length === 2);
  await E.respond('importReviewSearch', { last: true });
  ok('neueste Suche: Treffer als Kachel', /1 Treffer für Pikachu/.test($('impRvRes1').textContent) && $('impRvRes1').querySelectorAll('.tile').length === 1);
  await E.respond('importReviewSearch', { value: { stage: 'name', cards: [], notes: ['ALTE SUCHE'] } });
  ok('ältere Suche verworfen', !/ALTE SUCHE/.test($('impRvRes1').textContent) && $('impRvRes1').querySelectorAll('.tile').length === 1);
  E.click($('impRvRes1').querySelector('.tile'));
  ok('Treffer gewählt: importReviewDecide(karte neo1-25)', J(E.calls('importReviewDecide')[0].args) === J(['fpB', { type: 'karte', id: 'neo1-25', lang: 'de' }]));
  await E.respond('importReviewDecide');
  ok('Treffer: Suche zu, 2 von 4', !$('impRvN1') && $('impRvProg').textContent === '2 von 4 erledigt' && /Deine Wahl: Pikachu · Neo Genesis/.test(rv()[1].textContent));
  // Neu suchen -> Set-Auswahl wie im Tab Hinzufügen
  E.S.searchImpl = () => ({ stage: 'pickSet', cards: [], notes: ['Nummer 25 in welchem Set?'], number: '25',
    sets: [{ id: 'base1', name: 'Basis-Set', nameEn: 'Base Set', logo: '', official: 102, preferred: true }, { id: 'neo1', name: X1 + 'Neo Genesis', nameEn: 'Neo Genesis', logo: '', official: 111 }] });
  E.click(E.btn(rv()[0], 'Neu suchen'));
  E.click(E.btn(rv()[0], 'Suchen'));
  await E.respond('importReviewSearch');
  ok('Set-Auswahl: bevorzugte Sets zuerst', $('impRvSets0').querySelectorAll('.tile.set').length === 1 && /Basis-Set/.test($('impRvSets0').textContent));
  E.type($('impRvF0'), 'neo');
  ok('Set filtern: Neo Genesis, escaped', $('impRvSets0').querySelectorAll('.tile.set').length === 1 && $('impRvSets0').textContent.indexOf(X1 + 'Neo Genesis') >= 0 && E.clean());
  E.click($('impRvSets0').querySelector('.tile.set'));
  ok('Set gewählt: getCardBySetNumber(neo1, 25)', J(E.calls('getCardBySetNumber')[0].args) === J(['neo1', '25']) && /Suche Nummer 25 in/.test($('impRvRes0').textContent));
  await E.respond('getCardBySetNumber');
  ok('Karte aus dem Set als Kachel, zurück zu den Sets möglich', $('impRvRes0').querySelectorAll('.tile').length === 1 && /Neo Genesis · 25\/111/.test($('impRvRes0').textContent) &&
    !!E.btn($('impRvRes0'), 'Anderes Set wählen'));
  E.click(E.btn($('impRvRes0'), 'Anderes Set wählen'));
  ok('Anderes Set wählen: Set-Kacheln wieder da', !!$('impRvSets0'));
  E.click($('impRvSets0').querySelector('.tile.set'));
  await E.respond('getCardBySetNumber', { error: 'Nummer 25 gibt es in diesem Set nicht.' });
  ok('Set ohne die Nummer: Fehler, Sets bleiben', /gibt es in diesem Set nicht/.test($('impRvRes0').textContent) && !!$('impRvSets0'));
  E.click($('impRvSets0').querySelector('.tile.set'));
  await E.respond('getCardBySetNumber', { value: E.S.cards['neo1-25'] });
  E.click($('impRvRes0').querySelector('.tile'));
  ok('Karte aus der Set-Auswahl gewählt', J(E.calls('importReviewDecide')[0].args) === J(['fpA', { type: 'karte', id: 'neo1-25', lang: 'de' }]));
  await E.respond('importReviewDecide');
  // Alle übernehmen
  E.click(E.btn($('impRvAll'), 'Alle übernehmen'));
  ok('Alle übernehmen: importReviewAcceptPrefilled', E.calls('importReviewAcceptPrefilled').length === 1);
  await E.respond('importReviewAcceptPrefilled');
  ok('Alle übernehmen: 4 von 4, Box weg, Meldung', $('impRvProg').textContent === '4 von 4 erledigt' && !E.btn($('impRvAll'), 'Alle übernehmen') &&
    rv()[2].classList.contains('imp-done') && /übernommen/.test(E.msg()));
  // Später weitermachen
  E.click(E.btn(E.main(), 'Später weitermachen'));
  ok('Später weitermachen: Übersicht', E.calls('importState').length === 1 && /Prüfliste ist gespeichert/.test(E.msg()));
  E.S.draft = { sourceId: 'SRC1', sourceName: 'Ordner', tab: 'Karten', stage: 'pruefung', mode: 'neu' };
  await E.respond('importState');
  E.click(E.btn(E.main(), 'Weitermachen'));
  ok('Banner Prüfliste -> importReviewList', E.calls('importReviewList').length === 1);
  await E.respond('importReviewList');
  ok('Prüfliste wieder da, Stand vom Server', $('impRvProg').textContent === '4 von 4 erledigt');
  E.click(E.btn(E.main(), 'Weiter zur Vorschau'));
  ok('Weiter zur Vorschau: importBuildPreview mit Spinner', E.calls('importBuildPreview').length === 1 && /Berechne die Vorschau/.test(E.main().textContent));
  await E.respond('importBuildPreview');

  // ---- Vorschau ----
  const P = E.main();
  ok('Vorschau: Zahlen', /5 neue Karten, 2 Exemplare mehr bei Karten, die du schon hast, 1 weniger \(Abgleich\), 1 übersprungen, 3 schon importiert, 1 in der Prüfliste offen\./.test($('impPvCounts').textContent), $('impPvCounts').textContent);
  ok('Vorschau: Wert +7,25', /Wert der Sammlung: \+7,25/.test(P.textContent));
  ok('Vorschau: Abschnitte', ['Schon von Hand erfasst (2)', 'Von dir entfernt (2)', 'Neu (2)', 'Weniger (Abgleich) (1)', 'Übersprungen (1)']
    .every(h => [...P.querySelectorAll('h3')].some(x => x.textContent === h)), [...P.querySelectorAll('h3')].map(x => x.textContent));
  ok('Vorschau: Prüfliste offen mit Knopf', /1 Zeile aus der Prüfliste ist noch offen/.test(P.textContent) && !!E.btn(P, 'Zur Prüfliste'));
  ok('Vorschau: Dieselbe Karte vorausgewählt', E.radioVal('impHm0') === 'same' && E.radioVal('impHm1') === 'same' && /In der Tabelle: 2, von Hand: 1/.test(P.textContent));
  ok('Vorschau: trotzdem übernehmen nicht angehakt', !$('impRb0').checked && !$('impRb1').checked);
  ok('Vorschau: Weniger aus Import 3, escaped', /aus Import 3/.test(P.textContent) && E.clean() && P.textContent.indexOf(X2 + 'Glumanda') >= 0 && P.textContent.indexOf(X3 + 'Lavados') >= 0);
  E.click($('impHmE1'));
  E.click($('impRb1'));
  E.click($('impRb0')); E.click($('impRb0'));
  E.click(E.btn(P, 'Importieren'));
  E.click(E.btn(P, 'Importieren'));
  ok('Importieren: importCommit einmal mit den Entscheidungen', E.calls('importCommit').length === 1 &&
    J(E.calls('importCommit')[0].args) === J([{ hand: { fpH1: 'same', fpH2: 'extra' }, removed: { fpR2: true } }]) && /Importiere/.test(E.act()), E.calls('importCommit').map(c => c.args));
  ok('Importieren: alles gesperrt', E.btn(P, 'Abbrechen').disabled && $('impHmS0').disabled);
  await E.respond('importCommit', { error: 'Gerade läuft schon ein Import oder Zurücknehmen. Bitte kurz warten.' });
  ok('Commit-Fehler: Meldung, wieder frei, Auswahl bleibt', /Gerade läuft schon/.test(E.act()) && !E.btn(P, 'Importieren').disabled && E.radioVal('impHm1') === 'extra' && $('impRb1').checked);
  E.click(E.btn(P, 'Importieren'));
  await E.respond('importCommit');
  ok('Commit: loadUiConfig + importState, Meldung escaped', E.calls('getUiConfig').length === 1 && E.calls('importState').length === 1 &&
    E.msg().indexOf('Import 5 ist fertig: 7 Exemplare übernommen. ' + X3) === 0 && E.clean());
  await E.settle();
  ok('nach Commit: Übersicht', !!E.btn(E.main(), 'Neuer Import'));

  // ---- Vorschau: Abbrechen ----
  E.S.draft = { sourceId: 'SRC1', sourceName: 'Ordner', tab: 'Karten', stage: 'vorschau', mode: 'neu' };
  E.click($('tabAdd')); E.click($('tabImport'));
  await E.respond('importState');
  E.click(E.btn(E.main(), 'Weitermachen'));
  ok('Banner Vorschau -> importBuildPreview', E.calls('importBuildPreview').length === 1);
  await E.respond('importBuildPreview', { error: 'Gerade ist kein Import in Arbeit.' });
  ok('Vorschau-Fehler: Meldung + Nochmal versuchen', /kein Import in Arbeit/.test(E.main().textContent) && !!E.btn(E.main(), 'Nochmal versuchen'));
  E.click(E.btn(E.main(), 'Nochmal versuchen'));
  await E.respond('importBuildPreview');
  E.win.__confirmAnswer = false;
  const nConf = E.confirms.length;
  E.click(E.btn(E.main(), 'Abbrechen'));
  ok('Abbrechen: Rückfrage, nein -> nichts', E.confirms.length === nConf + 1 && E.pending.length === 0);
  E.win.__confirmAnswer = true;
  E.click(E.btn(E.main(), 'Abbrechen'));
  ok('Abbrechen: importDiscardDraft', E.calls('importDiscardDraft').length === 1);
  await E.respond('importDiscardDraft');
  ok('Abbrechen: Übersicht mit Meldung', E.calls('importState').length === 1 && /Import abgebrochen/.test(E.msg()));
  await E.settle();

  // ---- Zurücknehmen ----
  E.click(E.btn($('impImp0'), 'Zurücknehmen'));
  ok('Zurücknehmen: importUndoPreview(4)', J(E.calls('importUndoPreview')[0].args) === J([4]) && /Prüfe, was beim Zurücknehmen/.test(E.main().textContent));
  await E.respond('importUndoPreview');
  ok('Zurücknehmen: Satz mit Zahlen', $('impUdText').textContent === '70 Einträge werden gelöscht, 5 auf den alten Stand gesetzt, 2 von Hand geänderte zur Entscheidung.', $('impUdText').textContent);
  ok('Zurücknehmen: spätere Importe, Änderungen, escaped', /Spätere Importe derselben Tabelle \(Nr\. 5\)/.test(E.main().textContent) &&
    /Geändert: Zustand NM → LP/.test(E.main().textContent) && E.clean() && E.main().textContent.indexOf(X1 + 'Glurak') >= 0);
  ok('Zurücknehmen: nichts vorausgewählt, Knopf gesperrt', E.radioVal('impUd0') === null && E.radioVal('impUd1') === null && $('impUdGo').disabled &&
    /Noch 2 zu entscheiden/.test($('impUdHint').textContent));
  E.click($('impUdGo'));
  ok('gesperrter Knopf: kein Aufruf', E.pending.length === 0);
  E.click($('impUdK0'));
  ok('eine Entscheidung: noch gesperrt', $('impUdGo').disabled && /Noch 1/.test($('impUdHint').textContent));
  E.click($('impUdR1'));
  ok('alle entschieden: Knopf frei', !$('impUdGo').disabled && $('impUdHint').textContent === '');
  E.click($('impUdK1'));
  E.click($('impUdGo'));
  E.click($('impUdGo'));
  ok('importUndo einmal mit Entscheidungen', E.calls('importUndo').length === 1 && J(E.calls('importUndo')[0].args) === J([4, { E10: 'keep', E11: 'keep' }]), E.calls('importUndo').map(c => c.args));
  await E.respond('importUndo');
  ok('Zurückgenommen: loadUiConfig + importState, Meldung', E.calls('getUiConfig').length === 1 && E.calls('importState').length === 1 && /Import 4 ist zurückgenommen/.test(E.msg()));
  await E.settle();
  // ohne geänderte Exemplare: sofort frei; Abbrechen
  E.S.undoPreview = nr => ({ nr, sourceName: 'Tauschliste', counts: { loeschen: 1, zurueck: 0, fehlt: 2 }, changed: [], laterSameSource: [], newTerms: [] });
  E.click(E.btn($('impImp1'), 'Zurücknehmen'));
  await E.respond('importUndoPreview');
  ok('ohne Änderungen: Knopf frei, Satz', !$('impUdGo').disabled && $('impUdText').textContent === '1 Eintrag wird gelöscht, 2 Einträge sind schon nicht mehr da.', $('impUdText').textContent);
  E.click(E.btn(E.main(), 'Abbrechen'));
  ok('Abbrechen: zurück zur Übersicht, kein importUndo', E.calls('importState').length === 1 && E.calls('importUndo').length === 0);
  await E.settle();
  E.click(E.btn($('impImp1'), 'Zurücknehmen'));
  await E.respond('importUndoPreview', { error: 'Import 3 gibt es nicht.' });
  ok('Undo-Vorschau-Fehler: Meldung + Zur Übersicht', /Import 3 gibt es nicht/.test(E.main().textContent) && !!E.btn(E.main(), 'Zur Übersicht'));
  E.click(E.btn(E.main(), 'Zur Übersicht'));
  await E.settle();

  ok('keine Skriptfehler (Seitenleiste)', E.errors.length === 0, E.errors);

  // ---- Banner für jede Stufe ----
  async function bannerBoot(draft, setup) {
    const B = boot('sidebar', { setup: S => { S.draft = draft; if (setup) setup(S); } });
    await B.startup();
    await B.openImport();
    B.click(B.btn(B.main(), 'Weitermachen'));
    return B;
  }
  const base = { sourceId: 'SRC1', sourceName: 'Ordner', sourceUrl: 'https://docs.google.com/spreadsheets/d/SRC1/edit', kind: 'sheet', mode: 'alle' };
  {
    const B = await bannerBoot(Object.assign({ stage: 'tab', tab: '', tabs: [{ name: 'Karten', rows: 25, cols: 6 }, { name: 'Zwei', rows: 3, cols: 2 }] }, base));
    ok('Banner tab (mit Tabs): Schritt 2 ohne Aufruf', B.step() === 2 && B.pending.length === 0 && B.radioVal('impTab') === null &&
      B.main().querySelectorAll('input[name=impTab]').length === 2);
    B.click(B.btn(B.main(), 'Zurück'));
    ok('Banner tab: Link in Schritt 1', B.$('impUrl').value === base.sourceUrl);
    ok('keine Skriptfehler', B.errors.length === 0, B.errors);
  }
  {
    const B = await bannerBoot(Object.assign({ stage: 'tab', tab: '' }, base));
    ok('Banner tab (ohne Tabs): importOpenSource(Link)', J(B.calls('importOpenSource').map(c => c.args)) === J([[base.sourceUrl]]));
    await B.respond('importOpenSource');
    ok('Banner tab: dann Schritt 2', B.step() === 2 && B.radioVal('impTab') === 'Karten');
  }
  {
    const cfg = { form: 'liste', headerRow: 1, firstRow: 3, lastRow: 0, cols: Object.assign(emptyCols(), { name: 2, number: 1 }), fixed: { lang: 'JP' }, extras: [{ col: 5, name: 'Notiz', show: false }], grid: {} };
    const B = await bannerBoot(Object.assign({ stage: 'zuordnung', tab: 'Karten', cfg, templateName: 'Ordner-Vorlage' }, base), S => { S.implShape = true; });
    ok('Banner zuordnung: importSelectTab(Tab)', J(B.calls('importSelectTab').map(c => c.args)) === J([['Karten']]));
    await B.respond('importSelectTab');
    ok('Banner zuordnung: Schritt 3, Vorlage gewählt, kein importListTemplates', B.step() === 3 && B.$('impTpl').value === 'Ordner-Vorlage' && B.pending.length === 0);
    B.click(B.btn(B.main(), 'Weiter')); B.click(B.btn(B.main(), 'Weiter'));
    ok('Banner zuordnung: gespeicherte Zuordnung bleibt (nicht die der Vorlage)', B.step() === 5 && B.$('impCol_name').value === '2' && B.$('impFr').value === '3');
    B.click(B.btn(B.main(), 'Weiter'));
    ok('Banner zuordnung: gespeicherte feste Werte und Zusatzspalte', B.$('impFxLang').value === 'JP' && [...B.main().querySelectorAll('.box h3')].some(h => /Spalte F/.test(h.textContent)) &&
      B.main().querySelector('input[data-k="ex.c5.take"]').checked);
    ok('Banner zuordnung: Modus aus dem Entwurf', B.win.impS.wiz.mode === 'alle');
  }
  {
    const B = boot('sidebar', { setup: S => { S.implShape = true; } });
    await B.startup(); await B.openImport();
    await toStep3(B);
    ok('Quelle-Form mit cfg: kein importListTemplates, cfg der Vorlage', B.step() === 3 && B.S.log.every(l => l.fn !== 'importListTemplates') && B.win.impS.wiz.cfg.fixed.lang === 'EN');
    B.change(B.$('impTpl'), X2 + 'Alt');
    ok('andere Vorlage mit cfg: Checkliste, Modus neu', B.win.impS.wiz.cfg.form === 'checkliste' && B.win.impS.wiz.mode === 'neu' && B.pending.length === 0);
    B.click(B.btn(B.main(), 'Weiter')); B.click(B.btn(B.main(), 'Weiter'));
    ok('Checkliste: Spalte Vorhanden in der Zuordnung', B.step() === 5 && B.$('impCol_check').value === '3');
    B.click(B.btn(B.main(), 'Zur Übersicht'));
    ok('Zur Übersicht: importState, Hinweis', B.calls('importState').length === 1 && /bleibt in Arbeit/.test(B.msg()));
    ok('keine Skriptfehler', B.errors.length === 0, B.errors);
  }
  {
    const B = boot('sidebar', { setup: S => { S.noSuggest = true; S.driveService = false; } });
    await B.startup(); await B.openImport();
    B.click(B.btn(B.main(), 'Neuer Import'));
    ok('ohne Drive API: Hinweis', /fehlt noch die „Drive API“/.test(B.main().textContent));
    B.type(B.$('impUrl'), 'abc1234567890');
    B.click(B.btn(B.main(), 'Weiter'));
    await B.respond('importOpenSource');
    B.click(B.btn(B.main(), 'Weiter'));
    await B.respond('importSelectTab');
    ok('ohne passende Vorlage: Neue Vorlage, geraten', B.$('impTpl').value === '' && /Keine Vorlage passt genau/.test(B.main().textContent) &&
      B.win.impS.wiz.cfg.cols.qty === 3 && B.pending.length === 0);
    for (let k = 0; k < 4; k++) B.click(B.btn(B.main(), 'Weiter'));
    ok('ohne Vorlage: Schritt 7 lädt', B.step() === 7 && B.calls('importPreviewRows').length === 1);
    await B.respond('importPreviewRows', { error: 'Es sind noch keine Daten geladen. Bitte wähle zuerst einen Tab.' });
    ok('Vorschau-Fehler mit Nochmal versuchen', /noch keine Daten/.test(B.$('impPrev').textContent) && !!B.btn(B.$('impPrev'), 'Nochmal versuchen'));
    B.click(B.btn(B.$('impPrev'), 'Nochmal versuchen'));
    await B.respond('importPreviewRows');
    B.click(B.btn(B.main(), 'Weiter'));
    ok('ohne Vorlage: Name aus Datei und Tab, Modus Nur Neues', B.$('impSaveName').value === (X1 + 'Ordner · Karten') && B.radioVal('impMode') === 'neu');
    ok('keine Skriptfehler', B.errors.length === 0, B.errors);
  }
  {
    const B = await bannerBoot(Object.assign({ stage: 'erkennung', tab: 'Karten', total: 5, recognizePos: 2 }, base), S => { S.recog.pos = 2; S.recog.counts = { eindeutig: 5, unklar: 0, nichtGefunden: 0, uebersprungen: 0, bekannt: 0 }; });
    ok('Banner erkennung: importRecognizeStep, Stand 2 von 5', B.calls('importRecognizeStep').length === 1 && /2 von 5/.test(B.main().textContent));
    await B.respond('importRecognizeStep');
    B.click(B.btn(B.main(), 'Später weitermachen'));
    ok('Später weitermachen während eines Schritts: Übersicht', B.calls('importState').length === 1 && B.calls('importRecognizeStep').length === 1);
    await B.respond('importRecognizeStep');
    ok('veraltete Schritt-Antwort: kein weiterer Schritt', B.calls('importRecognizeStep').length === 0);
    await B.respond('importState');
    ok('Übersicht nach Später', !!B.btn(B.main(), 'Neuer Import'));
    B.click(B.btn(B.main(), 'Weitermachen'));
    await B.respond('importRecognizeStep');
    ok('alles eindeutig -> direkt Vorschau', B.calls('importBuildPreview').length === 1 && B.calls('importReviewList').length === 0);
    ok('keine Skriptfehler', B.errors.length === 0, B.errors);
  }
  {
    const B = await bannerBoot(Object.assign({ stage: 'pruefung', tab: 'Karten' }, base));
    ok('Banner pruefung: importReviewList', B.calls('importReviewList').length === 1);
  }
  {
    const B = await bannerBoot(Object.assign({ stage: 'vorschau', tab: 'Karten' }, base));
    ok('Banner vorschau: importBuildPreview', B.calls('importBuildPreview').length === 1);
  }
  {
    // Neuer Import trotz Entwurf: Rückfrage
    const B = boot('sidebar', { setup: S => { S.draft = Object.assign({ stage: 'pruefung', tab: 'Karten' }, base); } });
    await B.startup(); await B.openImport();
    B.win.__confirmAnswer = false;
    B.click(B.btn(B.main(), 'Neuer Import'));
    ok('Neuer Import mit Entwurf: Rückfrage, nein -> bleibt', B.confirms.length === 1 && /Import in Arbeit/.test(B.confirms[0]) && !B.$('impUrl'));
    B.win.__confirmAnswer = true;
    B.click(B.btn(B.main(), 'Neuer Import'));
    ok('ja -> Schritt 1', B.step() === 1);
    // busy und Fehler beim Laden
    B.click(B.btn(B.main(), 'Zurück'));
    await B.respond('importState', { error: 'NetworkError: Connection failure due to HTTP 0' });
    ok('Ladefehler deutsch mit Nochmal laden', /Keine Verbindung zum Server/.test(B.main().textContent) && !!B.btn(B.main(), 'Nochmal laden'));
    B.click(B.btn(B.main(), 'Nochmal laden'));
    B.S.busy = { nr: 7, phase: 'undo' };
    B.S.needsSetup = true;
    await B.respond('importState', { value: Object.assign(B.S.importState(), { needsSetup: true }) });
    ok('laufendes Zurücknehmen und fehlende Blätter angezeigt', /Gerade wird Import 7 zurückgenommen/.test(B.main().textContent) &&
      /Import-Blätter fehlen.*Karten erfassen/.test(B.main().textContent) && !/Einrichtung/.test(B.main().textContent));
    ok('keine Skriptfehler', B.errors.length === 0, B.errors);
  }

  // ---- Optional (REAL=1): derselbe Tab gegen die echten Serverteile (Code.gs + parts) über harness2 ----
  if (process.env.REAL) await realServerFlow();

  console.log('\n' + pass + ' ok, ' + failCount + ' fehlgeschlagen');
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
