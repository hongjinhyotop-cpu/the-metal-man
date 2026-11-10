/*
 * M8a 천마-20 의 불새-3 대전차미사일. DOM 없음 → 모의 전투에서도 같은 규칙.
 *
 *   - 천마-20 은 멈춰 있을 때, 자기 눈으로 보이는 아군 전차가 1.2~4.5km 에 있으면 미사일을 쏜다 (포는 그동안 쉰다).
 *   - 미사일은 느리다 (약 120m/s → 1.5km 에 13초, 3km 에 25초). 날아가는 내내 쏜 쪽이 표적을 봐야 한다(유도).
 *     표적이 능선·숲·건물 뒤로 빠지거나 연막에 들어가면 1초 뒤 유도가 끊겨 빗나간다. 쏜 전차가 격파돼도 빗나간다.
 *   - 발사 섬광은 크게 보인다. 아군 누군가 발사를 보면 1~2초 뒤 "미사일!" 경고(missile-warn) — 무전 기록·지도에 표시.
 *     무전을 받는 전차(2·3·4호차)의 전차장은 스스로 연막을 칠 때가 있다(AUTO_SMOKE_P). 1호차는 소대장이 정한다.
 *   - 끝까지 유도되면 Ballistics.resolveShot 으로 명중·관통 판정 (탄 'ATGM', 관통표 weapons.js).
 *
 * game.missiles = [{ id, from(천마-20), target, sx, sy, x, y, flown, at, lostFor, lost, seen, warnAt, warned }]
 * 사건: missile-launch · missile-warn · missile-miss · (명중하면) shot
 * 숫자는 모두 게임용 추정치 — TMM.MISSILE 만 고치면 된다.
 */
TMM.MISSILE = {
  COOLDOWN_SEC: 28, // 한 발 끝나고 다음 발까지 (재장전·표적 찾기)
  FIRST_DELAY_SEC: 25, // 표적을 처음 본 뒤 첫 발까지 (조준·확인)
  WARN_SEC: [1, 2], // 발사를 본 뒤 승무원이 "미사일!" 외칠 때까지
  LOST_SEC: 1.0, // 유도가 이만큼 끊기면 빗나감
  AUTO_SMOKE_P: 0.3, // 무전 받는 전차의 전차장이 스스로 연막을 칠 확률 (× 전차장 판단력)
  AUTO_SMOKE_SEC: [1.5, 3.5],
};

