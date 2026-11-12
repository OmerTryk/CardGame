/*
 * Pişti oyun motoru — saf kurallar, DOM'a bağımlı değil.
 * Kartlar 0..51 arası tam sayılardır: rank = c % 13, suit = floor(c / 13).
 *   rank: 0=As, 1..9 = 2..10, 10=Vale, 11=Kız, 12=Papaz
 *   suit: 0=Maça ♠, 1=Kupa ♥, 2=Karo ♦, 3=Sinek ♣
 * Durum nesnesi tamamen JSON'a çevrilebilir; yapay zekâ simülasyonları için hızlı kopyalanır.
 */
(function (global) {
  'use strict';

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_NAMES = ['As', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Vale', 'Kız', 'Papaz'];
  var SUITS = ['♠', '♥', '♦', '♣'];
  var SUIT_NAMES = ['Maça', 'Kupa', 'Karo', 'Sinek'];
  var JACK = 10;
  var HAND_SIZE = 4;

  function rank(c) { return c % 13; }
  function suit(c) { return (c / 13) | 0; }

  // Kart puanları: her As 1, her Vale 1, Sinek 2 = 2, Karo 10 = 3
  var POINTS = [];
  for (var i = 0; i < 52; i++) {
    var r = i % 13, s = (i / 13) | 0, p = 0;
    if (r === 0 || r === JACK) p = 1;
    if (s === 3 && r === 1) p = 2;
    if (s === 2 && r === 9) p = 3;
    POINTS.push(p);
  }
  var MAJORITY_BONUS = 3;

  function cardName(c) { return SUIT_NAMES[suit(c)] + ' ' + RANK_NAMES[rank(c)]; }
  function isRed(c) { var s = suit(c); return s === 1 || s === 2; }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function sideOf(s, p) { return s.teams ? p % 2 : p; }

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }

  function markSeen(s, c) {
    if (!s.seen[c]) { s.seen[c] = 1; s.seenRank[rank(c)]++; s.seenCount++; }
  }

  function dealRound(s) {
    for (var k = 0; k < HAND_SIZE; k++) {
      for (var i = 0; i < s.n; i++) {
        var p = (s.dealer + 1 + i) % s.n;
        s.hands[p].push(s.deck.pop());
      }
    }
    s.round++;
  }

  /**
   * Yeni bir el başlatır.
   * opts: { n: 2|4, teams: bool, dealer: number, rng?: fn, deck?: number[] }
   */
  function newHand(opts) {
    var n = opts.n;
    var deck = opts.deck ? opts.deck.slice() : shuffle(range52(), opts.rng);
    var hands = [], captured = [];
    for (var i = 0; i < n; i++) { hands.push([]); captured.push([]); }
    var s = {
      n: n,
      teams: !!(opts.teams && n === 4),
      dealer: opts.dealer || 0,
      turn: ((opts.dealer || 0) + 1) % n,
      hands: hands,
      captured: captured,     // her oyuncunun aldığı kartlar (hafif simülasyonda null)
      capCount: zeros(n),
      capPts: zeros(n),
      pisti: zeros(n),        // pişti puanları
      pistiCount: zeros(n),
      pile: [],
      pileHidden: 0,          // yerdeki destenin altındaki kapalı kart sayısı
      deck: deck,
      lastCapturer: -1,
      seen: zeros(52),        // herkesin gördüğü kartlar
      seenRank: zeros(13),
      seenCount: 0,
      round: 0,
      handOver: false,
      light: false
    };
    s.numSides = s.teams ? 2 : n;
    // Yere 4 kart: 3'ü kapalı, en üstteki açık
    for (var t = 0; t < 4; t++) s.pile.push(s.deck.pop());
    s.pileHidden = 3;
    markSeen(s, s.pile[3]);
    dealRound(s);
    return s;
  }

  function range52() { var a = []; for (var i = 0; i < 52; i++) a.push(i); return a; }

  function topCard(s) { return s.pile.length ? s.pile[s.pile.length - 1] : -1; }

  function canCapture(s, c) {
    if (!s.pile.length) return false;
    var r = rank(c);
    return r === JACK || r === rank(s.pile[s.pile.length - 1]);
  }

  function isPistiMove(s, c) {
    return s.pile.length === 1 && rank(c) === rank(s.pile[0]);
  }

  function takeCards(s, p, cards) {
    for (var i = 0; i < cards.length; i++) {
      s.capPts[p] += POINTS[cards[i]];
      if (!s.light) s.captured[p].push(cards[i]);
    }
    s.capCount[p] += cards.length;
  }

  /**
   * p oyuncusu c kartını oynar. Bir olay nesnesi döner:
   * { player, card, capture, pisti, taken, dealt, handOver, final }
   */
  function play(s, p, c) {
    if (s.handOver) throw new Error('El bitti');
    if (s.turn !== p) throw new Error('Sıra ' + s.turn + ' oyuncusunda');
    var hand = s.hands[p];
    var idx = hand.indexOf(c);
    if (idx < 0) throw new Error('Kart elde yok: ' + c);
    hand.splice(idx, 1);
    markSeen(s, c);

    var ev = { player: p, card: c, capture: false, pisti: 0, taken: null, dealt: false, handOver: false, final: null };

    if (canCapture(s, c)) {
      if (isPistiMove(s, c)) {
        ev.pisti = rank(c) === JACK ? 20 : 10;
        s.pisti[p] += ev.pisti;
        s.pistiCount[p]++;
      }
      for (var h = 0; h < s.pileHidden; h++) markSeen(s, s.pile[h]);
      var taken = s.pile;
      taken.push(c);
      takeCards(s, p, taken);
      ev.capture = true;
      ev.taken = s.light ? null : taken.slice();
      s.pile = [];
      s.pileHidden = 0;
      s.lastCapturer = p;
    } else {
      s.pile.push(c);
    }

    s.turn = (p + 1) % s.n;

    var empty = true;
    for (var q = 0; q < s.n; q++) if (s.hands[q].length) { empty = false; break; }
    if (empty) {
      if (s.deck.length >= s.n * HAND_SIZE) {
        dealRound(s);
        ev.dealt = true;
      } else {
        // El bitti: yerde kalan kartlar son alan oyuncuya gider
        if (s.pile.length && s.lastCapturer >= 0) {
          for (var k = 0; k < s.pileHidden; k++) markSeen(s, s.pile[k]);
          ev.final = { player: s.lastCapturer, cards: s.pile.slice() };
          takeCards(s, s.lastCapturer, s.pile);
          s.pile = [];
          s.pileHidden = 0;
        }
        s.handOver = true;
        ev.handOver = true;
      }
    }
    return ev;
  }

  function clone(s, light) {
    var c = {};
    for (var k in s) c[k] = s[k];
    c.hands = s.hands.map(function (h) { return h.slice(); });
    c.light = light || s.light;
    c.captured = c.light ? null : s.captured.map(function (a) { return a.slice(); });
    c.capCount = s.capCount.slice();
    c.capPts = s.capPts.slice();
    c.pisti = s.pisti.slice();
    c.pistiCount = s.pistiCount.slice();
    c.pile = s.pile.slice();
    c.deck = s.deck.slice();
    c.seen = s.seen.slice();
    c.seenRank = s.seenRank.slice();
    return c;
  }

  /** Hızlı taraf toplamları (simülasyon için). */
  function sideTotals(s) {
    var ns = s.numSides, cards = zeros(ns), pts = zeros(ns), i;
    for (i = 0; i < s.n; i++) {
      var sd = sideOf(s, i);
      cards[sd] += s.capCount[i];
      pts[sd] += s.capPts[i] + s.pisti[i];
    }
    var best = -1, bestSide = -1, tie = false;
    for (i = 0; i < ns; i++) {
      if (cards[i] > best) { best = cards[i]; bestSide = i; tie = false; }
      else if (cards[i] === best) tie = true;
    }
    if (!tie && bestSide >= 0) pts[bestSide] += MAJORITY_BONUS;
    return pts;
  }

  /** Ayrıntılı el sonu puan tablosu (arayüz için). */
  function handScore(s) {
    var ns = s.numSides, out = [], i;
    for (i = 0; i < ns; i++) out.push({ cards: 0, aces: 0, jacks: 0, clubs2: 0, diamonds10: 0, cardPts: 0, pisti: 0, pistiCount: 0, majority: 0, total: 0 });
    for (i = 0; i < s.n; i++) {
      var o = out[sideOf(s, i)];
      var cap = s.captured[i];
      o.cards += cap.length;
      for (var j = 0; j < cap.length; j++) {
        var c = cap[j], r = rank(c), su = suit(c);
        if (r === 0) o.aces++;
        if (r === JACK) o.jacks++;
        if (r === 1 && su === 3) o.clubs2 = 2;
        if (r === 9 && su === 2) o.diamonds10 = 3;
        o.cardPts += POINTS[c];
      }
      o.pisti += s.pisti[i];
      o.pistiCount += s.pistiCount[i];
    }
    var best = -1, bestSide = -1, tie = false;
    for (i = 0; i < ns; i++) {
      if (out[i].cards > best) { best = out[i].cards; bestSide = i; tie = false; }
      else if (out[i].cards === best) tie = true;
    }
    if (!tie) out[bestSide].majority = MAJORITY_BONUS;
    for (i = 0; i < ns; i++) out[i].total = out[i].cardPts + out[i].pisti + out[i].majority;
    return out;
  }

  var Engine = {
    RANKS: RANKS, RANK_NAMES: RANK_NAMES, SUITS: SUITS, SUIT_NAMES: SUIT_NAMES,
    JACK: JACK, HAND_SIZE: HAND_SIZE, POINTS: POINTS, MAJORITY_BONUS: MAJORITY_BONUS,
    rank: rank, suit: suit, cardName: cardName, isRed: isRed, shuffle: shuffle,
    sideOf: sideOf, newHand: newHand, play: play, clone: clone, canCapture: canCapture,
    isPistiMove: isPistiMove, topCard: topCard, sideTotals: sideTotals, handScore: handScore
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  global.PistiEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
