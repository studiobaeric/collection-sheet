'use strict';
/**
 * Tests für das Blatt „Dashboard“ (Code.gs Abschnitt 11): Aufbau, Bild-Knöpfe, Kennzahlen, Veränderung,
 * Mini-Diagramme, Blätter öffnen. Aufruf: node test_dashboard.js (Exit-Code 1 bei Fehlern)
 * Die Bilder der Knöpfe liefert die Attrappe aus assets/dashboard (wie raw.githubusercontent.com).
 */
const fs = require('fs');
const path = require('path');
const H = require('./harness2');
const KN = require('../tools/dashboard-knoepfe.js');

const t = H.runner('test_dashboard');
const ok = t.ok, eq = t.eq;
const J = x => JSON.stringify(x);
const ASSET_RE = /^https:\/\/raw\.githubusercontent\.com\/studiobaeric\/collection-sheet\/[^/]+\/assets\/dashboard\/([\w-]+)\.png$/;

function setup(opts) {
  const env = H.createEnv(opts);
  env.ctx.onOpen();
  env.setupMsg = env.ctx.setupAll_();
  return env;
}
const dash = env => env.sheet('Dashboard');
const cell = (env, a1) => dash(env).getRange(a1).getValue();
const assetFetches = env => env.fetchLog.filter(u => ASSET_RE.test(u));
const buttons = env => dash(env).getImages().filter(i => /^Dashboard-Knopf /.test(i.getAltTextDescription()));
const add = (env, extra) => env.ctx.addCard(Object.assign({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 }, extra || {}));
const refresh = env => env.ctx.refreshDashboard_(env.ctx.readData_(env.sheet('Daten')));
const today = env => env.ctx.dateText_(new Date());
const shift = (env, days) => env.ctx.dashDayShift_(today(env), days);
const short = (env, ymd) => env.ctx.dashShortDate_(ymd, today(env));
/** Blatt Verlauf mit diesen Einträgen [['yyyy-MM-dd', Gesamtwert], …] (Datum als Date wie beim Preislauf) */
function history(env, list) {
  const sh = env.sheet('Verlauf');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
  if (!list.length) return;
  sh.getRange(2, 1, list.length, 5).setValues(list.map(x => {
    const p = x[0].split('-').map(Number);
    return [typeof x[2] === 'string' ? x[0] : new Date(p[0], p[1] - 1, p[2]), x[1], 1, 0, 0];
  }));
}

const BTN = H.createEnv().run('DASH_BUTTONS');
const ASSETS = H.createEnv().run('DASH_ASSETS');

// ---------------------------------------------------------------------------
t.section('Knöpfe: Liste, Funktionen, Bilder im Repo');
{
  const env = H.createEnv();
  eq('11 Knöpfe: 7 Aktionen, 4 Blätter', BTN.map(b => b.key + (b.nav ? ' (Blatt)' : '')), ['erfassen', 'preise', 'import', 'updates', 'sets', 'ansicht', 'handy',
    'sammlung (Blatt)', 'pokedex (Blatt)', 'verlauf (Blatt)', 'seltenheiten (Blatt)']);
  ok('jede Funktion ist öffentlich und vorhanden', BTN.every(b => !/_$/.test(b.fn) && typeof env.ctx[b.fn] === 'function'), BTN.filter(b => typeof env.ctx[b.fn] !== 'function'));
  eq('Zeichen-Skript und Code.gs: gleiche Schlüssel und Beschriftungen', KN.BUTTONS.map(b => [b.key, b.label]), BTN.map(b => [b.key, b.label]));
  ok('Blätter-Knöpfe mit Pfeil, Karten erfassen hervorgehoben', KN.BUTTONS.every((b, i) => (b.kind === 'nav') === !!BTN[i].nav) &&
    KN.BUTTONS[0].kind === 'primary' && KN.BUTTONS.slice(1).every(b => b.kind !== 'primary'));
  ok('kein Bild ohne Knopf im Repo', fs.readdirSync(path.join(__dirname, '..', 'assets', 'dashboard')).sort().join() === BTN.map(b => b.key + '.png').sort().join());
  BTN.forEach(b => {
    const file = path.join(__dirname, '..', 'assets', 'dashboard', b.key + '.png');
    const buf = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const png = buf.length > 24 && buf.slice(1, 4).toString() === 'PNG';
    ok('Bild ' + b.key + '.png: PNG, doppelte Größe ' + KN.W * 2 + '×' + KN.H * 2 + ', unter 50 KB',
      png && buf.readUInt32BE(16) === KN.W * 2 && buf.readUInt32BE(20) === KN.H * 2 && buf.length < 50000, png ? [buf.readUInt32BE(16), buf.readUInt32BE(20), buf.length] : 'fehlt');
  });
  eq('Knopfgröße wie im Zeichen-Skript', env.run('[DASH_BTN_W, DASH_BTN_H]'), [KN.W, KN.H]);
  ok('Bilder fest auf einen Commit (nicht main)', /^https:\/\/raw\.githubusercontent\.com\/studiobaeric\/collection-sheet\/[0-9a-f]{40}\/assets\/dashboard\/$/.test(ASSETS), ASSETS);
  eq('Lage der Knöpfe', BTN.map((b, i) => J(env.ctx.dashButtonCell_(i))), [
    '{"row":12,"col":2}', '{"row":12,"col":6}', '{"row":12,"col":10}', '{"row":12,"col":14}',
    '{"row":13,"col":2}', '{"row":13,"col":6}', '{"row":13,"col":10}',
    '{"row":17,"col":2}', '{"row":17,"col":6}', '{"row":17,"col":10}', '{"row":17,"col":14}']);
}

