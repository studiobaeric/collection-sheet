'use strict';
// DATA: Commit bricht beim Schreiben des Protokolls ab (Importe-Zeile 'läuft' steht schon, committingNr im Entwurf).
// „Fortsetzen“ meldet „fertig“, setzt 'aktiv' mit den Plan-Zahlen, verwirft den Entwurf – übernommen wurde nichts.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.seed(env, { items: [C.clear('fpX', 2, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
const orig = c.appendProto_;
c.appendProto_ = function (entries) {
  if (entries.some(e => e.status === 'geplant')) throw new Error('Service Spreadsheets failed (Test)');
  return orig(entries);
};
try { env.uiCall('importCommit'); } catch (e) { console.log('Commit:', e.message); }
c.appendProto_ = orig;
console.log('Liste:', JSON.stringify(env.uiCall('importList').map(i => [i.nr, i.status, i.counts.neu])));
console.log('Entwurf da:', !!c.importDraft_(), 'committingNr', c.importDraft_() && c.importDraft_().committingNr);
const r = env.uiCall('importResume', 1);
console.log('Fortsetzen:', r.message);
console.log('Liste:', JSON.stringify(env.uiCall('importList').map(i => [i.nr, i.status, i.counts.neu, i.report])));
console.log('Daten-Zeilen:', env.data().length, ' Protokoll:', env.proto().length, ' Entwurf da:', !!c.importDraft_());
console.log(env.data().length === 0 && !c.importDraft_() ? 'BUG: Import 1 steht als aktiv mit Neu 2 da, nichts wurde übernommen, Entwurf ist weg' : 'OK');
// Nochmal importieren: Coverage leer -> alles neu (das ginge), aber die Prüfliste ist verloren
