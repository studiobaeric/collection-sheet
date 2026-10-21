'use strict';
// DATA: Anzahl einer Import-Zeile direkt im Blatt Daten erhöht -> Zurücknehmen löscht die Zeile ohne Nachfrage,
// die von Eric dazugezählten Exemplare verschwinden (Anzahl gilt nicht als Änderung).
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.seed(env, { items: [C.clear('fpX', 1, C.GLURAK)] });
env.uiCall('importCommit');
const r = env.data().find(x => x.fp === 'fpX');
env.sheet('Daten').getRange(r.row, 14).setValue(3);          // Eric tippt 3 statt 1 (zwei weitere gefunden)
c.onEdit({ range: env.sheet('Daten').getRange(r.row, 14) });
console.log('Sammlung vorher:', c.searchCollection('Glurak', '').groups[0].count);
const pv = env.uiCall('importUndoPreview', 1);
console.log('Undo-Vorschau: loeschen', pv.counts.loeschen, ' zur Entscheidung', pv.changed.length);
env.uiCall('importUndo', 1, {});
const left = C.sum(env.data().filter(x => x.id === 'swsh3-025'), x => x.count);
console.log(left === 2 ? 'OK' : 'BUG: nach dem Zurücknehmen bleiben ' + left + ' Glurak, die 2 von Eric dazugetippten sind ohne Nachfrage weg');
