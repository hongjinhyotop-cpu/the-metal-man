/*
 * 명령 실행과 전차의 '스스로 판단' (M4 무전 지휘).
 *
 * 무전으로 도착한(또는 1호차가 직접 받은) 명령을 전차에 적용한다. 무전 전달·지연·오청은 radio-net.js 가 맡고,
 * 여기서는 '알아들은 명령'을 실제 행동으로 바꾼다.
 *
 * 명령(order) 종류:
 *   move     { x, y, slot, count }   지정 위치로 이동 (여러 대면 옆으로 벌려 섬)
 *   cover    { angle }                현 위치 정지, angle 방향을 지켜봄 (차체도 그 방향)
 *   bound    { boundId }              엄호 이동에 참가 (게임 전체에 엄호 이동은 하나: game.bound)
 *   roe      { roe }                  사격 통제 'hold' | 'id' | 'free'
 *   target   { targetId }             목표 지정 (null 이면 해제)
 *   withdraw { x, y, slot, count }    철수: 처음 일부는 정면을 적에게 둔 채 후진
 *   stop     {}                       현 위치 정지
 *   report   {}                       상황 보고 (radio-net.js 가 보고문을 만든다)
 *
 * 전차 필드 (Orders.init 이 붙임):
 *   order {type, ...}  지금 수행 중인 마지막 명령 (명령이 없으면 이것을 계속한다)
 *   watch              지켜보는 방향(라디안) 또는 null
 *   roe                사격 통제 단계
 *   reverseM           남은 후진 거리(m)
 *   selfCoverAt        마지막으로 스스로 엄폐물로 움직인 시각
 */
