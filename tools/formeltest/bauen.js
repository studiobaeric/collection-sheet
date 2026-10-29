#!/usr/bin/env node
'use strict';
/**
 * Formeltest für 1.2.0 (#43) zusammenbauen: Formel-Bausteine aus src/Code.gs plus Ablauf (tools/formeltest/ablauf.gs)
 * in eine Skriptdatei, die man in eine Tabelle mit 1.1.3 einfügt. Dort prüft sie die neuen Formeln mit den echten Daten
 * gegen die Rechnung von 1.1.3 und misst, wie schnell Sheets nachrechnet.
 *
 *   node tools/formeltest/bauen.js [Ziel]   Standard: tools/formeltest/Formeltest.gs
 *
 * Alles steckt in FT_: Die Bausteine heißen wie in 1.1.3 (GROUP_HEADERS, viewFormula_ …) und verdecken dort nur innerhalb
 * von FT_ die alten. Von außen gibt es nur formeltest() (im Apps-Script-Editor zum Ausführen) und FT_.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CODE = path.join(ROOT, 'src', 'Code.gs');
const ABLAUF = path.join(__dirname, 'ablauf.gs');
const TARGET = path.resolve(process.argv[2] || path.join(__dirname, 'Formeltest.gs'));

/** Aus Code.gs (1.2.0), in dieser Reihenfolge; alles andere nimmt der Test aus der Tabelle (1.1.3). */
const TAKE = [
  'GROUP_HEADERS', 'GCOL', 'DEX_IDS_HEADERS', 'DEX_MAP_RANGE', 'LET_RESERVED',
  'groupFormatRow_', 'formulaSheets_', 'fref_', 'gref_', 'round2Formula_', 'letFormula_', 'filterRows_', 'listWithHint_',
  'ymdToDmyFormula_', 'letSuffix_', 'joinPerGroupPairs_', 'groupsFormula_', 'dexStatsFormula_', 'dexListFormula_',
  'dexCardFormula_', 'dmyFormula_', 'dashFormulas_', 'viewFormula_', 'dexKey_', 'dexMapOf_', 'dexStaticRows_'
];

/** Eine Funktion oder Konstante samt Kommentar direkt darüber. Funktionen enden mit „}“ am Zeilenanfang. */
function extract(lines, name) {
  const re = new RegExp('^(function ' + name + '\\(|const ' + name + ' = )');
  const hits = [];
  lines.forEach((l, i) => { if (re.test(l)) hits.push(i); });
  if (hits.length !== 1) throw new Error(name + ': ' + hits.length + ' Stellen in src/Code.gs statt einer');
  const start = hits[0];
  let end = start;
  const done = lines[start].startsWith('function ') ? l => l === '}' : l => /;\s*(\/\/.*)?$/.test(l);
  while (end < lines.length && !done(lines[end])) end++;
  if (end >= lines.length) throw new Error(name + ': Ende nicht gefunden');
  let from = start;
  while (from > 0 && /^(\/\*\*|\s+\*|\/\/)/.test(lines[from - 1])) from--;
  return lines.slice(from, end + 1).join('\n');
}

const indent = s => s.split('\n').map(l => (l ? '  ' + l : l)).join('\n');

function build() {
  const lines = fs.readFileSync(CODE, 'utf8').split('\n');
  const parts = TAKE.map(n => extract(lines, n));
  const ablauf = fs.readFileSync(ABLAUF, 'utf8').replace(/\s+$/, '');
  const out = [
    '// Formeltest für Pokémon-Sammlung 1.2.0 (#43). Vorübergehend: nach dem Test diese Datei wieder löschen.',
    '// Er rechnet die neuen Formeln mit deinen echten Daten nach und vergleicht sie mit der Rechnung deiner Version.',
    '// Daten, Sammlung, Pokédex und Dashboard ändert er nicht. Er legt nur das Blatt „Formeltest“ mit dem Ergebnis an;',
    '// seine Hilfsblätter „FT …“ löscht er am Ende wieder.',
    '// So geht es: Erweiterungen > Apps Script > neue Skriptdatei „Formeltest“, diesen Text einfügen, speichern, oben',
    '// die Funktion „formeltest“ wählen und „Ausführen“.',
    '// Gebaut von tools/formeltest/bauen.js aus src/Code.gs und tools/formeltest/ablauf.gs.',
    '',
    'function formeltest() {',
    '  FT_.run();',
    '}',
    '',
    'const FT_ = (function () {',
    '  // -------------------------------------------------------------------------',
    '  // Formel-Bausteine aus 1.2.0 (src/Code.gs)',
    '  // -------------------------------------------------------------------------',
    '',
    indent(parts.join('\n\n')),
    '',
    ablauf,
    '})();',
    ''
  ].join('\n');
  new vm.Script(out, { filename: path.basename(TARGET) }); // nur Syntax prüfen
  fs.writeFileSync(TARGET, out);
  return { target: TARGET, bytes: Buffer.byteLength(out), lines: out.split('\n').length };
}

if (require.main === module) {
  const r = build();
  console.log('Formeltest gebaut: ' + path.relative(process.cwd(), r.target) + ' (' + r.lines + ' Zeilen, ' + Math.round(r.bytes / 1024) + ' KB)');
}

module.exports = { build, TAKE };
