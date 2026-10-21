'use strict';
/**
 * Tests für Teil „Protokoll“ (parts/30_protokoll.gs): Abdeckung, Plan je Modus, Vorschau, Übernehmen mit
 * Protokoll 'geplant' -> 'erledigt', Abbruch + Fortsetzen, Liste, Zurücknehmen (Vorschau + Ausführen).
 * Nur erfundene Testdaten; Entwurf und Prüfung werden direkt gesetzt (ohne Teil „Erkennung“).
 *
 *   node test_import_protokoll.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./harness2');

const t = H.runner('import-protokoll');
const PARTS = path.join(__dirname, '..', 'parts');

// ---------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------

const GLURAK = {
  dataLang: 'de', id: 'swsh3-025', name: 'Glurak', nameEn: 'Charizard', setId: 'swsh3', setName: 'Flammende Finsternis',
  setDate: '2020-08-14', localId: '025', setSize: 189, img: 'https://assets.tcgdex.net/de/x/swsh3-025', rarity: 'Rare',
  category: 'Pokemon', illustrator: 'X', baseVariant: 'normal', variant: 'normal', price: 1.5, priceDate: '2026-10-13'
};
const GLURAK_REV = Object.assign({}, GLURAK, { variant: 'reverse', price: 2 });
const NOPRICE = Object.assign({}, GLURAK, { id: 'swsh3-136', localId: '136', img: 'https://assets.tcgdex.net/de/x/swsh3-136', price: null, priceDate: '' });
const BASE = {
  dataLang: 'de', id: 'base1-4', name: 'Glurak', nameEn: 'Charizard', setId: 'base1', setName: 'Grundset', setDate: '1999-01-09',
  localId: '4', setSize: 102, img: '', rarity: 'Rare Holo', category: 'Pokemon', illustrator: 'Mitsuhiro Arita',
  baseVariant: 'holo', variant: 'holo', price: 250, priceDate: '2026-10-13'
};
const MEWTWO_EN = {
  dataLang: 'en', id: 'old9-007', name: 'Mewtwo', nameEn: 'Mewtwo', setId: 'old9', setName: 'Old Set', setDate: '2001-01-01',
  localId: '007', setSize: 50, img: 'https://assets.tcgdex.net/en/x/old9-007', rarity: 'Rare', category: 'Pokemon',
  illustrator: 'X', baseVariant: 'normal', variant: 'normal', price: 0.8, priceDate: '2026-10-13'
};
const FREE = { free: true, name: 'Pikachu Promo', setName: 'Black Star', localId: '012/50' };

function vals(o) {
  return Object.assign({
    name: '', nameClean: '', number: '', set: '', qty: 1, variant: '', cond: '', lang: 'DE', version: '', cmUrl: '',
    tcgdexId: '', price: null, priceDate: '', extras: {}, skip: null, raw: {}
  }, o || {});
}

let rowSeq = 2;
function base(fp, qty, status, v) {
  return {
    fp: fp, srcRows: [rowSeq++], values: vals(Object.assign({ qty: qty }, v || {})), qty: qty, status: status, reason: '',
    candidates: [], decision: null, card: null, prefilled: false, confirmed: false
  };
}
/** eindeutig erkannt */
function clear(fp, qty, card, v) {
  const it = base(fp, qty, 'eindeutig', Object.assign({ name: card.name, nameClean: card.name, number: card.localId, set: card.setName }, v || {}));
  it.card = card;
  return it;
}
/** unklar ohne Entscheidung */
function unclear(fp, qty, v) {
  const it = base(fp, qty, 'unklar', Object.assign({ name: 'Rätselkarte' }, v || {}));
  it.reason = 'mehrere Treffer';
  it.candidates = [{ id: 'swsh3-025', lang: 'de', name: 'Glurak' }];
  return it;
}
/** unklar mit Entscheidung (karte | frei | skip) */
function decided(fp, qty, type, card, v, prefilled) {
  const it = base(fp, qty, 'unklar', Object.assign({ name: card ? card.name : 'Irgendwas' }, v || {}));
  it.decision = type === 'karte' ? { type: 'karte', id: card.id, lang: 'de' } : { type: type };
  it.card = card || null;
  it.prefilled = !!prefilled;
  it.confirmed = !prefilled;
  return it;
}
function known(fp, qty, v) {
  return base(fp, qty, 'bekannt', Object.assign({ name: 'Glurak' }, v || {}));
}
function unchecked(fp) {
  const it = base(fp, 0, 'übersprungen', { name: 'Nicht angehakt' });
  it.reason = 'nicht angehakt';
  return it;
}

// ---------------------------------------------------------------------------
// Umgebung
// ---------------------------------------------------------------------------

function mkEnv() {
  const env = H.createEnv({ files: ['Code.gs', '../parts/00_shared.gs', '../parts/30_protokoll.gs'] });
  env.ctx.einrichtung();
  env.ui.alerts.length = 0;
  return env;
}

/** Entwurf + Prüfung setzen, wie es Teil „Erkennung“ am Ende hinterlässt. */
function seed(env, o) {
  const c = env.ctx;
  c.importSaveDraft_({
    sourceId: o.sourceId || 'SRC1', sourceName: o.sourceName || 'Pokemon Ordner', sourceUrl: '', kind: 'sheet', tmpId: '',
    tab: o.tab || 'Karten', cfg: o.cfg || { form: 'liste', extras: [] }, templateName: o.template || 'Ordnerliste',
    mode: o.mode || 'neu', stage: o.stage || 'vorschau', recognizePos: o.items.length, total: o.items.length,
    startedAt: '2026-10-15', skipped: o.skipped || { summe: 0, leer: 0, nichtAngehakt: 0 }
  });
  c.withLock_(function () { c.reviewWriteAll_(o.items); });
}

function rowsOf(env, nr) {
  return env.data().filter(r => r.origin === 'Import ' + nr);
}
function rowBy(env, pred) {
  return env.data().find(pred);
}
function protoOf(env, nr) {
  return env.proto().filter(p => Number(p['Import-Nr']) === nr);
}
function importeRow(env, nr) {
  return env.objects('Importe').find(o => Number(o.Nr) === nr);
}
function setRun(env, nr, phase, agoMs) {
  env.props.IMPORT_RUN = JSON.stringify({ nr: nr, phase: phase, at: Date.now() - (agoMs || 0) });
}
function sum(list, f) { return list.reduce((s, x) => s + (Number(f(x)) || 0), 0); }

