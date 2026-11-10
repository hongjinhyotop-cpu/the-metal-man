/*
 * 시선(LOS) 판정 (M3).
 * 관측자 눈높이에서 표적 윗부분까지 직선을 긋고, 그 사이의 지형 높이와 숲·시가지가 시선을 가리는지 본다.
 *
 *   - 지형: 직선 아래 어느 지점이라도 땅이 시선보다 높으면 완전히 가려진다 (능선 너머).
 *   - 숲·시가지: 시선이 '지면 + 가림 높이' 보다 낮게 지나가면, 지나간 거리만큼 가림 정도가 쌓인다.
 *               가림 정도가 1 이상이면 완전히 가려지고, 그 아래면 '부분적으로 보임'.
 *   - 관측자·표적이 서 있는 칸 자체는 시선을 가리지 않는다 (숲 가장자리에서는 밖이 보임).
 *     표적이 숲·시가지 안에 있으면 따로 '은폐'로 다룬다 (TMM.TERRAIN_SIGHT.conceal).
 *   - 차체 엄폐: 시선이 보이는데, 표적 가까이(400m 이내)의 땅이 '표적 차체로 가는 시선'을 막으면
 *               포탑만 보이는 상태다 (능선 바로 뒤에 멈춘 전차).
 *
 * 높이 단위는 m. 수치는 모두 게임용 추정치.
 */
