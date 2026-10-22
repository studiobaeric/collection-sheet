'use strict';
// Verifikation MIGR-1..6 (nur erfundene Testdaten). Altes backup/Code.gs und neues src/ auf denselben Attrappen.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../harness2');
const ROOT = path.join(__dirname, '..', '..');
const J = x => JSON.stringify(x);

function world() {
  const env = H.createEnv({ files: [] });
  const SERVICES = Object.assign({}, env.ctx);
  const load = (dir, files) => {
    const ctx = Object.assign({}, SERVICES);
    vm.createContext(ctx);
    files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
    return ctx;
  };
  const DB = env.DB;
  const add = (id, de, en, extra) => {
    const set = id.slice(0, id.lastIndexOf('-'));
    ['de', 'en'].forEach(l => {
      DB[l + '/cards/' + id] = H.card(id, l, Object.assign({ name: l === 'de' ? de : en, set: { id: set, name: 'Set ' + set, cardCount: { official: 100 } } }, extra || {}));
      DB[l + '/sets/' + set] = DB[l + '/sets/' + set] || { id: set, name: 'Set ' + set, releaseDate: '2003-01-01', cards: [] };
      DB[l + '/sets/' + set].cards.push({ id, localId: id.split('-').pop(), name: l === 'de' ? de : en });
    });
  };
  add('neo4-3', 'Celebi', 'Celebi', { variants: { holo: true, normal: false, reverse: false, firstEdition: true }, pricing: { cardmarket: { trend: 12.4, 'trend-holo': 20, updated: '2026-10-10T00:00:00Z' } } });
  add('neo2-13', 'Nachtara', 'Umbreon', { pricing: { cardmarket: { trend: 5.5, 'trend-holo': 9.9, updated: '2026-10-10T00:00:00Z' } } });
  add('base3-2', 'Arktos', 'Articuno', { pricing: undefined });
  add('base1-10', 'Mewtu', 'Mewtwo', { pricing: { cardmarket: { trend: 3, updated: '2026-10-10T00:00:00Z' } } });
  const old = load(path.join(ROOT, 'backup'), ['Code.gs']);
  old.einrichtung();
  [
    { id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 },
    { id: 'neo2-13', lang: 'de', variant: 'base', condition: '', qty: 2 },
    { id: 'base3-2', lang: 'de', variant: 'base', condition: 'LP', qty: 1 },
    { id: 'base3-2', lang: 'de', variant: 'base', condition: 'NM', qty: 1 },
    { id: 'base1-10', lang: 'de', variant: 'base', condition: '', qty: 1 }
  ].forEach(r => old.addCard(r));
  const nu = load(path.join(ROOT, 'src'), ['Code.gs', 'Import.gs']);
  return { env, old, nu, load };
}
const groups = env => env.objects('Gruppen').map(g => [g['Gruppenschlüssel'], g.Name, g.Variante, g.Anzahl, g['Preis (EUR)']]);

// ---------------- MIGR-1
{
  console.log('\n=== MIGR-1');
  const { env, old, nu } = world();
  nu.setupAll_();
  console.log('Trigger nach Einrichtung:', J(env.triggers.map(t => t.fn)));
  const C = vm.runInContext('COL', nu);
  const v = env.values('Daten');
  const r = v.findIndex(x => x[C.id] === 'base1-10') + 1;
  env.sheet('Daten').deleteRow(r); // echtes Sheets: nur onChange(REMOVE_ROW), kein onEdit
  console.log('Daten-IDs nach deleteRow:', J(env.values('Daten').slice(1).filter(x => x[0]).map(x => x[C.id])));
  console.log('Gruppen enthält Mewtu noch:', groups(env).some(g => g[1] === 'Mewtu'));
  console.log('Seitenleiste zeigt Mewtu:', nu.searchCollection('Mewtu', '').groups.length);
  console.log('Sammlung F1 summiert über Gruppen (stale) bis Rebuild; onChange-Handler im Code?', typeof nu.onChange, typeof nu.beiAenderung);
  nu.withLock_(() => nu.rebuildGroups_());
  console.log('nach rebuildGroups_ Mewtu noch da:', groups(env).some(g => g[1] === 'Mewtu'));
}

