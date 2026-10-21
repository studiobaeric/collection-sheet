'use strict';
// Regressionstests für die Korrekturen aus dem Review (DATA-*, RECOG-*, GAS-*, MIGR-*).
// Nur erfundene Testdaten, alles über harness2 (keine echten Google- oder tcgdex-Aufrufe).
const H = require('./harness2');
const C = require('./review/common');
const W = require('./review/recog_world');

const t = H.runner('review-fixes');

/* ---------- kleine Helfer ---------- */

function sumCount(rows) { return rows.reduce((s, r) => s + (Number(r.count) || 0), 0); }

/** Fehler genau einmal auslösen, wenn cond(args) zutrifft; danach wieder das Original. */
function failOnce(ctx, name, cond, msg) {
  const orig = ctx[name];
  let fired = false;
  ctx[name] = function (...args) {
    if (!fired && cond.apply(null, args)) { fired = true; throw new Error(msg || 'Service Spreadsheets timed out (Test)'); }
    return orig.apply(this, args);
  };
  return () => { ctx[name] = orig; return fired; };
}

/** Ein Block: wirft er (z. B. weil eine Funktion im alten Code fehlt), zählt das als Fehlschlag und es geht weiter. */
function safe(fn) {
  try { fn(); } catch (e) { t.ok('Block ohne Ausnahme', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
}

// ======================================================================
// Je Befund ein Block.
// ======================================================================

/* ---------- DATA-7: rewriteData_ schreibt in einem einzigen Aufruf ---------- */
t.section('DATA-7 rewriteData_ in einem Schreibvorgang');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  C.seed(env, { items: [C.clear('fpX', 2, C.GLURAK)] });
  env.uiCall('importCommit');
  C.handRow(env, C.BASE, 1);
  const sh = env.sheet('Daten');
  // Jeder zweite Schreibaufruf auf Daten (nach dem ersten setValues) scheitert: früher clearContent
  const origGR = sh.getRange.bind(sh);
  let calls = 0, armed = true;
  sh.getRange = function (...a) {
    const r = origGR(...a);
    ['setValues', 'clearContent'].forEach((m) => {
      const o = r[m].bind(r);
      r[m] = function (...x) {
        if (armed && ++calls === 2) { armed = false; throw new Error('Zeitlimit überschritten (Test)'); }
        return o(...x);
      };
    });
    return r;
  };
  let err = '';
  try { env.uiCall('importUndo', 1, {}); } catch (e) { err = e.message; }
  sh.getRange = origGR;
  c.withLock_(() => c.rebuildGroups_());
  const hand = env.data().filter((r) => r.id === 'base1-4');
  t.ok('DATA-7: Abbruch nach dem ersten Schreiben lässt keine doppelte Hand-Zeile zurück', hand.length === 1 && sumCount(hand) === 1,
    { err, hand: hand.map((r) => [r.eid, r.count]) });
  // direkter Test: kürzer schreiben leert den Rest im selben Aufruf
  C.handRow(env, C.GLURAK, 1);
  C.handRow(env, C.GLURAK_REV, 1);
  let writes = 0;
  const before = env.data().length;
  const gr2 = sh.getRange.bind(sh);
  sh.getRange = function (...a) {
    const r = gr2(...a);
    const sv = r.setValues.bind(r), cc = r.clearContent.bind(r);
    r.setValues = (v) => { writes++; return sv(v); };
    r.clearContent = () => { writes++; return cc(); };
    return r;
  };
  const keep = c.readData_(sh).filter(c.isDataRow_).slice(0, 1);
  writes = 0;
  c.withLock_(() => c.rewriteData_(keep));
  sh.getRange = gr2;
  t.ok('DATA-7: rewriteData_ mit weniger Zeilen schreibt und leert in genau einem Aufruf', env.data().length === 1 && writes === 1,
    { before, writes, left: env.data().length });
});

/* ---------- GAS-3: Kopfzeile einer Zusatzspalte als Text ---------- */
t.section('GAS-3 Kopfzeile der Zusatzspalte wird nicht typisiert');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  const name = '2026-10-01'; // wird ohne Textformat zu einem Datum (im Harness wie in Sheets)
  C.seed(env, { cfg: { form: 'liste', extras: [{ col: 6, name, show: false }] }, items: [C.clear('fpA', 1, C.GLURAK, { extras: { [name]: 'Wert A' } })] });
  env.uiCall('importCommit');
  const hdr = env.values('Daten')[0];
  t.ok('GAS-3: Kopfzeile bleibt Text', hdr[30] === name, { got: String(hdr[30]) });
  t.eq('GAS-3: extraNames_ kennt den Namen', c.extraNames_(), [name]);
  const row = env.data().find((r) => r.fp === 'fpA');
  t.ok('GAS-3: Wert landet in der Zusatzspalte', row && row.extras[name] === 'Wert A', row && row.extras);
  C.seed(env, { sourceId: 'SRC2', cfg: { form: 'liste', extras: [{ col: 6, name, show: false }] }, items: [C.clear('fpB', 1, C.BASE, { extras: { [name]: 'Wert B' } })] });
  env.uiCall('importCommit');
  t.eq('GAS-3: zweiter Import legt keine doppelte Spalte an', c.extraNames_(), [name]);
  const pv = env.uiCall('importUndoPreview', 2);
  t.eq('GAS-3: Zurücknehmen sieht keine falsche Änderung am Zusatzwert', pv.changed.length, 0);
});

/* ---------- GAS-4: Drive-Kopie auch aus geteilten Ablagen ---------- */
t.section('GAS-4 supportsAllDrives bei der xlsx-Umwandlung');
['v3', 'v2'].forEach((ver) => {
  const env = H.createEnv({ drive: ver });
  env.ctx.einrichtung();
  env.addSource({ id: 'XLSXSHARED' + ver, name: 'Geteilt.xlsx', mime: 'xlsx', tabs: { Liste: [['Name', 'Nr.'], ['Glurak', '4']] } });
  env.uiCall('importOpenSource', 'XLSXSHARED' + ver);
  const extra = env.driveCopies[0] && env.driveCopies[0].extra;
  t.ok('GAS-4 (' + ver + '): Drive.Files.copy mit supportsAllDrives', !!extra && extra.supportsAllDrives === true && (ver === 'v3' || extra.convert === true), extra);
});

