/*
 * 마우스·키보드 입력.
 *   전차 클릭: 선택 / 지도 클릭: 선택 전차 이동 지시
 *   적 전차 클릭: 선택 전차의 사격 목표 지정
 *   스페이스바: 일시정지·재개 / 1~4: 호차 선택 / S: 정지 / Esc: 선택 해제
 *   Q: 탄종 전환 / X: 사격 목표 해제
 */
TMM.Input = (function () {
  function init(game, canvas, view, actions) {
    function local(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    canvas.addEventListener('mousemove', (ev) => {
      const p = local(ev);
      const m = view.toMap(p.x, p.y);
      game.hover = game.map.typeAt(m.x, m.y) >= 0 ? m : null;
      const overUnit = TMM.Renderer.hitUnit(view, game.units, p.x, p.y);
      const overEnemy = overUnit ? null : TMM.Renderer.hitUnit(view, game.enemies, p.x, p.y);
      game.hoverEnemyId = overEnemy ? overEnemy.id : null;
      let cursor = 'default';
      if (overUnit) cursor = 'pointer';
      else if (overEnemy) cursor = game.selectedId && !overEnemy.destroyed ? 'crosshair' : 'help';
      else if (game.selectedId && game.hover) {
        cursor = game.map.infoAt(m.x, m.y).speed ? 'crosshair' : 'not-allowed';
      }
      canvas.style.cursor = cursor;
    });

    canvas.addEventListener('mouseleave', () => {
      game.hover = null;
      game.hoverEnemyId = null;
    });

    canvas.addEventListener('click', (ev) => {
      const p = local(ev);
      const hit = TMM.Renderer.hitUnit(view, game.units, p.x, p.y);
      if (hit) {
        actions.select(hit.id);
        return;
      }
      const foe = TMM.Renderer.hitUnit(view, game.enemies, p.x, p.y);
      if (foe) {
        if (game.selectedId) actions.target(game.selectedId, foe.id);
        return;
      }
      if (!game.selectedId) return;
      const m = view.toMap(p.x, p.y);
      if (game.map.typeAt(m.x, m.y) < 0) return;
      actions.move(game.selectedId, m.x, m.y);
    });

    // 오른쪽 클릭: 선택 해제
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      actions.select(null);
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (!ev.repeat) actions.togglePause();
        return;
      }
      if (/^Digit[1-4]$/.test(ev.code) || /^Numpad[1-4]$/.test(ev.code)) {
        actions.select(Number(ev.code.slice(-1)));
        return;
      }
      if (ev.code === 'KeyS' && game.selectedId) {
        actions.stop(game.selectedId);
        return;
      }
      if (ev.code === 'KeyQ' && game.selectedId) {
        actions.cycleAmmo(game.selectedId);
        return;
      }
      if (ev.code === 'KeyX' && game.selectedId) {
        actions.clearTarget(game.selectedId);
        return;
      }
      if (ev.code === 'Escape') actions.select(null);
    });

    // 버튼에 포커스가 있을 때 스페이스바가 버튼을 누르지 않게
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') ev.preventDefault();
    });

    document.querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => actions.setSpeed(Number(btn.dataset.speed)));
    });
  }

  return { init };
})();
