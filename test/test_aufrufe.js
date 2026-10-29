'use strict';
/**
 * Wie oft spricht der Code mit der Tabelle (#43)? Zählt die Aufrufe an Tabelle, Blätter und Bereiche je Vorgang in
 * einer Sammlung in Erics Größe (102 Einträge) und prüft Obergrenzen, damit es nicht wieder langsamer wird:
 * - Speichern liest erst alles und schreibt dann; nach dem ersten Schreiben liest es nichts mehr (sonst muss die
 *   Tabelle zwischendurch festschreiben und nachrechnen),
 * - die Nachschlagewerte kommen aus dem Zwischenspeicher, gelesen werden sie nur nach einem neuen Stand,
 * - jeder Vorgang schreibt eine Zeile ins Zeitprotokoll.
 * Jeder Aufruf beginnt wie in Apps Script als neue Ausführung (ohne die Merker der vorigen).
 * Start: node test_aufrufe.js (AUFRUFE=1 zeigt jeden Aufruf)
 */
const H = require('./harness2');
const t = H.runner('test_aufrufe');
const ok = t.ok, eq = t.eq;

const N_ENTRIES = 102;
const N_SETS = 12;
const PER_SET = Math.ceil((N_ENTRIES + 20) / N_SETS);
const RARITIES = ['Häufig', 'Ungewöhnlich', 'Selten', 'Selten, Holo'];
const RARE_ID = 'set10-10'; // eine Seltenheit, die es noch nicht gibt (Set 10 kennt die Sammlung schon)
const NEW_SET_ID = 'set12-11'; // die erste Karte aus Set 12

function db() {
  const d = H.defaultDb();
  for (let s = 1; s <= N_SETS; s++) {
    const sid = 'set' + s;
    ['de', 'en'].forEach(lang => {
      d[lang + '/sets/' + sid] = { id: sid, name: (lang === 'de' ? 'Set ' : 'Set EN ') + s, releaseDate: (2010 + s) + '-01-01', cards: [] };
      d[lang + '/sets'] = d[lang + '/sets'].concat([{ id: sid, name: (lang === 'de' ? 'Set ' : 'Set EN ') + s, cardCount: { official: 100, total: 110 } }]);
    });
    for (let n = 1; n <= PER_SET; n++) {
      const id = sid + '-' + n;
      ['de', 'en'].forEach(lang => {
        d[lang + '/cards/' + id] = H.card(id, lang, {
          name: (lang === 'de' ? 'Pokemon ' : 'Pokemon EN ') + s + '-' + n,
          dexId: [((s * 37 + n * 11) % 1025) + 1],
          rarity: id === RARE_ID ? 'Ganz neu selten' : RARITIES[n % 4],
          set: { id: sid, name: (lang === 'de' ? 'Set ' : 'Set EN ') + s, cardCount: { official: 100, total: 110 } }
        });
      });
    }
  }
  return d;
}

const env = H.createEnv({ db: db() });
env.ctx.setupAll_();
const ids = [];
for (let s = 1; s <= N_SETS; s++) for (let n = 1; n <= PER_SET; n++) ids.push('set' + s + '-' + n);
for (let i = 0; i < N_ENTRIES; i++) env.uiCall('addCard', { id: ids[i], lang: 'de', variant: i % 5 === 0 ? 'reverse' : 'base', qty: 1 });
env.ctx.withLock_(() => env.ctx.writeCardHistory_(env.ctx.readData_(env.ctx.sheet_('Daten')))); // wie nach ein paar Preisläufen

// ---------------------------------------------------------------------------
// Zähler: jede Methode von Tabelle, Blatt und Bereich (außer reinem Adressieren wie getRange)
// ---------------------------------------------------------------------------
const READ = /^(get|is|has)/;
const LOCAL = new Set(['getRange', 'getA1Notation', 'getRow', 'getColumn', 'getNumRows', 'getNumColumns', 'getSheet', 'getParent',
  'getLastRowR', 'constructor']);
