/*
 * 오른쪽 정보 패널: 선택 전차 정보, 소대 현황, 지형 범례, 상단 시계.
 * 매 프레임 호출되지만 글자가 바뀐 곳만 고친다.
 */
TMM.Panel = (function () {
  const els = {};
  const cache = new Map();

  function set(el, key, value, asHTML) {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    if (asHTML) el.innerHTML = value;
    else el.textContent = value;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const DIR_NAMES = ['동', '남동', '남', '남서', '서', '북서', '북', '북동'];
  function bearing(heading) {
    // heading: 0 = 동쪽, 화면 y 아래 방향 → 방위각(북 0°, 시계방향)
    let deg = (heading * 180) / Math.PI + 90;
    deg = ((deg % 360) + 360) % 360;
    const idx = Math.round((((heading * 180) / Math.PI) % 360 + 360) % 360 / 45) % 8;
    return DIR_NAMES[idx] + ' ' + String(Math.round(deg) % 360).padStart(3, '0') + '°';
  }

  function stateText(game, u) {
    if (u.state === 'moving') return game.paused ? '이동 중 (일시정지)' : '이동 중';
    return '정지';
  }

  function init(game, onSelect) {
    els.info = document.getElementById('unit-info');
    els.roster = document.getElementById('roster');
    els.legend = document.getElementById('legend');
    els.time = document.getElementById('clock-time');
    els.remain = document.getElementById('clock-remain');
    els.run = document.getElementById('run-state');
    els.banner = document.getElementById('pause-banner');
    els.cursor = document.getElementById('cursor-readout');

    // 소대 현황 목록
    els.rows = {};
    for (const u of game.units) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roster-item team-' + u.team;
      btn.innerHTML =
        '<span class="chip"></span>' +
        '<span class="r-name">' + esc(u.callsign) + '</span>' +
        '<span class="r-role">' + esc(u.role) + '</span>' +
        '<span class="r-state"></span>';
      btn.addEventListener('click', () => onSelect(u.id));
      li.appendChild(btn);
      els.roster.appendChild(li);
      els.rows[u.id] = { btn, state: btn.querySelector('.r-state') };
    }

    // 지형 범례 (속도 빠른 순)
    const order = TMM.TERRAIN_INFO.map((t, i) => i).sort((a, b) => TMM.TERRAIN_INFO[b].speed - TMM.TERRAIN_INFO[a].speed);
    for (const i of order) {
      const t = TMM.TERRAIN_INFO[i];
      const li = document.createElement('li');
      li.innerHTML =
        '<span class="swatch" style="background:' + t.color + '"></span>' +
        '<span class="l-name">' + esc(t.name) + '</span>' +
        '<span class="l-speed">' + (t.speed ? t.speed + ' km/h' : '통행 불가') + '</span>';
      els.legend.appendChild(li);
    }
  }

  function unitInfoHTML(game, u) {
    const map = game.map;
    const team = TMM.TEAMS[u.team];
    const info = map.infoAt(u.x, u.y);
    const rows = [];
    const row = (k, v, cls) => rows.push('<dt>' + k + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</dd>');

    row('상태', esc(stateText(game, u)), u.state === 'moving' ? 'st-move' : 'st-idle');
    row('위치 지형', esc(info.name) + ' <span class="sub">· ' + esc(TMM.speedGrade(info.speed)) + '</span>');
    row('격자 좌표', '<span class="mono">' + map.gridRef(u.x, u.y) + '</span>');
    row('고도', '<span class="mono">약 ' + map.altitudeAt(u.x, u.y) + ' m</span>');
    row('현재 속도', '<span class="mono">' + Math.round(u.speedKmh) + ' km/h</span>');
    row('차체 방향', '<span class="mono">' + bearing(u.heading) + '</span>');

    if (u.state === 'moving' && u.dest) {
      const destInfo = map.infoAt(u.dest.x, u.dest.y);
      const rem = TMM.Movement.remaining(map, u);
      row('목적지', '<span class="mono">' + map.gridRef(u.dest.x, u.dest.y) + '</span> <span class="sub">· ' + esc(destInfo.name) + '</span>');
      row('남은 거리', '<span class="mono">' + (rem.meters / 1000).toFixed(1) + ' km</span> <span class="sub">· ' + TMM.Clock.duration(rem.sec) + '</span>');
    } else {
      row('목적지', '<span class="sub">없음</span>');
    }

    return (
      '<div class="unit-head team-' + u.team + '">' +
      '<span class="u-num">' + u.id + '</span>' +
      '<div><div class="u-call">' + esc(u.callsign) + '</div>' +
      '<div class="u-sub">' + esc(u.model) + ' · ' + esc(u.role) + ' · ' + esc(team.name) + '</div></div>' +
      '</div><dl class="kv">' + rows.join('') + '</dl>'
    );
  }

  function update(game) {
    const sel = game.units.find((u) => u.id === game.selectedId);
    if (sel) {
      set(els.info, 'info', unitInfoHTML(game, sel), true);
    } else {
      set(els.info, 'info', '<p class="empty">지도에서 전차를 클릭하거나<br>숫자키 1~4 를 눌러 선택하십시오.</p>', true);
    }

    for (const u of game.units) {
      const r = els.rows[u.id];
      set(r.state, 'rs' + u.id, stateText(game, u) + ' · ' + game.map.infoAt(u.x, u.y).name);
      const on = u.id === game.selectedId;
      if (cache.get('rsel' + u.id) !== on) {
        cache.set('rsel' + u.id, on);
        r.btn.classList.toggle('selected', on);
        r.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    set(els.time, 'time', TMM.Clock.format(game.gameSeconds));
    set(els.remain, 'remain', TMM.Clock.remaining(game.gameSeconds));
    const runKey = game.paused ? 'p' : 'r' + game.speedMult;
    if (cache.get('run') !== runKey) {
      cache.set('run', runKey);
      els.run.textContent = game.paused ? '일시정지' : '진행 중 ×' + game.speedMult;
      els.run.classList.toggle('paused', game.paused);
      els.banner.hidden = !game.paused;
      els.banner.querySelector('.pb-title').textContent = game.started ? '일시정지' : '작전 대기';
      els.banner.querySelector('.pb-hint').textContent = game.started
        ? '스페이스바를 누르면 재개합니다 · 정지 중에도 이동 지시 가능'
        : '스페이스바를 누르면 작전을 개시합니다';
      document.querySelectorAll('[data-speed]').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.speed) === game.speedMult);
      });
    }

    // 커서 아래 지형
    const h = game.hover;
    let txt = '커서를 지도 위에 올리면 지형 정보가 표시됩니다';
    if (h) {
      const info = game.map.infoAt(h.x, h.y);
      if (info) {
        txt = '격자 ' + game.map.gridRef(h.x, h.y) + ' · ' + info.name + ' · ' +
          (info.speed ? info.speed + ' km/h (' + TMM.speedGrade(info.speed) + ')' : '통행 불가');
      }
    }
    set(els.cursor, 'cursor', txt);
  }

  return { init, update };
})();
