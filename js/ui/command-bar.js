/*
 * 무전 지휘 창 (M4 → M7.5 정리): 받는 대상 · 선택 요약 · 명령 · 사격 통제 버튼, 송신 대기열,
 * 그리고 지도 아래 '지금 클릭하면 무슨 일이 생기는지' 안내 한 줄(#guide).
 * 버튼과 단축키·우클릭 메뉴는 같은 행동(main.js 의 actions)을 부른다.
 *   받는 대상: [1조] [2조] [소대 전체] 큰 버튼 + 호차 버튼 4개 (지도의 전차 아이콘을 클릭해도 된다)
 *   명령 버튼: 아이콘 + 한글 이름 + 단축키. 마우스를 올리면 한 줄 설명(안내 줄에도 나온다).
 */
TMM.CommandBar = (function () {
  const els = {};
  const cache = new Map();
  let tip = null; // 마우스를 올린 버튼·메뉴 항목의 설명 (안내 줄에 우선 표시)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function set(el, key, value, html) {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  // 16×16 선 아이콘 (currentColor)
  const ICON = {
    move: '<path d="M2 8h10M8 4l4 4-4 4"/>',
    cover: '<path d="M8 13L3 4a7 7 0 0 1 10 0z"/><circle cx="8" cy="13" r="1.3"/>',
    bound: '<path d="M2 12l4-4-4-4M8 12l4-4-4-4"/>',
    target: '<circle cx="8" cy="8" r="5"/><path d="M8 1v4M8 11v4M1 8h4M11 8h4"/>',
    withdraw: '<path d="M14 8H4M8 4L4 8l4 4"/>',
    stop: '<rect x="3.5" y="3.5" width="9" height="9"/>',
    report: '<path d="M3 3h10v7H7l-3 3v-3H3z"/>',
    support: '<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/>',
    scope: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.2"/><path d="M8 2v3M8 11v3M2 8h3M11 8h3"/>',
    ammo: '<path d="M6 14V6l2-4 2 4v8z"/><path d="M6 10h4"/>',
  };
  const icon = (k) => '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">' + (ICON[k] || '') + '</svg>';

  const TEAMS = [
    { to: 'T1', label: '1조', sub: '1·2호차', key: '5' },
    { to: 'T2', label: '2조', sub: '3·4호차', key: '6' },
    { to: 'ALL', label: '소대 전체', sub: '4대', key: '7' },
  ];
  const TANKS = ['1', '2', '3', '4'];

  // desc: 마우스를 올리면 나오는 한 줄 설명 · hint: 버튼을 누른 뒤 지도 클릭을 기다릴 때의 안내
  const ORDERS = [
    { id: 'move', label: '이동', key: 'M', desc: '고른 곳으로 이동합니다', hint: '갈 곳을 지도에서 클릭' },
    { id: 'cover', label: '엄호', key: 'C', desc: '그 방향을 지켜보며 멈춥니다 (차체도 그쪽으로)', hint: '지켜볼 방향(지점)을 클릭' },
    { id: 'withdraw', label: '철수', key: 'W', desc: '정면을 적에 둔 채 후진해 물러납니다', hint: '물러날 곳을 클릭' },
    { id: 'target', label: '목표 지정', key: 'T', desc: '쏠 표적을 정해 줍니다', hint: '쏠 표적을 클릭 (빈 곳은 해제)' },
    { id: 'stop', label: '정지', key: 'S', desc: '그 자리에 멈춥니다' },
    { id: 'report', label: '상황 보고', key: 'R', desc: '탄약·손상·보이는 적을 무전으로 보고받습니다' },
    { id: 'bound', label: '엄호 이동', key: 'B', desc: '소대 전체가 조별로 번갈아 엄호하며 전진합니다', hint: '전진할 목표 지점을 클릭 (소대 전체)' },
    // M7b: 이웃 K2 중대(흑표) 지원 요청 — 작전마다 한 번
    { id: 'support', label: '흑표 지원', key: 'K', desc: '이웃 K2 중대에 지원을 요청합니다 (작전마다 1번, 거절될 수 있음)', hint: '흑표가 지켜 줄 방향(지점)을 클릭' },
  ];

  const ROE_KEYS = { hold: '8', id: '9', free: '0' };

  const ORDER_NAME = { support: '흑표 지원 요청', move: '이동', cover: '엄호', bound: '엄호 이동', target: '목표 지정', withdraw: '철수', stop: '정지', report: '상황 보고', roe: '사격 통제' };

  function btnTip(el, text) {
    el.title = text;
    el.addEventListener('mouseenter', () => { tip = text; });
    el.addEventListener('mouseleave', () => { tip = null; });
    el.addEventListener('focus', () => { tip = text; });
    el.addEventListener('blur', () => { tip = null; });
  }

  function init(game, actions) {
    const root = document.getElementById('cmd');
    let html = '<div class="cmd-k">누구에게 <span class="cmd-kh">지도의 전차 아이콘을 클릭해도 됩니다</span></div>';
    html += '<div class="cmd-teams" role="group" aria-label="받는 대상: 조">';
    for (const t of TEAMS) html += '<button type="button" data-to="' + t.to + '"><b>' + t.label + '</b><span class="t-s">' + t.sub + '</span><kbd>' + t.key + '</kbd></button>';
    html += '</div><div class="cmd-to" role="group" aria-label="받는 대상: 전차">';
    for (const id of TANKS) html += '<button type="button" data-to="' + id + '"><span class="t-l">' + id + '호차<i class="dot"></i></span><span class="t-s">무전</span></button>';
    html += '</div>';
    html += '<ul class="cmd-sum" id="cmd-sum" aria-label="고른 전차 요약"></ul>';
    html += '<div class="cmd-k">명령 <span class="cmd-kh">또는 지도를 우클릭</span></div><div class="cmd-orders" role="group" aria-label="명령">';
    for (const o of ORDERS) html += '<button type="button" data-order="' + o.id + '">' + icon(o.id) + '<span class="o-l">' + o.label + '</span><kbd>' + o.key + '</kbd></button>';
    html += '</div><div class="cmd-k">사격 통제</div><div class="cmd-roe" role="group" aria-label="사격 통제">';
    for (const k of TMM.RADIO.ROE_ORDER) {
      const r = TMM.RADIO.ROE[k];
      html += '<button type="button" data-roe="' + k + '"><span class="o-l">' + r.name + '</span><kbd>' + ROE_KEYS[k] + '</kbd></button>';
    }
    html += '</div><div class="cmd-k">1호차 직접</div><div class="cmd-self" role="group" aria-label="1호차 직접">' +
      '<button type="button" data-act="scope">' + icon('scope') + '<span class="o-l">조준 화면</span><kbd>Tab</kbd></button>' +
      '<button type="button" data-act="ammo">' + icon('ammo') + '<span class="o-l">탄종 전환</span><kbd>Q</kbd></button>' +
      '</div><ul class="cmd-queue" id="cmd-queue"></ul>';
    root.innerHTML = html;

    els.to = {};
    root.querySelectorAll('[data-to]').forEach((b) => {
      els.to[b.dataset.to] = b;
      b.addEventListener('click', () => actions.setTo(b.dataset.to));
      const t = TEAMS.find((x) => x.to === b.dataset.to);
      if (t) btnTip(b, t.label + ' ' + t.key + ': ' + t.sub + '에게 명령합니다');
      else btnTip(b, b.dataset.to + '호차 ' + b.dataset.to + ': 이 전차를 고릅니다');
    });
    els.orders = {};
    root.querySelectorAll('[data-order]').forEach((b) => {
      const o = ORDERS.find((x) => x.id === b.dataset.order);
      els.orders[o.id] = b;
      b.addEventListener('click', () => actions.pickOrder(o.id));
      btnTip(b, o.label + ' ' + o.key + ': ' + o.desc);
    });
    els.roe = {};
    root.querySelectorAll('[data-roe]').forEach((b) => {
      const r = TMM.RADIO.ROE[b.dataset.roe];
      els.roe[b.dataset.roe] = b;
      b.addEventListener('click', () => actions.setRoe(b.dataset.roe));
      btnTip(b, r.name + ' ' + ROE_KEYS[b.dataset.roe] + ': ' + r.desc);
    });
    const sb = root.querySelector('[data-act="scope"]');
    sb.addEventListener('click', () => actions.toggleScope());
    btnTip(sb, '조준 화면 Tab: 1호차 조준경으로 직접 쏩니다 (그동안 무전 지휘 불가)');
    const ab = root.querySelector('[data-act="ammo"]');
    ab.addEventListener('click', () => actions.cycleAmmo());
    btnTip(ab, '탄종 전환 Q: 1호차의 철갑탄 ↔ 고폭탄을 바꿉니다');
    els.self = { scope: sb, ammo: ab };
    els.sum = document.getElementById('cmd-sum');
    els.sum.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-unit]');
      if (b) actions.select(Number(b.dataset.unit));
    });
    els.queue = document.getElementById('cmd-queue');
    els.guide = document.getElementById('guide');
  }

  const STATE_TEXT = {
    queued: '송신 대기',
    tx: '송신 중',
    garble: '잡음 — 다시 보냄',
    noack: '응답 기다림',
    ack: '복창 기다림',
    exec: '실행 준비',
  };

  // 선택 요약 한 줄: 호차 · 상태(아이콘) · 남은 탄 (+ 손상·교신 문제는 있을 때만)
  function stateIcon(game, u) {
    if (u.destroyed) return ['×', '격파', 'st-dead'];
    if (u.stall > 0) return ['▲', '정비 조치', 'st-warn'];
    if (u.fire && u.fire.targetId != null) return ['●', '교전', 'st-fire'];
    if (u.state === 'moving') return ['▶', u.reverseM > 0 ? '후진' : '이동', 'st-move'];
    if (u.watch != null) return ['◎', '엄호', 'st-cover'];
    return ['■', '정지', 'st-idle'];
  }
  function sumRow(game, u, ctrl) {
    const [ic, word, cls] = stateIcon(game, u);
    const total = TMM.Damage.totalAmmo(u);
    const cond = TMM.Damage.condition(u);
    const ls = TMM.Radio.linkState(game, u);
    const pend = TMM.Radio.pendingFor(game, u.id).length;
    let extra = '';
    if (!u.destroyed && cond.cls !== 'cond-ok') extra += '<span class="cond ' + cond.cls + '">' + esc(cond.text) + '</span>';
    if (!u.destroyed && u !== ctrl && ls.code === 'dead') extra += '<span class="s-bad">무전✕</span>';
    if (!u.destroyed && pend) extra += '<span class="s-pend">((·))</span>';
    return '<li><button type="button" class="sum-row team-' + u.team + (u.id === game.selectedId ? ' sel' : '') + (u.destroyed ? ' dead' : '') + '" data-unit="' + u.id + '" title="' + esc(u.callsign + ' — ' + TMM.Orders.describe(game, u)) + '">' +
      '<span class="s-n">' + u.id + '</span><b>' + esc(u.callsign) + (u === ctrl ? '<span class="s-me">직접</span>' : '') + '</b>' +
      '<span class="s-st ' + cls + '">' + ic + ' ' + word + '</span>' +
      '<span class="s-am mono' + (total <= 5 && !u.destroyed ? ' low' : '') + '">탄 ' + total + '</span>' + extra + '</button></li>';
  }

  // 지도 아래 안내 한 줄: 지금 클릭하면 무슨 일이 생기는지
  function guideText(game) {
    const cmd = game.cmd;
    const name = TMM.Command.specName(game, cmd.to);
    const units = TMM.Command.recipients(game, cmd.to);
    const ctrl = TMM.Radio.controlUnit(game);
    const direct = units.length === 1 && units[0] === ctrl;
    if (game.over) return ['작전 종료', ''];
    if (game.scope && game.scope.open) return ['조준 화면', '좌클릭 발사 · 우클릭 레이저 거리 · 휠 배율 · 가장자리로 포탑 회전 · [◀ 지도로] 또는 Tab 으로 돌아가기'];
    if (TMM.ContextMenu.isOpen()) return [tip || '메뉴에서 명령을 고르십시오', tip ? '' : '바깥을 클릭하거나 Esc 로 닫기'];
    if (tip) return [tip, ''];
    if (cmd.mode === 'support') return ['▶ 흑표 지원', '흑표가 지켜 줄 방향(지점)을 지도에서 클릭 · 우클릭/Esc 취소'];
    if (cmd.mode) {
      const o = ORDERS.find((x) => x.id === cmd.mode);
      const who = cmd.mode === 'bound' ? '소대 전체' : name;
      return ['▶ ' + who + ' · ' + ORDER_NAME[cmd.mode], (o && o.hint ? o.hint : '') + ' · 우클릭/Esc 취소'];
    }
    if (game.hoverUnitId != null) {
      const u = game.units.find((x) => x.id === game.hoverUnitId);
      if (u) return ['클릭: ' + u.callsign + ' 고르기', u.destroyed ? '격파됨' : '우클릭: 정지 · 상황 보고 메뉴'];
    }
    if (game.hoverContactId != null) {
      const c = TMM.Intel.contact(game, 'friend', game.hoverContactId);
      if (c && c.known) {
        const nm = TMM.Intel.displayName(c);
        if (c.wreck) return [nm + ' — 격파됨', ''];
        if (c.identified && c.kind === 'friendly') return [nm + ' — 아군입니다', '사격할 수 없습니다'];
        if (!c.identified) return ['⚠ ' + nm + ' — 아직 식별 안 됨 (아군일 수 있음)', '클릭/우클릭하면 ' + name + '에게 목표 지정 · 오인사격 위험'];
        return ['클릭: ' + name + '에게 목표 지정 (' + nm + ')', '우클릭: 메뉴'];
      }
    }
    if (!units.length) return [name + ' — 명령을 받을 전차가 없습니다', '다른 전차나 조를 고르십시오'];
    if (game.selectedId == null) return ['전차를 고르십시오', '지도의 전차 아이콘 클릭 또는 오른쪽 [1조] [2조] [소대 전체] · 지금은 ' + name + '에게 명령이 갑니다'];
    const pause = game.paused && !game.started ? ' · 작전 대기 중 — 미리 명령해 둘 수 있습니다' : '';
    if (direct) return [name + ' 선택됨', '지도 클릭 = 바로 이동 · 지도를 우클릭 = 명령 메뉴 · 적을 클릭 = 목표 지정' + pause];
    return [name + ' 선택됨', '지도를 우클릭해 명령 (무전, 몇 초 걸림) · 적을 클릭 = 목표 지정' + pause];
  }

  function update(game) {
    const cmd = game.cmd;
    // M6: 조준 화면에 있는 동안 무전 명령 불가 (사격 통제·상황 보고만)
    const scoped = !!(game.scope && game.scope.open);
    if (cache.get('scoped') !== scoped) {
      cache.set('scoped', scoped);
      document.querySelector('.cmd-card').classList.toggle('scoped', scoped);
      els.self.scope.querySelector('.o-l').textContent = scoped ? '지도로' : '조준 화면';
    }
    const ctrl = TMM.Radio.controlUnit(game);
    const units = TMM.Command.recipients(game, cmd.to);
    for (const t of TEAMS) {
      const on = cmd.to === t.to;
      if (cache.get('to' + t.to) !== on) {
        cache.set('to' + t.to, on);
        els.to[t.to].classList.toggle('on', on);
        els.to[t.to].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    for (const id of TANKS) {
      const b = els.to[id];
      const on = cmd.to === id;
      const u = game.units.find((x) => String(x.id) === id);
      const inGroup = !on && u && units.includes(u);
      let dot = '';
      if (u) dot = TMM.Radio.linkState(game, u).code;
      const key = (on ? '1' : inGroup ? 'g' : '0') + dot + (u && u === ctrl ? 'c' : '') + (u && u.destroyed ? 'd' : '') + (u ? '' : 'x');
      if (cache.get('to' + id) !== key) {
        cache.set('to' + id, key);
        b.classList.toggle('on', on);
        b.classList.toggle('grp', !!inGroup);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        const absent = !u; // M7a: 앞 작전에서 격파되어 이번 작전에 없는 전차
        b.classList.toggle('dead', !!(u && u.destroyed) || absent);
        b.querySelector('.dot').className = 'dot ' + dot;
        if (u) {
          const ls = TMM.Radio.linkState(game, u);
          b.title = u.callsign + ' ' + id + ': 이 전차를 고릅니다 — 교신: ' + ls.text;
          b.querySelector('.t-s').textContent = u.destroyed ? '격파' : u === ctrl ? '직접' : dot === 'dead' ? '두절' : '무전';
        } else b.querySelector('.t-s').textContent = '불참';
      }
    }
    for (const o of ORDERS) {
      const on = cmd.mode === o.id;
      if (cache.get('o' + o.id) !== on) {
        cache.set('o' + o.id, on);
        els.orders[o.id].classList.toggle('on', on);
      }
    }
    // M7b: 흑표 지원 버튼 — 상태 (작전마다 1번·응답 기다림·도착 몇 분 전·엄호 중·거절됨). 훈련 모드엔 없음.
    const sup = els.orders.support;
    if (game.support && sup) {
      const st = TMM.Support.status(game);
      if (cache.get('sup') !== st) {
        cache.set('sup', st);
        sup.title = '흑표 지원 K: 이웃 K2 중대 지원 요청 — ' + st;
        sup.classList.toggle('used', game.support.state !== 'ready');
      }
    }
    // 받는 전차들의 사격 통제가 모두 같으면 그 단계를 표시
    const roes = new Set(units.map((u) => u.roe));
    const cur = roes.size === 1 ? Array.from(roes)[0] : null;
    for (const k of TMM.RADIO.ROE_ORDER) {
      const on = cur === k;
      if (cache.get('r' + k) !== on) {
        cache.set('r' + k, on);
        els.roe[k].classList.toggle('on', on);
      }
    }

    // 선택 요약 (받는 대상 전차마다 한 줄)
    const rows = units.length ? units.map((u) => sumRow(game, u, ctrl)).join('') : '<li class="sum-none">' + esc(TMM.Command.specName(game, cmd.to)) + ' — 명령을 받을 전차가 없습니다</li>';
    set(els.sum, 'sum', rows, true);

    // 지도 아래 안내 한 줄
    const g = guideText(game);
    set(els.guide, 'guide', '<b>' + esc(g[0]) + '</b>' + (g[1] ? '<span>' + esc(g[1]) + '</span>' : ''), true);

    // 송신 대기열
    const q = [];
    for (const p of game.radio.pending.values()) {
      const u = game.units.find((x) => x.id === p.unitId);
      if (!u) continue;
      const what = p.order.type === 'roe' ? TMM.RADIO.ROE[p.order.roe].name : ORDER_NAME[p.order.type] || p.order.type;
      q.push('<li class="q-' + p.state + '"><b>' + esc(TMM.RADIO.call(u)) + '</b><span>' + esc(what) + '</span><span class="q-st">' + esc(STATE_TEXT[p.state] || p.state) + '</span></li>');
    }
    const busy = game.radio.busyUntil > game.gameSeconds;
    const waiting = game.radio.queue.length;
    let head = '';
    if (busy || waiting) head = '<li class="q-head">무전망 ' + (busy ? '통화 중' : '대기') + (waiting ? ' · 대기 ' + waiting + '건' : '') + (game.paused ? ' · 일시정지 중엔 송신 대기' : '') + '</li>';
    set(els.queue, 'queue', head + q.join(''), true);
  }

  return { init, update, ORDERS, setTip: (t) => { tip = t; } };
})();
