'use strict';
/**
 * Ende-zu-Ende-Test des Import-Tabs gegen den ECHTEN Server (Code.gs + Import.gs über harness2.js).
 *
 * - Ui.html kommt über das echte kartenErfassen() (bzw. doGet()) als Vorlage, die Scriptlets werden
 *   ausgewertet, include('ImportUi') ruft die echte Serverfunktion (liefert die echte ImportUi.html).
 * - google.script.run bedient die echten Serverfunktionen asynchron; Argumente und Ergebnisse laufen
 *   durch JSON wie bei Apps Script (Brücke wie in test_integration.js).
 * - Alles wird durch Klicks gesteuert: Import-Tab, Neuer Import, Link einer erfundenen .xlsx-Datei im Aufbau
 *   von Erics alter Tabelle, Assistent, Erkennung (mehrere Schritte), Prüfliste, Vorschau, Importieren,
 *   Sammlung, Zurücknehmen, Entwurf nach dem Schließen, Abbrechen, unterbrochener Import mit Fortsetzen, Web-Modus.
 * - Nach jedem Schritt: Blätter prüfen; die sichtbaren Texte mit Erics Augen prüfen (Deutsch, du, keine
 *   Gedankenstriche, keine Roh-IDs, kein JSON).
 *
 * Aufruf: node test_import_ui_e2e.js   (Exit-Code 1 bei Fehlern)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness2');

const t = H.runner('import-ui-e2e');
const J = (x) => JSON.stringify(x);
const SRC = path.join(__dirname, '..', 'src');
const IMPORTUI_RAW = fs.readFileSync(path.join(SRC, 'ImportUi.html'), 'utf8');

/* ===========================================================================
 * Erfundene tcgdex-Welt (keine echten Daten von Eric)
 * ========================================================================= */

const SETS = {
  base1: { en: 'Base Set', de: 'Grundset', official: 102, total: 102, date: '1999-01-09' },
  ex11: { en: 'Delta Species', de: 'EX Delta Species', official: 113, total: 114, date: '2005-10-31' },
  dpp: { en: 'DP Black Star Promos', de: 'DP Black Star Promos', official: 56, total: 56, date: '2007-05-01' },
  pl2: { en: 'Rising Rivals', de: 'Aufstieg der Rivalen', official: 111, total: 120, date: '2009-05-16' },
  pl3: { en: 'Supreme Victors', de: 'Ultimative Sieger', official: 147, total: 153, date: '2009-08-19' },
  hgss1: { en: 'HeartGold & SoulSilver', de: 'HeartGold & SoulSilver', official: 123, total: 124, date: '2010-02-10', abbr: 'HS' },
  hgss2: { en: 'Unleashed', de: 'Entfesselt', official: 95, total: 96, date: '2010-05-12', abbr: 'UL' },
  hgss3: { en: 'Undaunted', de: 'Unerschrocken', official: 90, total: 91, date: '2010-08-18' },
  hgssp: { en: 'HGSS Black Star Promos', de: 'HGSS Black Star Promos', official: 25, total: 25, date: '2010-02-01' },
  swsh3: { en: 'Darkness Ablaze', de: 'Flammende Finsternis', official: 189, total: 201, date: '2020-08-14' }
};
const NORMAL = { normal: true, reverse: true, holo: false, firstEdition: false };
const HOLO = { normal: false, reverse: true, holo: true, firstEdition: false };
/** [id, de, en, Varianten, Preise | null] */
const CARDS = [
  ['pl2-12', 'Celebi', 'Celebi', NORMAL, { trend: 0.5, holo: 1 }],
  ['pl3-148', 'Arktos', 'Articuno', HOLO, { trend: 2.2, holo: 2.2 }],
  ['hgss2-10', 'Nachtara', 'Umbreon', HOLO, { trend: 3, holo: 3 }],
  ['hgss2-40', 'Kramurx', 'Murkrow', NORMAL, { trend: 0.2, holo: 0.6 }],
  ['hgss2-88', 'Despotar', 'Tyranitar', HOLO, { trend: 3.5, holo: 4 }],
  ['hgss3-20', 'Starmie', 'Starmie', NORMAL, { trend: 0.4, holo: 1.2 }],
  ['hgss3-60', 'Mampfaxo', 'Munchlax', NORMAL, { trend: 0.3, holo: 0.8 }],
  ['hgss3-82', 'Hundemon', 'Houndoom', NORMAL, { trend: 0.8, holo: 1.6 }],
  ['hgss1-5', 'Gengar', 'Gengar', HOLO, { trend: 8, holo: 9 }],
  ['hgss1-61', 'Feurigel', 'Cyndaquil', NORMAL, { trend: 0.3, holo: 0.9 }],
  ['hgss1-78', 'Pikachu', 'Pikachu', NORMAL, { trend: 0.5, holo: 1.5 }],
  ['hgss1-111', 'Lugia', 'Lugia', HOLO, { trend: 15, holo: 15 }],
  ['hgssp-HGSS01', 'Ho-Oh', 'Ho-Oh', HOLO, { trend: 5, holo: 5 }],
  ['ex11-12', 'Dragoran', 'Dragonite', HOLO, { trend: 10, holo: 10 }],
  ['ex11-62', 'Ditto', 'Ditto', NORMAL, { trend: 6.5, holo: 7 }],
  ['dpp-DP12', 'Plaudagei', 'Chatot', HOLO, null],
  ['swsh3-025', 'Glurak', 'Charizard', NORMAL, { trend: 1.5, holo: 3.25 }],
  ['swsh3-136', 'Glurak', 'Charizard', NORMAL, { trend: 2, holo: 3 }],
  ['base1-4', 'Glurak', 'Charizard', HOLO, { trend: 300, holo: 300 }]
];
const localIdOf = (id) => id.slice(id.indexOf('-') + 1);
const setOf = (id) => id.slice(0, id.indexOf('-'));

function tcgCard(row, lang) {
  const [id, de, en, variants, price] = row;
  const s = SETS[setOf(id)];
  const c = {
    id, localId: localIdOf(id), name: lang === 'de' ? de : en,
    image: 'https://assets.tcgdex.net/' + lang + '/x/' + setOf(id) + '/' + localIdOf(id),
    category: 'Pokemon', rarity: 'Rare', illustrator: 'Erfundene Zeichnerin',
    set: { id: setOf(id), name: s[lang], cardCount: { official: s.official, total: s.total } },
    variants: Object.assign({}, variants)
  };
  if (price) c.pricing = { cardmarket: { trend: price.trend, 'trend-holo': price.holo, updated: '2026-10-13T00:00:00Z' } };
  return c;
}

function makeDb() {
  const db = {};
  db['de/sets'] = [];
  db['en/sets'] = [];
  Object.keys(SETS).forEach((id) => {
    const s = SETS[id];
    ['de', 'en'].forEach((lang) => {
      db[lang + '/sets'].push({ id, name: s[lang], logo: 'https://assets.tcgdex.net/' + lang + '/logo/' + id, cardCount: { official: s.official, total: s.total } });
      const cards = CARDS.filter((c) => setOf(c[0]) === id).map((c) => ({ id: c[0], localId: localIdOf(c[0]), name: lang === 'de' ? c[1] : c[2] }));
      const full = { id, name: s[lang], releaseDate: s.date, cardCount: { official: s.official, total: s.total }, cards };
      if (s.abbr && lang === 'en') full.abbreviation = { official: s.abbr };
      db[lang + '/sets/' + id] = full;
    });
  });
  CARDS.forEach((c) => {
    db['de/cards/' + c[0]] = tcgCard(c, 'de');
    db['en/cards/' + c[0]] = tcgCard(c, 'en');
  });
  db['de/cards'] = CARDS.map((c) => ({ id: c[0], name: c[1] }));
  db['en/cards'] = CARDS.map((c) => ({ id: c[0], name: c[2] }));
  // Namenssuche (findCandidates_): Glurak hat drei Karten, Feurigel eine
  db['de/cards?name=Glurak'] = ['swsh3-025', 'swsh3-136', 'base1-4'].map((id) => ({ id, localId: localIdOf(id), name: 'Glurak' }));
  db['de/cards?name=Feurigel'] = [{ id: 'hgss1-61', localId: '61', name: 'Feurigel' }];
  return db;
}

/* ===========================================================================
 * Erfundene Quelle im Aufbau von Erics alter Excel-Datei
 * ========================================================================= */

const CM = 'https://www.cardmarket.com/de/Pokemon/Products/Singles/';
const HEAD = ['Karte Name', 'Setnummer', 'Cardmarket', 'Set', '30 Tage Preistrend', 'Datum Preis-Daten', 'Spalte 1'];
const ROWS = [
  ['Arktos', '148', CM + 'Supreme-Victors/Articuno-Lv34-SV148', 'Ultimative Sieger', '2,20 €', '01.10.2026', 'Ordner A'],
  ['Nachtara', '10', CM + 'Unleashed/Umbreon-UL10', 'Entfesselt', '3,00 €', '01.10.2026', 'Ordner A'],
  ['Despotar', '88', CM + 'Unleashed/Tyranitar-UL88', 'Entfesselt', '3,50 €', '01.10.2026', 'Ordner A'],
  ['Hundemon', '82', CM + 'Undaunted/Houndoom-UD82', 'Unerschrocken', '0,80 €', '01.10.2026', 'Ordner B'],
  ['Hundemon', '82', CM + 'Undaunted/Houndoom-UD82', 'Unerschrocken', '0,80 €', '01.10.2026', 'Ordner B'],
  ['Pikachu Snowflake', '78', CM + 'HeartGold-SoulSilver/Pikachu-V3-HS78', 'HeartGold & SoulSilver', '12,00 €', '01.10.2026', 'Ordner B'],
  ['Gengar Rev Holo', '5', '', 'HeartGold & SoulSilver', '9,00 €', '01.10.2026', ''],
  ['Ditto', 'DS 62', '', '', '6,50 €', '01.10.2026', 'Ordner A'],
  ['Plaudagei', 'DP12', '', 'DP Black Star Promos', '1,10 €', '28.09.2026', ''],
  ['Glurak', '', '', '', '', '', 'Ordner C'],
  ['Fantasiemon', '999', '', 'Fantasie-Set', '5,00 €', '02.10.2026', 'Ordner C'],
  ['Feurigl', '61', '', '', '0,30 €', '01.10.2026', ''],
  ['Tauschkarte von Tom', '', '', '', '', '', 'nicht meine'],
  ['', '', '', '', '', '', ''],
  ['Lugia', '111', 'https://www.pricecharting.com/game/pokemon-heartgold-soulsilver/lugia-111', 'HeartGold & SoulSilver', '15,00 €', '01.10.2026', ''],
  ['Kramurx', '40', '', 'Entfesselt', '0,20 €', '01.10.2026', ''],
  ['Starmie', '20', CM + 'Undaunted/Starmie-UD20?isReverseHolo=Y', 'Unerschrocken', '1,20 €', '01.10.2026', ''],
  ['Dragoran', '12', CM + 'Delta-Species/Dragonite-DS12', 'EX Delta Species', '10,00 €', '01.10.2026', 'Ordner A'],
  ['Mampfaxo', '60', '', 'Unerschrocken', '0,30 €', '01.10.2026', ''],
  ['Ho-Oh', 'HGSS 01', '', '', '5,00 €', '01.10.2026', ''],
  ['SUMME', '', '', '', '90,50 €', '', '']
];
const XLSX_ID = 'XLSXUIE2E0001';
const XLSX_NAME = 'Pokemon Ordner.xlsx';
const XLSX_URL = 'https://drive.google.com/file/d/' + XLSX_ID + '/view?usp=sharing';
const ORIGIN_LABEL = XLSX_NAME + ', Import ';
const N_ENTRIES = 18; // zusammengefasste Einträge (Hundemon zweimal = einer)

function addXlsx(env) {
  // Kramurx: Name als Link (wie in Excel verlinkte Zellen), die Cardmarket-Spalte ist dort leer
  const kramurxRow = 2 + ROWS.findIndex((r) => r[0] === 'Kramurx');
  env.addSource({
    id: XLSX_ID, name: XLSX_NAME, mime: 'xlsx', tabs: {
      Tabellenblatt1: { values: [HEAD].concat(ROWS), links: { [kramurxRow + ',1']: CM + 'Unleashed/Murkrow-UL40' } },
      Pokedex: [['Nr', 'Pokémon', 'Vorhanden'], ['1', 'Bisasam', 'WAHR'], ['2', 'Bisaknosp', 'FALSCH']],
      'Bulk + Sammlung': [['Karte', 'Anzahl']]
    }
  });
}

