'use strict';
// GAS-3: Kopfzeile einer Zusatzspalte wird ohne '@' geschrieben und von Sheets typisiert.
// Harness typisiert ISO-Datum 'yyyy-mm-dd' (echtes Sheets auch, in jeder Sprache). Erfundene Daten.
const { mkEnv, seed, clear, GLURAK, BASE } = require('./common');
function run(name) {
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { cfg: { form: 'liste', extras: [{ col: 6, name, show: false }] }, items: [
    clear('fpA', 1, GLURAK, { extras: { [name]: 'Wert A' } }),
  ] });
  env.uiCall('importCommit');
  const hdr = env.values('Daten')[0];
  console.log('[' + name + '] Kopfzeile ab 31:', JSON.stringify(hdr.slice(30)), 'Typ:', typeof hdr[30], hdr[30] instanceof Date ? 'Date' : '');
  console.log('[' + name + '] extraNames_:', JSON.stringify(c.extraNames_()));
  console.log('[' + name + '] Werte Spalte 31:', JSON.stringify(env.values('Daten').slice(1).filter(r => r[0]).map(r => r[30])));
  seed(env, { sourceId: 'SRC2', cfg: { form: 'liste', extras: [{ col: 6, name, show: false }] }, items: [
    clear('fpB', 1, BASE, { extras: { [name]: 'Wert B' } }),
  ] });
  env.uiCall('importCommit');
  console.log('[' + name + '] nach 2. Import Kopfzeile ab 31:', JSON.stringify(env.values('Daten')[0].slice(30)));
  try {
    const pv = env.uiCall('importUndoPreview', 2);
    console.log('[' + name + '] Undo-Vorschau geändert:', JSON.stringify((pv.changed || []).map(x => [x.eid, x.title || '', x.what || x.changes || ''])).slice(0, 300));
    const dec = {}; (pv.changed || []).forEach(x => { dec[x.eid] = 'remove'; });
    const res = env.uiCall('importUndo', 2, dec);
    console.log('[' + name + '] Undo:', res.message);
  } catch (e) { console.log('undo err', e.message); }
  console.log('[' + name + '] nach Undo Import 2 Kopfzeile ab 31:', JSON.stringify(env.values('Daten')[0].slice(30)));
}
run('Ordner');
run('2026-10-01');
