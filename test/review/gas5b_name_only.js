'use strict';
// GAS-5b: Name mit internem Link, ohne Nummer / ohne Set. Erfundene Daten.
const { mkEnv } = require('./common');
function run(label, values, links) {
  const env = mkEnv();
  const ID = 'GSHEETLINKS0002';
  env.addSource({ id: ID, name: 'Testliste', mime: 'sheet', tabs: { Karten: { values, links } } });
  env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/d/' + ID + '/edit');
  const s = env.uiCall('importSelectTab', 'Karten');
  env.fetchLog.length = 0;
  env.uiCall('importStartRecognition', s.cfg, '', 'alle');
  let r, g = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && g++ < 100);
  console.log('[' + label + '] Erkennung:', JSON.stringify(r.counts));
  console.log('[' + label + '] Abrufe:', JSON.stringify(env.fetchLog.map(f => String(f.url || f).replace('https://api.tcgdex.net/v2/', ''))).slice(0, 400));
  const pruef = env.objects('Import-Prüfung');
  console.log('[' + label + '] Prüfung:', JSON.stringify(pruef.map(p => [p.Status, p.Grund, p.Name || p.name || ''])).slice(0, 500));
}
const V = [['Name', 'Set'], ['Glurak', 'Grundset'], ['Mewtu', 'Old Set']];
run('ohne Links', V, {});
run('Name mit #gid', V, { '2,1': '#gid=123456&range=A5', '3,1': '#gid=9&range=C3' });
const V2 = [['Name', 'Nr.'], ['Glurak', '4/102'], ['Glurak', '25/189']];
run('Name+Nr ohne Set, ohne Links', V2, {});
run('Name+Nr ohne Set, #gid im Namen', V2, { '2,1': '#gid=1&range=A5', '3,1': 'mailto:x@example.org' });
