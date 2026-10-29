'use strict';
/**
 * harness2.js – Apps-Script-Attrappen für Code.gs + Import.gs (Node, ohne Netz).
 *
 *   const H = require('./harness2');
 *   const env = H.createEnv();            // frischer Kontext pro Test (Code.gs + Import.gs, falls vorhanden)
 *   env.ctx.setupAll_();                // alle .gs-Funktionen hängen an env.ctx
 *   env.data();                           // Blatt Daten als Objekte
 *
 * createEnv(opts):
 *   files     Liste der .gs-Dateien (Standard: Code.gs, dazu Import.gs und Update.gs, falls es sie gibt)
 *   srcDir    Ordner der Dateien (Standard: ../src)
 *   noUi      true: SpreadsheetApp.getUi() wirft (wie in Triggern)
 *   drive     'v3' (Standard) | 'v2' | false (kein erweiterter Dienst Drive)
 *   sheets    Namen leerer Startblätter (Standard ['Tabellenblatt1'])
 *   db        eigene tcgdex-Attrappe (Standard: Kopie von DEFAULT_DB)
 *   formulas  false: Formeln nicht ausrechnen (Standard: ausrechnen mit formula.js, beim Lesen der Zellen)
 *   formulaMode  Lesart unsicherer Sheets-Stellen für formula.js (queryHeader, smush, wildcards)
 *
 * Wichtigste Teile von env: ctx, ss, DB, props, cache, ui, lock, fetchLog, triggers, templates, files (Drive),
 * sheet(name), values(name), objects(name), data(), groups(), proto(), addSource(spec), uiCall(fn, ...args),
 * run(code), setFormulaDisplay(fn).
 *
 * Formeln: Beim Lesen rechnet die Attrappe sie aus (test/formula.js) und breitet Matrizen aus wie Sheets, mit #REF!, wenn
 * das Blatt zu kurz ist oder im Bereich schon etwas steht. env.formulaLint und env.formulaErrors sammeln Auffälliges,
 * env.now = () => Date legt HEUTE() fest.
 *
 * Andere Adressen als tcgdex (GitHub, Apps-Script-API …): env.http = (url, options) => {code, body} | undefined.
 * Die Bilder der Dashboard-Knöpfe (raw.githubusercontent.com/…/assets/dashboard/) kommen ohne env.http aus dem Repo.
 * Kopien über DriveApp.makeCopy landen in env.sources (und env.backups).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const F = require('./formula');

const SRC_DIR = path.join(__dirname, '..', 'src');
const API = 'https://api.tcgdex.net/v2/';
const MIME = {
  GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
  MICROSOFT_EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  MICROSOFT_EXCEL_LEGACY: 'application/vnd.ms-excel',
  CSV: 'text/csv',
  PLAIN_TEXT: 'text/plain',
  PDF: 'application/pdf'
};

// ---------------------------------------------------------------------------
// kleine Hilfen
// ---------------------------------------------------------------------------

/** Kette, die jede Methode schluckt (für Builder wie newDataValidation). */
function chainObj() {
  const c = new Proxy(function () {}, {
    get: (t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => '' : () => c),
    apply: () => c
  });
  return c;
}

/** Bauer für bedingte Formatierung: merkt sich jeden Aufruf, build() -> {calls: [[Name, ...Argumente]], arg(Name)} */
function ruleBuilder() {
  const calls = [];
  const b = new Proxy({}, {
    get: (t, p) => {
      if (p === 'then') return undefined;
      if (p === 'build') return () => ({ calls: calls.slice(), arg: n => { const c = calls.find(x => x[0] === n); return c ? c[1] : undefined; } });
      return (...args) => { calls.push([String(p), ...args]); return b; };
    }
  });
  return b;
}

function colNum(s) {
  return s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** 'A1', 'A1:B2', 'H6:I' (offene Zeilen), 'A:C' -> {r, c, r2|null, c2} */
function parseA1(a1) {
  const m = String(a1).trim().match(/^\$?([A-Z]+)\$?(\d*)(?::\$?([A-Z]+)\$?(\d*))?$/);
  if (!m) throw new Error('A1-Notation nicht unterstützt: ' + a1);
  const r = m[2] ? +m[2] : 1;
  const c = colNum(m[1]);
  if (!m[3]) return { r, c, r2: m[2] ? r : null, c2: c };
  return { r, c, r2: m[4] ? +m[4] : null, c2: colNum(m[3]) };
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** Utilities.formatDate mit yyyy, yy, MM, dd, HH, mm, ss (lokale Zeit des Node-Prozesses). */
function formatDate(d, tz, pattern) {
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) throw new Error('Ungültiges Datum');
  return String(pattern)
    .replace(/yyyy/g, String(d.getFullYear()))
    .replace(/yy/g, String(d.getFullYear()).slice(-2))
    .replace(/MM/g, pad2(d.getMonth() + 1))
    .replace(/dd/g, pad2(d.getDate()))
    .replace(/HH/g, pad2(d.getHours()))
    .replace(/mm/g, pad2(d.getMinutes()))
    .replace(/ss/g, pad2(d.getSeconds()));
}

/** Wie Sheets Eingaben typisiert, wenn die Zelle kein Textformat ('@') hat. */
function coerce(v, fmt) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return v instanceof Date ? new Date(v.getTime()) : v;
  if (v.charAt(0) === "'") return v.slice(1);
  if (fmt === '@') return v;
  const t = v.trim();
  if (t !== '' && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const dm = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dm) return new Date(+dm[1], +dm[2] - 1, +dm[3]);
  if (/^(TRUE|FALSE)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  return v;
}

function displayOf(v, fmt) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return formatDate(v, '', /h/.test(fmt || '') ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (fmt && /€/.test(fmt)) return v.toFixed(2).replace('.', ',') + ' €';
    if (fmt === '0') return String(Math.round(v));
    return String(v);
  }
  return String(v);
}

function signedBytes(buf) {
  return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
}

function bytesOf(value) {
  if (Array.isArray(value)) return Buffer.from(value.map(b => (b < 0 ? b + 256 : b)));
  return Buffer.from(String(value), 'utf8');
}

/** Rückgaben an google.script.run: keine Dates, keine Funktionen (sonst kommt im Browser null an). */
function assertPlain(x, where) {
  where = where || 'Ergebnis';
  if (x instanceof Date) throw new Error(where + ' enthält ein Date');
  if (typeof x === 'function') throw new Error(where + ' enthält eine Funktion');
  if (typeof x === 'number' && !isFinite(x)) throw new Error(where + ' enthält ' + x);
  if (Array.isArray(x)) x.forEach((v, i) => assertPlain(v, where + '[' + i + ']'));
  else if (x && typeof x === 'object') Object.keys(x).forEach(k => assertPlain(x[k], where + '.' + k));
  return x;
}

// ---------------------------------------------------------------------------
// Tabellen-Attrappe
// ---------------------------------------------------------------------------

class FakeRichText {
  constructor(text, link, runs) { this.text = text; this.link = link || null; this.runs = runs || null; }
  getText() { return this.text; }
  getLinkUrl() { return this.link; }
  getRuns() {
    if (!this.runs) return [this];
    let pos = 0;
    return this.runs.map(r => {
      const o = new FakeRichText(r.text, r.url || null);
      o.getStartIndex = () => pos; pos += r.text.length; o.getEndIndex = () => pos;
      return o;
    });
  }
}