// ---------------------------------------------------------------------------
// 1. Erster Import (Nur Neues), Vorschau, Protokoll, Importe, Antworten
// ---------------------------------------------------------------------------
t.section('Import 1: Nur Neues');
{
  const env = mkEnv();
  const c = env.ctx;
  t.throws('Vorschau ohne Entwurf', () => env.uiCall('importBuildPreview'), /kein Import in Arbeit/);
  seed(env, { stage: 'erkennung', items: [clear('fpX', 2, GLURAK)] });
  t.throws('Vorschau während der Erkennung', () => env.uiCall('importBuildPreview'), /Erkennung ist noch nicht fertig/);

  const items = [
    clear('fpX', 2, GLURAK, { cond: 'NM' }),
    clear('fpY', 1, GLURAK_REV),
    decided('fpF', 1, 'frei', FREE, { name: 'Pikachu Promo', price: 2.5, priceDate: '01.10.2026', variant: 'holo' }),
    clear('fpN', 1, NOPRICE, { price: 3.1 }),
    clear('fpE', 1, MEWTWO_EN, { name: 'Mewtu', nameClean: 'Mewtu' }),
    unclear('fpU', 1),
    decided('fpK', 1, 'skip', null, { name: 'Energie' }),
    unchecked('fpC')
  ];
  seed(env, { items: items, skipped: { summe: 1, leer: 2, nichtAngehakt: 1 } });
  const pv = env.uiCall('importBuildPreview');
  t.eq('Vorschau: Modus', [pv.mode, pv.modeLabel, pv.sourceName, pv.tab], ['neu', 'Nur Neues', 'Pokemon Ordner', 'Karten']);
  t.eq('Vorschau: Zahlen', [pv.counts.neu, pv.counts.mehr, pv.counts.kopien, pv.counts.weniger, pv.counts.pruefOffen, pv.counts.uebersprungen],
    [5, 0, 6, 0, 1, 1]);
  t.eq('Vorschau: neu-Liste', pv.added.map(a => [a.fp, a.qty, a.newGroup]),
    [['fpX', 2, true], ['fpY', 1, true], ['fpF', 1, true], ['fpN', 1, true], ['fpE', 1, true]]);
  const ax = pv.added[0];
  t.eq('Vorschau: Titel und Unterzeile', [ax.title, ax.sub, ax.image],
    ['Glurak', 'Flammende Finsternis · 025/189 · Normal · DE NM', GLURAK.img]);
  t.eq('Vorschau: übersprungen und offen', pv.skipped.map(s => [s.fp, s.reason]),
    [['fpU', 'In der Prüfliste noch offen'], ['fpK', 'Von dir übersprungen']]);
  t.eq('Vorschau: keine Hand-Treffer, nichts entfernt', [pv.handMatch.length, pv.removedByYou.length, pv.decreased.length], [0, 0, 0]);
  // Wert: 2 × 1,50 + 1 × 2,00 + eigener Preis 2,50 + eigener Preis 3,10 + 0,80
  t.eq('Vorschau: Wertänderung', pv.valueChange, 11.4);
  t.eq('Vorschau: Quelle ausgelassen', pv.sourceSkipped, { summe: 1, leer: 2, nichtAngehakt: 1 });
  t.ok('Vorschau schreibt nichts', env.data().length === 0 && env.proto().length === 0);

  const res = env.uiCall('importCommit', {});
  t.eq('Commit: Nr 1', res.nr, 1);
  t.ok('Commit: Meldung', /^Import 1 ist fertig: 6 Exemplare übernommen \(5 neue Karten\)\. Wert \+11,40 €\./.test(res.message), res.message);
  const rows = rowsOf(env, 1);
  t.eq('Daten: 5 Zeilen Import 1 mit Quellzeile', rows.map(r => [r.fp, r.count]).sort(),
    [['fpE', 1], ['fpF', 1], ['fpN', 1], ['fpX', 2], ['fpY', 1]]);
  const rx = rows.find(r => r.fp === 'fpX');
  t.eq('Daten: Felder der Zeile X', [rx.id, rx.variant, rx.cond, rx.lang, rx.key, rx.price, rx.ownPrice],
    ['swsh3-025', 'normal', 'NM', 'DE', 'swsh3-025|normal||NM|DE', 1.5, '']);
  const rf = rows.find(r => r.fp === 'fpF');
  t.eq('Freie Karte: Schlüssel, Variante aus der Quelle, eigener Preis mit Datum',
    [rf.id, rf.source, rf.variant, rf.key, rf.ownPrice, rf.ownPriceDate, rf.setSize],
    ['', 'frei', 'holo', 'frei:pikachu promo~black star~12|holo||' + '|DE', 2.5, '2026-10-01', 50]);
  const rn = rows.find(r => r.fp === 'fpN');
  t.eq('Karte ohne Trendpreis: eigener Preis heute', [rn.ownPrice, rn.ownPriceDate], [3.1, c.todayText_()]);
  const re = rows.find(r => r.fp === 'fpE');
  t.eq('en-Ersatz: Name aus der Quelle, englischer Name', [re.name, re.nameEn, re.source], ['Mewtu', 'Mewtwo', 'en-Ersatz']);
  t.ok('Eintrag-IDs eindeutig', new Set(rows.map(r => r.eid)).size === 5);

  const pr = protoOf(env, 1);
  t.eq('Protokoll: 5 × neu, alle erledigt', [pr.length, pr.every(p => p.Typ === 'neu' && p.Status === 'erledigt')], [5, true]);
  const px = pr.find(p => p.Quellzeile === 'fpX');
  const dx = JSON.parse(px.Daten);
  t.eq('Protokoll: Schnappschuss X', [px['Eintrag-ID'], px.Menge, dx.id, dx.variant, dx.version, dx.cond, dx.lang, dx.ownPrice, dx.title, dx.card.id, px['Quelle-ID']],
    [rx.eid, 2, 'swsh3-025', 'normal', '', 'NM', 'DE', '', 'Glurak', 'swsh3-025', 'SRC1']);

  const imp = importeRow(env, 1);
  t.eq('Importe: Zeile', [imp.Quelle, imp['Quelle-ID'], imp.Tab, imp.Vorlage, imp.Modus, imp.Status, imp.Neu, imp.Mehr, imp.Weniger,
    imp['Übersprungen'], imp['Prüfliste offen'], imp['Wertänderung (EUR)']],
  ['Pokemon Ordner', 'SRC1', 'Karten', 'Ordnerliste', 'Nur Neues', 'aktiv', 5, 0, 0, 1, 1, 11.4]);
  t.ok('Importe: Datum als Text yyyy-MM-dd HH:mm', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(imp.Datum)), imp.Datum);
  t.ok('Importe: Bericht', /6 Exemplare übernommen/.test(imp.Bericht) && /In der Quelle ausgelassen: 1 Summenzeile, 2 leere Zeilen/.test(imp.Bericht), imp.Bericht);
  t.ok('Lauf beendet', !env.props.IMPORT_RUN);
  t.ok('Entwurf und Prüfung geleert', c.importDraft_() === null && c.reviewRead_().length === 0);
  const ans = c.answersLoad_('SRC1');
  t.eq('Antworten gesichert (frei, skip)', [ans.fpF && ans.fpF.decision.type, ans.fpK && ans.fpK.decision.type, !!ans.fpX], ['frei', 'skip', false]);
  const g = env.groups();
  t.ok('Gruppen neu aufgebaut', g.length === 5 && g.some(x => x['Gruppenschlüssel'] === 'swsh3-025|normal|' && Number(x.Anzahl) === 2));

  const list = env.uiCall('importList');
  t.eq('importList', [list.length, list[0].nr, list[0].status, list[0].mode, list[0].modeCode, list[0].counts, list[0].valueChange, list[0].undoneAt],
    [1, 1, 'aktiv', 'Nur Neues', 'neu', { neu: 5, mehr: 0, weniger: 0, uebersprungen: 1, pruefOffen: 1 }, 11.4, '']);

  // coverageFor_
  const cov = c.coverageFor_('SRC1');
  t.eq('Abdeckung X', [cov.fpX.D, cov.fpX.held, cov.fpX.Rall, cov.fpX.Rundone, cov.fpX.rows.length], [2, 2, 0, 0, 1]);
  t.ok('Abdeckung andere Quelle leer', Object.keys(c.coverageFor_('ANDERE')).length === 0);

  // Re-Import derselben Quelle: nichts Neues, nur der Unterschied
  t.section('Re-Import Nur Neues');
  seed(env, { items: [known('fpX', 2), clear('fpY', 1, GLURAK_REV), clear('fpN', 3, NOPRICE, { price: 9.99 })] });
  const pv2 = env.uiCall('importBuildPreview');
  t.eq('Re-Import: nur 2 mehr von N', [pv2.counts.kopien, pv2.counts.mehr, pv2.counts.neu, pv2.counts.bekannt], [2, 2, 0, 2]);
  t.eq('Re-Import: neu-Liste', pv2.added.map(a => [a.fp, a.qty, a.newGroup]), [['fpN', 2, false]]);
  const r2 = env.uiCall('importCommit');
  t.eq('Re-Import: Import 2', r2.nr, 2);
  const n2 = rowsOf(env, 2);
  t.eq('Re-Import: eine Zeile mit 2', n2.map(r => [r.fp, r.count]), [['fpN', 2]]);
  t.eq('Re-Import: eigener Preis nicht noch einmal (Gruppe hat schon einen)', [n2[0].ownPrice, rowBy(env, r => r.fp === 'fpN' && r.origin === 'Import 1').ownPrice], ['', 3.1]);
  seed(env, { items: [known('fpX', 2), clear('fpY', 1, GLURAK_REV), clear('fpN', 3, NOPRICE)] });
  const pv3 = env.uiCall('importBuildPreview');
  t.eq('Dritter Lauf: nichts mehr neu', [pv3.counts.kopien, pv3.added.length, pv3.counts.bekannt], [0, 0, 3]);
  t.eq('Lock nie verschachtelt', env.lock.nested, 0);
}

