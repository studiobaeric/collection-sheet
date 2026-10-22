'use strict';
/**
 * Zeichnet je Look eine Vorschau des ganzen Blatts „Dashboard“ mit Musterzahlen als PNG nach
 * docs/dashboard/vorschau-<Look>.png. Die Farben kommen aus docs/dashboard/looks.json, Raster, Knöpfe und Texte aus
 * src/Code.gs (geladen wie in den Tests), die Knöpfe zeichnet tools/dashboard-knoepfe.js. So bleiben auch die Looks,
 * die das Tool nicht baut, als Konzept sichtbar.
 *
 * Aufruf: NODE_PATH="$(npm root -g)" node tools/dashboard-vorschau.js [--theme <Look>] [--out <Ordner>]
 * Ohne --theme zeichnet es alle Looks. Braucht Playwright mit Chromium, wie tools/dashboard-knoepfe.js.
 */
const fs = require('fs');
const path = require('path');
const H = require('../test/harness2');
const KN = require('./dashboard-knoepfe');
const LOOKS = require('../docs/dashboard/looks.json');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const OUT = arg('out', path.join(__dirname, '..', 'docs', 'dashboard'));
const ONLY = arg('theme', '');

const env = H.createEnv();
const get = name => env.run(name);
const BUTTONS = get('DASH_BUTTONS');
const COLS = get('DASH_COL_WIDTHS');
const ROWS = get('DASH_ROW_HEIGHTS');
const BTN_W = get('DASH_BTN_W');
const BTN_H = get('DASH_BTN_H');
const PT = 4 / 3; // Schriftgröße in Sheets (pt) -> px

/** Musterzahlen wie in Erics Sammlung am 22.10.2026 */
const SAMPLE = {
  stand: 'Stand 22.10.2026 18:40 · Preise vom 22.10.2026', total: '487,35 €', change: '+12,40 € seit 15.10.', cards: '75',
  distinct: 'davon 68 verschiedene', owned: 57, dexTotal: 1025
};