let on = false, depth = 0, log = null;
function wrap(proto) {
  Object.getOwnPropertyNames(proto).forEach(m => {
    const f = proto[m];
    if (typeof f !== 'function' || LOCAL.has(m) || !/^(get|set|is|has|insert|delete|clear|append|hide|show|copy|sort|merge|protect|auto|toast|flush)/.test(m)) return;
    proto[m] = function (...args) {
      if (!on || depth) return f.apply(this, args);
      depth++;
      try {
        const who = this && this.sh ? this.sh.name : (this && this.name && this.ss ? this.name : 'Tabelle');
        log.push({ read: READ.test(m), what: who + '.' + m + (this && this.nr ? '(' + this.nr + 'x' + this.nc + ')' : ''),
          cells: !READ.test(m) && this && this.nr ? this.nr * this.nc : 0 });
        return f.apply(this, args);
      } finally { depth--; }
    };
  });
}
wrap(Object.getPrototypeOf(env.ss));
wrap(Object.getPrototypeOf(env.ss.getSheets()[0]));
wrap(Object.getPrototypeOf(env.ss.getSheets()[0].getRange(1, 1)));

/** Neue Ausführung wie in Apps Script: Merker der vorigen sind weg (der Zwischenspeicher bleibt). */
function freshExecution() {
  env.run('ssCache_ = null; settingsCache_ = null; tzCache_ = ""; formulaSemi_ = false; dexNamesCache_ = null; dexNameIdxCache_ = null; tmr_ = null; busyNotes_ = null;');
}

/**
 * fn als eigene Ausführung zählen -> {calls, reads, writes, readsAfterWrite, cells, seq, res, logs}. skipWrite (optional):
 * Schreiben in dieses Blatt zählt für readsAfterWrite nicht.
 */
function measure(fn, skipWrite) {
  freshExecution();
  const logs0 = env.logs.length;
  log = [];
  on = true;
  let res;
  try { res = fn(); } finally { on = false; }
  let wrote = false, after = 0, cells = 0;
  log.forEach(x => {
    if (x.read && wrote) after++;
    if (!x.read) { cells += x.cells; if (!skipWrite || x.what.indexOf(skipWrite + '.') !== 0) wrote = true; }
  });
  const reads = log.filter(x => x.read).length;
  const out = { calls: log.length, reads, writes: log.length - reads, readsAfterWrite: after, cells, seq: log.map(x => (x.read ? 'R ' : 'W ') + x.what), res, logs: env.logs.slice(logs0) };
  if (process.env.AUFRUFE) console.log(JSON.stringify({ calls: out.calls, reads, writes: out.writes, after, cells }) + '\n  ' + out.seq.join('\n  '));
  return out;
}

/** Obergrenze prüfen; der Text nennt die gezählten Aufrufe. */
function bound(label, m, max, cellsMax) {
  ok(label + ': ' + m.calls + ' Aufrufe (höchstens ' + max + ')', m.calls <= max, m.seq);
  eq(label + ': nach dem ersten Schreiben nichts mehr gelesen', m.readsAfterWrite, 0);
  if (cellsMax != null) ok(label + ': ' + m.cells + ' Zellen geschrieben (höchstens ' + cellsMax + ')', m.cells <= cellsMax, m.seq);
}

// ---------------------------------------------------------------------------
t.section('Tab Sammlung laden');
{
  env.ctx.dropLookups_();
  const cold = measure(() => env.uiCall('getCollection'));
  ok('ohne Nachschlagewerte im Zwischenspeicher: ' + cold.calls + ' Aufrufe (höchstens 22)', cold.calls <= 22, cold.seq);
  eq('alle Gruppen', cold.res.groups.length, N_ENTRIES);
  const warm = measure(() => env.uiCall('getCollection'));
  ok('danach aus dem Zwischenspeicher: ' + warm.calls + ' Aufrufe (höchstens 8), nur Einstellungen und Daten', warm.calls <= 8 &&
    warm.seq.every(x => /Tool-Einstellungen|Daten|Tabelle/.test(x)), warm.seq);
  eq('dasselbe Ergebnis', JSON.stringify(warm.res), JSON.stringify(cold.res));
  ok('Zeitprotokoll', /^getCollection \d+ ms: .*Daten lesen \d+, Nachschlagewerte \d+/.test(warm.logs.join('\n')), warm.logs);
}

