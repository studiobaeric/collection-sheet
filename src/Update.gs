/**
 * Update.gs – neue Versionen auf GitHub finden, neue Tabelle aus der Vorlage anlegen, Übernahme aus einer alten
 * Tabelle, alte Tabelle stilllegen und wieder benutzen. Braucht Code.gs (TOOL_VERSION, Einstellungen aus
 * Abschnitt 1c, setupSheets_ …). Bauplan: docs/SPEC.md Abschnitt 11.
 *
 *   1. Versionen und Release-Kanal (releases/channel.json im Repo, gelesen über raw.githubusercontent.com)
 *   2. Öffentlich: getUpdateInfo, setPrereleases, updateCopy
 *   3. Übernahme aus einer alten Tabelle: takeoverPreview, takeoverRun (bricht sie ab, lässt sie sich wiederholen)
 *   4. Stilllegen rückgängig: wiederBenutzen
 *
 * Ein Skript in einer Tabelle darf seinen eigenen Code nicht ersetzen (die Apps-Script-API ist im versteckten
 * Standard-Projekt jedes Skripts gesperrt, getestet am 21.10.2026). Eine neue Version kommt deshalb als neue Kopie
 * der Vorlage: updateCopy legt sie an, die neue Tabelle holt mit ihrem neuen Code alle Daten aus der alten
 * (takeoverRun) und legt die alte still. Die alte bleibt als Stand davor erhalten.
 */

const UPD_REPO = 'studiobaeric/collection-sheet';
const UPD_RAW = 'https://raw.githubusercontent.com/';
const UPD_CHANNEL_PATH = '/main/releases/channel.json';
const UPD_CACHE_KEY = 'UPD_CHANNEL';
const UPD_CACHE_SEC = 6 * 3600;
/** Name der neuen Tabelle bis zur Übernahme; danach bekommt sie den Namen der alten. */
const UPD_NEW_SUFFIX = ' (neu, Version ';
const UPD_OLD_SUFFIX = ' (alt)';
/** So lange gilt eine Übernahme als laufend (Apps Script bricht jede Ausführung nach 6 Minuten ab). */
const UPD_TAKE_MAX_MS = 7 * 60 * 1000;
const UPD_TAKE_BUSY = 'Die Übernahme läuft gerade oder ist eben erst abgebrochen. Bitte warte zwei Minuten und öffne dann die Seitenleiste neu (Pokémon > Karten erfassen).';

// ---------------------------------------------------------------------------
// 1. Versionen und Release-Kanal
// ---------------------------------------------------------------------------

/** '1.2.0' oder '1.2.0-beta.1' (auch mit führendem v) -> {n: [1, 2, 0], pre: ['beta', '1']}, sonst null. */
function updParse_(v) {
  const m = String(v == null ? '' : v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
}

/** Wie bei SemVer: -1, 0 oder 1. Eine Vorabversion ist älter als die fertige Version. Ungültiges zählt als ältestes. */
function updCompare_(a, b) {
  const x = updParse_(a), y = updParse_(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const p = x.pre[i], q = y.pre[i];
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p < +q ? -1 : 1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Release-Kanal aus dem Cache (6 Stunden) oder von GitHub. force: immer frisch holen. Wirft bei Fehlern. */
function updChannel_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const hit = cache.get(UPD_CACHE_KEY);
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* neu holen */ } }
  }
  const url = UPD_RAW + UPD_REPO + UPD_CHANNEL_PATH + '?t=' + Date.now();
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('GitHub antwortet nicht wie erwartet (' + code + '). Bitte später noch einmal versuchen.');
  let raw;
  try { raw = JSON.parse(res.getContentText('UTF-8')); } catch (e) { throw new Error('Die Liste der Versionen auf GitHub ist kaputt.'); }
  const ch = updCleanChannel_(raw);
  ch.fetchedAt = Utilities.formatDate(new Date(), tz_(), 'dd.MM.yyyy HH:mm');
  try { cache.put(UPD_CACHE_KEY, JSON.stringify(ch), UPD_CACHE_SEC); } catch (e) { /* zu groß: ohne Cache weiter */ }
  return ch;
}

/** Link einer Google-Tabelle, sonst ''. */
function updSheetLink_(s) {
  s = String(s == null ? '' : s).trim();
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/.test(s) ? s : '';
}

/** Nur gültige Releases, neueste zuerst. Ein Release kann eine eigene Vorlage haben (z. B. für Vorabversionen). */
function updCleanChannel_(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const releases = (Array.isArray(raw.releases) ? raw.releases : []).filter(function (r) {
    return r && updParse_(r.version);
  }).map(function (r) {
    return {
      version: String(r.version).replace(/^v/i, ''), tag: String(r.tag || ('v' + String(r.version).replace(/^v/i, ''))),
      date: String(r.date || ''), prerelease: !!r.prerelease, schema: String(r.schema == null ? '' : r.schema),
      notes: (Array.isArray(r.notes) ? r.notes : []).map(String), templateUrl: updSheetLink_(r.templateUrl)
    };
  });
  releases.sort(function (a, b) { return updCompare_(b.version, a.version); });
  return {
    repo: /^[\w.-]+\/[\w.-]+$/.test(String(raw.repo || '')) ? String(raw.repo) : UPD_REPO,
    templateUrl: updSheetLink_(raw.templateUrl), guideUrl: /^https:\/\//.test(String(raw.guideUrl || '')) ? String(raw.guideUrl) : '',
    releases: releases
  };
}

