'use strict';
// DATA: Zurücknehmen bricht nach rewriteData_ ab (vor dem Status 'zurückgenommen'); zweiter Versuch stellt Abgleich doppelt her.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;

C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
env.uiCall('importCommit');                       // Import 1: 3x Glurak
C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
env.uiCall('importCommit');                       // Import 2 (Abgleich): 2 weniger -> Zeile hat 1
C.show(env, 'vor dem Zurücknehmen von Import 2');

const orig = c.prWriteImport_;
let crashed = false;
c.prWriteImport_ = function (o) {
  if (!crashed && o.status === 'zurückgenommen') { crashed = true; throw new Error('Service Spreadsheets timed out (Test)'); }
  return orig(o);
};
try { env.uiCall('importUndo', 2, {}); } catch (e) { console.log('1. Versuch:', e.message); }
c.prWriteImport_ = orig;
C.show(env, 'nach dem Abbruch');
console.log('Status in importList:', env.uiCall('importList').map(i => i.nr + ':' + i.status).join(', '));
const res = env.uiCall('importUndo', 2, {});
console.log('2. Versuch:', res.message);
C.show(env, 'nach dem zweiten Versuch');
const n = C.sum(env.data().filter(r => r.fp === 'fpX'), r => r.count);
console.log(n === 3 ? 'OK: 3 Exemplare' : 'BUG: ' + n + ' Exemplare statt 3 (Abgleich doppelt zurückgesetzt)');
