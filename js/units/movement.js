/*
 * 전차 이동: 이동 명령 처리와 매 프레임 위치 갱신.
 * 속도는 전차가 지금 서 있는 칸의 지형으로 정해진다. 엔진이 손상되면 그 속도에 배수를 곱한다.
 * M4: unit.reverseM 이 남아 있으면 정면을 뒤로 둔 채 후진한다 (철수 명령). 후진은 느리다.
 */
TMM.Movement = (function () {
  const mul = (unit) => (TMM.Damage ? TMM.Damage.speedMul(unit) : 1);

  /**
   * 이동 명령. 반환: { ok, reason?, eta?, meters? }
   */
  function order(map, unit, tx, ty) {
    const info = map.infoAt(tx, ty);
    if (!info) return { ok: false, reason: '작전 지역 밖입니다' };
    if (!info.speed) return { ok: false, reason: info.name + ' 지역은 전차가 들어갈 수 없습니다' };

    const pts = TMM.Path.find(map, { x: unit.x, y: unit.y }, { x: tx, y: ty });
    if (!pts) return { ok: false, reason: '갈 수 있는 경로가 없습니다' };

    const est = TMM.Path.estimate(map, pts);
    est.sec /= mul(unit);
    if (unit.fixedSpeedKmh) est.sec = est.meters / (unit.fixedSpeedKmh / 3.6);
    unit.path = pts.slice(1);
    unit.dest = { x: tx, y: ty };
    unit.state = 'moving';
    return { ok: true, eta: est.sec, meters: est.meters };
  }

  function stop(unit) {
    unit.path = [];
    unit.dest = null;
    unit.state = 'idle';
    unit.speedKmh = 0;
    unit.reverseM = 0;
  }

  /**
   * dt: 게임 시간(초). 목적지에 도착하면 true 반환.
   */
  function update(map, unit, dt) {
    if (unit.state !== 'moving' || !unit.path.length) {
      unit.speedKmh = 0;
      return false;
    }
    let remaining = dt;
    while (remaining > 0 && unit.path.length) {
      const tgt = unit.path[0];
      const dx = tgt.x - unit.x, dy = tgt.y - unit.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) {
        unit.path.shift();
        continue;
      }
      // 통행 불가 칸 모서리를 스칠 때도 멈추지 않도록 최소 속도 보정
      // 보병처럼 지형과 상관없이 같은 속도로 걷는 부대는 fixedSpeedKmh (M3)
      const ms = unit.fixedSpeedKmh ? unit.fixedSpeedKmh / 3.6 : (map.speedMsAt(unit.x, unit.y) || map.maxSpeedMs * 0.15) * mul(unit);
      let v = ms;
      if (unit.reverseM > 0) {
        v *= TMM.RADIO.REVERSE_SPEED_MUL;
        unit.heading = Math.atan2(-dy, -dx);
      } else unit.heading = Math.atan2(dy, dx);
      unit.speedKmh = v * 3.6;
      const cellsPerSec = v / map.metersPerCell;
      const step = Math.min(cellsPerSec * remaining, dist);
      if (unit.reverseM > 0) unit.reverseM = Math.max(0, unit.reverseM - step * map.metersPerCell);
      if (step >= dist) {
        unit.x = tgt.x;
        unit.y = tgt.y;
        remaining -= dist / cellsPerSec;
        unit.path.shift();
      } else {
        unit.x += (dx / dist) * step;
        unit.y += (dy / dist) * step;
        remaining = 0;
      }
    }
    if (!unit.path.length) {
      stop(unit);
      return true;
    }
    return false;
  }

  // 남은 경로의 거리(m)와 시간(게임 초)
  function remaining(map, unit) {
    if (unit.state !== 'moving') return null;
    const est = TMM.Path.estimate(map, [{ x: unit.x, y: unit.y }].concat(unit.path));
    est.sec /= mul(unit);
    if (unit.fixedSpeedKmh) est.sec = est.meters / (unit.fixedSpeedKmh / 3.6);
    return est;
  }

  return { order, stop, update, remaining };
})();
