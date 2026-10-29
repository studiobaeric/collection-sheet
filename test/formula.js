'use strict';
/**
 * formula.js – Nachbau der Google-Sheets-Formeln, die das Tool schreibt (#43), für die Nachbildung (harness2.js).
 *
 *   const F = require('./formula');
 *   const res = F.evaluate('=SUM(1,2)', { ref: (sheet, a1) => F.arr([[1]]), now: new Date() });
 *   // res: Zahl, Text, true/false, null (leer), F.FErr (Fehler) oder F.Arr (Matrix)
 *
 * Abgedeckt: Zahlen, Text, Bezüge ('Blatt'!A2:AD, B4), Operatoren mit Matrizen (Zeile, Spalte oder gleich groß),
 * ARRAYFORMULA, LET und die Funktionen in FUNCS, darunter QUERY (select, where, group by, pivot, order by, label;
 * sum, count, min, max, avg; Kopfzeilen 0, -1 oder alle für das Zusammenfügen).
 *
 * Wo Sheets sich nicht sicher so verhält, schalten opts.mode-Werte um, damit die Tests beide Lesarten prüfen:
 *   queryHeader: 'omitIfEmpty' (Standard: alle Beschriftungen leer -> keine Kopfzeile) | 'always'
 *   smush:       'skipEmpty' (Standard: leere Zellen fallen weg) | 'keepEmpty' (doppelte Leerzeichen)
 *   wildcards:   true (Standard: SVERWEIS/VERGLEICH genau mit * ? ~ als Platzhalter) | false
 * Auffälligkeiten (lint): Rechnen mit Matrizen außerhalb von ARRAYFORMULA/FILTER, TEXT mit anderen Mustern als 0…,
 * Kommazahlen an Text gehängt (deutsche Tabelle!), CHOOSECOLS mit einer Liste. Landen in res.lint bzw. werfen mit strict.
 */

class FErr {
  constructor(code, msg) { this.code = code; this.msg = msg || ''; }
  toString() { return this.code; }
}
class Arr {
  constructor(v) { this.v = v; }
  get r() { return this.v.length; }
  get c() { return this.v.length ? this.v[0].length : 0; }
}
class FormulaError extends Error {}

const err = (code, msg) => new FErr(code, msg);
const NA = msg => err('#N/A', msg);
const isErr = x => x instanceof FErr;
const isArr = x => x instanceof Arr;
const arr = v => new Arr(v);

function fill(r, c, x) { return Array.from({ length: r }, () => Array(c).fill(x)); }
function toArr(x) { return isArr(x) ? x : arr([[x]]); }
function scalar(x) {
  if (!isArr(x)) return x;
  if (x.r === 0 || x.c === 0) return null;
  return x.v[0][0];
}
function single(x) { return !isArr(x) || (x.r === 1 && x.c === 1); }

// ---------------------------------------------------------------------------
// Tokenizer und Parser
// ---------------------------------------------------------------------------

const REF_RE = /^\$?[A-Z]{1,3}\$?\d*(?::\$?[A-Z]{1,3}\$?\d*)?$/;

function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= n) throw new FormulaError('Text ohne Ende');
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    if (ch === "'") { // 'Blatt'!A1
      let s = '';
      i++;
      for (;;) {
        if (i >= n) throw new FormulaError('Blattname ohne Ende');
        if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      if (src[i] !== '!') throw new FormulaError('Nach Blattname fehlt !');
      i++;
      const m = /^\$?[A-Z]{1,3}\$?\d*(?::\$?[A-Z]{1,3}\$?\d*)?/.exec(src.slice(i));
      if (!m) throw new FormulaError('Bezug fehlt nach ' + s);
      out.push({ t: 'ref', sheet: s, a1: m[0].replace(/\$/g, '') });
      i += m[0].length;
      continue;
    }
    const num = /^(\d+(\.\d+)?([eE][+-]?\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*/.exec(src.slice(i));
    if (id) {
      let word = id[0];
      let j = i + word.length;
      if (src[j] === '!') { // Blatt!A1 ohne Anführungszeichen
        const m = /^\$?[A-Z]{1,3}\$?\d*(?::\$?[A-Z]{1,3}\$?\d*)?/.exec(src.slice(j + 1));
        if (!m) throw new FormulaError('Bezug fehlt nach ' + word);
        out.push({ t: 'ref', sheet: word, a1: m[0].replace(/\$/g, '') });
        i = j + 1 + m[0].length;
        continue;
      }
      // Bereich wie A2:AD oder B4 (Großbuchstaben + Ziffern)
      const rm = /^\$?[A-Z]{1,3}\$?\d*(?::\$?[A-Z]{1,3}\$?\d*)?/.exec(src.slice(i));
      if (rm && rm[0].length >= word.length && REF_RE.test(rm[0]) && /\d|:/.test(rm[0]) && src[i + rm[0].length] !== '(') {
        out.push({ t: 'ref', sheet: null, a1: rm[0].replace(/\$/g, '') });
        i += rm[0].length;
        continue;
      }
      out.push({ t: 'id', v: word });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].indexOf(two) >= 0) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%(),;'.indexOf(ch) >= 0) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new FormulaError('Unbekanntes Zeichen: ' + ch);
  }
  return out;
}

const BIN_PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

function parse(src) {
  let s = String(src).trim();
  if (s.charAt(0) === '=') s = s.slice(1);
  const toks = tokenize(s);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BIN_PREC)) break;
      const prec = BIN_PREC[t.v];
      if (prec < minPrec) break;
      p++;
      const right = expr(t.v === '^' ? prec : prec + 1);
      left = { t: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  }
  function unary() {
    const t = peek();
    if (isOp(t, '-') || isOp(t, '+')) { p++; return { t: 'un', op: t.v, a: unary() }; }
    let node = primary();
    while (isOp(peek(), '%')) { p++; node = { t: 'bin', op: '/', a: node, b: { t: 'num', v: 100 } }; }
    return node;
  }
  function primary() {
    const t = toks[p++];
    if (!t) throw new FormulaError('Formel endet zu früh');
    if (t.t === 'num') return { t: 'num', v: t.v };
    if (t.t === 'str') return { t: 'str', v: t.v };
    if (t.t === 'ref') return { t: 'ref', sheet: t.sheet, a1: t.a1 };
    if (isOp(t, '(')) { const e = expr(1); if (!isOp(toks[p++], ')')) throw new FormulaError(') fehlt'); return e; }
    if (t.t === 'id') {
      if (isOp(peek(), '(')) {
        p++;
        const args = [];
        if (isOp(peek(), ')')) { p++; return { t: 'call', name: t.v.toUpperCase(), args }; }
        for (;;) {
          const nx = peek();
          if (isOp(nx, ',') || isOp(nx, ';') || isOp(nx, ')')) args.push({ t: 'empty' });
          else args.push(expr(1));
          const sep = toks[p++];
          if (isOp(sep, ')')) break;
          if (!isOp(sep, ',') && !isOp(sep, ';')) throw new FormulaError('Komma oder ) erwartet in ' + t.v);
        }
        return { t: 'call', name: t.v.toUpperCase(), args };
      }
      const up = t.v.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
      return { t: 'name', name: t.v.toLowerCase() };
    }
    throw new FormulaError('Unerwartet: ' + (t.v || t.t));
  }
  const ast = expr(1);
  if (p !== toks.length) throw new FormulaError('Rest nach der Formel: ' + toks.slice(p).map(x => x.v || x.a1).join(' '));
  return ast;
}

