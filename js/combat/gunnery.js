/*
 * 사격 통제: 매 프레임 모든 전차의 표적 선택 → 조준 → 장전 → 사격을 처리한다.
 *
 *   - 쏘려면 그 전차가 표적을 '직접' 봐야 한다 (M3 시야). 소대가 공유한 접촉이라도 안 보이면 못 쏜다.
 *   - 플레이어가 지정한 사격 목표(unit.targetId)가 보이고 사거리 안이면 그 표적을 쏜다.
 *     식별 전(미상 표적)이어도 지정하면 쏜다 → 오인사격 위험. 쏘기 전에 아군으로 식별되면 사격을 멈춘다.
 *   - 지정 목표가 없거나 쏠 수 없으면, '적으로 식별된' 보이는 표적 중 전차를 먼저, 가까운 것부터 자동 교전한다
 *     (자유 사격은 2km 안에서만. 더 먼 표적은 플레이어가 지정해야 쏜다).
 *     미상 표적은 자동으로 쏘지 않는다.
 *   - 표적이 바뀌면 조준 시간(aimSec)이 다시 필요하다. 한 발 쏘면 장전 시간(reloadSec).
 *   - 정지 중이면 차체 정면을 표적 쪽으로 천천히 돌린다 (정면 장갑으로 받기 위해).
 *     M3: 아군 전차는 플레이어가 지정한 표적일 때만 차체를 돌린다. 자동 교전은 포탑만 돌아간다.
 *
 * M4 사격 통제 (아군 소대 전차의 unit.roe, TMM.RADIO.ROE):
 *   hold 사격 금지 — 스스로 쏘지 않는다. 지정 목표(목표 지정 명령)만 쏜다.
 *   id   식별 후 사격 — 위의 기본 규칙 (적으로 식별된 표적, 2km 안)
 *   free 자유 사격 — 식별된 적은 사거리 끝까지, 미상 표적도 1.5km 안이면 쏜다 (오인사격 위험)
 *
 * 사격 결과는 events 배열에 { type: 'shot', shooter, target, ammoId, res, fresh } 로 쌓아
 * main.js 가 무전 기록과 화면 효과로 바꾼다.
 */
