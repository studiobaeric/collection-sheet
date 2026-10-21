'use strict';
// RECOG: „Set-Zuordnung vorbelegen“ nie geklickt (Knopf steckt in den Einstellungen) -> Import-Sets leer,
// keine Kürzel. Kürzel-Nummern ohne Set-Text landen in der Prüfliste.
const W = require('./recog_world');
const rows = [
  ['Ditto', 'DS 62', '', '', '6,50 €', '01.10.2026', ''],
  ['Hundemon', 'UD 82', '', '', '0,80 €', '01.10.2026', ''],
  ['Hundemon', 'UD 82', '', '', '0,80 €', '01.10.2026', ''],
  ['Despotar', 'UL 88', '', '', '3,50 €', '01.10.2026', '']
];
[true, false].forEach((prefill) => {
  const env = W.newEnv({ prefill });
  const r = W.run(env, rows);
  console.log('=== vorbelegt: ' + prefill + ' -> ' + JSON.stringify(r.counts));
  W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
  console.log('Import-Sets Zeilen:', env.objects('Import-Sets').length);
});
