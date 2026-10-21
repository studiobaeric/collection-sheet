'use strict';
// Verifikation DATA-3 über den normalen Weg: +1 in der Seitenleiste (Hand-Zeile), Quelle nachgezogen,
// Nur Neues mit „Dieselbe Karte“ (vorgewählt), später Abgleich nach unten.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;
const total = () => C.sum(env.data().filter(r => r.id === 'swsh3-025' && r.variant !== 'reverse'), r => r.count);
C.seed(env, { items: [C.clear('fpX', 2, C.GLURAK)] });
env.uiCall('importCommit');
const row = env.data().find(r => r.fp === 'fpX');
const adj = env.uiCall('adjustEntry', row.eid, 1);      // +1 -> Hand-Zeile
console.log('nach +1:', total(), JSON.stringify(env.data().map(r => [r.origin, r.count])));
C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });   // Quelle auf 3 nachgezogen
let pv = env.uiCall('importBuildPreview');
console.log('Import 2 Vorschau: handMatch', JSON.stringify(pv.handMatch.map(h => [h.qty, h.handCount, h.choice])), 'kopien', pv.counts.kopien);
env.uiCall('importCommit');
console.log('nach Import 2:', total());
C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 2, C.GLURAK)] }); // verkauft, Quelle 2
pv = env.uiCall('importBuildPreview');
console.log('Abgleich Vorschau weniger', pv.counts.weniger);
env.uiCall('importCommit');
console.log('nach Abgleich (Quelle 2):', total(), total() === 2 ? 'OK' : 'BUG');