TMM.Gunnery = (function () {
  const B = () => TMM.Ballistics;
  const D = () => TMM.Damage;
  const I = () => TMM.Intel;

  function allTargets(game, unit) {
    return unit.side === 'friend' ? game.enemies.concat(game.allies) : game.units.concat(game.allies);
  }

  function findUnit(game, id) {
    return game.enemies.find((e) => e.id === id) || game.allies.find((a) => a.id === id) || game.units.find((u) => u.id === id) || null;
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

  // M7a: 새 표적을 잡을 때 승무원이 탄종을 고른다 — 가려진 표적·차체 엄폐 표적이 2km 안이면 고폭탄, 아니면 철갑탄.
  // 소대장이 Q 로 직접 바꾼 1호차는 2분 동안 그대로 둔다(ammoPinnedUntil). 탄을 바꿔 넣는 시간은 새 표적 조준 시간에 포함.
  const choosesAmmo = (game, unit) => unit.side === 'friend' && !unit.ally && unit.model === 'K1A2' && !(unit.ammoPinnedUntil != null && game.gameSeconds < unit.ammoPinnedUntil);
  // 표적을 고를 때 쓰는 사거리: 탄종을 스스로 고르는 전차는 남은 탄 중 가장 긴 사거리
  function reach(game, unit) {
    if (!choosesAmmo(game, unit)) return TMM.AMMO[unit.ammoType].rangeM;
    let r = 0;
    for (const k of TMM.VEHICLES[unit.model].ammoTypes) if (unit.ammo[k] > 0) r = Math.max(r, TMM.AMMO[k].rangeM);
    return r || TMM.AMMO[unit.ammoType].rangeM;
  }
  function pickAmmo(game, unit, target) {
    if (!choosesAmmo(game, unit)) return;
    const d = B().distanceM(game.map, unit, target);
    const m = I().fireMods(game, unit, target);
    const tank = TMM.VEHICLES[target.model].cls === 'tank';
    let want = tank && (m.hullDown || m.obs >= 0.25) && d <= 2000 ? 'K277' : tank ? 'K276' : 'K277';
    if (d > TMM.AMMO[want].rangeM || unit.ammo[want] <= 0) want = want === 'K277' ? 'K276' : 'K277';
    if (unit.ammo[want] > 0 && d <= TMM.AMMO[want].rangeM) unit.ammoType = want;
  }

  // 자동 교전 우선순위: 전차 > 트럭 > 보병 (적은 보병에 철갑탄을 쓰지 않는다)
  const CLS_RANK = { tank: 0, truck: 1, infantry: 2 };
  const SOFT_MAX_M = 1500;
  // 자유 사격(자동 교전) 최대 거리 (게임용 추정치). 먼 표적에 탄을 낭비하지 않는다. 지정 사격은 사거리 끝까지.
  const FREE_FIRE_M = { friend: 2000, enemy: 2000 }; // 적이 트럭을 쏘는 최대 거리 (게임용 추정치)

  // 이번 프레임에 겨눌 표적
  function chooseTarget(game, unit, events) {
    const side = unit.side;
    if (unit.targetId != null) {
      const t = findUnit(game, unit.targetId);
      const c = t ? I().contact(game, side, t.id) : null;
      if (!t || t.destroyed || t.exited) unit.targetId = null; // 지정 목표가 격파됨·사라짐
      else if (c && c.identified && c.kind === 'friendly') {
        unit.targetId = null;
        if (events) events.push({ type: 'cease-fire', unit, target: t, contact: c });
      } else if (I().sees(game, unit, t) && B().distanceM(game.map, unit, t) <= reach(game, unit)) return t;
    }
    const roe = side === 'friend' && unit.roe ? unit.roe : 'id';
    if (roe === 'hold') return null; // 사격 금지: 지정 목표만
    let best = null, bestKey = Infinity;
    for (const t of allTargets(game, unit)) {
      if (t.destroyed || t.exited) continue;
      const c = I().contact(game, side, t.id);
      // M5: 3호차 윤지호 하사는 긴장해서 식별이 거의 끝난 미상 표적을 먼저 쏠 때가 있다 (조기 사격)
      const early = roe === 'id' && side === 'friend' && unit.crew && c && !c.identified && TMM.Crew.earlyFire(game, unit, c, B().distanceM(game.map, unit, t));
      const unknown = (roe === 'free' || early) && c && !c.identified;
      if (!unknown && !I().isHostile(c)) continue;
      const cls = TMM.VEHICLES[t.model].cls;
      if (side === 'enemy' && cls === 'infantry') continue;
      if (!I().sees(game, unit, t)) continue;
      const d = B().distanceM(game.map, unit, t);
      if (d > reach(game, unit)) continue;
      if (unknown) {
        // 자유 사격: 미상 표적도 쏜다 (식별된 적보다 뒤 순위). 정체를 모르므로 종류로 고르지 않는다.
        if (d > TMM.RADIO.FREE_UNKNOWN_M) continue;
        const key = 5e6 + d;
        if (key < bestKey) { best = t; bestKey = key; }
        continue;
      }
      if (roe !== 'free' && d > FREE_FIRE_M[side]) continue; // 자유 사격(자동 교전)은 이 거리 안에서만 (더 먼 표적은 지정해야 쏜다)
      if (unit.ai && unit.ai.fireM && d > unit.ai.fireM) continue; // M7a: 진지 방어 적의 매복 — 이 거리 안에 들어올 때까지 숨죽인다
      if (side === 'enemy' && cls !== 'tank' && d > SOFT_MAX_M) continue; // 적은 먼 트럭에 귀한 철갑탄을 쓰지 않는다
      let key = CLS_RANK[cls] * 1e6 + d;
      // 적 포수는 옆구리·뒤를 보이는 전차를 먼저 노린다 (정면은 안 뚫리므로) — 정면이면 1km 더 먼 것처럼 친다
      if (side === 'enemy' && B().aspect(t, unit) === 'front') key += 1000;
      if (key < bestKey) { best = t; bestKey = key; }
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

  /**
   * 한 발 쏘기 (자동 사격과 M6 조준 화면의 수동 사격이 같이 쓴다).
   * mods: Intel.fireMods 결과 (수동 사격이면 mods.manual 포함). 반환: 판정 결과 res
   */
  function fireAt(game, unit, target, rand, events, mods) {
    const veh = TMM.VEHICLES[unit.model];
    const ammoId = unit.ammoType;
    const c = I().contact(game, unit.side, target.id);
    const unidentified = !c || !c.identified;
    unit.ammo[ammoId] -= 1;
    unit.stats.shots += 1;
    unit.lastFiredAt = game.gameSeconds;
    unit.fire.reload = veh.reloadSec * (TMM.Crew ? TMM.Crew.reloadMul(unit) : 1); // M5: 탄약수
    const res = B().resolveShot(game.map, unit, target, ammoId, rand, mods || I().fireMods(game, unit, target));
    if (res.hit) unit.stats.hits += 1;
    const fresh = D().apply(target, res);
    const friendlyFire = target.side === unit.side;
    if (res.destroyed && !friendlyFire) unit.stats.kills += 1;
    if (mods && mods.manual) {
      // M6: 조준 화면에서 직접 쏜 기록 (결과 화면)
      const m = unit.stats.manual || (unit.stats.manual = { shots: 0, hits: 0, kills: 0 });
      m.shots += 1;
      if (res.hit) m.hits += 1;
      if (res.destroyed && !friendlyFire) m.kills += 1;
    }
    if (friendlyFire) {
      // 오인사격: 맞았든 빗나갔든 아군이 무전으로 외친다 → 정체가 드러나고 지정 목표 해제
      unit.targetId = null;
      unit.fire.targetId = null;
      I().reveal(game, unit.side, target, null, 'ff');
    }
    if (TMM.Crew && unit.crew) TMM.Crew.afterShot(game, unit, res, events); // M5: 성장·탄종 실수
    events.push({ type: 'shot', shooter: unit, target, ammoId, res, fresh, unidentified, friendlyFire, manual: !!(mods && mods.manual) });
    return res;
  }

  function updateUnit(game, unit, gdt, events, rand) {
    const f = unit.fire;
    f.reload = Math.max(0, f.reload - gdt);
    if (unit.destroyed || unit.exited || unit.damage.gun) { f.targetId = null; return; }
    // M6: 소대장이 조준 화면에 있으면 1호차는 수동 사격 (TMM.Scope.fire). 포수 자동 사격은 쉰다.
    if (TMM.Scope && TMM.Scope.isManual(game, unit)) { f.targetId = null; return; }
    if (!ensureAmmo(unit, events)) { f.targetId = null; return; }

    const target = chooseTarget(game, unit, events);
    if (!target) { f.targetId = null; return; }
    if (f.targetId !== target.id || B().distanceM(game.map, unit, target) > TMM.AMMO[unit.ammoType].rangeM) {
      pickAmmo(game, unit, target);
      if (B().distanceM(game.map, unit, target) > TMM.AMMO[unit.ammoType].rangeM) { f.targetId = null; return; }
    }
    if (f.targetId !== target.id) {
      f.targetId = target.id;
      // M5: 포수 실력. M6: 1호차는 소대장이 지도를 보는 동안 포수 혼자 표적을 잡아 느리다
      f.aim = TMM.VEHICLES[unit.model].aimSec * (TMM.Crew ? TMM.Crew.aimMul(unit) : 1) * (TMM.Scope ? TMM.Scope.autoAimMul(game, unit) : 1);
    } else {
      f.aim = Math.max(0, f.aim - gdt);
    }

    const moving = B().isMoving(unit);
    // 정지 중 차체 정면을 표적 쪽으로 돌린다 (정면 장갑으로 받기 위해).
    // 아군은 플레이어가 '지정한' 표적에만 차체를 돌리고, 자동 교전 때는 포탑만 돌린다 (M3).
    // 적 AI 는 항상 차체를 돌린다.
    const faceHull = unit.side === 'enemy' || unit.targetId === target.id;
    if (!moving && !unit.damage.track && faceHull) turnToward(unit, target, gdt);

    const veh = TMM.VEHICLES[unit.model];
    if (moving && !veh.canFireOnMove) return;
    if (f.aim > 0 || f.reload > 0) return;

    const mods = I().fireMods(game, unit, target);
    if (TMM.Scope) mods.autoMul = TMM.Scope.autoHitMul(game, unit); // M6: 지도 화면의 1호차 포수 혼자
    fireAt(game, unit, target, rand, events, mods);
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
    if (TMM.Scope && TMM.Scope.isManual(game, unit)) return f.reload > 0 ? '수동 사격 · 장전 중 ' + Math.ceil(f.reload) + '초' : '수동 사격 · 장전 완료 (조준 화면)';
    if (f.targetId == null) {
      if (unit.targetId != null) return '지정 목표가 보이지 않거나 사거리 밖';
      return '표적 없음 (보이는 적 없음)';
    }
    if (B().isMoving(unit) && !TMM.VEHICLES[unit.model].canFireOnMove) return '이동 중 — 정지 후 사격';
    if (f.aim > 0) return '조준 중 ' + Math.ceil(f.aim) + '초';
    if (f.reload > 0) return '장전 중 ' + Math.ceil(f.reload) + '초';
    return '사격 준비 완료';
  }

  return { update, status, chooseTarget, inRange, findUnit, fireAt, ensureAmmo };
})();
