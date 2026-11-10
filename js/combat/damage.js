/*
 * 전차 손상 상태: 전투 필드 초기화, 손상 적용, 상태 문구.
 * 아군·적 전차가 똑같이 쓴다.
 */
TMM.Damage = (function () {
  // 전차 객체에 전투용 필드를 붙인다
  function initCombat(unit, model) {
    const veh = TMM.VEHICLES[model];
    unit.model = model;
    unit.ammo = Object.assign({}, veh.ammoLoad);
    unit.ammoType = veh.ammoTypes[0];
    unit.damage = { track: false, engine: false, gun: false, fcs: false, radio: false };
    unit.destroyed = false;
    unit.targetId = null; // 지정 사격 목표 (플레이어가 지정)
    unit.fire = { targetId: null, aim: 0, reload: 0 }; // 지금 겨누는 표적, 남은 조준·장전 시간
    unit.stats = { shots: 0, hits: 0, kills: 0 };
    return unit;
  }

  const totalAmmo = (u) => Object.values(u.ammo).reduce((s, v) => s + v, 0);
  const canMove = (u) => !u.destroyed && !u.damage.track;
  const canFire = (u) => !u.destroyed && !u.damage.gun && totalAmmo(u) > 0;
  const speedMul = (u) => (u.damage.engine ? TMM.DAMAGE_EFFECT.engineSpeedMul : 1);
  const damagedParts = (u) => TMM.PART_KEYS.filter((k) => u.damage[k]);

  // 판정 결과를 표적에 적용. 새로 손상된 부위 목록을 돌려준다.
  function apply(unit, res) {
    if (res.destroyed) {
      unit.destroyed = true;
      TMM.Movement.stop(unit);
      return [];
    }
    const fresh = res.parts.filter((k) => !unit.damage[k]);
    for (const k of fresh) unit.damage[k] = true;
    if (unit.damage.track && unit.state === 'moving') TMM.Movement.stop(unit);
    return fresh;
  }

  // 짧은 상태 문구: '격파' / '정상' / '궤도·엔진 손상'
  function summary(u) {
    if (u.destroyed) return '격파';
    const parts = damagedParts(u);
    if (!parts.length) return '정상';
    return parts.map((k) => TMM.PARTS[k].name).join('·') + ' 손상';
  }

  // 전투 능력 평가 (소대 현황용)
  function condition(u) {
    if (u.destroyed) return { text: '격파', cls: 'cond-dead' };
    if (u.damage.track && u.damage.gun) return { text: '전투 불능', cls: 'cond-bad' };
    if (u.damage.gun) return { text: '화력 불능', cls: 'cond-bad' };
    if (u.damage.track) return { text: '기동 불능', cls: 'cond-bad' };
    if (damagedParts(u).length) return { text: '부분 손상', cls: 'cond-warn' };
    return { text: '정상', cls: 'cond-ok' };
  }

  return { initCombat, totalAmmo, canMove, canFire, speedMul, damagedParts, apply, summary, condition };
})();
