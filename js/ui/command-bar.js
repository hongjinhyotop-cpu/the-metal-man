/*
 * 무전 지휘 창 (M4): 받는 대상 · 명령 · 사격 통제 버튼, 지도 클릭 안내, 송신 대기열.
 * 버튼과 단축키는 같은 행동(main.js 의 actions)을 부른다.
 */
TMM.CommandBar = (function () {
  const els = {};
  const cache = new Map();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function set(el, key, value, html) {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  const TO = [
    { to: '1', label: '1호차', sub: '직접' },
    { to: '2', label: '2호차', sub: '무전' },
    { to: '3', label: '3호차', sub: '무전' },
    { to: '4', label: '4호차', sub: '무전' },
    { to: 'T1', label: '1조', sub: '1·2호차', key: '5' },
    { to: 'T2', label: '2조', sub: '3·4호차', key: '6' },
    { to: 'ALL', label: '소대', sub: '전체', key: '7' },
  ];

  const ORDERS = [
    { id: 'move', label: '이동', key: 'M', hint: '지도에서 이동할 위치를 클릭하십시오.' },
    { id: 'cover', label: '엄호', key: 'C', hint: '지켜볼 방향(지점)을 지도에서 클릭하십시오. 그 자리에 멈춰 차체를 그쪽으로 돌립니다.' },
    { id: 'bound', label: '엄호 이동', key: 'B', hint: '전진할 목표 지점을 클릭하십시오. 소대 전체가 한 조씩 번갈아 엄호하며 나아갑니다.' },
    { id: 'target', label: '목표 지정', key: 'T', hint: '쏠 표적을 클릭하십시오. 빈 곳을 클릭하면 지정 목표 해제.' },
    { id: 'withdraw', label: '철수', key: 'W', hint: '물러날 위치를 클릭하십시오. 처음 400m 는 정면을 적에게 둔 채 후진합니다.' },
    { id: 'stop', label: '정지', key: 'S' },
    { id: 'report', label: '상황 보고', key: 'R' },
  ];

  const ROE_KEYS = { hold: '8', id: '9', free: '0' };

  function init(game, actions) {
    const root = document.getElementById('cmd');
    let html = '<div class="cmd-k">받는 대상</div><div class="cmd-to" role="group" aria-label="받는 대상">';
    for (const t of TO) {
      html += '<button type="button" data-to="' + t.to + '" title="단축키 ' + (t.key || t.to) + '">' +
        '<span class="t-l">' + t.label + '<i class="dot"></i></span><span class="t-s">' + t.sub + '</span></button>';
    }
    html += '</div><div class="cmd-k">명령</div><div class="cmd-orders" role="group" aria-label="명령">';
    for (const o of ORDERS) html += '<button type="button" data-order="' + o.id + '">' + o.label + '<kbd>' + o.key + '</kbd></button>';
    html += '</div><div class="cmd-k">사격 통제</div><div class="cmd-roe" role="group" aria-label="사격 통제">';
    for (const k of TMM.RADIO.ROE_ORDER) {
      const r = TMM.RADIO.ROE[k];
      html += '<button type="button" data-roe="' + k + '" title="' + esc(r.desc) + '">' + r.name + '<kbd>' + ROE_KEYS[k] + '</kbd></button>';
    }
    html += '</div><p class="cmd-hint" id="cmd-hint"></p><ul class="cmd-queue" id="cmd-queue"></ul>';
    root.innerHTML = html;

    els.to = {};
    root.querySelectorAll('[data-to]').forEach((b) => {
      els.to[b.dataset.to] = b;
      b.addEventListener('click', () => actions.setTo(b.dataset.to));
    });
    els.orders = {};
    root.querySelectorAll('[data-order]').forEach((b) => {
      els.orders[b.dataset.order] = b;
      b.addEventListener('click', () => actions.pickOrder(b.dataset.order));
    });
    els.roe = {};
    root.querySelectorAll('[data-roe]').forEach((b) => {
      els.roe[b.dataset.roe] = b;
      b.addEventListener('click', () => actions.setRoe(b.dataset.roe));
    });
    els.hint = document.getElementById('cmd-hint');
    els.queue = document.getElementById('cmd-queue');
  }

  function orderHint(id) {
    const o = ORDERS.find((x) => x.id === id);
    return o ? o.hint : '';
  }

  const STATE_TEXT = {
    queued: '송신 대기',
    tx: '송신 중',
    garble: '잡음 — 다시 보냄',
    noack: '응답 기다림',
    ack: '복창 기다림',
    exec: '실행 준비',
  };

  const ORDER_NAME = { move: '이동', cover: '엄호', bound: '엄호 이동', target: '목표 지정', withdraw: '철수', stop: '정지', report: '상황 보고', roe: '사격 통제' };

  function update(game) {
    const cmd = game.cmd;
    const ctrl = TMM.Radio.controlUnit(game);
    for (const t of TO) {
      const b = els.to[t.to];
      const on = cmd.to === t.to;
      const u = game.units.find((x) => String(x.id) === t.to);
      let dot = '';
      if (u) {
        const ls = TMM.Radio.linkState(game, u);
        dot = ls.code;
        b.title = u.callsign + ' — 교신: ' + ls.text;
      }
      const key = (on ? '1' : '0') + dot + (u && u === ctrl ? 'c' : '') + (u && u.destroyed ? 'd' : '');
      if (cache.get('to' + t.to) !== key) {
        cache.set('to' + t.to, key);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('dead', !!(u && u.destroyed));
        const d = b.querySelector('.dot');
        d.className = 'dot ' + dot;
        if (u) b.querySelector('.t-s').textContent = u.destroyed ? '격파' : u === ctrl ? '직접' : dot === 'dead' ? '두절' : '무전';
      }
    }
    for (const o of ORDERS) {
      const on = cmd.mode === o.id;
      if (cache.get('o' + o.id) !== on) {
        cache.set('o' + o.id, on);
        els.orders[o.id].classList.toggle('on', on);
      }
    }
    // 받는 전차들의 사격 통제가 모두 같으면 그 단계를 표시
    const units = TMM.Command.recipients(game, cmd.to);
    const roes = new Set(units.map((u) => u.roe));
    const cur = roes.size === 1 ? Array.from(roes)[0] : null;
    for (const k of TMM.RADIO.ROE_ORDER) {
      const on = cur === k;
      if (cache.get('r' + k) !== on) {
        cache.set('r' + k, on);
        els.roe[k].classList.toggle('on', on);
      }
    }

    let hint;
    const name = TMM.Command.specName(game, cmd.to);
    const viaRadio = units.some((u) => u !== ctrl);
    if (cmd.mode) hint = '▶ ' + name + ' · ' + ORDER_NAME[cmd.mode] + ' — ' + orderHint(cmd.mode) + ' (Esc 취소)';
    else if (!units.length) hint = name + ' — 명령을 받을 전차가 없습니다.';
    else if (viaRadio) hint = name + '에게 무전으로 명령합니다. 몇 초 뒤 도착하고 "수신" 응답 뒤 실행합니다.' + (game.paused ? ' 일시정지 중에는 송신 대기 — 재개하면 전달 시작.' : '');
    else hint = name + '(지휘 전차)는 바로 움직입니다. 지도를 클릭하면 이동, 표적을 클릭하면 사격 목표.';
    set(els.hint, 'hint', hint);

    // 송신 대기열
    const rows = [];
    for (const p of game.radio.pending.values()) {
      const u = game.units.find((x) => x.id === p.unitId);
      if (!u) continue;
      const what = p.order.type === 'roe' ? TMM.RADIO.ROE[p.order.roe].name : ORDER_NAME[p.order.type] || p.order.type;
      rows.push('<li class="q-' + p.state + '"><b>' + esc(TMM.RADIO.call(u)) + '</b><span>' + esc(what) + '</span><span class="q-st">' + esc(STATE_TEXT[p.state] || p.state) + '</span></li>');
    }
    const busy = game.radio.busyUntil > game.gameSeconds;
    const waiting = game.radio.queue.length;
    let head = '';
    if (busy || waiting) head = '<li class="q-head">무전망 ' + (busy ? '통화 중' : '대기') + (waiting ? ' · 대기 ' + waiting + '건' : '') + '</li>';
    set(els.queue, 'queue', head + rows.join(''), true);
  }

  return { init, update, ORDERS };
})();
