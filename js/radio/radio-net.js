/*
 * 소대 무전망 (M4 무전 지휘). DOM 없이 돌아가므로 모의 전투에서도 같은 규칙이 적용된다.
 *
 *   - 무전망은 한 채널: 한 번에 한 사람만 말한다. 말하는 데 시간이 걸리고(TX), 붐비면 뒤 교신은 기다린다.
 *     중요한 것(명령·피격·격파)이 먼저, 오래 밀린 일상 보고는 버린다.
 *   - 명령: 소대장(1호차)이 말함 → 받는 전차가 '수신' 복창 → 잠시 뒤 실행.
 *       · 무전기가 손상된 전차(또는 소대장차 무전기 손상)는 듣지 못한다 → '응답 없음' (250m 안이면 수기·육성으로 전달)
 *       · 멀거나 능선 너머면 잡음 → '다시 보내라' → 자동으로 다시 보냄 (최대 MAX_RETRY 번)
 *       · 낮은 확률로 잘못 알아들음 → 복창이 다르고 엉뚱하게 실행 (소대장이 복창을 듣고 알아챈다)
 *   - 보고: 전차가 스스로 적 발견·식별·피격·손상·탄약 부족·격파·도착을 보고한다. 약간 늦게 올라오고,
 *     잡음이 끼면 일부만 들린다. 무전기가 손상된 전차는 보고하지 못한다.
 *   - 1호차(지휘 전차) 자신의 일은 차내 통화라 바로 들린다.
 *
 * 사건: { type: 'radio', from, text, kind } — main.js 가 무전 기록에 그대로 찍는다.
 * game.radio = { queue, timers, busyUntil, pending: Map('전차id:종류' → { unitId, order, state, at }), batch, control }
 *   종류: 'act'(이동·엄호·엄호 이동·철수·정지) | 'roe' | 'target' | 'report' — 종류가 다르면 동시에 전달 중일 수 있고,
 *   같은 종류의 새 명령은 앞 명령을 대신한다.
 */