/* ---------- GAS-5: nur Links nach außen an den Zelltext hängen ---------- */
t.section('GAS-5 interne Links und mailto bleiben weg');
safe(() => {
  const env = C.mkEnv();
  const ID = 'GSHEETLINKSFIX01';
  env.addSource({ id: ID, name: 'Testliste', mime: 'sheet', tabs: { Karten: {
    values: [['Name', 'Nr.', 'Set', 'Link'], ['Glurak', '25', 'Flammende Finsternis', 'CM'], ['Glurak', '4', 'Grundset', ''], ['Glurak', '136', 'Flammende Finsternis', '']],
    links: { '2,1': '#gid=123456&range=A5', '3,1': 'mailto:eric@example.org', '4,2': '#gid=0', '2,4': 'https://www.cardmarket.com/de/Pokemon/Products/Singles/Darkness-Ablaze/Charizard-DAA25' } } } });
  env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/d/' + ID + '/edit');
  env.uiCall('importSelectTab', 'Karten');
  const q = env.values('Import-Quelle').slice(1, 4);
  t.eq('GAS-5: Namen ohne #gid / mailto', q.map((r) => r[0]), ['Glurak', 'Glurak', 'Glurak']);
  t.eq('GAS-5: Nummer ohne #gid', q.map((r) => String(r[1])), ['25', '4', '136']);
  t.ok('GAS-5: Cardmarket-Link wird weiter angehängt', /cardmarket\.com/.test(String(q[0][3])), q[0][3]);
});

/* ---------- GAS-1 / MIGR-1: Zeile in Daten löschen baut die Gruppen neu ---------- */
t.section('GAS-1 / MIGR-1 onChange-Trigger nach Zeile löschen');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  const trig = () => env.triggers.map((x) => x.fn).sort();
  t.eq('GAS-1: Einrichtung legt den Trigger bei Änderung an', trig(), ['beiStrukturAenderung', 'naechtlicherPreislauf']);
  c.einrichtung();
  t.eq('GAS-1: zweite Einrichtung legt ihn nicht doppelt an', trig(), ['beiStrukturAenderung', 'naechtlicherPreislauf']);
  C.handRow(env, C.GLURAK, 2);
  C.handRow(env, C.BASE, 1);
  t.eq('GAS-1: vorher zwei Gruppen', env.groups().length, 2);
  const row = env.data().find((r) => r.id === 'base1-4').row;
  env.sheet('Daten').deleteRow(row); // wie Rechtsklick > Zeile löschen (kein onEdit)
  c.beiStrukturAenderung({ changeType: 'FORMAT' });
  t.eq('GAS-1: Formatänderung baut nicht neu', env.groups().length, 2);
  c.beiStrukturAenderung({ changeType: 'REMOVE_ROW' });
  t.eq('GAS-1: nach REMOVE_ROW nur noch Glurak in Gruppen', env.groups().map((g) => g['Name']), ['Glurak']);
  let threw = false;
  try { c.beiStrukturAenderung(undefined); } catch (e) { threw = true; }
  t.ok('GAS-1: ohne Ereignis kein Fehler', !threw);
});

/* ---------- GAS-2 / MIGR-2: Zeilen einer alten Web-App-Bereitstellung, kopierte Hand-Zeilen ---------- */
t.section('GAS-2 / MIGR-2 alte Bereitstellung, kopierte Zeile, Hinweis in der Einrichtung');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  const COL = env.run('COL');
  const handEid = C.handRow(env, C.GLURAK, 2);
  // so hängt die alte addCard (Version 1) eine Zeile an: 23 Spalten, alter Schlüssel, ohne Eintrag-ID/Herkunft/Sprache
  const sh = env.sheet('Daten');
  const v1 = c.buildCardRow_(C.GLURAK, { count: 1 }).slice(0, 23);
  v1[COL.key] = 'swsh3-025|normal|';
  sh.getRange(sh.getLastRow() + 1, 1, 1, 23).setValues([v1]);
  const res = env.uiCall('searchCollection', 'Glurak', '');
  const g = res.groups[0];
  t.ok('MIGR-2: Suche liefert keine Zeile ohne Eintrag-ID', g.rows.every((r) => r.eid), g.rows);
  t.eq('MIGR-2: alte Zeile in die Hand-Zeile eingerechnet (eine Hand-Zeile, 3 Exemplare)', g.rows.map((r) => [r.eid, r.count, r.origin]), [[handEid, 3, 'Hand']]);
  t.eq('MIGR-2: Gruppen zählt 3', env.groups().map((x) => x['Anzahl']), [3]);
  const adj = env.uiCall('adjustEntry', g.rows[0].eid, -1);
  t.eq('MIGR-2: -1 klappt danach', adj.count, 2);
  // kopierte Hand-Zeile (gleiche Eintrag-ID) -> nach onEdit eine Hand-Zeile mit der Summe
  const d = env.data().find((r) => r.eid === handEid);
  const raw = sh.getRange(d.row, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, 1, raw.length).setValues([raw]);
  c.onEdit({ range: sh.getRange(sh.getLastRow(), 1) });
  const hand = env.data().filter((r) => r.origin === 'Hand' && r.id === C.GLURAK.id);
  t.eq('MIGR-2: kopierte Zeile -> weiter eine Hand-Zeile, Anzahl addiert', hand.map((r) => [r.eid, r.count]), [[handEid, 4]]);
  // Import-Zeilen werden nie zusammengelegt
  C.seed(env, { items: [C.clear('fpZ', 1, C.BASE)] });
  env.uiCall('importCommit');
  const imp = env.data().find((r) => r.fp === 'fpZ');
  const raw2 = sh.getRange(imp.row, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, 1, raw2.length).setValues([raw2]);
  c.onEdit({ range: sh.getRange(sh.getLastRow(), 1) });
  const imps = env.data().filter((r) => r.fp === 'fpZ');
  t.ok('MIGR-2: kopierte Import-Zeile bleibt eine eigene Zeile (neue ID)', imps.length === 2 && imps[0].eid !== imps[1].eid, imps.map((r) => [r.eid, r.origin]));
  // Hinweis in der Einrichtung, wenn es eine Web-App gibt
  env.ui.alerts.length = 0;
  c.einrichtung();
  t.ok('GAS-2: ohne Web-App kein Hinweis auf „Neue Version“', !/Neue Version/.test(env.ui.alerts[0] || ''), env.ui.alerts);
  env.props.WEBAPP_URL = 'https://script.google.com/macros/s/ABC/exec';
  env.ui.alerts.length = 0;
  c.einrichtung();
  const msg = env.ui.alerts[0] || '';
  t.ok('GAS-2: mit Web-App nennt die Einrichtung „Neue Version“ und die Seitenleiste', /Bereitstellungen verwalten/.test(msg) && /Neue Version/.test(msg) && /Seitenleiste/.test(msg) && !/—/.test(msg), msg);
});

/* ---------- MIGR-5: Variante von Hand als Anzeigename eingetippt ---------- */
t.section('MIGR-5 Variante in Daten wird zum Code');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  const eid = C.handRow(env, C.GLURAK, 2);
  C.handRow(env, C.GLURAK_REV, 1);
  const sh = env.sheet('Daten');
  const COL = env.run('COL');
  const row = env.data().find((r) => r.eid === eid).row;
  sh.getRange(row, COL.variant + 1).setValue('Reverse Holo');
  c.onEdit({ range: sh.getRange(row, COL.variant + 1) });
  const r = env.data().find((x) => x.eid === eid);
  t.eq('MIGR-5: „Reverse Holo“ -> reverse, Schlüssel neu', [r.variant, r.key], ['reverse', 'swsh3-025|reverse||DE'.replace('||DE', '|||DE')]);
  t.eq('MIGR-5: eine Gruppe Reverse Holo mit 3 Exemplaren', env.groups().map((g) => [g['Variante'], g['Anzahl']]), [['reverse', 3]]);
  t.eq('MIGR-5: variantCode_', ['1. Edition', 'Non Holo', 'HOLO', 'normal', 'Shadowless'].map((x) => (typeof c.variantCode_ === 'function' ? c.variantCode_(x) : null)),
    ['firstEdition', 'normal', 'holo', 'normal', 'Shadowless']);
});