// ---------------------------------------------------------------------------
// 2. Von dir entfernt (handentfernt) und Modus „Alles addieren“
// ---------------------------------------------------------------------------
t.section('Von dir entfernt');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 2, GLURAK, { cond: 'NM' })] });
  env.uiCall('importCommit');
  const r1 = rowsOf(env, 1)[0];
  const adj = env.uiCall('adjustEntry', r1.eid, -1);
  t.eq('Eric verkauft 1 (handentfernt)', [adj.count, adj.token.logIds.length], [1, 1]);
  const he = env.proto().find(p => p.Typ === 'handentfernt');
  t.eq('handentfernt-Eintrag', [Number(he['Import-Nr']), he.Quellzeile, he.Menge, he['Quelle-ID']], [1, 'fpX', 1, 'SRC1']);

  seed(env, { items: [known('fpX', 2, { cond: 'NM' })] });
  const pv = env.uiCall('importBuildPreview');
  t.eq('Nur Neues: nichts wieder hinzugefügt', [pv.counts.kopien, pv.added.length], [0, 0]);
  t.eq('Nur Neues: in „Von dir entfernt“', pv.removedByYou.map(x => [x.fp, x.qty, x.ticked, x.title]), [['fpX', 1, false, 'Glurak']]);
  const pvT = env.uiCall('importBuildPreview', { removed: { fpX: true } });
  t.eq('Haken: 1 kommt zurück', [pvT.counts.kopien, pvT.added.map(a => a.qty)], [1, [1]]);
  const res = env.uiCall('importCommit', { removed: { fpX: true } });
  const back = rowsOf(env, res.nr);
  t.eq('Haken: neue Zeile aus dem Schnappschuss (Karte war „bekannt“)', back.map(r => [r.id, r.variant, r.cond, r.count, r.fp]),
    [['swsh3-025', 'normal', 'NM', 1, 'fpX']]);
  seed(env, { items: [known('fpX', 2, { cond: 'NM' })] });
  const pvAfter = env.uiCall('importBuildPreview');
  t.eq('Danach: nichts mehr entfernt oder neu', [pvAfter.removedByYou.length, pvAfter.counts.kopien], [0, 0]);

  t.section('Alles addieren');
  const env2 = mkEnv();
  seed(env2, { items: [clear('fpX', 2, GLURAK)] });
  env2.uiCall('importCommit');
  seed(env2, { mode: 'alle', items: [clear('fpX', 2, GLURAK)] });
  const pa = env2.uiCall('importBuildPreview');
  t.eq('alle: addiert alles noch einmal', [pa.counts.kopien, pa.counts.mehr, pa.removedByYou.length], [2, 2, 0]);
  const ra = env2.uiCall('importCommit');
  t.eq('alle: Importe-Modus', importeRow(env2, ra.nr).Modus, 'Alles addieren');
  t.eq('alle: zweite Zeile', rowsOf(env2, ra.nr).map(r => r.count), [2]);
  env2.uiCall('adjustEntry', rowsOf(env2, 1)[0].eid, -1);
  seed(env2, { mode: 'alle', items: [clear('fpX', 2, GLURAK)] });
  const pb = env2.uiCall('importBuildPreview');
  t.eq('alle mit handentfernt: 1 weniger, 1 in „Von dir entfernt“', [pb.counts.kopien, pb.removedByYou.map(x => x.qty)], [1, [1]]);
  const pc = env2.uiCall('importBuildPreview', { removed: { fpX: true } });
  t.eq('alle mit Haken: 2', pc.counts.kopien, 2);
}

// ---------------------------------------------------------------------------
// 3. Abgleich
// ---------------------------------------------------------------------------
t.section('Mit Quelle abgleichen');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 2, GLURAK), clear('fpY', 1, GLURAK_REV), clear('fpW', 1, BASE), clear('fpV', 2, NOPRICE)] });
  env.uiCall('importCommit');
  seed(env, { mode: 'alle', items: [clear('fpX', 2, GLURAK)] });
  env.uiCall('importCommit');
  // Hand-Zeile derselben Karte: Abgleich darf sie nie anfassen
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: '', qty: 1 });
  const handBefore = rowBy(env, r => r.origin === 'Hand');
  t.eq('vorher: X gehalten 4 (2 + 2)', sum(env.data().filter(r => r.fp === 'fpX'), r => r.count), 4);

  const items = [
    clear('fpX', 1, GLURAK), // 3 weniger: zuerst Import 2 (2), dann Import 1 (1)
    unclear('fpW', 1), // unklar: nie weniger
    clear('fpV', 2, NOPRICE), // gleich
    clear('fpZ', 1, BASE, { cond: 'EX' }) // neu
    // fpY fehlt in der Quelle -> S = 0
  ];
  seed(env, { mode: 'abgleich', items: items });
  const pv = env.uiCall('importBuildPreview');
  t.eq('Abgleich: Zahlen', [pv.counts.weniger, pv.counts.kopien, pv.counts.pruefOffen], [4, 1, 1]);
  t.eq('Abgleich: jüngster Import zuerst', pv.decreased.map(d => [d.title, d.qty, d.fromImport]),
    [['Glurak', 2, 2], ['Glurak', 1, 1], ['Glurak', 1, 1]]);
  // −3 × 1,50 (X) − 1 × 2,00 (Y) + 250 (Z neu)
  t.eq('Abgleich: Wertänderung', pv.valueChange, 243.5);

  // Eric ändert die Anzahl von Y, nachdem der Plan steht -> dieser Abgleich wird übersprungen
  const origAppend = c.appendProto_;
  const rowY = rowBy(env, r => r.fp === 'fpY');
  c.appendProto_ = function (entries) {
    if (entries.some(e => e.type === 'abgleich' && e.status === 'geplant')) {
      env.sheet('Daten').getRange(rowY.row, 14).setValue(5); // Spalte Anzahl
    }
    return origAppend(entries);
  };
  const res = env.uiCall('importCommit');
  c.appendProto_ = origAppend;
  t.eq('Abgleich: Import 3', res.nr, 3);
  t.ok('Abgleich: Meldung nennt die geänderte Zeile', /von dir|inzwischen geändert/.test(res.message), res.message);
  const xs = env.data().filter(r => r.fp === 'fpX');
  t.eq('Abgleich: X jetzt 1 (Import 1), 0 (Import 2)', xs.map(r => [r.origin, r.count]).sort(), [['Import 1', 1], ['Import 2', 0]]);
  t.eq('Abgleich: W unklar bleibt', rowBy(env, r => r.fp === 'fpW').count, 1);
  t.eq('Abgleich: V gleich bleibt', rowBy(env, r => r.fp === 'fpV').count, 2);
  t.eq('Abgleich: Y übersprungen (Eric hat 5 daraus gemacht)', rowBy(env, r => r.fp === 'fpY').count, 5);
  t.eq('Abgleich: Hand-Zeile unberührt', rowBy(env, r => r.eid === handBefore.eid).count, 1);
  t.eq('Abgleich: Z neu', rowsOf(env, 3).map(r => [r.fp, r.count, r.cond]), [['fpZ', 1, 'EX']]);
  const ab = protoOf(env, 3).filter(p => p.Typ === 'abgleich');
  t.eq('Abgleich: Protokoll mit countBefore', ab.map(p => [p.Menge, JSON.parse(p.Daten).countBefore, JSON.parse(p.Daten).fromImport, p.Status]).sort(),
    [[-1, 1, 1, 'übersprungen'], [-1, 2, 1, 'erledigt'], [-2, 2, 2, 'erledigt']]);
  const imp = importeRow(env, 3);
  t.eq('Abgleich: Importe Weniger zählt nur Erledigtes', [imp.Weniger, imp.Modus], [3, 'Mit Quelle abgleichen']);
  t.ok('Abgleich: Bericht nennt Übersprungenes', /inzwischen geändert/.test(imp.Bericht), imp.Bericht);
  const cov = c.coverageFor_('SRC1');
  t.eq('Abdeckung X nach Abgleich: D 1, held 1', [cov.fpX.D, cov.fpX.held], [1, 1]);

  // Checkliste: nicht angehakt heißt beim Abgleich „weg“
  seed(env, { mode: 'abgleich', items: [clear('fpX', 1, GLURAK), unchecked('fpV'), clear('fpZ', 1, BASE, { cond: 'EX' }), clear('fpY', 5, GLURAK_REV), unclear('fpW', 1)] });
  const pv2 = env.uiCall('importBuildPreview');
  t.eq('Abgleich: nicht angehakt -> alles weg', pv2.decreased.map(d => [d.qty, d.fromImport]), [[2, 1]]);
  t.eq('Lock nie verschachtelt', env.lock.nested, 0);
}

