/*
 * 무전 기록 창. (M4 무전 지휘에서 확장 예정)
 * kind: 'order' 지시 | 'report' 보고 | 'warn' 경고 | 'system' 체계 | 'crew' 승무원 말 (M5) | 'trust-up'·'trust-down' 신뢰도 변화 (M5)
 */
TMM.RadioLog = (function () {
  let listEl = null;
  const recentLines = []; // M6: 조준 화면에 짧게 흘려 보여 줄 최근 줄

  function init(el) {
    listEl = el;
  }

  function add(gameSeconds, from, text, kind) {
    recentLines.push({ at: gameSeconds, real: performance.now() / 1000, from, text, kind });
    if (recentLines.length > 12) recentLines.shift();
    if (!listEl) return;
    const li = document.createElement('li');
    li.className = 'log-' + (kind || 'report');
    const t = document.createElement('time');
    t.textContent = TMM.Clock.short(gameSeconds);
    const who = document.createElement('b');
    who.textContent = from;
    const msg = document.createElement('span');
    msg.textContent = text;
    li.append(t, who, msg);
    listEl.prepend(li);
    while (listEl.children.length > TMM.CONFIG.LOG_MAX) listEl.lastChild.remove();
  }

  // 최근 n 줄 (새 것이 먼저)
  function recent(n) {
    return recentLines.slice(-n).reverse();
  }

  return { init, add, recent };
})();