class Range {
  constructor(sh, r, c, nr, nc) {
    if (!(r >= 1 && c >= 1 && nr >= 1 && nc >= 1)) throw new Error('Bereich ungültig: ' + [r, c, nr, nc].join(','));
    if (r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) {
      throw new Error('Die Koordinaten des Bereichs liegen außerhalb der Abmessungen des Tabellenblatts (' + sh.name + ' ' +
        [r, c, nr, nc].join(',') + ' bei ' + sh.maxRows + 'x' + sh.maxCols + ')');
    }
    Object.assign(this, { sh, r, c, nr, nc });
  }
  cells(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = this.sh.get(this.r + i, this.c + j);
        row.push(v instanceof Date ? new Date(v.getTime()) : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sh.display(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getRichTextValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const R = this.r + i, C = this.c + j;
        const v = this.sh.get(R, C);
        if (typeof v !== 'string') { row.push(null); continue; }
        const l = this.sh.links[R + ',' + C];
        if (Array.isArray(l)) row.push(new FakeRichText(l.map(x => x.text).join(''), l.length === 1 ? l[0].url || null : null, l));
        else row.push(new FakeRichText(this.sh.display(R, C), l || null));
      }
      out.push(row);
    }
    return out;
  }
  getRichTextValue() { return this.getRichTextValues()[0][0]; }
  getFormula() { return this.sh.formulas[this.r + ',' + this.c] || ''; }
  getFormulas() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.formulas[(this.r + i) + ',' + (this.c + j)] || ''); o.push(row); } return o; }
  setValues(v) {
    if (!Array.isArray(v) || v.length !== this.nr || v.some(row => !Array.isArray(row) || row.length !== this.nc)) {
      throw new Error('Die Anzahl der Zeilen/Spalten in den Daten passt nicht zum Bereich (' + (v && v.length) + 'x' +
        (v && v[0] && v[0].length) + ' statt ' + this.nr + 'x' + this.nc + ') in ' + this.sh.name);
    }
    v.forEach((row, i) => row.forEach((x, j) => this.sh.put(this.r + i, this.c + j, x)));
    const env = this.sh.ss.env;
    env.writes++;
    env.writesBy[this.sh.name] = (env.writesBy[this.sh.name] || 0) + 1;
    return this;
  }
  setValue(x) { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(x))); }
  setFormula(f) { this.cells((R, C) => { this.sh.setCell(R, C, ''); this.sh.formulas[R + ',' + C] = f; }); return this; }
  setFormulas(fs2) { fs2.forEach((row, i) => row.forEach((f, j) => { const R = this.r + i, C = this.c + j; this.sh.setCell(R, C, ''); this.sh.formulas[R + ',' + C] = f; })); return this; }
  setNumberFormat(fmt) { this.cells((R, C) => this.sh.setFmt(R, C, fmt)); return this; }
  setNumberFormats(fm) {
    if (fm.length !== this.nr || fm.some(row => row.length !== this.nc)) throw new Error('setNumberFormats: Abmessungen passen nicht');
    fm.forEach((row, i) => row.forEach((f, j) => this.sh.setFmt(this.r + i, this.c + j, f)));
    return this;
  }
  getNumberFormat() { return this.sh.fmt(this.r, this.c); }
  getNumberFormats() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.fmt(this.r + i, this.c + j)); o.push(row); } return o; }
  clearContent() { this.cells((R, C) => { this.sh.setCell(R, C, ''); delete this.sh.formulas[R + ',' + C]; }); return this; }
  clear() { this.cells((R, C) => { this.sh.setCell(R, C, ''); this.sh.setFmt(R, C, undefined); delete this.sh.formulas[R + ',' + C]; }); return this; }
  clearFormat() { this.cells((R, C) => this.sh.setFmt(R, C, undefined)); return this; }
  insertCheckboxes() { this.cells((R, C) => { this.sh.checkboxes[R + ',' + C] = true; }); return this; }
  getSheet() { return this.sh; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getLastRow() { return this.r + this.nr - 1; }
  getLastColumn() { return this.c + this.nc - 1; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getA1Notation() {
    const a = colLetter(this.c) + this.r;
    return this.nr === 1 && this.nc === 1 ? a : a + ':' + colLetter(this.c + this.nc - 1) + (this.r + this.nr - 1);
  }
  protect() { return chainObj(); }
  activate() { return this; }
}
['setFontWeight', 'setBackground', 'setFontColor', 'setFontSize', 'setFontStyle', 'setBorder', 'setDataValidation',
  'clearDataValidations', 'setVerticalAlignment', 'setHorizontalAlignment', 'setWrap', 'setNote', 'merge', 'breakApart',
  'setFontFamily', 'setBackgrounds', 'setFontColors', 'setFontWeights', 'setRichTextValues', 'setRichTextValue',
  'setWrapStrategy', 'setTextStyle', 'removeCheckboxes', 'setFontLine'].forEach(m => { Range.prototype[m] = function () { return this; }; });
/** Text mit Link (SpreadsheetApp.newRichTextValue): Wert = Text, der Link landet in sh.links. */
Range.prototype.setRichTextValue = function (rt) {
  this.cells((R, C) => {
    this.sh.setCell(R, C, rt && rt.text != null ? String(rt.text) : '');
    delete this.sh.formulas[R + ',' + C];
    if (rt && rt.link) this.sh.links[R + ',' + C] = rt.link; else delete this.sh.links[R + ',' + C];
  });
  return this;
};

/** Schriftfarbe je Zelle, zum Prüfen (die übrigen Formate haben keine Wirkung). */
Range.prototype.setFontColor = function (color) {
  const fc = this.sh.fontColors = this.sh.fontColors || {};
  this.cells((R, C) => { fc[R + ',' + C] = color; });
  return this;
};
Range.prototype.getFontColor = function () { return (this.sh.fontColors || {})[this.r + ',' + this.c] || '#000000'; };

/** Bild über den Zellen (Sheet.insertImage) mit zugewiesener Funktion, Alternativtext, Größe und Anker. */
class FakeImage {
  constructor(sh, src, col, row, ox, oy) {
    this.sh = sh; this.src = src; this.col = col; this.row = row; this.ox = ox || 0; this.oy = oy || 0;
    this.script = ''; this.title = ''; this.desc = ''; this.w = 100; this.h = 100; this.removed = false;
  }
  assignScript(fn) { this.script = String(fn); return this; }
  getScript() { return this.script; }
  setAltTextTitle(t) { this.title = String(t); return this; }
  getAltTextTitle() { return this.title; }
  setAltTextDescription(d) { this.desc = String(d); return this; }
  getAltTextDescription() { return this.desc; }
  setWidth(w) { this.w = w; return this; }
  getWidth() { return this.w; }
  setHeight(h) { this.h = h; return this; }
  getHeight() { return this.h; }
  setAnchorCell(range) { this.col = range.getColumn(); this.row = range.getRow(); return this; }
  getAnchorCell() { return new Range(this.sh, this.row, this.col, 1, 1); }
  setAnchorCellXOffset(x) { this.ox = x; return this; }
  getAnchorCellXOffset() { return this.ox; }
  setAnchorCellYOffset(y) { this.oy = y; return this; }
  getAnchorCellYOffset() { return this.oy; }
  getSheet() { return this.sh; }
  getUrl() { return typeof this.src === 'string' ? this.src : null; }
  remove() { this.removed = true; this.sh.images = this.sh.images.filter(i => i !== this); }
}

// ---------------------------------------------------------------------------
// Formeln ausrechnen (formula.js): Seit 1.2.0 rechnen Gruppen, Pokédex und Dashboard per Formel (#43)
// ---------------------------------------------------------------------------

const isDateObj = v => Object.prototype.toString.call(v) === '[object Date]';
const ERR_TEXT_RE = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|ERROR!|NUM!|NULL!)$/;

/** Zellwert für das Rechenwerk: leer -> null, Datum -> Seriennummer, Fehlertext -> Fehler. */
function fval(v) {
  if (v === '' || v === undefined || v === null) return null;
  if (isDateObj(v)) return F.dateToSerial(v);
  if (typeof v === 'string' && ERR_TEXT_RE.test(v)) return new F.FErr(v);
  return v;
}

function isDateFmt(fmt) { return !!fmt && !/€/.test(fmt) && /yy|dd|hh/i.test(fmt); }