// ---------------------------------------------------------------------------
t.section('Einrichtung legt das Dashboard an');
{
  const env = setup();
  const sh = dash(env);
  const c = env.run('DASH_COLORS');
  eq('Reihenfolge: Dashboard, Sammlung, Pokédex', env.ss.list.map(s => s.name).slice(0, 3), ['Dashboard', 'Sammlung', 'Pokédex']);
  ok('Einrichtung ohne Hinweis auf fehlende Knöpfe', env.ui.alerts.length === 0 && /^Einrichtung fertig\./.test(env.setupMsg) &&
    env.setupMsg.indexOf(env.run('DASH_LOAD_FAILED')) < 0, [env.setupMsg, env.ui.alerts]);
  ok('Gitternetz aus, Hilfsspalten R:T versteckt', sh.hasHiddenGridlines() && [18, 19, 20].every(k => sh.isColumnHiddenByUser(k)) && !sh.isColumnHiddenByUser(17));
  eq('Kopf', [cell(env, 'C2'), cell(env, 'O2')], ['Pokémon-Sammlung', 'Version ' + env.run('TOOL_VERSION')]);
  ok('Stand ohne Preislauf', /^Stand \d\d\.\d\d\.\d{4} \d\d:\d\d · noch kein Preislauf$/.test(cell(env, 'C3')), cell(env, 'C3'));
  eq('Überschriften der Kacheln', ['C5', 'G5', 'K5', 'O5'].map(a => cell(env, a)), ['GESAMTWERT', 'KARTEN', 'POKÉDEX · 0,0 %', 'WERTVERLAUF · 90 TAGE']);
  eq('leere Sammlung', ['C6', 'G6', 'K6', 'C7', 'G7'].map(a => cell(env, a)), [0, 0, '0 von 1025', 'Noch kein Verlauf', '']);
  eq('Abschnitte und Hinweis', [cell(env, 'C10'), cell(env, 'C15'), cell(env, 'C19')], ['Aktionen', 'Blätter', env.run('DASH_HELP')]);
  ok('Wertverlauf: Linie aus R2:R91 mit Einstellungen S2:T4, erst ab zwei Einträgen',
    sh.getRange('O6').getFormula() === '=IF(COUNT(R2:R91)<2, "Noch zu wenig Verlauf", SPARKLINE(FILTER(R2:R91, R2:R91<>""), S2:T4))', sh.getRange('O6').getFormula());
  eq('Pokédex-Balken aus R93:R94 mit Einstellungen S7:T10', sh.getRange('K7').getFormula(), '=SPARKLINE(R93:R94, S7:T10)');
  eq('Einstellungen der Linie', sh.getRange('S2:T4').getValues(), [['charttype', 'line'], ['color', c.accent], ['linewidth', 2]]);
  eq('Einstellungen des Balkens', sh.getRange('S7:T10').getValues(), [['charttype', 'bar'], ['color1', c.accent], ['color2', c.track], ['max', 1025]]);
  eq('Balken: 0 vorhanden, 1025 fehlen', sh.getRange('R93:R94').getValues(), [[0], [1025]]);
  ok('Wertverlauf leer', sh.getRange('R2:R91').getValues().every(r => r[0] === ''));
  // Knöpfe
  const imgs = buttons(env);
  eq('11 Knöpfe, je einmal geladen', [imgs.length, assetFetches(env).length], [11, 11]);
  eq('geladen von DASH_ASSETS', assetFetches(env).map(u => u.slice(ASSETS.length)).sort(), BTN.map(b => b.key + '.png').sort());
  const wrong = BTN.map((b, i) => {
    const img = imgs.find(x => x.getAltTextDescription() === 'Dashboard-Knopf ' + b.key + ' v' + env.run('DASH_ASSET_VERSION'));
    const at = env.ctx.dashButtonCell_(i);
    if (!img) return b.key + ': fehlt';
    const got = [img.getScript(), img.getAltTextTitle(), img.getWidth(), img.getHeight(), img.getAnchorCell().getRow(), img.getAnchorCell().getColumn(),
      img.getAnchorCellXOffset(), img.getAnchorCellYOffset()];
    const want = [b.fn, b.label, 276, 52, at.row, at.col, 0, 3];
    return J(got) === J(want) ? null : b.key + ': ' + J(got) + ' statt ' + J(want);
  }).filter(Boolean);
  ok('jeder Knopf: Funktion, Beschriftung, Größe, Lage', wrong.length === 0, wrong);
  const blob = imgs[0].src;
  ok('Bild als PNG-Blob mit Namen eingefügt', blob && blob.getContentType() === 'image/png' && /^[\w-]+\.png$/.test(blob.getName()) && blob.getBytes().length > 1000);
  ok('Sammlung bleibt aktiv', env.ss.getActiveSheet().getName() === 'Sammlung', env.ss.getActiveSheet().getName());
}

