/*
 * 경로 탐색 (A*).
 * 비용 = 이동 시간. 그래서 전차는 돌아가더라도 도로처럼 빠른 길을 고른다.
 * 하천·저수지는 통행 불가이므로 하천은 다리로만 건넌다.
 */
TMM.Path = (function () {
  const SQ2 = Math.SQRT2;
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
  ];

  // 간단한 이진 힙 (우선순위 큐)
  function Heap() {
    this.ids = [];
    this.pri = [];
  }
  Heap.prototype.push = function (id, p) {
    const ids = this.ids, pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  };
  Heap.prototype.pop = function () {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop(), lastP = pri.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mp = lastP;
        if (l < n && pri[l] < mp) { m = l; mp = pri[l]; }
        if (r < n && pri[r] < mp) { m = r; mp = pri[r]; }
        if (m === i) break;
        ids[i] = ids[m];
        pri[i] = pri[m];
        i = m;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', {
    get() { return this.ids.length; },
  });

  /**
   * 칸 (sc,sr) → (gc,gr) 최단 시간 경로.
   * 반환: [{c, r}, ...] (출발 칸 포함) 또는 null
   */
  function findCells(map, sc, sr, gc, gr) {
    const cols = map.cols;
    const spd = map.speedMs;
    const M = map.metersPerCell;
    const goal = gr * cols + gc;
    if (!map.inBounds(gc, gr) || !spd[goal]) return null;

    const total = cols * map.rows;
    const g = new Float64Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const heap = new Heap();
    const hScale = M / map.maxSpeedMs;
    const h = (c, r) => Math.hypot(c - gc, r - gr) * hScale;

    const start = sr * cols + sc;
    g[start] = 0;
    heap.push(start, h(sc, sr));

    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      const cc = cur % cols, cr = (cur / cols) | 0;
      // 출발 칸이 통행 불가 칸이면(예: 경계) 느린 속도로 빠져나오게 한다
      const sCur = spd[cur] || map.maxSpeedMs * 0.15;

      for (let k = 0; k < 8; k++) {
        const nc = cc + DIRS[k][0], nr = cr + DIRS[k][1];
        if (!map.inBounds(nc, nr)) continue;
        const ni = nr * cols + nc;
        if (closed[ni]) continue;
        const sN = spd[ni];
        if (!sN) continue;
        // 대각선으로 하천 모서리를 스치며 건너가는 것 방지
        if (k >= 4 && (!spd[cr * cols + nc] || !spd[nr * cols + cc])) continue;
        const step = DIRS[k][2] * M * 0.5 * (1 / sCur + 1 / sN);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + h(nc, nr));
        }
      }
    }

    if (!isFinite(g[goal])) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) {
      cells.push({ c: i % cols, r: (i / cols) | 0 });
      if (i === start) break;
    }
    cells.reverse();
    return cells;
  }

  // a→b 직선이 통과하는 모든 지점이 minSpeed 이상인가
  function straightOK(map, a, b, minSpeed) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d * 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const s = map.speedMsAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (!s || s < minSpeed - 1e-6) return false;
    }
    return true;
  }

  /**
   * 칸 경로의 지그재그를 펴서 꺾이는 점만 남긴다.
   * 원래 경로보다 느린 지형을 지나가는 지름길은 만들지 않는다.
   */
  function smooth(map, pts) {
    if (pts.length <= 2) return pts.slice();
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      let minS = Math.min(map.speedMsAt(pts[i].x, pts[i].y) || Infinity, map.speedMsAt(pts[j].x, pts[j].y));
      while (j + 1 < pts.length) {
        const nextMin = Math.min(minS, map.speedMsAt(pts[j + 1].x, pts[j + 1].y));
        if (!straightOK(map, pts[i], pts[j + 1], nextMin)) break;
        j++;
        minS = nextMin;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /**
   * 실수 좌표 (from) → (to) 경로. 반환: 꺾이는 점 배열(출발점 포함) 또는 null
   */
  function find(map, from, to) {
    const cells = findCells(map, Math.floor(from.x), Math.floor(from.y), Math.floor(to.x), Math.floor(to.y));
    if (!cells) return null;
    const pts = cells.map((p) => ({ x: p.c + 0.5, y: p.r + 0.5 }));
    pts[0] = { x: from.x, y: from.y };
    if (pts.length === 1) pts.push({ x: to.x, y: to.y });
    else pts[pts.length - 1] = { x: to.x, y: to.y };
    return smooth(map, pts);
  }

  // 경로를 따라갈 때 걸리는 게임 시간(초)과 거리(m)
  function estimate(map, pts) {
    let sec = 0, meters = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(d * 2));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const s = map.speedMsAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) || map.maxSpeedMs * 0.15;
        sec += (d / steps) * map.metersPerCell / s;
      }
      meters += d * map.metersPerCell;
    }
    return { sec, meters };
  }

  return { find, findCells, estimate };
})();
