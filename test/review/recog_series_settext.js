'use strict';
// RECOG: Set-Spalte nennt die Serie / ein anderes Set als die Karte; Stufe 3 prüft den Namen nicht.
// Dazu: Set ohne deutsche Daten (en-Ersatz) und Link mit unbekanntem Set-Slug.
const W = require('./recog_world');
const extra = {
  extraCards: [
    ['hgss1-82', 'Quapsel', 'Poliwag', { normal: true, reverse: true }, { trend: 0.1, holo: 0.3 }],
    ['ex12-62', 'Kramurx', 'Murkrow', { normal: true, reverse: true }, { trend: 0.4, holo: 0.9 }]
  ],
  extraSets: { ex12: { en: 'Legend Maker', de: 'Legend Maker', official: 92, total: 93, date: '2006-02-01', noDe: true } }
};
const env = W.newEnv(extra);
const r = W.run(env, [
  // Hundemon aus „Unerschrocken“, Eric schreibt die Serie in die Set-Spalte
  ['Hundemon', '82', '', 'HeartGold & SoulSilver', '0,80 €', '01.10.2026', ''],
  // Ditto aus Delta Species, aber Set-Spalte falsch (Legend Maker), Nummer passt dort auf eine andere Karte
  ['Ditto', '62', '', 'Legend Maker', '6,50 €', '01.10.2026', ''],
  // Ho-Oh mit Link, dessen Set-Slug kein tcgdex-Name ist (z. B. „HGSS-Promos“), Set-Spalte = Serie
  ['Ho-Oh', 'HGSS 01', W.CM + 'HGSS-Promos/Ho-Oh-HGSSHGSS01', 'HeartGold & SoulSilver', '5,00 €', '01.10.2026', '']
]);
W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
const env2 = W.newEnv(Object.assign({ prefill: false }, extra));
const r2 = W.run(env2, [['Ho-Oh', 'HGSS 01', W.CM + 'HGSS-Promos/Ho-Oh-HGSSHGSS01', 'HeartGold & SoulSilver', '5,00 €', '01.10.2026', '']]);
console.log('ohne Vorbelegen:'); W.brief(r2.items).forEach((b) => console.log(JSON.stringify(b)));
