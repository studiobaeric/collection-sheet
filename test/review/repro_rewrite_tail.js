'use strict';
// DATA: rewriteData_ schreibt die Zeilen und leert den Rest in zwei Aufrufen. Stirbt der Lauf dazwischen,
// bleiben alte Zeilen unten stehen; repairRows_ gibt ihnen neue Eintrag-IDs -> doppelte Exemplare.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.seed(env, { items: [C.clear('fpX', 2, C.GLURAK)] });
env.uiCall('importCommit');                    // Import 1: Zeile 2
C.handRow(env, C.BASE, 1);                     // Hand-Zeile danach: Zeile 3
C.show(env, 'vorher');
const sh = env.sheet('Daten');
const origGR = sh.getRange.bind(sh);
let armed = true;
sh.getRange = function (...a) {
  const r = origGR(...a);
  if (armed && a[0] > 2 && a.length >= 3) {
    const oc = r.clearContent.bind(r);
    r.clearContent = function () { if (armed) { armed = false; throw new Error('Zeitlimit überschritten (Test)'); } return oc(); };
  }
  return r;
};
try { env.uiCall('importUndo', 1, {}); } catch (e) { console.log('Zurücknehmen:', e.message); }
sh.getRange = origGR;
c.withLock_(() => c.rebuildGroups_());       // z. B. nächste Aktion in der Seitenleiste
C.show(env, 'nach Abbruch + nächstem Neuaufbau');
console.log('Liste:', JSON.stringify(env.uiCall('importList').map(i => [i.nr, i.status])));
const hand = env.data().filter(r => r.id === 'base1-4');
console.log(hand.length === 1 ? 'OK' : 'BUG: Grundset-Glurak (von Hand, 1 Exemplar) steht jetzt ' + hand.length + '× da, Summe ' + C.sum(hand, r => r.count));
