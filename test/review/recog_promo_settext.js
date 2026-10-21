'use strict';
// RECOG: Promo-Nummer ("HGSS 01", "DP 16", "MEP 091") plus Set-Text, der ein normales Set meint.
const W = require('./recog_world');

const rows = [
  ['Ho-Oh', 'HGSS 01', '', 'HeartGold & SoulSilver', '5,00 €', '01.10.2026', ''],
  ['Ho-Oh', 'HGSS 01', '', 'HeartGold & SoulSilver Promo', '5,00 €', '01.10.2026', ''],
  ['Lucario', 'DP 16', '', 'Diamant & Perl Promos', '4,00 €', '01.10.2026', ''],
  ['Plaudagei', 'DP12', '', 'Diamant & Perl', '1,10 €', '01.10.2026', ''],
  ['Mega-Lucario-ex', 'MEP 091', '', 'Mega-Entwicklung', '9,00 €', '01.10.2026', ''],
  ['Ho-Oh', 'HGSS 01', '', '', '5,00 €', '01.10.2026', ''] // Kontrolle: ohne Set-Text richtig
];
[true, false].forEach((prefill) => {
  const env = W.newEnv({ prefill });
  const r = W.run(env, rows);
  console.log('=== Import-Sets vorbelegt: ' + prefill);
  W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
});
