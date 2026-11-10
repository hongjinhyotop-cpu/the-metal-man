/*
 * 명중·관통·손상 판정.
 * 한 발을 쏘면: 명중 판정 → 관통 판정 → 부위 손상/격파 판정 순으로 주사위를 굴린다.
 * 수치는 weapons.js 의 표를 쓴다.
 */
TMM.Ballistics = (function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // [[x, y], ...] 곡선 직선 보간
  function curve(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (x <= x1) {
        const [x0, y0] = points[i - 1];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return points[points.length - 1][1];
  }

  function distanceM(map, a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) * map.metersPerCell;
  }

  function isMoving(u) {
    return u.state === 'moving';
  }

  // 표적이 맞는 면: 표적 차체 방향과 '표적→사수' 방향의 각도 차
  function aspect(target, shooter) {
    const toShooter = Math.atan2(shooter.y - target.y, shooter.x - target.x);
    let d = Math.abs(toShooter - target.heading) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    const deg = (d * 180) / Math.PI;
    if (deg <= 50) return 'front';
    if (deg >= 130) return 'rear';
    return 'side';
  }
  const ASPECT_NAMES = { front: '정면', side: '측면', rear: '후면', top: '상부' }; // M8a top: 자폭 드론·포병 직격

  /**
   * 명중 확률. mods (M3, TMM.Intel.fireMods 가 만듦):
   *   { obs: 가림 정도 0~1+, hullDown: 차체 엄폐, light: 'day'|'night' }
   *   M6: manual { mul, lead } — 조준 화면 수동 사격 (TMM.Scope), autoMul — 지도 화면의 1호차 포수 혼자
   */
  function hitChance(map, shooter, target, ammoId, mods) {
    const ammo = TMM.AMMO[ammoId];
    const veh = TMM.VEHICLES[shooter.model];
    const d = distanceM(map, shooter, target);
    let p = curve(ammo.hit, d);
    if (veh.hitMul && d > 1000) p *= 1 + (veh.hitMul - 1) * Math.min(1, (d - 1000) / 1000); // M7b: K2 55구경장은 원거리에서 낫다
    if (isMoving(shooter)) p *= veh.moveFireMul;
    const manual = mods && mods.manual; // M6: 조준 화면 수동 사격
    // 움직이는 표적: 레이저로 잰 수동 사격은 사격통제장치가 리드를 자동 계산한다
    if (isMoving(target)) p *= manual && manual.lead ? veh.targetMoveMul + (TMM.SCOPE.LEAD_MOVE_MUL - veh.targetMoveMul) * manual.lead : veh.targetMoveMul;
    if (shooter.damage.fcs) p *= TMM.DAMAGE_EFFECT.fcsHitMul;
    p *= TMM.VEHICLES[target.model].size || 1;
    if (manual) p *= manual.mul; // M6: 포수 실력 대신 플레이어의 조준 품질 (TMM.Scope.quality)
    else if (shooter.crew && TMM.Crew) p *= TMM.Crew.hitMul(shooter, d); // M5: 포수 실력
    if (mods && mods.autoMul) p *= mods.autoMul; // M6: 지도 화면에 있는 동안 1호차 포수 혼자
    if (mods) {
      const V = TMM.VISION;
      // M7a: 고폭탄은 가림·차체 엄폐의 영향을 덜 받는다 (weapons.js 의 obsPenaltyMul·hullDownHit)
      if (mods.hullDown) p *= ammo.hullDownHit || V.HULL_DOWN_HIT;
      if (mods.obs) p *= 1 - V.OBS_HIT * (ammo.obsPenaltyMul != null ? ammo.obsPenaltyMul : 1) * Math.min(1, mods.obs);
      const sens = TMM.SENSORS[shooter.model];
      if (sens && mods.light) p *= sens[mods.light].hitMul;
    }
    return clamp(p, 0.02, 0.97);
  }

  function penChance(map, shooter, target, ammoId, asp) {
    const tbl = TMM.PENETRATION[ammoId][target.model];
    const [near, far] = tbl[asp];
    const d = distanceM(map, shooter, target);
    const t = clamp((d - 500) / Math.max(1, TMM.AMMO[ammoId].rangeM - 500), 0, 1);
    return near + (far - near) * t;
  }

  // 맞은 면에 따라 손상되기 쉬운 부위 (가중치, 게임용 추정치)
  const WEIGHTS_PEN = {
    front: { gun: 3, fcs: 3, radio: 1, track: 1, engine: 0 },
    side: { track: 4, engine: 1, gun: 1, fcs: 1, radio: 1 },
    rear: { engine: 5, track: 2, radio: 1, gun: 0, fcs: 0 },
  };
  const WEIGHTS_EXT = {
    front: { fcs: 2, gun: 1, radio: 2, track: 1, engine: 0 },
    side: { track: 4, radio: 1, fcs: 0, gun: 0, engine: 0 },
    rear: { track: 2, engine: 1, radio: 1, fcs: 0, gun: 0 },
  };

  function pickPart(target, weights, rand) {
    const opts = TMM.PART_KEYS.filter((k) => !target.damage[k] && weights[k] > 0);
    if (!opts.length) return null;
    const total = opts.reduce((s, k) => s + weights[k], 0);
    let r = rand() * total;
    for (const k of opts) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return opts[opts.length - 1];
  }

  /**
   * 한 발 판정. 표적 상태는 바꾸지 않고 결과만 돌려준다.
   * 반환: { distM, pHit, hit, aspect, pPen, pen, destroyed, parts: [부위키...] }
   */
  function resolveShot(map, shooter, target, ammoId, rand, mods) {
    const res = { distM: distanceM(map, shooter, target), aspect: aspect(target, shooter), parts: [], destroyed: false, pen: false, hit: false };
    res.pHit = hitChance(map, shooter, target, ammoId, mods);
    res.hit = rand() < res.pHit;
    if (!res.hit) return res;

    const ammo = TMM.AMMO[ammoId];
    const tveh = TMM.VEHICLES[target.model];
    if (tveh.soft) {
      // 트럭·보병: 장갑이 없다. 파괴(전투력 상실) 아니면 사상자·손상(hurt). 두 번째 피해는 파괴.
      res.pen = true;
      if (target.hurt || rand() < tveh.killOnPen) res.destroyed = true;
      else res.hurt = true;
      return res;
    }
    res.pPen = penChance(map, shooter, target, ammoId, res.aspect);
    res.pen = rand() < res.pPen;
    if (res.pen) {
      const kill = tveh.killOnPen * ammo.killMul;
      if (rand() < kill) {
        res.destroyed = true;
        return res;
      }
      const p1 = pickPart(target, WEIGHTS_PEN[res.aspect], rand);
      if (!p1) {
        // 더 망가질 곳이 없으면 격파
        res.destroyed = true;
        return res;
      }
      res.parts.push(p1);
      if (rand() < 0.4) {
        const tmp = Object.assign({}, target, { damage: Object.assign({}, target.damage, { [p1]: true }) });
        const p2 = pickPart(tmp, WEIGHTS_PEN[res.aspect], rand);
        if (p2) res.parts.push(p2);
      }
    } else if (rand() < ammo.externalDamage) {
      const p = pickPart(target, WEIGHTS_EXT[res.aspect], rand);
      if (p) res.parts.push(p);
    }
    return res;
  }

  return { curve, distanceM, isMoving, aspect, ASPECT_NAMES, hitChance, penChance, resolveShot };
})();
