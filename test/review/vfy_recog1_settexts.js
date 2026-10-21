'use strict';
// Verify RECOG-1: which Set texts for promo numbers lead to a wrong 'eindeutig' card? Also check parseSetNumber_ directly.
const W = require('./recog_world');
const texts = ['', 'HGSS Black Star Promos', 'HGSS Promos', 'Black Star Promos', 'Promo', 'HeartGold & SoulSilver',
  'HeartGold SoulSilver Promo', 'HeartGold & SoulSilver Black Star Promos'];
const dpTexts = ['', 'DP Black Star Promos', 'DP Promos', 'Diamant & Perl', 'Diamant & Perl Promos', 'Diamant & Perl Black Star Promos', 'Promos'];
[true, false].forEach((prefill) => {
  const env = W.newEnv({ prefill });
  const rows = texts.map((t) => ['Ho-Oh', 'HGSS 01', '', t, '5,00 €', '01.10.2026', ''])
    .concat(dpTexts.map((t) => ['Lucario', 'DP 16', '', t, '4,00 €', '01.10.2026', '']))
    .concat(dpTexts.map((t) => ['Plaudagei', 'DP12', '', t, '1,00 €', '01.10.2026', '']))
    .concat([['Mega-Lucario-ex', 'MEP 091', '', 'Mega-Entwicklung', '9,00 €', '01.10.2026', ''],
      ['Mega-Lucario-ex', 'MEP 091', '', 'MEP Black Star Promos', '9,00 €', '01.10.2026', ''],
      ['Mega-Lucario-ex', 'MEP 091', '', '', '9,00 €', '01.10.2026', '']]);
  const r = W.run(env, rows);
  console.log('=== prefill ' + prefill);
  W.brief(r.items).forEach((b) => {
    const wrong = b[4] === 'eindeutig' && b[5].indexOf('(' + b[0] + ')') < 0;
    console.log((wrong ? 'WRONG ' : '      ') + JSON.stringify(b.slice(0, 7)));
  });
  const idx = env.ctx.loadCmSets_();
  console.log('ps DP 16 / Diamant & Perl Promos:', JSON.stringify(env.ctx.parseSetNumber_('Diamant & Perl Promos', 'DP 16', idx)));
});