// ---------------------------------------------------------------------------
t.section('Hinzufügen');
const newIds = ids.slice(N_ENTRIES, N_ENTRIES + 6);
newIds.forEach(id => env.run('cacheCards_([{lang: "de", id: "' + id + '", data: fetchJson_(apiUrl_("de", "cards/' + id + '"))}])'));
{
  const m = measure(() => env.uiCall('addCard', { id: newIds[0], lang: 'de', variant: 'base', qty: 1, rid: 'r0' }));
  bound('neue Karte', m, 18, 80);
  ok('schreibt Daten und je eine Zeile Pokédex-Nummern A:C und D:E', m.seq.filter(x => /^W /.test(x)).join(' ').match(/Pokédex-Nummern\.setValues\(1x3\).*Pokédex-Nummern\.setValues\(1x2\)/) &&
    m.seq.some(x => /^W Daten\.setValues\(1x30\)/.test(x)), m.seq);
  ok('Zeitprotokoll mit den Schritten', /^addCard \d+ ms: Einstellungen \d+, tcgdex \d+, Set-Datum \d+, Sperre \d+, Daten lesen \d+, Nachschlagewerte \d+, schreiben \d+, festschreiben \d+$/.test(m.logs.join('\n')), m.logs);
  const dex = env.values('Pokédex-Nummern');
  ok('Nummern der neuen Karte in A:C und D:E', dex.some(r => r[0] === newIds[0]) && dex.some(r => r[3] === newIds[0]));
}
{
  const m = measure(() => env.uiCall('addCard', { id: newIds[0], lang: 'de', variant: 'base', qty: 1, rid: 'r1' }));
  bound('dieselbe Karte noch einmal', m, 9, 30);
  ok('liest weder Pokédex-Nummern noch Seltenheiten', !m.seq.some(x => /Pokédex-Nummern|Seltenheiten|Kartenverlauf|Importe/.test(x)), m.seq);
}
{
  env.run('cacheCards_([{lang: "de", id: "' + RARE_ID + '", data: fetchJson_(apiUrl_("de", "cards/' + RARE_ID + '"))}])');
  const m = measure(() => env.uiCall('addCard', { id: RARE_ID, lang: 'de', variant: 'base', qty: 1 }));
  bound('neue Karte mit neuer Seltenheit', m, 22, 90);
  ok('Seltenheit angehängt', env.values('Seltenheiten').some(r => r[0] === 'Ganz neu selten'));
  const again = measure(() => env.uiCall('getCollection'));
  ok('die nächste Sammlung kommt weiter aus dem Zwischenspeicher', again.calls <= 8, again.seq);
  const g = again.res.groups.find(x => x.id === RARE_ID);
  eq('neue Karte mit Pokédex-Nummer und ohne Stufe', [g.dex, g.k.rank], [[((10 * 37 + 10 * 11) % 1025) + 1], null]);
}
{
  // die erste Karte eines neuen Sets holt das Erscheinungsdatum von tcgdex und merkt es im Blatt Sets (vor der Sperre,
  // ohne sie, #38 S3); danach liest es die Sets einmal neu, sonst wie jede neue Karte
  env.run('cacheCards_([{lang: "de", id: "' + NEW_SET_ID + '", data: fetchJson_(apiUrl_("de", "cards/' + NEW_SET_ID + '"))}])');
  const m = measure(() => env.uiCall('addCard', { id: NEW_SET_ID, lang: 'de', variant: 'base', qty: 1 }), 'Sets');
  bound('erste Karte eines neuen Sets', m, 30, 80);
  eq('Erscheinungsdatum in Daten', env.data().find(r => r.id === NEW_SET_ID).setDate, (2010 + N_SETS) + '-01-01');
}
{
  const m = measure(() => env.uiCall('addFreeCard', { name: 'Fantasiemon', setName: 'Ordner', number: '7', qty: 1 }));
  bound('freie Karte', m, 16, 70);
}
{
  // sechs neue Karten nacheinander, wie beim Erfassen eines Stapels
  const all = newIds.slice(1).map((id, i) => measure(() => env.uiCall('addCard', { id, lang: 'de', variant: 'base', qty: 1, rid: 's' + i })));
  const sum = all.reduce((s, m) => s + m.calls, 0);
  ok('fünf weitere neue Karten: ' + sum + ' Aufrufe zusammen (höchstens 90)', sum <= 90, all.map(m => m.calls));
  eq('keine liest nach dem Schreiben', all.map(m => m.readsAfterWrite), [0, 0, 0, 0, 0]);
}

