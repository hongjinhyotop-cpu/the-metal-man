/*
 * 적 전차 AI (M3: 시야·식별 반영).
 * 적도 아군과 같은 시야·식별 규칙을 따른다. AI 는 '적 편 접촉 표'(game.intel.enemy)만 보고 판단하며,
 * 아군의 실제 위치를 몰래 보지 않는다.
 *
 *   advance  전진: 숨은 경로의 경유지를 차례로 지난다. 집결지에서는 소대 전원이 모일 때까지(최대 STAGE_MAX_SEC) 기다린 뒤
 *            동시에 사격 진지(숲 가장자리)로 나온다 → 주둔지를 서·동 양쪽에서 협공.
 *   deploy   전개: 처음 교전할 때 옆으로 벌려 선다 (lane 이 있는 전차만)
 *   engage   교전: 보이는 아군 전차(미상 포함)가 교전 거리 안이면 정지해 식별·사격.
 *                  교전 거리는 집결 전 APPROACH_ENGAGE_M (숨어 오는 중이라 웬만하면 지나침), 집결 후 ENGAGE_M.
 *                  LOST_SEC 동안 교전 거리 안에 아무도 안 보이면 다시 전진 (사격 진지 다음은 주둔지로 돌격).
 *   retreat  후퇴: 크게 손상되면 매봉 능선 고갯길 집결지로
 *   withdraw 퇴각: 소대가 전투력을 잃으면(싸울 수 있는 전차 1대 이하) 모두 지도 북쪽 끝 밖으로 빠져나간다.
 *                  움직일 수 없는 전차는 승무원이 버리고 떠난다(유기).
 *   hold     고착: 궤도가 끊기면 그 자리에서 사격만
 * 실제 사격은 gunnery.js 가 한다. 여기서는 이동과 정지만 정한다.
 */
