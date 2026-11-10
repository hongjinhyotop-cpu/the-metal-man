/*
 * M7a 캠페인 규칙 (DOM 없음 → 모의 캠페인에서도 씀): 캠페인 상태, 작전 → 전투 설정, 결과 이월, 자동 재정비, 엔딩, 저장.
 *
 * 흐름: 프롤로그 → [작전 명령 → 전투 → 재정비] × 5 → 엔딩
 * 상태(state)는 작전이 끝날 때마다 브라우저(localStorage)에 자동 저장된다.
 *   { v, phase('prologue'|'briefing'|'refit'|'ending'), op(지금/다음 작전 번호 0~4), fails(실패한 작전 수),
 *     tanks{호차: { alive, lostIn, damage{부위}, ammo{K276,K277} }}, crew(TMM.Crew.snapshot 형식),
 *     plan{호차: 철갑탄 수}, history[작전 결과], refit(직전 재정비 보고), ending('complete'|'partial'|'collapse'|null) }
 *
 * 이월 규칙 (M7a):
 *   - 격파된 전차는 다음 작전에 못 나온다 (보충은 M7b). 살아남은 전차가 2대 미만이면 '소대 붕괴'로 바로 끝.
 *   - 손상·잔탄·승무원(숙련도·피로·사기·부상)·신뢰도가 이어진다.
 *   - 재정비(자동): 탄약 보급(32발까지, 작전 실패 직후는 보급 차질로 24발까지), 가벼운 손상(주포·사격통제장치·무전기) 수리,
 *     경상 치료, 피로 −20. 궤도·엔진 손상과 중상은 그대로 (골라서 고치는 것은 M7b).
 *   - 작전에 실패하면 다음 작전이 불리해진다: 적이 경로 앞쪽(더 가까이)에서 출발, 진지 방어 적은 1대 더, 늦게 오는 적은 더 일찍.
 */
