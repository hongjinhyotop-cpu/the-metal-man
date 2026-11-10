/*
 * 플레이어가 지휘하지 않는 아군 (M3). 사격하지 않으며, 정해진 대로만 움직인다.
 *   - 보병 분대: 저수지 동쪽 숲의 관측초소. 피아식별장치 없음. 적이 가까이 오거나 정해진 시각이 되면 주둔지로 걸어서 철수.
 *   - 보급 트럭: 관측초소에 보급을 마치고 국도로 주둔지에 돌아온다. 피아식별장치 없음.
 *   - K2 전차(인접 중대): 동부 도로로 와서 주둔지를 지나 남쪽으로 빠져나간다. 피아식별장치 있음.
 * 피아식별장치가 없는 아군은 식별 전에는 '미상 표적'으로 보이므로, 서둘러 쏘면 오인사격이 된다.
 *
 * 시간(at)은 작전 개시 후 게임 초.
 */
TMM.Allies = (function () {
  const ROSTER = [
    {
      id: 201, model: 'INF', callsign: '아군 보병 분대', role: '관측초소', x: 83, y: 62.5,
      script: { type: 'outpost', withdrawM: 2000, at: 420, to: { x: 80, y: 101 } },
      fixedSpeedKmh: 5, // 걸어서 이동
    },
    {
      id: 202, model: 'TRUCK', callsign: '아군 보급 트럭', role: '보급', x: 85, y: 63.5,
      script: { type: 'drive', at: 300, to: { x: 84, y: 108 } },
    },
    {
      id: 203, model: 'K2', callsign: 'K2 전차 (인접 중대)', role: '이동 중', x: 159, y: 69.3,
      script: { type: 'drive', at: 20, to: { x: 82, y: 119.4 }, exit: true },
    },
  ];

  // none: true 면 비지휘 아군 없음 (M7a: 첫 접적 말고는 없다)
  function create(none) {
    if (none) return [];
    return ROSTER.map((d) => {
      const u = TMM.Damage.initCombat({
        id: d.id,
        side: 'friend',
        ally: true,
        callsign: d.callsign,
        role: d.role,
        team: 0,
        x: d.x,
        y: d.y,
        heading: Math.PI / 2,
        path: [],
        dest: null,
        state: 'idle',
        speedKmh: 0,
        fixedSpeedKmh: d.fixedSpeedKmh || 0,
        script: Object.assign({ done: false }, d.script),
      }, d.model);
      return u;
    });
  }

  function update(game, gdt, events) {
    const elapsed = game.gameSeconds - game.startSeconds;
    for (const a of game.allies) {
      if (a.destroyed || a.exited) continue;
      const sc = a.script;
      if (sc.type === 'outpost' && !sc.done) {
        // 적 전차가 가까이 오면 철수
        const near = game.enemies.some((e) => !e.destroyed && !e.exited && TMM.Ballistics.distanceM(game.map, a, e) <= sc.withdrawM);
        if (near || elapsed >= sc.at) {
          sc.done = true;
          TMM.Movement.order(game.map, a, sc.to.x, sc.to.y);
          events.push({ type: 'ally-move', unit: a, what: 'withdraw' });
        }
      } else if (sc.type === 'drive' && !sc.done && elapsed >= sc.at) {
        sc.done = true;
        TMM.Movement.order(game.map, a, sc.to.x, sc.to.y);
        events.push({ type: 'ally-move', unit: a, what: 'drive' });
      }
      if (sc.exit && sc.done && a.state !== 'moving' && Math.hypot(a.x - sc.to.x, a.y - sc.to.y) < 1.5) {
        a.exited = true;
        events.push({ type: 'ally-exit', unit: a });
      }
    }
  }

  return { create, update };
})();
