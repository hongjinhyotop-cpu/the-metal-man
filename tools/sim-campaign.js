// 모의 캠페인 (개발용, 게임에는 쓰이지 않음). Node 로 실행:
//   node tools/sim-campaign.js <good|naive|scope|passive> [횟수] [시드] [재정비: rec|idle] [흑표 지원: 1|0]
//   재정비 rec = '추천대로 하기'(Campaign.recommend), idle = 아무것도 안 함(필수 자리만 보충병). 기본: passive 는 idle, 나머지는 rec.
//   흑표 지원 기본: good 만 1 (보이는 적 쪽 / 공격 작전은 목표 쪽으로 한 번 요청)
//   good: 엄호 방향·표적 지정·단계적 이동/엄호 이동 + M8a 새 위협 대처(미사일 → 연막, 포격 경고 → 원 밖으로, 자폭 드론 → 움직임)
//   naive: good 과 같지만 새 위협에 대처하지 않음 / scope: 조준 화면에만(무전 명령 없음, 공격 작전에서는 1호차만 몰고 감) / passive: 아무것도 안 함
// 결과: 캠페인마다 작전별 결과(s 성공·f 실패·c 소대 붕괴, -손실, k격파/적 수, 걸린 분)와 엔딩, 마지막에 합계.
// 모의 캠페인: 전략별로 5개 작전을 이어서 돌린다.
const loadTMM = require('./sim-load.js');
const TMM = loadTMM();
const map = TMM.MapGen.generate();
const I = TMM.Intel;

function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

const issue = (g, spec, order) => TMM.Command.issue(g, spec, order);
function visibleHostiles(g, u) {
  const out = [];
  for (const c of g.intel.friend.contacts.values()) {
    if (!c.visible || c.wreck || !c.identified || c.kind !== 'hostile') continue;
    const t = c.unit; if (t.destroyed || t.exited) continue;
    if (!I.sees(g, u, t)) continue;
    const d = TMM.Ballistics.distanceM(g.map, u, t);
    if (d > 3000) continue;
    if (TMM.VEHICLES[t.model].cls !== 'tank') continue; // M8a: 목표 지정은 전차만 (보병 대전차조는 승무원이 알아서 고폭탄·기관총으로)
    out.push({ t, d, k: d });
  }
  return out.sort((a, b) => a.k - b.k);
}
function assignTargets(g, st) {
  if (g.gameSeconds - (st.lastAssign || 0) < 4) return;
  st.lastAssign = g.gameSeconds;
  st.tgt = st.tgt || {};
  for (const u of g.units) {
    if (u.destroyed) continue;
    if (g.scope.open && u.id === 1) continue;
    const cur = u.targetId != null ? TMM.Gunnery.findUnit(g, u.targetId) : null;
    if (cur && !cur.destroyed && !cur.exited && I.sees(g, u, cur)) continue;
    const v = visibleHostiles(g, u);
    if (!v.length) continue;
    if (st.tgt[u.id] === v[0].t.id && g.gameSeconds - (st.tgtAt[u.id] || 0) < 20) continue;
    st.tgt[u.id] = v[0].t.id; st.tgtAt[u.id] = g.gameSeconds;
    issue(g, String(u.id), { type: 'target', targetId: v[0].t.id });
  }
}
const at = (g) => g.gameSeconds - g.startSeconds;
function once(st, key, fn) { if (!st[key]) { st[key] = true; fn(); } }

