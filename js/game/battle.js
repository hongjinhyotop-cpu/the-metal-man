/*
 * 전투 한 틱 진행: 무전망(명령 전달) → 이동 → 아군(비지휘) 행동 → 시야·식별 → 명령 수행·엄호 이동 → 적 AI → 사격
 *                → 승무원(피로·고장·잡담) → 피격 시 스스로 판단 → 승무원 사건(부상·사기·신뢰도) → 자동 보고 → 승패 판정.
 * main.js 의 주 루프와 시험용 모의 전투가 같은 코드를 쓴다.
 * 반환: 이번 틱에 일어난 사건 배열 (무전 기록·화면 효과용)
 *
 * 승패 (M3):
 *   승리 — 적 소대가 모두 격파되었거나, 전투력을 잃고 지도 북쪽 끝 밖으로 퇴각함 (끝까지 쫓지 않아도 됨)
 *   패배 — 아군 소대 전차가 CONFIG.PLATOON_LOSS_FAIL(3)대 이상 격파됨 → 소대 전투력 상실 (M4)
 */
TMM.Battle = (function () {
  // opts.op (M7a 캠페인 작전, TMM.Campaign.battleSpec 이 만듦): { no, name, light, startSeconds, units, enemies, allies, rally, exits, objective, calls, marks }
  //   없으면 훈련 모드 (지금까지의 단일 전투)
  function create(opts) {
    const op = (opts && opts.op) || null;
    const light = (op && op.light) || (opts && opts.light) || 'day';
    const start = op && op.startSeconds != null ? op.startSeconds : TMM.LIGHT[light].start;
    const game = {
      map: (opts && opts.map) || TMM.MapGen.generate(),
      units: TMM.Platoon.create(op ? op.units : null),
      enemies: TMM.Enemy.create(op ? op.enemies : (opts && opts.enemies) || null), // M8a: 훈련 '혼합' 편성은 opts.enemies
      allies: TMM.Allies.create(op ? !op.allies : false),
      op,
      enemyRally: op && op.rally ? op.rally : null,
      enemyExits: op && op.exits ? op.exits : null,
      light,
      startSeconds: start,
      gameSeconds: start,
      lastShotAt: null,
      combat: false,
      over: null,
      enemyBroken: false,
      ffCount: 0, // 오인사격 횟수
      rand: (opts && opts.rand) || Math.random,
    };
    TMM.Intel.init(game);
    TMM.Orders.init(game);
    TMM.Radio.init(game);
    TMM.Crew.init(game, opts && opts.crew); // M5 승무원·신뢰도 (opts.crew: 이전 전투의 TMM.Crew.snapshot)
    TMM.Scope.init(game); // M6 1호차 조준 화면
    if (TMM.Support) TMM.Support.init(game); // M7b 이웃 K2 중대(흑표) 지원 요청
    TMM.Smoke.init(game); // M8a 연막 (전차마다 작전당 2회)
    TMM.Missiles.init(game); // M8a 천마-20 불새-3
    TMM.Indirect.init(game, op ? op.fires : opts && opts.fires); // M8a 포병·정찰 드론·자폭 드론
    game.mix = (opts && opts.mix) || null; // M8a 훈련 모드 적 구성 ('mixed' | null)
    game.pendingEvents = []; // M6: 전투 틱 밖(조준 화면 발사)에서 생긴 사건 → 다음 틱에서 무전·승무원 처리
    return game;
  }

  // gdt: 이번 틱의 게임 시간(초). 작전 시계도 여기서 진행한다.
  function step(game, gdt) {
    const events = game.pendingEvents && game.pendingEvents.length ? game.pendingEvents.splice(0) : [];
    game.gameSeconds += gdt;
    TMM.Radio.update(game, gdt, events);
    for (const u of game.units) {
      if (TMM.Movement.update(game.map, u, gdt)) events.push({ type: 'arrive', unit: u });
    }
    for (const e of game.enemies) if (!e.exited) TMM.Movement.update(game.map, e, gdt);
    for (const a of game.allies) if (!a.exited && !a.destroyed) TMM.Movement.update(game.map, a, gdt);
    TMM.Allies.update(game, gdt, events);
    TMM.Intel.update(game, gdt, events);
    TMM.Orders.update(game, gdt);
    TMM.EnemyAI.update(game, gdt, events);
    TMM.Gunnery.update(game, gdt, events);
    TMM.Missiles.update(game, gdt, events); // M8a
    TMM.Indirect.update(game, gdt, events); // M8a
    TMM.Smoke.update(game);
    TMM.Crew.update(game, gdt, events);
    TMM.Orders.onEvents(game, events);
    TMM.Crew.onEvents(game, events);
    TMM.Radio.onEvents(game, events);
    if (game.op) TMM.Objective.update(game, events); // M7a: 정해진 시각의 중대 무전
    if (TMM.Support) TMM.Support.update(game, gdt, events); // M7b: 이웃 K2 중대(흑표) 지원
    transferLeader(game, events); // M7b: 소대장이 탄 전차가 격파되면 다른 전차로 옮겨 탄다
    for (const ev of events) {
      if (ev.type === 'shot') {
        game.lastShotAt = game.gameSeconds;
        if (ev.friendlyFire) game.ffCount += 1;
      }
    }

    if (!game.over) {
      if (game.op) {
        // M7a 캠페인: 작전마다 다른 승패 조건 (objectives.js)
        const r = TMM.Objective.check(game);
        if (r) game.over = Object.assign({ at: game.gameSeconds }, r);
      } else if (game.tutorial) {
        // M7.5 기초 훈련: 승패 없음 (tutorial.js 가 단계로 끝을 정한다)
      } else if (game.enemies.every((e) => e.destroyed || e.exited)) game.over = { win: true, at: game.gameSeconds, result: 'success' };
      else if (game.units.filter((u) => u.destroyed).length >= TMM.CONFIG.PLATOON_LOSS_FAIL) game.over = { win: false, at: game.gameSeconds, result: 'collapse' };
      if (game.over) {
        for (const u of game.units.concat(game.enemies)) u.fire.targetId = null;
        TMM.Crew.finish(game, events);
        events.push({ type: 'over', win: game.over.win });
      }
    }
    return events;
  }

  // M7b: 소대장이 탄 전차가 격파되면 소대장은 4호차(부소대장차, 없으면 남은 전차)로 옮겨 타서 지휘를 계속한다.
  // 기본 난이도에서 소대장은 죽지 않는다(경상까지). 조준 화면도 새 전차 기준(4호차면 포수 조현석 하사).
  function transferLeader(game, events) {
    const cur = game.units.find((u) => u.leaderAboard);
    if (!cur || !cur.destroyed) return;
    const alive = game.units.filter((u) => !u.destroyed);
    const next = alive.find((u) => u.id === 4) || alive[0];
    cur.leaderAboard = false;
    if (!next) return;
    next.leaderAboard = true;
    if (game.scope) {
      if (game.scope.open) TMM.Scope.close(game);
      game.scope.unitId = next.id;
      game.scope.turretAz = null;
      game.scope.laser = null;
    }
    events.push({ type: 'leader-transfer', from: cur, to: next });
    events.push({ type: 'radio', from: '소대장', text: cur.callsign + ' 탈출. 소대장은 ' + next.callsign + '로 옮겨 탄다. 지휘 계속.', kind: 'warn' });
  }

  // 교전 중인가? (보이는 적이 가까이 있거나 최근에 사격이 있었음) → 시간 감속
  // 안 보이는 적은 따지지 않는다 (교전 표시로 숨은 적을 알게 되면 안 되므로).
  function inCombat(game) {
    const C = TMM.CONFIG;
    if (game.lastShotAt != null && game.gameSeconds - game.lastShotAt < C.COMBAT_LINGER_SEC) return true;
    // M8a: 포격 경고·날아오는 미사일·보이는 자폭 드론이 있으면 시간을 느리게 (대처할 틈)
    if (TMM.Missiles.active(game) || TMM.Indirect.urgent(game)) return true;
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.visible || c.wreck || c.kind === 'friendly') continue;
      for (const u of game.units) {
        if (!u.destroyed && Math.hypot(c.lastX - u.x, c.lastY - u.y) * game.map.metersPerCell <= C.COMBAT_RANGE_M) return true;
      }
    }
    return false;
  }

  // M8a: 대처할 틈이 필요한 위협이 있는가 (경고가 뜬 미사일·포격 원 안의 전차·보이는 자폭 드론) → 화면 배속을 ×1 로
  function urgent(game) {
    if (game.missiles && game.missiles.some((m) => !m.done && m.warned && !m.lost)) return true;
    for (const s of TMM.Indirect.warnings(game)) {
      if (game.units.some((u) => !u.destroyed && Math.hypot(u.x - s.x, u.y - s.y) <= s.r + 1)) return true;
    }
    return !!game.indirect && game.indirect.drones.some((d) => !d.gone && d.kind === 'kami' && d.seen);
  }

  return { create, step, inCombat, urgent };
})();
