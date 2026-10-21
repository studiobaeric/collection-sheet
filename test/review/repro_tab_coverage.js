'use strict';
// DATA: Abdeckung hängt nur an der Datei (Quelle-ID), nicht am Tab. Ein zweiter Tab derselben Datei
// gilt als „schon importiert“ (Nur Neues) bzw. nimmt beim Abgleich alles aus dem ersten Tab weg.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

// Tab 1 (Ordner): 1x Glurak, 1x Glurak Reverse
C.seed(env, { tab: 'Tabellenblatt1', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpY', 1, C.GLURAK_REV)] });
env.uiCall('importCommit');
C.show(env, 'nach Import 1 (Tab Tabellenblatt1)');

// Tab 2 derselben Datei (Bulk + Sammlung): noch ein Glurak (gleicher Fingerabdruck) und ein Basis-Glurak
C.seed(env, { tab: 'Bulk + Sammlung', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
let pv = env.uiCall('importBuildPreview');
console.log('Nur Neues, Tab 2: kopien =', pv.counts.kopien, 'bekannt =', pv.counts.bekannt, 'added =', JSON.stringify(pv.added.map(a => [a.title, a.sub, a.qty])));
// Erkennung würde fpX schon vorher als 'bekannt' markieren:
const cov = c.coverageFor_('SRC1');
console.log('coverageFor_(SRC1).fpX =', JSON.stringify({ D: cov.fpX.D, held: cov.fpX.held }), '-> Erkennung setzt Status bekannt');

// Abgleich mit Tab 2
C.seed(env, { tab: 'Bulk + Sammlung', mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
pv = env.uiCall('importBuildPreview');
console.log('Abgleich, Tab 2: weniger =', pv.counts.weniger, JSON.stringify(pv.decreased.map(d => [d.title, d.sub, d.qty, 'aus Import ' + d.fromImport])));
env.uiCall('importCommit');
C.show(env, 'nach Abgleich mit Tab 2');
const rev = env.data().find(r => r.fp === 'fpY');
console.log(rev.count === 1 ? 'OK' : 'BUG: Glurak Reverse aus Tabellenblatt1 steht auf ' + rev.count + ', weil er in Tab 2 fehlt');
