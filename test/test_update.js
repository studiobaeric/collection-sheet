'use strict';
/**
 * Tests für Update.gs und Code.gs Abschnitt 1c: Versionen, Release-Kanal, „Neue Version holen“ (Kopie der Vorlage),
 * Übernahme aus einer alten Tabelle, Stilllegen und wieder benutzen. Aufruf: node test_update.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./harness2');

const t = H.runner('update');
const SRC = H.SRC_DIR;
const REPO = 'studiobaeric/collection-sheet';
const RAW = 'https://raw.githubusercontent.com/';
const CHANNEL_URL = RAW + REPO + '/main/releases/channel.json';
const SCOPES = ['spreadsheets', 'script.container.ui', 'script.external_request', 'script.scriptapp', 'drive']
  .map(s => 'https://www.googleapis.com/auth/' + s);
const OLD_ID = '1OldSheetIdOldSheetIdOldSheetId0123456789';
const TEMPLATE_ID = '1TemplateIdTemplateIdTemplateId0123456789';
const BETA_ID = '1BetaTemplateBetaTemplateBetaTpl012345678';
const TEMPLATE_URL = 'https://docs.google.com/spreadsheets/d/' + TEMPLATE_ID + '/copy';
const J = x => JSON.stringify(x);

const read = p => fs.readFileSync(path.join(SRC, '..', p), 'utf8');
const withVersion = (code, v) => code.replace(/const TOOL_VERSION = '[^']*';/, "const TOOL_VERSION = '" + v + "';");

/** Ordner mit dem Code einer anderen Version (nur TOOL_VERSION geändert), für Umgebungen „neue Version“. */
function srcDirFor(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  fs.readdirSync(SRC).forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(dir, f)));
  fs.writeFileSync(path.join(dir, 'Code.gs'), withVersion(read('src/Code.gs'), version));
  return dir;
}

/** GitHub (nur der Kanal) im Speicher. */
function makeWorld() {
  const W = {
    releases: [], channelCode: 200, channelBroken: false, templateUrl: TEMPLATE_URL,
    guideUrl: 'https://github.com/' + REPO + '#von-hand-aktualisieren', channelFetches: 0
  };
  W.release = (version, opts) => {
    opts = opts || {};
    const rel = { version, tag: 'v' + version, date: opts.date || '2026-10-21', prerelease: !!opts.prerelease, schema: opts.schema || '2', notes: opts.notes || ['Neu in ' + version] };
    if (opts.templateUrl) rel.templateUrl = opts.templateUrl;
    W.releases.unshift(rel);
    return rel;
  };
  W.channel = () => ({ repo: REPO, templateUrl: W.templateUrl, guideUrl: W.guideUrl, releases: W.releases });
  W.handler = (url) => {
    if (url.indexOf(CHANNEL_URL) === 0) {
      W.channelFetches++;
      if (W.channelCode !== 200) return { code: W.channelCode, body: '' };
      return { code: 200, body: W.channelBroken ? '{kaputt' : J(W.channel()) };
    }
    return undefined;
  };
  return W;
}

/** Code der Tabellen in diesen Tests: Version 1.0.0, egal welche Version gerade im Repo steht (Release-Ablauf). */
const BASE_DIR = srcDirFor('1.0.0');
const baseEnv = () => H.createEnv({ srcDir: BASE_DIR });

function setupEnv(W, opts) {
  opts = opts || {};
  const env = H.createEnv({ srcDir: opts.srcDir || BASE_DIR });
  if (opts.id) env.ss.id = opts.id;
  env.http = W.handler;
  env.ctx.einrichtung();
  env.ui.alerts.length = 0;
  env.cache.clear();
  return env;
}

/** Vorlage wie in docs/RELEASE.md: eingerichtet, ohne Karten. In env sichtbar (Drive und SpreadsheetApp). */
function addTemplate(env, W, version, id) {
  const dir = srcDirFor(version);
  const tpl = setupEnv(W, { srcDir: dir, id: id || TEMPLATE_ID });
  tpl.ss.name = 'Pokémon-Sammlung Vorlage';
  env.sources[tpl.ss.id] = tpl.ss;
  env.driveFiles[tpl.ss.id] = { name: tpl.ss.name, mime: H.MIME.GOOGLE_SHEETS };
  return { tpl, dir };
}

/** Die Tabelle book mit dem Code aus srcDir „öffnen“ (wie eine Kopie, deren Skript eine andere Version hat). */
function openWith(book, srcDir, W) {
  const env = H.createEnv({ srcDir, sheets: [] });
  env.http = W.handler;
  env.ss.id = book.id;
  env.ss.name = book.name;
  book.list.forEach(s => {
    const n = env.ss.insertSheet(s.name, { maxRows: s.maxRows, maxCols: s.maxCols });
    n.d = s.d.map(r => (r ? r.slice() : r)); n.f = s.f.map(r => (r ? r.slice() : r)); n.formulas = Object.assign({}, s.formulas); n.hidden = s.hidden;
  });
  return env;
}

const updSheetIdOf = url => (String(url).match(/\/d\/([\w-]+)/) || [])[1];
const settingOf = (book, key) => {
  const sh = book.getSheetByName('Tool-Einstellungen');
  if (!sh) return undefined;
  const r = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 2).getValues().find(x => String(x[0]) === key);
  return r ? String(r[1]) : undefined;
};

// ---------------------------------------------------------------------------
t.section('Dateien: Namen, Ladereihenfolge, Manifest');
{
  const files = ['Code.gs', 'Import.gs', 'Update.gs'];
  const seen = {};
  files.forEach(f => {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/);
      if (m) (seen[m[1] || m[2]] = seen[m[1] || m[2]] || []).push(f + ':' + (i + 1));
    });
  });
  const dup = Object.keys(seen).filter(n => seen[n].length > 1).map(n => n + ' ' + seen[n].join(', '));
  t.ok('keine doppelten Namen über Code.gs, Import.gs, Update.gs', dup.length === 0, dup);
  const vm = require('vm');
  let loadErr = '';
  try { const ctx = vm.createContext({}); ['Update.gs', 'Import.gs', 'Code.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx)); } catch (e) { loadErr = e.message; }
  t.ok('Update.gs lädt vor Code.gs ohne Fehler', !loadErr, loadErr);
  const man = JSON.parse(read('src/appsscript.json'));
  t.eq('Manifest: Rechte (ohne Apps-Script-API)', man.oauthScopes, SCOPES);
  t.ok('Manifest: Drive v3, V8', man.runtimeVersion === 'V8' && man.dependencies.enabledAdvancedServices[0].version === 'v3');
  const up = fs.readFileSync(path.join(SRC, 'Update.gs'), 'utf8');
  t.ok('kein Gedankenstrich in Update.gs', up.indexOf('—') < 0);
  t.ok('kein api.github.com, keine Apps-Script-API', up.indexOf('api.github.com') < 0 && up.indexOf('script.googleapis.com') < 0);
}

// ---------------------------------------------------------------------------
t.section('Versionen vergleichen');
{
  const env = H.createEnv();
  const c = env.ctx;
  const order = ['0.9.9', '1.0.0', '1.0.1', '1.1.0-alpha', '1.1.0-beta.1', '1.1.0-beta.2', '1.1.0-beta.10', '1.1.0-rc.1', '1.1.0', '1.10.0', '2.0.0'];
  let sorted = true;
  for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
    const want = i < j ? -1 : i > j ? 1 : 0;
    if (c.updCompare_(order[i], order[j]) !== want) { sorted = false; console.log('  ', order[i], order[j], c.updCompare_(order[i], order[j])); }
  }
  t.ok('SemVer-Reihenfolge inkl. Vorabversionen', sorted);
  t.ok('v-Präfix und Ungültiges', c.updCompare_('v1.2.0', '1.2.0') === 0 && c.updCompare_('kaputt', '0.0.1') === -1 && c.updCompare_('1.0', '1.0.0') === -1);
  t.ok('TOOL_VERSION ist gültig', !!c.updParse_(env.run('TOOL_VERSION')));
  const clean = c.updCleanChannel_({ repo: 'x/y', templateUrl: 'https://evil.example/copy', guideUrl: 'javascript:alert(1)',
    releases: [{ version: '1.2.0', templateUrl: TEMPLATE_URL }, { version: 'neu' }, null, { version: 'v1.3.0-beta.1', prerelease: true, templateUrl: 'nein' }] });
  t.ok('Kanal bereinigt: nur gültige Versionen, nur Tabellen-Links, sortiert', clean.repo === 'x/y' && clean.templateUrl === '' && clean.guideUrl === '' &&
    J(clean.releases.map(r => r.version)) === J(['1.3.0-beta.1', '1.2.0']) && clean.releases[0].templateUrl === '' && clean.releases[1].templateUrl === TEMPLATE_URL &&
    clean.releases[0].tag === 'v1.3.0-beta.1', clean);
}

