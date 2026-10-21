'use strict';
// GAS-1: Zeile in Daten löschen (Rechtsklick > Zeile löschen) -> nur onChange, kein onEdit. Erfundene Daten.
const { mkEnv, handRow, GLURAK, BASE } = require('./common');
const env = mkEnv();
const c = env.ctx;
handRow(env, GLURAK, 2);
handRow(env, BASE, 1);
const g0 = env.groups().map(g => [g.Name || g.name, g.Anzahl]);
console.log('Gruppen vorher', JSON.stringify(g0));
const d = env.data();
const baseRow = d.findIndex(r => r.id === 'base1-4') + 2;
console.log('lösche Daten-Zeile', baseRow, 'Zeilen vorher', d.length);
env.sheet('Daten').deleteRow(baseRow); // im echten Sheets: kein onEdit, nur onChange REMOVE_ROW
console.log('Daten nachher', env.data().map(r => r.id));
console.log('Gruppen nachher (ohne Rebuild)', JSON.stringify(env.groups().map(g => [g.Name || g.name, g.Anzahl])));
console.log('Trigger', JSON.stringify(env.triggers.map(t => t.fn)));
// Seitenleiste liest Daten direkt:
const sc = c.searchCollection('', '');
console.log('Seitenleiste searchCollection', JSON.stringify(sc.groups.map(g => g.name + ':' + g.count)));
// Gesamtwert in Sammlung (Formel =SUM(I6:I) über Gruppen) bleibt alt bis zum nächsten Rebuild
c.preiseJetztAktualisieren && 0;
