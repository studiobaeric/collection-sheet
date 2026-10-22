'use strict';
/**
 * Zeichnet die Knöpfe des Blatts „Dashboard“ als PNG nach assets/dashboard/ (doppelte Auflösung).
 * Das Skript in der Tabelle lädt sie von GitHub und legt sie als Bilder mit zugewiesener Funktion aufs Blatt
 * (DASH_ASSETS in src/Code.gs zeigt auf den Commit mit diesen Dateien).
 *
 * Aufruf: NODE_PATH="$(npm root -g)" node tools/dashboard-knoepfe.js [--theme rot|dunkel|neutral] [--out Ordner]
 * Braucht Playwright mit Chromium (nicht in package.json, weil nur für neue Knöpfe nötig).
 *
 * Nach einer Änderung: Bilder committen und pushen, DASH_ASSETS auf den neuen Commit stellen und
 * DASH_ASSET_VERSION erhöhen, dann ersetzt die Einrichtung die alten Bilder in jeder Tabelle.
 * Symbole: Material Icons (Apache-Lizenz 2.0), der Pokéball ist selbst gezeichnet.
 */
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const OUT = arg('out', path.join(__dirname, '..', 'assets', 'dashboard'));
const W = 276; // Breite eines Felds im Dashboard (3 Spalten à 92 px)
const H = 52;

const ICONS = {
  add: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  euro: '<path d="M15 18.5c-2.51 0-4.68-1.42-5.76-3.5H15l1-2H8.58c-.05-.33-.08-.66-.08-1s.03-.67.08-1H15l1-2H9.24C10.32 6.92 12.5 5.5 15 5.5c1.61 0 3.09.59 4.23 1.57L21 5.3C19.41 3.87 17.3 3 15 3c-3.92 0-7.24 2.51-8.48 6H3l-1 2h4.06c-.04.33-.06.66-.06 1s.02.67.06 1H3l-1 2h4.52c1.24 3.49 4.56 6 8.48 6 2.31 0 4.41-.87 6-2.3l-1.78-1.77c-1.13.98-2.6 1.57-4.22 1.57z"/>',
  input: '<path d="M21 3.01H3c-1.1 0-2 .9-2 2V9h2V4.99h18v14.03H3V15H1v4.01c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98v-14c0-1.11-.9-2-2-2zM11 16l4-4-4-4v3H1v2h10v3z"/>',
  update: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
  translate: '<path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>',
  renew: '<path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/>',
  phone: '<path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>',
  grid: '<path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>',
  ball: '<path d="M12 3a9 9 0 0 0-9 9h5.2a3.9 3.9 0 0 1 7.6 0H21a9 9 0 0 0-9-9z"/>' +
    '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  chart: '<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>',
  star: '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>'
};

// Schlüssel = Dateiname, muss zu DASH_BUTTONS in src/Code.gs passen
const BUTTONS = [
  { key: 'erfassen', label: 'Karten erfassen', icon: 'add', kind: 'primary' },
  { key: 'preise', label: 'Preise aktualisieren', icon: 'euro' },
  { key: 'import', label: 'Importieren', icon: 'input' },
  { key: 'updates', label: 'Updates', icon: 'update' },
  { key: 'sets', label: 'Sets und Übersetzung', icon: 'translate' },
  { key: 'ansicht', label: 'Ansicht neu aufbauen', icon: 'renew' },
  { key: 'handy', label: 'Handy-Link', icon: 'phone' },
  { key: 'sammlung', label: 'Sammlung', icon: 'grid', kind: 'nav' },
  { key: 'pokedex', label: 'Pokédex', icon: 'ball', kind: 'nav' },
  { key: 'verlauf', label: 'Verlauf', icon: 'chart', kind: 'nav' },
  { key: 'seltenheiten', label: 'Seltenheiten', icon: 'star', kind: 'nav' }
];