// ---------------------------------------------------------------------------
t.section('Kennzahlen nach Änderungen');
{
  const env = setup();
  add(env, { qty: 2 });
  add(env, { variant: 'reverse' });
  const v = env.ctx.collectionValue_(env.ctx.readData_(env.sheet('Daten')));
  ok('Wert der Sammlung > 0', v.total > 0 && v.cards === 3, v);
  eq('Gesamtwert, Karten, Pokédex', ['C6', 'G6', 'K6'].map(a => cell(env, a)), [v.total, 3, '1 von 1025']);
  eq('3 Exemplare, 2 verschiedene', cell(env, 'G7'), 'davon 2 verschiedene');
  eq('Pokédex in Prozent', cell(env, 'K5'), 'POKÉDEX · 0,1 %');
  eq('Balken: 1 vorhanden, 1024 fehlen', dash(env).getRange('R93:R94').getValues(), [[1], [1024]]);
  // direkt im Blatt Daten geändert: onEdit rechnet nach
  const data = env.sheet('Daten');
  const COL = env.run('COL');
  const r = env.ctx.readData_(data).findIndex(x => x[COL.variant] === 'base' || x[COL.count] === 2) + 2;
  data.getRange(r, COL.count + 1).setValue(1);
  env.ctx.onEdit({ range: data.getRange(r, COL.count + 1) });
  eq('nach onEdit: 2 Karten, alle verschieden', [cell(env, 'G6'), cell(env, 'G7')], [2, 'alle verschieden']);
  data.getRange(r, COL.count + 1).setValue(0);
  env.ctx.onEdit({ range: data.getRange(r, COL.count + 1) });
  eq('eine Karte: kein Zusatz', [cell(env, 'G6'), cell(env, 'G7')], [1, '']);
  // Schreibvorgänge: Kopf, zwei Kachelzeilen, Unterzeile, Hilfsspalten
  const d0 = env.writesBy['Dashboard'] || 0;
  refresh(env);
  ok('Neuberechnung in 5 Schreibvorgängen', (env.writesBy['Dashboard'] || 0) - d0 === 5, (env.writesBy['Dashboard'] || 0) - d0);
  ok('Formeln bleiben stehen', /SPARKLINE/.test(dash(env).getRange('O6').getFormula()) && /SPARKLINE/.test(dash(env).getRange('K7').getFormula()));
}

