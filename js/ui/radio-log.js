/*
 * 무전 기록 창. (M4 무전 지휘에서 확장 예정)
 * kind: 'order' 지시 | 'report' 보고 | 'warn' 경고 | 'system' 체계 | 'crew' 승무원 말 (M5) | 'trust-up'·'trust-down' 신뢰도 변화 (M5)
 */
TMM.RadioLog = (function () {
  let listEl = null;

  function init(el) {
    listEl = el;
  }

  function add(gameSeconds, from, text, kind) {
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

  return { init, add };
})();
