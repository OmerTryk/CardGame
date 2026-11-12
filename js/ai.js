/*
 * Pişti yapay zekâsı. Sadece oyuncunun gerçekten bilebileceği bilgileri kullanır:
 * kendi eli, yerdeki açık kartlar, oynanmış (görülmüş) kartlar, el ve deste sayıları.
 *
 *   Kolay : sık hata yapar, eşleşme görürse alır, gerisi rastgele.
 *   Orta  : kart sayar; her kartın rakibe pişti/alım riskini olasılıkla hesaplar.
 *   Zor   : görünmeyen kartları binlerce kez rastgele dağıtıp eli sonuna kadar
 *           oynatır (Monte Carlo), en çok puan getiren hamleyi seçer.
 */
(function (global) {
  'use strict';
  var E = global.PistiEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var rank = E.rank, JACK = E.JACK, POINTS = E.POINTS;

  /** U kart içinde m "tehlikeli" kart varken h kart çeken birinin hiç tehlikeli kart çekmeme olasılığı. */
  function probNone(U, m, h) {
    if (h <= 0 || m <= 0) return 1;
    if (U - m < h) return 0;
    var p = 1;
    for (var i = 0; i < h; i++) p *= (U - m - i) / (U - i);
    return p;
  }

  function pileValue(s) {
    var v = 0;
    for (var i = s.pileHidden; i < s.pile.length; i++) v += POINTS[s.pile[i]];
    return v + s.pileHidden * P.hiddenVal;
  }

  // Kendi kendine oynatılarak ayarlanmış sezgisel ağırlıklar
  var P = {
    cw2: 0.11, cw4: 0.2,        // bir kartın "en çok kart" primine katkısı (2 taraf / daha fazla)
    jackEarly: 1.6,             // Vale'yi harcamanın bedeli (deste bitmeden)
    jackLate: 2.2,              // son dağıtımda Vale'yi saklamanın değeri
    jackDrop: 1,                // Vale'yi boşa yere atma cezası
    jackFactorHi: 0.9,          // rakip değerli yeri Vale ile alır mı
    jackFactorLo: 0.45,
    allySign: -0.4,             // sıradaki oyuncu eşimse alması bize iyidir
    ptsDrop: 0.15,              // puanlı kartı yere atma cezası
    tempo: 0,                   // aldıktan sonra rakip boş yere oynar -> pişti şansımız
    hiddenVal: 0.25             // kapalı kartın tahmini puanı
  };

  /** Her kart için sezgisel bir değer döner (yüksek = iyi). */
  function heuristicScores(s, p, out) {
    var hand = s.hands[p];
    var n = s.n;
    var unseen = [];
    for (var r = 0; r < 13; r++) unseen.push(4 - s.seenRank[r]);
    for (var i = 0; i < hand.length; i++) unseen[rank(hand[i])]--;
    var U = 52 - s.seenCount - hand.length;

    var CW = s.numSides === 2 ? P.cw2 : P.cw4;
    var lastDeal = s.deck.length === 0;
    var jackKeep = lastDeal ? (hand.length > 1 ? P.jackLate : 0) : P.jackEarly;
    var pile = s.pile, pl = pile.length;
    var top = pl ? rank(pile[pl - 1]) : -1;
    var pv = pileValue(s);

    var q = (p + 1) % n;
    var ally = E.sideOf(s, q) === E.sideOf(s, p) && q !== p;
    var sign = ally ? P.allySign : 1;
    // Benim hamlemden sonra herkesin eli boşalırsa yeni dağıtım olur
    var othersEmpty = true;
    for (var k = 0; k < n; k++) if (k !== p && s.hands[k].length) { othersEmpty = false; break; }
    var endsHand = othersEmpty && hand.length === 1 && s.deck.length < n * 4;
    var h = s.hands[q].length;
    var endsHandCap = endsHand;
    if (othersEmpty && hand.length === 1) h = 4;

    out = out || [];
    out.length = 0;
    for (var j = 0; j < hand.length; j++) {
      var c = hand[j], cr = rank(c), score;
      if (pl && (cr === top || cr === JACK)) {
        score = pv + POINTS[c] + CW * (pl + 1);
        if (pl === 1 && cr === top) score += cr === JACK ? 20 : 10;
        if (cr === JACK && top !== JACK) score -= jackKeep;
        if (!endsHandCap) score += P.tempo;
      } else {
        var nv = pv + POINTS[c] + CW * (pl + 1);
        if (endsHand) {
          var lc = s.lastCapturer;
          score = lc < 0 ? 0 : (E.sideOf(s, lc) === E.sideOf(s, p) ? nv : -nv);
        } else {
          var mR = unseen[cr];
          var mJ = cr === JACK ? 0 : unseen[JACK];
          var pAny = 1 - probNone(U, mR + mJ, h);
          var pRank = 1 - probNone(U, mR, h);
          var bonus = pl === 0 ? (cr === JACK ? 20 : 10) : 0;
          var jf = nv >= 1.5 ? P.jackFactorHi : P.jackFactorLo;
          var loss = pRank * (nv + bonus) + (pAny - pRank) * nv * jf;
          score = -sign * loss;
        }
        if (cr === JACK) score -= jackKeep + P.jackDrop;
        score -= POINTS[c] * P.ptsDrop;
      }
      out.push(score);
    }
    return out;
  }

  var scratch = [];
  function heuristicMove(s, p) {
    var sc = heuristicScores(s, p, scratch);
    var hand = s.hands[p], best = 0;
    for (var i = 1; i < sc.length; i++) if (sc[i] > sc[best]) best = i;
    return hand[best];
  }

  function easyMove(s, p, rng) {
    var hand = s.hands[p];
    if (rng() < 0.3) return hand[(rng() * hand.length) | 0];
    var top = s.pile.length ? rank(s.pile[s.pile.length - 1]) : -1;
    var i;
    for (i = 0; i < hand.length; i++) if (rank(hand[i]) === top) return hand[i];
    if (s.pile.length >= 3) for (i = 0; i < hand.length; i++) if (rank(hand[i]) === JACK) return hand[i];
    var nonJ = hand.filter(function (c) { return rank(c) !== JACK; });
    var pool = nonJ.length ? nonJ : hand;
    return pool[(rng() * pool.length) | 0];
  }

  function mediumMove(s, p, rng) {
    var hand = s.hands[p];
    var sc = heuristicScores(s, p, []);
    var best = -Infinity, choices = [];
    for (var i = 0; i < sc.length; i++) {
      var v = sc[i] + (rng() - 0.5) * 0.3; // hafif rastgelelik: hep aynı oynamasın
      if (v > best) { best = v; choices = [hand[i]]; }
    }
    return choices[0];
  }

  /** Görünmeyen kartları rastgele dağıtarak tutarlı bir "olası dünya" üretir. */
  function sampleWorld(s, p, rng) {
    var w = E.clone(s, true);
    var mine = {};
    var hand = s.hands[p];
    for (var i = 0; i < hand.length; i++) mine[hand[i]] = 1;
    var pool = [];
    for (var c = 0; c < 52; c++) if (!s.seen[c] && !mine[c]) pool.push(c);
    E.shuffle(pool, rng);
    var k = 0;
    for (var q = 0; q < s.n; q++) {
      if (q === p) continue;
      var len = s.hands[q].length;
      w.hands[q] = pool.slice(k, k + len);
      k += len;
    }
    for (var hI = 0; hI < s.pileHidden; hI++) w.pile[hI] = pool[k++];
    w.deck = pool.slice(k);
    return w;
  }

  function evalFor(w, side) {
    var t = E.sideTotals(w);
    var mine = t[side], others = 0;
    for (var i = 0; i < t.length; i++) if (i !== side) others += t[i];
    return mine - others / (t.length - 1);
  }

  function rollout(w) {
    while (!w.handOver) {
      var q = w.turn;
      E.play(w, q, heuristicMove(w, q));
    }
  }

  function hardMove(s, p, rng, opts) {
    var hand = s.hands[p];
    // Eşdeğer kartları ele (aynı sayı ve aynı puan)
    var cands = [], keys = {};
    for (var i = 0; i < hand.length; i++) {
      var key = rank(hand[i]) * 10 + POINTS[hand[i]];
      if (!keys[key]) { keys[key] = 1; cands.push(hand[i]); }
    }
    if (cands.length === 1) return cands[0];

    var budget = (opts && opts.timeMs) || 350;
    var maxWorlds = (opts && opts.maxWorlds) || 2500;
    var minWorlds = (opts && opts.minWorlds) || 200;
    var side = E.sideOf(s, p);
    var sums = cands.map(function () { return 0; });
    var start = Date.now(), worlds = 0;
    var now = typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now;
    start = now();
    while (worlds < maxWorlds && (worlds < minWorlds || now() - start < budget)) {
      var w = sampleWorld(s, p, rng);
      for (var j = 0; j < cands.length; j++) {
        var x = E.clone(w, true);
        E.play(x, p, cands[j]);
        rollout(x);
        sums[j] += evalFor(x, side);
      }
      worlds++;
    }
    var best = 0;
    for (var b = 1; b < cands.length; b++) if (sums[b] > sums[best]) best = b;
    return cands[best];
  }

  /** level: 'easy' | 'medium' | 'hard'. Oynanacak kartı döner. */
  function chooseMove(s, p, level, opts) {
    var rng = (opts && opts.rng) || Math.random;
    var hand = s.hands[p];
    if (hand.length === 1) return hand[0];
    if (level === 'easy') return easyMove(s, p, rng);
    if (level === 'medium') return mediumMove(s, p, rng);
    return hardMove(s, p, rng, opts);
  }

  var AI = { params: P, chooseMove: chooseMove, heuristicScores: heuristicScores, sampleWorld: sampleWorld, probNone: probNone,
    LEVELS: { easy: 'Kolay', medium: 'Orta', hard: 'Zor' } };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  global.PistiAI = AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
