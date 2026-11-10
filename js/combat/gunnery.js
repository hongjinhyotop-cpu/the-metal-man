/*
 * 사격 통제: 매 프레임 모든 전차의 표적 선택 → 조준 → 장전 → 사격을 처리한다.
 *
 *   - 플레이어가 지정한 사격 목표(unit.targetId)가 살아 있고 사거리 안이면 그 표적을 쏜다.
 *   - 지정 목표가 없거나 사거리 밖이면, 사거리 안의 가장 가까운 적과 자동 교전한다.
 *   - 표적이 바뀌면 조준 시간(aimSec)이 다시 필요하다. 한 발 쏘면 장전 시간(reloadSec).
 *   - 정지 중이면 차체 정면을 표적 쪽으로 천천히 돌린다 (정면 장갑으로 받기 위해).
 *
 * 사격 결과는 events 배열에 { type: 'shot', shooter, target, ammoId, res, fresh } 로 쌓아
 * main.js 가 무전 기록과 화면 효과로 바꾼다.
 */
TMM.Gunnery = (function () {
  const B = () => TMM.Ballistics;
  const D = () => TMM.Damage;

  function opponents(game, unit) {
    return unit.side === 'friend' ? game.enemies : game.units;
  }

  function inRange(game, unit, target, ammoId) {
    return B().distanceM(game.map, unit, target) <= TMM.AMMO[ammoId].rangeM;
  }

  // 쏠 탄종: 현재 탄종이 떨어졌으면 남은 탄종으로 바꾼다
  function ensureAmmo(unit, events) {
    if (unit.ammo[unit.ammoType] > 0) return true;
    const veh = TMM.VEHICLES[unit.model];
    const other = veh.ammoTypes.find((k) => unit.ammo[k] > 0);
    if (!other) return false;
    const from = unit.ammoType;
    unit.ammoType = other;
    events.push({ type: 'ammo-switch', unit, from, to: other });
    return true;
  }

  // 이번 프레임에 겨눌 표적
  function chooseTarget(game, unit) {
    const foes = opponents(game, unit).filter((e) => !e.destroyed);
    if (unit.targetId != null) {
      const t = foes.find((e) => e.id === unit.targetId);
      if (!t) unit.targetId = null; // 지정 목표가 격파됨
      else if (inRange(game, unit, t, unit.ammoType)) return t;
    }
    let best = null, bestD = Infinity;
    for (const e of foes) {
      const d = B().distanceM(game.map, unit, e);
      if (d <= TMM.AMMO[unit.ammoType].rangeM && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function turnToward(unit, target, gdt) {
    const want = Math.atan2(target.y - unit.y, target.x - unit.x);
    let diff = want - unit.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxStep = (TMM.VEHICLES[unit.model].turnDegPerSec * Math.PI / 180) * gdt;
    unit.heading += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
  }

  function updateUnit(game, unit, gdt, events, rand) {
    const f = unit.fire;
    f.reload = Math.max(0, f.reload - gdt);
    if (unit.destroyed || unit.damage.gun) { f.targetId = null; return; }
    if (!ensureAmmo(unit, events)) { f.targetId = null; return; }

    const target = chooseTarget(game, unit);
    if (!target) { f.targetId = null; return; }
    if (f.targetId !== target.id) {
      f.targetId = target.id;
      f.aim = TMM.VEHICLES[unit.model].aimSec;
    } else {
      f.aim = Math.max(0, f.aim - gdt);
    }

    const moving = B().isMoving(unit);
    if (!moving && !unit.damage.track) turnToward(unit, target, gdt);

    const veh = TMM.VEHICLES[unit.model];
    if (moving && !veh.canFireOnMove) return;
    if (f.aim > 0 || f.reload > 0) return;

    // 사격
    const ammoId = unit.ammoType;
    unit.ammo[ammoId] -= 1;
    unit.stats.shots += 1;
    f.reload = veh.reloadSec;
    const res = B().resolveShot(game.map, unit, target, ammoId, rand);
    if (res.hit) unit.stats.hits += 1;
    const fresh = D().apply(target, res);
    if (res.destroyed) unit.stats.kills += 1;
    events.push({ type: 'shot', shooter: unit, target, ammoId, res, fresh });
  }

  function update(game, gdt, events) {
    const rand = game.rand || Math.random;
    for (const u of game.units) updateUnit(game, u, gdt, events, rand);
    for (const e of game.enemies) updateUnit(game, e, gdt, events, rand);
  }

  // 패널 표시용: 지금 사격 상태 문구
  function status(game, unit) {
    if (unit.destroyed) return '격파됨';
    if (unit.damage.gun) return '주포 손상 — 사격 불가';
    if (D().totalAmmo(unit) <= 0) return '탄약 없음 — 사격 불가';
    const f = unit.fire;
    if (f.targetId == null) return '표적 없음 (사거리 안에 적 없음)';
    if (B().isMoving(unit) && !TMM.VEHICLES[unit.model].canFireOnMove) return '이동 중 — 정지 후 사격';
    if (f.aim > 0) return '조준 중 ' + Math.ceil(f.aim) + '초';
    if (f.reload > 0) return '장전 중 ' + Math.ceil(f.reload) + '초';
    return '사격 준비 완료';
  }

  return { update, status, chooseTarget, inRange };
})();