/** Neuere Versionen, die diese Tabelle bekommen darf (Vorabversionen nur mit Schalter), neueste zuerst. */
function updNewer_(ch) {
  const pre = settingGet_('PRERELEASES') === '1';
  return ch.releases.filter(function (r) { return (pre || !r.prerelease) && updCompare_(r.version, TOOL_VERSION) > 0; });
}

/** Vorlage für ein Release: eigene des Releases, sonst die allgemeine (nur für fertige Versionen). */
function updTemplateFor_(ch, rel) {
  if (!rel) return '';
  return rel.templateUrl || (rel.prerelease ? '' : ch.templateUrl);
}

/** Neueste erlaubte Version mit Vorlage (eine Vorabversion ohne eigene Vorlage wird übersprungen), sonst null. */
function updCopyTarget_(ch, newer) {
  return (newer || updNewer_(ch)).filter(function (r) { return !!updSheetId_(updTemplateFor_(ch, r)); })[0] || null;
}

/** Nächtlicher Preislauf: Kanal im Cache auffrischen, damit Seitenleiste und Web-App den Hinweis sofort zeigen. */
function checkForUpdate_() {
  try { updChannel_(true); } catch (e) { /* nächste Nacht wieder */ }
}

// ---------------------------------------------------------------------------
// 2. Öffentlich (Seitenleiste und Web-App)
// ---------------------------------------------------------------------------

/**
 * Stand für Hinweis-Leiste und Bereich Updates. Wirft nie: Fehler beim Abruf stehen in error.
 * -> {installed, codeVersion, outdated, available, banner, newer: [{version, date, prerelease, notes}], prereleases,
 *     copyVersion, templateUrl, newCopy: {url, version} | null, sheetUrl, checkedAt, error, guideUrl, collectionEmpty,
 *     takenFrom, pendingTake}
 * outdated: In der Tabelle lief schon neuerer Code (codeVersion) als dieser, etwa eine Web-App auf alter Version.
 *   Dann zählen nur Versionen, die neuer sind als codeVersion.
 * copyVersion/templateUrl: Version und Vorlage, die „Neue Version holen“ anlegt (die neueste mit Vorlage).
 * newCopy: schon angelegte neue Tabelle für copyVersion.
 * pendingTake: Link der alten Tabelle, wenn diese Tabelle von updateCopy angelegt und noch nicht befüllt wurde
 *   oder eine Übernahme abbrach.
 */
function getUpdateInfo(force) {
  const info = {
    installed: TOOL_VERSION, codeVersion: '', outdated: false, available: '', banner: '', newer: [], prereleases: false,
    copyVersion: '', templateUrl: '', newCopy: null, sheetUrl: '', checkedAt: '', error: '', guideUrl: '', collectionEmpty: false,
    takenFrom: '', pendingTake: ''
  };
  try {
    info.codeVersion = settingGet_('CODE_VERSION');
    info.outdated = codeIsNewer_(info.codeVersion);
    info.prereleases = settingGet_('PRERELEASES') === '1';
    info.takenFrom = settingGet_('TAKEN_FROM');
    info.collectionEmpty = updCardRows_(ss_()) === 0;
    info.sheetUrl = ss_().getUrl();
    info.pendingTake = updPendingTake_();
  } catch (e) { /* ohne diese Angaben weiter */ }
  let ch;
  try { ch = updChannel_(!!force); } catch (e) { info.error = e.message; return info; }
  info.checkedAt = ch.fetchedAt || '';
  info.guideUrl = ch.guideUrl;
  const newer = updNewer_(ch).filter(function (r) { return !info.outdated || updCompare_(r.version, info.codeVersion) > 0; });
  info.newer = newer.map(function (r) { return { version: r.version, date: r.date, prerelease: r.prerelease, notes: r.notes }; });
  if (newer.length) {
    info.available = info.banner = newer[0].version;
    const target = updCopyTarget_(ch, newer);
    if (target) {
      info.copyVersion = target.version;
      info.templateUrl = updTemplateFor_(ch, target);
      const url = settingGet_('NEW_COPY_URL');
      if (url && settingGet_('NEW_COPY_VERSION') === target.version) info.newCopy = { url: url, version: target.version };
    }
  }
  return info;
}

/** Schalter „Vorabversionen bekommen“. -> getUpdateInfo() */
function setPrereleases(on) {
  settingSet_('PRERELEASES', on ? '1' : '');
  return getUpdateInfo(false);
}

/**
 * Neue Version holen (nur Seitenleiste): die Vorlage der neuesten erlaubten Version (mit Vorlage) in den Ordner
 * dieser Tabelle kopieren und ihr sagen, woher sie die Daten übernehmen soll. Hier ändert sich nichts außer zwei
 * Einstellungen. Wirft nie: Fehler kommen als state 'error', mit templateUrl für den Weg von Hand.
 * -> {state: 'copied'|'none'|'notemplate'|'error', message, url, name, version, templateUrl}
 */
