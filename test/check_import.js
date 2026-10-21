'use strict';
/**
 * Statische Prüfung von Import.gs zusammen mit Code.gs (ohne Netz, ohne Parser-Bibliothek):
 *  1. Syntax (vm.Script) beider Dateien.
 *  2. Ladereihenfolge: Import.gs allein und vor Code.gs in einem Kontext laden (kein Zugriff auf Code.gs-Konstanten
 *     auf oberster Ebene, keine doppelten const/let).
 *  3. Keine doppelten Namen auf oberster Ebene (function/const/let/var) über Code.gs + Import.gs.
 *  4. Jede öffentliche Funktion in Import.gs ruft zuerst ensureSchema_() auf.
 *  5. In withLock_-Rümpfen von Import.gs (transitiv über private Helfer): kein withLock_ (Verschachtelung),
 *     kein ensureSchema_/migrateSchema_, keine öffentliche Funktion, kein UrlFetchApp/fetchJson_/fetchAllJson_.
 *  5b. Keine Schreibzugriffe auf Blätter außerhalb von withLock_ (transitiv; Ausnahme setReleaseDate_).
 *  6. Keine Gedankenstriche (—) und keine unsichtbaren Zeichen (NBSP, kombinierende Zeichen …) in Import.gs.
 * Aufruf: node check_import.js [srcDir]; Exit-Code 1 bei Fehlern.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = process.argv[2] || path.join(__dirname, '..', 'src');
const codeSrc = fs.readFileSync(path.join(srcDir, 'Code.gs'), 'utf8');
const impSrc = fs.readFileSync(path.join(srcDir, 'Import.gs'), 'utf8');
const errors = [];
const infos = [];
const err = (m) => errors.push(m);

/** Strings, Kommentare, Regex- und Template-Literale durch Leerzeichen ersetzen (Zeilen bleiben erhalten). */
function blank(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prev = ''; // letztes bedeutsames Zeichen/Wort
  const wipe = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%<>~^]$|^(return|typeof|case|in|of|new|delete|void|throw|else|do)$/;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; wipe(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; wipe(i, end); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      wipe(i + 1, j); i = j + 1; prev = 'str'; continue;
    }
    if (c === '/' && (prev === '' || regexAllowedAfter.test(prev))) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        else if (ch === '\n') break;
        j++;
      }
      wipe(i + 1, j); i = j + 1;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      prev = 'regex'; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      prev = src.slice(i, j); i = j; continue;
    }
    if (/\d/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; prev = 'num'; i = j; continue; }
    prev = c; i++;
  }
  return out.join('');
}

