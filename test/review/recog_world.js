'use strict';
// RECOG-Review: erfundene tcgdex-Welt im Stil von test_import_e2e.js plus Erweiterungen, und ein Helfer,
// der Zeilen im Aufbau von Erics Ordner-Datei durch den echten Ablauf schickt (öffnen, Tab, Erkennung).
const H = require('../harness2');

const SETS = {
  dp1: { en: 'Diamond & Pearl', de: 'Diamant & Perl', official: 130, total: 130, date: '2007-05-23' },
  dpp: { en: 'DP Black Star Promos', de: 'DP Black Star Promos', official: 56, total: 56, date: '2007-05-01' },
  ex11: { en: 'Delta Species', de: 'EX Delta Species', official: 113, total: 114, date: '2005-10-31' },
  hgss1: { en: 'HeartGold & SoulSilver', de: 'HeartGold & SoulSilver', official: 123, total: 124, date: '2010-02-10', abbr: 'HS' },
  hgss2: { en: 'Unleashed', de: 'Entfesselt', official: 95, total: 96, date: '2010-05-12', abbr: 'UL' },
  hgss3: { en: 'Undaunted', de: 'Unerschrocken', official: 90, total: 91, date: '2010-08-18' },
  hgssp: { en: 'HGSS Black Star Promos', de: 'HGSS Black Star Promos', official: 25, total: 25, date: '2010-02-01' },
  pl3: { en: 'Supreme Victors', de: 'Ultimative Sieger', official: 147, total: 153, date: '2009-08-19' },
  me01: { en: 'Mega Evolution', de: 'Mega-Entwicklung', official: 132, total: 188, date: '2025-09-26' },
  mep: { en: 'MEP Black Star Promos', de: 'MEP Black Star Promos', official: 100, total: 100, date: '2025-09-01' }
};
const NORMAL = { normal: true, reverse: true, holo: false, firstEdition: false };
const HOLO = { normal: false, reverse: true, holo: true, firstEdition: false };
const CARDS = [
  ['dp1-12', 'Plinfa', 'Piplup', NORMAL, { trend: 0.3, holo: 0.6 }],
  ['dp1-16', 'Panferno', 'Infernape', HOLO, { trend: 2, holo: 2.4 }],
  ['dpp-DP12', 'Plaudagei', 'Chatot', HOLO, null],
  ['dpp-DP16', 'Lucario', 'Lucario', HOLO, { trend: 4, holo: 4 }],
  ['ex11-62', 'Ditto', 'Ditto', NORMAL, { trend: 6.5, holo: 7 }],
  ['hgss1-1', 'Arkani', 'Arcanine', HOLO, { trend: 3, holo: 3 }],
  ['hgss1-5', 'Gengar', 'Gengar', HOLO, { trend: 8, holo: 9 }],
  ['hgss1-78', 'Pikachu', 'Pikachu', NORMAL, { trend: 0.5, holo: 1.5 }],
  ['hgss2-88', 'Despotar', 'Tyranitar', HOLO, { trend: 3.5, holo: 4 }],
  ['hgss3-82', 'Hundemon', 'Houndoom', NORMAL, { trend: 0.8, holo: 1.6 }],
  ['hgssp-HGSS01', 'Ho-Oh', 'Ho-Oh', HOLO, { trend: 5, holo: 5 }],
  ['pl3-148', 'Arktos', 'Articuno', HOLO, { trend: 2.2, holo: 2.2 }],
  ['me01-091', 'Bisaflor', 'Venusaur', NORMAL, { trend: 0.2, holo: 0.4 }],
  ['mep-091', 'Mega-Lucario-ex', 'Mega Lucario ex', HOLO, { trend: 9, holo: 9 }]
];
const localIdOf = (id) => id.slice(id.indexOf('-') + 1);
const setOf = (id) => id.slice(0, id.indexOf('-'));

function tcgCard(row, lang, setsMap) {
  const [id, de, en, variants, price] = row;
  const s = (setsMap || SETS)[setOf(id)];
  const c = {
    id, localId: localIdOf(id), name: lang === 'de' ? de : en, image: 'https://assets.tcgdex.net/' + lang + '/x/' + id,
    category: 'Pokemon', rarity: 'Rare', illustrator: 'X',
    set: { id: setOf(id), name: s[lang], cardCount: { official: s.official, total: s.total } },
    variants: Object.assign({}, variants)
  };
  if (price) c.pricing = { cardmarket: { trend: price.trend, 'trend-holo': price.holo, updated: '2026-10-13T00:00:00Z' } };
  return c;
}