function updateCopy() {
  if (takenOverBy_()) return { state: 'error', message: takenOverText_() };
  let ch;
  try { ch = updChannel_(true); } catch (e) { return { state: 'error', message: e.message }; }
  const newer = updNewer_(ch);
  if (!newer.length) return { state: 'none', message: 'Du hast schon die neueste Version (' + TOOL_VERSION + ').' };
  const rel = updCopyTarget_(ch, newer);
  if (!rel) {
    return { state: 'notemplate', version: newer[0].version, guideUrl: ch.guideUrl, message: 'Für Version ' + newer[0].version + ' gibt es noch keine Vorlage zum Kopieren.' };
  }
  const templateUrl = updTemplateFor_(ch, rel);
  const fail = function (text) { return { state: 'error', version: rel.version, templateUrl: templateUrl, message: text + ' Du kannst die Vorlage auch selbst kopieren.' }; };
  const ss = ss_();
  let file;
  try { file = DriveApp.getFileById(updSheetId_(templateUrl)); } catch (e) {
    return fail('Die Vorlage von Version ' + rel.version + ' ließ sich nicht öffnen.');
  }
  const name = ss.getName().replace(/ \(alt\)$/, '') + UPD_NEW_SUFFIX + rel.version + ')';
  let copy = null, where = 'im selben Ordner wie diese';
  try {
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    copy = file.makeCopy(name, parents.hasNext() ? parents.next() : DriveApp.getRootFolder());
  } catch (e) {
    // z. B. Ordner nur zum Ansehen geteilt: dann in „Meine Ablage“
    where = 'in „Meine Ablage“';
    try { copy = file.makeCopy(name, DriveApp.getRootFolder()); } catch (e2) { copy = null; }
  }
  if (!copy) return fail('Die neue Tabelle ließ sich nicht anlegen. Vielleicht ist dein Google Drive voll, oder die Vorlage darf nicht kopiert werden.');
  try {
    // die neue Tabelle weiß damit, dass sie von hier übernehmen soll (ihre Seitenleiste bietet es gleich an)
    writeSettings_(SpreadsheetApp.openById(copy.getId()), { TAKE_FROM: ss.getUrl() });
  } catch (e) {
    try { copy.setTrashed(true); } catch (e2) { /* dann bleibt sie liegen */ }
    return fail('Die neue Tabelle ließ sich nicht fertig anlegen. Bitte versuch es gleich noch einmal.');
  }
  settingsSetMany_({ NEW_COPY_URL: copy.getUrl(), NEW_COPY_VERSION: rel.version });
  return {
    state: 'copied', version: rel.version, url: copy.getUrl(), name: name,
    message: 'Die neue Tabelle mit Version ' + rel.version + ' liegt ' + where + '.'
  };
}

// ---------------------------------------------------------------------------
// 3. Übernahme aus einer alten Tabelle
// ---------------------------------------------------------------------------
// Für eine neue Kopie der Vorlage: alle Daten der alten Tabelle 1:1 in diese (leere) Tabelle holen, danach
// die alte stilllegen. Generierte Blätter (Sammlung, Gruppen, Pokédex …) baut setupSheets_ neu auf.
// Ein Lauf steht in TAKE_RUN ({from, url, at, own, failed}). Bricht er ab, lässt er sich wiederholen: Die Werte
// werden neu kopiert, eigene Blätter des abgebrochenen Laufs vorher gelöscht. TAKEN_FROM kommt erst ganz am Ende.

/** Blätter, deren Werte 1:1 übernommen werden (Reihenfolge = Reihenfolge der Anzeige in der Vorschau). */
function updTakeoverSheets_() {
  return [SHEETS.data, SHEETS.hist, SHEETS.imports, SHEETS.proto, 'Import-Begriffe', 'Import-Sets', 'Import-Vorlagen',
    'Import-Antworten', SHEETS.rarity, SHEETS.dexIds, SHEETS.sets, SHEETS.tr];
}

/** Kopfzeilen der übernommenen Blätter (für alte Tabellen ohne TOOL_SHEETS). */
function updTakeoverHeads_() {
  const m = {};
  m[SHEETS.hist] = HIST_HEADERS; m[SHEETS.proto] = PROTO_HEADERS; m[SHEETS.rarity] = RARITY_HEADERS;
  m[SHEETS.dexIds] = DEX_IDS_HEADERS; m[SHEETS.sets] = SET_HEADERS; m[SHEETS.tr] = TR_HEADERS;
  if (typeof IMPORTE_HEADERS !== 'undefined') {
    m[SHEETS.imports] = IMPORTE_HEADERS; m['Import-Begriffe'] = TERMS_HEADERS; m['Import-Sets'] = CMSETS_HEADERS;
    m['Import-Vorlagen'] = TEMPLATE_HEADERS; m['Import-Antworten'] = ANSWER_HEADERS;
  }
  return m;
}

/**
 * Blätter der alten Tabelle, die ihr Tool angelegt hat: {Name: true}. Ab 1.0 steht die Liste in ihren Einstellungen
 * (TOOL_SHEETS), sonst gilt die Liste dieses Codes, wobei ein Blatt zum Übernehmen mit fremder Kopfzeile dem Nutzer
 * gehört. Das Hinweisblatt einer früheren Übernahme gehört dazu, wenn die Tabelle schon einmal übernommen wurde.
 */