// --- 좋은 지휘 ---
const GOOD = {
  contact(g, st) {
    once(st, 'c0', () => { issue(g, 'T1', { type: 'cover', x: 45, y: 100 }); issue(g, 'T2', { type: 'cover', x: 122, y: 100 }); });
    assignTargets(g, st);
  },
  delay(g, st) {
    const t = at(g);
    const idle = (team) => g.units.filter((u) => !u.destroyed && u.team === team).every((u) => u.state !== 'moving');
    // 작전 명령에 동쪽 2제대(3분 뒤)가 나와 있으므로 4호차는 처음부터 동쪽, 3분이 되면 3호차도 동쪽 (M8a: 흑표 하향에 맞춘 봇 지휘 보강)
    once(st, 'd0', () => { issue(g, 'T1', { type: 'cover', x: 96, y: 40 }); issue(g, '3', { type: 'cover', x: 114, y: 36 }); issue(g, '4', { type: 'cover', x: 140, y: 70 }); });
    if (t > 2.8 * 60) once(st, 'd0e', () => issue(g, '3', { type: 'cover', x: 140, y: 72 }));
    if (t > 6 * 60) once(st, 'd1', () => { issue(g, 'T1', { type: 'move', x: 90, y: 80 }); issue(g, 'T2', { type: 'move', x: 106, y: 84 }); st.d1at = g.gameSeconds; });
    if (st.d1at && !st.d2 && g.gameSeconds - st.d1at > 20) {
      if (idle(1)) once(st, 'd1c1', () => issue(g, 'T1', { type: 'cover', x: 92, y: 60 }));
      if (idle(2)) once(st, 'd1c2', () => issue(g, 'T2', { type: 'cover', x: 130, y: 70 }));
    }
    if (t > 13 * 60) once(st, 'd2', () => { issue(g, 'ALL', { type: 'move', x: 84, y: 107 }); st.d2at = g.gameSeconds; });
    if (st.d2at && g.gameSeconds - st.d2at > 20) {
      if (idle(1)) once(st, 'd2c1', () => issue(g, 'T1', { type: 'cover', x: 84, y: 80 }));
      if (idle(2)) once(st, 'd2c2', () => issue(g, 'T2', { type: 'cover', x: 110, y: 90 }));
    }
    assignTargets(g, st);
  },
  bridge(g, st) {
    once(st, 'b0', () => { issue(g, 'T1', { type: 'cover', x: 22, y: 76 }); issue(g, 'T2', { type: 'cover', x: 50, y: 55 }); });
    assignTargets(g, st);
  },
  town(g, st) { attack(g, st, [[103, 46], [108, 38], [110, 30], [110, 22]]); },
  ridge(g, st) { attack(g, st, [[110, 34], [108, 26], [106, 20], [106, 14]]); },
};
function attack(g, st, wps) {
  st.wp = st.wp || 0;
  const anyVisible = [...g.intel.friend.contacts.values()].some((c) => c.visible && !c.wreck && c.kind === 'hostile' && c.identified && c.cls === 'tank'); // M8a: 보병은 기관총에 맡기고 전차가 보일 때만 멈춤
  if (!g.bound && !st.moving && st.wp < wps.length && (!anyVisible || g.gameSeconds - (st.waitFrom || 0) > 180)) {
    const [x, y] = wps[st.wp++];
    issue(g, 'ALL', { type: 'bound', x, y });
    st.moving = true; st.movedAt = g.gameSeconds;
  }
  if (st.moving && !g.bound && g.gameSeconds - st.movedAt > 5) { st.moving = false; st.waitFrom = g.gameSeconds; }
  if (st.wp >= wps.length && !g.bound && !anyVisible && g.gameSeconds - (st.lastPush || 0) > 120) {
    // 남은 적을 찾아 마지막 지점 주변으로
    st.lastPush = g.gameSeconds;
    const e = g.enemies.find((e) => !e.destroyed && !e.exited);
    if (e) { const c = I.contact(g, 'friend', e.id); const tx = c && c.known ? c.lastX : wps[wps.length-1][0], ty = c && c.known ? c.lastY + 6 : wps[wps.length-1][1]; issue(g, 'ALL', { type: 'move', x: tx, y: ty }); }
  }
  assignTargets(g, st);
}

// --- 조준 화면에만 (무전 명령 없음) ---
function scopeBot(g, st, realDt) {
  const S = TMM.Scope;
  if (!S.canUse(g)) return;
  if (!g.scope.open) S.open(g);
  const u = S.unit(g);
  const s = g.scope;
  // 1호차가 직접 보는 식별된 적 중 가장 가까운 것. 없으면 소대가 공유한 접촉(나침반 띠) 쪽으로 포탑을 돌린다.
  let best = null, bd = 1e9, look = null, ld = 1e9;
  for (const c of g.intel.friend.contacts.values()) {
    if (!c.known || c.wreck || !c.identified || c.kind !== 'hostile') continue;
    const t = c.unit; if (t.destroyed || t.exited) continue;
    const d = Math.hypot(c.lastX - u.x, c.lastY - u.y) * 50;
    if (d > 3000) continue;
    if (I.sees(g, u, t)) { if (d < bd) { bd = d; best = t; } }
    else if (c.visible && d < ld) { ld = d; look = c; }
  }
  if (!best && look) {
    const want = Math.atan2(look.lastY - u.y, look.lastX - u.x);
    const diff = S.wrap(want - s.az), maxStep = (40 * Math.PI / 180) * realDt;
    s.az = Math.abs(diff) > maxStep ? S.wrap(s.az + Math.sign(diff) * maxStep) : want; s.rx = 0;
  }
  if (!best) { st.sc = null; S.update(g, realDt); return; }
  if (!st.sc || st.sc.id !== best.id) st.sc = { id: best.id, found: 0, lased: false };
  const b = S.project(g, u, best, s.az);
  const want = b.az;
  const diff = S.wrap(want - s.az);
  const maxStep = (40 * Math.PI / 180) * realDt;
  if (Math.abs(diff) > maxStep) { s.az = S.wrap(s.az + Math.sign(diff) * maxStep); s.rx = 0; S.update(g, realDt); return; }
  st.sc.found += realDt;
  if (st.sc.found < st.findDelay) { S.update(g, realDt); return; }
  s.az = want; s.pitch = (b.el0 + b.el1) / 2; s.rx = 0; s.ry = 0;
  S.update(g, realDt);
  if (!S.laserValid(g, best)) S.lase(g);
  const pv = S.preview(g);
  if (s.settle >= st.hold && u.fire.reload <= 0 && pv && pv.inRange && pv.pHit >= (st.minP || 0.2)) {
    const r = S.fire(g);
    if (r.ok) { st.sc.found = st.findDelay; }
  }
}

