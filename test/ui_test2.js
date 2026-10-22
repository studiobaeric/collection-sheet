// UI-Test für src/Ui.html (Vorlage) mit jsdom und einem Stub-Server nach SPEC §4.
// Aufruf: node ui_test2.js   (jsdom liegt in ./node_modules)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src', 'Ui.html');
const RAW = fs.readFileSync(SRC, 'utf8');
const MODE_LET = "<?!= mode ?>";
const INCLUDE_LET = "<?!= include('ImportUi') ?>";
const START_LET = '<?!= typeof start === "string" ? start : "" ?>';

let pass = 0, failCount = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok  ', label); }
  else { failCount++; console.log('FAIL', label, extra === undefined ? '' : String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 900)); }
}
const flush = async () => { for (let k = 0; k < 3; k++) await new Promise(r => setImmediate(r)); };
const J = x => JSON.stringify(x);

// ---------------------------------------------------------------------------
// Stub-Server (im Speicher), Vertrag aus SPEC §4
// ---------------------------------------------------------------------------
const VL = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1. Edition' };
const LANG_ORDER = ['DE', 'EN', 'FR', 'IT', 'ES', 'PT', 'NL', 'PL', 'JP', 'KO', 'ZH'];
const COND_ORDER = ['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

function makeServer() {
  let n = 0;
  const S = { rows: [], imports: { 3: 'Pokemon Ordner', 4: 'Tauschliste' }, proto: [], cards: {}, searchCardsImpl: null };
  S.newEid = () => 'E' + (++n).toString(16).padStart(10, '0');
  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const normNum = s => low(s).replace(/^0+(?=\d)/, '');
  const idPart = r => r.id || ('frei:' + low(r.name) + '~' + low(r.setName) + '~' + normNum(r.localId));
  S.key = r => [idPart(r), r.variant, r.version || '', r.cond || '', r.lang || 'DE'].join('|');
  S.gkey = r => [idPart(r), r.variant, r.version || ''].join('|');
  const nrOf = r => r.origin === 'Hand' ? 0 : Number(String(r.origin).replace('Import ', ''));
  const byEid = eid => S.rows.find(r => r.eid === eid);
  const groupRows = gk => S.rows.filter(r => S.gkey(r) === gk);
  const groupCount = gk => groupRows(gk).reduce((s, r) => s + r.count, 0);
  const sortRows = rs => rs.slice().sort((a, b) => nrOf(a) - nrOf(b) ||
    LANG_ORDER.indexOf(a.lang) - LANG_ORDER.indexOf(b.lang) || COND_ORDER.indexOf(a.cond) - COND_ORDER.indexOf(b.cond));
  const ownOf = rs => { const r = sortRows(rs).find(x => typeof x.ownPrice === 'number'); return r ? r.ownPrice : null; };
  const exText = rs => {
    const sums = {};
    rs.filter(r => r.count > 0).forEach(r => { const k = r.lang + '|' + r.cond; sums[k] = (sums[k] || 0) + r.count; });
    return Object.keys(sums).sort((a, b) => {
      const [la, ca] = a.split('|'), [lb, cb] = b.split('|');
      return LANG_ORDER.indexOf(la) - LANG_ORDER.indexOf(lb) || COND_ORDER.indexOf(ca) - COND_ORDER.indexOf(cb);
    }).map(k => { const [l, c] = k.split('|'); return sums[k] + '× ' + l + (c ? ' ' + c : ''); }).join(', ');
  };
  S.addRow = o => {
    const r = Object.assign({ eid: S.newEid(), id: '', name: '', nameEn: '', source: o.id ? 'de' : 'frei', setName: '', setId: '', localId: '',
      setSize: null, variant: 'normal', version: '', cond: '', lang: 'DE', count: 1, origin: 'Hand', fp: '', ownPrice: '', price: '', image: '', extras: {} }, o);
    S.rows.push(r);
    return r;
  };

  S.getUiConfig = () => ({
    conditions: COND_ORDER.filter(Boolean).map(c => ({ code: c, label: c + ' Label' })),
    langs: LANG_ORDER.map(c => ({ code: c, label: c === 'DE' ? 'Deutsch' : c === 'EN' ? 'Englisch' : 'Sprache ' + c })),
    versions: ['Snowflake'], extras: ['Ordner', 'Notiz'], viewExtras: []
  });
  S.getSetSuggestions = () => ['Basis-Set', 'Flammende Finsternis'];
  S.searchCards = q => {
    if (S.searchCardsImpl) return S.searchCardsImpl(q);
    return { stage: 'none', cards: [], notes: ['Keine Karte gefunden.'] };
  };
  S.getCardDetail = (id, lang) => {
    const c = S.cards[id];
    if (!c) throw new Error('Karte ' + id + ' nicht gefunden.');
    return Object.assign({ lang }, c);
  };
  S.getCardBySetNumber = (setId, number) => {
    const c = Object.values(S.cards).find(x => x.setId === setId && normNum(x.localId) === normNum(String(number).split('/')[0]));
    if (!c) throw new Error('Nummer ' + number + ' gibt es in diesem Set nicht.');
    return Object.assign({ lang: 'de' }, c);
  };
  function result(r, msgName) {
    return { eid: r.eid, key: S.key(r), gkey: S.gkey(r), count: r.count, message: msgName + ' hinzugefügt, jetzt ' + r.count + ' Stück.' };
  }
  function setOwn(gk, price) {
    const d = '2026-10-15';
    groupRows(gk).forEach(r => { r.ownPrice = price > 0 ? price : ''; r.ownPriceDate = price > 0 ? d : ''; });
  }
  S.addCard = req => {
    const c = S.cards[req.id];
    if (!c) throw new Error('Karte ' + req.id + ' nicht gefunden – nichts gespeichert.');
    const variant = req.variant === 'base' ? c.baseVariant : req.variant;
    const probe = { id: c.id, variant, version: req.version || '', cond: req.condition || '', lang: req.cardLang || 'DE' };
    let r = S.rows.find(x => x.origin === 'Hand' && S.key(x) === S.key(probe));
    const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
    if (r) r.count += qty;
    else r = S.addRow({ id: c.id, name: c.name, setName: c.setName, setId: c.setId, localId: c.localId, setSize: c.setSize, variant,
      version: probe.version, cond: probe.cond, lang: probe.lang, count: qty, price: c.prices ? c.prices.base : '', image: c.image });
    if (req.ownPrice) setOwn(S.gkey(r), req.ownPrice);
    return result(r, c.name);
  };
  S.addFreeCard = req => {
    if (!String(req.name || '').trim()) throw new Error('Bitte einen Namen eingeben.');
    const probe = { id: '', name: req.name, setName: req.setName, localId: req.number, variant: req.variant || 'normal',
      version: req.version || '', cond: req.condition || '', lang: req.cardLang || 'DE' };
    let r = S.rows.find(x => x.origin === 'Hand' && S.key(x) === S.key(probe));
    const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
    if (r) r.count += qty; else r = S.addRow(Object.assign(probe, { count: qty }));
    if (req.ownPrice) setOwn(S.gkey(r), req.ownPrice);
    return result(r, req.name);
  };
  S.searchCollection = (query, setText) => {
    const words = low(query).split(/\s+/).filter(Boolean);
    const st = low(setText);
    const rows = S.rows.filter(r => words.every(w => low(r.name).includes(w) || low(r.version).includes(w)) && (!st || low(r.setName).includes(st)));
    const map = new Map();
    rows.forEach(r => { const k = S.gkey(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    const groups = [...map].map(([gk, rs0]) => {
      const rs = sortRows(rs0);
      const f = rs[0];
      const count = rs.reduce((s, r) => s + r.count, 0);
      const own = ownOf(rs);
      return {
        gkey: gk, name: f.name, nameEn: f.nameEn, source: f.source, isFree: !f.id, setName: f.setName, localId: f.localId,
        setSize: f.setSize, variant: f.variant, variantLabel: VL[f.variant], version: f.version, count, image: f.image,
        price: own != null ? own : (typeof f.price === 'number' ? f.price : null), priceManual: own != null, ownPrice: own,
        exemplare: exText(rs),
        rows: rs.map(r => {
          const nr = nrOf(r);
          return { eid: r.eid, key: S.key(r), cond: r.cond, lang: r.lang, count: r.count, origin: r.origin,
            originLabel: nr ? (S.imports[nr] ? S.imports[nr] + ', Import ' + nr : 'Import ' + nr) : 'von Hand',
            isImport: !!nr, importNr: nr || null, extras: Object.assign({}, r.extras) };
        })
      };
    });
    groups.sort((a, b) => (a.count > 0 ? 0 : 1) - (b.count > 0 ? 0 : 1));
    return { total: groups.length, groups: groups.slice(0, 60) };
  };
  S.adjustEntry = (eid, delta) => {
    const row = byEid(eid);
    if (!row) throw new Error('Eintrag nicht gefunden.');
    let target = row, createdEid = '';
    if (delta > 0 && row.origin !== 'Hand') {
      target = S.rows.find(r => r.origin === 'Hand' && S.key(r) === S.key(row));
      if (!target) {
        target = S.addRow(Object.assign({}, row, { eid: S.newEid(), origin: 'Hand', fp: '', count: 0, extras: Object.assign({}, row.extras) }));
        createdEid = target.eid;
      }
    }
    const before = target.count;
    target.count = Math.max(0, before + delta);
    const applied = target.count - before;
    const logIds = [];
    if (delta < 0 && row.origin !== 'Hand' && applied) { const id = 'L' + S.proto.length; S.proto.push({ id, eid: row.eid, qty: -applied }); logIds.push(id); }
    const token = { eid: target.eid, applied, logIds, createdEid };
    return { token, eid: target.eid, count: target.count, groupCount: groupCount(S.gkey(target)), applied, gkey: S.gkey(target) };
  };
  S.revertAdjust = token => {
    const row = byEid(token.eid);
    if (!row) throw new Error('Eintrag nicht gefunden.');
    row.count = Math.max(0, row.count - token.applied);
    S.proto = S.proto.filter(p => token.logIds.indexOf(p.id) < 0);
    const gk = S.gkey(row);
    if (token.createdEid && token.createdEid === row.eid && row.count === 0) S.rows.splice(S.rows.indexOf(row), 1);
    return { eid: row.eid, count: row.count, groupCount: groupCount(gk), gkey: gk };
  };
  S.editEntry = (eid, changes, qty) => {
    const row = byEid(eid);
    if (!row) throw new Error('Eintrag nicht gefunden.');
    qty = qty == null ? row.count : Math.max(1, Math.min(row.count, Number(qty)));
    let t = row;
    if (qty < row.count) { row.count -= qty; t = S.addRow(Object.assign({}, row, { eid: S.newEid(), count: qty, extras: Object.assign({}, row.extras) })); }
    if ('cond' in changes) t.cond = changes.cond;
    if ('cardLang' in changes) t.lang = changes.cardLang;
    if ('version' in changes) t.version = changes.version;
    if (changes.extras) Object.assign(t.extras, changes.extras);
    const other = S.rows.find(r => r !== t && S.key(r) === S.key(t) && r.origin === t.origin && r.fp === t.fp);
    if (other) { other.count += t.count; S.rows.splice(S.rows.indexOf(t), 1); t = other; }
    return { ok: true, eid: t.eid, gkey: S.gkey(t) };
  };
  S.setGroupOwnPrice = (gk, price) => {
    const rs = groupRows(gk);
    if (!rs.length) throw new Error('Zeile nicht gefunden.');
    setOwn(gk, Number(price) > 0 ? Number(price) : 0);
    const own = ownOf(rs);
    const f = sortRows(rs)[0];
    return { gkey: gk, price: own != null ? own : (typeof f.price === 'number' ? f.price : null), priceManual: own != null };
  };
  S.linkFreeGroup = (gk, cardId, dataLang, variant) => {
    const c = S.cards[cardId];
    if (!c) throw new Error('Karte nicht gefunden.');
    const rs = groupRows(gk);
    rs.forEach(r => {
      Object.assign(r, { id: c.id, setName: c.setName, setId: c.setId, localId: c.localId, setSize: c.setSize, source: dataLang === 'en' ? 'en-Ersatz' : 'de',
        variant: variant === 'base' ? c.baseVariant : variant, image: c.image, price: c.prices ? c.prices.base : '' });
      if (dataLang === 'de') r.name = c.name;
    });
    return { gkey: S.gkey(rs[0]) };
  };
  S.adjustCount = () => { throw new Error('adjustCount sollte die neue UI nicht mehr benutzen'); };
  // Updates (Update.gs), Vertrag aus SPEC §11
  S.updInfo = {
    installed: '1.0.0', codeVersion: '1.0.0', outdated: false, available: '', banner: '', newer: [], prereleases: false, copyVersion: '', templateUrl: '', newCopy: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/ALT0/edit', checkedAt: '21.10.2026 10:00', error: '', guideUrl: 'https://github.com/x/y#von-hand',
    collectionEmpty: false, takenFrom: '', pendingTake: ''
  };
  S.getUpdateInfo = () => S.updInfo;
  S.setPrereleases = on => Object.assign(S.updInfo, { prereleases: !!on });
  S.updateCopy = () => ({ state: 'copied', version: '1.1.0', url: 'https://docs.google.com/spreadsheets/d/NEUNEU/edit', name: 'Pokémon-Sammlung (neu, Version 1.1.0)',
    message: 'Die neue Tabelle mit Version 1.1.0 liegt im selben Ordner wie diese.' });
  S.takeoverPreview = url => ({ name: '<i>Alte Sammlung</i>', url, version: '', cards: 2, copies: 3, sheets: [{ name: 'Verlauf', rows: 1 }], own: ['Notizen'], warnings: ['<b>Achtung</b> Import 3'] });
  S.takeoverRun = () => ({ cards: 2, sheets: ['Verlauf'], own: ['Notizen'], message: '2 Einträge und 2 weitere Blätter übernommen. Die alte Tabelle ist jetzt stillgelegt.' });
  S.kartenErfassen = () => null;
  return S;
}

function seedCollection(S) {
  S.cards = {
    'swsh3-025': { id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', localId: '025', setSize: 189, baseVariant: 'normal', baseLabel: 'Normal', image: 'https://img/glurak', prices: { base: 1.5, reverse: 3, firstEdition: null }, canReverse: true },
    'base1-15': { id: 'base1-15', name: 'Mew', setName: 'Basis-Set', setId: 'base1', localId: '15', setSize: 102, baseVariant: 'holo', baseLabel: 'Holo', image: 'https://img/mew', prices: { base: 30 } },
    'base1-8': { id: 'base1-8', name: 'Mew', setName: 'Basis-Set', setId: 'base1', localId: '8', setSize: 102, baseVariant: 'normal', baseLabel: 'Normal', image: 'https://img/mew8', prices: { base: 2 } }
  };
  const G = {};
  G.gHand = S.addRow({ id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', localId: '025', setSize: 189, cond: 'NM', count: 2, price: 1.5, image: 'https://img/glurak' });
  G.gImp = S.addRow({ id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', localId: '025', setSize: 189, cond: '', count: 1, origin: 'Import 3', fp: 'fp1', price: 1.5, extras: { Ordner: 'Seite 3' } });
  G.pImp = S.addRow({ id: 'dpp-DP16', name: 'Pikachu', setName: 'DP Promo', setId: 'dpp', localId: 'DP16', version: 'Snowflake', count: 2, origin: 'Import 3', fp: 'fp2', ownPrice: 4, price: '' });
  G.free = S.addRow({ id: '', name: '<img src=x onerror="window.__xss=1">Mew', setName: '<script>window.__xss=2</script>Ordner', localId: '8', count: 1,
    extras: { '<i>Notiz</i>': '<b>fett</b>' } });
  G.e1 = S.addRow({ id: 'sv1-133', name: 'Evoli', setName: 'Karmesin', setId: 'sv1', localId: '133', cond: 'NM', count: 1, origin: 'Import 3', fp: 'fp3', price: 0.2 });
  G.e2 = S.addRow({ id: 'sv1-133', name: 'Evoli', setName: 'Karmesin', setId: 'sv1', localId: '133', cond: 'LP', lang: 'EN', count: 1, origin: 'Import 4', fp: 'fp4', price: 0.2 });
  G.zero = S.addRow({ id: 'sv1-1', name: 'Bisasam', setName: 'Karmesin', setId: 'sv1', localId: '1', count: 0, price: 0.1 });
  return G;
}

// ---------------------------------------------------------------------------
// Seite starten
// ---------------------------------------------------------------------------
const IMPORT_STUB = '<div id="paneImport" class="panel hidden">IMPORT-PANE</div><script>var impInitCalls = 0; function impInit() { impInitCalls++; }</script>';

function render(mode, include, start) {
  return RAW.replace(MODE_LET, mode).replace(START_LET, start || '').replace(INCLUDE_LET, include == null ? IMPORT_STUB : include);
}

function boot(mode, opts) {
  opts = opts || {};
  const S = makeServer();
  const G = opts.seed === false ? {} : seedCollection(S);
  const pending = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', e => errors.push(String(e)));
  function makeRun() {
    let okH, failH;
    const t = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; } };
    const px = new Proxy(t, { get: (o, p) => p in o ? o[p] : (...args) => { pending.push({ fn: p, args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH }); } });
    return px;
  }
  if (opts.server) opts.server(S);
  const dom = new JSDOM(render(mode, opts.include, opts.start), {
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
      win.__timers = timers;
      win.google = { script: { get run() { return makeRun(); } } };
    }
  });
  const win = dom.window, doc = win.document;
  const E = {
    S, G, win, doc, pending, errors,
    $: id => doc.getElementById(id),
    calls: fn => pending.filter(p => p.fn === fn),
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
      if (err != null) p.fail(new Error(err));
      else p.ok(res === undefined ? null : JSON.parse(JSON.stringify(res)));
      await flush();
      return { call: p, res, err };
    },
    async respondAll() { while (pending.length) await E.respond(pending[0].fn); },
    btn(el, text) { return [...(el || doc).querySelectorAll('button')].find(b => b.textContent.trim() === text); },
    click(el) { if (!el) throw new Error('Element fehlt'); el.click(); },
    type(el, v) { if (!el) throw new Error('Feld fehlt'); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    pick(el, v) { if (!el) throw new Error('Auswahl fehlt'); el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); },
    gi(name) { return win.state.groups.findIndex(g => g.name === name); },
    gIdx(pred) { return win.state.groups.findIndex(pred); },
    async startup() { await E.respond('getSetSuggestions'); await E.respond('getUiConfig'); await E.respond('getUpdateInfo'); },
    async openColl() {
      E.click(E.$('tabColl'));
      await E.respond('searchCollection');
    },
    expand(i) { E.click(E.$('gh' + i).querySelector('.info')); }
  };
  return E;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(async () => {
  // ---- Datei: Vorlage, keine fremden "<?", keine Gedankenstriche ----
  {
    const idxs = []; let k = -1;
    while ((k = RAW.indexOf('<?', k + 1)) >= 0) idxs.push(k);
    ok('genau drei Scriptlets in Ui.html', idxs.length === 3, idxs);
    ok('Scriptlet 1 ist MODE', RAW.substr(idxs[0], MODE_LET.length) === MODE_LET && /var MODE = '<\?!= mode \?>';/.test(RAW));
    ok('Scriptlet 2 ist START (fehlt start, bleibt es leer)', RAW.substr(idxs[1], START_LET.length) === START_LET && RAW.indexOf("var START = '" + START_LET + "';") >= 0);
    ok('Scriptlet 3 ist include(ImportUi)', RAW.substr(idxs[2], INCLUDE_LET.length) === INCLUDE_LET);
    const incAt = RAW.indexOf(INCLUDE_LET);
    ok('include steht nach dem Skript am Ende von body', incAt > RAW.lastIndexOf('</script>') && incAt < RAW.indexOf('</body>'));
    ok('kein Gedankenstrich (—) in Ui.html', RAW.indexOf('—') < 0);
    ok('kein adjustCount mehr in der UI', RAW.indexOf("'adjustCount'") < 0);
  }

  // ---- Sidebar: Tabs, Import, Konfiguration ----
  {
    const E = boot('sidebar');
    const { $ } = E;
    ok('Start: getSetSuggestions + getUiConfig angefragt', E.calls('getSetSuggestions').length === 1 && E.calls('getUiConfig').length === 1, E.pending.map(p => p.fn));
    await E.startup();
    ok('Sidebar: Tabs Hinzufügen, Sammlung, Import', $('tabAdd').textContent === 'Hinzufügen' && $('tabColl').textContent === 'Sammlung' && $('tabImport').textContent === 'Import');
    ok('Sidebar: Import-Tab sichtbar', !$('tabImport').classList.contains('hidden'));
    ok('LANGS aus getUiConfig ({code,label})', E.win.LANGS.length === 11 && E.win.LANGS[0].code === 'DE' && E.win.LANGS[0].label === 'Deutsch' && E.win.LANGS[8].label === 'Sprache JP', E.win.LANGS);
    ok('CONDITIONS bleiben Codes mit "" zuerst', J(E.win.CONDITIONS) === J(['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']), E.win.CONDITIONS);
    ok('Versionen in der datalist', /value="Snowflake"/.test($('versionList').innerHTML));
    ok('Setliste gefüllt', /Flammende Finsternis/.test($('setList').innerHTML));
    ['$', 'esc', 'call', 'setMsg', 'spinner', 'imgTag', 'cardImg', 'eur', 'errText', 'PLACEHOLDER', 'VARIANT_LABELS', 'CONDITIONS', 'CONDITION_LABELS', 'LANGS']
      .forEach(n => ok('global für ImportUi: ' + n, E.win[n] !== undefined));
    E.click($('tabImport'));
    ok('Import-Tab ruft impInit', E.win.impInitCalls === 1);
    ok('Import-Pane sichtbar, andere versteckt', !$('paneImport').classList.contains('hidden') && $('paneAdd').classList.contains('hidden') && $('paneColl').classList.contains('hidden'));
    ok('Import-Tab aktiv', $('tabImport').classList.contains('active') && !$('tabAdd').classList.contains('active'));
    E.click($('tabColl'));
    ok('Sammlung-Tab lädt die Liste', E.calls('searchCollection').length === 1 && !$('paneColl').classList.contains('hidden') && $('paneImport').classList.contains('hidden'));
    await E.respond('searchCollection');
    E.click($('tabAdd'));
    ok('zurück zu Hinzufügen', !$('paneAdd').classList.contains('hidden') && $('tabAdd').classList.contains('active'));
    ok('keine Skriptfehler (Sidebar)', E.errors.length === 0, E.errors);
  }

  // ---- Sidebar ohne ImportUi (impInit fehlt) ----
  {
    const E = boot('sidebar', { include: '' });
    await E.startup();
    let threw = false;
    try { E.win.showTab('import'); } catch (e) { threw = true; }
    ok('showTab(import) ohne impInit wirft nicht', !threw && E.errors.length === 0, E.errors);
  }

  // ---- getUiConfig schlägt fehl: eingebaute Liste bleibt ----
  {
    const E = boot('web');
    await E.respond('getSetSuggestions');
    await E.respond('getUiConfig', { error: 'kaputt' });
    ok('LANGS-Standardliste ohne getUiConfig', E.win.LANGS.length === 11 && E.win.LANGS[10].code === 'ZH' && E.win.LANGS[10].label === 'Chinesisch');
  }

  // ---- Web-App: kein Import, Sammlung mit Bearbeiten ----
  {
    const E = boot('web');
    const { $ } = E;
    await E.startup();
    ok('Web: Import-Tab versteckt', $('tabImport').classList.contains('hidden'));
    E.win.showTab('import');
    ok('Web: showTab(import) bleibt bei Hinzufügen, kein impInit', E.win.impInitCalls === 0 && !$('paneAdd').classList.contains('hidden') && $('paneImport').classList.contains('hidden'));
    await E.openColl();
    const i = E.gi('Glurak');
    E.expand(i);
    ok('Web: Bearbeiten-Knopf vorhanden', !!E.btn($('gr' + i), 'Bearbeiten'));
    E.click(E.btn($('gr' + i), 'Bearbeiten'));
    E.pick($('eCond' + i), 'EX');
    E.click(E.btn($('ge' + i), 'Speichern'));
    ok('Web: editEntry gesendet', E.calls('editEntry').length === 1);
    ok('keine Skriptfehler (Web)', E.errors.length === 0, E.errors);
  }

  // ---- Hinzufügen: Sprache, Sonderversion, eigener Preis ----
  {
    const E = boot('sidebar');
    const { $, S } = E;
    await E.startup();
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [{ id: 'swsh3-025', lang: 'de', name: 'Glurak', setName: 'Flammende Finsternis', localId: '025' }] });
    E.type($('fName'), 'Glurak');
    E.click(E.btn($('searchForm'), 'Suchen'));
    ok('searchCards mit Name', J(E.calls('searchCards')[0].args) === J([{ name: 'Glurak', number: '', set: '' }]), E.calls('searchCards')[0].args);
    await E.respond('searchCards');
    ok('Einzeltreffer lädt Details', J(E.calls('getCardDetail')[0].args) === J(['swsh3-025', 'de']));
    await E.respond('getCardDetail');
    ok('Bestätigung: Sprache-Auswahl, Standard DE', $('cLang') && $('cLang').value === 'DE' && $('cLang').options.length === 11);
    ok('Bestätigung: Sonderversion mit datalist', $('cVersion') && $('cVersion').getAttribute('list') === 'versionList');
    ok('Bestätigung: eigener Preis mit Hinweis', $('cOwnPrice') && /nur nötig, wenn tcgdex keinen Preis hat/i.test($('addResults').textContent));
    // ungültiger eigener Preis
    E.type($('cOwnPrice'), 'abc');
    E.click($('cAdd'));
    ok('ungültiger eigener Preis: kein addCard, Fehlermeldung', E.calls('addCard').length === 0 && /Eigener Preis/.test($('addMsg').textContent) && !$('cAdd').disabled);
    // gültig
    E.pick($('cLang'), 'EN');
    $('cVersion').value = 'Snowflake';
    $('cOwnPrice').value = '1,50';
    $('cQty').value = '2';
    E.pick($('cCond'), 'NM');
    $('cReverse').checked = true; $('cReverse').dispatchEvent(new E.win.Event('change'));
    E.click($('cAdd'));
    E.click($('cAdd'));
    ok('addCard nur einmal (Knopf gesperrt)', E.calls('addCard').length === 1);
    const req = E.calls('addCard')[0].args[0];
    ok('addCard sendet cardLang/version/ownPrice', J(req) === J({ id: 'swsh3-025', lang: 'de', variant: 'reverse', condition: 'NM', qty: 2, inputName: 'Glurak', cardLang: 'EN', version: 'Snowflake', ownPrice: 1.5 }), req);
    const r = await E.respond('addCard');
    ok('Erfolgsmeldung + Nochmal +1', /hinzugefügt/.test($('addMsg').textContent) && !!E.btn($('addMsg'), 'Nochmal +1') && $('addResults').innerHTML === '');
    E.click(E.btn($('addMsg'), 'Nochmal +1'));
    ok('Nochmal +1 nutzt adjustEntry(eid, 1)', J(E.calls('adjustEntry')[0].args) === J([r.res.eid, 1]), E.calls('adjustEntry')[0].args);
    await E.respond('adjustEntry');
    ok('Nochmal +1: neue Anzahl', /jetzt 3 Stück/.test($('addMsg').textContent), $('addMsg').textContent);

    // Standardwerte: DE, keine Version, kein eigener Preis
    E.type($('fName'), 'Glurak');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards'); await E.respond('getCardDetail');
    E.click($('cAdd'));
    const req2 = E.calls('addCard')[0].args[0];
    ok('Standard: cardLang DE, version leer, ownPrice null', req2.cardLang === 'DE' && req2.version === '' && req2.ownPrice === null && req2.variant === 'base' && req2.qty === 1, req2);
    // Antwort kommt, nachdem schon neu gesucht wurde: neues Ergebnis bleibt stehen
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [{ id: 'a', lang: 'de', name: 'X', setName: 'S', localId: '1' }, { id: 'b', lang: 'de', name: 'Y', setName: 'S', localId: '2' }] });
    E.type($('fName'), 'Neu');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards');
    await E.respond('addCard');
    ok('späte addCard-Antwort löscht neue Suche nicht', /2 Treffer/.test($('addResults').textContent) && /hinzugefügt/.test($('addMsg').textContent));
    ok('keine Skriptfehler (Hinzufügen)', E.errors.length === 0, E.errors);
  }

  // ---- Stale-Suche im Hinzufügen-Tab ----
  {
    const E = boot('sidebar');
    const { $ } = E;
    await E.startup();
    E.type($('fName'), 'Glu'); E.win.doSearch();
    E.type($('fName'), 'Glurak'); E.win.doSearch();
    const multi = { stage: 'de', notes: [], cards: [{ id: 'a', lang: 'de', name: 'Glurak', setName: 'S', localId: '1' }, { id: 'b', lang: 'de', name: '<b>Glurak</b>', setName: 'S', localId: '2' }] };
    await E.respond('searchCards', { last: true, value: multi });
    await E.respond('searchCards', { value: { stage: 'de', notes: [], cards: [] } });
    ok('ältere Suchantwort ignoriert', /2 Treffer/.test($('addResults').textContent));
    ok('Kachel-Name escaped', !$('addResults').querySelector('.cap b b') && /<b>Glurak<\/b>/.test($('addResults').textContent));
  }

  // ---- Freie Karte ----
  {
    const E = boot('sidebar');
    const { $, S } = E;
    await E.startup();
    S.searchCardsImpl = () => ({ stage: 'none', cards: [], notes: ['Keine Karte gefunden. Mit Nummer (z. B. 025/165) kannst du das Set aus einer Liste wählen.'] });
    E.type($('fName'), 'Unbekannt'); E.type($('fNumber'), '12'); E.type($('fSet'), 'Ordner');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards');
    const fb = E.btn($('addResults'), 'Als freie Karte speichern');
    ok('stage none: Knopf „Als freie Karte speichern“', !!fb);
    E.click(fb);
    ok('Formular: Name/Set/Nummer vorbelegt', $('frName').value === 'Unbekannt' && $('frSet').value === 'Ordner' && $('frNumber').value === '12');
    ok('Formular: Variante Normal/Holo/Reverse Holo/1. Edition', [...$('frVariant').options].map(o => o.textContent).join('|') === 'Normal|Holo|Reverse Holo|1. Edition' && $('frVariant').value === 'normal');
    ok('Formular: Zustand, Sprache, Sonderversion, Anzahl, eigener Preis', !!($('frCond') && $('frLang') && $('frVersion') && $('frQty') && $('frOwnPrice')) && $('frLang').value === 'DE');
    // Zurück und wieder hin
    E.click(E.btn($('addResults'), 'Zurück'));
    ok('Zurück zeigt wieder den Knopf', !!E.btn($('addResults'), 'Als freie Karte speichern') && !$('frName'));
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    // leerer Name
    $('frName').value = '  ';
    E.click($('frSave'));
    ok('leerer Name: kein addFreeCard', E.calls('addFreeCard').length === 0 && /Namen/.test($('addMsg').textContent));
    $('frName').value = 'Unbekannt';
    E.pick($('frVariant'), 'holo'); E.pick($('frCond'), 'EX'); E.pick($('frLang'), 'JP');
    $('frVersion').value = 'Staff'; $('frQty').value = '3'; $('frOwnPrice').value = '2,5';
    E.click($('frSave'));
    E.click($('frSave'));
    ok('addFreeCard genau einmal', E.calls('addFreeCard').length === 1);
    const req = E.calls('addFreeCard')[0].args[0];
    ok('addFreeCard-Argumente', J(req) === J({ name: 'Unbekannt', setName: 'Ordner', number: '12', variant: 'holo', condition: 'EX', qty: 3, cardLang: 'JP', version: 'Staff', ownPrice: 2.5 }), req);
    const r = await E.respond('addFreeCard');
    ok('freie Karte gespeichert, Formular weg', /hinzugefügt/.test($('addMsg').textContent) && !$('frName') && E.win.state.lastEid === r.res.eid);
    ok('neue Version gemerkt', /value="Staff"/.test($('versionList').innerHTML));
    // Serverfehler: Knopf wieder frei
    E.click(E.btn($('searchForm'), 'Suchen'));
    E.type($('fName'), 'Unbekannt');
    E.win.doSearch();
    await E.respondAll();
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    E.click($('frSave'));
    await E.respond('addFreeCard', { error: 'Sperre belegt' });
    ok('Fehler: Meldung, Knopf wieder aktiv', /Sperre belegt/.test($('addMsg').textContent) && /nichts gespeichert/.test($('addMsg').textContent) && !$('frSave').disabled);

    // Set-Auswahl: Knopf auch dort, auch nach erfolgloser Nummernsuche
    S.searchCardsImpl = () => ({ stage: 'pickSet', cards: [], notes: [], number: '99', sets: [{ id: 'base1', name: 'Basis-Set', nameEn: 'Base', preferred: true }] });
    E.type($('fName'), 'Mew'); E.type($('fNumber'), '99');
    E.win.doSearch();
    await E.respond('searchCards');
    ok('Set-Auswahl: freier-Karte-Knopf', !!E.btn($('addResults'), 'Als freie Karte speichern'));
    E.click($('setGrid').querySelector('.tile'));
    ok('getCardBySetNumber(setId, number)', J(E.calls('getCardBySetNumber')[0].args) === J(['base1', '99']));
    await E.respond('getCardBySetNumber');
    ok('Nummer nicht gefunden: Fehler + Picker + Knopf', /gibt es in diesem Set nicht/.test($('addMsg').textContent) && !!$('setGrid') && !!E.btn($('addResults'), 'Als freie Karte speichern'));
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    ok('Formular nach Set-Auswahl vorbelegt', $('frName').value === 'Mew' && $('frNumber').value === '99');
    E.click(E.btn($('addResults'), 'Zurück'));
    ok('Zurück zur Set-Auswahl', !!$('setGrid'));
    ok('keine Skriptfehler (frei)', E.errors.length === 0, E.errors);
  }

  // ---- Sammlung: Darstellung, Escaping ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    await E.startup();
    await E.openColl();
    const st = E.win.state;
    ok('Gruppen statt Einzelzeilen', st.groups.length === 5, st.groups.map(g => g.name));
    const gi = E.gi('Glurak');
    const head = $('gh' + gi).textContent;
    ok('Glurak: Exemplare-Text', head.indexOf('1× DE, 2× DE NM') >= 0, head);
    ok('Glurak: Anzahl 3', $('gh' + gi).querySelector('.cnt').textContent === '3');
    ok('Glurak: Set · Nummer · Variante · Preis', /Flammende Finsternis · 025\/189 · Normal · 1,50/.test(head), head);
    ok('Glurak: kein "manuell"', !/manuell/.test(head));
    const pi = E.gi('Pikachu');
    ok('Pikachu: Name · Version', $('gh' + pi).querySelector('.t').textContent === 'Pikachu · Snowflake', $('gh' + pi).querySelector('.t').textContent);
    ok('Pikachu: Preis manuell markiert', /4,00\s€ manuell/.test($('gh' + pi).textContent), $('gh' + pi).textContent);
    const fi = E.gIdx(g => g.isFree);
    ok('freie Karte markiert', /freie Karte/.test($('gh' + fi).textContent));
    ok('feindlicher Name escaped (kein img[src=x])', !$('collResults').querySelector('img[src="x"]') && $('gh' + fi).querySelector('.t').textContent.indexOf('<img src=x') === 0);
    ok('feindlicher Setname escaped (kein script)', !$('collResults').querySelector('script') && /<script>/.test($('gh' + fi).textContent));
    const zi = E.gi('Bisasam');
    ok('0er-Gruppe grau, -1 gesperrt', $('gh' + zi).querySelector('.item').classList.contains('zero') && E.btn($('gh' + zi), '−1').disabled);
    // aufklappen
    ok('zu: keine Exemplar-Zeilen', $('gx' + gi).classList.contains('hidden'));
    E.expand(gi);
    ok('aufgeklappt', !$('gx' + gi).classList.contains('hidden'));
    const rowsText = [...$('gr' + gi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('Exemplar-Zeilen: Anzahl × Sprache Zustand · Herkunft', rowsText[0].indexOf('2× DE NM · von Hand') === 0 && rowsText[1].indexOf('1× DE · Pokemon Ordner, Import 3') === 0, rowsText);
    ok('Zusatzwerte inline', /Ordner: Seite 3/.test(rowsText[1]));
    ok('je Zeile -1/+1/Bearbeiten', $('gr' + gi).querySelectorAll('button').length === 6 && !!E.btn($('gr' + gi), 'Bearbeiten'));
    E.expand(fi);
    ok('feindliche Zusatzspalte escaped', !$('gr' + fi).querySelector('i') && !$('gr' + fi).querySelector('.einfo b') && /<i>Notiz<\/i>: <b>fett<\/b>/.test($('gr' + fi).textContent));
    ok('freie Gruppe: Verknüpfen-Knopf', !!E.btn($('gl' + fi), 'Mit tcgdex-Karte verknüpfen'));
    ok('tcgdex-Gruppe: kein Verknüpfen-Knopf', !E.btn($('gl' + gi), 'Mit tcgdex-Karte verknüpfen'));
    ok('Eigener-Preis-Feld in der Gruppe', !!$('op' + gi) && !!E.btn($('gp' + gi), 'Speichern') && E.btn($('gp' + gi), 'Entfernen').disabled);
    E.expand(gi);
    ok('wieder zugeklappt', $('gx' + gi).classList.contains('hidden'));
    ok('keine Treffer: Hinweis', (E.win.renderCollection({ total: 0, groups: [] }), /Nichts gefunden/.test($('collResults').textContent)));
    ok('kein Gedankenstrich in der Sammlung', $('paneColl').textContent.indexOf('—') < 0);
    ok('keine Skriptfehler (Darstellung)', E.errors.length === 0, E.errors);
    ok('kein XSS ausgeführt', E.win.__xss === undefined);
  }

  // ---- Gruppe -1: eine Zeile direkt, mehrere: Auswahl ----
  {
    const E = boot('sidebar');
    const { $, G } = E;
    await E.startup();
    await E.openColl();
    const pi = E.gi('Pikachu');
    E.click(E.btn($('gh' + pi), '−1'));
    ok('-1 mit genau einer Zeile: adjustEntry direkt', J(E.calls('adjustEntry')[0].args) === J([G.pImp.eid, -1]) && $('gc' + pi).innerHTML === '');
    await E.respond('adjustEntry');
    ok('-1: Anzahl 1', $('gh' + pi).querySelector('.cnt').textContent === '1');
    const gi = E.gi('Glurak');
    E.click(E.btn($('gh' + gi), '−1'));
    ok('-1 mit mehreren Zeilen: kein Aufruf, Auswahl', E.calls('adjustEntry').length === 0 && /Welches Exemplar\?/.test($('gc' + gi).textContent));
    const opts = [...$('gc' + gi).querySelectorAll('button.opt')].map(b => b.textContent);
    ok('Auswahl listet Zeilen mit Herkunft', J(opts) === J(['2× DE NM · von Hand', '1× DE · Pokemon Ordner, Import 3', 'Abbrechen']), opts);
    E.click(E.btn($('gc' + gi), 'Abbrechen'));
    ok('Abbrechen schließt die Auswahl', $('gc' + gi).innerHTML === '' && E.calls('adjustEntry').length === 0);
    E.click(E.btn($('gh' + gi), '−1'));
    E.click(E.btn($('gc' + gi), '1× DE · Pokemon Ordner, Import 3'));
    ok('gewählte Zeile: adjustEntry(importEid, -1)', J(E.calls('adjustEntry')[0].args) === J([G.gImp.eid, -1]) && $('gc' + gi).innerHTML === '');
    await E.respond('adjustEntry');
    ok('nach -1: Anzahl 2, Exemplare neu berechnet', $('gh' + gi).querySelector('.cnt').textContent === '2' && /2× DE NM/.test($('gh' + gi).textContent) && !/1× DE,/.test($('gh' + gi).textContent), $('gh' + gi).textContent);
    ok('handentfernt protokolliert (Stub)', E.S.proto.length === 2);
    // jetzt nur noch eine Zeile mit Anzahl > 0
    E.click(E.btn($('gh' + gi), '−1'));
    ok('-1 danach direkt auf die Hand-Zeile', J(E.calls('adjustEntry')[0].args) === J([G.gHand.eid, -1]));
    await E.respond('adjustEntry');
    ok('keine Skriptfehler (-1)', E.errors.length === 0, E.errors);
  }

  // ---- Gruppe +1 ----
  {
    const E = boot('sidebar');
    const { $, G } = E;
    await E.startup();
    await E.openColl();
    const gi = E.gi('Glurak');
    E.click(E.btn($('gh' + gi), '+1'));
    ok('+1 mit Hand-Zeile: adjustEntry(handEid, 1)', J(E.calls('adjustEntry')[0].args) === J([G.gHand.eid, 1]));
    await E.respond('adjustEntry');
    ok('+1: Anzahl 4', $('gh' + gi).querySelector('.cnt').textContent === '4');
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn($('gh' + pi), '+1'));
    ok('+1 mit genau einer (Import-)Zeile: adjustEntry(dieseEid, 1)', J(E.calls('adjustEntry')[0].args) === J([G.pImp.eid, 1]));
    const r = await E.respond('adjustEntry');
    ok('Server legt Hand-Zeile an (Stub)', !!r.res.token.createdEid && r.res.eid === r.res.token.createdEid);
    const rows = [...$('gr' + pi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('neue Zeile „von Hand“ oben, Anzahl 3', rows.length === 2 && rows[0].indexOf('1× DE · von Hand') === 0 && $('gh' + pi).querySelector('.cnt').textContent === '3', rows);
    ok('Exemplare neu: 3× DE', /3× DE/.test($('gh' + pi).textContent));
    const ei = E.gi('Evoli');
    E.click(E.btn($('gh' + ei), '+1'));
    ok('+1 ohne Hand-Zeile, mehrere Zeilen: Auswahl', E.calls('adjustEntry').length === 0 && /Welches Exemplar\?/.test($('gc' + ei).textContent) && /von Hand erfasst/.test($('gc' + ei).textContent));
    E.click(E.btn($('gc' + ei), '1× EN LP · Tauschliste, Import 4'));
    ok('+1 Auswahl: adjustEntry(gewählt, 1)', J(E.calls('adjustEntry')[0].args) === J([G.e2.eid, 1]));
    await E.respond('adjustEntry');
    ok('+1 Auswahl: Anzahl 3', $('gh' + ei).querySelector('.cnt').textContent === '3');
    // jetzt hat Evoli eine Hand-Zeile -> direkt
    E.click(E.btn($('gh' + ei), '+1'));
    ok('+1 danach direkt auf die neue Hand-Zeile', E.calls('adjustEntry').length === 1 && E.calls('adjustEntry')[0].args[0] === E.S.rows.find(x => x.name === 'Evoli' && x.origin === 'Hand').eid);
    await E.respond('adjustEntry');
    // Zeilen-Knöpfe
    E.expand(ei);
    const rowBtns = $('gr' + ei).querySelectorAll('.erow');
    const firstImport = [...rowBtns].findIndex(el => /Import 3/.test(el.textContent));
    E.click(E.btn(rowBtns[firstImport], '−1'));
    ok('Zeilen -1 auf Import-Zeile', J(E.calls('adjustEntry')[0].args) === J([G.e1.eid, -1]));
    await E.respond('adjustEntry');
    ok('Zeile auf 0: Zeilen -1 gesperrt', E.btn($('gr' + ei).querySelectorAll('.erow')[firstImport], '−1').disabled);
    ok('keine Skriptfehler (+1)', E.errors.length === 0, E.errors);
  }

  // ---- Rückgängig ----
  {
    const E = boot('sidebar');
    const { $, G, S } = E;
    await E.startup();
    await E.openColl();
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn($('gh' + pi), '+1'));
    ok('während des Aufrufs: Knöpfe gesperrt', E.btn($('gh' + pi), '+1').disabled && E.btn($('gh' + pi), '−1').disabled);
    E.click(E.btn($('gh' + pi), '+1'));
    E.win.groupPlus(pi);
    ok('Doppelklick sendet nur einmal', E.calls('adjustEntry').length === 1);
    const r = await E.respond('adjustEntry');
    ok('Rückgängig sichtbar', !!E.btn($('gh' + pi), 'Rückgängig'));
    E.click(E.btn($('gh' + pi), 'Rückgängig'));
    ok('Rückgängig klappt die Gruppe nicht zu', !$('gx' + pi).classList.contains('hidden'));
    ok('revertAdjust mit dem Token', E.calls('revertAdjust').length === 1 && J(E.calls('revertAdjust')[0].args) === J([r.res.token]), E.calls('revertAdjust')[0] && E.calls('revertAdjust')[0].args);
    ok('während revert kein Rückgängig', !E.btn($('gh' + pi), 'Rückgängig'));
    await E.respond('revertAdjust');
    const rows = [...$('gr' + pi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('angelegte Hand-Zeile wieder weg, Anzahl 2', rows.length === 1 && /Import 3/.test(rows[0]) && $('gh' + pi).querySelector('.cnt').textContent === '2', rows);
    ok('Stub: Zeile gelöscht', !S.rows.some(x => x.eid === r.res.token.createdEid));
    // Rückgängig verschwindet nach 5 s
    const gi = E.gi('Glurak');
    E.click(E.btn($('gh' + gi), '+1'));
    await E.respond('adjustEntry');
    ok('Rückgängig da', !!E.btn($('gh' + gi), 'Rückgängig'));
    E.win.__advance(4900);
    ok('nach 4,9 s noch da', !!E.btn($('gh' + gi), 'Rückgängig'));
    E.win.__advance(200);
    ok('nach 5 s weg', !E.btn($('gh' + gi), 'Rückgängig'));
    // -1 auf Import-Zeile, Rückgängig löscht das Protokoll
    E.click(E.btn($('gh' + gi), '−1'));
    E.click(E.btn($('gc' + gi), '1× DE · Pokemon Ordner, Import 3'));
    const r2 = await E.respond('adjustEntry');
    ok('handentfernt-LogId im Token', r2.res.token.logIds.length === 1);
    E.click(E.btn($('gh' + gi), 'Rückgängig'));
    ok('revertAdjust bekommt logIds', J(E.calls('revertAdjust')[0].args[0]) === J(r2.res.token));
    await E.respond('revertAdjust');
    ok('Protokoll leer, Anzahl wieder 4', S.proto.length === 0 && $('gh' + gi).querySelector('.cnt').textContent === '4');
    // neue Änderung verwirft altes Rückgängig
    E.click(E.btn($('gh' + gi), '+1'));
    await E.respond('adjustEntry');
    E.click(E.btn($('gh' + gi), '+1'));
    ok('alte Rückgängig-Option weg, solange neu gespeichert wird', !E.btn($('gh' + gi), 'Rückgängig'));
    await E.respond('adjustEntry');
    // revert-Fehler
    E.click(E.btn($('gh' + gi), 'Rückgängig'));
    await E.respond('revertAdjust', { error: 'Zeitüberschreitung' });
    ok('revert-Fehler: Meldung, Knöpfe frei', /Zeitüberschreitung/.test($('collMsg').textContent) && !E.btn($('gh' + gi), '+1').disabled);
    ok('keine Skriptfehler (Rückgängig)', E.errors.length === 0, E.errors);
  }

  // ---- Bearbeiten ----
  {
    const E = boot('sidebar');
    const { $, G, S } = E;
    await E.startup();
    await E.openColl();
    let gi = E.gi('Glurak');
    E.expand(gi);
    const erows = () => [...$('gr' + gi).querySelectorAll('.erow')];
    E.click(E.btn(erows()[0], 'Bearbeiten'));
    ok('Formular: Zustand/Sprache/Sonderversion', $('eCond' + gi).value === 'NM' && $('eLang' + gi).value === 'DE' && $('eVer' + gi).value === '');
    ok('Formular: je Zusatzspalte ein Feld', !!$('eX' + gi + '_0') && !!$('eX' + gi + '_1') && /Ordner/.test($('ge' + gi).textContent) && /Notiz/.test($('ge' + gi).textContent));
    ok('„Wie viele davon?“ bei Anzahl 2', /Wie viele davon\?/.test($('ge' + gi).textContent) && $('eQty' + gi).value === '2' && $('eQty' + gi).max === '2');
    ok('bearbeitete Zeile markiert', erows()[0].classList.contains('sel'));
    // nichts geändert
    E.click(E.btn($('ge' + gi), 'Speichern'));
    ok('ohne Änderung kein editEntry', E.calls('editEntry').length === 0 && /Nichts geändert/.test($('collMsg').textContent) && $('ge' + gi).innerHTML === '');
    E.click(E.btn(erows()[0], 'Bearbeiten'));
    E.pick($('eCond' + gi), 'LP');
    E.type($('eX' + gi + '_0'), 'Box 1');
    E.type($('eQty' + gi), '5');
    E.click(E.btn($('ge' + gi), 'Speichern'));
    ok('ungültige Menge: kein Aufruf', E.calls('editEntry').length === 0 && /1 bis 2/.test($('collMsg').textContent));
    E.type($('eQty' + gi), '1');
    // Zählung neu zeichnen lässt Formularwerte stehen
    E.click(E.btn($('gh' + gi), '+1'));
    await E.respond('adjustEntry');
    ok('Formular übersteht Neuzeichnen', $('eCond' + gi).value === 'LP' && $('eX' + gi + '_0').value === 'Box 1');
    ok('Formular nach +1 aktualisiert (max 3, Menge bleibt 1, Kopf 3×)', $('eQty' + gi).max === '3' && $('eQty' + gi).value === '1' && /Bearbeiten: 3× DE NM/.test($('ge' + gi).textContent), $('ge' + gi).textContent);
    E.click(E.btn($('ge' + gi), 'Speichern'));
    ok('während des Speicherns: Knopf gesperrt', E.btn($('ge' + gi), 'Speichere …') && E.btn($('ge' + gi), 'Speichere …').disabled);
    E.win.saveEdit(gi); // Doppelklick
    ok('editEntry genau einmal', E.calls('editEntry').length === 1);
    const a = E.calls('editEntry')[0].args;
    ok('editEntry(eid, nur Änderungen, qty)', J(a) === J([G.gHand.eid, { cond: 'LP', extras: { Ordner: 'Box 1' } }, 1]), a);
    await E.respond('editEntry');
    ok('nach editEntry: Liste neu laden', E.calls('searchCollection').length === 1);
    await E.respond('searchCollection');
    gi = E.gi('Glurak');
    ok('Gespeichert-Meldung, Gruppe bleibt offen', /Gespeichert/.test($('collMsg').textContent) && !$('gx' + gi).classList.contains('hidden'));
    const t = [...$('gr' + gi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('aufgeteilt: 2× NM (nach +1), 1× LP', t.some(x => x.indexOf('2× DE NM · von Hand') === 0) && t.some(x => x.indexOf('1× DE LP · von Hand') === 0 && /Box 1/.test(x)), t);
    // Zeile mit Anzahl 1: kein Mengenfeld, qty 1; Sprache + Version
    const impIdx = erows().findIndex(el => /Import 3/.test(el.textContent));
    E.click(E.btn(erows()[impIdx], 'Bearbeiten'));
    ok('Anzahl 1: kein „Wie viele davon?“', !$('eQty' + gi) && !/Wie viele davon/.test($('ge' + gi).textContent));
    ok('Zusatzwert vorbelegt', $('eX' + gi + '_0').value === 'Seite 3');
    E.pick($('eLang' + gi), 'EN');
    E.type($('eVer' + gi), ' Snowflake ');
    E.click(E.btn($('ge' + gi), 'Speichern'));
    const b = E.calls('editEntry')[0].args;
    ok('editEntry(importEid, {cardLang, version}, 1)', J(b) === J([G.gImp.eid, { cardLang: 'EN', version: 'Snowflake' }, 1]), b);
    await E.respond('editEntry');
    await E.respond('searchCollection');
    const pi = E.gIdx(g => g.name === 'Glurak' && g.version === 'Snowflake');
    ok('Version verschiebt in neue Gruppe, die offen ist', pi >= 0 && !$('gx' + pi).classList.contains('hidden') && $('gh' + pi).querySelector('.t').textContent === 'Glurak · Snowflake');
    // Fehler
    E.click(E.btn($('gr' + pi), 'Bearbeiten'));
    E.pick($('eCond' + pi), 'PO');
    E.click(E.btn($('ge' + pi), 'Speichern'));
    await E.respond('editEntry', { error: 'Eintrag nicht gefunden.' });
    ok('editEntry-Fehler: Formular bleibt, Meldung', /nicht gefunden/.test($('collMsg').textContent) && !!$('eCond' + pi) && !E.btn($('ge' + pi), 'Speichern').disabled);
    E.click(E.btn($('ge' + pi), 'Abbrechen'));
    ok('Abbrechen schließt das Formular', $('ge' + pi).innerHTML === '');
    ok('keine Skriptfehler (Bearbeiten)', E.errors.length === 0, E.errors);
  }

  // ---- Eigener Preis ----
  {
    const E = boot('sidebar');
    const { $, S } = E;
    await E.startup();
    await E.openColl();
    const gi = E.gi('Glurak');
    E.expand(gi);
    E.type($('op' + gi), '0');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('Preis 0: kein Aufruf, Fehler', E.calls('setGroupOwnPrice').length === 0 && /größer als 0/.test($('collMsg').textContent));
    E.type($('op' + gi), '2,50');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('während des Speicherns gesperrt', E.btn($('gp' + gi), 'Speichern').disabled);
    E.win.savePrice(gi);
    ok('setGroupOwnPrice(gkey, 2.5) einmal', E.calls('setGroupOwnPrice').length === 1 && J(E.calls('setGroupOwnPrice')[0].args) === J([E.win.state.groups[gi].gkey, 2.5]));
    await E.respond('setGroupOwnPrice');
    ok('Kopfzeile: 2,50 € manuell', /2,50\s€ manuell/.test($('gh' + gi).textContent), $('gh' + gi).textContent);
    ok('Entfernen aktiv, Feld 2,50', !E.btn($('gp' + gi), 'Entfernen').disabled && $('op' + gi).value === '2,50');
    ok('Stub: alle Zeilen der Gruppe', S.rows.filter(r => r.name === 'Glurak').every(r => r.ownPrice === 2.5));
    E.click(E.btn($('gp' + gi), 'Entfernen'));
    ok('setGroupOwnPrice(gkey, null)', J(E.calls('setGroupOwnPrice')[0].args) === J([E.win.state.groups[gi].gkey, null]));
    await E.respond('setGroupOwnPrice');
    ok('wieder Trendpreis, kein manuell', /1,50\s€/.test($('gh' + gi).textContent) && !/manuell/.test($('gh' + gi).textContent) && $('op' + gi).value === '' && E.btn($('gp' + gi), 'Entfernen').disabled);
    ok('Meldung Preis entfernt', /entfernt/.test($('collMsg').textContent));
    E.type($('op' + gi), '1.234,5');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('Tausenderpunkt verstanden', E.calls('setGroupOwnPrice')[0].args[1] === 1234.5);
    await E.respond('setGroupOwnPrice', { error: 'Gruppe nicht gefunden.' });
    ok('Fehler: Knopf wieder frei', /nicht gefunden/.test($('collMsg').textContent) && !E.btn($('gp' + gi), 'Speichern').disabled);
    ok('keine Skriptfehler (Preis)', E.errors.length === 0, E.errors);
  }

  // ---- Freie Gruppe verknüpfen ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    await E.startup();
    await E.openColl();
    let fi = E.gIdx(g => g.isFree);
    const oldGkey = E.win.state.groups[fi].gkey;
    E.expand(fi);
    E.click(E.btn($('gl' + fi), 'Mit tcgdex-Karte verknüpfen'));
    ok('Mini-Suche vorbelegt', $('lkName' + fi).value === G.free.name && $('lkNum' + fi).value === '8' && $('lkSet' + fi).value === G.free.setName);
    E.type($('lkName' + fi), 'Mew');
    E.type($('lkSet' + fi), '');
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [
      { id: 'base1-15', lang: 'de', name: 'Mew', setName: 'Basis-Set', localId: '15', image: '' },
      { id: 'base1-8', lang: 'de', name: 'Mew', setName: 'Basis-Set', localId: '8', image: '' }] });
    E.click(E.btn($('gl' + fi), 'Suchen'));
    E.win.linkSearch(null, fi); // zweite Suche, die erste wird veraltet
    ok('searchCards({name, number, set})', J(E.calls('searchCards')[0].args) === J([{ name: 'Mew', number: '8', set: '' }]));
    await E.respond('searchCards', { value: { stage: 'de', notes: ['ALT'], cards: [] } });
    ok('veraltete Link-Suche ignoriert', !/ALT/.test($('gl' + fi).textContent) && /Suche bei tcgdex/.test($('gl' + fi).textContent));
    await E.respond('searchCards');
    const tiles = $('gl' + fi).querySelectorAll('.tile');
    ok('Kacheln zur Auswahl', tiles.length === 2);
    // Zählung neu zeichnen lässt die Suche stehen
    E.click(E.btn($('gh' + fi), '+1'));
    await E.respond('adjustEntry');
    ok('Suche übersteht Neuzeichnen', $('gl' + fi).querySelectorAll('.tile').length === 2);
    E.click($('gl' + fi).querySelectorAll('.tile')[1]);
    ok('linkFreeGroup(gkey, id, lang, base)', J(E.calls('linkFreeGroup')[0].args) === J([oldGkey, 'base1-8', 'de', 'base']), E.calls('linkFreeGroup')[0].args);
    E.win.linkPick(fi, 0);
    ok('kein zweiter linkFreeGroup', E.calls('linkFreeGroup').length === 1);
    const r = await E.respond('linkFreeGroup');
    ok('danach Liste neu laden', E.calls('searchCollection').length === 1);
    await E.respond('searchCollection');
    const ni = E.gIdx(g => g.gkey === r.res.gkey);
    ok('verknüpfte Gruppe offen, nicht mehr frei, Meldung', ni >= 0 && !E.win.state.groups[ni].isFree && !$('gx' + ni).classList.contains('hidden') && /verknüpft/.test($('collMsg').textContent));
    ok('alte Gruppe nicht mehr als offen gemerkt', !E.win.state.open[oldGkey]);

    // Set-Auswahl im Verknüpfen
    S.addRow({ id: '', name: 'Celebi', setName: 'Ordner', localId: '7', count: 1 });
    S.cards['base1-7'] = { id: 'base1-7', name: 'Celebi', setName: 'Basis-Set', setId: 'base1', localId: '7', setSize: 102, baseVariant: 'holo', baseLabel: 'Holo', image: '' };
    E.type($('colQuery'), 'Celebi');
    E.win.__advance(400);
    await E.respond('searchCollection');
    fi = E.gi('Celebi');
    E.expand(fi);
    E.click(E.btn($('gl' + fi), 'Mit tcgdex-Karte verknüpfen'));
    S.searchCardsImpl = q => ({ stage: 'pickSet', notes: ['Wähle das Set'], cards: [], number: q.number,
      sets: [{ id: 'base1', name: 'Basis-Set', nameEn: 'Base Set', preferred: true }, { id: 'neo1', name: 'Neo <Genesis>', nameEn: 'Neo Genesis', preferred: false }] });
    E.click(E.btn($('gl' + fi), 'Suchen'));
    await E.respond('searchCards');
    ok('Set-Auswahl: nur Vorauswahl', $('lkSets' + fi).querySelectorAll('.tile').length === 1);
    E.type($('lkFilter' + fi), 'neo');
    ok('Set-Filter findet weitere, escaped', $('lkSets' + fi).querySelectorAll('.tile').length === 1 && /Neo <Genesis>/.test($('lkSets' + fi).textContent) && document_has_no_genesis_tag($('lkSets' + fi)));
    E.type($('lkFilter' + fi), '');
    E.click($('lkSets' + fi).querySelector('.tile'));
    ok('getCardBySetNumber(setId, Nummer)', J(E.calls('getCardBySetNumber')[0].args) === J(['base1', '7']));
    await E.respond('getCardBySetNumber');
    ok('Karte als Kachel', $('gl' + fi).querySelectorAll('.tile').length === 1 && /Celebi/.test($('gl' + fi).textContent));
    E.click($('gl' + fi).querySelector('.tile'));
    ok('linkFreeGroup nach Set-Auswahl', J(E.calls('linkFreeGroup')[0].args.slice(1)) === J(['base1-7', 'de', 'base']));
    await E.respond('linkFreeGroup', { error: 'tcgdex nicht erreichbar' });
    ok('Link-Fehler: Meldung, Kachel wieder wählbar', /nicht erreichbar/.test($('gl' + fi).textContent) && $('gl' + fi).querySelectorAll('.tile').length === 1);
    // Reverse-Variante bleibt
    E.win.state.groups[fi].variant = 'reverse';
    E.click($('gl' + fi).querySelector('.tile'));
    ok('Variante reverse wird weitergegeben', E.calls('linkFreeGroup')[0].args[3] === 'reverse');
    await E.respond('linkFreeGroup', { error: 'x' });
    E.click(E.btn($('gl' + fi), 'Abbrechen'));
    ok('Abbrechen schließt die Mini-Suche', !!E.btn($('gl' + fi), 'Mit tcgdex-Karte verknüpfen'));
    ok('keine Skriptfehler (Verknüpfen)', E.errors.length === 0, E.errors);
  }

  // ---- Veraltete Antworten in der Sammlung ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    await E.startup();
    E.click($('tabColl'));
    E.type($('colQuery'), 'Glurak');
    E.win.loadCollection();
    // erste (leere Suche) kommt zuletzt
    await E.respond('searchCollection', { last: true });
    await E.respond('searchCollection');
    ok('ältere Listenantwort ignoriert', E.win.state.groups.length === 1 && E.win.state.groups[0].name === 'Glurak');
    // Debounce: nur eine Anfrage
    E.type($('colQuery'), 'G'); E.type($('colQuery'), 'Gl'); E.type($('colQuery'), 'Glurak');
    E.win.__advance(399);
    ok('Debounce: noch keine Anfrage', E.calls('searchCollection').length === 0);
    E.win.__advance(1);
    ok('Debounce: genau eine Anfrage', E.calls('searchCollection').length === 1);
    await E.respond('searchCollection');
    // Antwort kommt nach Neuladen: kein Fehler, neue Liste nachgezogen
    E.click(E.btn($('gh0'), '+1'));
    E.win.loadCollection();
    await E.respond('searchCollection');           // neue Liste (Server hat +1 schon)
    $('gh0').setAttribute('data-x', 'neu');
    let threw = false;
    try { await E.respond('adjustEntry'); } catch (e) { threw = true; }
    ok('späte adjust-Antwort nach Neuladen wirft nicht', !threw && E.errors.length === 0, E.errors);
    ok('neue Liste per gkey nachgezogen', $('gh0').querySelector('.cnt').textContent === '4' && E.win.state.groups[0].count === 4);
    ok('kein Rückgängig in der neuen Liste', !E.btn($('gh0'), 'Rückgängig'));
    // Listenantwort mit altem Stand, adjust-Antwort kam während des Ladens
    const stale = S.searchCollection('Glurak', '');
    E.click(E.btn($('gh0'), '+1'));          // 4 -> 5
    E.win.loadCollection();                   // Liste angefragt, bevor adjust zurück ist
    await E.respond('adjustEntry');           // kommt während des Ladens an
    await E.respond('searchCollection', { value: stale }); // Server las noch den alten Stand (4)
    ok('verspätete Änderung auf neue Liste übertragen', $('gh0').querySelector('.cnt').textContent === '5' && /1× DE, 4× DE NM/.test($('gh0').textContent), $('gh0').textContent);
    // Änderung, die vor dem Neuladen fertig war, wird nicht noch einmal angewendet
    S.rows.find(r => r.eid === G.gHand.eid).count = 9; // jemand anderes hat geändert
    E.win.loadCollection();
    await E.respond('searchCollection');
    ok('ältere Ergebnisse überschreiben frische Liste nicht', $('gh0').querySelector('.cnt').textContent === '10');
    // Preis-Antwort nach Neuladen
    E.expand(0);
    E.type($('op0'), '3');
    E.click(E.btn($('gp0'), 'Speichern'));
    E.win.loadCollection();
    await E.respond('searchCollection', { value: S.searchCollection('Glurak', '') });
    await E.respond('setGroupOwnPrice');
    ok('Preis-Antwort zieht neue Liste nach', /3,00\s€ manuell/.test($('gh0').textContent));
    // Liste-Fehler nach neuerer Liste ignoriert
    E.win.loadCollection(); E.win.loadCollection();
    await E.respond('searchCollection', { last: true });
    await E.respond('searchCollection', { error: 'alt' });
    ok('veralteter Listenfehler ignoriert', !/alt/.test($('collMsg').textContent) && E.win.state.groups.length === 1);
    ok('keine Skriptfehler (stale)', E.errors.length === 0, E.errors);
  }

  // ---- Weitere Fälle: mehrere Hand-Zeilen, Tastatur, 44px, Fehler, applied 0 ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    await E.startup();
    const handEn = S.addRow({ id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', localId: '025', setSize: 189, cond: 'LP', lang: 'EN', count: 1, price: '', image: 'https://img/glurak' });
    S.rows.forEach(r => { if (r.name === 'Glurak') r.price = ''; });
    await E.openColl();
    const gi = E.gi('Glurak');
    ok('Preis "" vom Server: kein leerer Preisteil', !/·\s+·/.test($('gh' + gi).textContent) && !/kein Preis/.test($('gh' + gi).textContent), $('gh' + gi).textContent);
    E.click(E.btn($('gh' + gi), '+1'));
    ok('+1 mit zwei Hand-Zeilen: Auswahl statt Aufruf', E.calls('adjustEntry').length === 0 && /Welches Exemplar\?/.test($('gc' + gi).textContent));
    const opts = [...$('gc' + gi).querySelectorAll('button.opt')].map(b => b.textContent);
    ok('+1-Auswahl listet alle Zeilen', opts.length === 4 && opts.some(t => t === '1× EN LP · von Hand') && opts[3] === 'Abbrechen', opts);
    E.click(E.btn($('gc' + gi), '1× EN LP · von Hand'));
    ok('+1 auf gewählte Hand-Zeile', J(E.calls('adjustEntry')[0].args) === J([handEn.eid, 1]));
    await E.respond('adjustEntry');
    ok('Exemplare mit EN', /2× EN LP/.test($('gh' + gi).textContent) && $('gh' + gi).querySelector('.cnt').textContent === '5', $('gh' + gi).textContent);
    // applied 0: kein Rückgängig
    E.click(E.btn($('gh' + gi), '−1'));
    E.click(E.btn($('gc' + gi), '1× DE · Pokemon Ordner, Import 3'));
    await E.respond('adjustEntry', { value: { token: { eid: G.gImp.eid, applied: 0, logIds: [], createdEid: '' }, eid: G.gImp.eid, count: 0, groupCount: 4, applied: 0, gkey: E.win.state.groups[gi].gkey } });
    ok('applied 0: kein Rückgängig, Anzahl vom Server', !E.btn($('gh' + gi), 'Rückgängig') && $('gh' + gi).querySelector('.cnt').textContent === '4');
    // Fehler bei adjustEntry
    E.click(E.btn($('gh' + gi), '−1'));
    E.click($('gc' + gi).querySelector('button.opt'));
    await E.respond('adjustEntry', { error: 'Sperre belegt' });
    ok('adjust-Fehler: Meldung, Knöpfe frei, Anzahl unverändert', /Sperre belegt/.test($('collMsg').textContent) && !E.btn($('gh' + gi), '+1').disabled && $('gh' + gi).querySelector('.cnt').textContent === '4');
    // Tastatur
    const info = $('gh' + gi).querySelector('.info');
    info.dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('Enter klappt auf', !$('gx' + gi).classList.contains('hidden') && $('gh' + gi).querySelector('.info').getAttribute('aria-expanded') === 'true');
    E.click(E.btn($('gh' + gi), '+1'));
    E.click(E.btn($('gc' + gi), '2× EN LP · von Hand'));
    await E.respond('adjustEntry');
    const ub = E.btn($('gh' + gi), 'Rückgängig');
    ub.dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('Enter auf Rückgängig klappt nicht zu', !$('gx' + gi).classList.contains('hidden'));
    $('gh' + gi).querySelector('.info').dispatchEvent(new E.win.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    ok('Leertaste klappt zu', $('gx' + gi).classList.contains('hidden'));
    // 44px
    const css = $('collResults').ownerDocument.querySelector('style').textContent;
    const rule = sel => { const m = css.match(new RegExp('(^|\\n)\\s*' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')); return m ? m[2] : ''; };
    ok('44px: .btn', /min-height:\s*44px/.test(rule('.btn')));
    ok('44px: .btn.small', /min-height:\s*44px/.test(rule('.btn.small')) && /min-width:\s*44px/.test(rule('.btn.small')));
    ok('44px: .undo', /min-height:\s*44px/.test(rule('.undo')));
    ok('44px: aufklappbare Infozeile', /min-height:\s*44px/.test(rule('.item .info')));
    // loadUiConfig für ImportUi
    S.getUiConfig = () => ({ conditions: [], langs: [], versions: ['Snowflake', 'Staff'], extras: ['Ordner', 'Notiz', 'Fach'], viewExtras: ['Fach'] });
    const pr = E.win.loadUiConfig();
    await E.respond('getUiConfig');
    const cfg = await pr;
    ok('loadUiConfig lädt neu', cfg && E.win.UI_CONFIG.extras.length === 3 && E.win.UI_CONFIG.viewExtras[0] === 'Fach' && /value="Staff"/.test($('versionList').innerHTML) && E.win.LANGS.length === 11 && E.win.CONDITIONS.length === 8);
    E.expand(gi);
    E.click(E.btn($('gr' + gi), 'Bearbeiten'));
    ok('neue Zusatzspalte im Bearbeiten-Formular', !!$('eX' + gi + '_2') && /Fach/.test($('ge' + gi).textContent));
    ok('keine Skriptfehler (weitere Fälle)', E.errors.length === 0, E.errors);
  }

  // ---- Updates: Hinweis-Leiste, Bereich, Neue Version holen ----
  {
    const NEW = { available: '1.1.0', banner: '1.1.0', copyVersion: '1.1.0', templateUrl: 'https://docs.google.com/spreadsheets/d/TPL/copy',
      newer: [{ version: '1.1.0', date: '2026-10-22', prerelease: false, notes: ['<b>fett</b> neu', 'Zweiter Punkt'] }] };
    const E = boot('sidebar', { server: S => Object.assign(S.updInfo, NEW) });
    const { $ } = E;
    ok('Start: getUpdateInfo(false) angefragt', E.calls('getUpdateInfo').length === 1 && J(E.calls('getUpdateInfo')[0].args) === J([false]));
    await E.startup();
    ok('Hinweis-Leiste: neue Version', !$('updBar').classList.contains('hidden') && /Version 1\.1\.0 ist da\./.test($('updBar').textContent));
    ok('Fußzeile: Version und Updates', /Version 1\.0\.0 · Updates/.test(E.doc.querySelector('.foot').textContent));
    E.click(E.btn($('updBar'), 'Ansehen'));
    ok('Bereich Updates offen, alle Tabs inaktiv', !$('paneUpd').classList.contains('hidden') && $('paneAdd').classList.contains('hidden') &&
      !E.doc.querySelector('.tabs button.active'));
    ok('Neuheiten mit Datum, escaped', /Neu: Version 1\.1\.0/.test($('updInfo').textContent) && /1\.1\.0 · 22\.10\.2026/.test($('updInfo').textContent) &&
      /<b>fett<\/b>/.test($('updInfo').textContent) && !$('updInfo').querySelector('ul.rel b'));
    ok('Sidebar: Knopf Neue Version holen, Erklärung, Weg von Hand', !!E.btn($('updInfo'), 'Neue Version holen') && /im selben Ordner/.test($('updInfo').textContent) &&
      $('updInfo').querySelector('a[href="https://github.com/x/y#von-hand"]') && /Handy-Link gleich/.test($('updInfo').textContent));
    E.click(E.btn($('updInfo'), 'Neue Version holen'));
    E.click(E.btn($('updInfo'), 'Neue Version holen'));
    ok('Holen: ein Aufruf, Knöpfe gesperrt, Hinweis', E.calls('updateCopy').length === 1 && E.btn($('updInfo'), 'Neue Version holen').disabled && $('updBack').disabled &&
      E.btn($('updInfo'), 'Nach Updates suchen').disabled && $('updPre').disabled && /Lege die neue Tabelle an/.test($('updMsg').textContent));
    E.win.updLoad(true);
    await E.respond('getUpdateInfo');
    ok('während des Anlegens: Suchen überschreibt die Meldung nicht, Knöpfe bleiben gesperrt', /Lege die neue Tabelle an/.test($('updMsg').textContent) &&
      E.btn($('updInfo'), 'Neue Version holen').disabled);
    E.S.updInfo.newCopy = { url: 'https://docs.google.com/spreadsheets/d/NEUNEU/edit', version: '1.1.0' };
    await E.respond('updateCopy');
    const m = $('updMsg');
    ok('angelegt: Meldung, Link, Schritte', m.querySelector('.msg.ok') && m.querySelector('a[href="https://docs.google.com/spreadsheets/d/NEUNEU/edit"]') &&
      /Karten erfassen/.test(m.textContent) && /Jetzt übernehmen/.test(m.textContent) && /Neue Bereitstellung/.test(m.textContent) && !E.btn($('updInfo'), 'Neue Version holen').disabled);
    ok('danach: getUpdateInfo neu', E.calls('getUpdateInfo').length === 1);
    await E.respond('getUpdateInfo');
    ok('Bereich: Kopie schon angelegt, Link, kein Knopf für eine zweite', /schon angelegt/.test($('updInfo').textContent) && /Papierkorb/.test($('updInfo').textContent) &&
      $('updInfo').querySelector('a[href="https://docs.google.com/spreadsheets/d/NEUNEU/edit"]') && !E.btn($('updInfo'), 'Noch einmal anlegen') && !E.btn($('updInfo'), 'Neue Version holen'));
    ok('Schritte und Link nur einmal, Meldung bleibt', E.doc.querySelectorAll('#paneUpd ol.rel').length === 1 &&
      E.doc.querySelectorAll('#paneUpd a[href="https://docs.google.com/spreadsheets/d/NEUNEU/edit"]').length === 1 && /liegt im selben Ordner/.test($('updMsg').textContent));
    // Zustände
    const states = [
      [{ state: 'none', message: 'Du hast schon die neueste Version (1.1.0).' }, m => m.querySelector('.msg.ok') && /neueste/.test(m.textContent)],
      [{ state: 'notemplate', message: 'Für Version 1.1.0 gibt es noch keine Vorlage zum Kopieren.', guideUrl: 'https://github.com/x/y#von-hand' },
        m => m.querySelector('.msg.warn') && m.querySelector('a[href="https://github.com/x/y#von-hand"]')],
      [{ state: 'error', message: 'Die Vorlage von Version 1.1.0 ließ sich nicht öffnen.', templateUrl: 'https://docs.google.com/spreadsheets/d/TPL/copy' },
        m => m.querySelector('.msg.err') && m.querySelector('a[href="https://docs.google.com/spreadsheets/d/TPL/copy"]') &&
          m.querySelector('input.copyurl').value === 'https://docs.google.com/spreadsheets/d/ALT0/edit' && /Aus alter Tabelle übernehmen/.test(m.textContent)],
      [{ state: 'error', message: '<img src=x onerror="window.__xss=9">kaputt' }, m => m.querySelector('.msg.err') && !m.querySelector('img') && /kaputt/.test(m.textContent)]
    ];
    for (const [value, check] of states) {
      E.win.updCopy();
      await E.respond('updateCopy', { value });
      ok('Zustand ' + value.state + ' ' + (value.templateUrl ? 'mit Vorlage' : ''), !!check($('updMsg')), $('updMsg').innerHTML);
      if (value.state === 'none' || value.state === 'notemplate') {
        ok('Zustand ' + value.state + ': Bereich wird neu geladen', E.calls('getUpdateInfo').length === 1 && J(E.calls('getUpdateInfo')[0].args) === J([false]));
        await E.respond('getUpdateInfo');
        ok('Zustand ' + value.state + ': Meldung bleibt, solange der Bereich noch anderes zeigt', !!check($('updMsg')));
      }
    }
    E.win.updCopy();
    await E.respond('updateCopy', { error: 'Das Sheet ist gerade beschäftigt.' });
    ok('Serverfehler: Meldung, Knöpfe frei', /beschäftigt/.test($('updMsg').textContent) && !E.btn($('updInfo'), 'Nach Updates suchen').disabled);
    // Vorabversionen
    E.click($('updPre'));
    ok('Vorabversionen: setPrereleases(true)', J(E.calls('setPrereleases')[0].args) === J([true]));
    await E.respond('setPrereleases');
    ok('Vorabversionen: Haken bleibt', $('updPre').checked === true);
    E.click($('updPre'));
    await E.respond('setPrereleases', { error: 'nein' });
    ok('Vorabversionen: Fehler setzt Haken zurück', $('updPre').checked === true && /nein/.test($('updMsg').textContent));
    // Suchen
    E.click(E.btn($('updInfo'), 'Nach Updates suchen'));
    ok('Nach Updates suchen: getUpdateInfo(true)', J(E.calls('getUpdateInfo')[0].args) === J([true]) && /Suche nach Updates/.test($('updMsg').textContent));
    await E.respond('getUpdateInfo', { value: Object.assign({}, E.S.updInfo, { available: '', banner: '', newer: [], error: 'GitHub antwortet nicht wie erwartet (500).' }) });
    ok('Fehler beim Prüfen sichtbar, Leiste weg', /Prüfen ging nicht: GitHub/.test($('updInfo').textContent) && $('updBar').classList.contains('hidden'));
    E.click(E.btn($('updInfo'), 'Nach Updates suchen'));
    await E.respond('getUpdateInfo', { error: 'offline' });
    ok('Aufruf scheitert: Meldung', /Prüfen ging nicht: offline/.test($('updMsg').textContent));
    // ohne Vorlage für die neue Version
    E.S.updInfo.newCopy = null;
    E.S.updInfo.templateUrl = '';
    E.win.updLoad(false);
    await E.respond('getUpdateInfo');
    ok('ohne Vorlage: kein Knopf, Hinweis mit Anleitung', !E.btn($('updInfo'), 'Neue Version holen') && /noch keine Vorlage/.test($('updInfo').textContent) &&
      $('updInfo').querySelector('a[href="https://github.com/x/y#von-hand"]'));
    E.click($('updBack'));
    ok('Zurück: wieder Hinzufügen', !$('paneAdd').classList.contains('hidden') && $('paneUpd').classList.contains('hidden') && $('tabAdd').classList.contains('active'));
    ok('keine Skriptfehler (Updates)', E.errors.length === 0 && !E.win.__xss, E.errors);
  }
  {
    // Hinweis ausblenden, Start im Bereich
    const E = boot('sidebar', { start: 'upd', server: S => Object.assign(S.updInfo, { available: '1.1.0', banner: '1.1.0', newer: [{ version: '1.1.0', notes: [] }],
      templateUrl: 'https://docs.google.com/spreadsheets/d/TPL/copy' }) });
    const { $ } = E;
    ok('start=upd: Bereich sofort offen, lädt', !$('paneUpd').classList.contains('hidden') && /Lade/.test($('updInfo').textContent));
    await E.startup();
    ok('start=upd: gerendert nach getUpdateInfo', /Neu: Version 1\.1\.0/.test($('updInfo').textContent));
    E.click(E.btn($('updBar'), '×'));
    ok('× blendet die Leiste aus', $('updBar').classList.contains('hidden'));
    // Vorabversion ohne Vorlage: Holen legt die neueste Version mit Vorlage an
    Object.assign(E.S.updInfo, { available: '1.2.0-beta.1', banner: '1.2.0-beta.1', copyVersion: '1.1.0', newer: [{ version: '1.2.0-beta.1', prerelease: true, notes: [] }, { version: '1.1.0', notes: [] }] });
    E.win.updLoad(false);
    await E.respond('getUpdateInfo');
    ok('ohne Vorlage der neuesten: Hinweis, welche Version angelegt wird', /Für Version 1\.2\.0-beta\.1 gibt es noch keine Vorlage/.test($('updInfo').textContent) &&
      /legt Version 1\.1\.0 an/.test($('updInfo').textContent) && /neue Tabelle mit Version 1\.1\.0/.test($('updInfo').textContent) && !!E.btn($('updInfo'), 'Neue Version holen'));
    ok('keine Skriptfehler (Start im Bereich)', E.errors.length === 0, E.errors);
  }
  {
    // neue Tabelle, von „Neue Version holen“ angelegt: Übernahme sofort mit Vorschau
    const OLD = 'https://docs.google.com/spreadsheets/d/ALT/edit';
    const E = boot('sidebar', { start: 'takeover', server: S => Object.assign(S.updInfo, { collectionEmpty: true, pendingTake: OLD }) });
    const { $ } = E;
    await E.startup();
    ok('ausstehende Übernahme: Link eingetragen, Vorschau läuft', $('takeUrl').value === OLD && E.calls('takeoverPreview').length === 1 &&
      J(E.calls('takeoverPreview')[0].args) === J([OLD]) && !$('paneUpd').classList.contains('hidden'));
    ok('Leiste: Übernahme', /Übernimm jetzt die Daten/.test($('updBar').textContent));
    await E.respond('takeoverPreview');
    ok('Vorschau da, Knopf Jetzt übernehmen', !!E.btn($('takeMsg'), 'Jetzt übernehmen'));
    E.win.updLoad(false);
    await E.respond('getUpdateInfo');
    ok('erneutes Laden startet die Vorschau nicht noch einmal', E.calls('takeoverPreview').length === 0);
    E.click(E.btn($('updBar'), 'Übernehmen'));
    ok('Leistenknopf prüft erneut', E.calls('takeoverPreview').length === 1);
    await E.respond('takeoverPreview');
    // zweimal schnell prüfen: nur die letzte Antwort zählt
    E.click(E.btn($('takeBox'), 'Prüfen'));
    E.click(E.btn($('takeBox'), 'Prüfen'));
    await E.respond('takeoverPreview', { error: 'alte Antwort' });
    ok('späte erste Vorschau überschreibt nichts', !/alte Antwort/.test($('takeMsg').textContent) && /Prüfe/.test($('takeMsg').textContent));
    await E.respond('takeoverPreview');
    // während der Übernahme: nichts doppelt, Leiste ohne Übernehmen, Feld gesperrt
    E.click(E.btn($('takeMsg'), 'Jetzt übernehmen'));
    ok('Übernahme läuft: Feld und Prüfen gesperrt, Leiste ohne Übernehmen', E.calls('takeoverRun').length === 1 && $('takeUrl').disabled && $('takeCheck').disabled &&
      !E.btn($('updBar'), 'Übernehmen'));
    E.win.updOpenTakeover(true);
    E.win.takePreview();
    E.win.takeRun();
    ok('Übernahme läuft: keine Vorschau, kein zweiter Lauf', E.calls('takeoverPreview').length === 0 && E.calls('takeoverRun').length === 1 && /Übernehme/.test($('takeMsg').textContent));
    await E.respond('takeoverRun', { error: 'Die alte Tabelle lässt sich mit deinem Konto nicht bearbeiten.' });
    ok('Fehler, den ein neuer Versuch nicht behebt: kein Noch-einmal-Knopf', /nicht bearbeiten/.test($('takeMsg').textContent) && !E.btn($('takeMsg'), 'Noch einmal versuchen'));
    await E.respond('getUpdateInfo');
    E.click(E.btn($('takeBox'), 'Prüfen'));
    await E.respond('takeoverPreview');
    E.click(E.btn($('takeMsg'), 'Jetzt übernehmen'));
    await E.respond('takeoverRun', { error: 'Die Übernahme ist nicht fertig geworden (Zeit). Bitte versuch es noch einmal.' });
    ok('abgebrochen: Meldung, Noch einmal versuchen, Feld frei, Info neu', /nicht fertig geworden/.test($('takeMsg').textContent) && !!E.btn($('takeMsg'), 'Noch einmal versuchen') &&
      !$('takeUrl').disabled && !$('takeCheck').disabled && E.calls('getUpdateInfo').length === 1);
    await E.respond('getUpdateInfo');
    E.click(E.btn($('takeMsg'), 'Noch einmal versuchen'));
    ok('Noch einmal versuchen: neue Vorschau', E.calls('takeoverPreview').length === 1 && J(E.calls('takeoverPreview')[0].args) === J([OLD]));
    await E.respond('takeoverPreview');
    E.click(E.btn($('takeMsg'), 'Jetzt übernehmen'));
    await E.respond('takeoverRun');
    ok('fertig: Leiste bietet bis zur neuen Info keine Übernahme an', !E.btn($('updBar'), 'Übernehmen') && /stillgelegt/.test($('takeMsg').textContent));
    await E.respond('getUiConfig');
    await E.respond('getUpdateInfo');
    ok('keine Skriptfehler (ausstehende Übernahme)', E.errors.length === 0, E.errors);
  }
  {
    // Übernahme aus einer alten Tabelle
    const E = boot('sidebar', { server: S => Object.assign(S.updInfo, { collectionEmpty: true }) });
    const { $ } = E;
    await E.startup();
    ok('leere Tabelle: Leiste bietet Übernahme an', /Neue Tabelle\?/.test($('updBar').textContent));
    E.click(E.btn($('updBar'), 'Übernehmen'));
    ok('Übernehmen öffnet den Bereich mit Feld', !$('paneUpd').classList.contains('hidden') && E.doc.activeElement === $('takeUrl'));
    E.click(E.btn($('takeBox'), 'Prüfen'));
    ok('ohne Link: Fehler, kein Aufruf', /Bitte den Link/.test($('takeMsg').textContent) && E.calls('takeoverPreview').length === 0);
    E.type($('takeUrl'), ' https://docs.google.com/spreadsheets/d/ALT/edit ');
    E.click(E.btn($('takeBox'), 'Prüfen'));
    ok('Prüfen: takeoverPreview mit Link', J(E.calls('takeoverPreview')[0].args) === J(['https://docs.google.com/spreadsheets/d/ALT/edit']) && /Prüfe/.test($('takeMsg').textContent));
    await E.respond('takeoverPreview');
    const tm = $('takeMsg');
    ok('Vorschau vor 1.0: Hinweis auf Trigger statt „stillgelegt“', /legt sich nicht selbst still/.test(tm.textContent) && /Trigger/.test(tm.textContent));
    ok('Vorschau: Name escaped, Version vor 1.0, Zahlen, Blätter, Warnungen', !tm.querySelector('i') && /<i>Alte Sammlung<\/i>/.test(tm.textContent) && /Version vor 1\.0/.test(tm.textContent) &&
      /2 Einträge mit 3 Karten/.test(tm.textContent) && /Verlauf \(1\)/.test(tm.textContent) && /Eigene Blätter: Notizen/.test(tm.textContent) && tm.querySelectorAll('.warn').length === 1 && !tm.querySelector('.warn b'));
    E.type($('takeUrl'), 'https://docs.google.com/spreadsheets/d/ANDERS/edit');
    E.click(E.btn(tm, 'Jetzt übernehmen'));
    ok('Link geändert: erst neu prüfen', E.calls('takeoverRun').length === 0 && E.calls('takeoverPreview').length === 1 &&
      J(E.calls('takeoverPreview')[0].args) === J(['https://docs.google.com/spreadsheets/d/ANDERS/edit']));
    await E.respond('takeoverPreview');
    E.click(E.btn($('takeMsg'), 'Jetzt übernehmen'));
    ok('Übernehmen: takeoverRun mit geprüftem Link', J(E.calls('takeoverRun')[0].args) === J(['https://docs.google.com/spreadsheets/d/ANDERS/edit']) && /Übernehme/.test($('takeMsg').textContent));
    E.S.updInfo.collectionEmpty = false;
    E.S.updInfo.takenFrom = 'https://docs.google.com/spreadsheets/d/ANDERS/edit';
    await E.respond('takeoverRun');
    ok('fertig: Meldung, Hinweis Handy-Seite, Zur Sammlung', /2 Einträge/.test($('takeMsg').textContent) && /neuen Link/.test($('takeMsg').textContent) && !!E.btn($('takeMsg'), 'Zur Sammlung'));
    ok('danach: getUiConfig und getUpdateInfo neu', E.calls('getUiConfig').length === 1 && E.calls('getUpdateInfo').length === 1);
    await E.respond('getUiConfig');
    await E.respond('getUpdateInfo');
    ok('Leiste weg nach der Übernahme', $('updBar').classList.contains('hidden'));
    E.click(E.btn($('takeMsg'), 'Zur Sammlung'));
    ok('Zur Sammlung', !$('paneColl').classList.contains('hidden') && E.calls('searchCollection').length === 1);
    E.click(E.btn($('takeBox'), 'Prüfen'));
    await E.respond('takeoverPreview', { error: 'In dieser Tabelle sind schon Karten.' });
    ok('Vorschau-Fehler', $('takeMsg').querySelector('.msg.err') && /schon Karten/.test($('takeMsg').textContent));
    ok('keine Skriptfehler (Übernahme)', E.errors.length === 0, E.errors);
  }
  {
    // Web-App: kein Holen, keine Übernahme
    const E = boot('web', { start: 'takeover', server: S => Object.assign(S.updInfo, { available: '1.1.0', banner: '1.1.0', newer: [{ version: '1.1.0', notes: ['x'] }], collectionEmpty: true,
      templateUrl: 'https://docs.google.com/spreadsheets/d/TPL/copy', pendingTake: 'https://docs.google.com/spreadsheets/d/ALT/edit' }) });
    const { $ } = E;
    await E.startup();
    ok('Web: Leiste mit neuer Version, keine Übernahme', /Version 1\.1\.0 ist da/.test($('updBar').textContent));
    ok('Web: start=takeover öffnet nur den Bereich, ohne Übernahme-Feld', !$('paneUpd').classList.contains('hidden') && $('takeBox').classList.contains('hidden') &&
      E.calls('takeoverPreview').length === 0);
    ok('Web: kein Holen, Hinweis auf den Computer', !E.btn($('updInfo'), 'Neue Version holen') && /am Computer/.test($('updInfo').textContent));
    E.S.updInfo.banner = '';
    E.win.updLoad(false);
    await E.respond('getUpdateInfo');
    ok('Web: leere Tabelle ohne Übernahme-Hinweis', $('updBar').classList.contains('hidden'));
    ok('keine Skriptfehler (Web, Updates)', E.errors.length === 0, E.errors);
  }
  {
    // Start über „Nach Updates suchen“ fragt frisch, Fehler beim Laden mit „Noch einmal versuchen“
    const E = boot('sidebar', { start: 'upd' });
    const { $ } = E;
    await E.respond('getSetSuggestions'); await E.respond('getUiConfig');
    ok('start=upd: getUpdateInfo(true)', J(E.calls('getUpdateInfo')[0].args) === J([true]));
    await E.respond('getUpdateInfo', { error: 'offline' });
    ok('Laden scheitert: Fehler und Knopf im Bereich', /Prüfen ging nicht: offline/.test($('updInfo').textContent) && !!E.btn($('updInfo'), 'Noch einmal versuchen'));
    E.click(E.btn($('updInfo'), 'Noch einmal versuchen'));
    ok('Noch einmal: getUpdateInfo(true)', J(E.calls('getUpdateInfo')[0].args) === J([true]));
    await E.respond('getUpdateInfo');
    ok('danach normal', /neueste Version/.test($('updInfo').textContent));
    ok('keine Skriptfehler (Laden)', E.errors.length === 0, E.errors);
  }
  {
    // Tabelle hat schon neueren Code: Hinweis statt Update
    const E = boot('sidebar', { server: S => Object.assign(S.updInfo, { codeVersion: '1.1.0', outdated: true, available: '1.1.0', banner: '1.1.0', newer: [{ version: '1.1.0', notes: [] }] }) });
    const { $ } = E;
    await E.startup();
    ok('veraltete Seitenleiste: Hinweis neu öffnen', /noch von Version 1\.0\.0/.test($('updBar').textContent) && /Karten erfassen neu öffnen/.test($('updBar').textContent) &&
      !/ist da/.test($('updBar').textContent));
    E.win.showTab('upd');
    ok('Bereich nennt beide Versionen', /Version 1\.0\.0 \(die Tabelle hat schon Version 1\.1\.0\)/.test($('updInfo').textContent));
    const W2 = boot('web', { server: S => Object.assign(S.updInfo, { codeVersion: '1.1.0', outdated: true }) });
    await W2.startup();
    ok('veraltete Web-App: Hinweis neu bereitstellen', /Diese Seite läuft noch mit Version 1\.0\.0/.test(W2.$('updBar').textContent) && /Neue Version/.test(W2.$('updBar').textContent));
    W2.win.showTab('upd');
    ok('veraltete Web-App: Bereich sagt neu bereitstellen, nicht „neueste Version“', W2.$('updInfo').querySelector('.msg.warn') &&
      /Bereitstellungen verwalten/.test(W2.$('updInfo').textContent) && !/neueste Version/.test(W2.$('updInfo').textContent) && !/am Computer: Tabelle öffnen/.test(W2.$('updInfo').textContent));
    ok('keine Skriptfehler (veraltet)', E.errors.length === 0 && W2.errors.length === 0, [E.errors, W2.errors]);
  }

  console.log('\n' + pass + ' UI-Prüfungen ok, ' + failCount + ' fehlgeschlagen');
  process.exitCode = failCount ? 1 : 0;
})().catch(e => { console.log('ERROR', e && e.stack || e); process.exitCode = 1; });

function document_has_no_genesis_tag(el) { return !el.querySelector('genesis'); }