function updOldToolSheets_(old, st) {
  const out = {};
  let names = null;
  try { const a = JSON.parse(st.map.TOOL_SHEETS || ''); if (Array.isArray(a)) names = a.map(String); } catch (e) { /* vor 1.0 */ }
  if (names) {
    names.forEach(function (n) { out[n] = true; });
  } else {
    toolSheetNames_().forEach(function (n) { out[n] = true; });
    const heads = updTakeoverHeads_();
    Object.keys(heads).forEach(function (n) {
      const sh = old.getSheetByName(n);
      if (!sh || sh.getLastRow() < 1) return;
      const want = heads[n].slice(0, 2);
      const got = sh.getRange(1, 1, 1, want.length).getValues()[0].map(function (v) { return String(v == null ? '' : v).trim(); });
      if (want.some(function (h, i) { return got[i] !== h; })) delete out[n];
    });
  }
  out[SHEETS.data] = true; // ohne Daten keine Übernahme (updOpenOld_ prüft, dass es das Blatt gibt)
  if (st.map.TAKEN_OVER_BY) out[st.map.TAKEN_OVER_SHEET || SHEETS.takenOver] = true;
  return out;
}

/** Zeilen mit Inhalt im Blatt Daten (ohne Kopfzeile). */
function updCardRows_(ss) {
  const sh = ss.getSheetByName(SHEETS.data);
  if (!sh || sh.getLastRow() < 2) return 0;
  return readData_(sh).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); }).length;
}

/** Link oder ID -> ID */
function updSheetId_(url) {
  const s = String(url == null ? '' : url).trim();
  const m = s.match(/\/d\/([\w-]{20,})/);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : '';
}

/** Einstellungen eines fremden Blatts „Tool-Einstellungen“ lesen (ohne Cache). */
function updReadSettings_(ss) {
  const sh = ss.getSheetByName(SHEETS.settings);
  const map = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = String(r[0] == null ? '' : r[0]).trim();
      if (k && !(k in map)) map[k] = r[1] == null ? '' : String(r[1]);
    });
  }
  return { exists: !!sh, map: map };
}

/** Laufende oder abgebrochene Übernahme in diese Tabelle: {from, url, at, own, failed} oder null. */
function updTakeRun_() {
  try {
    const r = JSON.parse(settingGet_('TAKE_RUN') || '');
    return r && typeof r === 'object' && r.from ? r : null;
  } catch (e) { return null; }
}

function updTakeRunSet_(run) {
  settingSet_('TAKE_RUN', run ? JSON.stringify(run) : '');
}

/** Läuft dieser Lauf vermutlich noch (nicht abgebrochen und jünger als eine Ausführung dauern kann)? */
function updTakeBusy_(run) {
  return !!run && !run.failed && Date.now() - Number(run.at || 0) < UPD_TAKE_MAX_MS;
}

/** Abgebrochenen Lauf markieren, damit „Jetzt übernehmen“ ihn sofort wiederholen darf. */
function updTakeFailed_(id) {
  try {
    settingsCache_ = null;
    const run = updTakeRun_();
    if (run && run.from === id) { run.failed = true; updTakeRunSet_(run); }
  } catch (e) { /* nach 7 Minuten gilt er ohnehin als abgebrochen */ }
}

/** Link der alten Tabelle, aus der diese noch übernehmen soll (von „Neue Version holen“ angelegt oder abgebrochen), sonst ''. */
function updPendingTake_() {
  if (settingGet_('TAKEN_FROM')) return '';
  const run = updTakeRun_();
  if (run && run.url) return String(run.url);
  const from = settingGet_('TAKE_FROM');
  return from && updCardRows_(ss_()) === 0 ? from : '';
}

/** Prüfen und alte Tabelle öffnen. -> {old, settings, resume, busy} ; wirft mit verständlicher Meldung */
function updOpenOld_(url) {
  const ss = ss_();
  const id = updSheetId_(url);
  if (!id) throw new Error('Bitte den Link der alten Tabelle einfügen (https://docs.google.com/spreadsheets/d/…).');
  if (id === ss.getId()) throw new Error('Das ist der Link dieser Tabelle. Bitte den Link der alten Tabelle einfügen.');
  if (takenOverBy_()) throw new Error(takenOverText_());
  let old;
  try { old = SpreadsheetApp.openById(id); } catch (e) {
    throw new Error('Die alte Tabelle lässt sich nicht öffnen. Ist der Link richtig und gehört sie deinem Konto?');
  }
  if (!old.getSheetByName(SHEETS.data)) throw new Error('In der alten Tabelle gibt es kein Blatt „' + SHEETS.data + '“.');
  const st = updReadSettings_(old);
  if (Number(st.map.SCHEMA_VERSION) > Number(SCHEMA_VERSION)) {
    throw new Error('Die alte Tabelle hat schon Version ' + (st.map.CODE_VERSION || '?') + ' mit einem neueren Datenformat. ' +
      'Bitte bring zuerst diese Tabelle unter Updates auf den neuesten Stand.');
  }
  const run = updTakeRun_();
  const resume = !!run && run.from === id && !settingGet_('TAKEN_FROM');
  if (!resume && updCardRows_(ss) > 0) {
    throw new Error('In dieser Tabelle sind schon Karten. Übernehmen geht nur in eine neue, leere Kopie der Vorlage.');
  }
  if (settingGet_('TAKEN_FROM')) {
    throw new Error('In diese Tabelle wurde schon übernommen. Übernehmen geht nur in eine neue, leere Kopie der Vorlage.');
  }
  return { old: old, settings: st, resume: resume, busy: resume && updTakeBusy_(run) };
}

