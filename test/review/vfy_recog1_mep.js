'use strict';
// Verify RECOG-1 with Cardmarket-style promo set names ("<Serie> Promos") for MEP.
const W = require('./recog_world');
const env = W.newEnv({});
const rows = ['Mega Evolution Promos', 'Mega-Entwicklung Promos', 'MEP Promos', 'Mega Evolution Black Star Promos']
  .map((t) => ['Mega-Lucario-ex', 'MEP 091', '', t, '9,00 €', '01.10.2026', '']);
const r = W.run(env, rows);
W.brief(r.items).forEach((b) => console.log(JSON.stringify(b.slice(0, 7))));
const idx = env.ctx.loadCmSets_();
['Mega Evolution Promos', 'Diamant & Perl Promos', 'HGSS Promos'].forEach((t) => console.log(t, '->', JSON.stringify(env.ctx.erSetIdsForText_(t, idx))));