function spark(color, w, h) {
  const seed = [3, -1, 4, 1, -5, 9, 2, -6, 5, 3, -2, 1, 4, 6, -3, 2, 1, -4, 7, 2, 3, -1, 2, 5, -2, 3, 4, -1, 2, 3];
  let v = 430;
  const pts = [];
  for (let i = 0; i < 60; i++) { v += seed[i % seed.length] * 0.9; pts.push(v); }
  const min = Math.min(...pts), max = Math.max(...pts);
  const d = pts.map((y, i) => (i * (w - 4) / 59 + 2).toFixed(1) + ',' + (h - 4 - (y - min) / (max - min) * (h - 8)).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

/** Element über Zellen: Zeilen r1..r2, Spalten c1..c2 (1-basiert, wie im Blatt) */
const at = (r1, c1, r2, c2, style, inner) =>
  `<div style="grid-row:${r1}/${(r2 || r1) + 1};grid-column:${c1}/${(c2 || c1) + 1};${style || ''}">${inner || ''}</div>`;

/** HTML der Vorschau für einen Look; pngs = { Schlüssel: PNG-Buffer } der Knöpfe in diesem Look */
function html(look, pngs) {
  const c = LOOKS.looks[look].blatt;
  const pct = (Math.round(SAMPLE.owned / SAMPLE.dexTotal * 1000) / 10).toFixed(1).replace('.', ',');
  const text = (size, color, extra) => `font-size:${(size * PT).toFixed(1)}px;color:${color};white-space:nowrap;padding:0 3px;display:flex;${extra || ''}`;
  const parts = [];
  // Kopf
  parts.push(at(2, 2, 3, 16, `background:${c.banner}`));
  parts.push(at(2, 3, 2, 15, text(20, c.title, 'align-items:flex-end;font-weight:700'), 'Pokémon-Sammlung'));
  parts.push(at(2, 3, 2, 15, text(9, c.bannerSub, 'align-items:flex-end;justify-content:flex-end;padding-bottom:4px'), 'Version ' + get('TOOL_VERSION')));
  parts.push(at(3, 3, 3, 15, text(10, c.bannerSub, 'align-items:flex-start'), SAMPLE.stand));
  // Kacheln
  const tiles = [
    ['GESAMTWERT', SAMPLE.total, `<span style="color:${c.up}">${SAMPLE.change}</span>`],
    ['KARTEN', SAMPLE.cards, SAMPLE.distinct],
    ['POKÉDEX · ' + pct + ' %', SAMPLE.owned + ' von ' + SAMPLE.dexTotal, null],
    ['WERTVERLAUF · ' + get('DASH_DAYS') + ' TAGE', null, null]
  ];
  tiles.forEach((tl, i) => {
    const col = 2 + i * 4;
    parts.push(at(5, col, 8, col + 2, `background:${c.tile};border:1px solid ${c.tileBorder};box-sizing:border-box`));
    parts.push(at(5, col + 1, 5, col + 1, text(8, c.label, 'align-items:flex-end;font-weight:700;letter-spacing:.3px'), tl[0]));
    if (tl[1] != null) parts.push(at(6, col + 1, 6, col + 1, text(20, c.value, 'align-items:center;font-weight:700'), tl[1]));
    if (tl[2] != null) parts.push(at(7, col + 1, 7, col + 1, text(10, c.sub, 'align-items:flex-start'), tl[2]));
  });
  const w = SAMPLE.owned / SAMPLE.dexTotal * 100;
  parts.push(at(7, 11, 7, 11, 'padding:3px 3px 5px;box-sizing:border-box', `<div style="height:100%;background:${c.track}"><div style="height:100%;width:${w}%;background:${c.accent}"></div></div>`));
  parts.push(at(6, 15, 7, 15, 'display:flex;align-items:center;justify-content:center', spark(c.accent, COLS[14] - 6, ROWS[6] + ROWS[7] - 6)));
  // Abschnitte, Knöpfe, Hinweis
  [[10, 'Aktionen'], [15, 'Blätter']].forEach(([r, t]) => {
    parts.push(at(r, 2, r, 16, `border-bottom:1px solid ${c.line}`));
    parts.push(at(r, 3, r, 3, text(12, c.section, 'align-items:center;font-weight:700'), t));
  });
  BUTTONS.forEach((b, i) => {
    const cell = env.ctx.dashButtonCell_(i);
    parts.push(at(cell.row, cell.col, cell.row, cell.col + 2, 'padding-top:3px',
      `<img src="data:image/png;base64,${pngs[b.key].toString('base64')}" width="${BTN_W}" height="${BTN_H}" style="display:block">`));
  });
  parts.push(at(19, 3, 19, 16, text(9, c.label, 'align-items:center'), get('DASH_HELP')));

  const rowList = Object.keys(ROWS).map(Number).sort((a, b) => a - b).map(r => ROWS[r] + 'px').concat(['16px']);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: ${c.page}; }
  .grid { display: grid; grid-template-columns: ${COLS.map(x => x + 'px').join(' ')}; grid-template-rows: ${rowList.join(' ')};
    width: ${COLS.reduce((a, b) => a + b, 0)}px; background: ${c.page}; font-family: Inter, 'DejaVu Sans', sans-serif; }
  </style></head><body><div class="grid">${parts.join('\n')}</div></body></html>`;
}

async function main() {
  const looks = ONLY ? [ONLY] : Object.keys(LOOKS.looks);
  looks.forEach(l => { if (!LOOKS.looks[l]) throw new Error('Unbekannter Look: ' + l); });
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1200, height: 700 } });
  const knopf = await ctx.newPage();
  await knopf.setViewportSize({ width: KN.W, height: KN.H });
  const p = await ctx.newPage();
  for (const look of looks) {
    await p.setContent(html(look, await KN.zeichne(knopf, look)), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, 'vorschau-' + look + '.png');
    await p.locator('.grid').screenshot({ path: file });
    console.log(file, fs.statSync(file).size, 'Bytes');
  }
  await browser.close();
}

module.exports = { html };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