function updSheetRows_(sh) {
  return sh ? Math.max(0, sh.getLastRow() - 1) : 0;
}

/** Vorschau der Übernahme (nur Seitenleiste). -> {name, url, version, cards, copies, sheets: [{name, rows}], own, warnings, resume} */
function takeoverPreview(url) {
  const o = updOpenOld_(url);
  if (o.busy) throw new Error(UPD_TAKE_BUSY);
  const old = o.old, st = o.settings;
  const tool = updOldToolSheets_(old, st);
  const data = old.getSheetByName(SHEETS.data);
  const head = data.getRange(1, 1, 1, Math.max(1, data.getLastColumn())).getValues()[0].map(String);
  const cntCol = head.indexOf('Anzahl');
  let cards = 0, copies = 0;
  if (data.getLastRow() >= 2) {
    data.getRange(2, 1, data.getLastRow() - 1, head.length).getValues().forEach(function (r) {
      if (!r.some(function (v) { return v !== '' && v != null; })) return;
      cards++;
      if (cntCol >= 0) copies += Number(r[cntCol]) || 0;
    });
  }
  const sheets = updTakeoverSheets_().filter(function (n) { return n !== SHEETS.data && tool[n] && old.getSheetByName(n); })
    .map(function (n) { return { name: n, rows: updSheetRows_(old.getSheetByName(n)) }; });
  const own = updOwnSheets_(old, st).map(function (sh) { return sh.getName(); });
  const warnings = [];
  if (o.resume) {
    warnings.push('Die letzte Übernahme ist nicht fertig geworden. „Jetzt übernehmen“ holt die Karten und deine eigenen Blätter noch einmal ganz aus der alten Tabelle. ' +
      'Was du seitdem in dieser Tabelle eingetragen oder geändert hast, geht dabei verloren.');
  }
  if (st.map.TAKEN_OVER_BY) warnings.push('Die alte Tabelle wurde schon einmal übernommen' + (st.map.TAKEN_OVER_AT ? ' (' + st.map.TAKEN_OVER_AT + ')' : '') + '.');
  const imp = old.getSheetByName(SHEETS.imports);
  if (imp && tool[SHEETS.imports] && imp.getLastRow() >= 2) {
    const ih = imp.getRange(1, 1, 1, imp.getLastColumn()).getValues()[0].map(String);
    const sc = ih.indexOf('Status'), nc = ih.indexOf('Nr');
    if (sc >= 0) {
      imp.getRange(2, 1, imp.getLastRow() - 1, ih.length).getValues().forEach(function (r) {
        if (String(r[sc]) === 'läuft') {
          warnings.push('Import ' + (nc >= 0 ? r[nc] : '') + ' ist nicht fertig. Nach der Übernahme kannst du ihn im Tab Import fortsetzen oder zurücknehmen.');
        }
      });
    }
  }
  warnings.push('Ein Import, den du gerade vorbereitest und noch nicht übernommen hast, kommt nicht mit.');
  if (own.length) warnings.push('Formeln in deinen eigenen Blättern, die auf andere Blätter zeigen, bitte danach kurz prüfen.');
  return {
    name: old.getName(), url: old.getUrl(), version: st.map.CODE_VERSION || '', cards: cards, copies: copies,
    sheets: sheets, own: own, warnings: warnings, resume: o.resume
  };
}

/** Eigene Blätter des Nutzers in der alten Tabelle (nicht von ihrem Tool, nicht leer). st: deren Einstellungen */
function updOwnSheets_(old, st) {
  const tool = updOldToolSheets_(old, st);
  return old.getSheets().filter(function (sh) { return !tool[sh.getName()] && (sh.getLastRow() > 0 || sh.getLastColumn() > 0); });
}

/** Werte (mit Zahlenformaten, damit Text wie „025“ Text bleibt) von src nach dst. -> Zeilen ohne Kopf */
function updCopyValues_(src, dst) {
  const lr = src.getLastRow(), lc = src.getLastColumn();
  dst.clearContents();
  if (!lr || !lc) return 0;
  if (dst.getMaxRows() < lr) dst.insertRowsAfter(dst.getMaxRows(), lr - dst.getMaxRows());
  if (dst.getMaxColumns() < lc) dst.insertColumnsAfter(dst.getMaxColumns(), lc - dst.getMaxColumns());
  const from = src.getRange(1, 1, lr, lc);
  const to = dst.getRange(1, 1, lr, lc);
  to.setNumberFormats(from.getNumberFormats());
  to.setValues(from.getValues());
  return lr - 1;
}

/** Zusatzspalten der Sammlung einer Tabelle vor 1.0: Kopfzeile 5 hinter den festen Spalten. */
function updOldViewExtras_(old) {
  const sh = old.getSheetByName(SHEETS.view);
  if (!sh || sh.getLastColumn() <= VIEW_HEADERS.length) return [];
  return sh.getRange(5, VIEW_HEADERS.length + 1, 1, sh.getLastColumn() - VIEW_HEADERS.length).getValues()[0]
    .map(function (v) { return String(v == null ? '' : v).trim(); }).filter(Boolean);
}

