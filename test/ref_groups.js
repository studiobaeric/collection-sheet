'use strict';
/**
 * ref_groups.js – die Rechnung in JavaScript, mit der die Tests die Formeln aus #43 vergleichen. So hat 1.1.3 die
 * Blätter Gruppen (groupSheetRow_) und Dashboard (refreshDashboard_) gefüllt; Pokédex-Zahlen liefert pokedexIndex_
 * aus Code.gs. Die Hilfsfunktionen (orderGroupRows_, groupPrice_, exemplareText_ …) kommen aus Code.gs (env.ctx): Dieselben
 * rechnen für Seitenleiste und Web-App, die Blätter müssen also dazu passen.
 */

const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

/** Eine Zeile wie früher im Blatt Gruppen (ohne Pokédex-Nr.), dahinter die Zusatzspalten in Reihenfolge der Zeilen. */
function groupRow(env, gkey, rows, dHeaders, extras, refs) {
  const COL = env.run('COL');
  const NCOL = env.run('NCOL');
  const GCOL = env.run('GCOL');
  const VARIANT_LABELS = env.run('VARIANT_LABELS');
  const VIEW_CHANGE_DAYS = env.run('VIEW_CHANGE_DAYS');
  const c = env.ctx;
  const ordered = c.orderGroupRows_(rows);
  const p = ordered[0];
  const first = col => {
    for (let i = 0; i < ordered.length; i++) if (ordered[i][col] !== '' && ordered[i][col] != null) return ordered[i][col];
    return '';
  };
  const maxDate = col => {
    let best = null;
    ordered.forEach(r => { if (isDate(r[col]) && (!best || r[col].getTime() > best.getTime())) best = r[col]; });
    return best || first(col);
  };
  const count = rows.reduce((s, r) => s + (Number(r[COL.count]) || 0), 0);
  const gp = c.groupPrice_(rows);
  const version = c.versionText_(p[COL.version]);
  const setSize = p[COL.setSize] === '' || p[COL.setSize] == null ? '' : Number(p[COL.setSize]) || '';
  const out = [
    gkey, String(p[COL.id] || ''), String(p[COL.setId] || ''), String(p[COL.setName] || ''), c.cellText_(first(COL.setDate)),
    String(p[COL.localId] == null ? '' : p[COL.localId]), String(p[COL.normNum] == null ? '' : p[COL.normNum]), setSize,
    String(p[COL.name] || '') + (version ? ' · ' + version : ''), String(p[COL.nameEn] || ''), String(p[COL.source] || ''),
    String(p[COL.variant] || ''), c.exemplareText_(rows), count,
    gp.price == null ? '' : gp.price,
    gp.manual ? 'manuell' + (gp.ownDate ? ' ' + c.dmyText_(gp.ownDate) : '') : gp.date,
    String(first(COL.img) || ''), String(p[COL.rarity] || ''), String(p[COL.category] || ''), String(p[COL.illustrator] || ''),
    maxDate(COL.added), maxDate(COL.changed), p[COL.numSort] === '' || p[COL.numSort] == null ? '' : Number(p[COL.numSort]) || ''
  ];
  const ch = gp.manual ? null : (c.groupChanges_(rows, refs) || {})[VIEW_CHANGE_DAYS];
  out.push(ch ? ch.eur : '', ch && ch.pct != null ? ch.pct / 100 : '', ch && ch.since ? c.dmyText_(ch.since) : '');
  const name = out[GCOL['Name'] - 1], nr = out[GCOL['Nummer'] - 1], price = out[GCOL['Preis (EUR)'] - 1];
  out.push(
    [name, out[GCOL['Name englisch'] - 1], out[GCOL['Illustrator'] - 1]].join('\n'),
    typeof price === 'number' ? price * count : 0,
    String(p[COL.source] || '') === 'en-Ersatz' ? name + ' (EN)' : name,
    setSize === '' ? nr : nr + '/' + setSize,
    VARIANT_LABELS[String(p[COL.variant] || '')] || VARIANT_LABELS.normal,
    typeof price === 'number' ? price : 'kein Preis'
  );
  extras.forEach(xn => {
    const col = dHeaders.indexOf(xn, NCOL);
    const vals = [];
    if (col >= 0) {
      ordered.forEach(r => {
        const v = c.cellText_(r[col]).trim();
        if (v && vals.indexOf(v) < 0) vals.push(v);
      });
    }
    out.push(vals.join(' / '));
  });
  return out;
}

