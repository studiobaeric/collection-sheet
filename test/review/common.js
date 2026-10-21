'use strict';
// Gemeinsame Helfer für die Review-Repros (nur erfundene Testdaten).
const path = require('path');
const H = require('../harness2');

const GLURAK = {
  dataLang: 'de', id: 'swsh3-025', name: 'Glurak', nameEn: 'Charizard', setId: 'swsh3', setName: 'Flammende Finsternis',
  setDate: '2020-08-14', localId: '025', setSize: 189, img: 'https://assets.tcgdex.net/de/x/swsh3-025', rarity: 'Rare',
  category: 'Pokemon', illustrator: 'X', baseVariant: 'normal', variant: 'normal', price: 1.5, priceDate: '2026-10-13'
};
const GLURAK_REV = Object.assign({}, GLURAK, { variant: 'reverse', price: 2 });
const BASE = Object.assign({}, GLURAK, { id: 'base1-4', setId: 'base1', setName: 'Grundset', localId: '4', price: 250 });
const FREE = { free: true, name: 'Pikachu Promo', setName: 'Black Star', localId: '012/50' };

function vals(o) {
  return Object.assign({
    name: '', nameClean: '', number: '', set: '', qty: 1, variant: '', cond: '', lang: 'DE', version: '', cmUrl: '',
    tcgdexId: '', price: null, priceDate: '', extras: {}, skip: null, raw: {}
  }, o || {});
}
let rowSeq = 2;
function clear(fp, qty, card, v) {
  return {
    fp, srcRows: [rowSeq++], values: vals(Object.assign({ qty, name: card.name, nameClean: card.name, number: card.localId, set: card.setName }, v || {})),
    qty, status: 'eindeutig', reason: '', candidates: [], decision: null, card, prefilled: false, confirmed: false
  };
}
function known(fp, qty, v) {
  return { fp, srcRows: [rowSeq++], values: vals(Object.assign({ qty, name: 'Glurak' }, v || {})), qty, status: 'bekannt', reason: '',
    candidates: [], decision: null, card: null, prefilled: false, confirmed: false };
}
function mkEnv(files) {
  const env = H.createEnv(files ? { files } : {});
  env.ctx.einrichtung();
  env.ui.alerts.length = 0;
  return env;
}
function seed(env, o) {
  const c = env.ctx;
  c.importSaveDraft_({
    sourceId: o.sourceId || 'SRC1', sourceName: o.sourceName || 'Pokemon Ordner', sourceUrl: '', kind: 'sheet', tmpId: '',
    tab: o.tab || 'Tabellenblatt1', cfg: o.cfg || { form: 'liste', extras: [] }, templateName: o.template || 'Ordnerliste',
    mode: o.mode || 'neu', stage: o.stage || 'vorschau', recognizePos: o.items.length, total: o.items.length,
    startedAt: '2026-10-15', skipped: { summe: 0, leer: 0, nichtAngehakt: 0 }
  });
  c.withLock_(function () { c.reviewWriteAll_(o.items); });
}
/** Hand-Zeile direkt anlegen (wie addCard, ohne tcgdex). */
function handRow(env, card, qty, opts) {
  const c = env.ctx;
  let eid;
  c.withLock_(function () {
    const st = c.dataStore_();
    const row = c.buildCardRow_(card, Object.assign({ count: qty, origin: 'Hand', headers: st.headers, width: st.width }, opts || {}));
    eid = row[c.COL ? c.COL.eid : 23];
    c.storeAdd_(st, row);
    c.storeSave_(st);
    c.rebuildGroups_();
  });
  return eid;
}
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
function show(env, label) {
  console.log('--- ' + label);
  env.data().forEach(r => console.log('   ', r.eid, r.origin, r.fp || '-', 'count=' + r.count, r.cond || '-', r.lang, r.version || '-', r.key));
}
module.exports = { H, GLURAK, GLURAK_REV, BASE, FREE, vals, clear, known, mkEnv, seed, handRow, sum, show };
