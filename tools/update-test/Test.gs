/**
 * Update-Test (Stand 21.10.2026)
 *
 * Prüft in einer leeren Wegwerf-Tabelle, ob ein an die Tabelle gebundenes Skript sich über die
 * Apps-Script-API selbst ersetzen und seine Web-App auf eine neue Version umstellen kann, ohne
 * eigenes Google-Cloud-Projekt. Davon hängt der Update-Knopf des Sammlungs-Tools ab.
 *
 * Start: im Skript-Editor oben die Funktion updateTestStarten wählen und auf „Ausführen“ klicken.
 * Das Ergebnis steht danach im Blatt „Ergebnis“ dieser Tabelle.
 */

const API_ = 'https://script.googleapis.com/v1/projects/';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Update-Test').addItem('Test starten', 'updateTestStarten').addToUi();
}

/** Nur damit die Test-Bereitstellung eine Web-App hat. */
function doGet() {
  return ContentService.createTextOutput('Update-Test ok');
}

function updateTestStarten() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Ergebnis') || ss.insertSheet('Ergebnis');
  sh.clear();
  sh.appendRow(['Schritt', 'Ergebnis', 'Details']);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(3, 700);
  const log = (step, res, details) => {
    const text = res === true ? 'OK' : res === false ? 'FEHLER' : String(res);
    sh.appendRow([step, text, String(details === undefined ? '' : details).slice(0, 40000)]);
    SpreadsheetApp.flush();
  };

  const id = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  log('0 Start', 'INFO', 'Skript-ID ' + id + ', ' + new Date().toISOString());

  // 1 Welche Berechtigungen hat das Token wirklich?
  try {
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true });
    const info = JSON.parse(r.getContentText() || '{}');
    const scopes = String(info.scope || '');
    const missing = ['script.projects', 'script.deployments'].filter(s => scopes.indexOf('auth/' + s) < 0);
    log('1 Berechtigungen', missing.length === 0,
      missing.length ? 'Es fehlen: ' + missing.join(', ') + '. Ist appsscript.json ersetzt?' : scopes);
    log('1b OAuth-Client', 'INFO', String(info.azp || info.aud || '?'));
  } catch (e) {
    log('1 Berechtigungen', false, e);
  }

  // 2 Projekt lesen: hier zeigt sich, ob der API-Schalter an ist und das Standard-Cloud-Projekt die API darf
  const r2 = call_('get', API_ + id, token);
  if (r2.code !== 200) {
    log('2 Projekt lesen', false, deute_(r2));
    log('Ende', 'ABBRUCH', 'Ohne Schritt 2 gehen die weiteren Schritte nicht.');
    return;
  }
  log('2 Projekt lesen', true, 'Titel „' + r2.json.title + '“' +
    (r2.json.parentId ? ', gebunden an Datei ' + r2.json.parentId : ', NICHT an eine Tabelle gebunden'));

  // 3 Inhalt lesen
  const r3 = call_('get', API_ + id + '/content', token);
  if (r3.code !== 200) {
    log('3 Inhalt lesen', false, deute_(r3));
    return;
  }
  const original = (r3.json.files || []).map(f => ({ name: f.name, type: f.type, source: f.source }));
  log('3 Inhalt lesen', true, original.map(f => f.name + ' (' + f.type + ')').join(', '));

  // 4 Inhalt schreiben: Markierungsdatei dazu, prüfen, dann den alten Stand zurückschreiben
  const marker = { name: 'UpdateTestMarker', type: 'SERVER_JS', source: '// Update-Test ' + new Date().toISOString() + '\n' };
  const r4 = call_('put', API_ + id + '/content', token, { files: original.concat([marker]) });
  if (r4.code !== 200) {
    log('4 Inhalt schreiben', false, deute_(r4));
    return;
  }
  const r4b = call_('get', API_ + id + '/content', token);
  const hasMarker = r4b.code === 200 && (r4b.json.files || []).some(f => f.name === marker.name);
  log('4 Inhalt schreiben', hasMarker, hasMarker ? 'Markierungsdatei angelegt und wiedergefunden' : 'Schreiben gab 200, Datei fehlt aber: ' + r4b.text);
  const r4c = call_('put', API_ + id + '/content', token, { files: original });
  log('4b Alten Stand zurück', r4c.code === 200, r4c.code === 200 ? 'Markierungsdatei wieder entfernt' : deute_(r4c));

  // 5 Version anlegen
  const r5 = call_('post', API_ + id + '/versions', token, { description: 'Update-Test 1' });
  if (r5.code !== 200) {
    log('5 Version anlegen', false, deute_(r5));
    return;
  }
  const v1 = r5.json.versionNumber;
  log('5 Version anlegen', true, 'Version ' + v1);

  // 6 Web-App-Bereitstellung anlegen
  const r6 = call_('post', API_ + id + '/deployments', token,
    { versionNumber: v1, manifestFileName: 'appsscript', description: 'Update-Test' });
  if (r6.code !== 200) {
    log('6 Web-App bereitstellen', false, deute_(r6));
    return;
  }
  const depId = r6.json.deploymentId;
  const url1 = webAppUrl_(r6.json);
  log('6 Web-App bereitstellen', !!url1, 'Bereitstellung ' + depId + ', Link ' + (url1 || 'keiner (fehlt webapp in appsscript.json?)'));

  // 7 Neue Version anlegen und die Bereitstellung darauf umstellen; der Link muss gleich bleiben
  const r7a = call_('post', API_ + id + '/versions', token, { description: 'Update-Test 2' });
  if (r7a.code !== 200) {
    log('7 Web-App umstellen', false, deute_(r7a));
    return;
  }
  const v2 = r7a.json.versionNumber;
  const r7 = call_('put', API_ + id + '/deployments/' + depId, token,
    { deploymentConfig: { versionNumber: v2, manifestFileName: 'appsscript', description: 'Update-Test, umgestellt' } });
  if (r7.code !== 200) {
    log('7 Web-App umstellen', false, deute_(r7));
  } else {
    const url2 = webAppUrl_(r7.json);
    const ver = r7.json.deploymentConfig && r7.json.deploymentConfig.versionNumber;
    log('7 Web-App umstellen', ver === v2 && url2 === url1,
      'Jetzt Version ' + ver + (url2 === url1 ? ', Link unverändert' : ', Link GEÄNDERT: ' + url2));
  }

  // 8 Sicherungskopie der ganzen Tabelle (das Skript sollte mitkopiert werden)
  try {
    const copy = ss.copy('Update-Test – Sicherung ' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM. HH:mm'));
    log('8 Sicherungskopie', true, copy.getUrl() +
      ' → Bitte öffnen und unter Erweiterungen > Apps Script nachsehen, ob dort derselbe Test-Code steht.');
  } catch (e) {
    log('8 Sicherungskopie', false, e);
  }

  // 9 Dateien von GitHub lesen (öffentliche Datei, ohne Anmeldung)
  try {
    const r9 = UrlFetchApp.fetch('https://raw.githubusercontent.com/github/gitignore/main/README.md', { muteHttpExceptions: true });
    log('9 GitHub lesen', r9.getResponseCode() === 200, 'HTTP ' + r9.getResponseCode() + ', ' + r9.getContentText().length + ' Zeichen');
  } catch (e) {
    log('9 GitHub lesen', false, e);
  }

  log('Ende', 'FERTIG', 'Sag Claude Bescheid, dann liest es dieses Blatt.');
}