function dayShift(ymd, days) {
  const p = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}

function shortDate(ymd, today) {
  const p = String(ymd).split('-');
  return p[2] + '.' + p[1] + '.' + (p[0] === String(today).slice(0, 4) ? '' : p[0]);
}

function eur(n) {
  const parts = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + parts[1] + ' €';
}

/**
 * Zahlen und Texte des Dashboards wie refreshDashboard_ in 1.1.3. hist: [{day: 'yyyy-MM-dd', total}] nach Tag sortiert,
 * today: 'yyyy-MM-dd'. -> {total, cards, distinct, dexOwned, dexTotal, pct, change, sign, lastDay, history}
 */
function dashboard(env, rows, hist, today, dex) {
  const c = env.ctx;
  const COL = env.run('COL');
  const value = c.collectionValue_(rows);
  let distinct = 0;
  c.groupRows_(rows).forEach(g => {
    if (g.idx.reduce((s, i) => s + (Number(rows[i][COL.count]) || 0), 0) > 0) distinct++;
  });
  dex = dex || c.pokedexIndex_(rows);
  const dexTotal = dex.entries.length;
  const dexOwned = dex.entries.filter(e => e.copies > 0).length;
  const target = dayShift(today, -7);
  let ref = null;
  hist.forEach(h => { if (h.day <= target) ref = h; });
  let change, sign = 0;
  if (ref) {
    const d = Math.round((value.total - ref.total) * 100) / 100;
    change = (d > 0 ? '+' : d < 0 ? '−' : '±') + eur(Math.abs(d)) + ' seit ' + shortDate(ref.day, today);
    sign = d > 0 ? 1 : d < 0 ? -1 : 0;
  } else {
    change = hist.length ? 'Vergleich ab ' + shortDate(dayShift(hist[0].day, 7), today) : 'Noch kein Verlauf';
  }
  const pct = dexTotal ? (Math.round(dexOwned / dexTotal * 1000) / 10).toFixed(1).replace('.', ',') : '0,0';
  const since = dayShift(today, -89);
  return {
    total: value.total, cards: value.cards, distinct, dexOwned, dexTotal, pct, change, sign,
    lastDay: hist.length ? hist[hist.length - 1].day : '',
    history: hist.filter(h => h.day >= since).map(h => h.total).slice(-90)
  };
}

const F = require('./formula');

/** Zelle zum Vergleichen: Datum (auch aus dem Skript-Kontext) als Seriennummer, leer als ''. */
const cellNorm = v => (v === null || v === undefined ? '' : isDate(v) ? F.dateToSerial(v) : v);
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

/** Blatt Verlauf wie dashHistory_ in 1.1.3: [{day, total}] nach Tag, je Tag der letzte Eintrag. */
function readHistory(env) {
  const c = env.ctx;
  const byDay = {};
  (env.values('Verlauf') || []).slice(1).forEach(r => {
    const day = typeof r[0] === 'string' ? r[0].trim() : isDate(r[0]) ? c.dateText_(r[0]) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof r[1] === 'number' && isFinite(r[1])) byDay[day] = r[1];
  });
  return Object.keys(byDay).sort().map(d => ({ day: d, total: byDay[d] }));
}

/**
 * Die Blätter mit Formeln (#43) gegen die Rechnung von 1.1.3 über die Daten der Attrappe: Gruppen (jede Gruppe, jede
 * Spalte, dazu die Pokédex-Nr. wie dexMapOf_), Pokédex-Daten (Karten, Exemplare, Wert je Pokémon wie pokedexIndex_)
 * und die Zahlen und Texte im Dashboard. -> Abweichungen [Blatt, Schlüssel, Spalte, Formel, erwartet]; leer = gleich
 */