// ---------------------------------------------------------------------------
// 4. Schon von Hand erfasst, eigener Preis
// ---------------------------------------------------------------------------
t.section('Schon von Hand erfasst');
{
  const env = mkEnv();
  const c = env.ctx;
  const h = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  const hf = env.uiCall('addFreeCard', { name: 'Pikachu Promo', setName: 'Black Star', number: '012/50', variant: 'holo', qty: 2 });
  seed(env, {
    items: [
      clear('fpX', 2, GLURAK, { cond: 'NM' }),
      decided('fpF', 1, 'frei', FREE, { variant: 'holo' }),
      clear('fpY', 1, GLURAK_REV)
    ]
  });
  const pv = env.uiCall('importBuildPreview');
  t.eq('Hand-Treffer: X und freie Karte', pv.handMatch.map(m => [m.fp, m.qty, m.handCount, m.choice]), [['fpX', 2, 1, 'same'], ['fpF', 1, 2, 'same']]);
  t.eq('Hand-Treffer: nur der Rest kommt dazu', pv.added.map(a => [a.fp, a.qty]), [['fpX', 1], ['fpY', 1]]);
  t.eq('Hand-Treffer: gleich gezählt', pv.counts.gleich, 2);
  const pe = env.uiCall('importBuildPreview', { hand: { fpX: 'extra' } });
  t.eq('Zusätzliches Exemplar: alles dazu', pe.added.map(a => [a.fp, a.qty]), [['fpX', 2], ['fpY', 1]]);

  const res = env.uiCall('importCommit', { hand: { fpF: 'same' } });
  const gl = protoOf(env, res.nr).filter(p => p.Typ === 'gleich');
  t.eq('gleich-Einträge mit Hand-Eintrag-ID', gl.map(p => [p['Eintrag-ID'], p.Quellzeile, p.Menge, JSON.parse(p.Daten).count]).sort(),
    [[h.eid, 'fpX', 1, 1], [hf.eid, 'fpF', 1, 2]].sort());
  t.eq('Hand-Zeilen bleiben Hand mit gleicher Anzahl', [rowBy(env, r => r.eid === h.eid).count, rowBy(env, r => r.eid === h.eid).origin,
    rowBy(env, r => r.eid === hf.eid).count], [1, 'Hand', 2]);
  t.eq('Import-Zeilen: X mit 1, Y mit 1, keine für F', rowsOf(env, res.nr).map(r => [r.fp, r.count]).sort(), [['fpX', 1], ['fpY', 1]]);
  seed(env, { items: [clear('fpX', 2, GLURAK, { cond: 'NM' }), decided('fpF', 1, 'frei', FREE, { variant: 'holo' })] });
  const pv2 = env.uiCall('importBuildPreview');
  t.eq('Re-Import danach: nichts und kein erneuter Hand-Treffer', [pv2.counts.kopien, pv2.handMatch.length], [0, 0]);

  // zweite Quelle: Hand-Exemplar ist schon vergeben
  seed(env, { sourceId: 'SRC2', sourceName: 'Zweite Liste', items: [clear('fpQ', 1, GLURAK, { cond: 'NM' })] });
  const pv3 = env.uiCall('importBuildPreview');
  t.eq('Andere Quelle: Hand-Exemplar schon von Import 1 vergeben, daher kein Treffer mehr', [pv3.handMatch.length, pv3.added.map(a => a.qty)], [0, [1]]);

  t.section('Eigener Preis');
  const env2 = mkEnv();
  env2.uiCall('addCard', { id: 'swsh3-136', lang: 'de', variant: 'base', condition: '', qty: 1, ownPrice: '4,00' });
  seed(env2, {
    items: [
      clear('fpN', 1, NOPRICE, { price: 9.5, cond: 'LP' }), // Gruppe hat schon eigenen Preis -> keiner
      clear('fpX', 1, GLURAK, { price: 7 }), // hat Trendpreis -> keiner
      clear('fpB', 1, BASE, { price: 3, version: 'Staff' }), // hat Trendpreis -> keiner
      decided('fpF', 1, 'frei', FREE, { price: null }), // ohne Quellpreis -> keiner
      decided('fpG', 1, 'frei', { free: true, name: 'Mew Promo', setName: '', localId: '8' }, { price: 1.234, priceDate: '2026-09-30' })
    ]
  });
  const res2 = env2.uiCall('importCommit', { hand: { fpN: 'extra' } });
  const rs = rowsOf(env2, res2.nr);
  const own = fp => { const r = rs.find(x => x.fp === fp); return [r.ownPrice, r.ownPriceDate]; };
  t.eq('eigener Preis: Gruppe hat schon einen', own('fpN'), ['', '']);
  t.eq('eigener Preis: Trendpreis vorhanden', [own('fpX'), own('fpB')], [['', ''], ['', '']]);
  t.eq('eigener Preis: ohne Quellpreis', own('fpF'), ['', '']);
  t.eq('eigener Preis: freie Karte mit Quellpreis und Datum', own('fpG'), [1.23, '2026-09-30']);
  t.eq('Sonderversion landet in Zeile und Gruppe', [rs.find(x => x.fp === 'fpB').version, rs.find(x => x.fp === 'fpB').key], ['Staff', 'base1-4|holo|Staff||DE']);
  t.eq('Hand-Zeile mit eigenem Preis unverändert', rowBy(env2, r => r.origin === 'Hand').ownPrice, 4);
}

