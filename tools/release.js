#!/usr/bin/env node
'use strict';
/**
 * Release-Eintrag in releases/channel.json schreiben (Version und Datenformat aus src/Code.gs).
 *
 *   node tools/release.js --notes "Erster Punkt" --notes "Zweiter Punkt" [--prerelease|--final] [--template URL] [--date 2026-10-21]
 *   node tools/release.js --main-template URL   nur die Hauptvorlage des Kanals (templateUrl) setzen
 *   node tools/release.js --check     prüft nur, ob die aktuelle Version im Kanal und oben in den Dateien steht (sonst Exit 1)
 *   node tools/release.js --stamp     schreibt nur die Version in den Kopfkommentar der Script- und HTML-Dateien
 *
 * Die Tabellen lesen den Kanal und zeigen neuere Versionen an. „Neue Version holen“ kopiert die Vorlage des
 * Releases (--template, sonst templateUrl des Kanals; eine Vorabversion braucht ihre eigene). Steht die Version
 * schon im Kanal, bleiben Notizen, Datum, Vorabversion und Vorlage, solange keine Option sie ändert. Fehlt eine
 * Vorlage, warnt --check nur (Exit 0): Dann erscheint in den Tabellen „Neue Version holen“ nicht.
 * Jeder Release-Eintrag schreibt die Version auch oben in die Script- und HTML-Dateien (HEADER_FILES).
 * Schritte: docs/RELEASE.md.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANNEL = path.join(ROOT, 'releases', 'channel.json');
const REPO = 'studiobaeric/collection-sheet';
/** Dateien, die ins Apps-Script-Projekt gehören (für die Anleitung „Von Hand aktualisieren“). */
const FILES = ['src/appsscript.json', 'src/Code.gs', 'src/Import.gs', 'src/Update.gs', 'src/Ui.html', 'src/ImportUi.html'];
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/;
/** Dateien mit der Version im Kopfkommentar; parts/00_shared.gs ist der Anfang von src/Import.gs (build_import.sh). */
const HEADER_FILES = ['src/Code.gs', 'src/Import.gs', 'parts/00_shared.gs', 'src/Update.gs', 'src/Ui.html', 'src/ImportUi.html'];
const HEADER_RE = /Pokémon-Sammlung · Version (\S+)/;
const HEADER_LINES = 8; // der Kopf muss in den ersten Zeilen stehen

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
  return fs.readFileSync(path.join(ROOT, 'src/Code.gs'), 'utf8');
}