// ---------------------------------------------------------------------------
// Werte, Umwandlung und Vergleich
// ---------------------------------------------------------------------------

function toNum(x) {
  if (isErr(x)) return x;
  if (x === null || x === undefined) return 0;
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const s = String(x).trim();
  if (s === '') return err('#VALUE!', 'leerer Text ist keine Zahl');
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  return err('#VALUE!', 'kein Zahlwert: ' + s);
}

function numText(n, ctx) {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  if (ctx) ctx.lintAdd('Kommazahl an Text gehängt (' + n + '): in einer deutschen Tabelle steht dort ein Komma');
  return String(Math.round(n * 1e10) / 1e10);
}

function toText(x, ctx) {
  if (isErr(x)) return x;
  if (x === null || x === undefined) return '';
  if (typeof x === 'number') return numText(x, ctx);
  if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE';
  return String(x);
}

function truthy(x) {
  if (x === null || x === undefined) return false;
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'string') {
    const u = x.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE' || x === '') return false;
    return err('#VALUE!', 'Text als Wahrheitswert: ' + x);
  }
  return false;
}

/** Sheets-Vergleich: Zahl < Text < Wahrheitswert, Text ohne Groß/klein; leer = 0 bzw. "". -> -1|0|1 */
function cmpVal(a, b) {
  if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const rank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ra === 2) return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordnung für SORT und QUERY: Zahlen vor Text vor Wahrheitswerten, leer zuletzt. caseSensitive für QUERY. */
function orderVal(a, b, caseSensitive) {
  const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (caseSensitive && typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return cmpVal(a, b);
}

// ---------------------------------------------------------------------------
// Matrizen elementweise
// ---------------------------------------------------------------------------

function dims(xs) {
  let R = 1, C = 1;
  xs.forEach(x => {
    if (!isArr(x)) return;
    if (x.r !== 1) { if (R !== 1 && R !== x.r) throw new FormulaError('Matrizen verschieden groß (' + R + ' und ' + x.r + ' Zeilen)'); R = x.r; }
    if (x.c !== 1) { if (C !== 1 && C !== x.c) throw new FormulaError('Matrizen verschieden groß (' + C + ' und ' + x.c + ' Spalten)'); C = x.c; }
  });
  return { R, C };
}

function at(x, i, j) {
  if (!isArr(x)) return x;
  return x.v[x.r === 1 ? 0 : i][x.c === 1 ? 0 : j];
}

/** fn auf jedes Element; Fehler in den Argumenten gehen durch (außer keepErr). */
function mapN(ctx, xs, fn, keepErr) {
  if (xs.every(single)) {
    const s = xs.map(scalar);
    if (!keepErr) { const e = s.find(isErr); if (e) return e; }
    return fn(...s);
  }
  if (!ctx.arrayCtx) ctx.lintAdd('Rechnen mit einer Matrix außerhalb von ARRAYFORMULA');
  const { R, C } = dims(xs);
  const out = fill(R, C, null);
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      const s = xs.map(x => at(x, i, j));
      const e = keepErr ? null : s.find(isErr);
      out[i][j] = e || fn(...s);
    }
  }
  return arr(out);
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

function evalNode(node, ctx) {
  switch (node.t) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'bool': return node.v;
    case 'empty': return null;
    case 'ref': return ctx.ref(node.sheet, node.a1);
    case 'name': {
      for (let s = ctx.scope; s; s = s.parent) if (Object.prototype.hasOwnProperty.call(s.vars, node.name)) return s.vars[node.name];
      return err('#NAME?', 'Unbekannter Name: ' + node.name);
    }
    case 'un': {
      const a = evalNode(node.a, ctx);
      return mapN(ctx, [a], x => { const n = toNum(x); return isErr(n) ? n : node.op === '-' ? -n : n; });
    }
    case 'bin': return binOp(node.op, evalNode(node.a, ctx), evalNode(node.b, ctx), ctx);
    case 'call': {
      const f = FUNCS[node.name];
      if (!f) return err('#NAME?', 'Unbekannte Funktion: ' + node.name);
      if (f.lazy) return f.fn(ctx, node.args);
      const args = node.args.map(a => evalNode(a, ctx));
      return f.fn(ctx, args, node.args);
    }
    default: throw new FormulaError('Knoten ' + node.t);
  }
}

