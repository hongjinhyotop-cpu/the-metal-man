/*
 * 시작점: 게임 상태를 만들고, 입력·그리기·패널을 연결해 주 루프를 돌린다.
 */
(function () {
  const C = TMM.CONFIG;

  function createGame() {
    return {
      map: TMM.MapGen.generate(),
      units: TMM.Platoon.create(),
      selectedId: null,
      paused: true, // 처음에는 작전 대기 상태
      started: false,
      speedMult: 1,
      gameSeconds: C.START_SECONDS,
      hover: null,
    };
  }

  function start() {
    const game = (TMM.game = createGame());
    const canvas = document.getElementById('map-canvas');
    const ctx = canvas.getContext('2d');
    const view = TMM.Renderer.createView();
    const terrain = TMM.TerrainLayer.build(game.map);
    const log = (from, text, kind) => TMM.RadioLog.add(game.gameSeconds, from, text, kind);
    const unitById = (id) => game.units.find((u) => u.id === id);

    const actions = {
      select(id) {
        game.selectedId = id && unitById(id) ? id : null;
      },
      move(id, x, y) {
        const u = unitById(id);
        const res = TMM.Movement.order(game.map, u, x, y);
        const grid = game.map.gridRef(x, y);
        if (!res.ok) {
          log(u.callsign, '이동 불가 — ' + res.reason + ' (격자 ' + grid + ')', 'warn');
          return;
        }
        const dest = game.map.infoAt(x, y).name;
        log('소대장', u.callsign + ', 격자 ' + grid + ' (' + dest + ') 로 이동하라.', 'order');
        log(u.callsign, '수신. 이동 개시. 거리 ' + (res.meters / 1000).toFixed(1) + 'km, ' + TMM.Clock.duration(res.eta) + ' 소요 예상.', 'report');
      },
      stop(id) {
        const u = unitById(id);
        if (u.state !== 'moving') return;
        TMM.Movement.stop(u);
        log('소대장', u.callsign + ', 현 위치에서 정지하라.', 'order');
        log(u.callsign, '수신. 정지 완료.', 'report');
      },
      togglePause() {
        game.paused = !game.paused;
        if (!game.paused && !game.started) {
          game.started = true;
          log('중대', '적 기갑부대 남하 중. 소대는 주둔지에서 출동 준비하라.', 'system');
        }
      },
      setSpeed(mult) {
        if (C.SPEED_OPTIONS.includes(mult)) game.speedMult = mult;
      },
    };

    TMM.RadioLog.init(document.getElementById('radio-log'));
    TMM.Panel.init(game, actions.select);
    TMM.Input.init(game, canvas, view, actions);

    const resize = () => TMM.Renderer.fit(view, canvas, game.map);
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    resize();

    log('체계', '작전 지도 로드 완료. K1A2 전차 4대 주둔지 대기 중.', 'system');

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!game.paused) {
        const gdt = dt * C.TIME_SCALE * game.speedMult;
        game.gameSeconds += gdt;
        for (const u of game.units) {
          if (TMM.Movement.update(game.map, u, gdt)) {
            const where = game.map.infoAt(u.x, u.y).name;
            log(u.callsign, '목표 지점 도착. 격자 ' + game.map.gridRef(u.x, u.y) + ' (' + where + ').', 'report');
          }
        }
      }
      TMM.Renderer.drawFrame(ctx, view, game, terrain, now / 1000);
      TMM.Panel.update(game);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // 글꼴이 준비된 뒤 지도를 그린다 (최대 1.5초 대기)
  function whenFontsReady(cb) {
    let done = false;
    const go = () => { if (!done) { done = true; cb(); } };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
    setTimeout(go, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => whenFontsReady(start));
  } else {
    whenFontsReady(start);
  }
})();
