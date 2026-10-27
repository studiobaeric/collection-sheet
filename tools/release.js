#!/usr/bin/env node
'use strict';
/**
 * Release-Eintrag in releases/channel.json schreiben (Version und Datenformat aus src/Code.gs, Notizen und Datum aus
 * CHANGELOG.md).
 *
 *   node tools/release.js [--prerelease|--final] [--template URL] [--date 2026-10-21]
 *   node tools/release.js --main-template URL   nur die Hauptvorlage des Kanals (templateUrl) setzen
 *   node tools/release.js --check     prüft nur, ob Kanal, CHANGELOG.md und die Köpfe der Dateien zur Version passen (sonst Exit 1)
 *   node tools/release.js --stamp     schreibt nur die Version in den Kopfkommentar der Script- und HTML-Dateien
 *   node tools/release.js --print-notes v1.1.0   gibt die Notizen einer Version als Markdown aus (GitHub-Release)
 *
 * CHANGELOG.md ist die Quelle der Notizen: Ein Lauf nimmt die Punkte unter „## [TOOL_VERSION]“, trägt dort das Datum
 * ein, wenn es fehlt (--date, sonst das bisherige aus dem Kanal oder heute), und gleicht Notizen und Datum aller
 * Versionen im Kanal mit CHANGELOG.md ab. Die Tabellen lesen den Kanal und zeigen neuere Versionen an. „Neue Version
 * holen“ kopiert die Vorlage des Releases (--template, sonst templateUrl des Kanals; eine Vorabversion braucht ihre
 * eigene). Steht die Version schon im Kanal, bleiben Vorabversion und Vorlage, solange keine Option sie ändert. Fehlt
 * eine Vorlage, warnt --check nur (Exit 0): Dann erscheint in den Tabellen „Neue Version holen“ nicht. Jeder Lauf
 * schreibt die Version auch oben in die Script- und HTML-Dateien (HEADER_FILES). Schritte: docs/RELEASE.md.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANNEL = path.join(ROOT, 'releases', 'channel.json');
const CHANGELOG = 'CHANGELOG.md'; // im Repo-Ordner
const REPO = 'studiobaeric/collection-sheet';
/** Dateien, die ins Apps-Script-Projekt gehören (für die Anleitung „Von Hand aktualisieren“). */
const FILES = ['src/appsscript.json', 'src/Code.gs', 'src/Import.gs', 'src/Update.gs', 'src/Ui.html', 'src/ImportUi.html'];
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/;
/** Dateien mit der Version im Kopfkommentar; parts/00_shared.gs ist der Anfang von src/Import.gs (build_import.sh). */
const HEADER_FILES = ['src/Code.gs', 'src/Import.gs', 'parts/00_shared.gs', 'src/Update.gs', 'src/Ui.html', 'src/ImportUi.html'];
const HEADER_RE = /Pokémon-Sammlung · Version (\S+)/;
const HEADER_LINES = 8; // der Kopf muss in den ersten Zeilen stehen
/** Versions-Konstante, mit der das Tool selbst prüft, ob alle Dateien zusammenpassen (#35); Code.gs hat TOOL_VERSION */
const CONST_RE = /\b((?:[A-Z]+_FILE_VERSION|impFileVersion) = ')([^']*)(')/g; // ImportUi.html: alle Namen dort beginnen mit imp
const CONST_FILES = ['src/Import.gs', 'parts/00_shared.gs', 'src/Update.gs', 'src/Ui.html', 'src/ImportUi.html'];
/** Release-Notizen sind kurze Stichpunkte (Eric, 23.10.2026); längere Punkte meldet das Werkzeug als Hinweis */
const NOTE_MAX = 70;
const longNotes = notes => cleanNotes(notes).filter(n => n.length > NOTE_MAX)
  .map(n => 'Punkt länger als ' + NOTE_MAX + ' Zeichen, bitte als Stichpunkt kürzen: „' + n + '“');
/** Überschrift eines Abschnitts in CHANGELOG.md: „## [1.2.0]“ oder „## [1.2.0] – 2026-11-01“ */
const SECTION_RE = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?:\s+[–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

const readRepo = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readChangelog = () => (fs.existsSync(path.join(ROOT, CHANGELOG)) ? readRepo(CHANGELOG) : '');
const today = () => new Date().toISOString().slice(0, 10);

function codeConst(code, name) {
  const m = code.match(new RegExp('^const ' + name + " = '([^']*)';", 'm'));
  if (!m) throw new Error(name + ' nicht in src/Code.gs gefunden');
  return m[1];
}

function readChannel() {
  if (!fs.existsSync(CHANNEL)) {
    return { repo: REPO, templateUrl: '', guideUrl: 'https://github.com/' + REPO + '#von-hand-aktualisieren', releases: [] };
  }
  return JSON.parse(fs.readFileSync(CHANNEL, 'utf8'));
}

function readCode() {
  return readRepo('src/Code.gs');
}

/**
 * Eintrag für den Stand im Arbeitsordner (code: Inhalt von src/Code.gs, changelog: Inhalt von CHANGELOG.md, sonst
 * gelesen). Notizen und Datum aus dem Abschnitt der Version in CHANGELOG.md (Datum: opts.date geht vor, ohne beides heute).
 */
function buildEntry(opts, code, changelog) {
  code = code == null ? readCode() : code;
  const version = codeConst(code, 'TOOL_VERSION');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('TOOL_VERSION ist keine gültige Version: ' + version);
  FILES.forEach(f => { if (!fs.existsSync(path.join(ROOT, f))) throw new Error(f + ' fehlt'); });
  const sec = changelogSection(changelog == null ? readChangelog() : changelog, version);
  const entry = {
    version,
    tag: 'v' + version,
    date: opts.date || (sec && sec.date) || today(),
    prerelease: opts.prerelease === undefined ? /-/.test(version) : !!opts.prerelease,
    schema: codeConst(code, 'SCHEMA_VERSION'),
    notes: sec ? sec.notes.slice() : []
  };
  if (opts.template) entry.templateUrl = opts.template;
  return entry;
}

/** Wie updCompare_ in Update.gs: neueste zuerst. */
function cmp(a, b) {
  const p = v => { const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/); return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const s = x.pre[i], t = y.pre[i], sn = /^\d+$/.test(s), tn = /^\d+$/.test(t);
    if (sn && tn && +s !== +t) return +s - +t;
    if (sn !== tn) return sn ? -1 : 1;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}

/** Kopfkommentar mit der Version: für .gs ein Block-Kommentar, für .html ein HTML-Kommentar */
function header(version, html) {
  const bar = '='.repeat(74);
  const lines = ['Pokémon-Sammlung · Version ' + version, 'https://github.com/' + REPO];
  return html
    ? '<!-- ' + bar + '\n' + lines.map(l => '     ' + l + '\n').join('') + '     ' + bar + ' -->\n'
    : '/* ' + bar + '\n' + lines.map(l => ' *  ' + l + '\n').join('') + ' * ' + bar + ' */\n\n';
}

/** Version im Kopfkommentar von text, sonst null */
function headerVersion(text) {
  const m = HEADER_RE.exec(String(text).split('\n').slice(0, HEADER_LINES).join('\n'));
  return m ? m[1] : null;
}

/** text mit version im Kopf: ersetzt die Version im vorhandenen Kopf, sonst kommt der Kopf an den Anfang (bei HTML nach <!DOCTYPE>) */
function stampText(text, version, html) {
  text = text.replace(CONST_RE, (all, a, v, b) => a + version + b);
  if (headerVersion(text) !== null) return text.replace(HEADER_RE, 'Pokémon-Sammlung · Version ' + version);
  const m = html && text.match(/^<!DOCTYPE[^>]*>\r?\n/i);
  return m ? m[0] + header(version, true) + text.slice(m[0].length) : header(version, html) + text;
}

/** Werte der Versions-Konstanten in text */
const constVersions = text => [...String(text).matchAll(CONST_RE)].map(m => m[2]);

const isHtml = f => /\.html$/.test(f);

/** -> Abweichungen der Kopfkommentare von version, je Datei eine Zeile (read: Datei -> Inhalt, sonst aus dem Repo) */
function headerDiffs(version, read) {
  read = read || readRepo;
  return HEADER_FILES.map(f => {
    const text = read(f), v = headerVersion(text);
    if (v !== version) return f + ': ' + (v === null ? 'kein Kopf mit der Version' : 'Version ' + v);
    if (CONST_FILES.indexOf(f) < 0) return null;
    const c = constVersions(text);
    if (!c.length) return f + ': keine Versions-Konstante (…_FILE_VERSION)';
    const bad = c.filter(x => x !== version);
    return bad.length ? f + ': Versions-Konstante ist ' + bad[0] : null;
  }).filter(Boolean);
}

/** Schreibt version in den Kopf aller HEADER_FILES -> die geänderten Dateien */
function stamp(version) {
  return HEADER_FILES.filter(f => {
    const old = readRepo(f), text = stampText(old, version, isHtml(f));
    if (text !== old) fs.writeFileSync(path.join(ROOT, f), text);
    return text !== old;
  });
}

const cleanNotes = notes => (notes || []).map(n => String(n == null ? '' : n).trim()).filter(Boolean);

/**
 * CHANGELOG.md zerlegen -> [{version, date, notes}] in der Reihenfolge der Datei. Ein Abschnitt beginnt mit
 * „## [1.2.0]“ (Datum dahinter mit – oder -) und endet bei der nächsten Überschrift # oder ##. Punkte beginnen mit
 * „- “, eingerückte Zeilen darunter gehören zum Punkt davor.
 */
function parseChangelog(text) {
  const out = [];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach(l => {
    const m = SECTION_RE.exec(l);
    if (m) { cur = { version: m[1], date: m[2] || '', notes: [] }; out.push(cur); return; }
    if (/^#{1,2}\s/.test(l)) { cur = null; return; }
    if (!cur) return;
    const b = /^[-*]\s+(.*)$/.exec(l);
    if (b) cur.notes.push(b[1]);
    else if (/^\s+\S/.test(l) && cur.notes.length) cur.notes[cur.notes.length - 1] += ' ' + l.trim();
  });
  out.forEach(s => { s.notes = cleanNotes(s.notes); });
  return out;
}

/** Abschnitt einer Version (auch als Tag „v…“) aus CHANGELOG.md, sonst null */
function changelogSection(text, version) {
  const v = String(version).replace(/^v/, '');
  return parseChangelog(text).find(s => s.version === v) || null;
}

/** text mit „## [version] – date“ als Überschrift des Abschnitts der Version */
function setChangelogDate(text, version, date) {
  return String(text).split('\n').map(l => {
    const m = SECTION_RE.exec(l.replace(/\r$/, ''));
    return m && m[1] === version ? '## [' + version + '] – ' + date : l;
  }).join('\n');
}

/** Notizen einer Version (auch als Tag „v…“) als Markdown für den GitHub-Release */
function releaseNotes(text, version) {
  const s = changelogSection(text, version);
  if (!s || !s.notes.length) throw new Error('CHANGELOG.md hat keine Punkte für ' + String(version).replace(/^v/, ''));
  return s.notes.map(n => '- ' + n).join('\n') + '\n\n' +
    'So kommst du zur neuen Version: in der Seitenleiste unter **Updates** auf **Neue Version holen**, oder ' +
    '[von Hand](https://github.com/' + REPO + '#von-hand-aktualisieren). Alle Versionen stehen in ' +
    '[CHANGELOG.md](https://github.com/' + REPO + '/blob/main/CHANGELOG.md).\n';
}

/** Notizen und Datum aller Versionen im Kanal ch aus CHANGELOG.md (ändert ch; Versionen ohne Punkte dort bleiben) -> geänderte Versionen */
function syncChannel(ch, text) {
  const secs = parseChangelog(text);
  return (ch.releases || []).filter(r => {
    const s = secs.find(x => x.version === r.version);
    if (!s || !s.notes.length) return false;
    const date = s.date || r.date;
    if (JSON.stringify(s.notes) === JSON.stringify(r.notes) && date === r.date) return false;
    r.notes = s.notes.slice();
    r.date = date;
    return true;
  }).map(r => r.version);
}

/** -> Abweichungen zwischen Kanal und CHANGELOG.md: jede Version im Kanal braucht dort einen Abschnitt mit denselben Punkten (und Datum) */
function changelogDiffs(ch, text) {
  const secs = parseChangelog(text), diffs = [], seen = {};
  secs.forEach(s => { if (seen[s.version]) diffs.push('CHANGELOG.md: Abschnitt [' + s.version + '] doppelt'); seen[s.version] = true; });
  (ch.releases || []).forEach(r => {
    const s = secs.find(x => x.version === r.version);
    if (!s) { diffs.push('CHANGELOG.md: kein Abschnitt [' + r.version + ']'); return; }
    if (JSON.stringify(s.notes) !== JSON.stringify(cleanNotes(r.notes))) diffs.push(r.version + ': Notizen anders als in CHANGELOG.md');
    if (s.date && s.date !== r.date) diffs.push(r.version + ': Datum ' + r.date + ' statt ' + s.date + ' wie in CHANGELOG.md');
  });
  return diffs;
}

/**
 * -> {version, missing, diffs, headers, warnings}: Abweichungen zwischen dem Kanal und dem Code oder CHANGELOG.md
 * (diffs: Exit 1), Köpfe mit anderer Version (headers: Exit 1), warnings: keine Vorlage für diese Version.
 * code/ch/read: zum Testen, sonst aus dem Repo.
 */
function check(code, ch, read) {
  read = read || readRepo;
  let changelog = '';
  try { changelog = read(CHANGELOG); } catch (e) { changelog = ''; }
  const entry = buildEntry({}, code, changelog);
  ch = ch || readChannel();
  const diffs = [], warnings = [], headers = headerDiffs(entry.version, read);
  if (ch.templateUrl && !SHEET_URL.test(ch.templateUrl)) diffs.push('templateUrl des Kanals ist kein Tabellen-Link');
  const rel = (ch.releases || []).find(r => r.version === entry.version);
  if (!rel) return { version: entry.version, missing: true, diffs, headers, warnings };
  if (rel.tag !== entry.tag) diffs.push('tag ' + rel.tag + ' statt ' + entry.tag);
  if (String(rel.schema) !== entry.schema) diffs.push('schema ' + rel.schema + ' statt ' + entry.schema);
  if (!cleanNotes(rel.notes).length) diffs.push('keine Notizen');
  if (rel.templateUrl && !SHEET_URL.test(rel.templateUrl)) diffs.push('templateUrl ist kein Tabellen-Link');
  if (rel.files || rel.scopes) diffs.push('alte Felder files/scopes (die Tabellen laden keinen Code mehr)');
  changelogDiffs(ch, changelog).forEach(d => diffs.push(d));
  longNotes(rel.notes).forEach(w => warnings.push(w));
  const tpl = rel.templateUrl || (rel.prerelease ? '' : ch.templateUrl);
  if (!tpl) warnings.push(rel.prerelease ? 'Diese Vorabversion hat keine eigene Vorlage (--template): Freiwillige bekommen sie nur von Hand.'
    : 'Der Kanal hat noch keine Vorlage (--main-template): „Neue Version holen“ erscheint in den Tabellen nicht.');
  return { version: entry.version, missing: false, diffs, headers, warnings };
}

function parseArgs(argv) {
  const o = {};
  const value = (a, i) => {
    const v = argv[i];
    if (v === undefined || /^--/.test(v) || !String(v).trim()) throw new Error(a + ' braucht einen Wert');
    return String(v).trim();
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--stamp') o.stamp = true;
    else if (a === '--prerelease') o.prerelease = true;
    else if (a === '--final') o.prerelease = false;
    else if (a === '--notes') throw new Error('--notes gibt es nicht mehr: Die Notizen stehen in CHANGELOG.md (docs/RELEASE.md).');
    else if (a === '--print-notes') o.printNotes = value(a, ++i);
    else if (a === '--date') o.date = value(a, ++i);
    else if (a === '--template') o.template = value(a, ++i);
    else if (a === '--main-template') o.mainTemplate = value(a, ++i);
    else throw new Error('Unbekannte Option: ' + a);
  }
  if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date bitte als JJJJ-MM-TT');
  [['--template', o.template], ['--main-template', o.mainTemplate]].forEach(([n, v]) => {
    if (v && !SHEET_URL.test(v)) throw new Error(n + ' bitte als Link einer Google-Tabelle (https://docs.google.com/spreadsheets/d/…)');
  });
  return o;
}

/**
 * Eintrag entry in den Kanal ch übernehmen (ändert ch). Notizen und Datum bringt entry aus CHANGELOG.md mit. Steht
 * die Version schon drin, bleiben Vorabversion und Vorlage, solange o sie nicht setzt. -> {entry, old}
 */
function nextChannel(ch, entry, o) {
  const old = (ch.releases || []).find(r => r.version === entry.version);
  entry.notes = cleanNotes(entry.notes);
  if (old && o.prerelease === undefined && typeof old.prerelease === 'boolean') entry.prerelease = old.prerelease;
  if (old && !o.template && old.templateUrl) entry.templateUrl = old.templateUrl;
  if (!entry.notes.length) throw new Error('CHANGELOG.md: Unter „## [' + entry.version + ']“ steht noch kein Punkt (was ist neu?).');
  ch.repo = ch.repo || REPO;
  ch.releases = (ch.releases || []).filter(r => r.version !== entry.version).concat([entry]).sort((a, b) => cmp(b.version, a.version));
  return { entry, old };
}

function writeChannel(ch) {
  fs.mkdirSync(path.dirname(CHANNEL), { recursive: true });
  fs.writeFileSync(CHANNEL, JSON.stringify(ch, null, 2) + '\n');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.printNotes) {
    process.stdout.write(releaseNotes(readChangelog(), o.printNotes));
    return 0;
  }
  if (o.stamp) {
    const version = codeConst(readCode(), 'TOOL_VERSION');
    const files = stamp(version);
    console.log('Version ' + version + ' oben in den Dateien: ' + (files.length ? 'geändert in ' + files.join(', ') : 'schon überall') + '.');
    return 0;
  }
  if (o.check) {
    const r = check();
    r.warnings.forEach(w => console.log('Hinweis: ' + w));
    if (r.headers.length) {
      console.log('Oben in diesen Dateien steht nicht Version ' + r.version + ':\n  ' + r.headers.join('\n  ') + '\nBitte node tools/release.js --stamp ausführen.');
    }
    if (r.missing) {
      console.log('Version ' + r.version + ' steht noch nicht in releases/channel.json. Bitte in CHANGELOG.md den Abschnitt „## [' + r.version +
        ']“ anlegen und node tools/release.js ausführen.');
      return 1;
    }
    if (r.diffs.length) {
      console.log('releases/channel.json passt nicht zu Version ' + r.version + ':\n  ' + r.diffs.join('\n  ') + '\nBitte node tools/release.js erneut ausführen.');
      return 1;
    }
    if (r.headers.length) return 1;
    console.log('releases/channel.json, CHANGELOG.md und die Köpfe der Dateien passen zu Version ' + r.version + '.');
    return 0;
  }
  const ch = readChannel();
  if (o.mainTemplate) {
    ch.templateUrl = o.mainTemplate;
    if (o.prerelease === undefined && !o.date && !o.template) {
      writeChannel(ch);
      console.log('Hauptvorlage gesetzt: ' + o.mainTemplate);
      return 0;
    }
  }
  const version = codeConst(readCode(), 'TOOL_VERSION');
  let text = readChangelog();
  const sec = changelogSection(text, version);
  if (!sec || !sec.notes.length) {
    throw new Error('CHANGELOG.md: Bitte oben einen Abschnitt „## [' + version + ']“ mit einem Punkt je Neuerung anlegen.');
  }
  const known = (ch.releases || []).find(r => r.version === version);
  const date = o.date || sec.date || (known && known.date) || today();
  if (date !== sec.date) {
    text = setChangelogDate(text, version, date);
    fs.writeFileSync(path.join(ROOT, CHANGELOG), text);
  }
  const { entry, old } = nextChannel(ch, buildEntry(o, null, text), o);
  const synced = syncChannel(ch, text).filter(v => v !== entry.version);
  writeChannel(ch);
  const stamped = stamp(entry.version);
  console.log((old ? 'Aktualisiert' : 'Neu') + ': ' + entry.version + (entry.prerelease ? ' (Vorabversion)' : '') + ', Datenformat ' + entry.schema +
    ', ' + entry.notes.length + ' Punkte aus CHANGELOG.md.');
  if (date !== sec.date) console.log('Datum ' + date + ' in CHANGELOG.md eingetragen.');
  if (synced.length) console.log('Notizen aus CHANGELOG.md übernommen für ' + synced.join(', ') + '.');
  longNotes(entry.notes).forEach(w => console.log('Hinweis: ' + w));
  if (stamped.length) console.log('Version oben eingetragen in ' + stamped.join(', ') + '.');
  if (entry.prerelease && !entry.templateUrl) console.log('Achtung: Ohne --template können Freiwillige diese Vorabversion nur von Hand einfügen.');
  console.log('Weiter: ' + (entry.prerelease
    ? 'nur die Vorlage der Vorabversion (--template) auf diese Version bringen, die Hauptvorlage nicht anfassen'
    : 'die Hauptvorlage auf diese Version bringen') + ', dann committen, Pull Request, mergen, ' + entry.tag +
    ' taggen; den GitHub-Release legt dann .github/workflows/release.yml an (docs/RELEASE.md).');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = {
  CONST_FILES, FILES, HEADER_FILES, buildEntry, constVersions, changelogDiffs, changelogSection, check, cleanNotes, cmp, header, headerDiffs, headerVersion,
  nextChannel, parseArgs, parseChangelog, releaseNotes, setChangelogDate, stampText, syncChannel
};