function binOp(op, a, b, ctx) {
  return mapN(ctx, [a, b], (x, y) => {
    switch (op) {
      case '&': {
        const s1 = toText(x, ctx), s2 = toText(y, ctx);
        return isErr(s1) ? s1 : isErr(s2) ? s2 : s1 + s2;
      }
      case '=': return cmpVal(x, y) === 0;
      case '<>': return cmpVal(x, y) !== 0;
      case '<': return cmpVal(x, y) < 0;
      case '>': return cmpVal(x, y) > 0;
      case '<=': return cmpVal(x, y) <= 0;
      case '>=': return cmpVal(x, y) >= 0;
      default: {
        const n1 = toNum(x), n2 = toNum(y);
        if (isErr(n1)) return n1;
        if (isErr(n2)) return n2;
        if (op === '+') return n1 + n2;
        if (op === '-') return n1 - n2;
        if (op === '*') return n1 * n2;
        if (op === '/') return n2 === 0 ? err('#DIV/0!', 'Teilen durch 0') : n1 / n2;
        if (op === '^') return Math.pow(n1, n2);
        throw new FormulaError('Operator ' + op);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Funktionen
// ---------------------------------------------------------------------------

function nArg(x, def) { const v = scalar(x); return v === null || v === undefined ? def : v; }

/** Werte einer Matrix zeilenweise. */
function flat(x) { return isArr(x) ? [].concat(...x.v) : [x]; }

function elem(fn) { return { fn: (ctx, a) => mapN(ctx, a, fn) }; }

/** fn ohne Hinweis „Matrix außerhalb von ARRAYFORMULA“ ausführen (Funktionen, die Matrizen von sich aus verarbeiten). */
function arrayPass(ctx, fn) {
  const was = ctx.arrayCtx;
  ctx.arrayCtx = true;
  try { return fn(); } finally { ctx.arrayCtx = was; }
}

function wildRe(pat) {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '~' && i + 1 < pat.length) { re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '*') re += '[\\s\\S]*';
    else if (ch === '?') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

/** Gleichheit für SVERWEIS/VERGLEICH genau: Text ohne Groß/klein, mit Platzhaltern (mode.wildcards). */
function exactEq(ctx, key, v) {
  if (typeof key === 'string') {
    if (typeof v !== 'string') return false;
    if (ctx.mode.wildcards && /[*?~]/.test(key)) return wildRe(key).test(v);
    return key.toLowerCase() === v.toLowerCase();
  }
  if (key === null) return v === null || v === '';
  if (typeof v === 'string' || v === null) return false;
  return key === v;
}

function criterion(ctx, crit) {
  // '>0', '<=5', '=x', 'x' -> Prüffunktion
  if (typeof crit === 'number' || typeof crit === 'boolean') return v => v === crit;
  const s = crit === null ? '' : String(crit);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s);
  const op = m[1] || '=';
  let rhs = m[2];
  const num = /^[+-]?\d+(\.\d+)?$/.test(rhs.trim()) ? Number(rhs) : null;
  return v => {
    if (num !== null && typeof v === 'number') {
      if (op === '=') return v === num;
      if (op === '<>') return v !== num;
      return op === '<' ? v < num : op === '>' ? v > num : op === '<=' ? v <= num : v >= num;
    }
    if (num !== null) return op === '<>';
    if (op === '=') return typeof v === 'string' && wildRe(rhs).test(v);
    if (op === '<>') return !(typeof v === 'string' && wildRe(rhs).test(v));
    if (typeof v !== 'string') return false;
    const c = cmpVal(v, rhs);
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

function serialToParts(n) {
  const ms = Math.round(n * 86400000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

function dateToSerial(d) {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) -
    Date.UTC(1899, 11, 30)) / 86400000;
}

function serialToDate(n) {
  const p = Date.UTC(1899, 11, 30) + Math.round(n * 86400000);
  const u = new Date(p);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
}

function splitText(ctx, text, delim) {
  const t = toText(text, ctx);
  if (isErr(t)) return [t];
  const ds = String(delim);
  const parts = [];
  let cur = '';
  for (const ch of t) {
    if (ds.indexOf(ch) >= 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.filter(x => x !== '').map(x => (/^[+-]?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : x));
}

const FUNCS = {
  ARRAYFORMULA: { lazy: true, fn: (ctx, args) => { const was = ctx.arrayCtx; ctx.arrayCtx = true; try { return evalNode(args[0], ctx); } finally { ctx.arrayCtx = was; } } },
  LET: {
    lazy: true,
    fn: (ctx, args) => {
      if (args.length < 3 || args.length % 2 !== 1) return err('#N/A', 'LET braucht Paare');
      const scope = { vars: {}, parent: ctx.scope };
      const was = ctx.scope;
      ctx.scope = scope;
      try {
        for (let i = 0; i < args.length - 1; i += 2) {
          if (args[i].t !== 'name') return err('#N/A', 'LET-Name erwartet');
          const nm = args[i].name;
          if (!/^[a-z_][a-z0-9_]*$/i.test(nm) || /^[a-z]{1,3}\d+$/i.test(nm)) ctx.lintAdd('LET-Name sieht aus wie ein Zellbezug: ' + nm);
          if (Object.prototype.hasOwnProperty.call(scope.vars, nm)) ctx.lintAdd('LET-Name doppelt: ' + nm);
          scope.vars[nm] = evalNode(args[i + 1], ctx);
        }
        return evalNode(args[args.length - 1], ctx);
      } finally { ctx.scope = was; }
    }
  },
  IF: {
    lazy: true,
    fn: (ctx, args) => {
      const c = evalNode(args[0], ctx);
      // Außerhalb von ARRAYFORMULA mit einer Zelle als Bedingung: der gewählte Zweig unverändert, auch eine Matrix
      if (!ctx.arrayCtx && single(c)) {
        const t = isErr(scalar(c)) ? scalar(c) : truthy(scalar(c));
        if (isErr(t)) return t;
        if (t) return args.length > 1 ? evalNode(args[1], ctx) : true;
        return args.length > 2 ? evalNode(args[2], ctx) : false;
      }
      const a = args.length > 1 ? evalNode(args[1], ctx) : true;
      const b = args.length > 2 ? evalNode(args[2], ctx) : false;
      return mapN(ctx, [c, a, b], (cc, x, y) => {
        if (isErr(cc)) return cc;
        const t = truthy(cc);
        if (isErr(t)) return t;
        return t ? x : y;
      }, true);
    }
  },
  // IFERROR und IFNA reichen eine Matrix durch (auch außerhalb von ARRAYFORMULA, z. B. um eine ARRAYFORMULA herum)
  IFERROR: { fn: (ctx, a) => arrayPass(ctx, () => mapN(ctx, [a[0], a.length > 1 ? a[1] : null], (x, y) => (isErr(x) ? y : x), true)) },
  IFNA: { fn: (ctx, a) => arrayPass(ctx, () => mapN(ctx, [a[0], a.length > 1 ? a[1] : null], (x, y) => (isErr(x) && x.code === '#N/A' ? y : x), true)) },
  NOT: elem(x => { const t = truthy(x); return isErr(t) ? t : !t; }),
  ISNUMBER: { fn: (ctx, a) => mapN(ctx, [a[0]], x => typeof x === 'number', true) },
  ISBLANK: { fn: (ctx, a) => mapN(ctx, [a[0]], x => x === null, true) },
  ISERROR: { fn: (ctx, a) => mapN(ctx, [a[0]], x => isErr(x), true) },
  ISODD: elem(x => Math.abs(Math.trunc(toNum(x))) % 2 === 1),
  EXACT: elem((x, y) => toText(x) === toText(y)),
  TRIM: elem(x => toText(x).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')),
  UPPER: elem(x => toText(x).toUpperCase()),
  LOWER: elem(x => toText(x).toLowerCase()),
  LEN: elem(x => toText(x).length),
  LEFT: { fn: (ctx, a) => mapN(ctx, [a[0], a.length > 1 ? a[1] : 1], (x, k) => toText(x, ctx).slice(0, toNum(k))) },
  RIGHT: { fn: (ctx, a) => mapN(ctx, [a[0], a.length > 1 ? a[1] : 1], (x, k) => { const s = toText(x, ctx); const kk = toNum(k); return kk <= 0 ? '' : s.slice(-kk); }) },
  MID: elem((x, st, k) => toText(x).substr(toNum(st) - 1, toNum(k))),
  REPT: elem((x, k) => toText(x).repeat(Math.max(0, toNum(k)))),
  CHAR: elem(x => String.fromCharCode(toNum(x))),
  SUBSTITUTE: elem((x, o, nw) => { const s = toText(x), oo = toText(o); return oo === '' ? s : s.split(oo).join(toText(nw)); }),
  FIND: { fn: (ctx, a) => mapN(ctx, [a[0], a[1]], (nd, hs) => { const i = toText(hs, ctx).indexOf(toText(nd, ctx)); return i < 0 ? err('#VALUE!', 'nicht gefunden') : i + 1; }) },
  SEARCH: { fn: (ctx, a) => mapN(ctx, [a[0], a[1]], (nd, hs) => { const i = toText(hs, ctx).toLowerCase().indexOf(toText(nd, ctx).toLowerCase()); return i < 0 ? err('#VALUE!', 'nicht gefunden') : i + 1; }) },
  TO_TEXT: { fn: (ctx, a) => mapN(ctx, [a[0]], x => toText(x)) },
  VALUE: elem(x => {
    if (typeof x === 'number') return x;
    if (x === null || x === '') return 0;
    const n = toNum(x);
    return n;
  }),
  N: { fn: (ctx, a) => mapN(ctx, [a[0]], x => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : 0)) },
  ROUND: { fn: (ctx, a) => mapN(ctx, [a[0], a.length > 1 ? a[1] : 0], (x, d) => { const n = toNum(x); if (isErr(n)) return n; const f = Math.pow(10, toNum(d)); const v = Math.round(Math.abs(n) * f + 1e-9) / f; return n < 0 ? -v : v; }) },
  INT: elem(x => { const n = toNum(x); return isErr(n) ? n : Math.floor(n); }),
  ABS: elem(x => { const n = toNum(x); return isErr(n) ? n : Math.abs(n); }),
  SIGN: elem(x => { const n = toNum(x); return isErr(n) ? n : Math.sign(n); }),
  MOD: elem((x, y) => { const a = toNum(x), b = toNum(y); return b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b); }),
  DAY: elem(x => serialToParts(toNum(x)).d),
  MONTH: elem(x => serialToParts(toNum(x)).m),
  YEAR: elem(x => serialToParts(toNum(x)).y),
  HOUR: elem(x => serialToParts(toNum(x)).h),
  MINUTE: elem(x => serialToParts(toNum(x)).mi),
  TODAY: { fn: ctx => Math.floor(dateToSerial(ctx.now())) },
  NOW: { fn: ctx => dateToSerial(ctx.now()) },
  TEXT: {
    fn: (ctx, a) => mapN(ctx, [a[0], a[1]], (x, f) => {
      const pat = toText(f);
      if (!/^0+$/.test(pat)) { ctx.lintAdd('TEXT mit Muster ' + pat + ' (in einer deutschen Tabelle unsicher)'); }
      const n = toNum(x);
      if (isErr(n)) return typeof x === 'string' ? x : n;
      const s = String(Math.round(Math.abs(n)));
      return (n < 0 ? '-' : '') + (s.length < pat.length ? '0'.repeat(pat.length - s.length) + s : s);
    })
  },
  REGEXMATCH: elem((x, re) => new RegExp(toText(re)).test(toText(x))),
  REGEXEXTRACT: elem((x, re) => {
    const m = new RegExp(toText(re)).exec(toText(x));
    if (!m) return NA('REGEXEXTRACT ohne Treffer');
    return m.length > 1 ? (m[1] === undefined ? '' : m[1]) : m[0];
  }),
  REGEXREPLACE: elem((x, re, rep) => toText(x).replace(new RegExp(toText(re), 'g'), toText(rep))),
  SPLIT: {
    fn: (ctx, a) => {
      const delim = toText(scalar(a[1]));
      const src = flat(a[0]);
      if (single(a[0])) return arr([splitText(ctx, scalar(a[0]), delim)]);
      if (!ctx.arrayCtx) ctx.lintAdd('SPLIT über eine Matrix außerhalb von ARRAYFORMULA');
      const rows = toArr(a[0]).v.map(r => splitText(ctx, r[0], delim));
      const w = Math.max(1, ...rows.map(r => r.length));
      return arr(rows.map(r => r.concat(Array(w - r.length).fill(null)).slice(0, w).map(v => (v === undefined ? null : v))));
    }
  },
  // --- Matrizen
  ROWS: { fn: (ctx, a) => toArr(a[0]).r },
  COLUMNS: { fn: (ctx, a) => toArr(a[0]).c },
  SEQUENCE: {
    fn: (ctx, a) => {
      const r = toNum(nArg(a[0], 1)), c = toNum(nArg(a[1], 1)), st = toNum(nArg(a[2], 1)), sp = toNum(nArg(a[3], 1));
      if (r < 1 || c < 1) return err('#VALUE!', 'SEQUENCE mit 0 Zeilen');
      const out = fill(r, c, 0);
      let k = 0;
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[i][j] = st + sp * k++;
      return arr(out);
    }
  },
  HSTACK: {
    fn: (ctx, a) => {
      const ms = a.map(toArr);
      const R = Math.max(...ms.map(m => m.r));
      return arr(Array.from({ length: R }, (_, i) => [].concat(...ms.map(m => (i < m.r ? m.v[i] : Array(m.c).fill(NA('HSTACK aufgefüllt')))))));
    }
  },
  VSTACK: {
    fn: (ctx, a) => {
      const ms = a.map(toArr);
      const C = Math.max(...ms.map(m => m.c));
      const out = [];
      ms.forEach(m => m.v.forEach(row => out.push(row.concat(Array(C - row.length).fill(NA('VSTACK aufgefüllt'))))));
      return arr(out);
    }
  },
  CHOOSECOLS: {
    fn: (ctx, a, nodes) => {
      const m = toArr(a[0]);
      if (isErr(scalar(a[0])) && single(a[0])) return scalar(a[0]);
      const idx = [];
      for (let k = 1; k < a.length; k++) {
        if (!single(a[k])) { ctx.lintAdd('CHOOSECOLS mit einer Liste von Spalten'); flat(a[k]).forEach(v => idx.push(toNum(v))); } else idx.push(toNum(scalar(a[k])));
      }
      for (const i of idx) if (!(Math.abs(i) >= 1 && Math.abs(i) <= m.c)) return err('#VALUE!', 'CHOOSECOLS: Spalte ' + i + ' von ' + m.c);
      return arr(m.v.map(row => idx.map(i => row[i > 0 ? i - 1 : m.c + i])));
    }
  },
  CHOOSEROWS: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const idx = [];
      for (let k = 1; k < a.length; k++) flat(a[k]).forEach(v => idx.push(toNum(v)));
      for (const i of idx) if (!(Math.abs(i) >= 1 && Math.abs(i) <= m.r)) return err('#VALUE!', 'CHOOSEROWS: Zeile ' + i);
      return arr(idx.map(i => m.v[i > 0 ? i - 1 : m.r + i].slice()));
    }
  },
  ARRAY_CONSTRAIN: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const r = Math.min(m.r, toNum(scalar(a[1]))), c = Math.min(m.c, toNum(scalar(a[2])));
      if (r < 1 || c < 1) return err('#VALUE!', 'ARRAY_CONSTRAIN mit 0');
      return arr(m.v.slice(0, r).map(row => row.slice(0, c)));
    }
  },
  TRANSPOSE: { fn: (ctx, a) => { const m = toArr(a[0]); return arr(Array.from({ length: m.c }, (_, j) => m.v.map(row => row[j]))); } },
  TOCOL: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const ignore = toNum(nArg(a[1], 0)), byCol = truthy(nArg(a[2], false));
      let vals = [];
      if (byCol) { for (let j = 0; j < m.c; j++) for (let i = 0; i < m.r; i++) vals.push(m.v[i][j]); } else vals = flat(m);
      if (ignore === 1 || ignore === 3) vals = vals.filter(v => v !== null);
      if (ignore === 2 || ignore === 3) vals = vals.filter(v => !isErr(v));
      if (!vals.length) return err('#N/A', 'TOCOL leer');
      return arr(vals.map(v => [v]));
    }
  },
  MMULT: {
    fn: (ctx, a) => {
      const x = toArr(a[0]), y = toArr(a[1]);
      if (x.c !== y.r) return err('#VALUE!', 'MMULT: Größen passen nicht');
      const out = fill(x.r, y.c, 0);
      for (let i = 0; i < x.r; i++) {
        for (let j = 0; j < y.c; j++) {
          let s = 0;
          for (let k = 0; k < x.c; k++) {
            const p = x.v[i][k], q = y.v[k][j];
            if (isErr(p)) return p;
            if (isErr(q)) return q;
            if (typeof p !== 'number' || typeof q !== 'number') return err('#VALUE!', 'MMULT mit Text');
            s += p * q;
          }
          out[i][j] = s;
        }
      }
      return arr(out);
    }
  },
  INDEX: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const r = toNum(nArg(a[1], 0)), c = toNum(nArg(a[2], 0));
      if (isErr(r)) return r;
      if (isErr(c)) return c;
      if (r < 0 || c < 0 || r > m.r || c > m.c) return err('#REF!', 'INDEX außerhalb (' + r + ', ' + c + ' bei ' + m.r + '×' + m.c + ')');
      if (r === 0 && c === 0) return m;
      if (r === 0) return arr(m.v.map(row => [row[c - 1]]));
      if (c === 0) { if (m.c === 1 && !(a.length > 2)) return m.v[r - 1][0]; return arr([m.v[r - 1].slice()]); }
      if (r > m.r || c > m.c) return err('#REF!', 'INDEX außerhalb');
      return m.v[r - 1][c - 1];
    }
  },
  FILTER: {
    lazy: true,
    fn: (ctx, nodes) => {
      const m = toArr(evalNode(nodes[0], ctx));
      const was = ctx.arrayCtx;
      ctx.arrayCtx = true;
      let conds;
      try { conds = nodes.slice(1).map(n => toArr(evalNode(n, ctx))); } finally { ctx.arrayCtx = was; }
      if (!conds.length) return err('#N/A', 'FILTER ohne Bedingung');
      // Eine Zeile mit mehreren Spalten und Bedingungen aus je einer Zelle: Zeilen oder Spalten? Das Tool meidet den Fall
      // (filterRows_ in Code.gs), darum hier ein Fehler statt einer Annahme über Sheets.
      if (m.r === 1 && m.c > 1 && conds.every(c => c.r === 1 && c.c === 1)) {
        return err('#VALUE!', 'FILTER mehrdeutig: eine Zeile, Bedingung aus einer Zelle (filterRows_ nehmen)');
      }
      const byRow = conds[0].c === 1 && conds[0].r === m.r;
      if (byRow) {
        for (const c of conds) if (c.r !== m.r || c.c !== 1) return err('#VALUE!', 'FILTER: Bedingung hat ' + c.r + ' statt ' + m.r + ' Zeilen');
        const keep = [];
        for (let i = 0; i < m.r; i++) {
          let ok = true;
          for (const c of conds) { const v = c.v[i][0]; if (isErr(v)) return v; const t = truthy(v); if (isErr(t)) return t; if (!t) { ok = false; break; } }
          if (ok) keep.push(m.v[i]);
        }
        if (!keep.length) return err('#N/A', 'No matches are found in FILTER evaluation.');
        return arr(keep);
      }
      for (const c of conds) if (c.c !== m.c || c.r !== 1) return err('#VALUE!', 'FILTER: Bedingung passt nicht');
      const cols = [];
      for (let j = 0; j < m.c; j++) if (conds.every(c => truthy(c.v[0][j]) === true)) cols.push(j);
      if (!cols.length) return err('#N/A', 'No matches are found in FILTER evaluation.');
      return arr(m.v.map(row => cols.map(j => row[j])));
    }
  },
  SORT: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const keys = [];
      for (let k = 1; k < a.length; k += 2) {
        const col = a[k];
        const asc = k + 1 < a.length ? truthy(scalar(a[k + 1])) : true;
        if (single(col)) keys.push({ i: toNum(scalar(col)) - 1, asc });
        else keys.push({ vals: toArr(col).v.map(r => r[0]), asc });
      }
      if (!keys.length) keys.push({ i: 0, asc: true });
      const idx = m.v.map((row, i) => i);
      idx.sort((x, y) => {
        for (const k of keys) {
          const p = k.vals ? k.vals[x] : m.v[x][k.i], q = k.vals ? k.vals[y] : m.v[y][k.i];
          const ep = p === null || p === '', eq = q === null || q === '';
          if (ep || eq) { if (ep !== eq) return ep ? 1 : -1; continue; }
          const c = cmpVal(p, q);
          if (c) return k.asc ? c : -c;
        }
        return x - y;
      });
      return arr(idx.map(i => m.v[i]));
    }
  },
  UNIQUE: {
    fn: (ctx, a) => {
      const m = toArr(a[0]);
      const seen = new Set();
      const out = [];
      m.v.forEach(row => { const k = JSON.stringify(row); if (!seen.has(k)) { seen.add(k); out.push(row); } });
      return arr(out);
    }
  },
  // --- Zusammenfassen
  SUM: { fn: (ctx, a) => { let s = 0; for (const x of a) for (const v of flat(x)) { if (isErr(v)) return v; if (typeof v === 'number') s += v; } return s; } },
  COUNT: { fn: (ctx, a) => a.reduce((n, x) => n + flat(x).filter(v => typeof v === 'number').length, 0) },
  COUNTA: { fn: (ctx, a) => a.reduce((n, x) => n + flat(x).filter(v => v !== null).length, 0) },
  MAX: { fn: (ctx, a) => { const ns = [].concat(...a.map(flat)).filter(v => typeof v === 'number'); return ns.length ? Math.max(...ns) : 0; } },
  MIN: { fn: (ctx, a) => { const ns = [].concat(...a.map(flat)).filter(v => typeof v === 'number'); return ns.length ? Math.min(...ns) : 0; } },
  SUMPRODUCT: {
    lazy: true,
    fn: (ctx, nodes) => {
      const a = arrayPass(ctx, () => nodes.map(n => evalNode(n, ctx)));
      const ms = a.map(toArr);
      let s = 0;
      for (let i = 0; i < ms[0].r; i++) for (let j = 0; j < ms[0].c; j++) {
        let p = 1;
        for (const m of ms) { const v = m.v[i][j]; p *= typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0; }
        s += p;
      }
      return s;
    }
  },
  COUNTIF: {
    fn: (ctx, a) => {
      const vals = flat(a[0]);
      return mapN(ctx, [a[1]], c => { const t = criterion(ctx, c); return vals.filter(v => t(v)).length; });
    }
  },
  SUMIF: {
    fn: (ctx, a) => {
      const vals = flat(a[0]);
      const sums = flat(a.length > 2 ? a[2] : a[0]);
      return mapN(ctx, [a[1]], c => {
        const t = criterion(ctx, c);
        let s = 0;
        vals.forEach((v, i) => { if (t(v) && typeof sums[i] === 'number') s += sums[i]; });
        return s;
      });
    }
  },
  TEXTJOIN: {
    fn: (ctx, a) => {
      const sep = toText(scalar(a[0])), skip = truthy(scalar(a[1]));
      const parts = [];
      for (const x of a.slice(2)) for (const v of flat(x)) { if (isErr(v)) return v; if (skip && (v === null || v === '')) continue; parts.push(toText(v)); }
      return parts.join(sep);
    }
  },
  // --- Nachschlagen
  VLOOKUP: {
    fn: (ctx, a) => {
      const table = toArr(a[1]);
      const sorted = a.length > 3 ? truthy(scalar(a[3])) : true;
      const idxs = flat(a[2]).map(toNum);
      for (const i of idxs) if (!(i >= 1 && i <= table.c)) return err('#REF!', 'SVERWEIS: Spalte ' + i + ' von ' + table.c);
      const first = table.v.map(r => r[0]);
      const findRow = key => {
        if (isErr(key)) return key;
        if (sorted) {
          let lo = 0, hi = first.length - 1, best = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const v = first[mid];
            if (v === null || v === '' || cmpVal(v, key) <= 0) {
              if (!(v === null || v === '')) best = mid;
              lo = mid + 1;
            } else hi = mid - 1;
          }
          // Sheets: größter Wert <= Schlüssel; nur gleicher Typ zählt
          if (best < 0 || typeof first[best] !== typeof key) return NA('SVERWEIS sortiert: nichts <= ' + key);
          return best;
        }
        for (let i = 0; i < first.length; i++) if (exactEq(ctx, key, first[i])) return i;
        return NA('SVERWEIS: ' + key + ' nicht gefunden');
      };
      const keys = toArr(a[0]);
      if (single(a[0])) {
        const r = findRow(scalar(a[0]));
        if (isErr(r)) return r;
        return idxs.length === 1 ? table.v[r][idxs[0] - 1] : arr([idxs.map(i => table.v[r][i - 1])]);
      }
      if (!ctx.arrayCtx) ctx.lintAdd('SVERWEIS mit einer Liste außerhalb von ARRAYFORMULA');
      if (keys.c !== 1) return err('#VALUE!', 'SVERWEIS: Schlüssel als Zeile');
      return arr(keys.v.map(row => { const r = findRow(row[0]); return isErr(r) ? idxs.map(() => r) : idxs.map(i => table.v[r][i - 1]); }));
    }
  },
  MATCH: {
    fn: (ctx, a) => {
      const look = flat(a[1]);
      const type = toNum(nArg(a[2], 1));
      const one = key => {
        if (isErr(key)) return key;
        if (type === 0) { for (let i = 0; i < look.length; i++) if (exactEq(ctx, key, look[i])) return i + 1; return NA('VERGLEICH: nicht gefunden'); }
        let best = -1;
        for (let i = 0; i < look.length; i++) {
          const v = look[i];
          if (v === null || v === '') continue;
          const c = cmpVal(v, key);
          if (type === 1 ? c <= 0 : c >= 0) best = i; else break;
        }
        return best < 0 ? NA('VERGLEICH: nichts passend') : best + 1;
      };
      return mapN(ctx, [a[0]], one);
    }
  },
  XLOOKUP: {
    fn: (ctx, a) => {
      const look = flat(a[1]);
      const res = toArr(a[2]);
      const missing = a.length > 3 && a[3] !== null ? a[3] : NA('XLOOKUP: nicht gefunden');
      const back = a.length > 5 && toNum(scalar(a[5])) === -1;
      return mapN(ctx, [a[0]], key => {
        const order = look.map((v, i) => i);
        if (back) order.reverse();
        for (const i of order) {
          const v = look[i];
          const eq = typeof key === 'string' ? typeof v === 'string' && v.toLowerCase() === key.toLowerCase() : key === v;
          if (eq) return res.c === 1 ? res.v[i][0] : res.v[0][i];
        }
        return scalar(missing);
      });
    }
  },
  // --- Anzeige
  IMAGE: elem(u => 'IMAGE:' + toText(u)),
  SPARKLINE: { fn: () => 'SPARKLINE' },
  QUERY: { fn: (ctx, a) => query(ctx, toArr(a[0]), a.length > 1 && a[1] !== null ? toText(scalar(a[1])) : '', a.length > 2 && a[2] !== null ? toNum(scalar(a[2])) : -1) }
};