// ---------------------------------------------------------------------------
// 5. Abbruch, Fortsetzen, Lauf-Sperre
// ---------------------------------------------------------------------------
t.section('Abbruch und Fortsetzen');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 3, GLURAK), clear('fpY', 1, GLURAK_REV)] });
  env.uiCall('importCommit');
  // Import 2: Abgleich mit Neuem und Weniger; appendDataRows_ wirft einmal (nachdem 'geplant' geschrieben ist)
  seed(env, {
    mode: 'abgleich',
    cfg: { form: 'liste', extras: [{ col: 6, name: 'Ordner', show: true }] },
    items: [clear('fpX', 1, GLURAK), clear('fpY', 1, GLURAK_REV), clear('fpZ', 2, BASE, { extras: { Ordner: 'Blau' } })]
  });
  const origAppend = c.appendDataRows_;
  let thrown = 0;
  c.appendDataRows_ = function (rows) {
    if (!thrown) { thrown++; throw new Error('Zeitüberschreitung (Test)'); }
    return origAppend(rows);
  };
  t.throws('Commit bricht ab', () => env.uiCall('importCommit'), /Der Import wurde unterbrochen.*fortsetzen oder zurücknehmen/);
  c.appendDataRows_ = origAppend;
  const pl = protoOf(env, 2);
  t.eq('Protokoll: alles noch geplant (spalte, neu, abgleich)', [pl.map(p => p.Typ), pl.every(p => p.Status === 'geplant')], [['spalte', 'neu', 'abgleich'], true]);
  t.eq('Importe: Status läuft (gespeichert)', importeRow(env, 2).Status, 'läuft');
  t.ok('Fehler hat den Lauf freigegeben', !env.props.IMPORT_RUN);
  t.eq('importList: unterbrochen', env.uiCall('importList')[0].status, 'unterbrochen');
  t.ok('Entwurf noch da (mit committingNr)', c.importDraft_() && c.importDraft_().committingNr === 2);

  // harter Abbruch (Zeitlimit): IMPORT_RUN bleibt stehen
  setRun(env, 2, 'commit', 60 * 1000);
  t.eq('frischer Lauf: läuft', env.uiCall('importList')[0].status, 'läuft');
  t.throws('frischer Lauf: Commit gesperrt', () => env.uiCall('importCommit'), /Gerade läuft schon ein Import oder Zurücknehmen/);
  t.throws('frischer Lauf: Fortsetzen gesperrt', () => env.uiCall('importResume', 2), /Gerade läuft schon/);
  t.throws('frischer Lauf: Zurücknehmen gesperrt', () => env.uiCall('importUndo', 1, {}), /Gerade läuft schon/);
  t.throws('frischer Lauf: Vorschau Zurücknehmen gesperrt', () => env.uiCall('importUndoPreview', 2), /Gerade läuft schon/);
  setRun(env, 2, 'commit', 7 * 60 * 1000);
  t.eq('alter Lauf (7 Minuten): unterbrochen', env.uiCall('importList')[0].status, 'unterbrochen');
  t.throws('neuer Commit verweigert, solange unterbrochen', () => env.uiCall('importCommit'), /Import 2 wurde unterbrochen.*Fortsetzen.*Zurücknehmen/);
  t.throws('anderen Import zurücknehmen verweigert', () => env.uiCall('importUndo', 1, {}), /Import 2 wurde unterbrochen/);

  const abBefore = env.data().filter(r => r.fp === 'fpX').map(r => r.count);
  t.eq('Abgleich schon geschrieben vor dem Abbruch', abBefore, [1]);
  const rr = env.uiCall('importResume', 2);
  t.ok('Fortsetzen: Meldung', /Import 2 ist jetzt fertig/.test(rr.message), rr.message);
  t.eq('Fortsetzen: keine doppelte Abnahme, Z einmal da', [env.data().filter(r => r.fp === 'fpX').map(r => r.count), rowsOf(env, 2).map(r => [r.fp, r.count, r.extras.Ordner])],
    [[1], [['fpZ', 2, 'Blau']]]);
  t.eq('Fortsetzen: Protokoll erledigt', protoOf(env, 2).map(p => p.Status), ['erledigt', 'erledigt', 'erledigt']);
  t.eq('Fortsetzen: Importe aktiv, Weniger 2', [importeRow(env, 2).Status, importeRow(env, 2).Weniger], ['aktiv', 2]);
  t.eq('Fortsetzen: Zusatzspalte in der Sammlung', c.getViewExtras_(), ['Ordner']);
  t.ok('Fortsetzen: Entwurf geleert, Lauf weg', c.importDraft_() === null && !env.props.IMPORT_RUN);
  const rr2 = env.uiCall('importResume', 2);
  t.ok('Fortsetzen zweimal: nichts doppelt', /schon fertig/.test(rr2.message) && rowsOf(env, 2).length === 1, rr2.message);
  t.eq('Spalte nur einmal angelegt', c.extraNames_(), ['Ordner']);

  // Fortsetzen ohne vorherigen „weichen“ Fehler: Lauf stirbt nach den geplanten Einträgen
  t.section('Harter Abbruch nach geplanten Einträgen');
  seed(env, { items: [clear('fpQ', 2, NOPRICE, { price: 2 })] });
  const origProto = c.appendProto_;
  c.appendProto_ = function (entries) {
    const ids = origProto(entries);
    if (entries.some(e => e.status === 'geplant')) throw new Error('hart');
    return ids;
  };
  t.throws('Commit stirbt', () => env.uiCall('importCommit'), /unterbrochen/);
  c.appendProto_ = origProto;
  setRun(env, 3, 'commit', 10 * 60 * 1000);
  t.eq('unterbrochen (Lauf alt)', env.uiCall('importList')[0].status, 'unterbrochen');
  t.eq('noch keine Zeile', rowsOf(env, 3).length, 0);
  env.uiCall('importResume', 3);
  t.eq('nach Fortsetzen: Zeile da, eigener Preis aus dem Schnappschuss', rowsOf(env, 3).map(r => [r.fp, r.count, r.ownPrice]), [['fpQ', 2, 2]]);
  env.uiCall('importResume', 3);
  t.eq('zweites Fortsetzen: keine Doppelten', rowsOf(env, 3).length, 1);
  t.eq('Lock nie verschachtelt', env.lock.nested, 0);
}

