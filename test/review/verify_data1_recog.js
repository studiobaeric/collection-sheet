'use strict';
// Verifikation DATA-1: Erkennung markiert eine Zeile aus einem ANDEREN Tab derselben Datei als 'bekannt'.
const C = require('./common');
const env = C.mkEnv();
const c = env.ctx;
C.seed(env, { tab: 'Tabellenblatt1', items: [C.clear('fpX', 1, C.GLURAK)] });
env.uiCall('importCommit');
// Tab 2, Stufe Erkennung, Zeile offen
const it = C.clear('fpX', 1, C.GLURAK);
it.status = 'offen'; it.card = null;
C.seed(env, { tab: 'Bulk + Sammlung', stage: 'erkennung', items: [it] });
const d = c.importDraft_(); d.recognizePos = 0; c.importSaveDraft_(d);
const r = env.uiCall('importRecognizeStep');
console.log('Erkennung Tab 2:', JSON.stringify(r.counts));
const rv = c.reviewRead_();
console.log('Status fpX:', rv[0].status, '/', rv[0].reason);
console.log('Importe:', JSON.stringify(env.uiCall('importList').map(i => [i.nr, i.tab, i.sourceId])));
