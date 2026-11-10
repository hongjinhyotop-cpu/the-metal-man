/*
 * 승무원과 신뢰도 (M5). DOM 없이 돌아가므로 모의 전투에서도 같은 규칙이 적용된다.
 *
 * 전차마다 unit.crew = { members[4], byRole{cmdr,gunner,loader,driver}, trust(2·3·4호차, 0~100), trustStart, … }
 * 승무원 한 명 m = { key, name, rank, role, traits, skill(숙련도), fatigue(피로), morale(사기), injury(0 없음·1 경상·2 중상), stats{…} }
 *
 * 보직 → 성능 (모두 '배수', 보통 승무원이면 약 1):
 *   전차장 — 무전 응답 지연·잘못 알아들음(신뢰도와 함께, TMM.RADIO.crewFactor), 식별 시간, 피격 시 스스로 엄폐(자율 판단)
 *   포수   — 명중률(hitMul), 조준 시간(aimMul)
 *   탄약수 — 장전 시간(reloadMul), 탄종 실수(실수하면 다시 넣느라 몇 초 더 걸림)
 *   조종수 — 기동 속도(speedMul, 엄폐물 진입도 그만큼 빨라짐), 고장(정비 조치로 잠시 멈춤)
 * 한 사람의 실력 eff = 숙련도 × 피로 × 사기 × 부상 (보통 1, 지치고 다치면 0.4 까지 떨어짐)
 *
 * 피로: 시간이 지날수록 쌓이고 교전 중엔 더 빨리 쌓인다. 사기: 피격·아군 손실에 떨어지고 격파·승리에 오른다.
 * 숙련도: 쏘고·장전하고·명령을 수행하고·움직일수록 조금씩 오른다 (이도현 이병·윤지호 하사는 빨리 큼).
 * 신뢰도: 2·3·4호차가 소대장을 믿는 정도. 손실 없는 임무 완수·철수시켜 살림·정확한 목표 지정에 오르고,
 *        무리한 명령으로 인한 손실·오인사격·잦은 명령 번복에 떨어진다. 높으면 빨리·정확히 알아듣고, 낮으면 늦고 잘못 알아듣는다.
 * 부상: 피탄되면 다칠 수 있다(기본 난이도는 전사 없이 중상까지). 다친 사람의 보직 성능이 떨어진다. 후송·복귀는 M7.
 *
 * 다른 파일과의 연결점 (모두 TMM.Crew 가 없으면 1 로 동작):
 *   radio-config.js crewFactor → radioFactor · gunnery.js aimMul/reloadMul/afterShot/earlyFire · ballistics.js hitMul
 *   damage.js speedMul · movement.js unit.stall(고장) · intel.js idMul · orders.js initiative · radio-net.js interpret/beforeAck/ackBody/noteOrder/onExecuted/spotLine
 *   command.js onDirectOrder · battle.js init/update/onEvents/finish
 */
TMM.CREW = {
  START_FATIGUE: { day: 10, night: 14 }, // 작전 시작 때 피로 (야간은 이미 지쳐 있음)
  FATIGUE_PER_MIN: 0.55, // 게임 1분에 쌓이는 피로
  FATIGUE_COMBAT_MUL: 2.2, // 교전 중이면 이만큼 빨리 쌓임
  INJURY_MUL: [1, 0.85, 0.5], // 부상 정도별 실력 배수 (없음·경상·중상)
  INJURY_NAME: ['', '경상', '중상'],

  // 사기 변화
  MORALE_HIT: -6, MORALE_PEN: -10, MORALE_LOSS: -12, MORALE_KILL: 8, MORALE_KILL_OTHERS: 3, MORALE_WIN: 10, MORALE_LOSE: -10, MORALE_FF: -10,

  // 신뢰도 변화
  TRUST_WIN_CLEAN: 15, TRUST_WIN: 5, TRUST_SAVED: 8, TRUST_TARGET_KILL: 3,
  TRUST_LOSS: -4, TRUST_RECKLESS_LOSS: -10, TRUST_FF: -8, TRUST_FLIP: -3,
  RECKLESS_SEC: 120, // 명령을 받은 지 이 시간 안에 노출된 채 격파되면 '무리한 명령'
  FLIP_WINDOW_SEC: 45, // 이 시간 안에 행동 명령이 다시 바뀌면 '번복'
  FLIP_COUNT: 2, // 번복이 이만큼 쌓이면 신뢰 하락

  // 대사 횟수 제한
  HUMOR_MAX_PER_PERSON: 3, // 한 전투에 한 사람이 하는 유머 대사 최대 횟수
  HUMOR_PERSON_COOLDOWN: 150, // 같은 사람이 다시 농담하기까지 (게임 초)
  HUMOR_GLOBAL_COOLDOWN: 45, // 누구든 다음 농담까지
  BANTER_PER_SEC: 1 / 75, // 조용할 때 잡담이 나올 확률 (게임 1초당)
  HEATED_SEC: 20, // 피격·근탄 뒤 이 시간은 '격한 교전'
  HEATED_M: 1500, // 보이는 적이 이 거리 안이면 '격한 교전'

  // 탄약수 실수·조종수 고장
  SLIP_BASE: 0.02, // 보통 탄약수의 탄종 실수 확률 (한 번 장전에)
  SLIP_REDO_SEC: 4, // 실수하면 다시 넣는 시간
  BREAKDOWN_PER_SEC: 1 / 4000, // 움직이는 1초당 고장 확률 (보통 조종수)
  BREAKDOWN_SEC: [25, 45],

  // 성장 (한 번에 오르는 숙련도, 높을수록 덜 오름)
  GROW_SHOT: 0.45, GROW_HIT: 0.35, GROW_KILL: 1.2, GROW_RELOAD: 0.4, GROW_ORDER: 0.5, GROW_KM: 0.6, GROW_SURVIVE: 1.0,

  // 장만석: 신뢰가 이보다 낮으면 이동 위치를 '해석', 이보다 높으면 먼저 의견 제시
  REINTERPRET_BELOW: 50,
  SUGGEST_ABOVE: 70,
  // 윤지호: 숙련도가 이보다 낮으면 오인 보고·조기 사격
  JUMPY_UNTIL: 70,
};