TMM.Orders = (function () {
  const R = () => TMM.RADIO;
  const DIRS = ['동', '남동', '남', '남서', '서', '북서', '북', '북동'];

  function norm(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  // 방향 이름 (지도 각도: 0 = 동, y 가 아래로 커짐)
  function dirName(angle) {
    const deg = ((angle * 180) / Math.PI + 360) % 360;
    return DIRS[Math.round(deg / 45) % 8];
  }
  const dirTo = (a, b) => dirName(Math.atan2(b.y - a.y, b.x - a.x));

  function init(game) {
    for (const u of game.units) {
      u.order = { type: 'idle' };
      u.watch = null;
      u.roe = 'id';
      u.reverseM = 0;
      u.selfCoverAt = -1e9;
      u.selfMove = false;
      u.spaceAt = -1e9;
    }
    game.bound = null;
  }

  const unitById = (game, id) => game.units.find((u) => u.id === id);

  function passable(map, x, y) {
    const info = map.infoAt(x, y);
    return !!(info && info.speed);
  }

  // (x, y) 에 다른 소대 전차가 서 있거나 그리로 가는 중인가
  function occupied(game, u, x, y) {
    const sp = R().SPACING_CELLS;
    for (const o of game.units) {
      if (o === u || o.destroyed) continue;
      if (Math.hypot(o.x - x, o.y - y) < sp && o.state !== 'moving') return true;
      if (o.state === 'moving' && o.dest && Math.hypot(o.dest.x - x, o.dest.y - y) < sp) return true;
    }
    return false;
  }

  // 겹치지 않는 가까운 자리: 다른 전차가 있으면 둘레를 돌며 빈 곳을 찾는다
  function freeSpot(game, u, x, y) {
    if (!occupied(game, u, x, y)) return { x, y };
    const sp = R().SPACING_CELLS;
    for (const r of [sp, sp * 1.6, sp * 2.3, sp * 3]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + r;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (passable(game.map, px, py) && !occupied(game, u, px, py)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  // 여러 대에게 같은 위치를 주면 진행 방향의 옆으로 벌려 세운다
  function formationPoint(game, u, o) {
    const slot = o.slots ? o.slots[u.id] : o.slot;
    if (!o.count || o.count < 2 || slot == null) return { x: o.x, y: o.y };
    const dir = Math.atan2(o.y - (o.cy != null ? o.cy : u.y), o.x - (o.cx != null ? o.cx : u.x));
    const perp = dir + Math.PI / 2;
    const off = (slot - (o.count - 1) / 2) * R().FORMATION_CELLS;
    const p = { x: o.x + Math.cos(perp) * off, y: o.y + Math.sin(perp) * off };
    return passable(game.map, p.x, p.y) ? p : { x: o.x, y: o.y };
  }

  // 이동 (겹치지 않는 자리로). 반환: Movement.order 결과
  function moveUnit(game, u, x, y, reverse) {
    const p = freeSpot(game, u, x, y);
    let res = TMM.Movement.order(game.map, u, p.x, p.y);
    if (!res.ok && (p.x !== x || p.y !== y)) res = TMM.Movement.order(game.map, u, x, y);
    u.reverseM = res.ok && reverse ? R().REVERSE_CELLS * game.map.metersPerCell : 0;
    return res;
  }

  // 엄호 방향: 명령에 각도가 있으면 그것, 아니면 지정한 지점 쪽
  function angleFor(u, o) {
    return o.angle != null ? o.angle : Math.atan2(o.y - u.y, o.x - u.x);
  }

  // 명령을 실행할 수 없는 이유 (없으면 null)
  function check(game, u, o) {
    if (u.destroyed) return '격파됨';
    if ((o.type === 'move' || o.type === 'withdraw' || o.type === 'bound') && u.damage.track) return '궤도 손상, 기동 불가';
    if (o.type === 'move' || o.type === 'withdraw') {
      const info = game.map.infoAt(o.x, o.y);
      if (!info) return '작전 지역 밖';
      if (!info.speed) return info.name + ' 진입 불가';
    }
    return null;
  }

  // 명령을 전차에 적용한다. 반환: { ok, reason?, res? }
  function execute(game, u, o) {
    const why = check(game, u, o);
    if (why) return { ok: false, reason: why };
    switch (o.type) {
      case 'move':
      case 'withdraw': {
        leaveBound(game, u);
        const p = formationPoint(game, u, o);
        const res = moveUnit(game, u, p.x, p.y, o.type === 'withdraw');
        if (!res.ok) return { ok: false, reason: res.reason };
        u.order = { type: o.type, x: u.dest.x, y: u.dest.y };
        u.watch = null;
        u.selfMove = false;
        return { ok: true, res };
      }
      case 'cover': {
        leaveBound(game, u);
        TMM.Movement.stop(u);
        u.reverseM = 0;
        const angle = angleFor(u, o);
        u.watch = angle;
        u.order = { type: 'cover', angle };
        u.selfMove = false;
        return { ok: true };
      }
      case 'stop':
        leaveBound(game, u);
        TMM.Movement.stop(u);
        u.reverseM = 0;
        u.order = { type: 'hold' };
        u.selfMove = false;
        return { ok: true };
      case 'roe':
        u.roe = o.roe;
        return { ok: true };
      case 'target':
        u.targetId = o.targetId;
        return { ok: true };
      case 'bound':
        return joinBound(game, u, o.boundId);
      default:
        return { ok: true };
    }
  }

  // ---- 엄호 이동 ----
  // 한 조가 멈춰 지켜보는(엄호) 동안 다른 조가 앞으로 나가고, 도착하면 역할을 바꾼다. 목표 지점에 두 조가 모두 닿으면 끝.
  function startBound(game, x, y, firstTeam, ids) {
    const members = ids.map((id) => unitById(game, id)).filter((u) => u && !u.destroyed);
    const cx = members.reduce((s, u) => s + u.x, 0) / Math.max(1, members.length);
    const cy = members.reduce((s, u) => s + u.y, 0) / Math.max(1, members.length);
    const L = Math.hypot(x - cx, y - cy) || 1;
    const b = {
      id: (game.boundSeq = (game.boundSeq || 0) + 1),
      P: { x, y },
      origin: { x: cx, y: cy },
      axis: { x: (x - cx) / L, y: (y - cy) / L },
      total: L,
      expect: new Set(ids),
      members: new Set(),
      moving: firstTeam,
      phase: 'moving',
      ordered: new Set(),
      target: {},
      bounds: 0,
    };
    game.bound = b;
    return b;
  }

  function joinBound(game, u, boundId) {
    const b = game.bound;
    if (!b || b.id !== boundId || b.phase === 'done') return { ok: false, reason: '엄호 이동이 이미 끝남' };
    b.members.add(u.id);
    u.order = { type: 'bound' };
    u.selfMove = false;
    if (u.team !== b.moving) {
      TMM.Movement.stop(u);
      u.watch = Math.atan2(b.axis.y, b.axis.x);
    }
    return { ok: true };
  }

  function leaveBound(game, u) {
    const b = game.bound;
    if (!b) return;
    b.expect.delete(u.id);
    b.members.delete(u.id);
    if (!b.expect.size) game.bound = null;
  }

  const progressOf = (b, p) => (p.x - b.origin.x) * b.axis.x + (p.y - b.origin.y) * b.axis.y;

  function teamMembers(game, b, team) {
    const out = [];
    for (const id of b.members) {
      const u = unitById(game, id);
      if (u && u.team === team) out.push(u);
    }
    return out.sort((a, c) => a.id - c.id);
  }

  // 움직이는 조가 이번에 나갈 거리(축 위의 진행도)
  function boundTarget(game, b, team) {
    const own = teamMembers(game, b, team);
    const other = teamMembers(game, b, team === 1 ? 2 : 1);
    const avg = (list) => list.reduce((s, u) => s + progressOf(b, u), 0) / list.length;
    const ownP = own.length ? avg(own) : 0;
    const otherP = other.length ? avg(other) : ownP;
    return Math.min(b.total, Math.max(ownP + R().BOUND_MIN_CELLS, otherP + R().BOUND_LEAP_CELLS));
  }

  function updateBound(game) {
    const b = game.bound;
    if (!b || b.phase === 'done') return;
    for (const id of Array.from(b.members)) {
      const u = unitById(game, id);
      if (!u || u.destroyed || u.damage.track) { b.members.delete(id); b.expect.delete(id); }
    }
    for (const id of Array.from(b.expect)) {
      const u = unitById(game, id);
      if (!u || u.destroyed) b.expect.delete(id);
    }
    if (!b.expect.size) { game.bound = null; return; }
    if (!b.members.size) return; // 아직 아무도 명령을 받지 못함

    const axisAngle = Math.atan2(b.axis.y, b.axis.x);
    const perp = { x: -b.axis.y, y: b.axis.x };

    if (b.phase === 'moving') {
      const movers = teamMembers(game, b, b.moving);
      const waiting = Array.from(b.expect).some((id) => !b.members.has(id) && unitById(game, id).team === b.moving);
      if (!movers.length && !waiting) {
        // 움직일 조가 없음 (모두 격파·기동 불능) → 남은 조가 혼자 나간다
        const other = b.moving === 1 ? 2 : 1;
        if (!teamMembers(game, b, other).length) return;
        b.moving = other;
        b.ordered.clear();
        return;
      }
      if (b.target[b.moving] == null) b.target[b.moving] = boundTarget(game, b, b.moving);
      const tp = b.target[b.moving];
      for (const u of movers) {
        if (b.ordered.has(u.id)) continue;
        b.ordered.add(u.id);
        const k = movers.indexOf(u);
        const lat = (b.moving === 1 ? -1 : 1) * R().FORMATION_CELLS + (k - 0.5) * R().FORMATION_CELLS;
        let px = b.origin.x + b.axis.x * tp + perp.x * lat, py = b.origin.y + b.axis.y * tp + perp.y * lat;
        if (!passable(game.map, px, py)) { px = b.origin.x + b.axis.x * tp; py = b.origin.y + b.axis.y * tp; }
        u.watch = null;
        const res = moveUnit(game, u, px, py, false);
        if (!res.ok) TMM.Movement.stop(u);
      }
      // 엄호 조는 멈춰서 진행 방향을 지켜본다
      for (const u of teamMembers(game, b, b.moving === 1 ? 2 : 1)) {
        if (u.state === 'moving' && !b.ordered.has(u.id)) TMM.Movement.stop(u);
        if (u.state !== 'moving' && u.watch == null) u.watch = axisAngle;
      }
      const done = movers.length && movers.every((u) => b.ordered.has(u.id) && u.state !== 'moving');
      if (done && !waiting) {
        b.phase = 'reporting';
        b.bounds += 1;
        for (const u of movers) u.watch = axisAngle;
        const finished = tp >= b.total - 0.5 && teamMembers(game, b, b.moving === 1 ? 2 : 1).every((u) => progressOf(b, u) >= b.total - 3);
        b.finished = finished;
        // 도착 보고가 무전으로 전달되면 다음 조가 움직인다
        TMM.Radio.boundReport(game, movers[0], b, finished, () => {
          if (game.bound !== b) return;
          if (b.finished) {
            b.phase = 'done';
            for (const id of b.members) {
              const u = unitById(game, id);
              if (u) { u.order = { type: 'cover', angle: axisAngle }; u.watch = axisAngle; }
            }
            game.bound = null;
            return;
          }
          b.moving = b.moving === 1 ? 2 : 1;
          b.target[b.moving] = null;
          b.ordered.clear();
          b.phase = 'moving';
        });
      }
    }
  }

  // ---- 스스로 판단 ----
  function turnToward(u, angle, gdt) {
    const diff = norm(angle - u.heading);
    const maxStep = (TMM.VEHICLES[u.model].turnDegPerSec * Math.PI / 180) * gdt;
    u.heading += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
  }

  // 피격된 전차가 가까운 엄폐물(사수에게서 안 보이거나 차체 엄폐가 되는 곳)을 찾는다
  function findCover(game, u, shooter) {
    const map = game.map;
    const [r0, r1] = R().SELF_COVER_RANGE_CELLS;
    let best = null, bestScore = 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p = { x: u.x + Math.cos(a) * r, y: u.y + Math.sin(a) * r };
        if (!passable(map, p.x, p.y) || occupied(game, u, p.x, p.y)) continue;
        // 적 쪽으로 다가가는 곳은 피한다
        if (Math.hypot(p.x - shooter.x, p.y - shooter.y) < Math.hypot(u.x - shooter.x, u.y - shooter.y) - 1) continue;
        const los = TMM.Sight.line(map, shooter, p);
        let s = 0;
        if (los.clear && los.hullDown) s = 4; // 포탑만 보이고 반격 가능
        else if (!los.clear) s = 3; // 아예 안 보임
        else if (los.obs > 0.5) s = 1.5;
        if (!s) continue;
        const ts = TMM.TERRAIN_SIGHT[map.typeAt(p.x, p.y)];
        if (ts.conceal < 0.8) s += 0.5;
        s -= r * 0.12;
        if (s > bestScore) { bestScore = s; best = p; }
      }
    }
    return best;
  }

  // 전투 사건에 대한 반응: 피격되면 짧게 스스로 판단 (명령이 없을 때·멈춰 있을 때)
  function onEvents(game, events) {
    const now = game.gameSeconds;
    const ctrl = TMM.Radio.controlUnit(game);
    for (const ev of events) {
      if (ev.type !== 'shot') continue;
      const u = ev.target;
      if (u.side !== 'friend' || u.ally || u === ctrl || u.destroyed || !ev.res.hit) continue;
      if (u.state === 'moving' || u.damage.track) continue;
      if (now - u.selfCoverAt < R().SELF_COVER_COOLDOWN_SEC) continue;
      if (game.rand() > R().SELF_COVER_P * R().crewFactor(u, 'initiative')) continue;
      if (u.hullDown) continue; // 이미 차체 엄폐
      const p = findCover(game, u, ev.shooter);
      if (!p) continue;
      const res = TMM.Movement.order(game.map, u, p.x, p.y);
      if (!res.ok || res.meters > 500) { if (res.ok) TMM.Movement.stop(u); continue; }
      u.selfCoverAt = now;
      u.selfMove = true;
      u.watch = Math.atan2(ev.shooter.y - u.y, ev.shooter.x - u.x);
      ev.selfCover = true;
      if (game.bound) game.bound.ordered.add(u.id);
    }
  }

  function update(game, gdt) {
    updateBound(game);
    const now = game.gameSeconds;
    for (const u of game.units) {
      if (u.destroyed) continue;
      if (u.state !== 'moving') {
        u.reverseM = 0;
        if (u.selfMove && u.order.type !== 'bound') u.selfMove = false;
        // 지켜보는 방향으로 차체를 돌린다 (지정 표적을 쏘는 중이면 그쪽이 우선)
        const firingDesignated = u.targetId != null && u.fire.targetId === u.targetId;
        if (u.watch != null && !firingDesignated && !u.damage.track) turnToward(u, u.watch, gdt);
        // 서로 너무 붙어 섰으면 비켜 선다
        if (!u.damage.track && now - u.spaceAt > 15) {
          const close = game.units.find((o) => o !== u && !o.destroyed && o.state !== 'moving' && o.id < u.id && Math.hypot(o.x - u.x, o.y - u.y) < R().SPACING_CELLS * 0.6);
          if (close) {
            u.spaceAt = now;
            const p = freeSpot(game, u, u.x, u.y);
            if (p.x !== u.x || p.y !== u.y) TMM.Movement.order(game.map, u, p.x, p.y);
          }
        }
      }
    }
  }

  // ---- 문구 ----
  function gridOf(game, o) {
    return game.map.gridRef(o.x, o.y);
  }

  // 명령 본문 (소대장이 말하는 것)
  function phrase(game, o, ctx) {
    const R0 = R();
    switch (o.type) {
      case 'move': return '격자 ' + gridOf(game, o) + ' (' + game.map.infoAt(o.x, o.y).name + ') 로 이동하라';
      case 'withdraw': return '격자 ' + gridOf(game, o) + ' 로 철수하라. 후진으로 빠져라';
      case 'cover': return '현 위치 정지, ' + dirName(o.angle != null ? o.angle : Math.atan2(o.y - o.cy, o.x - o.cx)) + '쪽 엄호하라';
      case 'stop': return '현 위치 정지하라';
      case 'roe': return R0.ROE[o.roe].name + '. ' + R0.ROE[o.roe].desc;
      case 'target': return o.targetId == null ? '지정 목표 해제' : (ctx && ctx.targetName ? ctx.targetName : '지정 표적') + ' 사격하라';
      case 'bound': return '엄호 이동으로 격자 ' + gridOf(game, o) + ' 까지 전진하라. ' + o.firstTeam + '조 먼저';
      case 'report': return '상황 보고하라';
      default: return '';
    }
  }

  // 수신 복창 (알아들은 대로)
  function readback(game, u, o, ctx) {
    switch (o.type) {
      case 'move': return '격자 ' + gridOf(game, o) + ' 로 이동';
      case 'withdraw': return '격자 ' + gridOf(game, o) + ' 로 후진 철수';
      case 'cover': return dirName(angleFor(u, o)) + '쪽 엄호';
      case 'stop': return '정지';
      case 'roe': return R().ROE[o.roe].name;
      case 'target': return o.targetId == null ? '지정 목표 해제' : (ctx && ctx.targetName ? ctx.targetName : '표적') + ' 조준';
      case 'bound': return '엄호 이동. ' + (u.team === o.firstTeam ? '먼저 전진' : '엄호 후 전진');
      default: return '';
    }
  }

  // 지금 수행 중인 명령 한 줄 (패널용)
  function describe(game, u) {
    if (u.destroyed) return '—';
    const o = u.order;
    let s;
    if (o.type === 'move') s = u.state === 'moving' ? '이동 중 → ' + gridOf(game, o) : '이동 완료, 대기';
    else if (o.type === 'withdraw') s = u.state === 'moving' ? (u.reverseM > 0 ? '후진 철수 중' : '철수 중') : '철수 완료, 대기';
    else if (o.type === 'cover') s = dirName(o.angle) + '쪽 엄호';
    else if (o.type === 'hold') s = '정지';
    else if (o.type === 'bound') {
      const b = game.bound;
      s = b ? '엄호 이동 · ' + (b.moving === u.team && b.phase === 'moving' ? '전진' : '엄호') : '엄호 이동';
    } else s = '명령 없음 · 대기';
    if (u.selfMove) s += ' (피격, 엄폐물로 이동)';
    return s;
  }

  return {
    init, execute, check, update, onEvents, startBound, leaveBound, freeSpot, moveUnit, phrase, readback, describe,
    dirName, dirTo, findCover, formationPoint, angleFor,
  };
})();