// ---------------------------------------------------------------------------
t.section('Einstellungen, Kopien, Stilllegen, wieder benutzen');
{
  const W = makeWorld();
  const env = setupEnv(W);
  const c = env.ctx;
  t.ok('Einrichtung: Blatt Tool-Einstellungen versteckt, Tabellen-ID', env.sheet('Tool-Einstellungen').isSheetHidden() &&
    env.setting('Tabellen-ID') === 'SSID' && env.setting('CODE_VERSION') === env.run('TOOL_VERSION') && env.setting('SCHEMA_VERSION') === '2' && !!env.setting('SETUP_AT'));
  c.settingSet_('WEBAPP_URL', 'https://script.google.com/macros/s/AKfyWEB1/exec');
  c.settingSet_('PRERELEASES', '1');
  // so sieht eine Kopie aus (Vorlage oder „Kopie erstellen“): das Blatt nennt eine andere Tabelle
  const sh = env.sheet('Tool-Einstellungen');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  rows.forEach((r, i) => { if (r[0] === 'Tabellen-ID') sh.getRange(i + 2, 2).setValue('TEMPLATEID'); });
  env.run('settingsCache_ = null');
  t.ok('Kopie: lokale Werte lesen sich leer, andere bleiben', c.settingGet_('WEBAPP_URL') === '' && c.settingGet_('SETUP_AT') === '' && c.settingGet_('PRERELEASES') === '1');
  t.ok('Kopie ist frisch', c.isFreshCopy_() === true);
  const before = env.writes;
  t.ok('frische Kopie: Web-App bittet um die Seitenleiste, schreibt nichts', /Diese Tabelle ist neu/.test(c.doGet().getContent()) && env.writes === before);
  env.triggers = [];
  c.kartenErfassen();
  t.ok('frische Kopie: Seitenleiste richtet ein (Auslöser, Tabellen-ID)', env.triggers.length === 2 && env.setting('Tabellen-ID') === 'SSID' && env.setting('WEBAPP_URL') === '' &&
    env.props.SPREADSHEET_ID === 'SSID', env.triggers.map(x => x.fn));
  t.ok('danach nicht mehr frisch', c.isFreshCopy_() === false);

  // Stilllegen
  c.settingsSetMany_({ TAKEN_OVER_BY: 'https://docs.google.com/spreadsheets/d/NEU/edit', TAKEN_OVER_AT: '21.10.2026 10:00', TAKEN_OVER_SHEET: 'Übernommen' });
  env.ss.insertSheet('Übernommen', 0);
  env.ss.rename('Pokémon-Sammlung (alt)');
  env.ui.menus.length = 0;
  c.onOpen();
  t.ok('stillgelegt: Menü nur mit Hinweis und Wieder-benutzen', env.ui.menus.length === 1 &&
    J(env.ui.menus[0].items) === J([['Diese Tabelle wurde übernommen', 'uebernommenHinweis'], ['Diese Tabelle wieder benutzen', 'wiederBenutzen']]));
  c.kartenErfassen();
  const side = env.ui.sidebars[env.ui.sidebars.length - 1].getContent();
  t.ok('stillgelegt: Seitenleiste zeigt Link', /übernommen/.test(side) && side.indexOf('https://docs.google.com/spreadsheets/d/NEU/edit') >= 0);
  t.ok('stillgelegt: Web-App zeigt Link', /Zur neuen Tabelle/.test(c.doGet().getContent()));
  c.naechtlicherPreislauf();
  t.ok('stillgelegt: nächtlicher Lauf löscht die Auslöser', env.triggers.length === 0);
  t.eq('stillgelegt: neue Version holen geht nicht', env.uiCall('updateCopy').state, 'error');
  t.throws('stillgelegt: Schreiben scheitert mit Hinweis', () => env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 }), /übernommen/);

  // wieder benutzen: erst Nein, dann Ja
  env.alertAnswer = 'NO';
  c.wiederBenutzen();
  t.ok('Nein: bleibt stillgelegt', c.takenOverBy_() !== '' && env.triggers.length === 0);
  env.alertAnswer = 'YES';
  env.ui.alerts.length = 0;
  c.wiederBenutzen();
  t.ok('Ja: wieder aktiv, Auslöser, Hinweisblatt weg, Name ohne (alt)', c.takenOverBy_() === '' && env.triggers.length === 2 && !env.sheet('Übernommen') &&
    env.ss.getName() === 'Pokémon-Sammlung' && /wieder aktiv/.test(env.ui.alerts.join(' ')), env.ui.alerts);
  t.ok('Ja: Rückfrage nannte die neue Tabelle', /NEU\/edit/.test(env.ui.alerts[0] || ''), env.ui.alerts);
  env.ui.menus.length = 0;
  c.onOpen();
  t.ok('danach volles Menü', env.ui.menus[0].items.some(x => x[1] === 'kartenErfassen'));
  env.ui.alerts.length = 0;
  c.wiederBenutzen();
  t.ok('nicht stillgelegt: nur Hinweis', /nicht stillgelegt/.test(env.ui.alerts.join(' ')));
}