// M7b: 흑표(이웃 K2 중대) 지원 요청 — 방어형 작전은 처음 보이는 적 쪽, 공격 작전은 시작 1분 뒤 목표 쪽
function callSupport(g, st) {
  if (!st.support || g.support.state !== 'ready') return;
  if (g.op.objective.type === 'attack') {
    if (at(g) < 60) return;
    const z = g.op.marks[0];
    TMM.Support.request(g, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2);
    return;
  }
  for (const c of g.intel.friend.contacts.values()) {
    if (c.visible && c.identified && c.kind === 'hostile' && !c.wreck) { TMM.Support.request(g, c.lastX, c.lastY); return; }
  }
}

// M8a: 새 위협에 대처 (사람이 경고를 보고 하는 것 흉내) — 지난 틱의 사건(st.events)을 본다
//   미사일 경고 → 노린 전차에 연막 · 포격 경고 → 원 안의 전차를 원 밖으로 · 자폭 드론 경고 → 노린 전차를 조금 움직임
function react(g, st) {
  const mpc = g.map.metersPerCell;
  for (const ev of st.events || []) {
    if (ev.type === 'missile-warn') {
      const t = ev.missile.target;
      if (t.side === 'friend' && !t.ally && !t.destroyed && t.smoke > 0) issue(g, String(t.id), { type: 'smoke' });
    } else if (ev.type === 'arty-warn') {
      const s = ev.strike;
      for (const u of g.units) {
        if (u.destroyed || u.damage.track) continue;
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d > s.r + 40 / mpc) continue;
        // 원 밖으로: 아는 적에게서 먼 쪽(뒤쪽)을 고른다 — 적 앞으로 나가 옆구리를 보이지 않게
        const foes = [...g.intel.friend.contacts.values()].filter((c) => c.known && !c.wreck && c.kind !== 'friendly');
        const far = (q) => (foes.length ? Math.min(...foes.map((c) => Math.hypot(c.lastX - q.x, c.lastY - q.y))) : q.y);
        let p = null, best = -Infinity;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const q = { x: s.x + Math.cos(a) * (s.r + 80 / mpc), y: s.y + Math.sin(a) * (s.r + 80 / mpc) };
          const info = g.map.infoAt(q.x, q.y);
          if (!info || !info.speed) continue;
          const sc = far(q) - Math.hypot(q.x - u.x, q.y - u.y) * 0.5;
          if (sc > best) { best = sc; p = q; }
        }
        // 보이는 적과 맞서 싸우는 중(2km 안)이면 자리를 지킨다 — 포격을 피하려다 옆구리를 보이는 것이 더 위험
        if (foes.some((c) => c.visible && Math.hypot(c.lastX - u.x, c.lastY - u.y) * mpc < 2000)) continue;
        if (p) { issue(g, String(u.id), { type: 'move', x: p.x, y: p.y }); st.artyMoved = st.artyMoved || {}; st.artyMoved[u.id] = { at: g.gameSeconds, watch: u.watch }; }
      }
    } else if (ev.type === 'kami-warn') {
      const t = ev.target;
      if (t && t.side === 'friend' && !t.ally && !t.destroyed && !t.damage.track && t.state !== 'moving') {
        const a = t.heading + Math.PI / 2;
        for (const r of [5, -5, 4, -4]) {
          const q = { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r };
          const info = g.map.infoAt(q.x, q.y);
          if (info && info.speed) { issue(g, String(t.id), { type: 'move', x: q.x, y: q.y }); break; }
        }
      }
    }
  }
  // 포격을 피해 옮긴 전차는 도착하면 다시 원래 방향을 엄호
  for (const id in st.artyMoved || {}) {
    const u = g.units.find((x) => x.id === Number(id));
    const m = st.artyMoved[id];
    if (!u || u.destroyed) { delete st.artyMoved[id]; continue; }
    if (u.state !== 'moving' && g.gameSeconds - m.at > 15) {
      if (m.watch != null) issue(g, id, { type: 'cover', x: u.x + Math.cos(m.watch) * 20, y: u.y + Math.sin(m.watch) * 20 });
      delete st.artyMoved[id];
    }
  }
}

