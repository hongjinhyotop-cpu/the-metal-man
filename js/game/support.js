/*
 * M7b 이웃 K2 중대 지원 요청 (호출부호 '흑표', 가상). DOM 없음 → 모의 전투에서도 같은 규칙.
 *
 *   - 작전마다 한 번만. 소대장이 지켜 달라는 지점(방향)을 찍어 중대망으로 요청한다.
 *   - 흑표 6(중대장)이 잠시 뒤 답한다. 그쪽 사정(자기 전투)으로 거절할 수도 있다 — 거절되면 이번 작전에는 다시 못 부른다.
 *   - 받아들이면 몇 분 뒤 K2 2대가 소대 뒤쪽에서 와서 소대 옆에 서고, 지정한 방향을 엄호하며(식별된 적, 2.5km 안) 쏜다.
 *   - 정해진 시간이 지나거나 한 대라도 크게 다치면 왔던 곳으로 돌아간다.
 *   - 흑표 K2 는 소대가 아니다: 무전 명령을 받지 않고, 잃어도 소대 손실(작전 실패·붕괴)로 치지 않는다.
 *     전장관리체계는 연결되어 본 것을 소대와 나눈다(intel.js observers). 적도 이들을 쏠 수 있다.
 *
 * game.support = { state('ready'|'asked'|'coming'|'on'|'leaving'|'done'|'refused'), at, x, y, units[], replyAt, arriveAt, leaveAt }
 * 숫자는 모두 게임용 추정치이며 TMM.SUPPORT 만 고치면 된다.
 */
TMM.SUPPORT = {
  CALL: '흑표', // 이웃 K2 중대 호출부호 (가상)
  CALL_6: '흑표 6',
  REPLY_SEC: [25, 50], // 요청 후 답이 올 때까지 (게임 초)
  REFUSE_P: 0.5, // 기본 거절 확률 (M8a: 0.35 → 0.5, 흑표는 '급할 때 도움' 정도로)
  REFUSE_PER_FAIL: 0.1, // 앞선 작전 실패 1번마다 더 (대대 전체가 바쁘다)
  ARRIVE_SEC: [210, 330], // 받아들인 뒤 지도에 나타날 때까지 (M8a: 150~240 → 210~330)
  STAY_SEC: 150, // 엄호 위치에 도착한 뒤 머무는 시간 (M8a: 240 → 150)
  SPAWN_BACK_M: 1300, // 엄호 위치에서 이만큼 뒤(지정 방향 반대쪽)에서 나타난다
  SIDE_M: 260, // 소대 옆으로 비켜 서는 거리
  MAX_RANGE_M: 4000, // 소대에서 이보다 먼 곳은 엄호 방향으로만 쓴다
};

