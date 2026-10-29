'use strict';
/**
 * gen_daten.js – Testdaten wie in einer echten Tabelle für die Formel-Tests (#43): Daten mit Zusatzspalten und vielen
 * Sonderfällen (freie Karten, leere Felder, eigene Preise, * ? ~ im Namen, Zeilen mit 0 Exemplaren), Kartenverlauf,
 * gemerkte Pokédex-Nummern (A:C) und Verlauf. Fester Startwert, damit Fehler nachstellbar sind.
 *
 *   const gen = require('./gen_daten');
 *   const { rows, extrasNames, cards } = gen(env, { cards: 40, seed: 7, extras: ['Ordner', 'Notiz'], histDays: 120 });
 */
module.exports = function generate(env, opts) {
  opts = opts || {};
  const ctx = env.ctx;
  const COL = env.run('COL'), NCOL = env.run('NCOL');
  let seed = opts.seed || 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const extrasNames = opts.extras || ['Ordner', 'Notiz'];
  const VDate = env.run('Date');
  const base = new VDate(2026, 9, 1, 12, 0, 0);
  const day = n => new VDate(base.getTime() + n * 86400000 + Math.floor(rnd() * 3600) * 1000);
  const names = ['Glurak', 'Pikachu', 'Mewtu', 'Bisasam', 'Glurak-ex', 'Pikachu & Zekrom-GX', 'Dunkles Ho-Oh', 'Alola-Vulpix',
    'Pika*chu ~x', 'Mew?', 'Professor Eich', 'Pokémon-Center', 'Garados', 'Relaxo', 'Evoli', 'Despotar'];
  const rows = [];
  let eid = 0;
  const mk = o => {
    const r = new Array(NCOL + extrasNames.length).fill('');
    Object.keys(o).forEach(k => { if (k in COL) r[COL[k]] = o[k]; });
    (o.extras || []).forEach((v, i) => { if (i < extrasNames.length) r[NCOL + i] = v; });
    r[COL.eid] = 'e' + (++eid);
    r[COL.key] = ctx.entryKey_(r);
    rows.push(r);
    return r;
  };
  const cards = [];
  const nCards = opts.cards || 40;
  for (let i = 1; i <= nCards; i++) {
    const set = 'set' + (1 + (i % 5));
    const name = names[i % names.length];
    cards.push({
      id: i % 13 === 0 ? '' : set + '-' + String(i).padStart(3, '0'), setId: set, setName: 'Set ' + set.toUpperCase(),
      setDate: i % 11 === 0 ? '' : '20' + (10 + (i % 5)) + '-0' + (1 + (i % 9)) + '-15',
      localId: i % 7 === 0 ? 'TG' + String(i).padStart(2, '0') : String(i).padStart(3, '0'),
      normNum: i % 7 === 0 ? 'TG' + i : String(i), setSize: i % 6 === 0 ? '' : 100 + (i % 5),
      name, nameEn: i % 4 === 0 ? '' : 'Pokemon ' + i,
      source: i % 8 === 0 ? 'en-Ersatz' : i % 13 === 0 ? 'frei' : 'de',
      img: i % 5 === 0 ? '' : 'https://assets.tcgdex.net/de/x/' + set + '/' + i,
      rarity: pick(['Häufig', 'Selten', 'Selten, Holo', '']),
      category: /Eich|Center/.test(name) ? 'Trainer' : pick(['Pokémon', 'Pokémon', '']),
      illustrator: pick(['Arita', 'Saito', '']), numSort: i % 7 === 0 ? '' : i
    });
  }
  cards.forEach((c, ci) => {
    const nGroups = 1 + (ci % 3);
    for (let g = 0; g < nGroups; g++) {
      const variant = ['normal', 'holo', 'reverse', 'firstEdition', '', 'special'][(ci + g) % 6];
      const version = g === 2 ? pick(['Promo', ' Promo  Stempel ', '']) : '';
      const nRows = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < nRows; k++) {
        const hasOwn = rnd() < 0.15;
        const hasPrice = rnd() < 0.75;
        const added = rnd() < 0.1 ? '' : day(Math.floor(rnd() * 20));
        mk(Object.assign({}, c, {
          variant, version,
          lang: pick(['DE', 'DE', 'EN', 'FR', '', 'JP', 'XX']), cond: pick(['', 'NM', 'NM', 'EX', 'LP', 'PO', 'nm']),
          count: pick([1, 1, 2, 3, 0, 1]), price: hasPrice ? Math.round(rnd() * 5000) / 100 : '',
          priceDate: hasPrice ? '2026-10-2' + Math.floor(rnd() * 8) : (rnd() < 0.5 ? '2026-10-01' : ''),
          ownPrice: hasOwn ? Math.round(rnd() * 3000) / 100 : '', ownPriceDate: hasOwn ? pick(['2026-10-05', '']) : '',
          origin: pick(['', 'Hand', 'Import 1', 'Import 2', 'Hand']), added, changed: day(25 + Math.floor(rnd() * 3)),
          setDate: k === 0 && rnd() < 0.3 ? '' : c.setDate, img: k === 0 && rnd() < 0.3 ? '' : c.img,
          extras: [pick(['A', 'B', ' A ', '', 'Ordner 2']), pick(['', 'x y', 'z'])]
        }));
      }
    }
  });

  const put = (name, table) => {
    const sh = env.sheet(name) || ctx.ss_().insertSheet(name);
    const w = table[0].length;
    if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
    if (sh.getMaxRows() < table.length + 1) sh.insertRowsAfter(sh.getMaxRows(), table.length + 1 - sh.getMaxRows());
    sh.getRange(1, 1, table.length, w).setValues(table.map(r => r.map(v => (typeof v === 'string' && v !== '' ? "'" + v : v))));
    return sh;
  };
  const headers = env.run('DATA_HEADERS').concat(extrasNames);
  put('Daten', [headers].concat(rows));

  const CH = env.run('CARD_HIST_HEADERS');
  const chRows = [CH];
  cards.forEach((c, i) => {
    if (!c.id || i % 3 === 0) return;
    ['normal', 'holo', 'reverse', 'firstEdition', ''].forEach((v, j) => {
      if ((i + j) % 2) return;
      const row = new Array(CH.length).fill('');
      row[0] = c.id; row[1] = v; row[2] = '2026-10-28';
      row[CH.indexOf('Vergleich 30 Tage')] = rnd() < 0.2 ? 0 : Math.round(rnd() * 4000) / 100;
      row[CH.indexOf('Seit (30 Tage)')] = rnd() < 0.5 ? '' : '2026-10-1' + (i % 9);
      chRows.push(row);
    });
  });
  put('Kartenverlauf', chRows);

  // Pokédex-Nummern A:C: für drei von vier Karten-IDs gemerkt, Rest aus dem Namen
  const dexRows = [['Karten-ID', 'Pokédex-Nr.', 'Abgerufen am']];
  cards.forEach((c, i) => {
    if (c.id && i % 4 !== 3) dexRows.push([c.id, i % 5 === 0 ? (i + 1) + ' ' + (i + 300) : String(i + 1), '2026-10-28']);
  });
  const dx = env.sheet('Pokédex-Nummern') || ctx.ss_().insertSheet('Pokédex-Nummern');
  dx.clear();
  dx.getRange(1, 1, dexRows.length, 3).setValues(dexRows.map(r => r.map(v => "'" + v)));

  // Verlauf: ein Wert je Tag, die letzten 120 Tage mit Lücken
  const hist = env.sheet('Verlauf') || ctx.ss_().insertSheet('Verlauf');
  const now = new Date();
  const hRows = [['Datum', 'Gesamtwert (EUR)', 'Kartenanzahl', 'Einträge ohne Preis', 'Fehlgeschlagene Abrufe']];
  for (let d = opts.histDays || 120; d >= 1; d--) {
    if (d % 9 === 4) continue;
    const t = new VDate(now.getFullYear(), now.getMonth(), now.getDate() - d);
    hRows.push([t, Math.round((900 + d * 3.7 + rnd() * 40) * 100) / 100, 100 + d, 2, 0]);
  }
  if (hist.getMaxRows() < hRows.length + 1) hist.insertRowsAfter(hist.getMaxRows(), hRows.length + 1 - hist.getMaxRows());
  hist.getRange(1, 1, hRows.length, 5).setValues(hRows);
  return { rows, extrasNames, cards };
};
