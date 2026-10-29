// UI-Test für src/Ui.html (Vorlage) mit jsdom und einem Stub-Server nach SPEC §4.
// Aufruf: node ui_test2.js   (jsdom liegt in ./node_modules)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src', 'Ui.html');
const RAW = fs.readFileSync(SRC, 'utf8');
const MODE_LET = "<?!= mode ?>";
const INCLUDE_LET = "<?!= mode === 'sidebar' ? include('ImportUi') : '' ?>";
const START_LET = '<?!= typeof start === "string" ? start : "" ?>';
const SEARCH_LET = "<?!= typeof searchJs_ === 'function' ? searchJs_() : 'null' ?>";

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
// Set-Symbole wie im Blatt Sets (#47); Basis-Set hat keins
const SYM = { swsh3: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol', swshp: 'https://assets.tcgdex.net/univ/swsh/swshp/symbol' };

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
  S.getSetSuggestions = () => [
    { id: 'swshp', name: 'SWSH Black Star Promos', en: '', symbol: SYM.swshp, promo: true },
    { id: 'swsh3', name: 'Flammende Finsternis', en: 'Darkness Ablaze', symbol: SYM.swsh3, promo: false },
    { id: 'base1', name: 'Basis-Set', en: 'Base Set', symbol: '', promo: false }
  ];
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
    return { eid: r.eid, key: S.key(r), gkey: S.gkey(r), count: r.count, message: msgName + ' hinzugefügt, jetzt ' + r.count + ' Stück.',
      delta: S.delta([S.gkey(r)]) };
  }
  // Anfrage-ID wie addRid_ in Code.gs: eine schon gespeicherte Anfrage kommt mit derselben Antwort zurück
  S.rids = {};
  const once = fn => req => {
    if (req.rid && S.rids[req.rid]) return Object.assign({}, S.rids[req.rid], { repeat: true, delta: null });
    const res = fn(req);
    if (req.rid) S.rids[req.rid] = res;
    return res;
  };
  function setOwn(gk, price) {
    const d = '2026-10-15';
    groupRows(gk).forEach(r => { r.ownPrice = price > 0 ? price : ''; r.ownPriceDate = price > 0 ? d : ''; });
  }
  S.addCard = once(req => {
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
  });
  S.addFreeCard = once(req => {
    if (!String(req.name || '').trim()) throw new Error('Bitte einen Namen eingeben.');
    const probe = { id: '', name: req.name, setName: req.setName, localId: req.number, variant: req.variant || 'normal',
      version: req.version || '', cond: req.condition || '', lang: req.cardLang || 'DE' };
    let r = S.rows.find(x => x.origin === 'Hand' && S.key(x) === S.key(probe));
    const qty = Math.max(1, Math.floor(Number(req.qty) || 1));
    if (r) r.count += qty; else r = S.addRow(Object.assign(probe, { count: qty }));
    if (req.ownPrice) setOwn(S.gkey(r), req.ownPrice);
    return result(r, req.name);
  });
  const upNum = x => String(x == null ? '' : x).trim().toUpperCase().replace(/^([A-Z]*)0+(\d)/, '$1$2');
  // Gruppe fürs UI wie collGroup_ in Code.gs (mit dex und k zum Suchen und Sortieren im Browser)
  S.uiGroup = gk => {
    const rs = sortRows(groupRows(gk));
    const f = rs[0];
    const count = rs.reduce((s, r) => s + r.count, 0);
    const own = ownOf(rs);
    return {
      gkey: gk, id: f.id, name: f.name, nameEn: f.nameEn, source: f.source, isFree: !f.id, setName: f.setName, localId: f.localId,
      setId: f.setId || '', setSymbol: SYM[f.setId] || '', setPromo: /promo/i.test(f.setName), priceDate: f.priceDate || '',
      setSize: f.setSize, variant: f.variant, variantLabel: VL[f.variant], version: f.version, count, image: f.image,
      price: own != null ? own : (typeof f.price === 'number' ? f.price : null), priceManual: own != null, ownPrice: own,
      exemplare: exText(rs), rarity: f.rarity || '', illustrator: f.illustrator || '', chg: f.chg || null, dex: f.dex || [],
      k: { words: [low(f.name), low(f.nameEn), low(f.version), low(f.illustrator)], num: upNum(f.localId), size: Number(f.setSize) || 0,
        setId: f.setId || '', sets: [low(f.setName)], setDate: f.setDate || '', numSort: Number(String(f.localId).replace(/\D/g, '')) || 0,
        localId: String(f.localId || ''), variant: f.variant, version: f.version || '', name: f.name, rank: f.rank == null ? null : f.rank,
        added: S.rows.indexOf(f) },
      rows: rs.map(r => {
        const nr = nrOf(r);
        return { eid: r.eid, key: S.key(r), cond: r.cond, lang: r.lang, count: r.count, origin: r.origin,
          originLabel: nr ? (S.imports[nr] ? S.imports[nr] + ', Import ' + nr : 'Import ' + nr) : 'von Hand',
          isImport: !!nr, importNr: nr || null, extras: Object.assign({}, r.extras) };
      })
    };
  };
  S.delta = keys => {
    keys = keys.filter((k, i) => keys.indexOf(k) === i);
    return { groups: keys.filter(k => groupRows(k).length).map(S.uiGroup), gone: keys.filter(k => !groupRows(k).length) };
  };
  S.getCollection = () => {
    const keys = [];
    S.rows.forEach(r => { const k = S.gkey(r); if (keys.indexOf(k) < 0) keys.push(k); });
    return { groups: keys.map(S.uiGroup), total: keys.length };
  };
  // nur noch für den Tab Pokédex
  S.searchCollection = (query, setText) => {
    const words = low(query).split(/\s+/).filter(Boolean);
    const st = low(setText);
    const keys = [];
    S.rows.filter(r => words.every(w => low(r.name).includes(w) || low(r.version).includes(w)) && (!st || low(r.setName).includes(st)))
      .forEach(r => { const k = S.gkey(r); if (keys.indexOf(k) < 0) keys.push(k); });
    const groups = keys.map(S.uiGroup);
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
    return { token, eid: target.eid, count: target.count, groupCount: groupCount(S.gkey(target)), applied, gkey: S.gkey(target),
      delta: applied ? S.delta([S.gkey(target)]) : null };
  };
  S.revertAdjust = token => {
    const row = byEid(token.eid);
    if (!row) throw new Error('Eintrag nicht gefunden.');
    row.count = Math.max(0, row.count - token.applied);
    S.proto = S.proto.filter(p => token.logIds.indexOf(p.id) < 0);
    const gk = S.gkey(row);
    if (token.createdEid && token.createdEid === row.eid && row.count === 0) S.rows.splice(S.rows.indexOf(row), 1);
    return { eid: row.eid, count: row.count, groupCount: groupCount(gk), gkey: gk, delta: S.delta([gk]) };
  };
  S.editEntry = (eid, changes, qty) => {
    const row = byEid(eid);
    if (!row) throw new Error('Eintrag nicht gefunden.');
    qty = qty == null ? row.count : Math.max(1, Math.min(row.count, Number(qty)));
    const oldGk = S.gkey(row);
    let t = row;
    if (qty < row.count) { row.count -= qty; t = S.addRow(Object.assign({}, row, { eid: S.newEid(), count: qty, extras: Object.assign({}, row.extras) })); }
    if ('cond' in changes) t.cond = changes.cond;
    if ('cardLang' in changes) t.lang = changes.cardLang;
    if ('version' in changes) t.version = changes.version;
    if ('variant' in changes) t.variant = changes.variant;
    if (changes.extras) Object.assign(t.extras, changes.extras);
    const other = S.rows.find(r => r !== t && S.key(r) === S.key(t) && r.origin === t.origin && r.fp === t.fp);
    if (other) { other.count += t.count; S.rows.splice(S.rows.indexOf(t), 1); t = other; }
    return { ok: true, eid: t.eid, gkey: S.gkey(t), delta: S.delta([oldGk, S.gkey(t)]) };
  };
  S.setGroupOwnPrice = (gk, price) => {
    const rs = groupRows(gk);
    if (!rs.length) throw new Error('Zeile nicht gefunden.');
    setOwn(gk, Number(price) > 0 ? Number(price) : 0);
    const own = ownOf(rs);
    const f = sortRows(rs)[0];
    return { gkey: gk, price: own != null ? own : (typeof f.price === 'number' ? f.price : null), priceManual: own != null, delta: S.delta([gk]) };
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
    return { gkey: S.gkey(rs[0]), delta: S.delta([gk, S.gkey(rs[0])]) };
  };
  S.adjustCount = () => { throw new Error('adjustCount sollte die neue UI nicht mehr benutzen'); };
  // Updates (Update.gs), Vertrag aus SPEC §11
  S.updInfo = {
    installed: '1.0.0', codeVersion: '1.0.0', outdated: false, available: '', banner: '', newer: [], prereleases: false, copyVersion: '', templateUrl: '', newCopy: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/ALT0/edit', checkedAt: '21.10.2026 10:00', error: '', guideUrl: 'https://github.com/x/y#von-hand',
    collectionEmpty: false, takenFrom: '', pendingTake: ''
  };
  S.getUpdateInfo = () => S.updInfo;
  // wie getFileVersions in Code.gs: die .gs-Dateien vom Server, die HTML-Dateien von der Seite (ImportUi.html liest der
  // Server selbst, wenn die Seite sie nicht meldet: Handy-Seite ohne Import-Teil)
  S.gsVersions = { 'Code.gs': UI_VERSION, 'Update.gs': UI_VERSION, 'Import.gs': UI_VERSION };
  S.importUiVersion = UI_VERSION;
  S.getFileVersions = ui => ({ files: Object.keys(S.gsVersions).map(n => ({ name: n, version: S.gsVersions[n] }))
    .concat(Object.keys(ui || {}).map(n => ({ name: n, version: ui[n] })))
    .concat(ui && 'ImportUi.html' in ui ? [] : [{ name: 'ImportUi.html', version: S.importUiVersion }]) });
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
    'swsh3-025': { id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', setSymbol: SYM.swsh3, localId: '025', setSize: 189, baseVariant: 'normal', baseLabel: 'Normal', image: 'https://img/glurak', prices: { base: 1.5, reverse: 3, firstEdition: null }, canReverse: true },
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
const UI_VERSION = /var UI_FILE_VERSION = '([^']*)'/.exec(RAW)[1];
const IMPORT_STUB = '<div id="paneImport" class="panel hidden">IMPORT-PANE</div><script>var impFileVersion = \'' + UI_VERSION + '\'; var impInitCalls = 0; function impInit() { impInitCalls++; }</script>';