/** Ergebnis einer Formelzelle für getValues: Zahl in einem Datumsformat -> Date (aus dem Skript-Kontext). */
function outValue(sh, R, C, v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && isDateFmt(sh.fmt(R, C))) {
    const env = sh.ss.env;
    const d = F.serialToDate(v);
    return env.VDate ? new env.VDate(d.getTime()) : d;
  }
  return v;
}

/** Bereich für eine Formel lesen: Einzelzelle als Wert, sonst F.Arr; fehlt das Blatt oder die Spalte: #REF! */
function readRef(sh, a1, name) {
  if (!sh) return new F.FErr('#REF!', 'Blatt fehlt: ' + name);
  const p = parseA1(a1);
  const r2 = p.r2 == null ? sh.maxRows : p.r2;
  if (p.c2 > sh.maxCols || r2 > sh.maxRows) return new F.FErr('#REF!', 'Bereich außerhalb von ' + sh.name + ': ' + a1);
  if (p.r === r2 && p.c === p.c2) return fval(sh.rawGet(p.r, p.c));
  const out = [];
  for (let R = p.r; R <= r2; R++) {
    const row = [];
    for (let C = p.c; C <= p.c2; C++) row.push(fval(sh.rawGet(R, C)));
    out.push(row);
  }
  return F.arr(out);
}

/**
 * Formel in (r0, c0) ausrechnen und ausbreiten wie Sheets: Reicht das Blatt nicht oder steht im Bereich schon etwas,
 * zeigt die Zelle #REF!. Lint-Hinweise und Rechenfehler landen in env.formulaLint bzw. env.formulaErrors.
 */
function evalFormulaCell(sh, r0, c0, formula) {
  const env = sh.ss.env;
  const a1 = colLetter(c0) + r0;
  let value;
  const hook = env.formulaDisplay ? String(env.formulaDisplay(sh.name, a1, formula) || '') : '';
  if (/^#/.test(hook)) value = new F.FErr(hook);
  else {
    const res = F.evaluate(formula, {
      ref: (sheet, ref) => readRef(sheet == null ? sh : sh.ss.getSheetByName(sheet), ref, sheet),
      now: () => (env.now ? env.now() : new Date()),
      mode: env.formulaMode
    });
    value = res.value;
    if (res.lint.length) env.formulaLint.push({ sheet: sh.name, cell: a1, lint: res.lint });
    if (F.isErr(value) && value.msg) env.formulaErrors.push({ sheet: sh.name, cell: a1, code: value.code, msg: value.msg });
  }
  const cells = new Map();
  if (F.isArr(value)) {
    const R = value.r, C = value.c;
    let why = '';
    if (!R || !C) why = 'leeres Ergebnis';
    else if (r0 + R - 1 > sh.maxRows || c0 + C - 1 > sh.maxCols) {
      why = 'Result was not automatically expanded, please insert more ' + (r0 + R - 1 > sh.maxRows ? 'rows (' + (r0 + R - 1 - sh.maxRows) + ')' : 'columns');
    } else {
      for (let i = 0; i < R && !why; i++) {
        for (let j = 0; j < C; j++) {
          if (!i && !j) continue;
          const RR = r0 + i, CC = c0 + j;
          const row = sh.d[RR - 1];
          const stored = row ? row[CC - 1] : undefined;
          if (sh.formulas[RR + ',' + CC] || (stored !== undefined && stored !== null && stored !== '')) {
            why = 'Array result was not expanded because it would overwrite data in ' + colLetter(CC) + RR;
            break;
          }
        }
      }
    }
    if (why) {
      value = new F.FErr('#REF!', why);
      env.formulaErrors.push({ sheet: sh.name, cell: a1, code: '#REF!', msg: why });
    } else {
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) cells.set((r0 + i) + ',' + (c0 + j), value.v[i][j] === undefined ? null : value.v[i][j]);
    }
  }
  if (!F.isArr(value)) cells.set(r0 + ',' + c0, value === undefined ? null : value);
  return { value, cells };
}

