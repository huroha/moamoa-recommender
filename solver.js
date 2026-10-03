// 한글 모아모아 배치 추천 엔진
// 판: 가로 10 × 세로 16. 각 행은 10비트 정수(열 c = 비트 c, 왼쪽이 0).
// 조각은 빈 곳 어디든 놓을 수 있고, 가득 찬 가로줄은 지워지며 나머지 블록은 움직이지 않는다.
(function (root) {
  'use strict';

  var W = 10, H = 16, FULL = (1 << W) - 1;

  // 기본 방향은 게임 UI에 처음 표시되는 모양 (pieces.md 기준)
  var PIECES = [
    { name: 'ㄱ', color: 'pink',   shape: ['##', '.#', '.#'] },
    { name: 'ㄴ', color: 'pink',   shape: ['#.', '##'] },
    { name: 'ㄷ', color: 'pink',   shape: ['##', '#.', '##'] },
    { name: 'ㄹ', color: 'pink',   shape: ['##', '.#', '##', '#.', '##'] },
    { name: 'ㅁ', color: 'green',  shape: ['###', '#.#', '###'] },
    { name: 'ㅂ', color: 'green',  shape: ['#.#', '###', '#.#', '###'] },
    { name: 'ㅅ', color: 'green',  shape: ['.#.', '#.#'] },
    { name: 'ㅇ', color: 'green',  shape: ['.#.', '#.#', '.#.'] },
    { name: 'ㅈ', color: 'green',  shape: ['###', '.#.', '#.#'] },
    { name: 'ㅊ', color: 'yellow', shape: ['.#.', '###', '.#.', '#.#'] },
    { name: 'ㅋ', color: 'yellow', shape: ['##', '.#', '##', '.#'] },
    { name: 'ㅌ', color: 'yellow', shape: ['##', '#.', '##', '#.', '##'] },
    { name: 'ㅍ', color: 'yellow', shape: ['####', '.##.', '####'] },
    { name: 'ㅎ', color: 'yellow', shape: ['..#..', '#####', '.#.#.', '..#..'] },
    { name: 'ㅏ', color: 'blue',   shape: ['#.', '##', '#.'] },
    { name: 'ㅑ', color: 'blue',   shape: ['#.', '##', '#.', '##', '#.'] },
    { name: 'ㅡ', color: 'blue',   shape: ['###'] },
    { name: 'ㅣ', color: 'blue',   shape: ['#', '#', '#', '#', '#'] },
    { name: '·',  color: 'pink',   shape: ['#'] }
  ];

  function shapeCells(shape) {
    var cells = [];
    for (var r = 0; r < shape.length; r++)
      for (var c = 0; c < shape[r].length; c++)
        if (shape[r][c] === '#') cells.push([r, c]);
    return cells;
  }

  function normalize(cells) {
    var minR = Infinity, minC = Infinity;
    cells.forEach(function (p) { minR = Math.min(minR, p[0]); minC = Math.min(minC, p[1]); });
    return cells.map(function (p) { return [p[0] - minR, p[1] - minC]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  }

  // 시계 방향 90도: (r, c) -> (c, -r)
  function rotateCW(cells) { return normalize(cells.map(function (p) { return [p[1], -p[0]]; })); }
  // 좌우 반전
  function flipH(cells) { return normalize(cells.map(function (p) { return [p[0], -p[1]]; })); }

  // 방향 = 반전(선택) 후 시계 방향 회전 k번. 같은 모양은 버튼을 덜 누르는 쪽만 남긴다.
  function buildOrientations(piece) {
    var base = normalize(shapeCells(piece.shape)), seen = {}, out = [];
    [0, 1].forEach(function (f) {
      var cells = f ? flipH(base) : base;
      for (var k = 0; k < 4; k++) {
        var key = JSON.stringify(cells);
        if (!seen[key] || seen[key].presses > f + k) {
          var h = 0, w = 0;
          cells.forEach(function (p) { h = Math.max(h, p[0] + 1); w = Math.max(w, p[1] + 1); });
          var masks = [];
          for (var r = 0; r < h; r++) masks.push(0);
          cells.forEach(function (p) { masks[p[0]] |= 1 << p[1]; });
          var o = { flip: f, rot: k, presses: f + k, cells: cells, h: h, w: w, masks: masks };
          if (seen[key]) out[out.indexOf(seen[key])] = o; else out.push(o);
          seen[key] = o;
        }
        cells = rotateCW(cells);
      }
    });
    return out;
  }

  var BY_NAME = {};
  PIECES.forEach(function (p) {
    p.size = shapeCells(p.shape).length;
    p.orients = buildOrientations(p);
    BY_NAME[p.name] = p;
  });

  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }
  var POP = new Uint8Array(1 << 12);
  for (var i = 0; i < POP.length; i++) POP[i] = popcount(i);

  function canPlace(board, o, y, x) {
    for (var r = 0; r < o.h; r++) if (board[y + r] & (o.masks[r] << x)) return false;
    return true;
  }


  var MAX_ABILITIES = 7;

  // 조각을 놓고 가득 찬 줄을 지운다.
  // 점수 = 칸 수 + 300 × (동시 제거 줄 수)² + 능력 획득 1개당 50
  // icons: 행별 능력 아이콘 비트마스크. 블록 아래에 깔려 있어도 되고, 그 줄이 지워지면 획득한다.
  // 능력이 가득 차 있으면 획득하지 못하고 아이콘은 판에 그대로 남는다.
  function place(board, icons, abil, o, y, x, size) {
    var nb = board.slice(), ni = icons, cleared = [], gained = 0;
    for (var r = 0; r < o.h; r++) nb[y + r] |= o.masks[r] << x;
    for (var row = 0; row < H; row++) if (nb[row] === FULL) cleared.push(row);
    if (cleared.length) {
      ni = icons.slice();
      cleared.forEach(function (row) {
        nb[row] = 0;
        var m = ni[row];
        while (m && abil + gained < MAX_ABILITIES) { m &= m - 1; gained++; }
        ni[row] = m;
      });
    }
    var n = cleared.length;
    return { board: nb, icons: ni, cleared: cleared, gained: gained, points: size + 300 * n * n + 50 * gained };
  }

  // 평가 가중치 (tune.js 자가 플레이 비교로 정함)
  //  safe : 오래 버티기. 줄을 생기는 대로 지운다.
  //  score: 고득점. 거의 찬 줄을 빈칸 위치가 같게 쌓아 두었다가 한 번에 여러 줄을 지운다.
  var WEIGHTS = {
    safe:  { rowTrans: 2, colTrans: 2, holes: 60, filled: 3, missing: 200, rowSq: 1, run: 0, danger: 0, dangerAt: 160, ability: 150 },
    score: { rowTrans: 2, colTrans: 2, holes: 60, filled: 3, missing: 200, rowSq: 1, run: 0, danger: 0, dangerAt: 160, ability: 150 }
  };

  // 판의 모양 평가 (높을수록 좋음). 비트 연산만 써서 빠르게 계산.
  function shapeScore(board, wt) {
    var rowTrans = 0, colTrans = 0, holes = 0, filled = 0, rowSq = 0;
    var runs = 0, runLen = 0, prevGap = -1;
    for (var r = 0; r < H; r++) {
      var row = board[r];
      var up = r === 0 ? FULL : board[r - 1];
      var down = r === H - 1 ? FULL : board[r + 1];
      var padded = (row << 1) | 1 | (1 << (W + 1));
      rowTrans += POP[(padded ^ (padded >> 1)) & ((1 << (W + 1)) - 1)];
      colTrans += POP[row ^ up];
      var empty = ~row & FULL;
      var left = ((row << 1) | 1) & FULL;
      var right = (row >> 1) | (1 << (W - 1));
      holes += POP[empty & left & right & up & down];
      var f = POP[row];
      filled += f;
      rowSq += f * f;
      // 빈칸이 1~2개뿐인 줄이 같은 빈칸 위치로 연달아 있으면, 세로 조각 하나로 한꺼번에 지울 수 있다
      var gaps = POP[empty];
      if (gaps >= 1 && gaps <= 2) {
        if (empty === prevGap) runLen++;
        else { runs += Math.min(runLen, 5) * Math.min(runLen, 5); runLen = 1; }
        prevGap = empty;
      } else {
        runs += Math.min(runLen, 5) * Math.min(runLen, 5); runLen = 0; prevGap = -1;
      }
    }
    runs += Math.min(runLen, 5) * Math.min(runLen, 5);
    colTrans += POP[board[H - 1] ^ FULL];
    var over = Math.max(0, filled - wt.dangerAt);
    return -wt.rowTrans * rowTrans - wt.colTrans * colTrans - wt.holes * holes - wt.filled * filled
      + wt.rowSq * rowSq + wt.run * runs - wt.danger * over * over;
  }

  // 마무리 평가: 다음 턴에 각 조각을 놓을 자리가 있는지
  function fitPenalty(board, wt) {
    var missing = 0;
    for (var p = 0; p < PIECES.length; p++) {
      var ok = false, os = PIECES[p].orients;
      for (var k = 0; k < os.length && !ok; k++) {
        var o = os[k];
        for (var y = 0; y + o.h <= H && !ok; y++)
          for (var x = 0; x + o.w <= W && !ok; x++)
            if (canPlace(board, o, y, x)) ok = true;
      }
      if (!ok) missing++;
    }
    return -wt.missing * missing;
  }

  function stateKey(board, icons, used) {
    return used + ':' + Array.prototype.join.call(board, ',') + '|' + Array.prototype.join.call(icons, ',');
  }

  // 조각 1~3개의 배치 순서·방향·위치를 빔 서치로 찾는다. 평가 순으로 정렬된 최종 상태 목록을 돌려준다.
  function search(board0, icons0, abil0, names, wt, beamWidth, keep) {
    var pieces = names.map(function (n) { return BY_NAME[n]; });
    var all = (1 << pieces.length) - 1;
    var start = { board: board0, icons: icons0, abil: abil0, used: 0, moves: [], points: 0, bonus: 0, prio: 0 };
    var beam = [start], finals = [], deepest = [start];

    for (var depth = 0; depth < pieces.length; depth++) {
      var children = new Map();
      beam.forEach(function (s) {
        var tried = {};
        pieces.forEach(function (piece, idx) {
          if (s.used & (1 << idx) || tried[piece.name]) return;
          tried[piece.name] = true;
          piece.orients.forEach(function (o) {
            for (var y = 0; y + o.h <= H; y++)
              for (var x = 0; x + o.w <= W; x++) {
                if (!canPlace(s.board, o, y, x)) continue;
                var res = place(s.board, s.icons, s.abil, o, y, x, piece.size);
                var used = s.used | (1 << idx);
                var key = stateKey(res.board, res.icons, used);
                var points = s.points + res.points;
                var bonus = s.bonus + wt.ability * res.gained;
                var prio = points + bonus + shapeScore(res.board, wt);
                var prev = children.get(key);
                if (prev && prev.prio >= prio) continue;
                children.set(key, {
                  board: res.board, icons: res.icons, abil: s.abil + res.gained, used: used,
                  points: points, bonus: bonus, prio: prio,
                  moves: s.moves.concat([{ piece: piece.name, slot: idx, orient: o, y: y, x: x,
                    cleared: res.cleared, gained: res.gained, points: res.points,
                    before: s.board, iconsBefore: s.icons }])
                });
              }
          });
        });
      });
      if (!children.size) break;
      beam = Array.from(children.values()).sort(function (a, b) { return b.prio - a.prio; }).slice(0, beamWidth);
      deepest = beam;
      if (depth === pieces.length - 1) finals = beam.filter(function (s) { return s.used === all; });
    }

    var complete = finals.length > 0;
    var pool = complete ? finals : deepest;
    var ranked = pool.slice(0, keep).map(function (s) {
      s.total = s.prio + fitPenalty(s.board, wt);
      return s;
    }).sort(function (a, b) { return b.total - a.total; });
    return { complete: complete, ranked: ranked };
  }

  // 고정 시드 난수: 같은 입력이면 항상 같은 추천이 나오게 한다
  function rng(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

  // 다음 턴 내다보기: 상위 후보마다 같은 "가상의 다음 조각 3개" 묶음들을 이어서 놓아 보고 평균 결과를 더한다.
  // 다음 턴에 3개를 다 못 놓으면 게임 오버이므로 크게 깎는다.
  function lookahead(ranked, wt, la) {
    var rand = rng(12345), hands = [];
    for (var k = 0; k < la.samples; k++)
      hands.push([0, 1, 2].map(function () { return PIECES[Math.floor(rand() * PIECES.length)].name; }));
    var top = ranked.slice(0, la.top);
    top.forEach(function (s) {
      var sum = 0;
      hands.forEach(function (hand) {
        var r = search(s.board, s.icons, s.abil, hand, wt, la.beam, 10);
        var best = r.ranked[0];
        if (!best) { sum -= la.gameOver * 3; return; }
        sum += r.complete ? best.total : best.total - la.gameOver * (3 - best.moves.length);
      });
      s.future = sum / hands.length;
      s.total2 = s.total + s.future;
    });
    top.sort(function (a, b) { return b.total2 - a.total2; });
    return top.concat(ranked.slice(la.top));
  }

  // names: 보유 조각 이름 1~3개
  // opts.mode: 'score'(기본, 다음 턴까지 내다봄) | 'safe'(빠름)
  // opts.icons: [[행, 열], ...] (0부터), opts.abilities: 보유 능력 수 0~7
  // 반환: 평가 순 계획 목록 (첫 수가 서로 다른 것 위주)
  function solve(boardIn, names, opts) {
    opts = opts || {};
    var mode = WEIGHTS[opts.mode] ? opts.mode : 'score';
    var wt = WEIGHTS[mode];
    var beamWidth = opts.beamWidth || 200, maxPlans = opts.maxPlans || 5;
    var abil0 = Math.max(0, Math.min(MAX_ABILITIES, opts.abilities || 0));
    var icons0 = [];
    for (var r = 0; r < H; r++) icons0.push(0);
    (opts.icons || []).forEach(function (p) { icons0[p[0]] |= 1 << p[1]; });

    var res = search(Array.from(boardIn), icons0, abil0, names, wt, beamWidth, 60);
    var ranked = res.ranked;
    var la = opts.lookahead !== undefined ? opts.lookahead : LOOKAHEAD[mode];
    if (la && res.complete) ranked = lookahead(ranked, wt, la);

    var plans = [], firstSeen = {};
    ranked.forEach(function (s) {
      if (plans.length >= maxPlans || !s.moves.length) return;
      var m = s.moves[0], k = m.piece + m.orient.flip + m.orient.rot + ':' + m.y + ',' + m.x;
      if (firstSeen[k]) return;
      firstSeen[k] = true;
      var icons = [];
      for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) if (s.icons[r] & (1 << c)) icons.push([r, c]);
      plans.push({ moves: s.moves, points: s.points, finalBoard: s.board, finalIcons: icons,
        abilities: s.abil, gained: s.abil - abil0, complete: res.complete });
    });
    return { complete: res.complete, placed: ranked.length ? ranked[0].moves.length : 0, plans: plans };
  }

  // 모드별 내다보기 설정 (top: 다시 평가할 후보 수, samples: 가상 다음 턴 수, beam: 그때의 빔 폭)
  var LOOKAHEAD = {
    safe: null,
    score: { top: 6, samples: 8, beam: 40, gameOver: 3000 }
  };

  var api = { W: W, H: H, FULL: FULL, MAX_ABILITIES: MAX_ABILITIES, PIECES: PIECES, BY_NAME: BY_NAME,
    solve: solve, weights: WEIGHTS, lookahead: LOOKAHEAD, place: place, canPlace: canPlace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoaSolver = api;
})(this);
