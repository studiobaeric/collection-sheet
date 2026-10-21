'use strict';
// Zufällige Abfolgen (feste Seeds): Hand-Zeilen, Importe (alle Modi), -1/+1, Bearbeiten, Rückgängig, Zurücknehmen.
// Invarianten: eindeutige Eintrag-IDs; Commit/Undo senkt nie Hand-Exemplare (Summe je Hand-Schlüssel);
// Commit direkt gefolgt von Undo stellt Daten exakt wieder her (Anzahl je eid + Schlüssel).
const C = require('./common');
const CARDS = [C.GLURAK, C.GLURAK_REV, C.BASE];
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const problems = [];
function snap(env) { return env.data().map(r => [r.eid, r.origin, r.fp, r.count, r.key].join('#')).sort(); }
function handTotals(env) { const o = {}; env.data().filter(r => r.origin === 'Hand').forEach(r => { o[r.key] = (o[r.key] || 0) + r.count; }); return o; }
for (let seed = 1; seed <= 60; seed++) {
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  const env = C.mkEnv();
  const c = env.ctx;
  const log = [];
  let lastToken = null, lastCommit = null;
  for (let step = 0; step < 25; step++) {
    const op = pick(['hand', 'commit', 'commit', 'commit', 'adj', 'adj', 'edit', 'revert', 'undo', 'undo']);
    try {
      const before = snap(env), hb = handTotals(env);
      if (op === 'hand') { C.handRow(env, pick(CARDS), 1 + Math.floor(R() * 2), { cond: pick(['', 'NM']) }); log.push('hand'); lastCommit = null; }
      else if (op === 'commit') {
        const mode = pick(['neu', 'alle', 'abgleich']);
        const n = 1 + Math.floor(R() * 3);
        const items = [];
        const used = {};
        for (let k = 0; k < n; k++) {
          const ci = Math.floor(R() * 3);
          const cond = pick(['', 'NM']);
          const fp = 'fp' + ci + cond;
          if (used[fp]) continue; used[fp] = 1;
          items.push(C.clear(fp, Math.floor(R() * 4), CARDS[ci], { cond }));
        }
        const src = pick(['SRC1', 'SRC1', 'SRC2']);
        C.seed(env, { mode, items, sourceId: src });
        const pv = env.uiCall('importBuildPreview');
        const choices = { hand: {}, removed: {} };
        pv.handMatch.forEach(h => { choices.hand[h.fp] = pick(['same', 'extra']); });
        pv.removedByYou.forEach(h => { if (R() < 0.5) choices.removed[h.fp] = true; });
        const res = env.uiCall('importCommit', choices);
        log.push('commit#' + res.nr + ' ' + mode + ' ' + src + ' ' + items.map(i => i.fp + 'x' + i.qty).join(','));
        lastCommit = { nr: res.nr, before };
        const ha = handTotals(env);
        Object.keys(hb).forEach(k => { if ((ha[k] || 0) < hb[k]) problems.push(`seed ${seed}: commit senkt Hand ${k} ${hb[k]} -> ${ha[k] || 0} | ${log.join(' ; ')}`); });
      } else if (op === 'adj') {
        const rows = env.data(); if (!rows.length) continue;
        const r = pick(rows);
        const res = env.uiCall('adjustEntry', r.eid, pick([-1, 1]));
        lastToken = res.token; log.push('adj ' + r.origin + ' ' + res.applied); lastCommit = null;
      } else if (op === 'revert') {
        if (!lastToken) continue;
        env.uiCall('revertAdjust', lastToken); lastToken = null; log.push('revert'); lastCommit = null;
      } else if (op === 'edit') {
        const rows = env.data().filter(r => r.count > 0); if (!rows.length) continue;
        const r = pick(rows);
        env.uiCall('editEntry', r.eid, { cond: r.cond === 'NM' ? 'LP' : 'NM' }, R() < 0.5 ? 1 : null);
        log.push('edit ' + r.origin); lastCommit = null; lastToken = null;
      } else if (op === 'undo') {
        const act = env.uiCall('importList').filter(i => i.status === 'aktiv');
        if (!act.length) continue;
        const imp = (lastCommit && R() < 0.7) ? act.find(i => i.nr === lastCommit.nr) || pick(act) : pick(act);
        const pv = env.uiCall('importUndoPreview', imp.nr);
        const dec = {};
        pv.changed.forEach(x => { dec[x.eid] = pick(['keep', 'remove']); });
        env.uiCall('importUndo', imp.nr, dec);
        log.push('undo#' + imp.nr);
        if (env.data().some(r => r.origin === 'Import ' + imp.nr)) problems.push(`seed ${seed}: Zeilen von Import ${imp.nr} nach Undo noch da`);
        const ha = handTotals(env);
        Object.keys(hb).forEach(k => { if ((ha[k] || 0) < hb[k]) problems.push(`seed ${seed}: undo senkt Hand ${k} | ${log.join(' ; ')}`); });
        if (lastCommit && lastCommit.nr === imp.nr) {
          const now = snap(env);
          if (JSON.stringify(now) !== JSON.stringify(lastCommit.before)) problems.push(`seed ${seed}: Commit+Undo nicht exakt\n   vorher ${JSON.stringify(lastCommit.before)}\n   nachher ${JSON.stringify(now)}\n   | ${log.join(' ; ')}`);
        }
        lastCommit = null; lastToken = null;
      }
      const eids = env.data().map(r => r.eid);
      if (new Set(eids).size !== eids.length) problems.push(`seed ${seed}: doppelte eid | ${log.join(' ; ')}`);
      if (env.lock.nested) { problems.push(`seed ${seed}: Sperre verschachtelt`); env.lock.nested = 0; }
    } catch (e) {
      if (!/Bitte entscheide|nicht gefunden|keine Karten/.test(e.message)) problems.push(`seed ${seed}: ${op} wirft ${e.message} | ${log.join(' ; ')}`);
    }
  }
}
console.log(problems.length ? problems.slice(0, 12).join('\n') + '\n(' + problems.length + ' Probleme)' : 'keine Probleme');