/**
 * Freigaben der alten Tabelle auf diese übertragen, ohne E-Mails (Drive-Dienst). Der Besitzer der alten wird hier
 * Bearbeiter, falls es nicht derselbe ist. -> {added, failed}; failed -1: Freigaben ließen sich nicht lesen
 */
function updCopySharing_(old, ss) {
  const out = { added: 0, failed: 0 };
  const opt = { fields: 'permissions(type,role,emailAddress,domain,allowFileDiscovery)', supportsAllDrives: true };
  let have, want;
  try {
    have = Drive.Permissions.list(ss.getId(), opt).permissions || [];
    want = Drive.Permissions.list(old.getId(), opt).permissions || [];
  } catch (e) { out.failed = -1; return out; }
  const key = function (p) { return p.type + '|' + String(p.emailAddress || p.domain || '').toLowerCase(); };
  const known = {};
  have.forEach(function (p) { known[key(p)] = true; });
  want.forEach(function (p) {
    const role = p.role === 'owner' ? 'writer' : p.role;
    if (['writer', 'commenter', 'reader'].indexOf(role) < 0 || known[key(p)]) return;
    const res = { type: p.type, role: role };
    if (p.emailAddress) res.emailAddress = p.emailAddress;
    if (p.domain) res.domain = p.domain;
    if (p.type === 'anyone' || p.type === 'domain') res.allowFileDiscovery = !!p.allowFileDiscovery;
    const args = { supportsAllDrives: true };
    if (p.type === 'user' || p.type === 'group') args.sendNotificationEmail = false;
    try { Drive.Permissions.create(res, ss.getId(), args); known[key(p)] = true; out.added++; } catch (e) { out.failed++; }
  });
  return out;
}

/** Satz zu den Freigaben für die Meldung nach der Übernahme. */
function updSharingText_(sh) {
  if (sh.failed < 0) return ' Die Freigaben der alten Tabelle ließen sich nicht übernehmen. Hast du sie mit anderen geteilt, teile diese Tabelle bitte auch (oben rechts auf „Teilen“).';
  if (sh.failed) return ' Nicht alle Freigaben der alten Tabelle ließen sich übernehmen. Bitte prüf oben rechts unter „Teilen“, wer diese Tabelle sehen darf.';
  return sh.added ? ' Wer die alte Tabelle sehen oder bearbeiten durfte, darf das jetzt auch hier.' : '';
}

