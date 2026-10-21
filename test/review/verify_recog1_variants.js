'use strict';
// Verifikation RECOG-1: welche plausiblen Set-Texte bei Promo-Nummern führen zu falscher 'eindeutig'-Karte?
const W = require('./recog_world');
const texts = ['HGSS Promos', 'HGSS Black Star Promos', 'HeartGold & SoulSilver Promos', 'HeartGold & SoulSilver', 'Promo', 'Black Star Promo',
  'DP Promos', 'Diamond & Pearl Promos', 'Diamant & Perl', 'DP Black Star Promos',
  'Mega Evolution Promos', 'MEP Promos', 'Mega-Entwicklung Promos', 'Mega-Entwicklung'];
const nums = { HGSS: ['Ho-Oh', 'HGSS 01'], DP: ['Lucario', 'DP 16'], ME: ['Mega-Lucario-ex', 'MEP 091'] };
const rows = [];
texts.forEach((t) => {
  const k = /HGSS|HeartGold/.test(t) ? 'HGSS' : /^DP|Diam/.test(t) ? 'DP' : /Mega|MEP/.test(t) ? 'ME' : null;
  const list = k ? [k] : Object.keys(nums);
  list.forEach((kk) => rows.push([nums[kk][0], nums[kk][1], '', t, '1,00 €', '01.10.2026', '']));
});
[true, false].forEach((prefill) => {
  const env = W.newEnv({ prefill });
  const r = W.run(env, rows);
  console.log('=== prefill ' + prefill);
  W.brief(r.items).forEach((b) => console.log(JSON.stringify(b.slice(0, 7))));
});