// ---------------------------------------------------------------------------
t.section('Menü und Start-Tab');
{
  const W = makeWorld();
  const env = setupEnv(W);
  env.ui.menus.length = 0;
  env.ctx.onOpen();
  const main = env.ui.menus[0];
  t.ok('Menü Pokémon mit Untermenü Updates', main.name === 'Pokémon' && main.subs.length === 1 && main.subs[0].name === 'Updates' &&
    J(main.subs[0].items) === J([['Nach Updates suchen', 'updatesAnzeigen'], ['Aus alter Tabelle übernehmen', 'uebernahmeAnzeigen']]));
  env.ctx.updatesAnzeigen();
  t.eq('Updates öffnet Seitenleiste mit start=upd', env.templates[env.templates.length - 1].start, 'upd');
  env.ctx.uebernahmeAnzeigen();
  t.eq('Übernahme öffnet Seitenleiste mit start=takeover', env.templates[env.templates.length - 1].start, 'takeover');
  env.ctx.kartenErfassen({ authMode: 'FULL' });
  t.eq('Menü ohne Argument: start leer', env.templates[env.templates.length - 1].start, '');
  env.ctx.kartenErfassen('<script>');
  t.eq('unbekannter Start-Tab wird verworfen', env.templates[env.templates.length - 1].start, '');
  env.ctx.settingSet_('TAKE_FROM', 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit');
  env.ctx.kartenErfassen();
  t.eq('von „Neue Version holen“ angelegt und leer: start=takeover', env.templates[env.templates.length - 1].start, 'takeover');
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  env.ctx.kartenErfassen();
  t.eq('mit Karten: kein Übernahme-Start', env.templates[env.templates.length - 1].start, '');
}

// ---------------------------------------------------------------------------
t.section('getUpdateInfo');
{
  const W = makeWorld();
  W.release('1.0.0');
  const env = setupEnv(W);
  let info = env.uiCall('getUpdateInfo', false);
  t.ok('nichts Neues', info.installed === '1.0.0' && info.available === '' && info.banner === '' && info.newer.length === 0 && !info.error &&
    info.templateUrl === '' && info.newCopy === null && info.sheetUrl === env.ss.getUrl(), info);
  t.ok('Anleitung aus dem Kanal, Zeitpunkt', info.guideUrl === W.guideUrl && /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(info.checkedAt));
  W.release('1.1.0', { notes: ['Schneller suchen'] });
  W.release('1.2.0-beta.1', { prerelease: true, templateUrl: 'https://docs.google.com/spreadsheets/d/' + BETA_ID + '/copy' });
  info = env.uiCall('getUpdateInfo', false);
  t.ok('Cache: ohne force kein neuer Abruf', W.channelFetches === 1 && info.available === '', W.channelFetches);
  info = env.uiCall('getUpdateInfo', true);
  t.ok('force: 1.1.0 verfügbar, Vorabversion nicht, Vorlage des Kanals', info.available === '1.1.0' && info.banner === '1.1.0' && J(info.newer.map(x => x.version)) === J(['1.1.0']) &&
    J(info.newer[0].notes) === J(['Schneller suchen']) && info.templateUrl === TEMPLATE_URL && info.copyVersion === '1.1.0', info);
  info = env.uiCall('setPrereleases', true);
  t.ok('Vorabversionen an: 1.2.0-beta.1 zuerst, mit eigener Vorlage', info.prereleases && info.available === '1.2.0-beta.1' && info.newer.length === 2 &&
    env.setting('PRERELEASES') === '1' && info.templateUrl.indexOf(BETA_ID) >= 0, info);
  W.releases[0].templateUrl = undefined;
  info = env.uiCall('getUpdateInfo', true);
  t.ok('Vorabversion ohne eigene Vorlage: Holen nimmt die neueste mit Vorlage', info.available === '1.2.0-beta.1' && info.copyVersion === '1.1.0' &&
    info.templateUrl === TEMPLATE_URL, info);
  info = env.uiCall('setPrereleases', false);
  t.ok('Vorabversionen aus', !info.prereleases && info.available === '1.1.0' && env.setting('PRERELEASES') === '');
  t.ok('collectionEmpty bei leerer Sammlung, keine ausstehende Übernahme', info.collectionEmpty === true && info.pendingTake === '');
  env.ctx.settingsSetMany_({ NEW_COPY_URL: 'https://docs.google.com/spreadsheets/d/NEUNEUNEUNEUNEUNEUNEUNEU/edit', NEW_COPY_VERSION: '1.0.5' });
  t.ok('angelegte Kopie einer anderen Version zählt nicht', env.uiCall('getUpdateInfo', false).newCopy === null);
  env.ctx.settingSet_('NEW_COPY_VERSION', '1.1.0');
  t.ok('angelegte Kopie, die es in Drive nicht (mehr) gibt, zählt nicht', env.uiCall('getUpdateInfo', false).newCopy === null);
  env.driveFiles.NEUNEUNEUNEUNEUNEUNEUNEU = { name: 'Neu', mime: 'application/vnd.google-apps.spreadsheet', trashed: false };
  t.eq('angelegte Kopie dieser Version', env.uiCall('getUpdateInfo', false).newCopy, { url: 'https://docs.google.com/spreadsheets/d/NEUNEUNEUNEUNEUNEUNEUNEU/edit', version: '1.1.0' });
  env.driveFiles.NEUNEUNEUNEUNEUNEUNEUNEU.trashed = true;
  t.ok('angelegte Kopie im Papierkorb zählt nicht', env.uiCall('getUpdateInfo', false).newCopy === null);
  env.driveFiles.NEUNEUNEUNEUNEUNEUNEUNEU.trashed = false;
  env.ctx.settingSet_('TAKE_FROM', 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit');
  t.eq('ausstehende Übernahme', env.uiCall('getUpdateInfo', false).pendingTake, 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit');
  env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  info = env.uiCall('getUpdateInfo', false);
  t.ok('mit Karte: collectionEmpty false, keine ausstehende Übernahme', info.collectionEmpty === false && info.pendingTake === '');

  W.channelCode = 404;
  info = env.uiCall('getUpdateInfo', true);
  t.ok('GitHub nicht erreichbar: Fehlertext, kein Absturz', /GitHub/.test(info.error) && info.installed === '1.0.0' && info.available === '', info);
  W.channelCode = 200; W.channelBroken = true;
  t.ok('kaputte Liste: Fehlertext', /kaputt/.test(env.uiCall('getUpdateInfo', true).error));
  W.channelBroken = false;
  env.cache.clear();
  W.channelFetches = 0;
  env.ctx.checkForUpdate_();
  t.ok('checkForUpdate_ füllt den Cache', W.channelFetches === 1 && env.cache.has('UPD_CHANNEL'));
  env.cache.clear();
  W.channelFetches = 0;
  env.ctx.naechtlicherPreislauf();
  t.ok('nächtlicher Preislauf fragt GitHub', W.channelFetches === 1);
}

// ---------------------------------------------------------------------------
t.section('Neue Version holen: Kopie der Vorlage, Übernahme, alte Tabelle');
{
  const W = makeWorld();
  W.release('1.0.0'); W.release('1.1.0', { notes: ['Neu'] });
  const old = setupEnv(W, { id: OLD_ID });
  old.ss.name = 'Meine Karten';
  old.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  old.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', condition: 'LP', qty: 1 });
  old.ctx.settingSet_('WEBAPP_URL', 'https://script.google.com/macros/s/ALT/exec');
  old.sheet('Sammlung').getRange('B4').setValue('Glurak');
  const { tpl, dir } = addTemplate(old, W, '1.1.0');
  tpl.ctx.settingSet_('PRERELEASES', '1'); // die Vorlage hat Vorabversionen an, die alte Tabelle nicht
  t.ok('Vorlage: Version 1.1.0, ohne Karten, mit Liste ihrer Blätter', settingOf(tpl.ss, 'CODE_VERSION') === '1.1.0' && tpl.data().length === 0 &&
    JSON.parse(settingOf(tpl.ss, 'TOOL_SHEETS')).indexOf('Seltenheiten') >= 0);
  const r = old.uiCall('updateCopy');
  t.ok('angelegt: Zustand, Name, Ordner', r.state === 'copied' && r.version === '1.1.0' && r.name === 'Meine Karten (neu, Version 1.1.0)' &&
    old.backups.length === 1 && old.backups[0].folder === 'ROOT' && /\/d\/BACKUP/.test(r.url), r);
  const copy = old.sources[old.backups[0].id];
  t.ok('Kopie: eigene Tabellen-ID, weiß, woher sie übernimmt, kein Einrichtungsstempel', settingOf(copy, 'Tabellen-ID') === copy.getId() &&
    settingOf(copy, 'TAKE_FROM') === old.ss.getUrl() && settingOf(copy, 'SETUP_AT') === '' && settingOf(copy, 'CODE_VERSION') === '1.1.0');
  t.ok('alte Tabelle: unverändert bis auf den Merker', old.data().length === 2 && old.setting('NEW_COPY_URL') === r.url && old.setting('NEW_COPY_VERSION') === '1.1.0' &&
    !old.setting('TAKEN_OVER_BY') && old.triggers.length === 2);
  const info = old.uiCall('getUpdateInfo', false);
  t.ok('alte Tabelle: Info nennt die angelegte Kopie', info.newCopy && info.newCopy.url === r.url && info.available === '1.1.0', info);
  const r2 = old.uiCall('updateCopy');
  t.ok('zweites Holen: keine zweite Tabelle, Link der ersten', r2.state === 'copied' && r2.existing === true && r2.url === r.url &&
    old.backups.length === 1 && /gibt es schon/.test(r2.message) && old.lock.depth === 0, r2);

  // die neue Tabelle mit ihrem eigenen (neuen) Code öffnen
  const neu = openWith(copy, dir, W);
  neu.sources[OLD_ID] = old.ss;
  neu.perms[OLD_ID] = [{ type: 'user', role: 'owner', emailAddress: 'ich@example.org' }, { type: 'user', role: 'writer', emailAddress: 'Oma@example.org' },
    { type: 'anyone', role: 'reader', allowFileDiscovery: false }];
  t.ok('neu: nicht frisch, aber nie eingerichtet', neu.ctx.isFreshCopy_() === false && neu.ctx.needsSetup_() === true);
  t.ok('neu: Web-App bittet erst um die Seitenleiste', /Diese Tabelle ist neu/.test(neu.ctx.doGet().getContent()));
  neu.ctx.kartenErfassen();
  t.ok('neu: Seitenleiste richtet ein und startet mit der Übernahme', neu.triggers.length === 2 && !!neu.setting('SETUP_AT') &&
    neu.templates[neu.templates.length - 1].start === 'takeover', neu.triggers.map(x => x.fn));
  const ni = neu.uiCall('getUpdateInfo', false);
  t.ok('neu: pendingTake = alte Tabelle, nichts Neueres', ni.pendingTake === old.ss.getUrl() && ni.installed === '1.1.0' && ni.available === '', ni);
  const p = neu.uiCall('takeoverPreview', ni.pendingTake);
  t.ok('neu: Vorschau', p.cards === 2 && p.copies === 3 && p.version === '1.0.0', p);
  const tr = neu.uiCall('takeoverRun', ni.pendingTake);
  t.ok('neu: übernommen, Namen getauscht', tr.cards === 2 && tr.manualStop === false && tr.oldName === 'Meine Karten (alt)' && tr.newName === 'Meine Karten' &&
    neu.ss.getName() === 'Meine Karten' && old.ss.getName() === 'Meine Karten (alt)' && /heißt jetzt „Meine Karten \(alt\)“/.test(tr.message), tr);
  t.ok('neu: Daten, Suchfeld, keine ausstehende Übernahme mehr', neu.data().length === 2 && neu.sheet('Sammlung').getRange('B4').getValue() === 'Glurak' &&
    neu.uiCall('getUpdateInfo', false).pendingTake === '' && neu.setting('TAKEN_FROM') === old.ss.getUrl() && neu.setting('TAKE_RUN') === '');
  t.ok('neu: Vorabversionen wie in der alten Tabelle (aus)', neu.setting('PRERELEASES') === '');
  const pc = neu.permCreates;
  t.ok('neu: Freigaben der alten ohne E-Mail übernommen, Besitzer nicht doppelt', pc.length === 2 && pc.every(x => x.id === neu.ss.id) &&
    pc[0].res.emailAddress === 'Oma@example.org' && pc[0].res.role === 'writer' && pc[0].args.sendNotificationEmail === false &&
    pc[1].res.type === 'anyone' && pc[1].res.role === 'reader' && !('sendNotificationEmail' in pc[1].args) && tr.shared.added === 2 && /darf das jetzt auch hier/.test(tr.message), [pc, tr.shared]);
  old.run('settingsCache_ = null'); // neue Ausführung in der alten Tabelle (die neue hat dort geschrieben)
  t.ok('alt: stillgelegt mit Hinweisblatt und Wieder-benutzen-Hinweis', old.ctx.takenOverBy_() === neu.ss.getUrl() && old.ss.getSheets()[0].getName() === 'Übernommen' &&
    /wieder benutzen/.test(J(old.values('Übernommen'))));
  // Handy-Seite der alten Tabelle verweist auf die neue Handy-Seite, sobald es sie gibt
  delete old.sources[neu.ss.id]; // wer die neue Tabelle (noch) nicht sehen darf
  const noAccess = old.ctx.doGet().getContent();
  t.ok('alt: Web-App ohne Zugriff auf die neue Tabelle sagt das', /lässt sich von hier nicht öffnen/.test(noAccess) && /Zur neuen Tabelle/.test(noAccess));
  old.sources[neu.ss.id] = neu.ss;
  t.ok('alt: Web-App ohne neue Handy-Seite erklärt das Bereitstellen', /noch keine Handy-Seite/.test(old.ctx.doGet().getContent()));
  neu.ctx.settingSet_('WEBAPP_URL', 'https://script.google.com/macros/s/NEU/exec');
  old.run('settingsCache_ = null');
  const page = old.ctx.doGet().getContent();
  t.ok('alt: Web-App verlinkt die neue Handy-Seite', page.indexOf('https://script.google.com/macros/s/NEU/exec') >= 0 && /Zur neuen Handy-Seite/.test(page));
  // wieder benutzen
  old.alertAnswer = 'YES';
  old.ctx.wiederBenutzen();
  t.ok('alt: wieder benutzen', old.ctx.takenOverBy_() === '' && old.ss.getName() === 'Meine Karten' && !old.ss.getSheetByName('Übernommen') && old.setting('NEW_COPY_URL') === '');
  t.ok('Sperren frei', old.lock.depth === 0 && neu.lock.depth === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
t.section('Neue Version holen: Fehlerfälle');
{
  const W = makeWorld();
  W.release('1.0.0');
  const env = setupEnv(W);
  t.eq('keine neuere Version: none', env.uiCall('updateCopy').state, 'none');
  W.release('1.1.0');
  W.templateUrl = '';
  let r = env.uiCall('updateCopy');
  t.ok('ohne Vorlage: notemplate mit Anleitung', r.state === 'notemplate' && r.guideUrl === W.guideUrl && /noch keine Vorlage/.test(r.message) && env.backups.length === 0, r);
  W.templateUrl = TEMPLATE_URL;
  r = env.uiCall('updateCopy');
  t.ok('Vorlage nicht erreichbar: Fehler mit Link zum Selbstkopieren', r.state === 'error' && r.templateUrl === TEMPLATE_URL && /nicht öffnen/.test(r.message) && env.backups.length === 0, r);
  W.channelCode = 500;
  t.ok('GitHub nicht erreichbar', /GitHub/.test(env.uiCall('updateCopy').message));
  W.channelCode = 200;
  // Vorabversion mit eigener Vorlage
  const { dir } = addTemplate(env, W, '1.2.0-beta.1', BETA_ID);
  W.release('1.2.0-beta.1', { prerelease: true, templateUrl: 'https://docs.google.com/spreadsheets/d/' + BETA_ID + '/copy' });
  env.ctx.settingSet_('PRERELEASES', '1');
  r = env.uiCall('updateCopy');
  t.ok('Vorabversion: kopiert ihre eigene Vorlage', r.state === 'copied' && r.version === '1.2.0-beta.1' && settingOf(env.sources[env.backups[0].id], 'CODE_VERSION') === '1.2.0-beta.1', r);
  t.ok('Sperre frei, Daten unverändert', env.lock.depth === 0 && env.data().length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
t.section('Neue Version holen: Kopieren scheitert, Vorabversion ohne Vorlage');
{
  const W = makeWorld();
  W.release('1.0.0'); W.release('1.1.0');
  const env = setupEnv(W);
  const { dir } = addTemplate(env, W, '1.1.0');
  env.makeCopyFails = 2;
  let r = env.uiCall('updateCopy');
  t.ok('Kopieren geht nicht: Fehler mit Weg von Hand, kein Merker', r.state === 'error' && r.templateUrl === TEMPLATE_URL && /ließ sich nicht anlegen/.test(r.message) &&
    /selbst kopieren/.test(r.message) && env.backups.length === 0 && !env.setting('NEW_COPY_URL'), r);
  env.makeCopyFails = 1;
  r = env.uiCall('updateCopy');
  t.ok('Ordner nicht beschreibbar: Kopie in Meine Ablage', r.state === 'copied' && /in „Meine Ablage“/.test(r.message) && env.backups.length === 1 && env.backups[0].folder === 'ROOT', r);
  // die neue Tabelle lässt sich nicht beschreiben: Kopie in den Papierkorb, Fehler
  env.run('var __ws = writeSettings_; writeSettings_ = function (ss, o) { if (/^BACKUP/.test(ss.getId())) throw new Error("kaputt"); return __ws(ss, o); }');
  env.ctx.settingsSetMany_({ NEW_COPY_URL: '', NEW_COPY_VERSION: '' });
  r = env.uiCall('updateCopy');
  const last = env.backups[env.backups.length - 1];
  t.ok('neue Tabelle unfertig: Papierkorb, Fehler, kein Merker', r.state === 'error' && /nicht fertig anlegen/.test(r.message) && env.driveFiles[last.id].trashed === true &&
    !env.setting('NEW_COPY_URL'), r);
  env.run('writeSettings_ = __ws');
  // Vorabversion ohne eigene Vorlage: die neueste fertige Version mit Vorlage
  W.release('1.2.0-beta.1', { prerelease: true });
  env.ctx.settingSet_('PRERELEASES', '1');
  r = env.uiCall('updateCopy');
  t.ok('Vorabversion ohne Vorlage: holt 1.1.0', r.state === 'copied' && r.version === '1.1.0', r);
  t.eq('Info: angelegte Kopie zählt für 1.1.0', env.uiCall('getUpdateInfo', false).newCopy, { url: r.url, version: '1.1.0' });
  const nCopies = env.backups.length;
  const again = env.uiCall('updateCopy');
  t.ok('noch einmal holen: dieselbe Tabelle, keine neue', again.existing === true && again.url === r.url && env.backups.length === nCopies, again);
  env.driveFiles[updSheetIdOf(r.url)].trashed = true;
  const fresh = env.uiCall('updateCopy');
  t.ok('erste Kopie im Papierkorb: eine neue', fresh.state === 'copied' && !fresh.existing && fresh.url !== r.url && env.backups.length === nCopies + 1, fresh);
  W.templateUrl = '';
  r = env.uiCall('updateCopy');
  t.ok('gar keine Vorlage: notemplate für die neueste Version', r.state === 'notemplate' && r.version === '1.2.0-beta.1', r);
  t.ok('Sperre frei', env.lock.depth === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
t.section('Von Hand aktualisiert: neuer Code richtet die Blätter ein');
{
  const W = makeWorld();
  W.release('1.0.0'); W.release('1.1.0');
  const dir = srcDirFor('1.1.0');
  const env0 = setupEnv(W);
  env0.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  env0.sheet('Sammlung').getRange('B4').setValue('Glurak');
  const env = openWith(env0.ss, dir, W);
  Object.assign(env.props, env0.props);
  env.triggers = env0.triggers.slice();
  t.eq('vorher: CODE_VERSION 1.0.0', env.setting('CODE_VERSION'), '1.0.0');
  env.ctx.kartenErfassen('upd');
  t.ok('Seitenleiste: upgradeIfNeeded_ lief, Suchfeld bleibt, keine Neueinrichtung', env.setting('CODE_VERSION') === '1.1.0' && env.sheet('Sammlung').getRange('B4').getValue() === 'Glurak' &&
    env.templates[env.templates.length - 1].start === 'upd' && env.setting('SETUP_AT') === env0.setting('SETUP_AT'));
  const writes = env.writes;
  env.ctx.kartenErfassen();
  t.ok('zweites Öffnen: kein Umbau', env.writes === writes);
  const info = env.uiCall('getUpdateInfo', true);
  t.ok('Info: neueste Version', info.installed === '1.1.0' && info.available === '' && !info.outdated, info);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
t.section('Übernahme aus einer alten Tabelle (Version 1.0)');
{
  const W = makeWorld();
  W.release('1.0.0');
  // alte Tabelle: eigene Umgebung mit dem gleichen Code, andere ID
  const oldEnv = baseEnv();
  oldEnv.ss.id = OLD_ID;
  oldEnv.ctx.einrichtung();
  oldEnv.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  oldEnv.uiCall('addCard', { id: 'base1-4', lang: 'de', variant: 'base', condition: 'LP', qty: 1 });
  const ob = oldEnv.ss;
  ob.getSheetByName('Daten').insertColumnsAfter(30, 1);
  ob.getSheetByName('Daten').getRange(1, 31).setValue('Ordner');
  ob.getSheetByName('Daten').getRange(2, 31, 2, 1).setValues([['A'], ['B']]);
  oldEnv.ctx.setViewExtras(['Ordner']);
  oldEnv.ctx.settingSet_('PRERELEASES', '1');
  oldEnv.ctx.settingSet_('WEBAPP_URL', 'https://script.google.com/macros/s/ALT/exec');
  ob.getSheetByName('Sammlung').getRange('B4').setValue('Glurak');
  ob.getSheetByName('Sammlung').getRange('H4').setValue(true);
  ob.getSheetByName('Verlauf').getRange(2, 1, 1, 5).setValues([[new Date(2026, 9, 1), 12.5, 3, 0, 0]]);
  ob.getSheetByName('Seltenheiten').getRange(2, 2).setValue(99);
  const notes = ob.insertSheet('Notizen');
  notes.getRange('A1:B2').setValues([['Wunsch', 'Preis'], ['Glurak', 5]]);
  notes.getRange('C2').setFormula('=B2*2');
  ob.insertSheet('Leer');

  const env = setupEnv(W);
  env.sources[OLD_ID] = ob;
  const url = 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit#gid=0';
  const p = env.uiCall('takeoverPreview', url);
  t.ok('Vorschau: Karten, Exemplare, Version, eigene Blätter', p.cards === 2 && p.copies === 3 && p.version === '1.0.0' && J(p.own) === J(['Notizen']) &&
    p.sheets.some(s => s.name === 'Verlauf' && s.rows === 1), p);
  t.ok('Vorschau ändert nichts', env.data().length === 0 && !settingOf(ob, 'TAKEN_OVER_BY'));
  const r = env.uiCall('takeoverRun', url);
  t.ok('Übernahme: Meldung', r.cards === 2 && /2 Einträge/.test(r.message) && J(r.own) === J(['Notizen']), r);
  t.ok('ab 1.0: legt sich selbst still', r.manualStop === false && /jetzt stillgelegt/.test(r.message) && r.noteSheet === 'Übernommen' &&
    settingOf(ob, 'TAKEN_OVER_SHEET') === 'Übernommen');
  t.ok('neue Tabelle: CODE_VERSION und SETUP_AT', env.setting('CODE_VERSION') === env.run('TOOL_VERSION') && !!env.setting('SETUP_AT'));
  const d = env.data();
  t.ok('Daten 1:1 (Schlüssel, Eintrag-ID, Anzahl, Nummer als Text)', d.length === 2 && J(d.map(x => x.key)) === J(oldEnv.data().map(x => x.key)) &&
    J(d.map(x => x.eid)) === J(oldEnv.data().map(x => x.eid)) && d[0].count === 2 && d[0].localId === '025', d.map(x => [x.key, x.localId]));
  t.ok('Zusatzspalte und Ansicht', J(d.map(x => x.extras.Ordner)) === J(['A', 'B']) && env.setting('VIEW_EXTRAS') === '["Ordner"]' &&
    env.values('Sammlung')[4].indexOf('Ordner') >= 0);
  t.ok('Gruppen neu gebaut', env.groups().length === 2);
  t.ok('Verlauf, Seltenheiten übernommen', env.values('Verlauf').length === 2 && env.values('Verlauf')[1][1] === 12.5 && env.values('Seltenheiten')[1][1] === 99);
  t.ok('eigenes Blatt mit Formel kopiert, leeres nicht', env.sheet('Notizen') && env.sheet('Notizen').getRange('C2').getFormula() === '=B2*2' && !env.sheet('Leer'));
  t.ok('Suchfelder der Sammlung', env.sheet('Sammlung').getRange('B4').getValue() === 'Glurak' && env.sheet('Sammlung').getRange('H4').getValue() === true);
  t.ok('Einstellungen: PRERELEASES ja, WEBAPP_URL nein, TAKEN_FROM', env.setting('PRERELEASES') === '1' && !env.setting('WEBAPP_URL') &&
    env.setting('TAKEN_FROM') === ob.getUrl() && /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(env.setting('TAKEN_AT')));
  t.ok('alte Tabelle: TAKEN_OVER_BY und erstes Blatt „Übernommen“', settingOf(ob, 'TAKEN_OVER_BY') === env.ss.getUrl() && ob.getSheets()[0].getName() === 'Übernommen' &&
    ob.getSheetByName('Übernommen').getRange('A4').getValue() === env.ss.getUrl());
  const notice = J(oldEnv.values('Übernommen'));
  t.ok('alte Tabelle ab 1.0: erst Wieder-benutzen, Trigger nur für den Fall einer älteren Version', notice.indexOf('wieder benutzen') >= 0 &&
    notice.indexOf('ältere Version') > notice.indexOf('wieder benutzen') && notice.indexOf('Trigger') > notice.indexOf('ältere Version'));
  oldEnv.ctx.onOpen();
  t.ok('alte Tabelle: eigener Code erkennt das Stilllegen', oldEnv.ctx.takenOverBy_() === env.ss.getUrl());
  t.ok('Sperre frei', env.lock.depth === 0 && env.lock.nested === 0);
  // zweites Mal: Tabelle hat jetzt Karten
  t.throws('nicht in eine Tabelle mit Karten', () => env.uiCall('takeoverPreview', url), /schon Karten/);
}

// ---------------------------------------------------------------------------
t.section('Übernahme aus einer Tabelle vor 1.0 (Version 1, ohne Einstellungen)');
{
  const backupDir = path.join(__dirname, '..', 'backup');
  const old = H.createEnv({ srcDir: backupDir, files: ['Code.gs'] });
  old.ss.id = OLD_ID;
  old.ctx.einrichtung();
  old.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  old.ctx.addCard({ id: 'base1-4', lang: 'de', variant: 'base', condition: 'LP', qty: 1 });
  old.sheet('Sammlung').getRange('B4').setValue('Glurak');
  t.ok('alte Tabelle hat 23 Spalten, kein Einstellungsblatt', old.values('Daten')[0].length === 23 && !old.sheet('Tool-Einstellungen'));
  const W = makeWorld();
  const env = setupEnv(W);
  env.sources[OLD_ID] = old.ss;
  const p = env.uiCall('takeoverPreview', OLD_ID);
  t.ok('Vorschau: Version leer, 2 Karten', p.version === '' && p.cards === 2 && p.copies === 3, p);
  const r = env.uiCall('takeoverRun', OLD_ID);
  t.ok('vor 1.0: manualStop, Meldung nennt Trigger und Hinweisblatt', r.manualStop === true && /legt sich nicht selbst still/.test(r.message) &&
    /Trigger/.test(r.message) && /„Übernommen“/.test(r.message), r);
  const d = env.data();
  t.ok('umgestellt auf Version 2', env.values('Daten')[0][23] === 'Eintrag-ID' && d.length === 2 && d.every(x => /^E[0-9a-f]{10}$/.test(x.eid) && x.origin === 'Hand') &&
    J(d.map(x => x.key)) === J(['swsh3-025|normal||NM|DE', 'base1-4|holo||LP|DE']), d.map(x => x.key));
  t.ok('Suchfeld übernommen', env.sheet('Sammlung').getRange('B4').getValue() === 'Glurak');
  t.ok('alte Tabelle: Anleitung zum Löschen der Trigger', /Trigger/.test(J(old.values('Übernommen'))) && settingOf(old.ss, 'TAKEN_OVER_BY') === env.ss.getUrl());
  t.ok('alte Tabelle: Anleitung zum Archivieren der Web-App', /Archivieren/.test(J(old.values('Übernommen'))) && /Web-App-Link anzeigen/.test(J(old.values('Übernommen'))));
}

// ---------------------------------------------------------------------------
t.section('Übernahme: Fehler');
{
  const W = makeWorld();
  const env = setupEnv(W);
  t.throws('kein Link', () => env.uiCall('takeoverPreview', 'hallo'), /Link der alten Tabelle/);
  t.throws('eigener Link', () => env.uiCall('takeoverPreview', 'https://docs.google.com/spreadsheets/d/SSIDSSIDSSIDSSIDSSIDSSID/edit'), /nicht öffnen/);
  env.ss.id = 'SSIDSSIDSSIDSSIDSSIDSSID';
  t.throws('Link dieser Tabelle', () => env.uiCall('takeoverPreview', 'https://docs.google.com/spreadsheets/d/SSIDSSIDSSIDSSIDSSIDSSID/edit'), /dieser Tabelle/);
  env.ss.id = 'SSID';
  env.addSource({ id: OLD_ID, name: 'Irgendwas', tabs: { Blatt1: [['a']] } });
  t.throws('ohne Blatt Daten', () => env.uiCall('takeoverPreview', OLD_ID), /kein Blatt „Daten“/);
  const W2 = makeWorld();
  const env2 = setupEnv(W2);
  env2.addSource({ id: OLD_ID, name: 'Alt', tabs: { Daten: [['Schlüssel'], ['x']], Importe: [['Nr', 'Datum', 'Quelle', 'Quelle-ID', 'Tab', 'Vorlage', 'Modus', 'Status'], [3, '', '', '', '', '', '', 'läuft']] } });
  const p = env2.uiCall('takeoverPreview', OLD_ID);
  t.ok('Vorschau warnt vor unfertigem Import', p.warnings.some(w => /Import 3 ist nicht fertig/.test(w)), p.warnings);
}

// ---------------------------------------------------------------------------
t.section('Kopie wird vor der Seitenleiste eigen, Web-App auf alter Version, Datenformat-Schutz');
{
  const W = makeWorld();
  const env = setupEnv(W);
  const c = env.ctx;
  // Kopie der Vorlage, die schon vor dem ersten Öffnen der Seitenleiste etwas geschrieben hat
  const sh = env.sheet('Tool-Einstellungen');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  rows.forEach((r, i) => { if (r[0] === 'Tabellen-ID') sh.getRange(i + 2, 2).setValue('TEMPLATEID'); });
  env.run('settingsCache_ = null');
  c.settingSet_('PRERELEASES', '1');
  t.ok('eigen geworden, aber nie eingerichtet', c.isFreshCopy_() === false && c.needsSetup_() === true && !env.setting('SETUP_AT'));
  t.ok('Web-App bittet um die Seitenleiste', /Diese Tabelle ist neu/.test(c.doGet().getContent()));
  env.triggers = [];
  c.kartenErfassen();
  t.ok('Seitenleiste richtet ein (Auslöser, SETUP_AT)', env.triggers.length === 2 && !!env.setting('SETUP_AT') && c.needsSetup_() === false, env.triggers.map(x => x.fn));

  // Web-App läuft auf einer älteren Bereitstellung als der Code, der die Tabelle zuletzt eingerichtet hat
  c.settingSet_('CODE_VERSION', '9.0.0');
  const html = c.doGet().getContent();
  t.ok('doGet setzt CODE_VERSION nicht zurück, zeigt die Web-App', env.setting('CODE_VERSION') === '9.0.0' && !/Diese Tabelle ist neu/.test(html) && env.templates[env.templates.length - 1].mode === 'web', env.setting('CODE_VERSION'));
  W.release('1.1.0');
  const info = env.uiCall('getUpdateInfo', true);
  t.ok('getUpdateInfo: outdated mit codeVersion, ältere Versionen zählen nicht als neu', info.outdated === true && info.codeVersion === '9.0.0' &&
    info.installed === env.run('TOOL_VERSION') && info.available === '' && info.newer.length === 0, info);
  c.kartenErfassen();
  t.ok('Seitenleiste (neuester gespeicherter Code) übernimmt die Tabelle', env.setting('CODE_VERSION') === env.run('TOOL_VERSION') &&
    env.uiCall('getUpdateInfo', false).outdated === false);

  // Daten in einem neueren Format: nie nach unten umstellen
  c.settingSet_('SCHEMA_VERSION', '3');
  t.throws('neueres Datenformat: Fehler statt Umstellung', () => env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 }), /älterem Code/);
  t.ok('Daten unverändert', env.data().length === 0 && env.setting('SCHEMA_VERSION') === '3');
  c.settingSet_('SCHEMA_VERSION', '2');
  c.settingsSetMany_({ TAKEN_OVER_BY: 'https://docs.google.com/spreadsheets/d/NEU/edit', TAKEN_OVER_AT: '21.10.2026 10:00' });
  t.throws('stillgelegt: Schreiben scheitert mit Hinweis', () => env.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 }), /übernommen/);
}

// ---------------------------------------------------------------------------
t.section('Übernahme: eigenes Blatt „Übernommen“, neueres Datenformat');
{
  const W = makeWorld();
  const oldEnv = baseEnv();
  oldEnv.ss.id = OLD_ID;
  oldEnv.ctx.einrichtung();
  oldEnv.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  const ob = oldEnv.ss;
  ob.insertSheet('Übernommen').getRange('A1:B1').setValues([['Tausch mit Max', 'Glurak']]);
  const env = setupEnv(W);
  env.sources[OLD_ID] = ob;
  const p = env.uiCall('takeoverPreview', OLD_ID);
  t.ok('Vorschau: eigenes Blatt „Übernommen“ zählt als eigenes', J(p.own) === J(['Übernommen']), p.own);
  const r = env.uiCall('takeoverRun', OLD_ID);
  t.ok('neue Tabelle hat das eigene Blatt', env.sheet('Übernommen') && env.sheet('Übernommen').getRange('A1').getValue() === 'Tausch mit Max' && J(r.own) === J(['Übernommen']));
  t.ok('alte Tabelle: eigenes Blatt unverändert, Hinweis in „Übernommen (Hinweis)“', ob.getSheetByName('Übernommen').getRange('B1').getValue() === 'Glurak' &&
    ob.getSheets()[0].getName() === 'Übernommen (Hinweis)' && settingOf(ob, 'TAKEN_OVER_SHEET') === 'Übernommen (Hinweis)' && r.noteSheet === 'Übernommen (Hinweis)');
  // dieselbe alte Tabelle noch einmal (Warnung): das Hinweisblatt ist kein eigenes Blatt, das eigene bleibt eins
  const env2 = setupEnv(makeWorld());
  env2.sources[OLD_ID] = ob;
  const p2 = env2.uiCall('takeoverPreview', OLD_ID);
  t.ok('zweite Vorschau: Hinweisblatt nicht dabei, Warnung', J(p2.own) === J(['Übernommen']) && p2.warnings.some(w => /schon einmal übernommen/.test(w)), p2);

  // alte Tabelle mit neuerem Datenformat
  const newer = baseEnv();
  newer.ss.id = OLD_ID.replace('Old', 'New');
  newer.ctx.einrichtung();
  newer.ctx.settingsSetMany_({ SCHEMA_VERSION: '3', CODE_VERSION: '2.0.0' });
  const env3 = setupEnv(makeWorld());
  env3.sources[newer.ss.id] = newer.ss;
  t.throws('neueres Datenformat: Übernahme abgelehnt', () => env3.uiCall('takeoverPreview', newer.ss.id), /neueren Datenformat/);
}

// ---------------------------------------------------------------------------
t.section('Übernahme: eigene Blätter mit Namen des Tools');
{
  // Tabelle vor 1.0 (Version 1 kannte weder Seltenheiten noch Import-Blätter): gleichnamige Blätter mit fremder
  // Kopfzeile gehören dem Nutzer. (Generierte Blätter wie Pokédex erkennt das erst ab 1.0, über TOOL_SHEETS.)
  const backupDir = path.join(__dirname, '..', 'backup');
  const old = H.createEnv({ srcDir: backupDir, files: ['Code.gs'] });
  old.ss.id = OLD_ID;
  old.ctx.einrichtung();
  old.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  old.ss.insertSheet('Import-Sets').getRange('A1:B2').setValues([['Set', 'Gefangen'], ['Basis', 'ja']]);
  old.ss.insertSheet('Seltenheiten').getRange('A1:B2').setValues([['Mein Ziel', 'Budget'], ['Glurak', 300]]);
  const env = setupEnv(makeWorld());
  env.sources[OLD_ID] = old.ss;
  const p = env.uiCall('takeoverPreview', OLD_ID);
  t.ok('vor 1.0: Vorschau zählt sie als eigene Blätter', J(p.own.slice().sort()) === J(['Import-Sets', 'Seltenheiten']) &&
    !p.sheets.some(s => s.name === 'Seltenheiten' || s.name === 'Import-Sets'), p);
  env.uiCall('takeoverRun', OLD_ID);
  t.ok('vor 1.0: als „(alt)“ kopiert, Seltenheiten des Tools unberührt', env.sheet('Import-Sets (alt)').getRange('B2').getValue() === 'ja' &&
    env.sheet('Seltenheiten (alt)').getRange('A2').getValue() === 'Glurak' && env.values('Seltenheiten').length > 2 &&
    !env.values('Seltenheiten').some(r => r[0] === 'Glurak'), env.values('Seltenheiten').slice(0, 3));
  t.ok('neue Tabelle: Liste ihrer Blätter gespeichert', JSON.parse(env.setting('TOOL_SHEETS')).indexOf('Pokédex') >= 0);

  // ab 1.0: die Liste der alten Tabelle zählt (ein Blatt, das erst eine spätere Version anlegt)
  const o2 = baseEnv();
  o2.ss.id = OLD_ID;
  o2.ctx.einrichtung();
  o2.ctx.settingSet_('TOOL_SHEETS', J(JSON.parse(o2.setting('TOOL_SHEETS')).filter(n => n !== 'Seltenheiten')));
  o2.sheet('Seltenheiten').clear();
  o2.sheet('Seltenheiten').getRange('A1:B2').setValues([['Wunsch', 'Preis'], ['Mew', 50]]);
  const env2 = setupEnv(makeWorld());
  env2.sources[OLD_ID] = o2.ss;
  const p2 = env2.uiCall('takeoverPreview', OLD_ID);
  t.ok('ab 1.0: TOOL_SHEETS der alten Tabelle entscheidet', J(p2.own) === J(['Seltenheiten']), p2.own);
  env2.uiCall('takeoverRun', OLD_ID);
  t.ok('ab 1.0: eigenes Blatt als „(alt)“, Tool-Blatt bleibt', env2.sheet('Seltenheiten (alt)').getRange('A2').getValue() === 'Mew' && !env2.values('Seltenheiten').some(r => r[0] === 'Mew'));
}

// ---------------------------------------------------------------------------
t.section('Übernahme: eigenes Blatt „Dashboard“ aus Versionen vor 1.1.0');
{
  const dashOk = env => env.sheet('Dashboard').getRange('C2').getValue() === 'Pokémon-Sammlung' && env.sheet('Dashboard').getImages().length === 12;
  // vor 1.0 (ohne TOOL_SHEETS)
  const old = H.createEnv({ srcDir: path.join(__dirname, '..', 'backup'), files: ['Code.gs'] });
  old.ss.id = OLD_ID;
  old.ctx.einrichtung();
  old.ctx.addCard({ id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 1 });
  old.ss.insertSheet('Dashboard').getRange('A1:B2').setValues([['Ziel', 'Budget'], ['Glurak', 300]]);
  const env = setupEnv(makeWorld());
  env.sources[OLD_ID] = old.ss;
  t.ok('vor 1.0: eigenes Dashboard zählt als eigenes Blatt', env.uiCall('takeoverPreview', OLD_ID).own.indexOf('Dashboard') >= 0);
  env.uiCall('takeoverRun', OLD_ID);
  t.ok('vor 1.0: als „Dashboard (alt)“ kopiert, Dashboard des Tools mit Knöpfen', env.sheet('Dashboard (alt)').getRange('B2').getValue() === 300 && dashOk(env));
  // 1.0.x: TOOL_SHEETS ohne Dashboard
  const o2 = baseEnv();
  o2.ss.id = OLD_ID;
  o2.ctx.einrichtung();
  o2.ss.deleteSheet(o2.sheet('Dashboard'));
  o2.ctx.settingSet_('TOOL_SHEETS', J(JSON.parse(o2.setting('TOOL_SHEETS')).filter(n => n !== 'Dashboard')));
  o2.ss.insertSheet('Dashboard').getRange('A1').setValue('Meine Übersicht');
  const env2 = setupEnv(makeWorld());
  env2.sources[OLD_ID] = o2.ss;
  t.ok('1.0.x: eigenes Dashboard zählt als eigenes Blatt', J(env2.uiCall('takeoverPreview', OLD_ID).own) === J(['Dashboard']));
  env2.uiCall('takeoverRun', OLD_ID);
  t.ok('1.0.x: als „Dashboard (alt)“ kopiert', env2.sheet('Dashboard (alt)').getRange('A1').getValue() === 'Meine Übersicht' && dashOk(env2));
  // ab 1.1.0: das Dashboard gehört dem Tool und wird neu aufgebaut, nicht kopiert
  const o3 = baseEnv();
  o3.ss.id = OLD_ID;
  o3.ctx.einrichtung();
  const env3 = setupEnv(makeWorld());
  env3.sources[OLD_ID] = o3.ss;
  t.ok('ab 1.1.0: Dashboard nicht unter den eigenen Blättern', J(env3.uiCall('takeoverPreview', OLD_ID).own) === J([]));
  env3.uiCall('takeoverRun', OLD_ID);
  t.ok('ab 1.1.0: kein „Dashboard (alt)“', !env3.sheet('Dashboard (alt)') && dashOk(env3));
}

// ---------------------------------------------------------------------------
t.section('Übernahme: abgebrochen, wiederholt, doppelt, ohne Schreibrecht');
{
  const oldEnv = baseEnv();
  oldEnv.ss.id = OLD_ID;
  oldEnv.ctx.einrichtung();
  oldEnv.uiCall('addCard', { id: 'swsh3-025', lang: 'de', variant: 'base', condition: 'NM', qty: 2 });
  const ob = oldEnv.ss;
  ob.insertSheet('Notizen').getRange('A1').setValue('Wunschliste');
  const W = makeWorld();
  const env = setupEnv(W);
  env.sources[OLD_ID] = ob;
  env.ctx.settingSet_('TAKE_FROM', ob.getUrl());
  // ohne Schreibrecht auf die alte Tabelle: gar nicht erst anfangen
  env.run('var __ws = writeSettings_; writeSettings_ = function (ss, o) { if (ss.getId() === "' + OLD_ID + '") throw new Error("Keine Berechtigung"); return __ws(ss, o); }');
  t.throws('alte Tabelle nur zum Ansehen: verständlicher Fehler', () => env.uiCall('takeoverRun', OLD_ID), /nicht bearbeiten/);
  t.ok('ohne Schreibrecht: nichts übernommen, kein Lauf', env.data().length === 0 && !env.setting('TAKE_RUN'));
  env.run('writeSettings_ = __ws');
  // Abbruch nach dem Kopieren (z. B. Zeitlimit beim Neuaufbau)
  env.run('var __st = setupTriggers_; setupTriggers_ = function () { throw new Error("Zeit abgelaufen"); }');
  t.throws('Abbruch: Meldung mit dem Weg zum Wiederholen', () => env.uiCall('takeoverRun', OLD_ID), /nicht fertig geworden \(Zeit abgelaufen\)/);
  env.run('setupTriggers_ = __st');
  const run = JSON.parse(env.setting('TAKE_RUN'));
  t.ok('Abbruch: Lauf als abgebrochen vermerkt, Karten da, alte Tabelle nicht stillgelegt', run.failed === true && run.from === OLD_ID && J(run.own) === J(['Notizen']) &&
    env.data().length === 1 && !settingOf(ob, 'TAKEN_OVER_BY') && !env.setting('TAKEN_FROM'));
  t.eq('Abbruch: Übernahme bleibt ausstehend', env.uiCall('getUpdateInfo', false).pendingTake, ob.getUrl());
  env.ctx.kartenErfassen();
  t.eq('Abbruch: Seitenleiste startet wieder mit der Übernahme', env.templates[env.templates.length - 1].start, 'takeover');
  const p = env.uiCall('takeoverPreview', OLD_ID);
  t.ok('Abbruch: Vorschau geht trotz Karten, mit Hinweis auf Verlust neuer Einträge', p.resume === true && /nicht fertig geworden/.test(p.warnings[0]) &&
    /seitdem in dieser Tabelle eingetragen/.test(p.warnings[0]), p.warnings);
  // Hinweisblatt lässt sich nicht anlegen: alte Tabelle bleibt aktiv
  const insertOrig = ob.insertSheet;
  ob.insertSheet = function () { throw new Error('zu viele Zellen'); };
  t.throws('Hinweisblatt scheitert: Übernahme nicht fertig', () => env.uiCall('takeoverRun', OLD_ID), /nicht fertig geworden \(zu viele Zellen\)/);
  ob.insertSheet = insertOrig;
  oldEnv.run('settingsCache_ = null');
  t.ok('Hinweisblatt scheitert: alte Tabelle nicht stillgelegt, neue nicht fertig', oldEnv.ctx.takenOverBy_() === '' && !settingOf(ob, 'TAKEN_OVER_BY') && !env.setting('TAKEN_FROM') &&
    JSON.parse(env.setting('TAKE_RUN')).failed === true);
  const r = env.uiCall('takeoverRun', OLD_ID);
  t.ok('Wiederholung: fertig, eigenes Blatt nur einmal, Lauf gelöscht', r.cards === 1 && env.sheet('Notizen') && !env.sheet('Notizen (alt)') && env.data().length === 1 &&
    env.setting('TAKE_RUN') === '' && env.setting('TAKEN_FROM') === ob.getUrl() && !!settingOf(ob, 'TAKEN_OVER_BY'), r);
  t.throws('danach: keine zweite Übernahme', () => env.uiCall('takeoverPreview', OLD_ID), /schon Karten/);

  // zweiter Lauf, während der erste noch läuft
  const env2 = setupEnv(makeWorld());
  const o2 = baseEnv();
  o2.ss.id = OLD_ID.replace('Old', 'Two');
  o2.ctx.einrichtung();
  env2.sources[o2.ss.id] = o2.ss;
  env2.ctx.settingSet_('TAKE_RUN', J({ from: o2.ss.id, url: o2.ss.getUrl(), at: Date.now(), own: [] }));
  t.throws('läuft gerade: Vorschau sagt warten', () => env2.uiCall('takeoverPreview', o2.ss.id), /läuft gerade/);
  t.throws('läuft gerade: kein zweiter Lauf', () => env2.uiCall('takeoverRun', o2.ss.id), /läuft gerade/);
  env2.ctx.settingSet_('TAKE_RUN', J({ from: o2.ss.id, url: o2.ss.getUrl(), at: Date.now() - 8 * 60 * 1000, own: [] }));
  t.ok('nach 8 Minuten gilt er als abgebrochen', env2.uiCall('takeoverPreview', o2.ss.id).resume === true);
  // Freigaben nicht lesbar: Hinweis zum Teilen
  env2.run('var __dr = Drive; Drive = undefined;');
  const r2 = env2.uiCall('takeoverRun', o2.ss.id);
  t.ok('Freigaben nicht lesbar: Hinweis zum Teilen', r2.shared.failed === -1 && /teile diese Tabelle bitte auch/.test(r2.message), r2);
  env2.run('Drive = __dr');
  t.ok('Sperren frei', env.lock.depth === 0 && env2.lock.depth === 0);
}

// ---------------------------------------------------------------------------
t.section('Älterer Code als die Daten, Kopie einer Tabelle vor 1.0');
{
  const W = makeWorld();
  const env = setupEnv(W);
  env.ctx.settingSet_('SCHEMA_VERSION', '3');
  env.ui.alerts.length = 0;
  env.ctx.einrichtung();
  t.ok('Einrichtung mit älterem Code: nichts umgebaut, Hinweis', env.setting('SCHEMA_VERSION') === '3' && /neueren Version/.test(env.ui.alerts.join(' ')), env.ui.alerts);
  // frische Kopie mit neuerem Datenformat: keine Seitenleiste
  const sh = env.sheet('Tool-Einstellungen');
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach((r, i) => { if (r[0] === 'Tabellen-ID') sh.getRange(i + 2, 2).setValue('TEMPLATEID'); });
  env.run('settingsCache_ = null');
  const n = env.ui.sidebars.length;
  env.ctx.kartenErfassen();
  t.ok('frische Kopie mit neuerem Format: keine Seitenleiste', env.ui.sidebars.length === n && env.setting('SCHEMA_VERSION') === '3');

  // „Kopie erstellen“ einer Tabelle vor 1.0: Skript-Eigenschaften der anderen Tabelle, keine Auslöser
  const c = setupEnv(W);
  c.ss.deleteSheet(c.sheet('Tool-Einstellungen'));
  Object.assign(c.props, { SCHEMA_VERSION: '2', SPREADSHEET_ID: 'ORIGINALORIGINALORIGINAL', WEBAPP_URL: 'https://script.google.com/macros/s/ALT/exec' });
  c.triggers = [];
  c.run('settingsCache_ = null');
  c.ctx.kartenErfassen();
  t.ok('Kopie vor 1.0: wird eingerichtet (Auslöser, eigene ID), alter Web-App-Link gilt nicht', c.triggers.length === 2 && c.props.SPREADSHEET_ID === c.ss.getId() &&
    c.ctx.settingGet_('WEBAPP_URL') === '' && c.setting('SETUP_AT') !== 'vor 1.0', [c.triggers.length, c.props.SPREADSHEET_ID, c.setting('SETUP_AT')]);
  // dasselbe über Pokémon > Einrichtung statt Karten erfassen
  const c2 = setupEnv(W);
  c2.ss.deleteSheet(c2.sheet('Tool-Einstellungen'));
  Object.assign(c2.props, { SCHEMA_VERSION: '2', SPREADSHEET_ID: 'ORIGINALORIGINALORIGINAL', WEBAPP_URL: 'https://script.google.com/macros/s/ALT/exec' });
  c2.run('settingsCache_ = null');
  c2.ctx.einrichtung();
  t.ok('Kopie vor 1.0 über Einrichtung: alter Web-App-Link gilt nicht', c2.ctx.settingGet_('WEBAPP_URL') === '' && c2.props.SPREADSHEET_ID === c2.ss.getId() && c2.triggers.length === 2);
  // eigene Tabelle vor 1.0 (SPREADSHEET_ID passt): gilt als eingerichtet
  const own = setupEnv(W);
  own.ss.deleteSheet(own.sheet('Tool-Einstellungen'));
  Object.assign(own.props, { SCHEMA_VERSION: '2', SPREADSHEET_ID: own.ss.getId(), WEBAPP_URL: 'https://script.google.com/macros/s/MEINS/exec' });
  own.run('settingsCache_ = null');
  own.ctx.kartenErfassen();
  t.ok('eigene Tabelle vor 1.0: SETUP_AT vor 1.0, Web-App-Link bleibt', own.setting('SETUP_AT') === 'vor 1.0' && own.setting('WEBAPP_URL') === 'https://script.google.com/macros/s/MEINS/exec');
}

// ---------------------------------------------------------------------------
t.section('Release-Werkzeug und Kanal im Repo');
{
  const R = require('../tools/release.js');
  const env = H.createEnv();
  const vs = ['1.0.0', '1.0.1', '1.1.0-beta.1', '1.1.0-beta.10', '1.1.0-beta.2', '1.1.0', '0.9.0', '2.0.0-rc.1'];
  const a = vs.slice().sort((x, y) => R.cmp(y, x));
  const b = vs.slice().sort((x, y) => env.ctx.updCompare_(y, x));
  t.eq('tools/release.js sortiert wie updCompare_', a, b);
  t.ok('Dateiliste existiert', R.FILES.every(f => fs.existsSync(path.join(SRC, '..', f))));
  const c = R.check();
  t.ok('releases/channel.json passt zur Version in src/Code.gs (sonst: node tools/release.js)', !c.missing && c.diffs.length === 0, c);
  const ch = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'releases', 'channel.json'), 'utf8'));
  const clean = env.ctx.updCleanChannel_(ch);
  t.ok('Kanal: alle Einträge gültig, Repo, Anleitung', clean.releases.length === ch.releases.length && clean.repo === REPO && /#von-hand-aktualisieren$/.test(clean.guideUrl));
  // erneuter Lauf für dieselbe Version: Notizen, Datum, Vorabversion und Vorlage bleiben
  const entry = R.buildEntry({});
  const tplUrl = 'https://docs.google.com/spreadsheets/d/' + BETA_ID + '/copy';
  const chan = { repo: REPO, releases: [Object.assign({}, entry, { notes: ['alt'], date: '2026-01-02', prerelease: true, templateUrl: tplUrl })] };
  const n1 = R.nextChannel(chan, R.buildEntry({}), { notes: [] });
  t.ok('nextChannel: Notizen, Datum, Vorabversion, Vorlage bleiben', n1.entry.notes[0] === 'alt' && n1.entry.date === '2026-01-02' &&
    n1.entry.prerelease === true && n1.entry.templateUrl === tplUrl && chan.releases.length === 1, n1.entry);
  const n2 = R.nextChannel(chan, R.buildEntry({ prerelease: false, notes: ['neu'] }), { notes: ['neu'], prerelease: false });
  t.ok('nextChannel: --final und neue Notizen', n2.entry.prerelease === false && J(n2.entry.notes) === J(['neu']));
  t.throws('nextChannel: neue Version ohne Notizen', () => R.nextChannel({ releases: [] }, Object.assign(R.buildEntry({}), { version: '9.9.9' }), { notes: [] }), /--notes/);
  t.throws('--template nur mit Tabellen-Link', () => R.parseArgs(['--template', 'https://example.org/x']), /Google-Tabelle/);
  t.eq('--template', R.parseArgs(['--template', tplUrl, '--notes', 'x']).template, tplUrl);
  const readme = fs.readFileSync(path.join(SRC, '..', 'README.md'), 'utf8');
  t.ok('README hat den Abschnitt „Von Hand aktualisieren“', /^## Von Hand aktualisieren$/m.test(readme));

  // check() mit erfundenem Kanal: jede Abweichung wird gemeldet
  const code = read('src/Code.gs');
  const v = entry.version;
  const base = () => ({ repo: REPO, templateUrl: TEMPLATE_URL, releases: [Object.assign({}, entry, { notes: ['x'], prerelease: false })] });
  const diffOf = mut => { const ch = base(); mut(ch, ch.releases[0]); return R.check(code, ch); };
  t.ok('check: passt', (r => !r.missing && !r.diffs.length && !r.warnings.length)(R.check(code, base())));
  t.ok('check: Version fehlt', R.check(withVersion(code, '9.9.9'), base()).missing === true);
  t.ok('check: falscher Tag', diffOf((c, r) => { r.tag = 'v0.0.1'; }).diffs.some(d => /^tag /.test(d)));
  t.ok('check: falsches Datenformat', diffOf((c, r) => { r.schema = '99'; }).diffs.some(d => /^schema /.test(d)));
  t.ok('check: leere Notizen', diffOf((c, r) => { r.notes = ['', '  ']; }).diffs.indexOf('keine Notizen') >= 0);
  t.ok('check: Vorlage des Releases kein Tabellen-Link', diffOf((c, r) => { r.templateUrl = 'https://example.org/x'; }).diffs.some(d => /templateUrl ist kein/.test(d)));
  t.ok('check: Vorlage des Kanals kein Tabellen-Link', diffOf(c => { c.templateUrl = 'docs.google.com/spreadsheets/d/x'; }).diffs.some(d => /des Kanals/.test(d)));
  t.ok('check: alte Felder', diffOf((c, r) => { r.files = {}; }).diffs.some(d => /files\/scopes/.test(d)));
  const noTpl = diffOf(c => { c.templateUrl = ''; });
  t.ok('check: ohne Vorlage nur ein Hinweis', !noTpl.diffs.length && /--main-template/.test(noTpl.warnings[0]), noTpl);
  const preNoTpl = diffOf((c, r) => { r.prerelease = true; });
  t.ok('check: Vorabversion ohne eigene Vorlage: Hinweis (die Hauptvorlage zählt nicht)', !preNoTpl.diffs.length && /--template/.test(preNoTpl.warnings[0]), preNoTpl);
  // Optionen
  t.ok('parseArgs: --prerelease, --final, --date, --main-template', R.parseArgs(['--prerelease']).prerelease === true && R.parseArgs(['--final']).prerelease === false &&
    R.parseArgs(['--date', '2026-10-22']).date === '2026-10-22' && R.parseArgs(['--main-template', TEMPLATE_URL]).mainTemplate === TEMPLATE_URL);
  t.throws('parseArgs: falsches Datum', () => R.parseArgs(['--date', '22.10.2026']), /JJJJ-MM-TT/);
  t.throws('parseArgs: unbekannte Option', () => R.parseArgs(['--hallo']), /Unbekannte Option/);
  t.throws('parseArgs: --notes ohne Wert', () => R.parseArgs(['--notes']), /braucht einen Wert/);
  t.throws('parseArgs: --notes leer', () => R.parseArgs(['--notes', '  ']), /braucht einen Wert/);
  t.throws('parseArgs: --notes frisst keine Option', () => R.parseArgs(['--notes', '--final']), /braucht einen Wert/);
  t.throws('parseArgs: --main-template nur Tabellen-Link', () => R.parseArgs(['--main-template', 'https://example.org']), /Google-Tabelle/);
  const n3 = R.nextChannel({ releases: [Object.assign({}, entry, { notes: ['alt'] })] }, R.buildEntry({ notes: [' '] }), { notes: [' '] });
  t.ok('nextChannel: leere Notizen ersetzen alte nicht', J(n3.entry.notes) === J(['alt']), n3.entry.notes);
  // Kommandozeile: Exit 1 bei Abweichung (in einer Kopie des Repos)
  const cp = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  ['src', 'tools', 'releases'].forEach(d => fs.cpSync(path.join(SRC, '..', d), path.join(tmp, d), { recursive: true }));
  const cli = args => cp.spawnSync(process.execPath, [path.join(tmp, 'tools', 'release.js')].concat(args), { encoding: 'utf8' });
  t.eq('CLI --check: passt, Exit 0', cli(['--check']).status, 0);
  const chPath = path.join(tmp, 'releases', 'channel.json');
  const ch0 = JSON.parse(fs.readFileSync(chPath, 'utf8'));
  ch0.releases.find(r => r.version === v).schema = '99';
  fs.writeFileSync(chPath, JSON.stringify(ch0));
  const bad = cli(['--check']);
  t.ok('CLI --check: Abweichung, Exit 1', bad.status === 1 && /passt nicht/.test(bad.stdout), bad.stdout);
  const set = cli(['--main-template', TEMPLATE_URL]);
  t.ok('CLI --main-template schreibt nur die Hauptvorlage', set.status === 0 && JSON.parse(fs.readFileSync(chPath, 'utf8')).templateUrl === TEMPLATE_URL, set.stdout + set.stderr);
  t.eq('CLI: Fehler in Optionen, Exit 1', cli(['--notes']).status, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}

fs.rmSync(BASE_DIR, { recursive: true, force: true });
t.done();