// ---------------------------------------------------------------------------
t.section('Veränderung des Gesamtwerts seit 7 Tagen');
{
  const env = setup();
  add(env, { qty: 4 });
  const total = env.ctx.collectionValue_(env.ctx.readData_(env.sheet('Daten'))).total;
  const c = env.run('DASH_COLORS');
  const color = () => dash(env).getRange('C7').getFontColor();
  history(env, []);
  refresh(env);
  eq('ohne Verlauf', [cell(env, 'C7'), color()], ['Noch kein Verlauf', c.sub]);
  history(env, [[today(env), total]]);
  refresh(env);
  eq('nur heute: ab wann es einen Vergleich gibt', cell(env, 'C7'), 'Vergleich ab ' + short(env, shift(env, 7)));
  history(env, [[shift(env, -3), total - 1], [today(env), total]]);
  refresh(env);
  eq('jüngster Eintrag 3 Tage alt: noch kein Vergleich', cell(env, 'C7'), 'Vergleich ab ' + short(env, shift(env, 4)));
  history(env, [[shift(env, -7), total - 12.4], [shift(env, -1), total - 2]]);
  refresh(env);
  eq('genau 7 Tage: plus, grün', [cell(env, 'C7'), color()], ['+12,40 € seit ' + short(env, shift(env, -7)), c.up]);
  history(env, [[shift(env, -20), total + 50], [shift(env, -9), total + 3.1], [shift(env, -5), total - 9]]);
  refresh(env);
  eq('Tag fehlt: der nächstältere, minus, rot', [cell(env, 'C7'), color()], ['−3,10 € seit ' + short(env, shift(env, -9)), c.down]);
  history(env, [[shift(env, -8), total]]);
  refresh(env);
  eq('gleich geblieben', [cell(env, 'C7'), color()], ['±0,00 € seit ' + short(env, shift(env, -8)), c.sub]);
  history(env, [[shift(env, -7), total - 1000], [shift(env, -7), total - 1234.5]]);
  refresh(env);
  eq('zwei Einträge am selben Tag: der letzte zählt, Tausenderpunkt', cell(env, 'C7'), '+1.234,50 € seit ' + short(env, shift(env, -7)));
  history(env, [[shift(env, -7), total - 5, 'text'], ['Summe', 99]]);
  refresh(env);
  eq('Datum als Text yyyy-MM-dd zählt, andere Zeilen nicht', cell(env, 'C7'), '+5,00 € seit ' + short(env, shift(env, -7)));
  // Hilfen
  eq('Datum kurz: im selben Jahr ohne Jahr', [env.ctx.dashShortDate_('2026-10-15', '2026-10-22'), env.ctx.dashShortDate_('2025-12-30', '2026-01-03')], ['15.10.', '30.12.2025']);
  eq('Tage verschieben über Monats- und Jahresgrenzen', [env.ctx.dashDayShift_('2026-03-01', -1), env.ctx.dashDayShift_('2024-03-01', -1), env.ctx.dashDayShift_('2026-12-31', 1),
    env.ctx.dashDayShift_('2026-10-22', -7)], ['2026-02-28', '2024-02-29', '2027-01-01', '2026-10-15']);
  eq('Euro', [env.ctx.dashEur_(0), env.ctx.dashEur_(1234.5), env.ctx.dashEur_(1234567.891), env.ctx.dashEur_(-2.005)], ['0,00 €', '1.234,50 €', '1.234.567,89 €', '2,01 €']);
}