const STRATS = {
  good: (g, st) => { react(g, st); callSupport(g, st); GOOD[g.op.key](g, st); },
  naive: (g, st) => { callSupport(g, st); GOOD[g.op.key](g, st); }, // M8a: 좋은 지휘지만 새 위협에 대처하지 않음 (비교용)
  scope: (g, st, realDt) => {
    st.findDelay = 0.7; st.hold = 1.3;
    // 공격 작전: 다른 전차에는 명령하지 않고, 1호차만 (지도를 잠깐 열어 클릭해) 목표 쪽으로 몰고 간다
    if (g.op.objective.type === 'attack' && g.gameSeconds - (st.lastDrive || -1e9) > 90) {
      const u = g.units.find((x) => x.id === 1 && !x.destroyed);
      const seen = u && [...g.intel.friend.contacts.values()].some((c) => c.visible && !c.wreck && c.kind === 'hostile' && c.identified && TMM.Intel.sees(g, u, c.unit));
      if (u && !seen && u.state !== 'moving') {
        st.lastDrive = g.gameSeconds;
        const z = g.op.marks[0]; const tx = (z.x0 + z.x1) / 2, ty = z.y1 + 2;
        const dx = tx - u.x, dy = ty - u.y, L = Math.hypot(dx, dy);
        if (L > 3) { const k = Math.min(1, 16 / L); TMM.Command.issue(g, '1', { type: 'move', x: u.x + dx * k, y: u.y + dy * k }); }
      }
    }
    scopeBot(g, st, realDt);
  },
  passive: () => {},
};

function runCampaign(strat, seed, refitMode, support) {
  const rand = mulberry(seed);
  refitMode = refitMode || (strat === 'passive' ? 'idle' : 'rec');
  if (support == null) support = strat === 'good' || strat === 'naive';
  const s = TMM.Campaign.newState(); s.phase = 'briefing';
  const ops = [];
  while (s.phase !== 'ending') {
    TMM.Campaign.applyPlan(s);
    const op = TMM.Campaign.battleSpec(s);
    const g = TMM.Battle.create({ op, map, crew: s.crew, rand });
    g.started = true;
    const st = { tgtAt: {}, support };
    while (!g.over) {
      const combat = TMM.Battle.inCombat(g);
      const realDt = 0.5 / (combat ? 3 : 10);
      STRATS[strat](g, st, realDt);
      st.events = TMM.Battle.step(g, 0.5);
      if (g.gameSeconds - g.startSeconds > 7200) { console.log('TIMEOUT'); break; }
    }
    ops.push({ no: op.no, r: g.over.result[0], lost: g.units.filter((u) => u.destroyed).length, kills: g.enemies.filter(e=>e.destroyed&&!e.abandoned).length, n: g.enemies.length, min: Math.round((g.over.at - g.startSeconds)/60), k2: g.units.filter((u) => u.model === 'K2').length, sup: g.support.state });
    TMM.Campaign.record(s, g);
    if (s.refitPending) TMM.Campaign.autoRefit(s, refitMode, rand);
  }
  return { ops, ending: s.ending, alive: TMM.Campaign.aliveIds(s).length, k2: s.k2Count };
}

module.exports = { TMM, map, STRATS, mulberry, runCampaign };
if (require.main === module) {
const strat = process.argv[2] || 'good';
const N = Number(process.argv[3] || 10);
const seed0 = Number(process.argv[4] || 1);
const refitMode = process.argv[5] || null;
const support = process.argv[6] == null ? null : process.argv[6] === '1';
const per = {}; const endings = {}; let aliveSum = 0, k2Sum = 0;
for (let i = 0; i < N; i++) {
  const r = runCampaign(strat, seed0 + i * 7919, refitMode, support);
  endings[r.ending] = (endings[r.ending] || 0) + 1; aliveSum += r.alive; k2Sum += r.k2;
  console.log(strat, i, r.ending, 'alive', r.alive, 'K2', r.k2, r.ops.map((o) => o.no + o.r + '(-' + o.lost + ' k' + o.kills + '/' + o.n + ' ' + o.min + 'm' + (o.k2 ? ' K2×' + o.k2 : '') + (o.sup !== 'ready' ? ' 흑표:' + o.sup : '') + ')').join(' '));
  for (const o of r.ops) { const p = per[o.no] = per[o.no] || { n: 0, s: 0, f: 0, c: 0, lost: 0 }; p.n++; p[o.r]++; p.lost += o.lost; }
}
console.log('ENDINGS', JSON.stringify(endings), 'avg alive', (aliveSum / N).toFixed(2), 'avg K2', (k2Sum / N).toFixed(2));
for (const k in per) { const p = per[k]; console.log('op', k, 'played', p.n, 'success', p.s, 'fail', p.f, 'collapse', p.c, 'avg lost', (p.lost / p.n).toFixed(2)); }
}
