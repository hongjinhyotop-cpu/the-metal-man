/*
 * 1호차 조준 화면의 규칙 (M6). 화면(DOM)이 없어도 돌아가므로 모의 전투에서도 쓴다.
 * 그리기는 js/render/scope-view.js, 입력 연결은 main.js·input.js.
 *
 * 핵심: 소대장은 1호차 전차장이기도 하다.
 *   - 조준 화면(game.scope.open)에 있는 동안 1호차는 '수동 사격'. 포수의 자동 사격이 꺼지고 플레이어가 직접 쏜다.
 *     무전 명령은 못 내리고 소대 사격 통제(8·9·0)와 상황 보고 요구(R)만 단축키로 된다 (main.js).
 *   - 지도 화면에 있는 동안 1호차는 김태윤 상병(포수)이 알아서 싸운다.
 *     전차장이 표적을 잡아 주지 않으므로 조준이 느리고 명중이 조금 낮다 (AUTO_AIM_MUL·AUTO_HIT_MUL).
 *
 * 각도: 지도와 같은 약속 (라디안, 0 = 동쪽, +π/2 = 남쪽). 나침반 방위각(북 0°, 시계 방향) = 각도 + 90°.
 * 조준선 위치(rx, ry)는 '화면 너비' 단위의 비율: 각도 = 비율 × 시야각(fov). rx 는 화면 가운데에서 오른쪽 +,
 * ry 는 지평선 높이에서 위쪽 +. 그래서 화면 크기와 상관없이 같은 규칙으로 계산한다.
 *
 * 수동 사격 명중 (Ballistics.hitChance 의 mods.manual):
 *   포수 실력(Crew.hitMul) 대신 '조준 품질'을 곱한다.
 *   조준 품질 = 거리 측정(레이저면 ×1, 눈대중이면 거리에 따라 ×0.95~0.4) × 조준 안정(막 올렸을 때 ×0.7 → 유지하면 ×1.2)
 *             × (조준선이 표적에서 살짝 벗어나 있으면 ×0.3)
 *   조준경에 붙어 있는 동안 1호차는 조준경 시야(+12°) 밖을 잠망경으로만 본다: 탐지 거리 ×0.35 (주의력 배분).
 *   레이저로 잰 표적은 사격통제장치가 리드(움직이는 표적의 앞을 겨냥)를 자동 계산 → 움직이는 표적 배수가 0.7 → 0.9.
 * 수치는 모두 게임용 추정치이며 이 파일 위쪽 TMM.SCOPE 만 고치면 된다.
 */
TMM.SCOPE = {
  // 배율: 광각·협각 시야각(도). 표시 이름은 실제 조준경의 배율 느낌만 낸다.
  ZOOMS: [{ fovDeg: 12, name: '광각 ×3' }, { fovDeg: 4, name: '협각 ×10' }],
  // 포탑 회전: 조준선을 화면 가장자리 EDGE(비율) 안으로 가져가면 그쪽으로 돈다. 최대 속도 = 시야각 × 이 값 / 실제 초
  EDGE: 0.13,
  PAN_FOV_PER_SEC: 1.4,
  KEY_PAN_FOV_PER_SEC: 0.8,
  PAN_MAX_DEG_PER_SEC: 40, // 포탑 회전 한계 (실제 초)
  // 조준 안정: 조준선을 같은 표적에 이만큼(실제 초, 일시정지 중엔 안 쌓임) 두면 가장 정확하다
  SETTLE_SEC: 1.3,
  SNAP_MUL: 0.7, // 막 올린 조준
  SETTLED_MUL: 1.2, // 충분히 유지한 조준 (K1A2 사격통제장치 + 전차장 직접 조준)
  NEAR_MUL: 0.3, // 조준선이 표적 가장자리에서 조금 벗어남
  // 레이저 없이 눈대중으로 거리를 잡으면: 1km 마다 ×(1 − 이 값), 최소값까지
  GUESS_LOSS_PER_KM: 0.22,
  GUESS_MIN: 0.4,
  LASER_VALID_SEC: 30, // 측정값을 쓰는 시간 (게임 초)
  LASER_MOVE_M: 120, // 측정 뒤 표적이나 1호차가 이만큼 움직이면 다시 재야 한다
  LEAD_MOVE_MUL: 0.9, // 레이저로 잰 움직이는 표적 (자동 리드). 2km 밖은 점점 줄어 3km 에서 보통(0.7)
  // 2km 밖 직접 조준: 신기루·탄 분산으로 1km 마다 이만큼 줄어든다 (3km 에서 ×0.6)
  LONG_FROM_M: 2000,
  LONG_LOSS_PER_KM: 0.4,
  // 조준경 안의 표적은 크게 보여 식별이 빠르다 (식별 시간 배수)
  ID_IN_VIEW: [0.6, 0.4], // 시야 안 [광각, 협각]
  ID_ON_RETICLE: 0.3, // 조준선 바로 위
  // 조준경에 붙어 있는 동안 (전차장 머리 숙임): 조준경 시야 밖은 조종수·탄약수 잠망경으로만 본다 → 탐지 거리 배수
  HEAD_DOWN_MARGIN_DEG: 12, // 조준경 시야 가장자리에서 이만큼까지는 그대로
  HEAD_DOWN_DETECT: 0.35,
  // 지도 화면에 있는 동안 1호차 포수 혼자 싸울 때 (전차장이 표적을 잡아 주지 않음)
  AUTO_AIM_MUL: 1.25,
  AUTO_HIT_MUL: 0.93,
  // 표적 실루엣 크기 (m)
  SIZE: {
    K1A2: { len: 7.5, wid: 3.6, h: 2.4 },
    K2: { len: 7.5, wid: 3.6, h: 2.4 },
    CHONMA: { len: 6.6, wid: 3.3, h: 2.4 },
    POKPUNG: { len: 6.9, wid: 3.4, h: 2.4 },
    CHONMA20: { len: 7.1, wid: 3.5, h: 2.5 },
    ATINF: { len: 10, wid: 10, h: 1.2 }, // 엎드린 대전차조
    TRUCK: { len: 7, wid: 2.5, h: 2.9 },
    INF: { len: 18, wid: 18, h: 1.7 }, // 흩어진 분대
  },
};

