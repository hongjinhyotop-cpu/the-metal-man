/*
 * M8a 하늘과 먼 곳에서 오는 위협: 적 포병, 정찰 드론, 자폭 드론. DOM 없음 → 모의 전투에서도 같은 규칙.
 *
 * 작전 설정 game.op.fires (훈련 '혼합'은 Battle.create 의 opts.fires):
 *   artillery: { from(작전 개시 후 이 시각부터 쏠 수 있음), max(최대 포격 수), still(true: 한자리에 오래 있는, 적이 아는 전차를 노림) }
 *   recon:     [{ at, route: [[x, y], …], life }]   정찰 드론 (경로를 돌며 아래의 전차를 찾음)
 *   kamikaze:  [{ at, n, from: [x, y] }]            자폭 드론 n 대 (20초 간격)
 *
 * 포병: 표적 지점에 원형 경고(arty-warn)가 뜨고 WARN_SEC 뒤 SALVO_SEC 동안 포탄 SHELLS 발이 원 안에 떨어진다.
 *   직격(DIRECT_M 안)은 드물다 — 윗면 관통 판정. 가까운 탄(NEAR_M 안)은 궤도·무전기·외부 장비 손상과 승무원 부상.
 *   원 밖으로 나가면 안전. 정찰 드론에 발견되면 몇 분 뒤 그 자리, 적이 보고 있는 채로 한자리에 오래 있으면 그 자리.
 * 정찰 드론: 높이 떠서 경로를 돈다. 아래 EYE_M 안의 전차를 SPOT_SEC 동안 보면 '발견' → 적이 위치를 알고, 포병을 부른다.
 *   숲 속(×0.35)·시가지(×0.6)·연막 안이면 잘 못 본다. 우리 전차가 가까이 오면(SEEN_M) 드론이 보인다. 너무 높아 쏠 수 없다.
 * 자폭 드론: 가까운 전차로 날아와 윗면(약한 곳)을 노린다. 전차장이 12.7mm 기관총으로 쏴서 떨어뜨릴 수 있다(MG_*).
 *   숲 속이거나 계속 움직이거나 연막 안이면 덜 맞는다.
 *
 * game.indirect = { strikes[], drones[], booms[], lastStrike, nStrikes, fires }
 * 사건: arty-plan · arty-warn · arty-impact · arty-done · drone-seen · drone-spot · kami-launch · kami-warn · kami-down · kami-miss · shot(직격·자폭 명중)
 * 숫자는 모두 게임용 추정치 — TMM.INDIRECT 만 고치면 된다.
 */
TMM.INDIRECT = {
  ARTY: {
    DELAY_DRONE_SEC: [100, 160], // 드론이 발견한 뒤 포탄이 떨어질 때까지 ("몇 분 뒤")
    DELAY_STILL_SEC: [50, 80], // 적이 보고 있는 채 한자리에 오래 있을 때
    WARN_SEC: 35, // 떨어지기 전 지도에 원형 경고
    RADIUS_M: 90, // 탄이 떨어지는 원
    SHELLS: 8,
    SALVO_SEC: 6,
    DIRECT_M: 7, // 직격
    NEAR_M: 40, // 파편·폭풍
    NEAR_DMG_P: 0.32, // 가까운 탄 한 발에 외부 장비 손상 확률 (가까울수록 큼)
    NEAR_HURT_P: 0.1, // 가까운 탄 한 발에 승무원 경상 확률
    STILL_SEC: 150, // 이만큼 한자리(STILL_M 안)에 있고 적이 보고 있으면 포병이 노린다
    STILL_M: 120,
    COOLDOWN_SEC: 120, // 포격 사이 최소 간격
  },
  RECON: {
    SPEED_MS: 28,
    EYE_M: 750, // 드론 카메라로 아래 전차를 찾는 거리
    CONCEAL: { forest: 0.35, town: 0.6 },
    MOVING_MUL: 1.1,
    SPOT_SEC: 8, // 이만큼 보면 '발견'
    RESPOT_SEC: 150, // 같은 전차를 다시 신고하기까지
    SEEN_M: { day: 1700, night: 1400 }, // 우리 전차가 드론을 알아채는 거리 (열상·소리)
    LIFE_SEC: 900,
  },
  KAMI: {
    SPEED_MS: 35,
    SEEN_M: { day: 1000, night: 800 },
    MG_RANGE_M: 500,
    MG_BURST_SEC: 2,
    MG_P: 0.07, // 한 번 쏠 때 떨어뜨릴 확률 (× 전차장 실력)
    HIT_P: 0.8,
    CONCEAL: { forest: 0.45, town: 0.75 },
    MOVING_MUL: 0.6,
    SMOKE_MUL: 0.4,
    NEAR_DMG_P: 0.3, // 빗나가도 옆에서 터지면 외부 장비 손상
    GAP_SEC: 20,
  },
  TOP_PARTS: { fcs: 3, radio: 3, gun: 2, engine: 2, track: 0 }, // 윗면에 맞을 때 손상되기 쉬운 부위
  NEAR_PARTS: { track: 3, radio: 3, fcs: 2, gun: 1, engine: 0 }, // 파편·폭풍
};