TMM.Campaign = (function () {
  const SAVE_KEY = 'tmm.campaign.v1';
  const OPS = () => TMM.CAMPAIGN.OPS;
  const K = {
    SUPPLY_FULL: 32,
    SUPPLY_SHORT: 24, // 작전 실패 직후: 보급 차질
    LIGHT_PARTS: ['gun', 'fcs', 'radio'], // 재정비에서 고치는 손상
    HEAVY_PARTS: ['track', 'engine'], // 그대로 남는 손상 (M7b 에서 골라서 수리)
    FATIGUE_RECOVER: 20,
    FATIGUE_MIN: 5,
    MAX_PRESSURE: 2, // 실패 누적 효과 상한
    PRESSURE_DELAY_SEC: 90, // 실패 1번마다 늦게 오는 적이 이만큼 일찍
  };
  const IDS = [1, 2, 3, 4];
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const total = (a) => (a.K276 || 0) + (a.K277 || 0);

  function newState() {
    const tanks = {};
    for (const id of IDS) tanks[id] = { alive: true, lostIn: null, damage: { track: false, engine: false, gun: false, fcs: false, radio: false }, ammo: { K276: 20, K277: 12 } };
    const s = { v: 1, phase: 'prologue', op: 0, fails: 0, tanks, crew: null, plan: {}, history: [], refit: null, ending: null, savedAt: null };
    resetPlan(s);
    return s;
  }

  const aliveIds = (s) => IDS.filter((id) => s.tanks[id].alive);

  // 작전 명령 화면의 탄종 배분 기본값: 그 작전의 권장 철갑탄 수 (가진 탄 안에서)
  function resetPlan(s) {
    const op = OPS()[Math.min(s.op, OPS().length - 1)];
    for (const id of IDS) {
      const t = total(s.tanks[id].ammo);
      s.plan[id] = Math.max(0, Math.min(t, Math.round((op.ammo / K.SUPPLY_FULL) * t)));
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
    const units = aliveIds(s).map((id) => {
      // 궤도 손상(이동 불가) 전차는 작전 위치로 나갈 수 없다 → rearPos 가 있으면 거기(주둔지)에 남는다
      const stuck = s.tanks[id].damage.track && op.rearPos;
      const pos = stuck ? op.rearPos[id] : op.units ? op.units[id] : [R.find((d) => d.id === id).x, R.find((d) => d.id === id).y];
      return { id, x: pos[0], y: pos[1], heading: op.heading, ammo: copy(s.tanks[id].ammo), damage: copy(s.tanks[id].damage) };
    });
    let enemies = op.enemies === 'roster-3' ? copy(TMM.Enemy.ROSTER.filter((d) => d.n !== 2)).map((d, i) => Object.assign(d, { n: i + 1 })) : copy(op.enemies || TMM.Enemy.ROSTER);
    if (op.extra && p) enemies = enemies.concat(copy(op.extra.slice(0, p)));
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

  const crewName = (key) => {
    for (const id of IDS) {
      const d = TMM.CREW_ROSTER[id].find((m) => m.key === key);
      if (d) return d;
    }
    return null;
  };
  const trustOf = (snap, id) => (snap && snap[id] && snap[id].trust != null ? snap[id].trust : TMM.CREW_TRUST_START[id]);

  // 전투가 끝났을 때: 결과 이월 → 재정비(또는 엔딩) → 저장. 반환: 갱신된 state
  function record(s, game) {
    const op = OPS()[s.op];
    const over = game.over;
    const before = s.crew;
    const after = TMM.Crew.snapshot(game);
    const lostNow = [];
    for (const u of game.units) {
      const t = s.tanks[u.id];
      t.damage = copy(u.damage);
      t.ammo = { K276: u.ammo.K276 || 0, K277: u.ammo.K277 || 0 };
      if (u.destroyed && t.alive) {
        t.alive = false;
        t.lostIn = op.no;
        lostNow.push(u.id);
      }
    }
    s.crew = Object.assign({}, before || {}, after);
    const trust = {};
    for (const id of [2, 3, 4]) trust[id] = [Math.round(trustOf(before, id)), Math.round(trustOf(s.crew, id))];
    const kills = game.enemies.filter((e) => e.destroyed && !e.abandoned).length;
    s.history.push({
      no: op.no, name: op.name, result: over.result, reason: over.reason || '',
      kills, abandoned: game.enemies.filter((e) => e.abandoned).length, fled: game.enemies.filter((e) => e.exited && !e.ai.pending).length, enemyTotal: game.enemies.length,
      lost: lostNow, minutes: Math.round((over.at - game.startSeconds) / 60), trust, ff: game.ffCount || 0,
    });
    if (over.result === 'fail') s.fails += 1;

    if (over.result === 'collapse' || aliveIds(s).length < TMM.Objective.COLLAPSE_BELOW) {
      s.phase = 'ending';
      s.ending = 'collapse';
    } else if (s.op >= OPS().length - 1) {
      s.phase = 'ending';
      s.ending = endingKind(s);
    } else {
      s.refit = refit(s, over.result === 'fail', before, lostNow, trust);
      s.op += 1;
      s.phase = 'briefing';
      s.refitPending = true; // 재정비 화면을 먼저 보여 준다
      resetPlan(s);
    }
    return s;
  }

  function endingKind(s) {
    const last = s.history[s.history.length - 1];
    const fails = s.history.filter((h) => h.result !== 'success').length;
    return last && last.result === 'success' && fails <= 1 ? 'complete' : 'partial';
  }

  // 자동 재정비. 반환: 재정비 보고 (화면용)
  function refit(s, failed, crewBefore, lostNow, trust) {
    const cap = failed ? K.SUPPLY_SHORT : K.SUPPLY_FULL;
    const tanks = [];
    for (const id of IDS) {
      const t = s.tanks[id];
      if (!t.alive) {
        tanks.push({ id, alive: false, lostNow: lostNow.includes(id), lostIn: t.lostIn });
        continue;
      }
      const ammoBefore = total(t.ammo);
      const repaired = K.LIGHT_PARTS.filter((k) => t.damage[k]);
      for (const k of repaired) t.damage[k] = false;
      const remain = K.HEAVY_PARTS.filter((k) => t.damage[k]);
      const ammoAfter = Math.max(ammoBefore, cap);
      t.ammo = { K276: Math.min(t.ammo.K276, ammoAfter), K277: 0 };
      t.ammo.K277 = ammoAfter - t.ammo.K276;
      tanks.push({ id, alive: true, ammoBefore, ammoAfter, repaired, remain });
    }
    const crew = [];
    for (const id of IDS) {
      const sv = s.crew[id];
      if (!sv) continue;
      const alive = s.tanks[id].alive;
      for (const m of sv.members) {
        const d = crewName(m.key);
        const b0 = crewBefore && crewBefore[id] ? crewBefore[id].members.find((x) => x.key === m.key) : null;
        const skill0 = b0 ? b0.skill : d.skill;
        const row = { unitId: id, key: m.key, name: d.name, rank: d.rank, role: d.role, player: !!d.player, alive, injBefore: m.injury, fatBefore: Math.round(m.fatigue), skill: Math.round(m.skill), skillGain: Math.round(m.skill - skill0), morale: Math.round(m.morale) };
        if (alive) {
          if (m.injury === 1) m.injury = 0; // 경상 치료
          m.fatigue = Math.max(K.FATIGUE_MIN, m.fatigue - K.FATIGUE_RECOVER);
        }
        row.injAfter = m.injury;
        row.fatAfter = Math.round(m.fatigue);
        crew.push(row);
      }
    }
    return { cap, failed, tanks, crew, trust };
  }

  // ---- 에필로그: 살아남은 소대원과 신뢰도에 따라 ----
  function memberState(s, key) {
    for (const id of IDS) {
      const sv = s.crew && s.crew[id];
      const m = sv && sv.members.find((x) => x.key === key);
      if (m) return { m, tank: s.tanks[id], trust: sv.trust };
    }
    return null;
  }
  function epilogue(s) {
    const out = [];
    const ms = (k) => memberState(s, k);
    const ok = (k) => { const x = ms(k); return x && x.tank.alive && x.m.injury < 2; };
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
      if (ldh.m.injury >= 2 || !ldh.tank.alive) out.push(['note', '이도현 이병은 후송 트럭 안에서도 "날개 달린 게 철갑탄…" 하고 중얼거렸다.']);
      else if (ldh.m.skill >= 50) out.push(['ldh', '소대장님! 이제 철갑탄이랑 고폭탄 안 헷갈립니다! …거의 안 헷갈립니다!']);
      else out.push(['kty', '이도현이요? 아직 가끔 헷갈립니다. 그래도 장전은 빨라졌습니다.']);
    }
    const yjh = ms('yjh');
    const t3 = trustOf(s.crew, 3);
    if (yjh && ok('yjh') && ok('smh')) {
      if (t3 >= 65) out.push(['smh', '…윤 하사님. 이번엔 무전기 똑바로 드셨더라고요. (3호차 사람들이 처음으로 같이 웃었다)']);
      else out.push(['yjh', '송 병장, 다음엔 내 말 좀 한 번에 들어 줘라. …부탁이다.']);
    } else if (yjh) {
      out.push(['note', '3호차의 빈자리에는 임채운 일병이 붙여 둔 "3호차 파이팅" 쪽지만 남아 있었다.']);
    }
    if (ok('cms')) out.push(['cms', '교범에 이런 72시간은 없었습니다. …제가 한 장 써 두겠습니다.']);
    else if (ms('cms')) out.push(['note', '최민수 중사의 체크리스트 47개 항목은 2호차와 함께 불탔다.']);
    if (ok('msb')) out.push(['msb', '불고기 전투식량, 끝까지 아껴 뒀습니다. 소대장님 몫도 있습니다.']);
    return out;
  }

  // ---- 저장 ----
  function save(s) {
    s.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.v === 1 ? s : null;
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

  return { newState, battleSpec, record, applyPlan, setPlan, resetPlan, aliveIds, pressure, pressureText, epilogue, save, load, clear, resumeText, crewName, total, K, IDS };
})();