TMM.Sight = (function () {
  const EYE_H = 3.0; // 관측자 눈높이 (전차장 조준경)
  const TOP_H = 2.6; // 표적이 '보이는' 높이 (포탑 윗부분)
  const HULL_H = 1.5; // 표적 차체 가운데 높이
  const HULL_NEAR = 8; // 차체 엄폐를 만드는 지형은 표적에서 이 칸 수(400m) 안에 있어야 한다
  const HULL_TOL = 0.6; // 땅이 차체 시선보다 이만큼 낮아도 '가림'으로 친다 (지형 격자가 거칠어서)
  const STEP = 0.5; // 시선 표본 간격(칸)

  // 칸 중심 사이를 직선 보간한 지면 높이(m)
  function groundAtSlow(map, x, y) {
    const { cols, rows } = map;
    const elev = map.sightElev || map.elev;
    const fx = Math.min(cols - 1, Math.max(0, x - 0.5));
    const fy = Math.min(rows - 1, Math.max(0, y - 0.5));
    const c0 = Math.floor(fx), r0 = Math.floor(fy);
    const c1 = Math.min(cols - 1, c0 + 1), r1 = Math.min(rows - 1, r0 + 1);
    const tx = fx - c0, ty = fy - r0;
    const e =
      elev[r0 * cols + c0] * (1 - tx) * (1 - ty) +
      elev[r0 * cols + c1] * tx * (1 - ty) +
      elev[r1 * cols + c0] * (1 - tx) * ty +
      elev[r1 * cols + c1] * tx * ty;
    return 40 + e * 330; // mapgen 의 altitudeAt 과 같은 환산
  }

  // 빠른 조회용 격자: 1칸을 SUB×SUB 로 나눠 높이를 미리 계산 (지도마다 한 번)
  const SUB = 4;
  function grid(map) {
    if (map._sightGrid) return map._sightGrid;
    const w = map.cols * SUB, h = map.rows * SUB;
    const alt = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) alt[r * w + c] = groundAtSlow(map, (c + 0.5) / SUB, (r + 0.5) / SUB);
    }
    const coverH = new Float32Array(map.cols * map.rows);
    const coverObs = new Float32Array(map.cols * map.rows);
    for (let i = 0; i < coverH.length; i++) {
      const ts = TMM.TERRAIN_SIGHT[map.type[i]];
      coverH[i] = ts.h;
      coverObs[i] = ts.obs;
    }
    map._sightGrid = { w, h, alt, coverH, coverObs };
    return map._sightGrid;
  }

  function groundAt(map, x, y) {
    const G = grid(map);
    let c = Math.floor(x * SUB), r = Math.floor(y * SUB);
    if (c < 0) c = 0; else if (c >= G.w) c = G.w - 1;
    if (r < 0) r = 0; else if (r >= G.h) r = G.h - 1;
    return G.alt[r * G.w + c];
  }

  /**
   * a(관측자) → b(표적) 시선.
   * 반환: { clear, obs(0~1, 길 위 가림 정도), hullDown, blockedBy('terrain'|'cover'|null) }
   * opts.eyeH / opts.topH 로 높이를 바꿀 수 있다 (가상 관측점 계산용).
   */
  // 같은 두 지점의 시선은 다시 계산하지 않는다 (멈춰 있는 전차끼리는 매번 같은 결과)
  const cache = new Map();
  function line(map, a, b, opts) {
    if (opts) return lineRaw(map, a, b, opts);
    const key = Math.round(a.x * 20) + ',' + Math.round(a.y * 20) + ',' + Math.round(b.x * 20) + ',' + Math.round(b.y * 20);
    let r = cache.get(key);
    if (!r || r.map !== map) {
      if (cache.size > 20000) cache.clear();
      r = lineRaw(map, a, b, null);
      r.map = map;
      cache.set(key, r);
    }
    return { clear: r.clear, obs: r.obs, hullDown: r.hullDown, blockedBy: r.blockedBy };
  }

  function lineRaw(map, a, b, opts) {
    const eyeH = (opts && opts.eyeH) || EYE_H;
    const topH = (opts && opts.topH) || TOP_H;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const res = { clear: true, obs: 0, hullDown: false, blockedBy: null };
    if (dist < 1) return res;

    const G = grid(map);
    const cols = map.cols, rows = map.rows;
    const ha = groundAt(map, a.x, a.y) + eyeH;
    const gb = groundAt(map, b.x, b.y);
    const hTop = gb + topH;
    const hHull = gb + HULL_H;
    const acx = Math.floor(a.x), acy = Math.floor(a.y);
    const bcx = Math.floor(b.x), bcy = Math.floor(b.y);
    const steps = Math.ceil(dist / STEP);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, y = a.y + dy * t;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cx === bcx && cy === bcy) continue; // 표적 칸
      let gc = Math.floor(x * SUB), gr = Math.floor(y * SUB);
      if (gc < 0) gc = 0; else if (gc >= G.w) gc = G.w - 1;
      if (gr < 0) gr = 0; else if (gr >= G.h) gr = G.h - 1;
      const g = G.alt[gr * G.w + gc];
      const lineTop = ha + (hTop - ha) * t;
      if (g >= lineTop) {
        res.clear = false;
        res.blockedBy = 'terrain';
        return res;
      }
      if ((cx !== acx || cy !== acy) && cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
        const ci = cy * cols + cx;
        const o = G.coverObs[ci];
        if (o && g + G.coverH[ci] > lineTop) {
          res.obs += o * (dist / steps);
          if (res.obs >= 1) {
            res.clear = false;
            res.blockedBy = 'cover';
            return res;
          }
        }
      }
      // 차체 엄폐: 표적 가까운 땅이 차체로 가는 시선을 막는가
      if ((1 - t) * dist <= HULL_NEAR) {
        const lineHull = ha + (hHull - ha) * t;
        if (g >= lineHull - HULL_TOL) res.hullDown = true;
      }
    }
    return res;
  }

  /**
   * 지점 p 가 '북쪽에서 볼 때' 차체 엄폐가 되는 지형인가 (커서 안내용).
   * 북·북동·북서 2km 지점의 가상 관측자 중 하나라도 차체 엄폐로 보면 true.
   */
  function hullDownFromNorth(map, p) {
    const R = 2000 / map.metersPerCell;
    let any = false;
    for (const ang of [-Math.PI / 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5]) {
      const o = { x: p.x + Math.cos(ang) * R, y: p.y + Math.sin(ang) * R };
      if (o.y < 0) o.y = 0.5;
      if (o.x < 0 || o.x > map.cols) continue;
      const r = line(map, o, p);
      if (r.clear && r.hullDown) any = true;
    }
    return any;
  }

  /**
   * 관측자 o 에서 보이는 칸 격자 (step 칸 간격). 시야 표시용.
   * 반환: { step, w, h, data: Uint8Array (0 가려짐, 1 부분, 2 보임) }
   */
  function viewshed(map, o, maxCells, step) {
    step = step || 2;
    const w = Math.ceil(map.cols / step), h = Math.ceil(map.rows / step);
    const data = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const p = { x: c * step + step / 2, y: r * step + step / 2 };
        if (Math.hypot(p.x - o.x, p.y - o.y) > maxCells) continue;
        const res = line(map, o, p);
        data[r * w + c] = res.clear ? (res.obs > 0.3 ? 1 : 2) : 0;
      }
    }
    return { step, w, h, data };
  }

  return { groundAt, line, hullDownFromNorth, viewshed, EYE_H, TOP_H };
})();
