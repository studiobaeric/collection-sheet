'use strict';
/**
 * Versionen der Script-Dateien vergleichen (#35): gsFileVersions_, getFileVersions (mit den HTML-Versionen der Seite),
 * Meldung beim Öffnen, Merken in Tool-Einstellungen, alte und fehlende Dateien.
 * Start: node test_versionen.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./harness2');
const t = H.runner('test_versionen');
const ok = t.ok, eq = t.eq;

const SRC = path.join(__dirname, '..', 'src');
const V = /const TOOL_VERSION = '([^']*)'/.exec(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8'))[1];
const OK_UI = { 'Ui.html': V, 'ImportUi.html': V };

function setup(opts) {
  const env = H.createEnv(opts || {});
  env.ctx.setupAll_();
  return env;
}
const names = rep => rep.files.map(f => f.name + ' ' + f.version);

t.section('Alle Dateien gleich');
{
  const env = setup();
  eq('.gs-Dateien', env.ctx.gsFileVersions_(), { 'Code.gs': V, 'Update.gs': V, 'Import.gs': V });
  const rep = env.ctx.getFileVersions(OK_UI);
  eq('fünf Dateien in fester Reihenfolge', names(rep), ['Code.gs', 'Update.gs', 'Import.gs', 'Ui.html', 'ImportUi.html'].map(n => n + ' ' + V));
  ok('passt: nichts auffällig', rep.newest === V && rep.odd.length === 0, rep);
  eq('in Tool-Einstellungen gemerkt', env.ctx.settingGet_('FILE_VERSIONS'),
    'Code.gs ' + V + ', Update.gs ' + V + ', Import.gs ' + V + ', Ui.html ' + V + ', ImportUi.html ' + V);
  const w = env.writes;
  env.ctx.getFileVersions(OK_UI);
  ok('unverändert: kein neues Schreiben', env.writes === w);
  env.ss.toasts.length = 0;
  env.ctx.onOpen();
  ok('beim Öffnen keine Meldung', !env.ss.toasts.some(m => /passen nicht zusammen/.test(m)), env.ss.toasts);
}

t.section('Eine HTML-Datei alt oder fehlend');
{
  const env = setup();
  let rep = env.ctx.getFileVersions({ 'Ui.html': '1.1.1', 'ImportUi.html': V });
  eq('Ui.html 1.1.1 auffällig', [rep.newest, rep.odd], [V, ['Ui.html']]);
  ok('gemerkt mit „passt nicht zusammen“', / Ui\.html 1\.1\.1, .* – passt nicht zusammen$/.test(env.ctx.settingGet_('FILE_VERSIONS')), env.ctx.settingGet_('FILE_VERSIONS'));
  rep = env.ctx.getFileVersions({ 'Ui.html': V, 'ImportUi.html': null });
  eq('ImportUi.html fehlt', [rep.odd, rep.files[4].version], [['ImportUi.html'], null]);
  ok('Text: fehlt', /ImportUi\.html fehlt/.test(env.ctx.settingGet_('FILE_VERSIONS')));
  rep = env.ctx.getFileVersions({ 'Ui.html': V, 'ImportUi.html': 'alt' });
  ok('ImportUi.html älter als 1.1.2', rep.odd[0] === 'ImportUi.html' && /ImportUi\.html älter als 1\.1\.2/.test(env.ctx.settingGet_('FILE_VERSIONS')));
  rep = env.ctx.getFileVersions({ 'Ui.html': '<b>x</b>', 'ImportUi.html': 'x'.repeat(100) });
  eq('unbrauchbare Angaben gelten als fehlend', [rep.files[3].version, rep.files[4].version], [null, null]);
  rep = env.ctx.getFileVersions({ 'Ui.html': '9.0.0', 'ImportUi.html': '9.0.0' });
  eq('Seite neuer als der Code: die .gs-Dateien fallen auf', [rep.newest, rep.odd], ['9.0.0', ['Code.gs', 'Update.gs', 'Import.gs']]);
  rep = env.ctx.getFileVersions(null);
  ok('ohne Angaben der Seite: HTML-Dateien fehlen', rep.odd.join() === 'Ui.html,ImportUi.html');
}

t.section('.gs-Dateien alt oder fehlend');
{
  // Update.gs von vor 1.1.2: ohne UPDATE_FILE_VERSION
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-ver-'));
  ['Code.gs', 'Import.gs'].forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(dir, f)));
  fs.writeFileSync(path.join(dir, 'Update.gs'), fs.readFileSync(path.join(SRC, 'Update.gs'), 'utf8').replace(/^const UPDATE_FILE_VERSION = .*$/m, ''));
  let env = setup({ srcDir: dir, files: ['Code.gs', 'Import.gs', 'Update.gs'] });
  eq('Update.gs ohne Konstante: alt', env.ctx.gsFileVersions_()['Update.gs'], 'alt');
  env.ss.toasts.length = 0;
  env.ctx.onOpen();
  const msg = env.ss.toasts.find(m => /passen nicht zusammen/.test(m)) || '';
  ok('beim Öffnen: Meldung mit der alten Datei', /Update\.gs älter als 1\.1\.2/.test(msg) && /Code\.gs /.test(msg) && /Erweiterungen > Apps Script/.test(msg), env.ss.toasts);
  ok('Meldung bleibt 30 Sekunden', env.ss.toastLog.some(x => /passen nicht/.test(x.msg) && x.timeout === 30));
  fs.rmSync(dir, { recursive: true, force: true });
  // Import.gs fehlt
  env = setup({ files: ['Code.gs', 'Update.gs'] });
  eq('Import.gs fehlt', env.ctx.gsFileVersions_()['Import.gs'], null);
  env.ss.toasts.length = 0;
  env.ctx.onOpen();
  ok('beim Öffnen: Import.gs fehlt', env.ss.toasts.some(m => /Import\.gs fehlt/.test(m)), env.ss.toasts);
}

t.section('Vergleich der Versionen');
{
  const env = setup();
  const c = env.ctx.fileVerCmp_;
  eq('Reihenfolge', [c('1.1.2', '1.1.10'), c('1.2.0', '1.1.9'), c('1.1.2', '1.1.2'), c('1.2.0-beta.1', '1.2.0'), c('1.2.0', '1.2.0-beta.1'),
    c('1.2.0-beta.2', '1.2.0-beta.1'), c('1.0.0', ''), c('', '1.0.0')], [-1, 1, 0, -1, 1, 1, 1, -1]);
}

t.section('Kopie der Tabelle');
{
  const env = setup();
  env.ctx.getFileVersions({ 'Ui.html': '1.1.1', 'ImportUi.html': V });
  ok('FILE_VERSIONS gilt nur für diese Tabelle', env.run('SETTINGS_LOCAL').indexOf('FILE_VERSIONS') >= 0);
}

t.done();