/** Erics Blatt vor dem Einspielen: Daten im alten Format (23 Spalten) mit drei Testkarten von Hand, Verlauf. */
function addV1Data(env) {
  const sh = env.ss.insertSheet('Daten');
  const V1 = ['Schlüssel', 'Karten-ID', 'Set-ID', 'Setname', 'Set-Erscheinungsdatum', 'Nummer', 'Nummer normalisiert', 'Setgröße',
    'Name', 'Name englisch', 'Quelle', 'Variante', 'Zustand', 'Anzahl', 'Trendpreis (EUR)', 'Preisstand', 'Bild-URL', 'Seltenheit',
    'Kartentyp', 'Illustrator', 'Hinzugefügt am', 'Zuletzt geändert', 'Nummer sortierbar'];
  const d = new Date(2026, 8, 20);
  [
    V1,
    ['pl3-148|holo|NM', 'pl3-148', 'pl3', 'Ultimative Sieger', '2009-08-19', '148', '148', 147, 'Arktos', 'Articuno', 'de', 'holo', 'NM', 1, 2.2, '2026-10-13', 'https://assets.tcgdex.net/de/x/pl3/148', 'Rare', 'Pokemon', 'Z', d, d, 148],
    ['pl2-12|normal|', 'pl2-12', 'pl2', 'Aufstieg der Rivalen', '2009-05-16', '12', '12', 111, 'Celebi', 'Celebi', 'de', 'normal', '', 1, 0.5, '2026-10-13', 'https://assets.tcgdex.net/de/x/pl2/12', 'Rare', 'Pokemon', 'Z', d, d, 12],
    ['hgss2-10|holo|LP', 'hgss2-10', 'hgss2', 'Entfesselt', '2010-05-12', '10', '10', 95, 'Nachtara', 'Umbreon', 'de', 'holo', 'LP', 2, 3, '2026-10-13', 'https://assets.tcgdex.net/de/x/hgss2/10', 'Rare Holo', 'Pokemon', 'Z', d, d, 10]
  ].forEach((r, i) => r.forEach((v, j) => sh.setCell(i + 1, j + 1, v)));
  const hist = env.ss.insertSheet('Verlauf');
  [['Datum', 'Gesamtwert (EUR)', 'Kartenanzahl', 'Einträge ohne Preis', 'Fehlgeschlagene Abrufe'],
    [new Date(2026, 9, 13), 8.7, 4, 0, 0], [new Date(2026, 9, 14), 8.7, 4, 0, 0]]
    .forEach((r, i) => r.forEach((v, j) => hist.setCell(i + 1, j + 1, v)));
}

/* ===========================================================================
 * Vorlage auswerten wie HtmlService (nur druckende Scriptlets kommen vor)
 * ========================================================================= */

function escHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function evaluateTemplate(tpl, includeImpl) {
  const seen = [];
  const html = tpl.__content.replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, kind, expr) => {
    seen.push(m);
    if (!kind) throw new Error('Scriptlet ohne Ausgabe wird hier nicht unterstützt: ' + m);
    const val = new Function('mode', 'start', 'include', 'return (' + expr + ');')(tpl.mode, tpl.start, includeImpl);
    return kind === '!=' ? String(val) : escHtml(val);
  });
  return { html, scriptlets: seen };
}

/** Was google.script.run nicht transportiert (Date, Funktion, undefined, NaN). */
function leaks(x, where, out) {
  out = out || [];
  if (x instanceof Date || Object.prototype.toString.call(x) === '[object Date]') out.push(where + ': Date');
  else if (typeof x === 'function') out.push(where + ': Funktion');
  else if (typeof x === 'number' && !isFinite(x)) out.push(where + ': ' + x);
  else if (Array.isArray(x)) x.forEach((v, i) => leaks(v, where + '[' + i + ']', out));
  else if (x && typeof x === 'object') {
    Object.keys(x).forEach((k) => {
      if (x[k] === undefined) out.push(where + '.' + k + ': undefined');
      else leaks(x[k], where + '.' + k, out);
    });
  }
  return out;
}

/* ===========================================================================
 * Seite starten: echte Vorlage + echter Server (asynchron, JSON-Rundreise)
 * ========================================================================= */

const ALL_CALLS = [];      // alle Aufrufe aller Seiten (für die Vertragsprüfung)
const ALL_LEAKS = [];

function boot(env, mode, label) {
  let out;
  if (mode === 'sidebar') {
    const before = env.ui.sidebars.length;
    env.ctx.kartenErfassen();
    out = env.ui.sidebars[before];
    t.ok(label + ': kartenErfassen zeigt die Seitenleiste „Pokémon-Karten“', !!out && out.title === 'Pokémon-Karten', out && out.title);
  } else {
    out = env.ctx.doGet();
    t.ok(label + ': doGet liefert „Pokémon-Sammlung“ mit viewport', !!out && out.title === 'Pokémon-Sammlung' && out.meta.some((m) => m[0] === 'viewport'), out && out.title);
  }
  const tpl = out.template;
  t.ok(label + ': Vorlage Ui mit mode=' + mode, tpl && tpl.__file === 'Ui' && tpl.mode === mode, tpl && tpl.mode);
  const includes = [];
  const ev = evaluateTemplate(tpl, (name) => {
    includes.push(name);
    const s = env.ctx.include(name); // echte Serverfunktion
    if (typeof s !== 'string') throw new Error('include liefert keinen Text');
    return s;
  });
  if (mode === 'sidebar') {
    t.ok(label + ': include(\'ImportUi\') liefert die echte ImportUi.html', J(includes) === J(['ImportUi']) &&
      ev.html.indexOf(IMPORTUI_RAW) >= 0 && ev.html.indexOf('<?') < 0, includes);
  } else {
    // die Handy-Seite hat keinen Import-Teil (#36 A3)
    t.ok(label + ': ohne ImportUi.html', J(includes) === J([]) && ev.html.indexOf('id="paneImport"') < 0 && ev.html.indexOf('<?') < 0, includes);
  }

  const pending = [];
  const errors = [];
  const callLog = [];
  const confirms = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e && (e.stack || e.message)) || e)));
  vc.on('error', (e) => errors.push(String(e)));
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
      win.clearTimeout = (id) => { const k = timers.findIndex((x) => x.id === id); if (k >= 0) timers.splice(k, 1); };
      win.__advance = (ms) => {
        now += ms;
        for (;;) {
          const due = timers.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          timers.splice(timers.indexOf(due), 1);
          due.fn();
        }
      };
      win.google = { script: { get run() { return makeRun(); } } };
      win.__confirmAnswer = true;
      win.confirm = (msg) => { confirms.push(String(msg)); return win.__confirmAnswer; };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 6; k++) await new Promise((r) => setImmediate(r)); };

  const E = {
    env, win, doc, pending, errors, callLog, confirms, mode, label,
    $: (id) => doc.getElementById(id),
    main: () => doc.getElementById('impMain'),
    pane: () => doc.getElementById('paneImport'),
    text: () => doc.getElementById('paneImport').textContent.replace(/\s+/g, ' ').trim(),
    msg: () => doc.getElementById('impMsg').textContent.replace(/\s+/g, ' ').trim(),
    act: () => ((doc.getElementById('impAct') || { textContent: '' }).textContent).replace(/\s+/g, ' ').trim(),
    /** Einen offenen Aufruf an den echten Server geben. */
    async serve(p) {
      const entry = { fn: p.fn, args: p.args, page: label };
      callLog.push(entry);
      ALL_CALLS.push(entry);
      let res, err = null;
      try {
        if (/_$/.test(p.fn)) throw new Error(p.fn + ' ist privat und über google.script.run nicht erreichbar');
        if (typeof env.ctx[p.fn] !== 'function') throw new Error('Serverfunktion fehlt: ' + p.fn);
        res = env.ctx[p.fn].apply(null, JSON.parse(JSON.stringify(p.args)));
      } catch (e) { err = e; }
      if (err) {
        entry.error = err.message;
        if (p.fail) p.fail(new win.Error(err.message));
      } else {
        const l = leaks(res, p.fn);
        l.forEach((x) => ALL_LEAKS.push(x));
        const plain = l.some((x) => /Date|Funktion/.test(x)) || res === undefined ? null : JSON.parse(JSON.stringify(res));
        entry.res = plain === null ? null : JSON.parse(JSON.stringify(plain)); // eigene Kopie: das UI darf seine verändern
        if (p.ok) p.ok(plain);
      }
      await flush();
    },
    /** Alle offenen (und dabei neu entstehenden) Aufrufe abarbeiten. */
    async settle(max) {
      max = max || 80;
      await flush();
      while (pending.length && max-- > 0) await E.serve(pending.shift());
      if (pending.length) throw new Error('settle: zu viele Aufrufe (' + pending.map((p) => p.fn).join(',') + ')');
    },
    /** Den ersten offenen Aufruf dieser Funktion bedienen. */
    async serveFn(fn) {
      await flush();
      const k = pending.findIndex((p) => p.fn === fn);
      if (k < 0) throw new Error('kein offener Aufruf ' + fn + ' (offen: ' + pending.map((p) => p.fn).join(',') + ')');
      await E.serve(pending.splice(k, 1)[0]);
    },
    calls: (fn) => callLog.filter((c) => c.fn === fn),
    lastCall: (fn) => { const l = callLog.filter((c) => c.fn === fn); return l[l.length - 1] || null; },
    btn(el, text) { return [...(el || doc).querySelectorAll('button')].find((b) => b.textContent.trim() === text) || null; },
    btnRe(el, re) { return [...(el || doc).querySelectorAll('button')].find((b) => re.test(b.textContent.trim())) || null; },
    click(el, what) { if (!el) throw new Error('Element fehlt: ' + (what || '?') + ' | ' + E.text().slice(0, 300)); el.click(); },
    async clickSettle(el, what) { E.click(el, what); await E.settle(); },
    type(el, v) { if (!el) throw new Error('Feld fehlt'); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    pick(el, v) { if (!el) throw new Error('Auswahl fehlt'); if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); },
    check(el, on) { if (!el) throw new Error('Haken fehlt'); if (!!el.checked !== !!on) el.click(); },
    step() { const m = ((E.main().querySelector('.imp-sub') || {}).textContent || '').match(/Schritt (\d) von 8/); return m ? Number(m[1]) : 0; },
    radioVal(name) { const r = [...doc.querySelectorAll('input[name="' + name + '"]')].find((x) => x.checked); return r ? r.value : null; },
    /** Weiter im Assistenten (Knopf „Weiter“), dann Server bedienen. */
    async next() { E.click(E.btn(E.main(), 'Weiter'), 'Weiter'); await E.settle(); },
    close() { pending.length = 0; win.close(); }
  };
  return E;
}

/* ===========================================================================
 * Prüfungen
 * ========================================================================= */

const FORMAL = /\b(Sie (können|haben|müssen|sollten|wählen|klicken|geben|finden|möchten)|Ihnen|Ihre[mnrs]?|Bitte (geben|wählen|klicken|prüfen) Sie)\b/;