// ---------------------------------------------------------------------------
// QUERY (Google Visualization API Query Language, Teilmenge)
// ---------------------------------------------------------------------------

function qTokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== ch) v += s[j++];
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!='].indexOf(two) >= 0) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('(),=<>*+-/'.indexOf(ch) >= 0) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new FormulaError('QUERY: unbekanntes Zeichen ' + ch);
  }
  return out;
}

const Q_KEYWORDS = ['select', 'where', 'group', 'pivot', 'order', 'limit', 'offset', 'label', 'format', 'options'];
const Q_AGG = ['sum', 'count', 'min', 'max', 'avg'];

function parseQuery(q) {
  const toks = qTokenize(q);
  let p = 0;
  const kw = w => toks[p] && toks[p].t === 'id' && toks[p].v.toLowerCase() === w;
  const isKw = () => toks[p] && toks[p].t === 'id' && Q_KEYWORDS.indexOf(toks[p].v.toLowerCase()) >= 0;
  const colRef = () => {
    const t = toks[p];
    if (!t || t.t !== 'id') throw new FormulaError('QUERY: Spalte erwartet');
    if (Q_AGG.indexOf(t.v.toLowerCase()) >= 0 && toks[p + 1] && toks[p + 1].v === '(') {
      p += 2;
      const inner = toks[p++];
      if (!toks[p] || toks[p].v !== ')') throw new FormulaError('QUERY: ) fehlt');
      p++;
      return { agg: t.v.toLowerCase(), col: colIndex(inner.v) };
    }
    p++;
    return { col: colIndex(t.v) };
  };
  const colIndex = v => {
    const m = /^Col(\d+)$/i.exec(v);
    if (!m) throw new FormulaError('QUERY: nur ColN-Spalten (' + v + ')');
    return Number(m[1]) - 1;
  };
  const list = () => { const out = [colRef()]; while (toks[p] && toks[p].v === ',') { p++; out.push(colRef()); } return out; };
  const res = { select: null, where: null, group: [], pivot: [], order: [], labels: [] };
  while (p < toks.length) {
    if (kw('select')) {
      p++;
      if (toks[p] && toks[p].v === '*') { p++; res.select = '*'; } else res.select = list();
    } else if (kw('where')) {
      p++;
      const start = p;
      while (p < toks.length && !isKw()) p++;
      res.where = parseWhere(toks.slice(start, p), colIndex);
    } else if (kw('group')) {
      p++; if (!kw('by')) throw new FormulaError('QUERY: group by'); p++;
      res.group = list().map(c => c.col);
    } else if (kw('pivot')) {
      p++; res.pivot = list().map(c => c.col);
    } else if (kw('order')) {
      p++; if (!kw('by')) throw new FormulaError('QUERY: order by'); p++;
      for (;;) {
        const c = colRef();
        let desc = false;
        if (kw('desc')) { desc = true; p++; } else if (kw('asc')) p++;
        res.order.push({ c, desc });
        if (toks[p] && toks[p].v === ',') { p++; continue; }
        break;
      }
    } else if (kw('label')) {
      p++;
      for (;;) {
        const c = colRef();
        const t = toks[p++];
        if (!t || t.t !== 'str') throw new FormulaError('QUERY: Beschriftung erwartet');
        res.labels.push({ c, text: t.v });
        if (toks[p] && toks[p].v === ',') { p++; continue; }
        break;
      }
    } else throw new FormulaError('QUERY: unerwartet ' + toks[p].v);
  }
  return res;
}

