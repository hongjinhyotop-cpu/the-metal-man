/*
 * 지휘 명령의 입구 (M4). 화면(main.js 의 actions)과 모의 전투가 같은 함수를 쓴다.
 *
 * 받는 대상(spec): '1'~'4' 한 대 / 'T1' 1조(1·2호차) / 'T2' 2조(3·4호차) / 'ALL' 소대 전체
 *   - 지휘 전차(1호차, 격파되면 4호차)는 차내 통화로 바로 실행한다.
 *   - 나머지 전차에게는 무전(TMM.Radio.sendOrder)으로 보낸다 → 지연·잡음·오청·두절을 거친다.
 *   - 엄호 이동은 언제나 소대 전체가 참가한다. 받는 대상은 '먼저 나갈 조'를 정한다
 *     (2조나 3·4호차를 골랐으면 2조 먼저, 그 밖에는 1조 먼저).
 *
 * 반환: { ok, lines: [{ from, text, kind }] } — 바로 무전 기록에 찍을 차내 통화
 */
TMM.Command = (function () {
  const R = () => TMM.RADIO;

  function recipients(game, spec) {
    let list;
    if (spec === 'ALL') list = game.units;
    else if (spec === 'T1') list = game.units.filter((u) => u.team === 1);
    else if (spec === 'T2') list = game.units.filter((u) => u.team === 2);
    else list = game.units.filter((u) => String(u.id) === String(spec));
    return list.filter((u) => !u.destroyed);
  }

  function specName(game, spec) {
    if (spec === 'ALL') return '소대 전체';
    if (spec === 'T1') return '1조';
    if (spec === 'T2') return '2조';
    return spec + '호차';
  }

  function toName(spec, units) {
    if (spec === 'ALL') return R().NET;
    if ((spec === 'T1' || spec === 'T2') && units.length > 1) return R().TEAM_CALL[spec === 'T1' ? 1 : 2];
    return units.length === 1 ? R().call(units[0]) : R().NET;
  }

  function issue(game, spec, order, ctx) {
    const lines = [];
    const line = (from, text, kind) => lines.push({ from, text, kind });
    if (game.over) return { ok: false, lines };
    let units = recipients(game, spec);
    if (!units.length) {
      line('체계', specName(game, spec) + ' — 명령을 받을 수 있는 전차가 없습니다.', 'warn');
      return { ok: false, lines };
    }
    ctx = Object.assign({}, ctx);
    const ctrl = TMM.Radio.controlUnit(game);
    const o = Object.assign({}, order);
    let to = toName(spec, units);

    if (o.type === 'target' && o.targetId != null && !ctx.targetName) {
      const c = TMM.Intel.contact(game, 'friend', o.targetId);
      ctx.targetName = c ? TMM.Intel.displayName(c) : '표적';
    }
    if (o.type === 'bound') {
      units = game.units.filter((u) => !u.destroyed && !u.damage.track);
      if (!units.length) {
        line('체계', '엄호 이동 — 움직일 수 있는 전차가 없습니다.', 'warn');
        return { ok: false, lines };
      }
      let first = spec === 'T2' ? 2 : spec === 'T1' || spec === 'ALL' ? 1 : (game.units.find((u) => String(u.id) === String(spec)) || { team: 1 }).team;
      if (!units.some((u) => u.team === first)) first = first === 1 ? 2 : 1;
      const b = TMM.Orders.startBound(game, o.x, o.y, first, units.map((u) => u.id));
      o.boundId = b.id;
      o.firstTeam = first;
      to = R().NET;
    }
    if (o.type === 'move' || o.type === 'withdraw' || o.type === 'cover') {
      o.cx = units.reduce((s, u) => s + u.x, 0) / units.length;
      o.cy = units.reduce((s, u) => s + u.y, 0) / units.length;
      o.count = units.length;
      o.slots = {};
      // 목적지 쪽으로 볼 때 왼쪽부터 차례로 세운다
      const dir = Math.atan2(o.y - o.cy, o.x - o.cx);
      const side = (u) => -Math.sin(dir) * (u.x - o.cx) + Math.cos(dir) * (u.y - o.cy);
      units.slice().sort((a, b) => side(a) - side(b)).forEach((u, i) => { o.slots[u.id] = i; });
    }

    const radio = units.filter((u) => u !== ctrl);
    const direct = units.find((u) => u === ctrl);
    if (radio.length) TMM.Radio.sendOrder(game, radio, o, Object.assign({}, ctx, { toName: to }));

    if (direct) {
      TMM.Radio.clearPending(game, direct, o);
      const name = direct.id + '호차';
      const alone = !radio.length;
      if (alone) line('소대장', name + ', ' + TMM.Orders.phrase(game, o, ctx) + '.', 'order');
      if (o.type === 'report') {
        const evs = [];
        TMM.Radio.statusReport(game, direct, evs);
        for (const e of evs) line(e.from, e.text, e.kind);
      } else {
        const r = TMM.Orders.execute(game, direct, o);
        const who = alone ? name : name + ' (차내)';
        if (!r.ok) line(who, '불가 — ' + r.reason + '.', 'warn');
        else if ((o.type === 'move' || o.type === 'withdraw') && r.res) {
          line(who, '수신. ' + (o.type === 'withdraw' ? '후진 철수' : '이동') + ' 개시. 거리 ' + (r.res.meters / 1000).toFixed(1) + 'km, ' + TMM.Clock.duration(r.res.eta) + ' 소요 예상.', 'report');
        } else if (alone) line(who, '수신. ' + TMM.Orders.readback(game, direct, o, ctx) + '.', 'report');
      }
    }
    return { ok: true, lines };
  }

  return { issue, recipients, specName };
})();