/** Übernahme ausführen (nur Seitenleiste). -> {message, cards, sheets, own, manualStop, noteSheet, oldName, newName, shared} */
function takeoverRun(url) {
  const o = updOpenOld_(url);
  if (o.busy) throw new Error(UPD_TAKE_BUSY);
  const old = o.old, st = o.settings, id = old.getId();
  const ss = ss_();
  // Am Ende wird die alte Tabelle stillgelegt: Darf dieses Konto sie nicht ändern, gar nicht erst anfangen
  try { writeSettings_(old, {}); } catch (e) {
    throw new Error('Die alte Tabelle lässt sich mit deinem Konto nicht bearbeiten. Übernehmen geht nur aus einer Tabelle, die du bearbeiten darfst.');
  }
  const when = Utilities.formatDate(new Date(), tz_(), 'dd.MM.yyyy HH:mm');
  const tool = updOldToolSheets_(old, st);
  let started = false;
  const res = (function () {
    try {
      return withLock_(function () {
        // noch einmal unter der Sperre: Eine zweite Seitenleiste kann gleichzeitig übernehmen wollen
        settingsCache_ = null;
        const cur = updTakeRun_();
        const same = !!cur && cur.from === id;
        if (settingGet_('TAKEN_FROM')) throw new Error('Die Übernahme ist schon fertig. Bitte öffne die Seitenleiste neu.');
        if (same && updTakeBusy_(cur)) throw new Error(UPD_TAKE_BUSY);
        if (!same && updCardRows_(ss) > 0) throw new Error('In dieser Tabelle sind schon Karten. Übernehmen geht nur in eine neue, leere Kopie der Vorlage.');
        const run = { from: id, url: old.getUrl(), at: Date.now(), own: [] };
        updTakeRunSet_(run);
        SpreadsheetApp.flush();
        started = true;
        // eigene Blätter eines abgebrochenen Laufs zuerst weg, sonst kämen sie doppelt
        (same ? cur.own || [] : []).forEach(function (n) {
          const sh = ss.getSheetByName(String(n));
          if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
        });
        let cards = 0;
        const copied = [];
        updTakeoverSheets_().forEach(function (n) {
          const src = old.getSheetByName(n);
          if (!src || !tool[n]) return;
          const dst = getOrCreateSheet_(ss, n);
          const rows = updCopyValues_(src, dst);
          if (n === SHEETS.data) cards = rows; else copied.push(n);
        });
        updOwnSheets_(old, st).forEach(function (src) {
          let name = src.getName();
          if (ss.getSheetByName(name)) name += ' (alt)';
          let i = 2;
          while (ss.getSheetByName(name)) name = src.getName() + ' (alt ' + (i++) + ')';
          src.copyTo(ss).setName(name);
          run.own.push(name);
          updTakeRunSet_(run);
        });
        // Suchfelder der Sammlung (gleiche Lage seit Version 1)
        const oldView = old.getSheetByName(SHEETS.view);
        const view = ss.getSheetByName(SHEETS.view);
        if (oldView && view) {
          try { view.getRange('B4:H4').setValues(oldView.getRange('B4:H4').getValues()); } catch (e) { /* Standard bleibt */ }
        }
        return { cards: cards, copied: copied, own: run.own.slice() };
      });
    } catch (e) {
      if (started) updTakeFailed_(id);
      throw started ? updTakeError_(e) : e;
    }
  })();

  let note, shared;
  try {
    // Daten auf das Format dieses Codes bringen, dann alles neu aufbauen (ohne Sperre: die Funktionen sperren selbst)
    settingSet_('SCHEMA_VERSION', '');
    migrateSchema_();
    const extras = st.exists && st.map.VIEW_EXTRAS ? (function () { try { return JSON.parse(st.map.VIEW_EXTRAS); } catch (e) { return []; } })()
      : updOldViewExtras_(old);
    const have = extraNames_();
    settingsSetMany_({
      VIEW_EXTRAS: JSON.stringify((Array.isArray(extras) ? extras : []).map(String).filter(function (n) { return have.indexOf(n) >= 0; })),
      PRERELEASES: st.map.PRERELEASES === '1' ? '1' : ''
    });
    setupSheets_(ss, true);
    setupTriggers_();
    settingsSetMany_({ CODE_VERSION: TOOL_VERSION, TOOL_SHEETS: JSON.stringify(toolSheetNames_()), SETUP_AT: settingGet_('SETUP_AT') || when });
    shared = updCopySharing_(old, ss);
    note = updMarkOld_(old, st, ss.getUrl(), when);
  } catch (e) {
    updTakeFailed_(id);
    throw updTakeError_(e);
  }
  settingsSetMany_({ TAKEN_FROM: old.getUrl(), TAKEN_AT: when, TAKE_RUN: '' });
  const names = updRenameAfterTakeover_(old, ss);
  // Code vor 1.0 kennt das Stilllegen nicht: dort läuft alles weiter, bis der Nutzer die Auslöser löscht
  const manualStop = !st.map.CODE_VERSION;
  const done = res.cards + ' Einträge und ' + (res.copied.length + res.own.length) + ' weitere Blätter übernommen. ';
  const renamed = names.old ? ' Sie heißt jetzt „' + names.old + '“.' : '';
  return {
    cards: res.cards, sheets: res.copied, own: res.own, manualStop: manualStop, noteSheet: note, oldName: names.old, newName: names.now,
    shared: shared,
    message: done + (manualStop
      ? 'Die alte Tabelle hat eine Version vor 1.0 und legt sich nicht selbst still.' + renamed + ' Sie zeigt jetzt vorne das Blatt „' + note +
        '“ mit einem Hinweis auf diese Tabelle. Bitte lösch dort die Trigger, damit sie nachts keine Preise mehr abruft. Die Schritte stehen in dem Blatt.'
      : 'Die alte Tabelle ist jetzt stillgelegt.' + renamed + ' Läuft dort doch noch eine ältere Version (das Menü Pokémon zeigt nach dem Neuladen alle Punkte), stehen im Blatt „' +
        note + '“ die Schritte zum Abschalten.') + updSharingText_(shared)
  };
}

/** Fehler eines angefangenen Laufs: verständlich, mit dem Weg zum Wiederholen. */
function updTakeError_(e) {
  return new Error('Die Übernahme ist nicht fertig geworden (' + (e && e.message ? e.message : e) + '). ' +
    'Bitte versuch es noch einmal. Was schon übernommen wurde, wird dabei ersetzt, und die alte Tabelle bleibt bis dahin, wie sie ist. ' +
    'Trag bis dahin bitte nichts in dieser Tabelle ein, sonst geht es beim nächsten Versuch verloren.');
}

/**
 * Namen nach der Übernahme: die alte Tabelle bekommt „ (alt)“, eine von updateCopy angelegte neue den Namen der alten.
 * -> {old: neuer Name der alten oder '', now: Name dieser Tabelle}
 */
function updRenameAfterTakeover_(old, ss) {
  const out = { old: '', now: ss.getName() };
  try {
    const base = old.getName().replace(/ \(alt\)$/, '');
    if (old.getName() !== base + UPD_OLD_SUFFIX) { old.rename(base + UPD_OLD_SUFFIX); out.old = base + UPD_OLD_SUFFIX; }
    const mine = updSheetId_(settingGet_('TAKE_FROM')) === old.getId() || ss.getName().indexOf(UPD_NEW_SUFFIX) >= 0;
    if (mine && ss.getName() !== base) { ss.rename(base); out.now = base; }
  } catch (e) { /* Namen sind nur Komfort */ }
  return out;
}

/**
 * Alte Tabelle stilllegen: Einstellungen (ab 1.0 hört ihr Code darauf) und ein erstes Blatt mit dem Hinweis. Ein
 * eigenes Blatt, das zufällig „Übernommen“ heißt, bleibt: Der Hinweis kommt dann in „Übernommen (Hinweis)“.
 * -> Name des Hinweisblatts
 */
