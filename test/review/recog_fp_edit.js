'use strict';
// RECOG: Fingerabdruck hängt an jedem Text der Zeile. Eric ergänzt in der Quelle ein leeres Set-Feld bzw.
// einen Link (oder fügt einen Begriff hinzu) und importiert wieder mit „Nur Neues“.
const W = require('./recog_world');
const CM = W.CM;

const V1 = [
  ['Hundemon', '82', '', '', '0,80 €', '01.10.2026', ''],                 // Set leer (eine der 3 leeren Zellen)
  ['Despotar', '88', '', 'Entfesselt', '3,50 €', '01.10.2026', ''],      // noch ohne Link
  ['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', '']
];
const V2 = [
  ['Hundemon', '82', '', 'Unerschrocken', '0,80 €', '01.10.2026', ''],   // Set nachgetragen
  ['Despotar', '88', CM + 'Unleashed/Tyranitar-UL88', 'Entfesselt', '3,50 €', '01.10.2026', ''], // Link nachgetragen
  ['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', '']
];

const env = W.newEnv();
const c = env.ctx;
let r = W.run(env, V1, 'neu', 'SRCFP00001');
console.log('--- Import 1 Erkennung'); W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
// Lucario Promo in der Prüfliste entscheiden
const luc = r.items.find((i) => i.values.name === 'Lucario Promo');
env.uiCall('importReviewDecide', luc.fp, { type: 'karte', id: 'dpp-DP16', lang: 'de' });
let pv = env.uiCall('importBuildPreview');
const res = env.uiCall('importCommit', {});
console.log('Import 1:', res.message || JSON.stringify(res.counts));
const count = () => env.data().map((d) => [d.name, d.id, d.count, d.origin]);
console.log('Daten nach Import 1:', JSON.stringify(count()));

// Eric verkauft Despotar (−1 von Hand) -> soll bei späteren Importen wegbleiben
const desp = env.data().find((d) => d.id === 'hgss2-88');
try { env.uiCall('adjustEntry', desp.eid, -1); } catch (e) { console.log('adjustEntry:', e.message); }
console.log('Daten nach Verkauf:', JSON.stringify(count()));

// Eric bearbeitet seine Liste und importiert wieder (Standard: Nur Neues)
// Begriff „Promo“ als Ignorieren, damit „Lucario Promo“ künftig erkannt wird
const sh = env.sheet('Import-Begriffe');
sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([['Promo', 'Ignorieren', '', 'Name und Spalten']]);

r = W.run(env, V2, 'neu', 'SRCFP00001');
console.log('--- Import 2 Erkennung (Nur Neues)'); W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
pv = env.uiCall('importBuildPreview');
console.log('Vorschau 2 counts:', JSON.stringify(pv.counts));
console.log('Vorschau 2 added:', JSON.stringify(pv.added.map((a) => [a.title, a.qty, a.newGroup])));
console.log('Vorschau 2 removedByYou:', JSON.stringify(pv.removedByYou));