// ---------------- MIGR-2
{
  console.log('\n=== MIGR-2');
  const { env, old, nu } = world();
  nu.setupAll_();
  const C = vm.runInContext('COL', nu);
  const rows = () => env.values('Daten').slice(1).filter(r => r[0]).map(r => [r[C.key], r[C.eid], r[C.origin], r[C.count]]);
  const before = groups(env).find(g => g[0] === 'neo2-13|normal|');
  old.addCard({ id: 'neo2-13', lang: 'de', variant: 'base', condition: '', qty: 1 }); // alte Bereitstellung
  console.log('Daten nach alter addCard:', J(rows().filter(r => /neo2-13/.test(r[0]))));
  console.log('Gruppe Nachtara vorher/nachher:', before[3], groups(env).find(g => g[0] === 'neo2-13|normal|')[3]);
  const sc = nu.searchCollection('Nachtara', '');
  const g = sc.groups[0];
  console.log('neue Seitenleiste rows:', J(g.rows.map(r => [r.eid, r.count, r.originLabel])));
  const emptyRow = g.rows.find(r => !r.eid);
  try { nu.adjustEntry(emptyRow.eid, -1); console.log('adjustEntry ok'); } catch (e) { console.log('adjustEntry Fehler:', e.message); }
  const sc2 = nu.searchCollection('Nachtara', '');
  console.log('nach Neu laden eids:', J(sc2.groups[0].rows.map(r => r.eid)));
  // getUiConfig repariert auch nicht?
  nu.getUiConfig();
  console.log('nach getUiConfig eids:', J(nu.searchCollection('Nachtara', '').groups[0].rows.map(r => r.eid)));
  nu.withLock_(() => nu.rebuildGroups_());
  console.log('nach rebuildGroups_ Daten:', J(rows().filter(r => /neo2-13/.test(r[0]))));
  console.log('Gruppe nach Rebuild:', J(groups(env).find(g => g[0] === 'neo2-13|normal|')));
  const g3 = nu.searchCollection('Nachtara', '').groups[0];
  console.log('Seitenleiste rows nach Rebuild:', J(g3.rows.map(r => [r.eid, r.count, r.originLabel, r.key])));
  // Kopierte Daten-Zeile von Hand (Copy/Paste): gleiche eid -> repair gibt neue eid, zweite Hand-Zeile
  const sh = env.sheet('Daten');
  const v = env.values('Daten');
  const celebi = v.findIndex(r => r[C.id] === 'neo4-3');
  const last = sh.getLastRow();
  sh.getRange(last + 1, 1, 1, v[celebi].length).setValues([v[celebi]]);
  nu.onEdit({ range: sh.getRange(last + 1, 1) });
  console.log('Celebi-Zeilen nach Copy/Paste + onEdit:', J(rows().filter(r => /neo4-3/.test(r[0]))));
}

// ---------------- MIGR-3
{
  console.log('\n=== MIGR-3');
  const { env, old, nu } = world();
  const oldHist = () => env.values('Verlauf').slice(1).map(r => r.slice(1, 5));
  old.preiseJetztAktualisieren();
  const a = oldHist();
  nu.setupAll_();
  nu.preiseJetztAktualisieren();
  const b = oldHist();
  console.log('alt [Wert, Karten, ohne Preis, failed]:', J(a[a.length - 1]), ' neu:', J(b[b.length - 1]));
  console.log('Sammlung J1 (Einträge) zählt Gruppen:', env.sheet('Sammlung').getRange('I1:J1').getValues()[0].join(' '), '/ Gruppen:', groups(env).length);
}

