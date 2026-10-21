'use strict';
// Schreibzugriffe ohne Sperre in den öffentlichen Funktionen von Code.gs (Sammlung, Preislauf, onEdit).
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;
const v = [];
let current = '';
const sheet0 = env.ss.getSheets()[0];
const SheetP = Object.getPrototypeOf(sheet0);
const RangeP = Object.getPrototypeOf(sheet0.getRange(1, 1));
function wrap(P, names, sheetOf) {
  names.forEach(m => {
    const o = P[m]; if (typeof o !== 'function') return;
    P[m] = function (...a) {
      const sh = sheetOf(this);
      if (current && env.lock.depth === 0 && sh && sh.name !== 'Sets') v.push(current + ': ' + m + ' auf ' + sh.name);
      return o.apply(this, a);
    };
  });
}
wrap(RangeP, ['setValues', 'setNumberFormats', 'clearContent', 'clear', 'setFormula'], r => r.sh);
wrap(SheetP, ['insertRowsAfter', 'deleteRows', 'deleteColumns', 'insertColumnsAfter', 'appendRow'], s => s);
function run(name, fn) { current = name; try { return fn(); } catch (e) { console.log(name, 'wirft', e.message); } finally { current = ''; } }

const a = run('addCard', () => env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 }));
const g = run('searchCollection', () => env.uiCall('searchCollection', '', ''));
run('getUiConfig', () => env.uiCall('getUiConfig'));
const adj = run('adjustEntry', () => env.uiCall('adjustEntry', a.eid, -1));
run('revertAdjust', () => env.uiCall('revertAdjust', adj.token));
run('editEntry', () => env.uiCall('editEntry', a.eid, { cond: 'LP' }, 1));
run('setGroupOwnPrice', () => env.uiCall('setGroupOwnPrice', a.gkey, '3,10'));
const f = run('addFreeCard', () => env.uiCall('addFreeCard', { name: 'Testkarte', setName: 'X', number: '1/10' }));
run('linkFreeGroup', () => env.uiCall('linkFreeGroup', f.gkey, 'swsh3-025', 'de', 'base'));
run('setViewExtras', () => env.uiCall('setViewExtras', []));
run('onEdit(Daten)', () => c.onEdit({ range: env.sheet('Daten').getRange(2, 13) }));
run('naechtlicherPreislauf', () => c.naechtlicherPreislauf());
run('ansichtNeuAufbauen', () => c.ansichtNeuAufbauen());
console.log(v.length ? 'Schreibzugriffe ohne Sperre:\n  ' + [...new Set(v)].join('\n  ') : 'keine');
