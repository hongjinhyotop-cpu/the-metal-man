/*
 * 전투 한 틱 진행: 이동 → 아군(비지휘) 행동 → 시야·식별 → 적 AI → 사격 → 승패 판정.
 * main.js 의 주 루프와 시험용 모의 전투가 같은 코드를 쓴다.
 * 반환: 이번 틱에 일어난 사건 배열 (무전 기록·화면 효과용)
 *
 * 승패 (M3):
 *   승리 — 적 소대가 모두 격파되었거나, 전투력을 잃고 지도 북쪽 끝 밖으로 퇴각함 (끝까지 쫓지 않아도 됨)
 *   패배 — 아군 소대 전차 4대가 모두 격파됨
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
    return game;
  }

  // gdt: 이번 틱의 게임 시간(초). 작전 시계도 여기서 진행한다.
  function step(game, gdt) {
    const events = [];
    game.gameSeconds += gdt;
    for (const u of game.units) {
      if (TMM.Movement.update(game.map, u, gdt)) events.push({ type: 'arrive', unit: u });
    }
    for (const e of game.enemies) if (!e.exited) TMM.Movement.update(game.map, e, gdt);
    for (const a of game.allies) if (!a.exited && !a.destroyed) TMM.Movement.update(game.map, a, gdt);
    TMM.Allies.update(game, gdt, events);
    TMM.Intel.update(game, gdt, events);
    TMM.EnemyAI.update(game, gdt, events);
    TMM.Gunnery.update(game, gdt, events);
    for (const ev of events) {
      if (ev.type === 'shot') {
        game.lastShotAt = game.gameSeconds;
        if (ev.friendlyFire) game.ffCount += 1;
      }
    }

    if (!game.over) {
      if (game.enemies.every((e) => e.destroyed || e.exited)) game.over = { win: true, at: game.gameSeconds };
      else if (game.units.every((u) => u.destroyed)) game.over = { win: false, at: game.gameSeconds };
      if (game.over) {
        for (const u of game.units.concat(game.enemies)) u.fire.targetId = null;
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