// Farben der Knöpfe je Look (die Farben des Blatts stehen in DASH_COLORS in src/Code.gs)
const THEMES = {
  rot: {
    bg: '#fff', fg: '#202124', border: '#dadce0', icoBg: '#fdecea', icoFg: '#c62828',
    primBg: '#c62828', primFg: '#fff', primBorder: '#b71c1c', primIcoBg: 'rgba(255,255,255,.18)',
    navIcoBg: '#f1f3f4', navIcoFg: '#3c4043', chev: '#9aa0a6',
    shadow: '0 1px 2px rgba(60,64,67,.22), 0 1px 3px 1px rgba(60,64,67,.10)'
  },
  dunkel: {
    bg: '#2a2b30', fg: '#e8eaed', border: '#3f4148', icoBg: 'rgba(239,83,80,.16)', icoFg: '#ff6b66',
    primBg: '#d32f2f', primFg: '#fff', primBorder: '#e53935', primIcoBg: 'rgba(255,255,255,.2)',
    navIcoBg: '#3a3b41', navIcoFg: '#e8eaed', chev: '#80868b',
    shadow: '0 1px 2px rgba(0,0,0,.55), 0 1px 3px 1px rgba(0,0,0,.25)'
  },
  neutral: {
    bg: '#fff', fg: '#202124', border: '#dadce0', icoBg: '#e8f0fe', icoFg: '#1a73e8',
    primBg: '#1a73e8', primFg: '#fff', primBorder: '#1967d2', primIcoBg: 'rgba(255,255,255,.2)',
    navIcoBg: '#f1f3f4', navIcoFg: '#3c4043', chev: '#9aa0a6',
    shadow: '0 1px 2px rgba(60,64,67,.22), 0 1px 3px 1px rgba(60,64,67,.10)'
  }
};
const THEME = arg('theme', 'rot');

function page(b, t) {
  t = t || THEMES[THEME];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; }
  .wrap { width: ${W}px; height: ${H}px; padding: 2px 3px 4px; box-sizing: border-box; }
  .btn { height: 100%; border-radius: 10px; display: flex; align-items: center; gap: 12px; padding: 0 14px 0 8px;
    font: 600 15px/1 Inter, 'DejaVu Sans', sans-serif; letter-spacing: -0.1px; box-sizing: border-box;
    background: ${t.bg}; color: ${t.fg}; border: 1px solid ${t.border}; box-shadow: ${t.shadow}; }
  .ico { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: ${t.icoBg}; color: ${t.icoFg}; flex: none; }
  .ico svg { width: 20px; height: 20px; fill: currentColor; }
  .lbl { flex: 1; white-space: nowrap; }
  .chev { color: ${t.chev}; font: 400 22px/1 Inter, sans-serif; margin-top: -2px; }
  .primary { background: ${t.primBg}; color: ${t.primFg}; border-color: ${t.primBorder}; }
  .primary .ico { background: ${t.primIcoBg}; color: ${t.primFg}; }
  .nav .ico { background: ${t.navIcoBg}; color: ${t.navIcoFg}; }
</style></head><body><div class="wrap"><div class="btn ${b.kind || ''}">
  <div class="ico"><svg viewBox="0 0 24 24">${ICONS[b.icon]}</svg></div>
  <div class="lbl">${b.label}</div>${b.kind === 'nav' ? '<div class="chev">›</div>' : ''}
</div></div></body></html>`;
}

async function main() {
  if (!THEMES[THEME]) throw new Error('Unbekannter Look: ' + THEME);
  const { chromium } = require('playwright'); // erst hier: die Tests lesen BUTTONS ohne Playwright
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  for (const b of BUTTONS) {
    await p.setContent(page(b));
    await p.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, b.key + '.png');
    await p.locator('.wrap').screenshot({ path: file, omitBackground: true });
    console.log(file, fs.statSync(file).size, 'Bytes');
  }
  await browser.close();
}

module.exports = { BUTTONS, THEMES, ICONS, page, W, H };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
