'use strict';
// Verify RECOG-3 without any edit of the source: (a) only a new term in Import-Begriffe, (b) only a changed fixed value.
const W = require('./recog_world');
const ROWS = [
  ['Hundemon', '82', '', 'Unerschrocken', '0,80 €', '01.10.2026', ''],
  ['Despotar', '88', '', 'Entfesselt', '3,50 €', '01.10.2026', ''],
  ['Lucario Promo', 'DP 16', '', 'DP Black Star Promos', '4,00 €', '01.10.2026', '']
];
function runCfg(env, rows, sourceId, tweak) {
  env.addSource({ id: sourceId, name: 'Pokemon Ordner.xlsx', mime: 'sheet', tabs: { Tabellenblatt1: [W.HEAD].concat(rows) } });
  env.uiCall('importOpenSource', sourceId);
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  const cfg = JSON.parse(JSON.stringify(s.cfg));
  if (tweak) tweak(cfg);
  env.uiCall('importStartRecognition', cfg, '', 'neu');
  let r, n = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && n++ < 50);
  return env.ctx.reviewRead_();
}
function scenario(label, tweakEnv, tweakCfg) {
  const env = W.newEnv();
  const items = runCfg(env, ROWS, 'SRCVFY0001');
  items.filter((i) => i.status !== 'eindeutig').forEach((i) => console.log('review open in import 1:', i.values.name, i.status));
  env.uiCall('importBuildPreview');
  env.uiCall('importCommit', {});
  const desp = env.data().find((d) => d.id === 'hgss2-88');
  env.uiCall('adjustEntry', desp.eid, -1); // verkauft
  if (tweakEnv) tweakEnv(env);
  const items2 = runCfg(env, ROWS, 'SRCVFY0001', tweakCfg);
  console.log('=== ' + label);
  console.log(' import 2 statuses:', JSON.stringify(items2.map((i) => [i.values.name, i.status])));
  const pv = env.uiCall('importBuildPreview');
  console.log(' preview counts:', JSON.stringify(pv.counts));
  console.log(' added:', JSON.stringify(pv.added.map((a) => [a.title, a.qty])), ' removedByYou:', JSON.stringify(pv.removedByYou.map((x) => x.title)));
}
scenario('control: nothing changed', null, null);
scenario('only new term "Promo"/Ignorieren', (env) => {
  const sh = env.sheet('Import-Begriffe');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([['Promo', 'Ignorieren', '', 'Name und Spalten']]);
}, null);
scenario('only fixed cond NM in the wizard', null, (cfg) => { cfg.fixed = Object.assign({}, cfg.fixed, { cond: 'NM' }); });