function updMarkOld_(old, st, newUrl, when) {
  let name = st.map.TAKEN_OVER_BY ? (st.map.TAKEN_OVER_SHEET || SHEETS.takenOver) : '';
  let sh = name ? old.getSheetByName(name) : null;
  if (!sh) {
    const base = SHEETS.takenOver;
    name = base;
    for (let i = 1; old.getSheetByName(name); i++) name = base + (i === 1 ? ' (Hinweis)' : ' (Hinweis ' + i + ')');
  }
  writeSettings_(old, { TAKEN_OVER_BY: newUrl, TAKEN_OVER_AT: when, TAKEN_OVER_SHEET: name });
  let created = false;
  try {
    if (sh) sh.clear(); else { sh = old.insertSheet(name, 0); created = true; }
    updWriteNotice_(old, sh, st, newUrl, when);
  } catch (e) {
    // sonst wäre die alte Tabelle stillgelegt, ohne dass die Übernahme fertig ist
    try { writeSettings_(old, { TAKEN_OVER_BY: st.map.TAKEN_OVER_BY || '', TAKEN_OVER_AT: st.map.TAKEN_OVER_AT || '', TAKEN_OVER_SHEET: st.map.TAKEN_OVER_SHEET || '' }); } catch (e2) { /* bleibt markiert */ }
    try { if (created) old.deleteSheet(sh); } catch (e3) { /* halbes Hinweisblatt bleibt */ }
    throw e;
  }
  return name;
}

/** Text des Hinweisblatts sh in der alten Tabelle. */
function updWriteNotice_(old, sh, st, newUrl, when) {
  const lines = [
    ['Diese Tabelle wurde übernommen'],
    [''],
    ['Am ' + when + ' wurden alle Daten in eine neue Tabelle übernommen. Bitte mach nur noch dort weiter.'],
    [newUrl],
    ['Die Daten hier bleiben zum Nachsehen. Du kannst diese Tabelle auch löschen, wenn du sie nicht mehr brauchst.']
  ];
  // Code vor 1.0 kennt das Stilllegen nicht: Auslöser von Hand löschen, sonst läuft nachts der Preisabruf weiter
  const manual = [['Damit hier nachts keine Preise mehr abgerufen werden: Erweiterungen > Apps Script öffnen, links auf „Trigger“ (Wecker) klicken und jeden Trigger über ⋮ > „Trigger löschen“ entfernen.'],
    [''], ['Hast du die Handy-Seite (Web-App) dieser Tabelle benutzt: In Apps Script auf Bereitstellen > Bereitstellungen verwalten klicken, die Web-App auswählen und „Archivieren“ wählen. Speichere am Handy danach den Link der neuen Tabelle (dort Pokémon > Web-App-Link anzeigen).']];
  if (st.map.CODE_VERSION) {
    // ab 1.0 legt sich die Tabelle selbst still; läuft hier doch wieder älterer Code, hilft nur der Weg von Hand
    lines.push([''], ['Willst du doch hier weitermachen: Pokémon > Diese Tabelle wieder benutzen.'],
      [''], ['Zeigt das Menü Pokémon hier nach dem Neuladen noch alle Punkte, läuft in dieser Tabelle eine ältere Version. Dann bitte so:'], ['']);
  } else {
    lines.push(['']);
  }
  manual.forEach(function (l) { lines.push(l); });
  sh.getRange(1, 1, lines.length, 1).setValues(lines);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.setColumnWidth(1, 720);
  sh.getRange(1, 1, lines.length, 1).setWrap(true);
  try { old.setActiveSheet(sh); old.moveActiveSheet(1); } catch (e) { /* Reihenfolge ist nur Komfort */ }
}

// ---------------------------------------------------------------------------
// 4. Stilllegen rückgängig
// ---------------------------------------------------------------------------

/**
 * Menü einer stillgelegten Tabelle: doch hier weitermachen. Menü, Seitenleiste und der nächtliche Preislauf kommen
 * zurück; das Hinweisblatt verschwindet. Die neue Tabelle bleibt, wie sie ist.
 */
function wiederBenutzen() {
  const ui = SpreadsheetApp.getUi();
  const url = takenOverBy_();
  if (!url) { alert_('Diese Tabelle ist nicht stillgelegt.'); return; }
  const answer = ui.alert('Diese Tabelle wieder benutzen?',
    'Sie bekommt ihr Menü und den nächtlichen Preislauf zurück. Was du seit der Übernahme in der neuen Tabelle geändert hast, fehlt hier.\n\n' +
    'Die neue Tabelle läuft sonst weiter. Lösch sie danach, wenn du sie nicht mehr brauchst:\n' + url, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  const ss = ss_();
  const note = settingGet_('TAKEN_OVER_SHEET');
  settingsSetMany_({ TAKEN_OVER_BY: '', TAKEN_OVER_AT: '', TAKEN_OVER_SHEET: '', NEW_COPY_URL: '', NEW_COPY_VERSION: '' });
  const sh = note ? ss.getSheetByName(note) : null;
  if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
  try {
    const n = ss.getName();
    if (/ \(alt\)$/.test(n)) ss.rename(n.replace(/ \(alt\)$/, ''));
  } catch (e) { /* Name ist nur Komfort */ }
  setupTriggers_();
  alert_('Diese Tabelle ist wieder aktiv. Bitte lade sie einmal neu, damit das ganze Menü erscheint.');
}
