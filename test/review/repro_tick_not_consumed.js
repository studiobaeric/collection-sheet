'use strict';
// DATA: „trotzdem übernehmen“ (Haken bei „Von dir entfernt“) verbraucht den handentfernt-Eintrag nicht.
// Beim nächsten Import zählt die schon zurückgeholte Entnahme weiter als Abdeckung: ein echtes neues Exemplar
// wird nicht übernommen und als „Von dir entfernt“ angeboten.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
env.uiCall('importCommit');                                  // Import 1: 3
const row = env.data().find(r => r.fp === 'fpX');
env.uiCall('adjustEntry', row.eid, -1);                      // Eric nimmt eins raus (handentfernt 1)
C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
let pv = env.uiCall('importBuildPreview');
console.log('Import 2 Vorschau: removedByYou', JSON.stringify(pv.removedByYou.map(x => x.qty)), 'kopien', pv.counts.kopien);
env.uiCall('importCommit', { removed: { fpX: true } });       // Haken: doch übernehmen
console.log('nach Import 2 (Haken): Exemplare', C.sum(env.data().filter(r => r.fp === 'fpX'), r => r.count), '(Quelle 3)');

// Eric kauft ein viertes und trägt 4 in der Quelle ein
C.seed(env, { items: [C.clear('fpX', 4, C.GLURAK)] });
pv = env.uiCall('importBuildPreview');
console.log('Import 3 (Quelle 4): kopien', pv.counts.kopien, ' removedByYou', JSON.stringify(pv.removedByYou.map(x => x.qty)));
const cov = c.coverageFor_('SRC1').fpX;
console.log('Abdeckung:', JSON.stringify({ D: cov.D, Rall: cov.Rall, Rundone: cov.Rundone, held: cov.held }));
env.uiCall('importCommit');
const n = C.sum(env.data().filter(r => r.fp === 'fpX'), r => r.count);
console.log(n === 4 ? 'OK' : 'BUG: nach Import 3 hat die Sammlung ' + n + ' statt 4; das neue Exemplar steht unter „Von dir entfernt“');
