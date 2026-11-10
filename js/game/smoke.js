/*
 * M8a 연막 (우리 편 기능). DOM 없음 → 모의 전투에서도 같은 규칙.
 *
 *   - 소대 전차(K1A2·K2)마다 작전당 2회. 재정비(다음 작전)에서 다시 채워진다.
 *   - '연막' 명령(orders.js 의 type 'smoke'): 1호차(지휘 전차)는 바로, 2·3·4호차는 무전으로 받는다.
 *   - 전차 앞(위협 쪽)으로 연막탄을 던져, 전차를 감싸는 둥근 연막이 잠시 생긴다.
 *     연막을 지나는 시선은 모두 가린다(intel.js pairVis) → 그 안의 전차는 보이지도, 쏘지도 못한다.
 *     날아오는 미사일은 유도가 끊기고(missiles.js), 자폭 드론·정찰 드론도 잘 못 본다(indirect.js).
 *
 * game.smoke = [{ x, y, r(칸), born, until, by }]   unit.smoke = 남은 횟수
 * 숫자는 모두 게임용 추정치이며 TMM.SMOKE 만 고치면 된다.
 */
TMM.SMOKE = {
  CHARGES: 2, // 작전당 연막 횟수
  AHEAD_M: 45, // 연막 중심: 전차에서 위협 쪽으로 이만큼
  RADIUS_M: 95, // 다 퍼졌을 때 반지름
  GROW_SEC: 4, // 다 퍼지는 데 걸리는 시간 (게임 초)
  LAST_SEC: 80, // 연막이 버티는 시간
  FADE_SEC: 12, // 끝나기 전 이만큼은 옅어진다 (시선은 계속 가림)
};

TMM.Smoke = (function () {
  const K = () => TMM.SMOKE;

  function init(game) {
    game.smoke = [];
    for (const u of game.units) u.smoke = K().CHARGES;
  }

  // 연막을 던질 방향: 지켜보는 방향 → 가장 가까운 아는 적 → 차체 방향
  function facing(game, u) {
    if (u.watch != null) return u.watch;
    let best = null, bd = Infinity;
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.known || c.wreck || c.kind === 'friendly') continue;
      const d = Math.hypot(c.lastX - u.x, c.lastY - u.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? Math.atan2(best.lastY - u.y, best.lastX - u.x) : u.heading;
  }

  // 전차 u 가 연막을 친다. 반환: { ok, reason? }
  function deploy(game, u, events) {
    if (u.destroyed) return { ok: false, reason: '격파됨' };
    if (!(u.smoke > 0)) return { ok: false, reason: '연막탄 소진' };
    u.smoke -= 1;
    const mpc = game.map.metersPerCell;
    const a = facing(game, u);
    const cloud = {
      x: u.x + (Math.cos(a) * K().AHEAD_M) / mpc,
      y: u.y + (Math.sin(a) * K().AHEAD_M) / mpc,
      r: K().RADIUS_M / mpc,
      born: game.gameSeconds,
      until: game.gameSeconds + K().LAST_SEC,
      by: u.id,
    };
    game.smoke.push(cloud);
    if (events) events.push({ type: 'smoke', unit: u, cloud });
    return { ok: true };
  }

  // 지금 반지름 (칸): 처음 몇 초는 퍼지는 중
  function radius(game, c) {
    const k = Math.min(1, (game.gameSeconds - c.born) / K().GROW_SEC);
    return c.r * (0.45 + 0.55 * k);
  }

  // 선분 a→b 가 연막 원을 지나는가 (한쪽 끝이 연막 안이어도 가림)
  function segHits(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L2));
    const px = ax + dx * t - cx, py = ay + dy * t - cy;
    return px * px + py * py <= r * r;
  }

  function blocks(game, a, b) {
    const list = game.smoke;
    if (!list || !list.length) return false;
    for (const c of list) {
      if (game.gameSeconds >= c.until) continue;
      if (segHits(a.x, a.y, b.x, b.y, c.x, c.y, radius(game, c))) return true;
    }
    return false;
  }

  // 지점이 연막 안인가
  function covers(game, p) {
    if (!game.smoke) return false;
    for (const c of game.smoke) {
      if (game.gameSeconds < c.until && Math.hypot(p.x - c.x, p.y - c.y) <= radius(game, c)) return true;
    }
    return false;
  }

  function update(game) {
    if (game.smoke && game.smoke.length) game.smoke = game.smoke.filter((c) => game.gameSeconds < c.until);
  }

  return { init, deploy, blocks, covers, radius, update };
})();