class Sheet {
  constructor(ss, name, opts) {
    opts = opts || {};
    this.ss = ss; this.name = name;
    this.d = []; this.f = []; this.formulas = {}; this.links = {}; this.disp = null; this.checkboxes = {};
    this.maxRows = opts.maxRows || 1000; this.maxCols = opts.maxCols || 26;
    this.hidden = false; this.frozen = 0; this.hiddenCols = {}; this.rowHeights = {}; this.charts = []; this.rules = [];
    this.images = []; this.gridHidden = false; this.meta = [];
    this.id = ++ss.env.sheetSeq;
  }
  get(R, C) {
    const fv = this.formulaValue(R, C);
    if (fv !== undefined) return fv === null ? '' : F.isErr(fv) ? fv.code : fv;
    const row = this.d[R - 1]; const v = row ? row[C - 1] : undefined; return v === undefined || v === null ? '' : v;
  }
  /** Wert für eine Formel: wie get, aber Fehler als F.FErr. */
  rawGet(R, C) {
    const fv = this.formulaValue(R, C);
    if (fv !== undefined) return fv === null ? '' : fv;
    const row = this.d[R - 1]; const v = row ? row[C - 1] : undefined; return v === undefined || v === null ? '' : v;
  }
  /**
   * Wert aus einer Formel (Anker oder ausgebreitet), sonst undefined. Rechnet nur die Formeln links oberhalb der Zelle,
   * jede einmal je Schreibstand (env.gen).
   */
  formulaValue(R, C) {
    const env = this.ss.env;
    if (!env.evalFormulas) return undefined;
    const keys = Object.keys(this.formulas);
    for (let i = 0; i < keys.length; i++) {
      const p = keys[i].split(',');
      const r0 = +p[0], c0 = +p[1];
      if (r0 > R || c0 > C) continue;
      const res = this.anchorResult(r0, c0);
      if (res && res.cells.has(R + ',' + C)) return outValue(this, R, C, res.cells.get(R + ',' + C));
    }
    return undefined;
  }
  /** Ergebnis der Formel in (r0, c0): {value, cells: Map 'R,C' -> Wert}; null, solange sie gerade rechnet (Kreis). */
  anchorResult(r0, c0) {
    const env = this.ss.env;
    if (this.fxGen !== env.gen) { this.fx = {}; this.fxGen = env.gen; }
    const key = r0 + ',' + c0;
    const hit = this.fx[key];
    if (hit === 'busy') return null;
    if (hit) return hit;
    this.fx[key] = 'busy';
    let res = null;
    try { res = evalFormulaCell(this, r0, c0, this.formulas[key]); } finally { this.fx[key] = res || undefined; }
    return res;
  }
  fmt(R, C) { const row = this.f[R - 1]; return row ? row[C - 1] : undefined; }
  setFmt(R, C, f) { (this.f[R - 1] = this.f[R - 1] || [])[C - 1] = f; }
  setCell(R, C, v) { this.ss.env.gen++; (this.d[R - 1] = this.d[R - 1] || [])[C - 1] = v; }
  put(R, C, x) {
    if (typeof x === 'string' && x.charAt(0) === '=' && this.fmt(R, C) !== '@') { this.setCell(R, C, ''); this.formulas[R + ',' + C] = x; return; }
    delete this.formulas[R + ',' + C];
    this.setCell(R, C, coerce(x, this.fmt(R, C)));
  }
  display(R, C) {
    if (this.disp && this.disp[R - 1] && this.disp[R - 1][C - 1] !== undefined) return String(this.disp[R - 1][C - 1]);
    const f = this.formulas[R + ',' + C];
    const env = this.ss.env;
    if (f && env.formulaDisplay) { const h = String(env.formulaDisplay(this.name, colLetter(C) + R, f) || ''); if (h || !env.evalFormulas) return h; }
    if (f && !env.evalFormulas) return '';
    const fv = this.formulaValue(R, C);
    if (fv !== undefined) return F.isErr(fv) ? fv.code : displayOf(fv === null ? '' : fv, this.fmt(R, C));
    return displayOf(this.get(R, C), this.fmt(R, C));
  }
  getName() { return this.name; }
  setName(n) { this.ss.env.gen++; delete this.ss.byName[this.name]; this.name = n; this.ss.byName[n] = this; return this; }
  getParent() { return this.ss; }
  getSheetId() { return this.id; }
  getIndex() { return this.ss.list.indexOf(this) + 1; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const p = parseA1(a);
      const r2 = p.r2 == null ? this.maxRows : p.r2;
      return new Range(this, p.r, p.c, r2 - p.r + 1, p.c2 - p.c + 1);
    }
    return new Range(this, a, b, c == null ? 1 : c, d == null ? 1 : d);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  hasContent(R, C) { const v = this.get(R, C); return (v !== '' && v !== undefined) || !!this.formulas[R + ',' + C]; }
  getLastRow() {
    let last = 0;
    for (let i = 0; i < this.d.length; i++) if (this.d[i] && this.d[i].some(v => v !== '' && v !== undefined && v !== null)) last = i + 1;
    Object.keys(this.formulas).forEach(k => { last = Math.max(last, +k.split(',')[0]); });
    this.spillCells().forEach(rc => { last = Math.max(last, rc[0]); });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.d.forEach(row => { if (row) for (let j = row.length - 1; j >= last; j--) { const v = row[j]; if (v !== '' && v !== undefined && v !== null) { last = j + 1; break; } } });
    Object.keys(this.formulas).forEach(k => { last = Math.max(last, +k.split(',')[1]); });
    this.spillCells().forEach(rc => { last = Math.max(last, rc[1]); });
    return last;
  }
  /** Zellen mit Inhalt aus ausgebreiteten Formeln: [[R, C]] (leere Texte zählen nicht). */
  spillCells() {
    const out = [];
    if (!this.ss.env.evalFormulas) return out;
    Object.keys(this.formulas).forEach(k => {
      const p = k.split(',');
      const res = this.anchorResult(+p[0], +p[1]);
      if (res) res.cells.forEach((v, rc) => { if (v !== null && v !== '') { const q = rc.split(','); out.push([+q[0], +q[1]]); } });
    });
    return out;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) {
    this.ss.env.gen++;
    if (after < this.d.length) { this.d.splice(after, 0, ...Array.from({ length: n }, () => [])); }
    if (after < this.f.length) { this.f.splice(after, 0, ...Array.from({ length: n }, () => [])); }
    this.maxRows += n; return this;
  }
  insertRowsBefore(before, n) { return this.insertRowsAfter(before - 1, n); }
  insertRows(before, n) { return this.insertRowsAfter(before - 1, n || 1); }
  insertColumnsAfter(after, n) {
    this.ss.env.gen++;
    [this.d, this.f].forEach(m => m.forEach(row => { if (row && after < row.length) row.splice(after, 0, ...Array(n).fill(undefined)); }));
    this.maxCols += n; return this;
  }
  insertColumnsBefore(before, n) { return this.insertColumnsAfter(before - 1, n); }
  deleteRows(r, n) {
    this.ss.env.gen++;
    if (r < 1 || r + n - 1 > this.maxRows) throw new Error('deleteRows außerhalb');
    this.d.splice(r - 1, n); this.f.splice(r - 1, n);
    const fm = {};
    Object.keys(this.formulas).forEach(k => { const [R, C] = k.split(',').map(Number); if (R < r) fm[k] = this.formulas[k]; else if (R >= r + n) fm[(R - n) + ',' + C] = this.formulas[k]; });
    this.formulas = fm;
    this.maxRows -= n; return this;
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteColumns(c, n) {
    this.ss.env.gen++;
    if (c < 1 || c + n - 1 > this.maxCols) throw new Error('deleteColumns außerhalb');
    [this.d, this.f].forEach(m => m.forEach(row => { if (row) row.splice(c - 1, n); }));
    this.maxCols -= n; return this;
  }
  deleteColumn(c) { return this.deleteColumns(c, 1); }
  appendRow(arr) {
    const R = this.getLastRow() + 1;
    if (R > this.maxRows) this.maxRows = R;
    if (arr.length > this.maxCols) this.maxCols = arr.length;
    arr.forEach((x, j) => this.put(R, j + 1, x));
    return this;
  }
  clear() { this.ss.env.gen++; this.d = []; this.f = []; this.formulas = {}; this.checkboxes = {}; return this; }
  clearContents() { this.ss.env.gen++; this.d = []; this.formulas = {}; return this; }
  clearFormats() { this.f = []; return this; }
  hideSheet() { this.hidden = true; return this; }
  showSheet() { this.hidden = false; return this; }
  isSheetHidden() { return this.hidden; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getFrozenRows() { return this.frozen; }
  setFrozenColumns() { return this; }
  hideColumns(c, n) { for (let i = 0; i < (n || 1); i++) this.hiddenCols[c + i] = true; return this; }
  showColumns(c, n) { for (let i = 0; i < (n || 1); i++) delete this.hiddenCols[c + i]; return this; }
  isColumnHiddenByUser(c) { return !!this.hiddenCols[c]; }
  hideRows() { return this; }
  showRows() { return this; }
  setColumnWidth() { return this; }
  setColumnWidths() { return this; }
  autoResizeColumns() { return this; }
  setRowHeight(r, h) { this.rowHeights[r] = h; return this; }
  setRowHeights(r, n, h) { for (let i = 0; i < n; i++) this.rowHeights[r + i] = h; return this; }
  setRowHeightsForced(r, n, h) { return this.setRowHeights(r, n, h); }
  getProtections() { return []; }
  protect() { return chainObj(); }
  clearConditionalFormatRules() { this.rules = []; return this; }
  setConditionalFormatRules(rules) { this.rules = rules; return this; }
  getConditionalFormatRules() { return this.rules; }
  getCharts() { return this.charts; }
  newChart() { return chainObj(); }
  insertChart(c) { this.charts.push(c); return this; }
  updateChart() { return this; }
  removeChart() { return this; }
  activate() { this.ss.active = this; return this; }
  setTabColor() { return this; }
  setHiddenGridlines(b) { this.gridHidden = !!b; return this; }
  hasHiddenGridlines() { return this.gridHidden; }
  /** src: Blob oder URL. Ein Blob ohne Bytes oder mit falschem Typ scheitert wie in Apps Script. */
  insertImage(src, col, row, ox, oy) {
    if (src && typeof src === 'object' && typeof src.getBytes === 'function') {
      const type = String(src.getContentType ? src.getContentType() || '' : '');
      if (!src.getBytes().length || !/^image\/(png|jpeg|gif)$/.test(type)) throw new Error('Das Bild konnte nicht eingefügt werden (' + (type || 'kein Typ') + ').');
    }
    const img = new FakeImage(this, src, col, row, ox, oy);
    this.images.push(img);
    this.ss.env.imagesInserted = (this.ss.env.imagesInserted || 0) + 1;
    return img;
  }
  getImages() { return this.images.slice(); }
  addDeveloperMetadata(key, value) { this.meta.push({ key: String(key), value: value == null ? null : String(value) }); return this; }
  getDeveloperMetadata() {
    return this.meta.map(m => ({ getKey: () => m.key, getValue: () => m.value, remove: () => { this.meta = this.meta.filter(x => x !== m); } }));
  }
  copyTo(ss2) {
    let n = 'Kopie von ' + this.name;
    let i = 2;
    while (ss2.byName[n]) n = 'Kopie von ' + this.name + ' ' + (i++);
    return cloneSheet(this, ss2, n);
  }
}

/** Blatt mit Werten, Formaten, Formeln und Größe in eine Tabelle kopieren (für copyTo und makeCopy). */
function cloneSheet(sh, ss2, name) {
  const c = ss2.insertSheet(name, { maxRows: sh.maxRows, maxCols: sh.maxCols });
  c.d = sh.d.map(r => (r ? r.map(v => (v instanceof Date ? new Date(v.getTime()) : v)) : r));
  c.f = sh.f.map(r => (r ? r.slice() : r));
  c.formulas = Object.assign({}, sh.formulas);
  c.links = Object.assign({}, sh.links);
  c.checkboxes = Object.assign({}, sh.checkboxes);
  c.hidden = sh.hidden;
  c.frozen = sh.frozen;
  c.gridHidden = sh.gridHidden;
  c.images = sh.images.map(i => Object.assign(new FakeImage(c, i.src, i.col, i.row, i.ox, i.oy),
    { script: i.script, title: i.title, desc: i.desc, w: i.w, h: i.h }));
  c.meta = sh.meta.map(m => Object.assign({}, m));
  return c;
}

class FakeSpreadsheet {
  constructor(env, id, name, opts) {
    opts = opts || {};
    this.env = env; this.id = id; this.name = name || id; this.mime = opts.mime || MIME.GOOGLE_SHEETS;
    this.list = []; this.byName = {}; this.active = null; this.toasts = [];
  }
  getSheetByName(n) { return this.byName[n] || null; }
  insertSheet(n, opts) {
    if (n && typeof n === 'object') { opts = n; n = null; }
    let index = null;
    if (typeof opts === 'number') { index = opts; opts = null; } // insertSheet(name, index), index ab 0
    if (!n) { let i = this.list.length + 1; while (this.byName['Tabellenblatt' + i]) i++; n = 'Tabellenblatt' + i; }
    if (this.byName[n]) throw new Error('Ein Tabellenblatt mit dem Namen „' + n + '“ existiert bereits.');
    this.env.gen++;
    const sh = new Sheet(this, n, opts);
    if (index == null) this.list.push(sh); else this.list.splice(index, 0, sh);
    this.byName[n] = sh;
    return sh;
  }
  getSheets() { return this.list.slice(); }
  getSheetById(id) { return this.list.find(s => s.id === id) || null; }
  deleteSheet(sh) { this.env.gen++; this.list = this.list.filter(s => s !== sh); delete this.byName[sh.name]; }
  getId() { return this.id; }
  getName() { return this.name; }
  rename(n) { this.name = String(n); if (this.env && this.env.driveFiles && this.env.driveFiles[this.id]) this.env.driveFiles[this.id].name = this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSpreadsheetTimeZone() { return 'Europe/Berlin'; }
  getSpreadsheetLocale() { return 'de_DE'; }
  setActiveSheet(sh) { this.active = sh; return sh; }
  getActiveSheet() { return this.active || this.list[0] || null; }
  moveActiveSheet(pos) {
    const sh = this.getActiveSheet();
    if (!sh) return;
    this.list = this.list.filter(s => s !== sh);
    this.list.splice(pos - 1, 0, sh);
  }
  toast(msg, title, timeout) { this.toasts.push(String(msg)); this.toastLog = (this.toastLog || []).concat([{ msg: String(msg), title: title, timeout: timeout }]); }
}

// ---------------------------------------------------------------------------
// tcgdex-Attrappe (wie die alte harness.js)
// ---------------------------------------------------------------------------

const card = (id, lang, extra = {}) => Object.assign({
  id, localId: id.split('-').pop(), name: lang === 'de' ? 'Glurak' : 'Charizard', image: `https://assets.tcgdex.net/${lang}/x/${id}`,
  category: 'Pokemon', rarity: 'Rare', illustrator: 'X',
  set: { id: id.slice(0, id.lastIndexOf('-')), name: lang === 'de' ? 'Flammende Finsternis' : 'Darkness Ablaze', cardCount: { official: 189, total: 201 } },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false },
  pricing: { cardmarket: { trend: 1.5, 'trend-holo': 3.25, updated: '2026-10-13T00:00:00Z' } }
}, extra);

function defaultDb() {
  return {
    'de/cards?name=Glurak': [{ id: 'swsh3-025', localId: '025', name: 'Glurak' }, { id: 'swsh3-136', localId: '136', name: 'Glurak' }, { id: 'base1-4', localId: '4', name: 'Glurak' }],
    'de/cards/swsh3-025': card('swsh3-025', 'de'),
    'en/cards/swsh3-025': card('swsh3-025', 'en'),
    'de/cards/swsh3-136': card('swsh3-136', 'de', { pricing: undefined }),
    'en/cards/swsh3-136': card('swsh3-136', 'en'),
    'de/cards/base1-4': card('base1-4', 'de', { image: undefined, variants: { holo: true, normal: false, reverse: false, firstEdition: true } }),
    'en/cards/base1-4': card('base1-4', 'en'),
    'de/sets': [{ id: 'swsh3', name: 'Flammende Finsternis', logo: 'L', cardCount: { official: 189, total: 201 } }, { id: 'base1', name: 'Grundset', cardCount: { official: 102, total: 102 } }],
    'en/sets': [{ id: 'swsh3', name: 'Darkness Ablaze', cardCount: { official: 189, total: 201 } }, { id: 'base1', name: 'Base Set', cardCount: { official: 102, total: 102 } }, { id: 'old9', name: 'Old Set', cardCount: { official: 50 } }],
    'de/sets/swsh3': { id: 'swsh3', name: 'Flammende Finsternis', releaseDate: '2020-08-14', cards: [{ id: 'swsh3-025', localId: '025', name: 'Glurak' }, { id: 'swsh3-136', localId: '136', name: 'Glurak' }] },
    'en/sets/swsh3': { id: 'swsh3', name: 'Darkness Ablaze', releaseDate: '2020-08-14', cards: [{ id: 'swsh3-025', localId: '025', name: 'Charizard' }, { id: 'swsh3-136', localId: '136', name: 'Charizard' }] },
    'de/sets/base1': { id: 'base1', name: 'Grundset', releaseDate: '1999-01-09', cards: [{ id: 'base1-4', localId: '4', name: 'Glurak' }] },
    'en/sets/base1': { id: 'base1', name: 'Base Set', releaseDate: '1999-01-09', cards: [{ id: 'base1-4', localId: '4', name: 'Charizard' }] },
    'de/cards': [{ id: 'swsh3-025', name: 'Glurak' }, { id: 'sv1-1', name: 'Glurak-ex' }, { id: 'old9-7', name: 'Mewtu' }],
    'en/cards': [{ id: 'swsh3-025', name: 'Charizard' }, { id: 'sv1-1', name: 'Charizard ex' }, { id: 'old9-7', name: 'Mewtwo' }],
    'de/cards?name=Mewtu': [],
    'en/cards?name=Mewtwo': [{ id: 'old9-007', localId: '007', name: 'Mewtwo' }],
    'en/cards/old9-007': card('old9-007', 'en', { name: 'Mewtwo', set: { id: 'old9', name: 'Old Set', cardCount: { official: 50 } } }),
    'en/sets/old9': { id: 'old9', name: 'Old Set', releaseDate: '2001-01-01', cards: [{ id: 'old9-007', localId: '007', name: 'Mewtwo' }] },
    'de/cards?name=Unbekannt': [],
    'en/cards?name=Unbekannt': []
  };
}

// ---------------------------------------------------------------------------
// Umgebung
// ---------------------------------------------------------------------------

function createEnv(opts) {
  opts = opts || {};
  const srcDir = opts.srcDir || SRC_DIR;
  let files = opts.files;
  if (!files) {
    files = ['Code.gs'];
    if (fs.existsSync(path.join(srcDir, 'Import.gs'))) files.push('Import.gs');
    if (fs.existsSync(path.join(srcDir, 'Update.gs'))) files.push('Update.gs');
  }

  const env = {
    srcDir, files, writes: 0, writesBy: {}, sheetSeq: 0, uuidSeq: 0, flushes: 0,
    props: {}, userProps: {}, docProps: {}, cache: new Map(), cachePuts: [],
    fetchLog: [], fetchFail: null, triggers: [], templates: [], outputs: [], sleeps: 0,
    lock: { depth: 0, acquired: 0, nested: 0, busy: false, maxDepth: 0 },
    formulaDisplay: null, promptResponse: '', promptButton: 'OK',
    gen: 0, evalFormulas: opts.formulas !== false, formulaMode: opts.formulaMode || {}, formulaLint: [], formulaErrors: [], now: null,
    driveFiles: {}, sources: {}, drive: opts.drive === undefined ? 'v3' : opts.drive, driveCopies: [],
    http: null, httpLog: [], backups: [], perms: {}, permCreates: [], makeCopyFails: 0
  };
  env.DB = opts.db || defaultDb();

  // --- Hauptsheet
  const ss = new FakeSpreadsheet(env, 'SSID', 'Pokémon-Sammlung');
  (opts.sheets || ['Tabellenblatt1']).forEach(n => ss.insertSheet(n));
  env.ss = ss;

  // --- UI
  const ui = {
    alerts: [], sidebars: [], prompts: [], dialogs: [], menus: [],
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    // mit Knöpfen (YES_NO …) antwortet env.alertAnswer, sonst Ja bzw. OK
    alert(a, b, c) { ui.alerts.push(b === undefined ? String(a) : String(a) + ': ' + String(b)); return c ? (env.alertAnswer || (c === 'YES_NO' ? 'YES' : 'OK')) : 'OK'; },
    showSidebar(h) { ui.sidebars.push(h); },
    showModalDialog(h, t) { ui.dialogs.push({ h, t }); },
    showModelessDialog(h, t) { ui.dialogs.push({ h, t }); },
    prompt(title, msg) { ui.prompts.push({ title, msg }); return { getSelectedButton: () => env.promptButton, getResponseText: () => env.promptResponse }; },
    createMenu(name) {
      const items = [], subs = [];
      const entry = { name, items, subs };
      ui.menus.push(entry);
      const m = {
        __entry: entry,
        addItem(l, f) { items.push([l, f]); return m; }, addSeparator() { return m; },
        // Untermenü: gehört zum Hauptmenü, nicht in ui.menus
        addSubMenu(sub) { if (sub && sub.__entry) { ui.menus = ui.menus.filter(x => x !== sub.__entry); subs.push(sub.__entry); } return m; },
        addToUi() { return m; }
      };
      return m;
    }
  };
  env.ui = ui;

  // --- Html
  function htmlOutput(content) {
    const o = {
      content: content || '', title: '', meta: [],
      getContent() { return o.content; }, setContent(c) { o.content = c; return o; }, append(c) { o.content += c; return o; },
      setTitle(t) { o.title = t; return o; }, getTitle() { return o.title; },
      addMetaTag(n, c) { o.meta.push([n, c]); return o; },
      setWidth() { return o; }, setHeight() { return o; }, setSandboxMode() { return o; }, setXFrameOptionsMode() { return o; },
      setFaviconUrl() { return o; }
    };
    env.outputs.push(o);
    return o;
  }
  function htmlFile(name) {
    const p = path.join(srcDir, name + '.html');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  const HtmlService = {
    createTemplateFromFile(name) {
      const content = htmlFile(name);
      if (content == null) throw new Error('No HTML file named ' + name + ' was found.');
      const t = { __file: name, __content: content, evaluate() { const o = htmlOutput(content); o.template = t; return o; }, getRawContent() { return content; } };
      env.templates.push(t);
      return t;
    },
    createHtmlOutputFromFile(name) {
      const content = htmlFile(name);
      if (content == null) throw new Error('No HTML file named ' + name + ' was found.');
      return htmlOutput(content);
    },
    createHtmlOutput(html) { return htmlOutput(html || ''); },
    createTemplate(html) { const t = { __content: html, evaluate() { return htmlOutput(html); } }; env.templates.push(t); return t; },
    SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE' },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' }
  };

  // --- tcgdex
  /** Antwort mit Text oder Bytes (Buffer), wie HTTPResponse */
  function httpResponse(code, body, type) {
    const text = typeof body === 'string' ? body : body === undefined || Buffer.isBuffer(body) ? '' : JSON.stringify(body);
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(text, 'utf8');
    type = type || (Buffer.isBuffer(body) ? 'image/png' : 'text/plain');
    return {
      getResponseCode: () => code, getContentText: () => text, getHeaders: () => ({ 'Content-Type': type }),
      getBlob: () => {
        let ct = type, nm = null;
        return { getBytes: () => signedBytes(bytes), getContentType: () => ct, setContentType(t) { ct = t; return this; },
          getName: () => nm, setName(n) { nm = n; return this; }, getDataAsString: () => text };
      }
    };
  }
  function resp(url, opt) {
    if (env.http) {
      const r = env.http(url, opt || {});
      if (r !== undefined) {
        env.httpLog.push({ url, method: String((opt && opt.method) || 'get').toLowerCase(), payload: opt && opt.payload, headers: opt && opt.headers });
        if (r === 'throw') throw new Error('Address unavailable: ' + url);
        return httpResponse(r.code || 200, r.body, r.type);
      }
    }
    env.fetchLog.push(url);
    if (env.fetchFail) {
      const f = env.fetchFail(url);
      if (f === 'throw') throw new Error('Address unavailable: ' + url);
      if (typeof f === 'number') return { getResponseCode: () => f, getContentText: () => '', getHeaders: () => ({}) };
    }
    // Knöpfe des Dashboards: die Bilder aus assets/dashboard im Repo (egal auf welchem Commit)
    const asset = /^https:\/\/raw\.githubusercontent\.com\/studiobaeric\/collection-sheet\/[^/]+\/(assets\/dashboard\/[\w-]+\.png)$/.exec(url);
    if (asset) {
      const file = path.join(__dirname, '..', asset[1]);
      return fs.existsSync(file) ? httpResponse(200, fs.readFileSync(file), 'image/png') : httpResponse(404, '404: Not Found');
    }
    let body;
    if (url.indexOf(API) === 0) {
      const k = decodeURIComponent(url.slice(API.length));
      body = env.DB[k];
    }
    if (typeof body === 'function') body = body(url);
    const text = body === undefined ? '{"error":"not found"}' : JSON.stringify(body);
    return { getResponseCode: () => (body === undefined ? 404 : 200), getContentText: () => text, getHeaders: () => ({}) };
  }
  const UrlFetchApp = {
    fetch: (u, o) => resp(u, o),
    fetchAll: (rs) => rs.map(r => (typeof r === 'string' ? resp(r) : resp(r.url, r)))
  };

  // --- Properties / Cache / Lock
  function propStore(store) {
    return {
      getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setProperty(k, v) { store[k] = String(v); return this; },
      deleteProperty(k) { delete store[k]; return this; },
      getProperties: () => Object.assign({}, store),
      setProperties(o, deleteOthers) { if (deleteOthers) Object.keys(store).forEach(k => delete store[k]); Object.keys(o).forEach(k => { store[k] = String(o[k]); }); return this; },
      deleteAllProperties() { Object.keys(store).forEach(k => delete store[k]); return this; },
      getKeys: () => Object.keys(store)
    };
  }
  const PropertiesService = {
    getScriptProperties: () => propStore(env.props),
    getUserProperties: () => propStore(env.userProps),
    getDocumentProperties: () => propStore(env.docProps)
  };
  const scriptCache = {
    get: k => (env.cache.has(k) ? env.cache.get(k) : null),
    put(k, v, ttl) {
      v = String(v);
      if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
      env.cache.set(k, v); env.cachePuts.push({ k, size: v.length, ttl });
    },
    remove: k => { env.cache.delete(k); },
    getAll: keys => { const o = {}; keys.forEach(k => { if (env.cache.has(k)) o[k] = env.cache.get(k); }); return o; },
    putAll(o, ttl) { Object.keys(o).forEach(k => scriptCache.put(k, o[k], ttl)); },
    removeAll: keys => keys.forEach(k => env.cache.delete(k))
  };
  const CacheService = { getScriptCache: () => scriptCache, getUserCache: () => scriptCache, getDocumentCache: () => scriptCache };
  const lockObj = {
    tryLock() {
      if (env.lock.busy) return false;
      env.lock.acquired++; env.lock.depth++;
      if (env.lock.depth > 1) env.lock.nested++;
      env.lock.maxDepth = Math.max(env.lock.maxDepth, env.lock.depth);
      return true;
    },
    waitLock(ms) { if (!lockObj.tryLock(ms)) throw new Error('Lock timeout'); },
    releaseLock() { env.lock.depth = Math.max(0, env.lock.depth - 1); },
    hasLock: () => env.lock.depth > 0
  };
  const LockService = { getScriptLock: () => lockObj, getDocumentLock: () => lockObj, getUserLock: () => lockObj };

  // --- Drive
  const rootFolder = { getId: () => 'ROOT', getName: () => 'Meine Ablage' };
  function driveFile(id) {
    const f = env.driveFiles[id] || (id === env.ss.id ? { name: env.ss.name, mime: MIME.GOOGLE_SHEETS, main: true } : null);
    if (!f) throw new Error('No item with the given ID could be found, or you do not have permission to access it. (' + id + ')');
    const book = env.sources[id] || (id === env.ss.id ? env.ss : null);
    return {
      getId: () => id, getName: () => f.name, getMimeType: () => f.mime,
      getUrl: () => (book ? book.getUrl() : 'https://drive.google.com/file/d/' + id + '/view'),
      setTrashed(b) { f.trashed = !!b; return this; }, isTrashed: () => !!f.trashed, getSize: () => 1000,
      getLastUpdated: () => new Date(2026, 9, 1),
      getParents() { let done = !!env.noParents; return { hasNext: () => !done, next: () => { done = true; return rootFolder; } }; },
      // Kopie einer Google-Tabelle: alle Blätter mit Werten, Formaten und Formeln (wie Drive, Skript inklusive)
      makeCopy(name, folder) {
        if (!book) throw new Error('makeCopy nur für Tabellen nachgebildet');
        if (env.makeCopyFails > 0) { env.makeCopyFails--; throw new Error('Drive: Kopieren nicht erlaubt'); }
        const nid = 'BACKUP' + (++env.uuidSeq) + 'xxxxxxxxxxxxxxxxxxxx';
        const copy = new FakeSpreadsheet(env, nid, name);
        book.list.forEach(sh => cloneSheet(sh, copy, sh.name));
        env.sources[nid] = copy;
        env.driveFiles[nid] = { name, mime: MIME.GOOGLE_SHEETS, tabs: {}, trashed: false };
        env.backups.push({ id: nid, name, folder: folder && folder.getId ? folder.getId() : null });
        return driveFile(nid);
      }
    };
  }
  const DriveApp = {
    getFileById: driveFile,
    getRootFolder: () => rootFolder
  };
  function driveCopy(resource, id, extra) {
    const src = env.driveFiles[id];
    if (!src) throw new Error('File not found: ' + id);
    const newId = 'tmp' + (++env.uuidSeq);
    const name = (resource && (resource.name || resource.title)) || ('Kopie von ' + src.name);
    const conv = resource && resource.mimeType === MIME.GOOGLE_SHEETS;
    env.driveCopies.push({ from: id, to: newId, resource, extra });
    registerSource({ id: newId, name, mime: conv ? MIME.GOOGLE_SHEETS : src.mime, tabs: src.tabs });
    return { id: newId, name, title: name, mimeType: conv ? MIME.GOOGLE_SHEETS : src.mime };
  }
  // Freigaben (Drive v3): env.perms[id] = [{type, role, emailAddress?, domain?}], sonst nur der Besitzer
  const permsOf = id => env.perms[id] || [{ type: 'user', role: 'owner', emailAddress: 'ich@example.org' }];
  const Permissions = {
    list: (id) => ({ permissions: permsOf(id).map(p => Object.assign({}, p)) }),
    create(res, id, args) {
      if (env.permFail && env.permFail(res)) throw new Error('Freigabe nicht erlaubt');
      env.perms[id] = permsOf(id).concat([Object.assign({}, res)]);
      env.permCreates.push({ id, res: Object.assign({}, res), args: Object.assign({}, args) });
      return res;
    }
  };
  let Drive;
  if (env.drive === 'v3') {
    Drive = { Permissions, Files: {
      copy: (resource, id, extra) => driveCopy(resource, id, extra),
      create: (resource) => { const nid = 'new' + (++env.uuidSeq); env.driveFiles[nid] = { name: resource && resource.name, mime: resource && resource.mimeType }; return { id: nid }; },
      get: id => { driveFile(id); const f = env.driveFiles[id]; return { id, name: f.name, mimeType: f.mime }; },
      remove: id => { delete env.driveFiles[id]; },
      update: (res, id) => { const f = env.driveFiles[id]; if (f && res && res.trashed) f.trashed = true; return { id }; }
    } };
  } else if (env.drive === 'v2') {
    Drive = { Files: {
      copy: (resource, id, extra) => { if (!extra || !extra.convert) throw new Error('v2-Kopie ohne convert'); return driveCopy(resource, id, extra); },
      insert: (resource) => { const nid = 'new' + (++env.uuidSeq); env.driveFiles[nid] = { name: resource && resource.title, mime: resource && resource.mimeType }; return { id: nid }; },
      get: id => { driveFile(id); const f = env.driveFiles[id]; return { id, title: f.name, mimeType: f.mime }; },
      remove: id => { delete env.driveFiles[id]; },
      trash: id => { const f = env.driveFiles[id]; if (f) f.trashed = true; return { id }; }
    } };
  }

  /**
   * Quelldatei registrieren. spec = {id, name, mime ('sheet'|'xlsx'|'xls'|MIME-Text),
   *   tabs: {Tabname: {values: 2D, display?: 2D, links?: {'zeile,spalte' (1-basiert): url | [{text, url}]}} | 2D}}
   * Google-Sheets-Quellen öffnet SpreadsheetApp.openById; xlsx nur über eine Drive-Kopie.
   */
  function registerSource(spec) {
    const mime = spec.mime === 'xlsx' ? MIME.MICROSOFT_EXCEL : spec.mime === 'xls' ? MIME.MICROSOFT_EXCEL_LEGACY
      : (!spec.mime || spec.mime === 'sheet') ? MIME.GOOGLE_SHEETS : spec.mime;
    env.driveFiles[spec.id] = { name: spec.name || spec.id, mime, tabs: spec.tabs || {}, trashed: false };
    if (mime === MIME.GOOGLE_SHEETS) {
      const s = new FakeSpreadsheet(env, spec.id, spec.name || spec.id);
      Object.keys(spec.tabs || {}).forEach(tab => {
        const t = Array.isArray(spec.tabs[tab]) ? { values: spec.tabs[tab] } : spec.tabs[tab];
        const vals = t.values || [];
        const sh = s.insertSheet(tab, { maxRows: Math.max(1000, vals.length), maxCols: Math.max(26, ...vals.map(r => r.length)) });
        vals.forEach((row, i) => row.forEach((v, j) => sh.setCell(i + 1, j + 1, v instanceof Date ? new Date(v.getTime()) : v)));
        if (t.display) sh.disp = t.display.map(r => r.slice());
        if (t.links) sh.links = Object.assign({}, t.links);
      });
      env.sources[spec.id] = s;
    }
    return env.driveFiles[spec.id];
  }
  env.addSource = registerSource;

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => (opts.noActive ? null : ss),
    getActive: () => (opts.noActive ? null : ss),
    openById(id) {
      if (id === ss.getId()) return ss;
      if (env.sources[id]) return env.sources[id];
      throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp. (' + id + ')');
    },
    openByUrl(url) { const m = String(url).match(/\/d\/([\w-]+)/); return SpreadsheetApp.openById(m ? m[1] : url); },
    flush() { env.flushes++; },
    getUi() { if (opts.noUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; },
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
    BorderStyle: { SOLID: 'SOLID', DASHED: 'DASHED' },
    newDataValidation: () => chainObj(),
    newConditionalFormatRule: () => ruleBuilder(),
    newRichTextValue() {
      const rt = { text: '', link: null };
      const b = {
        setText(t) { rt.text = String(t); return b; },
        setLinkUrl(a, bb, c) { rt.link = c === undefined ? a : c; return b; },
        setTextStyle() { return b; },
        build: () => new FakeRichText(rt.text, rt.link)
      };
      return b;
    },
    newTextStyle: () => chainObj(),
    WrapStrategy: { WRAP: 'WRAP', CLIP: 'CLIP' }
  };

  const Utilities = {
    sleep() { env.sleeps++; },
    formatDate,
    getUuid() {
      const n = ++env.uuidSeq;
      return '3f2a9c1e-7b4d-4e8a-9c3b-' + n.toString(16).padStart(12, '0');
    },
    DigestAlgorithm: { MD2: 'md2', MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512' },
    Charset: { US_ASCII: 'US_ASCII', UTF_8: 'UTF_8' },
    computeDigest(alg, value) { return signedBytes(crypto.createHash(alg).update(bytesOf(value)).digest()); },
    base64Encode(v) { return bytesOf(v).toString('base64'); },
    base64Decode(s) { return signedBytes(Buffer.from(s, 'base64')); },
    newBlob(data, contentType, name) {
      const b = bytesOf(data);
      return { getBytes: () => signedBytes(b), getDataAsString: () => b.toString('utf8'), getContentType: () => contentType || null, getName: () => name || null, setName(n) { name = n; return this; } };
    },
    parseCsv(s) { return String(s).split(/\r?\n/).filter(Boolean).map(l => l.split(',')); }
  };

  const ScriptApp = {
    getProjectTriggers: () => env.triggers.slice(),
    deleteTrigger: t => { env.triggers = env.triggers.filter(x => x !== t); },
    newTrigger(fn) {
      const t = { fn, getHandlerFunction: () => fn, getUniqueId: () => fn + env.triggers.length };
      const b = new Proxy({}, { get: (o, p) => (p === 'create' ? () => { env.triggers.push(t); return t; } : () => b) });
      return b;
    },
    getService: () => ({ getUrl: () => null }),
    getScriptId: () => 'SCRIPTID',
    getOAuthToken: () => 'TOKEN',
    AuthMode: { FULL: 'FULL', LIMITED: 'LIMITED' }
  };

  // console.log landet im Protokoll der Ausführung (Zeitprotokoll, #43): hier in env.logs statt in der Testausgabe
  env.logs = [];
  const ctx = {
    console: Object.assign(Object.create(console), { log: (...a) => { env.logs.push(a.map(String).join(' ')); }, info: (...a) => { env.logs.push(a.map(String).join(' ')); } }),
    Logger: { log() {} },
    SpreadsheetApp, PropertiesService, CacheService, LockService, UrlFetchApp, Utilities, ScriptApp, HtmlService, DriveApp,
    Session: { getScriptTimeZone: () => 'Europe/Berlin', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    Charts: { ChartType: { LINE: 'LINE' } },
    MimeType: Object.assign({}, MIME)
  };
  if (Drive) ctx.Drive = Drive;
  env.ctx = ctx;
  vm.createContext(ctx);
  env.VDate = vm.runInContext('Date', ctx); // Datumswerte aus Formeln wie die des Skripts (instanceof Date im Kontext)
  files.forEach(f => {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });

  // --- Lesehilfen
  env.run = code => vm.runInContext(code, ctx);
  env.sheet = name => ss.getSheetByName(name);
  env.values = name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return null;
    const lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (!lr || !lc) return [];
    return sh.getRange(1, 1, lr, lc).getValues();
  };
  env.objects = (name, headerRow) => {
    const v = env.values(name);
    if (!v || !v.length) return [];
    const h = v[(headerRow || 1) - 1].map(String);
    return v.slice(headerRow || 1).filter(r => r.some(x => x !== '')).map(r => {
      const o = {};
      h.forEach((k, j) => { if (k) o[k] = r[j]; });
      return o;
    });
  };
  /** Daten als Objekte mit den COL-Namen (key, id, …, fp) plus extras {Name: Wert} und row (Blattzeile). */
  env.data = () => {
    const v = env.values('Daten');
    if (!v || v.length < 2) return [];
    const COL = env.run('COL');
    const NCOL = env.run('NCOL');
    const h = v[0].map(String);
    const out = [];
    v.slice(1).forEach((r, i) => {
      if (!r.some(x => x !== '')) return;
      const o = { row: i + 2, extras: {} };
      Object.keys(COL).forEach(k => { o[k] = r[COL[k]] === undefined ? '' : r[COL[k]]; });
      for (let j = NCOL; j < h.length; j++) if (h[j]) o.extras[h[j]] = r[j] === undefined ? '' : r[j];
      out.push(o);
    });
    return out;
  };
  env.groups = () => env.objects('Gruppen');
  /** Einstellung aus dem Blatt „Tool-Einstellungen“ (erster Eintrag), sonst wie settingGet_ die alte Skript-Eigenschaft. */
  env.setting = key => {
    const v = env.values('Tool-Einstellungen');
    if (v) { const row = v.slice(1).find(r => String(r[0]) === key); if (row) return String(row[1]); }
    return env.props[key];
  };
  env.proto = () => env.objects('Import-Protokoll');
  /** Wie google.script.run: Ergebnis muss JSON-fähig sein, Rückgabe als JSON-Kopie. */
  env.uiCall = (fn, ...args) => {
    if (/_$/.test(fn)) throw new Error(fn + ' ist privat und nicht über google.script.run aufrufbar');
    if (typeof ctx[fn] !== 'function') throw new Error('Funktion fehlt: ' + fn);
    const res = ctx[fn](...JSON.parse(JSON.stringify(args)));
    assertPlain(res, fn);
    return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
  };
  env.setFormulaDisplay = fn => { env.formulaDisplay = fn; };
  return env;
}

/** Mini-Testlauf: const t = runner('core'); t.ok(label, cond, extra); t.done(); */
function runner(name) {
  let pass = 0, fail = 0;
  const t = {
    ok(label, cond, extra) {
      if (cond) { pass++; console.log('ok  ', label); }
      else {
        fail++; process.exitCode = 1;
        console.log('FAIL', label, extra === undefined ? '' : (() => { try { return JSON.stringify(extra).slice(0, 900); } catch (e) { return String(extra); } })());
      }
      return !!cond;
    },
    eq(label, a, b) { const ja = JSON.stringify(a), jb = JSON.stringify(b); return t.ok(label, ja === jb, { got: a, want: b }); },
    throws(label, fn, re) {
      try { fn(); } catch (e) { return t.ok(label, !re || re.test(e.message), e.message); }
      return t.ok(label, false, 'kein Fehler');
    },
    section(s) { console.log('\n# ' + s); },
    done() {
      console.log('\n' + (name ? name + ': ' : '') + pass + ' passed, ' + fail + ' failed');
      if (fail) process.exitCode = 1;
      return { pass, fail };
    },
    get pass() { return pass; },
    get fail() { return fail; }
  };
  return t;
}

module.exports = { createEnv, card, defaultDb, runner, assertPlain, formatDate, parseA1, colLetter, MIME, API, SRC_DIR };
