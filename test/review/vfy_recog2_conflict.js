'use strict';
// Verify RECOG-2: stage 2/3 hit is taken without comparing the row name; also code in number vs. Set text.
const W = require('./recog_world');
const extra = { extraCards: [['hgss1-82', 'Quapsel', 'Poliwag', { normal: true, reverse: true }, { trend: 0.1, holo: 0.3 }]] };
const env = W.newEnv(extra);
const r = W.run(env, [
  ['Hundemon', 'UD 82', '', 'HeartGold & SoulSilver', '0,80 €', '01.10.2026', ''],          // Kürzel UD sagt Unerschrocken
  ['Hundemon', '82', '', 'HeartGold & SoulSilver', '0,80 €', '01.10.2026', ''],
  ['Hundemon', '82', W.CM + 'Undaunted/Houndoom-UD82', 'HeartGold & SoulSilver', '0,80 €', '01.10.2026', ''], // Link gewinnt
  ['Hundemon', '82', W.CM + 'Unleashed/Tyranitar-UL88', '', '0,80 €', '01.10.2026', ''] // Link einer anderen Karte
]);
W.brief(r.items).forEach((b) => console.log(JSON.stringify(b.slice(0, 7))));
const pv = env.uiCall('importBuildPreview');
console.log('preview added:', JSON.stringify(pv.added.map((a) => [a.title, a.sub, a.qty])));