/* ---------- DATA-1: Abdeckung je Datei UND Tab ---------- */
t.section('DATA-1 zweiter Tab derselben Datei ist eine eigene Liste');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  C.seed(env, { tab: 'Tabellenblatt1', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpY', 1, C.GLURAK_REV)] });
  env.uiCall('importCommit');
  t.eq('DATA-1: Abdeckung im anderen Tab leer', Object.keys(c.coverageFor_('SRC1', 'Bulk + Sammlung')), []);
  t.eq('DATA-1: Abdeckung im selben Tab da', Object.keys(c.coverageFor_('SRC1', 'Tabellenblatt1')).sort(), ['fpX', 'fpY']);
  t.eq('DATA-1: ohne Tab-Angabe wie bisher alle Tabs', Object.keys(c.coverageFor_('SRC1')).sort(), ['fpX', 'fpY']);
  // Tab 2, Nur Neues: das zweite Glurak kommt dazu
  C.seed(env, { tab: 'Bulk + Sammlung', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
  let pv = env.uiCall('importBuildPreview');
  t.eq('DATA-1: Nur Neues Tab 2: 2 Exemplare, nichts bekannt', [pv.counts.kopien, pv.counts.bekannt], [2, 0]);
  t.ok('DATA-1: Vorschau warnt, dass bisher nur ein anderer Tab importiert wurde', pv.warnings.length === 1 && /Tabellenblatt1/.test(pv.warnings[0]) && !/—/.test(pv.warnings[0]), pv.warnings);
  // Tab 2 im Abgleich: Tab 1 bleibt unberührt
  C.seed(env, { tab: 'Bulk + Sammlung', mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-1: Abgleich Tab 2 nimmt nichts aus Tab 1 weg', [pv.counts.weniger, pv.decreased.length, pv.counts.kopien], [0, 0, 2]);
  env.uiCall('importCommit');
  t.eq('DATA-1: Glurak Reverse aus Tab 1 bleibt 1', env.data().filter((r) => r.fp === 'fpY').map((r) => r.count), [1]);
  t.eq('DATA-1: Glurak jetzt 2 (je 1 aus jedem Tab)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 2);
  // Tab 1 unverändert abgleichen: die Karten aus Tab 2 bleiben
  C.seed(env, { tab: 'Tabellenblatt1', mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK), C.clear('fpY', 1, C.GLURAK_REV)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-1: Abgleich Tab 1 unverändert: nichts weniger, nichts neu, keine Warnung', [pv.counts.weniger, pv.counts.kopien, pv.warnings.length], [0, 0, 0]);
  const list = env.uiCall('importList');
  const pvu = env.uiCall('importUndoPreview', 1);
  t.eq('DATA-1: Zurücknehmen nennt spätere Importe nur aus demselben Tab', pvu.laterSameSource, []);
  t.ok('DATA-1: Liste hat Tab je Import', list.every((i) => i.tab), list.map((i) => i.tab));
});
safe(() => {
  // Erkennung (Nur Neues): eine gleiche Zeile im zweiten Tab ist nicht „bekannt“
  const env = W.newEnv();
  const rows = [['Ditto', 'DS 62', '', '', '', '', '']];
  env.addSource({ id: 'XLSXTABS01', name: 'Pokemon Ordner.xlsx', mime: 'sheet', tabs: { Tabellenblatt1: [W.HEAD].concat(rows), 'Bulk + Sammlung': [W.HEAD].concat(rows) } });
  const flow = (tab) => {
    env.uiCall('importOpenSource', 'XLSXTABS01');
    const s = env.uiCall('importSelectTab', tab);
    env.uiCall('importStartRecognition', s.cfg, '', 'neu');
    let r, n = 0;
    do { r = env.uiCall('importRecognizeStep'); } while (!r.done && n++ < 20);
    return r;
  };
  let r = flow('Tabellenblatt1');
  env.uiCall('importCommit');
  r = flow('Bulk + Sammlung');
  t.eq('DATA-1: Erkennung im zweiten Tab: eindeutig statt bekannt', [r.counts.eindeutig, r.counts.bekannt], [1, 0]);
  r = flow('Tabellenblatt1');
  t.eq('DATA-1: Erkennung im selben Tab: bekannt', [r.counts.eindeutig, r.counts.bekannt], [0, 1]);
});

/* ---------- DATA-3: Abgleich zählt „Dieselbe Karte“-Exemplare mit ---------- */
t.section('DATA-3 Abgleich mit von Hand erfassten Exemplaren');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  const handEid = C.handRow(env, C.GLURAK, 1);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit', { hand: { fpX: 'same' } }); // 1 gleich + 2 neu
  const total = () => c.searchCollection('Glurak', '').groups[0].count;
  t.eq('DATA-3: nach Import 1: 3 Glurak', total(), 3);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 2, C.GLURAK)] });
  let pv = env.uiCall('importBuildPreview');
  t.eq('DATA-3: Quelle 2: Vorschau 1 weniger', pv.counts.weniger, 1);
  env.uiCall('importCommit');
  t.eq('DATA-3: Sammlung 2', total(), 2);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
  env.uiCall('importCommit');
  t.eq('DATA-3: Quelle 1: Sammlung 1', total(), 1);
  t.eq('DATA-3: die Hand-Zeile wird nie verringert', env.data().find((r) => r.eid === handEid).count, 1);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 0, C.GLURAK)] });
  env.uiCall('importCommit');
  t.eq('DATA-3: Quelle 0: Hand-Exemplar bleibt', [total(), env.data().find((r) => r.eid === handEid).count], [1, 1]);
  // Nur Neues danach (Quelle 2): ein Exemplar kommt dazu
  C.seed(env, { mode: 'neu', items: [C.clear('fpX', 2, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-3: Nur Neues mit Quelle 2: 1 neues Exemplar', pv.counts.kopien, 1);
});
safe(() => {
  // Hand-Exemplar inzwischen selbst verkauft: dann zählt es beim Abgleich nicht mehr
  const env = C.mkEnv();
  const c = env.ctx;
  const handEid = C.handRow(env, C.GLURAK, 1);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit', { hand: { fpX: 'same' } });
  env.uiCall('adjustEntry', handEid, -1);
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 2, C.GLURAK)] });
  const pv = env.uiCall('importBuildPreview');
  t.eq('DATA-3: Hand-Exemplar weg: Quelle 2 = 2 Import-Exemplare, nichts weniger', pv.counts.weniger, 0);
});