TMM.Radio = (function () {
  const R = () => TMM.RADIO;
  const I = () => TMM.Intel;
  const O = () => TMM.Orders;

  function init(game) {
    game.radio = { queue: [], timers: [], busyUntil: -1e9, seq: 0, pending: new Map(), batch: new Map(), control: 1, ridge: new Map() };
    for (const u of game.units) {
      u.ammoWarned = 0;
      u.lastMissLog = -1e9;
      u.lastUnidLog = -1e9;
    }
  }

  // 지휘 전차: 1호차. 격파되면 부소대장차(4호차)가 지휘를 넘겨받는다.
  function controlUnit(game) {
    const alive = game.units.filter((u) => !u.destroyed);
    return alive.find((u) => u.id === 1) || alive.find((u) => u.id === 4) || alive[0] || null;
  }

  const call = (u) => R().call(u);
  const cat = (o) => (o.type === 'roe' || o.type === 'target' || o.type === 'report' ? o.type : 'act');
  const pkey = (u, o) => u.id + ':' + cat(o);
  // 전차 하나에 전달 중인 명령들
  function pendingFor(game, id) {
    const out = [];
    for (const p of game.radio.pending.values()) if (p.unitId === id) out.push(p);
    return out;
  }
  function clearPending(game, u, o) {
    game.radio.pending.delete(pkey(u, o));
  }
  const between = (game, r) => r[0] + game.rand() * (r[1] - r[0]);
  const intercom = (u) => u.id + '호차 (차내)';

  // 두 지점 사이를 능선이 가리는가 (안테나 높이 직선, 숲·건물은 전파를 막지 않는다고 본다)
  function ridgeBetween(game, a, b) {
    const key = Math.round(a.x) + ',' + Math.round(a.y) + ':' + Math.round(b.x) + ',' + Math.round(b.y);
    const cache = game.radio.ridge;
    if (cache.has(key)) return cache.get(key);
    const map = game.map, H = R().ANTENNA_H, S = TMM.Sight;
    const ha = S.groundAt(map, a.x, a.y) + H, hb = S.groundAt(map, b.x, b.y) + H;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / 0.5);
    let blocked = false;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (S.groundAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) > ha + (hb - ha) * t) { blocked = true; break; }
    }
    if (cache.size > 5000) cache.clear();
    cache.set(key, blocked);
    return blocked;
  }

  // 교신 상태: { ok, self?, hand?, garbleP, ridge?, d, why? }
  function link(game, a, b) {
    if (!a || !b || a.destroyed || b.destroyed) return { ok: false, why: 'lost', garbleP: 1 };
    if (a === b) return { ok: true, self: true, garbleP: 0, d: 0 };
    const d = TMM.Ballistics.distanceM(game.map, a, b);
    if (a.damage.radio || b.damage.radio) {
      if (d <= R().HAND_SIGNAL_M) return { ok: true, hand: true, garbleP: 0, d };
      return { ok: false, why: 'radio', garbleP: 1, d };
    }
    const ridge = ridgeBetween(game, a, b);
    const far = Math.min(1, Math.max(0, (d - R().CLEAR_M) / (R().FAR_M - R().CLEAR_M))) * R().FAR_GARBLE;
    return { ok: true, garbleP: Math.min(0.9, far + (ridge ? R().RIDGE_GARBLE : 0)), ridge, d };
  }

  // 패널·지도 표시용 교신 상태
  function linkState(game, u) {
    const ctrl = controlUnit(game);
    if (u.destroyed) return { code: 'lost', text: '격파됨' };
    if (u === ctrl) return { code: 'self', text: '지휘 전차' + (u.damage.radio ? ' · 무전기 손상 (250m 안만 전달)' : '') };
    const l = link(game, ctrl, u);
    if (!l.ok) return { code: 'dead', text: u.damage.radio ? '교신 두절 · 무전기 손상' : '교신 두절 · 지휘 전차 무전기 손상' };
    if (l.hand) return { code: 'hand', text: '무전기 손상 · 가까워서 수기·육성으로 전달' };
    if (l.garbleP >= 0.3) return { code: 'noisy', text: '잡음 심함' + (l.ridge ? ' · 능선 너머' : '') + ' · ' + Math.round(l.garbleP * 100) + '%' };
    if (l.garbleP > 0) return { code: 'noisy', text: '약간 잡음' + (l.ridge ? ' · 능선 너머' : '') + ' · ' + Math.round(l.garbleP * 100) + '%' };
    return { code: 'good', text: '양호' };
  }

  function emit(events, from, text, kind) {
    events.push({ type: 'radio', from, text, kind: kind || 'report' });
  }

  function push(game, msg) {
    msg.id = ++game.radio.seq;
    msg.created = game.gameSeconds;
    if (msg.readyAt == null) msg.readyAt = game.gameSeconds;
    game.radio.queue.push(msg);
    return msg;
  }

  function later(game, sec, fn) {
    game.radio.timers.push({ at: game.gameSeconds + sec, fn });
  }

  // 잡음: 앞의 호출부호는 남기고 본문 낱말 일부를 '…' 로
  function garble(game, text) {
    const w = text.split(' ');
    const head = Math.min(5, w.length - 1);
    let any = false;
    for (let i = head; i < w.length - 1; i++) {
      if (game.rand() < 0.45) { w[i] = '…'; any = true; }
    }
    if (!any && w.length > head + 1) w[head] = '…';
    return w.join(' ').replace(/(… )+…/g, '…') + ' (잡음)';
  }

  // ---- 무전망 진행 ----
  function update(game, dt, events) {
    const net = game.radio;
    const now = game.gameSeconds;

    const ctrl = controlUnit(game);
    if (ctrl && ctrl.id !== net.control) {
      net.control = ctrl.id;
      emit(events, call(ctrl), R().NET + ', 여기 ' + call(ctrl) + '. 강철 1 피격. 지금부터 본 차가 소대를 지휘한다. 이상.', 'warn');
    }

    if (net.timers.length) {
      const due = net.timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
      if (due.length) {
        net.timers = net.timers.filter((t) => t.at > now);
        for (const t of due) t.fn(events);
      }
    }
    flushBatches(game, events);

    while (now >= net.busyUntil) {
      let best = null;
      for (const m of net.queue) {
        if (m.readyAt > now) continue;
        if (!best || m.prio > best.prio || (m.prio === best.prio && m.readyAt < best.readyAt)) best = m;
      }
      if (!best) break;
      net.queue.splice(net.queue.indexOf(best), 1);
      if (best.prio <= 1 && now - best.readyAt > R().STALE_SEC) continue; // 너무 밀린 일상 보고
      if (best.check && !best.check()) { if (best.onDrop) best.onDrop(events); continue; }
      let text = best.text, kind = best.kind;
      if (best.fromUnit) {
        // 보고는 말하는 전차 → 지휘 전차 사이의 교신 상태를 탄다
        const l = link(game, best.fromUnit, controlUnit(game));
        if (!l.ok) { if (best.onDrop) best.onDrop(events); continue; }
        if (!best.noGarble && game.rand() < l.garbleP) { text = garble(game, text); kind = 'garble'; }
      }
      if (best.onStart) best.onStart();
      emit(events, best.fromName, text, kind);
      const tx = R().TX_BASE_SEC + text.length * R().TX_PER_CHAR_SEC;
      net.busyUntil = now + tx + R().GAP_SEC;
      if (best.onDone) later(game, tx, best.onDone);
    }
  }

  // ---- 명령 ----
  // units: 무전으로 받을 전차들 (지휘 전차 제외), order: Orders 의 명령, ctx: { toName, targetName, attempt }
  function sendOrder(game, units, order, ctx) {
    const ctrl = controlUnit(game);
    if (!ctrl || !units.length) return;
    ctx = ctx || {};
    const attempt = ctx.attempt || 0;
    const toName = ctx.toName || (units.length === 1 ? call(units[0]) : R().NET);
    const text = toName + ', 여기 ' + call(ctrl) + '. ' + (attempt ? '반복한다. ' : '') + O().phrase(game, order, ctx) + '. 이상.';
    const net = game.radio;
    for (const u of units) net.pending.set(pkey(u, order), { unitId: u.id, order, state: 'queued', at: game.gameSeconds, ctx });
    if (TMM.Crew && !attempt) for (const u of units) TMM.Crew.noteOrder(game, u, order, ctx.events || null); // M5: 명령 번복 → 신뢰도
    push(game, {
      fromName: call(ctrl),
      text,
      kind: 'order',
      prio: 3,
      onStart: () => { for (const u of units) { const p = net.pending.get(pkey(u, order)); if (p && p.order === order) p.state = 'tx'; } },
      onDone: (events) => delivered(game, units, order, ctx, attempt, events),
    });
  }

  function fail(game, u, order) {
    const p = game.radio.pending.get(pkey(u, order));
    if (p && p.order === order) game.radio.pending.delete(pkey(u, order));
    if (order.type === 'bound') O().leaveBound(game, u);
  }

  function delivered(game, units, order, ctx, attempt, events) {
    const ctrl = controlUnit(game);
    const net = game.radio;
    for (const u of units) {
      const p = net.pending.get(pkey(u, order));
      if (!p || p.order !== order) continue; // 그 사이 같은 종류의 새 명령을 받음
      if (u.destroyed || !ctrl) { fail(game, u, order); continue; }
      const l = link(game, ctrl, u);
      if (!l.ok) {
        p.state = 'noack';
        later(game, R().NO_ACK_SEC, (ev) => {
          const q = net.pending.get(pkey(u, order));
          if (!q || q.order !== order) return;
          emit(ev, call(ctrl), call(u) + ', ' + call(u) + '. 응답하라… 응답 없음.', 'warn');
          fail(game, u, order);
        });
        continue;
      }
      if (game.rand() < l.garbleP) {
        // 잡음으로 일부만 들림 → 다시 보내 달라고 한다
        p.state = 'garble';
        push(game, {
          fromName: call(u),
          text: call(ctrl) + ', 여기 ' + call(u) + '. 잡음, 일부만 수신. 다시 보내라. 이상.',
          kind: 'garble',
          prio: 3,
          readyAt: game.gameSeconds + between(game, R().ACK_DELAY_SEC),
          check: () => !u.destroyed,
          onDone: (ev) => {
            const q = net.pending.get(pkey(u, order));
            if (!q || q.order !== order) return;
            if (attempt + 1 >= R().MAX_RETRY) {
              emit(ev, call(ctrl), call(u) + ', 교신 불가. 송신 중지.', 'warn');
              fail(game, u, order);
            } else {
              sendOrder(game, [u], order, Object.assign({}, ctx, { toName: call(u), attempt: attempt + 1 }));
            }
          },
        });
        continue;
      }
      if (order.type === 'report') {
        net.pending.delete(pkey(u, order));
        statusReport(game, u, events);
        continue;
      }
      const heard = mishear(game, u, order, ctx);
      // M5: 장만석 상사는 신뢰가 낮으면 이동 위치를 근처 더 나은 엄폐물로 '해석'한다
      const interp = TMM.Crew ? TMM.Crew.interpret(game, u, heard.order) : null;
      if (interp) heard.order = interp.order;
      const why = O().check(game, u, heard.order);
      const rb = O().readback(game, u, heard.order, heard.ctx);
      const body = why ? '수신. 그러나 ' + why + '.' : TMM.Crew ? TMM.Crew.ackBody(game, u, rb, heard.order, interp) : '수신. ' + rb + '.';
      // M5: 되묻기(최민수 중사)·머뭇거림(낮은 신뢰)·차내 갈등(3호차) → 응답이 늦어진다
      const pre = TMM.Crew ? TMM.Crew.beforeAck(game, u, heard.order, heard.ctx) : { delay: 0, ask: null, mic: [] };
      const ackAt = game.gameSeconds + between(game, R().ACK_DELAY_SEC) * R().crewFactor(u, 'ack');
      if (pre.ask) {
        push(game, {
          fromName: call(u), fromUnit: u, noGarble: true,
          text: call(ctrl) + ', 여기 ' + call(u) + '. ' + pre.ask + ' 이상.',
          kind: 'report', prio: 3, readyAt: ackAt, check: () => !u.destroyed,
        });
      }
      p.state = 'ack';
      push(game, {
        fromName: call(u),
        text: call(u) + ', ' + body,
        kind: why ? 'warn' : 'report',
        prio: 3,
        readyAt: ackAt + pre.delay,
        check: () => !u.destroyed,
        onDrop: () => fail(game, u, order),
        onDone: (ev) => {
          const q = net.pending.get(pkey(u, order));
          if (!q || q.order !== order) return;
          for (const [key, text] of pre.mic) {
            const m = u.crew && u.crew.members.find((x) => x.key === key);
            if (m) emit(ev, u.id + '호차 ' + m.name + ' ' + m.rank, text, 'crew');
          }
          if (heard.wrong) emit(ev, '복창 확인', '⚠ ' + call(u) + ' 복창이 지시와 다름 — 잘못 알아들었다. 다시 지시할 것.', 'warn');
          q.state = 'exec';
          later(game, R().EXEC_DELAY_SEC, (ev2) => {
            const q2 = net.pending.get(pkey(u, order));
            if (!q2 || q2.order !== order) return;
            net.pending.delete(pkey(u, order));
            if (why) { if (order.type === 'bound') O().leaveBound(game, u); return; }
            const r = O().execute(game, u, heard.order);
            if (!r.ok) emit(ev2, call(u), call(ctrl) + ', 여기 ' + call(u) + '. ' + r.reason + '. 이상.', 'warn');
            else if (TMM.Crew) TMM.Crew.onExecuted(game, u, heard.order);
          });
        },
      });
    }
  }

  // 잘못 알아들음 (낮은 확률). 반환: { order, ctx, wrong }
  function mishear(game, u, order, ctx) {
    const same = { order, ctx, wrong: false };
    if (game.rand() >= R().MISHEAR_P * R().crewFactor(u, 'mishear')) return same;
    const o = Object.assign({}, order);
    const rnd = game.rand;
    if (o.type === 'move' || o.type === 'withdraw') {
      const [a, b] = R().MISHEAR_OFFSET_CELLS;
      for (let i = 0; i < 12; i++) {
        const ang = rnd() * Math.PI * 2, r = a + rnd() * (b - a);
        const x = o.x + Math.cos(ang) * r, y = o.y + Math.sin(ang) * r;
        const info = game.map.infoAt(x, y);
        if (info && info.speed) {
          o.x = x; o.y = y; o.count = 1; o.slots = null;
          return { order: o, ctx, wrong: true };
        }
      }
      return same;
    }
    if (o.type === 'cover') {
      o.angle = O().angleFor(u, order) + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.6 ? Math.PI / 4 : Math.PI / 2);
      return { order: o, ctx, wrong: true };
    }
    if (o.type === 'roe') {
      const list = R().ROE_ORDER;
      const i = list.indexOf(o.roe);
      o.roe = list[i === 1 ? (rnd() < 0.5 ? 0 : 2) : 1];
      return { order: o, ctx, wrong: true };
    }
    if (o.type === 'target' && o.targetId != null) {
      const others = Array.from(game.intel.friend.contacts.values()).filter((c) => c.known && !c.wreck && c.kind !== 'friendly' && c.id !== o.targetId);
      if (!others.length) return same;
      const c = others[Math.floor(rnd() * others.length)];
      o.targetId = c.id;
      return { order: o, ctx: Object.assign({}, ctx, { targetName: I().displayName(c) }), wrong: true };
    }
    return same;
  }

  // ---- 보고 ----
  // u 가 지휘 전차에게 보고. 지휘 전차 자신이면 차내 통화로 바로 들린다.
  function report(game, u, body, opts, events) {
    opts = opts || {};
    const ctrl = controlUnit(game);
    if (!ctrl) return;
    if (u === ctrl) {
      if (opts.onDone) later(game, 0.5, opts.onDone);
      emit(events, intercom(u), body, opts.kind);
      return;
    }
    const toName = opts.toName || call(ctrl);
    const delay = opts.delay != null ? opts.delay : between(game, R().REPORT_DELAY_SEC) * R().crewFactor(u, 'report');
    push(game, {
      fromName: call(u),
      fromUnit: u,
      text: toName + ', 여기 ' + call(u) + '. ' + body + ' 이상.',
      kind: opts.kind || 'report',
      prio: opts.prio != null ? opts.prio : 1,
      readyAt: game.gameSeconds + delay,
      noGarble: !!opts.noGarble,
      check: opts.allowDead ? null : () => !u.destroyed,
      onDone: opts.onDone,
      onDrop: opts.onDone ? () => later(game, R().NO_ACK_SEC, opts.onDone) : null,
    });
  }

  // 엄호 이동: 한 조가 자리를 잡으면 다른 조에게 알린다 (이 보고가 전달되면 다음 조가 움직인다)
  function boundReport(game, leader, b, finished, onDone) {
    const team = leader.team, other = team === 1 ? 2 : 1;
    const ctrl = controlUnit(game);
    const evs = [];
    if (finished) {
      report(game, leader, '목표 지점 도착. 엄호 이동 완료, 진행 방향 엄호 중.', { prio: 2, onDone }, evs);
    } else if (leader === ctrl) {
      // 지휘 전차가 직접 다른 조에게 지시
      push(game, {
        fromName: call(leader),
        text: R().TEAM_CALL[other] + ', 여기 ' + call(leader) + '. ' + team + '조 엄호 위치. ' + other + '조 전진하라. 이상.',
        kind: 'order',
        prio: 2,
        onDone,
      });
    } else {
      report(game, leader, team + '조 엄호 위치 도착. ' + other + '조 전진하라.', { prio: 2, toName: R().NET, onDone }, evs);
    }
    if (evs.length) game.radio.timers.push({ at: game.gameSeconds, fn: (ev) => ev.push(...evs) });
  }

  // 상황 보고: 탄약, 손상, 보이는 적, 지금 하는 일
  function statusReport(game, u, events) {
    const ammo = TMM.VEHICLES[u.model].ammoTypes.map((k) => TMM.AMMO[k].short.slice(0, 2) + ' ' + u.ammo[k]).join('·');
    const dmg = TMM.Damage.damagedParts(u);
    const seen = [];
    const m = game.vis.get(u.id);
    if (m) {
      for (const id of m.keys()) {
        const c = I().contact(game, 'friend', id);
        if (c && !c.wreck && c.kind !== 'friendly') seen.push(I().displayName(c));
      }
    }
    const body = '탄약 ' + TMM.Damage.totalAmmo(u) + '발 (' + ammo + '), ' +
      (dmg.length ? dmg.map((k) => TMM.PARTS[k].name).join('·') + ' 손상' : '손상 없음') + ', ' +
      (seen.length ? '보이는 적 ' + seen.length + ' (' + seen.join(', ') + ')' : '보이는 적 없음') + '. ' +
      O().describe(game, u) + '.';
    report(game, u, body, { prio: 2, delay: between(game, R().ACK_DELAY_SEC) }, events);
  }

  function requestReport(game, units, events) {
    // 지휘 전차 자신의 상황은 바로 보인다
    for (const u of units) statusReport(game, u, events);
  }

  // ---- 전투 사건 → 자동 보고 ----
  const ASP = () => TMM.Ballistics.ASPECT_NAMES;
  const PART_LINES = {
    track: '궤도 손상, 기동 불가', engine: '엔진 손상, 속도 저하', gun: '주포 손상, 사격 불가',
    fcs: '사격통제장치 손상, 명중률 저하', radio: '무전기 손상',
  };
  const km = (m) => (m / 1000).toFixed(1) + 'km';
  const isPlatoon = (u) => u && u.side === 'friend' && !u.ally;
  const unitById = (game, id) => game.units.find((u) => u.id === id);

  // 표적 위치 설명: '북동쪽 숲'
  function where(game, from, t) {
    return O().dirTo(from, t) + '쪽 ' + game.map.infoAt(t.x, t.y).name;
  }

  // 같은 전차가 짧은 시간에 여러 표적을 발견하면 한 번에 묶어 보고한다
  function flushBatches(game, events) {
    const now = game.gameSeconds;
    for (const [id, b] of game.radio.batch) {
      if (now - b.at < 1.5) continue;
      game.radio.batch.delete(id);
      const u = unitById(game, id);
      if (!u || u.destroyed) continue;
      const groups = new Map();
      const friends = [];
      for (const c of b.list) {
        if (!c.known || c.wreck) continue;
        const t = c.unit;
        if (c.identified && c.kind === 'friendly') { friends.push(where(game, u, t) + ' ' + t.callsign); continue; }
        const key = where(game, u, t);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      const parts = [];
      for (const [k, list] of groups) {
        const names = list.map((c) => c.identified ? c.unit.callsign : c.label);
        const what = list.every((c) => c.identified) ? '적 ' + list.length : '미상 표적 ' + list.length;
        parts.push(k + ' ' + what + ' (' + names.join('·') + (list.length === 1 ? ', ' + km(list[0].dist) : '') + ')');
      }
      if (parts.length) {
        const allUnknown = b.list.every((c) => !c.identified);
        const body = parts.join(', ') + '.';
        report(game, u, TMM.Crew ? TMM.Crew.spotLine(game, u, body, allUnknown) : body, { prio: 1 }, events);
      }
      if (friends.length) report(game, u, friends.join(', ') + ' — 피아식별 응답, 아군.', { prio: 0 }, events);
    }
  }

  function onEvents(game, events) {
    const out = [];
    const ctrl = controlUnit(game);
    for (const ev of events) {
      switch (ev.type) {
        case 'contact-new': {
          if (ev.side !== 'friend') break;
          const u = unitById(game, ev.by);
          if (!u) break;
          const b = game.radio.batch.get(u.id) || { at: game.gameSeconds, list: [] };
          b.list.push(ev.contact);
          game.radio.batch.set(u.id, b);
          break;
        }
        case 'contact-id': {
          if (ev.side !== 'friend' || ev.how === 'iff' || ev.contact.kind !== 'hostile' || !ev.contact.known) break;
          const c = ev.contact, t = ev.unit;
          const u = unitById(game, c.seenBy[0]) || ctrl;
          if (!u) break;
          const what = TMM.VEHICLES[t.model].cls === 'tank' ? '적 천마호 전차' : '적';
          report(game, u, '미상 표적 ' + c.label + ', ' + what + '로 식별 (' + t.callsign + '). ' + where(game, u, t) + ', ' + km(c.dist) + '.', { prio: 1 }, out);
          break;
        }
        case 'shot': onShot(game, ev, ctrl, out); break;
        case 'ammo-switch':
          if (isPlatoon(ev.unit)) report(game, ev.unit, TMM.AMMO[ev.from].short + ' 소진. ' + TMM.AMMO[ev.to].short + '으로 전환.', { prio: 0, kind: 'warn' }, out);
          break;
        case 'arrive': {
          const u = ev.unit;
          if (!isPlatoon(u) || u.destroyed) break;
          const grid = game.map.gridRef(u.x, u.y);
          if (u.selfMove) report(game, u, '엄폐 위치 도착. 격자 ' + grid + '.', { prio: 0 }, out);
          else if (u.order.type === 'move' || u.order.type === 'withdraw' || u === ctrl) {
            report(game, u, '목표 지점 도착. 격자 ' + grid + ' (' + game.map.infoAt(u.x, u.y).name + ').', { prio: 0 }, out);
          }
          break;
        }
        case 'cease-fire':
          if (isPlatoon(ev.unit)) report(game, ev.unit, '사격 중지! 표적은 ' + ev.target.callsign + ', 아군입니다.', { prio: 3, kind: 'warn' }, out);
          break;
        case 'enemy-engage': {
          const c = I().contact(game, 'friend', ev.unit.id);
          if (!c || !c.visible || !c.identified || ev.unit.ai.reported) break;
          ev.unit.ai.reported = true;
          const u = unitById(game, c.seenBy[0]);
          if (u) report(game, u, ev.unit.callsign + ' 정지, 사격 자세. ' + where(game, u, ev.unit) + '.', { prio: 1, kind: 'warn' }, out);
          break;
        }
        case 'enemy-retreat': {
          const c = I().contact(game, 'friend', ev.unit.id);
          if (!c || !c.visible || !c.identified) break;
          const u = unitById(game, c.seenBy[0]);
          if (u) report(game, u, ev.unit.callsign + ' 후퇴 중.', { prio: 0 }, out);
          break;
        }
        default: break;
      }
    }
    events.push(...out);
  }

  function onShot(game, ev, ctrl, out) {
    const { shooter: s, target: t, res } = ev;
    const now = game.gameSeconds;
    // 소대 전차가 쏨
    if (isPlatoon(s) && !ev.friendlyFire) {
      const c = I().contact(game, 'friend', t.id);
      const tname = ev.unidentified ? '미식별 표적' + (c ? ' ' + c.label : '') : t.callsign;
      const what = TMM.AMMO[ev.ammoId].short;
      if (s === ctrl) {
        // 지휘 전차: 차내에서 한 발 한 발 다 들린다
        let r;
        if (res.destroyed) r = '격파!' + (ev.unidentified ? ' 확인 결과 ' + t.callsign + '.' : '');
        else if (!res.hit) r = '빗나감.';
        else if (ev.fresh.length) r = '명중. ' + (res.pen ? '' : '외부 손상: ') + ev.fresh.map((k) => TMM.PARTS[k].name).join('·') + ' 손상.';
        else if (res.pen) r = '명중, 관통. 효과 미확인.';
        else r = '명중, 관통 실패.';
        emit(out, intercom(s), tname + '에 ' + what + ' 사격 (' + km(res.distM) + '). ' + r, res.destroyed ? 'kill' : ev.unidentified ? 'warn' : 'fire');
      } else if (res.destroyed) {
        report(game, s, tname + ' 격파. (' + what + ', ' + km(res.distM) + ')', { prio: 1, kind: 'kill' }, out);
      } else if (ev.unidentified && now - s.lastUnidLog > 60) {
        s.lastUnidLog = now;
        report(game, s, '미식별 표적' + (c ? ' ' + c.label : '') + '에 사격 중.', { prio: 1, kind: 'warn' }, out);
      }
      const total = TMM.Damage.totalAmmo(s);
      if (total === 0 && s.ammoWarned < 2) {
        s.ammoWarned = 2;
        report(game, s, '탄약 소진. 사격 불가.', { prio: 2, kind: 'warn' }, out);
      } else if (total <= R().AMMO_LOW && s.ammoWarned < 1) {
        s.ammoWarned = 1;
        const detail = TMM.VEHICLES[s.model].ammoTypes.map((k) => TMM.AMMO[k].short + ' ' + s.ammo[k]).join('·');
        report(game, s, '탄약 부족. 잔탄 ' + total + '발 (' + detail + ').', { prio: 1, kind: 'warn' }, out);
      }
    }
    // 소대 전차가 맞음
    if (isPlatoon(t) && s.side === 'enemy') {
      const c = I().contact(game, 'friend', s.id);
      const from = c && c.known ? I().displayName(c) : '미상 표적';
      if (!res.hit) {
        if (now - t.lastMissLog > R().MISS_REPORT_SEC) {
          t.lastMissLog = now;
          report(game, t, from + '의 포격, 근탄. 피해 없음.', { prio: 0 }, out);
        }
      } else if (res.destroyed) {
        // 격파된 전차는 말할 수 없다 → 가장 가까운 다른 전차가 알린다
        const others = game.units.filter((u) => !u.destroyed && u !== t);
        others.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
        const by = others[0];
        if (by) report(game, by, call(t) + ' 피격, 격파됨! (' + ASP()[res.aspect] + ', ' + km(res.distM) + ')', { prio: 3, kind: 'loss' }, out);
      } else {
        let body = '피탄! ' + ASP()[res.aspect];
        if (ev.fresh.length) body += (res.pen ? ' 관통. ' : '. ') + ev.fresh.map((k) => PART_LINES[k]).join(', ') + '.';
        else body += res.pen ? ' 관통, 피해 경미.' : ' 장갑이 막아냄.';
        if (ev.selfCover) body += ' 엄폐물로 이동한다.';
        // 무전기가 방금 망가졌으면 그 보고는 못 나간다 (report 가 교신 상태를 확인)
        report(game, t, body, { prio: 2, kind: 'warn' }, out);
      }
    }
  }

  return {
    init, update, link, linkState, controlUnit, sendOrder, pendingFor, clearPending, report, boundReport, requestReport, statusReport, onEvents, call,
  };
})();
