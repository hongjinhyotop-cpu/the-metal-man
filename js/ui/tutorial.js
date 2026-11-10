/*
 * M7.5 기초 훈련 (훈련 모드 → 기초 훈련): 짧은 3단계로 마우스 조작을 익힌다. 게임 규칙은 그대로 쓰고 상황만 단순하게.
 *   1 이동     : 1호차 아이콘을 클릭해 고르고 → 노란 동그라미를 클릭 → 도착
 *   2 무전 명령: [2조] 버튼 → 지도를 우클릭 → [엄호] → 3·4호차가 복창하고 엄호 시작
 *   3 사격     : 북쪽에 적 전차 1대가 나타남 → 식별되면 우클릭 → [목표 지정] → 소대 사격
 * 적은 쏘지 않는다(매복 거리 60m). 비지휘 아군(보병·트럭·K2)은 없다. 승패 판정 없음(battle.js 가 game.tutorial 이면 건너뜀).
 * 단계마다 지도 위(#tut)에 할 일 한 줄, 지도에는 노란 고리(renderer.js drawTutorial).
 * 끝나면 [실전 훈련] [다시 하기] [처음 화면] — 한 페이지에서 전투는 한 번이므로 sessionStorage 'tmm.next' 를 남기고 다시 연다.
 */
