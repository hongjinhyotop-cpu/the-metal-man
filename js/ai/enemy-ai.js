/*
 * 적 전차 AI (M2 간단판).
 *   advance  전진: 아군 주둔지 쪽 목표로 이동
 *   deploy   전개: 아군이 사거리에 들어오면 종대에서 횡대로 옆으로 벌려 선다 (같은 자리에 겹치지 않게)
 *   engage   교전: 정지해서 사격 (천마호는 기동 간 사격을 하지 않음)
 *   retreat  후퇴: 피해가 크면 매봉 능선 고갯길로 물러난다
 *   hold     고착: 움직일 수 없으면 그 자리에서 버틴다
 * 실제 사격은 gunnery.js 가 한다. 여기서는 이동과 정지만 정한다.
 */
TMM.EnemyAI = (function () {
  const B = () => TMM.Ballistics;
  const D = () => TMM.Damage;

  // 정지해서 사격을 시작하는 거리 (게임용 추정치). 최대 사거리(3km)보다 약간 짧게 잡아,
  // 아군이 보이면 곧 멈춰 쏜다. 멈춰 있는 동안은 최대 사거리 안의 아군을 쏜다.
  const ENGAGE_M = 2800;

  function nearestFriendM(game, e) {
    let best = Infinity;
    for (const u of game.units) {
      if (u.destroyed) continue;
      best = Math.min(best, B().distanceM(game.map, e, u));
    }
    return best;
  }

  // 후퇴 조건 (게임용 기준): 주포 손상, 탄약 없음, 부위 2곳 이상 손상,
  // 또는 소대가 절반 이상 격파됐는데 자신도 손상됨
  function shouldRetreat(game, e) {
    const parts = D().damagedParts(e).length;
    const lost = game.enemies.filter((x) => x.destroyed).length;
    return e.damage.gun || D().totalAmmo(e) <= 0 || parts >= 2 || (lost >= 2 && parts >= 1);
  }

  // 횡대 전개: 진행 방향의 옆으로 lane × 5칸(250m) 이동. 갈 수 없는 곳이면 그 자리에서 교전.
  function deploy(game, e) {
    const lane = e.ai.lane || 0;
    if (!lane) return false;
    const px = Math.sin(e.heading), py = -Math.cos(e.heading); // 진행 방향의 왼쪽 (남쪽으로 갈 때 동쪽)
    for (const k of [1, 0.6, 0.3]) {
      const tx = e.x + px * lane * 5 * k, ty = e.y + py * lane * 5 * k;
      const info = game.map.infoAt(tx, ty);
      if (!info || !info.speed) continue;
      if (TMM.Movement.order(game.map, e, tx, ty).ok) return true;
    }
    return false;
  }

  function update(game, gdt, events) {
    const range = ENGAGE_M;
    for (const e of game.enemies) {
      if (e.destroyed) continue;
      const ai = e.ai;
      ai.repath = Math.max(0, ai.repath - gdt);

      if (!D().canMove(e)) {
        if (ai.mode !== 'hold') {
          ai.mode = 'hold';
          if (e.state === 'moving') TMM.Movement.stop(e);
        }
        continue;
      }

      if (ai.mode !== 'retreat' && shouldRetreat(game, e)) {
        ai.mode = 'retreat';
        const res = TMM.Movement.order(game.map, e, TMM.Enemy.RALLY.x, TMM.Enemy.RALLY.y);
        if (res.ok) events.push({ type: 'enemy-retreat', unit: e });
        continue;
      }

      if (ai.mode === 'retreat') continue; // 집결지에 도착하면 그 자리에서 정지 (사거리에 들어오면 사격)

      if (ai.mode === 'deploy') {
        if (e.state === 'moving') continue;
        ai.mode = 'engage';
        ai.deployed = true;
      }

      const near = nearestFriendM(game, e);
      const armed = D().canFire(e);
      if (armed && near <= range) {
        if (ai.mode !== 'engage') {
          TMM.Movement.stop(e);
          events.push({ type: 'enemy-engage', unit: e });
          if (!ai.deployed && deploy(game, e)) ai.mode = 'deploy';
          else ai.mode = 'engage';
        }
        continue;
      }

      // 사거리 안에 아군이 없으면 다시 전진
      if (ai.mode === 'engage') ai.mode = 'advance';
      if (e.state !== 'moving' && ai.repath <= 0) {
        const dGoal = Math.hypot(e.x - ai.goal.x, e.y - ai.goal.y);
        if (dGoal > 2) TMM.Movement.order(game.map, e, ai.goal.x, ai.goal.y);
        ai.repath = 20; // 경로 재탐색은 게임 20초에 한 번
      }
    }
  }

  const MODE_NAMES = { advance: '전진 중', deploy: '전개 중', engage: '정지 사격', retreat: '후퇴 중', hold: '기동 불능' };

  return { update, MODE_NAMES };
})();