function render(mode, include, start, search) {
  // wie HtmlService: den Import-Teil gibt es nur in der Seitenleiste (#36 A3)
  const imp = mode === 'sidebar' ? (include == null ? IMPORT_STUB : include) : '';
  // ohne Suchablauf (search) sucht die Seite über den Stub-Server
  return RAW.replace(MODE_LET, mode).replace(START_LET, start || '').replace(SEARCH_LET, search || 'null').replace(INCLUDE_LET, imp);
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
    const px = new Proxy(t, { get: (o, p) => p in o ? o[p] : (opts.missing || []).indexOf(p) >= 0 ? undefined // Funktion fehlt im Skript
      : (...args) => { pending.push({ fn: p, args: JSON.parse(JSON.stringify(args)), ok: okH, fail: failH }); } });
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
    async startup() { await E.respond('getSetSuggestions'); await E.respond('getUiConfig'); await E.respond('getUpdateInfo'); await flush(); await E.respond('getFileVersions'); },
    async openColl() {
      E.click(E.$('tabColl'));
      await E.respond('getCollection');
    },
    expand(i) { E.click(E.$('gh' + i).querySelector('.info')); },
    /** Anzahl rechts in der Zeile der Karte („3×“, #52) */
    cnt(i) { return E.$('gh' + i).querySelector('.side .n').textContent.replace('×', ''); },
    /** Exemplar-Zeile k der aufgeklappten Karte i */
    erow(i, k) { return E.$('gr' + i).querySelectorAll('.erow')[k]; },
    /** Karteninfo als {Beschriftung: Text} (#52) */
    info(i) { const o = {}; [...E.$('gp' + i).querySelectorAll('table.itab tr')].forEach(tr => { o[tr.querySelector('th').textContent] = tr.querySelector('td').textContent; }); return o; }
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
    ok('genau vier Scriptlets in Ui.html', idxs.length === 4, idxs);
    ok('Scriptlet 1 ist MODE', RAW.substr(idxs[0], MODE_LET.length) === MODE_LET && /var MODE = '<\?!= mode \?>';/.test(RAW));
    ok('Scriptlet 2 ist START (fehlt start, bleibt es leer)', RAW.substr(idxs[1], START_LET.length) === START_LET && RAW.indexOf("var START = '" + START_LET + "';") >= 0);
    ok('Scriptlet 3 ist der Suchablauf (searchJs_, sonst null) in einem eigenen Skript', RAW.substr(idxs[2], SEARCH_LET.length) === SEARCH_LET &&
      RAW.indexOf('<script>\n// Suchablauf aus Code.gs') >= 0 && RAW.indexOf('window.SEARCH = ' + SEARCH_LET + ';\n</script>') >= 0);
    ok('Scriptlet 4 ist include(ImportUi), nur in der Seitenleiste', RAW.substr(idxs[3], INCLUDE_LET.length) === INCLUDE_LET);
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
    ok('Set-Liste vom Server (#47), keine datalist mehr', E.win.SETS.list.length === 3 && E.win.SETS.byId.swsh3.name === 'Flammende Finsternis' && !$('setList'), E.win.SETS.list);
    ['$', 'esc', 'call', 'setMsg', 'spinner', 'imgTag', 'cardImg', 'eur', 'errText', 'PLACEHOLDER', 'VARIANT_LABELS', 'CONDITIONS', 'CONDITION_LABELS', 'LANGS']
      .forEach(n => ok('global für ImportUi: ' + n, E.win[n] !== undefined));
    E.click($('tabImport'));
    ok('Import-Tab ruft impInit', E.win.impInitCalls === 1);
    ok('Import-Pane sichtbar, andere versteckt', !$('paneImport').classList.contains('hidden') && $('paneAdd').classList.contains('hidden') && $('paneColl').classList.contains('hidden'));
    ok('Import-Tab aktiv', $('tabImport').classList.contains('active') && !$('tabAdd').classList.contains('active'));
    E.click($('tabColl'));
    ok('Sammlung-Tab lädt die Liste', E.calls('getCollection').length === 1 && !$('paneColl').classList.contains('hidden') && $('paneImport').classList.contains('hidden'));
    await E.respond('getCollection');
    E.click($('tabAdd'));
    ok('zurück zu Hinzufügen', !$('paneAdd').classList.contains('hidden') && $('tabAdd').classList.contains('active'));
    ok('keine Skriptfehler (Sidebar)', E.errors.length === 0, E.errors);
  }

  // ---- Set-Auswahlliste mit Symbol und Name (#47) ----
  {
    const E = boot('sidebar');
    const { $ } = E;
    await E.startup();
    const drop = () => E.doc.querySelector('.setdrop');
    const opts = () => [...drop().querySelectorAll('.opt')];
    $('fSet').focus();
    ok('Setfeld anwählen: Liste mit allen Sets', !!drop() && !drop().classList.contains('hidden') && opts().length === 3, drop() && drop().outerHTML.slice(0, 300));
    const sym = opts()[1].querySelector('img.sym');
    ok('Liste: Symbol und Name', !!sym && sym.getAttribute('src') === 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol.png' && opts()[1].textContent === 'Flammende Finsternis', opts()[1].innerHTML);
    {
      // #57: .png lädt nicht -> .webp, lädt auch das nicht -> der Set-Name an seiner Stelle
      const box = E.doc.createElement('div');
      box.innerHTML = E.win.setMark({ setId: 'swsh3', setName: 'Flammende Finsternis', setSymbol: 'https://x/sym' }).html;
      const img = box.querySelector('img.sym');
      E.win.symFail(img);
      const second = img.getAttribute('src');
      E.win.symFail(img);
      ok('Symbol: erst .png, dann .webp, dann der Set-Name (#57)', second === 'https://x/sym.webp' && !box.querySelector('img') && box.textContent === 'Flammende Finsternis', [second, box.innerHTML]);
    }
    ok('Liste: Promo-Set mit Stern, Set ohne Symbol nur mit Namen', !!opts()[0].querySelector('.promo') && opts()[0].textContent === '★SWSH Black Star Promos' &&
      !opts()[2].querySelector('img') && opts()[2].textContent === 'Basis-Set', opts().map(o => o.innerHTML));
    E.type($('fSet'), 'darkness');
    ok('tippen filtert, auch nach dem englischen Namen', opts().length === 1 && opts()[0].textContent === 'Flammende Finsternis', opts().map(o => o.textContent));
    E.type($('fSet'), 'xyz');
    ok('nichts passt: Hinweis', opts().length === 0 && /Kein Set passt/.test(drop().textContent));
    E.type($('fSet'), 'set');
    $('fSet').dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    ok('Pfeil runter markiert', opts()[0].classList.contains('on'));
    const enter = new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    $('fSet').dispatchEvent(enter);
    ok('Enter übernimmt das Set (ohne zu suchen), Liste zu', $('fSet').value === 'Basis-Set' && enter.defaultPrevented && drop().classList.contains('hidden') && E.calls('searchCards').length === 0);
    E.type($('fSet'), '');
    E.click(opts()[1]);
    ok('Antippen übernimmt das Set', $('fSet').value === 'Flammende Finsternis' && drop().classList.contains('hidden'));
    E.type($('fSet'), 'Fl');
    $('fSet').dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('Escape schließt die Liste, das Getippte bleibt', drop().classList.contains('hidden') && $('fSet').value === 'Fl');
    E.type($('fSet'), '');
    $('fSet').blur(); E.win.__advance(200);
    ok('Feld verlassen schließt die Liste', drop().classList.contains('hidden'));
    // Sammlung: die Wahl filtert gleich
    await E.openColl();
    $('colSet').focus();
    E.click(opts().find(o => o.textContent === 'Flammende Finsternis'));
    E.win.__advance(200);
    ok('Sammlung: gewähltes Set filtert die Liste', $('colSet').value === 'Flammende Finsternis' && E.win.state.groups.length === 1 && E.win.state.groups[0].name === 'Glurak' &&
      drop().classList.contains('hidden'), E.win.state.groups.map(g => g.name));
    // ältere Code.gs liefert nur Namen: die Liste zeigt sie ohne Symbol
    E.win.applySets(['Basis-Set', 'XY Black Star Promos']);
    $('fName').focus(); $('fSet').focus();
    ok('ältere Code.gs (nur Namen): Liste mit Namen, Promo mit Stern', opts().length === 2 && opts()[0].textContent === 'Basis-Set' && !!opts()[1].querySelector('.promo'), opts().map(o => o.innerHTML));
    ok('keine Skriptfehler (Set-Liste)', E.errors.length === 0, E.errors);
  }

  // ---- Sammlung beim Start vorladen (#39 V3) ----
  for (const mode of ['sidebar', 'web']) {
    const E = boot(mode);
    const { $ } = E;
    ok('Start lädt die Sammlung im Hintergrund (' + mode + ')', E.calls('getCollection').length === 1, E.pending.map(p => p.fn));
    await E.startup();
    await E.respond('getCollection');
    ok('Tab Sammlung noch zu, Liste schon da (' + mode + ')', $('paneColl').classList.contains('hidden') && E.win.coll.all.length > 0);
    if (mode === 'sidebar') E.click($('tabImport'));
    E.click($('tabColl'));
    ok('Tab Sammlung ohne Warten, auch nach dem Import-Tab (' + mode + ')', E.calls('getCollection').length === 0 && !E.win.coll.stale &&
      E.win.state.groups.length > 0 && $('gh0') && !/Lade/.test($('collResults').textContent));
    ok('keine Skriptfehler (Vorladen ' + mode + ')', E.errors.length === 0, E.errors);
  }
  {
    const E = boot('sidebar', { start: 'takeover' });
    ok('Übernahme: kein Vorladen', E.calls('getCollection').length === 0, E.pending.map(p => p.fn));
  }

  // ---- Ohne Einsortieren (#43): keine Leiste, eine Zahl „pending“ aus einer älteren Antwort stört nicht ----
  for (const mode of ['sidebar', 'web']) {
    const E = boot(mode);
    const { $ } = E;
    ok('keine Leiste „Einsortieren“ (' + mode + ')', !$('sortBar') && typeof E.win.sortIn === 'undefined' && typeof E.win.pendSet === 'undefined');
    await E.respond('getSetSuggestions');
    await E.respond('getCollection', { value: Object.assign(E.S.getCollection(), { pending: 5 }) });
    await E.respond('getUiConfig', { value: Object.assign(E.S.getUiConfig(), { pending: 2 }) });
    ok('kein Hinweis „noch nicht einsortiert“ (' + mode + ')', !/noch nicht einsortiert/.test(E.doc.body.textContent));
    await E.respondAll();
    ok('keine Skriptfehler (ohne Einsortieren, ' + mode + ')', E.errors.length === 0, E.errors);
  }

  // ---- Sidebar ohne ImportUi (impInit fehlt) ----
  {
    const E = boot('sidebar', { include: '' });
    await E.startup();
    let threw = false;
    try { E.win.showTab('import'); } catch (e) { threw = true; }
    ok('showTab(import) ohne impInit wirft nicht', !threw && E.errors.length === 0, E.errors);
  }

  // ---- Knopf „Importieren“ im Dashboard: Seitenleiste startet im Bereich Import (der steht erst nach dem Hauptskript) ----
  {
    const E = boot('sidebar', { start: 'import' });
    const { $ } = E;
    await E.startup();
    ok('start=import: Bereich Import offen, impInit einmal', !$('paneImport').classList.contains('hidden') && $('tabImport').classList.contains('active') &&
      $('paneAdd').classList.contains('hidden') && E.win.impInitCalls === 1, [$('paneImport').className, E.win.impInitCalls]);
    ok('keine Skriptfehler (Start Import)', E.errors.length === 0, E.errors);
    const E2 = boot('sidebar', { start: 'import', include: '' });
    await E2.startup();
    ok('start=import ohne ImportUi: Hinzufügen', !E2.$('paneAdd').classList.contains('hidden') && E2.$('tabAdd').classList.contains('active') && E2.errors.length === 0, E2.errors);
    const E3 = boot('web', { start: 'import' });
    await E3.startup();
    ok('start=import in der Web-App: Hinzufügen', !E3.$('paneAdd').classList.contains('hidden') && !E3.$('paneImport') && E3.errors.length === 0, E3.errors);
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
    ok('Web: ohne Import-Teil (#36 A3)', !$('paneImport') && typeof E.win.impInit === 'undefined' && typeof E.win.impFileVersion === 'undefined');
    E.win.showTab('import');
    ok('Web: showTab(import) bleibt bei Hinzufügen', !$('paneAdd').classList.contains('hidden') && E.errors.length === 0, E.errors);
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
    ok('kein Feld Anzahl mehr (#50)', !$('cQty') && !/Anzahl/.test($('addResults').textContent));
    ok('Bestätigung: Set-Symbol statt Set-Name (#47)', !!$('addResults').querySelector('.meta img.sym[title="Flammende Finsternis"]') &&
      !/Flammende Finsternis/.test($('addResults').querySelector('.meta').textContent) && /025\/189/.test($('addResults').querySelector('.meta').textContent),
      $('addResults').querySelector('.meta').innerHTML);
    E.pick($('cLang'), 'EN');
    $('cVersion').value = 'Snowflake';
    $('cOwnPrice').value = '1,50';
    E.pick($('cCond'), 'NM');
    $('cReverse').checked = true; $('cReverse').dispatchEvent(new E.win.Event('change'));
    $('fNumber').value = '25'; $('fSet').value = 'Flammende Finsternis'; // inzwischen getippt
    E.click($('cAdd'));
    ok('danach: der Treffer bleibt als Kachel (#53)', /1 Treffer – Karte antippen/.test($('addResults').textContent) && $('addResults').querySelectorAll('.tile').length === 1 && !$('cAdd'),
      $('addResults').textContent);
    ok('danach: Name bleibt markiert im Feld, Nummer und Set leer', $('fName').value === 'Glurak' && E.doc.activeElement === $('fName') &&
      $('fName').selectionStart === 0 && $('fName').selectionEnd === 6 && $('fNumber').value === '' && $('fSet').value === '',
      [$('fName').value, E.doc.activeElement && E.doc.activeElement.id, $('fNumber').value, $('fSet').value]);
    ok('addCard genau einmal', E.calls('addCard').length === 1);
    const req = Object.assign({}, E.calls('addCard')[0].args[0]);
    ok('addCard mit Anfrage-ID', typeof req.rid === 'string' && req.rid.length > 5, req);
    delete req.rid;
    ok('addCard sendet cardLang/version/ownPrice, ein Exemplar', J(req) === J({ id: 'swsh3-025', lang: 'de', variant: 'reverse', condition: 'NM', qty: 1, inputName: 'Glurak', cardLang: 'EN', version: 'Snowflake', ownPrice: 1.5 }), req);
    ok('letzte Karte darüber: speichert …', /Zuletzt hinzugefügt/.test($('addLast').textContent) && /Glurak/.test($('addLast').textContent) &&
      /025\/189 · Reverse Holo/.test($('addLast').textContent) && !!$('addLast').querySelector('img.sym[title="Flammende Finsternis"]') &&
      /speichert/.test($('addLast').textContent), $('addLast').textContent);
    ok('zuletzt hinzugefügt steht über den Treffern', !!($('addLast').compareDocumentPosition($('addResults')) & E.win.Node.DOCUMENT_POSITION_FOLLOWING));
    ok('beim Speichern nicht antippbar', !$('addLast').querySelector('.info.tap'));
    ok('Hinweis: Seitenleiste offen lassen', /Seitenleiste bitte offen lassen/.test($('addLast').textContent));
    const r = await E.respond('addCard');
    ok('gespeichert: jetzt 1 Stück, antippbar', /hinzugefügt, jetzt 1 Stück/.test($('addLast').textContent) &&
      !!$('addLast').querySelector('.info.tap') && !/offen lassen/.test($('addLast').textContent), $('addLast').textContent);
    ok('kein Knopf „Nochmal +1“ mehr (#34)', !E.btn($('addLast'), 'Nochmal +1') && !$('addLast').querySelector('button') && typeof E.win.againPlusOne === 'undefined');

    // dieselbe Karte noch einmal: Kachel antippen statt neu suchen; Standardwerte DE, keine Version, kein eigener Preis
    E.click($('addResults').querySelector('.tile'));
    await E.respond('getCardDetail');
    ok('Kachel antippen: Bestätigung ohne neue Suche', !!$('cAdd') && E.calls('searchCards').length === 0);
    E.click(E.btn($('addResults'), 'Zurück'));
    ok('Zurück: wieder die Kachel', /1 Treffer – Karte antippen/.test($('addResults').textContent) && !$('cAdd'));
    E.click($('addResults').querySelector('.tile'));
    await E.respond('getCardDetail');
    E.click($('cAdd'));
    const req2 = E.calls('addCard')[0].args[0];
    ok('Standard: cardLang DE, version leer, ownPrice null', req2.cardLang === 'DE' && req2.version === '' && req2.ownPrice === null && req2.variant === 'base' && req2.qty === 1, req2);
    // Gleich die nächste Karte, bevor die erste gespeichert ist: nacheinander
    E.click($('addResults').querySelector('.tile'));
    await E.respond('getCardDetail');
    E.click($('cAdd'));
    ok('zweite Karte wartet, bis die erste gespeichert ist', E.calls('addCard').length === 1 && /Noch 2 Karten werden gespeichert/.test($('addLast').textContent), $('addLast').textContent);
    // Antwort kommt, nachdem schon neu gesucht wurde: neues Ergebnis bleibt stehen
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [{ id: 'a', lang: 'de', name: 'X', setName: 'S', localId: '1' }, { id: 'b', lang: 'de', name: 'Y', setName: 'S', localId: '2' }] });
    E.type($('fName'), 'Neu');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards');
    await E.respond('addCard');
    ok('danach geht die zweite raus, mit eigener Anfrage-ID', E.calls('addCard').length === 1 && E.calls('addCard')[0].args[0].rid !== req2.rid);
    await E.respond('addCard');
    ok('späte addCard-Antworten lassen die neue Suche stehen', /2 Treffer/.test($('addResults').textContent) && /hinzugefügt, jetzt 2 Stück/.test($('addLast').textContent), $('addLast').textContent);
    ok('nur die letzte Karte steht da', $('addLast').querySelectorAll('.item').length === 1);
    // mehrere Treffer: nach dem Hinzufügen stehen alle wieder da, ein neuer Name ersetzt den markierten
    S.cards.a = { id: 'a', name: 'X', setName: 'S', setId: 's', localId: '1', baseVariant: 'normal', baseLabel: 'Normal', image: '', prices: { base: 1 } };
    E.click($('addResults').querySelectorAll('.tile')[0]);
    await E.respond('getCardDetail');
    E.click($('cAdd'));
    ok('mehrere Treffer bleiben stehen', /2 Treffer – Karte antippen/.test($('addResults').textContent) && $('addResults').querySelectorAll('.tile').length === 2 && $('fName').value === 'Neu');
    await E.respond('addCard');
    ok('keine Skriptfehler (Hinzufügen)', E.errors.length === 0, E.errors);
  }

  // ---- Nummer im Namensfeld (#51), englische Ersatzdaten als graue Zeile (#48) ----
  {
    const E = boot('sidebar');
    const { $, S } = E;
    await E.startup();
    // der Server nimmt die Nummer aus dem Namen (splitNameNumber_) und gibt den Namen zurück
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], inputName: 'Glurak', cards: [{ id: 'swsh3-025', lang: 'de', name: 'Glurak', setName: 'Flammende Finsternis', localId: '025' }] });
    E.type($('fName'), 'Glurak 25');
    E.click(E.btn($('searchForm'), 'Suchen'));
    ok('ohne Suchablauf im Browser: der Server trennt Name und Nummer', J(E.calls('searchCards')[0].args) === J([{ name: 'Glurak 25', number: '', set: '' }]));
    await E.respond('searchCards'); await E.respond('getCardDetail');
    E.click($('cAdd'));
    ok('addCard mit dem Namen ohne Nummer', E.calls('addCard')[0].args[0].inputName === 'Glurak');
    ok('Namensfeld danach nur mit dem Namen', $('fName').value === 'Glurak' && $('fName').selectionEnd === 6, $('fName').value);
    await E.respond('addCard');
    // englische Ersatzdaten: graue Zeile zum Aufklappen statt gelbem Kasten
    S.searchCardsImpl = q => ({ stage: 'en', notes: ['Keine deutsche Karte gefunden.'], inputName: 'Mewtu', cards: [{ id: 'old9-7', lang: 'en', name: 'Mewtwo', setName: 'Old Set',
      setId: 'old9', localId: '7', baseVariant: 'normal', baseLabel: 'Normal', image: '', prices: { base: 2 }, priceFromEn: false }] });
    E.type($('fName'), 'Mewtu');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards');
    const fold = $('addResults').querySelector('details.inote');
    ok('Ersatzdaten: graue Zeile „ⓘ Englische Ersatzdaten“, zu', !!fold && !fold.open && /ⓘ Englische Ersatzdaten/.test(fold.querySelector('summary').textContent) &&
      !$('addResults').querySelector('.warn'), $('addResults').innerHTML.slice(0, 600));
    ok('aufgeklappt: der ganze Text mit dem eingegebenen Namen', /Gespeichert wird sie unter deinem eingegebenen Namen „Mewtu“/.test(fold.querySelector('.txt').textContent), fold.textContent);
    ok('graue Hinweise über den Treffern bleiben', /Keine deutsche Karte gefunden/.test($('addResults').querySelector('.notes').textContent));
    ok('Set ohne Symbol: der Set-Name', /Old Set · 7/.test($('addResults').querySelector('.meta').textContent), $('addResults').querySelector('.meta').textContent);
    ok('keine Skriptfehler (Nummer im Namen, Ersatzdaten)', E.errors.length === 0, E.errors);
  }

  // ---- Zuletzt hinzugefügt antippen: Sammlung mit Suche, neue Karte oben und offen (#33) ----
  for (const loaded of [false, true]) {
    const E = boot('sidebar');
    const { $, S } = E;
    const tag = loaded ? ' (Sammlung schon geladen)' : ' (Sammlung noch nicht geladen)';
    await E.startup();
    // Vorladen beim Start (#39 V3): hier einmal fehlgeschlagen, dann ist die Sammlung noch nicht geladen
    if (loaded) { await E.openColl(); E.type($('colQuery'), 'Evoli'); E.win.__advance(200); E.click($('tabAdd')); }
    else await E.respond('getCollection', { error: 'Zeitüberschreitung' });
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [{ id: 'swsh3-025', lang: 'de', name: 'Glurak', setName: 'Flammende Finsternis', localId: '025' }] });
    E.type($('fName'), 'Glurak');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards'); await E.respond('getCardDetail');
    $('cReverse').checked = true; $('cReverse').dispatchEvent(new E.win.Event('change'));
    E.click($('cAdd'));
    E.click($('addLast').querySelector('.info'));
    ok('antippen, solange es speichert: nichts' + tag, !$('paneAdd').classList.contains('hidden'));
    const r = await E.respond('addCard');
    ok('nach dem Speichern kein Neuladen nötig' + tag, E.calls('getCollection').length === 0 && E.win.coll.stale === !loaded);
    E.click($('addLast').querySelector('.info.tap'));
    ok('Tab Sammlung offen, Suche mit Name und Nummer' + tag, !$('paneColl').classList.contains('hidden') && $('colQuery').value === 'Glurak 025', $('colQuery').value);
    ok(loaded ? 'kein Neuladen, delta reicht' + tag : 'lädt die Sammlung' + tag, E.calls('getCollection').length === (loaded ? 0 : 1));
    if (!loaded) await E.respond('getCollection');
    const st = E.win.state;
    ok('neue Karte ganz oben' + tag, st.groups[0].gkey === r.res.gkey && st.groups[0].variant === 'reverse', st.groups.map(g => g.gkey));
    ok('neue Karte aufgeklappt' + tag, !$('gx0').classList.contains('hidden') && /1× DE/.test($('gr0').textContent), $('gr0').textContent);
    ok('andere Treffer darunter' + tag, st.groups.length === 2 && st.groups[1].gkey === 'swsh3-025|normal|' && $('gx1').classList.contains('hidden'));
    // neu suchen: die Karte rückt an ihren Platz
    E.type($('colQuery'), 'Glurak'); E.win.__advance(200);
    ok('neue Suche sortiert wieder normal' + tag, st.groups[0].gkey === 'swsh3-025|normal|' && st.groups[1].gkey === r.res.gkey);
    ok('keine Skriptfehler (antippen)' + tag, E.errors.length === 0, E.errors);
  }

  // ---- Versionen der Script-Dateien (#35) ----
  {
    const start3 = async E => { await E.respond('getSetSuggestions'); await E.respond('getUiConfig'); await E.respond('getUpdateInfo'); await flush(); };
    // alles gleich
    let E = boot('sidebar');
    await start3(E);
    ok('fragt getFileVersions mit den Versionen der HTML-Dateien', E.calls('getFileVersions').length === 1 &&
      J(E.calls('getFileVersions')[0].args) === J([{ 'Ui.html': UI_VERSION, 'ImportUi.html': UI_VERSION }]), E.calls('getFileVersions').map(c => c.args));
    await E.respond('getFileVersions');
    ok('alles gleich: keine rote Leiste', E.$('verBar').classList.contains('hidden') && E.$('verBar').innerHTML === '');
    E.click(E.btn(E.doc.querySelector('.foot'), 'Updates'));
    ok('Updates: Liste der Dateien, keine Warnung', /Dateien: Code\.gs [\d.]+ · Update\.gs [\d.]+ · Import\.gs [\d.]+ · Ui\.html [\d.]+ · ImportUi\.html [\d.]+/.test(E.$('updFiles').textContent) &&
      !E.$('updFiles').querySelector('.msg.err, .fodd'), E.$('updFiles').textContent);
    ok('keine Skriptfehler (Versionen gleich)', E.errors.length === 0, E.errors);

    // eine .gs-Datei alt
    E = boot('sidebar', { server: S => { S.gsVersions['Update.gs'] = 'alt'; } });
    await start3(E);
    await E.respond('getFileVersions');
    const bar = E.$('verBar');
    ok('rote Leiste: Update.gs älter, die anderen aktuell', !bar.classList.contains('hidden') &&
      bar.textContent.indexOf('Script-Dateien passen nicht zusammen: Update.gs älter als 1.1.2, die anderen ' + UI_VERSION + '.') >= 0, bar.textContent);
    E.click(E.btn(bar, 'Details'));
    ok('Details öffnet Updates: Update.gs rot, Anleitung für die Seitenleiste', !E.$('paneUpd').classList.contains('hidden') &&
      [...E.$('updFiles').querySelectorAll('.fodd')].map(x => x.textContent).join() === 'Update.gs älter als 1.1.2' &&
      /aus Version [\d.]+ ersetzen/.test(E.$('updFiles').textContent) && /Seitenleiste schließen/.test(E.$('updFiles').textContent), E.$('updFiles').textContent);
    E.click(bar.querySelector('.x'));
    ok('× blendet die Leiste aus, die Liste unter Updates bleibt', bar.classList.contains('hidden') && !!E.$('updFiles').querySelector('.fodd'));

    // Handy-Seite, Code.gs älter als die anderen
    E = boot('web', { server: S => { S.gsVersions['Code.gs'] = '1.1.1'; } });
    await start3(E);
    ok('Handy-Seite meldet nur Ui.html (ohne Import-Teil)', J(E.calls('getFileVersions')[0].args) === J([{ 'Ui.html': UI_VERSION }]), E.calls('getFileVersions').map(c => c.args));
    await E.respond('getFileVersions');
    ok('Handy-Seite: Code.gs 1.1.1 in der Leiste', /Code\.gs 1\.1\.1, die anderen /.test(E.$('verBar').textContent), E.$('verBar').textContent);
    E.win.showTab('upd');
    ok('Handy-Seite: Anleitung mit neu bereitstellen', /Web-App neu bereitstellen/.test(E.$('updFiles').textContent), E.$('updFiles').textContent);
    ok('Handy-Seite: alle fünf Dateien unter Updates', /Code\.gs 1\.1\.1 · Update\.gs [\d.]+ · Import\.gs [\d.]+ · Ui\.html [\d.]+ · ImportUi\.html [\d.]+/.test(E.$('updFiles').textContent), E.$('updFiles').textContent);
    E = boot('web', { server: S => { S.importUiVersion = 'alt'; } });
    await start3(E);
    await E.respond('getFileVersions');
    ok('Handy-Seite: ImportUi.html alt (liest der Server)', /ImportUi\.html älter als 1\.1\.2/.test(E.$('verBar').textContent), E.$('verBar').textContent);

    // Code.gs von vor 1.1.2: getFileVersions fehlt
    E = boot('sidebar', { missing: ['getFileVersions'] });
    await start3(E);
    ok('ohne getFileVersions: kein Aufruf, Code.gs älter', E.calls('getFileVersions').length === 0 &&
      /Code\.gs älter als 1\.1\.2, die anderen /.test(E.$('verBar').textContent), E.$('verBar').textContent);
    ok('keine Skriptfehler (Code.gs alt)', E.errors.length === 0, E.errors);

    // ImportUi.html fehlt / ist alt
    E = boot('sidebar', { include: '' });
    await start3(E);
    ok('ImportUi.html fehlt: null', J(E.calls('getFileVersions')[0].args[0]) === J({ 'Ui.html': UI_VERSION, 'ImportUi.html': null }));
    await E.respond('getFileVersions');
    ok('Leiste: ImportUi.html fehlt', /ImportUi\.html fehlt/.test(E.$('verBar').textContent), E.$('verBar').textContent);
    E = boot('sidebar', { include: '<div id="paneImport" class="panel hidden"></div><script>function impInit() {}</script>' });
    await start3(E);
    ok('ImportUi.html ohne Versions-Konstante: alt', E.calls('getFileVersions')[0].args[0]['ImportUi.html'] === 'alt');

    // Fehler beim Fragen: still weiter
    E = boot('sidebar');
    await start3(E);
    await E.respond('getFileVersions', { error: 'Zeitüberschreitung' });
    ok('Fehler beim Fragen: keine Leiste, keine Skriptfehler', E.$('verBar').classList.contains('hidden') && E.errors.length === 0, E.errors);
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
    ok('Formular: Zustand, Sprache, Sonderversion, eigener Preis, keine Anzahl (#50)', !!($('frCond') && $('frLang') && $('frVersion') && $('frOwnPrice')) && !$('frQty') && $('frLang').value === 'DE');
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
    $('frVersion').value = 'Staff'; $('frOwnPrice').value = '2,5';
    E.click($('frSave'));
    ok('freie Karte: Formular sofort weg', !$('frName') && !$('frSave'));
    ok('addFreeCard genau einmal', E.calls('addFreeCard').length === 1);
    const req = Object.assign({}, E.calls('addFreeCard')[0].args[0]);
    ok('addFreeCard mit Anfrage-ID', typeof req.rid === 'string' && req.rid.length > 5);
    delete req.rid;
    ok('addFreeCard-Argumente', J(req) === J({ name: 'Unbekannt', setName: 'Ordner', number: '12', variant: 'holo', condition: 'EX', qty: 1, cardLang: 'JP', version: 'Staff', ownPrice: 2.5 }), req);
    ok('freie Karte darunter: speichert …', /freie Karte · Ordner · 12 · Holo/.test($('addLast').textContent) && /speichert/.test($('addLast').textContent), $('addLast').textContent);
    const r = await E.respond('addFreeCard');
    ok('freie Karte gespeichert', /hinzugefügt, jetzt 1 Stück/.test($('addLast').textContent) && !!$('addLast').querySelector('.info.tap') && r.res.eid, $('addLast').textContent);
    ok('danach wieder das Suchergebnis, Name markiert (#53)', !!E.btn($('addResults'), 'Als freie Karte speichern') && $('fName').value === 'Unbekannt' &&
      E.doc.activeElement === $('fName') && $('fNumber').value === '' && $('fSet').value === '');
    ok('neue Version gemerkt', /value="Staff"/.test($('versionList').innerHTML));
    // Serverfehler: zweimal von selbst wiederholen, dann rote Zeile
    E.type($('fName'), 'Unbekannt');
    E.win.doSearch();
    await E.respondAll();
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    E.click($('frSave'));
    const rid = E.calls('addFreeCard')[0].args[0].rid;
    await E.respond('addFreeCard', { error: 'Sperre belegt' });
    ok('Fehler 1: noch keine rote Zeile, wartet', !$('addLast').querySelector('.addfail') && E.calls('addFreeCard').length === 0 && /speichert/.test($('addLast').textContent));
    E.win.__advance(1500); await flush();
    ok('Wiederholung 1 mit derselben Anfrage-ID', E.calls('addFreeCard').length === 1 && E.calls('addFreeCard')[0].args[0].rid === rid);
    await E.respond('addFreeCard', { error: 'Sperre belegt' });
    E.win.__advance(4000); await flush();
    ok('Wiederholung 2 mit derselben Anfrage-ID', E.calls('addFreeCard').length === 1 && E.calls('addFreeCard')[0].args[0].rid === rid);
    await E.respond('addFreeCard', { error: 'Sperre belegt' });
    E.win.__advance(60000); await flush();
    ok('nach 3 Versuchen: keine weitere Wiederholung', E.calls('addFreeCard').length === 0);
    const fail = $('addLast').querySelector('.addfail');
    ok('rote Zeile „Nicht gespeichert: Grund“', !!fail && /Nicht gespeichert: Sperre belegt/.test(fail.textContent) && /Unbekannt/.test(fail.textContent), $('addLast').textContent);
    ok('rote Zeile: Nochmal versuchen und Verwerfen', !!E.btn(fail, 'Nochmal versuchen') && !!E.btn(fail, 'Verwerfen'));
    ok('letzte gespeicherte Karte steht weiter da', /hinzugefügt, jetzt 1 Stück/.test($('addLast').textContent));
    // weitere Karte: rote Zeile bleibt
    E.type($('fName'), 'Unbekannt');
    E.win.doSearch();
    await E.respondAll();
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    $('frName').value = 'Andere';
    E.click($('frSave'));
    await E.respond('addFreeCard');
    ok('rote Zeile bleibt nach einer neuen Karte', !!$('addLast').querySelector('.addfail') && /Andere/.test($('addLast').textContent));
    // Nochmal versuchen: dieselbe Anfrage-ID; war sie doch gespeichert, zählt sie nicht doppelt
    E.click(E.btn($('addLast').querySelector('.addfail'), 'Nochmal versuchen'));
    ok('Nochmal versuchen: dieselbe Anfrage-ID', E.calls('addFreeCard').length === 1 && E.calls('addFreeCard')[0].args[0].rid === rid);
    ok('Nochmal versuchen: rote Zeile weg, speichert …', !$('addLast').querySelector('.addfail') && /speichert/.test($('addLast').textContent));
    await E.respond('addFreeCard');
    ok('gespeichert: 1 Stück', /hinzugefügt, jetzt 1 Stück/.test($('addLast').textContent), $('addLast').textContent);
    const before = S.rows.reduce((n, x) => n + x.count, 0);
    E.win.queueAdd(E.win.adds[0]); // dieselbe Karte noch einmal schicken (z. B. Antwort verloren)
    await E.respond('addFreeCard');
    ok('gleiche Anfrage-ID zählt nicht doppelt', S.rows.reduce((n, x) => n + x.count, 0) === before);
    // Verwerfen
    E.type($('fName'), 'Unbekannt');
    E.win.doSearch();
    await E.respondAll();
    E.click(E.btn($('addResults'), 'Als freie Karte speichern'));
    E.win.ADD_RETRY_MS = [];
    E.click($('frSave'));
    await E.respond('addFreeCard', { error: 'Kaputt' });
    ok('ohne Wiederholungen gleich rot', /Nicht gespeichert: Kaputt/.test($('addLast').textContent));
    E.click(E.btn($('addLast').querySelector('.addfail'), 'Verwerfen'));
    ok('Verwerfen: rote Zeile weg, nichts geschickt', !$('addLast').querySelector('.addfail') && E.calls('addFreeCard').length === 0);
    E.win.ADD_RETRY_MS = [1500, 4000];

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

  // ---- Sammlung: Darstellung, Escaping (#52, #47, #46) ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    await E.startup();
    await E.openColl();
    const st = E.win.state;
    ok('Gruppen statt Einzelzeilen', st.groups.length === 5, st.groups.map(g => g.name));
    const gi = E.gi('Glurak');
    const head = $('gh' + gi).textContent;
    ok('Glurak: Anzahl rechts klein, daneben der Pfeil', E.cnt(gi) === '3' && $('gh' + gi).querySelector('.side .n').textContent === '3×' &&
      $('gh' + gi).querySelector('.side .chev').textContent === '▼');
    const sym = $('gh' + gi).querySelector('.s img.sym');
    ok('Glurak: Set-Symbol mit Set-Name als Tooltip, dann die Nummer', !!sym && sym.getAttribute('title') === 'Flammende Finsternis' &&
      /swsh3\/symbol\.png$/.test(sym.getAttribute('src')) && $('gh' + gi).querySelector('.s').textContent.trim() === '025/189', $('gh' + gi).innerHTML);
    ok('Glurak: Zeile ohne Preis, Variante Normal, Exemplare, Seltenheit', !/1,50|Normal|DE NM|Flammende/.test(head), head);
    ok('Kopf ohne −1 und +1 (#49)', !E.btn($('gh' + gi), '−1') && !E.btn($('gh' + gi), '+1'));
    const pi = E.gi('Pikachu');
    ok('Pikachu: Name · Version', $('gh' + pi).querySelector('.t').textContent === 'Pikachu · Snowflake', $('gh' + pi).querySelector('.t').textContent);
    ok('Pikachu: Promo-Set als Stern', !!$('gh' + pi).querySelector('.s .promo') && $('gh' + pi).querySelector('.s .promo').getAttribute('title') === 'DP Promo' &&
      /★ DP16/.test($('gh' + pi).querySelector('.s').textContent) && !/4,00/.test($('gh' + pi).textContent), $('gh' + pi).innerHTML);
    const fi = E.gIdx(g => g.isFree);
    ok('freie Karte markiert', /freie Karte/.test($('gh' + fi).textContent));
    ok('feindlicher Name escaped (kein img[src=x])', !$('collResults').querySelector('img[src="x"]') && $('gh' + fi).querySelector('.t').textContent.indexOf('<img src=x') === 0);
    ok('feindlicher Setname escaped (kein script)', !$('collResults').querySelector('script') && /<script>/.test($('gh' + fi).textContent));
    const zi = E.gi('Bisasam');
    ok('0er-Gruppe grau, 0×', $('gh' + zi).querySelector('.item').classList.contains('zero') && E.cnt(zi) === '0');
    // aufklappen: die ganze Zeile
    ok('zu: keine Exemplar-Zeilen', $('gx' + gi).classList.contains('hidden'));
    E.click($('gh' + gi).querySelector('.item img'));
    ok('Antippen des Bilds klappt auf, Pfeil zeigt nach oben', !$('gx' + gi).classList.contains('hidden') && $('gh' + gi).querySelector('.side .chev').textContent === '▲' &&
      $('gh' + gi).querySelector('.item.head').getAttribute('aria-expanded') === 'true');
    const inf = E.info(gi);
    ok('Karteninfo als Tabelle: Set mit Symbol, Nummer, Variante, Preis', inf.Set === ' Flammende Finsternis' && !!$('gp' + gi).querySelector('td img.sym') &&
      inf.Nummer === '025/189' && inf.Variante === 'Normal' && /^1,50\s€/.test(inf.Preis) && !('Sonderversion' in inf), inf);
    ok('Preis: Link „Eigener Preis …“, kein Feld', !!E.btn($('gp' + gi), 'Eigener Preis …') && !$('op' + gi));
    const rowsText = [...$('gr' + gi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('Exemplar-Zeilen: Anzahl × Sprache Zustand · Herkunft', rowsText[0].indexOf('2× DE NM · von Hand') === 0 && rowsText[1].indexOf('1× DE · Pokemon Ordner, Import 3') === 0, rowsText);
    ok('Zusatzwerte inline', /Ordner: Seite 3/.test(rowsText[1]));
    ok('je Zeile −1 und Bearbeiten, kein +1 (#49)', $('gr' + gi).querySelectorAll('button').length === 4 && !!E.btn($('gr' + gi), 'Bearbeiten') && !E.btn($('gr' + gi), '+1'));
    ok('Knopf „+ Exemplar“ unter den Exemplaren', !!E.btn($('gx' + gi), '+ Exemplar') &&
      !!($('gr' + gi).compareDocumentPosition(E.btn($('gx' + gi), '+ Exemplar')) & E.win.Node.DOCUMENT_POSITION_FOLLOWING));
    E.expand(pi);
    const pinf = E.info(pi);
    ok('Pikachu: Info mit Sonderversion, eigener Preis', pinf.Set === '★ DP Promo' && pinf.Nummer === 'DP16' && pinf.Sonderversion === 'Snowflake' &&
      /^4,00\s€ \(eigener Preis\)/.test(pinf.Preis), pinf);
    E.expand(fi);
    ok('feindliche Zusatzspalte escaped', !$('gr' + fi).querySelector('i') && !$('gr' + fi).querySelector('.einfo b') && /<i>Notiz<\/i>: <b>fett<\/b>/.test($('gr' + fi).textContent));
    ok('freie Karte: Set als Text in der Info', /<script>window.__xss=2<\/script>Ordner/.test(E.info(fi).Set), E.info(fi));
    ok('freie Gruppe: Verknüpfen-Knopf', !!E.btn($('gl' + fi), 'Mit tcgdex-Karte verknüpfen'));
    ok('tcgdex-Gruppe: kein Verknüpfen-Knopf', !E.btn($('gl' + gi), 'Mit tcgdex-Karte verknüpfen'));
    E.expand(gi);
    ok('wieder zugeklappt', $('gx' + gi).classList.contains('hidden') && $('gh' + gi).querySelector('.side .chev').textContent === '▼');
    // Bildgröße (#46): klein wie bisher, mittel, groß
    ok('Bildgröße: Standard klein', $('colImg').value === 's' && $('collResults').classList.contains('isz-s'));
    E.pick($('colImg'), 'l');
    ok('Bildgröße groß', $('collResults').classList.contains('isz-l') && !$('collResults').classList.contains('isz-s') && E.pending.length === 0);
    E.pick($('colImg'), 'm');
    ok('Bildgröße mittel', $('collResults').classList.contains('isz-m') && !$('collResults').classList.contains('isz-l'));
    const css = E.doc.querySelector('style').textContent;
    ok('Bildbreiten 48, 80 und 120 px', /\.item > img \{ width: 48px;/.test(css) && /#collResults\.isz-m \.item > img \{ width: 80px; \}/.test(css) && /#collResults\.isz-l \.item > img \{ width: 120px; \}/.test(css));
    E.type($('colQuery'), 'Gibtsnicht');
    E.win.__advance(200);
    ok('keine Treffer: Hinweis, kein Serveraufruf', /Nichts gefunden/.test($('collResults').textContent) && E.pending.length === 0 && $('collInfo').textContent === '0 von 5 Einträgen');
    ok('Bildgröße bleibt nach der Suche', $('collResults').classList.contains('isz-m'));
    ok('kein Gedankenstrich in der Sammlung', $('paneColl').textContent.indexOf('—') < 0);
    ok('keine Skriptfehler (Darstellung)', E.errors.length === 0, E.errors);
    ok('kein XSS ausgeführt', E.win.__xss === undefined);
  }

  // ---- Exemplar −1 (#49): pro Zeile, kein Kopf-Knopf mehr ----
  {
    const E = boot('sidebar');
    const { $, G } = E;
    await E.startup();
    await E.openColl();
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn(E.erow(pi, 0), '−1'));
    ok('−1 auf der Zeile: adjustEntry direkt', J(E.calls('adjustEntry')[0].args) === J([G.pImp.eid, -1]));
    ok('während des Aufrufs: −1 gesperrt', E.btn(E.erow(pi, 0), '−1').disabled);
    E.win.rowAdjust(pi, 0, -1);
    ok('Doppelklick sendet nur einmal', E.calls('adjustEntry').length === 1);
    await E.respond('adjustEntry');
    ok('−1: Anzahl 1', E.cnt(pi) === '1');
    const gi = E.gi('Glurak');
    E.expand(gi);
    const imp = [...$('gr' + gi).querySelectorAll('.erow')].findIndex(el => /Import 3/.test(el.textContent));
    E.click(E.btn(E.erow(gi, imp), '−1'));
    ok('−1 auf die Import-Zeile', J(E.calls('adjustEntry')[0].args) === J([G.gImp.eid, -1]));
    await E.respond('adjustEntry');
    ok('nach −1: Anzahl 2, Zeile auf 0 gesperrt', E.cnt(gi) === '2' && E.btn(E.erow(gi, imp), '−1').disabled && E.erow(gi, imp).classList.contains('zero'));
    ok('handentfernt protokolliert (Stub)', E.S.proto.length === 2);
    ok('keine Skriptfehler (−1)', E.errors.length === 0, E.errors);
  }

  // ---- „+ Exemplar“ (#49): Hinzufügen-Seite dieser Karte, danach zurück zur Sammlung ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    S.addRow({ id: 'swsh3-025', name: 'Glurak', setName: 'Flammende Finsternis', setId: 'swsh3', localId: '025', setSize: 189, variant: 'reverse', cond: 'NM', count: 1, price: 3, image: 'https://img/glurak' });
    S.addRow({ id: 'base1-8', name: 'Mew', setName: 'Basis-Set', setId: 'base1', localId: '8', setSize: 102, source: 'en-Ersatz', count: 1, price: 2, image: 'https://img/mew8' });
    await E.startup();
    // vorher eine Suche mit zwei Treffern: die steht danach wieder da
    S.searchCardsImpl = q => ({ stage: 'de', notes: [], cards: [{ id: 'a', lang: 'de', name: 'X', setName: 'S', localId: '1' }, { id: 'b', lang: 'de', name: 'Y', setName: 'S', localId: '2' }] });
    E.type($('fName'), 'Suche');
    E.click(E.btn($('searchForm'), 'Suchen'));
    await E.respond('searchCards');
    await E.openColl();
    const gi = E.gi('Glurak');
    E.expand(gi);
    E.click(E.btn($('gx' + gi), '+ Exemplar'));
    ok('+ Exemplar: Tab Hinzufügen, lädt die Karte', !$('paneAdd').classList.contains('hidden') && $('paneColl').classList.contains('hidden') &&
      J(E.calls('getCardDetail')[0].args) === J(['swsh3-025', 'de']));
    ok('+ Exemplar: Namensfeld nicht angewählt', E.doc.activeElement !== $('fName'));
    await E.respond('getCardDetail');
    ok('Bestätigung: „Weiteres Exemplar“, ohne Anzahl, Normal', /Weiteres Exemplar für die Sammlung/.test($('addResults').textContent) && !$('cQty') &&
      !$('cReverse').checked && $('cVersion').value === '' && $('cLang').value === 'DE');
    E.pick($('cLang'), 'EN'); E.pick($('cCond'), 'LP');
    E.click($('cAdd'));
    const req = Object.assign({}, E.calls('addCard')[0].args[0]); delete req.rid;
    ok('addCard: ein Exemplar mit eigener Sprache und eigenem Zustand', J(req) === J({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'LP', qty: 1, inputName: 'Glurak', cardLang: 'EN', version: '', ownPrice: null }), req);
    ok('sofort zurück zur Sammlung, die Karte offen, „speichert …“', !$('paneColl').classList.contains('hidden') && !$('gx' + gi).classList.contains('hidden') &&
      /speichert/.test($('gh' + gi).textContent) && E.btn(E.erow(gi, 0), '−1').disabled);
    ok('Hinzufügen steht wieder wie vorher (zwei Treffer)', /2 Treffer – Karte antippen/.test($('addResults').textContent) && !/Weiteres Exemplar/.test($('addResults').textContent));
    await E.respond('addCard');
    ok('gespeichert: 4×, neue Zeile EN LP, nicht neu geladen', E.cnt(gi) === '4' && !/speichert/.test($('gh' + gi).textContent) &&
      /1× EN LP · von Hand/.test($('gr' + gi).textContent) && E.calls('getCollection').length === 0, $('gr' + gi).textContent);
    ok('zuletzt hinzugefügt nennt es auch', /Glurak/.test($('addLast').textContent) && /jetzt 1 Stück/.test($('addLast').textContent), $('addLast').textContent);
    // Reverse-Karte: Variante vorgewählt; Zurück bricht ab
    const ri = E.gIdx(g => g.name === 'Glurak' && g.variant === 'reverse');
    ok('Reverse-Karte: Variante in der Zeile', /025\/189 · Reverse Holo/.test($('gh' + ri).querySelector('.s').textContent), $('gh' + ri).querySelector('.s').textContent);
    E.expand(ri);
    E.click(E.btn($('gx' + ri), '+ Exemplar'));
    await E.respond('getCardDetail');
    ok('Reverse vorgewählt, Preis Reverse', $('cReverse').checked && /3,00/.test($('cPrice').textContent), $('cPrice').textContent);
    E.click(E.btn($('addResults'), 'Zurück'));
    ok('Zurück: Sammlung, nichts gespeichert, Hinzufügen wie vorher', !$('paneColl').classList.contains('hidden') && E.calls('addCard').length === 0 &&
      /2 Treffer/.test($('addResults').textContent));
    // Tab wechseln bricht auch ab
    E.click(E.btn($('gx' + ri), '+ Exemplar'));
    await E.respond('getCardDetail');
    E.click($('tabColl'));
    E.click($('tabAdd'));
    ok('Tab gewechselt: Hinzufügen wieder wie vorher', /2 Treffer/.test($('addResults').textContent) && !$('cAdd'));
    // englische Ersatzdaten: Name der Karte bleibt
    E.click($('tabColl'));
    const mi = E.gIdx(g => g.source === 'en-Ersatz');
    E.expand(mi);
    E.click(E.btn($('gx' + mi), '+ Exemplar'));
    ok('Ersatzdaten: Karte englisch laden', J(E.calls('getCardDetail')[0].args) === J(['base1-8', 'en']));
    await E.respond('getCardDetail');
    ok('Ersatzdaten: Hinweis nennt den gespeicherten Namen', /unter deinem eingegebenen Namen „Mew“/.test($('addResults').querySelector('details.inote').textContent));
    E.click($('cAdd'));
    ok('addCard mit dem Namen der Karte', E.calls('addCard')[0].args[0].lang === 'en' && E.calls('addCard')[0].args[0].inputName === 'Mew');
    await E.respond('addCard');
    // Karte fehlt bei tcgdex: Fehler und Weg zurück
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn($('gx' + pi), '+ Exemplar'));
    await E.respond('getCardDetail');
    ok('Karte nicht gefunden: Meldung, Knopf zurück', /nicht gefunden/.test($('addMsg').textContent) && !!E.btn($('addResults'), 'Zurück zur Sammlung'));
    E.click(E.btn($('addResults'), 'Zurück zur Sammlung'));
    ok('zurück zur Sammlung', !$('paneColl').classList.contains('hidden') && $('addMsg').textContent === '');
    // freie Karte: Formular vorbelegt
    const fi = E.gIdx(g => g.isFree);
    E.expand(fi);
    E.click(E.btn($('gx' + fi), '+ Exemplar'));
    ok('freie Karte: Formular „Weiteres Exemplar“ vorbelegt', /Weiteres Exemplar \(freie Karte\)/.test($('addResults').textContent) && $('frName').value === G.free.name &&
      $('frSet').value === G.free.setName && $('frNumber').value === '8' && $('frVariant').value === 'normal' && !$('frQty'));
    E.pick($('frCond'), 'GD');
    E.click($('frSave'));
    const fr = Object.assign({}, E.calls('addFreeCard')[0].args[0]); delete fr.rid;
    ok('addFreeCard: ein Exemplar', fr.qty === 1 && fr.condition === 'GD' && fr.name === G.free.name, fr);
    ok('zurück zur Sammlung, „speichert …“', !$('paneColl').classList.contains('hidden') && /speichert/.test($('gh' + fi).textContent));
    await E.respond('addFreeCard');
    ok('freie Karte: 2×', E.cnt(fi) === '2');
    // Speichern scheitert: Fehler auch an der Karte
    E.win.ADD_RETRY_MS = [];
    E.click(E.btn($('gx' + gi), '+ Exemplar'));
    await E.respond('getCardDetail');
    E.click($('cAdd'));
    await E.respond('addCard', { error: 'Sperre belegt' });
    ok('Fehler an der Karte und im Tab Hinzufügen', /Exemplar nicht gespeichert: Sperre belegt/.test($('gh' + gi).textContent) && !$('gh' + gi).querySelector('.s.saving') &&
      !!$('addLast').querySelector('.addfail'), $('gh' + gi).textContent);
    E.click(E.btn($('addLast').querySelector('.addfail'), 'Verwerfen'));
    ok('Verwerfen nimmt den Fehler von der Karte', !/nicht gespeichert/.test($('gh' + gi).textContent));
    E.win.ADD_RETRY_MS = [1500, 4000];
    ok('keine Skriptfehler (+ Exemplar)', E.errors.length === 0, E.errors);
  }

  // ---- Rückgängig ----
  {
    const E = boot('sidebar');
    const { $, G, S } = E;
    await E.startup();
    await E.openColl();
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn(E.erow(pi, 0), '−1'));
    const r = await E.respond('adjustEntry');
    ok('Rückgängig sichtbar', !!E.btn($('gh' + pi), 'Rückgängig'));
    E.click(E.btn($('gh' + pi), 'Rückgängig'));
    ok('Rückgängig klappt die Gruppe nicht zu', !$('gx' + pi).classList.contains('hidden'));
    ok('revertAdjust mit dem Token', E.calls('revertAdjust').length === 1 && J(E.calls('revertAdjust')[0].args) === J([r.res.token]), E.calls('revertAdjust')[0] && E.calls('revertAdjust')[0].args);
    ok('während revert kein Rückgängig', !E.btn($('gh' + pi), 'Rückgängig'));
    await E.respond('revertAdjust');
    ok('Anzahl wieder 2, Protokoll leer', E.cnt(pi) === '2' && S.proto.length === 0);
    // Rückgängig verschwindet nach 5 s
    const gi = E.gi('Glurak');
    E.expand(gi);
    E.click(E.btn(E.erow(gi, 0), '−1'));
    await E.respond('adjustEntry');
    ok('Rückgängig da', !!E.btn($('gh' + gi), 'Rückgängig'));
    E.win.__advance(4900);
    ok('nach 4,9 s noch da', !!E.btn($('gh' + gi), 'Rückgängig'));
    E.win.__advance(200);
    ok('nach 5 s weg', !E.btn($('gh' + gi), 'Rückgängig'));
    // −1 auf Import-Zeile, Rückgängig löscht das Protokoll
    const imp = [...$('gr' + gi).querySelectorAll('.erow')].findIndex(el => /Import 3/.test(el.textContent));
    E.click(E.btn(E.erow(gi, imp), '−1'));
    const r2 = await E.respond('adjustEntry');
    ok('handentfernt-LogId im Token', r2.res.token.logIds.length === 1);
    E.click(E.btn($('gh' + gi), 'Rückgängig'));
    ok('revertAdjust bekommt logIds', J(E.calls('revertAdjust')[0].args[0]) === J(r2.res.token));
    await E.respond('revertAdjust');
    ok('Protokoll leer, Anzahl wieder 2', S.proto.length === 0 && E.cnt(gi) === '2');
    // neue Änderung verwirft altes Rückgängig
    E.click(E.btn(E.erow(gi, 0), '−1'));
    await E.respond('adjustEntry');
    E.click(E.btn(E.erow(gi, imp), '−1'));
    ok('alte Rückgängig-Option weg, solange neu gespeichert wird', !E.btn($('gh' + gi), 'Rückgängig'));
    await E.respond('adjustEntry');
    // revert-Fehler
    E.click(E.btn($('gh' + gi), 'Rückgängig'));
    await E.respond('revertAdjust', { error: 'Zeitüberschreitung' });
    ok('revert-Fehler: Meldung, Karte wieder frei', /Zeitüberschreitung/.test($('collMsg').textContent) && !E.win.isBusy(E.win.state.groups[gi]) &&
      /Nicht rückgängig gemacht/.test($('gh' + gi).textContent));
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
    // inzwischen ein Exemplar DE NM über „+ Exemplar“ dazu: die Karte zeichnet neu, das Formular bleibt
    E.click(E.btn($('gx' + gi), '+ Exemplar'));
    await E.respond('getCardDetail', { last: true }); // die erste Anfrage holt die Varianten fürs Bearbeiten (#54)
    E.pick($('cCond'), 'NM');
    E.click($('cAdd'));
    await E.respond('addCard');
    ok('Formular übersteht Neuzeichnen', $('eCond' + gi).value === 'LP' && $('eX' + gi + '_0').value === 'Box 1' && !$('paneColl').classList.contains('hidden'));
    ok('Formular aktualisiert (max 3, Menge bleibt 1, Kopf 3×)', $('eQty' + gi).max === '3' && $('eQty' + gi).value === '1' && /Bearbeiten: 3× DE NM/.test($('ge' + gi).textContent), $('ge' + gi).textContent);
    E.click(E.btn($('ge' + gi), 'Speichern'));
    const rowsNow = () => [...$('gr' + gi).querySelectorAll('.einfo')].map(e => e.textContent);
    ok('sofort: Formular zu, Karte offen, „speichert …“', $('ge' + gi).innerHTML === '' && !$('gx' + gi).classList.contains('hidden') &&
      /speichert/.test($('gh' + gi).textContent), $('gh' + gi).textContent);
    ok('sofort: Zeile geteilt (2× NM, 1× LP mit Box 1, speichert)', rowsNow().some(x => x.indexOf('2× DE NM · von Hand') === 0) &&
      rowsNow().some(x => x.indexOf('1× DE LP · von Hand · speichert') === 0 && /Box 1/.test(x)), rowsNow());
    ok('während des Speicherns: −1 der Karte gesperrt, geteilte Zeile nicht bearbeitbar', E.btn(E.erow(gi, 0), '−1').disabled &&
      E.btn([...$('gr' + gi).querySelectorAll('.erow')].find(el => /speichert/.test(el.textContent)), 'Bearbeiten').disabled);
    ok('editEntry genau einmal', E.calls('editEntry').length === 1);
    const a = E.calls('editEntry')[0].args;
    ok('editEntry(eid, nur Änderungen, qty)', J(a) === J([G.gHand.eid, { cond: 'LP', extras: { Ordner: 'Box 1' } }, 1]), a);
    // gleich die nächste Karte bearbeiten, während noch gespeichert wird
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn($('gr' + pi), 'Bearbeiten'));
    E.pick($('eCond' + pi), 'GD');
    E.click(E.btn($('ge' + pi), 'Speichern'));
    ok('zweite Änderung wartet, zeigt sie aber schon', E.calls('editEntry').length === 1 && /speichert/.test($('gh' + pi).textContent) &&
      /2× DE GD/.test($('gr' + pi).textContent), $('gr' + pi).textContent);
    await E.respond('editEntry');
    ok('erste gespeichert: nicht neu geladen, „speichert“ weg', E.calls('getCollection').length === 0 && !/speichert/.test($('gh' + gi).textContent) &&
      E.gi('Glurak') === gi);
    const t = rowsNow();
    ok('aufgeteilt (Serverstand): 2× NM (nach +1), 1× LP', t.some(x => x.indexOf('2× DE NM · von Hand') === 0) && t.some(x => x.indexOf('1× DE LP · von Hand') === 0 && /Box 1/.test(x)), t);
    ok('danach geht die zweite raus', E.calls('editEntry').length === 1 && E.calls('editEntry')[0].args[0] === G.pImp.eid);
    await E.respond('editEntry');
    ok('zweite gespeichert', !/speichert/.test($('gh' + pi).textContent) && S.rows.find(r => r.eid === G.pImp.eid).cond === 'GD');
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
    ok('Vorschau: das Exemplar wandert aus der Karte', !/Import 3/.test($('gr' + gi).textContent) && /speichert/.test($('gh' + gi).textContent));
    await E.respond('editEntry');
    const vi = E.gIdx(g => g.name === 'Glurak' && g.version === 'Snowflake');
    ok('Version: neue Karte offen direkt unter der alten', vi >= 0 && !$('gx' + vi).classList.contains('hidden') &&
      $('gh' + vi).querySelector('.t').textContent === 'Glurak · Snowflake' && $('g' + gi).nextElementSibling === $('g' + vi));
    ok('Liste nicht neu geladen oder sortiert', E.calls('getCollection').length === 0 && $('collInfo').textContent === '6 Einträge', $('collInfo').textContent);
    // Fehler: die Karte geht zurück und zeigt den Fehler
    E.click(E.btn($('gr' + vi), 'Bearbeiten'));
    E.pick($('eCond' + vi), 'PO');
    E.click(E.btn($('ge' + vi), 'Speichern'));
    ok('Vorschau PO', /EN PO/.test($('gr' + vi).textContent));
    await E.respond('editEntry', { error: 'Eintrag nicht gefunden.' });
    ok('editEntry-Fehler: Änderung zurück, Meldung oben und an der Karte', !/PO/.test($('gr' + vi).textContent) && /nicht gefunden/.test($('collMsg').textContent) &&
      /Nicht gespeichert: Eintrag nicht gefunden/.test($('gh' + vi).textContent) && !/speichert …/.test($('gh' + vi).textContent), [$('gr' + vi).textContent, $('collMsg').textContent]);
    E.click(E.btn($('gr' + vi), 'Bearbeiten'));
    E.click(E.btn($('ge' + vi), 'Abbrechen'));
    ok('Abbrechen schließt das Formular', $('ge' + vi).innerHTML === '');
    E.click(E.btn(E.erow(vi, 0), '−1'));
    await E.respond('adjustEntry');
    ok('nächste Änderung räumt die Fehlermeldung weg', !/Nicht gespeichert/.test($('gh' + vi).textContent));
    ok('keine Skriptfehler (Bearbeiten)', E.errors.length === 0, E.errors);
  }

  // ---- Bearbeiten: Variante (#54) ----
  {
    const E = boot('sidebar');
    const { $, G, S } = E;
    await E.startup();
    await E.openColl();
    const gi = E.gi('Glurak');
    E.expand(gi);
    E.click(E.btn(E.erow(gi, 0), 'Bearbeiten'));
    ok('Varianten werden geladen', /Varianten werden geladen/.test($('ge' + gi).textContent) && J(E.calls('getCardDetail')[0].args) === J(['swsh3-025', 'de']));
    await E.respond('getCardDetail');
    ok('Haken wie beim Hinzufügen: nur Reverse Holo, nicht gesetzt', !!$('eRev' + gi) && !$('eRev' + gi).checked && !$('eFirst' + gi), $('ge' + gi).innerHTML);
    E.pick($('eCond' + gi), 'LP'); // Formular bleibt beim Neuzeichnen
    $('eRev' + gi).checked = true; $('eRev' + gi).dispatchEvent(new E.win.Event('change', { bubbles: true }));
    E.type($('eQty' + gi), '1');
    E.click(E.btn($('ge' + gi), 'Speichern'));
    const a = E.calls('editEntry')[0].args;
    ok('editEntry mit variant: reverse', J(a) === J([G.gHand.eid, { cond: 'LP', variant: 'reverse' }, 1]), a);
    await E.respond('editEntry');
    const ri = E.gIdx(g => g.name === 'Glurak' && g.variant === 'reverse');
    ok('Reverse Holo: eigene Karte', ri >= 0 && S.rows.some(r => r.variant === 'reverse' && r.count === 1 && r.cond === 'LP'), S.rows.map(r => [r.variant, r.count]));
    // zurück: Haken vorbelegt, abwählen -> Grundvariante der Karte
    ok('neue Karte gleich offen', !$('gx' + ri).classList.contains('hidden'));
    E.click(E.btn(E.erow(ri, 0), 'Bearbeiten'));
    await E.respond('getCardDetail');
    ok('Reverse-Haken vorbelegt', $('eRev' + ri).checked);
    $('eRev' + ri).checked = false; $('eRev' + ri).dispatchEvent(new E.win.Event('change', { bubbles: true }));
    E.click(E.btn($('ge' + ri), 'Speichern'));
    ok('abgewählt: variant = Grundvariante (normal)', E.calls('editEntry')[0].args[1].variant === 'normal', E.calls('editEntry')[0].args);
    await E.respond('editEntry');
    // ohne Varianten (Fehler): nichts zu wählen, die übrigen Felder gehen
    const pi = E.gi('Pikachu');
    E.expand(pi);
    E.click(E.btn($('gr' + pi), 'Bearbeiten'));
    await E.respond('getCardDetail');
    ok('Varianten nicht ladbar: Hinweis, kein Haken', /konnten nicht geladen werden/.test($('ge' + pi).textContent) && !$('eRev' + pi), $('ge' + pi).textContent);
    E.click(E.btn($('ge' + pi), 'Abbrechen'));
    // freie Karte: Auswahl Variante
    const fi = E.gIdx(g => g.isFree);
    E.expand(fi);
    E.click(E.btn($('gr' + fi), 'Bearbeiten'));
    ok('freie Karte: Auswahl statt Haken, kein Laden', !!$('eVar' + fi) && $('eVar' + fi).value === 'normal' && E.calls('getCardDetail').length === 0);
    E.pick($('eVar' + fi), 'holo');
    E.click(E.btn($('ge' + fi), 'Speichern'));
    ok('freie Karte: variant holo', E.calls('editEntry')[0].args[1].variant === 'holo', E.calls('editEntry')[0].args);
    await E.respond('editEntry');
    ok('keine Skriptfehler (Variante)', E.errors.length === 0, E.errors);
  }

  // ---- Eigener Preis: hinter dem Link „Eigener Preis …“ in der Karteninfo (#52) ----
  {
    const E = boot('sidebar');
    const { $, S } = E;
    await E.startup();
    await E.openColl();
    const gi = E.gi('Glurak');
    E.expand(gi);
    ok('zu: kein Feld, kein Kasten', !$('op' + gi) && !$('gp' + gi).querySelector('.box'));
    E.click(E.btn($('gp' + gi), 'Eigener Preis …'));
    ok('Link öffnet Feld mit Speichern und Entfernen', !!$('op' + gi) && E.doc.activeElement === $('op' + gi) && !!E.btn($('gp' + gi), 'Speichern') &&
      E.btn($('gp' + gi), 'Entfernen').disabled && $('op' + gi).value === '');
    E.type($('op' + gi), '0');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('Preis 0: kein Aufruf, Fehler', E.calls('setGroupOwnPrice').length === 0 && /größer als 0/.test($('collMsg').textContent));
    E.type($('op' + gi), '2,50');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('während des Speicherns gesperrt', E.btn($('gp' + gi), 'Speichern').disabled);
    E.win.savePrice(gi);
    ok('setGroupOwnPrice(gkey, 2.5) einmal', E.calls('setGroupOwnPrice').length === 1 && J(E.calls('setGroupOwnPrice')[0].args) === J([E.win.state.groups[gi].gkey, 2.5]));
    await E.respond('setGroupOwnPrice');
    ok('gespeichert: Feld zu, Info „2,50 € (eigener Preis)“', !$('op' + gi) && /^2,50\s€ \(eigener Preis\)/.test(E.info(gi).Preis), E.info(gi));
    ok('Kopfzeile bleibt ohne Preis', !/2,50/.test($('gh' + gi).textContent));
    ok('Stub: alle Zeilen der Gruppe', S.rows.filter(r => r.name === 'Glurak').every(r => r.ownPrice === 2.5));
    E.click(E.btn($('gp' + gi), 'Eigener Preis …'));
    ok('wieder offen: Feld 2,50, Entfernen aktiv', $('op' + gi).value === '2,50' && !E.btn($('gp' + gi), 'Entfernen').disabled);
    E.click(E.btn($('gp' + gi), 'Entfernen'));
    ok('setGroupOwnPrice(gkey, null)', J(E.calls('setGroupOwnPrice')[0].args) === J([E.win.state.groups[gi].gkey, null]));
    await E.respond('setGroupOwnPrice');
    ok('wieder Trendpreis', /^1,50\s€/.test(E.info(gi).Preis) && !/eigener Preis\)/.test(E.info(gi).Preis) && !$('op' + gi), E.info(gi));
    ok('Meldung Preis entfernt', /entfernt/.test($('collMsg').textContent));
    E.click(E.btn($('gp' + gi), 'Eigener Preis …'));
    E.click(E.btn($('gp' + gi), 'Eigener Preis …'));
    ok('Link klappt das Feld auch wieder zu', !$('op' + gi));
    E.click(E.btn($('gp' + gi), 'Eigener Preis …'));
    E.type($('op' + gi), '1.234,5');
    E.click(E.btn($('gp' + gi), 'Speichern'));
    ok('Tausenderpunkt verstanden', E.calls('setGroupOwnPrice')[0].args[1] === 1234.5);
    await E.respond('setGroupOwnPrice', { error: 'Gruppe nicht gefunden.' });
    ok('Fehler: Feld bleibt offen, Knopf wieder frei', /nicht gefunden/.test($('collMsg').textContent) && !!$('op' + gi) && !E.btn($('gp' + gi), 'Speichern').disabled);
    // Preis mit Veränderung und Stand (wie das Blatt Sammlung)
    const g = E.win.state.groups[gi];
    g.base.chg = { 30: { eur: 0.4, pct: 25, since: '' } }; g.base.priceDate = '2026-10-13';
    E.win.showBase(g); E.win.redraw(g, 'p');
    ok('Preis: Stand und Veränderung über 30 Tage', /1,50\s€ · Stand 13\.10\.(2026)?/.test(E.info(gi).Preis) && /\+0,40\s€ \(\+25 %\) in 30 Tagen/.test(E.info(gi).Preis) &&
      !!$('gp' + gi).querySelector('.chg.up'), E.info(gi).Preis);
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
    E.click(E.btn(E.erow(fi, 0), '−1'));
    await E.respond('adjustEntry');
    ok('Suche übersteht Neuzeichnen', $('gl' + fi).querySelectorAll('.tile').length === 2);
    E.click($('gl' + fi).querySelectorAll('.tile')[1]);
    ok('linkFreeGroup(gkey, id, lang, base)', J(E.calls('linkFreeGroup')[0].args) === J([oldGkey, 'base1-8', 'de', 'base']), E.calls('linkFreeGroup')[0].args);
    E.win.linkPick(fi, 0);
    ok('kein zweiter linkFreeGroup', E.calls('linkFreeGroup').length === 1);
    const prev = $('g' + fi).previousElementSibling;
    const r = await E.respond('linkFreeGroup');
    const ni = E.gIdx(g => g.gkey === r.res.gkey);
    ok('nicht neu geladen, verknüpfte Gruppe an derselben Stelle, offen, Meldung', E.calls('getCollection').length === 0 && ni >= 0 &&
      !E.win.state.groups[ni].isFree && !$('gx' + ni).classList.contains('hidden') && $('g' + ni).previousElementSibling === prev &&
      !$('g' + fi) && /verknüpft/.test($('collMsg').textContent));
    ok('alte Gruppe nicht mehr als offen gemerkt', !E.win.state.open[oldGkey] && !E.win.coll.byKey[oldGkey]);

    // Set-Auswahl im Verknüpfen; die neue Karte kam von woanders: erst „Neu laden“
    S.addRow({ id: '', name: 'Celebi', setName: 'Ordner', localId: '7', count: 1 });
    S.cards['base1-7'] = { id: 'base1-7', name: 'Celebi', setName: 'Basis-Set', setId: 'base1', localId: '7', setSize: 102, baseVariant: 'holo', baseLabel: 'Holo', image: '' };
    E.type($('colQuery'), 'Celebi');
    E.win.__advance(200);
    ok('Celebi noch nicht in der geladenen Sammlung', E.gi('Celebi') < 0 && E.pending.length === 0);
    E.click($('collReload'));
    await E.respond('getCollection');
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

  // ---- Sammlung im Browser: Suche ohne Server, Neu laden, veraltete Antworten (#30) ----
  {
    const E = boot('sidebar');
    const { $, S, G } = E;
    const st = E.win.state;
    await E.startup();
    E.click($('tabColl'));
    ok('Sammlung einmal laden', E.calls('getCollection').length === 1 && /Lade die Sammlung/.test($('collResults').textContent));
    await E.respond('getCollection');
    ok('Zahl der Einträge', $('collInfo').textContent === '5 Einträge', $('collInfo').textContent);
    // Debounce, dann ohne Server
    E.type($('colQuery'), 'G'); E.type($('colQuery'), 'Gl'); E.type($('colQuery'), 'Glurak');
    E.win.__advance(199);
    ok('Debounce: Liste noch unverändert', st.groups.length === 5);
    E.win.__advance(1);
    ok('Suche im Browser: nur Glurak, kein Serveraufruf', E.pending.length === 0 && st.groups.length === 1 && st.groups[0].name === 'Glurak' &&
      $('collInfo').textContent === '1 von 5 Einträgen', $('collInfo').textContent);
    const q = text => { E.type($('colQuery'), text); E.win.__advance(200); return st.groups.map(g => g.name); };
    ok('Nummer mit Setgröße', J(q('025/189')) === J(['Glurak']) && J(q('25')) === J(['Glurak']) && J(q('025/100')) === J([]));
    ok('Nummer mit Buchstaben, führende Null', J(q('dp016')) === J(['Pikachu']));
    ok('Sonderversion und zwei Wörter', J(q('snowflake')) === J(['Pikachu']) && J(q('glurak 025')) === J(['Glurak']) && J(q('glurak 133')) === J([]));
    q('');
    E.type($('colSet'), 'karmesin');
    E.win.__advance(200);
    ok('Set-Filter', J(st.groups.map(g => g.name).sort()) === J(['Bisasam', 'Evoli']));
    E.type($('colSet'), 'SV1');
    E.win.__advance(200);
    ok('Set-ID', st.groups.length === 2);
    E.type($('colSet'), '');
    E.pick($('colSort'), 'name');
    ok('Sortieren nach Name im Browser, 0er am Ende', E.pending.length === 0 && J(st.groups.map(g => g.name).filter(n => n[0] !== '<')) ===
      J(['Evoli', 'Glurak', 'Pikachu', 'Bisasam']), st.groups.map(g => g.name));
    E.click($('colDir'));
    ok('Richtung umgedreht, 0er bleiben am Ende', st.groups[0].name === 'Pikachu' && st.groups[st.groups.length - 1].name === 'Bisasam', st.groups.map(g => g.name));
    E.pick($('colSort'), 'price');
    ok('Preis: teuerste zuerst', st.groups[0].name === 'Pikachu' && st.groups[1].name === 'Glurak', st.groups.map(g => g.name));
    E.pick($('colSort'), 'set');
    // Tab wechseln: Liste bleibt, kein Neuladen
    E.expand(E.gi('Glurak'));
    E.click($('tabAdd')); E.click($('tabColl'));
    ok('Tab zurück: kein Neuladen, Karte bleibt offen', E.pending.length === 0 && !$('gx' + E.gi('Glurak')).classList.contains('hidden'));
    // Hinzufügen: beim nächsten Öffnen neu laden
    E.win.markStale(); // Hinzufügen ohne delta (z. B. wiederholte Anfrage)
    E.click($('tabColl'));
    ok('nach Hinzufügen: lädt neu, alte Liste bleibt stehen', E.calls('getCollection').length === 1 && st.groups.length === 5 && $('collReload').disabled &&
      /Lädt/.test($('collReload').textContent));
    await E.respond('getCollection');
    ok('neu geladen, Karte weiter offen', !$('collReload').disabled && !$('gx' + E.gi('Glurak')).classList.contains('hidden'));
    // Neu laden holt Änderungen von woanders
    S.rows.find(r => r.eid === G.gHand.eid).count = 9;
    E.click($('collReload'));
    await E.respond('getCollection');
    let gi = E.gi('Glurak');
    ok('Neu laden: Änderung von woanders', E.cnt(gi) === '10');
    // Neu laden, während gespeichert wird: wartet
    E.click(E.btn(E.erow(gi, 0), '−1'));
    E.click($('collReload'));
    ok('Neu laden wartet auf das Speichern', E.calls('getCollection').length === 0 && /sobald alles gespeichert/.test($('collMsg').textContent));
    await E.respond('adjustEntry');
    ok('danach lädt es', E.calls('getCollection').length === 1);
    await E.respond('getCollection');
    gi = E.gi('Glurak');
    ok('Stand nach Laden: 9', E.cnt(gi) === '9');
    // Liste angefragt, dann eine Änderung: die alte Antwort zählt nicht, es lädt noch einmal
    const stale = S.getCollection();
    E.click($('collReload'));
    E.click(E.btn(E.erow(gi, 0), '−1'));
    await E.respond('adjustEntry');
    await E.respond('getCollection', { value: stale }); // Stand von vor dem −1
    ok('veraltete Liste verworfen, lädt noch einmal', E.calls('getCollection').length === 1 && E.cnt(gi) === '8');
    await E.respond('getCollection');
    gi = E.gi('Glurak');
    ok('frisch: 8', E.cnt(gi) === '8' && st.groups[gi].count === 8);
    // zwei Ladeaufträge: nur der neueste zählt, ein alter Fehler auch nicht
    E.win.loadCollection(); E.win.loadCollection();
    await E.respond('getCollection', { last: true });
    await E.respond('getCollection', { error: 'alt' });
    ok('veralteter Listenfehler ignoriert', !/alt/.test($('collMsg').textContent) && st.groups.length === 5);
    E.win.loadCollection();
    await E.respond('getCollection', { error: 'Zeitüberschreitung' });
    ok('Ladefehler: Meldung, alte Liste bleibt', /Zeitüberschreitung/.test($('collMsg').textContent) && st.groups.length === 5 && !$('collReload').disabled);
    // während des Ladens woanders hinzugefügt: die Antwort ist schon alt, beim nächsten Öffnen noch einmal
    E.win.loadCollection();
    E.click($('tabAdd'));
    E.win.markStale();
    await E.respond('getCollection');
    ok('Hinzufügen während des Ladens: bleibt als veraltet markiert', E.win.coll.stale === true);
    E.click($('tabColl'));
    ok('beim Öffnen lädt es noch einmal', E.calls('getCollection').length === 1);
    await E.respond('getCollection');
    ok('jetzt aktuell', E.win.coll.stale === false);
    E.click($('tabAdd')); E.click($('tabColl'));
    ok('Tab hin und her, während nichts geändert wurde: nichts geladen', E.pending.length === 0);
    ok('keine Skriptfehler (Sammlung im Browser)', E.errors.length === 0, E.errors);
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
    ok('Zeile ohne leere Teile', !/·\s+·/.test($('gh' + gi).textContent) && !/kein Preis/.test($('gh' + gi).textContent), $('gh' + gi).textContent);
    // Tastatur: die ganze Zeile ist ein Knopf
    const row = () => $('gh' + gi).querySelector('.item.head');
    ok('Zeile mit der Tastatur erreichbar', row().getAttribute('tabindex') === '0' && row().getAttribute('role') === 'button' && row().getAttribute('aria-expanded') === 'false');
    row().dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('Enter klappt auf', !$('gx' + gi).classList.contains('hidden') && row().getAttribute('aria-expanded') === 'true');
    ok('Preis "" vom Server: „kein Preis“ in der Karteninfo', /^kein Preis/.test(E.info(gi).Preis), E.info(gi));
    // zwei Hand-Zeilen: −1 genau auf die gewählte
    const en = [...$('gr' + gi).querySelectorAll('.erow')].findIndex(el => /EN LP/.test(el.textContent));
    E.click(E.btn(E.erow(gi, en), '−1'));
    ok('−1 auf die gewählte Hand-Zeile', J(E.calls('adjustEntry')[0].args) === J([handEn.eid, -1]));
    await E.respond('adjustEntry');
    ok('Anzahl 3', E.cnt(gi) === '3');
    // applied 0: kein Rückgängig
    const imp = [...$('gr' + gi).querySelectorAll('.erow')].findIndex(el => /Import 3/.test(el.textContent));
    E.click(E.btn(E.erow(gi, imp), '−1'));
    await E.respond('adjustEntry', { value: { token: { eid: G.gImp.eid, applied: 0, logIds: [], createdEid: '' }, eid: G.gImp.eid, count: 0, groupCount: 3, applied: 0, gkey: E.win.state.groups[gi].gkey, delta: null } });
    ok('applied 0 (ohne delta): kein Rückgängig, nichts geändert', !E.btn($('gh' + gi), 'Rückgängig') && E.cnt(gi) === '3');
    // Fehler bei adjustEntry
    E.click(E.btn(E.erow(gi, 0), '−1'));
    await E.respond('adjustEntry', { error: 'Sperre belegt' });
    ok('adjust-Fehler: Meldung oben und an der Karte, Knöpfe frei, Anzahl unverändert', /Sperre belegt/.test($('collMsg').textContent) &&
      /Nicht geändert: Sperre belegt/.test($('gh' + gi).textContent) && !E.btn(E.erow(gi, 0), '−1').disabled && E.cnt(gi) === '3');
    E.click(E.btn(E.erow(gi, 0), '−1'));
    await E.respond('adjustEntry');
    const ub = E.btn($('gh' + gi), 'Rückgängig');
    ub.dispatchEvent(new E.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('Enter auf Rückgängig klappt nicht zu', !$('gx' + gi).classList.contains('hidden'));
    row().dispatchEvent(new E.win.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    ok('Leertaste klappt zu', $('gx' + gi).classList.contains('hidden'));
    // 44px
    const css = $('collResults').ownerDocument.querySelector('style').textContent;
    const rule = sel => { const m = css.match(new RegExp('(^|\\n)\\s*' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')); return m ? m[2] : ''; };
    ok('44px: .btn', /min-height:\s*44px/.test(rule('.btn')));
    ok('44px: .btn.small', /min-height:\s*44px/.test(rule('.btn.small')) && /min-width:\s*44px/.test(rule('.btn.small')));
    ok('44px: .undo', /min-height:\s*44px/.test(rule('.undo')));
    ok('44px: aufklappbare Infozeile', /min-height:\s*44px/.test(rule('.item .info')));
    ok('großer Pfeil rechts (#52)', /font-size:\s*22px/.test(rule('.item .side .chev')));
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
      /Karten erfassen/.test(m.textContent) && /Jetzt übernehmen/.test(m.textContent) && /Neue Bereitstellung/.test(m.textContent) &&
      /gelbe Leiste/.test(m.textContent) && /Zugriff erlauben/.test(m.textContent) && /tcgdex\.net/.test(m.textContent) && !E.btn($('updInfo'), 'Neue Version holen').disabled);
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
    ok('Übernahme erklärt die gelbe Leiste von Google', /gelbe Leiste/.test($('takeBox').textContent) && /Zugriff erlauben/.test($('takeBox').textContent) &&
      /fehlen die Kartenbilder/.test($('takeBox').textContent));
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
    // das Vorladen vom Start (#39 V3) gilt nach der Übernahme nicht mehr: ein zweiter Aufruf
    ok('Zur Sammlung', !$('paneColl').classList.contains('hidden') && E.calls('getCollection').length === 2);
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