/** Funktionen auf oberster Ebene: {name: {body (blanked), start, end, line}}; dazu Top-Level-Namen. */
function scan(src, file) {
  const b = blank(src);
  const fns = {};
  const tops = [];
  const re = /^(function\s+([A-Za-z_$][\w$]*)\s*\(|(const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm;
  let m;
  while ((m = re.exec(b))) {
    const name = m[2] || m[4];
    tops.push({ name, kind: m[2] ? 'function' : m[3], file, line: b.slice(0, m.index).split('\n').length });
    if (m[2]) {
      const open = b.indexOf('{', m.index);
      let depth = 0, k = open;
      for (; k < b.length; k++) {
        if (b[k] === '{') depth++;
        else if (b[k] === '}') { depth--; if (depth === 0) break; }
      }
      fns[name] = { body: b.slice(open + 1, k), raw: src.slice(open + 1, k), file, line: tops[tops.length - 1].line };
    }
  }
  return { fns, tops, blanked: b };
}

const code = scan(codeSrc, 'Code.gs');
const imp = scan(impSrc, 'Import.gs');

// 1. Syntax
[['Code.gs', codeSrc], ['Import.gs', impSrc]].forEach(([f, s]) => {
  try { new vm.Script(s, { filename: f }); } catch (e) { err('Syntaxfehler in ' + f + ': ' + e.message); }
});

// 2. Ladereihenfolge (Import.gs zuerst, dann Code.gs; und umgekehrt)
[['Import.gs', 'Code.gs'], ['Code.gs', 'Import.gs']].forEach((order) => {
  const ctx = vm.createContext({});
  try {
    order.forEach((f) => vm.runInContext(f === 'Code.gs' ? codeSrc : impSrc, ctx, { filename: f }));
  } catch (e) {
    err('Laden in der Reihenfolge ' + order.join(' -> ') + ' scheitert: ' + e.message);
  }
});

// 3. Doppelte Namen
const seen = {};
code.tops.concat(imp.tops).forEach((t) => {
  (seen[t.name] = seen[t.name] || []).push(t.file + ':' + t.line + ' (' + t.kind + ')');
});
Object.keys(seen).forEach((n) => { if (seen[n].length > 1) err('Doppelter Name ' + n + ': ' + seen[n].join(', ')); });

// 4. ensureSchema_ zuerst
const isPublic = (n) => !/_$/.test(n);
const allFns = Object.assign({}, code.fns, imp.fns);
const publicNames = Object.keys(allFns).filter(isPublic);
Object.keys(imp.fns).filter(isPublic).forEach((n) => {
  const first = imp.fns[n].body.replace(/^\s+/, '');
  if (!/^ensureSchema_\(\)\s*;/.test(first)) err('Öffentliche Funktion ' + n + ' ruft nicht zuerst ensureSchema_() auf');
});

// 5. Sperr-Regeln (transitiv über private Funktionen)
function calls(body) {
  const out = new Set();
  const re = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) out.add(m[1]);
  if (/\bUrlFetchApp\b/.test(body)) out.add('UrlFetchApp');
  return out;
}
const callMemo = {};
function closure(name, stack) {
  if (callMemo[name]) return callMemo[name];
  const res = new Set();
  const f = allFns[name];
  if (!f) return res;
  if (stack.indexOf(name) >= 0) return res;
  calls(f.body).forEach((c) => {
    res.add(c);
    if (allFns[c] && !isPublic(c) && c !== 'withLock_') closure(c, stack.concat(name)).forEach((x) => res.add(x));
  });
  callMemo[name] = res;
  return res;
}
const forbidden = (c) => c === 'withLock_' || c === 'ensureSchema_' || c === 'migrateSchema_' || c === 'UrlFetchApp' ||
  c === 'fetchJson_' || c === 'fetchAllJson_' || (publicNames.indexOf(c) >= 0);
let lockBodies = 0;
Object.keys(imp.fns).forEach((n) => {
  const b = imp.fns[n].body;
  const re = /withLock_\(\s*function\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(b))) {
    let depth = 1, k = m.index + m[0].length;
    for (; k < b.length && depth; k++) { if (b[k] === '{') depth++; else if (b[k] === '}') depth--; }
    const inner = b.slice(m.index + m[0].length, k - 1);
    lockBodies++;
    const direct = calls(inner);
    const all = new Set(direct);
    direct.forEach((c) => { if (allFns[c] && !isPublic(c) && c !== 'withLock_') closure(c, []).forEach((x) => all.add(x)); });
    all.forEach((c) => {
      if (!forbidden(c)) return;
      // Pfad für die Meldung
      const via = Array.from(direct).filter((d) => d === c || (allFns[d] && closure(d, []).has(c)));
      err('Im Lock von ' + n + ' wird ' + c + ' erreicht (über ' + via.join(', ') + ')');
    });
  }
});
// 5b. Schreibzugriffe auf Blätter außerhalb einer Sperre (transitiv über private Helfer, Sperr-Rümpfe ausgenommen).
// Erlaubt: setReleaseDate_ (Code.gs schreibt den Set-Cache „Sets“ absichtlich ohne Sperre, siehe CORE_API.md).
const WRITE_RE = /\.(setValues|setValue|clearContent|clearContents|clear|insertRowsAfter|insertRowsBefore|deleteRows?|deleteColumns?|insertColumnsAfter|insertColumnsBefore|setNumberFormats?|appendRow|hideSheet|showSheet|insertSheet|deleteSheet|setDataValidation|setFormulas?|setFrozenRows)\(/g;
const OUTSIDE_OK = { setReleaseDate_: true, withLock_: true };
function outsideLocks(body) {
  let out = '', pos = 0;
  const re = /withLock_\(\s*function\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    out += body.slice(pos, m.index);
    let depth = 1, k = m.index + m[0].length;
    for (; k < body.length && depth; k++) { if (body[k] === '{') depth++; else if (body[k] === '}') depth--; }
    pos = k;
    re.lastIndex = k;
  }
  return out + body.slice(pos);
}
const writeMemo = {};
function writesOutside(name, stack) {
  if (writeMemo[name]) return writeMemo[name];
  const f = allFns[name];
  if (!f || OUTSIDE_OK[name] || stack.indexOf(name) >= 0) return [];
  const body = outsideLocks(f.body);
  const found = [];
  let m;
  WRITE_RE.lastIndex = 0;
  while ((m = WRITE_RE.exec(body))) found.push(name + ': .' + m[1]);
  calls(body).forEach((c) => {
    if (allFns[c] && !isPublic(c)) writesOutside(c, stack.concat(name)).forEach((x) => found.push(name + ' > ' + x));
  });
  writeMemo[name] = found;
  return found;
}
Object.keys(imp.fns).filter(isPublic).forEach((n) => {
  writesOutside(n, []).forEach((w) => err('Schreibzugriff ohne Sperre: ' + w));
});

// private Helfer, die selbst withLock_ nehmen, dürfen nur außerhalb einer Sperre laufen: auflisten
Object.keys(imp.fns).filter((n) => !isPublic(n) && /withLock_\(/.test(imp.fns[n].body))
  .forEach((n) => infos.push('privater Helfer mit eigener Sperre: ' + n));

// 6. Gedankenstriche und unsichtbare Zeichen (gehen beim Einfügen in den Apps-Script-Editor leicht verloren)
impSrc.split('\n').forEach((l, i) => {
  if (l.indexOf('—') >= 0) err('Gedankenstrich in Import.gs:' + (i + 1) + ': ' + l.trim());
  if (/[\u00a0\u0300-\u036f\u200b-\u200f\u2028\u2029\ufeff]/.test(l)) err('Unsichtbares Zeichen in Import.gs:' + (i + 1) + ' (bitte als \\u-Escape schreiben)');
});

const nPub = Object.keys(imp.fns).filter(isPublic).length;
infos.forEach((x) => console.log('info ', x));
if (errors.length) {
  errors.forEach((e) => console.log('FEHLER', e));
  console.log('check_import: ' + errors.length + ' Fehler');
  process.exitCode = 1;
} else {
  console.log('check_import: ok (' + imp.tops.length + ' Namen in Import.gs, ' + code.tops.length + ' in Code.gs, ' + nPub +
    ' öffentliche Funktionen, ' + lockBodies + ' Sperr-Rümpfe geprüft)');
}
