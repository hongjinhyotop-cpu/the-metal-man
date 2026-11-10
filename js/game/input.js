/*
 * 마우스·키보드 입력 (M4: 무전 지휘).
 *   전차 클릭 / 1~4: 전차 선택 (받는 대상도 그 전차로) · 5 1조 · 6 2조 · 7 소대 전체
 *   지도 클릭: 고른 명령의 위치 지정. 명령을 고르지 않았으면 지휘 전차(1호차)만 이동.
 *   표적 클릭: 받는 대상에게 목표 지정 (1호차는 바로, 2·3·4호차는 무전)
 *   M 이동 · C 엄호 · B 엄호 이동 · T 목표 지정 · W 철수 · S 정지 · R 상황 보고
 *   8 사격 금지 · 9 식별 후 사격 · 0 자유 사격
 *   Q 탄종 전환(1호차) · X 목표 해제 · V 시야 표시 · 스페이스바 일시정지 · Esc/오른쪽 클릭 취소
 *   M6 Tab: 지도 ↔ 1호차 조준 화면. 조준 화면에서는 마우스 조준·좌클릭 발사·L(또는 오른쪽 클릭) 레이저·Q 탄종·
 *      휠/Z 배율·A D W S(화살표) 포탑, 8·9·0·R 만 소대 전체에. 다른 명령 키는 막힌다.
 */