// ---------------------------------------------------------------------------
t.section('Wertverlauf und Preislauf');
{
  const env = setup();
  add(env, { qty: 2 });
  const list = [];
  for (let d = -120; d <= -1; d++) list.push([shift(env, d), 100 + d]);
  history(env, list);
  refresh(env);
  const r = dash(env).getRange('R2:R91').getValues().map(x => x[0]);
  ok('nur die letzten 90 Tage, älteste zuerst', r.length === 90 && r[0] === 100 - 89 && r[88] === 99 && r[89] === '', [r[0], r[88], r[89]]);
  history(env, list.slice(-3));
  refresh(env);
  const r2 = dash(env).getRange('R2:R91').getValues().map(x => x[0]);
  ok('kürzerer Verlauf: Rest leer', r2.slice(0, 3).join() === '97,98,99' && r2.slice(3).every(x => x === ''), r2.slice(0, 5));
  // Preislauf schreibt Verlauf und Kopfzeile
  history(env, []);
  env.ctx.preiseJetztAktualisieren();
  const total = env.ctx.collectionValue_(env.ctx.readData_(env.sheet('Daten'))).total;
  ok('nach dem Preislauf: Preise vom heute', new RegExp(' · Preise vom ' + env.ctx.dmyText_(today(env)).replace(/\./g, '\\.') + '$').test(cell(env, 'C3')), cell(env, 'C3'));
  eq('heutiger Wert im Wertverlauf', dash(env).getRange('R2').getValue(), total);
}

// ---------------------------------------------------------------------------
t.section('Hinweis auf neue Version');
{
  const env = setup();
  const v = env.run('TOOL_VERSION');
  env.cache.set('UPD_CHANNEL', J({ releases: [{ version: '9.9.9', prerelease: false, notes: [] }] }));
  refresh(env);
  eq('neue Version aus dem Zwischenspeicher', cell(env, 'O2'), 'Version ' + v + ' · Version 9.9.9 ist da');
  env.cache.set('UPD_CHANNEL', J({ releases: [{ version: '9.9.9-beta.1', prerelease: true, notes: [] }] }));
  refresh(env);
  eq('Vorabversion nur mit Vorabversionen an', cell(env, 'O2'), 'Version ' + v);
  env.cache.set('UPD_CHANNEL', '{kaputt');
  refresh(env);
  eq('kaputter Zwischenspeicher: nur die Version', cell(env, 'O2'), 'Version ' + v);
  const n = env.httpLog.length + env.fetchLog.length;
  env.cache.clear();
  refresh(env);
  ok('ohne Zwischenspeicher kein Abruf', env.httpLog.length + env.fetchLog.length === n && cell(env, 'O2') === 'Version ' + v);
}