function call_(method, url, token, body) {
  const opt = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (body !== undefined) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(body);
  }
  const r = UrlFetchApp.fetch(url, opt);
  let json = null;
  try { json = JSON.parse(r.getContentText()); } catch (e) { json = null; }
  return { code: r.getResponseCode(), json: json, text: r.getContentText() };
}

function webAppUrl_(deployment) {
  const ep = (deployment.entryPoints || []).filter(e => e.entryPointType === 'WEB_APP')[0];
  return ep && ep.webApp ? ep.webApp.url : '';
}

function deute_(r) {
  const msg = (r.json && r.json.error && r.json.error.message) || r.text;
  let hint = '';
  if (/has not enabled the Apps Script API|usersettings/i.test(msg)) {
    hint = 'Der Schalter für die Apps-Script-API ist aus. Unter https://script.google.com/home/usersettings einschalten, ' +
      'ein paar Minuten warten und den Test erneut starten.';
  } else if (/has not been used in project|SERVICE_DISABLED|it is disabled/i.test(msg)) {
    hint = 'WICHTIG: Das Standard-Cloud-Projekt dieses Skripts darf die Apps-Script-API nicht nutzen. ' +
      'Das ist das entscheidende Ergebnis, bitte Claude Bescheid sagen.';
  } else if (r.code === 401 || /insufficient|scope/i.test(msg)) {
    hint = 'Eine Berechtigung fehlt. Ist appsscript.json ersetzt, und hast du beim Start alles erlaubt?';
  }
  return 'HTTP ' + r.code + ': ' + msg + (hint ? ' → ' + hint : '');
}