function parseWhere(toks, colIndex) {
  // nur: ColN op Wert [and|or ColN op Wert …], dazu ColN is not null
  const conds = [];
  let p = 0;
  let join = 'and';
  while (p < toks.length) {
    const c = colIndex(toks[p++].v);
    let op, val;
    if (toks[p] && toks[p].t === 'id' && toks[p].v.toLowerCase() === 'is') {
      p++;
      let neg = false;
      if (toks[p].v.toLowerCase() === 'not') { neg = true; p++; }
      p++; // null
      op = neg ? 'notnull' : 'null';
    } else {
      op = toks[p++].v;
      const t = toks[p++];
      val = t.t === 'num' ? t.v : t.t === 'str' ? t.v : t.v;
    }
    conds.push({ c, op, val, join });
    if (p < toks.length) { join = toks[p++].v.toLowerCase(); }
  }
  return row => {
    let acc = null;
    for (const k of conds) {
      const v = row[k.c];
      let ok;
      if (k.op === 'null') ok = v === null;
      else if (k.op === 'notnull') ok = v !== null;
      else if (v === null) ok = false;
      else {
        const c = typeof v === 'string' && typeof k.val === 'string' ? (v < k.val ? -1 : v > k.val ? 1 : 0) : cmpVal(v, k.val);
        ok = k.op === '=' ? c === 0 : k.op === '!=' || k.op === '<>' ? c !== 0 : k.op === '<' ? c < 0 : k.op === '>' ? c > 0 : k.op === '<=' ? c <= 0 : c >= 0;
      }
      acc = acc === null ? ok : k.join === 'or' ? acc || ok : acc && ok;
    }
    return acc;
  };
}