TMM.Support = (function () {
  const K = () => TMM.SUPPORT;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const between = (game, r) => r[0] + game.rand() * (r[1] - r[0]);

  function init(game) {
    game.support = { state: 'ready', units: [] };
  }

  // 요청할 수 있는가. 반환: { ok, why }
  function available(game) {
    const sp = game.support;
    if (!sp) return { ok: false, why: '지원 요청을 쓸 수 없습니다.' };
    if (game.over) return { ok: false, why: '작전이 끝났습니다.' };
    if (sp.state === 'refused') return { ok: false, why: '흑표가 이번 작전에서는 지원을 거절했습니다.' };
    if (sp.state !== 'ready') return { ok: false, why: '흑표 지원은 작전마다 한 번만 요청할 수 있습니다' + (sp.state === 'done' ? '.' : ' (이미 요청함).') };
    if (!TMM.Radio.controlUnit(game)) return { ok: false, why: '지휘 전차가 없습니다.' };
    return { ok: true };
  }

  const platoonCenter = (game) => {
    const us = game.units.filter((u) => !u.destroyed);
    if (!us.length) return null;
    return { x: us.reduce((s, u) => s + u.x, 0) / us.length, y: us.reduce((s, u) => s + u.y, 0) / us.length };
  };

  // 지도 (x, y) 쪽을 지켜 달라고 요청한다. 반환: { ok, lines[] } (무전 기록)
  function request(game, x, y) {
    const a = available(game);
    const lines = [];
    if (!a.ok) { lines.push({ from: '체계', text: a.why, kind: 'warn' }); return { ok: false, lines }; }
    const sp = game.support;
    const ctr = platoonCenter(game);
    sp.state = 'asked';
    sp.at = game.gameSeconds;
    sp.x = x;
    sp.y = y;
    sp.replyAt = game.gameSeconds + between(game, K().REPLY_SEC);
    const dir = TMM.Orders.dirTo(ctr, { x, y });
    lines.push({ from: '소대장', text: K().CALL + ', 여기 ' + TMM.RADIO.NET + '. 지원 요청. 우리 ' + dir + '쪽, 격자 ' + game.map.gridRef(x, y) + ' 방향 엄호 바란다. 이상.', kind: 'order' });
    return { ok: true, lines };
  }

  // 엄호 위치: 소대 옆(지정 방향을 볼 때 오른쪽·왼쪽 중 갈 수 있는 쪽)
  function coverSpot(game, ctr, k) {
    const map = game.map;
    const dir = Math.atan2(game.support.y - ctr.y, game.support.x - ctr.x);
    const side = K().SIDE_M / map.metersPerCell;
    for (const sgn of [1, -1]) {
      for (const mul of [1, 1.6, 2.3]) {
        const off = sgn * side * mul * (k === 0 ? 1 : 1.55);
        const p = { x: ctr.x + Math.cos(dir + Math.PI / 2) * off, y: ctr.y + Math.sin(dir + Math.PI / 2) * off };
        const info = map.infoAt(p.x, p.y);
        if (info && info.speed) return p;
      }
    }
    return { x: ctr.x, y: ctr.y };
  }

  // 나타날 곳: 엄호 위치에서 지정 방향 반대쪽으로 SPAWN_BACK_M (갈 수 있는 칸, 지도 안)
  function spawnSpot(game, p) {
    const map = game.map;
    const back = Math.atan2(p.y - game.support.y, p.x - game.support.x);
    for (const m of [1, 0.8, 0.6, 1.2, 0.4]) {
      for (const da of [0, 0.4, -0.4, 0.8, -0.8]) {
        const r = (K().SPAWN_BACK_M * m) / map.metersPerCell;
        const q = { x: clamp(p.x + Math.cos(back + da) * r, 1, map.cols - 1), y: clamp(p.y + Math.sin(back + da) * r, 1, map.rows - 1) };
        const info = map.infoAt(q.x, q.y);
        if (info && info.speed && TMM.Path.find(map, q, p)) return q;
      }
    }
    return { x: p.x, y: p.y };
  }

  function spawn(game, events) {
    const sp = game.support;
    const ctr = platoonCenter(game) || { x: sp.x, y: sp.y + 30 };
    const watch = Math.atan2(sp.y - ctr.y, sp.x - ctr.x);
    for (let k = 0; k < 2; k++) {
      const p = coverSpot(game, ctr, k);
      const s = spawnSpot(game, p);
      const u = TMM.Damage.initCombat({
        id: 301 + k, side: 'friend', ally: true, support: true,
        callsign: K().CALL + ' ' + (k + 1), role: '이웃 중대 지원', team: 0,
        x: s.x, y: s.y, heading: Math.atan2(p.y - s.y, p.x - s.x), path: [], dest: null, state: 'idle', speedKmh: 0,
        script: { type: 'support' }, roe: 'id', watch: null, home: s, post: p, watchAngle: watch, targetId: null,
      }, 'K2');
      TMM.Movement.order(game.map, u, p.x, p.y);
      game.allies.push(u);
      sp.units.push(u);
    }
    sp.state = 'coming';
    events.push({ type: 'support-arrive', units: sp.units });
    events.push({ type: 'radio', from: K().CALL + ' 1', text: TMM.RADIO.NET + ', 여기 ' + K().CALL + ' 1. K2 2대 진입 중. 곧 너희 옆에 붙는다. 피아식별장치 켜 둠.', kind: 'system' });
  }

  function update(game, gdt, events) {
    const sp = game.support;
    if (!sp || sp.state === 'ready' || sp.state === 'done' || sp.state === 'refused') return;
    const now = game.gameSeconds;
    const S = K();
    if (sp.state === 'asked' && now >= sp.replyAt) {
      const fails = game.campaign ? game.campaign.fails || 0 : 0;
      const p = S.REFUSE_P + S.REFUSE_PER_FAIL * Math.min(2, fails);
      if (game.rand() < p) {
        sp.state = 'refused';
        events.push({ type: 'support-refused' });
        events.push({ type: 'radio', from: S.CALL_6, text: TMM.RADIO.NET + ', 여기 ' + S.CALL_6 + '. 미안하다, 우리도 지금 붙잡혀 있다. 지원 불가. 자력으로 해결하라. 이상.', kind: 'warn' });
        return;
      }
      sp.state = 'waiting';
      sp.arriveAt = now + between(game, S.ARRIVE_SEC);
      events.push({ type: 'radio', from: S.CALL_6, text: TMM.RADIO.NET + ', 여기 ' + S.CALL_6 + '. 지원 승인. K2 2대 보낸다. 약 ' + Math.round((sp.arriveAt - now) / 60) + '분 뒤 도착. 이상.', kind: 'system' });
      return;
    }
    if (sp.state === 'waiting' && now >= sp.arriveAt) { spawn(game, events); return; }
    const alive = sp.units.filter((u) => !u.destroyed && !u.exited);
    if (sp.state === 'coming' || sp.state === 'on') {
      for (const u of alive) {
        if (u.state !== 'moving') {
          u.watch = u.watchAngle;
          // 지켜보는 방향으로 차체를 돌린다
          const diff = Math.atan2(Math.sin(u.watchAngle - u.heading), Math.cos(u.watchAngle - u.heading));
          const step = (TMM.VEHICLES.K2.turnDegPerSec * Math.PI / 180) * gdt;
          u.heading += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
        }
      }
      if (sp.state === 'coming' && alive.length && alive.every((u) => u.state !== 'moving')) {
        sp.state = 'on';
        sp.leaveAt = now + S.STAY_SEC;
        events.push({ type: 'radio', from: S.CALL + ' 1', text: '엄호 위치 도착. ' + TMM.Orders.dirName(alive[0].watchAngle) + '쪽 감시 중. ' + Math.round(S.STAY_SEC / 60) + '분 있겠다.', kind: 'report' });
      }
      const hurt = sp.units.some((u) => u.destroyed || TMM.Damage.damagedParts(u).length >= 2);
      if ((sp.state === 'on' && now >= sp.leaveAt) || hurt || !alive.length) {
        sp.state = 'leaving';
        for (const u of alive) {
          TMM.Movement.order(game.map, u, u.home.x, u.home.y);
          u.watch = null;
          u.targetId = null;
        }
        events.push({ type: 'radio', from: S.CALL + ' 1', text: hurt ? '피해 발생. 흑표 복귀한다. 미안하다, 강철.' : '시간 다 됐다. 흑표 복귀한다. 강철, 행운을 빈다.', kind: 'system' });
      }
      return;
    }
    if (sp.state === 'leaving') {
      for (const u of alive) {
        if (u.state !== 'moving' && Math.hypot(u.x - u.home.x, u.y - u.home.y) < 2.5) {
          u.exited = true;
          events.push({ type: 'ally-exit', unit: u });
        } else if (u.state !== 'moving') TMM.Movement.order(game.map, u, u.home.x, u.home.y);
      }
      if (!sp.units.some((u) => !u.destroyed && !u.exited)) sp.state = 'done';
    }
  }

  // 화면 문구 (명령 버튼 아래)
  function status(game) {
    const sp = game.support;
    if (!sp) return '';
    const now = game.gameSeconds;
    switch (sp.state) {
      case 'ready': return '작전마다 1번';
      case 'asked': return '응답 기다림';
      case 'waiting': return '도착 ' + Math.max(0, Math.ceil((sp.arriveAt - now) / 60)) + '분 전';
      case 'coming': return '진입 중';
      case 'on': return '엄호 중 · ' + Math.max(0, Math.ceil((sp.leaveAt - now) / 60)) + '분';
      case 'leaving': return '복귀 중';
      case 'refused': return '거절됨';
      default: return '사용함';
    }
  }

  return { init, available, request, update, status };
})();