// ---------------------------------------------------------------------------
t.section('Ändern im Tab Sammlung');
const coll = env.uiCall('getCollection');
const grp = coll.groups.find(g => g.id === ids[3]);
const eid = grp.rows[0].eid;
{
  const m = measure(() => env.uiCall('adjustEntry', eid, 1));
  bound('+1', m, 8, 30);
  ok('Antwort mit der geänderten Karte', m.res.delta && m.res.delta.groups.length === 1 && m.res.delta.groups[0].count === 2, m.res.delta);
  ok('Zeitprotokoll', /^adjustEntry \d+ ms: Einstellungen \d+, Sperre \d+, Daten lesen \d+, Nachschlagewerte \d+, schreiben \d+, festschreiben \d+$/.test(m.logs.join('\n')), m.logs);
  const r = measure(() => env.uiCall('revertAdjust', m.res.token));
  bound('Rückgängig', r, 8, 30);
  const minus = measure(() => env.uiCall('adjustEntry', eid, -1));
  bound('−1', minus, 8, 30);
  env.uiCall('adjustEntry', eid, 1);
}
{
  const m = measure(() => env.uiCall('editEntry', eid, { cond: 'LP' }, null));
  bound('Bearbeiten: Zustand', m, 8, 30);
  env.uiCall('adjustEntry', eid, 1);
  const split = measure(() => env.uiCall('editEntry', eid, { cond: 'NM' }, 1));
  bound('Bearbeiten: ein Exemplar abtrennen (neue Zeile)', split, 12, 100);
  // Zusammenlegen löscht eine Zeile: Daten wird ab der obersten betroffenen Zeile in einem Rutsch neu geschrieben
  // (alles oder nichts); hier steht die Zeile, in die zusammengelegt wird, weit oben
  const back = measure(() => env.uiCall('editEntry', split.res.eid, { cond: 'LP' }, null));
  bound('Bearbeiten: wieder zusammenlegen, Ziel weit oben', back, 9);
  // dasselbe mit einer Karte, die unten steht: nur die letzten Zeilen
  const lastEid = env.data().filter(r => r.id === newIds[5])[0].eid;
  env.uiCall('adjustEntry', lastEid, 1);
  const split2 = env.uiCall('editEntry', lastEid, { cond: 'NM' }, 1);
  const back2 = measure(() => env.uiCall('editEntry', split2.eid, { cond: '' }, null));
  bound('Bearbeiten: zusammenlegen, Ziel unten', back2, 9, 200);
}
{
  const m = measure(() => env.uiCall('setGroupOwnPrice', grp.gkey, 3.5));
  bound('eigener Preis', m, 9, 30);
}
{
  const free = env.uiCall('getCollection').groups.find(g => g.name === 'Fantasiemon');
  const m = measure(() => env.uiCall('linkFreeGroup', free.gkey, ids[N_ENTRIES + 7], 'de', 'base'));
  bound('freie Karte verknüpfen', m, 18, 90);
}

// ---------------------------------------------------------------------------
t.section('Nachschlagewerte bleiben richtig');
{
  // eine Sperre ohne keepLookups (Import, Preislauf, …) setzt einen neuen Stand: danach wird wieder gelesen
  env.ctx.withLock_(() => env.ctx.afterDataChange_());
  const m = measure(() => env.uiCall('getCollection'));
  ok('nach einer anderen Sperre: liest die Nachschlagewerte neu', m.seq.some(x => /Kartenverlauf/.test(x)), m.seq);
  // Änderung von Hand in einem dieser Blätter: onEdit setzt einen neuen Stand
  const rar = env.sheet('Seltenheiten');
  const row = env.values('Seltenheiten').findIndex(r => r[0] === 'Ganz neu selten') + 1;
  rar.getRange(row, 2).setValue(99);
  env.ctx.onEdit({ range: rar.getRange(row, 2) });
  const g = env.uiCall('getCollection').groups.find(x => x.id === RARE_ID);
  eq('Stufe von Hand gilt sofort', g.k.rank, 99);
  // Zeile in Pokédex-Nummern von Hand gelöscht (löst kein onEdit aus, aber beiStrukturAenderung)
  const before = measure(() => env.uiCall('getCollection'));
  ok('vorher aus dem Zwischenspeicher', !before.seq.some(x => /Pokédex-Nummern/.test(x)));
  env.ctx.beiStrukturAenderung({ changeType: 'REMOVE_ROW' });
  const after = measure(() => env.uiCall('getCollection'));
  ok('nach beiStrukturAenderung neu gelesen', after.seq.some(x => /Pokédex-Nummern/.test(x)), after.seq);
}

t.done();