TMM.Scope = (function () {
  const K = () => TMM.SCOPE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const EYE_H = 3.0;

  function init(game) {
    const lead = game.units.find((u) => u.leaderAboard && !u.destroyed) || game.units.find((u) => u.id === 1) || game.units[0];
    game.scope = {
      open: false,
      unitId: lead ? lead.id : 1, // M7b: 소대장이 탄 전차 (1호차가 없으면 4호차)
      az: -Math.PI / 2, // 포탑(조준경)이 보는 방향
      zoom: 0,
      pitch: 0, // 화면 가운데의 앙각 (위 +)
      aspect: 0.6, // 화면 높이 / 너비 (scope-view 가 맞춤)
      rx: 0, ry: 0, // 조준선 위치 (화면 너비 비율, 화면 가운데 기준)
      keyPan: 0, // A/D·←→ (−1, 0, 1)
      keyTilt: 0, // W/S·↑↓ (−1, 0, 1)
      pan: 0, // 지금 포탑 회전 속도 (라디안/실제 초)
      onId: null, // 조준선 아래 표적
      onState: null, // 'on' | 'near' | null
      settle: 0,
      laser: null, // { targetId|null, distM, at, tx, ty, ux, uy }
      opens: 0,
      time: 0, // 조준 화면에서 보낸 실제 시간
    };
  }

  const unit = (game) => game.units.find((u) => u.id === game.scope.unitId) || null;
  function canUse(game) {
    const u = unit(game);
    return !!u && !u.destroyed;
  }
  function isManual(game, u) {
    const s = game.scope;
    return !!s && s.open && u.id === s.unitId && !u.destroyed;
  }
  const fov = (game) => (K().ZOOMS[game.scope.zoom].fovDeg * Math.PI) / 180;

  function bearingTo(u, t) {
    return Math.atan2(t.y - u.y, t.x - u.x);
  }

  // 처음 열 때 볼 방향: 쏘던 표적 → 지정 목표 → 엄호 방향 → 차체 방향
  function initialAz(game, u) {
    const id = (u.fire && u.fire.targetId) || u.targetId;
    const t = id != null ? TMM.Gunnery.findUnit(game, id) : null;
    if (t && !t.destroyed) return bearingTo(u, t);
    if (u.watch != null) return u.watch;
    return u.heading;
  }

  // 처음 앙각: 그 방향 1.5km 앞 땅 (표적을 쏘던 중이면 표적)
  function initialPitch(game, u, az) {
    const id = (u.fire && u.fire.targetId) || u.targetId;
    const t = id != null ? TMM.Gunnery.findUnit(game, id) : null;
    if (t && !t.destroyed) { const b = project(game, u, t, az); return (b.el0 + b.el1) / 2; }
    const mpc = game.map.metersPerCell;
    const x = clamp(u.x + (Math.cos(az) * 1500) / mpc, 0.5, game.map.cols - 0.5);
    const y = clamp(u.y + (Math.sin(az) * 1500) / mpc, 0.5, game.map.rows - 0.5);
    return clamp(Math.atan2(ground(game.map, x, y) - eyeAlt(game, u), 1500), -0.05, 0.05);
  }

  function open(game) {
    const s = game.scope;
    const u = unit(game);
    if (!u || u.destroyed) return false;
    if (!s.open) {
      s.open = true;
      s.opens += 1;
      s.az = s.turretAz != null ? s.turretAz : initialAz(game, u);
      s.pitch = initialPitch(game, u, s.az);
      s.rx = 0;
      s.ry = 0;
      s.settle = 0;
      s.onId = null;
      u.fire.targetId = null; // 포수 자동 조준 중단
    }
    return true;
  }

  function close(game) {
    const s = game.scope;
    if (!s.open) return;
    s.open = false;
    s.turretAz = null; // 지도 화면에서는 포수가 알아서 돌린다
    s.keyPan = 0;
    s.pan = 0;
    // 포수가 다시 표적을 잡는다: open() 에서 fire.targetId 를 비웠으므로 Gunnery 가 조준 시간을 새로 매긴다
  }

  // ---- 표적 기하 ----
  // 조준경용 지면 높이: 시야 격자(1칸을 4×4)를 이중선형 보간 (그림의 땅과 표적 위치가 딱 맞도록)
  function ground(map, x, y) {
    TMM.Sight.groundAt(map, 0, 0); // 시야 격자가 없으면 만든다
    const G = map._sightGrid;
    const fx = clamp(x * 4 - 0.5, 0, G.w - 1.001), fy = clamp(y * 4 - 0.5, 0, G.h - 1.001);
    const c = fx | 0, r = fy | 0, tx = fx - c, ty = fy - r;
    const i = r * G.w + c;
    const a = G.alt[i], b = G.alt[i + 1], d = G.alt[i + G.w], e = G.alt[i + G.w + 1];
    return a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty;
  }
  function eyeAlt(game, u) {
    return ground(game.map, u.x, u.y) + EYE_H;
  }

  /**
   * 관측자 u 에서 본 표적 t 의 각도 상자.
   * 반환: { az(절대 방위 라디안), daz(시야 중심 기준), el0(아래 끝 각도), el1(위 끝), halfW(반폭 각도), distM, size }
   */
  function project(game, u, t, viewAz) {
    const distM = TMM.Ballistics.distanceM(game.map, u, t);
    const d = Math.max(20, distM);
    const az = bearingTo(u, t);
    const sz = K().SIZE[t.model] || K().SIZE.K1A2;
    const rel = wrap((t.heading || 0) - az);
    const across = Math.abs(Math.sin(rel)) * sz.len + Math.abs(Math.cos(rel)) * sz.wid;
    const g = ground(game.map, t.x, t.y);
    const eye = eyeAlt(game, u);
    const el0 = Math.atan2(g - eye, d);
    const el1 = Math.atan2(g + sz.h - eye, d);
    return { az, daz: wrap(az - (viewAz != null ? viewAz : game.scope.az)), el0, el1, halfW: Math.atan2(across / 2, d), distM, rel, size: sz };
  }

  // 조준경에 보이는 표적들 (1호차가 '직접' 보는 것만)
  function visibleTargets(game, u) {
    const out = [];
    const m = game.vis.get(u.id);
    if (!m) return out;
    for (const [id, pv] of m) {
      const t = TMM.Gunnery.findUnit(game, id);
      if (!t || t.destroyed || t.exited) continue;
      out.push({ t, pv });
    }
    return out;
  }

  // 조준선 각도 (절대 방위, 앙각)
  function aimAngles(game) {
    const s = game.scope;
    const f = fov(game);
    return { az: s.az + s.rx * f, el: s.pitch + s.ry * f };
  }

  /**
   * 조준선 아래 표적. 반환: { t, pv, box, on } (on: 실루엣 위, 아니면 가장자리 근처) 또는 null
   */
  function targetAt(game) {
    const u = unit(game);
    if (!u) return null;
    const a = aimAngles(game);
    const margin = fov(game) * 0.006; // 화면에서 약 5픽셀
    let best = null, bestScore = Infinity;
    for (const { t, pv } of visibleTargets(game, u)) {
      const b = project(game, u, t);
      const dx = Math.abs(wrap(a.az - b.az));
      const elMid = (b.el0 + b.el1) / 2, halfH = (b.el1 - b.el0) / 2;
      const dy = Math.abs(a.el - elMid);
      const onX = b.halfW + margin, onY = halfH + margin;
      const nearX = b.halfW * 1.6 + margin * 3, nearY = halfH * 1.6 + margin * 3;
      let on = null;
      if (dx <= onX && dy <= onY) on = true;
      else if (dx <= nearX && dy <= nearY) on = false;
      else continue;
      const score = (on ? 0 : 10) + dx / (b.halfW + margin) + dy / (halfH + margin) + b.distM / 1e5;
      if (score < bestScore) { bestScore = score; best = { t, pv, box: b, on }; }
    }
    return best;
  }

  // ---- 레이저 거리측정 ----
  function laserValid(game, t) {
    const s = game.scope, L = s.laser, u = unit(game);
    if (!L || !t || L.targetId !== t.id || !u) return false;
    if (game.gameSeconds - L.at > K().LASER_VALID_SEC) return false;
    const mpc = game.map.metersPerCell;
    if (Math.hypot(t.x - L.tx, t.y - L.ty) * mpc > K().LASER_MOVE_M) return false;
    if (Math.hypot(u.x - L.ux, u.y - L.uy) * mpc > K().LASER_MOVE_M) return false;
    return true;
  }

  // 조준선 방향으로 지형(땅·숲·건물)에 닿는 거리 (m). 하늘이면 null
  function terrainRange(game, u, az, el) {
    const map = game.map;
    const eye = eyeAlt(game, u);
    const mpc = map.metersPerCell;
    const tanEl = Math.tan(el);
    for (let d = 40; d <= 6000; d += d < 1000 ? 10 : 25) {
      const x = u.x + (Math.cos(az) * d) / mpc, y = u.y + (Math.sin(az) * d) / mpc;
      const type = map.typeAt(x, y);
      if (type < 0) return null;
      const own = d < 60 || (Math.floor(x) === Math.floor(u.x) && Math.floor(y) === Math.floor(u.y));
      const ch = own ? 0 : TMM.TERRAIN_SIGHT[type].h * (type === TMM.T.BASE ? 0.35 : 0.85);
      const top = ground(map, x, y) + ch;
      if (top >= eye + tanEl * d) return d;
    }
    return null;
  }

  /**
   * L 키. 반환: { ok, distM, target, why }
   */
  function lase(game) {
    const s = game.scope, u = unit(game);
    if (!u || u.destroyed) return { ok: false, why: '1호차 격파됨' };
    if (u.damage.fcs) return { ok: false, why: '사격통제장치 손상 — 레이저 거리측정기 고장' };
    const hit = targetAt(game);
    if (hit && hit.on) {
      const err = (game.rand() - 0.5) * 10; // ±5m
      const distM = Math.max(10, Math.round(hit.box.distM + err));
      s.laser = { targetId: hit.t.id, distM, at: game.gameSeconds, tx: hit.t.x, ty: hit.t.y, ux: u.x, uy: u.y };
      return { ok: true, distM, target: hit.t, moving: TMM.Ballistics.isMoving(hit.t) };
    }
    const a = aimAngles(game);
    const d = terrainRange(game, u, a.az, a.el);
    s.laser = d == null ? null : { targetId: null, distM: Math.round(d), at: game.gameSeconds, tx: 0, ty: 0, ux: u.x, uy: u.y };
    return { ok: true, distM: d == null ? null : Math.round(d), target: null };
  }

  // ---- 조준 품질 ----
  function quality(game, t, hit) {
    const S = K(), s = game.scope, u = unit(game);
    const distM = TMM.Ballistics.distanceM(game.map, u, t);
    const laser = laserValid(game, t);
    const rangeMul = laser ? 1 : clamp(1 - S.GUESS_LOSS_PER_KM * distM / 1000, S.GUESS_MIN, 1);
    const settle = s.onId === t.id ? clamp(s.settle / S.SETTLE_SEC, 0, 1) : 0;
    const settleMul = S.SNAP_MUL + (S.SETTLED_MUL - S.SNAP_MUL) * settle;
    const onMul = !hit || hit.on ? 1 : S.NEAR_MUL;
    const far = Math.max(0, distM - S.LONG_FROM_M) / 1000;
    const longMul = Math.max(0.3, 1 - S.LONG_LOSS_PER_KM * far);
    // 리드: 2km 안은 다 맞추고, 그 밖은 3km 까지 점점 일반 사격과 같아진다
    const lead = laser ? 1 - Math.min(1, far) : 0;
    return { laser, settle, rangeMul, settleMul, longMul, mul: rangeMul * settleMul * onMul * longMul, lead };
  }

  function manualMods(game, u, t, hit) {
    const q = quality(game, t, hit);
    const mods = TMM.Intel.fireMods(game, u, t);
    mods.manual = { mul: q.mul, lead: q.lead };
    return { mods, q };
  }

  // 조준선 아래 표적의 명중 예상 (화면 표시용). 없으면 null
  function preview(game) {
    const u = unit(game);
    if (!u || u.destroyed) return null;
    const hit = targetAt(game);
    if (!hit) return null;
    const { mods, q } = manualMods(game, u, hit.t, hit);
    const ammo = u.ammoType;
    const inRange = hit.box.distM <= TMM.AMMO[ammo].rangeM;
    return { hit, q, pHit: TMM.Ballistics.hitChance(game.map, u, hit.t, ammo, mods), inRange };
  }

  /**
   * 좌클릭 발사. events 는 다음 전투 틱에서 무전·승무원 처리 (game.pendingEvents).
   * 반환: { ok, why, wild, target, res }
   */
  function fire(game) {
    const u = unit(game);
    if (!game.scope.open) return { ok: false, why: '조준 화면이 아님' };
    if (game.paused) return { ok: false, why: '일시정지 중 — 조준·사격 불가' };
    if (game.over) return { ok: false, why: '작전 종료' };
    if (!u || u.destroyed) return { ok: false, why: '1호차 격파됨' };
    if (u.damage.gun) return { ok: false, why: '주포 손상 — 사격 불가' };
    const events = game.pendingEvents || (game.pendingEvents = []);
    if (!TMM.Gunnery.ensureAmmo(u, events)) return { ok: false, why: '탄약 없음' };
    if (u.fire.reload > 0) return { ok: false, why: 'reload' };
    const hit = targetAt(game);
    if (hit && hit.box.distM > TMM.AMMO[u.ammoType].rangeM) {
      return { ok: false, why: '사거리 밖 — ' + TMM.AMMO[u.ammoType].short + ' 최대 ' + (TMM.AMMO[u.ammoType].rangeM / 1000).toFixed(1) + 'km' };
    }
    const ammoId = u.ammoType;
    if (!hit) {
      // 표적 없는 곳에 쏨: 탄 한 발 낭비
      u.ammo[ammoId] -= 1;
      u.stats.shots += 1;
      u.lastFiredAt = game.gameSeconds;
      game.lastShotAt = game.gameSeconds;
      u.fire.reload = TMM.VEHICLES[u.model].reloadSec * TMM.Crew.reloadMul(u);
      game.scope.settle = 0;
      const m = u.stats.manual || (u.stats.manual = { shots: 0, hits: 0, kills: 0 });
      m.shots += 1;
      if (u.crew && u.crew.byRole.loader) u.crew.byRole.loader.stats.reloads += 1;
      return { ok: true, wild: true, ammoId };
    }
    const { mods } = manualMods(game, u, hit.t, hit);
    const res = TMM.Gunnery.fireAt(game, u, hit.t, game.rand, events, mods);
    game.scope.settle = 0; // 반동: 다시 조준을 안정시켜야 한다
    return { ok: true, target: hit.t, res, ammoId };
  }

  // 지도 화면의 1호차 포수 혼자 (Gunnery 가 부름). 전차장 자리에 소대장이 앉은 전차만 (4호차로 옮겨 타도 장만석 상사가 전차장)
  const playerCmdr = (u) => !!(u.crew && u.crew.byRole.cmdr && u.crew.byRole.cmdr.player);
  function autoAimMul(game, u) {
    return playerCmdr(u) && !isManual(game, u) ? K().AUTO_AIM_MUL : 1;
  }
  function autoHitMul(game, u) {
    return playerCmdr(u) && !isManual(game, u) ? K().AUTO_HIT_MUL : 1;
  }

  // 식별 시간 배수 (Intel.pairVis 가 부름): 조준경 시야 안의 표적은 크게 보여 빨리 식별된다
  function idMul(game, o, t) {
    const s = game.scope;
    if (!s || !s.open || o.id !== s.unitId) return 1;
    const f = fov(game);
    const daz = Math.abs(wrap(bearingTo(o, t) - s.az));
    if (daz > f / 2) return 1;
    const a = aimAngles(game);
    if (Math.abs(wrap(bearingTo(o, t) - a.az)) < f * 0.05) return K().ID_ON_RETICLE;
    return K().ID_IN_VIEW[s.zoom];
  }

  // 탐지 거리 배수 (Intel.pairVis 가 부름): 조준경에 붙어 있으면 1호차는 시야 밖을 잘 못 본다
  function detectMul(game, o, t) {
    const s = game.scope;
    if (!s || !s.open || o.id !== s.unitId) return 1;
    const lim = fov(game) / 2 + (K().HEAD_DOWN_MARGIN_DEG * Math.PI) / 180;
    return Math.abs(wrap(bearingTo(o, t) - s.az)) <= lim ? 1 : K().HEAD_DOWN_DETECT;
  }

  /**
   * 매 프레임 (실제 시간 realDt, 일시정지 중엔 0): 포탑 회전, 조준 안정.
   */
  function update(game, realDt) {
    const s = game.scope;
    if (!s.open) return;
    const u = unit(game);
    if (!u || u.destroyed) return;
    const S = K();
    const f = fov(game);
    let rate = 0;
    const edge = 0.5 - S.EDGE;
    if (Math.abs(s.rx) > edge) rate = Math.sign(s.rx) * Math.pow(Math.min(1, (Math.abs(s.rx) - edge) / S.EDGE), 1.5) * S.PAN_FOV_PER_SEC * f;
    if (s.keyPan) rate += s.keyPan * S.KEY_PAN_FOV_PER_SEC * f;
    const maxR = (S.PAN_MAX_DEG_PER_SEC * Math.PI) / 180;
    rate = clamp(rate, -maxR, maxR);
    // 위아래 (포 앙각): 조준선이 화면 위·아래 가장자리 근처면 그쪽으로
    const halfH = s.aspect / 2, vEdge = halfH - S.EDGE * s.aspect;
    let tilt = 0;
    if (Math.abs(s.ry) > vEdge) tilt = Math.sign(s.ry) * Math.min(1, (Math.abs(s.ry) - vEdge) / (S.EDGE * s.aspect)) * 0.6 * S.PAN_FOV_PER_SEC * f;
    if (s.keyTilt) tilt += s.keyTilt * 0.5 * S.KEY_PAN_FOV_PER_SEC * f;
    s.pan = realDt > 0 ? rate : 0;
    if (realDt <= 0) return;
    s.time += realDt;
    s.az = wrap(s.az + rate * realDt);
    s.pitch = clamp(s.pitch + tilt * realDt, -0.17, 0.17); // ±10°
    s.turretAz = s.az;

    const hit = targetAt(game);
    const steady = Math.abs(rate) < 0.15 * f && Math.abs(tilt) < 0.15 * f;
    if (hit && hit.on) {
      if (s.onId !== hit.t.id) { s.onId = hit.t.id; s.settle = 0; }
      if (steady) s.settle = Math.min(S.SETTLE_SEC * 1.5, s.settle + realDt);
      else s.settle = Math.max(0, s.settle - realDt);
      s.onState = 'on';
    } else {
      s.onState = hit ? 'near' : null;
      s.settle = Math.max(0, s.settle - realDt * 2);
      if (s.settle === 0) s.onId = hit ? hit.t.id : null;
    }
  }

  // 배율 전환. 조준선이 가리키는 각도는 그대로 두고 시야만 바꾼다.
  function setZoom(game, z) {
    const s = game.scope;
    z = clamp(z, 0, K().ZOOMS.length - 1);
    if (z === s.zoom) return;
    const a = aimAngles(game);
    s.zoom = z;
    // 조준선이 가리키던 곳을 화면 가운데로
    s.az = a.az;
    s.pitch = a.el;
    s.rx = 0;
    s.ry = 0;
  }

  // 나침반 방위각 (북 0°, 시계 방향)
  function compassDeg(az) {
    let d = (az * 180) / Math.PI + 90;
    d = ((d % 360) + 360) % 360;
    return d;
  }

  return {
    init, unit, canUse, isManual, fov, open, close, project, visibleTargets, aimAngles, targetAt,
    lase, laserValid, quality, preview, fire, autoAimMul, autoHitMul, idMul, detectMul, update, setZoom, compassDeg, eyeAlt, ground, wrap,
  };
})();
