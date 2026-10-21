'use strict';
// GAS-5: interne Links (#gid=...) und mailto: werden an den Zelltext gehängt. Erfundene Daten.
const { mkEnv } = require('./common');
function run(label, links) {
  const env = mkEnv();
  const ID = 'GSHEETLINKS0001';
  env.addSource({ id: ID, name: 'Testliste', mime: 'sheet', tabs: { Karten: {
    values: [['Name', 'Nr.', 'Set'], ['Glurak', '25', 'Flammende Finsternis'], ['Glurak', '4', 'Grundset'], ['Glurak', '136', 'Flammende Finsternis']],
    links: links } } });
  env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/d/' + ID + '/edit');
  const s = env.uiCall('importSelectTab', 'Karten');
  console.log('[' + label + '] Import-Quelle Spalte A:', JSON.stringify(env.values('Import-Quelle').slice(1, 4).map(r => r[0])));
  console.log('[' + label + '] Spalten geraten:', JSON.stringify(s.guess.cols));
  const pr = env.uiCall('importPreviewRows', s.cfg);
  console.log('[' + label + '] Vorschau name/number:', JSON.stringify(pr.rows.map(r => [r.fields.name, r.fields.number, r.fields.cmUrl || ''])));
  env.uiCall('importStartRecognition', s.cfg, '', 'alle');
  let r, g = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && g++ < 100);
  console.log('[' + label + '] Erkennung:', JSON.stringify(r.counts));
  const pruef = env.objects('Import-Prüfung');
  console.log('[' + label + '] Prüfung:', JSON.stringify(pruef.map(p => Object.keys(p).filter(k => /status|Status|Grund|reason/i.test(k)).map(k => p[k]))).slice(0, 400));
}
run('ohne Links', {});
run('interne Links im Namen', { '2,1': '#gid=123456&range=A5', '3,1': 'mailto:eric@example.org', '4,1': '#gid=0' });
run('interne Links in der Nummer', { '2,2': '#gid=123456&range=A5', '3,2': '#gid=777&range=B2' });