// ---------------------------------------------------------------------------
// 6. Zurücknehmen: Vorschau, Entscheidungen, Ausführen
// ---------------------------------------------------------------------------
t.section('Zurücknehmen: Vorschau');
{
  const env = mkEnv();
  const c = env.ctx;
  const cfg = { form: 'liste', extras: [{ col: 6, name: 'Ordner', show: true }] };
  seed(env, {
    cfg: cfg,
    items: [
      clear('fpA', 3, GLURAK, { cond: 'NM', extras: { Ordner: 'A' } }),
      clear('fpB', 1, GLURAK_REV, { cond: 'NM' }),
      decided('fpF', 1, 'frei', FREE, { variant: 'normal', price: 1.5 }),
      clear('fpZ', 2, BASE),
      clear('fpN', 1, NOPRICE, { extras: { Ordner: 'A' } }),
      clear('fpU', 1, MEWTWO_EN)
    ]
  });
  env.uiCall('importCommit');
  t.eq('Zusatzspalte angelegt und gezeigt', [c.extraNames_(), c.getViewExtras_()], [['Ordner'], ['Ordner']]);
  t.eq('spalte im Protokoll', protoOf(env, 1).filter(p => p.Typ === 'spalte').map(p => JSON.parse(p.Daten).name), ['Ordner']);
  const R = fp => rowBy(env, r => r.fp === fp && r.origin === 'Import 1');
  const eidA = R('fpA').eid, eidB = R('fpB').eid, eidF = R('fpF').eid, eidZ = R('fpZ').eid, eidN = R('fpN').eid, eidU = R('fpU').eid;

  // Änderungen von Eric danach
  env.uiCall('editEntry', eidB, { cond: 'LP' });
  const split = env.uiCall('editEntry', eidA, { cond: 'EX' }, 1);
  const gF = c.groupKey_({ id: '', name: 'Pikachu Promo', setName: 'Black Star', localId: '012', variant: 'normal', version: '' });
  env.uiCall('linkFreeGroup', gF, 'swsh3-136', 'de', 'base');
  env.uiCall('setGroupOwnPrice', 'base1-4|holo|', '4,20');
  env.uiCall('editEntry', eidN, { extras: { Ordner: 'B' } });
  env.uiCall('adjustEntry', eidU, -1); // verkauft: Anzahl 0, handentfernt
  // Hand-Zeile mit demselben Schlüssel wie das abgespaltene Exemplar
  const hand = env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'EX', qty: 1 });

  const pv = env.uiCall('importUndoPreview', 1);
  const ch = {};
  pv.changed.forEach(x => { ch[x.eid] = x; });
  t.eq('Vorschau: geänderte Zeilen', Object.keys(ch).sort(), [split.eid, eidB, eidF, eidZ, eidN].sort());
  t.eq('Vorschau: Zustand', ch[eidB].changes, ['Zustand NM → LP']);
  t.eq('Vorschau: aufgeteilt', ch[split.eid].changes, ['Aufgeteilt', 'Zustand NM → EX']);
  t.eq('Vorschau: verknüpft', ch[eidF].changes, ['Mit tcgdex-Karte verknüpft']);
  t.eq('Vorschau: eigener Preis', ch[eidZ].changes, ['Eigener Preis ohne → 4,20 €']);
  t.eq('Vorschau: Zusatzwert', ch[eidN].changes, ['Zusatzwert Ordner: A → B']);
  t.eq('Vorschau: Zahlen (A unverändert, U mit 0 ohne Frage)', pv.counts, { loeschen: 2, zurueck: 0, fehlt: 0, bleiben: 0 }); // bleiben: Review DATA-6
  t.eq('Vorschau: Titel/Unterzeile/Anzahl', [ch[eidB].title, ch[eidB].sub, ch[eidB].count], ['Glurak', 'Flammende Finsternis · 025/189 · Reverse Holo · DE LP', 1]);
  t.eq('Vorschau: sonst', [pv.sourceName, pv.laterSameSource, pv.newTerms], ['Pokemon Ordner', [], []]);
  t.ok('Vorschau schreibt nichts', importeRow(env, 1).Status === 'aktiv');

  t.section('Zurücknehmen: Ausführen');
  t.throws('ohne Entscheidungen verweigert', () => env.uiCall('importUndo', 1, {}), /noch offen: 5/);
  t.throws('teilweise entschieden verweigert', () => env.uiCall('importUndo', 1, { [eidB]: 'remove', [eidF]: 'keep' }), /noch offen: 3/);
  t.ok('nach Verweigerung kein Lauf übrig', !env.props.IMPORT_RUN);
  const handentferntBefore = env.proto().filter(p => p.Typ === 'handentfernt').length;
  let rewrites = 0;
  const origRewrite = c.rewriteData_;
  c.rewriteData_ = function (rows) { rewrites++; return origRewrite(rows); };
  const res = env.uiCall('importUndo', 1, {
    [split.eid]: 'keep', [eidB]: 'remove', [eidF]: 'keep', [eidZ]: 'remove', [eidN]: 'keep'
  });
  c.rewriteData_ = origRewrite;
  t.eq('ein rewriteData_', rewrites, 1);
  t.eq('Ergebnis', [res.nr, res.deleted, res.kept, res.restored, res.skipped], [1, 4, 3, 0, 0]);
  t.ok('Meldung', /Import 1 ist zurückgenommen: 4 Einträge gelöscht, 3 behalten/.test(res.message), res.message);
  t.eq('keine Zeile Import 1 mehr', rowsOf(env, 1).length, 0);
  t.eq('abgespaltenes Exemplar in die Hand-Zeile EX eingerechnet', [rowBy(env, r => r.eid === hand.eid).count, !rowBy(env, r => r.eid === split.eid)], [2, true]);
  const rf = rowBy(env, r => r.eid === eidF);
  t.eq('verknüpfte Karte bleibt als Hand', [rf.origin, rf.fp, rf.id, rf.key, rf.ownPrice], ['Hand', '', 'swsh3-136', 'swsh3-136|normal|||DE', 1.5]);
  // N (swsh3-136, gleicher Schlüssel wie die verknüpfte Karte) wird beim Behalten in diese Hand-Zeile eingerechnet,
  // sein Zusatzwert füllt das leere Feld
  t.eq('N in dieselbe Hand-Zeile eingerechnet, Zusatzwert übernommen', [!rowBy(env, r => r.eid === eidN), rf.count, rf.extras.Ordner], [true, 2, 'B']);
  t.ok('B, Z, A, U gelöscht', ![eidA, eidB, eidZ, eidU].some(e => rowBy(env, r => r.eid === e)));
  t.eq('Zusatzspalte bleibt (N hat noch einen Wert)', c.extraNames_(), ['Ordner']);
  t.eq('handentfernt bleibt', env.proto().filter(p => p.Typ === 'handentfernt').length, handentferntBefore);
  const imp = importeRow(env, 1);
  t.eq('Importe: zurückgenommen', imp.Status, 'zurückgenommen');
  t.ok('Importe: Zurückgenommen am', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(imp['Zurückgenommen am'])), imp['Zurückgenommen am']);
  t.ok('Importe: Bericht ergänzt', /Zurückgenommen am .*4 Einträge gelöscht/.test(imp.Bericht), imp.Bericht);
  const l = env.uiCall('importList')[0];
  t.eq('importList: zurückgenommen mit Datum', [l.status, !!l.undoneAt], ['zurückgenommen', true]);
  t.throws('zweimal zurücknehmen verweigert', () => env.uiCall('importUndo', 1, {}), /schon zurückgenommen/);
  t.throws('Vorschau für zurückgenommenen Import', () => env.uiCall('importUndoPreview', 1), /schon zurückgenommen/);
  t.ok('Gruppen ohne Import-Zeilen', env.groups().every(g => !/Import/.test(JSON.stringify(g))));
  t.eq('Lock nie verschachtelt', env.lock.nested, 0);
}

t.section('Zurücknehmen: Zusatzspalte entfernen');
{
  const env = mkEnv();
  const c = env.ctx;
  c.setViewExtras_([]);
  seed(env, {
    cfg: { form: 'liste', extras: [{ col: 7, name: 'Fach', show: true }] },
    items: [clear('fpX', 1, GLURAK, { extras: { Fach: '3' } }), clear('fpY', 1, GLURAK_REV, { extras: { Fach: '4' } })]
  });
  env.uiCall('importCommit');
  t.eq('Fach angelegt und gezeigt', [c.extraNames_(), c.getViewExtras_(), env.groups().length, Object.keys(env.groups()[0]).includes('Fach')],
    [['Fach'], ['Fach'], 2, true]);
  const pv = env.uiCall('importUndoPreview', 1);
  t.eq('unverändert: nichts zu entscheiden', [pv.changed.length, pv.counts.loeschen], [0, 2]);
  const res = env.uiCall('importUndo', 1, {});
  t.eq('Spalte gelöscht und aus der Sammlung', [res.droppedColumns, c.extraNames_(), c.getViewExtras_(), Object.keys(env.groups()[0] || {}).includes('Fach')],
    [['Fach'], [], [], false]);
  t.eq('Daten leer', env.data().length, 0);
  const head = env.values('Daten')[0];
  t.eq('Kopfzeile ohne Fach', head.length, 30);
}