TMM.Input = (function () {
  function init(game, canvas, view, actions, scopeCanvas) {
    function local(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    canvas.addEventListener('mousemove', (ev) => {
      const p = local(ev);
      const m = view.toMap(p.x, p.y);
      game.hover = game.map.typeAt(m.x, m.y) >= 0 ? m : null;
      const overUnit = TMM.Renderer.hitUnit(view, game.units, p.x, p.y);
      const overMark = overUnit ? null : TMM.Renderer.hitUnit(view, TMM.Renderer.contactMarks(game), p.x, p.y);
      game.hoverContactId = overMark ? overMark.id : null;
      let cursor = 'default';
      const mode = game.cmd.mode;
      if (overUnit) cursor = 'pointer';
      else if (overMark) {
        const c = overMark.contact;
        cursor = !c.wreck && c.kind !== 'friendly' ? 'crosshair' : 'help';
      }
      else if (mode === 'cover' || mode === 'target') cursor = 'crosshair';
      else if (game.hover && (mode || game.cmd.to === String(game.selectedId))) {
        cursor = game.map.infoAt(m.x, m.y).speed ? 'crosshair' : 'not-allowed';
      }
      canvas.style.cursor = cursor;
    });

    canvas.addEventListener('mouseleave', () => {
      game.hover = null;
      game.hoverContactId = null;
    });

    canvas.addEventListener('click', (ev) => {
      const p = local(ev);
      const hit = TMM.Renderer.hitUnit(view, game.units, p.x, p.y);
      if (hit) {
        actions.select(hit.id);
        return;
      }
      const mark = TMM.Renderer.hitUnit(view, TMM.Renderer.contactMarks(game), p.x, p.y);
      if (mark) {
        actions.contactClick(mark.id);
        return;
      }
      const m = view.toMap(p.x, p.y);
      if (game.map.typeAt(m.x, m.y) < 0) return;
      actions.mapClick(m.x, m.y);
    });

    // 오른쪽 클릭: 고른 명령 취소, 없으면 선택 해제
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      actions.cancel();
    });

    // ---- M6 조준 화면 마우스 ----
    if (scopeCanvas) {
      const sl = (ev) => {
        const r = scopeCanvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
      };
      scopeCanvas.addEventListener('mousemove', (ev) => {
        if (game.paused || game.scopeUi.guide) return; // 일시정지 중에는 조준선이 움직이지 않는다
        const p = sl(ev);
        TMM.ScopeView.setReticle(game, scopeCanvas, p.x, p.y);
      });
      scopeCanvas.addEventListener('mousedown', (ev) => {
        if (ev.button === 0) actions.scopeFire();
        else if (ev.button === 2) actions.scopeLase();
      });
      scopeCanvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
      scopeCanvas.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        actions.scopeZoom(ev.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      // 화면 밖으로 나가면 포탑이 계속 돌지 않게 조준선을 가장자리 안쪽으로
      scopeCanvas.addEventListener('mouseleave', () => {
        const s = game.scope, e = 0.5 - TMM.SCOPE.EDGE - 0.01, v = s.aspect / 2 - TMM.SCOPE.EDGE * s.aspect - 0.01;
        s.rx = Math.max(-e, Math.min(e, s.rx));
        s.ry = Math.max(-v, Math.min(v, s.ry));
      });
    }

    // 조준 화면 키: 포탑 돌리기 (누르고 있는 동안)
    const held = new Set();
    const PAN_KEYS = { KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0], KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1] };
    function updateHeld() {
      let pan = 0, tilt = 0;
      for (const k of held) { pan += PAN_KEYS[k][0]; tilt += PAN_KEYS[k][1]; }
      actions.scopeKeys(Math.sign(pan), Math.sign(tilt));
    }

    function scopeKey(ev, digit) {
      if (game.scopeUi.guide) {
        actions.dismissGuide();
        return;
      }
      if (PAN_KEYS[ev.code]) {
        ev.preventDefault();
        held.add(ev.code);
        updateHeld();
        return;
      }
      if (ev.code === 'Escape') return actions.toggleScope();
      if (ev.code === 'KeyL') return actions.scopeLase();
      if (ev.code === 'KeyQ') return actions.cycleAmmo();
      if (ev.code === 'KeyZ') return actions.scopeZoom(null);
      if (digit === '8') return actions.setRoe('hold');
      if (digit === '9') return actions.setRoe('id');
      if (digit === '0') return actions.setRoe('free');
      if (ev.code === 'KeyR') return actions.pickOrder('report');
      if (digit && '1234'.includes(digit)) return actions.select(Number(digit)); // 정보 창만 바뀜
      if (digit || ['KeyM', 'KeyC', 'KeyB', 'KeyT', 'KeyX', 'KeyV', 'KeyK'].includes(ev.code)) actions.scopeBlocked();
    }

    window.addEventListener('keydown', (ev) => {
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
      if (ev.code === 'Tab') {
        // M6: 지도 ↔ 조준 화면
        ev.preventDefault();
        if (!ev.repeat && !ev.ctrlKey && !ev.altKey && !ev.metaKey) actions.toggleScope();
        return;
      }
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (!ev.repeat) actions.togglePause();
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const digit = /^(Digit|Numpad)[0-9]$/.test(ev.code) ? ev.code.slice(-1) : null;
      if (game.scope && game.scope.open) return scopeKey(ev, digit);
      if (digit && '1234'.includes(digit)) return actions.select(Number(digit));
      if (digit === '5') return actions.setTo('T1');
      if (digit === '6') return actions.setTo('T2');
      if (digit === '7') return actions.setTo('ALL');
      if (digit === '8') return actions.setRoe('hold');
      if (digit === '9') return actions.setRoe('id');
      if (digit === '0') return actions.setRoe('free');
      const ORDER_KEYS = { KeyM: 'move', KeyC: 'cover', KeyB: 'bound', KeyT: 'target', KeyW: 'withdraw', KeyS: 'stop', KeyR: 'report', KeyK: 'support' };
      if (ORDER_KEYS[ev.code]) return actions.pickOrder(ORDER_KEYS[ev.code]);
      if (ev.code === 'KeyQ') return actions.cycleAmmo();
      if (ev.code === 'KeyX') return actions.clearTarget();
      if (ev.code === 'KeyV') return actions.toggleSight();
      if (ev.code === 'Escape') actions.cancel();
    });

    // 버튼에 포커스가 있을 때 스페이스바가 버튼을 누르지 않게
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') ev.preventDefault();
      if (held.delete(ev.code)) updateHeld();
    });
    window.addEventListener('blur', () => { held.clear(); updateHeld(); });

    document.querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => actions.setSpeed(Number(btn.dataset.speed)));
    });
  }

  return { init };
})();
