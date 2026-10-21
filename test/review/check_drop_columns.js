'use strict';
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;
const hand = C.handRow(env, C.BASE, 1);
C.seed(env, { cfg: { form: 'liste', extras: [{ col: 7, name: 'Ordner', show: true }, { col: 8, name: 'Fach', show: false }] },
  items: [C.clear('fpX', 1, C.GLURAK, { extras: { Ordner: 'Blau', Fach: '3' } })] });
env.uiCall('importCommit');
env.uiCall('editEntry', hand, { extras: { Notiz: 'Geschenk' } });
console.log('Spalten vorher:', c.extraNames_(), 'Ansicht:', c.getViewExtras_());
env.uiCall('importUndo', 1, {});
console.log('Spalten nachher:', c.extraNames_(), 'Ansicht:', c.getViewExtras_());
console.log('Hand-Zeile:', JSON.stringify(env.data().map(r => [r.eid, r.count, r.extras])));
console.log('Gruppen-Kopf:', env.values('Gruppen')[0].slice(22));