function makeDb(opts) {
  opts = opts || {};
  const db = H.defaultDb();
  db['de/sets'] = [];
  db['en/sets'] = [];
  const cards = CARDS.concat(opts.extraCards || []);
  const sets = Object.assign({}, SETS, opts.extraSets || {});
  Object.keys(sets).forEach((id) => {
    const s = sets[id];
    ['de', 'en'].forEach((lang) => {
      if (lang === 'de' && s.noDe) return;
      db[lang + '/sets'].push({ id, name: s[lang], logo: 'L', cardCount: { official: s.official, total: s.total } });
      const list = cards.filter((c) => setOf(c[0]) === id).map((c) => ({ id: c[0], localId: localIdOf(c[0]), name: lang === 'de' ? c[1] : c[2] }));
      const full = { id, name: s[lang], releaseDate: s.date, cardCount: { official: s.official, total: s.total }, cards: list };
      if (s.abbr && lang === 'en') full.abbreviation = { official: s.abbr };
      db[lang + '/sets/' + id] = full;
    });
  });
  cards.forEach((c) => {
    const s = sets[setOf(c[0])];
    if (!s.noDe) db['de/cards/' + c[0]] = tcgCard(c, 'de', sets);
    db['en/cards/' + c[0]] = tcgCard(c, 'en', sets);
  });
  db['de/cards'] = cards.filter((c) => !sets[setOf(c[0])].noDe).map((c) => ({ id: c[0], name: c[1] }));
  db['en/cards'] = cards.map((c) => ({ id: c[0], name: c[2] }));
  // Namenssuche wie tcgdex: Teiltext, Groß/klein egal
  const byName = (lang) => (url) => {
    const m = url.match(/[?&]name=([^&]*)/);
    const q = decodeURIComponent(m ? m[1] : '').toLowerCase();
    return cards.filter((c) => lang === 'en' || !sets[setOf(c[0])].noDe)
      .filter((c) => (lang === 'de' ? c[1] : c[2]).toLowerCase().indexOf(q) >= 0)
      .map((c) => ({ id: c[0], localId: localIdOf(c[0]), name: lang === 'de' ? c[1] : c[2], image: 'https://assets.tcgdex.net/' + lang + '/x/' + c[0] }));
  };
  db.__nameSearch = { de: byName('de'), en: byName('en') };
  return db;
}

const CM = 'https://www.cardmarket.com/de/Pokemon/Products/Singles/';
const HEAD = ['Karte Name', 'Setnummer', 'Cardmarket', 'Set', '30 Tage Preistrend', 'Datum Preis-Daten', 'Spalte 1'];

function newEnv(opts) {
  opts = opts || {};
  const db = makeDb(opts);
  const env = H.createEnv({ db });
  // Namenssuche dynamisch: 'de/cards?name=…' -> Funktion
  const orig = env.DB;
  env.DB = new Proxy(orig, {
    get(t, k) {
      if (typeof k === 'string' && /^(de|en)\/cards\?name=/.test(k) && !(k in t)) {
        const lang = k.slice(0, 2);
        return () => t.__nameSearch[lang]('?' + k.split('?')[1]);
      }
      return t[k];
    }
  });
  env.ctx.setupAll_();
  if (opts.prefill !== false) env.uiCall('importSetsVorbelegen');
  return env;
}

/** Zeilen durch den echten Ablauf schicken; liefert die Prüfungs-Einträge. */
function run(env, rows, mode, sourceId) {
  sourceId = sourceId || 'XLSXREVIEW01';
  env.addSource({ id: sourceId, name: 'Pokemon Ordner.xlsx', mime: 'sheet', tabs: { Tabellenblatt1: [HEAD].concat(rows) } });
  env.uiCall('importOpenSource', sourceId);
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  env.uiCall('importStartRecognition', s.cfg, '', mode || 'neu');
  let r, n = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && n++ < 50);
  return { guess: s.guess, items: env.ctx.reviewRead_(), counts: r.counts };
}

function brief(items) {
  return items.map((i) => [i.values.name, i.values.number, i.values.set, i.qty, i.status, i.card ? i.card.id + ' (' + i.card.name + ')' : '-',
    i.status !== 'eindeutig' ? i.reason : '', (i.candidates || []).map((c) => c.id).join(',')]);
}

module.exports = { H, SETS, CARDS, makeDb, newEnv, run, brief, CM, HEAD };
