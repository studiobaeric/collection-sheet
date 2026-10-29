'use strict';
/**
 * Tests für den erweiterten Pokédex mit Formen (#55): Formenliste aus PokeAPI, Erkennung am Kartennamen, Form von Hand,
 * Blatt Pokédex mit Haken, Dashboard und Pokédex-Tab.
 * Start: node test_formen.js   (Exit-Code 1 bei Fehlern; jsdom liegt in ./node_modules)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness2');
const t = H.runner('test_formen');
const ok = t.ok, eq = t.eq;
const J = x => JSON.stringify(x);

// ---------------------------------------------------------------------------
// PokeAPI-Attrappe: kleine Auszüge der drei CSV-Dateien
// ---------------------------------------------------------------------------
const POKEMON = `id,identifier,species_id,height,weight,base_experience,order,is_default
1,bulbasaur,1,7,69,64,1,1
6,charizard,6,17,905,267,7,1
10034,charizard-mega-x,6,17,1105,293,8,0
10035,charizard-mega-y,6,17,1005,293,9,0
10196,charizard-gmax,6,280,10000,267,10,0
20,raticate,20,7,185,145,30,1
10092,raticate-alola,20,7,255,145,31,0
10093,raticate-totem-alola,20,14,1050,145,32,0
25,pikachu,25,4,60,112,35,1
10158,pikachu-starter,25,4,60,112,36,0
10094,pikachu-original-cap,25,4,60,112,37,0
37,vulpix,37,6,99,60,50,1
10103,vulpix-alola,37,6,99,60,51,0
201,unown,201,5,50,118,250,1
382,kyogre,382,45,3520,335,500,1
10077,kyogre-primal,382,98,4300,347,501,0
678,meowstic-male,678,6,85,163,800,1
10025,meowstic-female,678,6,85,163,801,0
681,aegislash-shield,681,17,530,250,900,1
10026,aegislash-blade,681,17,530,250,901,0
`;
const FORMS = `id,identifier,form_identifier,pokemon_id,introduced_in_version_group_id,is_default,is_battle_only,is_mega,form_order,order
1,bulbasaur,,1,1,1,0,0,1,1
6,charizard,,6,1,1,0,0,1,7
10047,charizard-mega-x,mega-x,10034,15,1,1,1,2,8
10048,charizard-mega-y,mega-y,10035,15,1,1,1,3,9
10196,charizard-gmax,gmax,10196,20,1,1,0,4,10
20,raticate,,20,1,1,0,0,1,30
10092,raticate-alola,alola,10092,17,1,0,0,2,31
10093,raticate-totem-alola,totem-alola,10093,17,1,0,0,3,32
25,pikachu,,25,1,1,0,0,1,35
10158,pikachu-starter,starter,10158,19,1,0,0,2,36
10094,pikachu-original-cap,original-cap,10094,17,1,0,0,3,37
37,vulpix,,37,1,1,0,0,1,50
10103,vulpix-alola,alola,10103,17,1,0,0,2,51
201,unown-a,a,201,3,1,0,0,1,250
10001,unown-b,b,201,3,0,0,0,2,251
382,kyogre,,382,5,1,0,0,1,500
10077,kyogre-primal,primal,10077,15,1,1,0,2,501
678,meowstic-male,male,678,15,1,0,0,1,800
10025,meowstic-female,female,10025,15,1,0,0,2,801
681,aegislash-shield,shield,681,15,1,0,0,1,900
10026,aegislash-blade,blade,10026,15,1,1,0,2,901
`;
const NAMES = `pokemon_form_id,local_language_id,form_name,pokemon_name
10047,6,Mega-Form,Mega-Glurak X
10047,9,Mega Charizard X,Mega Charizard X
10048,6,Mega-Form,Mega-Glurak Y
10103,6,Alola-Form,Alola Vulpix
10103,9,Alolan Form,Alolan Vulpix
10025,6,Weiblich,Psiaugon ♀
201,6,A,Icognito A
10001,6,B,Icognito B
10077,6,Protomorphose,Proto-Kyogre
10094,9,Original Cap,"Pikachu, Original Cap"
`;
const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const http = (files) => url => {
  if (url.indexOf(POKEAPI) !== 0) return undefined;
  const f = url.slice(POKEAPI.length).replace('.csv', '');
  return files[f] != null ? { code: 200, body: files[f] } : { code: 404, body: '404: Not Found' };
};
const FILES = { pokemon: POKEMON, pokemon_forms: FORMS, pokemon_form_names: NAMES };

// tcgdex: Karten mit Formen im Namen
function db() {
  const d = H.defaultDb();
  const add = (id, de, en, extra) => {
    d['de/cards/' + id] = H.card(id, 'de', Object.assign({ name: de }, extra || {}));
    d['en/cards/' + id] = H.card(id, 'en', Object.assign({ name: en }, extra || {}));
  };
  add('swsh3-025', 'Glurak', 'Charizard', { dexId: [6] });
  add('swsh3-020', 'Glurak VMAX', 'Charizard VMAX', { dexId: [6], pricing: { cardmarket: { trend: 10, 'trend-holo': 0, updated: '2026-10-13T00:00:00Z' } } });
  add('swsh3-021', 'Mega-Glurak X-ex', 'Mega Charizard X ex', { dexId: [6], pricing: { cardmarket: { trend: 20, 'trend-holo': 0, updated: '2026-10-13T00:00:00Z' } } });
  add('swsh3-022', 'M-Glurak-EX', 'M Charizard-EX', { dexId: [6] });
  add('swsh3-030', 'Alola-Vulpix', 'Alolan Vulpix', { dexId: [37] });
  return d;
}

function setup(files) {
  const env = H.createEnv({ db: db() });
  env.http = http(files || FILES);
  env.ctx.setupAll_();
  return env;
}
const add = (env, id, extra) => env.ctx.addCard(Object.assign({ id, lang: 'de', variant: 'base', condition: 'NM', qty: 1 }, extra || {}));
const dexData = env => env.objects('Pokédex-Daten');
const row = (env, kennung) => dexData(env).find(o => String(o.Kennung) === kennung);
const setBoxes = (env, vals) => {
  const sh = env.sheet('Pokédex');
  sh.getRange('L4:P4').setValues([vals]);
};
const pdxList = env => env.values('Pokédex').slice(5).map(r => r.slice(0, 6)).filter(r => r[1] !== '' && r[1] != null);
const pdxCards = (env, sel) => {
  env.sheet('Pokédex').getRange('I4').setValue(sel);
  return env.values('Pokédex').slice(5).map(r => r[8]).filter(x => x !== '' && x != null);
};

// ---------------------------------------------------------------------------
t.section('CSV und Formenliste');
{
  const env = H.createEnv({ files: ['Code.gs'] });
  const c = env.ctx;
  eq('CSV mit Anführungszeichen', J(c.csvRows_('a,"b, c",d\n1,"x ""y""",\r\n')), J([['a', 'b, c', 'd'], ['1', 'x "y"', '']]));
  const rows = c.dexFormsFromCsv_(FORMS, POKEMON, NAMES, []);
  const by = {};
  rows.forEach(r => { by[r.token] = r; });
  eq('Kennungen', rows.map(r => r.token), ['6_1', '6_2', '6_3', '6_4', '20_1', '20_2', '25_1', '25_2', '37_1', '37_2', '201_1', '201_2', '382_1', '382_2', '678_1', '678_2']);
  ok('ohne Totem, Partner-Pikachu und Kampf-Formen (Durengard)', !rows.some(r => /totem|starter/.test(r.key) || r.nr === 681 || r.nr === 1));
  eq('Gruppen', rows.map(r => r.grp).join(' '), 'base mega mega gmax base regional base other base regional base other base mega base gender');
  eq('deutsche Namen von PokeAPI', [by['6_2'].de, by['37_2'].de, by['201_1'].de, by['201_2'].de, by['382_2'].de, by['678_2'].de],
    ['Mega-Glurak X', 'Alola Vulpix', 'Icognito A', 'Icognito B', 'Proto-Kyogre', 'Psiaugon ♀']);
  eq('zusammengesetzt, wo PokeAPI keinen deutschen Namen hat', [by['6_4'].de, by['20_2'].de, by['25_2'].de, by['6_1'].de],
    ['Gigadynamax-Glurak', 'Alola-Rattikarl', 'Pikachu (Original Cap)', 'Glurak']);
  eq('englische Namen', [by['6_2'].en, by['6_4'].en, by['37_2'].en, by['25_2'].en], ['Mega Charizard X', 'Gigantamax Charizard', 'Alolan Vulpix', 'Pikachu, Original Cap']);
  eq('Grundform mit Geschlecht', by['678_1'].de, 'Psiaugon ♂');
  // Nummern bleiben: eine neue Form bekommt die nächste freie, alte behalten ihre
  const old = rows.filter(r => r.key !== 'charizard-mega-x');
  old.find(r => r.key === 'charizard-gmax').form = 7;
  const again = c.dexFormsFromCsv_(FORMS, POKEMON, NAMES, old);
  const k = key => again.find(r => r.key === key).token;
  eq('feste Nummern, neue Form hinten', [k('charizard'), k('charizard-mega-y'), k('charizard-gmax'), k('charizard-mega-x')], ['6_1', '6_3', '6_7', '6_8']);

  // Erkennen am Namen
  const ix = c.dexFormIndex_(rows);
  const f = (name, nr) => c.dexFormOfName_(name, nr, ix);
  eq('Mega-Glurak X-ex', f('Mega-Glurak X-ex', 6), '6_2');
  eq('Mega Charizard Y (englisch)', f('Mega Charizard Y', 6), '6_3');
  eq('M-Glurak-EX ohne X/Y: keine Form', f('M-Glurak-EX', 6), '');
  eq('Glurak VMAX -> Gigadynamax', f('Glurak VMAX', 6), '6_4');
  eq('Glurak-ex: keine Form', f('Glurak-ex', 6), '');
  eq('Alola-Vulpix-GX', f('Alola-Vulpix-GX', 37), '37_2');
  eq('Alolan Vulpix', f('Alolan Vulpix', 37), '37_2');
  eq('Dunkles Alola-Vulpix (Wort davor)', f('Dunkles Alola-Vulpix', 37), '37_2');
  eq('Proto-Kyogre-EX', f('Proto-Kyogre-EX', 382), '382_2');
  eq('Icognito B', f('Icognito B', 201), '201_2');
  eq('Pikachu VMAX ohne Gigadynamax-Form: keine', f('Pikachu VMAX', 25), '');
  eq('Pokémon ohne Formen', f('Bisasam', 1), '');
  eq('Kennung -> Nummer', [c.dexTokenNr_('6_2'), c.dexTokenNr_('25'), c.dexTokenNr_('')], [6, 25, 0]);
  eq('parseDexText_ liest Kennungen als Nummern', J(c.parseDexText_('6_2 25')), '[6,25]');
}

// ---------------------------------------------------------------------------
t.section('Laden, Kennungen der Karten, Blatt Pokédex');
{
  const env = setup();
  const c = env.ctx;
  ok('Blatt Pokédex-Formen versteckt', !!env.sheet('Pokédex-Formen') && env.sheet('Pokédex-Formen').isSheetHidden());
  ok('Einrichtung lädt die Formen mit', env.objects('Pokédex-Formen').length === 16 && /16 Pokédex-Formen geladen/.test(env.ss.toasts.join(' ')), env.ss.toasts);
  ok('Stand gemerkt', !!env.setting('DEX_FORMS_AT'));
  add(env, 'swsh3-025', { qty: 2 });
  add(env, 'swsh3-020');
  add(env, 'swsh3-021');
  add(env, 'swsh3-022');
  add(env, 'swsh3-030');
  const map = {};
  env.objects('Pokédex-Nummern').forEach(o => { if (o['Sammlung: Karte']) map[o['Sammlung: Karte']] = String(o['Sammlung: Pokédex-Nr.']); });
  eq('Kennungen in Pokédex-Nummern E', [map['swsh3-025'], map['swsh3-020'], map['swsh3-021'], map['swsh3-022'], map['swsh3-030']], ['6', '6_4', '6_2', '6', '37_2']);
  // ohne Haken: wie bisher je Art eine Zeile, alle Karten bei der Art
  eq('ohne Haken: Glurak zählt alle 4 Karten', [row(env, '6').Karten, row(env, '6').Exemplare, row(env, '6').Sichtbar], [4, 5, 1]);
  eq('Formzeilen unsichtbar', [row(env, '6_1').Sichtbar, row(env, '6_2').Sichtbar], [0, 0]);
  eq('Zähler', env.sheet('Pokédex').getRange('D1').getValue(), '2 von 1025');
  eq('Liste ohne Formzeilen', pdxList(env).filter(r => r[0] === 6 || String(r[0]).indexOf('6.') === 0).map(r => r[1]), ['Glurak']);
  // Mega anhaken
  setBoxes(env, [true, false, false, false, false]);
  eq('Mega: Art unsichtbar, Grundform und Megas sichtbar', [row(env, '6').Sichtbar, row(env, '6_1').Sichtbar, row(env, '6_2').Sichtbar, row(env, '6_3').Sichtbar, row(env, '6_4').Sichtbar],
    [0, 1, 1, 1, 0]);
  eq('Mega: Grundform zählt auch Gigadynamax (ausgeblendet)', [row(env, '6_1').Karten, row(env, '6_1').Exemplare, row(env, '6_2').Karten, row(env, '6_3').Karten], [3, 4, 1, 0]);
  eq('Mega: Kyogre bekommt Grundform und Proto-Kyogre', [row(env, '382').Sichtbar, row(env, '382_1').Sichtbar, row(env, '382_2').Sichtbar], [0, 1, 1]);
  eq('Zähler mit Formen', env.sheet('Pokédex').getRange('D1').getValue(), '3 von 1028');
  const six = pdxList(env).filter(r => String(r[0]).indexOf('6.') === 0 || r[0] === 6);
  eq('Liste: Glurak-Zeilen in Reihenfolge', six.map(r => [r[0], r[1], r[3]]), [['6.1', 'Glurak', 3], ['6.2', 'Mega-Glurak X', 1], ['6.3', 'Mega-Glurak Y', 0]]);
  env.sheet('Pokédex').getRange('D4').setValue('6');
  eq('Suche „6“ zeigt alle Glurak-Zeilen', pdxList(env).map(r => r[0]), ['6.1', '6.2', '6.3']);
  env.sheet('Pokédex').getRange('D4').setValue('');
  eq('Karten der Form', pdxCards(env, '#6.2 Mega-Glurak X'), ['Mega-Glurak X-ex']);
  eq('Karten der Grundform (mit ausgeblendetem Gigadynamax)', pdxCards(env, '#6.1 Glurak').sort(), ['Glurak', 'Glurak VMAX', 'M-Glurak-EX'].sort());
  eq('Karten der Art (Auswahl #6)', pdxCards(env, '#6 Glurak').length, 4);
  const dd = env.values('Pokédex-Daten').slice(1).map(r => r[13]).filter(Boolean);
  ok('Auswahl im Blatt listet sichtbare Formen', dd.indexOf('#6.2 Mega-Glurak X') >= 0 && dd.indexOf('#6 Glurak') < 0 && dd.indexOf('#37 Vulpix') >= 0, dd.slice(0, 8));
  // alle Gruppen
  setBoxes(env, [true, true, true, true, true]);
  eq('alle: Vulpix mit Alola-Form', [row(env, '37_2').Karten, row(env, '37_1').Karten, row(env, '6_4').Karten, row(env, '6_1').Karten], [1, 0, 1, 2]);
  eq('Dashboard zählt wie das Blatt', env.sheet('Dashboard').getRange('K6').getValue(), '4 von 1034');
  ok('keine Formelfehler', !env.formulaErrors || env.formulaErrors.length === 0, env.formulaErrors);
  ok('no nested locks', env.lock.nested === 0, env.lock);
}

// ---------------------------------------------------------------------------
t.section('Haken „Alle Formen“ (onEdit) und Ansicht neu aufbauen');
{
  const env = setup();
  const c = env.ctx;
  const sh = env.sheet('Pokédex');
  const edit = a1 => c.onEdit({ range: sh.getRange(a1), source: env.ss });
  sh.getRange('K4').setValue(true); edit('K4');
  eq('Alle setzt alle', sh.getRange('L4:P4').getValues()[0], [true, true, true, true, true]);
  sh.getRange('M4').setValue(false); edit('M4');
  eq('einer weg: Alle aus', sh.getRange('K4').getValue(), false);
  sh.getRange('M4').setValue(true); edit('M4');
  eq('alle wieder da: Alle an', sh.getRange('K4').getValue(), true);
  sh.getRange('K4:P4').setValues([[false, true, false, false, false, false]]);
  c.setupPokedexSheet_(env.ss, true);
  eq('Haken bleiben beim Neuaufbau', sh.getRange('K4:P4').getValues()[0], [false, true, false, false, false, false]);
  eq('Beschriftung', sh.getRange('K3:P3').getValues()[0], ['Alle Formen', 'Mega', 'Regionalformen', 'Gigadynamax', 'Geschlechter', 'Weitere Formen']);
}

// ---------------------------------------------------------------------------
t.section('PokeAPI nicht erreichbar, wöchentlich');
{
  const env = setup({});
  ok('ohne PokeAPI: Einrichtung klappt, Hinweis', env.objects('Pokédex-Formen').length === 0 && /Pokédex-Formen konnten nicht geladen werden/.test(env.ss.toasts.join(' ')), env.ss.toasts);
  add(env, 'swsh3-021');
  eq('ohne Formen: Nummer', String(env.objects('Pokédex-Nummern').find(o => o['Sammlung: Karte'] === 'swsh3-021')['Sammlung: Pokédex-Nr.']), '6');
  env.http = http(FILES);
  eq('nächster Lauf holt sie (noch nie geholt)', env.ctx.refreshDexForms_(false), 16);
  eq('Kennung nachgetragen', String(env.objects('Pokédex-Nummern').find(o => o['Sammlung: Karte'] === 'swsh3-021')['Sammlung: Pokédex-Nr.']), '6_2');
  eq('innerhalb einer Woche nicht noch einmal', env.ctx.refreshDexForms_(false), null);
  env.http = http({});
  t.throws('Fehler: alte Liste bleibt', () => env.ctx.refreshDexForms_(true), /PokeAPI/);
  eq('Liste noch da', env.objects('Pokédex-Formen').length, 16);
}

// ---------------------------------------------------------------------------
t.section('Form von Hand (Bearbeiten)');
{
  const env = setup();
  const a = add(env, 'swsh3-022'); // M-Glurak-EX: nicht eindeutig -> Grundform
  const gk = a.gkey;
  let f = env.uiCall('getCardForms', gk);
  eq('Feld Form: Glurak mit Optionen', [f.length, f[0].nr, f[0].cur, f[0].opts.map(o => o[0])], [1, 6, '6', ['6', '6_2', '6_3', '6_4']]);
  eq('Optionen mit Namen', f[0].opts.map(o => o[1]), ['Glurak', 'Mega-Glurak X', 'Mega-Glurak Y', 'Gigadynamax-Glurak']);
  const r = env.uiCall('editEntry', a.eid, { forms: ['6_3'] });
  eq('Speichern ohne andere Änderung: Kennungen zurück', J(r.dexf), '["6_3"]');
  const ids = env.objects('Pokédex-Nummern');
  eq('gemerkt in F:G und E', [ids.find(o => o['Form von Hand: Karte'] === 'swsh3-022')['Form von Hand'], String(ids.find(o => o['Sammlung: Karte'] === 'swsh3-022')['Sammlung: Pokédex-Nr.'])], ['6_3', '6_3']);
  setBoxes(env, [true, false, false, false, false]);
  eq('zählt bei Mega-Glurak Y', row(env, '6_3').Karten, 1);
  f = env.uiCall('getCardForms', gk);
  eq('Feld zeigt die Wahl', f[0].cur, '6_3');
  // zweite Variante derselben Karte: gleiche Form
  const b = add(env, 'swsh3-022', { variant: 'reverse' });
  eq('gilt für alle Varianten der Karte', env.uiCall('getCardForms', b.gkey)[0].cur, '6_3');
  // übersteht Ansicht neu aufbauen (afterDataChange_)
  env.ctx.withLock_(() => env.ctx.afterDataChange_());
  eq('übersteht das Nachziehen', String(env.objects('Pokédex-Nummern').find(o => o['Sammlung: Karte'] === 'swsh3-022')['Sammlung: Pokédex-Nr.']), '6_3');
  // zurück zur Grundform
  env.uiCall('editEntry', a.eid, { forms: ['6'] });
  eq('Grundform von Hand', String(env.objects('Pokédex-Nummern').find(o => o['Sammlung: Karte'] === 'swsh3-022')['Sammlung: Pokédex-Nr.']), '6');
  // unpassende Kennung wird ignoriert
  const r2 = env.uiCall('editEntry', a.eid, { forms: ['37_2'] });
  eq('fremde Kennung: nichts', J(r2.dexf), '["6"]');
  eq('Karte ohne Formen: kein Feld', env.uiCall('getCardForms', add(env, 'base1-4').gkey).length, 1); // Glurak hat Formen
  ok('no nested locks', env.lock.nested === 0, env.lock);
  // getPokedex liefert Formen und Kennungen
  const p = env.uiCall('getPokedex');
  ok('getPokedex: forms, toks, groups', p.forms.length === 16 && p.forms[1][0] === '6_2' && p.toks['6'] && p.groups.length === 5, [p.forms.slice(0, 2), p.toks]);
  // Sammlung: Gruppen tragen ihre Kennungen
  const coll = env.uiCall('getCollection');
  ok('Gruppen mit dexf', coll.groups.every(g => Array.isArray(g.dexf)), coll.groups.map(g => g.dexf));
}

// ---------------------------------------------------------------------------
// UI (Seitenleiste)
// ---------------------------------------------------------------------------
function boot(env, mode, storage) {
  const raw = fs.readFileSync(path.join(H.SRC_DIR, 'Ui.html'), 'utf8')
    .replace("<?!= mode ?>", mode)
    .replace(/<\?!= typeof start[^?]*\?>/, '')
    .replace("<?!= typeof searchJs_ === 'function' ? searchJs_() : 'null' ?>", 'null')
    .replace("<?!= include('ImportUi') ?>", '<div id="paneImport" class="panel hidden"></div><script>function impInit() {}</script>');
  const pending = [], errors = [], log = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  const dom = new JSDOM(raw, {
    runScripts: 'dangerously', virtualConsole: vc, url: 'https://script.google.com/x',
    beforeParse(win) {
      if (storage) Object.keys(storage).forEach(k => win.localStorage.setItem(k, storage[k]));
      win.setTimeout = (fn) => { fn(); return 1; };
      win.clearTimeout = () => {};
      win.google = { script: { get run() {
        let okH = null, failH = null;
        const base = { withSuccessHandler(f) { okH = f; return px; }, withFailureHandler(f) { failH = f; return px; } };
        const px = new Proxy(base, { get: (o, p) => (p in o ? o[p] : (...args) => { pending.push({ fn: String(p), args: JSON.parse(J(args)), ok: okH, fail: failH }); }) });
        return px;
      } } };
    }
  });
  const win = dom.window, doc = win.document;
  const flush = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); };
  const E = {
    win, doc, errors, log, $: id => doc.getElementById(id),
    async settle() {
      await flush();
      let n = 0;
      while (pending.length && n++ < 50) {
        const p = pending.shift();
        log.push(p);
        try { p.ok(env.uiCall(p.fn, ...p.args)); } catch (e) { p.fail(new win.Error(e.message)); }
        await flush();
      }
    },
    calls: fn => log.filter(p => p.fn === fn),
    btn: (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text) || null,
    async click(el) { if (!el) throw new Error('Element fehlt'); el.click(); await E.settle(); },
    async pick(el, v) { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); await E.settle(); },
    async check(el, on) { el.checked = on; el.dispatchEvent(new win.Event('change', { bubbles: true })); await E.settle(); },
    async type(el, v) { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); await E.settle(); }
  };
  return E;
}

(async () => {
  t.section('UI: Pokédex-Tab mit Formen');
  {
    const env = setup();
    add(env, 'swsh3-025', { qty: 2 }); add(env, 'swsh3-020'); add(env, 'swsh3-021'); add(env, 'swsh3-030');
    const E = boot(env, 'web');
    await E.settle();
    await E.click(E.$('tabDex'));
    const rows = () => [...E.$('dexList').querySelectorAll('.dex')];
    const titles = () => rows().map(r => r.querySelector('.nr').textContent + ' ' + r.querySelector('.t').textContent);
    eq('ohne Haken: 1025 Zeilen', [rows().length, E.$('dexSummary').textContent], [1025, 'Vorhanden: 2 von 1025.']);
    ok('Haken in „Formen ▾“, alle aus', !!E.$('dexForm_mega') && !E.$('dexForm_mega').checked && !E.$('dexFormAll').checked);
    await E.check(E.$('dexForm_mega'), true);
    eq('Mega: Zeilen von Glurak', (await (async () => { await E.type(E.$('dexQuery'), '6'); return titles(); })()),
      ['#006.1 Glurak', '#006.2 Mega-Glurak X', '#006.3 Mega-Glurak Y']);
    ok('Grundform zählt VMAX mit', /2 Karten · 3 Exemplare/.test(rows()[0].textContent), rows()[0].textContent);
    ok('Mega-Glurak X vorhanden, Y fehlt', /1 Karte · 1 Exemplar/.test(rows()[1].textContent) && rows()[2].classList.contains('miss'));
    eq('Zusammenfassung zählt Formzeilen', E.$('dexSummary').textContent, 'Vorhanden: 3 von 1028.');
    ok('pro Gerät gemerkt', JSON.parse(E.win.localStorage.getItem('pkmDexForms')).mega === true);
    await E.click(rows()[1]);
    const box = E.$('dx6_2');
    ok('Form aufgeklappt: nur ihre Karte', box && /Mega-Glurak X-ex/.test(box.textContent) && !/Glurak VMAX/.test(box.textContent), box && box.textContent);
    await E.click(rows()[0]);
    const b1 = E.$('dx6_1');
    ok('Grundform: Glurak und VMAX, ohne Mega', b1 && /Glurak VMAX/.test(b1.textContent) && !/Mega-Glurak/.test(b1.textContent), b1 && b1.textContent);
    await E.click(E.btn(E.$('dx6_2'), 'In Sammlung öffnen'));
    ok('Sammlung: Chip mit Form', /Nur #006\.2 Mega-Glurak X/.test(E.$('colDex').textContent), E.$('colDex').textContent);
    eq('Sammlung gefiltert auf die Form', E.win.state.groups.map(g => g.id), ['swsh3-021']);
    // Alle Formen
    await E.click(E.$('tabDex'));
    await E.check(E.$('dexFormAll'), true);
    ok('Alle setzt alle Gruppen', ['mega', 'regional', 'gmax', 'gender', 'other'].every(g => E.$('dexForm_' + g).checked));
    await E.type(E.$('dexQuery'), 'vulpix');
    eq('Alola-Vulpix eigene Zeile', titles(), ['#037.1 Vulpix', '#037.2 Alola Vulpix']);
    await E.check(E.$('dexForm_regional'), false);
    ok('eine Gruppe aus: Alle aus', !E.$('dexFormAll').checked);
    eq('ohne Regionalformen: Vulpix eine Zeile', titles(), ['#037 Vulpix']);
    ok('keine Skriptfehler', E.errors.length === 0, E.errors);
    // gemerkte Haken beim nächsten Start
    const E2 = boot(env, 'web', { pkmDexForms: J({ gmax: true }) });
    await E2.settle();
    await E2.click(E2.$('tabDex'));
    await E2.type(E2.$('dexQuery'), 'glurak');
    eq('gemerkte Haken (Gigadynamax)', E2.win.dex.rows.filter(r => r.nr === 6).map(r => r.key), ['6_1', '6_4']);
    ok('keine Skriptfehler (2)', E2.errors.length === 0, E2.errors);
  }

  t.section('UI: Feld Form im Bearbeiten');
  {
    const env = setup();
    add(env, 'swsh3-022'); add(env, 'swsh3-030');
    const E = boot(env, 'sidebar');
    await E.settle();
    await E.click(E.$('tabColl'));
    const gi = E.win.state.groups.findIndex(g => g.id === 'swsh3-022');
    E.win.state.groups[gi].open = true;
    E.win.openEdit(gi, 0);
    await E.settle();
    const sel = E.$('eForm' + gi + '_0');
    ok('Feld Form mit Glurak-Formen', !!sel && sel.value === '6' && [...sel.options].map(o => o.textContent).join('|') === 'Glurak|Mega-Glurak X|Mega-Glurak Y|Gigadynamax-Glurak',
      sel && sel.outerHTML);
    await E.pick(sel, '6_2');
    await E.click(E.btn(E.$('ge' + gi), 'Speichern'));
    const call = E.calls('editEntry').pop();
    eq('editEntry mit forms', J(call.args[1]), J({ forms: ['6_2'] }));
    eq('Gruppe kennt ihre Form', J(E.win.coll.all.find(g => g.id === 'swsh3-022').dexf), '["6_2"]');
    ok('keine Skriptfehler (Bearbeiten)', E.errors.length === 0, E.errors);
  }
  t.done();
})();