TMM.Tutorial = (function () {
  const ENEMY_ID = 101;
  const STEP_NAMES = ['이동', '무전 명령', '사격'];
  let el = null;
  let io = null; // { log, toast }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unit = (game, id) => game.units.find((u) => u.id === id);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // 전차가 잘 가는 땅 중 (x, y) 근처에서 가장 빠른 칸
  function goodSpot(map, x, y, rad) {
    let best = null, bestS = -1;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const px = Math.floor(x + dx) + 0.5, py = Math.floor(y + dy) + 0.5;
        const info = map.infoAt(px, py);
        if (!info || !info.speed) continue;
        const sc = info.speed - Math.hypot(dx, dy) * 1.2;
        if (sc > bestS) { bestS = sc; best = { x: px, y: py }; }
      }
    }
    return best || { x, y };
  }

  // 3단계 적 위치: 소대에서 2.2~2.7km 북쪽, 트인 땅, 1호차와 2조 한 대 이상이 볼 수 있는 곳
  function enemySpot(game) {
    const map = game.map;
    const alive = game.units.filter((u) => !u.destroyed);
    const cx = alive.reduce((a, u) => a + u.x, 0) / alive.length;
    const cy = alive.reduce((a, u) => a + u.y, 0) / alive.length;
    const u1 = unit(game, 1) || alive[0];
    const t2 = alive.filter((u) => u.team === 2);
    let best = null, bestS = -1e9;
    for (let y = Math.max(4, Math.floor(cy - 56)); y <= cy - 40; y += 1) {
      for (let x = Math.max(4, Math.floor(cx - 30)); x <= Math.min(map.cols - 4, cx + 30); x += 1) {
        const p = { x: x + 0.5, y: y + 0.5 };
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < 44 || d > 54) continue;
        const info = map.infoAt(p.x, p.y);
        if (!info || !info.speed) continue;
        if (TMM.TERRAIN_SIGHT[map.typeAt(p.x, p.y)].conceal < 0.9) continue;
        const a = TMM.Sight.line(map, u1, p);
        if (!a.clear || a.obs > 0.2) continue;
        const seen2 = t2.filter((u) => { const l = TMM.Sight.line(map, u, p); return l.clear && l.obs < 0.3; }).length;
        const sc = seen2 * 10 - Math.abs(p.x - cx) * 0.2 - Math.abs(d - 48);
        if (sc > bestS) { bestS = sc; best = p; }
      }
    }
    return best || { x: cx, y: Math.max(6, cy - 46) };
  }

  function setup(game) {
    game.allies = [];
    game.enemies = TMM.Enemy.create([{ id: ENEMY_ID, n: 1, x: 80, y: 10, static: true, fireM: 60, delay: 1e9, stage: -1 }]);
    game.paused = false; // 바로 시작 (스페이스바를 몰라도 되게)
    game.started = true;
    const u1 = unit(game, 1);
    game.tutorial = {
      step: 0,
      marks: [],
      move: goodSpot(game.map, u1.x, u1.y - 9, 3),
      watch: null,
      enemy: null,
      shotAt: null,
      done: false,
      lastKey: '',
    };
    const u3 = unit(game, 3) || u1;
    game.tutorial.watch = goodSpot(game.map, u3.x + 8, u3.y - 28, 3);
  }

  function start(game, hooks) {
    io = hooks;
    el = document.getElementById('tut');
    el.hidden = false;
    document.querySelector('.map-wrap').classList.add('tutorial');
    io.log(TMM.RADIO.COMPANY, '강철, 여기 강철 6. 기초 훈련을 시작한다. 화면 위의 할 일을 하나씩 따라 하라. 이상.', 'system');
  }

  function spawnEnemy(game) {
    const e = game.enemies.find((x) => x.id === ENEMY_ID);
    const p = enemySpot(game);
    e.x = p.x;
    e.y = p.y;
    e.heading = Math.PI / 2;
    e.ai.pending = false;
    e.exited = false;
    game.tutorial.enemy = e;
    io.log(TMM.RADIO.COMPANY, '강철, 여기 강철 6. 북쪽 개활지에 전차 1대 접근 중. 확인하라. 이상.', 'system');
  }

  function next(game) {
    const T = game.tutorial;
    io.toast('✓ ' + (T.step + 1) + '단계 완료 — ' + STEP_NAMES[T.step], '');
    T.step += 1;
    if (T.step === 2) spawnEnemy(game);
  }

  // 지금 할 일: { title, do, hint, marks }
  function task(game) {
    const T = game.tutorial;
    const cmd = game.cmd;
    const u1 = unit(game, 1);
    if (T.step === 0) {
      if (cmd.to !== '1') return { do: '지도에서 1호차 아이콘(노란 네모 "1")을 클릭해 고르십시오', hint: '내 전차는 번호가 붙은 네모입니다. 1조는 노란색, 2조는 청록색.', marks: [{ x: u1.x, y: u1.y, unit: true, label: '1호차 클릭' }] };
      const toMark = u1.dest && dist(u1.dest, T.move) < 3.5;
      if (u1.state === 'moving' && toMark) return { do: '1호차 이동 중… 노란 동그라미에 도착하면 다음 단계', hint: '1호차는 소대장이 탄 지휘 전차라 바로 움직입니다. 나머지는 무전으로 몇 초 걸립니다.', marks: [{ x: T.move.x, y: T.move.y, label: '도착 지점' }] };
      return { do: '노란 동그라미를 클릭하십시오 — 1호차가 그곳으로 갑니다', hint: u1.state === 'moving' ? '지금은 다른 곳으로 가고 있습니다. 노란 동그라미를 클릭하세요.' : '1호차는 지도를 클릭하기만 하면 움직입니다. (우클릭 → [이동]도 같습니다)', marks: [{ x: T.move.x, y: T.move.y, label: '여기를 클릭' }] };
    }
    if (T.step === 1) {
      const t2 = game.units.filter((u) => u.team === 2 && !u.destroyed);
      const sending = t2.some((u) => TMM.Radio.pendingFor(game, u.id).length);
      if (sending) return { do: '무전 전달 중… 3·4호차가 "수신" 복창하면 완료됩니다', hint: '무전 기록에 복창이 올라옵니다. 2·3·4호차 명령은 몇 초 늦게 도착합니다.', marks: [] };
      if (cmd.to !== 'T2') return { do: '오른쪽 위 [2조] 버튼을 누르십시오 (3·4호차)', hint: '조 버튼으로 두 대에게 한 번에 명령합니다. 지도에서 3호차·4호차 아이콘을 눌러도 됩니다.', marks: t2.map((u) => ({ x: u.x, y: u.y, unit: true, label: u.id === 3 ? '2조' : '' })) };
      return { do: '노란 표시 근처를 우클릭 → 메뉴에서 [엄호 (이쪽 지켜봐)]를 고르십시오', hint: '엄호 = 그 방향을 지켜보며 멈춥니다. 적이 올 쪽을 정해 두면 옆구리를 덜 맞습니다.', marks: [{ x: T.watch.x, y: T.watch.y, label: '여기를 우클릭', r: 4 }] };
    }
    if (T.step === 2) {
      const e = T.enemy;
      const c = TMM.Intel.contact(game, 'friend', ENEMY_ID);
      if (T.shotAt != null) return { do: '목표 지정 완료! 소대가 사격합니다…', hint: '무전 기록의 붉은·노란 줄(격파·경고)을 먼저 보면 됩니다.', marks: [] };
      if (!c || !c.known) return { do: '북쪽에 적이 다가옵니다 — 지도에 표시가 뜰 때까지 기다리십시오', hint: '적은 보일 때만 지도에 나타납니다.', marks: [{ x: e.x, y: e.y, label: '이쪽을 보세요', r: 5 }] };
      const pos = { x: c.visible ? c.unit.x : c.lastX, y: c.visible ? c.unit.y : c.lastY };
      if (!c.identified) return { do: '노란 "?" (미상 표적)가 붉은 마름모(적)로 바뀔 때까지 기다리십시오', hint: '식별 전에 쏘면 아군일 수도 있습니다. 아래 노란 막대가 식별 진행도.', marks: [{ x: pos.x, y: pos.y, label: '식별 중', r: 3 }] };
      return { do: '적(붉은 마름모)을 우클릭 → [목표 지정]을 고르십시오', hint: '지금 고른 전차·조가 그 적을 쏩니다. 2km 넘는 적은 목표를 지정해 줘야 쏩니다.', marks: [{ x: pos.x, y: pos.y, label: '우클릭', r: 2 }] };
    }
    return null;
  }

  function check(game) {
    const T = game.tutorial;
    if (T.step === 0) {
      const u1 = unit(game, 1);
      if (dist(u1, T.move) < 3 && u1.state !== 'moving') next(game);
    } else if (T.step === 1) {
      const t2 = game.units.filter((u) => u.team === 2 && !u.destroyed);
      if (t2.length && t2.every((u) => u.order && u.order.type === 'cover' && u.watch != null)) next(game);
    } else if (T.step === 2) {
      const e = T.enemy;
      if (T.shotAt == null && game.units.some((u) => !u.destroyed && u.targetId === ENEMY_ID)) T.shotAt = game.gameSeconds;
      if (T.shotAt != null && (e.destroyed || e.exited || game.gameSeconds - T.shotAt > 90)) {
        io.toast('✓ 3단계 완료 — 사격', '');
        T.step = 3;
        T.done = true;
        T.marks = [];
        game.paused = true;
        showDone(game);
      }
    }
  }

  function go(next) {
    try { if (next) sessionStorage.setItem('tmm.next', next); } catch (e) { /* 저장소 없음 */ }
    location.reload();
  }

  function showDone(game) {
    const e = game.tutorial.enemy;
    el.className = 'tut done';
    el.innerHTML =
      '<div class="tut-k">기초 훈련 · 완료</div>' +
      '<div class="tut-do">잘했습니다! 이제 실제 전투를 지휘할 수 있습니다.' + (e && e.destroyed ? ' (적 전차 격파)' : '') + '</div>' +
      '<ul class="tut-sum">' +
      '<li><b>고르기</b> — 전차 아이콘 클릭, 또는 [1조] [2조] [소대 전체]</li>' +
      '<li><b>명령</b> — 지도를 우클릭 → 이동 · 엄호 · 철수</li>' +
      '<li><b>사격</b> — 적을 우클릭 → 목표 지정</li>' +
      '<li><b>헷갈리면</b> — 오른쪽 위 [? 조작법] 또는 F1</li>' +
      '</ul>' +
      '<div class="tut-row"><button type="button" class="r-btn" data-tut="training">실전 훈련 (단일 전투) ▸</button>' +
      '<button type="button" class="c-btn" data-tut="tutorial">다시 하기</button>' +
      '<button type="button" class="c-btn dim" data-tut="title">처음 화면</button></div>';
    el.querySelectorAll('[data-tut]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tut === 'title' ? null : b.dataset.tut)));
  }

  function update(game) {
    const T = game.tutorial;
    if (!T || T.done || !el) return;
    check(game);
    if (T.done) return;
    const t = task(game);
    T.marks = t.marks;
    const paused = game.paused && !game.over;
    const key = T.step + '|' + t.do + '|' + t.hint + '|' + paused;
    if (key === T.lastKey) return;
    T.lastKey = key;
    let dots = '';
    for (let i = 0; i < 3; i++) dots += '<i class="' + (i < T.step ? 'ok' : i === T.step ? 'cur' : '') + '"></i>';
    el.className = 'tut';
    el.innerHTML =
      '<div class="tut-k"><span class="tut-dots">' + dots + '</span>기초 훈련 · ' + (T.step + 1) + '/3 ' + STEP_NAMES[T.step] +
      '<button type="button" class="tut-quit" data-quit title="기초 훈련을 그만두고 처음 화면으로">그만두기</button></div>' +
      '<div class="tut-do">' + esc(t.do) + '</div>' +
      '<div class="tut-hint">' + (paused ? '<b class="warn">일시정지 중 — 위의 [▶ 재개]를 누르십시오.</b> ' : '') + esc(t.hint) + '</div>';
    el.querySelector('[data-quit]').addEventListener('click', () => go(null));
  }

  return { setup, start, update, ENEMY_ID };
})();