TMM.Missiles = (function () {
  const K = () => TMM.MISSILE;
  const A = () => TMM.AMMO.ATGM;
  const between = (game, r) => r[0] + game.rand() * (r[1] - r[0]);
  let nextId = 1;

  function init(game) {
    game.missiles = [];
    game.missileStats = { n: 0, lost: 0 }; // 결과 화면: 날아온 미사일 수·유도가 끊겨 빗나간 수
  }

  const friendTargets = (game) => game.units.filter((u) => !u.destroyed).concat(game.allies.filter((a) => a.support && !a.destroyed && !a.exited));

  function chooseTarget(game, e) {
    const mpc = game.map.metersPerCell;
    let best = null, bd = Infinity;
    for (const t of friendTargets(game)) {
      const c = TMM.Intel.contact(game, 'enemy', t.id);
      if (!c || !c.identified || c.kind !== 'hostile') continue;
      if (!TMM.Intel.sees(game, e, t)) continue;
      const d = Math.hypot(t.x - e.x, t.y - e.y) * mpc;
      if (d < A().minM || d > A().rangeM) continue;
      // 이미 다른 미사일이 노리는 전차는 뒤로
      const key = d + (game.missiles.some((m) => m.target === t) ? 3000 : 0);
      if (key < bd) { bd = key; best = t; }
    }
    return best;
  }

  // 유도 가능: 쏜 전차가 살아 있고, 표적까지 시선이 트이고, 연막이 없음
  function guided(game, m) {
    const e = m.from, t = m.target;
    if (e.destroyed || e.damage.fcs && game.rand() < 0.02) return false;
    if (t.destroyed) return false;
    if (!TMM.Sight.line(game.map, e, t).clear) return false;
    if (TMM.Smoke && TMM.Smoke.blocks(game, e, t)) return false;
    return true;
  }

  function launch(game, e, t, events) {
    const m = {
      id: nextId++, from: e, target: t, sx: e.x, sy: e.y, x: e.x, y: e.y, flown: 0, at: game.gameSeconds,
      lostFor: 0, lost: false, seen: false, warnAt: null, warned: false,
    };
    e.missiles -= 1;
    e.guiding = m;
    e.lastFiredAt = game.gameSeconds; // 발사 섬광 → 잘 보인다
    TMM.Movement.stop(e);
    // 아군(소대·흑표) 누군가 발사를 볼 수 있으면 경고
    const obs = game.units.filter((u) => !u.destroyed).concat(game.allies.filter((a) => a.support && !a.destroyed && !a.exited));
    m.seen = obs.some((o) => !o.damage.radio && TMM.SENSORS[o.model] && TMM.Intel.pairVis(game, o, e));
    if (m.seen) m.warnAt = game.gameSeconds + between(game, K().WARN_SEC);
    game.missiles.push(m);
    game.missileStats.n += 1;
    events.push({ type: 'missile-launch', missile: m });
  }

  // 남은 비행 시간 (게임 초)
  function eta(game, m) {
    const d = Math.hypot(m.target.x - m.x, m.target.y - m.y) * game.map.metersPerCell;
    return d / A().speedMs;
  }

  function finish(game, m, events, why) {
    m.done = true;
    if (m.from.guiding === m) m.from.guiding = null;
    m.from.missileCd = game.gameSeconds + K().COOLDOWN_SEC;
    if (why) events.push({ type: 'missile-miss', missile: m, why });
  }

  function impact(game, m, events) {
    const e = m.from, t = m.target;
    if (t.destroyed) return finish(game, m, events, 'gone');
    const mods = TMM.Intel.fireMods(game, e, t);
    mods.obs = 0;
    const res = TMM.Ballistics.resolveShot(game.map, e, t, 'ATGM', game.rand, mods);
    finish(game, m, null);
    if (!res.hit) return events.push({ type: 'missile-miss', missile: m, why: 'miss' });
    e.stats.shots += 1;
    e.stats.hits += 1;
    const fresh = TMM.Damage.apply(t, res);
    if (res.destroyed) e.stats.kills += 1;
    events.push({ type: 'shot', shooter: e, target: t, ammoId: 'ATGM', res, fresh, unidentified: false, friendlyFire: false, manual: false, missile: true });
  }

  function autoSmoke(game, m, events) {
    const t = m.target;
    if (!t.crew || t.destroyed || !(t.smoke > 0) || t.ally) return;
    if (t === TMM.Radio.controlUnit(game)) return; // 1호차는 소대장이 정한다
    if (game.rand() >= K().AUTO_SMOKE_P * TMM.RADIO.crewFactor(t, 'initiative')) return;
    m.autoSmokeAt = game.gameSeconds + between(game, K().AUTO_SMOKE_SEC);
  }

  function update(game, gdt, events) {
    if (!game.missiles) return;
    const now = game.gameSeconds;
    // 발사
    for (const e of game.enemies) {
      if (!(e.missiles > 0) || e.destroyed || e.exited || e.guiding || e.state === 'moving' || e.ai.pending) continue;
      if (e.ai.mode === 'withdraw' || e.ai.mode === 'retreat') continue;
      if (e.missileCd != null && now < e.missileCd) continue;
      const t = chooseTarget(game, e);
      if (!t) { e.missileSeen = null; continue; }
      if (e.missileSeen == null) { e.missileSeen = now; continue; }
      if (now - e.missileSeen < K().FIRST_DELAY_SEC && e.missileCd == null) continue;
      launch(game, e, t, events);
    }
    // 비행
    for (const m of game.missiles) {
      if (m.done) continue;
      const t = m.target;
      if (m.warnAt != null && !m.warned && now >= m.warnAt) {
        m.warned = true;
        events.push({ type: 'missile-warn', missile: m, eta: eta(game, m) });
        autoSmoke(game, m, events);
      }
      if (m.autoSmokeAt != null && now >= m.autoSmokeAt) {
        m.autoSmokeAt = null;
        if (TMM.Smoke.deploy(game, t, events).ok) TMM.Radio.report(game, t, '미사일! 연막 친다!', { prio: 3, kind: 'warn', delay: 0.5 }, events);
      }
      if (!m.lost) {
        if (guided(game, m)) m.lostFor = 0;
        else {
          m.lostFor += gdt;
          if (m.from.destroyed || t.destroyed || m.lostFor >= K().LOST_SEC) {
            m.lost = true;
            game.missileStats.lost += 1;
            m.lostWhy = t.destroyed ? 'gone' : m.from.destroyed ? 'launcher' : TMM.Smoke.covers(game, t) || TMM.Smoke.blocks(game, m.from, t) ? 'smoke' : 'cover';
            if (m.from.guiding === m) m.from.guiding = null;
          }
        }
      }
      // 앞으로 날아간다 (유도 중이면 표적 쪽으로, 끊기면 그대로 직진)
      const step = (A().speedMs * gdt) / game.map.metersPerCell;
      const tx = m.lost ? m.x + (m.vx || 0) : t.x, ty = m.lost ? m.y + (m.vy || 0) : t.y;
      const dx = tx - m.x, dy = ty - m.y, L = Math.hypot(dx, dy) || 1e-9;
      if (!m.lost) { m.vx = dx / L; m.vy = dy / L; }
      m.flown += step * game.map.metersPerCell;
      if (!m.lost && L <= step) { m.x = t.x; m.y = t.y; impact(game, m, events); continue; }
      m.x += (m.lost ? m.vx || 0 : dx / L) * step;
      m.y += (m.lost ? m.vy || 0 : dy / L) * step;
      if (m.lost && (m.flown >= A().rangeM || Math.hypot(t.x - m.x, t.y - m.y) * game.map.metersPerCell < 30 || m.flown > Math.hypot(t.x - m.sx, t.y - m.sy) * game.map.metersPerCell + 400)) {
        finish(game, m, events, m.lostWhy || 'cover');
      }
    }
    if (game.missiles.length > 12) game.missiles = game.missiles.filter((m) => !m.done || now - m.at < 30);
  }

  const active = (game) => !!game.missiles && game.missiles.some((m) => !m.done);

  return { init, update, eta, active };
})();
