/*
 * M7.5 우클릭 메뉴: 지도에서 오른쪽 클릭한 곳에 상황에 맞는 명령을 띄운다.
 *   땅 → 이동 / 엄호 / 철수 (+ 엄호 이동, 흑표 지원)
 *   적(표적) → 목표 지정 / 이쪽 엄호
 *   내 전차 → 정지 / 상황 보고 / 목표 해제 (+ 지휘 전차: 탄종 전환, 조준 화면)
 * 항목마다 단축키를 같이 보여 준다 (쓰다 보면 외워지게). 메뉴가 떠 있을 때 그 글자 키를 누르면 그 항목이 실행된다.
 * 항목: { label, key, desc, run(), disabled, why, danger, sep }
 * 메뉴의 내용은 main.js(actions.openMenu)가 만든다. 이 파일은 그리기와 닫기만.
 */
TMM.ContextMenu = (function () {
  let el = null;
  let items = [];
  let onHover = null;
  let outsideAt = -1; // 메뉴 밖을 눌러 닫은 시각 — 그 클릭이 지도 명령으로 이어지지 않게
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function init(opts) {
    el = document.getElementById('ctx-menu');
    onHover = (opts && opts.onHover) || null;
    // 메뉴 밖을 누르면 닫는다
    document.addEventListener('mousedown', (ev) => {
      if (isOpen() && !el.contains(ev.target)) { outsideAt = performance.now(); close(); }
    }, true);
    window.addEventListener('blur', close);
  }

  function isOpen() {
    return !!(el && !el.hidden);
  }

  // x, y: .map-wrap 안의 화면 좌표 / head: { title, sub }
  function open(x, y, head, list) {
    if (!el) return;
    items = list.filter(Boolean);
    let html = '<div class="cm-head"><b>' + esc(head.title) + '</b>' + (head.sub ? '<span>' + esc(head.sub) + '</span>' : '') + '</div>';
    items.forEach((it, i) => {
      if (it.sep) { html += '<div class="cm-sep" role="separator"></div>'; return; }
      html += '<button type="button" role="menuitem" class="cm-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '"' +
        (it.disabled ? ' aria-disabled="true"' : '') + ' title="' + esc(it.disabled && it.why ? it.why : it.desc || '') + '">' +
        '<span class="cm-l">' + esc(it.label) + '</span>' + (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : '') +
        '<span class="cm-d">' + esc(it.disabled && it.why ? it.why : it.desc || '') + '</span></button>';
    });
    el.innerHTML = html;
    el.hidden = false;
    el.querySelectorAll('.cm-item').forEach((b) => {
      const it = items[Number(b.dataset.i)];
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        run(it);
      });
      b.addEventListener('mouseenter', () => { if (onHover) onHover(it.label + (it.key ? ' ' + it.key : '') + ': ' + (it.disabled && it.why ? it.why : it.desc || '')); });
      b.addEventListener('mouseleave', () => { if (onHover) onHover(null); });
    });
    // 화면 밖으로 넘치지 않게
    const wrap = el.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, wrap.width - r.width - 4));
    const top = Math.max(4, Math.min(y, wrap.height - r.height - 4));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const first = el.querySelector('.cm-item:not([aria-disabled])');
    if (first) first.focus({ preventScroll: true });
  }

  function run(it) {
    if (!it || it.disabled) return;
    close();
    it.run();
  }

  function close() {
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    items = [];
    if (onHover) onHover(null);
  }

  // 메뉴가 떠 있을 때의 키: Esc 닫기, 항목의 단축키 글자 → 그 항목. 처리했으면 true.
  function handleKey(ev) {
    if (!isOpen()) return false;
    if (ev.code === 'Escape') { close(); return true; }
    if (ev.code === 'ArrowDown' || ev.code === 'ArrowUp') {
      const bs = Array.from(el.querySelectorAll('.cm-item:not([aria-disabled])'));
      if (!bs.length) return true;
      const i = bs.indexOf(document.activeElement);
      const n = ev.code === 'ArrowDown' ? (i + 1) % bs.length : (i - 1 + bs.length) % bs.length;
      bs[n].focus();
      return true;
    }
    if (ev.code === 'Enter' || ev.code === 'Space') return false; // 포커스된 버튼이 스스로 눌린다
    const k = ev.code.startsWith('Key') ? ev.code.slice(3) : ev.code === 'Tab' ? 'Tab' : null;
    if (!k) return false;
    const it = items.find((x) => !x.sep && x.key === k);
    if (!it) return false;
    run(it);
    return true;
  }

  // 방금 메뉴 밖을 눌러 닫았나 (그 클릭은 무시)
  function justClosed() {
    return performance.now() - outsideAt < 600;
  }

  return { init, open, close, isOpen, handleKey, justClosed };
})();
