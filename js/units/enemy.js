/*
 * 적 부대: 북한군 천마호 전차 1개 소대(4대).
 * 북쪽 매봉 능선 고갯길과 새터읍에서 출발해 남쪽 아군 주둔지 방향으로 전진한다.
 * M2 에서는 적이 항상 보인다 (시야·식별은 M3).
 */
TMM.Enemy = (function () {
  const ROSTER = [
    // x, y: 출발 위치 / gx, gy: 전진 목표 (아군 주둔지 앞) / lane: 교전 시 횡대 위치 (서쪽 -, 동쪽 +)
    { id: 101, n: 1, x: 106.5, y: 9, gx: 82, gy: 92, lane: -0.5 },
    { id: 102, n: 2, x: 100, y: 15, gx: 72, gy: 95, lane: -1.5 },
    { id: 103, n: 3, x: 111, y: 22, gx: 90, gy: 94, lane: 0.5 },
    { id: 104, n: 4, x: 119, y: 26, gx: 98, gy: 98, lane: 1.5 },
  ];

  // 후퇴 집결지: 매봉 능선 고갯길 북쪽
  const RALLY = { x: 106.5, y: 6 };

  function create() {
    return ROSTER.map((d) => TMM.Damage.initCombat({
      id: d.id,
      num: d.n,
      side: 'enemy',
      callsign: '적 전차 ' + d.n,
      role: '천마호 소대',
      team: 0,
      x: d.x,
      y: d.y,
      heading: Math.PI / 2, // 남쪽을 향함
      path: [],
      dest: null,
      state: 'idle',
      speedKmh: 0,
      ai: { mode: 'advance', goal: { x: d.gx, y: d.gy }, repath: 0, lane: d.lane, deployed: false },
    }, 'CHONMA'));
  }

  return { create, RALLY };
})();
