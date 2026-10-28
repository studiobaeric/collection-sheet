  // -------------------------------------------------------------------------
  // Ablauf des Formeltests (tools/formeltest/ablauf.gs, eingebaut von tools/formeltest/bauen.js)
  // -------------------------------------------------------------------------
  // Läuft in einer Tabelle mit 1.1.3 und nutzt deren Funktionen (readData_, groupSheetRow_, pokedexIndex_ …) als
  // Vergleich. Die Formeln oben stammen aus 1.2.0. Alle Formeln lesen eine Kopie von Daten („FT Daten“) und schreiben in
  // Hilfsblätter „FT …“, die am Ende wieder verschwinden. Daten, Sammlung, Pokédex und Dashboard bleiben, wie sie sind.

  const FT = {
    data: 'FT Daten', groups: 'FT Gruppen', dexIds: 'FT Pokédex-Nummern', dexData: 'FT Pokédex-Daten', dex: 'FT Pokédex',
    view: 'FT Sammlung', dash: 'FT Dashboard', probes: 'FT Proben', room: 'FT Platz'
  };
  const REPORT = 'Formeltest';

  function run() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const started = Date.now();
    const out = [];
    const st = { problems: 0 };
    const log = {
      info: function (a, b, c) { out.push([a, b, c == null ? '' : c]); },
      ok: function (a, b, c) { out.push([a, '✓ ' + b, c == null ? '' : c]); },
      bad: function (a, b, c) { st.problems++; out.push([a, '✗ ' + b, c == null ? '' : c]); }
    };
    try {
      cleanup(ss);
      log.info('Tabelle', ss.getName(), 'Gebietsschema ' + ss.getSpreadsheetLocale() + ', Zeitzone ' + ss.getSpreadsheetTimeZone() +
        ', Tool-Version ' + (typeof TOOL_VERSION !== 'undefined' ? TOOL_VERSION : '?'));
      probes(ss, log);
      compareAll(ss, log);
    } catch (e) {
      log.bad('Abbruch', e.message, String(e.stack || '').slice(0, 1500));
    } finally {
      try { cleanup(ss); } catch (e) { log.bad('Aufräumen', e.message); }
      writeReport(ss, out, st.problems, started);
    }
  }

  function cleanup(ss) {
    Object.keys(FT).forEach(function (k) {
      const sh = ss.getSheetByName(FT[k]);
      if (sh) ss.deleteSheet(sh);
    });
  }

  function writeReport(ss, out, problems, started) {
    let sh = ss.getSheetByName(REPORT);
    if (!sh) sh = ss.insertSheet(REPORT);
    sh.clear();
    const head = [['Formeltest 1.2.0 (#43)', problems ? '✗ ' + problems + ' Punkte weichen ab' : '✓ Alles stimmt',
      'Dauer ' + Math.round((Date.now() - started) / 1000) + ' s, ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm')]];
    const rows = head.concat([['Prüfung', 'Ergebnis', 'Einzelheiten']]).concat(out).map(function (r) {
      return r.map(function (x) { const s = String(x == null ? '' : x); return s.length > 45000 ? s.slice(0, 45000) + ' …' : s; });
    });
    sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setFontSize(12);
    sh.getRange(2, 1, 1, 3).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setColumnWidth(1, 300);
    sh.setColumnWidth(2, 280);
    sh.setColumnWidth(3, 700);
    sh.getRange(1, 1, rows.length, 3).setWrap(true).setVerticalAlignment('top');
    ss.setActiveSheet(sh);
  }

  /** Formel setzen wie setFormulaLocal_: erst mit Kommas, bei #ERROR! mit Semikolons. -> {how, ms} */
  function setF(range, formula) {
    const t0 = Date.now();
    range.setFormula(formula);
    SpreadsheetApp.flush();
    let how = 'Kommas';
    if (range.getDisplayValue() === '#ERROR!') {
      range.setFormula(toSemicolons_(formula));
      SpreadsheetApp.flush();
      how = range.getDisplayValue() === '#ERROR!' ? 'Fehler (#ERROR!)' : 'Semikolons';
    }
    return { how: how, ms: Date.now() - t0 };
  }

  function secs(ms) { return (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',') + ' s'; }

  // ---------- Proben: kleine Formeln, die je eine Annahme der großen Formeln prüfen ----------

  // [Name, Formel, erwartete Anzeige, Hinweis]. Ohne Erwartung nur zur Info: Die Formeln kommen mit jedem Ergebnis klar.
  const PROBES = [
    ['QUERY ohne Kopfzeile, wenn alle Beschriftungen leer sind', '=ROWS(QUERY(HSTACK(SEQUENCE(3), SEQUENCE(3)), "select Col1, sum(Col2) group by Col1 label Col1 \'\', sum(Col2) \'\'", 0))', '', 'Nur zur Info: 3 = ohne Kopfzeile, 4 = mit leerer Kopfzeile; die Formeln filtern sie weg.'],
    ['QUERY fügt Zeilen zusammen, leere Zellen', '=QUERY(VSTACK("a", "", "b"), , 9^9)', '', 'Nur zur Info: „a b“ oder „a  b“; die Formeln glätten die Lücken.'],
    ['QUERY min() mit Text', '=TEXTJOIN(",", TRUE, QUERY(HSTACK(VSTACK("x", "x"), VSTACK("b2", "a1")), "select Col1, min(Col2) group by Col1 label Col1 \'\', min(Col2) \'\'", 0))', 'x,a1', ''],
    ['QUERY pivot mit Text (max)', '=TEXTJOIN("|", FALSE, LET(pvt, QUERY(HSTACK(VSTACK(1, 1, 2), VSTACK("p", "q", "r"), VSTACK("A", "B", "A")), "select Col1, max(Col2) group by Col1 pivot Col3", 0), FILTER(pvt, ISNUMBER(CHOOSECOLS(pvt, 1)))))', '1|p|q|2|r|', ''],
    ['QUERY group by: Groß und klein', '=TEXTJOIN(",", TRUE, QUERY(VSTACK("b", "B", "a", "A"), "select Col1, count(Col1) group by Col1 label Col1 \'\', count(Col1) \'\'", 0))', '', 'Nur zur Info: Reihenfolge und ob „a“ und „A“ getrennt zählen.'],
    ['SVERWEIS mit Spaltenliste aus SEQUENCE', '=SUM(ARRAYFORMULA(VLOOKUP(VSTACK(2, 1), HSTACK(SEQUENCE(3), SEQUENCE(3)*10, SEQUENCE(3)*100), SEQUENCE(1, 2, 2), TRUE)))', '330', ''],
    ['MMULT verteilt eine Spalte', '=SUM(MMULT(SEQUENCE(3), SEQUENCE(1, 2, 1, 0)))', '12', ''],
    ['SPLIT liefert Zahlen', '=N(ISNUMBER(INDEX(SPLIT("25 644", " "), 1, 2)))', '', 'Nur zur Info: 1 = Zahl, 0 = Text; die Formeln wandeln beides um.'],
    ['TOCOL behält Lücken', '=ROWS(ARRAYFORMULA(TOCOL(SPLIT(VSTACK("1 2", "3"), " "))))', '4', ''],
    ['TEXT mit Nullen', '=TEXT(7, "000000") & "|" & TEXT(4000000000123, "0000000000000")', '000007|4000000000123', ''],
    ['EXACT über eine Spalte', '=SUM(ARRAYFORMULA(N(EXACT(VSTACK("a", "A"), "a"))))', '1', ''],
    ['VERGLEICH ungefähr über eine Spalte', '=SUM(ARRAYFORMULA(MATCH(VSTACK(1, 2, 3, 4), VSTACK(1, 3), 1)))', '6', ''],
    ['REGEXEXTRACT über eine Spalte', '=TEXTJOIN(",", TRUE, ARRAYFORMULA(IFERROR(REGEXEXTRACT(VSTACK("a|b|c", "x"), "^(.*)\\|[^|]*$"), "-")))', 'a|b,-', ''],
    ['SVERWEIS genau mit * im Suchwort', '=IFERROR(VLOOKUP("a*", VSTACK("abc"), 1, FALSE), "kein Platzhalter")', '', 'Nur zur Info: Die Formeln ersetzen * ? ~ vorher.'],
    ['IMAGE über eine Spalte', '=ROWS(ARRAYFORMULA(IMAGE(VSTACK("https://assets.tcgdex.net/de/swsh/swsh3/136/low.png", "https://assets.tcgdex.net/de/swsh/swsh3/136/low.png"))))', '2', ''],
    ['LET mit Namen aus drei Buchstaben', '=LET(abc, 1, xyz, abc+1, xyz*2)', '4', ''],
    ['Leeres Argument in QUERY', '=SUM(QUERY(SEQUENCE(3), , 0))', '6', '']
  ];

  function probes(ss, log) {
    const sh = ss.insertSheet(FT.probes);
    PROBES.forEach(function (p, i) { sh.getRange(i + 1, 1).setFormula(p[1]); });
    SpreadsheetApp.flush();
    let shown = sh.getRange(1, 1, PROBES.length, 1).getDisplayValues();
    const semi = [];
    PROBES.forEach(function (p, i) {
      if (shown[i][0] === '#ERROR!') { sh.getRange(i + 1, 1).setFormula(toSemicolons_(p[1])); semi.push(i); }
    });
    if (semi.length) { SpreadsheetApp.flush(); shown = sh.getRange(1, 1, PROBES.length, 1).getDisplayValues(); }
    PROBES.forEach(function (p, i) {
      const got = shown[i][0];
      const note = (semi.indexOf(i) >= 0 ? 'mit Semikolons. ' : '') + p[3];
      if (!p[2]) log.info('Probe: ' + p[0], got, note);
      else if (got === p[2]) log.ok('Probe: ' + p[0], got, note);
      else log.bad('Probe: ' + p[0], got + ' statt ' + p[2], note);
    });
    // Reicht das Blatt nicht, breitet Sheets eine Formel dann trotzdem aus (neue Zeilen) oder zeigt es #REF!?
    const room = ss.insertSheet(FT.room);
    if (room.getMaxRows() > 10) room.deleteRows(11, room.getMaxRows() - 10);
    room.getRange('A1').setFormula('=SEQUENCE(20)');
    SpreadsheetApp.flush();
    log.info('Probe: Formel länger als das Blatt', room.getRange('A1').getDisplayValue() + ', Zeilen danach: ' + room.getMaxRows(),
      'Bei #REF! muss das Skript genug Zeilen bereithalten (macht 1.2.0).');
  }

  // ---------- Vergleich mit deinen Daten ----------

  function same(a, b) {
    const isD = function (x) { return Object.prototype.toString.call(x) === '[object Date]'; };
    if (isD(a) || isD(b)) {
      if (!isD(a) || !isD(b)) return false;
      return Math.abs(a.getTime() - b.getTime()) < 1000;
    }
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
    return String(a == null ? '' : a) === String(b == null ? '' : b);
  }

  function show(x) {
    if (Object.prototype.toString.call(x) === '[object Date]') return Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    return JSON.stringify(x);
  }

  function compareAll(ss, log) {
    const src = ss.getSheetByName(SHEETS.data);
    if (!src) { log.bad('Daten', 'Blatt Daten fehlt'); return; }
    const rows = readData_(src);
    const dHeaders = dataHeaders_();
    const extras = getViewExtras_();
    const spec = extras.map(function (x) { return { name: x, col: dHeaders.indexOf(x, NCOL) + 1 }; });
    log.info('Daten', rows.length + ' Zeilen, ' + groupRows_(rows).length + ' Karten (Gruppen)', 'Zusatzspalten in der Sammlung: ' + (extras.join(', ') || 'keine'));

    // Kopie von Daten: Die Formeln lesen sie, so lässt sich auch eine Änderung messen, ohne deine Daten anzufassen
    const fd = src.copyTo(ss).setName(FT.data);
    const names = { data: FT.data, groups: FT.groups, dexIds: FT.dexIds, dexData: FT.dexData };
    const need = fd.getMaxRows() + 10;

    // Pokédex-Nummern: Spalten D:E so, wie 1.2.0 sie schreibt (syncDexMap_)
    const cache = loadDexIds_();
    const map = dexMapOf_(rows, cache);
    const dx = ss.insertSheet(FT.dexIds);
    const mapRows = Object.keys(map).sort().map(function (k) { return [k, map[k]]; });
    if (dx.getMaxRows() < mapRows.length + 2) dx.insertRowsAfter(dx.getMaxRows(), mapRows.length + 2 - dx.getMaxRows());
    dx.getRange(1, 4, 1, 2).setValues([[DEX_IDS_HEADERS[3], DEX_IDS_HEADERS[4]]]);
    if (mapRows.length) dx.getRange(2, 4, mapRows.length, 2).setNumberFormat('@').setValues(mapRows);

    const times = [];
    const g = compareGroups(ss, log, rows, dHeaders, extras, spec, names, map, need, times);
    const dexIdx = pokedexIndex_(rows);
    compareDexData(ss, log, dexIdx, names, times);
    compareDexSheet(ss, log, dexIdx, names, times);
    compareView(ss, log, rows, extras, names, need, times);
    compareDash(ss, log, rows, dexIdx, names, times);
    log.info('Zeit: Formeln das erste Mal gerechnet', times.map(function (t) { return t[0] + ' ' + secs(t[1]) + ' (' + t[2] + ')'; }).join(', '), '');
    if (g) measureChanges(ss, log, fd);
  }

  function compareGroups(ss, log, rows, dHeaders, extras, spec, names, map, need, times) {
    const sh = ss.insertSheet(FT.groups);
    const headers = GROUP_HEADERS.concat(extras);
    const width = headers.length;
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
    sh.getRange(1, 1, 1, width).setValues([headers]);
    const fmt = groupFormatRow_(width);
    sh.getRange(2, 1, sh.getMaxRows() - 1, width).setNumberFormats(Array.from({ length: sh.getMaxRows() - 1 }, function () { return fmt; }));
    const f = groupsFormula_(spec, names);
    const res = setF(sh.getRange('A2'), f);
    times.push(['Gruppen', res.ms, res.how]);
    const first = sh.getRange('A2').getDisplayValue();
    if (/^#/.test(first)) { log.bad('Gruppen: Formel', first + ' (' + res.how + ')', 'Länge ' + f.length + ' Zeichen'); return false; }
    const last = sh.getLastRow();
    const got = last >= 2 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
    // Erwartung: so hat 1.1.3 das Blatt Gruppen gefüllt
    const refs = loadCardHistRefs_();
    const want = {};
    groupRows_(rows).forEach(function (gr) {
      want[gr.gkey] = groupSheetRow_(gr.gkey, gr.idx.map(function (i) { return rows[i]; }), dHeaders, extras, refs);
    });
    const oldHeaders = GROUP_HEADERS.filter(function (h) { return h !== 'Pokédex-Nr.'; }).concat(extras);
    const byKey = {};
    got.forEach(function (r) { byKey[String(r[0])] = r; });
    const keys = Object.keys(want);
    const missing = keys.filter(function (k) { return !byKey[k]; });
    const extra = got.filter(function (r) { return !want[String(r[0])]; }).map(function (r) { return String(r[0]); });
    if (missing.length || extra.length) {
      log.bad('Gruppen: Karten', got.length + ' statt ' + keys.length, 'fehlen: ' + missing.slice(0, 5).join(', ') + ' · zu viel: ' + extra.slice(0, 5).join(', '));
    } else log.ok('Gruppen: Karten', keys.length + ' Karten, wie bisher', '');
    const diff = {};
    keys.forEach(function (k) {
      const r = byKey[k];
      if (!r) return;
      oldHeaders.forEach(function (h, j) {
        const gi = headers.indexOf(h);
        let a = want[k][j], b = r[gi];
        if (j >= GROUP_HEADERS.length - 1) { // Zusatzspalte: 1.2.0 nennt mehrere Werte alphabetisch
          a = String(a).split(' / ').sort().join(' / ');
        }
        if (!same(a, b)) (diff[h] = diff[h] || []).push(k + ': erwartet ' + show(a) + ', Formel ' + show(b));
      });
      const dexWant = map[dexKey_(k)] || '';
      if (!same(dexWant, r[headers.indexOf('Pokédex-Nr.')])) (diff['Pokédex-Nr.'] = diff['Pokédex-Nr.'] || []).push(k + ': erwartet ' + show(dexWant) + ', Formel ' + show(r[headers.indexOf('Pokédex-Nr.')]));
    });
    const cols = Object.keys(diff);
    if (!cols.length) log.ok('Gruppen: alle Spalten', 'gleich wie bisher', width + ' Spalten');
    cols.forEach(function (h) { log.bad('Gruppen: Spalte ' + h, diff[h].length + ' Abweichungen', diff[h].slice(0, 4).join('\n')); });
    return true;
  }

  function compareDexData(ss, log, idx, names, times) {
    const sh = ss.insertSheet(FT.dexData);
    const fixed = dexStaticRows_();
    if (sh.getMaxRows() < fixed.length + 1) sh.insertRowsAfter(sh.getMaxRows(), fixed.length + 1 - sh.getMaxRows());
    sh.getRange(1, 1, 1, DEX_LIST_HEADERS.length).setValues([DEX_LIST_HEADERS]);
    sh.getRange(2, 1, fixed.length, 4).setValues(fixed.map(function (r) { return r.slice(0, 4); }));
    sh.getRange(2, 8, fixed.length, 1).setNumberFormat('@').setValues(fixed.map(function (r) { return [r[4]]; }));
    const res = setF(sh.getRange('E2'), dexStatsFormula_(names));
    times.push(['Pokédex-Daten', res.ms, res.how]);
    const got = sh.getRange(2, 1, fixed.length, 7).getValues();
    const bad = [];
    idx.entries.forEach(function (e) {
      const r = got[e.nr - 1];
      if (!r) { if (e.cards) bad.push('#' + e.nr + ' fehlt in der Liste'); return; }
      if (!same(e.cards, r[4]) || !same(e.copies, r[5]) || Math.abs((Number(r[6]) || 0) - e.value) > 0.005) {
        bad.push('#' + e.nr + ': erwartet ' + [e.cards, e.copies, e.value].join('/') + ', Formel ' + [r[4], r[5], r[6]].join('/'));
      }
    });
    const owned = idx.entries.filter(function (e) { return e.copies > 0; }).length;
    if (bad.length) log.bad('Pokédex-Daten: Karten, Exemplare, Wert', bad.length + ' Abweichungen', bad.slice(0, 5).join('\n'));
    else log.ok('Pokédex-Daten: Karten, Exemplare, Wert', 'gleich wie bisher', owned + ' Pokémon vorhanden');
  }

  function compareDexSheet(ss, log, idx, names, times) {
    const sh = ss.insertSheet(FT.dex);
    if (sh.getMaxRows() < 1040) sh.insertRowsAfter(sh.getMaxRows(), 1040 - sh.getMaxRows());
    // das Pokémon mit den meisten Karten
    const byNr = {};
    idx.owned.forEach(function (o) { (byNr[o.nr] = byNr[o.nr] || []).push(o); });
    let best = 0;
    Object.keys(byNr).forEach(function (nr) { if (!best || byNr[nr].length > byNr[best].length) best = Number(nr); });
    const e = idx.entries[best - 1];
    sh.getRange('B4:D4').setValues([['Alle', 'Alle', '']]);
    sh.getRange('I4').setNumberFormat('@').setValue(best ? '#' + best + ' ' + e.name : '');
    const r1 = setF(sh.getRange('A6'), dexListFormula_(names));
    const r2 = setF(sh.getRange('H6'), dexCardFormula_(names));
    times.push(['Pokédex-Liste', r1.ms, r1.how], ['Pokédex-Karten', r2.ms, r2.how]);
    const count = function (col) {
      const v = sh.getRange(6, col, sh.getMaxRows() - 5, 1).getValues();
      let n = 0;
      v.forEach(function (x) { if (x[0] !== '') n++; });
      return n;
    };
    const all = count(1);
    if (all === idx.entries.length) log.ok('Pokédex: Liste „Alle“', all + ' Pokémon', '');
    else log.bad('Pokédex: Liste „Alle“', all + ' statt ' + idx.entries.length + ' Zeilen', sh.getRange('A6').getDisplayValue());
    const t0 = Date.now();
    sh.getRange('B4').setValue('Vorhanden');
    SpreadsheetApp.flush();
    const have = count(1);
    const owned = idx.entries.filter(function (x) { return x.copies > 0; }).length;
    if (have === owned) log.ok('Pokédex: Liste „Vorhanden“', have + ' Pokémon', 'Umschalten ' + secs(Date.now() - t0));
    else log.bad('Pokédex: Liste „Vorhanden“', have + ' statt ' + owned, sh.getRange('A6').getDisplayValue());
    if (best) {
      const cards = sh.getRange(6, 9, sh.getMaxRows() - 5, 6).getValues().filter(function (r) { return r[0] !== ''; });
      const want = byNr[best].map(function (o) { return o.count; }).sort().join(',');
      const got = cards.map(function (r) { return r[5]; }).sort().join(',');
      if (cards.length === byNr[best].length && want === got) log.ok('Pokédex: Karten von #' + best + ' ' + e.name, cards.length + ' Karten', '');
      else log.bad('Pokédex: Karten von #' + best + ' ' + e.name, cards.length + ' statt ' + byNr[best].length + ' Karten', 'Anzahl erwartet ' + want + ', Formel ' + got + ' · ' + sh.getRange('H6').getDisplayValue());
    }
  }

  function compareView(ss, log, rows, extras, names, need, times) {
    const sh = ss.insertSheet(FT.view);
    if (sh.getMaxRows() < need + 5) sh.insertRowsAfter(sh.getMaxRows(), need + 5 - sh.getMaxRows());
    if (sh.getMaxColumns() < 30) sh.insertColumnsAfter(sh.getMaxColumns(), 30 - sh.getMaxColumns());
    sh.getRange('B4:H4').setValues([['', 'Alle', '', 'Set und Nummer', '', false, true]]);
    const res = setF(sh.getRange('A6'), viewFormula_(extras.length, names));
    times.push(['Sammlung mit Bildern', res.ms, res.how]);
    let want = 0;
    groupRows_(rows).forEach(function (gr) {
      if (gr.idx.reduce(function (s, i) { return s + (Number(rows[i][COL.count]) || 0); }, 0) > 0) want++;
    });
    const v = sh.getRange(6, 2, sh.getMaxRows() - 5, 1).getValues().filter(function (r) { return r[0] !== ''; });
    if (v.length === want) log.ok('Sammlung: Zeilen', want + ' Karten mit Exemplaren', '');
    else log.bad('Sammlung: Zeilen', v.length + ' statt ' + want, sh.getRange('A6').getDisplayValue());
  }

  function compareDash(ss, log, rows, dex, names, times) {
    const sh = ss.insertSheet(FT.dash);
    if (sh.getMaxColumns() < 26) sh.insertColumnsAfter(sh.getMaxColumns(), 26 - sh.getMaxColumns());
    const fs = dashFormulas_(names);
    let ms = 0, how = '';
    Object.keys(fs).forEach(function (a1) {
      const r = setF(sh.getRange(a1), fs[a1]);
      ms += r.ms;
      if (r.how !== 'Kommas') how += a1 + ' ' + r.how + ' ';
    });
    times.push(['Dashboard', ms, how || 'Kommas']);
    // Erwartung wie refreshDashboard_ in 1.1.3
    const value = collectionValue_(rows);
    let distinct = 0;
    groupRows_(rows).forEach(function (gr) {
      if (gr.idx.reduce(function (s, i) { return s + (Number(rows[i][COL.count]) || 0); }, 0) > 0) distinct++;
    });
    const dexTotal = dex.entries.length;
    const dexOwned = dex.entries.filter(function (e) { return e.copies > 0; }).length;
    const hist = dashHistory_();
    const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const target = dashDayShift_(today, -DASH_CHANGE);
    let ref = null;
    hist.forEach(function (h) { if (h.day <= target) ref = h; });
    let change;
    if (ref) {
      const d = Math.round((value.total - ref.total) * 100) / 100;
      change = (d > 0 ? '+' : d < 0 ? '−' : '±') + dashEur_(Math.abs(d)) + ' seit ' + dashShortDate_(ref.day, today);
    } else {
      change = hist.length ? 'Vergleich ab ' + dashShortDate_(dashDayShift_(hist[0].day, DASH_CHANGE), today) : 'Noch kein Verlauf';
    }
    const pct = dexTotal ? (Math.round(dexOwned / dexTotal * 1000) / 10).toFixed(1).replace('.', ',') : '0,0';
    const last = hist.length ? hist[hist.length - 1] : null;
    const since = dashDayShift_(today, -(DASH_DAYS - 1));
    const vals = hist.filter(function (h) { return h.day >= since; }).map(function (h) { return h.total; }).slice(-DASH_DAYS);
    const hl = colLetter_(DASH_HELPER_COL);
    const want = {
      C3: last ? 'Preise vom ' + dmyText_(last.day) : 'Noch kein Preislauf',
      K5: 'POKÉDEX · ' + pct + ' %',
      C6: value.total,
      G6: value.cards,
      K6: dexTotal ? dexOwned + ' von ' + dexTotal : '–',
      C7: change,
      G7: value.cards > 1 ? (distinct === value.cards ? 'alle verschieden' : 'davon ' + distinct + ' verschiedene') : ''
    };
    want[hl + (DASH_DAYS + 3)] = dexOwned;
    want[hl + (DASH_DAYS + 4)] = Math.max(0, dexTotal - dexOwned);
    want[colLetter_(DASH_HELPER_COL + 2) + '10'] = Math.max(1, dexTotal);
    const bad = [];
    Object.keys(want).forEach(function (a1) {
      let got = sh.getRange(a1).getValue();
      if (a1 === 'C6' && typeof got === 'number') got = Math.round(got * 100) / 100;
      if (!same(want[a1], got)) bad.push(a1 + ': erwartet ' + show(want[a1]) + ', Formel ' + show(got));
    });
    const hv = sh.getRange(hl + '2:' + hl + (DASH_DAYS + 1)).getValues().map(function (r) { return r[0]; }).filter(function (x) { return x !== ''; });
    if (hv.length !== vals.length || hv.some(function (x, i) { return Math.abs(x - vals[i]) > 0.005; })) {
      bad.push('Wertverlauf: erwartet ' + vals.length + ' Werte, Formel ' + hv.length);
    }
    if (bad.length) log.bad('Dashboard', bad.length + ' Abweichungen', bad.join('\n'));
    else log.ok('Dashboard', 'gleich wie bisher', 'Gesamtwert ' + dashEur_(value.total) + ', ' + value.cards + ' Karten, Pokédex ' + dexOwned + ' von ' + dexTotal + ', ' + change);
  }

  /** Wie schnell rechnet Sheets alles nach, wenn sich Daten ändert? Ändert nur die Kopie „FT Daten“. */
  function measureChanges(ss, log, fd) {
    const groups = ss.getSheetByName(FT.groups), view = ss.getSheetByName(FT.view), dash = ss.getSheetByName(FT.dash);
    const readAll = function () {
      groups.getRange('A2:B3').getValues();
      dash.getRange('C6:G7').getValues();
      view.getRange('A6:H8').getValues();
    };
    const last = fd.getLastRow();
    if (last < 2) return;
    const cell = fd.getRange(2, COL.count + 1);
    const before = cell.getValue();
    const t1 = Date.now();
    cell.setValue((Number(before) || 0) + 1);
    SpreadsheetApp.flush();
    readAll();
    const ms1 = Date.now() - t1;
    cell.setValue(before);
    SpreadsheetApp.flush();
    readAll();
    // neue Karte am Ende (neuer Schlüssel und neue Eintrag-ID)
    const row = fd.getRange(2, 1, 1, fd.getLastColumn()).getValues()[0];
    row[COL.key] = String(row[COL.key]).replace(/^([^|]*)/, '$1-formeltest');
    row[COL.eid] = 'formeltest';
    const t2 = Date.now();
    fd.getRange(last + 1, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    readAll();
    const ms2 = Date.now() - t2;
    const t3 = Date.now();
    fd.deleteRow(last + 1);
    SpreadsheetApp.flush();
    readAll();
    const ms3 = Date.now() - t3;
    log.info('Zeit: Nachrechnen nach einer Änderung', 'Anzahl +1: ' + secs(ms1) + ' · neue Karte: ' + secs(ms2) + ' · Zeile gelöscht: ' + secs(ms3),
      'Gruppen, Sammlung (mit Bildern), Pokédex und Dashboard zusammen, gemessen bis die Werte da sind');
  }

  return { run: run };
