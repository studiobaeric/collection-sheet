'use strict';
// GAS-2: alte (versionierte) Web-App-Bereitstellung läuft nach „Einrichtung“ mit v1-Code weiter. Erfundene Daten.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../harness2');
const ROOT = path.join(__dirname, '..', '..');
const env = H.createEnv({ files: [] });
const SERVICES = Object.assign({}, env.ctx);
function loadCode(dir, files) {
  const ctx = Object.assign({}, SERVICES);
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
const DB = env.DB;
function addDb(id, de, extra) {
  const set = id.slice(0, id.lastIndexOf('-'));
  ['de', 'en'].forEach(l => {
    DB[l + '/cards/' + id] = H.card(id, l, Object.assign({ name: de, set: { id: set, name: 'Set ' + set, cardCount: { official: 100 } } }, extra || {}));
    DB[l + '/sets/' + set] = DB[l + '/sets/' + set] || { id: set, name: 'Set ' + set, releaseDate: '2003-01-01', cards: [] };
    DB[l + '/sets/' + set].cards.push({ id, localId: id.split('-').pop(), name: de });
  });
}
addDb('neo4-3', 'Celebi', { variants: { holo: true, normal: false, reverse: false, firstEdition: true }, pricing: { cardmarket: { trend: 12.4, 'trend-holo': 20, updated: '2026-10-10T00:00:00Z' } } });

const old = loadCode(path.join(ROOT, 'backup'), ['Code.gs']);
old.einrichtung();
old.addCard({ id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
console.log('v1 Daten Spalte A:', env.values('Daten').slice(1).filter(r => r[0]).map(r => r[0]));

const neu = loadCode(path.join(ROOT, 'src'), ['Code.gs', 'Import.gs']);
env.ui.alerts.length = 0;
neu.einrichtung();
console.log('Einrichtung-Meldung:', env.ui.alerts.join(' | '));
console.log('  enthält Hinweis auf Neu-Bereitstellung?', /Bereitstell|Web-App|Handy/i.test(env.ui.alerts.join(' ')));
const C = vm.runInContext('COL', neu);
const rows = () => env.values('Daten').slice(1).filter(r => r.some(x => x !== '')).map(r => ({ key: r[C.key], eid: r[C.eid], origin: r[C.origin], count: r[C.count] }));
console.log('v2 Daten nach Einrichtung:', JSON.stringify(rows()));
const grp = () => env.groups().map(g => JSON.stringify([g.Name || g.name, g.Anzahl]));
console.log('Gruppen:', grp());

// Handy (alte Bereitstellung): Celebi +1 über Hinzufügen
const r1 = old.addCard({ id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
console.log('alte addCard:', JSON.stringify(r1));
console.log('Daten danach:', JSON.stringify(rows()));
console.log('Gruppen danach (kein Rebuild):', grp());
// Nächster Rebuild durch neuen Code
neu.withLock_(function () { neu.rebuildGroups_(); });
console.log('Daten nach Rebuild:', JSON.stringify(rows()));
console.log('Gruppen nach Rebuild:', grp());
const sc = neu.searchCollection('Celebi', '');
console.log('Seitenleiste Gruppe rows:', JSON.stringify(sc.groups.map(g => ({ n: g.name, count: g.count, rows: g.rows.map(r => [r.eid, r.originLabel || r.origin, r.count]) }))));
// Handy alte -1
const verlaufVor = env.values('Verlauf').length;
const histSheets = env.ss.getSheets().map(s => s.getName());
const key = env.values('Daten')[1][0];
const a = old.adjustCount(key, -1);
console.log('alte adjustCount -1:', JSON.stringify(a), 'Gruppen:', grp());
console.log('Blätter:', histSheets.join(','));
