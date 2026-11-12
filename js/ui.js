/* Pişti arayüzü: kurulum, masa çizimi, animasyonlar, oyun döngüsü, kayıt. */
(function () {
  'use strict';
  var E = window.PistiEngine;
  var AI = window.PistiAI;
  var SAVE_KEY = 'kahvehane-pisti-v1';

  var SPEEDS = {
    slow: { think: 1100, anim: 1.35 },
    normal: { think: 600, anim: 1 },
    fast: { think: 200, anim: 0.55 }
  };
  var LEVEL_LABEL = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };
  var POS_2 = ['bottom', 'top'];
  var POS_4 = ['bottom', 'right', 'top', 'left'];
  var SEAT_LABELS_2 = ['Alt', 'Karşı'];
  var SEAT_LABELS_4 = ['Alt', 'Sağ', 'Karşı', 'Sol'];

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (id) { return document.getElementById(id); };

  // ---------- Durum ----------
  var settings = defaultSettings();
  var match = null;        // { scores, handNo, dealer, state, log, over, summary }
  var loopToken = 0;
  var pending = null;      // insan hamlesi bekleniyor: { p, resolve }
  var thinking = -1;
  var viewSeat = 0;
  var revealed = true;
  var screen = 'setup';

  function defaultSettings() {
    return {
      players: 2,
      mode: 'teams',
      seats: [
        { name: 'Sen', type: 'human' },
        { name: 'Kemal', type: 'hard' },
        { name: 'Ayten', type: 'medium' },
        { name: 'Rıza', type: 'hard' }
      ],
      target: 101,
      speed: 'normal',
      hints: true
    };
  }

  function n() { return settings.players; }
  function teams() { return settings.players === 4 && settings.mode === 'teams'; }
  function numSides() { return teams() ? 2 : n(); }
  function sideOf(p) { return teams() ? p % 2 : p; }
  function seat(p) { return settings.seats[p]; }
  function humans() {
    var h = [];
    for (var i = 0; i < n(); i++) if (seat(i).type === 'human') h.push(i);
    return h;
  }
  function sideName(sd) {
    if (!teams()) return seat(sd).name;
    return seat(sd).name + ' & ' + seat(sd + 2).name;
  }
  function anim(ms) { return reduceMotion ? 0 : ms * SPEEDS[settings.speed].anim; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  // ---------- Kayıt ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ settings: settings, match: match })); } catch (e) { /* depolama yok */ }
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function loadSettingsOnly() {
    var d = loadSaved();
    if (d && d.settings) settings = mergeSettings(d.settings);
    return d;
  }
  function mergeSettings(s) {
    var def = defaultSettings();
    var out = Object.assign(def, s);
    if (!Array.isArray(out.seats) || out.seats.length !== 4) out.seats = defaultSettings().seats;
    return out;
  }

  // ---------- Kart HTML ----------
  function cardHTML(c, cls, attrs) {
    var r = E.rank(c), su = E.suit(c), R = E.RANKS[r], S = E.SUITS[su];
    var classes = 'card face' + (E.isRed(c) ? ' red' : '') + (r === E.JACK ? ' jack' : '') + (cls ? ' ' + cls : '');
    var pip = r >= 10
      ? '<span class="pip letter"><span>' + R + '<small>' + S + '</small></span></span>'
      : '<span class="pip">' + S + '</span>';
    var corner = '<b>' + R + '</b><i>' + S + '</i>';
    var pts = E.POINTS[c] ? '<span class="pts" title="' + E.POINTS[c] + ' puan">' + E.POINTS[c] + '</span>' : '';
    return '<div class="' + classes + '" ' + (attrs || '') + ' aria-label="' + E.cardName(c) + '">' +
      '<span class="corner tl">' + corner + '</span>' + pip + '<span class="corner br">' + corner + '</span>' + pts + '</div>';
  }
  function backHTML(cls) { return '<div class="card back' + (cls ? ' ' + cls : '') + '"></div>'; }

  // ---------- Yerleşim ----------
  function posOf(p) {
    var rel = (p - viewSeat + n()) % n();
    return (n() === 2 ? POS_2 : POS_4)[rel];
  }
  function seatEl(p) { return document.querySelector('.seat[data-pos="' + posOf(p) + '"]'); }

  // ---------- Çizim ----------
  function render(opts) {
    opts = opts || {};
    if (!match) return;
    var s = match.state;
    var table = $('table');
    table.className = 'table seats-' + n();
    renderScoreboard();
    for (var p = 0; p < n(); p++) renderSeat(p, opts);
    renderCenter(opts);
  }

  function renderScoreboard() {
    var html = '';
    for (var sd = 0; sd < numSides(); sd++) {
      html += '<div class="score-chip side-' + sd + '"><span class="dot"></span><span>' + esc(sideName(sd)) +
        '</span><b>' + match.scores[sd] + '</b><small>/ ' + settings.target + '</small></div>';
    }
    html += '<div class="score-chip"><small>' + match.handNo + '. el</small></div>';
    $('scoreboard').innerHTML = html;
  }

  function renderSeat(p, opts) {
    var s = match.state;
    var el = seatEl(p);
    var pos = posOf(p);
    var st = seat(p);
    var active = !s.handOver && s.turn === p;
    el.className = 'seat' + (pos === 'bottom' ? ' seat-me' : '') + (active ? ' active' : '');
    el.dataset.player = p;

    var tag = st.type === 'human' ? (humans().length > 1 ? 'İnsan' : '') : 'YZ · ' + LEVEL_LABEL[st.type];
    var info = '<div class="seat-info side-' + sideOf(p) + '"><span class="dot"></span><span class="name">' + esc(st.name) + '</span>' +
      (tag ? '<span class="tag">' + tag + '</span>' : '') +
      (thinking === p ? '<span class="thinking" aria-label="düşünüyor"><i></i><i></i><i></i></span>' : '') + '</div>';
    var stats = '<div class="seat-stats"><span class="stack-wrap"><span class="stack' + (s.capCount[p] ? ' has' : '') + '"></span><span>' +
      s.capCount[p] + ' kart</span></span>' +
      (s.pistiCount[p] ? '<span class="badge-pisti">' + s.pistiCount[p] + ' pişti</span>' : '') +
      (s.lastCapturer === p ? '<span class="badge-last">son alan</span>' : '') + '</div>';

    var hand = s.hands[p];
    var handHtml;
    var showFaces = pos === 'bottom' && st.type === 'human' && revealed;
    if (opts.hideHands) {
      handHtml = '<div class="hand ' + (pos === 'bottom' ? 'mine' : 'opp') + '"></div>';
    } else if (showFaces) {
      var sorted = hand.slice().sort(function (a, b) { return E.rank(a) - E.rank(b) || E.suit(a) - E.suit(b); });
      var myTurn = pending && pending.p === p;
      handHtml = '<div class="hand mine' + (myTurn ? '' : ' waiting') + '">' + sorted.map(function (c, i) {
        var cls = myTurn ? 'playable' : '';
        if (myTurn && settings.hints && E.canCapture(s, c)) cls += ' hint';
        var attrs = 'data-card="' + c + '"' + (myTurn ? ' tabindex="0" role="button" title="' + (i + 1) + ' tuşu"' : '');
        return cardHTML(c, cls, attrs);
      }).join('') + '</div>';
    } else {
      var cls = pos === 'bottom' ? 'mine' : 'opp';
      handHtml = '<div class="hand ' + cls + '">' + hand.map(function () { return backHTML(); }).join('') + '</div>';
    }

    var prompt = '';
    if (pos === 'bottom') {
      var txt = '';
      if (pending && pending.p === p) {
        var canTake = hand.some(function (c) { return E.canCapture(s, c); });
        txt = 'Sıra sende, bir kart seç' + (settings.hints && canTake ? '. Vurgulu kartlar yerdekini alır.' : '.');
      }
      prompt = '<div class="turn-prompt">' + txt + '</div>';
    }

    if (pos === 'bottom') el.innerHTML = prompt + handHtml + '<div class="seat-stats-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center">' + info + stats + '</div>';
    else if (pos === 'top') el.innerHTML = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center">' + info + stats + '</div>' + handHtml;
    else el.innerHTML = info + stats + handHtml;
  }

  function rot(c) { return (((c * 37) % 11) - 5) * 1.6; }

  function renderCenter(opts) {
    var s = match.state;
    // Deste
    var deckN = opts.deckCount != null ? opts.deckCount : s.deck.length;
    var deckHtml = '';
    var layers = Math.min(4, Math.ceil(deckN / 8));
    for (var i = 0; i < layers; i++) deckHtml += backHTML('" style="transform:translate(' + (-i * 1.5) + 'px,' + (-i * 1.5) + 'px)');
    $('deck').innerHTML = deckHtml;
    $('deckCount').textContent = deckN ? 'Deste: ' + deckN : 'Deste bitti';

    // Yer
    var pile, hidden;
    if (opts.pileOverride) { pile = opts.pileOverride; hidden = opts.pileHidden || 0; }
    else if (opts.hidePile) { pile = []; hidden = 0; }
    else { pile = s.pile; hidden = s.pileHidden; }
    var cw = cardSize().width;
    var html = '';
    if (!pile.length) {
      html = '<div class="pile-empty">Yer boş</div>';
    } else {
      var maxShow = 5;
      var start = Math.max(0, pile.length - maxShow);
      // kapalı kartlar ve görünmeyen alt kartlar
      var under = Math.min(start + 0, 3);
      for (var u = 0; u < under; u++) {
        html += backHTML('" style="transform:translate(-50%,-50%) translate(' + (-cw * 0.32 - u * 2) + 'px,' + (u * 2 - 3) + 'px) rotate(' + (-8 + u * 3) + 'deg)');
      }
      for (var j = start; j < pile.length; j++) {
        var depth = pile.length - 1 - j;
        var dx = -depth * cw * 0.14;
        var dy = -depth * 1.5;
        var style = 'style="transform:translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) rotate(' + rot(pile[j]) + 'deg)"';
        html += j < hidden ? backHTML('" ' + style.replace(/^style="/, 'style="')) : cardHTML(pile[j], '', style);
      }
    }
    $('pile').innerHTML = html;
    var pts = 0;
    for (var k = hidden; k < pile.length; k++) pts += E.POINTS[pile[k]];
    var info = pile.length ? 'Yerde ' + pile.length + ' kart' + (hidden ? ' (' + hidden + ' kapalı)' : '') + (pts ? ' · ' + pts + ' puan' : '') : '';
    $('pileInfo').textContent = info;
  }

  function cardSize() {
    var r = $('deck').getBoundingClientRect();
    return { width: r.width || 70, height: r.height || 100 };
  }
  function pileTarget() {
    var r = $('pile').getBoundingClientRect();
    var cs = cardSize();
    return { left: r.left + r.width / 2 - cs.width / 2, top: r.top + r.height / 2 - cs.height / 2, width: cs.width, height: cs.height };
  }
  function deckRect() {
    var r = $('deck').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function seatHandRect(p) {
    var el = seatEl(p);
    var h = el && el.querySelector('.hand');
    var r = (h && h.getBoundingClientRect()) || el.getBoundingClientRect();
    var cs = cardSize();
    var w = posOf(p) === 'bottom' ? cs.width : cs.width * 0.56;
    var hh = w * 1.42;
    return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - hh / 2, width: w, height: hh };
  }
  function stackRect(p) {
    var el = seatEl(p);
    var st = el && el.querySelector('.stack');
    var r = st ? st.getBoundingClientRect() : el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: Math.max(r.width, 20), height: Math.max(r.height, 28) };
  }

  // ---------- Animasyon ----------
  function fly(html, from, to, ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var el = wrap.firstElementChild;
    el.style.width = to.width + 'px';
    el.style.height = to.height + 'px';
    el.style.setProperty('--cw', to.width + 'px');
    $('fly').appendChild(el);
    var sx = from.width / to.width, sy = from.height / to.height;
    if (!el.animate) { el.remove(); return Promise.resolve(); }
    var a = el.animate([
      { transform: 'translate(' + from.left + 'px,' + from.top + 'px) scale(' + sx + ',' + sy + ')' },
      { transform: 'translate(' + to.left + 'px,' + to.top + 'px) scale(1,1)' }
    ], { duration: ms, easing: 'cubic-bezier(.3,.75,.3,1)', fill: 'forwards' });
    return new Promise(function (res) {
      var done = function () { el.remove(); res(); };
      a.onfinish = done; a.oncancel = done;
      setTimeout(done, ms + 400);
    });
  }

  function flyPileTo(p, cards) {
    var from = pileTarget();
    var to = stackRect(p);
    var cs = cardSize();
    var tgt = { left: to.left, top: to.top, width: cs.width, height: cs.height };
    // Kart boyutunu yığın boyutuna küçült
    var sc = to.width / cs.width;
    var ms = anim(420);
    var shown = cards.slice(-3);
    var promises = shown.map(function (c, i) {
      return sleep(i * 50).then(function () {
        return flyScaled(cardHTML(c), from, tgt, sc, ms);
      });
    });
    return Promise.all(promises);
  }
  function flyScaled(html, from, to, endScale, ms) {
    if (!ms) return Promise.resolve();
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var el = wrap.firstElementChild;
    el.style.width = from.width + 'px';
    el.style.height = from.height + 'px';
    el.style.setProperty('--cw', from.width + 'px');
    $('fly').appendChild(el);
    if (!el.animate) { el.remove(); return Promise.resolve(); }
    var a = el.animate([
      { transform: 'translate(' + from.left + 'px,' + from.top + 'px) scale(1)', opacity: 1 },
      { transform: 'translate(' + to.left + 'px,' + to.top + 'px) scale(' + endScale + ')', opacity: 0.6 }
    ], { duration: ms, easing: 'cubic-bezier(.5,0,.4,1)', fill: 'forwards' });
    return new Promise(function (res) {
      var done = function () { el.remove(); res(); };
      a.onfinish = done; a.oncancel = done;
      setTimeout(done, ms + 400);
    });
  }

  async function animateDeal(token, withTable) {
    var s = match.state;
    var ms = anim(260);
    var stagger = anim(55);
    var deckLeft = s.deck.length + s.n * 4 + (withTable ? 4 : 0);
    render({ hideHands: true, hidePile: withTable, deckCount: deckLeft });
    if (!ms) { render(); return; }
    await frame();
    var from = deckRect();
    var jobs = [];
    var t = 0;
    if (withTable) {
      var tgt = pileTarget();
      for (var i = 0; i < 4; i++) {
        (function (i, delay) {
          jobs.push(sleep(delay).then(function () {
            return fly(i === 3 ? cardHTML(s.pile[3]) : backHTML(), from, tgt, ms);
          }));
        })(i, t);
        t += stagger;
      }
      t += stagger * 2;
    }
    for (var k = 0; k < 4; k++) {
      for (var q = 0; q < s.n; q++) {
        var p = (s.dealer + 1 + q) % s.n;
        (function (p, delay) {
          jobs.push(sleep(delay).then(function () {
            if (token !== loopToken) return;
            return fly(backHTML(), from, seatHandRect(p), ms);
          }));
        })(p, t);
        t += stagger;
      }
    }
    await Promise.all(jobs);
    if (token !== loopToken) return;
    render();
  }

  function showBanner(text, sub) {
    var b = $('banner');
    b.hidden = true;
    b.innerHTML = esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : '');
    void b.offsetWidth;
    b.hidden = false;
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(function () { b.hidden = true; }, reduceMotion ? 1400 : 1500);
  }

  // ---------- Günlük ----------
  function log(cls, text) {
    match.log.push({ cls: cls, text: text });
    if (match.log.length > 300) match.log.shift();
    $('ticker').textContent = text;
    renderLog();
  }
  function renderLog() {
    if ($('logPanel').hidden) return;
    $('log').innerHTML = match.log.slice().reverse().map(function (l) {
      return '<li class="' + l.cls + '">' + esc(l.text) + '</li>';
    }).join('');
  }

  // ---------- Oyun akışı ----------
  function newMatch() {
    match = {
      scores: new Array(numSides()).fill(0),
      handNo: 0,
      dealer: Math.floor(Math.random() * n()),
      state: null,
      log: [],
      over: false,
      summary: null
    };
    var h = humans();
    viewSeat = h.length ? h[0] : 0;
    revealed = h.length <= 1;
  }

  async function startHand() {
    match.handNo++;
    match.dealer = (match.dealer + 1) % n();
    match.state = E.newHand({ n: n(), teams: teams(), dealer: match.dealer });
    match.summary = null;
    log('sys', match.handNo + '. el başladı. Kartları ' + seat(match.dealer).name + ' dağıttı.');
    save();
    var token = ++loopToken;
    if (humans().length > 1) revealed = false;
    await animateDeal(token, true);
    if (token !== loopToken) return;
    runLoop(token);
  }

  function resumeLoop() {
    var token = ++loopToken;
    render();
    runLoop(token);
  }

  async function runLoop(token) {
    while (token === loopToken) {
      var s = match.state;
      if (s.handOver) { finishHand(); return; }
      var p = s.turn;
      var card;
      if (seat(p).type === 'human') {
        if (humans().length > 1 && (viewSeat !== p || !revealed)) {
          viewSeat = p;
          revealed = false;
          render();
          await curtain(p);
          if (token !== loopToken) return;
          revealed = true;
        }
        card = await new Promise(function (resolve) {
          pending = { p: p, resolve: resolve, token: token };
          render();
        });
        pending = null;
        if (token !== loopToken || card == null) return;
      } else {
        thinking = p;
        render();
        await frame();
        var t0 = Date.now();
        card = AI.chooseMove(s, p, seat(p).type);
        var wait = SPEEDS[settings.speed].think - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        thinking = -1;
        if (token !== loopToken) return;
      }
      await doPlay(p, card, token);
      if (humans().length > 1 && seat(p).type === 'human') { revealed = false; }
    }
  }

  async function doPlay(p, card, token) {
    var s = match.state;
    var from;
    var el = document.querySelector('.hand.mine [data-card="' + card + '"]');
    if (el && posOf(p) === 'bottom') {
      var r = el.getBoundingClientRect();
      from = { left: r.left, top: r.top, width: r.width, height: r.height };
      el.style.visibility = 'hidden';
    } else {
      from = seatHandRect(p);
      var hEl = seatEl(p).querySelector('.hand');
      if (hEl && hEl.lastElementChild) hEl.lastElementChild.style.visibility = 'hidden';
    }
    var prevPile = s.pile.slice();
    var prevHidden = s.pileHidden;
    await fly(cardHTML(card), from, pileTarget(), anim(320));
    if (token !== loopToken) return;

    var ev = E.play(s, p, card);
    var name = seat(p).name;

    if (ev.capture) {
      // Önce kartın yere düştüğünü göster, sonra topla
      render({ pileOverride: prevPile.concat([card]), pileHidden: prevHidden, deckCount: ev.dealt ? s.deck.length + s.n * 4 : null, hideHandsFor: null });
      if (ev.pisti) {
        log('pisti', name + ' ' + E.cardName(card) + ' ile PİŞTİ yaptı! +' + ev.pisti);
        showBanner(ev.pisti === 20 ? 'VALE PİŞTİ!' : 'PİŞTİ!', name + ' +' + ev.pisti);
      } else {
        log('cap', name + ' ' + E.cardName(card) + ' ile ' + ev.taken.length + ' kart aldı.');
      }
      await sleep(anim(ev.pisti ? 900 : 420));
      if (token !== loopToken) return;
      render({ hidePile: true, deckCount: ev.dealt ? s.deck.length + s.n * 4 : null, hideHands: ev.dealt });
      await flyPileTo(p, ev.taken);
    } else {
      log('drop', name + ' ' + E.cardName(card) + ' attı.');
      if (ev.final) render({ pileOverride: prevPile.concat([card]), pileHidden: prevHidden });
    }
    if (token !== loopToken) return;

    if (ev.final) {
      var to = seat(ev.final.player).name;
      log('sys', 'Yerde kalan ' + ev.final.cards.length + ' kart son alan ' + to + "'e gitti.");
      await sleep(anim(500));
      render({ hidePile: true });
      await flyPileTo(ev.final.player, ev.final.cards);
    }
    save();
    if (ev.dealt) {
      log('sys', 'Yeni kartlar dağıtıldı. Destede ' + s.deck.length + ' kart kaldı.');
      if (humans().length > 1) revealed = false;
      await animateDeal(token, false);
    } else {
      render();
    }
  }

  function curtain(p) {
    return new Promise(function (resolve) {
      $('curtainName').textContent = seat(p).name;
      $('curtain').hidden = false;
      $('btnReveal').focus();
      $('btnReveal').onclick = function () { $('curtain').hidden = true; resolve(); };
    });
  }

  function finishHand() {
    var s = match.state;
    if (!s.scored) {
      var sc = E.handScore(s);
      for (var i = 0; i < sc.length; i++) match.scores[i] += sc[i].total;
      s.scored = true;
      // Kazanan kontrolü: hedefi geçen ve tek başına en yüksek olan
      var max = Math.max.apply(null, match.scores);
      var leaders = match.scores.filter(function (v) { return v === max; }).length;
      match.over = max >= settings.target && leaders === 1;
      match.summary = sc;
      log('sys', match.handNo + '. el bitti. ' + match.scores.map(function (v, i) { return sideName(i) + ' ' + v; }).join(', '));
      save();
    }
    render();
    showHandEnd();
  }

  function showHandEnd() {
    var sc = match.summary || E.handScore(match.state);
    var sides = numSides();
    var head = '<thead><tr><th></th>' + range(sides).map(function (i) {
      return '<th class="side-' + i + '"><span class="dot"></span> ' + esc(sideName(i)) + '</th>';
    }).join('') + '</tr></thead>';
    function row(label, f, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td>' + range(sides).map(function (i) { return '<td>' + f(sc[i], i) + '</td>'; }).join('') + '</tr>';
    }
    var body = '<tbody>' +
      row('Alınan kart', function (o) { return o.cards; }) +
      row('En çok kart (+3)', function (o) { return o.majority ? '+3' : '–'; }) +
      row('As', function (o) { return o.aces || '–'; }) +
      row('Vale', function (o) { return o.jacks || '–'; }) +
      row('Sinek 2', function (o) { return o.clubs2 ? '+2' : '–'; }) +
      row('Karo 10', function (o) { return o.diamonds10 ? '+3' : '–'; }) +
      row('Pişti', function (o) { return o.pisti ? '+' + o.pisti + ' (' + o.pistiCount + ')' : '–'; }) +
      row('Bu el', function (o) { return o.total; }, 'sum') +
      row('Toplam', function (o, i) { return match.scores[i]; }, 'grand') +
      '</tbody>';
    $('handEndTable').innerHTML = head + body;

    var max = Math.max.apply(null, match.scores);
    if (match.over) {
      var w = match.scores.indexOf(max);
      var hs = humans();
      var youWon = hs.length === 1 && sideOf(hs[0]) === w;
      $('handEndTitle').textContent = youWon ? 'Kazandın!' : 'Oyun bitti: ' + sideName(w) + ' kazandı';
      $('handEndNote').textContent = match.handNo + ' el sürdü. Aynı masayla yeniden oynayabilirsin.';
      $('btnNextHand').textContent = 'Yeni oyun';
    } else {
      $('handEndTitle').textContent = match.handNo + '. el bitti';
      var need = settings.target - max;
      $('handEndNote').textContent = max >= settings.target
        ? 'Hedefte eşitlik var, bir el daha oynanıyor.'
        : 'Hedef ' + settings.target + ' puan. Öndeki tarafın ' + need + ' puana daha ihtiyacı var.';
      $('btnNextHand').textContent = 'Sonraki el';
    }
    $('handEnd').hidden = false;
    screen = 'handEnd';
    $('btnNextHand').focus();
  }

  function range(k) { var a = []; for (var i = 0; i < k; i++) a.push(i); return a; }

  // ---------- İnsan girişi ----------
  function playHumanCard(c) {
    if (!pending) return;
    var hand = match.state.hands[pending.p];
    if (hand.indexOf(c) < 0) return;
    var r = pending.resolve;
    pending = null;
    r(c);
  }
  $('table').addEventListener('click', function (e) {
    var el = e.target.closest('.card.playable');
    if (el) playHumanCard(Number(el.dataset.card));
  });
  $('table').addEventListener('keydown', function (e) {
    var el = e.target.closest && e.target.closest('.card.playable');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); playHumanCard(Number(el.dataset.card)); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('rules').hidden = true; $('logPanel').hidden = true; }
    if (pending && /^[1-4]$/.test(e.key) && screen === 'game') {
      var els = document.querySelectorAll('.hand.mine .card.playable');
      var el = els[Number(e.key) - 1];
      if (el) playHumanCard(Number(el.dataset.card));
    }
  });

  // ---------- Kurulum ekranı ----------
  function buildSeatRows() {
    var rows = '';
    var labels = n() === 2 ? SEAT_LABELS_2 : SEAT_LABELS_4;
    for (var i = 0; i < n(); i++) {
      var st = settings.seats[i];
      var dotCls = teams() ? 'side-' + (i % 2) : 'side-' + i;
      rows += '<div class="seat-row">' +
        '<span class="where ' + dotCls + '"><span class="dot"></span>' + labels[i] + '</span>' +
        '<input type="text" id="seatName' + i + '" maxlength="14" value="' + esc(st.name) + '" aria-label="' + labels[i] + ' oyuncunun adı">' +
        '<select id="seatType' + i + '" aria-label="' + labels[i] + ' oyuncunun türü">' +
        opt('human', 'İnsan', st.type) + opt('easy', 'YZ · Kolay', st.type) + opt('medium', 'YZ · Orta', st.type) + opt('hard', 'YZ · Zor', st.type) +
        '</select></div>';
    }
    $('seatRows').innerHTML = rows;
    function opt(v, l, cur) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>'; }
  }
  function readSeatRows() {
    for (var i = 0; i < n(); i++) {
      var nm = $('seatName' + i);
      var tp = $('seatType' + i);
      if (nm) settings.seats[i].name = nm.value.trim() || (i === 0 ? 'Sen' : 'Oyuncu ' + (i + 1));
      if (tp) settings.seats[i].type = tp.value;
    }
  }
  function syncSetupFromSettings() {
    $('players' + settings.players).checked = true;
    $(settings.mode === 'teams' ? 'modeTeams' : 'modeSolo').checked = true;
    var tg = $('target' + settings.target); if (tg) tg.checked = true;
    $('speed' + settings.speed.charAt(0).toUpperCase() + settings.speed.slice(1)).checked = true;
    $('hints').checked = !!settings.hints;
    $('modeField').hidden = settings.players !== 4;
    buildSeatRows();
  }
  function readSetup() {
    readSeatRows();
    var f = $('setupForm');
    settings.players = Number(f.querySelector('input[name="players"]:checked').value);
    settings.mode = f.querySelector('input[name="mode"]:checked').value;
    settings.target = Number(f.querySelector('input[name="target"]:checked').value);
    settings.speed = f.querySelector('input[name="speed"]:checked').value;
    settings.hints = $('hints').checked;
  }
  $('setupForm').addEventListener('change', function (e) {
    if (e.target.name === 'players' || e.target.name === 'mode') {
      readSeatRows();
      settings.players = Number($('setupForm').querySelector('input[name="players"]:checked').value);
      settings.mode = $('setupForm').querySelector('input[name="mode"]:checked').value;
      $('modeField').hidden = settings.players !== 4;
      buildSeatRows();
    }
  });
  $('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    readSetup();
    beginNewGame();
  });
  $('btnResume').addEventListener('click', function () {
    if (!match) return;
    // Yalnızca hız ve ipucu ayarları devam eden oyunda değişebilir
    var f = $('setupForm');
    settings.speed = f.querySelector('input[name="speed"]:checked').value;
    settings.hints = $('hints').checked;
    $('setup').hidden = true;
    screen = 'game';
    if (match.state.handOver) { finishHand(); }
    else resumeLoop();
  });

  function beginNewGame() {
    loopToken++;
    pending = null;
    thinking = -1;
    $('setup').hidden = true;
    $('handEnd').hidden = true;
    $('curtain').hidden = true;
    $('fly').innerHTML = '';
    screen = 'game';
    newMatch();
    startHand();
  }

  function openMenu() {
    loopToken++;
    if (pending) { var r = pending.resolve; pending = null; r(null); }
    thinking = -1;
    $('curtain').hidden = true;
    $('handEnd').hidden = true;
    syncSetupFromSettings();
    $('btnResume').hidden = !(match && !match.over);
    $('setup').hidden = false;
    screen = 'setup';
    if (match) save();
  }

  // ---------- Düğmeler ----------
  $('btnMenu').addEventListener('click', openMenu);
  $('btnToMenu').addEventListener('click', openMenu);
  $('btnNextHand').addEventListener('click', function () {
    $('handEnd').hidden = true;
    screen = 'game';
    if (match.over) { beginNewGame(); return; }
    startHand();
  });
  $('btnRules').addEventListener('click', function () { $('rules').hidden = false; $('btnRulesClose').focus(); });
  $('btnRulesClose').addEventListener('click', function () { $('rules').hidden = true; });
  $('rules').addEventListener('click', function (e) { if (e.target === $('rules')) $('rules').hidden = true; });
  $('btnLog').addEventListener('click', function () { $('logPanel').hidden = !$('logPanel').hidden; renderLog(); });
  $('btnLogClose').addEventListener('click', function () { $('logPanel').hidden = true; });
  window.addEventListener('resize', function () { if (match && screen !== 'setup') render(); });

  // ---------- Başlatma ----------
  function restore(data) {
    if (!data || !data.match || !data.match.state) return false;
    settings = mergeSettings(data.settings || {});
    match = data.match;
    var h = humans();
    viewSeat = h.length ? h[0] : 0;
    revealed = h.length <= 1;
    return true;
  }

  function start(hotData) {
    if (hotData && restore(hotData) && hotData.screen === 'game' && !match.over) {
      $('setup').hidden = true;
      screen = 'game';
      if (match.state.handOver) finishHand(); else resumeLoop();
      return;
    }
    var saved = loadSettingsOnly();
    if (saved && saved.match && saved.match.state && !saved.match.over) {
      restore(saved);
      render();
      $('btnResume').hidden = false;
    }
    syncSetupFromSettings();
  }

  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try { window.claude.hot.snapshot(function () { return { settings: settings, match: match, screen: screen }; }); } catch (e) { /* yok say */ }
  }
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
  else start((window.claude && window.claude.hot && window.claude.hot.data) || null);
})();