/** Sichtbare Texte mit Erics Augen: Deutsch, du, keine Gedankenstriche, keine Roh-IDs, kein JSON, keine Fehlerreste. */
function eyes(E, label, root) {
  const el = root || E.pane();
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  const bad = [];
  if (text.indexOf('—') >= 0) bad.push('Gedankenstrich');
  const m1 = text.match(/\b(undefined|null|NaN|true|false)\b|\[object/); if (m1) bad.push('roh: ' + m1[0]);
  if (/[{[]\s*"[A-Za-z]/.test(text) || /"\s*:\s*["{[\d]/.test(text)) bad.push('JSON');
  const m2 = text.match(/\b[0-9a-f]{12}\b/); if (m2) bad.push('Quellzeilen-Kennung ' + m2[0]);
  const m3 = text.match(/\b[EL][0-9a-f]{10}\b/); if (m3) bad.push('Eintrag-/Log-ID ' + m3[0]);
  const m4 = text.match(FORMAL); if (m4) bad.push('Sie-Form: ' + m4[0]);
  const m5 = text.match(/TypeError|ReferenceError|is not a function|Cannot read|Exception|Unexpected token|Serverfunktion fehlt|ist privat/); if (m5) bad.push('Fehlerrest: ' + m5[0]);
  const m6 = text.match(/\b(Error|Loading|Cancel|Submit|Next|Back)\b/); if (m6) bad.push('Englisch: ' + m6[0]);
  const m7 = text.match(/timed out|Service \w+|with id|SSID|XLSXUIE2E/); if (m7) bad.push('Technik: ' + m7[0]);
  if (process.env.SHOW) console.log('\n--- ' + label + ' ---\n' + text.slice(0, 2500));
  t.ok(label + ': Texte für Eric ok', bad.length === 0, { bad, text: text.slice(0, 700) });
  return text;
}

function snapRows(env, filter) {
  // leere Zusatzwerte zählen nicht (eine neue Zusatzspalte gibt jeder Zeile ein leeres Feld)
  const ex = (o) => { const out = {}; Object.keys(o || {}).sort().forEach((k) => { if (String(o[k]) !== '') out[k] = o[k]; }); return out; };
  return J(env.data().filter(filter).map((d) => [d.eid, d.key, d.count, d.cond, d.lang, d.origin, d.fp, d.ownPrice, d.version, d.variant, ex(d.extras)]));
}

/** Konsistenz der Blätter (wie test_integration.js) plus Import-Zustand. */
function checkSheets(env, label, opts) {
  opts = opts || {};
  const COL = env.run('COL');
  const c = env.ctx;
  const raw = c.readData_(c.sheet_('Daten')).filter((r) => c.isDataRow_(r));
  const eids = raw.map((r) => String(r[COL.eid]));
  const bad = [];
  if (!eids.every((e) => /^E[0-9a-f]{10}$/.test(e)) || new Set(eids).size !== eids.length) bad.push(['eids', eids]);
  const badKey = raw.filter((r) => String(r[COL.key]) !== c.entryKey_(r));
  if (badKey.length) bad.push(['Schlüssel', badKey.map((r) => [r[COL.key], c.entryKey_(r)])]);
  const hand = {};
  raw.forEach((r) => {
    if (!c.isHandOrigin_(r[COL.origin])) return;
    const k = c.entryKey_(r);
    if (hand[k]) bad.push(['doppelte Hand-Zeile', k]);
    hand[k] = true;
  });
  if (!raw.every((r) => r[COL.origin] === 'Hand' || /^Import \d+$/.test(r[COL.origin]))) bad.push(['Herkunft', raw.map((r) => r[COL.origin])]);
  if (!raw.every((r) => Number.isInteger(r[COL.count]) && r[COL.count] >= 0)) bad.push(['Anzahl', raw.map((r) => r[COL.count])]);
  if (!raw.every((r) => (r[COL.origin] === 'Hand') === (String(r[COL.fp] || '') === ''))) bad.push(['Quellzeile', raw.map((r) => [r[COL.origin], r[COL.fp]])]);
  // Gruppen = Neuberechnung aus Daten
  const want = {};
  raw.forEach((r) => { const g = c.groupKey_(r); (want[g] = want[g] || []).push(r); });
  const groups = env.groups();
  const gk = groups.map((g) => g['Gruppenschlüssel']);
  if (!(gk.length === Object.keys(want).length && gk.every((k) => want[k]) && new Set(gk).size === gk.length)) bad.push(['Gruppen', gk, Object.keys(want)]);
  groups.forEach((g) => {
    const rs = want[g['Gruppenschlüssel']];
    if (!rs) return;
    const cnt = rs.reduce((s, r) => s + r[COL.count], 0);
    if (g.Anzahl !== cnt) bad.push(['Gruppe Anzahl', g['Gruppenschlüssel'], g.Anzahl, cnt]);
    if (g.Exemplare !== c.exemplareText_(rs)) bad.push(['Gruppe Exemplare', g['Gruppenschlüssel'], g.Exemplare]);
    const gp = c.groupPrice_(rs);
    if ((g['Preis (EUR)'] === '' ? null : g['Preis (EUR)']) !== gp.price) bad.push(['Gruppe Preis', g['Gruppenschlüssel'], g['Preis (EUR)'], gp.price]);
  });
  // Protokoll: jede 'neu'-Zeile eines aktiven Imports zeigt auf eine Daten-Zeile dieses Imports (oder eine behaltene)
  const imps = env.objects('Importe');
  const active = {};
  imps.forEach((i) => { if (i.Status === 'aktiv') active[i.Nr] = true; });
  env.proto().forEach((p) => {
    if (p.Typ === 'neu' && active[p['Import-Nr']] && p.Status === 'erledigt') {
      const r = raw.find((x) => String(x[COL.eid]) === String(p['Eintrag-ID']));
      if (!r) bad.push(['neu ohne Zeile', p['Eintrag-ID']]);
      else if (r[COL.origin] !== 'Import ' + p['Import-Nr'] && r[COL.origin] !== 'Hand') bad.push(['neu: Herkunft', r[COL.origin]]);
    }
  });
  if (env.lock.nested !== 0 || env.lock.depth !== 0) bad.push(['Sperre', env.lock]);
  if (opts.noRun !== false && env.props.IMPORT_RUN) bad.push(['IMPORT_RUN noch gesetzt', env.props.IMPORT_RUN]);
  if (opts.verlauf) {
    const v = J(env.values('Verlauf'));
    if (v !== opts.verlauf) bad.push(['Verlauf verändert']);
  }
  if (opts.hand) {
    const h = snapRows(env, (d) => opts.hand.eids.indexOf(d.eid) >= 0);
    if (h !== opts.hand.snap) bad.push(['Karten von Hand verändert', h]);
  }
  t.ok(label + ': Blätter stimmen', bad.length === 0, bad);
}

function draft(env) { try { return JSON.parse(env.props.IMPORT_DRAFT || 'null'); } catch (e) { return 'kaputt'; } }
function importe(env) { return env.objects('Importe'); }
function rowsOf(env, nr) { return env.data().filter((d) => d.origin === 'Import ' + nr); }
function protoOf(env, nr) { return env.proto().filter((p) => Number(p['Import-Nr']) === nr); }
function byName(list, name) { return list.find((d) => d.name === name); }

/* ===========================================================================
 * Vertrag: jedes google.script.run aus ImportUi.html gibt es öffentlich und liefert, was das UI liest
 * ========================================================================= */

/** Pfade, die ImportUi.html liest ('a[].b' = jedes Element). Leere Listen sind erlaubt. */
const SHAPES = {
  importSetsVorbelegen: [], // Text für die Meldung
  importState: ['draft', 'imports', 'busy', 'driveService', 'templates', 'needsSetup'],
  importOpenSource: ['sourceId', 'sourceName', 'kind', 'tabs[].name', 'tabs[].rows', 'tabs[].cols', 'tabs[].hidden'],
  importSelectTab: ['tab', 'nRows', 'nCols', 'sample', 'guess.headerRow', 'guess.firstRow', 'guess.cols', 'templates', 'suggested', 'cfg',
    'templates[].name', 'templates[].mode', 'templates[].cfg', 'templates[].matches'],
  importListTemplates: ['[].name', '[].mode', '[].cfg'],
  importPreviewRows: ['rows', 'total', 'importable', 'skippedCounts.summe', 'skippedCounts.leer', 'skippedCounts.nichtAngehakt',
    'rows[].srcRows', 'rows[].fields.name', 'rows[].fields.nameClean', 'rows[].fields.number', 'rows[].fields.set', 'rows[].fields.qty',
    'rows[].fields.variant', 'rows[].fields.cond', 'rows[].fields.lang', 'rows[].fields.version', 'rows[].fields.price',
    'rows[].fields.priceDate', 'rows[].fields.cmUrl', 'rows[].fields.tcgdexId', 'rows[].extras', 'rows[].skip'],
  importSaveTemplate: ['name', 'mode'],
  importStartRecognition: ['total', 'skipped.summe', 'skipped.leer', 'skipped.nichtAngehakt'],
  importRecognizeStep: ['done', 'pos', 'total', 'counts.eindeutig', 'counts.unklar', 'counts.nichtGefunden', 'counts.uebersprungen', 'counts.bekannt'],
  importReviewList: ['items', 'open', 'total', 'items[].fp', 'items[].srcRows', 'items[].values.name', 'items[].values.nameClean',
    'items[].values.number', 'items[].values.set', 'items[].values.raw', 'items[].qty', 'items[].status', 'items[].reason',
    'items[].candidates', 'items[].decision', 'items[].prefilled', 'items[].confirmed', 'items[].card',
    'items[].candidates[].id', 'items[].candidates[].lang', 'items[].candidates[].name', 'items[].candidates[].setName',
    'items[].candidates[].localId', 'items[].candidates[].setSize', 'items[].candidates[].image'],
  importReviewDecide: ['item.fp', 'item.decision', 'item.confirmed', 'item.prefilled', 'item.card', 'item.values', 'item.candidates', 'open'],
  importReviewSearch: ['stage', 'cards', 'notes', 'cards[].id', 'cards[].lang', 'cards[].name', 'cards[].setName', 'cards[].localId', 'cards[].image'],
  getCardBySetNumber: ['id', 'lang', 'name', 'setName', 'localId', 'setSize', 'image'],
  importReviewAcceptPrefilled: ['open'],
  importBuildPreview: ['mode', 'modeLabel', 'sourceName', 'tab', 'counts.neu', 'counts.mehr', 'counts.weniger', 'counts.uebersprungen',
    'counts.pruefOffen', 'counts.bekannt', 'valueChange', 'newColumns', 'handMatch', 'removedByYou', 'added', 'decreased', 'skipped',
    'handMatch[].fp', 'handMatch[].title', 'handMatch[].sub', 'handMatch[].image', 'handMatch[].qty', 'handMatch[].handCount', 'handMatch[].choice',
    'removedByYou[].fp', 'removedByYou[].title', 'removedByYou[].sub', 'removedByYou[].image', 'removedByYou[].qty',
    'added[].fp', 'added[].title', 'added[].sub', 'added[].image', 'added[].qty', 'added[].newGroup',
    'decreased[].title', 'decreased[].sub', 'decreased[].qty', 'decreased[].fromImport', 'skipped[].title', 'skipped[].reason'],
  importCommit: ['nr', 'message'],
  importResume: ['nr', 'message'],
  importList: ['[].nr', '[].date', '[].sourceName', '[].tab', '[].mode', '[].status', '[].counts.neu', '[].counts.mehr',
    '[].counts.weniger', '[].counts.uebersprungen', '[].counts.pruefOffen', '[].valueChange', '[].undoneAt'],
  importUndoPreview: ['nr', 'sourceName', 'counts.loeschen', 'counts.zurueck', 'counts.fehlt', 'changed', 'laterSameSource', 'newTerms',
    'changed[].eid', 'changed[].title', 'changed[].sub', 'changed[].count', 'changed[].changes'],
  importUndo: ['message'],
  importDiscardDraft: [],
  setViewExtras: ['viewExtras'],
  getUiConfig: ['extras', 'viewExtras', 'langs', 'conditions', 'versions']
};

/** Fehlende Pfade in einem Ergebnis. */
function missingPaths(res, paths) {
  const miss = [];
  paths.forEach((p) => {
    const parts = p.split('.');
    const walk = (o, i, where) => {
      if (i >= parts.length) return;
      let k = parts[i];
      let each = false;
      if (/\[\]$/.test(k)) { each = true; k = k.slice(0, -2); }
      const v = k === '' ? o : (o == null ? undefined : o[k]);
      if (v === undefined) { miss.push(where + (k ? '.' + k : '')); return; }
      if (each) {
        if (!Array.isArray(v)) { miss.push(where + '.' + k + ' (keine Liste)'); return; }
        v.forEach((x, j) => walk(x, i + 1, where + '.' + k + '[' + j + ']'));
      } else walk(v, i + 1, where + '.' + k);
    };
    walk(res, 0, '');
  });
  return miss;
}

/* ===========================================================================
 * Ablauf
 * ========================================================================= */

(async () => {
  const env = H.createEnv({ db: makeDb() });
  const c = env.ctx;
  addV1Data(env);
  c.setupAll_();
  addXlsx(env);
  const VERLAUF = J(env.values('Verlauf'));
  const handRows0 = env.data().filter((d) => d.origin === 'Hand');
  const HAND = { eids: handRows0.map((d) => d.eid), snap: snapRows(env, (d) => d.origin === 'Hand') };
  t.eq('Ausgang: drei Karten von Hand nach der Einrichtung', handRows0.map((d) => [d.name, d.count, d.cond]),
    [['Arktos', 1, 'NM'], ['Celebi', 1, ''], ['Nachtara', 2, 'LP']]);
  checkSheets(env, 'Ausgang', { verlauf: VERLAUF, hand: HAND });
  // Uhr der Erkennung: jede Abfrage eine Minute später, damit die Erkennung in mehreren Schritten läuft
  let clock = 0;
  env.ctx.erNow_ = () => (clock += 60000);

  /* ---------------- 0. Statischer Vertrag ---------------- */
  t.section('0. Vertrag ImportUi.html -> Server');
  const uiCalls = [...new Set([...IMPORTUI_RAW.matchAll(/call\(\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
    .concat([...IMPORTUI_RAW.matchAll(/impAsk\(\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1])))].sort();
  t.ok('ImportUi.html ruft ' + uiCalls.length + ' Serverfunktionen auf', uiCalls.length >= 20, uiCalls);
  const notPublic = uiCalls.filter((fn) => /_$/.test(fn) || typeof c[fn] !== 'function');
  t.ok('jede davon gibt es öffentlich auf dem Server', notPublic.length === 0, notPublic);
  const noShape = uiCalls.filter((fn) => !SHAPES[fn]);
  t.ok('für jede ist festgehalten, welche Felder das UI liest', noShape.length === 0, noShape);
  t.ok('ImportUi.html ohne Gedankenstrich', IMPORTUI_RAW.indexOf('—') < 0);

  /* ---------------- 1. Seitenleiste öffnen, Import-Tab ---------------- */
  t.section('1. Seitenleiste, Import-Tab, Einstellungen');
  let E = boot(env, 'sidebar', 'Seitenleiste');
  await E.settle();
  t.ok('Start lädt nur Set-Vorschläge, getUiConfig, getUpdateInfo, getFileVersions und die Sammlung', J(E.callLog.map((x) => x.fn).sort()) === J(['getCollection', 'getFileVersions', 'getSetSuggestions', 'getUiConfig', 'getUpdateInfo']), E.callLog.map((x) => x.fn));
  t.ok('Import-Tab sichtbar', !E.$('tabImport').classList.contains('hidden'));
  t.ok('Import-Bereich noch versteckt, kein importState', E.$('paneImport').classList.contains('hidden') && E.calls('importState').length === 0);
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Import-Tab: importState geladen', E.calls('importState').length === 1 && !E.$('paneImport').classList.contains('hidden'));
  t.ok('Übersicht: keine Importe, Knopf „Neuer Import“', /Noch keine Importe/.test(E.text()) && !!E.btn(E.main(), 'Neuer Import'), E.text().slice(0, 300));
  t.ok('Übersicht: kein Banner, kein Hinweis auf fehlende Blätter', !/Import in Arbeit/.test(E.text()) && !/Import-Blätter fehlen/.test(E.text()));
  eyes(E, 'Übersicht leer');
  // Einstellungen: Set-Zuordnung vorbelegen (füllt die Kürzel für "DS 62", "HGSS 01" …)
  await E.clickSettle(E.btn(E.main(), 'Einstellungen ▼'), 'Einstellungen');
  t.ok('Einstellungen: noch keine Zusatzspalten', /Noch keine Zusatzspalten/.test(E.$('impVx').textContent), E.$('impVx').textContent);
  await E.clickSettle(E.btn(E.main(), 'Set-Zuordnung vorbelegen'), 'Set-Zuordnung vorbelegen');
  t.ok('Set-Zuordnung vorbelegt: Meldung', /^\d+ Sets vorbelegt, \d+ davon mit Kürzel\./.test(E.$('impSetMsg').textContent.trim()), E.$('impSetMsg').textContent);
  const cmRows = env.objects('Import-Sets');
  t.ok('Blatt Import-Sets mit Kürzeln (DS, UL, HGSS)', ['DS', 'UL', 'HGSS'].every((k) => cmRows.some((r) => r['Kürzel'] === k)), cmRows.map((r) => r['Kürzel']));
  eyes(E, 'Einstellungen');
  await E.clickSettle(E.btn(E.main(), 'Einstellungen ▲'), 'Einstellungen zu');
  checkSheets(env, 'Nach Einstellungen', { verlauf: VERLAUF, hand: HAND });

  /* ---------------- 2. Assistent ---------------- */
  t.section('2. Assistent: Quelle, Tab, Vorlage, Form, Zuordnung');
  E.click(E.btn(E.main(), 'Neuer Import'), 'Neuer Import');
  t.ok('Schritt 1: Quelle', E.step() === 1 && !!E.$('impUrl') && /Drive API/.test(E.text()), E.text().slice(0, 300));
  eyes(E, 'Schritt 1');
  E.click(E.btn(E.main(), 'Weiter'));
  t.ok('Schritt 1 ohne Link: Hinweis, kein Serveraufruf', /Bitte füge den Link/.test(E.act()) && E.pending.length === 0, E.act());
  E.type(E.$('impUrl'), 'https://example.com/irgendwas');
  await E.next();
  t.ok('Schritt 1 mit fremdem Link: deutscher Fehler', E.step() === 1 && /Den Link kenne ich nicht/.test(E.act()), E.act());
  E.type(E.$('impUrl'), XLSX_URL);
  const copies0 = env.driveCopies.length;
  await E.next();
  t.ok('Schritt 2: Tab-Liste der .xlsx', E.step() === 2 && /Datei: Pokemon Ordner\.xlsx \(\.xlsx\)/.test(E.text()), E.text().slice(0, 400));
  t.ok('Schritt 2: Tabellenblatt1 vorausgewählt, alle drei Tabs mit Zeilen', E.radioVal('impTab') === 'Tabellenblatt1' &&
    /Tabellenblatt1\s*22 Zeilen, 7 Spalten/.test(E.main().textContent.replace(/\s+/g, ' ')) && /Pokedex/.test(E.text()) && /Bulk \+ Sammlung/.test(E.text()), E.text().slice(0, 500));
  t.ok('Server: temporäre Kopie angelegt, Entwurf Stufe „tab“', env.driveCopies.length === copies0 + 1 && draft(env).stage === 'tab' && draft(env).kind === 'xlsx', draft(env));
  const tmp1 = env.driveCopies[env.driveCopies.length - 1].to;
  eyes(E, 'Schritt 2');
  await E.next();
  t.ok('Schritt 3: Vorlage, keine vorhanden', E.step() === 3 && E.$('impTpl').value === '' && /Noch keine Vorlagen/.test(E.text()), E.text().slice(0, 400));
  t.ok('Schritt 3: Tab-Größe 22 Zeilen, 7 Spalten', /Tab „Tabellenblatt1“: 22 Zeilen, 7 Spalten/.test(E.text()), E.text().slice(0, 300));
  t.ok('Server: Kopie im Papierkorb, Import-Quelle gefüllt, Stufe „zuordnung“', env.driveFiles[tmp1].trashed === true &&
    env.values('Import-Quelle').length === 22 && draft(env).stage === 'zuordnung', [env.driveFiles[tmp1].trashed, env.values('Import-Quelle').length, draft(env).stage]);
  eyes(E, 'Schritt 3');
  await E.next();
  t.ok('Schritt 4: Form Liste gewählt', E.step() === 4 && E.radioVal('impForm') === 'liste', E.radioVal('impForm'));
  eyes(E, 'Schritt 4');
  await E.next();
  t.ok('Schritt 5: Zuordnung', E.step() === 5 && E.$('impHr').value === '1' && E.$('impFr').value === '2' && E.$('impLr').value === '');
  const guessed = {};
  ['name', 'number', 'set', 'qty', 'variant', 'cond', 'lang', 'version', 'price', 'priceDate', 'cmLink', 'tcgdexId'].forEach((f) => { guessed[f] = E.$('impCol_' + f).value; });
  t.eq('Schritt 5: Spalten richtig geraten', guessed, { name: '0', number: '1', set: '3', qty: '-1', variant: '-1', cond: '-1', lang: '-1', version: '-1', price: '4', priceDate: '5', cmLink: '2', tcgdexId: '-1' });
  t.ok('Schritt 5: Optionen zeigen Buchstabe und Überschrift', [...E.$('impCol_name').options].some((o) => o.textContent === 'A · Karte Name') &&
    E.$('impCol_name').options[0].textContent === '– keine –', [...E.$('impCol_name').options].map((o) => o.textContent));
  t.ok('Schritt 5: keine Haken-Spalte bei einer Liste', !E.$('impCol_check'));
  t.ok('Schritt 5: Stichprobe mit Kopfzeile', !!E.main().querySelector('.imp-tbl tr.imp-hr') && /Die ersten 22 Zeilen deines Tabs/.test(E.text()), E.text().slice(-300));
  eyes(E, 'Schritt 5');
  await E.next();
  t.section('2b. Feste Werte, Zusatzspalte, Vorschau der ersten zehn Zeilen');
  t.ok('Schritt 6: Feste Werte (Sprache DE)', E.step() === 6 && E.$('impFxLang').value === 'DE' && E.$('impFxCond').value === '' && E.$('impFxVar').value === '');
  const exBoxes = [...E.main().querySelectorAll('.box')].filter((b) => /Spalte G/.test(b.textContent));
  t.ok('Schritt 6: Spalte G (Spalte 1) als Zusatzspalte angeboten, nicht angehakt', exBoxes.length === 1 && /z\. B\. „Ordner A“/.test(exBoxes[0].textContent) &&
    !E.main().querySelector('input[data-k="ex.c6.take"]').checked, E.text().slice(0, 900));
  E.check(E.main().querySelector('input[data-k="ex.c6.take"]'), true);
  E.type(E.main().querySelector('input[data-k="ex.c6.name"]'), 'Zustand');
  await E.next();
  t.ok('Schritt 6: fester Spaltenname wird abgelehnt', E.step() === 6 && /„Zustand“ gibt es im Blatt „Daten“ schon als feste Spalte/.test(E.act()), E.act());
  E.type(E.main().querySelector('input[data-k="ex.c6.name"]'), 'Ordner');
  E.check(E.main().querySelector('input[data-k="ex.c6.show"]'), true);
  eyes(E, 'Schritt 6');
  await E.next();
  t.ok('Schritt 7: Vorschau geladen', E.step() === 7 && E.calls('importPreviewRows').length === 1 && !!E.$('impPrev').querySelector('table'), E.text().slice(0, 300));
  const prevArgs = E.lastCall('importPreviewRows').args[0];
  t.eq('Schritt 7: an den Server geht die Zuordnung mit Zusatzspalte', [prevArgs.form, prevArgs.cols.name, prevArgs.cols.cmLink, prevArgs.extras],
    ['liste', 0, 2, [{ col: 6, name: 'Ordner', show: true }]]);
  const prevRows = [...E.$('impPrev').querySelectorAll('tr')].slice(1).map((tr) => [...tr.children].map((td) => td.textContent));
  t.eq('Schritt 7: zehn Zeilen', prevRows.length, 10);
  t.ok('Schritt 7: Zählung über alle Zeilen', /21 Zeilen gelesen, davon 19 mit Karten\. Übersprungen: 1 Summenzeile, 1 leer\./.test(E.$('impPrev').textContent), E.$('impPrev').textContent.slice(0, 200));
  const pika = prevRows.find((r) => r[1] === 'Pikachu');
  t.ok('Schritt 7: Pikachu mit Sonderversion, Preis, Link und Ordner', !!pika && /Snowflake/.test(pika[5]) && /12,00\s€/.test(pika[5]) && /Cardmarket-Link/.test(pika[5]) && /Ordner: Ordner B/.test(pika[5]), pika);
  const gengar = prevRows.find((r) => r[1] === 'Gengar');
  t.ok('Schritt 7: Gengar Rev Holo -> Reverse Holo', !!gengar && /Reverse Holo/.test(gengar[5]), gengar);
  eyes(E, 'Schritt 7');
  t.ok('Server: Einstellungen im Entwurf gemerkt (für Weitermachen)', draft(env).cfg && draft(env).cfg.extras.length === 1 && draft(env).cfg.extras[0].name === 'Ordner', draft(env).cfg);

  /* ---------------- 3. Schließen mitten im Assistenten, Weitermachen ---------------- */
  t.section('3. Seitenleiste mitten im Assistenten geschlossen, Banner, Weitermachen');
  E.close();
  E = boot(env, 'sidebar', 'Seitenleiste 2');
  await E.settle();
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Banner „Import in Arbeit“ mit Datei, Tab und Stand', /Import in Arbeit: Pokemon Ordner\.xlsx · Tab Tabellenblatt1/.test(E.text()) &&
    /Stand: Spalten zuordnen · Nur Neues/.test(E.text()) && !!E.btn(E.main(), 'Weitermachen') && !!E.btn(E.main(), 'Verwerfen'), E.text().slice(0, 400));
  eyes(E, 'Banner Assistent');
  const copies1 = env.driveCopies.length;
  await E.clickSettle(E.btn(E.main(), 'Weitermachen'), 'Weitermachen');
  t.ok('Weitermachen: Schritt 3, keine neue Kopie der .xlsx', E.step() === 3 && env.driveCopies.length === copies1, [E.step(), env.driveCopies.length - copies1]);
  await E.next(); await E.next(); await E.next();
  t.ok('Weitermachen: Zuordnung und Zusatzspalte sind noch da', E.step() === 6 && E.main().querySelector('input[data-k="ex.c6.take"]').checked &&
    E.main().querySelector('input[data-k="ex.c6.name"]').value === 'Ordner' && E.main().querySelector('input[data-k="ex.c6.show"]').checked);
  await E.next();
  t.ok('Weitermachen: Vorschau wieder da', E.step() === 7 && !!E.$('impPrev').querySelector('table'));
  await E.next();
  t.ok('Schritt 8: Name der Vorlage und Modus Nur Neues', E.step() === 8 && E.$('impSaveName').value === 'Pokemon Ordner.xlsx · Tabellenblatt1' && E.radioVal('impMode') === 'neu',
    [E.$('impSaveName').value, E.radioVal('impMode')]);
  t.ok('Schritt 8: Modi mit Erklärung', /Nur Neues \(Standard\)/.test(E.text()) && /Alles addieren/.test(E.text()) && /Mit Quelle abgleichen/.test(E.text()));
  eyes(E, 'Schritt 8');

  /* ---------------- 4. Erkennung (mehrere Schritte), Schließen, Weitermachen ---------------- */
  t.section('4. Vorlage speichern, Erkennung in Schritten');
  E.click(E.btn(E.main(), 'Erkennung starten'), 'Erkennung starten');
  await E.serveFn('importSaveTemplate');
  await E.serveFn('importStartRecognition');
  const tpl = env.objects('Import-Vorlagen');
  t.ok('Vorlage gespeichert (mit Modus und Kopfzeilen)', tpl.length === 1 && tpl[0].Name === 'Pokemon Ordner.xlsx · Tabellenblatt1' &&
    /"mode":"neu"/.test(tpl[0].Konfiguration) && /karte name\|setnummer\|cardmarket/.test(tpl[0].Kopfzeilen), tpl);
  t.ok('Erkennung: Prüfung angelegt', env.objects('Import-Prüfung').length === N_ENTRIES && draft(env).stage === 'erkennung', [env.objects('Import-Prüfung').length, draft(env).stage]);
  t.ok('Erkennung: Fortschritt 0 von ' + N_ENTRIES, /0 von 18 Einträgen erkannt/.test(E.text()) && /In der Tabelle übersprungen: 1 Summenzeile, 1 leer/.test(E.text()), E.text().slice(0, 400));
  await E.serveFn('importRecognizeStep');
  const pos1 = draft(env).recognizePos;
  t.ok('Erkennung: erster Schritt schafft nur einen Teil', pos1 > 0 && pos1 < N_ENTRIES && new RegExp(pos1 + ' von 18 Einträgen erkannt').test(E.text()) &&
    E.pending.some((p) => p.fn === 'importRecognizeStep'), [pos1, E.text().slice(0, 300)]);
  const bar = E.main().querySelector('.imp-bar');
  t.ok('Erkennung: Balken zeigt den Fortschritt', bar && Number(bar.getAttribute('aria-valuenow')) === Math.round(pos1 * 100 / N_ENTRIES));
  t.ok('Erkennung: Zwischenstand der Zählung', /\d+ eindeutig, \d+ unklar, \d+ nicht gefunden/.test(E.text()), E.text().slice(0, 400));
  eyes(E, 'Erkennung');
  await E.serveFn('importRecognizeStep');
  const pos2 = draft(env).recognizePos;
  t.ok('Erkennung: zweiter Schritt', pos2 > pos1 && pos2 < N_ENTRIES, [pos1, pos2]);
  // Seitenleiste zu, während die Erkennung läuft
  E.close();
  E = boot(env, 'sidebar', 'Seitenleiste 3');
  await E.settle();
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Banner: Stand Erkennung mit Position', new RegExp('Stand: Erkennung \\(' + pos2 + ' von 18\\)').test(E.text()), E.text().slice(0, 300));
  eyes(E, 'Banner Erkennung');
  E.click(E.btn(E.main(), 'Weitermachen'), 'Weitermachen');
  let guardN = 0;
  while (E.pending.some((p) => p.fn === 'importRecognizeStep') && guardN++ < 30) await E.serveFn('importRecognizeStep');
  t.ok('Erkennung in mehreren Schritten fertig', E.calls('importRecognizeStep').length >= 2 && draft(env).stage === 'pruefung', [E.calls('importRecognizeStep').length, draft(env).stage]);
  await E.settle();
  const lastStep = E.lastCall('importRecognizeStep').res;
  t.eq('Erkennung: Zählung', lastStep.counts, { eindeutig: 14, unklar: 1, nichtGefunden: 3, uebersprungen: 0, bekannt: 0 });
  checkSheets(env, 'Nach der Erkennung', { verlauf: VERLAUF, hand: HAND });

  /* ---------------- 5. Prüfliste ---------------- */
  t.section('5. Prüfliste: Kandidat, Neu suchen, freie Karte, Überspringen');
  t.ok('Prüfliste mit Meldung der Erkennung', /Erkennung fertig: 14 eindeutig, 1 unklar, 3 nicht gefunden\./.test(E.msg()) && /Prüfliste/.test(E.text()), E.msg());
  const boxes = () => [...E.main().querySelectorAll('.imp-rv')];
  const boxOf = (name) => boxes().find((b) => b.querySelector('b') && b.querySelector('b').textContent === name);
  t.eq('Prüfliste: vier Zeilen', boxes().map((b) => b.querySelector('b').textContent), ['Glurak', 'Fantasiemon', 'Feurigl', 'Tauschkarte von Tom']);
  t.ok('Prüfliste: 0 von 4 erledigt, 4 vorausgewählt', E.$('impRvProg').textContent === '0 von 4 erledigt · 4 als freie Karte vorausgewählt', E.$('impRvProg').textContent);
  // #22: Leiste mit „Weiter zur Vorschau“ oben vor der ersten Zeile, der Knopf unten bleibt
  const rvBar = E.$('impRvBar');
  t.ok('Leiste oben: Stand und Weiter zur Vorschau, vor der ersten Zeile', rvBar && rvBar.contains(E.$('impRvProg')) && !!E.btn(rvBar, 'Weiter zur Vorschau') &&
    !!(rvBar.compareDocumentPosition(boxes()[0]) & E.win.Node.DOCUMENT_POSITION_FOLLOWING) && /sticky/.test(E.win.getComputedStyle(rvBar).position));
  t.eq('Weiter zur Vorschau: oben und unten', [...E.main().querySelectorAll('button')].filter((b) => b.textContent === 'Weiter zur Vorschau').length, 2);
  t.ok('jede Zeile: als freie Karte vorausgewählt', boxes().every((b) => /Vorausgewählt: Als freie Karte/.test(b.textContent) &&
    /vorausgewählt/.test(b.querySelector('.imp-badge.last') ? b.querySelector('.imp-badge.last').textContent : '') && !b.classList.contains('imp-done') &&
    E.btn(b, 'Als freie Karte').classList.contains('imp-on')), boxes().map((b) => b.textContent.slice(0, 120)));
  t.ok('Vorauswahl: kein „Alle übernehmen“', !/Alle übernehmen/.test(E.text()));
  const gl = boxOf('Glurak');
  t.ok('Glurak: unklar mit drei Kandidaten samt Bild, Set und Nummer', /unklar/.test(gl.textContent) && gl.querySelectorAll('.tile').length === 3 &&
    [...gl.querySelectorAll('.tile')].every((x) => x.querySelector('img') && /\d/.test(x.textContent)) && /Grundset · 4\/102/.test(gl.textContent), gl.textContent);
  t.ok('Glurak: Originalwerte der Zeile', /Zeile 11 · 1 Stück/.test(gl.textContent) && /Name: Glurak/.test(gl.textContent), gl.textContent);
  const fan = boxOf('Fantasiemon');
  t.ok('Fantasiemon: nicht gefunden mit Grund', /nicht gefunden/.test(fan.textContent) && /Set „Fantasie-Set“ nicht erkannt/.test(fan.textContent), fan.textContent);
  eyes(E, 'Prüfliste');
  // Kandidat antippen
  await E.clickSettle([...boxOf('Glurak').querySelectorAll('.tile')].find((x) => /Grundset/.test(x.textContent)), 'Kachel Grundset');
  t.ok('Glurak: Grundset gewählt und erledigt', /Deine Wahl: Glurak · Grundset · 4\/102 · Holo/.test(boxOf('Glurak').textContent) &&
    !!boxOf('Glurak').querySelector('.tile.imp-chosen') && boxOf('Glurak').classList.contains('imp-done'), boxOf('Glurak').textContent);
  t.ok('Prüfliste: 1 von 4 erledigt', E.$('impRvProg').textContent === '1 von 4 erledigt · 3 als freie Karte vorausgewählt', E.$('impRvProg').textContent);
  const ans1 = env.objects('Import-Antworten');
  t.ok('Server: Antwort sofort in Import-Antworten', ans1.length === 1 && JSON.parse(ans1[0].Entscheidung).id === 'base1-4', ans1);
  // Freie Karte und Überspringen
  await E.clickSettle(E.btn(boxOf('Fantasiemon'), 'Als freie Karte'), 'Als freie Karte');
  t.ok('Fantasiemon: Als freie Karte', /Deine Wahl: Als freie Karte „Fantasiemon“/.test(boxOf('Fantasiemon').textContent), boxOf('Fantasiemon').textContent);
  await E.clickSettle(E.btn(boxOf('Tauschkarte von Tom'), 'Überspringen'), 'Überspringen');
  t.ok('Tauschkarte: Überspringen', /Deine Wahl: Überspringen/.test(boxOf('Tauschkarte von Tom').textContent));
  // Wahl aufheben und wieder setzen
  await E.clickSettle(E.btn(boxOf('Tauschkarte von Tom'), 'Wahl aufheben'), 'Wahl aufheben');
  t.ok('Wahl aufheben: wieder offen', !/Deine Wahl/.test(boxOf('Tauschkarte von Tom').textContent) && E.$('impRvProg').textContent === '2 von 4 erledigt · 1 als freie Karte vorausgewählt' &&
    env.objects('Import-Antworten').length === 2, E.$('impRvProg').textContent);
  await E.clickSettle(E.btn(boxOf('Tauschkarte von Tom'), 'Überspringen'), 'Überspringen');
  // Neu suchen: Feurigl mit Nummer -> Set-Auswahl -> Karte; dann mit richtigem Namen
  E.click(E.btn(boxOf('Feurigl'), 'Neu suchen'), 'Neu suchen');
  const fIdx = boxes().indexOf(boxOf('Feurigl'));
  t.ok('Neu suchen: Felder mit den Werten der Zeile', E.$('impRvN' + fIdx).value === 'Feurigl' && E.$('impRvNr' + fIdx).value === '61' && E.$('impRvSet' + fIdx).value === '');
  E.$('impRvN' + fIdx).closest('form').dispatchEvent(new E.win.Event('submit', { bubbles: true, cancelable: true }));
  await E.settle();
  const resEl = () => E.$('impRvRes' + fIdx);
  t.ok('Neu suchen: keine Karte, Set-Auswahl', /Wähle das Set, dann wird Nummer 61 darin gesucht/.test(resEl().textContent) && resEl().querySelectorAll('.tile.set').length >= 5, resEl().textContent.slice(0, 300));
  E.type(E.$('impRvF' + fIdx), 'Heart');
  const setTiles = [...E.$('impRvSets' + fIdx).querySelectorAll('.tile.set')];
  t.ok('Set filtern: HeartGold & SoulSilver', setTiles.length === 1 && /HeartGold & SoulSilver/.test(setTiles[0].textContent), setTiles.map((x) => x.textContent));
  await E.clickSettle(setTiles[0], 'Set-Kachel');
  t.ok('Set gewählt: Feurigel 61 als Kachel, „Anderes Set wählen“', /Feurigel/.test(resEl().textContent) && /61\/123/.test(resEl().textContent) &&
    !!E.btn(resEl(), 'Anderes Set wählen') && E.calls('getCardBySetNumber').length === 1, resEl().textContent);
  eyes(E, 'Neu suchen Set');
  E.click(E.btn(resEl(), 'Anderes Set wählen'), 'Anderes Set wählen');
  t.ok('Anderes Set wählen: wieder die Set-Auswahl', resEl().querySelectorAll('.tile.set').length >= 1);
  E.type(E.$('impRvN' + fIdx), 'Feurigel');
  E.$('impRvN' + fIdx).closest('form').dispatchEvent(new E.win.Event('submit', { bubbles: true, cancelable: true }));
  await E.settle();
  t.ok('Neu suchen mit Namen: Treffer', /Karte antippen, um sie zu wählen/.test(resEl().textContent) && resEl().querySelectorAll('.tile').length === 1, resEl().textContent.slice(0, 300));
  t.eq('Neu suchen: Server bekam Name und Nummer', E.lastCall('importReviewSearch').args[1], { name: 'Feurigel', number: '61', set: '' });
  await E.clickSettle(resEl().querySelector('.tile'), 'Treffer');
  t.ok('Feurigl: Feurigel gewählt', /Deine Wahl: Feurigel · HeartGold & SoulSilver · 61\/123/.test(boxOf('Feurigl').textContent), boxOf('Feurigl').textContent);
  t.ok('Prüfliste: 4 von 4 erledigt', E.$('impRvProg').textContent === '4 von 4 erledigt', E.$('impRvProg').textContent);
  eyes(E, 'Prüfliste erledigt');
  t.eq('Server: vier Antworten gespeichert', env.objects('Import-Antworten').map((a) => JSON.parse(a.Entscheidung).type).sort(), ['frei', 'karte', 'karte', 'skip']);

  // Schließen in der Prüfliste: Banner, Weitermachen
  E.close();
  E = boot(env, 'sidebar', 'Seitenleiste 4');
  await E.settle();
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Banner: Stand Prüfliste', /Stand: Prüfliste · Nur Neues/.test(E.text()), E.text().slice(0, 300));
  await E.clickSettle(E.btn(E.main(), 'Weitermachen'), 'Weitermachen');
  t.ok('Weitermachen: Prüfliste mit allen Entscheidungen', E.$('impRvProg') && E.$('impRvProg').textContent === '4 von 4 erledigt' &&
    boxes().every((b) => b.classList.contains('imp-done')), E.text().slice(0, 300));

  /* ---------------- 6. Vorschau ---------------- */
  t.section('6. Vorschau: von Hand erfasst, neu, übersprungen');
  await E.clickSettle(E.btn(E.main(), 'Weiter zur Vorschau'), 'Weiter zur Vorschau');
  const pv = E.lastCall('importBuildPreview').res;
  t.ok('Vorschau: Kopf mit Quelle, Tab, Modus', /Pokemon Ordner\.xlsx · Tab Tabellenblatt1 · Nur Neues/.test(E.text()), E.text().slice(0, 200));
  t.ok('Vorschau: Zählung', E.$('impPvCounts').textContent === '15 neue Karten, 1 übersprungen.', E.$('impPvCounts').textContent);
  t.ok('Vorschau: neue Zusatzspalte genannt', /Neue Zusatzspalten: Ordner/.test(E.text()));
  t.ok('Vorschau: „Schon von Hand erfasst (2)“ mit Arktos und Nachtara', /Schon von Hand erfasst \(2\)/.test(E.text()) &&
    pv.handMatch.map((h) => h.title).sort().join() === 'Arktos,Nachtara', pv.handMatch.map((h) => h.title));
  const hmNacht = pv.handMatch.findIndex((h) => h.title === 'Nachtara');
  const hmArk = pv.handMatch.findIndex((h) => h.title === 'Arktos');
  t.ok('Vorschau: Dieselbe Karte vorausgewählt', E.$('impHmS' + hmNacht).checked && E.$('impHmS' + hmArk).checked && !E.$('impHmE' + hmNacht).checked);
  t.ok('Vorschau: Nachtara mit Zahlen aus Tabelle und von Hand', /In der Tabelle: 1, von Hand: 2/.test(E.$('impHmS' + hmNacht).closest('.item').textContent), E.$('impHmS' + hmNacht).closest('.item').textContent);
  t.ok('Vorschau: Neu (15) mit Bildern', /Neu \(15\)/.test(E.text()) && /Plaudagei/.test(E.text()) && /Fantasiemon/.test(E.text()), E.text().slice(0, 1200));
  t.ok('Vorschau: Übersprungen (1) mit Grund', /Übersprungen \(1\)/.test(E.text()) && /Tauschkarte von Tom\s*Von dir übersprungen/.test(E.text()));
  t.ok('Vorschau: Wertänderung positiv', /Wert der Sammlung: \+/.test(E.text()), E.text().slice(0, 400));
  eyes(E, 'Vorschau');
  // Später weitermachen aus der Vorschau: zurück zur Übersicht, Banner „Vorschau“, Weitermachen
  const later = E.btnRe(E.main(), /^Später weitermachen$/);
  t.ok('Vorschau: „Später weitermachen“ vorhanden', !!later);
  await E.clickSettle(later, 'Später weitermachen');
  t.ok('Später weitermachen: Übersicht mit Meldung und Banner (Stand Prüfliste, alles entschieden)', /Der Import bleibt in Arbeit/.test(E.msg()) && /Stand: Prüfliste/.test(E.text()) &&
    !!E.btn(E.main(), 'Weitermachen'), E.text().slice(0, 300));
  eyes(E, 'Banner nach der Vorschau');
  await E.clickSettle(E.btn(E.main(), 'Weitermachen'), 'Weitermachen');
  t.ok('Weitermachen: Prüfliste „4 von 4 erledigt“', /4 von 4 erledigt/.test(E.text()), E.text().slice(0, 200));
  await E.clickSettle(E.btn(E.main(), 'Weiter zur Vorschau'), 'Weiter zur Vorschau');
  t.ok('Weitermachen: wieder die Vorschau', !!E.$('impPvCounts') && E.$('impPvCounts').textContent === '15 neue Karten, 1 übersprungen.', E.text().slice(0, 200));
  // Nachtara als zusätzliches Exemplar: Zahlen oben werden neu gerechnet
  const nPv = E.calls('importBuildPreview').length;
  E.click(E.$('impHmE' + hmNacht), 'Zusätzliches Exemplar');
  await E.settle();
  t.ok('Radio: Nachtara Zusätzliches Exemplar', E.$('impHmE' + hmNacht).checked && !E.$('impHmS' + hmNacht).checked);
  t.ok('Zahlen neu gerechnet mit der Wahl', E.calls('importBuildPreview').length === nPv + 1 &&
    E.lastCall('importBuildPreview').args[0].hand[pv.handMatch[hmNacht].fp] === 'extra' &&
    E.$('impPvCounts').textContent === '15 neue Karten, 1 Exemplar mehr bei Karten, die du schon hast, 1 übersprungen.', E.$('impPvCounts').textContent);
  eyes(E, 'Vorschau nach Wahl');

  /* ---------------- 7. Importieren ---------------- */
  t.section('7. Importieren');
  await E.clickSettle(E.btn(E.main(), 'Importieren'), 'Importieren');
  const commitArgs = E.lastCall('importCommit').args[0];
  t.ok('importCommit bekommt die Wahl aus der Vorschau', commitArgs.hand[pv.handMatch[hmNacht].fp] === 'extra' && commitArgs.hand[pv.handMatch[hmArk].fp] === 'same', commitArgs);
  t.ok('Import fertig: Meldung', /^Import 1 ist fertig: 17 Exemplare übernommen \(15 neue Karten, 1 mehr bei vorhandenen\)\. Wert \+/.test(E.msg()), E.msg());
  t.ok('Liste zeigt Import 1 aktiv', E.main().querySelectorAll('.imp-imp').length === 1 && /Import 1/.test(E.$('impImp0').textContent) &&
    /aktiv/.test(E.$('impImp0').textContent) && /15 neu, 1 mehr, 1 übersprungen/.test(E.$('impImp0').textContent) && !!E.btn(E.$('impImp0'), 'Zurücknehmen'), E.$('impImp0').textContent);
  t.ok('Liste: Datum deutsch, Quelle, Tab, Modus', /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/.test(E.$('impImp0').textContent) && /Pokemon Ordner\.xlsx · Tab Tabellenblatt1 · Nur Neues/.test(E.$('impImp0').textContent), E.$('impImp0').textContent);
  t.ok('kein Banner mehr', !/Import in Arbeit/.test(E.text()));
  eyes(E, 'Liste nach Import');
  const imp1 = importe(env);
  t.eq('Importe: Nr, Quelle, Modus, Status, Zahlen', imp1.map((i) => [i.Nr, i.Quelle, i['Quelle-ID'], i.Tab, i.Modus, i.Status, i.Neu, i.Mehr, i['Übersprungen']]),
    [[1, XLSX_NAME, XLSX_ID, 'Tabellenblatt1', 'Nur Neues', 'aktiv', 15, 1, 1]]);
  const r1 = rowsOf(env, 1);
  t.eq('Daten: 16 Zeilen aus Import 1 (15 neue Karten, Nachtara zusätzlich)', r1.length, 16);
  t.ok('Daten: Hundemon 2×, Snowflake, Reverse, Promo-Preis', byName(r1, 'Hundemon').count === 2 && byName(r1, 'Pikachu').version === 'Snowflake' &&
    byName(r1, 'Gengar').variant === 'reverse' && byName(r1, 'Starmie').variant === 'reverse' && byName(r1, 'Plaudagei').ownPrice === 1.1 &&
    byName(r1, 'Plaudagei').ownPriceDate === '2026-09-28', r1.map((d) => [d.name, d.count, d.variant, d.version, d.ownPrice]));
  t.ok('Daten: Fantasiemon frei mit eigenem Preis', byName(r1, 'Fantasiemon').source === 'frei' && byName(r1, 'Fantasiemon').ownPrice === 5);
  t.ok('Daten: Kramurx über den verlinkten Namen erkannt', byName(r1, 'Kramurx').id === 'hgss2-40', byName(r1, 'Kramurx'));
  t.ok('Daten: Zusatzspalte Ordner', byName(r1, 'Despotar').extras.Ordner === 'Ordner A' && byName(r1, 'Glurak').extras.Ordner === 'Ordner C' && byName(r1, 'Gengar').extras.Ordner === '');
  t.ok('Daten: Nachtara als zusätzliches Exemplar, Arktos nicht doppelt', byName(r1, 'Nachtara').count === 1 && !byName(r1, 'Arktos'));
  t.ok('Protokoll: gleich für Arktos, spalte Ordner', protoOf(env, 1).some((p) => p.Typ === 'gleich' && JSON.parse(p.Daten).title === 'Arktos') &&
    protoOf(env, 1).some((p) => p.Typ === 'spalte' && /Ordner/.test(p.Daten)) && protoOf(env, 1).every((p) => p.Status === 'erledigt'), protoOf(env, 1).map((p) => [p.Typ, p.Status]));
  t.ok('Sammlung zeigt Ordner (VIEW_EXTRAS, Gruppen, Kopfzeile)', J(JSON.parse(env.setting('VIEW_EXTRAS') || '[]')) === J(['Ordner']) &&
    env.values('Gruppen')[0].indexOf('Ordner') >= 0 && env.values('Sammlung').some((r) => r.indexOf('Ordner') >= 0));
  t.ok('Entwurf und Import-Quelle/-Prüfung geleert', !env.props.IMPORT_DRAFT && env.values('Import-Quelle').length === 0 && env.objects('Import-Prüfung').length === 0);
  t.ok('getUiConfig neu geladen: Ordner bekannt', E.win.UI_CONFIG.extras.indexOf('Ordner') >= 0 && E.win.UI_CONFIG.versions.indexOf('Snowflake') >= 0, E.win.UI_CONFIG);
  checkSheets(env, 'Nach Import 1', { verlauf: VERLAUF, hand: HAND });

  /* ---------------- 8. Sammlung ---------------- */
  t.section('8. Sammlung: Import-Zeilen, Zusatzwert, Auswahl bei −1, Bearbeiten');
  await E.clickSettle(E.$('tabColl'), 'Tab Sammlung');
  const gIdx = (name) => E.win.state.groups.findIndex((g) => g.name === name);
  const des = gIdx('Despotar');
  t.ok('Sammlung: Despotar da', des >= 0);
  E.click(E.$('gh' + des).querySelector('.info'), 'Despotar aufklappen');
  const desRows = E.$('gr' + des).textContent.replace(/\s+/g, ' ');
  t.ok('Despotar: Zeile „1× DE · Pokemon Ordner.xlsx, Import 1“ mit Ordner', /1× DE · Pokemon Ordner\.xlsx, Import 1/.test(desRows) && /Ordner: Ordner A/.test(desRows), desRows);
  const nac = gIdx('Nachtara');
  t.ok('Nachtara: Gruppe mit Hand- und Import-Zeile', E.win.state.groups[nac].rows.length === 2 && /1× DE, 2× DE LP/.test(E.$('gh' + nac).textContent), E.$('gh' + nac).textContent);
  E.click(E.btn(E.$('gh' + nac), '−1'), 'Nachtara −1');
  const chooser = E.$('gc' + nac);
  const opts = [...chooser.querySelectorAll('button.opt')].map((b) => b.textContent);
  t.ok('−1: Auswahl „Welches Exemplar?“ mit Hand und Import', /Welches Exemplar\?/.test(chooser.textContent) &&
    opts.indexOf('2× DE LP · von Hand') >= 0 && opts.indexOf('1× DE · ' + ORIGIN_LABEL + '1') >= 0 && opts.indexOf('Abbrechen') >= 0, opts);
  await E.clickSettle([...chooser.querySelectorAll('button.opt')].find((b) => /Import 1/.test(b.textContent)), 'Import-Exemplar');
  const nacImp = rowsOf(env, 1).find((d) => d.name === 'Nachtara');
  t.ok('−1 auf das Import-Exemplar: Anzahl 0, „handentfernt“ protokolliert, Hand-Zeile unverändert', nacImp.count === 0 &&
    env.proto().some((p) => p.Typ === 'handentfernt' && Number(p['Import-Nr']) === 1 && Number(p.Menge) === 1) &&
    env.data().find((d) => d.origin === 'Hand' && d.name === 'Nachtara').count === 2, [nacImp.count]);
  E.win.__advance(6000); // Rückgängig verfällt
  // Bearbeiten: Despotar aus dem Import bekommt Zustand LP (wird beim Zurücknehmen „von Hand geändert“)
  const desJ = E.win.state.groups[des].rows.findIndex((r) => r.origin === 'Import 1');
  E.click(E.btnRe(E.$('gr' + des), /^Bearbeiten$/), 'Bearbeiten');
  t.ok('Bearbeiten: Feld für Ordner', /Ordner/.test(E.$('ge' + des).textContent) && desJ >= 0, E.$('ge' + des).textContent);
  eyes(E, 'Sammlung mit Import-Zeilen', E.$('paneColl'));
  E.pick(E.$('eCond' + des), 'LP');
  await E.clickSettle(E.btn(E.$('ge' + des), 'Speichern'), 'Speichern');
  t.ok('Bearbeiten: gespeichert, ohne die Liste neu zu laden', rowsOf(env, 1).find((d) => d.name === 'Despotar').cond === 'LP' &&
    !/speichert/.test(E.$('gh' + des).textContent) && /1× DE LP · Pokemon Ordner\.xlsx, Import 1/.test(E.$('gr' + des).textContent), E.$('gr' + des).textContent);
  // beide Änderungen stehen gleich in Gruppen und Sammlung (Formeln, #43), ohne Leiste „Einsortieren“
  t.ok('keine Leiste „Einsortieren“', !E.$('sortBar'));
  checkSheets(env, 'Nach der Sammlung', { verlauf: VERLAUF });

  /* ---------------- 9. Zurücknehmen ---------------- */
  t.section('9. Zurücknehmen mit geänderter Zeile');
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Import-Tab: Übersicht neu geladen', E.calls('importState').length >= 2 && /Import 1/.test(E.text()));
  // Einstellungen: Zusatzspalte Ordner in der Sammlung aus- und wieder einblenden (setViewExtras)
  await E.clickSettle(E.btn(E.main(), 'Einstellungen ▼'), 'Einstellungen');
  t.ok('Einstellungen: Ordner angehakt', !!E.$('impVx0') && E.$('impVx0').checked && /Ordner/.test(E.$('impVx').textContent), E.$('impVx').textContent);
  E.check(E.$('impVx0'), false);
  await E.clickSettle(E.btn(E.$('impVx'), 'Anzeige speichern'), 'Anzeige speichern');
  t.ok('Anzeige ohne Ordner gespeichert', /Gespeichert\. Die Sammlung zeigt keine Zusatzspalten\./.test(E.$('impSetMsg').textContent) &&
    J(JSON.parse(env.setting('VIEW_EXTRAS') || '[]')) === '[]' && env.values('Gruppen')[0].indexOf('Ordner') < 0, [E.$('impSetMsg').textContent, env.setting('VIEW_EXTRAS')]);
  E.check(E.$('impVx0'), true);
  await E.clickSettle(E.btn(E.$('impVx'), 'Anzeige speichern'), 'Anzeige speichern');
  t.ok('Anzeige mit Ordner gespeichert', /Gespeichert\. Die Sammlung zeigt jetzt: Ordner\./.test(E.$('impSetMsg').textContent) &&
    J(JSON.parse(env.setting('VIEW_EXTRAS') || '[]')) === J(['Ordner']) && env.values('Gruppen')[0].indexOf('Ordner') >= 0, [E.$('impSetMsg').textContent, env.setting('VIEW_EXTRAS')]);
  eyes(E, 'Einstellungen nach Import');
  checkSheets(env, 'Nach Anzeige speichern', { verlauf: VERLAUF });
  await E.clickSettle(E.btn(E.$('impImp0'), 'Zurücknehmen'), 'Zurücknehmen');
  t.ok('Zurücknehmen: Überschrift und Quelle', /Import 1 zurücknehmen/.test(E.text()) && /Pokemon Ordner\.xlsx/.test(E.text()));
  t.ok('Zurücknehmen: Zählung', E.$('impUdText').textContent === '15 Einträge werden gelöscht, 1 von Hand geänderter zur Entscheidung.', E.$('impUdText').textContent);
  t.ok('Zurücknehmen: Despotar mit Änderung', /Von Hand geändert \(1\)/.test(E.text()) && /Despotar/.test(E.text()) && /Geändert: Zustand ohne → LP/.test(E.text()), E.text().slice(0, 900));
  t.ok('Zurücknehmen: nichts vorausgewählt, Knopf gesperrt', !E.$('impUdK0').checked && !E.$('impUdR0').checked && E.$('impUdGo').disabled &&
    /Noch 1 zu entscheiden/.test(E.$('impUdHint').textContent));
  eyes(E, 'Zurücknehmen');
  E.click(E.$('impUdGo'));
  await E.settle();
  t.ok('Gesperrter Knopf ruft nichts auf', E.calls('importUndo').length === 0);
  E.click(E.$('impUdR0'));
  t.ok('Entfernen gewählt: Knopf frei', !E.$('impUdGo').disabled && E.$('impUdHint').textContent === '');
  E.click(E.$('impUdK0'));
  t.ok('Behalten gewählt: Knopf frei', !E.$('impUdGo').disabled && E.$('impUdK0').checked);
  const despEid = rowsOf(env, 1).find((d) => d.name === 'Despotar').eid;
  await E.clickSettle(E.$('impUdGo'), 'Zurücknehmen');
  t.eq('importUndo bekommt die Entscheidung', E.lastCall('importUndo').args, [1, { [despEid]: 'keep' }]);
  t.ok('Zurückgenommen: Meldung', /^Import 1 ist zurückgenommen: 15 Einträge gelöscht, 1 behalten \(jetzt von Hand\)\./.test(E.msg()), E.msg());
  t.ok('Liste: zurückgenommen mit Datum, kein Knopf', /zurückgenommen/.test(E.$('impImp0').textContent) && /zurückgenommen am \d{2}\.\d{2}\.\d{4}/.test(E.$('impImp0').textContent) &&
    !E.$('impImp0').querySelector('button'), E.$('impImp0').textContent);
  eyes(E, 'Liste nach Zurücknehmen');
  t.ok('Daten: keine Zeile aus Import 1, Despotar jetzt von Hand mit LP und Ordner', rowsOf(env, 1).length === 0 &&
    env.data().filter((d) => d.origin === 'Hand').map((d) => d.name).sort().join() === 'Arktos,Celebi,Despotar,Nachtara' &&
    env.data().find((d) => d.name === 'Despotar').cond === 'LP' && env.data().find((d) => d.name === 'Despotar').extras.Ordner === 'Ordner A');
  t.ok('Protokoll: „handentfernt“ bleibt', env.proto().some((p) => p.Typ === 'handentfernt'));
  t.ok('Zusatzspalte bleibt (Despotar hat einen Wert)', env.run('extraNames_()').indexOf('Ordner') >= 0);
  t.ok('Importe: Status zurückgenommen', importe(env)[0].Status === 'zurückgenommen' && /Zurückgenommen am/.test(importe(env)[0].Bericht));
  checkSheets(env, 'Nach dem Zurücknehmen', { verlauf: VERLAUF });

  /* ---------------- 10. Neu importieren, vorbelegt, Von dir entfernt, Abbrechen ---------------- */
  t.section('10. Wieder importieren: Vorlage passt, Antworten vorbelegt, Abbrechen');
  const dataBefore10 = snapRows(env, () => true);
  E.click(E.btn(E.main(), 'Neuer Import'), 'Neuer Import');
  E.type(E.$('impUrl'), XLSX_URL);
  await E.next();
  await E.next();
  t.ok('Vorlage passt und ist vorausgewählt', E.step() === 3 && E.$('impTpl').value === 'Pokemon Ordner.xlsx · Tabellenblatt1' &&
    /passt zu diesem Tab/.test(E.$('impTpl').textContent) && /ist vorausgewählt/.test(E.text()) && /Modus der Vorlage: Nur Neues/.test(E.text()), E.text().slice(0, 400));
  // Vorlage ohne mitgelieferte Einstellungen (Fallback über importListTemplates)
  const tplName = E.$('impTpl').value;
  const wiz = E.win.impS.wiz;
  wiz.info.templates.forEach((x) => { delete x.cfg; });
  E.pick(E.$('impTpl'), '');
  E.pick(E.$('impTpl'), tplName);
  await E.settle();
  t.ok('Vorlage ohne Einstellungen: aus importListTemplates geholt', E.calls('importListTemplates').length === 1 && E.win.impS.wiz.cfg &&
    E.win.impS.wiz.cfg.extras.length === 1 && E.win.impS.wiz.cfg.extras[0].name === 'Ordner' && E.$('impTpl').value === tplName, E.win.impS.wiz.cfg);
  for (let k = 0; k < 5; k++) await E.next();
  t.ok('mit der Vorlage bis Schritt 8', E.step() === 8 && E.$('impSaveName').value === 'Pokemon Ordner.xlsx · Tabellenblatt1');
  await E.clickSettle(E.btn(E.main(), 'Erkennung starten'), 'Erkennung starten');
  t.ok('Prüfliste vorbelegt: „Deine Wahl vom letzten Mal“', boxes().length === 4 && boxes().every((b) => /Deine Wahl vom letzten Mal/.test(b.textContent)) &&
    E.$('impRvProg').textContent === '0 von 4 erledigt' && /4 Zeilen hast du beim letzten Mal schon entschieden/.test(E.text()), E.text().slice(0, 500));
  eyes(E, 'Prüfliste vorbelegt');
  await E.clickSettle(E.btn(E.$('impRvAll'), 'Alle übernehmen'), 'Alle übernehmen');
  t.ok('Alle übernehmen: 4 von 4', E.$('impRvProg').textContent === '4 von 4 erledigt' && /Deine Wahl vom letzten Mal ist übernommen/.test(E.msg()), E.msg());
  await E.clickSettle(E.btn(E.main(), 'Weiter zur Vorschau'), 'Weiter zur Vorschau');
  const pv2 = E.lastCall('importBuildPreview').res;
  t.ok('Vorschau: „Von dir entfernt (1)“ Nachtara, nicht angehakt', /Von dir entfernt \(1\)/.test(E.text()) && pv2.removedByYou.length === 1 &&
    pv2.removedByYou[0].title === 'Nachtara' && !E.$('impRb0').checked && /trotzdem übernehmen/.test(E.text()), E.text().slice(0, 800));
  t.ok('Vorschau: Despotar (jetzt von Hand) unter „Schon von Hand erfasst“', pv2.handMatch.some((h) => h.title === 'Despotar'), pv2.handMatch.map((h) => h.title));
  eyes(E, 'Vorschau 2');
  // Abbrechen: erst Nein, dann Ja
  E.win.__confirmAnswer = false;
  E.click(E.btn(E.main(), 'Abbrechen'), 'Abbrechen');
  await E.settle();
  t.ok('Abbrechen, Rückfrage mit Nein: nichts passiert', E.calls('importDiscardDraft').length === 0 && /Vorschau/.test(E.text()) &&
    /Import abbrechen\?/.test(E.confirms[E.confirms.length - 1]), E.confirms);
  E.win.__confirmAnswer = true;
  await E.clickSettle(E.btn(E.main(), 'Abbrechen'), 'Abbrechen');
  t.ok('Abbrechen: zurück zur Liste mit Meldung', /Import abgebrochen\. Es wurde nichts übernommen\./.test(E.msg()) && !/Import in Arbeit/.test(E.text()), E.msg());
  t.ok('Abbrechen: Entwurf, Import-Quelle, Import-Prüfung leer; Antworten und Vorlage bleiben', !env.props.IMPORT_DRAFT && env.values('Import-Quelle').length === 0 &&
    env.objects('Import-Prüfung').length === 0 && env.objects('Import-Antworten').length === 4 && env.objects('Import-Vorlagen').length === 1);
  t.ok('Abbrechen: Daten und Importe unverändert', snapRows(env, () => true) === dataBefore10 && importe(env).length === 1);
  eyes(E, 'Liste nach Abbrechen');
  checkSheets(env, 'Nach Abbrechen', { verlauf: VERLAUF });

  /* ---------------- 11. Unterbrochener Import, Fortsetzen ---------------- */
  t.section('11. Unterbrochener Import und Fortsetzen');
  E.click(E.btn(E.main(), 'Neuer Import'), 'Neuer Import');
  E.type(E.$('impUrl'), XLSX_URL);
  await E.next(); await E.next();
  for (let k = 0; k < 5; k++) await E.next();
  await E.clickSettle(E.btn(E.main(), 'Erkennung starten'), 'Erkennung starten');
  await E.clickSettle(E.btn(E.$('impRvAll'), 'Alle übernehmen'), 'Alle übernehmen');
  await E.clickSettle(E.btn(E.main(), 'Weiter zur Vorschau'), 'Weiter zur Vorschau');
  const pv11 = E.lastCall('importBuildPreview').res;
  t.ok('Import 2 Vorschau: Arktos und Despotar (behalten) von Hand, Nachtara von dir entfernt', pv11.handMatch.map((h) => h.title).sort().join() === 'Arktos,Despotar' &&
    pv11.removedByYou.map((x) => x.title).join() === 'Nachtara' && E.$('impPvCounts').textContent === '14 neue Karten, 1 übersprungen.', [pv11.handMatch.map((h) => h.title), E.$('impPvCounts').textContent]);
  E.check(E.$('impRb0'), true); // Nachtara trotzdem übernehmen
  await E.settle();
  t.ok('Haken „trotzdem übernehmen“: Zahlen neu gerechnet', E.$('impPvCounts').textContent === '14 neue Karten, 1 Exemplar mehr bei Karten, die du schon hast, 1 übersprungen.', E.$('impPvCounts').textContent);
  // Der Lauf bricht beim Schreiben ab (z. B. Google Tabellen antwortet nicht)
  const origSave = env.ctx.storeSave_;
  let failSave = true;
  env.ctx.storeSave_ = function (st) {
    if (failSave) { failSave = false; throw new Error('Service Spreadsheets timed out while accessing document with id SSID.'); }
    return origSave(st);
  };
  await E.clickSettle(E.btn(E.main(), 'Importieren'), 'Importieren');
  env.ctx.storeSave_ = origSave;
  t.ok('Abbruch: Server meldet „unterbrochen“', /Der Import wurde unterbrochen/.test(E.lastCall('importCommit').error || ''), E.lastCall('importCommit'));
  t.ok('Abbruch: deutsche Meldung mit Hinweis auf die Liste', E.msg() === 'Der Import wurde unterbrochen (Google Tabellen hat zu lange gebraucht). Du kannst ihn in der Liste fortsetzen oder zurücknehmen.', E.msg());
  t.ok('Abbruch: Liste mit „unterbrochen“, Fortsetzen und Zurücknehmen', /Import 2/.test(E.$('impImp0').textContent) && /unterbrochen/.test(E.$('impImp0').textContent) &&
    !!E.btn(E.$('impImp0'), 'Fortsetzen') && !!E.btn(E.$('impImp0'), 'Zurücknehmen') && /Dieser Import wurde nicht fertig/.test(E.$('impImp0').textContent), E.text().slice(0, 600));
  t.ok('Abbruch: kein Banner „Import in Arbeit“ für den unterbrochenen Import', !/Import in Arbeit/.test(E.text()), E.text().slice(0, 300));
  t.ok('Server: Importe läuft, Protokoll geplant, keine Daten-Zeilen', importe(env)[1].Status === 'läuft' && protoOf(env, 2).length > 0 &&
    protoOf(env, 2).every((p) => p.Status === 'geplant') && rowsOf(env, 2).length === 0 && !env.props.IMPORT_RUN);
  eyes(E, 'Liste unterbrochen');
  // Neuer Import wird verweigert, solange einer unterbrochen ist? (Commit wird verweigert; hier nur die Anzeige)
  // Ein anderer Lauf ist gerade aktiv (frisches IMPORT_RUN): Hinweis „Bitte kurz warten“
  env.props.IMPORT_RUN = JSON.stringify({ nr: 2, phase: 'resume', at: Date.now() });
  E.close();
  E = boot(env, 'sidebar', 'Seitenleiste 5');
  await E.settle();
  await E.clickSettle(E.$('tabImport'), 'Tab Import');
  t.ok('Lauf aktiv: Hinweis und „läuft“ ohne Knöpfe', /Gerade wird Import 2 fortgesetzt\. Bitte kurz warten\./.test(E.text()) &&
    /läuft/.test(E.$('impImp0').textContent) && /Läuft gerade/.test(E.$('impImp0').textContent) && !E.$('impImp0').querySelector('button'), E.text().slice(0, 500));
  eyes(E, 'Lauf aktiv');
  env.props.IMPORT_RUN = JSON.stringify({ nr: 2, phase: 'resume', at: Date.now() - 7 * 60 * 1000 });
  await E.clickSettle(E.btn(E.main(), 'Aktualisieren'), 'Aktualisieren');
  t.ok('Lauf veraltet: wieder unterbrochen mit Fortsetzen', /unterbrochen/.test(E.$('impImp0').textContent) && !!E.btn(E.$('impImp0'), 'Fortsetzen') && !/Bitte kurz warten/.test(E.text()), E.text().slice(0, 400));
  await E.clickSettle(E.btn(E.$('impImp0'), 'Fortsetzen'), 'Fortsetzen');
  t.ok('Fortsetzen: Meldung', /^Import 2 ist jetzt fertig: 15 Einträge nachgetragen\./.test(E.msg()), E.msg());
  t.ok('Fortsetzen: Liste mit Import 2 aktiv', /aktiv/.test(E.$('impImp0').textContent) && /Import 2/.test(E.$('impImp0').textContent), E.$('impImp0').textContent);
  t.ok('Fortsetzen: Daten, Protokoll erledigt, Entwurf weg', rowsOf(env, 2).length === 15 && protoOf(env, 2).every((p) => p.Status === 'erledigt') &&
    importe(env)[1].Status === 'aktiv' && !env.props.IMPORT_DRAFT && !env.props.IMPORT_RUN, [rowsOf(env, 2).length, protoOf(env, 2).map((p) => p.Status), importe(env)[1].Status]);
  t.ok('Fortsetzen: Nachtara trotzdem übernommen', rowsOf(env, 2).some((d) => d.name === 'Nachtara' && d.count === 1));
  eyes(E, 'Liste nach Fortsetzen');
  checkSheets(env, 'Nach Fortsetzen', { verlauf: VERLAUF });

  /* ---------------- 12. Entwurf verwerfen aus dem Banner ---------------- */
  t.section('12. Banner: Verwerfen');
  E.click(E.btn(E.main(), 'Neuer Import'), 'Neuer Import');
  E.type(E.$('impUrl'), XLSX_URL);
  await E.next();
  E.click(E.btnRe(E.main(), /^Zur Übersicht$/), 'Zur Übersicht');
  await E.settle();
  t.ok('Zur Übersicht: Meldung und Banner Stand „Tab wählen“', /Der Import bleibt in Arbeit/.test(E.msg()) && /Stand: Tab wählen/.test(E.text()), E.text().slice(0, 300));
  const trashBefore = env.driveFiles[env.driveCopies[env.driveCopies.length - 1].to].trashed;
  await E.clickSettle(E.btn(E.main(), 'Verwerfen'), 'Verwerfen');
  t.ok('Verwerfen: Rückfrage, Meldung, kein Banner, temporäre Kopie gelöscht', /Den Import in Arbeit verwerfen\?/.test(E.confirms[E.confirms.length - 1]) &&
    /Der Import in Arbeit ist verworfen\./.test(E.msg()) && !/Import in Arbeit:/.test(E.text()) && !env.props.IMPORT_DRAFT &&
    trashBefore === false && env.driveFiles[env.driveCopies[env.driveCopies.length - 1].to].trashed === true, E.text().slice(0, 300));
  checkSheets(env, 'Nach Verwerfen', { verlauf: VERLAUF });

  /* ---------------- 13. Web-Modus ---------------- */
  t.section('13. Web-App: kein Import-Tab, keine Fehler');
  const W = boot(env, 'web', 'Web');
  await W.settle();
  t.ok('Web: Import-Tab versteckt, kein Import-Bereich', W.$('tabImport').classList.contains('hidden') && !W.$('paneImport') && typeof W.win.impInit === 'undefined');
  W.win.showTab('import');
  await W.settle();
  t.ok('Web: showTab(import) bleibt bei Hinzufügen, kein Import-Aufruf', !W.$('paneAdd').classList.contains('hidden') &&
    W.callLog.every((x) => !/^import/.test(x.fn)), W.callLog.map((x) => x.fn));
  await W.clickSettle(W.$('tabColl'), 'Tab Sammlung');
  t.ok('Web: Sammlung zeigt Import-Zeilen', W.win.state.groups.some((g) => g.rows.some((r) => r.originLabel === ORIGIN_LABEL + '2')));
  eyes(W, 'Web: Sammlung', W.$('paneColl'));
  t.ok('Web: keine Skriptfehler', W.errors.length === 0, W.errors);
  W.close();

  /* ---------------- 14. Vertrag: Antworten enthalten alles, was das UI liest ---------------- */
  t.section('13b. Fehlertexte im Import-Tab');
  {
    const Z = boot(env, 'sidebar', 'Fehlertexte');
    await Z.settle();
    const et = (m) => Z.win.impErrText(new Z.win.Error(m));
    const wrapped = 'Der Import wurde unterbrochen (Service Spreadsheets timed out). Du kannst ihn in der Liste fortsetzen oder zurücknehmen.';
    t.ok('deutsche Servermeldung mit englischer Ursache bleibt', et(wrapped) === wrapped, et(wrapped));
    t.ok('reiner Google-Zeitfehler wird deutsch', et('Service Spreadsheets timed out while accessing document with id 1abc.') === 'Google Tabellen hat gerade zu lange gebraucht. Bitte versuche es gleich noch einmal.');
    t.ok('mit „Exception:“ davor auch', et('Exception: Service Spreadsheets timed out while accessing document with id 1abc.') === 'Google Tabellen hat gerade zu lange gebraucht. Bitte versuche es gleich noch einmal.');
    t.ok('Verbindungsfehler', /^Keine Verbindung zum Server/.test(et('NetworkError: Connection failure due to HTTP 0')));
    t.ok('Zeitlimit', /^Das hat zu lange gedauert/.test(et('Exceeded maximum execution time')));
    t.ok('Fehlertexte: keine Skriptfehler', Z.errors.length === 0, Z.errors);
    Z.close();
  }

  t.section('14. Vertrag: Antworten der echten Serverfunktionen');
  const used = [...new Set(ALL_CALLS.map((x) => x.fn))].sort();
  const unused = uiCalls.filter((fn) => used.indexOf(fn) < 0);
  t.ok('jede Serverfunktion aus ImportUi.html wurde im Ablauf aufgerufen', unused.length === 0, unused);
  const miss = [];
  ALL_CALLS.forEach((x) => {
    if (x.error || !SHAPES[x.fn]) return;
    missingPaths(x.res, SHAPES[x.fn]).forEach((m) => miss.push(x.fn + m));
  });
  t.ok('alle Felder, die das UI liest, kommen vom Server', miss.length === 0, [...new Set(miss)].slice(0, 20));
  t.ok('alle Antworten reines JSON (kein Date, kein undefined)', ALL_LEAKS.length === 0, ALL_LEAKS.slice(0, 10));
  const errs = ALL_CALLS.filter((x) => x.error).map((x) => x.fn + ': ' + x.error);
  t.ok('Serverfehler nur die erwarteten (falscher Link, Abbruch)', errs.length === 2 && /importOpenSource: Den Link kenne ich nicht/.test(errs[0]) &&
    /importCommit: Der Import wurde unterbrochen/.test(errs[1]), errs);
  t.ok('keine Skriptfehler in der Seitenleiste', E.errors.length === 0, E.errors);
  t.ok('Sperre nie verschachtelt', env.lock.nested === 0, env.lock);
  E.close();
  t.done();
})().catch((e) => {
  console.log('FAIL Ablauf abgebrochen:', e && e.stack || e);
  process.exitCode = 1;
  t.done();
});