// ---------------------------------------------------------------------------
// 7. Älteren Import zurücknehmen, Abgleich wiederherstellen, Re-Import nach Zurücknehmen
// ---------------------------------------------------------------------------
t.section('Älterer Import, Abgleich, Re-Import');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 2, GLURAK)] });
  env.uiCall('importCommit'); // 1: X 2
  const r1 = rowsOf(env, 1)[0];
  env.uiCall('adjustEntry', r1.eid, -1); // verkauft 1
  seed(env, { mode: 'alle', items: [clear('fpX', 2, GLURAK)] });
  const ra = env.uiCall('importCommit'); // 2: alle -> 1 (1 von dir entfernt)
  t.eq('Import 2 (alle) fügt 1 hinzu', rowsOf(env, 2).map(r => r.count), [1]);
  seed(env, { mode: 'abgleich', items: [clear('fpX', 1, GLURAK)] });
  env.uiCall('importCommit'); // 3: abgleich S = 1, held 2 -> Import 2 auf 0
  t.eq('Abgleich nimmt beim jüngsten Import', [rowsOf(env, 1)[0].count, rowsOf(env, 2)[0].count], [1, 0]);

  const pv3 = env.uiCall('importUndoPreview', 3);
  t.eq('Vorschau Abgleich-Import: 1 zurück, nichts zu löschen', [pv3.counts.zurueck, pv3.counts.loeschen, pv3.changed.length], [1, 0, 0]);
  const u3 = env.uiCall('importUndo', 3, {});
  t.eq('Abgleich zurückgenommen: Import 2 wieder 1', [u3.restored, rowsOf(env, 2)[0].count, rowsOf(env, 1)[0].count], [1, 1, 1]);
  t.eq('Vorschau Import 1: später Import 2 derselben Quelle aktiv', env.uiCall('importUndoPreview', 1).laterSameSource, [2]);

  // älteren Import zurücknehmen, neuerer bleibt
  const u1 = env.uiCall('importUndo', 1, {});
  t.eq('Import 1 zurück: Zeile weg, Import 2 bleibt', [u1.deleted, rowsOf(env, 1).length, rowsOf(env, 2).map(r => r.count)], [1, 0, [1]]);
  t.eq('importList', env.uiCall('importList').map(i => [i.nr, i.status]), [[3, 'zurückgenommen'], [2, 'aktiv'], [1, 'zurückgenommen']]);
  const cov = c.coverageFor_('SRC1');
  t.eq('Abdeckung ignoriert zurückgenommene Importe (Rundone)', [cov.fpX.D, cov.fpX.Rundone, cov.fpX.Rall, cov.fpX.held], [1, 1, 1, 1]);
  seed(env, { items: [clear('fpX', 2, GLURAK)] });
  const pa = env.uiCall('importBuildPreview');
  t.eq('Re-Import Nur Neues: nichts, 1 von dir entfernt', [pa.counts.kopien, pa.removedByYou.map(x => x.qty)], [0, [1]]);

  // auch Import 2 zurück -> Re-Import bringt die Karte zurück, die verkaufte bleibt weg
  c.importResetDraft_();
  env.uiCall('importUndo', 2, {});
  seed(env, { items: [clear('fpX', 2, GLURAK)] });
  const pb = env.uiCall('importBuildPreview');
  t.eq('nach Zurücknehmen von allem: 1 neu, 1 von dir entfernt', [pb.counts.kopien, pb.counts.neu, pb.removedByYou.map(x => x.qty)], [1, 1, [1]]);
  const rb = env.uiCall('importCommit');
  t.eq('Re-Import nach Zurücknehmen: neue Nr und Zeile', [rb.nr, rowsOf(env, rb.nr).map(r => [r.fp, r.count])], [4, [['fpX', 1]]]);
  t.eq('Abdeckung danach', [c.coverageFor_('SRC1').fpX.D, c.coverageFor_('SRC1').fpX.held], [1, 1]);
  t.eq('Lock nie verschachtelt', env.lock.nested, 0);
}

// ---------------------------------------------------------------------------
// 8. Lauf-Sperre bei Zurücknehmen, Abbruch beim Zurücknehmen, unterbrochenen Import zurücknehmen
// ---------------------------------------------------------------------------
t.section('Unterbrochenen Import zurücknehmen');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 2, GLURAK), clear('fpY', 1, GLURAK_REV)] });
  env.uiCall('importCommit');
  seed(env, { mode: 'abgleich', items: [clear('fpX', 1, GLURAK), clear('fpN', 1, NOPRICE)] });
  const origAppend = c.appendDataRows_;
  c.appendDataRows_ = function () { throw new Error('weg'); };
  t.throws('Abbruch', () => env.uiCall('importCommit'), /unterbrochen/);
  c.appendDataRows_ = origAppend;
  t.eq('Abgleich vor dem Abbruch geschrieben', [rowsOf(env, 1).find(r => r.fp === 'fpX').count, rowsOf(env, 1).find(r => r.fp === 'fpY').count], [1, 0]);
  const pv = env.uiCall('importUndoPreview', 2);
  t.eq('Vorschau: Status unterbrochen, 2 Abgleiche zurück', [pv.status, pv.counts.zurueck, pv.counts.loeschen], ['unterbrochen', 2, 0]);
  const u = env.uiCall('importUndo', 2, {});
  t.eq('Zurücknehmen stellt den alten Stand her', [u.restored, rowsOf(env, 1).find(r => r.fp === 'fpX').count, rowsOf(env, 1).find(r => r.fp === 'fpY').count], [2, 2, 1]);
  t.eq('Import 2 zurückgenommen, keine Zeilen', [importeRow(env, 2).Status, rowsOf(env, 2).length], ['zurückgenommen', 0]);
  t.ok('Lauf weg', !env.props.IMPORT_RUN);
  // Entwurf mit committingNr eines zurückgenommenen Imports darf neu übernommen werden
  const d = c.importDraft_();
  t.ok('Entwurf noch da', d && d.committingNr === 2);
  const again = env.uiCall('importCommit');
  t.eq('erneut übernommen als Import 3', [again.nr, rowsOf(env, 3).map(r => r.fp)], [3, ['fpN']]);
}

t.section('Lauf-Sperre beim Zurücknehmen');
{
  const env = mkEnv();
  const c = env.ctx;
  seed(env, { items: [clear('fpX', 1, GLURAK)] });
  env.uiCall('importCommit');
  setRun(env, 99, 'undo', 30 * 1000);
  t.throws('Zurücknehmen während Lauf', () => env.uiCall('importUndo', 1, {}), /Gerade läuft schon ein Import oder Zurücknehmen/);
  t.throws('Fortsetzen während Lauf', () => env.uiCall('importResume', 1), /Gerade läuft schon/);
  setRun(env, 99, 'undo', 6 * 60 * 1000 + 5000);
  const u = env.uiCall('importUndo', 1, {});
  t.eq('alter Lauf hält nicht auf', u.deleted, 1);
  // Fehler mitten im Zurücknehmen gibt den Lauf frei
  seed(env, { items: [clear('fpX', 1, GLURAK)] });
  env.uiCall('importCommit');
  const orig = c.rewriteData_;
  c.rewriteData_ = function () { throw new Error('kaputt'); };
  t.throws('Fehler beim Zurücknehmen', () => env.uiCall('importUndo', 2, {}), /kaputt/);
  c.rewriteData_ = orig;
  t.ok('Lauf nach Fehler frei', !env.props.IMPORT_RUN);
  t.eq('Import 2 noch aktiv', importeRow(env, 2).Status, 'aktiv');
  t.eq('Fortsetzen eines aktiven Imports: schon fertig', /schon fertig/.test(env.uiCall('importResume', 2).message), true);
  t.throws('Fortsetzen eines zurückgenommenen Imports', () => env.uiCall('importResume', 1), /zurückgenommen/);
  t.throws('unbekannter Import', () => env.uiCall('importUndoPreview', 42), /gibt es nicht/);
  t.throws('Abgleich ohne Zeilen verweigert', () => { seed(env, { mode: 'abgleich', items: [] }); env.uiCall('importCommit'); }, /keine Karten/);
  t.eq('Daten unverändert nach verweigertem Abgleich', rowsOf(env, 2).map(r => r.count), [1]);
}

// ---------------------------------------------------------------------------
// 9. Hilfen
// ---------------------------------------------------------------------------
t.section('Hilfen');
{
  const env = mkEnv();
  const c = env.ctx;
  t.eq('prDateText_', ['01.10.2026', '1.2.26', '2026-09-30', '2026-09-30T10:00:00Z', 'gestern', '', '31.13.2026'].map(c.prDateText_),
    ['2026-10-01', '2026-02-01', '2026-09-30', '2026-09-30', '', '', '']);
  t.eq('prSub_ freie Karte', c.prSub_(c.buildCardRow_(FREE, { variant: 'holo', cond: 'LP', lang: 'EN', eid: 'E1' })), 'Black Star · 012/50 · Holo · EN LP');
  t.eq('Importe fehlt: leere Liste', env.uiCall('importList'), []);
  t.eq('Abdeckung ohne Daten', c.coverageFor_('X'), {});
}

