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
  function create(opts) {
    const light = (opts && opts.light) || 'day';
    const game = {
      map: (opts && opts.map) || TMM.MapGen.generate(),
      units: TMM.Platoon.create(),
      enemies: TMM.Enemy.create(),
      allies: TMM.Allies.create(),
      light,
      startSeconds: TMM.LIGHT[light].start,
      gameSeconds: TMM.LIGHT[light].start,
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
    return game;
  }

  // gdt: 이번 틱의 게임 시간(초). 작전 시계도 여기서 진행한다.
  function step(game, gdt) {
    const events = [];
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
    TMM.Crew.update(game, gdt, events);
    TMM.Orders.onEvents(game, events);
    TMM.Crew.onEvents(game, events);
    TMM.Radio.onEvents(game, events);
    for (const ev of events) {
      if (ev.type === 'shot') {
        game.lastShotAt = game.gameSeconds;
        if (ev.friendlyFire) game.ffCount += 1;
      }
    }

    if (!game.over) {
      if (game.enemies.every((e) => e.destroyed || e.exited)) game.over = { win: true, at: game.gameSeconds };
      else if (game.units.filter((u) => u.destroyed).length >= TMM.CONFIG.PLATOON_LOSS_FAIL) game.over = { win: false, at: game.gameSeconds };
      if (game.over) {
        for (const u of game.units.concat(game.enemies)) u.fire.targetId = null;
        TMM.Crew.finish(game, events);
        events.push({ type: 'over', win: game.over.win });
      }
    }
    return events;
  }

  // 교전 중인가? (보이는 적이 가까이 있거나 최근에 사격이 있었음) → 시간 감속
  // 안 보이는 적은 따지지 않는다 (교전 표시로 숨은 적을 알게 되면 안 되므로).
  function inCombat(game) {
    const C = TMM.CONFIG;
    if (game.lastShotAt != null && game.gameSeconds - game.lastShotAt < C.COMBAT_LINGER_SEC) return true;
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.visible || c.wreck || c.kind === 'friendly') continue;
      for (const u of game.units) {
        if (!u.destroyed && Math.hypot(c.lastX - u.x, c.lastY - u.y) * game.map.metersPerCell <= C.COMBAT_RANGE_M) return true;
      }
    }
    return false;
  }

  return { create, step, inCombat };
})();