/** Eintrag für den Stand im Arbeitsordner (code: Inhalt von src/Code.gs, sonst gelesen). */
function buildEntry(opts, code) {
  code = code == null ? readCode() : code;
  const version = codeConst(code, 'TOOL_VERSION');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('TOOL_VERSION ist keine gültige Version: ' + version);
  FILES.forEach(f => { if (!fs.existsSync(path.join(ROOT, f))) throw new Error(f + ' fehlt'); });
  const entry = {
    version,
    tag: 'v' + version,
    date: opts.date || new Date().toISOString().slice(0, 10),
    prerelease: opts.prerelease === undefined ? /-/.test(version) : !!opts.prerelease,
    schema: codeConst(code, 'SCHEMA_VERSION'),
    notes: cleanNotes(opts.notes)
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
  if (headerVersion(text) !== null) return text.replace(HEADER_RE, 'Pokémon-Sammlung · Version ' + version);
  const m = html && text.match(/^<!DOCTYPE[^>]*>\r?\n/i);
  return m ? m[0] + header(version, true) + text.slice(m[0].length) : header(version, html) + text;
}

const isHtml = f => /\.html$/.test(f);
const readRepo = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** -> Abweichungen der Kopfkommentare von version, je Datei eine Zeile (read: Datei -> Inhalt, sonst aus dem Repo) */
function headerDiffs(version, read) {
  read = read || readRepo;
  return HEADER_FILES.map(f => {
    const v = headerVersion(read(f));
    return v === version ? null : f + ': ' + (v === null ? 'kein Kopf mit der Version' : 'Version ' + v);
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
 * -> {version, missing, diffs, headers, warnings}: Abweichungen zwischen dem Kanal-Eintrag der aktuellen Version und
 * dem Code (diffs: Exit 1), Köpfe mit anderer Version (headers: Exit 1), warnings: keine Vorlage für diese Version.
 * code/ch/read: zum Testen, sonst aus dem Repo.
 */
function check(code, ch, read) {
  const entry = buildEntry({}, code);
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
  const tpl = rel.templateUrl || (rel.prerelease ? '' : ch.templateUrl);
  if (!tpl) warnings.push(rel.prerelease ? 'Diese Vorabversion hat keine eigene Vorlage (--template): Freiwillige bekommen sie nur von Hand.'
    : 'Der Kanal hat noch keine Vorlage (--main-template): „Neue Version holen“ erscheint in den Tabellen nicht.');
  return { version: entry.version, missing: false, diffs, headers, warnings };
}

function parseArgs(argv) {
  const o = { notes: [] };
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
    else if (a === '--notes') o.notes.push(value(a, ++i));
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
 * Eintrag entry in den Kanal ch übernehmen (ändert ch). Steht die Version schon drin, bleiben Notizen, Datum,
 * Vorabversion und Vorlage, solange o sie nicht setzt. -> {entry, old}
 */
function nextChannel(ch, entry, o) {
  const old = (ch.releases || []).find(r => r.version === entry.version);
  entry.notes = cleanNotes(entry.notes);
  if (old && !cleanNotes(o.notes).length) entry.notes = cleanNotes(old.notes);
  if (old && !o.date) entry.date = old.date || entry.date;
  if (old && o.prerelease === undefined && typeof old.prerelease === 'boolean') entry.prerelease = old.prerelease;
  if (old && !o.template && old.templateUrl) entry.templateUrl = old.templateUrl;
  if (!entry.notes.length) throw new Error('Bitte mindestens eine Zeile mit --notes angeben (was ist neu?).');
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
      console.log('Version ' + r.version + ' steht noch nicht in releases/channel.json. Bitte node tools/release.js --notes "…" ausführen.');
      return 1;
    }
    if (r.diffs.length) {
      console.log('releases/channel.json passt nicht zu Version ' + r.version + ':\n  ' + r.diffs.join('\n  ') + '\nBitte node tools/release.js erneut ausführen.');
      return 1;
    }
    if (r.headers.length) return 1;
    console.log('releases/channel.json und die Köpfe der Dateien passen zu Version ' + r.version + '.');
    return 0;
  }
  const ch = readChannel();
  if (o.mainTemplate) {
    ch.templateUrl = o.mainTemplate;
    if (!o.notes.length && o.prerelease === undefined && !o.date && !o.template) {
      writeChannel(ch);
      console.log('Hauptvorlage gesetzt: ' + o.mainTemplate);
      return 0;
    }
  }
  const { entry, old } = nextChannel(ch, buildEntry(o), o);
  writeChannel(ch);
  const stamped = stamp(entry.version);
  console.log((old ? 'Aktualisiert' : 'Neu') + ': ' + entry.version + (entry.prerelease ? ' (Vorabversion)' : '') + ', Datenformat ' + entry.schema + '.');
  if (stamped.length) console.log('Version oben eingetragen in ' + stamped.join(', ') + '.');
  if (entry.prerelease && !entry.templateUrl) console.log('Achtung: Ohne --template können Freiwillige diese Vorabversion nur von Hand einfügen.');
  console.log('Weiter: ' + (entry.prerelease
    ? 'nur die Vorlage der Vorabversion (--template) auf diese Version bringen, die Hauptvorlage nicht anfassen'
    : 'die Hauptvorlage auf diese Version bringen') + ', dann committen, Pull Request, mergen, ' + entry.tag + ' taggen (docs/RELEASE.md).');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { FILES, HEADER_FILES, buildEntry, check, cleanNotes, cmp, header, headerDiffs, headerVersion, nextChannel, parseArgs, stampText };