/* ---------- DATA-4: „trotzdem übernehmen“ hebt „von dir entfernt“ auf ---------- */
t.section('DATA-4 zurückgeholtes Exemplar blockiert kein neues');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit');
  const row = env.data().find((r) => r.fp === 'fpX');
  env.uiCall('adjustEntry', row.eid, -1);
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  let pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4: Import 2 bietet 1 unter „Von dir entfernt“ an', pv.removedByYou.map((x) => x.qty), [1]);
  env.uiCall('importCommit', { removed: { fpX: true } });
  t.eq('DATA-4: nach dem Haken 3', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  const neu2 = env.proto().filter((e) => e['Typ'] === 'neu' && e['Import-Nr'] === 2);
  t.ok('DATA-4: neu-Eintrag merkt sich das zurückgeholte Exemplar', neu2.length === 1 && JSON.parse(neu2[0]['Daten']).revived === 1, neu2.map((e) => e['Daten']));
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4: gleiche Quelle danach: nichts neu, nichts angeboten', [pv.counts.kopien, pv.removedByYou.length], [0, 0]);
  C.seed(env, { items: [C.clear('fpX', 4, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4: Quelle 4: 1 neues Exemplar, nichts zurückgehalten', [pv.counts.kopien, pv.removedByYou.length], [1, 0]);
  env.uiCall('importCommit');
  t.eq('DATA-4: Sammlung 4', sumCount(env.data().filter((r) => r.fp === 'fpX')), 4);
  // Zurücknehmen von Import 2 (mit dem zurückgeholten Exemplar): das entfernte bleibt wieder weg
  env.uiCall('importUndo', 2, {});
  C.seed(env, { items: [C.clear('fpX', 4, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4: nach Zurücknehmen von Import 2: das verkaufte steht wieder unter „Von dir entfernt“', pv.removedByYou.map((x) => x.qty), [1]);
});
safe(() => {
  // entfernt in einem Import, der danach zurückgenommen wurde
  const env = C.mkEnv();
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit');
  env.uiCall('adjustEntry', env.data().find((r) => r.fp === 'fpX').eid, -1);
  env.uiCall('importUndo', 1, {});
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  let pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4 (zurückgenommen): 2 neu, 1 angeboten', [pv.counts.kopien, pv.removedByYou.map((x) => x.qty)], [2, [1]]);
  env.uiCall('importCommit', { removed: { fpX: true } });
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4 (zurückgenommen): gleiche Quelle: nichts neu', [pv.counts.kopien, pv.removedByYou.length], [0, 0]);
  C.seed(env, { items: [C.clear('fpX', 4, C.GLURAK)] });
  pv = env.uiCall('importBuildPreview');
  t.eq('DATA-4 (zurückgenommen): Quelle 4: 1 neu', [pv.counts.kopien, pv.removedByYou.length], [1, 0]);
});

/* ---------- DATA-5: Fortsetzen nach Abbruch vor dem Protokoll ---------- */
t.section('DATA-5 Fortsetzen ohne Protokolleinträge meldet nichts Falsches');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  C.seed(env, { items: [C.clear('fpX', 2, C.GLURAK), C.clear('fpZ', 1, C.BASE)] });
  const restore = failOnce(c, 'appendProto_', (entries) => entries.some((e) => e.status === 'geplant'), 'Service Spreadsheets failed (Test)');
  let err = '';
  try { env.uiCall('importCommit'); } catch (e) { err = e.message; }
  restore();
  t.ok('DATA-5: Commit meldet die Unterbrechung', /unterbrochen/.test(err), err);
  t.eq('DATA-5: Liste zeigt unterbrochen', env.uiCall('importList').map((i) => [i.nr, i.status]), [[1, 'unterbrochen']]);
  const r = env.uiCall('importResume', 1);
  t.ok('DATA-5: Fortsetzen meldet nicht „fertig“', !/ist jetzt fertig/.test(r.message) && /nichts übernommen|nichts geändert/.test(r.message) && r.nothingDone === true, r.message);
  t.ok('DATA-5: Meldung ohne Gedankenstrich', !/—/.test(r.message));
  const list = env.uiCall('importList');
  t.eq('DATA-5: Import steht als zurückgenommen, ohne Zahlen', list.map((i) => [i.nr, i.status, i.counts.neu]), [[1, 'zurückgenommen', 0]]);
  const d = c.importDraft_();
  t.ok('DATA-5: Entwurf bleibt, ohne committingNr', !!d && d.committingNr == null && d.stage === 'vorschau', d && { stage: d.stage, committingNr: d.committingNr });
  t.eq('DATA-5: nichts in Daten', env.data().length, 0);
  const st = env.uiCall('importState');
  t.ok('DATA-5: importState zeigt den Entwurf (Banner „Weitermachen“)', !!st.draft, st.draft);
  const res = env.uiCall('importCommit');
  t.eq('DATA-5: noch einmal Importieren klappt (Import 2, 3 Exemplare)', [res.nr, sumCount(env.data())], [2, 3]);
});

/* ---------- DATA-2: Zurücknehmen nach Abbruch setzt den Abgleich nicht doppelt zurück ---------- */
t.section('DATA-2 Zurücknehmen ist wiederholbar');
const data2Setup = () => {
  const env = C.mkEnv();
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit');                       // Import 1: 3
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
  env.uiCall('importCommit');                       // Import 2: 2 weniger -> 1
  return env;
};
safe(() => {
  // Abbruch NACH dem Schreiben von Daten (Status „zurückgenommen“ fehlt noch)
  const env = data2Setup();
  const c = env.ctx;
  const restore = failOnce(c, 'prWriteImport_', (o) => o.status === 'zurückgenommen');
  let err = '';
  try { env.uiCall('importUndo', 2, {}); } catch (e) { err = e.message; }
  restore();
  t.ok('DATA-2: Meldung sagt, dass es noch einmal geht', /unterbrochen/.test(err) && /noch einmal/.test(err) && !/—/.test(err), err);
  t.eq('DATA-2: Daten schon zurückgesetzt (3)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  const pv = env.uiCall('importUndoPreview', 2);
  t.eq('DATA-2: Vorschau beim zweiten Versuch: nichts mehr zurückzusetzen', pv.counts.zurueck, 0);
  const res = env.uiCall('importUndo', 2, {});
  t.eq('DATA-2: zweiter Versuch: weiter 3 Glurak (nicht 5)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  t.ok('DATA-2: zweiter Versuch: nichts mehr zurückzusetzen (schon erledigt)', res.restored === 0, res.message);
  t.eq('DATA-2: Import 2 zurückgenommen, Import 1 aktiv', env.uiCall('importList').map((i) => [i.nr, i.status]), [[2, 'zurückgenommen'], [1, 'aktiv']]);
  const marks = env.proto().filter((e) => e['Typ'] === 'abgleich-zurück');
  t.eq('DATA-2: eine Vormerkung, erledigt', marks.map((e) => e['Status']), ['erledigt']);
});
safe(() => {
  // Abbruch VOR dem Schreiben von Daten: der zweite Versuch setzt einmal zurück
  const env = data2Setup();
  const c = env.ctx;
  const restore = failOnce(c, 'rewriteData_', () => true);
  try { env.uiCall('importUndo', 2, {}); } catch (e) { /* erwartet */ }
  restore();
  t.eq('DATA-2: vor dem Schreiben abgebrochen: Daten unverändert (1)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 1);
  env.uiCall('importUndo', 2, {});
  t.eq('DATA-2: zweiter Versuch: 3 Glurak', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  const marks = env.proto().filter((e) => e['Typ'] === 'abgleich-zurück').map((e) => e['Status']).sort();
  t.eq('DATA-2: alte Vormerkung übersprungen, neue erledigt', marks, ['erledigt', 'übersprungen']);
  // Abdeckung danach wie ohne Abbruch: Import 1 deckt 3 ab
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  t.eq('DATA-2: Nur Neues danach: nichts neu', env.uiCall('importBuildPreview').counts.kopien, 0);
});

safe(() => {
  // Abbruch NACH dem Schreiben von Daten, aber bevor die Vormerkung als erledigt markiert ist
  const env = data2Setup();
  const c = env.ctx;
  const restore = failOnce(c, 'setProtoStatus_', (ids, status) => status === 'erledigt' && ids && ids.length > 0);
  try { env.uiCall('importUndo', 2, {}); } catch (e) { /* erwartet */ }
  const fired = restore();
  t.ok('DATA-2: Abbruch beim Markieren ausgelöst', fired === true);
  t.eq('DATA-2: Daten schon zurückgesetzt (3)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  t.eq('DATA-2: Vormerkung noch geplant', env.proto().filter((e) => e['Typ'] === 'abgleich-zurück').map((e) => e['Status']), ['geplant']);
  const res = env.uiCall('importUndo', 2, {});
  t.eq('DATA-2: zweiter Versuch: weiter 3 Glurak (nicht 5)', sumCount(env.data().filter((r) => r.fp === 'fpX')), 3);
  t.ok('DATA-2: zweiter Versuch meldet 1 auf den alten Stand gesetzt', res.restored === 1, res.message);
  t.eq('DATA-2: Vormerkung jetzt erledigt', env.proto().filter((e) => e['Typ'] === 'abgleich-zurück').map((e) => e['Status']), ['erledigt']);
});

/* ---------- DATA-6: in Daten erhöhte Anzahl einer Import-Zeile bleibt beim Zurücknehmen ---------- */
t.section('DATA-6 von Hand dazugezählte Exemplare bleiben');
safe(() => {
  const env = C.mkEnv();
  const c = env.ctx;
  C.seed(env, { items: [C.clear('fpX', 1, C.GLURAK)] });
  env.uiCall('importCommit');
  const sh = env.sheet('Daten');
  const COL = env.run('COL');
  const row = env.data().find((r) => r.fp === 'fpX');
  sh.getRange(row.row, COL.count + 1).setValue(3); // Eric tippt 3 in Anzahl
  c.onEdit({ range: sh.getRange(row.row, COL.count + 1) });
  const pv = env.uiCall('importUndoPreview', 1);
  t.eq('DATA-6: Vorschau: 1 Eintrag gelöscht, 2 bleiben, nichts zu entscheiden', [pv.counts.loeschen, pv.counts.bleiben, pv.changed.length], [1, 2, 0]);
  const res = env.uiCall('importUndo', 1, {});
  const left = env.data().filter((r) => r.id === C.GLURAK.id);
  t.eq('DATA-6: danach 2 Glurak von Hand', left.map((r) => [r.origin, r.count, r.fp]), [['Hand', 2, '']]);
  t.ok('DATA-6: Meldung nennt die bleibenden Exemplare', /2 Exemplare, die du von Hand dazugezählt hast, bleiben/.test(res.message), res.message);
});
safe(() => {
  // mit vorhandener Hand-Zeile, verkauftem Exemplar und späterem Abgleich: nur der echte Überschuss bleibt
  const env = C.mkEnv();
  const c = env.ctx;
  const handEid = C.handRow(env, C.GLURAK, 1);
  C.seed(env, { items: [C.clear('fpX', 3, C.GLURAK)] });
  env.uiCall('importCommit', { hand: { fpX: 'extra' } });           // Import 1: 3 neu
  const imp = env.data().find((r) => r.fp === 'fpX');
  env.uiCall('adjustEntry', imp.eid, -1);                            // verkauft: 2
  C.seed(env, { mode: 'abgleich', items: [C.clear('fpX', 1, C.GLURAK)] });
  env.uiCall('importCommit');                                        // Import 2: 1 weniger -> 1
  let pv = env.uiCall('importUndoPreview', 1);
  t.eq('DATA-6: ohne Änderung von Hand bleibt nichts', pv.counts.bleiben, 0);
  const sh = env.sheet('Daten');
  const COL = env.run('COL');
  const r1 = env.data().find((r) => r.fp === 'fpX' && r.origin === 'Import 1');
  sh.getRange(r1.row, COL.count + 1).setValue(2);                    // 1 dazugetippt
  c.onEdit({ range: sh.getRange(r1.row, COL.count + 1) });
  pv = env.uiCall('importUndoPreview', 1);
  t.eq('DATA-6: 1 dazugetippt -> 1 bleibt', pv.counts.bleiben, 1);
  env.uiCall('importUndo', 1, {});
  t.eq('DATA-6: Hand-Zeile hat jetzt 2, Import-Zeile weg', env.data().filter((r) => r.id === C.GLURAK.id).map((r) => [r.eid === handEid, r.origin, r.count]), [[true, 'Hand', 2]]);
});

/* ---------- RECOG-3: geänderte Quellzeile, Begriff oder fester Wert: nichts kommt doppelt, Verkauftes bleibt weg ---------- */
t.section('RECOG-3 geänderte Quellzeilen');
const R3_V1 = [
  ['Hundemon', '82', '', '', '0,80 €', '01.10.2026', ''],
  ['Despotar', '88', '', 'Entfesselt', '3,50 €', '01.10.2026', ''],
  ['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', '']
];
const R3_V2 = [
  ['Hundemon', '82', '', 'Unerschrocken', '0,80 €', '01.10.2026', ''],                          // Set nachgetragen
  ['Despotar', '88', W.CM + 'Unleashed/Tyranitar-UL88', 'Entfesselt', '3,50 €', '01.10.2026', ''], // Link nachgetragen
  ['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', '']                                 // Begriff „Promo“ neu
];
/** Wie W.run, aber mit Änderungen an der Zuordnung (z. B. feste Werte). */
function r3Run(env, rows, mode, patch) {
  env.addSource({ id: 'SRCFP00001', name: 'Pokemon Ordner.xlsx', mime: 'sheet', tabs: { Tabellenblatt1: [W.HEAD].concat(rows) } });
  env.uiCall('importOpenSource', 'SRCFP00001');
  const s = env.uiCall('importSelectTab', 'Tabellenblatt1');
  const cfg = Object.assign({}, s.cfg);
  if (patch) cfg.fixed = Object.assign({}, cfg.fixed || {}, patch);
  env.uiCall('importStartRecognition', cfg, '', mode || 'neu');
  let r, n = 0;
  do { r = env.uiCall('importRecognizeStep'); } while (!r.done && n++ < 50);
  return r;
}
function r3Import1(env, patch) {
  r3Run(env, R3_V1, 'neu', patch);
  const luc = env.ctx.reviewRead_().find((i) => i.values.name === 'Lucario Promo');
  if (luc && luc.status !== 'eindeutig') env.uiCall('importReviewDecide', luc.fp, { type: 'karte', id: 'dpp-DP16', lang: 'de' });
  env.uiCall('importCommit', {});
  const desp = env.data().find((d) => d.id === 'hgss2-88');
  env.uiCall('adjustEntry', desp.eid, -1); // verkauft
}
const r3Counts = (env) => env.data().map((d) => [d.id, d.count]).sort();
const r3AddTerm = (env) => {
  const sh = env.sheet('Import-Begriffe');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([['Promo', 'Ignorieren', '', 'Name und Spalten']]);
};
safe(() => {
  const env = W.newEnv();
  r3Import1(env);
  const before = r3Counts(env);
  r3AddTerm(env);
  r3Run(env, R3_V2, 'neu');
  const pv = env.uiCall('importBuildPreview');
  t.eq('RECOG-3: Nur Neues nach Änderungen: nichts dazu', [pv.counts.kopien, pv.added.length], [0, 0]);
  t.eq('RECOG-3: verkaufter Despotar steht unter „Von dir entfernt“', pv.removedByYou.map((x) => [x.title, x.qty]), [['Despotar', 1]]);
  const note = (pv.notes || []).join(' ');
  t.ok('RECOG-3: Hinweis nennt die geänderten Zeilen', /3 Zeilen in deiner Liste haben sich/.test(note) && /Hundemon/.test(note) && /Lucario/.test(note) && !/—/.test(note), note);
  env.uiCall('importCommit', {});
  t.eq('RECOG-3: Daten nach Import 2 unverändert', r3Counts(env), before);
  const moves = env.proto().filter((e) => e['Typ'] === 'umgezogen');
  t.eq('RECOG-3: 3 Umzüge im Protokoll, erledigt', moves.map((e) => e['Status']), ['erledigt', 'erledigt', 'erledigt']);
  // Import 3 mit derselben (geänderten) Liste: alles bekannt, nichts neu erkannt
  const r = r3Run(env, R3_V2, 'neu');
  t.eq('RECOG-3: Import 3: alles bekannt', [r.counts.bekannt, r.counts.eindeutig], [3, 0]);
  const pv3 = env.uiCall('importBuildPreview');
  t.eq('RECOG-3: Import 3: nichts dazu, Despotar bleibt weg', [pv3.counts.kopien, pv3.removedByYou.length], [0, 1]);
  // Zurücknehmen von Import 2 geht und ändert an Daten nichts
  env.ctx.importResetDraft_();
  env.uiCall('importUndo', 2, {});
  t.eq('RECOG-3: Import 2 zurückgenommen, Daten gleich', r3Counts(env), before);
  r3Run(env, R3_V2, 'neu');
  t.eq('RECOG-3: danach wieder mit geänderter Liste: nichts dazu', env.uiCall('importBuildPreview').counts.kopien, 0);
});
safe(() => {
  // nur ein fester Wert der Vorlage geändert: kein neuer Fingerabdruck
  const env = W.newEnv();
  r3Import1(env);
  const r = r3Run(env, R3_V1, 'neu', { cond: 'NM' });
  t.eq('RECOG-3: fester Zustand NM: alles bekannt', [r.counts.bekannt, r.counts.eindeutig], [3, 0]);
  const pv = env.uiCall('importBuildPreview');
  t.eq('RECOG-3: fester Zustand NM: nichts dazu, Despotar bleibt weg', [pv.counts.kopien, pv.removedByYou.length], [0, 1]);
  const c = env.ctx;
  const ex = (raw, fixed) => c.extractRow_({ srcRows: [2], raw, extrasRaw: {} }, { form: 'liste', fixed }, c.loadTerms_());
  const fpA = c.fingerprint_(ex({ name: 'Glurak', number: '4' }, { cond: 'NM', lang: 'EN' }));
  const fpB = c.fingerprint_(ex({ name: 'Glurak', number: '4' }, {}));
  const fpC = c.fingerprint_(ex({ name: 'Glurak', number: '4', cond: 'NM' }, {}));
  t.ok('RECOG-3: feste Werte zählen nicht im Fingerabdruck, Zellwerte schon', fpA === fpB && fpC !== fpB, [fpA, fpB, fpC]);
});
safe(() => {
  // Abgleich mit geänderter Liste: nichts weniger, nichts doppelt
  const env = W.newEnv();
  r3Import1(env);
  const before = r3Counts(env);
  r3AddTerm(env);
  r3Run(env, R3_V2, 'abgleich');
  const pv = env.uiCall('importBuildPreview');
  t.eq('RECOG-3: Abgleich nach Änderungen: nichts weniger, nichts dazu', [pv.counts.weniger, pv.counts.kopien], [0, 0]);
  env.uiCall('importCommit', {});
  t.eq('RECOG-3: Abgleich: Daten unverändert', r3Counts(env), before);
});
safe(() => {
  // eine wirklich neue Karte kommt weiter dazu; Umzug hin und zurück
  const env = W.newEnv();
  r3Import1(env);
  r3AddTerm(env);
  r3Run(env, R3_V2.concat([['Gengar', '5', '', 'HeartGold & SoulSilver', '8,00 €', '01.10.2026', '']]), 'neu');
  const pv = env.uiCall('importBuildPreview');
  t.eq('RECOG-3: neue Karte kommt dazu', pv.added.map((a) => [a.title, a.qty]), [['Gengar', 1]]);
  const c = env.ctx;
  const mv = (nr, from, to) => ({ type: 'umgezogen', nr, fp: to, data: { from }, status: 'erledigt', sourceId: 'S' });
  const res = c.prAliasResolver_([mv(1, 'A', 'B'), mv(2, 'B', 'A')], () => true, () => true, null);
  t.eq('RECOG-3: Umzug hin und zurück', [res('A'), res('B')], ['A', 'A']);
  const res2 = c.prAliasResolver_([mv(1, 'A', 'B'), mv(2, 'B', 'C')], () => true, () => true, null);
  t.eq('RECOG-3: Umzug in zwei Schritten', [res2('A'), res2('B'), res2('C')], ['C', 'C', 'C']);
});

/* ---------- RECOG-1: Promo-Nummer + Set-Text eines normalen Sets ---------- */
t.section('RECOG-1 Promo-Nummer und Set-Text');
const recogRows = (env, rows, src) => {
  const r = W.run(env, rows.map((x) => [x[0], x[1], x[3] || '', x[2], '', '', '']), 'neu', src);
  return (name, number, set) => r.items.find((i) => i.values.name === name && i.values.number === number && i.values.set === set);
};
const r1Rows = [
  ['Ho-Oh', 'HGSS 01', 'HeartGold & SoulSilver'],
  ['Ho-Oh', 'HGSS 01', 'HeartGold & SoulSilver Promo'],
  ['Lucario', 'DP 16', 'Diamant & Perl Promos'],
  ['Mega-Lucario-ex', 'MEP 091', 'Mega-Entwicklung'],
  ['Mega-Lucario-ex', 'MEP 091', 'Mega Evolution Promos'],
  ['Hundemon', 'UD 82', 'HeartGold & SoulSilver'],
  ['Plaudagei', 'DP12', 'Diamant & Perl'],
  ['', 'HGSS 01', 'HeartGold & SoulSilver']
];
[true, false].forEach((prefill) => safe(() => {
  const env = W.newEnv({ prefill });
  const get = recogRows(env, r1Rows, 'SRCRECOG1' + (prefill ? 'A' : 'B'));
  const tag = prefill ? ' (vorbelegt)' : ' (ohne Vorbelegen)';
  const card = (it) => (it && it.card ? it.card.id : '');
  const cands = (it) => (it && it.candidates ? it.candidates.map((x) => x.id) : []);
  t.eq('RECOG-1: HGSS 01 + HeartGold & SoulSilver -> Ho-Oh-Promo' + tag, card(get('Ho-Oh', 'HGSS 01', 'HeartGold & SoulSilver')), 'hgssp-HGSS01');
  t.eq('RECOG-1: HGSS 01 + „… Promo“ -> Ho-Oh-Promo' + tag, card(get('Ho-Oh', 'HGSS 01', 'HeartGold & SoulSilver Promo')), 'hgssp-HGSS01');
  t.eq('RECOG-1: DP 16 + Diamant & Perl Promos -> Lucario-Promo' + tag, card(get('Lucario', 'DP 16', 'Diamant & Perl Promos')), 'dpp-DP16');
  t.eq('RECOG-1: MEP 091 + Mega-Entwicklung -> Mega-Lucario-ex' + tag, card(get('Mega-Lucario-ex', 'MEP 091', 'Mega-Entwicklung')), 'mep-091');
  t.eq('RECOG-1: MEP 091 + Mega Evolution Promos -> Mega-Lucario-ex' + tag, card(get('Mega-Lucario-ex', 'MEP 091', 'Mega Evolution Promos')), 'mep-091');
  const pl = get('Plaudagei', 'DP12', 'Diamant & Perl');
  t.ok('RECOG-1: DP12 + Diamant & Perl nie still Plinfa' + tag, card(pl) !== 'dp1-12' && (card(pl) === 'dpp-DP12' || (pl.status === 'unklar' && cands(pl).indexOf('dpp-DP12') >= 0)),
    [pl && pl.status, card(pl), cands(pl)]);
  const noName = get('', 'HGSS 01', 'HeartGold & SoulSilver');
  t.ok('RECOG-1: ohne Namen nie Arkani' + tag, card(noName) !== 'hgss1-1' && cands(noName).indexOf('hgss1-1') < 0, [noName && noName.status, card(noName), cands(noName)]);
  if (prefill) t.eq('RECOG-1: UD 82 + HeartGold & SoulSilver -> Hundemon', card(get('Hundemon', 'UD 82', 'HeartGold & SoulSilver')), 'hgss3-82');
}));
safe(() => {
  const env = W.newEnv();
  const c = env.ctx;
  const idx = c.loadCmSets_();
  const p1 = c.parseSetNumber_('Diamant & Perl Promos', 'DP 16', idx);
  t.eq('RECOG-1: ungefährer Set-Text ist unsicher (beide Sets, mehrdeutig)', [p1.weak, p1.ambiguous, p1.setIds.slice().sort()], [true, true, ['dp1', 'dpp']]);
  const p2 = c.parseSetNumber_('HeartGold & SoulSilver', 'HGSS 01', idx);
  t.eq('RECOG-1: Set-Text und Kürzel widersprechen sich', [p2.conflict, p2.ambiguous, p2.setIds, p2.exact], [true, true, ['hgss1', 'hgssp'], { hgss1: true }]);
  const p3 = c.parseSetNumber_('Diamant & Perl', 'DP 16', idx);
  t.eq('RECOG-1: Set-Text grenzt das Kürzel ein (wie bisher)', [p3.setIds, p3.number, p3.ambiguous], [['dp1'], '16', false]);
  const cards = [['s-1', '1', 'Arkani'], ['s-16', '16', 'Panferno']];
  t.eq('RECOG-1: erMatchNumber_ nur genau', [c.erMatchNumber_(cards, 'HGSS01', true).length, c.erMatchNumber_(cards, 'HGSS01').length, c.erMatchNumber_(cards, 'MEP016').length], [0, 1, 1]);
});

/* ---------- RECOG-2: Name der Zeile muss zu Set + Nummer bzw. Link passen ---------- */
t.section('RECOG-2 Namensprüfung bei Set + Nummer und Link');
safe(() => {
  // wie review/recog_series_settext.js: Quapsel hgss1-82, Kramurx ex12-62 (Set ohne deutsche Daten)
  const env = W.newEnv({
    extraCards: [
      ['hgss1-82', 'Quapsel', 'Poliwag', { normal: true, reverse: true }, { trend: 0.1, holo: 0.3 }],
      ['ex12-62', 'Kramurx', 'Murkrow', { normal: true, reverse: true }, { trend: 0.4, holo: 0.9 }]
    ],
    extraSets: { ex12: { en: 'Legend Maker', de: 'Legend Maker', official: 92, total: 93, date: '2006-02-01', noDe: true } }
  });
  // Übersetzung wie aus tcgdex (Kramurx gibt es in neueren deutschen Sets)
  const tr = env.sheet('Übersetzung');
  tr.getRange(tr.getLastRow() + 1, 1, 1, 4).setValues([['Kramurx', 'Murkrow', 3, '']]);
  const T = W.CM + 'Unleashed/Tyranitar-UL88';
  const get = recogRows(env, [
    ['Hundemon', '82', 'HeartGold & SoulSilver'],
    ['Hundemon', '82', '', T],
    ['Despotar', '88', 'Entfesselt', T],
    ['Tyranitar', '88', 'Entfesselt'],
    ['Lucario Promo', 'DP 16', 'DP Black Star Promos'],
    ['', '', '', T],
    ['Hundemon', '82', 'Unerschrocken'],
    ['Ditto', '62', 'Legend Maker'],
    ['Kramurx', '62', 'Legend Maker']
  ], 'SRCRECOG2X');
  const h1 = get('Hundemon', '82', 'HeartGold & SoulSilver');
  t.eq('RECOG-2: Serienname im Set: unklar statt Quapsel', [h1.status, h1.card ? h1.card.id : '', h1.candidates.map((x) => x.id)], ['unklar', '', ['hgss3-82', 'hgss1-82']]);
  t.ok('RECOG-2: Grund nennt den Widerspruch', /^Name passt nicht zu Set und Nummer\./.test(h1.reason) && !/—/.test(h1.reason), h1.reason);
  const h2 = get('Hundemon', '82', '');
  t.eq('RECOG-2: fremder Link: unklar, Despotar nur Kandidat', [h2.status, h2.candidates.map((x) => x.id).indexOf('hgss2-88') >= 0, /Cardmarket-Link/.test(h2.reason)], ['unklar', true, true]);
  t.eq('RECOG-2: passender deutscher Name mit Link: eindeutig', get('Despotar', '88', 'Entfesselt').card.id, 'hgss2-88');
  t.eq('RECOG-2: englischer Name passt auch', get('Tyranitar', '88', 'Entfesselt').card.id, 'hgss2-88');
  t.eq('RECOG-2: Name mit Zusatz (Anfang) passt', get('Lucario Promo', 'DP 16', 'DP Black Star Promos').card.id, 'dpp-DP16');
  t.eq('RECOG-2: ohne Namen zählt der Name aus dem Link', get('', '', '').card.id, 'hgss2-88');
  t.eq('RECOG-2: richtiges Set: eindeutig', get('Hundemon', '82', 'Unerschrocken').card.id, 'hgss3-82');
  const di = get('Ditto', '62', 'Legend Maker');
  t.eq('RECOG-2: falsches Set (Ditto in Legend Maker): unklar, nicht Murkrow', [di.status, di.card ? di.card.id : ''], ['unklar', '']);
  t.eq('RECOG-2: Set ohne deutsche Daten, deutscher Name über die Übersetzung', get('Kramurx', '62', 'Legend Maker').card.id, 'ex12-62');
  // Vorschau: Quapsel kommt nicht mehr dazu
  const pv = env.uiCall('importBuildPreview');
  t.ok('RECOG-2: Vorschau ohne Quapsel', !pv.added.some((a) => /Quapsel/.test(a.title)), pv.added.map((a) => a.title));
});

/* ---------- RECOG-4: Kürzel alter Sets auch ohne „Set-Zuordnung vorbelegen“ ---------- */
t.section('RECOG-4 Kürzel ohne Vorbelegen');
safe(() => {
  const env = W.newEnv({ prefill: false });
  const r = W.run(env, [
    ['Ditto', 'DS 62', '', '', '', '', ''],
    ['Hundemon', 'UD 82', '', '', '', '', ''],
    ['Despotar', 'UL 88', '', '', '', '', '']
  ], 'neu', 'SRCRECOG4A');
  t.eq('RECOG-4: DS/UD/UL ohne Vorbelegen eindeutig', r.items.map((i) => [i.values.number, i.status, i.card && i.card.id]),
    [['DS 62', 'eindeutig', 'ex11-62'], ['UD 82', 'eindeutig', 'hgss3-82'], ['UL 88', 'eindeutig', 'hgss2-88']]);
  const sh = env.sheet('Import-Sets');
  t.eq('RECOG-4: Blatt Import-Sets bleibt leer (kein Abruf, nichts geschrieben)', sh ? Math.max(0, sh.getLastRow() - 1) : 0, 0);
});
safe(() => {
  const env = W.newEnv({ prefill: false });
  const c = env.ctx;
  const sh = c.getOrCreateSheet_(c.ss_(), 'Import-Sets');
  c.writeHeaders_(sh, c.CMSETS_HEADERS || ['Cardmarket-Name', 'Kürzel', 'tcgdex-Sets', 'Herkunft']);
  sh.getRange(2, 1, 2, 4).setValues([['Mein Set', 'DS', 'pl3', 'Hand'], ['Unerschrocken', '', 'hgss3', 'Hand']]);
  const idx = c.loadCmSets_();
  t.eq('RECOG-4: Hand-Kürzel hat Vorrang vor der Liste', idx.byCode.DS, ['pl3']);
  t.ok('RECOG-4: Set mit Hand-Zeile bekommt kein Listen-Kürzel', !idx.byCode.UD, idx.byCode.UD);
  t.eq('RECOG-4: andere Sets aus der Liste', [idx.byCode.UL, idx.byCode.HGSS], [['hgss2'], ['hgssp']]);
  t.ok('RECOG-4: Sets, die es im Cache nicht gibt, bekommen nichts', !idx.byCode.RS, idx.byCode.RS);
});

/* ---------- RECOG-5: Suche in der Prüfliste mit „DP 16“ / „DS 62“ ---------- */
t.section('RECOG-5 Suche mit Leerzeichen in der Nummer');
safe(() => {
  const env = W.newEnv();
  const c = env.ctx;
  const r = W.run(env, [['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', '']], 'neu', 'SRCRECOG5A');
  const it = r.items.find((i) => i.values.name === 'Lucario Promo');
  t.eq('RECOG-5: Zeile ist in der Prüfliste', it.status, 'unklar');
  const s = env.uiCall('importReviewSearch', it.fp, {});
  t.ok('RECOG-5: Suche ohne Eingabe nutzt „DP16“', s.number === 'DP16' && !(s.notes || []).some((n) => /DP 16/.test(n)), [s.stage, s.number, s.notes]);
  const s2 = env.uiCall('importReviewSearch', it.fp, { name: 'Lucario', number: 'DP 16', set: '' });
  t.eq('RECOG-5: Suche Lucario / DP 16 findet die Promo', (s2.cards || []).map((x) => x.id), ['dpp-DP16']);
  t.eq('RECOG-5: erSearchInput_ schreibt zusammen, auch ohne bekanntes Kürzel',
    ['DP 16', 'HGSS 01', 'XY 5', 'QQ 62/113', 'DS 62', '62'].map((n) => c.erSearchInput_({ name: '', number: n, set: '' }, c.loadCmSets_()).number),
    ['DP16', 'HGSS01', 'XY5', 'QQ62/113', '62', '62']);
});
safe(() => {
  const env = W.newEnv({ prefill: false });
  const get = (set, num) => { try { return env.uiCall('getCardBySetNumber', set, num).id; } catch (e) { return 'Fehler: ' + e.message; } };
  t.eq('RECOG-5: Set wählen mit „DP 16“', get('dpp', 'DP 16'), 'dpp-DP16');
  t.eq('RECOG-5: Set wählen mit „DS 62“ (nur die Ziffern passen)', get('ex11', 'DS 62'), 'ex11-62');
  t.eq('RECOG-5: Set wählen mit „16“ in den DP-Promos', get('dpp', '16'), 'dpp-DP16');
  t.eq('RECOG-5: genaue Nummer wie bisher', get('hgss3', '82'), 'hgss3-82');
  t.ok('RECOG-5: unbekannte Nummer: Fehler wie bisher', /Nummer 999 gibt es in diesem Set nicht/.test(get('hgss3', '999')), get('hgss3', '999'));
});

// @@END@@
t.done();
