/*
 * 전투 한 틱 진행: 이동 → 적 AI → 사격 → 승패 판정.
 * main.js 의 주 루프와 시험용 모의 전투가 같은 코드를 쓴다.
 * 반환: 이번 틱에 일어난 사건 배열 (무전 기록·화면 효과용)
 */
TMM.Battle = (function () {
  function step(game, gdt) {
    const events = [];
    for (const u of game.units) {
      if (TMM.Movement.update(game.map, u, gdt)) events.push({ type: 'arrive', unit: u });
    }
    for (const e of game.enemies) TMM.Movement.update(game.map, e, gdt);
    TMM.EnemyAI.update(game, gdt, events);
    TMM.Gunnery.update(game, gdt, events);
    for (const ev of events) if (ev.type === 'shot') game.lastShotAt = game.gameSeconds;

    if (!game.over) {
      if (game.enemies.every((e) => e.destroyed)) game.over = { win: true, at: game.gameSeconds };
      else if (game.units.every((u) => u.destroyed)) game.over = { win: false, at: game.gameSeconds };
      if (game.over) {
        for (const u of game.units.concat(game.enemies)) u.fire.targetId = null;
        events.push({ type: 'over', win: game.over.win });
      }
    }
    return events;
  }

  // 교전 중인가? (적이 가까이 있거나 최근에 사격이 있었음) → 시간 감속
  function inCombat(game) {
    const C = TMM.CONFIG;
    if (game.lastShotAt != null && game.gameSeconds - game.lastShotAt < C.COMBAT_LINGER_SEC) return true;
    for (const e of game.enemies) {
      if (e.destroyed) continue;
      for (const u of game.units) {
        if (!u.destroyed && TMM.Ballistics.distanceM(game.map, e, u) <= C.COMBAT_RANGE_M) return true;
      }
    }
    return false;
  }

  return { step, inCombat };
})();