TMM.Indirect = (function () {
  const K = () => TMM.INDIRECT;
  const between = (game, r) => r[0] + game.rand() * (r[1] - r[0]);
  const mpc = (game) => game.map.metersPerCell;
  const distM = (game, a, b) => Math.hypot(a.x - b.x, a.y - b.y) * mpc(game);
  let nextId = 1;

  function init(game, fires) {
    game.indirect = { strikes: [], drones: [], booms: [], lastStrike: -1e9, nStrikes: 0, fires: fires || null, kamiQueue: [] };
    if (!fires) return;
    for (const k of fires.kamikaze || []) {
      for (let i = 0; i < (k.n || 1); i++) game.indirect.kamiQueue.push({ at: k.at + i * K().KAMI.GAP_SEC, from: k.from });
    }
    game.indirect.reconQueue = (fires.recon || []).map((r) => Object.assign({}, r));
  }

  // 지킬 것: 소대 전차 + 흑표 지원 K2
  const targets = (game) => game.units.filter((u) => !u.destroyed).concat(game.allies.filter((a) => a.support && !a.destroyed && !a.exited));
  const terrainKey = (game, p) => {
    const t = game.map.typeAt(p.x, p.y);
    if (t === TMM.T.FOREST) return 'forest';
    if (t === TMM.T.TOWN) return 'town';
    return null;
  };

  function pickWeighted(game, u, weights) {
    const opts = TMM.PART_KEYS.filter((k) => !u.damage[k] && weights[k] > 0);
    if (!opts.length) return null;
    let r = game.rand() * opts.reduce((s, k) => s + weights[k], 0);
    for (const k of opts) { r -= weights[k]; if (r <= 0) return k; }
    return opts[opts.length - 1];
  }

  // 윗면 공격 판정 (자폭 드론·포병 직격): res 를 만든다
  function topHit(game, u, killMul) {
    const res = { distM: 0, aspect: 'top', parts: [], hit: true, pen: false, destroyed: false };
    res.pen = game.rand() < (TMM.TOP_PEN[u.model] || 0.6);
    if (res.pen && game.rand() < TMM.VEHICLES[u.model].killOnPen * killMul) res.destroyed = true;
    else {
      const p = pickWeighted(game, u, K().TOP_PARTS);
      if (p) res.parts.push(p);
      else if (res.pen) res.destroyed = true;
    }
    return res;
  }

  function shotEvent(game, u, res, ammoId, src, events) {
    const fresh = TMM.Damage.apply(u, res);
    const shooter = { id: ammoId === 'ARTY' ? 'arty' : 'drone-' + src.id, side: 'enemy', callsign: ammoId === 'ARTY' ? '적 포병' : '자폭 드론', x: src.x, y: src.y, model: ammoId };
    events.push({ type: 'shot', shooter, target: u, ammoId, res, fresh, unidentified: false, friendlyFire: false, manual: false, indirect: true });
  }

  // ---------------------------------------------------------------- 포병
  function request(game, x, y, delayR, why, unit, events) {
    const ind = game.indirect;
    const A = K().ARTY;
    const f = ind.fires && ind.fires.artillery;
    if (!f) return null;
    const now = game.gameSeconds;
    if (now - game.startSeconds < (f.from || 0)) return null;
    if (ind.nStrikes >= (f.max || 3)) return null;
    if (now - ind.lastStrike < A.COOLDOWN_SEC) return null;
    if (ind.strikes.some((s) => !s.done && Math.hypot(s.x - x, s.y - y) * mpc(game) < A.RADIUS_M * 1.5)) return null;
    const fireAt = now + between(game, delayR);
    const s = { id: nextId++, x, y, r: A.RADIUS_M / mpc(game), fireAt, warnAt: fireAt - A.WARN_SEC, warned: false, left: A.SHELLS, nextShell: fireAt, done: false, why, unitId: unit ? unit.id : null, hits: new Map() };
    ind.strikes.push(s);
    ind.nStrikes += 1;
    ind.lastStrike = now;
    events.push({ type: 'arty-plan', strike: s, why });
    return s;
  }

  function shell(game, s, events) {
    const A = K().ARTY;
    const a = game.rand() * Math.PI * 2, rr = Math.sqrt(game.rand()) * s.r;
    const p = { x: s.x + Math.cos(a) * rr, y: s.y + Math.sin(a) * rr };
    game.indirect.booms.push({ x: p.x, y: p.y, t: game.gameSeconds, big: false });
    for (const u of targets(game)) {
      const d = distM(game, u, p);
      if (d > A.NEAR_M) continue;
      const rec = s.hits.get(u.id) || { parts: [], hurt: 0, direct: false };
      s.hits.set(u.id, rec);
      if (d <= A.DIRECT_M) {
        const res = topHit(game, u, 0.5); // 포탄 직격: 윗면 관통이어도 자폭 드론보다 덜 치명적 (게임용 추정치)
        rec.direct = true;
        shotEvent(game, u, res, 'ARTY', p, events);
        continue;
      }
      const near = 1 - (d - A.DIRECT_M) / (A.NEAR_M - A.DIRECT_M) * 0.6;
      if (game.rand() < A.NEAR_DMG_P * near) {
        const k = pickWeighted(game, u, K().NEAR_PARTS);
        if (k) { u.damage[k] = true; rec.parts.push(k); if (k === 'track' && u.state === 'moving') TMM.Movement.stop(u); }
      }
      if (u.crew && game.rand() < A.NEAR_HURT_P * near) {
        // 해치 밖으로 머리를 낸 전차장이 다치기 쉽다
        const ms = u.crew.members.filter((m) => m.injury < 2);
        const m = ms.find((x) => x.role === 'cmdr' && game.rand() < 0.5) || ms[Math.floor(game.rand() * ms.length)];
        if (m) { TMM.Crew.hurt(game, u, m, 1, events, true); rec.hurt += 1; }
      }
    }
  }

  function updateArtillery(game, events) {
    const ind = game.indirect;
    const A = K().ARTY;
    const now = game.gameSeconds;
    const f = ind.fires && ind.fires.artillery;
    // 한자리에 오래 있고 적이 보고 있는 전차 → 포격 요청
    if (f && f.still) {
      for (const u of game.units) {
        if (u.destroyed) continue;
        if (u.stillX == null || Math.hypot(u.x - u.stillX, u.y - u.stillY) * mpc(game) > A.STILL_M) { u.stillX = u.x; u.stillY = u.y; u.stillSince = now; continue; }
        if (now - u.stillSince < A.STILL_SEC) continue;
        const c = TMM.Intel.contact(game, 'enemy', u.id);
        if (!c || !c.known || now - c.lastSeen > 20) continue;
        if (request(game, u.x, u.y, A.DELAY_STILL_SEC, 'still', u, events)) u.stillSince = now; // 다시 세기
      }
    }
    for (const s of ind.strikes) {
      if (s.done) continue;
      if (!s.warned && now >= s.warnAt) { s.warned = true; events.push({ type: 'arty-warn', strike: s }); }
      if (now < s.fireAt) continue;
      if (!s.impacted) { s.impacted = true; events.push({ type: 'arty-impact', strike: s }); }
      while (s.left > 0 && now >= s.nextShell) {
        s.left -= 1;
        s.nextShell += A.SALVO_SEC / A.SHELLS;
        shell(game, s, events);
      }
      if (s.left <= 0) {
        s.done = true;
        s.doneAt = now;
        events.push({ type: 'arty-done', strike: s });
        // 피해 보고 (전차마다 한 줄, 직격은 shot 사건이 따로 보고)
        for (const [id, rec] of s.hits) {
          const u = game.units.find((x) => x.id === id);
          if (!u || u.destroyed || rec.direct) continue;
          const parts = rec.parts.map((k) => TMM.PARTS[k].name);
          if (!parts.length && !rec.hurt) continue;
          const body = '포격 피해! ' + (parts.length ? parts.join('·') + ' 손상' : '') + (parts.length && rec.hurt ? ', ' : '') + (rec.hurt ? '승무원 부상 ' + rec.hurt + '명' : '') + '.';
          TMM.Radio.report(game, u, body, { prio: 2, kind: 'warn' }, events);
        }
      }
    }
  }

  // ---------------------------------------------------------------- 정찰 드론
  function spawnRecon(game, r, events) {
    const route = r.route.map(([x, y]) => ({ x, y }));
    const d = { id: nextId++, kind: 'recon', x: route[0].x, y: route[0].y, route, wp: 1, until: game.gameSeconds + (r.life || K().RECON.LIFE_SEC), spot: new Map(), seen: false, seenAt: -1e9, orbit: null };
    game.indirect.drones.push(d);
    events.push({ type: 'drone-launch', drone: d });
  }

  function moveToward(game, d, tx, ty, speed, gdt) {
    const step = (speed * gdt) / mpc(game);
    const dx = tx - d.x, dy = ty - d.y, L = Math.hypot(dx, dy);
    if (L <= step) { d.x = tx; d.y = ty; return true; }
    d.x += (dx / L) * step;
    d.y += (dy / L) * step;
    d.heading = Math.atan2(dy, dx);
    return false;
  }

  function seenByUs(game, d, range) {
    for (const u of targets(game)) if (distM(game, u, d) <= range) return true;
    return false;
  }

  function updateRecon(game, d, gdt, events) {
    const R = K().RECON;
    const now = game.gameSeconds;
    // 움직임: 발견한 전차 위를 잠시 돈다, 아니면 경로를 따라
    if (d.orbit && now < d.orbit.until) {
      const a = (now - d.orbit.from) * 0.25;
      moveToward(game, d, d.orbit.x + Math.cos(a) * 6, d.orbit.y + Math.sin(a) * 6, R.SPEED_MS, gdt);
    } else if (now >= d.until) {
      // 수명이 다하면 북쪽으로 돌아간다
      if (moveToward(game, d, d.x, -3, R.SPEED_MS, gdt) || d.y < 0) d.gone = true;
    } else {
      const w = d.route[d.wp % d.route.length];
      if (moveToward(game, d, w.x, w.y, R.SPEED_MS, gdt)) d.wp += 1;
    }
    // 우리가 드론을 보는가
    const seen = seenByUs(game, d, R.SEEN_M[game.light]);
    if (seen) {
      if (!d.seen) events.push({ type: 'drone-seen', drone: d });
      d.seen = true;
      d.seenAt = now;
    } else if (now - d.seenAt > 15) d.seen = false;
    if (d.gone || now >= d.until) return;
    // 아래의 전차 찾기 (한 틱에 여러 대를 찾으면 사건 하나로 묶는다)
    const found = [];
    for (const u of targets(game)) {
      const tk = terrainKey(game, u);
      let eye = R.EYE_M * (tk ? R.CONCEAL[tk] : 1) * (u.state === 'moving' ? R.MOVING_MUL : 1);
      if (TMM.Smoke.covers(game, u)) eye = 0;
      const dd = distM(game, u, d);
      const acc = d.spot.get(u.id) || 0;
      if (dd > eye) { if (acc) d.spot.set(u.id, Math.max(0, acc - gdt)); continue; }
      const v = acc + gdt;
      d.spot.set(u.id, v);
      if (v < R.SPOT_SEC) continue;
      if (u.droneSpotAt != null && now - u.droneSpotAt < R.RESPOT_SEC) continue;
      u.droneSpotAt = now;
      d.spot.set(u.id, 0);
      TMM.Intel.reveal(game, 'enemy', u, null, 'drone');
      const ec = TMM.Intel.contact(game, 'enemy', u.id);
      if (ec) { ec.lastX = u.x; ec.lastY = u.y; ec.lastSeen = now; }
      found.push(u);
    }
    if (found.length) {
      const u = found[0];
      d.orbit = { x: u.x, y: u.y, from: now, until: now + 20 };
      const s = request(game, u.x, u.y, K().ARTY.DELAY_DRONE_SEC, 'drone', u, events);
      events.push({ type: 'drone-spot', drone: d, unit: u, units: found, strike: s, known: d.seen });
    }
  }

  // ---------------------------------------------------------------- 자폭 드론
  function spawnKami(game, q, events) {
    const d = { id: nextId++, kind: 'kami', x: q.from[0], y: q.from[1], target: null, seen: false, warned: false, mgT: 0 };
    game.indirect.drones.push(d);
    events.push({ type: 'kami-launch', drone: d });
  }

  function kamiTarget(game, d) {
    // 적이 아는 전차 중 가장 가까운 것, 없으면 그냥 가장 가까운 전차 (드론 카메라로 찾음)
    let best = null, bd = Infinity;
    for (const u of targets(game)) {
      const c = TMM.Intel.contact(game, 'enemy', u.id);
      const known = c && c.known && game.gameSeconds - c.lastSeen < 120;
      const dd = distM(game, u, d) + (known ? 0 : 1200);
      if (dd < bd) { bd = dd; best = u; }
    }
    return best;
  }

  function cmdrEff(u) {
    const c = u.crew && u.crew.byRole && u.crew.byRole.cmdr;
    return c && TMM.Crew ? TMM.Crew.eff(c) : 1;
  }

  function updateKami(game, d, gdt, events) {
    const KM = K().KAMI;
    if (!d.target || d.target.destroyed || d.target.exited) d.target = kamiTarget(game, d);
    const t = d.target;
    if (!t) { d.gone = true; return; }
    // 우리가 드론을 보는가
    if (seenByUs(game, d, KM.SEEN_M[game.light])) {
      d.seen = true;
      if (!d.warned) { d.warned = true; events.push({ type: 'kami-warn', drone: d, target: t }); }
    }
    // 전차장 12.7mm 기관총 (드론이 보이고 사거리 안)
    if (d.seen) {
      d.mgT += gdt;
      if (d.mgT >= KM.MG_BURST_SEC) {
        d.mgT = 0;
        for (const u of targets(game)) {
          if (distM(game, u, d) > KM.MG_RANGE_M) continue;
          let p = KM.MG_P * cmdrEff(u);
          if (u.state === 'moving') p *= 0.8;
          if (game.scope && game.scope.open && TMM.Scope.unit(game) === u) p *= 0.4; // 소대장이 조준경에 붙어 있음
          if (terrainKey(game, u) === 'forest') p *= 0.7; // 나뭇가지
          if (game.rand() < p) {
            d.gone = true;
            game.indirect.booms.push({ x: d.x, y: d.y, t: game.gameSeconds, big: false, air: true });
            events.push({ type: 'kami-down', drone: d, by: u });
            return;
          }
        }
      }
    }
    if (!moveToward(game, d, t.x, t.y, KM.SPEED_MS, gdt) && distM(game, d, t) > 25) return;
    // 공격
    d.gone = true;
    const tk = terrainKey(game, t);
    let p = KM.HIT_P * (tk ? KM.CONCEAL[tk] : 1);
    if (t.state === 'moving') p *= KM.MOVING_MUL;
    if (TMM.Smoke.covers(game, t)) p *= KM.SMOKE_MUL;
    game.indirect.booms.push({ x: t.x, y: t.y, t: game.gameSeconds, big: true });
    if (game.rand() < p) {
      shotEvent(game, t, topHit(game, t, TMM.AMMO.DRONE.killMul), 'DRONE', d, events);
    } else {
      let part = null;
      if (game.rand() < KM.NEAR_DMG_P) {
        part = pickWeighted(game, t, K().NEAR_PARTS);
        if (part) { t.damage[part] = true; if (part === 'track' && t.state === 'moving') TMM.Movement.stop(t); }
      }
      events.push({ type: 'kami-miss', drone: d, target: t, part, why: tk === 'forest' ? 'forest' : TMM.Smoke.covers(game, t) ? 'smoke' : t.state === 'moving' ? 'moving' : 'miss' });
    }
  }

  // ---------------------------------------------------------------- 틱
  function update(game, gdt, events) {
    const ind = game.indirect;
    if (!ind || !ind.fires) return;
    const el = game.gameSeconds - game.startSeconds;
    for (const r of ind.reconQueue) if (!r.done && el >= r.at) { r.done = true; spawnRecon(game, r, events); }
    for (const q of ind.kamiQueue) if (!q.done && el >= q.at) { q.done = true; spawnKami(game, q, events); }
    for (const d of ind.drones) {
      if (d.gone) continue;
      if (d.kind === 'recon') updateRecon(game, d, gdt, events);
      else updateKami(game, d, gdt, events);
    }
    updateArtillery(game, events);
    if (ind.drones.length > 10) ind.drones = ind.drones.filter((d) => !d.gone);
    if (ind.booms.length > 40) ind.booms = ind.booms.filter((b) => game.gameSeconds - b.t < 20);
  }

  // 화면을 느리게 할 만한 위협이 있는가 (교전 중 판정)
  function urgent(game) {
    const ind = game.indirect;
    if (!ind) return false;
    const now = game.gameSeconds;
    if (ind.strikes.some((s) => !s.done && now >= s.warnAt)) return true;
    return ind.drones.some((d) => !d.gone && d.kind === 'kami' && d.seen);
  }

  // 포격 경고 원 (화면용): 경고가 뜬 것만
  const warnings = (game) => (game.indirect ? game.indirect.strikes.filter((s) => s.warned && !s.done) : []);

  return { init, update, urgent, warnings, request };
})();
