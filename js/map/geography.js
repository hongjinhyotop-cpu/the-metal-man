/*
 * 가상 작전 지역의 지리 정의.
 * 좌표 단위는 "칸"(1칸 = 50m). x 는 서→동, y 는 북→남(화면 아래가 남쪽).
 *
 *   북쪽: 매봉 능선과 그 남쪽 기슭의 소도시(새터읍)
 *   가운데: 논과 가람 저수지가 있는 개활지
 *   서쪽: 남북으로 흐르는 덕천(하천), 다리 2곳
 *   남쪽: 아군 주둔지
 *
 * 여기의 함수들은 지도 생성(mapgen)과 지도 그리기(map-renderer) 양쪽에서 쓰인다.
 */
TMM.Geo = (function () {
  const N = TMM.Noise;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function sstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function gauss(x, y, cx, cy, sx, sy) {
    const dx = (x - cx) / sx, dy = (y - cy) / sy;
    return Math.exp(-(dx * dx + dy * dy));
  }

  const Geo = {
    RIDGE_T: 0.42, // 이 높이 이상이면 '능선'
    RIVER_HALF: 1.7, // 하천 반폭(칸)

    // 하천 중심선의 x 좌표 (y 에 따라 굽이침)
    riverX(y) {
      return 29 + 4.5 * Math.sin(y * 0.065 + 0.4) + 2 * Math.sin(y * 0.17 + 1.3);
    },

    reservoir: { cx: 66, cy: 60, rx: 13, ry: 8 },
    reservoirRadius(th) {
      return 1 + 0.14 * Math.sin(3 * th + 1) + 0.08 * Math.sin(5 * th + 2);
    },
    inReservoir(x, y) {
      const R = this.reservoir;
      const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
      return Math.hypot(dx, dy) < this.reservoirRadius(Math.atan2(dy, dx));
    },

    town: { x0: 94, y0: 18, x1: 125, y1: 34 },
    inTown(x, y) {
      const t = this.town;
      return x >= t.x0 && x < t.x1 && y >= t.y0 && y < t.y1;
    },

    base: { x0: 70, y0: 103, x1: 94, y1: 116 },
    inBase(x, y) {
      const b = this.base;
      return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
    },

    // 도로 (half = 반폭, 칸)
    roads: [
      { name: '국도 (남북)', half: 1.0, pts: [[82, 120], [82, 103], [82, 92], [86, 80], [91, 66], [96, 51], [101, 40], [106, 32], [107, 21], [106, 11], [108, 0]] },
      { name: '서부 도로', half: 1.0, pts: [[82, 92], [66, 87], [50, 82], [36, 78], [22, 76], [0, 73]] },
      { name: '북부 도로', half: 1.0, pts: [[106, 28], [88, 33], [70, 37], [52, 39], [36, 41], [22, 42], [0, 44]] },
      { name: '동부 도로', half: 1.0, pts: [[86, 80], [108, 77], [130, 73], [160, 69]] },
      { name: '읍내 동쪽 길', half: 0.8, pts: [[124, 26], [140, 31], [160, 33]] },
      { name: '읍내 길 1', half: 0.7, pts: [[95, 23], [124, 24]] },
      { name: '읍내 길 2', half: 0.7, pts: [[97, 30], [123, 30]] },
      { name: '읍내 길 3', half: 0.7, pts: [[116, 19], [117, 34]] },
      { name: '농로', half: 0.7, pts: [[91, 66], [110, 62], [128, 56], [142, 50]] },
    ],

    // 높이 (대략 0~1, 0.42 이상 능선)
    // bump: 잔물결 같은 작은 기복의 크기. 시야 계산용 높이는 이것을 줄여서 만든다
    // (지도 그림의 기복을 그대로 쓰면 평야의 낮은 둔덕마다 시선이 막혀 평야 전체가 안 보이게 됨).
    elevation(x, y, bump) {
      const n = N.fbm(x / 16, y / 16, 7, 4);
      const band = sstep(32, 3, y + (n - 0.5) * 22); // 북쪽으로 갈수록 1
      let e = band * (0.55 + 0.45 * N.fbm(x / 9, y / 9, 13, 3));
      e += 0.25 * gauss(x, y, 52, 9, 14, 6) + 0.22 * gauss(x, y, 142, 8, 12, 6) + 0.14 * gauss(x, y, 78, 13, 10, 5);
      e *= 1 - 0.5 * gauss(x, y, 107, 12, 7, 14); // 국도가 지나는 고갯길
      e *= 1 - 0.8 * gauss(x, y, 109, 27, 19, 8); // 읍내 분지
      e += 0.16 * gauss(x, y, 126, 100, 11, 8) + 0.13 * gauss(x, y, 44, 104, 9, 7) + 0.1 * gauss(x, y, 10, 20, 10, 14);
      e += (bump == null ? 0.06 : bump) * n;
      return e;
    },

    // 지도 위에 쓰는 지명 (가상)
    labels: [
      { text: '매봉 능선', x: 76, y: 9, kind: 'area' },
      { text: '312고지', x: 52, y: 5.5, kind: 'peak' },
      { text: '288고지', x: 142, y: 5, kind: 'peak' },
      { text: '새터읍', x: 109.5, y: 21.2, kind: 'town' },
      { text: '가람 저수지', x: 66, y: 60.5, kind: 'water' },
      { text: '덕천', x: 22, y: 58, kind: 'water' },
      { text: '들말 평야', x: 118, y: 86, kind: 'area' },
      { text: '아군 주둔지', x: 82, y: 114.6, kind: 'base' },
    ],
  };

  return Geo;
})();