TMM.EnemyAI = (function () {
  const B = () => TMM.Ballistics;
  const D = () => TMM.Damage;

  // ---- 적 행동 기준 (게임용 추정치) ----
  // (모의 전투에서 바꿔 볼 수 있도록 TMM.EnemyAI.P 로도 내보낸다)
  const P = {
    ENGAGE_M: 2000, // 사격 진지에 도착한 뒤: 이 거리 안에 아군이 보이면 정지해 사격
    APPROACH_ENGAGE_M: 1200, // 집결 전(숨어서 이동 중): 아주 가까울 때만 멈춰 싸운다
    ASSAULT_ENGAGE_M: 900, // 집결 후 사격 진지로 나가는 중: 진지에 닿을 때까지 웬만하면 멈추지 않는다
    STAGE_MAX_SEC: 360, // 첫 전차가 집결지에 닿은 뒤 이 시간이 지나면 다 안 모여도 출발
    LOST_SEC: 40, // 교전 중 아군이 이 시간 동안 안 보이면 다시 전진
    BREAK_EFFECTIVE: 0, // 싸울 수 있는 전차가 이 수 이하가 되면 소대 퇴각 (M4: 1 → 0, 마지막 한 대까지 싸운다)
    RETREAT_PARTS: 3, // 부위가 이만큼 손상되면 후퇴 (M4: 2 → 3)
  };

  // 적이 보고 있는 위협: 아군 전차, 또는 아직 식별 못 한 미상 표적(멈춰서 식별한다).
  // 트럭·보병으로 식별된 것은 위협으로 보지 않고 전진을 계속한다. (보병은 작아서 처음부터 무시)
  function threats(game, e) {
    const out = [];
    for (const c of game.intel.enemy.contacts.values()) {
      if (!c.visible || c.wreck) continue;
      if (c.unit.model === 'INF') continue;
      if (c.identified && c.cls !== 'tank') continue;
      out.push({ c, d: Math.hypot(c.lastX - e.x, c.lastY - e.y) * game.map.metersPerCell });
    }
    return out;
  }

  // 후퇴 조건 (게임용 기준): 주포 손상, 탄약 없음, 부위 2곳 이상 손상,
  // 또는 소대가 절반 이상 격파됐는데 자신도 손상됨
  function shouldRetreat(game, e) {
    const parts = D().damagedParts(e).length;
    const lost = game.enemies.filter((x) => x.destroyed).length;
    return e.damage.gun || D().totalAmmo(e) <= 0 || parts >= P.RETREAT_PARTS || (lost >= 2 && parts >= 1);
  }

  // 싸울 수 있는 전차: 살아 있고, 주포·탄약이 있고, 움직일 수 있고, 손상 부위 1곳 이하
  function effective(e) {
    if (e.ai.pending) return true; // M7a: 아직 오는 중인 제대가 있으면 소대(전체)는 무너지지 않았다
    return !e.destroyed && !e.exited && D().canFire(e) && D().canMove(e) && D().damagedParts(e).length <= 1 && e.ai.mode !== 'retreat';
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

  // 소대 퇴각 판단과 실행
  function checkBreak(game, events) {
    if (game.enemyBroken) return;
    const alive = game.enemies.filter((e) => !e.destroyed && !e.exited);
    if (!alive.length) return;
    if (game.enemies.filter(effective).length > P.BREAK_EFFECTIVE) return;
    game.enemyBroken = true;
    events.push({ type: 'enemy-break' });
    for (const e of alive) {
      if (!D().canMove(e)) {
        // 움직일 수 없는 전차는 승무원이 버리고 떠난다
        e.abandoned = true;
        e.destroyed = true;
        TMM.Movement.stop(e);
        events.push({ type: 'enemy-abandon', unit: e });
        continue;
      }
      e.ai.mode = 'withdraw';
      e.ai.repath = 0;
      e.targetId = null;
    }
  }

  // 집결 완료 판단: 살아서 싸울 수 있는 전차가 모두 집결지에 왔거나, 기다린 시간이 다 됨
  function checkGo(game, events) {
    if (game.enemyGo) return;
    const active = game.enemies.filter((e) => !e.destroyed && !e.exited && e.ai.mode !== 'retreat' && e.ai.mode !== 'hold');
    const allStaged = active.length && active.every((e) => e.ai.staged || e.ai.wp > e.ai.stage);
    const timeout = game.enemyStagedAt != null && game.gameSeconds - game.enemyStagedAt > P.STAGE_MAX_SEC;
    if (allStaged || timeout) {
      game.enemyGo = true;
      events.push({ type: 'enemy-go' });
    }
  }

  function update(game, gdt, events) {
    checkBreak(game, events);
    checkGo(game, events);
    const now = game.gameSeconds;
    // M7a: 작전마다 후퇴 집결지·퇴각 출구가 다르다 (game.enemyRally, game.enemyExits). 퇴각은 가장 가까운 출구로.
    const RALLY = game.enemyRally || TMM.Enemy.RALLY;
    const EXITS = game.enemyExits || [TMM.Enemy.EXIT];

    for (const e of game.enemies) {
      // M7a: 늦게 오는 적 — 출발 시각이 되면 지도에 나타난다
      if (e.ai.pending) {
        if (now - game.startSeconds < e.ai.delay) continue;
        e.ai.pending = false;
        e.exited = false;
        events.push({ type: 'enemy-arrive', unit: e });
      }
      if (e.destroyed || e.exited) continue;
      const ai = e.ai;
      ai.repath = Math.max(0, ai.repath - gdt);
      ai.wait = Math.max(0, ai.wait - gdt);

      if (ai.mode === 'withdraw') {
        if (!ai.exit) ai.exit = EXITS.reduce((b, x) => (Math.hypot(x.x - e.x, x.y - e.y) < Math.hypot(b.x - e.x, b.y - e.y) ? x : b));
        const EXIT = ai.exit;
        if (Math.hypot(e.x - EXIT.x, e.y - EXIT.y) < 1.8) {
          e.exited = true;
          TMM.Movement.stop(e);
          events.push({ type: 'enemy-exit', unit: e });
        } else if (e.state !== 'moving' && ai.repath <= 0) {
          TMM.Movement.order(game.map, e, EXIT.x, EXIT.y);
          ai.repath = 10;
        }
        continue;
      }


      if (!D().canMove(e)) {
        if (ai.mode !== 'hold') {
          ai.mode = 'hold';
          if (e.state === 'moving') TMM.Movement.stop(e);
        }
        continue;
      }

      if (ai.mode !== 'retreat' && shouldRetreat(game, e)) {
        ai.mode = 'retreat';
        const res = TMM.Movement.order(game.map, e, RALLY.x, RALLY.y);
        if (res.ok) events.push({ type: 'enemy-retreat', unit: e });
        continue;
      }
      if (ai.mode === 'retreat') continue; // 집결지에 도착하면 그 자리에서 정지 (보이는 아군이 사거리에 들어오면 사격)

      if (ai.mode === 'deploy') {
        if (e.state === 'moving') continue;
        ai.mode = 'engage';
        ai.deployed = true;
      }

      const th = threats(game, e);
      const atPos = ai.route.length >= 2 && ai.wp >= ai.route.length - 2 && Math.hypot(e.x - ai.route[ai.route.length - 2].x, e.y - ai.route[ai.route.length - 2].y) < 2.5;
      if (atPos) ai.atPos = true;
      const radius = ai.engageM || (ai.atPos || ai.static ? P.ENGAGE_M : game.enemyGo ? P.ASSAULT_ENGAGE_M : P.APPROACH_ENGAGE_M);
      // 멈춰 싸우는 것은 '자기 눈으로' 보이는 위협이 있을 때만 (소대가 공유한 접촉만으로는 멈추지 않고 다가간다)
      const close = th.some((t) => t.d <= radius && TMM.Intel.sees(game, e, t.c.unit));
      if (close) ai.lastThreatAt = now;
      const armed = D().canFire(e);

      // M7a: 진지 방어 — 움직이지 않고, 보이는 아군과 싸운다
      if (ai.static) {
        if (armed && close && ai.mode !== 'engage') {
          ai.mode = 'engage';
          events.push({ type: 'enemy-engage', unit: e });
        }
        continue;
      }

      if (armed && close) {
        if (ai.mode !== 'engage') {
          TMM.Movement.stop(e);
          events.push({ type: 'enemy-engage', unit: e });
          if (!ai.deployed && deploy(game, e)) ai.mode = 'deploy';
          else ai.mode = 'engage';
        }
        continue;
      }

      if (ai.mode === 'engage') {
        if (now - ai.lastThreatAt < P.LOST_SEC) continue; // 방금까지 보이던 아군을 기다린다
        ai.mode = 'advance';
      }

      // 전진: 경유지를 차례로
      if (e.state === 'moving' || ai.wait > 0) continue;
      const wp = ai.route[Math.min(ai.wp, ai.route.length - 1)];
      const dWp = Math.hypot(e.x - wp.x, e.y - wp.y);
      if (dWp <= 2) {
        if (ai.wp === ai.stage && !game.enemyGo) {
          // 집결지: 소대가 다 모일 때까지 대기
          if (!ai.staged) {
            ai.staged = true;
            if (game.enemyStagedAt == null) game.enemyStagedAt = now;
          }
          continue;
        }
        if (ai.wp < ai.route.length - 1) ai.wp += 1;
        continue;
      }
      if (ai.repath <= 0) {
        const res = TMM.Movement.order(game.map, e, wp.x, wp.y);
        ai.repath = 20; // 경로 재탐색은 게임 20초에 한 번
        if (!res.ok && ai.wp < ai.route.length - 1) ai.wp += 1; // 갈 수 없는 경유지는 건너뜀
      }
    }
  }

  const MODE_NAMES = { defend: '진지 방어', advance: '전진 중', deploy: '전개 중', engage: '정지 사격', retreat: '후퇴 중', withdraw: '퇴각 중', hold: '기동 불능' };

  return { update, MODE_NAMES, ENGAGE_M: P.ENGAGE_M, P };
})();