/** Spaltentyp nach Mehrheit (Zahl oder Text); die Minderheit wird null. */
function typeColumns(rows, ncol) {
  const types = [];
  for (let j = 0; j < ncol; j++) {
    let nNum = 0, nStr = 0, nBool = 0;
    rows.forEach(r => { const v = r[j]; if (typeof v === 'number') nNum++; else if (typeof v === 'string' && v !== '') nStr++; else if (typeof v === 'boolean') nBool++; });
    types.push(nStr > nNum && nStr >= nBool ? 'string' : nBool > nNum && nBool > nStr ? 'boolean' : nNum ? 'number' : nStr ? 'string' : 'number');
  }
  return rows.map(r => r.map((v, j) => {
    if (v === null || isErr(v)) return null;
    if (types[j] === 'number') return typeof v === 'number' ? v : null;
    if (types[j] === 'string') return typeof v === 'string' ? v : null;
    return typeof v === 'boolean' ? v : null;
  }));
}

function aggregate(fn, vals) {
  const xs = vals.filter(v => v !== null);
  if (fn === 'count') return xs.length;
  if (!xs.length) return null;
  if (fn === 'sum') return xs.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  if (fn === 'avg') return xs.reduce((s, v) => s + v, 0) / xs.length;
  const c = (a, b) => (typeof a === 'string' && typeof b === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : cmpVal(a, b));
  return xs.reduce((m, v) => (fn === 'min' ? (c(v, m) < 0 ? v : m) : (c(v, m) > 0 ? v : m)));
}

