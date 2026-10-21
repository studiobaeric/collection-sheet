'use strict';
// Verifikation DATA-1, realistischere Richtung: Tab 1 und Tab 2 (verschiedene Karten) importiert,
// danach Abgleich mit Tab 1 -> nimmt alle Karten aus Tab 2 weg?
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;
C.seed(env, { tab: 'Tabellenblatt1', items: [C.clear('fpX', 1, C.GLURAK)] });
env.uiCall('importCommit');
C.seed(env, { tab: 'Bulk + Sammlung', items: [C.clear('fpZ', 2, C.BASE), C.clear('fpY', 1, C.GLURAK_REV)] });
env.uiCall('importCommit');
C.show(env, 'nach Import 1 (Tab 1) und Import 2 (Tab 2)');
// Eric verkauft nichts, gleicht Tab 1 ab (unverändert)
C.seed(env, { tab: 'Tabellenblatt1', mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
const pv = env.uiCall('importBuildPreview');
console.log('Abgleich Tab 1 (unverändert): weniger =', pv.counts.weniger, JSON.stringify(pv.decreased.map(d => [d.title, d.qty, 'aus Import ' + d.fromImport])));
env.uiCall('importCommit');
C.show(env, 'nach Abgleich Tab 1');
const left = C.sum(env.data().filter(r => r.fp === 'fpZ' || r.fp === 'fpY'), r => r.count);
console.log(left === 3 ? 'OK' : 'BUG: Karten aus Tab 2 stehen jetzt auf ' + left + ' statt 3');
// Rueckgaengig moeglich?
const u = env.uiCall('importUndo', 3, {});
console.log('Undo Import 3:', u.message);
console.log('nach Undo:', C.sum(env.data().filter(r => r.fp === 'fpZ' || r.fp === 'fpY'), r => r.count));
