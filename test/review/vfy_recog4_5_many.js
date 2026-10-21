'use strict';
// Verify RECOG-4 / RECOG-5 with many same-named cards (like real tcgdex) and no prefill.
const W = require('./recog_world');
const NORMAL = { normal: true, reverse: true, holo: false, firstEdition: false };
const extraSets = {}, extraCards = [];
for (let i = 1; i <= 30; i++) {
  const id = 'zz' + i;
  extraSets[id] = { en: 'Filler ' + i, de: 'Füller ' + i, official: 100, total: 100, date: '2015-01-0' + (i % 9 + 1) };
  extraCards.push([id + '-' + (10 + i), 'Ditto', 'Ditto', NORMAL, { trend: 1, holo: 1 }]);
}
[true, false].forEach((prefill) => {
  const env = W.newEnv({ prefill, extraSets, extraCards });
  const r = W.run(env, [['Ditto', 'DS 62', '', '', '6,50 €', '01.10.2026', '']]);
  console.log('=== prefill ' + prefill);
  W.brief(r.items).forEach((b) => console.log(JSON.stringify(b.slice(0, 7)), 'cands:', (r.items[0].candidates || []).length));
  const it = r.items[0];
  if (it.status !== 'eindeutig') {
    [{}, { name: 'Ditto', number: 'DS 62', set: 'Delta Species' }, { name: 'Ditto', number: '62', set: 'Delta Species' }].forEach((q) => {
      try {
        const s = env.uiCall('importReviewSearch', it.fp, q);
        console.log(' search', JSON.stringify(q), '->', s.stage, (s.cards || []).map((c) => c.id).join(','), s.number || '', (s.notes || []).join(' | '));
        if (s.stage === 'pickSet') {
          try { console.log('  pick ex11 ->', env.uiCall('getCardBySetNumber', 'ex11', s.number).id); }
          catch (e) { console.log('  pick ex11 throws:', e.message); }
        }
      } catch (e) { console.log(' search throws', e.message); }
    });
  }
});
