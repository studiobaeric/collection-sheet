'use strict';
// Startet alle Test-Suiten nacheinander (Aufruf: npm test). Die Skripte unter test/review/ sind
// Nachstellungen aus Code-Reviews und laufen nicht mit, einige sind absichtlich rot (siehe docs/FIXLOG.md).
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  'shared_smoke', 'check_import', 'test_core', 'test_integration', 'test_import_quelle', 'test_import_erkennung',
  'test_import_protokoll', 'test_import_e2e', 'test_review_fixes', 'test_pokedex', 'ui_test2', 'importui_test',
  'test_import_ui_e2e', 'test_update', 'test_dashboard', 'test_kartenverlauf', 'test_speichern'
];

let failed = 0;
for (const name of SUITES) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], { encoding: 'utf8' });
  const tail = String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-1)[0] || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' (' + (Date.now() - t0) + ' ms) ' + tail);
  if (!ok) console.log(String(r.stdout || '').split('\n').filter(l => /FAIL|✗|Error|fehl/i.test(l)).slice(0, 20).join('\n'));
}
console.log(failed ? failed + ' Suite(n) fehlgeschlagen' : 'Alle ' + SUITES.length + ' Suiten grün');
process.exit(failed ? 1 : 0);