TMM.Crew = (function () {
  const K = () => TMM.CREW;
  const V = () => TMM.CREW_VOICE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (game, list) => list[Math.floor(game.rand() * list.length) % list.length];
  const fill = (s, d) => s.replace(/\{(\w+)\}/g, (_, k) => (d[k] != null ? d[k] : ''));

  // ---- 만들기 ----
  function makeMember(d, saved) {
    const m = {
      key: d.key, name: d.name, rank: d.rank, role: d.role, about: d.about || '', player: !!d.player,
      traits: Object.assign({}, d.traits),
      skill: d.skill, morale: d.morale, fatigue: 0, injury: 0,
      shaken: false, humor: 0, lastHumorAt: -1e9,
      stats: { shots: 0, hits: 0, kills: 0, reloads: 0, slips: 0, orders: 0, meters: 0, breakdowns: 0, asks: 0 },
    };
    if (saved) Object.assign(m, { skill: saved.skill, morale: saved.morale, fatigue: saved.fatigue, injury: saved.injury });
    m.skill0 = m.skill;
    m.morale0 = m.morale;
    return m;
  }

  // saved: snapshot() 이 만든 이전 전투 상태 (M7 캠페인에서 이어 쓰기)
  function init(game, saved) {
    game.crewState = { lastIncoming: -1e9, lastHumorAt: -1e9, queue: [], sys: [], usedBanter: new Set(), heatAt: -1, heat: false, quietAt: -1, quiet: true, done: false };
    for (const u of game.units) {
      const roster = TMM.CREW_ROSTER[u.id];
      if (!roster) continue;
      const sv = saved && saved[u.id];
      const members = roster.map((d) => makeMember(d, sv && sv.members.find((x) => x.key === d.key)));
      const byRole = {};
      for (const m of members) byRole[m.role] = m;
      const trust = u.id === 1 ? null : sv && sv.trust != null ? sv.trust : TMM.CREW_TRUST_START[u.id];
      u.crew = {
        members, byRole, trust, trustStart: trust, trustLog: [],
        orderTimes: [], flips: [], flipNote: false, lastOrderAt: -1e9, lastOrderType: null,
        rescue: null, earlyRolled: new Map(), suggestAt: -1e9, suggests: 0, kills: 0,
      };
      if (!sv) for (const m of members) m.fatigue = K().START_FATIGUE[game.light] || 12;
    }
  }

  function snapshot(game) {
    const out = {};
    for (const u of game.units) {
      if (!u.crew) continue;
      out[u.id] = { trust: u.crew.trust, members: u.crew.members.map((m) => ({ key: m.key, skill: m.skill, morale: m.morale, fatigue: m.fatigue, injury: m.injury })) };
    }
    return out;
  }

  // ---- 실력 ----
  const member = (u, role) => (u && u.crew ? u.crew.byRole[role] : null);
  const byKey = (u, key) => (u && u.crew ? u.crew.members.find((m) => m.key === key) : null);

  function eff(m) {
    if (!m) return 1;
    const skill = 0.75 + 0.5 * (m.skill / 100); // 숙련도 50 → 1.0
    const fat = 1 - 0.3 * Math.max(0, m.fatigue - 20) / 80; // 피로 20 까지는 영향 없음, 100 이면 0.7
    const mor = 0.95 + 0.1 * (m.morale / 100);
    let e = skill * fat * mor * K().INJURY_MUL[m.injury];
    if (m.shaken) e *= 0.75;
    return e;
  }

  // 4호차: 장 상사가 멀쩡하면 조현석 하사와 손발이 맞는다
  function bondMul(u) {
    if (!u.crew) return 1;
    const g = u.crew.byRole.gunner;
    if (!g || !g.traits.bond) return 1;
    const boss = byKey(u, g.traits.bond);
    return boss && boss.injury < 2 ? 0.9 : 1;
  }

  function aimMul(u) {
    const g = member(u, 'gunner');
    if (!g) return 1;
    return clamp((1 / eff(g)) * (g.traits.aimMul || 1) * bondMul(u), 0.7, 2.2);
  }

  function reloadMul(u) {
    const l = member(u, 'loader');
    if (!l) return 1;
    return clamp((1 / eff(l)) * (l.traits.reloadMul || 1) * bondMul(u), 0.7, 2.4);
  }

  function hitMul(u, distM) {
    const g = member(u, 'gunner');
    if (!g) return 1;
    let p = (0.7 + 0.3 * eff(g)) * (g.traits.hitMul || 1);
    if (distM > 1500 && g.traits.longHitMul) p *= g.traits.longHitMul;
    return p;
  }

  function speedMul(u) {
    const d = member(u, 'driver');
    if (!d) return 1;
    return clamp((0.8 + 0.2 * eff(d)) * (d.traits.speedMul || 1), 0.55, 1.25);
  }

  function idMul(u) {
    const c = member(u, 'cmdr');
    if (!c) return 1;
    return clamp(1 / (0.7 + 0.3 * eff(c)), 0.8, 1.5);
  }

  const trustOf = (u) => (u && u.crew && u.crew.trust != null ? u.crew.trust : 60);

  // 무전: what = 'mishear' | 'ack' | 'report' | 'initiative'
  function radioFactor(u, what) {
    const c = member(u, 'cmdr');
    if (!c) return 1;
    const e = eff(c);
    const t = trustOf(u);
    const jumpy = c.traits.jumpy && c.skill < K().JUMPY_UNTIL;
    const lowMorale = c.morale < 30 ? 1.15 : 1;
    switch (what) {
      case 'mishear': return clamp((1.4 - 0.4 * e) * (1.5 - t / 100) * (jumpy ? 1.25 : 1), 0.3, 2.5);
      case 'ack': return clamp((1.3 - 0.3 * e) * (1.3 - 0.6 * (t / 100)) * (jumpy ? 0.8 : 1) * lowMorale, 0.5, 2.2);
      case 'report': return clamp((1.3 - 0.3 * e) * (jumpy ? 0.8 : 1), 0.6, 2);
      case 'initiative': return clamp((0.8 + 0.2 * e) * (c.traits.veteran ? 1.2 : 1) * (c.morale < 30 ? 0.8 : 1), 0.4, 1.17);
      default: return 1;
    }
  }

  // ---- 상황 판단 ----
  // 격한 교전: 최근 피격·근탄, 또는 보이는 적이 가까움
  function heated(game) {
    const st = game.crewState;
    if (!st) return false;
    if (st.heatAt === game.gameSeconds) return st.heat;
    st.heatAt = game.gameSeconds;
    st.heat = false;
    if (game.gameSeconds - st.lastIncoming < K().HEATED_SEC) st.heat = true;
    else {
      for (const c of game.intel.friend.contacts.values()) {
        if (!c.visible || c.wreck || c.kind === 'friendly') continue;
        if (game.units.some((u) => !u.destroyed && Math.hypot(c.lastX - u.x, c.lastY - u.y) * game.map.metersPerCell <= K().HEATED_M)) { st.heat = true; break; }
      }
    }
    return st.heat;
  }
  function quiet(game) {
    const st = game.crewState;
    if (st.quietAt !== game.gameSeconds) { st.quietAt = game.gameSeconds; st.quiet = !TMM.Battle.inCombat(game); }
    return st.quiet;
  }

  // ---- 말하기 ----
  const label = (u, m) => (m.player ? u.id + '호차 소대장' : u.id + '호차 ' + m.name + ' ' + m.rank);

  // 이 전차의 차내 대화가 지휘 전차에 들리는가 (지휘 전차 자신이거나 교신이 됨)
  function audible(game, u) {
    if (u.destroyed) return false;
    const ctrl = TMM.Radio.controlUnit(game);
    if (!ctrl) return false;
    if (u === ctrl) return true;
    const l = TMM.Radio.link(game, ctrl, u);
    return l.ok;
  }

  function say(events, u, m, text) {
    events.push({ type: 'radio', from: label(u, m), text, kind: 'crew' });
  }

  // 유머 대사를 해도 되는가 (횟수·간격 제한)
  function canJoke(game, m) {
    const now = game.gameSeconds;
    return m.injury < 2 && m.humor < K().HUMOR_MAX_PER_PERSON && now - m.lastHumorAt >= K().HUMOR_PERSON_COOLDOWN;
  }
  function joked(game, m) {
    m.humor += 1;
    m.lastHumorAt = game.gameSeconds;
    game.crewState.lastHumorAt = game.gameSeconds;
  }
  const globalJokeOk = (game) => game.gameSeconds - game.crewState.lastHumorAt >= K().HUMOR_GLOBAL_COOLDOWN;

  // 여러 줄 대화를 몇 초 간격으로 늘어놓는다
  function queueLines(game, u, lines, gap) {
    let at = game.gameSeconds;
    for (const [key, text] of lines) {
      const m = byKey(u, key);
      if (!m) continue;
      game.crewState.queue.push({ at, unitId: u.id, key, text });
      at += gap || 3;
    }
  }

  function flushQueue(game, events) {
    const st = game.crewState;
    if (!st.queue.length) return;
    const due = st.queue.filter((q) => q.at <= game.gameSeconds);
    if (!due.length) return;
    st.queue = st.queue.filter((q) => q.at > game.gameSeconds);
    for (const q of due) {
      const u = game.units.find((x) => x.id === q.unitId);
      const m = byKey(u, q.key);
      if (!u || !m || !audible(game, u)) continue;
      say(events, u, m, q.text);
    }
  }

  // 대화 한 묶음을 시도한다 (유머 제한 포함). speakers 전원이 말할 수 있어야 한다.
  function tryJoke(game, u, lines, gap) {
    if (!globalJokeOk(game) || !audible(game, u)) return false;
    const ms = lines.map(([k]) => byKey(u, k));
    if (ms.some((m) => !m || m.injury >= 2)) return false;
    if (!canJoke(game, ms[0])) return false;
    joked(game, ms[0]);
    queueLines(game, u, lines, gap);
    return true;
  }

  // ---- 신뢰도 ----
  function adjustTrust(game, u, delta, reason, events) {
    if (!u.crew || u.crew.trust == null || u.destroyed || !delta) return;
    const before = u.crew.trust;
    u.crew.trust = clamp(before + delta, 0, 100);
    const d = Math.round(u.crew.trust - before);
    if (!d) return;
    u.crew.trustLog.push({ at: game.gameSeconds, delta: d, reason });
    if (Math.abs(d) >= 3) {
      (events || game.crewState.sys).push({ type: 'radio', from: '신뢰도', text: u.callsign + ' ' + (d > 0 ? '▲ +' : '▼ ') + d + ' (' + reason + ') → ' + Math.round(u.crew.trust), kind: d > 0 ? 'trust-up' : 'trust-down' });
    }
  }
  function trustAll(game, delta, reason, events, except) {
    for (const u of game.units) if (u !== except) adjustTrust(game, u, delta, reason, events);
  }

  function trustLabel(t) {
    if (t == null) return '';
    if (t < 25) return '불신';
    if (t < 45) return '시험하는 중';
    if (t < 65) return '보통';
    if (t < 85) return '믿음';
    return '깊은 신뢰';
  }

  // ---- 성장·사기 ----
  function grow(m, amount) {
    if (!m || m.player) return;
    const g = amount * (m.traits.growth || 1) * (1 - m.skill / 125);
    m.skill = clamp(m.skill + g, 0, 100);
  }
  function addMorale(u, delta) {
    if (!u.crew) return;
    let mul = 1;
    if (delta < 0) {
      const guard = u.crew.members.find((m) => m.traits.moraleGuard && m.injury < 2);
      if (guard) mul = guard.traits.moraleGuard;
    }
    for (const m of u.crew.members) m.morale = clamp(m.morale + delta * mul, 0, 100);
  }

  // ---- 사격 연결 ----
  // 한 발 쏜 직후 (gunnery.js): 성장·통계, 탄약수 탄종 실수
  function afterShot(game, u, res, events) {
    if (!u.crew) return;
    const g = u.crew.byRole.gunner, l = u.crew.byRole.loader;
    if (g) {
      g.stats.shots += 1;
      grow(g, K().GROW_SHOT + (res.hit ? K().GROW_HIT : 0));
      if (res.hit) g.stats.hits += 1;
      if (res.destroyed) { g.stats.kills += 1; grow(g, K().GROW_KILL); }
    }
    if (!l) return;
    l.stats.reloads += 1;
    grow(l, K().GROW_RELOAD);
    if (TMM.Damage.totalAmmo(u) <= 0) return;
    const slip = K().SLIP_BASE * clamp(2 - eff(l), 0.3, 2) + (l.traits.slip || 0) * Math.max(0, 1 - l.skill / 80);
    if (game.rand() >= slip) return;
    l.stats.slips += 1;
    u.fire.reload += K().SLIP_REDO_SEC;
    if (!audible(game, u)) return;
    const types = TMM.VEHICLES[u.model].ammoTypes;
    const other = types.find((k) => k !== u.ammoType) || u.ammoType;
    const a = TMM.AMMO[u.ammoType].short, b = TMM.AMMO[other].short;
    if (!heated(game) && l.traits.slip && canJoke(game, l) && globalJokeOk(game)) {
      joked(game, l);
      say(events, u, l, fill(V().slip.line, { ammo: a, other: b })); // 넣으라는 탄 대신 다른 탄을 넣음
      if (g && g.injury < 2) game.crewState.queue.push({ at: game.gameSeconds + 1.5, unitId: u.id, key: g.key, text: V().slip.reply });
    } else if ((l.traits.slip || u === TMM.Radio.controlUnit(game)) && game.gameSeconds - (l.lastShortAt || -1e9) > 90) {
      l.lastShortAt = game.gameSeconds; // 격할 때의 짧은 말도 너무 자주 하지 않게
      say(events, u, l, V().slip.short);
    }
  }

  // 윤지호 하사: 긴장해서 식별이 덜 끝난 표적에 먼저 쏠 때가 있다 (gunnery.js chooseTarget)
  // 반환: 이 접촉을 쏠지 여부
  function earlyFire(game, u, c, distM) {
    const cm = member(u, 'cmdr');
    if (!cm || !cm.traits.jumpy || cm.skill >= K().JUMPY_UNTIL || cm.injury >= 2) return false;
    if (!c || c.identified || c.idProg < 0.7 || distM > 1500) return false;
    const rolled = u.crew.earlyRolled; // Map(접촉 id → 쏠지 여부), 표적마다 한 번만 정한다
    if (!rolled.has(c.id)) rolled.set(c.id, game.rand() < 0.35 * clamp((K().JUMPY_UNTIL - cm.skill) / 35, 0, 1));
    return rolled.get(c.id);
  }

  // ---- 무전 연결 (radio-net.js) ----
  // 명령을 보낼 때: 같은 전차에게 행동 명령을 자주 뒤집는지 본다
  function noteOrder(game, u, order, events) {
    if (!u.crew) return;
    const now = game.gameSeconds;
    const act = !(order.type === 'roe' || order.type === 'target' || order.type === 'report');
    if (!act) return;
    const c = u.crew;
    if (c.lastOrderType && now - c.lastOrderAt < K().FLIP_WINDOW_SEC && order.type !== 'stop') {
      c.flips.push(now);
      c.flips = c.flips.filter((t) => now - t < 90);
      if (c.flips.length >= K().FLIP_COUNT) {
        c.flips = [];
        c.flipNote = true;
        adjustTrust(game, u, K().TRUST_FLIP, '명령을 자주 뒤집음', events);
      }
    }
    c.lastOrderAt = now;
    c.lastOrderType = order.type;
  }

  // 근처의 더 나은 엄폐 위치 (위협 방향에서 차체 엄폐 > 아예 안 보임). 없으면 null
  function threatFor(game, p) {
    let best = null, bd = Infinity;
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.known || c.wreck || (c.identified && c.kind === 'friendly')) continue;
      const d = Math.hypot(c.lastX - p.x, c.lastY - p.y);
      if (d < bd) { bd = d; best = { x: c.lastX, y: c.lastY }; }
    }
    return best || { x: p.x, y: p.y - 40 }; // 아무것도 모르면 북쪽 2km 를 위협으로 본다
  }
  function spotScore(map, threat, p) {
    const los = TMM.Sight.line(map, threat, p);
    let s = 0;
    if (los.clear && los.hullDown) s = 3;
    else if (!los.clear) s = 2.2;
    else if (los.obs > 0.5) s = 1;
    if (TMM.TERRAIN_SIGHT[map.typeAt(p.x, p.y)].conceal < 0.8) s += 0.4;
    return s;
  }
  function betterSpot(game, u, p0, maxR) {
    const map = game.map;
    const threat = threatFor(game, p0);
    const base = spotScore(map, threat, p0);
    if (base >= 3) return null;
    let best = null, bestS = base + 0.9;
    for (const r of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
      if (r > maxR) break;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const p = { x: p0.x + Math.cos(a) * r, y: p0.y + Math.sin(a) * r };
        const info = map.infoAt(p.x, p.y);
        if (!info || !info.speed) continue;
        if (Math.hypot(p.x - threat.x, p.y - threat.y) < Math.hypot(p0.x - threat.x, p0.y - threat.y) - 1.5) continue;
        const f = TMM.Orders.freeSpot(game, u, p.x, p.y);
        if (f.x !== p.x || f.y !== p.y) continue;
        const s = spotScore(map, threat, p) - r * 0.05;
        if (s > bestS) { bestS = s; best = p; }
      }
    }
    return best;
  }

  function placeText(game, from, p) {
    return { dir: TMM.Orders.dirTo(from, p), m: Math.round(Math.hypot(p.x - from.x, p.y - from.y) * game.map.metersPerCell / 10) * 10, grid: game.map.gridRef(p.x, p.y) };
  }

  // 장만석 상사: 신뢰가 낮으면 이동 위치를 '해석'한다. 반환: { order, text } 또는 null
  function interpret(game, u, order) {
    const c = member(u, 'cmdr');
    if (!c || !c.traits.veteran || c.injury >= 2 || order.type !== 'move') return null;
    const t = trustOf(u);
    if (t >= K().REINTERPRET_BELOW) return null;
    if (t >= 40 && game.rand() > (K().REINTERPRET_BELOW - t) / 10) return null;
    const p0 = TMM.Orders.formationPoint(game, u, order);
    const p = betterSpot(game, u, p0, 6.5); // 325m 안
    if (!p) return null;
    const o = Object.assign({}, order, { x: p.x, y: p.y, count: 1, slots: null, slot: null });
    return { order: o, text: fill(pick(game, V().reinterpret), placeText(game, p0, p)) };
  }

  // 수신 응답 전에: 되묻기(최민수)·머뭇거림(낮은 신뢰)·차내 갈등(3호차). 반환 { delay, ask, mic[] }
  function beforeAck(game, u, order, ctx) {
    const out = { delay: 0, ask: null, mic: [] };
    if (!u.crew) return out;
    const c = member(u, 'cmdr');
    const hot = heated(game);
    const rb = TMM.Orders.readback(game, u, order, ctx);
    const unidTarget = order.type === 'target' && order.targetId != null && (() => {
      const ct = TMM.Intel.contact(game, 'friend', order.targetId);
      return !ct || !ct.identified;
    })();
    if (c && c.traits.asksBack && c.injury < 2) {
      let k = null;
      if (u.crew.flipNote) k = 'flip';
      else if (order.type === 'withdraw') k = 'withdraw';
      else if (order.type === 'bound') k = 'bound';
      else if (unidTarget) k = 'target';
      else if (order.type === 'roe' && order.roe === 'free') k = 'roe';
      if (k) {
        out.ask = hot ? V().askBack.short : V().askBack[k];
        out.delay += 3 + game.rand() * 2;
        c.stats.asks += 1;
      }
    }
    if (!out.ask && u.crew.flipNote && c && V().flip[c.key]) {
      out.ask = V().flip[c.key];
      out.delay += 1.5;
    }
    u.crew.flipNote = false;
    const t = trustOf(u);
    if (!out.ask && t < 25 && game.rand() < (25 - t) / 40) {
      out.ask = fill(pick(game, V().doubt), { rb });
      out.delay += 3 + game.rand();
    }
    // 3호차: 송민혁 병장과 윤지호 하사의 갈등 (하사가 클수록·격파할수록 줄어든다)
    const g = member(u, 'gunner');
    if (g && g.traits.friction && g.injury < 2 && c && c.injury < 2) {
      const level = clamp(1 - (c.skill - 40) / 45, 0, 1) * (u.crew.kills >= 2 ? 0.5 : 1);
      if (game.rand() < 0.35 * level) {
        out.delay += 2 + game.rand() * 3;
        if (!hot && canJoke(game, g) && globalJokeOk(game)) {
          joked(game, g);
          const line = pick(game, V().friction);
          out.mic.push([line[0], line[1]], [c.key, pick(game, V().frictionReply)]);
        } else out.mic.push(V().frictionShort);
      }
    }
    return out;
  }

  // 수신 복창 본문 (호출부호 뒤). interp: 장만석의 해석
  function ackBody(game, u, rb, order, interp) {
    if (interp) return interp.text;
    const plain = '수신. ' + rb + '.';
    const c = member(u, 'cmdr');
    if (!c || c.injury >= 2 || heated(game)) return plain;
    const A = V().ack;
    let list = null;
    if (c.key === 'cms') list = order.type === 'cover' ? A.cmsCover : game.rand() < 0.6 ? A.cms : null;
    else if (c.key === 'yjh') list = game.rand() < 0.6 ? A.yjh : null;
    else if (c.key === 'jms') {
      const t = trustOf(u);
      list = t < 45 ? A.jmsLow : t >= K().SUGGEST_ABOVE ? (game.rand() < 0.5 ? A.jmsHigh : A.jmsMid) : A.jmsMid;
    }
    return list ? fill(pick(game, list), { rb }) : plain;
  }

  // 명령을 실제로 수행하기 시작했을 때
  function onExecuted(game, u, order) {
    if (!u.crew) return;
    const c = member(u, 'cmdr');
    if (c) { c.stats.orders += 1; grow(c, K().GROW_ORDER); }
    u.crew.orderAt = game.gameSeconds;
    if (order.type === 'withdraw') {
      // 위험할 때 철수: 최근 맞았거나, 손상됐거나, 보이는 적이 가까움
      const danger = game.gameSeconds - (u.crew.hitAt || -1e9) < 90 || TMM.Damage.damagedParts(u).length > 0 || nearestVisibleEnemyM(game, u) < 1800;
      u.crew.rescue = danger ? { at: game.gameSeconds } : null;
    } else if (order.type === 'move' || order.type === 'cover' || order.type === 'stop' || order.type === 'bound') u.crew.rescue = null;
  }

  function nearestVisibleEnemyM(game, u) {
    let best = Infinity;
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.visible || c.wreck || c.kind === 'friendly') continue;
      best = Math.min(best, Math.hypot(c.lastX - u.x, c.lastY - u.y) * game.map.metersPerCell);
    }
    return best;
  }

  // 윤지호 하사의 발견 보고: 미상 표적을 먼저 '적 전차' 라고 외쳤다가 정정할 때가 있다
  function spotLine(game, u, body, allUnknown) {
    const c = member(u, 'cmdr');
    if (!c || !c.traits.jumpy || c.skill >= K().JUMPY_UNTIL || !allUnknown) return body;
    if (game.rand() < 0.4 * clamp((K().JUMPY_UNTIL - c.skill) / 35, 0, 1)) return V().earlyReport + ' ' + body;
    return body;
  }

  // 지휘 전차(1호차)에게 직접 내린 명령: 박성훈 병장이 투덜거린다
  function onDirectOrder(game, u, order, lines) {
    if (!u.crew) return;
    const c = member(u, 'cmdr');
    if (c) c.stats.orders += 1;
    if (order.type !== 'move' && order.type !== 'withdraw') return;
    const d = member(u, 'driver');
    if (!d || !d.traits.grumble || d.injury >= 2 || !quiet(game)) return;
    const p = 0.3 + Math.max(0, 60 - d.morale) / 100;
    if (game.rand() >= p || !canJoke(game, d) || !globalJokeOk(game)) return;
    joked(game, d);
    lines.push({ from: label(u, d), text: pick(game, d.morale < 35 ? V().grumble.slice(1) : V().grumble), kind: 'crew' });
  }

  // ---- 부상 ----
  const HURT_W = {
    front: { cmdr: 2, gunner: 3, loader: 2, driver: 1 },
    side: { cmdr: 1, gunner: 1, loader: 2, driver: 2 },
    rear: { cmdr: 1, gunner: 0.5, loader: 1, driver: 3 },
  };
  function pickHurt(game, u, aspect) {
    const w = HURT_W[aspect] || HURT_W.side;
    const ms = u.crew.members.filter((m) => m.injury < 2);
    if (!ms.length) return null;
    const tot = ms.reduce((s, m) => s + w[m.role], 0);
    let r = game.rand() * tot;
    for (const m of ms) { r -= w[m.role]; if (r <= 0) return m; }
    return ms[ms.length - 1];
  }

  function hurt(game, u, m, level, events, silent) {
    const before = m.injury;
    m.injury = Math.max(m.injury, Math.min(2, level));
    if (m.injury === before) return;
    m.morale = clamp(m.morale - 10, 0, 100);
    if (!silent && !u.destroyed) {
      const who = TMM.CREW_ROLES[m.role].name + ' ' + m.name + ' ' + m.rank;
      const text = fill(m.injury >= 2 ? V().hurtHeavy : V().hurtLight, { who, role: TMM.CREW_ROLES[m.role].name });
      TMM.Radio.report(game, u, text, { prio: 2, kind: 'warn' }, events);
    }
    // 류경호 일병: 장 상사가 다치면 크게 흔들린다
    for (const o of u.crew.members) {
      if (o.traits.fears === m.key && !o.shaken) {
        o.shaken = true;
        o.morale = clamp(o.morale - 25, 0, 100);
        if (!u.destroyed && audible(game, u)) game.crewState.queue.push({ at: game.gameSeconds + 2, unitId: u.id, key: o.key, text: V().scared[1] });
      }
    }
  }

  // ---- 전투 사건 ----
  function onEvents(game, events) {
    const out = [];
    const now = game.gameSeconds;
    const C = K();
    for (const ev of events) {
      if (ev.type === 'arrive') {
        const u = ev.unit;
        if (u.side === 'friend' && !u.ally && u.crew && u.crew.rescue && u.order.type === 'withdraw' && !u.destroyed) {
          u.crew.rescue = null;
          adjustTrust(game, u, C.TRUST_SAVED, '위험할 때 철수시켜 살림', out);
          const c = member(u, 'cmdr');
          if (c && V().saved[c.key] && !heated(game)) TMM.Radio.report(game, u, V().saved[c.key].replace(/^강철 1, /, ''), { prio: 0 }, out);
        }
        continue;
      }
      if (ev.type !== 'shot') continue;
      const s = ev.shooter, t = ev.target, res = ev.res;
      const sPlatoon = s.side === 'friend' && !s.ally && s.crew;
      const tPlatoon = t.side === 'friend' && !t.ally && t.crew;
      if (sPlatoon && ev.friendlyFire) {
        addMorale(s, C.MORALE_FF);
        trustAll(game, C.TRUST_FF, '오인사격', out);
      } else if (sPlatoon && res.destroyed && t.side !== s.side) {
        s.crew.kills += 1;
        addMorale(s, C.MORALE_KILL);
        for (const o of game.units) if (o !== s && !o.destroyed) addMorale(o, C.MORALE_KILL_OTHERS);
        if (s.targetId === t.id && s.crew.trust != null) adjustTrust(game, s, C.TRUST_TARGET_KILL, '정확한 목표 지정', out);
        const ch = V().cheer[s.id];
        if (ch && !heated(game)) tryJoke(game, s, ch, 2);
      }
      if (tPlatoon && s.side === 'enemy') {
        game.crewState.lastIncoming = now;
        if (!res.hit) continue;
        t.crew.hitAt = now;
        if (res.destroyed) {
          // 기본 난이도: 전사 없이 중상까지
          for (const m of t.crew.members) hurt(game, t, m, game.rand() < 0.5 ? 2 : 1, out, true);
          for (const o of game.units) if (o !== t && !o.destroyed) addMorale(o, C.MORALE_LOSS);
          const o = t.order ? t.order.type : 'idle';
          const recent = t.crew.orderAt != null && now - t.crew.orderAt < C.RECKLESS_SEC;
          const exposed = t.state === 'moving' || !t.hullDown;
          const reckless = recent && exposed && (o === 'move' || o === 'bound' || o === 'withdraw');
          trustAll(game, reckless ? C.TRUST_RECKLESS_LOSS : C.TRUST_LOSS, reckless ? '무리한 명령으로 ' + t.callsign + ' 손실' : t.callsign + ' 손실', out, t);
          continue;
        }
        addMorale(t, res.pen ? C.MORALE_PEN : C.MORALE_HIT);
        if (res.pen) {
          if (game.rand() < 0.7) { const m = pickHurt(game, t, res.aspect); if (m) hurt(game, t, m, game.rand() < 0.4 ? 2 : m.injury + 1, out); }
          if (game.rand() < 0.25) { const m = pickHurt(game, t, res.aspect); if (m) hurt(game, t, m, m.injury + 1, out); }
        } else if (game.rand() < 0.1) {
          const m = pickHurt(game, t, res.aspect);
          if (m && m.injury === 0) hurt(game, t, m, 1, out);
        }
      }
    }
    events.push(...out);
  }

  // ---- 매 틱 ----
  function update(game, gdt, events) {
    const C = K();
    const now = game.gameSeconds;
    const combat = !quiet(game);
    const fatigue = (gdt / 60) * C.FATIGUE_PER_MIN * (combat ? C.FATIGUE_COMBAT_MUL : 1);
    for (const u of game.units) {
      if (!u.crew || u.destroyed) continue;
      for (const m of u.crew.members) m.fatigue = clamp(m.fatigue + fatigue * (m.traits.fatigueMul || 1) * (m.injury ? 1.5 : 1), 0, 100);
      // 조종수: 움직인 거리와 고장
      const d = u.crew.byRole.driver;
      if (d && u.state === 'moving' && !(u.stall > 0)) {
        const meters = (u.speedKmh / 3.6) * gdt;
        d.stats.meters += meters;
        grow(d, C.GROW_KM * meters / 1000);
        const rate = C.BREAKDOWN_PER_SEC * clamp(2 - eff(d), 0.4, 2) * (d.traits.breakdownMul || 1);
        if (game.rand() < rate * gdt) {
          const sec = Math.round(C.BREAKDOWN_SEC[0] + game.rand() * (C.BREAKDOWN_SEC[1] - C.BREAKDOWN_SEC[0]));
          u.stall = sec;
          d.stats.breakdowns += 1;
          TMM.Radio.report(game, u, fill(V().breakdown, { sec }), { prio: 1, kind: 'warn' }, events);
        }
      }
    }
    flushQueue(game, events);
    if (game.crewState.sys.length) events.push(...game.crewState.sys.splice(0)); // 명령 번복 등 사건 밖에서 생긴 신뢰도 알림

    // 조용할 때 잡담
    if (!combat && globalJokeOk(game) && game.rand() < gdt * C.BANTER_PER_SEC) {
      const list = V().banter.filter((b, i) => {
        if (game.crewState.usedBanter.has(i)) return false;
        const u = game.units.find((x) => x.id === b.tank);
        return u && !u.destroyed && audible(game, u) && b.lines.every(([k]) => { const m = byKey(u, k); return m && m.injury < 2; }) && canJoke(game, byKey(u, b.lines[0][0]));
      });
      if (list.length) {
        const b = pick(game, list);
        const u = game.units.find((x) => x.id === b.tank);
        if (tryJoke(game, u, b.lines, 3)) game.crewState.usedBanter.add(V().banter.indexOf(b));
      }
    }

    // 장만석 상사: 신뢰가 높으면 더 나은 진지를 먼저 제안한다
    if (Math.floor(now / 10) !== Math.floor((now - gdt) / 10)) {
      for (const u of game.units) {
        const c = member(u, 'cmdr');
        if (!c || !c.traits.veteran || u.destroyed || c.injury >= 2) continue;
        if (trustOf(u) < C.SUGGEST_ABOVE || u.state === 'moving' || u.damage.track || u.hullDown) continue;
        if (now - u.crew.suggestAt < 150 || u.crew.suggests >= 3 || heated(game)) continue;
        if (u.order.type !== 'cover' && u.order.type !== 'hold' && u.order.type !== 'idle' && u.order.type !== 'move') continue;
        const p = betterSpot(game, u, { x: u.x, y: u.y }, 6.5);
        u.crew.suggestAt = now;
        if (!p) continue;
        u.crew.suggests += 1;
        TMM.Radio.report(game, u, fill(pick(game, V().suggest), placeText(game, u, p)), { prio: 0 }, events);
      }
    }
  }

  // 전투가 끝났을 때 한 번
  function finish(game, events) {
    const st = game.crewState;
    if (!st || st.done) return;
    st.done = true;
    const C = K();
    const win = game.over && game.over.win;
    const lost = game.units.some((u) => u.destroyed);
    for (const u of game.units) {
      if (!u.crew) continue;
      if (!u.destroyed) {
        addMorale(u, win ? C.MORALE_WIN : C.MORALE_LOSE);
        for (const m of u.crew.members) grow(m, C.GROW_SURVIVE);
      }
      if (win) adjustTrust(game, u, lost ? C.TRUST_WIN : C.TRUST_WIN_CLEAN, lost ? '임무 완수' : '손실 없이 임무 완수', events);
    }
  }

  // ---- 결과 화면용 한 줄 요약 ----
  function memberLine(u, m) {
    const s = m.stats;
    const parts = [];
    const name = m.name + ' ' + m.rank;
    if (m.player) return null;
    if (m.role === 'gunner') {
      parts.push(s.shots ? s.shots + '발 쏴서 ' + s.hits + '발 명중' + (s.kills ? ', 격파 ' + s.kills : '') : '사격 기회 없음');
    } else if (m.role === 'loader') {
      parts.push(s.reloads ? '장전 ' + s.reloads + '회' + (s.slips ? ', 장전 실수 ' + s.slips + '회' : ', 실수 없음') : '장전할 일 없음');
    } else if (m.role === 'driver') {
      parts.push((s.meters / 1000).toFixed(1) + 'km 기동' + (s.breakdowns ? ', 정비 조치 ' + s.breakdowns + '회' : ''));
    } else if (m.role === 'cmdr') {
      parts.push('명령 ' + s.orders + '회 수행' + (s.asks ? ', 되물음 ' + s.asks + '회' : ''));
      if (u.crew.trust != null) parts.push('신뢰도 ' + Math.round(u.crew.trustStart) + '→' + Math.round(u.crew.trust));
    }
    const gain = m.skill - m.skill0;
    let note;
    if (m.injury >= 2) note = '중상, 후송 필요.';
    else if (gain >= 12) note = '많이 늘었다.';
    else if (gain >= 5) note = '조금 늘었다.';
    else if (m.injury === 1) note = '경상, 계속 근무 가능.';
    else if (m.fatigue >= 70) note = '많이 지쳤다.';
    else if (m.morale < 30) note = '사기가 바닥이다.';
    else if (m.traits.veteran && u.crew.trust != null && u.crew.trust - u.crew.trustStart >= 15) note = '소대장을 인정하기 시작했다.';
    else if (m.traits.grumble) note = '투덜댔지만 운전은 최고.';
    else note = '제 몫을 했다.';
    if (m.injury === 1 && note !== '경상, 계속 근무 가능.') note += ' (경상)';
    return name + ', ' + parts.join(', ') + '. ' + note;
  }

  function summaries(game) {
    const out = [];
    for (const u of game.units) {
      if (!u.crew) continue;
      for (const m of u.crew.members) {
        const text = memberLine(u, m);
        if (text) out.push({ unit: u, member: m, text });
      }
    }
    return out;
  }

  // ---- 패널용 ----
  function statusWord(m) {
    if (m.injury) return K().INJURY_NAME[m.injury];
    if (m.shaken) return '동요';
    if (m.fatigue >= 70) return '지침';
    if (m.morale < 30) return '사기 저하';
    return '';
  }

  return {
    init, snapshot, update, onEvents, finish,
    eff, aimMul, reloadMul, hitMul, speedMul, idMul, radioFactor,
    afterShot, earlyFire, noteOrder, interpret, beforeAck, ackBody, onExecuted, spotLine, onDirectOrder,
    summaries, trustLabel, statusWord, heated, member,
  };
})();
