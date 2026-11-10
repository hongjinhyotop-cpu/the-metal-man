/*
 * 시작점: 게임 상태를 만들고, 입력·그리기·패널을 연결해 주 루프를 돌린다.
 */
(function () {
  const C = TMM.CONFIG;

  function createGame() {
    return {
      map: TMM.MapGen.generate(),
      units: TMM.Platoon.create(),
      enemies: TMM.Enemy.create(),
      selectedId: null,
      paused: true, // 처음에는 작전 대기 상태
      started: false,
      speedMult: 1,
      gameSeconds: C.START_SECONDS,
      hover: null,
      fx: [], // 화면 효과 (사격 궤적, 피탄 섬광)
      lastShotAt: null,
      combat: false, // 교전 중이면 시간 감속
      over: null, // 승패가 나면 { win, at }
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
    const enemyById = (id) => game.enemies.find((e) => e.id === id);
    const km = (m) => (m / 1000).toFixed(1) + 'km';

    const actions = {
      select(id) {
        game.selectedId = id && unitById(id) ? id : null;
      },
      move(id, x, y) {
        const u = unitById(id);
        if (game.over) return;
        if (u.destroyed) {
          log(u.callsign, '(응답 없음) — 격파된 전차입니다.', 'warn');
          return;
        }
        if (u.damage.track) {
          log(u.callsign, '궤도 손상으로 기동 불가. 현 위치에서 사격만 가능.', 'warn');
          return;
        }
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
      // 사격 목표 지정
      target(id, enemyId) {
        const u = unitById(id), e = enemyById(enemyId);
        if (!u || !e || game.over) return;
        if (u.destroyed) {
          log(u.callsign, '(응답 없음) — 격파된 전차입니다.', 'warn');
          return;
        }
        if (e.destroyed) {
          log(u.callsign, e.callsign + ' 는 이미 격파됨.', 'report');
          return;
        }
        u.targetId = e.id;
        const d = TMM.Ballistics.distanceM(game.map, u, e);
        log('소대장', u.callsign + ', ' + e.callsign + ' 사격하라.', 'order');
        if (u.damage.gun) log(u.callsign, '주포 손상, 사격 불가.', 'warn');
        else if (TMM.Damage.totalAmmo(u) <= 0) log(u.callsign, '잔탄 없음, 사격 불가.', 'warn');
        else if (d > TMM.AMMO[u.ammoType].rangeM) log(u.callsign, '수신. 거리 ' + km(d) + ', 사거리 밖. 접근 시 사격.', 'report');
        else log(u.callsign, '수신. 거리 ' + km(d) + ', 조준 중.', 'report');
      },
      clearTarget(id) {
        const u = unitById(id);
        if (!u || u.targetId == null) return;
        u.targetId = null;
        log('소대장', u.callsign + ', 지정 목표 해제. 자유 사격.', 'order');
      },
      // 탄종 전환 (K276 ↔ K277)
      cycleAmmo(id) {
        const u = unitById(id);
        if (!u || u.destroyed || game.over) return;
        const types = TMM.VEHICLES[u.model].ammoTypes;
        const next = types[(types.indexOf(u.ammoType) + 1) % types.length];
        if (u.ammo[next] <= 0) {
          log(u.callsign, TMM.AMMO[next].short + ' 잔탄 없음. 전환 불가.', 'warn');
          return;
        }
        u.ammoType = next;
        u.fire.reload = Math.max(u.fire.reload, 3); // 탄을 바꿔 넣는 시간 (게임용 추정치)
        log('소대장', u.callsign + ', ' + TMM.AMMO[next].short + '으로 전환.', 'order');
        log(u.callsign, '수신. ' + TMM.AMMO[next].name + ' 장전.', 'report');
      },
      togglePause() {
        if (game.over) return;
        game.paused = !game.paused;
        if (!game.paused && !game.started) {
          game.started = true;
          log('중대', '작전 개시. 사거리 안의 적과 자유 교전하라.', 'system');
        }
      },
      setSpeed(mult) {
        if (C.SPEED_OPTIONS.includes(mult)) game.speedMult = mult;
      },
    };

    TMM.RadioLog.init(document.getElementById('radio-log'));
    TMM.Panel.init(game, actions.select);
    TMM.Result.init();
    TMM.Input.init(game, canvas, view, actions);

    const resize = () => TMM.Renderer.fit(view, canvas, game.map);
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    resize();

    log('체계', '작전 지도 로드 완료. K1A2 전차 4대 주둔지 대기 중.', 'system');

    // 전투 사건 → 무전 기록 + 화면 효과
    const PART_LINES = {
      track: '궤도 손상, 기동 불가',
      engine: '엔진 손상, 속도 저하',
      gun: '주포 손상, 사격 불가',
      fcs: '사격통제장치 손상, 명중률 저하',
      radio: '무전기 손상',
    };
    const partsText = (parts) => parts.map((k) => PART_LINES[k]).join(', ');
    const ASP = TMM.Ballistics.ASPECT_NAMES;

    function report(ev, realT) {
      if (ev.type === 'arrive') {
        const u = ev.unit;
        const where = game.map.infoAt(u.x, u.y).name;
        log(u.callsign, '목표 지점 도착. 격자 ' + game.map.gridRef(u.x, u.y) + ' (' + where + ').', 'report');
      } else if (ev.type === 'shot') {
        const { shooter: s, target: t, res } = ev;
        game.fx.push({ t: realT, x0: s.x, y0: s.y, x1: t.x, y1: t.y, side: s.side, hit: res.hit, pen: res.pen, kill: res.destroyed });
        if (s.side === 'friend') {
          const what = TMM.AMMO[ev.ammoId].short;
          if (res.destroyed) {
            log(s.callsign, t.callsign + ' 격파. (' + what + ', ' + km(res.distM) + ')', 'kill');
            return;
          }
          let r;
          if (!res.hit) r = '빗나감.';
          else if (ev.fresh.length) r = '명중. ' + (res.pen ? '' : '외부 손상: ') + ev.fresh.map((k) => TMM.PARTS[k].name).join('·') + ' 손상.';
          else if (res.pen) r = '명중, 관통. 효과 미확인.';
          else r = '명중, 관통 실패.';
          log(s.callsign, t.callsign + '에 ' + what + ' 사격 (' + km(res.distM) + '). ' + r, 'fire');
        } else {
          if (!res.hit) {
            // 적 포탄이 빗나간 것은 같은 전차에 대해 게임 60초에 한 번만 알린다 (기록이 넘치지 않게)
            if (!(t.lastMissLog > game.gameSeconds - 60)) {
              t.lastMissLog = game.gameSeconds;
              log(t.callsign, s.callsign + '의 포격, 근탄. 피해 없음.', 'report');
            }
          }
          else if (res.destroyed) log('소대망', t.callsign + ' 피격, 격파됨! (' + ASP[res.aspect] + ', ' + km(res.distM) + ')', 'loss');
          else if (ev.fresh.length) log(t.callsign, '피탄! ' + ASP[res.aspect] + (res.pen ? ' 관통. ' : '. ') + partsText(ev.fresh) + '.', 'warn');
          else if (res.pen) log(t.callsign, '피탄! ' + ASP[res.aspect] + ' 관통, 피해 경미.', 'warn');
          else log(t.callsign, '피탄! ' + ASP[res.aspect] + ' 장갑이 막아냄.', 'warn');
        }
      } else if (ev.type === 'ammo-switch') {
        if (ev.unit.side === 'friend') {
          log(ev.unit.callsign, TMM.AMMO[ev.from].short + ' 소진. ' + TMM.AMMO[ev.to].short + '으로 전환.', 'warn');
        }
      } else if (ev.type === 'enemy-engage') {
        if (!ev.unit.ai.reported) {
          ev.unit.ai.reported = true;
          log('소대망', ev.unit.callsign + ' 정지, 사격 자세. 격자 ' + game.map.gridRef(ev.unit.x, ev.unit.y) + '.', 'report');
        }
      } else if (ev.type === 'enemy-retreat') {
        log('소대망', ev.unit.callsign + ' 후퇴 중.', 'report');
      } else if (ev.type === 'over') {
        if (ev.win) log('중대', '적 천마호 소대 격멸 확인. 수고했다.', 'system');
        else log('중대', '소대 교신 두절… 작전 실패.', 'system');
        TMM.Result.show(game);
      }
    }

    log('중대', '적 천마호 전차 1개 소대, 매봉 능선·새터읍 일대에서 남하 중. 소대는 저지하라.', 'system');

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!game.paused && !game.over) {
        game.combat = TMM.Battle.inCombat(game);
        const scale = game.combat ? C.COMBAT_TIME_SCALE : C.TIME_SCALE;
        const gdt = dt * scale * game.speedMult;
        game.gameSeconds += gdt;
        const events = TMM.Battle.step(game, gdt);
        for (const ev of events) report(ev, now / 1000);
      }
      game.fx = game.fx.filter((f) => now / 1000 - f.t < C.FX_SECONDS);
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
