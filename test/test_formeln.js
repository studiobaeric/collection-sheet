'use strict';
/**
 * Die Formeln aus #43 („Die Tabelle rechnet selbst“) gegen die Rechnung von 1.1.3 (test/ref_groups.js):
 * - viele Testdaten (test/gen_daten.js) in jeder Lesart unsicherer Sheets-Stellen (formula.js: queryHeader, smush,
 *   wildcards), dazu leere Sammlung, eine einzige Karte und Suchen ohne Treffer (Hinweis in einer Zelle),
 * - Platz für die Formeln, wenn Daten wächst, und keine Auffälligkeiten beim Rechnen (lint).
 * Start: node test_formeln.js
 */
const H = require('./harness2');
const R = require('./ref_groups');
const gen = require('./gen_daten');
const t = H.runner('test_formeln');
const ok = t.ok, eq = t.eq;

/** Neue Tabelle, eingerichtet, mit Testdaten; Zusatzspalten gezeigt, Pokédex-Nummern für die Formel nachgezogen. */
function filled(mode, opts) {
  const env = H.createEnv({ formulaMode: mode });
  env.ctx.setupAll_();
  const res = gen(env, opts);
  env.uiCall('setViewExtras', res.extrasNames);
  env.ctx.withLock_(() => env.ctx.afterDataChange_());
  return env;
}

const cell = (env, sheet, a1) => env.sheet(sheet).getRange(a1).getValue();

// ---------------------------------------------------------------------------
t.section('Viele Daten: Formeln = Rechnung von 1.1.3, in jeder Lesart');
[
  {},
  { queryHeader: 'always' },
  { smush: 'keepEmpty' },
  { wildcards: false },
  { queryHeader: 'always', smush: 'keepEmpty', wildcards: false }
].forEach(mode => {
  const label = JSON.stringify(mode);
  const env = filled(mode, { cards: 40, seed: 7 });
  const n = env.groups().length;
  const d = R.compareSheets(env);
  ok(label + ': ' + n + ' Gruppen, alles gleich', n > 60 && d.length === 0, d.slice(0, 4));
  eq(label + ': keine Rechenfehler', env.formulaErrors.filter(e => e.code !== '#N/A').slice(0, 3), []);
});
{
  const env = filled({}, { cards: 25, seed: 99, extras: ['Fach'] });
  eq('anderer Startwert, eine Zusatzspalte: alles gleich', R.compareSheets(env).slice(0, 4), []);
  eq('keine Auffälligkeiten beim Rechnen (lint)', env.formulaLint.slice(0, 3), []);
}

// ---------------------------------------------------------------------------
t.section('Leere Sammlung und eine einzige Karte');
{
  const env = H.createEnv();
  env.ctx.setupAll_();
  eq('leer: alles gleich', R.compareSheets(env), []);
  eq('leer: Hinweis in einer Zelle der Sammlung', [cell(env, 'Sammlung', 'A6'), cell(env, 'Sammlung', 'B6'), cell(env, 'Sammlung', 'C6')],
    ['Keine Einträge gefunden', '', '']);
  eq('leer: Pokédex-Liste vollständig, Kartenliste mit Hinweis', [cell(env, 'Pokédex', 'B6'), cell(env, 'Pokédex', 'H6'), cell(env, 'Pokédex', 'I6')],
    ['Bisasam', 'Oben in I4 ein Pokémon wählen', '']);
  // die erste Karte einer neuen Sammlung: eine Daten-Zeile, eine Gruppe (FILTER über eine Zeile, filterRows_)
  env.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  eq('eine Karte: alles gleich', R.compareSheets(env), []);
  eq('eine Karte: in der Sammlung', [cell(env, 'Sammlung', 'B6'), cell(env, 'Sammlung', 'G6'), cell(env, 'Sammlung', 'B7')], ['Glurak', 1, '']);
  env.sheet('Pokédex').getRange('I4').setValue('#6 Glurak');
  eq('eine Karte: im Pokédex', [cell(env, 'Pokédex', 'I6'), cell(env, 'Pokédex', 'N6'), cell(env, 'Pokédex', 'I7')], ['Glurak', 1, '']);
  eq('eine Karte: Dashboard', [cell(env, 'Dashboard', 'G6'), cell(env, 'Dashboard', 'K6'), cell(env, 'Dashboard', 'G7')], [1, '1 von 1025', '']);
  // mit einer gezeigten Zusatzspalte: eine Gruppe mit einem Wert
  const eid = env.data()[0].eid;
  env.ctx.editEntry(eid, { extras: { Ordner: 'Seite 1' } }, null);
  env.uiCall('setViewExtras', ['Ordner']);
  eq('eine Karte mit Zusatzspalte: alles gleich', R.compareSheets(env), []);
  eq('Zusatzspalte in der Sammlung', cell(env, 'Sammlung', 'Q6'), 'Seite 1');
  eq('keine Rechenfehler außer „nichts gefunden“', env.formulaErrors.filter(e => e.code !== '#N/A').slice(0, 3), []);
}

