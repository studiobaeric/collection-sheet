'use strict';
// DATA: Abgleich vergleicht nur held (Import-Zeilen) mit der Quelle; per „Dieselbe Karte“ gezählte Hand-Exemplare fehlen.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.handRow(env, C.GLURAK, 1);                            // Eric hat 1 Glurak von Hand (Testkarte)
C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 3, C.GLURAK)] });
let pv = env.uiCall('importBuildPreview');
console.log('Import 1 Vorschau handMatch:', JSON.stringify(pv.handMatch.map(h => [h.qty, h.handCount, h.choice])));
env.uiCall('importCommit', { hand: { fpX: 'same' } }); // Dieselbe Karte: 1 gleich + 2 neu
C.show(env, 'nach Import 1 (Quelle sagt 3)');
console.log('Sammlung Anzahl:', c.searchCollection('Glurak', '').groups[0].count);

// Eric verkauft einen und trägt in der Quelle 2 ein, dann Abgleich
C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 2, C.GLURAK)] });
pv = env.uiCall('importBuildPreview');
console.log('Abgleich Vorschau: weniger =', pv.counts.weniger, ', neu =', pv.counts.kopien);
env.uiCall('importCommit');
const total = c.searchCollection('Glurak', '').groups[0].count;
C.show(env, 'nach Abgleich (Quelle sagt 2)');
console.log(total === 2 ? 'OK' : 'BUG: Sammlung zeigt ' + total + ' Glurak, die Quelle sagt 2');

C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
env.uiCall('importCommit');
const total2 = c.searchCollection('Glurak', '').groups[0].count;
console.log(total2 === 1 ? 'OK' : 'BUG: nach Abgleich auf 1 zeigt die Sammlung ' + total2);