// ---------------------------------------------------------------------------
t.section('Knöpfe beim erneuten Aufbau');
{
  const env = setup();
  const sh = dash(env);
  const before = buttons(env);
  env.ctx.setupAll_();
  ok('Einrichtung noch einmal: keine neuen Abrufe, dieselben Bilder', assetFetches(env).length === 11 && buttons(env).length === 11 &&
    buttons(env).every(i => before.indexOf(i) >= 0), [assetFetches(env).length, buttons(env).length]);
  env.ctx.ansichtNeuAufbauen();
  eq('Ansicht neu aufbauen: Meldung ohne Ladefehler', env.ui.alerts.slice(-1)[0], 'Ansicht neu aufgebaut.');
  // verschoben, Funktion geändert, eigenes Bild, doppelter und unbekannter Knopf
  before[0].setAnchorCell(sh.getRange('A30')).setWidth(10).assignScript('apiPruefen');
  const own = sh.insertImage('https://example.com/pikachu.png', 2, 25);
  own.setAltTextDescription('Mein Pikachu');
  const dup = sh.insertImage('https://example.com/x.png', 3, 25);
  dup.setAltTextDescription('Dashboard-Knopf preise v' + env.run('DASH_ASSET_VERSION'));
  const odd = sh.insertImage('https://example.com/y.png', 4, 25);
  odd.setAltTextDescription('Dashboard-Knopf gibtsnicht v' + env.run('DASH_ASSET_VERSION'));
  env.ctx.ansichtNeuAufbauen();
  const k0 = buttons(env).find(i => /erfassen/.test(i.getAltTextDescription()));
  ok('verschobener Knopf wieder an seinem Platz', k0 === before[0] && k0.getAnchorCell().getA1Notation() === 'B12' && k0.getWidth() === 276 && k0.getScript() === 'kartenErfassen');
  ok('eigenes Bild bleibt', sh.getImages().indexOf(own) >= 0 && !own.removed);
  ok('doppelter und unbekannter Knopf entfernt', dup.removed && odd.removed && buttons(env).length === 11 &&
    buttons(env).filter(i => /preise/.test(i.getAltTextDescription())).length === 1);
  ok('dabei nichts geladen', assetFetches(env).length === 11);
  // neue Bild-Version: alle ersetzen
  buttons(env).forEach(i => i.setAltTextDescription(i.getAltTextDescription().replace(/ v\S+$/, ' v0')));
  const old = buttons(env);
  env.ctx.ansichtNeuAufbauen();
  ok('alte Bild-Version: alle neu geladen und ersetzt', old.every(i => i.removed) && buttons(env).length === 11 && assetFetches(env).length === 22 &&
    buttons(env).every(i => / v1$/.test(i.getAltTextDescription())), [assetFetches(env).length, buttons(env).length]);
  ok('eigenes Bild bleibt auch dabei', !own.removed);
  // Blatt von Hand verschoben: wieder nach vorne, Inhalt neu
  env.ss.setActiveSheet(sh);
  env.ss.moveActiveSheet(env.ss.list.length);
  sh.getRange('C2').setValue('Gekritzel');
  env.ss.setActiveSheet(env.sheet('Sammlung'));
  env.ctx.ansichtNeuAufbauen();
  ok('wieder vorne, Kopf neu, Sammlung bleibt aktiv', env.ss.list[0].name === 'Dashboard' && env.ss.list[1].name === 'Sammlung' && cell(env, 'C2') === 'Pokémon-Sammlung' &&
    env.ss.getActiveSheet().getName() === 'Sammlung');
}

// ---------------------------------------------------------------------------
t.section('GitHub nicht erreichbar');
{
  const FAILED = H.createEnv().run('DASH_LOAD_FAILED');
  const env = H.createEnv();
  env.fetchFail = url => (ASSET_RE.test(url) ? 404 : undefined);
  const msg = env.ctx.setupAll_();
  ok('Einrichtung klappt, Meldung nennt die Knöpfe', /^Einrichtung fertig\./.test(msg) && msg.indexOf(FAILED) >= 0 && env.ss.toasts.indexOf(msg) >= 0, msg);
  eq('keine Knöpfe, Hinweis im Blatt', [buttons(env).length, cell(env, 'C19')], [0, FAILED]);
  ok('Hinweis rot', dash(env).getRange('C19').getFontColor() === env.run('DASH_COLORS').warn);
  ok('Kennzahlen trotzdem da', cell(env, 'C2') === 'Pokémon-Sammlung' && cell(env, 'K6') === '0 von 1025');
  env.fetchFail = null;
  env.ctx.ansichtNeuAufbauen();
  eq('wieder erreichbar: Knöpfe da, Hinweis normal', [buttons(env).length, cell(env, 'C19'), env.ui.alerts.slice(-1)[0]], [11, env.run('DASH_HELP'), 'Ansicht neu aufgebaut.']);

  const env2 = H.createEnv();
  env2.fetchFail = url => (ASSET_RE.test(url) ? 'throw' : undefined);
  const msg2 = env2.ctx.setupAll_();
  ok('Abruf wirft: Einrichtung läuft durch, Hinweis', buttons(env2).length === 0 && cell(env2, 'C19') === FAILED && /^Einrichtung fertig\./.test(msg2), msg2);

  const env3 = H.createEnv();
  env3.http = url => (/\/preise\.png$/.test(url) ? { code: 404, body: '404: Not Found' } : /\/sets\.png$/.test(url) ? { code: 200, body: Buffer.alloc(0) } : undefined);
  env3.ctx.setupAll_();
  ok('zwei fehlen (404, leeres Bild): 9 Knöpfe, Hinweis', buttons(env3).length === 9 && cell(env3, 'C19') === FAILED &&
    !buttons(env3).some(i => / (preise|sets) /.test(i.getAltTextDescription())));
  env3.http = null;
  env3.ctx.ansichtNeuAufbauen();
  eq('danach: nur die zwei fehlenden geladen', [buttons(env3).length, assetFetches(env3).slice(9).map(u => u.split('/').pop())], [11, ['preise.png', 'sets.png']]);
}

