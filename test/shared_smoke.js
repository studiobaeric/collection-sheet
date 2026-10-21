const H = require('./harness2');
const env = H.createEnv({ files: ['Code.gs', '../parts/00_shared.gs'] });
const c = env.ctx;
c.einrichtung && c.einrichtung();
c.answersUpsert_('SRC1', [{fp: 'aaa', decision: {type: 'karte', id: 'x1', lang: 'de'}, card: {id: 'x1'}}, {fp: 'bbb', decision: {type: 'skip'}}]);
c.answersUpsert_('SRC2', [{fp: 'aaa', decision: {type: 'frei'}, card: {free: true, name: 'X'}}]);
c.answersUpsert_('SRC1', [{fp: 'bbb', decision: null}, {fp: 'aaa', decision: {type: 'karte', id: 'x2', lang: 'en'}, card: {id: 'x2'}}]);
console.log(JSON.stringify(c.answersLoad_('SRC1')), JSON.stringify(c.answersLoad_('SRC2')));
c.reviewWriteAll_([{fp: 'f1', srcRows: [2, 3], values: {name: 'Glurak'}, qty: 2, status: 'unklar', reason: 'r', candidates: [{id: 'a'}], decision: null, card: null, prefilled: false, confirmed: false},
  {fp: 'f2', srcRows: [4], values: {}, qty: 1, status: 'eindeutig', card: {id: 'b'}}]);
const items = c.reviewRead_();
console.log(JSON.stringify(items));
items[0].decision = {type: 'skip'}; items[0].confirmed = true; c.reviewWriteItems_([items[0]]);
console.log(c.reviewRead_().map(it => JSON.stringify(c.reviewResolve_(it))).join(' '));
c.importSaveDraft_({sourceId: 'S', tmpId: ''}); console.log(JSON.stringify(c.importDraft_())); c.importResetDraft_(); console.log(c.importDraft_());
c.importSetRun_(3, 'commit'); console.log(JSON.stringify(c.importRunState_())); try { c.importAssertNoRun_(); } catch (e) { console.log('throws:', e.message); } c.importClearRun_(); console.log(c.importRunState_());
