/*
 * 지리 정의(TMM.Geo)를 바탕으로 칸 단위 지형 격자를 만든다.
 * 결과: TMM.Map 객체 (지형 조회, 속도 조회, 격자 좌표 변환)
 */
TMM.MapGen = (function () {
  const T = TMM.T;
  const Geo = TMM.Geo;
  const N = TMM.Noise;

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // 시야 계산용 높이의 잔기복 크기 (지도 그림은 0.06). 게임용 추정치.
  const SIGHT_BUMP = 0.012;

  function generate() {
    const { COLS, ROWS, METERS_PER_CELL } = TMM.CONFIG;
    const type = new Uint8Array(COLS * ROWS);
    const elev = new Float32Array(COLS * ROWS);
    const sightElev = new Float32Array(COLS * ROWS); // 시야 계산용 높이 (작은 기복을 줄임, M3)

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c + 0.5, y = r + 0.5;
        const i = r * COLS + c;
        const e = Geo.elevation(x, y);
        elev[i] = e;
        sightElev[i] = Geo.elevation(x, y, SIGHT_BUMP);
        const rx = Geo.riverX(y);

        let t = T.OPEN;

        // 숲: 능선 경사면, 하천 서안, 남쪽 야산에 많고 그 외는 드문드문
        const f = N.fbm(x / 7, y / 7, 23, 3);
        let thr = 0.63;
        if (e > 0.17 && e < Geo.RIDGE_T + 0.12) thr = 0.47;
        if (x < rx - 2) thr = Math.min(thr, 0.52);
        if (e > 0.09 && y > 85) thr = Math.min(thr, 0.45);
        if (f > thr) t = T.FOREST;

        // 논: 가운데 낮은 평지
        const p = N.fbm(x / 12, y / 12, 31, 3);
        if (e < 0.13 && y > 36 && y < 97 && x > rx + 3 && x < 152 && p > 0.45) t = T.PADDY;

        if (e > Geo.RIDGE_T) t = T.RIDGE;
        if (Geo.inTown(x, y)) t = T.TOWN;
        if (Geo.inBase(x, y)) t = T.BASE;
        if (Geo.inReservoir(x, y)) t = T.RESERVOIR;
        if (Math.abs(x - rx) < Geo.RIVER_HALF) t = T.RIVER;

        type[i] = t;
      }
    }

    // 도로를 칸에 찍는다. 하천 위의 도로 칸은 다리가 된다.
    for (const road of Geo.roads) {
      const pts = road.pts;
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
        const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - 2));
        const c1 = Math.min(COLS - 1, Math.ceil(Math.max(ax, bx) + 2));
        const r0 = Math.max(0, Math.floor(Math.min(ay, by) - 2));
        const r1 = Math.min(ROWS - 1, Math.ceil(Math.max(ay, by) + 2));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            if (distToSegment(c + 0.5, r + 0.5, ax, ay, bx, by) >= road.half) continue;
            const i = r * COLS + c;
            if (type[i] === T.RIVER || type[i] === T.BRIDGE) type[i] = T.BRIDGE;
            else if (type[i] !== T.RESERVOIR) type[i] = T.ROAD;
          }
        }
      }
    }

    // 칸별 이동 속도(m/s) 미리 계산
    const speedMs = new Float32Array(COLS * ROWS);
    for (let i = 0; i < speedMs.length; i++) {
      speedMs[i] = TMM.TERRAIN_INFO[type[i]].speed / 3.6;
    }

    return createMap(COLS, ROWS, METERS_PER_CELL, type, elev, speedMs, sightElev);
  }

  function createMap(cols, rows, metersPerCell, type, elev, speedMs, sightElev) {
    return {
      cols,
      rows,
      metersPerCell,
      type,
      elev,
      sightElev,
      speedMs,
      maxSpeedMs: TMM.MAX_SPEED_KMH / 3.6,

      inBounds(c, r) {
        return c >= 0 && r >= 0 && c < cols && r < rows;
      },
      typeAt(x, y) {
        const c = Math.floor(x), r = Math.floor(y);
        if (!this.inBounds(c, r)) return -1;
        return type[r * cols + c];
      },
      infoAt(x, y) {
        const t = this.typeAt(x, y);
        return t < 0 ? null : TMM.TERRAIN_INFO[t];
      },
      speedMsAt(x, y) {
        const c = Math.floor(x), r = Math.floor(y);
        if (!this.inBounds(c, r)) return 0;
        return speedMs[r * cols + c];
      },
      // 해발 고도(m) 근사
      altitudeAt(x, y) {
        const c = Math.floor(x), r = Math.floor(y);
        if (!this.inBounds(c, r)) return 0;
        return Math.round(40 + elev[r * cols + c] * 330);
      },
      // 6자리 격자 좌표 "동서-남북" (100m 단위, 북쪽으로 갈수록 숫자 증가)
      gridRef(x, y) {
        const e = Math.floor((x * metersPerCell) / 100);
        const n = Math.floor(((rows - y) * metersPerCell) / 100);
        const pad = (v) => String(Math.max(0, v)).padStart(3, '0');
        return pad(e) + '-' + pad(n);
      },
    };
  }

  return { generate };
})();