function compareSheets(env) {
  const c = env.ctx;
  const out = [];
  const GH = env.run('GROUP_HEADERS');
  const data = env.run('readData_(sheet_(SHEETS.data))').filter(r => c.isDataRow_(r));
  const extras = c.getViewExtras_();
  const dHeaders = c.dataHeaders_();
  const refs = c.loadCardHistRefs_();
  const want = {};
  c.groupRows_(data).forEach(g => { want[g.gkey] = groupRow(env, g.gkey, g.idx.map(i => data[i]), dHeaders, extras, refs); });
  const dexWant = c.dexMapOf_(data, c.loadDexIds_());
  const vals = env.values('Gruppen');
  const wantHead = GH.concat(extras);
  if (JSON.stringify(vals[0].slice(0, wantHead.length)) !== JSON.stringify(wantHead)) out.push(['Gruppen', 'Kopf', '', vals[0], wantHead]);
  const di = GH.indexOf('Pokédex-Nr.');
  const got = {};
  vals.slice(1).forEach(r => {
    if (r[0] === '' || r[0] == null) return;
    if (typeof r[0] !== 'string' || got[r[0]]) out.push(['Gruppen', String(r[0]), 'doppelt oder Fehler']);
    got[r[0]] = r;
  });
  Object.keys(want).forEach(k => {
    const g = got[k];
    if (!g) { out.push(['Gruppen', k, 'fehlt']); return; }
    want[k].forEach((wv, j) => {
      const gj = j < di ? j : j + 1; // die Pokédex-Nr. gab es in 1.1.3 nicht
      let a = cellNorm(wv);
      const b = cellNorm(g[gj]);
      if (j >= di) a = String(a).split(' / ').sort().join(' / '); // Zusatzspalten nennen mehrere Werte alphabetisch
      if (!same(a, b)) out.push(['Gruppen', k, j < di ? GH[j] : 'Zusatz ' + extras[j - di], b, a]);
    });
    const dx = dexWant[c.dexKey_(k)];
    if (String(cellNorm(g[di])) !== (dx || '')) out.push(['Gruppen', k, 'Pokédex-Nr.', g[di], dx]);
  });
  Object.keys(got).forEach(k => { if (!want[k]) out.push(['Gruppen', k, 'zu viel']); });

  const dv = env.values('Pokédex-Daten');
  const dex = c.pokedexIndex_(data);
  dex.entries.forEach(e => {
    const r = dv[e.nr] || [];
    const g = [r[0], r[4], r[5], r[6]].map(cellNorm);
    const w = [e.nr, e.cards, e.copies, e.value];
    if (!g.every((x, i) => same(x, w[i]))) out.push(['Pokédex-Daten', e.nr, 'Nr./Karten/Exemplare/Wert', g, w]);
  });

  const dash = env.sheet('Dashboard');
  if (dash) {
    const today = c.dateText_(new Date());
    const d = dashboard(env, data, readHistory(env), today, dex);
    const cell = a1 => cellNorm(dash.getRange(a1).getValue());
    const w = {
      C6: d.total, G6: d.cards, K6: d.dexOwned + ' von ' + d.dexTotal, K5: 'POKÉDEX · ' + d.pct + ' %', C7: d.change,
      G7: d.cards > 1 ? (d.distinct === d.cards ? 'alle verschieden' : 'davon ' + d.distinct + ' verschiedene') : ''
    };
    Object.keys(w).forEach(a1 => { if (!same(cell(a1), w[a1])) out.push(['Dashboard', a1, '', cell(a1), w[a1]]); });
    const hl = env.ctx.colLetter_(env.run('DASH_HELPER_COL'));
    const line = dash.getRange(hl + '2:' + hl + '91').getValues().map(r => cellNorm(r[0])).filter(v => v !== '');
    if (!line.every((v, i) => same(v, d.history[i])) || line.length !== d.history.length) out.push(['Dashboard', hl + '2:' + hl + '91', '', line, d.history]);
  }
  return out;
}

module.exports = { groupRow, dashboard, compareSheets, readHistory, isDate, eur, shortDate, dayShift };
