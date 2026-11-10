/*
 * M7.5 화면 정리: '간단 보기'(기본) ↔ '상세 보기', 접는 칸, 조작 요약 카드(F1 / ? 버튼).
 *   간단 보기: 오른쪽 창에 받는 대상·선택 요약·명령 버튼·무전 기록 최근 5줄만. 나머지 칸은 접힘.
 *              지도의 엄호 부채꼴도 고른 전차 것만.
 *   상세 보기: 모든 칸을 펼치고, 무전 기록은 승무원 잡담까지 전부, 엄호 부채꼴은 모든 전차.
 * 고른 보기는 이 브라우저에 기억한다(localStorage 'tmm.view'). 저장소를 못 써도 동작한다.
 */
TMM.Layout = (function () {
  const KEY = 'tmm.view';
  let detail = false;
  let game = null;
  let helpPaused = false; // 도움말을 열면서 멈췄으면 닫을 때 다시 진행
  const listeners = [];

  function load() {
    try { return localStorage.getItem(KEY) === 'detail'; } catch (e) { return false; }
  }
  function save() {
    try { localStorage.setItem(KEY, detail ? 'detail' : 'simple'); } catch (e) { /* 저장소 없음 */ }
  }

  function apply(openFolds) {
    const side = document.getElementById('side');
    if (!side) return;
    side.classList.toggle('simple', !detail);
    side.classList.toggle('detail', detail);
    side.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.view === 'detail') === detail ? 'true' : 'false'));
    if (openFolds) side.querySelectorAll('details.fold').forEach((d) => { d.open = detail; });
    if (game) game.viewDetail = detail;
    for (const fn of listeners) fn(detail);
  }

  function setDetail(on) {
    detail = !!on;
    save();
    apply(true);
  }

  function helpOpen() {
    const el = document.getElementById('help');
    return !!(el && !el.hidden);
  }
  function showHelp(on) {
    const el = document.getElementById('help');
    if (!el) return;
    if (on == null) on = el.hidden;
    el.hidden = !on;
    // 전투 중이면 카드를 보는 동안 잠깐 멈춘다 (닫으면 다시 진행)
    const g = TMM.game;
    if (on) {
      helpPaused = !!(g && g.started && !g.paused && !g.over);
      if (helpPaused) g.paused = true;
      document.getElementById('help-note').textContent = helpPaused ? '카드를 보는 동안 잠시 멈춥니다 · 닫으면 다시 진행' : '마우스만으로 다 됩니다 · 키는 몰라도 됩니다';
      const b = el.querySelector('[data-help-close]');
      if (b) b.focus();
    } else if (helpPaused) {
      helpPaused = false;
      if (g && g.paused && !g.over) g.paused = false;
    }
  }

  function init() {
    detail = load();
    const side = document.getElementById('side');
    if (side) {
      side.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setDetail(b.dataset.view === 'detail')));
      side.querySelectorAll('[data-help]').forEach((b) => b.addEventListener('click', () => showHelp(true)));
    }
    const help = document.getElementById('help');
    if (help) {
      help.addEventListener('click', (ev) => { if (ev.target === help) showHelp(false); });
      help.querySelector('[data-help-close]').addEventListener('click', () => showHelp(false));
    }
    // F1 · ? 는 전투 밖(캠페인 화면)에서도 열린다. Esc 로 닫기.
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'F1' || (ev.key === '?' && !(ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)))) {
        ev.preventDefault();
        showHelp();
        return;
      }
      if (helpOpen() && ev.code === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        showHelp(false);
      }
    }, true);
    apply(true);
  }

  // 전투가 시작될 때 (main.js boot)
  function attach(g) {
    game = g;
    g.viewDetail = detail;
  }

  return {
    init,
    attach,
    showHelp,
    helpOpen,
    isDetail: () => detail,
    onChange: (fn) => listeners.push(fn),
  };
})();
