/*
 * 오른쪽 정보 패널: 선택 전차 정보(탄약·탄종·손상 포함), 소대 현황, 적 현황, 지형 범례, 상단 시계.
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
    if (u.destroyed) return '격파됨';
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
    els.enemies = document.getElementById('enemy-roster');

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
        '<span class="r-cond"></span>' +
        '<span class="r-state"></span>';
      btn.addEventListener('click', () => onSelect(u.id));
      li.appendChild(btn);
      els.roster.appendChild(li);
      els.rows[u.id] = { btn, state: btn.querySelector('.r-state'), cond: btn.querySelector('.r-cond') };
    }

    // 적 현황 목록
    els.erows = {};
    for (const e of game.enemies) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="e-tag">' + e.num + '</span><span class="e-name">' + esc(e.callsign) + '</span><span class="e-state"></span>';
      els.enemies.appendChild(li);
      els.erows[e.id] = { li, state: li.querySelector('.e-state') };
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

    const combat = combatHTML(game, u);
    return (
      '<div class="unit-head team-' + u.team + '">' +
      '<span class="u-num">' + u.id + '</span>' +
      '<div><div class="u-call">' + esc(u.callsign) + '</div>' +
      '<div class="u-sub">' + esc(u.model) + ' · ' + esc(u.role) + ' · ' + esc(team.name) + '</div></div>' +
      '</div>' + combat + '<dl class="kv">' + rows.join('') + '</dl>'
    );
  }

  // 탄약·탄종·사격·손상
  function combatHTML(game, u) {
    const veh = TMM.VEHICLES[u.model];
    const total = TMM.Damage.totalAmmo(u);
    const full = Object.values(veh.ammoLoad).reduce((a, b) => a + b, 0);
    const cond = TMM.Damage.condition(u);
    const ammo = TMM.AMMO[u.ammoType];
    const out = [];

    out.push('<div class="combat">');
    out.push('<div class="cb-row"><span class="cb-k">전투 상태</span><span class="cond ' + cond.cls + '">' + cond.text + '</span></div>');

    // 탄약
    out.push('<div class="cb-row"><span class="cb-k">120mm 잔탄</span><span class="mono cb-big' + (total <= 5 ? ' low' : '') + '">' + total + '<span class="sub"> / ' + full + '발</span></span></div>');
    out.push('<div class="ammo-types">');
    for (const k of veh.ammoTypes) {
      const a = TMM.AMMO[k];
      const on = k === u.ammoType;
      const pct = Math.round((u.ammo[k] / veh.ammoLoad[k]) * 100);
      out.push(
        '<div class="ammo' + (on ? ' on' : '') + (u.ammo[k] <= 0 ? ' empty' : '') + '">' +
        '<span class="a-mark">' + (on ? '▶' : '') + '</span>' +
        '<span class="a-name" title="' + esc(a.name + ' · ' + a.use) + '">' + k + ' <span class="sub">' + esc(a.short) + '</span></span>' +
        '<span class="a-cnt mono">' + u.ammo[k] + '</span>' +
        '<span class="a-bar"><i style="width:' + pct + '%"></i></span>' +
        '</div>'
      );
    }
    out.push('</div>');
    out.push('<div class="cb-row"><span class="cb-k">현재 탄종</span><span>' + esc(ammo.name) + '<br><span class="sub">' + esc(ammo.use) + ' · 사거리 ' + (ammo.rangeM / 1000).toFixed(1) + 'km · Q 키로 전환</span></span></div>');

    // 사격 목표
    let tgt;
    const foes = game.enemies;
    const manual = u.targetId != null ? foes.find((e) => e.id === u.targetId) : null;
    const engaged = u.fire.targetId != null ? foes.find((e) => e.id === u.fire.targetId) : null;
    if (manual) {
      const d = TMM.Ballistics.distanceM(game.map, u, manual);
      const inR = d <= ammo.rangeM;
      tgt = '<b>' + esc(manual.callsign) + '</b> <span class="sub">· 지정 · ' + (d / 1000).toFixed(1) + 'km' + (inR ? '' : ' · 사거리 밖') + '</span>';
      if (!inR && engaged) tgt += '<br><span class="sub">대신 ' + esc(engaged.callsign) + ' 자동 교전</span>';
    } else if (engaged) {
      const d = TMM.Ballistics.distanceM(game.map, u, engaged);
      tgt = esc(engaged.callsign) + ' <span class="sub">· 자동 교전 · ' + (d / 1000).toFixed(1) + 'km</span>';
    } else {
      tgt = '<span class="sub">없음 · 자유 사격</span>';
    }
    out.push('<div class="cb-row"><span class="cb-k">사격 목표</span><span>' + tgt + '</span></div>');
    if (engaged && !u.destroyed) {
      const p = TMM.Ballistics.hitChance(game.map, u, engaged, u.ammoType);
      const asp = TMM.Ballistics.ASPECT_NAMES[TMM.Ballistics.aspect(engaged, u)];
      out.push('<div class="cb-row"><span class="cb-k">명중 예상</span><span class="mono">' + Math.round(p * 100) + '% <span class="sub">· 적 ' + asp + ' 조준</span></span></div>');
    }
    out.push('<div class="cb-row"><span class="cb-k">사격</span><span>' + esc(TMM.Gunnery.status(game, u)) + '</span></div>');

    // 손상
    out.push('<div class="parts">');
    for (const k of TMM.PART_KEYS) {
      const bad = u.destroyed || u.damage[k];
      out.push('<span class="part' + (bad ? ' bad' : '') + '" title="' + esc(TMM.PARTS[k].effect) + '">' + TMM.PARTS[k].name + '<b>' + (u.destroyed ? '파괴' : bad ? '손상' : '정상') + '</b></span>');
    }
    out.push('</div></div>');
    return out.join('');
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
      set(r.state, 'rs' + u.id, stateText(game, u) + ' · ' + game.map.infoAt(u.x, u.y).name + ' · 잔탄 ' + TMM.Damage.totalAmmo(u));
      const c = TMM.Damage.condition(u);
      set(r.cond, 'rc' + u.id, '<span class="cond ' + c.cls + '">' + c.text + '</span>', true);
      if (cache.get('rdead' + u.id) !== u.destroyed) {
        cache.set('rdead' + u.id, u.destroyed);
        r.btn.classList.toggle('dead', u.destroyed);
      }
      const on = u.id === game.selectedId;
      if (cache.get('rsel' + u.id) !== on) {
        cache.set('rsel' + u.id, on);
        r.btn.classList.toggle('selected', on);
        r.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    for (const e of game.enemies) {
      const r = els.erows[e.id];
      let txt;
      if (e.destroyed) txt = '격파';
      else {
        txt = TMM.EnemyAI.MODE_NAMES[e.ai.mode] || '';
        const dmg = TMM.Damage.damagedParts(e);
        if (dmg.length) txt += ' · ' + dmg.map((k) => TMM.PARTS[k].name).join('·') + ' 손상';
      }
      set(r.state, 'es' + e.id, txt);
      if (cache.get('edead' + e.id) !== e.destroyed) {
        cache.set('edead' + e.id, e.destroyed);
        r.li.classList.toggle('dead', e.destroyed);
      }
    }

    set(els.time, 'time', TMM.Clock.format(game.gameSeconds));
    set(els.remain, 'remain', TMM.Clock.remaining(game.gameSeconds));
    const runKey = (game.over ? 'o' : game.paused ? 'p' : 'r' + game.speedMult) + (game.combat ? 'c' : '');
    if (cache.get('run') !== runKey) {
      cache.set('run', runKey);
      els.run.textContent = game.over ? '작전 종료' : game.paused ? '일시정지' : (game.combat ? '교전 중' : '진행 중') + ' ×' + game.speedMult;
      els.run.title = game.combat ? '교전 중에는 시간이 느리게 흐릅니다 (실제 1초 = 게임 ' + TMM.CONFIG.COMBAT_TIME_SCALE + '초)' : '';
      els.run.classList.toggle('paused', game.paused || !!game.over);
      els.run.classList.toggle('combat', game.combat && !game.paused && !game.over);
      els.banner.hidden = !game.paused || !!game.over;
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
    const foe = game.hoverEnemyId != null ? game.enemies.find((e) => e.id === game.hoverEnemyId) : null;
    if (foe) {
      txt = foe.callsign + ' · 천마호 · ' + TMM.Damage.summary(foe);
      const sel = game.units.find((u) => u.id === game.selectedId);
      if (sel && !foe.destroyed && !sel.destroyed) {
        const d = TMM.Ballistics.distanceM(game.map, sel, foe);
        const inR = d <= TMM.AMMO[sel.ammoType].rangeM;
        txt += ' · ' + sel.callsign + '에서 ' + (d / 1000).toFixed(1) + 'km' +
          (inR ? ' · 명중 예상 ' + Math.round(TMM.Ballistics.hitChance(game.map, sel, foe, sel.ammoType) * 100) + '% · 클릭하면 사격 목표' : ' · 사거리 밖');
      }
    } else if (h) {
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