// ---------------------------------------------------------------------------
t.section('Blätter öffnen, Dashboard, Import');
{
  const env = setup();
  const active = () => env.ss.getActiveSheet().getName();
  env.ctx.zurSammlung(); const a1 = active();
  env.ctx.zumPokedex(); const a2 = active();
  env.ctx.zumVerlauf(); const a3 = active();
  env.ctx.zuSeltenheiten(); const a4 = active();
  eq('vier Blätter', [a1, a2, a3, a4], ['Sammlung', 'Pokédex', 'Verlauf', 'Seltenheiten']);
  env.sheet('Verlauf').hideSheet();
  env.ctx.zumVerlauf();
  ok('verstecktes Blatt wird sichtbar', active() === 'Verlauf' && !env.sheet('Verlauf').isSheetHidden());
  env.ctx.zumDashboard();
  eq('Menü Dashboard', active(), 'Dashboard');
  env.ss.deleteSheet(env.sheet('Seltenheiten'));
  const n = env.ui.alerts.length;
  env.ctx.zuSeltenheiten();
  ok('fehlendes Blatt: wieder angelegt und offen, mit Hinweis unten rechts', active() === 'Seltenheiten' && env.objects('Seltenheiten').length > 40 &&
    env.ui.alerts.length === n && env.ss.toasts.some(m => /Lege fehlende Blätter wieder an: Seltenheiten/.test(m)), env.ss.toasts.slice(-2));
  // Dashboard gelöscht: Menü baut es wieder auf
  env.ss.deleteSheet(dash(env));
  add(env);
  ok('ohne Dashboard: Änderungen legen keins an', !env.sheet('Dashboard') && env.ctx.refreshDashboard_([]) === false);
  env.ctx.zumDashboard();
  ok('Menü Dashboard: neu aufgebaut, vorne, offen, mit Knöpfen', env.ss.list[0].name === 'Dashboard' && active() === 'Dashboard' && buttons(env).length === 11 && cell(env, 'G6') === 1);
  // Importieren: Seitenleiste im Bereich Import
  env.ctx.importAnzeigen();
  const tpl = env.templates[env.templates.length - 1];
  ok('Importieren: Seitenleiste mit start=import', tpl.__file === 'Ui' && tpl.start === 'import' && tpl.mode === 'sidebar', [tpl.__file, tpl.start, tpl.mode]);
  env.ctx.kartenErfassen();
  eq('Knopf ohne Argument: normaler Start', env.templates[env.templates.length - 1].start, '');
  // stillgelegte Tabelle: kein neues Dashboard
  env.ss.deleteSheet(dash(env));
  env.ctx.settingSet_('TAKEN_OVER_BY', 'https://docs.google.com/spreadsheets/d/NEU/edit');
  const m = env.ui.alerts.length;
  env.ctx.zumDashboard();
  ok('stillgelegt: Hinweis statt Dashboard', !env.sheet('Dashboard') && env.ui.alerts.length === m + 1 && /übernommen/.test(env.ui.alerts[m]));
}

// ---------------------------------------------------------------------------
t.section('Startseite');
{
  const env = setup();
  const active = () => env.ss.getActiveSheet().getName();
  env.ss.setActiveSheet(env.sheet('Pokédex'));
  env.ctx.onOpen();
  eq('beim Öffnen: Dashboard', active(), 'Dashboard');
  dash(env).hideSheet();
  env.ss.setActiveSheet(env.sheet('Pokédex'));
  env.ctx.onOpen();
  eq('verstecktes Dashboard bleibt versteckt', [active(), dash(env).isSheetHidden()], ['Pokédex', true]);
  dash(env).showSheet();
  env.ctx.settingSet_('TAKEN_OVER_BY', 'https://docs.google.com/spreadsheets/d/NEU/edit');
  env.ss.setActiveSheet(env.sheet('Sammlung'));
  env.ctx.onOpen();
  eq('stillgelegte Tabelle: kein Sprung', active(), 'Sammlung');
  const env2 = H.createEnv();
  env2.ctx.onOpen();
  ok('Tabelle ohne Dashboard: Menü wie bisher, kein Fehler', env2.ui.menus.length === 1 && env2.ss.getActiveSheet().getName() === 'Tabellenblatt1');
}

