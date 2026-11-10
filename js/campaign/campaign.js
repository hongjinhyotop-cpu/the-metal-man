/*
 * 캠페인 규칙 (DOM 없음 → 모의 캠페인에서도 씀): 캠페인 상태, 작전 → 전투 설정, 결과 이월, 재정비, 엔딩, 저장.
 *
 * 흐름: 프롤로그 → [작전 명령 → 전투 → 재정비] × 5 → 엔딩
 * 상태(state)는 작전이 끝날 때·재정비를 마칠 때 브라우저(localStorage)에 자동 저장된다.
 *   { v(2), phase('prologue'|'briefing'|'ending'), op(지금/다음 작전 번호 0~4), fails(실패한 작전 수),
 *     supply(대대 보급 상황 0 부족·1 보통·2 원활), k2Count(받은 K2 보충 수), recruitN(만든 보충병 수),
 *     tanks{호차: { alive, lostIn, model('K1A2'|'K2'), damage{부위}, ammo{K276,K277}, isNew }},
 *     crew{ 호차: { trust, members[{ key, role(자리), skill, morale, fatigue, injury, mods }] }, people{보충병 key: 정의} },
 *     reserve[후방 대기 승무원 { key, skill, morale, fatigue, injury, mods, from(원래 호차), spare(K2 보충으로 남은 탄약수) }],
 *     evac[후송된 승무원 { …, heavy, returnOp(이 작전 번호(0~4) 앞 재정비에서 복귀, 중상은 null = 72시간 안에 못 옴) }],
 *     usedEvents[재정비 이벤트 id], refitInfo(재정비 준비: 시간·K2 보충·이벤트), refit(마친 재정비 보고), refitPending,
 *     plan{호차: 철갑탄 수}, history[작전 결과], ending('complete'|'partial'|'collapse'|null) }
 *
 * M7b 재정비 (작전 사이에 주어진 시간 refitHours 를 나눠 쓴다. 다 할 수는 없다):
 *   정비 — 궤도 4시간·엔진 5시간 (전차별로 고른다). 주포·사격통제장치·무전기 같은 가벼운 손상은 승무원이 자체 정비(시간 안 듦).
 *   보급 — 탄약 요청 1시간(+1시간 추가 요청). 받는 양은 대대 보급 상황(작전 성공 ↑, 실패 ↓)에 따라 다르다.
 *   휴식 — 1시간마다 피로 −8. 2시간 이상 쉬면 남긴 경상자가 낫는다.
 *   부상자 — 중상: 후송(1시간, 캠페인 끝까지 못 돌아옴) / 데리고 감(실력 ×0.5). 경상: 남김 / 후송(1시간, 1~2작전 뒤 복귀).
 *   결원 — 대대 보충병(능력 낮은 신병) 또는 다른 전차·후방 대기에서 재배치. 전차장·포수·조종수 자리는 비울 수 없다.
 *   K2 보충 — 전차를 잃으면 작전 2 이후 재정비에서 대대가 K2 를 보내 줄 수 있다(캠페인 전체 최대 2대, 성과가 좋으면 확률 ↑).
 *            잃은 전차 번호(1호차 우선)를 받고, 그 전차의 승무원 3명(전차장·포수·조종수)이 탄다. 남는 탄약수는 플레이어가 배치.
 *   승무원 이벤트 — 재정비마다 짧은 대화 1~2개 (TMM.CREW_EVENTS). 선택에 따라 사기·신뢰도가 바뀐다.
 *   '추천대로 하기'(recommend) 는 M7a 의 자동 재정비처럼 알아서 고른다.
 *
 * 작전에 실패하면 다음 작전이 불리해진다: 적이 경로 앞쪽(더 가까이)에서 출발, 진지 방어 적은 1대 더, 늦게 오는 적은 더 일찍. 보급 상황도 나빠진다.
 */