// ---------------------------------------------------------------------------
t.section('Nichts gefunden: Hinweis in einer Zelle');
{
  const env = filled({}, { cards: 12, seed: 3 });
  const view = env.sheet('Sammlung');
  view.getRange('B4').setValue('gibtsnicht');
  eq('Sammlung: Suche ohne Treffer', [cell(env, 'Sammlung', 'A6'), cell(env, 'Sammlung', 'B6'), cell(env, 'Sammlung', 'P6')], ['Keine Einträge gefunden', '', '']);
  view.getRange('B4').setValue('');
  ok('Suche leer: wieder alle', cell(env, 'Sammlung', 'B6') !== '' && cell(env, 'Sammlung', 'A6') !== 'Keine Einträge gefunden');
  const dex = env.sheet('Pokédex');
  dex.getRange('I4').setValue('#151 Mew');
  eq('Pokédex: Pokémon ohne Karten', [cell(env, 'Pokédex', 'H6'), cell(env, 'Pokédex', 'I6'), cell(env, 'Pokédex', 'P6')], ['Keine Karten von diesem Pokémon', '', '']);
  dex.getRange('D4').setValue('xyzxyz');
  eq('Pokédex: Liste ohne Treffer', [cell(env, 'Pokédex', 'A6'), cell(env, 'Pokédex', 'B6')], ['Keine Pokémon gefunden', '']);
}

// ---------------------------------------------------------------------------
t.section('Platz für die Formeln, wenn Daten wächst');
{
  const env = filled({}, { cards: 10, seed: 5 });
  const groups = env.sheet('Gruppen'), view = env.sheet('Sammlung');
  // wie eine Tabelle mit sehr kurzen Blättern: Gruppen und Sammlung auf 12 Zeilen
  groups.deleteRows(13, groups.getMaxRows() - 12);
  view.deleteRows(13, view.getMaxRows() - 12);
  const errs0 = env.formulaErrors.length;
  ok('zu kurz: Gruppen zeigt #REF!', String(cell(env, 'Gruppen', 'A2')) === '#REF!', cell(env, 'Gruppen', 'A2'));
  env.ctx.withLock_(() => env.ctx.afterDataChange_());
  ok('afterDataChange_: Gruppen und Sammlung wieder lang genug', groups.getMaxRows() >= env.sheet('Daten').getMaxRows() &&
    view.getMaxRows() >= env.sheet('Daten').getMaxRows() + 5, [groups.getMaxRows(), view.getMaxRows(), env.sheet('Daten').getMaxRows()]);
  eq('danach alles gleich', R.compareSheets(env).slice(0, 3), []);
  ok('neue Fehler nur von vorher', env.formulaErrors.slice(errs0).every(e => e.code === '#REF!' || e.code === '#N/A'));
  // Daten wächst über die Zeilen der anderen Blätter hinaus (ensureRows_): sie wachsen mit
  const data = env.sheet('Daten');
  const before = data.getMaxRows();
  env.ctx.withLock_(() => env.ctx.ensureRows_(data, before + 300));
  ok('ensureRows_: Gruppen, Sammlung und Pokédex wachsen mit', data.getMaxRows() >= before + 300 && groups.getMaxRows() >= data.getMaxRows() &&
    view.getMaxRows() >= data.getMaxRows() + 5 && env.sheet('Pokédex').getMaxRows() >= Math.max(1026, data.getMaxRows()) + 5,
    [data.getMaxRows(), groups.getMaxRows(), view.getMaxRows(), env.sheet('Pokédex').getMaxRows()]);
}

t.done();