// ---------------- MIGR-4
{
  console.log('\n=== MIGR-4');
  const { env, old, nu } = world();
  nu.setupAll_();
  const res = JSON.parse(J(nu.searchCollection('', '')));
  console.log('Schlüssel der Antwort:', Object.keys(res));
  // renderCollection aus backup/Ui.html (Zeile 325-327) mit dieser Antwort
  const src = fs.readFileSync(path.join(ROOT, 'backup', 'Ui.html'), 'utf8');
  const m = src.match(/function renderCollection\(res\) \{\n  state\.items = res\.items;\n  if \(!res\.items\.length\)/);
  console.log('alter Code liest res.items.length:', !!m);
  try { const state = {}; state.items = res.items; if (!res.items.length) {} console.log('kein Fehler'); } catch (e) { console.log('alter Client Fehler:', e.message); }
}

// ---------------- MIGR-5
{
  console.log('\n=== MIGR-5');
  const { env, old, nu } = world();
  nu.setupAll_();
  const C = vm.runInContext('COL', nu);
  const sh = env.sheet('Daten');
  const v = env.values('Daten');
  const r = v.findIndex(x => x[C.id] === 'neo2-13') + 1;
  sh.getRange(r, C.variant + 1).setValue('Reverse Holo');
  nu.onEdit({ range: sh.getRange(r, C.variant + 1) });
  const d = env.values('Daten')[r - 1];
  console.log('Daten nach Edit+onEdit: variant', J(d[C.variant]), 'key', J(d[C.key]));
  nu.preiseJetztAktualisieren();
  console.log('Gruppe:', J(groups(env).filter(g => /neo2-13/.test(g[0]))));
  console.log('priceFor_(Reverse Holo) =', nu.priceFor_({ trend: 5.5, 'trend-holo': 9.9 }, 'Reverse Holo'), ' reverse =', nu.priceFor_({ trend: 5.5, 'trend-holo': 9.9 }, 'reverse'));
  const sc = nu.searchCollection('Nachtara', '').groups[0];
  console.log('Seitenleiste variantLabel:', sc.variantLabel, 'Formel zeigt: Normal (vr<>"reverse")');
  // v1 zum Vergleich: gleiche Eingabe im alten Code
  const w = world();
  const C1 = vm.runInContext('COL', w.old);
  const sh1 = w.env.sheet('Daten');
  const v1 = w.env.values('Daten');
  const r1 = v1.findIndex(x => x[C1.id] === 'neo2-13') + 1;
  sh1.getRange(r1, C1.variant + 1).setValue('Reverse Holo');
  w.old.preiseJetztAktualisieren();
  const d1 = w.env.values('Daten')[r1 - 1];
  console.log('v1: variant', d1[C1.variant], 'Preis nach Preislauf', d1[C1.price], '(v1 hatte das gleiche Verhalten)');
  console.log('v1 viewFormula mappt unbekannte Variante auf Normal:', /"firstEdition", "1. Edition", "Normal"/.test(w.old.viewFormula_()));
}

// ---------------- MIGR-6
{
  console.log('\n=== MIGR-6');
  const { env, old, nu } = world();
  nu.setupAll_();
  const C = vm.runInContext('COL', nu);
  // Daten-Zeiten künstlich altern: Celebi am ältesten, Mewtu am neuesten
  const sh = env.sheet('Daten');
  const v = env.values('Daten');
  v.slice(1).forEach((r, i) => {
    if (!r[0]) return;
    const t = new Date(2026, 0, 1 + i);
    sh.getRange(i + 2, C.added + 1, 1, 2).setValues([[t, t]]);
  });
  nu.withLock_(() => nu.rebuildGroups_());
  const top = () => {
    const gs = env.objects('Gruppen');
    const by = col => gs.slice().sort((a, b) => (b[col] && b[col].getTime ? b[col].getTime() : 0) - (a[col] && a[col].getTime ? a[col].getTime() : 0))[0].Name;
    return { neu_sp21_HinzugefuegtAm: by('Hinzugefügt am'), v1_ZuletztGeaendert: by('Zuletzt geändert') };
  };
  console.log('vorher oben:', J(top()));
  nu.addCard({ id: 'neo4-3', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  console.log('nach +1 Celebi (Merge in Hand-Zeile) oben:', J(top()));
  console.log('viewFormula nutzt Spalte 21:', /CHOOSECOLS\(flt, 21\), CHOOSECOLS\(flt, 5\)/.test(nu.viewFormula_(0)));
}
