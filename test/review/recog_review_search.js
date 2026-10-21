'use strict';
// RECOG: Suche in der Prüfliste mit den Werten der Quellzeile ("DP 16", ohne Set).
const W = require('./recog_world');
const env = W.newEnv();
const r = W.run(env, [['Lucario Promo', 'DP 16', '', '', '4,00 €', '01.10.2026', ''], ['Arkani Promo', 'HGSS 01', '', 'HeartGold & SoulSilver', '', '', '']]);
W.brief(r.items).forEach((b) => console.log(JSON.stringify(b)));
const it = r.items.find((i) => i.values.name === 'Lucario Promo');
if (it.status !== 'eindeutig') {
  const s = env.uiCall('importReviewSearch', it.fp, {});
  console.log('Suche ohne Eingabe:', s.stage, (s.cards || []).map((c) => c.id), s.notes);
  const s2 = env.uiCall('importReviewSearch', it.fp, { name: 'Lucario', number: 'DP 16', set: '' });
  console.log('Suche Lucario / DP 16:', s2.stage, (s2.cards || []).map((c) => c.id), s2.notes);
}
// Set-Auswahl wie in impRvPickSet: getCardBySetNumber mit der Nummer aus der Quellzeile
try { const card = env.uiCall('getCardBySetNumber', 'dpp', 'DP 16'); console.log('getCardBySetNumber(dpp, "DP 16"):', card.id); }
catch (e) { console.log('getCardBySetNumber(dpp, "DP 16") wirft:', e.message); }
try { const card = env.uiCall('getCardBySetNumber', 'dpp', 'DP16'); console.log('getCardBySetNumber(dpp, "DP16"):', card.id); }
catch (e) { console.log('getCardBySetNumber(dpp, "DP16") wirft:', e.message); }
