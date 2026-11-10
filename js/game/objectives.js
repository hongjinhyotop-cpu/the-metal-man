/*
 * M7a 작전 목표: 캠페인 작전마다 다른 승패 조건과 정해진 시각의 중대 무전.
 * DOM 없이 돌아간다 (모의 전투에서도 씀). game.op 이 없으면(훈련 모드) 쓰지 않는다.
 *
 * game.op.objective = { type, timeLimit(게임 초), zone, ... }
 *   defend  진지 방어: 적이 모두 격파·퇴각하면 성공, 제한 시간까지 버텨도 성공. 적이 zone(주둔지)에 들어오면 실패.
 *   delay   지연전: 제한 시간까지 적을 zone(주둔지) 밖에 묶어 두면 성공 (적이 무너져도 성공). 그 전에 들어오면 실패.
 *           끝날 때 cutY(2차 저지선) 북쪽에 남은 전차는 고립 → 전차 유기(격파와 같음, 승무원은 경상으로 탈출).
 *   bridge  교량 사수: 제한 시간까지 적이 하천 동쪽으로 건너오지 못하면 성공. 건너오면 실패.
 *   attack  공격: 제한 시간 안에 적을 모두 격파·퇴각시키면 성공. 시간이 다 되면 실패(공격 돈좌).
 * 어느 작전이든 살아남은 소대 전차가 2대 미만이 되면 '소대 붕괴' — 캠페인이 바로 끝난다.
 *
 * game.over = { win, at, result('success'|'fail'|'collapse'), reason }
 */
TMM.Objective = (function () {
  const COLLAPSE_BELOW = 2; // 살아남은 전차가 이 수보다 적으면 소대 붕괴

  const elapsed = (game) => game.gameSeconds - game.startSeconds;
  const alive = (game) => game.units.filter((u) => !u.destroyed).length;
  // 아직 싸우러 오는 적 (격파·이탈·퇴각·후퇴 중이 아님)
  const pushing = (e) => !e.destroyed && !e.exited && e.ai.mode !== 'withdraw' && e.ai.mode !== 'retreat';
  const inZone = (z, e) => e.x >= z.x0 && e.x <= z.x1 && e.y >= z.y0 && e.y <= z.y1;
  // 하천 서쪽에서 온 적이 덕천을 건넜나 (북쪽 조처럼 처음부터 동쪽에 있는 적은 따지지 않는다)
  const crossed = (e) => e.ai.tag !== 'north' && e.x > TMM.Geo.riverX(e.y) + 4;

  function check(game) {
    const op = game.op, ob = op.objective;
    const t = elapsed(game);
    if (alive(game) < COLLAPSE_BELOW) return { win: false, result: 'collapse', reason: '살아남은 전차가 ' + alive(game) + '대 — 소대가 전투력을 잃었습니다.' };
    const gone = game.enemies.every((e) => e.destroyed || (e.exited && !e.ai.pending)); // 아직 안 온 제대가 있으면 끝나지 않음
    if (ob.type === 'attack') {
      if (gone) return { win: true, result: 'success', reason: ob.winText || '목표 지역의 적을 모두 몰아냈습니다.' };
      if (t >= ob.timeLimit) return { win: false, result: 'fail', reason: ob.timeText || '제한 시간 안에 목표를 확보하지 못했습니다 — 공격 돈좌.' };
      return null;
    }
    // 방어형 (defend · delay · bridge)
    const breach = ob.type === 'bridge' ? game.enemies.find((e) => pushing(e) && crossed(e)) : game.enemies.find((e) => pushing(e) && ob.zone && inZone(ob.zone, e));
    if (breach) return { win: false, result: 'fail', reason: ob.breachText || '적이 방어선을 뚫었습니다.' };
    if (gone) return { win: true, result: 'success', reason: ob.goneText || '적이 전투력을 잃고 물러났습니다.' };
    if (t >= ob.timeLimit) {
      // 지연전: 끝날 때 차단선(ob.cutY) 북쪽에 남은 전차는 적 사이에 고립 → 승무원만 빠져나오고 전차는 유기
      const cut = ob.cutY != null ? cutOff(game, ob.cutY) : [];
      const note = cut.length ? ' 단, 물러나지 못한 ' + cut.map((u) => u.callsign).join('·') + '는 고립되어 전차를 버리고 승무원만 빠져나왔습니다.' : '';
      if (alive(game) < COLLAPSE_BELOW) return { win: false, result: 'collapse', reason: '고립된 전차를 버리고 나니 살아남은 전차가 ' + alive(game) + '대 — 소대가 전투력을 잃었습니다.', cut: cut.length };
      return { win: true, result: 'success', reason: (ob.holdText || '정해진 시간까지 버텼습니다.') + note, cut: cut.length };
    }
    return null;
  }

  // 고립 전차 유기: 전차는 잃고(격파와 같음), 승무원은 모두 경상 이상으로 빠져나온다
  function cutOff(game, cutY) {
    const out = [];
    for (const u of game.units) {
      if (u.destroyed || u.y >= cutY) continue;
      u.destroyed = true;
      u.abandoned = true;
      TMM.Movement.stop(u);
      if (u.crew) for (const m of u.crew.members) m.injury = Math.max(m.injury, 1);
      out.push(u);
    }
    return out;
  }

  // 정해진 시각의 중대 무전 (op.calls: [{ at: 개시 후 게임 초, text }])
  function update(game, events) {
    const calls = game.op.calls;
    if (!calls) return;
    game.opCallsDone = game.opCallsDone || 0;
    const t = elapsed(game);
    while (game.opCallsDone < calls.length && calls[game.opCallsDone].at <= t) {
      const c = calls[game.opCallsDone++];
      events.push({ type: 'radio', from: c.from || TMM.RADIO.COMPANY, text: c.text, kind: c.kind || 'system' });
    }
  }

  // 화면 위 목표 띠: { title, goal, time, timeLabel }
  function status(game) {
    const op = game.op, ob = op.objective;
    const left = Math.max(0, ob.timeLimit - elapsed(game));
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    // M8a: 남은 적은 전차만 센다 (숨은 보병 대전차조의 수는 알려 주지 않는다)
    const tanks = game.enemies.filter((e) => TMM.VEHICLES[e.model].cls === 'tank');
    const enemyLeft = tanks.filter((e) => !e.destroyed && (!e.exited || e.ai.pending)).length;
    return {
      title: '작전 ' + op.no + ' · ' + op.name,
      goal: ob.short,
      time: String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'),
      timeLabel: ob.type === 'attack' ? '공격 제한' : '버틸 시간',
      enemy: '적 전차 ' + enemyLeft + '/' + tanks.length,
    };
  }

  return { check, update, status, COLLAPSE_BELOW };
})();
