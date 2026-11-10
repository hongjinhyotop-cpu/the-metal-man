/*
 * 오른쪽 정보 패널: 선택 전차 정보(탄약·탄종·손상·엄폐 포함), 소대 현황, 접촉 현황(전장관리체계), 지형 범례, 상단 시계.
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
    if (u.stall > 0) return '정비 조치 중 ' + Math.ceil(u.stall) + '초';
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
        '<span class="r-role">' + esc(u.role + (u.leaderAboard && u.id !== 1 ? ' · 소대장 동승' : '')) + '</span>' +
        '<span class="r-cond"></span>' +
        '<span class="r-state"></span>' +
        '<span class="r-cmd"></span>';
      btn.addEventListener('click', () => onSelect(u.id));
      li.appendChild(btn);
      els.roster.appendChild(li);
      els.rows[u.id] = { btn, state: btn.querySelector('.r-state'), cond: btn.querySelector('.r-cond'), cmd: btn.querySelector('.r-cmd') };
    }

    els.esum = document.getElementById('contact-summary');
    els.light = document.getElementById('light-state');
    els.light.textContent = TMM.LIGHT[game.light].name;
    els.light.classList.toggle('night', game.light === 'night');
    els.sightBtn = document.getElementById('sight-hint');

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

    const ctrl = TMM.Radio.controlUnit(game);
    const ls = TMM.Radio.linkState(game, u);
    const pend = TMM.Radio.pendingFor(game, u.id).length;
    row('명령', esc(TMM.Orders.describe(game, u)) + (pend ? ' <span class="warn">· 새 명령 전달 중</span>' : ''));
    row('사격 통제', esc(TMM.RADIO.ROE[u.roe].name) + ' <span class="sub">· ' + esc(TMM.RADIO.ROE[u.roe].desc) + '</span>');
    row('교신', '<span class="' + (ls.code === 'good' || ls.code === 'self' ? 'ok' : ls.code === 'noisy' || ls.code === 'hand' ? 'sub' : 'warn') + '">' + esc(ls.text) + '</span>' +
      (u === ctrl ? ' <span class="sub">· 직접 조작</span>' : ' <span class="sub">· 무전으로만 지휘</span>'));
    row('상태', esc(stateText(game, u)), u.state === 'moving' ? 'st-move' : 'st-idle');
    row('위치 지형', esc(info.name) + ' <span class="sub">· ' + esc(TMM.speedGrade(info.speed)) + '</span>');
    row('격자 좌표', '<span class="mono">' + map.gridRef(u.x, u.y) + '</span>');
    row('고도', '<span class="mono">약 ' + map.altitudeAt(u.x, u.y) + ' m</span>');
    row('현재 속도', '<span class="mono">' + Math.round(u.speedKmh) + ' km/h</span>');
    row('차체 방향', '<span class="mono">' + bearing(u.heading) + '</span>');
    row('엄폐', coverText(game, u));
    const ts = TMM.TERRAIN_SIGHT[map.typeAt(u.x, u.y)];
    if (ts.conceal < 0.8) row('은폐', '<span class="ok">' + esc(info.name) + ' 안</span> <span class="sub">· 적이 탐지하기 어려움</span>');

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
      '<div><div class="u-call">' + esc(u.callsign) + ' <span class="u-radio">' + esc(TMM.RADIO.call(u)) + '</span></div>' +
      '<div class="u-sub">' + esc(u.model) + ' · ' + esc(u.role + (u.leaderAboard && u.id !== 1 ? ' · 소대장 동승' : '')) + ' · ' + esc(team.name) + '</div></div>' +
      '</div>' + crewHTML(game, u) + combat + '<dl class="kv">' + rows.join('') + '</dl>'
    );
  }

  // M5: 승무원 카드 4장 + 신뢰도 막대 (2·3·4호차)
  function bar(cls, v, title) {
    const n = Math.round(v);
    return '<span class="cw-bar ' + cls + '" title="' + title + ' ' + n + '"><i style="width:' + n + '%"></i></span><span class="cw-n mono">' + n + '</span>';
  }
  function crewHTML(game, u) {
    if (!u.crew || !TMM.Crew) return '';
    const out = ['<div class="crew">'];
    const t = u.crew.trust;
    if (t != null) {
      const d = Math.round(t - u.crew.trustStart);
      const last = u.crew.trustLog[u.crew.trustLog.length - 1];
      out.push('<div class="trust' + (t < 35 ? ' low' : t >= 70 ? ' high' : '') + '">' +
        '<span class="tr-k">신뢰도</span>' +
        '<span class="tr-bar"><i style="width:' + Math.round(t) + '%"></i></span>' +
        '<span class="tr-v mono">' + Math.round(t) + '</span>' +
        '<span class="tr-l">' + esc(TMM.Crew.trustLabel(t)) + (d ? ' <span class="sub">(' + (d > 0 ? '+' : '') + d + ')</span>' : '') + '</span>' +
        (last ? '<span class="tr-why sub">최근: ' + esc(last.reason) + ' ' + (last.delta > 0 ? '+' : '') + last.delta + '</span>' : '<span class="tr-why sub">소대장을 얼마나 믿는가 · 높으면 빨리·정확히 따름</span>') +
        '</div>');
    }
    out.push('<div class="crew-cards">');
    for (const role of TMM.VEHICLES[u.model].crewRoles || TMM.CREW_ROLE_ORDER) {
      const m = u.crew.byRole[role];
      if (!m) {
        // M7b: 빈자리 (3명 K1A2 의 탄약수)
        out.push('<div class="cw vacant"><div class="cw-head"><span class="cw-role">' + esc(TMM.CREW_ROLES[role].name) + '</span><span class="cw-st warn">없음</span></div><div class="cw-name sub">' + (role === 'loader' ? '포수가 대신 장전 — 느림' : '공석') + '</div></div>');
        continue;
      }
      const st = TMM.Crew.statusWord(m);
      const stCls = m.injury >= 2 ? 'bad' : m.injury || m.shaken ? 'warn' : st ? 'dim' : '';
      out.push('<div class="cw' + (m.injury >= 2 ? ' hurt2' : m.injury ? ' hurt1' : '') + (u.destroyed ? ' dead' : '') + '" title="' + esc(m.about + ' · ' + TMM.CREW_ROLES[role].effect) + '">' +
        '<div class="cw-head"><span class="cw-role">' + esc(TMM.CREW_ROLES[role].name) + '</span>' + (st ? '<span class="cw-st ' + stCls + '">' + esc(st) + '</span>' : m.trained && m.trained !== role && !m.player ? '<span class="cw-st warn">' + esc(TMM.CREW_ROLES[m.trained].name) + ' 출신</span>' : m.recruit ? '<span class="cw-st dim">보충병</span>' : '') + '</div>' +
        '<div class="cw-name">' + esc(m.player ? '소대장 (나)' : m.name) + ' <span class="sub">' + esc(m.rank) + '</span></div>' +
        '<div class="cw-stats">' +
        (m.player ? '<span class="cw-k">숙련</span><span class="cw-na sub">직접 조작</span>' : '<span class="cw-k">숙련</span>' + bar('sk', m.skill, '숙련도')) +
        '<span class="cw-k">피로</span>' + bar('ft', m.fatigue, '피로') +
        '<span class="cw-k">사기</span>' + bar('mo', m.morale, '사기') +
        '</div></div>');
    }
    out.push('</div></div>');
    return out.join('');
  }

  // 차체 엄폐 문구: 보이는 적 기준
  function coverText(game, u) {
    if (u.destroyed) return '<span class="sub">—</span>';
    const cv = u.cover;
    if (!cv || !cv.list.length) return '<span class="sub">보이는 적 없음</span>';
    if (cv.moving) return '<span class="warn">이동 중 — 노출</span>';
    const hd = cv.list.filter((x) => x.hullDown).map((x) => TMM.Intel.displayName(x.contact));
    if (hd.length === cv.list.length) return '<span class="ok">▲ 차체 엄폐</span> <span class="sub">· 포탑만 보임 (피탄 확률 절반)</span>';
    if (hd.length) return '<span class="ok">▲ 차체 엄폐</span> <span class="sub">· ' + esc(hd.join(', ')) + ' 기준만</span>';
    return '<span class="warn">노출</span> <span class="sub">· 능선 바로 뒤에 멈추면 차체 엄폐</span>';
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
    const I = TMM.Intel;
    const cOf = (id) => (id != null ? I.contact(game, 'friend', id) : null);
    const manual = cOf(u.targetId);
    const engaged = cOf(u.fire.targetId);
    const distTo = (c) => Math.hypot(c.lastX - u.x, c.lastY - u.y) * game.map.metersPerCell;
    if (manual) {
      const d = distTo(manual);
      const inR = d <= ammo.rangeM;
      tgt = '<b>' + esc(I.displayName(manual)) + '</b> <span class="sub">· 지정 · ' + (d / 1000).toFixed(1) + 'km' + (inR ? '' : ' · 사거리 밖') + (manual.visible ? '' : ' · 표적 소실') + '</span>';
      if (!manual.identified) tgt += '<br><span class="warn">⚠ 미식별 표적 — 오인사격 위험</span>';
      if (engaged && engaged !== manual) tgt += '<br><span class="sub">대신 ' + esc(I.displayName(engaged)) + ' 자동 교전</span>';
    } else if (engaged) {
      tgt = esc(I.displayName(engaged)) + ' <span class="sub">· 자동 교전 · ' + (distTo(engaged) / 1000).toFixed(1) + 'km</span>';
    } else {
      const ROE_IDLE = { hold: '사격 금지 — 목표 지정한 표적만 쏨', id: '식별된 적과 2km 안 자동 교전', free: '자유 사격 — 사거리 끝까지, 미상 표적도 1.5km 안' };
      tgt = '<span class="sub">없음 · ' + ROE_IDLE[u.roe || 'id'] + '</span>';
    }
    out.push('<div class="cb-row"><span class="cb-k">사격 목표</span><span>' + tgt + '</span></div>');
    if (engaged && !u.destroyed) {
      const t = engaged.unit;
      const mods = I.fireMods(game, u, t);
      const p = TMM.Ballistics.hitChance(game.map, u, t, u.ammoType, mods);
      const asp = TMM.Ballistics.ASPECT_NAMES[TMM.Ballistics.aspect(t, u)];
      const notes = [];
      if (mods.hullDown) notes.push('표적 차체 엄폐');
      if (mods.obs > 0.15) notes.push('가림 ' + Math.round(Math.min(1, mods.obs) * 100) + '%');
      out.push('<div class="cb-row"><span class="cb-k">명중 예상</span><span class="mono">' + Math.round(p * 100) + '% <span class="sub">· 적 ' + asp + ' 조준' + (notes.length ? ' · ' + notes.join(' · ') : '') + '</span></span></div>');
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

  const hullCache = { key: '', v: false };

  // 접촉 한 줄 설명 (HTML)
  function contactLine(game, c) {
    const name = TMM.Intel.displayName(c);
    const age = Math.max(0, Math.round(game.gameSeconds - c.lastSeen));
    let st;
    if (c.wreck) st = c.unit.abandoned ? '유기됨' : TMM.Damage.summary(c.unit);
    else if (c.visible) {
      st = '보임 · ' + (c.dist / 1000).toFixed(1) + 'km';
      if (!c.identified) st += ' · 식별 중 ' + Math.round(c.idProg * 100) + '%';
      else if (c.kind === 'hostile' && c.unit.ai) {
        st += ' · ' + (TMM.EnemyAI.MODE_NAMES[c.unit.ai.mode] || '');
        const dmg = TMM.Damage.damagedParts(c.unit);
        if (dmg.length) st += ' · ' + dmg.map((k) => TMM.PARTS[k].name).join('·') + ' 손상';
      } else if (c.unit.hurt) st += ' · ' + TMM.Damage.summary(c.unit);
    } else st = '놓침 · 마지막 위치 ' + age + '초 전';
    return name + ' — ' + st;
  }

  // 접촉 현황 (전장관리체계): 소대가 알고 있는 표적 목록
  function updateContacts(game) {
    const list = Array.from(game.intel.friend.contacts.values()).filter((c) => c.known);
    const rank = (c) => (c.wreck ? 4 : c.kind === 'friendly' ? 3 : !c.identified ? 0 : c.visible ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || a.firstSeen - b.firstSeen);
    let html = '';
    for (const c of list) {
      const cls = c.wreck ? 'k-dead' : !c.identified ? 'k-unknown' : c.kind === 'friendly' ? 'k-friend' : 'k-enemy';
      const tag = !c.identified ? c.label : c.kind === 'friendly' ? '아' : c.unit.num || '적';
      const line = contactLine(game, c);
      const i = line.indexOf(' — ');
      html += '<li class="' + cls + (c.visible ? '' : ' lost') + '"><span class="e-tag">' + esc(String(tag)) + '</span>' +
        '<span class="e-name">' + esc(line.slice(0, i)) + '</span><span class="e-state">' + esc(line.slice(i + 3)) + '</span></li>';
    }
    if (!list.length) html = '<li class="none">아직 탐지한 표적 없음</li>';
    set(els.enemies, 'contacts', html, true);

    const kills = game.enemies.filter((e) => e.destroyed && !e.abandoned).length;
    const aband = game.enemies.filter((e) => e.abandoned).length;
    const gone = game.enemies.filter((e) => e.exited && !e.ai.pending).length; // M7a: 아직 안 온 제대는 빼고
    const seen = game.enemies.filter((e) => { const c = TMM.Intel.contact(game, 'friend', e.id); return c && c.known && c.identified; }).length;
    let sum = '적 전차 식별 ' + seen + ' / ' + game.enemies.length + ' · 격파 ' + kills;
    if (aband) sum += ' · 유기 ' + aband;
    if (gone) sum += ' · 이탈 ' + gone;
    if (game.ffCount) sum += ' · 오인사격 ' + game.ffCount + '회';
    set(els.esum, 'esum', sum);
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
      const hurtN = u.crew ? u.crew.members.filter((m) => m.injury).length : 0;
      set(r.state, 'rs' + u.id, stateText(game, u) + ' · ' + game.map.infoAt(u.x, u.y).name + ' · 잔탄 ' + TMM.Damage.totalAmmo(u) +
        (u.crew && u.crew.trust != null ? ' · 신뢰 ' + Math.round(u.crew.trust) : '') + (hurtN ? ' · 부상 ' + hurtN : ''));
      const ls = TMM.Radio.linkState(game, u);
      const pend = TMM.Radio.pendingFor(game, u.id).length;
      set(r.cmd, 'rcmd' + u.id, '<span class="lk lk-' + ls.code + '"></span>' + esc(TMM.Orders.describe(game, u)) + ' · ' + esc(TMM.RADIO.ROE[u.roe].short) +
        (ls.code === 'dead' ? ' · <b class="warn">교신 두절</b>' : '') + (pend ? ' · <b class="pend">((·)) 전달 중</b>' : ''), true);
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

    updateContacts(game);

    set(els.time, 'time', TMM.Clock.format(game.gameSeconds));
    set(els.remain, 'remain', TMM.Clock.remaining(game.gameSeconds));
    const runKey = (game.over ? 'o' : game.paused ? 'p' : 'r' + game.speedMult) + (game.combat ? 'c' : '') + (game.started ? 's' : '');
    if (cache.get('run') !== runKey) {
      cache.set('run', runKey);
      els.run.textContent = game.over ? '작전 종료' : game.paused ? '일시정지' : (game.combat ? '교전 중' : '진행 중') + ' ×' + game.speedMult;
      els.run.title = game.combat ? '교전 중에는 시간이 느리게 흐릅니다 (실제 1초 = 게임 ' + TMM.CONFIG.COMBAT_TIME_SCALE + '초)' : '';
      els.run.classList.toggle('paused', game.paused || !!game.over);
      els.run.classList.toggle('combat', game.combat && !game.paused && !game.over);
      els.banner.hidden = !game.paused || !!game.over;
      els.banner.querySelector('.pb-title').textContent = game.started ? '일시정지' : '작전 대기';
      els.banner.querySelector('.pb-hint').textContent = game.started
        ? '스페이스바를 누르면 재개합니다 · 정지 중 내린 무전 명령은 재개하면 전달됩니다'
        : '스페이스바를 누르면 작전을 개시합니다 · 지금 미리 무전 명령을 내려 둘 수 있습니다';
      document.querySelectorAll('[data-speed]').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.speed) === game.speedMult);
      });
    }

    const sightKey = game.showSight ? 'on' : 'off';
    if (cache.get('sight') !== sightKey) {
      cache.set('sight', sightKey);
      els.sightBtn.textContent = game.showSight ? '시야 표시 켜짐 (V)' : '시야 표시 꺼짐 (V)';
      els.sightBtn.classList.toggle('on', game.showSight);
    }

    // 커서 아래 지형
    const h = game.hover;
    let txt = '커서를 지도 위에 올리면 지형 정보가 표시됩니다';
    const c = game.hoverContactId != null ? TMM.Intel.contact(game, 'friend', game.hoverContactId) : null;
    if (c) {
      txt = contactLine(game, c).replace(/<[^>]+>/g, '');
      const sel = game.units.find((u) => u.id === game.selectedId);
      if (!c.known) txt = '';
      else if (sel && !c.wreck && !sel.destroyed && c.kind !== 'friendly') {
        const d = Math.hypot(c.lastX - sel.x, c.lastY - sel.y) * game.map.metersPerCell;
        const inR = d <= TMM.AMMO[sel.ammoType].rangeM;
        const sees = c.visible && TMM.Intel.sees(game, sel, c.unit);
        txt += ' · ' + sel.callsign + '에서 ' + (d / 1000).toFixed(1) + 'km';
        if (!sees) txt += ' · 본 차에서 안 보임';
        else if (!inR) txt += ' · 사거리 밖';
        else txt += ' · 명중 예상 ' + Math.round(TMM.Ballistics.hitChance(game.map, sel, c.unit, sel.ammoType, TMM.Intel.fireMods(game, sel, c.unit)) * 100) + '%';
        const to = TMM.Command.specName(game, game.cmd.to);
        txt += c.identified ? ' · 클릭하면 ' + to + '에게 목표 지정' : ' · ⚠ 미식별 — 클릭하면 오인사격 위험을 안고 ' + to + '에게 목표 지정';
      }
    } else if (h) {
      const info = game.map.infoAt(h.x, h.y);
      if (info) {
        txt = '격자 ' + game.map.gridRef(h.x, h.y) + ' · ' + info.name + ' · ' +
          (info.speed ? info.speed + ' km/h (' + TMM.speedGrade(info.speed) + ')' : '통행 불가');
        // 커서 지점의 엄폐 안내 (칸이 바뀔 때만 계산)
        const key = Math.floor(h.x) + ',' + Math.floor(h.y);
        if (hullCache.key !== key) {
          hullCache.key = key;
          hullCache.v = info.speed ? TMM.Sight.hullDownFromNorth(game.map, h) : false;
        }
        if (hullCache.v) txt += ' · ▲ 북쪽에서 볼 때 차체 엄폐 지형';
        const ts = TMM.TERRAIN_SIGHT[game.map.typeAt(h.x, h.y)];
        if (ts.conceal < 0.8) txt += ' · 은폐 (탐지 어려움)';
      }
    }
    set(els.cursor, 'cursor', txt);
  }

  return { init, update };
})();