function query(ctx, data, q, headers) {
  const src = data.v.map(r => r.slice());
  if (headers > 0 && headers >= src.length && !q.trim()) {
    // „Smush“: alle Zeilen sind Kopfzeilen, je Spalte zusammengefügt
    return arr([data.v[0].map((_, j) => {
      const parts = src.map(r => r[j]).map(v => (v === null ? '' : toText(v)));
      return ctx.mode.smush === 'keepEmpty' ? parts.join(' ') : parts.filter(x => x !== '').join(' ');
    })]);
  }
  const nHead = headers > 0 ? headers : 0;
  const headRows = src.slice(0, nHead);
  const body = typeColumns(src.slice(nHead), data.c);
  const colLabel = j => headRows.map(r => (r[j] === null ? '' : toText(r[j]))).join(' ').trim();
  const pq = parseQuery(q || 'select *');
  let rows = pq.where ? body.filter(pq.where) : body;
  const sel = pq.select === '*' || !pq.select ? Array.from({ length: data.c }, (_, j) => ({ col: j })) : pq.select;
  const labelOf = c => {
    const l = pq.labels.find(x => x.c.col === c.col && x.c.agg === c.agg);
    if (l) return l.text;
    return c.agg ? (c.agg + ' ' + (colLabel(c.col) || 'Col' + (c.col + 1))).trim() : colLabel(c.col);
  };
  let out, head;
  if (pq.group.length || sel.some(c => c.agg)) {
    const groups = new Map();
    rows.forEach(r => {
      const k = JSON.stringify(pq.group.map(g => r[g]));
      if (!groups.has(k)) groups.set(k, { key: pq.group.map(g => r[g]), rows: [] });
      groups.get(k).rows.push(r);
    });
    let gs = Array.from(groups.values());
    gs.sort((x, y) => { for (let i = 0; i < pq.group.length; i++) { const c = orderVal(x.key[i], y.key[i], true); if (c) return c; } return 0; });
    if (pq.pivot.length) {
      const pv = pq.pivot[0];
      const pvals = Array.from(new Set(rows.map(r => JSON.stringify(r[pv])))).map(s => JSON.parse(s));
      pvals.sort((x, y) => orderVal(x, y, true));
      const aggs = sel.filter(c => c.agg);
      head = sel.filter(c => !c.agg).map(labelOf);
      pvals.forEach(v => aggs.forEach(c => head.push(aggs.length === 1 ? toText(v) : toText(v) + ' ' + labelOf(c))));
      out = gs.map(g => {
        const row = sel.filter(c => !c.agg).map(c => g.key[pq.group.indexOf(c.col)]);
        pvals.forEach(v => aggs.forEach(c => {
          const sub = g.rows.filter(r => JSON.stringify(r[pv]) === JSON.stringify(v));
          row.push(sub.length ? aggregate(c.agg, sub.map(r => r[c.col])) : null);
        }));
        return row;
      });
      return arr([head].concat(out).map(r => r.map(v => (v === undefined ? null : v))));
    }
    head = sel.map(labelOf);
    out = gs.map(g => sel.map(c => (c.agg ? aggregate(c.agg, g.rows.map(r => r[c.col])) : g.key[pq.group.indexOf(c.col)])));
  } else {
    head = sel.map(labelOf);
    out = rows.map(r => sel.map(c => r[c.col]));
  }
  if (pq.order.length) {
    const pos = pq.order.map(o => sel.findIndex(c => c.col === o.c.col && c.agg === o.c.agg));
    out.sort((x, y) => { for (let i = 0; i < pos.length; i++) { const c = orderVal(x[pos[i]], y[pos[i]], true); if (c) return pq.order[i].desc ? -c : c; } return 0; });
  }
  const allEmpty = head.every(h => h === '');
  if (allEmpty && ctx.mode.queryHeader !== 'always') {
    if (!out.length) return err('#N/A', 'QUERY ohne Zeilen');
    return arr(out);
  }
  return arr([head].concat(out));
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

const DEFAULT_MODE = { queryHeader: 'omitIfEmpty', smush: 'skipEmpty', wildcards: true };

/**
 * Formel auswerten. opts: {ref(sheet, a1) -> Wert/Arr (Zellen: Datum als Seriennummer, leer = null), now() -> Date,
 * mode: {queryHeader, smush, wildcards}, strict: Auffälligkeiten werfen}. -> {value, lint: []}
 */
function evaluate(formula, opts) {
  opts = opts || {};
  const lint = [];
  const ctx = {
    ref: opts.ref || (() => err('#REF!', 'kein Blatt')),
    now: opts.now || (() => new Date()),
    mode: Object.assign({}, DEFAULT_MODE, opts.mode || {}),
    scope: null,
    arrayCtx: false,
    lintAdd: m => { if (lint.indexOf(m) < 0) lint.push(m); }
  };
  let ast;
  try { ast = parse(formula); } catch (e) {
    if (e instanceof FormulaError) return { value: err('#ERROR!', e.message), lint };
    throw e;
  }
  let value;
  try { value = evalNode(ast, ctx); } catch (e) {
    // Fehler im Rechenwerk selbst: als Fehlerwert mit Hinweis, damit Tests ihn sehen (nicht als Absturz mitten in der Einrichtung)
    value = e instanceof FormulaError ? err('#VALUE!', e.message) : err('#ERROR!', 'Rechenwerk: ' + e.message);
    if (!(e instanceof FormulaError)) lint.push('Rechenwerk-Fehler: ' + e.message);
  }
  if (opts.strict && lint.length) throw new Error('Formel auffällig: ' + lint.join('; '));
  return { value, lint };
}

module.exports = { evaluate, parse, tokenize, Arr, FErr, arr, isErr, isArr, dateToSerial, serialToDate, FUNCS, DEFAULT_MODE };