// ---------------------------------------------------------------------------
// 10. Alle Teile zusammen (falls die anderen Teile schon da sind und laden)
// ---------------------------------------------------------------------------
t.section('Teile zusammen');
{
  const files = ['00_shared.gs', '10_quelle.gs', '20_erkennung.gs', '30_protokoll.gs'];
  const src = files.map(f => {
    const p = path.join(PARTS, f);
    return fs.existsSync(p) ? { f, s: fs.readFileSync(p, 'utf8') } : null;
  }).filter(Boolean);
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  const names = {};
  [{ f: 'Code.gs', s: code }].concat(src).forEach(x => {
    const re = /^(?:function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+))/gm;
    let m;
    while ((m = re.exec(x.s))) {
      const n = m[1] || m[2];
      (names[n] = names[n] || []).push(x.f);
    }
  });
  const mine = Object.keys(names).filter(n => names[n].includes('30_protokoll.gs') && names[n].length > 1);
  t.eq('keine doppelten Namen mit Code.gs oder anderen Teilen', mine.map(n => n + ': ' + names[n].join(', ')), []);
  const all = src.length === files.length;
  if (all) {
    let env = null;
    try {
      env = H.createEnv({ files: ['Code.gs'].concat(files.map(f => '../parts/' + f)) });
    } catch (e) {
      console.log('  (andere Teile laden gerade nicht: ' + e.message + ', übersprungen)');
    }
    if (env) {
      env.ctx.einrichtung();
      seed(env, { items: [clear('fpX', 2, GLURAK)] });
      const r = env.uiCall('importCommit');
      t.eq('zusammen: Commit', [r.nr, rowsOf(env, 1).length], [1, 1]);
      const st = env.uiCall('importState');
      t.eq('zusammen: importState zeigt den Import', [st.imports.length, st.imports[0].status], [1, 'aktiv']);
      t.eq('zusammen: Importe-Blatt aus setupImportSheets_', Object.keys(importeRow(env, 1)).length >= 16, true);
      // hängt an den anderen Teilen: Abweichungen dort nur als Warnung (E2E_STRICT=1 macht sie zu Fehlern)
      const strict = !!process.env.E2E_STRICT;
      const soft = {
        warn: 0,
        section: t.section,
        ok(label, cond, extra) {
          if (strict) return t.ok(label, cond, extra);
          if (cond) console.log('ok  ', label);
          else { soft.warn++; console.log('WARN', label, JSON.stringify(extra === undefined ? '' : extra).slice(0, 600)); }
          return !!cond;
        },
        eq(label, a, b) { return soft.ok(label, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b }); }
      };
      try {
        e2e(soft);
      } catch (e) {
        if (strict) t.ok('e2e ohne Fehler', false, e.message);
        else console.log('WARN Ablauf mit den anderen Teilen abgebrochen: ' + e.message);
      }
      if (soft.warn) console.log('  (' + soft.warn + ' Warnungen im Ablauf mit den anderen Teilen)');
    }
  } else {
    console.log('  (nicht alle Teile vorhanden, übersprungen)');
  }
}

/** Ganzer Ablauf mit den echten Teilen „Quelle“ und „Erkennung“ (erfundene Liste, tcgdex-Attrappe). */
function e2e(t) {
  t.section('Ganzer Ablauf mit Quelle und Erkennung');
  const env = H.createEnv({ files: ['Code.gs', '../parts/00_shared.gs', '../parts/10_quelle.gs', '../parts/20_erkennung.gs', '../parts/30_protokoll.gs'] });
  const c = env.ctx;
  c.einrichtung();
  env.addSource({ id: 'SRCFILE0001', name: 'Meine Liste', mime: 'sheet', tabs: { Karten: [
    ['Karte Name', 'Setnummer', 'Set', 'Anzahl', 'Preis', 'Ordner'],
    ['Glurak', '025/189', 'Flammende Finsternis', '2', '', 'A'],
    ['Mewtu', '7', 'Old Set', '1', '3,50', 'B'],
    ['Unbekannt', '', '', '1', '2,00', 'C'],
    ['Summe', '', '', '', '10,00', '']
  ] } });
  let cfg = null;
  function run(mode) {
    env.uiCall('importOpenSource', 'https://docs.google.com/spreadsheets/d/SRCFILE0001/edit');
    const s = env.uiCall('importSelectTab', 'Karten');
    if (!cfg) {
      cfg = Object.assign({}, s.guess, { form: 'liste', lastRow: 0, fixed: { lang: 'DE', cond: '', variant: '', version: '' },
        extras: [{ col: 5, name: 'Ordner', show: true }] });
    }
    env.uiCall('importStartRecognition', cfg, 'Meine Vorlage', mode);
    let r, g = 0;
    do { r = env.uiCall('importRecognizeStep'); } while (!r.done && g++ < 50);
    return r;
  }
  let r = run('neu');
  t.eq('e2e: Erkennung', r.counts, { eindeutig: 2, unklar: 0, nichtGefunden: 1, uebersprungen: 0, bekannt: 0 });
  env.uiCall('importReviewList').items.forEach(i => env.uiCall('importReviewDecide', i.fp, { type: 'frei' }));
  const pv = env.uiCall('importBuildPreview');
  t.eq('e2e: Vorschau', [pv.counts.neu, pv.counts.kopien, pv.sourceSkipped.summe], [3, 4, 1]);
  const res = env.uiCall('importCommit');
  t.eq('e2e: Daten', env.data().map(d => [d.name, d.count, d.origin, d.ownPrice, d.extras.Ordner]),
    [['Glurak', 2, 'Import 1', '', 'A'], ['Mewtu', 1, 'Import 1', '', 'B'], ['Unbekannt', 1, 'Import 1', 2, 'C']]);
  t.eq('e2e: Sammlung zeigt Ordner', [res.nr, c.getViewExtras_()], [1, ['Ordner']]);
  r = run('neu');
  t.eq('e2e: Re-Import alles bekannt (coverageFor_)', r.counts.bekannt, 3);
  t.eq('e2e: Re-Import Vorschau leer', env.uiCall('importBuildPreview').counts.kopien, 0);
  env.uiCall('importDiscardDraft');
  env.uiCall('adjustEntry', env.data().find(d => d.name === 'Glurak').eid, -1);
  run('neu');
  t.eq('e2e: verkauft -> von dir entfernt', env.uiCall('importBuildPreview').removedByYou.map(x => [x.title, x.qty]), [['Glurak', 1]]);
  env.uiCall('importDiscardDraft');
  const u = env.uiCall('importUndo', 1, {});
  t.eq('e2e: zurückgenommen, Spalte weg', [u.deleted, env.data().length, c.extraNames_(), c.getViewExtras_()], [3, 0, [], []]);
  r = run('neu');
  t.eq('e2e: nach Zurücknehmen vorbelegt', env.uiCall('importReviewList').items.map(i => [i.prefilled, i.decision && i.decision.type]), [[true, 'frei']]);
  const pv2 = env.uiCall('importBuildPreview');
  t.eq('e2e: verkauftes bleibt weg', [pv2.counts.kopien, pv2.removedByYou.map(x => x.qty)], [3, [1]]);
  const res2 = env.uiCall('importCommit');
  t.eq('e2e: Import 2', [res2.nr, env.data().map(d => [d.name, d.count, d.origin])],
    [2, [['Glurak', 1, 'Import 2'], ['Mewtu', 1, 'Import 2'], ['Unbekannt', 1, 'Import 2']]]);
  t.eq('e2e: Liste', env.uiCall('importState').imports.map(i => [i.nr, i.status]), [[2, 'aktiv'], [1, 'zurückgenommen']]);
  t.eq('e2e: Lock nie verschachtelt', env.lock.nested, 0);
}

t.done();
