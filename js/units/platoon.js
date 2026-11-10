/*
 * 아군 전차 소대 편성.
 *   1조: 1호차(소대장차), 2호차
 *   2조: 3호차, 4호차(부소대장차)
 * 전투 필드(탄약·손상)는 TMM.Damage.initCombat 이 붙인다. 이후 단계(M5 승무원 등)에서 각 전차 객체에 필드를 추가해 나간다.
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

  // spec (M7a 캠페인): [{ id, x, y, heading, ammo{탄종:발수}, damage{부위:true} }] — 이번 작전에 나오는 전차만.
  //   격파된 전차는 빼고 넘긴다. 없으면 훈련 모드처럼 4대가 주둔지에서 새 전차로 시작.
  function create(spec) {
    const list = spec ? spec.map((sp) => Object.assign({}, ROSTER.find((d) => d.id === sp.id), sp)) : ROSTER;
    return list.map((d) => {
      const u = TMM.Damage.initCombat({
        id: d.id,
        side: 'friend',
        callsign: d.id + '호차',
        role: d.role,
        team: d.team,
        x: d.x,
        y: d.y,
        heading: d.heading != null ? d.heading : -Math.PI / 2, // 북쪽을 향함 (라디안, 0 = 동쪽)
        path: [], // 남은 꺾이는 점들
        dest: null, // 최종 목적지 {x, y}
        state: 'idle', // 'idle' 정지 | 'moving' 이동 중
        speedKmh: 0,
      }, 'K1A2');
      if (d.ammo) u.ammo = Object.assign({ K276: 0, K277: 0 }, d.ammo);
      if (d.damage) Object.assign(u.damage, d.damage);
      if (u.ammo[u.ammoType] <= 0) u.ammoType = TMM.VEHICLES.K1A2.ammoTypes.find((k) => u.ammo[k] > 0) || u.ammoType;
      return u;
    });
  }

  return { create, ROSTER };
})();
