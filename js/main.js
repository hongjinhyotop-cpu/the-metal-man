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
      cmd: { to: '1', mode: null }, // M4 무전 지휘: 받는 대상, 지도 클릭을 기다리는 명령
      scopeFx: [], // M6 조준 화면 효과 (세계 좌표, 실제 시간)
      scopeUi: { alert: null, voice: null, guide: false, recoil: 0, hitShake: 0, timers: [] },
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

  let scopeGuided = false; // 조준 화면 첫 안내는 한 번만

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

    const ctrlUnit = () => TMM.Radio.controlUnit(game);
    const cmd = game.cmd;
    const logLines = (lines) => { for (const l of lines) log(l.from, l.text, l.kind); };
    const issue = (order, spec) => {
      logLines(TMM.Command.issue(game, spec || cmd.to, order).lines);
      cmd.mode = null;
    };

    // ---- M6 1호차 조준 화면 ----
    const scopeCanvas = document.getElementById('scope-canvas');
    const sctx = scopeCanvas.getContext('2d');
    const wrapEl = document.querySelector('.map-wrap');
    const ui = game.scopeUi;
    const SV = TMM.CREW_VOICE.scope;
    const realNow = () => performance.now() / 1000;
    const pickLine = (list) => (Array.isArray(list) ? list[Math.floor(Math.random() * list.length)] : list);
    const fillT = (t, d) => t.replace(/\{(\w+)\}/g, (_, k) => (d[k] != null ? d[k] : ''));
    const scoped = () => game.scope.open;
    // 조준 화면 자막: role 이 있으면 1호차 그 보직 승무원의 말
    function voice(role, text, kind, sec) {
      const u = TMM.Scope.unit(game);
      const m = role && u && u.crew ? u.crew.byRole[role] : null;
      ui.voice = { who: m ? m.name + ' ' + m.rank : role === 'me' ? '소대장' : '체계', text, kind, until: realNow() + (sec || 2.4) };
    }
    function later(sec, fn) { ui.timers.push({ at: realNow() + sec, fn }); }
    function alertScope(text, level) {
      const t = realNow();
      ui.alert = { text, level: level || 'warn', t, until: t + 3.6 };
    }
    function showScope(on) {
      scopeCanvas.hidden = !on;
      wrapEl.classList.toggle('scoped', on);
      canvas.style.cursor = 'default';
    }
    function closeScope(why) {
      if (!scoped()) return;
      TMM.Scope.close(game);
      ui.guide = false;
      showScope(false);
      if (why) toast(why, 'warn');
    }
    function loaderLine(u) {
      const l = u.crew && u.crew.byRole.loader;
      if (!l) return '장전 완료!';
      const list = l.injury >= 2 ? SV.loadedHurt : l.skill >= 55 ? SV.loadedSure : SV.loaded;
      return fillT(pickLine(list), { ammo: TMM.AMMO[u.ammoType].short });
    }
    // 받는 대상이 지휘 전차 한 대인가 (그렇다면 직접 조작)
    const directOnly = () => {
      const us = TMM.Command.recipients(game, cmd.to);
      return us.length === 1 && us[0] === ctrlUnit();
    };

    const actions = {
      select(id) {
        game.selectedId = id && unitById(id) ? id : null;
        if (game.selectedId) {
          cmd.to = String(id);
          cmd.mode = null;
        }
      },
      setTo(spec) {
        if (scoped()) return actions.scopeBlocked();
        cmd.to = spec;
        cmd.mode = null;
        if (/^[1-4]$/.test(spec)) game.selectedId = Number(spec);
      },
      // 명령 버튼·단축키. 위치·표적이 필요한 명령은 지도 클릭을 기다린다.
      pickOrder(id) {
        if (game.over) return;
        if (scoped()) {
          if (id === 'report') {
            issue({ type: 'report' }, 'ALL');
            voice('me', '강철, 상황 보고하라.', null, 1.8);
          } else actions.scopeBlocked();
          return;
        }
        if (id === 'stop') return issue({ type: 'stop' });
        if (id === 'report') return issue({ type: 'report' });
        cmd.mode = cmd.mode === id ? null : id;
      },
      setRoe(roe) {
        if (game.over) return;
        if (scoped()) {
          // 조준 중: 소대 전체 사격 통제만 단축키로
          issue({ type: 'roe', roe }, 'ALL');
          voice('me', '강철, ' + TMM.RADIO.ROE[roe].name + '.', null, 1.8);
          return;
        }
        issue({ type: 'roe', roe });
      },
      cancel() {
        if (cmd.mode) cmd.mode = null;
        else game.selectedId = null;
      },
      // 지도(빈 곳) 클릭
      mapClick(x, y) {
        if (game.over || scoped()) return;
        const info = game.map.infoAt(x, y);
        const mode = cmd.mode;
        if (mode === 'target') return issue({ type: 'target', targetId: null });
        if (mode === 'cover') return issue({ type: 'cover', x, y });
        if (mode === 'move' || mode === 'withdraw' || mode === 'bound') {
          if (!info || !info.speed) {
            toast((info ? info.name : '작전 지역 밖') + ' — 전차가 갈 수 없는 곳입니다.', 'warn');
            return;
          }
          return issue({ type: mode, x, y });
        }
        if (directOnly()) {
          if (!info || !info.speed) {
            log(ctrlUnit().callsign, '이동 불가 — ' + (info ? info.name + ' 지역은 전차가 들어갈 수 없습니다' : '작전 지역 밖입니다') + '.', 'warn');
            return;
          }
          return issue({ type: 'move', x, y });
        }
        toast(TMM.Command.specName(game, cmd.to) + '은(는) 무전으로만 움직입니다 — [이동 M] 등 명령을 고른 뒤 지도를 클릭하십시오.', 'warn');
      },
      // 지도 위 접촉(표적) 클릭: 목표 지정 (지휘 전차면 바로, 아니면 무전)
      contactClick(targetId) {
        if (game.over || scoped()) return;
        const c = I.contact(game, 'friend', targetId);
        if (!c) return;
        const name = I.displayName(c);
        if (cmd.mode && cmd.mode !== 'target') {
          // 위치가 필요한 명령 중이면 표적 위치를 지점으로 쓴다
          return actions.mapClick(c.visible ? c.unit.x : c.lastX, c.visible ? c.unit.y : c.lastY);
        }
        if (c.wreck) {
          log('체계', name + ' 는 이미 격파됨.', 'report');
          return;
        }
        if (c.identified && c.kind === 'friendly') {
          log('체계', name + ' 는 아군입니다. 사격 불가.', 'warn');
          toast(name + ' — 아군입니다. 사격할 수 없습니다.', 'warn');
          cmd.mode = null;
          return;
        }
        if (!c.identified) {
          log('체계', '⚠ ' + name + ' 은(는) 미식별 표적 — 아군일 수 있음. 오인사격 위험.', 'warn');
          toast('⚠ ' + name + ' 은(는) 아직 식별되지 않았습니다 — 오인사격 위험', 'warn');
        }
        issue({ type: 'target', targetId });
      },
      clearTarget() {
        if (scoped()) return actions.scopeBlocked();
        issue({ type: 'target', targetId: null });
      },
      // 탄종 전환 (지휘 전차만. 다른 전차는 승무원이 알아서 바꾼다)
      cycleAmmo() {
        const u = ctrlUnit();
        if (!u || game.over) return;
        if (!directOnly() && !scoped()) {
          toast('탄종 전환은 지휘 전차(1호차)만 직접 합니다. 다른 전차는 탄이 떨어지면 스스로 바꿉니다.', 'warn');
          return;
        }
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
        if (scoped()) voice('loader', TMM.AMMO[next].short + '! 바꿔 넣겠습니다!', null, 1.8);
      },
      // ---- M6 조준 화면 ----
      toggleScope() {
        if (game.over) return;
        if (scoped()) return closeScope();
        if (!TMM.Scope.canUse(game)) {
          toast('1호차가 격파되어 조준 화면을 쓸 수 없습니다.', 'warn');
          return;
        }
        cmd.mode = null;
        TMM.Scope.open(game);
        showScope(true);
        if (!scopeGuided) {
          scopeGuided = true;
          ui.guide = true;
          ui.guideUntil = realNow() + 14;
        }
      },
      // 첫 안내가 떠 있으면 닫기만 한다. 반환: 닫았는가
      dismissGuide() {
        if (!ui.guide) return false;
        ui.guide = false;
        return true;
      },
      scopeFire() {
        if (actions.dismissGuide()) return;
        const u = TMM.Scope.unit(game);
        const r = TMM.Scope.fire(game);
        if (!r.ok) {
          if (r.why === 'reload') {
            const l = u && u.crew && u.crew.byRole.loader;
            voice('loader', pickLine(l && l.skill >= 55 ? SV.busySure : SV.busy), 'warn', 1.4);
          } else if (/사거리/.test(r.why)) voice('gunner', SV.range + ' (' + r.why + ')', 'warn', 2);
          else voice(null, r.why, 'warn', 2);
          return;
        }
        const t0 = realNow();
        ui.recoil = t0;
        voice('me', '발사!', null, 0.9);
        if (r.wild) {
          log(u.callsign + ' (차내)', TMM.AMMO[r.ammoId].short + ' 발사 — 표적 없음, 탄 1발 낭비.', 'warn');
          later(0.9, () => voice('gunner', SV.wild, 'warn'));
          return;
        }
        const t = r.target, res = r.res;
        const dur = Math.min(1.6, 0.25 + res.distM / 2600); // 탄이 날아가는 시간 (보기 좋게 줄임)
        const ox = res.hit ? 0 : (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 10);
        const st = TMM.ScopeView.reticleScreen(game, scopeCanvas);
        game.scopeFx.push({ kind: 'tracer', x: t.x, y: t.y, t: t0, dur, sx: st.x, sy: st.y, hit: res.hit, ox });
        game.scopeFx.push({ kind: 'impact', x: t.x, y: t.y, t: t0 + dur, hit: res.hit, pen: res.pen, kill: res.destroyed, ox });
        later(dur + 0.35, () => {
          if (t.side === 'friend') voice('gunner', SV.ff, 'warn');
          else if (res.destroyed) {
            voice('gunner', pickLine(SV.kill));
            const l = u.crew && u.crew.byRole.loader;
            if (l && l.skill < 55 && Math.random() < 0.35) later(1.6, () => voice('loader', SV.killCheer[1]));
          } else if (res.hit) voice('gunner', res.pen ? SV.pen : SV.hit);
          else voice('gunner', pickLine(SV.miss));
        });
      },
      scopeLase() {
        if (actions.dismissGuide()) return;
        if (game.paused) return voice(null, '일시정지 중 — 조준·사격 불가', 'warn', 1.6);
        const r = TMM.Scope.lase(game);
        if (!r.ok) return voice('gunner', SV.noFcs, 'warn', 2.6);
        if (r.target) voice('gunner', fillT(r.moving ? SV.laseMoving : SV.lase, { d: r.distM }), null, 2);
        else if (r.distM == null) voice('gunner', SV.laseNone, null, 1.6);
        else voice('gunner', fillT(SV.laseGround, { d: r.distM }), null, 1.6);
      },
      scopeZoom(dir) {
        if (actions.dismissGuide()) return;
        if (game.paused) return;
        const z = dir == null ? (game.scope.zoom + 1) % TMM.SCOPE.ZOOMS.length : game.scope.zoom + dir;
        TMM.Scope.setZoom(game, z);
      },
      scopeKeys(pan, tilt) {
        game.scope.keyPan = pan;
        game.scope.keyTilt = tilt;
      },
      scopeBlocked() {
        if (actions.dismissGuide()) return;
        voice(null, '조준 중에는 무전 명령을 내릴 수 없습니다 — Tab 으로 지도', 'warn', 2.2);
      },
      toggleSight() {
        game.showSight = !game.showSight;
      },
      togglePause() {
        if (game.over) return;
        game.paused = !game.paused;
        if (!game.paused && !game.started) {
          game.started = true;
          log(TMM.RADIO.COMPANY, TMM.RADIO.NET + ', 여기 ' + TMM.RADIO.COMPANY + '. 작전 개시. 식별된 적과 교전하라. 미식별 표적은 확인 후 사격. 이상.', 'system');
        }
      },
      setSpeed(mult) {
        if (C.SPEED_OPTIONS.includes(mult)) game.speedMult = mult;
      },
    };

    TMM.RadioLog.init(document.getElementById('radio-log'));
    TMM.Panel.init(game, actions.select);
    TMM.CommandBar.init(game, actions);
    TMM.Result.init();
    TMM.Input.init(game, canvas, view, actions, scopeCanvas);

    const resize = () => TMM.Renderer.fit(view, canvas, game.map);
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    resize();

    log('체계', '작전 지도 로드 완료. K1A2 전차 4대 주둔지 대기 중. ' + TMM.LIGHT[light].name + ' 작전.', 'system');

    // 무전망(TMM.Radio)이 만든 교신과, 무전망을 거치지 않는 알림(전장관리체계 경고·중대 무전·화면 효과)
    function report(ev, realT) {
      if (ev.type === 'radio') {
        log(ev.from, ev.text, ev.kind);
      } else if (ev.type === 'contact-id') {
        if (ev.side !== 'friend' || ev.how === 'iff' || !ev.contact.known) return;
        const c = ev.contact, t = ev.unit;
        if (c.kind === 'friendly') {
          log('전장관리체계', '미상 표적 ' + c.label + ' 은(는) ' + t.callsign + '! 아군이다. 사격 금지.', 'warn');
          toast('미상 표적 ' + c.label + ' = ' + t.callsign + ' (아군) — 사격 금지', 'warn');
        }
      } else if (ev.type === 'shot') {
        const { shooter: s, target: t, res } = ev;
        game.fx.push({ t: realT, x0: s.x, y0: s.y, x1: t.x, y1: t.y, side: s.side, hit: res.hit, pen: res.pen, kill: res.destroyed });
        // M6: 조준경에 보이는 다른 사격 (1호차 수동 사격은 발사할 때 이미 넣음)
        const u1 = TMM.Scope.unit(game);
        if (u1 && !u1.destroyed && !ev.manual) {
          if (s !== u1 && I.sees(game, u1, s)) game.scopeFx.push({ kind: 'flash', x: s.x, y: s.y, t: realT });
          if (t !== u1 && (I.sees(game, u1, t) || t.destroyed)) {
            game.scopeFx.push({ kind: 'impact', x: t.x, y: t.y, t: realT + Math.min(1.2, 0.2 + res.distM / 3000), hit: res.hit, pen: res.pen, kill: res.destroyed, ox: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 10) });
          }
        }
        // M6: 조준 화면 경고 — 소대 전차가 맞음
        if (s.side === 'enemy' && t.side === 'friend' && !t.ally && res.hit) {
          if (t === u1) ui.hitShake = realT;
          alertScope(t.callsign + (res.destroyed ? ' 피격, 격파됨!' : res.pen ? ' 피격 — 관통!' : ' 피격'), res.destroyed ? 'loss' : 'warn');
        }
        if (ev.friendlyFire) alertScope('오인사격! ' + s.callsign + ' → ' + t.callsign, 'loss');
        if (s.side === 'friend' && ev.friendlyFire) {
          const r = !res.hit ? '빗나감' : res.destroyed ? (t.model === 'INF' ? '분대 전투력 상실' : '파괴') : t.model === 'INF' ? '사상자 발생' : '손상';
          log('⚠ 오인사격', s.callsign + '이(가) ' + t.callsign + '에 사격! (' + km(res.distM) + ') — ' + r + '.', 'ff');
          log(t.callsign, '사격 중지! 사격 중지! 여기는 아군이다!', 'ff');
          toast('⚠ 오인사격! ' + s.callsign + ' → ' + t.callsign + ' (' + r + ')', 'ff');
        } else if (s.side === 'enemy' && t.ally) {
          if (res.destroyed) log(TMM.RADIO.COMPANY, t.callsign + ' 피격! ' + (t.model === 'INF' ? '전투력 상실.' : '격파됨.'), 'loss');
          else if (res.hit) log(t.callsign, '피격! 피해 발생.', 'warn');
        }
      } else if (ev.type === 'enemy-break') {
        log(TMM.RADIO.COMPANY, '적 무전 감청: 천마호 소대 퇴각 명령. 적이 북쪽으로 물러난다. 끝까지 쫓을 필요 없음.', 'system');
      } else if (ev.type === 'enemy-abandon') {
        const c = I.contact(game, 'friend', ev.unit.id);
        if (c && c.visible) log('전장관리체계', I.displayName(c) + ' 승무원 탈출, 전차 유기.', 'report');
      } else if (ev.type === 'enemy-exit') {
        log(TMM.RADIO.COMPANY, '적 전차 1대 작전 지역 북쪽 밖으로 이탈.', 'report');
      } else if (ev.type === 'ally-move') {
        const u = ev.unit;
        if (u.model === 'INF') log(u.callsign, '적 전차 접근. 관측초소에서 주둔지로 도보 철수한다.', 'report');
        else if (u.model === 'TRUCK') log(TMM.RADIO.COMPANY, '보급 트럭이 관측초소에서 국도로 주둔지에 복귀한다. 피아식별장치 없음, 오인사격 주의.', 'system');
        else log(TMM.RADIO.COMPANY, '인접 중대 K2 전차 1대가 동부 도로로 와서 주둔지를 지나 남쪽으로 이동한다.', 'system');
      } else if (ev.type === 'over') {
        if (ev.win) {
          if (game.enemies.some((e) => e.exited)) log(TMM.RADIO.COMPANY, '적 천마호 소대 퇴각 확인. 진지 사수, 작전 성공. 수고했다.', 'system');
          else log(TMM.RADIO.COMPANY, '적 천마호 소대 격멸 확인. 수고했다.', 'system');
        } else log(TMM.RADIO.COMPANY, '강철, 여기 강철 6. 강철 소대 전투력 상실 확인. 남은 전차는 주둔지로 철수하라. 작전 실패.', 'system');
        TMM.Result.show(game);
      }
    }

    log(TMM.RADIO.COMPANY, '강철, 여기 강철 6. 적 천마호 전차 1개 소대(4대), 매봉 능선·새터읍 일대에서 남하 중. 강철은 주둔지를 지키며 저지하라. 이상.', 'system');
    log(TMM.RADIO.COMPANY, '전방 저수지 동쪽 숲에 아군 보병 분대(관측초소)와 보급 트럭이 있다. 둘 다 피아식별장치 없음 — 식별 전 사격 주의. 이상.', 'system');
    log('체계', '1호차는 직접 조작, 2·3·4호차는 무전으로 지휘합니다. 오른쪽 위 [무전 지휘] 창에서 받는 대상과 명령을 고르십시오.', 'system');

    // M6: 교신 두절 감시 (조준 화면 경고)
    const linkWas = new Map();
    function watchLinks() {
      for (const u of game.units) {
        if (u.destroyed) { linkWas.set(u.id, 'lost'); continue; }
        const code = TMM.Radio.linkState(game, u).code;
        const was = linkWas.get(u.id);
        if (code === 'dead' && was && was !== 'dead') alertScope(u.callsign + ' 교신 두절', 'warn');
        linkWas.set(u.id, code);
      }
    }
    let reloadWas = 0;
    function updateScope(realDt, nowR) {
      for (const tm of ui.timers.slice()) if (tm.at <= nowR) { ui.timers.splice(ui.timers.indexOf(tm), 1); tm.fn(); }
      game.scopeFx = game.scopeFx.filter((f) => nowR - f.t < 3);
      if (ui.guide && nowR > ui.guideUntil) ui.guide = false;
      if (!scoped()) return;
      if (game.over) return closeScope();
      if (!TMM.Scope.canUse(game)) return closeScope('1호차 격파 — 조준 화면이 꺼졌습니다. 지휘권은 4호차(부소대장차)로.');
      TMM.Scope.update(game, realDt);
      // 장전이 끝나면 탄약수가 외친다
      const u = TMM.Scope.unit(game);
      const r = u.fire.reload;
      if (reloadWas > 0 && r <= 0 && !u.damage.gun && TMM.Damage.totalAmmo(u) > 0) voice('loader', loaderLine(u), null, 1.6);
      reloadWas = r;
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      updateScope(!game.paused && !game.over ? dt : 0, now / 1000);
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
      watchLinks();
      if (scoped()) TMM.ScopeView.draw(sctx, scopeCanvas, game, now / 1000);
      else TMM.Renderer.drawFrame(ctx, view, game, terrain, now / 1000);
      TMM.Panel.update(game);
      TMM.CommandBar.update(game);
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