// ---------------------------------------------------------------------------
t.section('Eigenes Blatt „Dashboard“ aus der Zeit vor 1.1.0');
{
  // Tabelle auf 1.0.x: TOOL_SHEETS ohne Dashboard, ein selbst angelegtes Blatt „Dashboard“; dann Code 1.1.0 von Hand
  const env = setup();
  env.ss.deleteSheet(dash(env));
  env.ctx.settingSet_('TOOL_SHEETS', J(JSON.parse(env.setting('TOOL_SHEETS')).filter(n => n !== 'Dashboard')));
  env.ctx.settingSet_('CODE_VERSION', '1.0.3');
  env.ss.insertSheet('Dashboard').getRange('A1:B2').setValues([['Mein Ziel', 'Budget'], ['Glurak', 300]]);
  env.ss.insertSheet('Dashboard (alt)').getRange('A1').setValue('noch älter');
  env.ctx.kartenErfassen();
  ok('eigenes Blatt bleibt als „Dashboard (alt 2)“, Inhalt unverändert', env.sheet('Dashboard (alt 2)') && env.sheet('Dashboard (alt 2)').getRange('B2').getValue() === 300 &&
    env.sheet('Dashboard (alt)').getRange('A1').getValue() === 'noch älter', env.ss.list.map(s => s.name));
  ok('Hinweis unten rechts', env.ss.toasts.some(m => /Dein Blatt „Dashboard“ heißt jetzt „Dashboard \(alt 2\)“/.test(m)), env.ss.toasts);
  ok('Dashboard des Tools neu, vorne, mit Knöpfen', env.ss.list[0].name === 'Dashboard' && cell(env, 'C2') === 'Pokémon-Sammlung' && buttons(env).length === 11);
  ok('jetzt in TOOL_SHEETS', JSON.parse(env.setting('TOOL_SHEETS')).indexOf('Dashboard') >= 0);
  const n = env.ss.list.length;
  env.ctx.ansichtNeuAufbauen();
  ok('beim nächsten Aufbau: nichts umbenannt', env.ss.list.length === n && !env.sheet('Dashboard (alt 3)') && cell(env, 'C2') === 'Pokémon-Sammlung');
  // Markierung verloren, aber in TOOL_SHEETS: bleibt das Dashboard des Tools
  dash(env).getDeveloperMetadata().forEach(m => m.remove());
  env.ctx.ansichtNeuAufbauen();
  ok('ohne Markierung, aber in TOOL_SHEETS: nicht umbenannt, Markierung wieder da', env.ss.list.length === n &&
    dash(env).getDeveloperMetadata().some(m => m.getKey() === 'pokemonToolDashboard'));
  // ganz neue Tabelle (noch keine Einstellungen) mit eigenem Dashboard
  const env2 = H.createEnv({ sheets: ['Tabellenblatt1', 'Dashboard'] });
  env2.sheet('Dashboard').getRange('A1').setValue('Meins');
  env2.ctx.setupAll_();
  ok('neue Tabelle: eigenes Blatt als „Dashboard (alt)“', env2.sheet('Dashboard (alt)').getRange('A1').getValue() === 'Meins' && buttons(env2).length === 11);
}

// ---------------------------------------------------------------------------
t.section('Code ohne Update.gs');
{
  const env = H.createEnv({ files: ['Code.gs'] });
  env.ctx.setupAll_();
  ok('Dashboard auch ohne Update.gs, ohne Hinweis auf Versionen', buttons(env).length === 11 && cell(env, 'O2') === 'Version ' + env.run('TOOL_VERSION'));
}

t.done();