TMM.Campaign = (function () {
  const SAVE_KEY = 'tmm.campaign.v1';
  const OPS = () => TMM.CAMPAIGN.OPS;
  const K = {
    LIGHT_PARTS: ['gun', 'fcs', 'radio'], // 승무원 자체 정비 (시간 안 듦)
    HEAVY_PARTS: ['track', 'engine'], // 재정비 시간을 들여 고침
    REPAIR_H: { track: 4, engine: 5 },
    SUPPLY_H: 1, // 탄약 보급 요청
    SUPPLY_EXTRA_H: 1, // 추가 요청
    SUPPLY_POOL: [30, 48, 66], // 대대 보급 상황(부족·보통·원활)별 소대가 받는 탄 (발)
    SUPPLY_EXTRA_MUL: 0.5, // 추가 요청으로 더 받는 양 (보급 상황이 '부족'이면 불가)
    SUPPLY_NAME: ['부족', '보통', '원활'],
    EVAC_H: 1, // 후송 한 명 (응급처치·호송 준비)
    REST_FATIGUE: 8, // 휴식 1시간마다 피로 회복
    REST_MORALE: 2,
    BASE_FATIGUE: 3, // 휴식을 안 해도 회복되는 피로
    FATIGUE_MIN: 5,
    HEAL_REST_H: 2, // 이만큼 쉬면 남긴 경상자가 낫는다
    RECRUITS_PER_REFIT: 3, // 한 번 재정비에 받을 수 있는 대대 보충병
    LIGHT_RETURN: [1, 2], // 경상 후송자는 이만큼 작전을 쉬고 돌아온다
    K2_MAX: 2,
    K2_FROM_OP: 2, // 이 작전(번호)이 끝난 뒤의 재정비부터 K2 보충 가능
    K2_P: 0.05, K2_P_SUCCESS: 0.32, K2_P_KILLS: 0.2, K2_P_MAX: 0.6, // 보충 확률 = 기본 + 성공 + 격파 비율 × …
    MAX_PRESSURE: 2, // 실패 누적 효과 상한
    PRESSURE_DELAY_SEC: 90, // 실패 1번마다 늦게 오는 적이 이만큼 일찍
  };
  const IDS = [1, 2, 3, 4];
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const total = (a) => (a.K276 || 0) + (a.K277 || 0);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ammoMax = (t) => TMM.VEHICLES[t.model || 'K1A2'].ammoMax || 32;
  const seatRoles = (t) => TMM.VEHICLES[t.model || 'K1A2'].crewRoles || TMM.CREW_ROLE_ORDER;
  const REQUIRED = ['cmdr', 'gunner', 'driver']; // 비울 수 없는 자리 (K1A2 탄약수는 비울 수 있다 — 3명 K1A2)

  let known = null; // 마지막으로 쓴 상태의 보충병 정의 (crewName 용)
  const people = (s) => (s && s.crew && s.crew.people) || {};
  const def = (s, key) => TMM.Crew.personDef(key, people(s));

  function newState() {
    const tanks = {};
    for (const id of IDS) tanks[id] = { alive: true, lostIn: null, model: 'K1A2', damage: { track: false, engine: false, gun: false, fcs: false, radio: false }, ammo: { K276: 20, K277: 12 } };
    const crew = { people: {} };
    const f0 = TMM.CREW.START_FATIGUE[OPS()[0].light] || 12;
    for (const id of IDS) {
      crew[id] = { trust: id === 1 ? null : TMM.CREW_TRUST_START[id], members: TMM.CREW_ROSTER[id].map((d) => ({ key: d.key, role: d.role, skill: d.skill, morale: d.morale, fatigue: f0, injury: 0 })) };
    }
    const s = {
      v: 2, phase: 'prologue', op: 0, fails: 0, supply: 2, k2Count: 0, recruitN: 0,
      tanks, crew, reserve: [], evac: [], usedEvents: [], plan: {}, history: [], refit: null, refitInfo: null, ending: null, savedAt: null,
    };
    known = s.crew.people;
    resetPlan(s);
    return s;
  }

  const aliveIds = (s) => IDS.filter((id) => s.tanks[id].alive);
  // 소대장이 타는 전차: 1호차, 없으면 4호차, 없으면 남은 전차
  function leaderTank(s) {
    const a = aliveIds(s);
    return a.includes(1) ? 1 : a.includes(4) ? 4 : a[0] || null;
  }

  // 작전 명령 화면의 탄종 배분 기본값: 그 작전의 권장 철갑탄 비율 (가진 탄 안에서)
  function resetPlan(s) {
    const op = OPS()[Math.min(s.op, OPS().length - 1)];
    for (const id of IDS) {
      const t = total(s.tanks[id].ammo);
      s.plan[id] = Math.max(0, Math.min(t, Math.round((op.ammo / 32) * t)));
    }
  }
  function setPlan(s, id, ap) {
    const t = total(s.tanks[id].ammo);
    s.plan[id] = Math.max(0, Math.min(t, Math.round(ap)));
  }
  // 배분을 전차에 적용 (출동할 때)
  function applyPlan(s) {
    for (const id of aliveIds(s)) {
      const t = total(s.tanks[id].ammo);
      const ap = Math.max(0, Math.min(t, s.plan[id] != null ? s.plan[id] : 20));
      s.tanks[id].ammo = { K276: ap, K277: t - ap };
    }
  }

  const pressure = (s) => Math.min(K.MAX_PRESSURE, s.fails);

  // 작전 → Battle.create 의 opts.op
  function battleSpec(s) {
    const op = OPS()[s.op];
    const p = pressure(s);
    const R = TMM.Platoon.ROSTER;
    const lead = leaderTank(s);
    const units = aliveIds(s).map((id) => {
      // 궤도 손상(이동 불가) 전차는 작전 위치로 나갈 수 없다 → rearPos 가 있으면 거기(주둔지)에 남는다
      const stuck = s.tanks[id].damage.track && op.rearPos;
      const pos = stuck ? op.rearPos[id] : op.units ? op.units[id] : [R.find((d) => d.id === id).x, R.find((d) => d.id === id).y];
      return { id, x: pos[0], y: pos[1], heading: op.heading, ammo: copy(s.tanks[id].ammo), damage: copy(s.tanks[id].damage), model: s.tanks[id].model || 'K1A2', leader: id === lead };
    });
    let enemies = op.enemies === 'roster-3' ? copy(TMM.Enemy.ROSTER.filter((d) => d.n !== 2)).map((d, i) => Object.assign(d, { n: i + 1 })) : copy(op.enemies || TMM.Enemy.ROSTER);
    if (op.enemiesExtra) enemies = enemies.concat(copy(op.enemiesExtra)); // M8a: 천마호 편성 뒤에 붙는 적 (보병 대전차조 등)
    if (op.extra && p) enemies = enemies.concat(copy(op.extra.slice(0, p)));
    enemies.forEach((d, i) => { if (d.n == null || op.enemies === 'roster-3' || op.enemiesExtra) d.n = i + 1; });
    enemies = enemies.map((d, i) => {
      d.id = 101 + i;
      if (!d.static && p && d.route && d.route.length > p + 1) {
        // 앞 작전 실패: 적이 경로의 앞쪽(더 가까이)에서 출발한다
        const k = p;
        d.x = d.route[k - 1][0];
        d.y = d.route[k - 1][1];
        d.route = d.route.slice(k);
        if (d.stage >= 0) d.stage = Math.max(0, d.stage - k);
      }
      if (d.delay && p) d.delay = Math.max(0, d.delay - K.PRESSURE_DELAY_SEC * p);
      return d;
    });
    const marks = op.marks.map((m) => copy(m));
    if (op.objective.type === 'bridge') {
      // 하천선(넘어오면 실패) — 덕천 중심선 동쪽 4칸
      const pts = [];
      for (let y = 48; y <= 104; y += 4) pts.push([TMM.Geo.riverX(y) + 4, y]);
      for (const m of marks) if (m.type === 'line') m.pts = pts;
    }
    return {
      no: op.no, key: op.key, name: op.name, when: op.when, light: op.light, startSeconds: op.startSeconds,
      units, enemies, allies: !!op.allies, rally: op.rally, exits: op.exits,
      objective: copy(op.objective), calls: op.calls ? copy(op.calls).sort((a, b) => a.at - b.at) : [], marks, intro: op.intro.slice(), pressure: p,
      fires: op.fires ? copy(op.fires) : null, threats: (op.threats || []).slice(), // M8a 포병·드론, 새 위협 안내
    };
  }

  // 앞 작전 실패의 영향 (작전 명령 화면 문구)
  function pressureText(s) {
    const p = pressure(s);
    if (!p) return '';
    const op = OPS()[s.op];
    const parts = [];
    if (op.extra) parts.push('적 진지에 전차 ' + p + '대 증원');
    else parts.push('적이 ' + (p === 1 ? '한 구간' : '두 구간') + ' 더 가까이서 출발');
    if (op.enemies && op.enemies.some((e) => e.delay)) parts.push('늦게 오는 적이 ' + (K.PRESSURE_DELAY_SEC * p) / 60 + '분 일찍 도착');
    return '앞선 작전 실패 ' + s.fails + '회의 여파: ' + parts.join(', ') + '.';
  }

  // 승무원 정의 (이름·계급·보직·성격). s 를 안 주면 마지막으로 쓴 캠페인의 보충병까지 찾는다.
  const crewName = (key, s) => TMM.Crew.personDef(key, s ? people(s) : known);
  const trustOf = (snap, id) => (snap && snap[id] && snap[id].trust != null ? snap[id].trust : TMM.CREW_TRUST_START[id]);

  // ---------------------------------------------------------------- 사람 찾기
  // 승무원 기록 하나 찾기: { m(기록), tank(호차 | null), where('tank'|'reserve'|'evac') }
  function locate(s, key) {
    for (const id of IDS) {
      const sv = s.crew[id];
      const m = sv && sv.members.find((x) => x.key === key);
      if (m) return { m, tank: id, where: 'tank' };
    }
    const r = s.reserve.find((x) => x.key === key);
    if (r) return { m: r, tank: null, where: 'reserve' };
    const e = s.evac.find((x) => x.key === key);
    if (e) return { m: e, tank: null, where: 'evac' };
    return null;
  }
  // 소대에 있는(후송 안 된) 사람 전부
  function present(s) {
    const out = [];
    for (const id of IDS) if (s.crew[id]) for (const m of s.crew[id].members) out.push({ m, tank: s.tanks[id].alive ? id : null });
    for (const m of s.reserve) out.push({ m, tank: null });
    return out;
  }
  const isRecruit = (s, key) => { const d = def(s, key); return !!(d && d.recruit); };

  // ---------------------------------------------------------------- 전투가 끝났을 때
  // 결과 이월 → 재정비 준비(또는 엔딩) → 저장. 반환: 갱신된 state
  function record(s, game) {
    known = people(s);
    const op = OPS()[s.op];
    const over = game.over;
    const before = s.crew;
    const after = TMM.Crew.snapshot(game);
    const lostNow = [];
    for (const u of game.units) {
      const t = s.tanks[u.id];
      t.damage = copy(u.damage);
      t.ammo = { K276: u.ammo.K276 || 0, K277: u.ammo.K277 || 0 };
      t.isNew = false;
      if (u.destroyed && t.alive) {
        t.alive = false;
        t.lostIn = op.no;
        lostNow.push(u.id);
      }
    }
    s.crew = Object.assign({}, before || {}, after);
    s.crew.people = Object.assign({}, people({ crew: before }), after.people);
    const trust = {};
    for (const id of [2, 3, 4]) trust[id] = [Math.round(trustOf(before, id)), Math.round(trustOf(s.crew, id))];
    const kills = game.enemies.filter((e) => e.destroyed && !e.abandoned).length;
    s.history.push({
      no: op.no, name: op.name, result: over.result, reason: over.reason || '',
      kills, abandoned: game.enemies.filter((e) => e.abandoned).length, fled: game.enemies.filter((e) => e.exited && !e.ai.pending).length, enemyTotal: game.enemies.length,
      lost: lostNow, minutes: Math.round((over.at - game.startSeconds) / 60), trust, ff: game.ffCount || 0,
      support: game.support ? game.support.state : null,
    });
    if (over.result === 'fail') { s.fails += 1; s.supply = Math.max(0, s.supply - 1); }
    else if (over.result === 'success') s.supply = Math.min(2, s.supply + 1);

    if (over.result === 'collapse' || aliveIds(s).length < TMM.Objective.COLLAPSE_BELOW) {
      s.phase = 'ending';
      s.ending = 'collapse';
    } else if (s.op >= OPS().length - 1) {
      s.phase = 'ending';
      s.ending = endingKind(s);
    } else {
      s.op += 1;
      s.phase = 'briefing';
      s.refitInfo = prepareRefit(s, game.rand || Math.random, { result: over.result, lostNow, trust, kills, enemyTotal: game.enemies.length });
      s.refit = null;
      s.refitPending = true; // 재정비 화면을 먼저 보여 준다
    }
    return s;
  }

  function endingKind(s) {
    const last = s.history[s.history.length - 1];
    const fails = s.history.filter((h) => h.result !== 'success').length;
    return last && last.result === 'success' && fails <= 1 ? 'complete' : 'partial';
  }

  // ---------------------------------------------------------------- 재정비 준비 (전투 직후 한 번)
  // 자체 정비(가벼운 손상), 후송자 복귀, K2 보충 판정, 잃은 전차 승무원 → 후방 대기, 승무원 이벤트 고르기
  function prepareRefit(s, rand, r) {
    const nextOp = OPS()[s.op];
    const info = { hours: nextOp.refitHours || 6, result: r.result, lostNow: r.lostNow, trust: r.trust, light: {}, returned: [], k2: null, spare: null, events: [], eventsDone: {}, k2Chance: 0 };
    // 1. 가벼운 손상은 승무원이 자체 정비
    for (const id of aliveIds(s)) {
      const t = s.tanks[id];
      const fixed = K.LIGHT_PARTS.filter((k) => t.damage[k]);
      for (const k of fixed) t.damage[k] = false;
      if (fixed.length) info.light[id] = fixed;
    }
    // 2. 후송됐던 경상자 복귀
    for (const e of s.evac.slice()) {
      if (e.returnOp != null && e.returnOp <= s.op) {
        s.evac.splice(s.evac.indexOf(e), 1);
        const m = Object.assign({}, e, { injury: 0, fatigue: 10, morale: Math.max(e.morale, 55) });
        delete m.heavy; delete m.returnOp;
        s.reserve.push(m);
        info.returned.push(m.key);
      }
    }
    // 3. K2 보충 (작전 2 이후, 잃은 전차가 있을 때, 캠페인 최대 2대)
    const dead = IDS.filter((id) => !s.tanks[id].alive);
    const doneNo = OPS()[s.op - 1].no;
    if (dead.length && doneNo >= K.K2_FROM_OP && s.k2Count < K.K2_MAX) {
      const p = Math.min(K.K2_P_MAX, K.K2_P + (r.result === 'success' ? K.K2_P_SUCCESS : 0) + K.K2_P_KILLS * (r.enemyTotal ? r.kills / r.enemyTotal : 0));
      info.k2Chance = Math.round(p * 100);
      if (rand() < p) {
        const slot = dead.includes(1) ? 1 : dead[0];
        s.k2Count += 1;
        s.tanks[slot] = { alive: true, lostIn: null, model: 'K2', isNew: true, damage: { track: false, engine: false, gun: false, fcs: false, radio: false }, ammo: copy(TMM.VEHICLES.K2.ammoLoad) };
        info.k2 = slot;
      }
    }
    // 4. 잃은 전차의 승무원 → 후방 대기 (소대장은 1호차 기록에 남아 다른 전차에 동승). 새 K2 에는 그 전차 승무원 3명.
    for (const id of IDS) {
      const sv = s.crew[id] || (s.crew[id] = { trust: id === 1 ? null : TMM.CREW_TRUST_START[id], members: [] });
      const t = s.tanks[id];
      if (!t.alive) {
        const keep = [];
        for (const m of sv.members) {
          if (def(s, m.key) && def(s, m.key).player) { keep.push(m); continue; }
          s.reserve.push(Object.assign({}, m, { from: id }));
        }
        sv.members = keep;
        continue;
      }
      if (info.k2 !== id) continue;
      // 새 K2: 그 전차에 남은 사람(방금 격파) 또는 후방 대기 중인 그 전차 출신으로 전차장·포수·조종수
      const seats = {};
      for (const m of sv.members) seats[m.role] = m;
      sv.members = [];
      for (const m of Object.values(seats)) if (m.role === 'loader' || !seatRoles(t).includes(m.role)) s.reserve.push(Object.assign({}, m, { from: id }));
      for (const role of seatRoles(t)) {
        let m = seats[role] && seats[role].role === role ? seats[role] : null;
        if (!m) {
          const i = s.reserve.findIndex((x) => x.from === id && x.role === role);
          if (i >= 0) m = s.reserve.splice(i, 1)[0];
        }
        if (role === 'cmdr' && id === 1) {
          // 소대장이 새 1호차의 전차장
          const pi = IDS.map((k) => s.crew[k]).find((c) => c && c.members.some((x) => def(s, x.key).player));
          if (pi) { m = pi.members.find((x) => def(s, x.key).player); pi.members = pi.members.filter((x) => x !== m); }
        }
        if (m) { delete m.from; delete m.spare; m.role = role; sv.members.push(m); }
      }
      const loaderGone = s.reserve.filter((x) => x.from === id && x.role === 'loader');
      for (const x of loaderGone) x.spare = true;
      if (loaderGone.length) info.spare = loaderGone[0].key;
    }
    // 5. 승무원 이벤트 1~2개
    info.events = pickEvents(s, rand);
    known = people(s);
    return info;
  }

  function eventEligible(s, ev) {
    if (s.usedEvents.includes(ev.id)) return false;
    if ((ev.minOp || 0) > OPS()[s.op].no) return false;
    const here = present(s);
    return ev.need.every((k) => (k === 'recruit' ? here.some((x) => isRecruit(s, x.m.key)) : here.some((x) => x.m.key === k)));
  }
  function pickEvents(s, rand) {
    const list = TMM.CREW_EVENTS.filter((ev) => eventEligible(s, ev));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const n = list.length >= 2 && rand() < 0.55 ? 2 : Math.min(1, list.length);
    return list.slice(0, n).map((ev) => ev.id);
  }

  // 이벤트 선택지 (그 선택지에 필요한 사람이 없으면 뺀다)
  function eventChoices(s, ev) {
    const here = present(s);
    return ev.choices.map((c, i) => ({ c, i })).filter(({ c }) => !c.need || c.need.every((k) => here.some((x) => x.m.key === k)));
  }
  // 'recruit' 같은 대명사를 실제 사람으로
  function resolveKey(s, key) {
    if (key !== 'recruit') return key;
    const r = present(s).find((x) => isRecruit(s, x.m.key));
    return r ? r.m.key : null;
  }

  // 이벤트 선택. 반환: 결과 대사 + 바뀐 수치 [{ who, what, d }]
  function chooseEvent(s, evId, idx) {
    const ev = TMM.CREW_EVENTS.find((e) => e.id === evId);
    const info = s.refitInfo;
    if (!ev || !info || info.eventsDone[evId]) return null;
    const ch = ev.choices[idx];
    const changes = [];
    const nameOf = (key) => { const d = def(s, key); return d ? (d.player ? '소대장' : d.name + ' ' + d.rank) : key; };
    for (const fx of ch.fx) {
      const [kind, k0, a] = fx;
      if (kind === 'moraleAll') {
        for (const x of present(s)) x.m.morale = clamp(x.m.morale + k0, 0, 100);
        changes.push({ who: '소대 전원', what: '사기', d: k0 });
        continue;
      }
      const key = resolveKey(s, k0);
      const loc = key && locate(s, key);
      if (!loc || loc.where === 'evac') continue;
      if (kind === 'morale') { loc.m.morale = clamp(loc.m.morale + a, 0, 100); changes.push({ who: nameOf(key), what: '사기', d: a }); }
      else if (kind === 'skill') { loc.m.skill = clamp(loc.m.skill + a, 0, 100); changes.push({ who: nameOf(key), what: '숙련도', d: a }); }
      else if (kind === 'fatigue') { loc.m.fatigue = clamp(loc.m.fatigue + a, 0, 100); changes.push({ who: nameOf(key), what: '피로', d: a }); }
      else if (kind === 'mod') { loc.m.mods = Object.assign({}, loc.m.mods, a); }
      else if (kind === 'trust') {
        const id = loc.tank;
        if (id && s.crew[id].trust != null) { s.crew[id].trust = clamp(s.crew[id].trust + a, 0, 100); changes.push({ who: id + '호차', what: '신뢰도', d: a }); }
      } else if (kind === 'moraleTank') {
        const id = loc.tank;
        if (!id) continue;
        for (const m of s.crew[id].members) m.morale = clamp(m.morale + a, 0, 100);
        changes.push({ who: id + '호차 승무원', what: '사기', d: a });
      }
    }
    if (!s.usedEvents.includes(evId)) s.usedEvents.push(evId);
    s.eventChoices = Object.assign({}, s.eventChoices, { [evId]: idx });
    info.eventsDone[evId] = { choice: idx, changes };
    return { lines: ch.lines.map(([k, t]) => [resolveKey(s, k) || k, t]), changes };
  }

  // ---------------------------------------------------------------- 재정비 계획
  // plan = { repair{호차:{track,engine}}, supply(0 안 함·1 요청·2 추가 요청), rest(시간), wounded{key:'evac'|'keep'}, seats{호차:{자리: key|'NEW'|null}} }

  function woundedList(s) {
    return present(s).filter((x) => x.m.injury > 0 && !def(s, x.m.key).player);
  }

  function blankPlan(s) {
    const plan = { repair: {}, supply: 0, rest: 0, wounded: {}, seats: {}, prevSeat: {} };
    for (const id of aliveIds(s)) {
      plan.repair[id] = { track: false, engine: false };
      const seats = {};
      for (const role of seatRoles(s.tanks[id])) seats[role] = null;
      for (const m of s.crew[id].members) if (role0(m, seats)) seats[m.role] = m.key;
      plan.seats[id] = seats;
    }
    for (const x of woundedList(s)) plan.wounded[x.m.key] = 'keep';
    return plan;
  }
  const role0 = (m, seats) => Object.prototype.hasOwnProperty.call(seats, m.role) && seats[m.role] == null;

  // 지금 계획에서 어느 자리에 앉아 있나: { id, role } | null
  function seatOf(plan, key) {
    for (const id in plan.seats) for (const role in plan.seats[id]) if (plan.seats[id][role] === key) return { id: Number(id), role };
    return null;
  }
  const isPlayer = (s, key) => !!(def(s, key) && def(s, key).player);

  // 자리 배정. value: 사람 key | 'NEW'(보충병) | null(비움). 다른 전차에 앉아 있던 사람이면 자리를 맞바꾼다.
  function assign(s, plan, id, role, value) {
    const seats = plan.seats[id];
    if (!seats || !(role in seats)) return false;
    const cur = seats[role];
    if (cur && isPlayer(s, cur)) return false; // 소대장 자리는 고정
    if (value === cur) return true;
    if (value == null && REQUIRED.includes(role)) return false;
    if (value && value !== 'NEW') {
      if (isPlayer(s, value)) return false;
      if (plan.wounded[value] === 'evac') return false;
      const from = seatOf(plan, value);
      if (from) plan.seats[from.id][from.role] = cur && cur !== 'NEW' ? cur : (REQUIRED.includes(from.role) ? 'NEW' : null);
    }
    if (value === 'NEW' && newCount(plan) >= K.RECRUITS_PER_REFIT && cur !== 'NEW') return false;
    seats[role] = value;
    return true;
  }
  const newCount = (plan) => { let n = 0; for (const id in plan.seats) for (const r in plan.seats[id]) if (plan.seats[id][r] === 'NEW') n++; return n; };

  // 부상자 처리 바꾸기. 후송하면 자리가 빈다(필수 자리는 보충병으로 채움). 다시 남기면 비어 있던 원래 자리로 돌아간다.
  function setWounded(s, plan, key, v) {
    if (!(key in plan.wounded)) return;
    plan.wounded[key] = v;
    if (v === 'evac') {
      const at = seatOf(plan, key);
      if (at) {
        plan.prevSeat[key] = at;
        plan.seats[at.id][at.role] = null;
        fillSeat(s, plan, at.id, at.role);
      }
    } else {
      const p = plan.prevSeat[key];
      if (p && plan.seats[p.id] && (plan.seats[p.id][p.role] == null || plan.seats[p.id][p.role] === 'NEW')) plan.seats[p.id][p.role] = key;
    }
  }

  // 빈자리 채우기: 후방 대기 중 같은 보직(다치지 않은 사람 우선) → 다른 보직 → 보충병. 탄약수 자리는 보충병까지 다 떨어지면 비움.
  function candidatesFor(s, plan, role) {
    const free = present(s).filter((x) => !isPlayer(s, x.m.key) && plan.wounded[x.m.key] !== 'evac' && !seatOf(plan, x.m.key));
    const score = (x) => (def(s, x.m.key).role === role ? 0 : 10) + x.m.injury * 4 - x.m.skill / 50;
    return free.sort((a, b) => score(a) - score(b));
  }
  function fillSeat(s, plan, id, role) {
    const c = candidatesFor(s, plan, role)[0];
    // 같은 보직이면 바로, 다른 보직이면 보충병(숙련도 약 28)보다 나을 때만
    if (c && (def(s, c.m.key).role === role ? c.m.injury < 2 : c.m.injury < 1 && c.m.skill * TMM.CREW.OFF_ROLE_MUL > 30)) plan.seats[id][role] = c.m.key;
    else if (newCount(plan) < K.RECRUITS_PER_REFIT || REQUIRED.includes(role)) plan.seats[id][role] = 'NEW';
  }

  // 시간 계산: { items[{ what, h }], used, hours, left }
  function planCost(s, plan) {
    const items = [];
    for (const id in plan.repair) for (const k of K.HEAVY_PARTS) if (plan.repair[id][k]) items.push({ what: id + '호차 ' + TMM.PARTS[k].name + ' 수리', h: K.REPAIR_H[k] });
    if (plan.supply >= 1) items.push({ what: '탄약 보급 요청', h: K.SUPPLY_H });
    if (plan.supply >= 2) items.push({ what: '추가 탄약 요청', h: K.SUPPLY_EXTRA_H });
    const ev = Object.values(plan.wounded).filter((v) => v === 'evac').length;
    if (ev) items.push({ what: '부상자 후송 ' + ev + '명', h: ev * K.EVAC_H });
    if (plan.rest) items.push({ what: '휴식', h: plan.rest });
    const used = items.reduce((a, x) => a + x.h, 0);
    const hours = s.refitInfo ? s.refitInfo.hours : 6;
    return { items, used, hours, left: hours - used };
  }

  // 보급으로 받을 탄과 전차별 결과 (화면 미리보기·적용 공용). 반환: { pool, level, add{호차: 발}, after{호차: 발} }
  function supplyPreview(s, plan) {
    const level = s.supply;
    let pool = 0;
    if (plan.supply >= 1) pool = K.SUPPLY_POOL[level];
    if (plan.supply >= 2 && level > 0) pool += Math.round(K.SUPPLY_POOL[level] * K.SUPPLY_EXTRA_MUL);
    const ids = aliveIds(s);
    const now = {}, add = {};
    for (const id of ids) { now[id] = total(s.tanks[id].ammo); add[id] = 0; }
    let left = pool;
    while (left > 0) {
      let best = null, br = Infinity;
      for (const id of ids) {
        const mx = ammoMax(s.tanks[id]);
        if (now[id] + add[id] >= mx) continue;
        const r = (now[id] + add[id]) / mx;
        if (r < br) { br = r; best = id; }
      }
      if (best == null) break;
      add[best] += 1;
      left -= 1;
    }
    const after = {};
    for (const id of ids) after[id] = now[id] + add[id];
    return { pool, used: pool - left, level, add, after, extraOk: level > 0 };
  }

  // '추천대로 하기': 보급 → 중상자 후송 → 궤도 → 엔진 → (탄이 모자라면) 추가 보급 → 남은 시간 휴식, 빈자리는 후방 대기·보충병으로
  function recommend(s) {
    const plan = blankPlan(s);
    const hours = s.refitInfo ? s.refitInfo.hours : 6;
    let left = hours;
    const needAmmo = aliveIds(s).some((id) => total(s.tanks[id].ammo) < ammoMax(s.tanks[id]));
    if (needAmmo) { plan.supply = 1; left -= K.SUPPLY_H; }
    // 전차에 앉은 중상자만 후송 (후방 대기 중인 중상자는 데리고 다녀도 전투에 지장 없음)
    for (const x of woundedList(s)) {
      if (x.m.injury >= 2 && seatOf(plan, x.m.key) && left >= K.EVAC_H) { setWounded(s, plan, x.m.key, 'evac'); left -= K.EVAC_H; }
    }
    for (const part of ['track', 'engine']) {
      for (const id of aliveIds(s)) {
        if (s.tanks[id].damage[part] && left >= K.REPAIR_H[part]) { plan.repair[id][part] = true; left -= K.REPAIR_H[part]; }
      }
    }
    if (plan.supply === 1 && s.supply > 0 && left >= K.SUPPLY_EXTRA_H + 2) {
      const pv = supplyPreview(s, plan);
      if (aliveIds(s).some((id) => pv.after[id] < ammoMax(s.tanks[id]) * 0.85)) { plan.supply = 2; left -= K.SUPPLY_EXTRA_H; }
    }
    plan.rest = Math.max(0, Math.floor(left));
    // 빈자리, 그리고 후방에 더 나은 같은 보직이 놀고 있으면 바꿔 앉힌다
    for (const id of aliveIds(s)) for (const role of seatRoles(s.tanks[id])) if (plan.seats[id][role] == null) fillSeat(s, plan, id, role);
    const worth = (key, role) => {
      if (!key) return 0;
      if (key === 'NEW') return 28;
      const loc = locate(s, key);
      return loc.m.skill * (def(s, key).role === role ? 1 : TMM.CREW.OFF_ROLE_MUL) * TMM.CREW.INJURY_MUL[loc.m.injury];
    };
    const all = [];
    for (const id of aliveIds(s)) for (const role of seatRoles(s.tanks[id])) all.push({ id, role });
    all.sort((a, b) => worth(plan.seats[a.id][a.role], a.role) - worth(plan.seats[b.id][b.role], b.role)); // 가장 약한 자리부터
    for (const { id, role } of all) {
      const cur = plan.seats[id][role];
      if (cur && isPlayer(s, cur)) continue;
      const best = candidatesFor(s, plan, role).find((x) => def(s, x.m.key).role === role && x.m.injury < 2);
      if (best && worth(best.m.key, role) > worth(cur, role) + 10) assign(s, plan, id, role, best.m.key);
    }
    return plan;
  }

  // 아무것도 하지 않는 계획 (모의 캠페인 '가만히'용): 필수 자리만 보충병으로 채움
  function idlePlan(s) {
    const plan = blankPlan(s);
    for (const id of aliveIds(s)) for (const role of REQUIRED) if (plan.seats[id][role] == null) plan.seats[id][role] = 'NEW';
    return plan;
  }

  // 보충병 하나 만들기 (가상 인물, 이름·성격은 순서대로 정해진다)
  function makeRecruit(s, role) {
    const R = TMM.CREW_RECRUITS;
    const used = new Set(present(s).map((x) => (def(s, x.m.key) || {}).name).concat(s.evac.map((x) => (def(s, x.key) || {}).name)));
    let n = s.recruitN, name;
    for (let tries = 0; tries < 40; tries++) {
      name = R.FAMILY[(n * 7 + 3 + tries) % R.FAMILY.length] + R.GIVEN[(n * 11 + 5 + tries * 3) % R.GIVEN.length];
      if (!used.has(name)) break;
    }
    const ty = R.TYPES[(n * 3 + 1) % R.TYPES.length];
    s.recruitN = n + 1;
    const key = 'r' + s.recruitN;
    const skill = 20 + ((n * 5) % 13);
    // 전차장 자리에는 초임 하사가 온다
    const d = { key, name, rank: role === 'cmdr' ? '하사' : R.RANKS[n % R.RANKS.length], role, skill, morale: 55 + (ty.morale || 0), traits: Object.assign({}, ty.traits), recruit: true, about: '대대 보충병 · ' + ty.name + ' — ' + ty.about, type: ty.name };
    s.crew.people[key] = d;
    known = s.crew.people;
    return { key, role, skill, morale: d.morale, fatigue: 8, injury: 0 };
  }

  // 재정비 적용. 반환: 보고 (화면용). s.refit 에 담고 refitPending 을 끈다.
  function applyRefit(s, plan, rand) {
    rand = rand || Math.random;
    const info = s.refitInfo || { hours: 6 };
    const cost = planCost(s, plan);
    const rep = { hours: info.hours, used: cost.used, items: cost.items, repaired: {}, light: info.light || {}, supply: null, rest: plan.rest, evac: [], kept: [], healed: [], recruits: [], autoFilled: [], moved: [], k2: info.k2, spare: info.spare, returned: info.returned || [] };
    // 1. 정비
    for (const id in plan.repair) for (const k of K.HEAVY_PARTS) if (plan.repair[id][k] && s.tanks[id].alive && s.tanks[id].damage[k]) {
      s.tanks[id].damage[k] = false;
      (rep.repaired[id] = rep.repaired[id] || []).push(k);
    }
    // 2. 보급
    const sp = supplyPreview(s, plan);
    for (const id in sp.add) {
      const t = s.tanks[id];
      const tot = total(t.ammo) + sp.add[id];
      t.ammo = { K276: Math.min(t.ammo.K276, tot), K277: 0 };
      t.ammo.K277 = tot - t.ammo.K276;
    }
    rep.supply = { level: sp.level, pool: sp.pool, add: sp.add, after: sp.after, requested: plan.supply };
    // 3. 필수 자리 확인 (비어 있으면 보충병)
    for (const id of aliveIds(s)) for (const role of REQUIRED) if (plan.seats[id] && plan.seats[id][role] == null) { plan.seats[id][role] = 'NEW'; rep.autoFilled.push(id + '호차 ' + TMM.CREW_ROLES[role].name); }
    // 4. 사람 다시 앉히기
    const all = new Map();
    for (const x of present(s)) all.set(x.m.key, { m: x.m, tank: x.tank });
    const oldSeat = new Map();
    for (const id of IDS) for (const m of (s.crew[id] ? s.crew[id].members : [])) oldSeat.set(m.key, { id, role: m.role });
    const seated = new Set();
    for (const id of aliveIds(s)) {
      const members = [];
      for (const role of seatRoles(s.tanks[id])) {
        const v = plan.seats[id] ? plan.seats[id][role] : null;
        if (!v) continue;
        let m;
        if (v === 'NEW') {
          m = makeRecruit(s, role);
          rep.recruits.push({ key: m.key, tank: id, role });
        } else {
          const x = all.get(v);
          if (!x) continue;
          m = x.m;
          const o = oldSeat.get(v);
          if (!o || o.id !== id || o.role !== role) rep.moved.push({ key: v, from: o ? o.id : null, to: id, role });
          delete m.from; delete m.spare;
          m.role = role;
        }
        members.push(m);
        seated.add(m.key);
      }
      // 소대장 (1호차가 살아 있으면 위 자리에서 이미 앉음)
      s.crew[id] = { trust: s.crew[id] ? s.crew[id].trust : TMM.CREW_TRUST_START[id], members };
    }
    // 1호차가 없으면 소대장 기록은 1호차 자리에 남는다 (다른 전차에 동승)
    if (!s.tanks[1].alive) {
      const pl = Array.from(all.values()).find((x) => isPlayer(s, x.m.key));
      s.crew[1] = { trust: null, members: pl ? [pl.m] : [] };
      if (pl) seated.add(pl.m.key);
    }
    // 5. 후송·후방 대기
    const reserve = [];
    for (const [key, x] of all) {
      if (seated.has(key)) continue;
      const m = x.m;
      if (plan.wounded[key] === 'evac') {
        const heavy = m.injury >= 2;
        const back = heavy ? null : s.op + K.LIGHT_RETURN[0] + (rand() < 0.5 ? 0 : K.LIGHT_RETURN[1] - K.LIGHT_RETURN[0]);
        s.evac.push(Object.assign({}, m, { heavy, returnOp: back }));
        rep.evac.push({ key, heavy, back });
        continue;
      }
      if (isPlayer(s, key)) continue;
      const o = oldSeat.get(key);
      if (o && s.tanks[o.id] && s.tanks[o.id].alive) m.from = o.id;
      reserve.push(m);
    }
    s.reserve = reserve;
    // 6. 휴식·치료
    for (const x of present(s)) {
      const m = x.m;
      m.fatigue = Math.max(K.FATIGUE_MIN, m.fatigue - K.BASE_FATIGUE - K.REST_FATIGUE * plan.rest);
      m.morale = clamp(m.morale + K.REST_MORALE * plan.rest, 0, 100);
      if (m.injury === 1 && plan.rest >= K.HEAL_REST_H) { m.injury = 0; rep.healed.push(m.key); }
      else if (m.injury > 0 && !isPlayer(s, m.key)) rep.kept.push({ key: m.key, injury: m.injury });
      if (isPlayer(s, m.key) && m.injury === 1 && plan.rest >= 1) { m.injury = 0; rep.healed.push(m.key); }
    }
    s.refit = rep;
    s.refitPending = false;
    resetPlan(s);
    known = people(s);
    return rep;
  }

  // 모의 캠페인용: 이벤트는 첫 선택지(또는 주어진 함수), 재정비는 recommend / idle
  function autoRefit(s, mode, rand) {
    if (!s.refitPending) return null;
    for (const id of (s.refitInfo.events || [])) {
      const ev = TMM.CREW_EVENTS.find((e) => e.id === id);
      const ch = eventChoices(s, ev);
      chooseEvent(s, id, ch.length ? ch[ch.length > 2 ? 2 : 0].i : 0);
    }
    return applyRefit(s, mode === 'idle' ? idlePlan(s) : recommend(s), rand);
  }

  // 재정비 화면용: 사람 한 명의 표시 정보
  function personInfo(s, key) {
    const d = def(s, key);
    const loc = locate(s, key);
    if (!d || !loc) return null;
    return { key, name: d.player ? '소대장' : d.name, rank: d.rank, trained: d.role, about: d.about || '', recruit: !!d.recruit, player: !!d.player, m: loc.m, where: loc.where, tank: loc.tank };
  }

  // ---- 에필로그: 살아남은 소대원과 신뢰도에 따라 ----
  function memberState(s, key) {
    const loc = locate(s, key);
    if (!loc) return null;
    return { m: loc.m, tank: loc.tank ? s.tanks[loc.tank] : null, evac: loc.where === 'evac', trust: loc.tank && s.crew[loc.tank] ? s.crew[loc.tank].trust : null };
  }
  function epilogue(s) {
    const out = [];
    const ms = (k) => memberState(s, k);
    const ok = (k) => { const x = ms(k); return x && !x.evac && x.m.injury < 2; };
    const jms = ms('jms');
    const t4 = trustOf(s.crew, 4);
    if (ok('jms')) {
      if (t4 >= 70) out.push(['jms', '소대장님. 처음엔 솔직히 걱정했습니다. 이제는 아닙니다. …다음에도 같이 가시죠.']);
      else if (t4 >= 40) out.push(['jms', '살아서 돌아왔으면 된 겁니다. 나머지는 차차 배우시면 됩니다, 소대장님.']);
      else out.push(['jms', '…다들 살아 있는 건 운입니다, 소대장님. 운은 두 번 안 옵니다.']);
    } else if (jms) {
      out.push(['note', '장만석 상사는 후송 헬기에 오르며 한 마디만 남겼다. "애들… 잘 부탁합니다, 소대장님."']);
    }
    const psh = ms('psh');
    if (ok('psh')) out.push(['psh', s.ending === 'collapse' ? '소대장님, 살아만 있으면 전역은 합니다. 그거면 된 겁니다.' : '전역 D-27 입니다, 소대장님. 이 정도 했으면 전역 하루쯤 당겨 줘도 되지 않습니까?']);
    else if (psh) out.push(['note', '병원 침대에서 박성훈 병장이 웃었다. "이렇게 전역 앞당기려던 건 아닌데 말입니다."']);
    const ldh = ms('ldh');
    if (ldh) {
      if (ldh.m.injury >= 2 || ldh.evac) out.push(['note', '이도현 이병은 후송 트럭 안에서도 "날개 달린 게 철갑탄…" 하고 중얼거렸다.']);
      else if (ldh.m.skill >= 50) out.push(['ldh', '소대장님! 이제 철갑탄이랑 고폭탄 안 헷갈립니다! …거의 안 헷갈립니다!']);
      else out.push(['kty', '이도현이요? 아직 가끔 헷갈립니다. 그래도 장전은 빨라졌습니다.']);
    }
    const yjh = ms('yjh');
    const t3 = trustOf(s.crew, 3);
    if (yjh && ok('yjh') && ok('smh')) {
      if (t3 >= 65 || s.usedEvents.includes('smh_yjh')) out.push(['smh', '…윤 하사님. 이번엔 무전기 똑바로 드셨더라고요. (3호차 사람들이 처음으로 같이 웃었다)']);
      else out.push(['yjh', '송 병장, 다음엔 내 말 좀 한 번에 들어 줘라. …부탁이다.']);
    } else if (yjh) {
      out.push(['note', '3호차의 빈자리에는 임채운 일병이 붙여 둔 "3호차 파이팅" 쪽지만 남아 있었다.']);
    }
    if (ok('cms')) out.push(['cms', '교범에 이런 72시간은 없었습니다. …제가 한 장 써 두겠습니다.']);
    else if (ms('cms')) out.push(['note', '최민수 중사의 체크리스트 47개 항목은 후송 가방 안에 고이 접혀 있었다.']);
    if (ok('msb')) out.push(['msb', s.usedEvents.includes('msb_bulgogi') && s.eventChoices && s.eventChoices.msb_bulgogi === 0 ? '불고기는 그때 다 먹었습니다. 대신 라면 한 봉지 남겨 뒀습니다, 소대장님.' : '불고기 전투식량, 끝까지 아껴 뒀습니다. 소대장님 몫도 있습니다.']);
    if (s.k2Count) out.push(['note', '대대가 보내 준 K2 ' + s.k2Count + '대는 강철 소대 무늬를 단 채 끝까지 함께 달렸다.']);
    const rec = present(s).filter((x) => isRecruit(s, x.m.key) && x.m.injury < 2);
    if (rec.length) {
      const d = def(s, rec[0].m.key);
      out.push(['note', '보충병 ' + d.name + ' ' + d.rank + (rec.length > 1 ? ' 등 ' + rec.length + '명' : '') + '은(는) 이제 "강철" 무전 호출에 망설임 없이 답한다.']);
    }
    return out;
  }

  // ---- 저장 ----
  // 옛 저장(v1, M7a)을 v2 로 고쳐 읽는다
  function migrate(s) {
    if (!s) return null;
    if (s.v === 2) return s;
    if (s.v !== 1) return null;
    s.v = 2;
    s.supply = s.fails ? 1 : 2;
    s.k2Count = 0;
    s.recruitN = 0;
    s.reserve = [];
    s.evac = [];
    s.usedEvents = [];
    for (const id of IDS) s.tanks[id].model = 'K1A2';
    if (s.crew) {
      s.crew.people = {};
      for (const id of IDS) {
        const sv = s.crew[id];
        if (!sv) continue;
        for (const m of sv.members) { const d = TMM.Crew.personDef(m.key, {}); m.role = d ? d.role : 'loader'; }
        if (!s.tanks[id].alive) {
          for (const m of sv.members) if (!(TMM.Crew.personDef(m.key, {}) || {}).player) s.reserve.push(Object.assign({}, m, { from: id }));
          sv.members = sv.members.filter((m) => (TMM.Crew.personDef(m.key, {}) || {}).player);
        }
      }
    } else {
      // 첫 작전 전 저장: 새 상태의 승무원으로
      s.crew = newState().crew;
    }
    if (s.refitPending) s.refitPending = false; // M7a 자동 재정비는 이미 적용됨
    s.refitInfo = null;
    return s;
  }
  function save(s) {
    s.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = migrate(JSON.parse(raw));
      if (s) known = people(s);
      return s;
    } catch (e) { return null; }
  }
  function clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
  }
  // 이어하기 버튼 문구
  function resumeText(s) {
    if (!s) return '';
    if (s.phase === 'prologue') return '프롤로그';
    if (s.phase === 'ending') return '엔딩 · ' + TMM.CAMPAIGN.ENDINGS[s.ending].title;
    const op = OPS()[s.op];
    return '작전 ' + op.no + ' · ' + op.name + (s.refitPending ? ' 앞 재정비' : ' 명령 대기') + ' · 전차 ' + aliveIds(s).length + '대';
  }

  return {
    newState, battleSpec, record, applyPlan, setPlan, resetPlan, aliveIds, leaderTank, pressure, pressureText, epilogue, save, load, clear, resumeText, crewName, total, K, IDS,
    // M7b 재정비
    recommend, idlePlan, blankPlan, planCost, supplyPreview, assign, setWounded, candidatesFor, seatOf, applyRefit, autoRefit, chooseEvent, eventChoices,
    woundedList, personInfo, present, locate, seatRoles, ammoMax, REQUIRED, migrate,
  };
})();
