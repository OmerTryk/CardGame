// Motor ve yapay zekâ testi: node tests/simulate.js
'use strict';
const assert = require('assert');
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

function seeded(seed) {
  return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function playHand(n, teams, levels, rng, dealer) {
  const s = E.newHand({ n, teams, dealer, rng });
  while (!s.handOver) {
    const p = s.turn;
    // Bilgi sızıntısı kontrolü: örneklenen dünya tutarlı olmalı
    const w = AI.sampleWorld(s, p, rng);
    assert.strictEqual(w.deck.length, s.deck.length);
    for (let q = 0; q < n; q++) assert.strictEqual(w.hands[q].length, s.hands[q].length);
    const c = AI.chooseMove(s, p, levels[p], { rng, timeMs: 15, maxWorlds: 60, minWorlds: 10 });
    assert.ok(s.hands[p].includes(c));
    E.play(s, p, c);
  }
  // Değişmezler: 52 kartın hepsi birine gitmiş olmalı
  const all = [].concat(...s.captured).sort((a, b) => a - b);
  assert.strictEqual(all.length, 52);
  all.forEach((c, i) => assert.strictEqual(c, i));
  const sc = E.handScore(s);
  const cardPts = sc.reduce((a, o) => a + o.cardPts, 0);
  assert.strictEqual(cardPts, 13);
  const fast = E.sideTotals(s);
  sc.forEach((o, i) => assert.strictEqual(o.total, fast[i]));
  return sc;
}

function tournament(n, teams, levels, hands, label) {
  const rng = seeded(12345);
  const sides = teams ? 2 : n;
  const tot = new Array(sides).fill(0);
  let pistis = 0;
  const t0 = Date.now();
  for (let h = 0; h < hands; h++) {
    const sc = playHand(n, teams, levels, rng, h % n);
    sc.forEach((o, i) => { tot[i] += o.total; pistis += o.pistiCount; });
  }
  console.log(`${label.padEnd(34)} el başına ort. puan: ${tot.map(t => (t / hands).toFixed(2)).join(' | ')}  (pişti/el ${(pistis / hands).toFixed(2)}, ${Date.now() - t0}ms)`);
  return tot;
}

// Kural testleri
(function rules() {
  // Pişti: yerde tek kart varken aynı sayı
  const s = E.newHand({ n: 2, teams: false, dealer: 1 });
  s.pile = [5]; s.pileHidden = 0; s.hands[0] = [18, 1]; s.hands[1] = [2]; s.turn = 0; // 6♠ yerde, 6♥ oyna
  let ev = E.play(s, 0, 18);
  assert.strictEqual(ev.pisti, 10);
  // Vale ile tek kart almak pişti değil
  s.pile = [7]; s.turn = 1;
  ev = E.play(s, 1, 2); // 3♠ atıldı, almaz
  assert.strictEqual(ev.capture, false);
  const s2 = E.newHand({ n: 2, teams: false, dealer: 1 });
  s2.pile = [3]; s2.pileHidden = 0; s2.hands[0] = [10, 0]; s2.turn = 0;
  ev = E.play(s2, 0, 10);
  assert.ok(ev.capture); assert.strictEqual(ev.pisti, 0);
  // Vale üstüne vale: 20
  const s3 = E.newHand({ n: 2, teams: false, dealer: 1 });
  s3.pile = [23]; s3.pileHidden = 0; s3.hands[0] = [10, 0]; s3.turn = 0;
  ev = E.play(s3, 0, 10);
  assert.strictEqual(ev.pisti, 20);
  console.log('Kural testleri geçti.');
})();

const H = Number(process.argv[2] || 60);
console.log('Turnuva (hız için Zor seviyeye hamle başına en fazla 60 olası dünya verilir; oyunda bu sayı 200-2500 arasıdır):');
tournament(2, false, ['hard', 'easy'], H, '2 kişi: Zor vs Kolay');
tournament(2, false, ['hard', 'medium'], H, '2 kişi: Zor vs Orta');
tournament(2, false, ['medium', 'easy'], H, '2 kişi: Orta vs Kolay');
tournament(4, true, ['hard', 'medium', 'hard', 'medium'], Math.ceil(H / 2), '4 kişi eşli: Zor takım vs Orta');
tournament(4, false, ['hard', 'medium', 'easy', 'medium'], Math.ceil(H / 2), '4 kişi tekli: Zor/Orta/Kolay/Orta');
