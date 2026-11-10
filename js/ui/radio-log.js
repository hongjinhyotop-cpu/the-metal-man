/*
 * 무전 기록 창.
 * kind: 'order' 지시 | 'report' 보고 | 'warn' 경고 | 'system' 체계 | 'crew' 승무원 말 (M5) | 'trust-up'·'trust-down' 신뢰도 변화 (M5)
 *       'fire' 사격 | 'kill' 격파 | 'loss' 아군 손실 | 'ff' 오인사격 | 'garble' 잡음
 * M7.5: 간단 보기에서는 최근 SIMPLE_N(5)줄만, 승무원 잡담(crew)은 빼고 보여 준다. '전체 보기' 단추나 상세 보기면 전부.
 *       중요한 줄(피격·격파·손실·오인사격·경고)은 왼쪽 색 막대로 강조한다.
 */
TMM.RadioLog = (function () {
  let listEl = null;
  let full = false; // 전체 보기 (상세 보기이거나 '전체 보기' 단추)
  let moreBtn = null;
  let localFull = false;
  const SIMPLE_N = 5;
  const IMPORTANT = { warn: 1, kill: 1, loss: 1, ff: 1 };
  const recentLines = []; // M6: 조준 화면에 짧게 흘려 보여 줄 최근 줄

  function init(el) {
    listEl = el;
    moreBtn = document.querySelector('[data-log-more]');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        localFull = !localFull;
        refresh();
      });
    }
    if (TMM.Layout) {
      TMM.Layout.onChange(() => { localFull = false; refresh(); });
    }
    refresh();
  }

  function refresh() {
    full = localFull || (TMM.Layout && TMM.Layout.isDetail());
    if (moreBtn) {
      moreBtn.textContent = localFull ? '최근 5줄만' : '전체 보기';
      moreBtn.hidden = !!(TMM.Layout && TMM.Layout.isDetail());
    }
    if (!listEl) return;
    listEl.classList.toggle('full', full);
    let shown = 0;
    for (const li of listEl.children) {
      const chatter = li.classList.contains('log-crew');
      const show = full || (!chatter && shown < SIMPLE_N);
      li.hidden = !show;
      if (show) shown += 1;
    }
  }

  function add(gameSeconds, from, text, kind) {
    recentLines.push({ at: gameSeconds, real: performance.now() / 1000, from, text, kind });
    if (recentLines.length > 12) recentLines.shift();
    if (!listEl) return;
    const li = document.createElement('li');
    li.className = 'log-' + (kind || 'report') + (IMPORTANT[kind] ? ' imp' : '');
    const t = document.createElement('time');
    t.textContent = TMM.Clock.short(gameSeconds);
    const who = document.createElement('b');
    who.textContent = from;
    const msg = document.createElement('span');
    msg.textContent = text;
    li.append(t, who, msg);
    listEl.prepend(li);
    while (listEl.children.length > TMM.CONFIG.LOG_MAX) listEl.lastChild.remove();
    refresh();
  }

  // 최근 n 줄 (새 것이 먼저)
  function recent(n) {
    return recentLines.slice(-n).reverse();
  }

  return { init, add, recent, refresh };
})();
