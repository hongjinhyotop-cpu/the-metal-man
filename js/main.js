/*
 * 시작점: 시작 화면(주간/야간 선택) → 게임 상태를 만들고, 입력·그리기·패널을 연결해 주 루프를 돌린다.
 */
(function () {
  const C = TMM.CONFIG;

  function createGame(light) {
    const game = TMM.Battle.create({ light });
    Object.assign(game, {
      selectedId: null,
      paused: true, // 처음에는 작전 대기 상태
      started: false,
      speedMult: 1,
      hover: null,
      hoverContactId: null,
      showSight: false, // V 키: 선택 전차의 시야 표시
      fx: [], // 화면 효과 (사격 궤적, 피탄 섬광)
    });
    return game;
  }

  // ---- 시작 화면 ----
  function showStart() {
    const el = document.getElementById('start');
    let light = 'day';
    el.querySelectorAll('[data-light]').forEach((btn) => {
      btn.addEventListener('click', () => {
        light = btn.dataset.light;
        el.querySelectorAll('[data-light]').forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      });
    });
    el.querySelector('[data-go]').addEventListener('click', () => {
      el.hidden = true;
      boot(light);
    });
    el.hidden = false;
  }

  // 화면 위 알림 (오인사격 경고 등). 실제 시간으로 몇 초 뒤 사라진다.
  let toastTimer = null;
  function toast(text, kind) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'toast ' + (kind || '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'ff' ? 5000 : 3000);
  }

  function boot(light) {
    const game = (TMM.game = createGame(light));
    const canvas = document.getElementById('map-canvas');
    const ctx = canvas.getContext('2d');
    const view = TMM.Renderer.createView();
    const terrain = TMM.TerrainLayer.build(game.map);
    const log = (from, text, kind) => TMM.RadioLog.add(game.gameSeconds, from, text, kind);
    const unitById = (id) => game.units.find((u) => u.id === id);
    const km = (m) => (m / 1000).toFixed(1) + 'km';
    const I = TMM.Intel;
    const nameOf = (t) => {
      const c = I.contact(game, 'friend', t.id);
      return c ? I.displayName(c) : '미상 표적';
    };

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
      // 사격 목표 지정 (지도에 보이는 접촉을 클릭)
      target(id, targetId) {
        const u = unitById(id);
        const c = I.contact(game, 'friend', targetId);
        if (!u || !c || game.over) return;
        const t = c.unit;
        const name = I.displayName(c);
        if (u.destroyed) {
          log(u.callsign, '(응답 없음) — 격파된 전차입니다.', 'warn');
          return;
        }
        if (c.wreck) {
          log(u.callsign, name + ' 는 이미 격파됨.', 'report');
          return;
        }
        if (c.identified && c.kind === 'friendly') {
          log(u.callsign, name + ' 는 아군입니다. 사격 불가.', 'warn');
          toast(name + ' — 아군입니다. 사격할 수 없습니다.', 'warn');
          return;
        }
        u.targetId = t.id;
        log('소대장', u.callsign + ', ' + name + ' 사격하라.', 'order');
        if (!c.identified) {
          log(u.callsign, '⚠ 미식별 표적입니다. 아군일 수 있음 — 오인사격 위험. 지시대로 사격하겠음.', 'warn');
          toast('⚠ ' + name + ' 은(는) 아직 식별되지 않았습니다 — 오인사격 위험', 'warn');
        }
        const d = TMM.Ballistics.distanceM(game.map, u, t);
        if (u.damage.gun) log(u.callsign, '주포 손상, 사격 불가.', 'warn');
        else if (TMM.Damage.totalAmmo(u) <= 0) log(u.callsign, '잔탄 없음, 사격 불가.', 'warn');
        else if (!c.visible) log(u.callsign, '수신. 표적 소실 상태. 재포착 시 사격.', 'report');
        else if (!I.sees(game, u, t)) log(u.callsign, '수신. 본 차에서는 표적이 보이지 않음. 시야에 들어오면 사격.', 'report');
        else if (d > TMM.AMMO[u.ammoType].rangeM) log(u.callsign, '수신. 거리 ' + km(d) + ', 사거리 밖. 접근 시 사격.', 'report');
        else log(u.callsign, '수신. 거리 ' + km(d) + ', 조준 중.', 'report');
      },
      clearTarget(id) {
        const u = unitById(id);
        if (!u || u.targetId == null) return;
        u.targetId = null;
        log('소대장', u.callsign + ', 지정 목표 해제. 식별된 적과 자유 교전.', 'order');
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
      toggleSight() {
        game.showSight = !game.showSight;
      },
      togglePause() {
        if (game.over) return;
        game.paused = !game.paused;
        if (!game.paused && !game.started) {
          game.started = true;
          log('중대', '작전 개시. 식별된 적과 자유 교전하라. 미식별 표적은 확인 후 사격.', 'system');
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

    log('체계', '작전 지도 로드 완료. K1A2 전차 4대 주둔지 대기 중. ' + TMM.LIGHT[light].name + ' 작전.', 'system');

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
    const callsignOf = (id) => {
      const u = unitById(id);
      return u ? u.callsign : '소대망';
    };

    function report(ev, realT) {
      if (ev.type === 'arrive') {
        const u = ev.unit;
        const where = game.map.infoAt(u.x, u.y).name;
        log(u.callsign, '목표 지점 도착. 격자 ' + game.map.gridRef(u.x, u.y) + ' (' + where + ').', 'report');
      } else if (ev.type === 'contact-new') {
        if (ev.side !== 'friend') return;
        const c = ev.contact, t = ev.unit;
        const d = km(c.dist);
        if (c.identified) {
          // 피아식별장치 응답
          log(callsignOf(ev.by), t.callsign + ' 탐지 — 피아식별 응답, 아군. (거리 ' + d + ')', 'report');
        } else {
          log(callsignOf(ev.by), '미상 표적 ' + c.label + ' 탐지. 격자 ' + game.map.gridRef(t.x, t.y) + ', 거리 ' + d + '. 식별 중.', 'report');
        }
      } else if (ev.type === 'contact-id') {
        if (ev.side !== 'friend' || ev.how === 'iff') return;
        const c = ev.contact, t = ev.unit;
        if (c.kind === 'hostile') {
          log(callsignOf(c.seenBy[0]), '미상 표적 ' + c.label + ', ' + (TMM.VEHICLES[t.model].cls === 'tank' ? '적 천마호 전차로' : '적으로') + ' 식별. (' + t.callsign + ')', 'report');
        } else {
          log('소대망', '미상 표적 ' + c.label + ' 은(는) ' + t.callsign + '! 아군이다. 사격 금지.', 'warn');
          toast('미상 표적 ' + c.label + ' = ' + t.callsign + ' (아군) — 사격 금지', 'warn');
        }
      } else if (ev.type === 'cease-fire') {
        log(ev.unit.callsign, '사격 중지! 표적은 ' + ev.target.callsign + ', 아군입니다.', 'warn');
      } else if (ev.type === 'shot') {
        const { shooter: s, target: t, res } = ev;
        game.fx.push({ t: realT, x0: s.x, y0: s.y, x1: t.x, y1: t.y, side: s.side, hit: res.hit, pen: res.pen, kill: res.destroyed });
        if (s.side === 'friend') {
          const what = TMM.AMMO[ev.ammoId].short;
          if (ev.friendlyFire) {
            const r = !res.hit ? '빗나감' : res.destroyed ? (t.model === 'INF' ? '분대 전투력 상실' : '파괴') : t.model === 'INF' ? '사상자 발생' : '손상';
            log('⚠ 오인사격', s.callsign + '이(가) ' + t.callsign + '에 사격! (' + km(res.distM) + ') — ' + r + '.', 'ff');
            log(t.callsign, '사격 중지! 사격 중지! 여기는 아군이다!', 'ff');
            toast('⚠ 오인사격! ' + s.callsign + ' → ' + t.callsign + ' (' + r + ')', 'ff');
            return;
          }
          const tname = ev.unidentified ? '미식별 표적' : t.callsign;
          if (res.destroyed) {
            log(s.callsign, tname + ' 격파. (' + what + ', ' + km(res.distM) + ')' + (ev.unidentified ? ' 확인 결과 ' + t.callsign + '.' : ''), 'kill');
            return;
          }
          let r;
          if (!res.hit) r = '빗나감.';
          else if (ev.fresh.length) r = '명중. ' + (res.pen ? '' : '외부 손상: ') + ev.fresh.map((k) => TMM.PARTS[k].name).join('·') + ' 손상.';
          else if (res.pen) r = '명중, 관통. 효과 미확인.';
          else r = '명중, 관통 실패.';
          log(s.callsign, tname + '에 ' + what + ' 사격 (' + km(res.distM) + '). ' + r, ev.unidentified ? 'warn' : 'fire');
        } else {
          const from = nameOf(s);
          if (t.ally) {
            if (res.destroyed) log('중대', t.callsign + ' 피격! ' + (t.model === 'INF' ? '전투력 상실.' : '격파됨.'), 'loss');
            else if (res.hit) log(t.callsign, '피격! 피해 발생.', 'warn');
            return;
          }
          if (!res.hit) {
            // 적 포탄이 빗나간 것은 같은 전차에 대해 게임 60초에 한 번만 알린다 (기록이 넘치지 않게)
            if (!(t.lastMissLog > game.gameSeconds - 60)) {
              t.lastMissLog = game.gameSeconds;
              log(t.callsign, from + '의 포격, 근탄. 피해 없음.', 'report');
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
        const c = I.contact(game, 'friend', ev.unit.id);
        if (c && c.visible && c.identified && !ev.unit.ai.reported) {
          ev.unit.ai.reported = true;
          log('소대망', ev.unit.callsign + ' 정지, 사격 자세. 격자 ' + game.map.gridRef(ev.unit.x, ev.unit.y) + '.', 'report');
        }
      } else if (ev.type === 'enemy-retreat') {
        const c = I.contact(game, 'friend', ev.unit.id);
        if (c && c.visible && c.identified) log('소대망', ev.unit.callsign + ' 후퇴 중.', 'report');
      } else if (ev.type === 'enemy-break') {
        log('중대', '적 무전 감청: 천마호 소대 퇴각 명령. 적이 북쪽으로 물러난다. 끝까지 쫓을 필요 없음.', 'system');
      } else if (ev.type === 'enemy-abandon') {
        const c = I.contact(game, 'friend', ev.unit.id);
        if (c && c.visible) log('소대망', I.displayName(c) + ' 승무원 탈출, 전차 유기.', 'report');
      } else if (ev.type === 'enemy-exit') {
        log('중대', '적 전차 1대 작전 지역 북쪽 밖으로 이탈.', 'report');
      } else if (ev.type === 'ally-move') {
        const u = ev.unit;
        if (u.model === 'INF') log(u.callsign, '적 전차 접근. 관측초소에서 주둔지로 도보 철수한다.', 'report');
        else if (u.model === 'TRUCK') log('중대', '보급 트럭이 관측초소에서 국도로 주둔지에 복귀한다. 피아식별장치 없음, 오인사격 주의.', 'system');
        else log('중대', '인접 중대 K2 전차 1대가 동부 도로로 와서 주둔지를 지나 남쪽으로 이동한다.', 'system');
      } else if (ev.type === 'over') {
        if (ev.win) {
          if (game.enemies.some((e) => e.exited)) log('중대', '적 천마호 소대 퇴각 확인. 진지 사수, 작전 성공. 수고했다.', 'system');
          else log('중대', '적 천마호 소대 격멸 확인. 수고했다.', 'system');
        } else log('중대', '소대 교신 두절… 작전 실패.', 'system');
        TMM.Result.show(game);
      }
    }

    log('중대', '적 천마호 전차 1개 소대(4대), 매봉 능선·새터읍 일대에서 남하 중. 소대는 저지하라.', 'system');
    log('중대', '전방 저수지 동쪽 숲에 아군 보병 분대(관측초소)와 보급 트럭이 있다. 둘 다 피아식별장치 없음 — 식별 전 사격 주의.', 'system');

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!game.paused && !game.over) {
        game.combat = TMM.Battle.inCombat(game);
        const scale = game.combat ? C.COMBAT_TIME_SCALE : C.TIME_SCALE;
        const gdt = dt * scale * game.speedMult;
        const events = TMM.Battle.step(game, gdt);
        for (const ev of events) report(ev, now / 1000);
      } else if (!game.visReady) {
        const evs = [];
        TMM.Intel.update(game, 0, evs); // 작전 대기 중에도 처음 시야는 계산해 둔다
        for (const ev of evs) report(ev, now / 1000);
      }
      game.fx = game.fx.filter((f) => now / 1000 - f.t < C.FX_SECONDS);
      TMM.Renderer.drawFrame(ctx, view, game, terrain, now / 1000);
      TMM.Panel.update(game);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // 글꼴이 준비된 뒤 시작 화면을 띄운다 (최대 1.5초 대기)
  function whenFontsReady(cb) {
    let done = false;
    const go = () => { if (!done) { done = true; cb(); } };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
    setTimeout(go, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => whenFontsReady(showStart));
  } else {
    whenFontsReady(showStart);
  }
})();
