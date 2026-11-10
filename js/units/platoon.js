/*
 * 아군 전차 소대 편성.
 *   1조: 1호차(소대장차), 2호차
 *   2조: 3호차, 4호차(부소대장차)
 * 이후 단계(M2 피해, M5 승무원 등)에서 각 전차 객체에 필드를 추가해 나간다.
 */
TMM.TEAMS = {
  1: { name: '1조', color: '#e2c35a', dark: '#5a4c1c' },
  2: { name: '2조', color: '#6fc7bf', dark: '#1d4a47' },
};

TMM.Platoon = (function () {
  const ROSTER = [
    { id: 1, role: '소대장차', team: 1, x: 74, y: 106.5 },
    { id: 2, role: '1조 소속', team: 1, x: 77, y: 111 },
    { id: 3, role: '2조 소속', team: 2, x: 87, y: 111 },
    { id: 4, role: '부소대장차', team: 2, x: 90, y: 106.5 },
  ];

  function create() {
    return ROSTER.map((d) => ({
      id: d.id,
      callsign: d.id + '호차',
      role: d.role,
      team: d.team,
      model: 'K1A2',
      x: d.x,
      y: d.y,
      heading: -Math.PI / 2, // 북쪽을 향함 (라디안, 0 = 동쪽)
      path: [], // 남은 꺾이는 점들
      dest: null, // 최종 목적지 {x, y}
      state: 'idle', // 'idle' 정지 | 'moving' 이동 중
      speedKmh: 0,
    }));
  }

  return { create };
})();
