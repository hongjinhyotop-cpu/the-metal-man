/*
 * M7a 캠페인 화면: 처음 화면(이어하기·새 캠페인·훈련 모드), 프롤로그, 작전 명령, 재정비, 엔딩.
 * 전투 화면 위를 덮는 전체 화면 창(#camp) 하나에 그린다. 규칙은 TMM.Campaign(js/campaign/campaign.js).
 *
 * TMM.CampaignUI.init({ training(), battle(state) })
 *   training: 훈련 모드(기존 단일 전투) 선택 화면으로 / battle: 작전 명령 화면에서 '출동' → 전투 시작
 */
TMM.CampaignUI = (function () {
  let el = null, h = null;
  const C = () => TMM.Campaign;
  const D = () => TMM.CAMPAIGN;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PART_NAMES = () => { const o = {}; for (const k of TMM.PART_KEYS) o[k] = TMM.PARTS[k].name; return o; };
  const RESULT_NAME = { success: '성공', fail: '실패', collapse: '소대 붕괴' };

  function init(handlers) {
    el = document.getElementById('camp');
    h = handlers;
  }

  function open(html, cls) {
    el.className = 'camp ' + (cls || '');
    el.innerHTML = '<div class="c-box">' + html + '</div>';
    el.hidden = false;
    el.scrollTop = 0;
    const f = el.querySelector('[data-focus]') || el.querySelector('button');
    if (f) f.focus({ preventScroll: true });
  }
  function close() { el.hidden = true; el.innerHTML = ''; }
  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };

  // ---------------------------------------------------------------- 처음 화면
  function title() {
    const s = C().load();
    open(
      '<div class="s-kicker">한반도 전쟁 · 개전 첫 72시간</div>' +
      '<div class="c-logo">THE METAL MAN</div>' +
      '<p class="s-brief">K1A2 전차 소대장(소위)이 되어 전차 4대와 승무원 16명을 지휘합니다. 작전 5개를 거치며 손상·탄약·부상·신뢰도가 다음 작전으로 이어집니다.</p>' +
      '<div class="c-menu">' +
      (s ? '<button type="button" class="c-big" data-cont data-focus><b>이어하기</b><span>' + esc(C().resumeText(s)) + '</span></button>' : '') +
      '<button type="button" class="c-big" data-new' + (s ? '' : ' data-focus') + '><b>새 캠페인</b><span>프롤로그부터 · 작전 5개 · 작전이 끝날 때마다 자동 저장</span></button>' +
      '<button type="button" class="c-big dim" data-train><b>훈련 모드</b><span>캠페인과 상관없는 단일 전투 (주간/야간 선택)</span></button>' +
      '</div>' +
      '<p class="c-note">저장은 이 브라우저에만 남습니다. 사생활 보호 창이나 저장소를 지우면 사라질 수 있습니다.</p>',
      'title'
    );
    on('[data-cont]', () => route(C().load()));
    on('[data-new]', () => {
      if (s && !window.confirm('저장된 캠페인을 지우고 새로 시작할까요?')) return;
      const n = C().newState();
      C().save(n);
      route(n);
    });
    on('[data-train]', () => { close(); h.training(); });
  }

  // 저장된 단계로
  function route(s) {
    if (!s) return title();
    if (s.phase === 'prologue') return prologue(s, 0);
    if (s.phase === 'ending') return ending(s);
    if (s.refitPending) return refitScreen(s);
    return orders(s);
  }

  // ---------------------------------------------------------------- 프롤로그
  function who(key) {
    if (key === 'me') return { name: '소대장', cls: 'me' };
    if (key === 'radio') return { name: '대대 무전', cls: 'radio' };
    const d = C().crewName(key);
    return d ? { name: d.name + ' ' + d.rank, cls: '' } : { name: key, cls: '' };
  }
  function linesHtml(lines) {
    return '<div class="c-lines">' + lines.map(([k, t]) => {
      if (k === 'note') return '<p class="c-say note">' + esc(t) + '</p>';
      const w = who(k);
      return '<p class="c-say ' + w.cls + '"><b>' + esc(w.name) + '</b><span>' + esc(t) + '</span></p>';
    }).join('') + '</div>';
  }
  function prologue(s, i) {
    const P = D().PROLOGUE;
    const sc = P[i];
    const last = i === P.length - 1;
    open(
      '<div class="s-kicker">프롤로그 · ' + (i + 1) + ' / ' + P.length + '</div>' +
      '<div class="c-scene"><span class="mono">' + esc(sc.time) + '</span> ' + esc(sc.place) + '</div>' +
      linesHtml(sc.lines) +
      (sc.lesson ? '<div class="c-lesson"><div class="c-lesson-t">' + esc(sc.lesson.title) + '</div><ul>' + sc.lesson.items.map((x) => '<li>' + x + '</li>').join('') + '</ul></div>' : '') +
      '<div class="c-nav">' +
      (i > 0 ? '<button type="button" class="c-btn dim" data-prev>◂ 이전</button>' : '<span></span>') +
      '<span class="c-gap"></span>' +
      (last ? '' : '<button type="button" class="c-btn dim" data-skip>건너뛰기</button>') +
      '<button type="button" class="r-btn" data-next data-focus>' + (last ? '작전 명령 받기 ▸' : '다음 ▸') + '</button>' +
      '</div>',
      'prologue'
    );
    on('[data-prev]', () => prologue(s, i - 1));
    const done = () => { s.phase = 'briefing'; s.refitPending = false; C().save(s); orders(s); };
    on('[data-skip]', done);
    on('[data-next]', () => (last ? done() : prologue(s, i + 1)));
  }

  // ---------------------------------------------------------------- 작전 명령
  let overview = null; // 지형 그림 캐시
  function terrainImage() {
    if (!overview) {
      const map = TMM.game && TMM.game.map ? TMM.game.map : (TMM._map = TMM._map || TMM.MapGen.generate());
      overview = TMM.TerrainLayer.build(map);
    }
    return overview;
  }
  function drawOverview(cv, spec) {
    const map = { cols: TMM.CONFIG.COLS, rows: TMM.CONFIG.ROWS };
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 320, hgt = (w * map.rows) / map.cols;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hgt * dpr);
    cv.style.height = hgt + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = w / map.cols;
    try { ctx.drawImage(terrainImage(), 0, 0, w, hgt); } catch (e) { ctx.fillStyle = '#2a3320'; ctx.fillRect(0, 0, w, hgt); }
    if (spec.light === 'night') { ctx.fillStyle = 'rgba(4,10,26,0.45)'; ctx.fillRect(0, 0, w, hgt); }
    TMM.Renderer.drawMarks(ctx, { ox: 0, oy: 0, scale: k }, spec.marks, 0.9);
    // 적: 진지(붉은 마름모) 또는 진입 방향(붉은 화살표)
    ctx.lineWidth = 2;
    for (const e of spec.enemies) {
      const x = e.x * k, y = e.y * k;
      ctx.fillStyle = '#e0563f';
      ctx.strokeStyle = '#e0563f';
      if (e.static) {
        ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
      } else {
        const to = e.route && e.route[Math.min(1, e.route.length - 1)];
        if (!to) continue;
        const a = Math.atan2(to[1] - e.y, to[0] - e.x);
        const L = Math.min(40, Math.hypot(to[0] - e.x, to[1] - e.y) * k);
        const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
        ctx.setLineDash(e.delay ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.5) * 7, ey - Math.sin(a - 0.5) * 7); ctx.lineTo(ex - Math.cos(a + 0.5) * 7, ey - Math.sin(a + 0.5) * 7); ctx.closePath(); ctx.fill();
      }
    }
    // 아군 시작 위치
    ctx.font = '700 9px ' + getComputedStyle(document.body).getPropertyValue('--mono');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const u of spec.units) {
      const team = u.id <= 2 ? 1 : 2;
      const x = u.x * k, y = u.y * k;
      ctx.fillStyle = TMM.TEAMS[team].color;
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = '#12160c';
      ctx.fillText(String(u.id), x, y + 0.5);
    }
  }

  function tankLine(s, id) {
    const t = s.tanks[id];
    const P = PART_NAMES();
    if (!t.alive) return '<span class="bad">격파됨 (작전 ' + t.lostIn + ') — 이번 작전 불참</span>';
    const dmg = TMM.PART_KEYS.filter((k) => t.damage[k]).map((k) => P[k]);
    const sv = s.crew && s.crew[id];
    const hurt = sv ? sv.members.filter((m) => m.injury >= 2).map((m) => C().crewName(m.key).name) : [];
    const fat = sv ? Math.round(sv.members.reduce((a, m) => a + m.fatigue, 0) / sv.members.length) : null;
    const parts = [dmg.length ? '<span class="bad">' + dmg.join('·') + ' 손상</span>' : '<span class="ok">차량 정상</span>'];
    if (hurt.length) parts.push('<span class="bad">중상 ' + hurt.join('·') + '</span>');
    if (fat != null) parts.push('피로 ' + fat);
    if (id !== 1) parts.push('신뢰 ' + Math.round(sv && sv.trust != null ? sv.trust : TMM.CREW_TRUST_START[id]));
    return parts.join(' · ');
  }

  function orders(s) {
    const op = D().OPS[s.op];
    const spec = C().battleSpec(s);
    const b = op.brief;
    const press = C().pressureText(s);
    const alive = C().aliveIds(s);
    const rows = C().IDS.map((id) => {
      const t = s.tanks[id];
      const team = id <= 2 ? 1 : 2;
      if (!t.alive) return '<div class="c-tank dead team-' + team + '"><div class="c-tank-h"><b>' + id + '호차</b> ' + tankLine(s, id) + '</div></div>';
      const tot = C().total(t.ammo);
      const ap = s.plan[id];
      return '<div class="c-tank team-' + team + '">' +
        '<div class="c-tank-h"><b>' + id + '호차</b> <span class="sub">' + (team === 1 ? '1조' : '2조') + '</span> ' + tankLine(s, id) + '</div>' +
        '<div class="c-ammo"><span class="c-ap">철갑 <b data-ap="' + id + '">' + ap + '</b></span>' +
        '<input type="range" min="0" max="' + tot + '" value="' + ap + '" data-plan="' + id + '" aria-label="' + id + '호차 철갑탄 수">' +
        '<span class="c-he">고폭 <b data-he="' + id + '">' + (tot - ap) + '</b></span><span class="c-tot">/ ' + tot + '발</span></div>' +
        '</div>';
    }).join('');
    open(
      '<div class="c-order-head"><div><div class="s-kicker">작전 명령 · 강철 소대 · 대대 발령</div>' +
      '<div class="c-op">작전 ' + op.no + ' <span>/ 5</span> · ' + esc(op.name) + '</div>' +
      '<div class="c-when mono">' + esc(op.when) + '</div></div>' +
      '<button type="button" class="c-btn dim" data-title>처음 화면</button></div>' +
      '<div class="c-grid">' +
      '<div class="c-doc">' +
      '<dl class="c-brief">' +
      '<dt>1. 상황</dt><dd>' + esc(b.situation) + '</dd>' +
      '<dt>2. 임무</dt><dd><b>' + esc(b.mission) + '</b></dd>' +
      '<dt>적 정보</dt><dd>' + esc(b.enemy) + '</dd>' +
      '<dt>아군</dt><dd>' + esc(b.friendly) + '</dd>' +
      '<dt>시간대</dt><dd>' + esc(op.when) + (op.light === 'night' ? ' — 어둠 속에서는 K1A2 열상장비가 유리, 적은 잘 못 본다.' : ' — 양쪽 모두 멀리 본다.') + '</dd>' +
      '<dt class="ok">승리 조건</dt><dd>' + esc(b.win) + '</dd>' +
      '<dt class="bad">실패</dt><dd>' + esc(b.lose) + ' 작전에 실패해도 캠페인은 계속되지만 다음 작전이 불리해진다. 살아남은 전차가 2대 미만이 되면 소대 붕괴로 끝.</dd>' +
      '</dl>' +
      (press ? '<p class="c-press">⚠ ' + esc(press) + '</p>' : '') +
      '<p class="c-tip"><b>장만석 상사</b> ' + esc(b.tip) + '</p>' +
      '</div>' +
      '<div class="c-side"><canvas class="c-map" aria-label="작전 지도 요약"></canvas>' +
      '<p class="c-legend"><i class="lg-u"></i>아군 시작 <i class="lg-e"></i>적 진입·진지 <i class="lg-m"></i>목표·저지선</p></div>' +
      '</div>' +
      '<div class="c-sec">편성과 탄약 <span class="sub">— 1조(1·2호차)·2조(3·4호차) 편성은 고정. 전차마다 가진 탄 안에서 철갑탄/고폭탄 비율을 고른다.</span></div>' +
      '<p class="c-ammo-help">철갑탄: 사거리 3km, 개활지 원거리 전차전용. 고폭탄: 사거리 2.5km, 숲·건물 사이에 숨은 표적이나 차체 엄폐 표적에도 잘 맞는다. 승무원은 표적에 맞춰 알아서 골라 쏜다.</p>' +
      '<div class="c-tanks">' + rows + '</div>' +
      '<div class="c-presets"><span class="sub">한꺼번에:</span>' +
      '<button type="button" class="c-btn dim" data-preset="24">철갑 위주 24/8</button>' +
      '<button type="button" class="c-btn dim" data-preset="20">기본 20/12</button>' +
      '<button type="button" class="c-btn dim" data-preset="12">고폭 위주 12/20</button>' +
      '<button type="button" class="c-btn dim" data-preset="op">권장 (' + op.ammo + '/' + (32 - op.ammo) + ')</button></div>' +
      '<div class="c-nav"><span class="c-gap">전차 ' + alive.length + '대 출동 · 작전 지도에서 스페이스바를 누르면 작전 개시</span>' +
      '<button type="button" class="r-btn s-go" data-go data-focus>출동 ▸</button></div>',
      'orders'
    );
    const cv = el.querySelector('.c-map');
    requestAnimationFrame(() => drawOverview(cv, spec));
    const sync = (id) => {
      const tot = C().total(s.tanks[id].ammo);
      el.querySelector('[data-ap="' + id + '"]').textContent = s.plan[id];
      el.querySelector('[data-he="' + id + '"]').textContent = tot - s.plan[id];
      el.querySelector('[data-plan="' + id + '"]').value = s.plan[id];
    };
    el.querySelectorAll('[data-plan]').forEach((r) => r.addEventListener('input', () => {
      const id = Number(r.dataset.plan);
      C().setPlan(s, id, Number(r.value));
      sync(id);
    }));
    el.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
      const v = btn.dataset.preset === 'op' ? op.ammo : Number(btn.dataset.preset);
      for (const id of alive) { C().setPlan(s, id, Math.round((v / 32) * C().total(s.tanks[id].ammo))); sync(id); }
    }));
    on('[data-title]', () => { C().save(s); title(); });
    on('[data-go]', () => {
      C().applyPlan(s);
      C().save(s);
      close();
      h.battle(s);
    });
  }

  // ---------------------------------------------------------------- 재정비
  function refitScreen(s) {
    const r = s.refit;
    const last = s.history[s.history.length - 1];
    const P = PART_NAMES();
    const res = last.result;
    const tankRows = r.tanks.map((t) => {
      const team = t.id <= 2 ? 1 : 2;
      if (!t.alive) return '<li class="team-' + team + ' dead"><b>' + t.id + '호차</b> ' + (t.lostNow ? '<span class="bad">이번 작전에서 격파</span> — 승무원 후송. 다음 작전 불참 (보충은 아직 없음)' : '작전 ' + t.lostIn + '에서 격파 — 불참') + '</li>';
      const bits = [];
      bits.push('탄약 ' + t.ammoBefore + ' → <b>' + t.ammoAfter + '</b>발');
      if (t.repaired.length) bits.push('<span class="ok">수리: ' + t.repaired.map((k) => P[k]).join('·') + '</span>');
      if (t.remain.length) bits.push('<span class="bad">수리 못 함: ' + t.remain.map((k) => P[k]).join('·') + '</span>');
      if (!t.repaired.length && !t.remain.length) bits.push('<span class="ok">손상 없음</span>');
      return '<li class="team-' + team + '"><b>' + t.id + '호차</b> ' + bits.join(' · ') + '</li>';
    }).join('');
    const ROLE = TMM.CREW_ROLES;
    const INJ = ['', '경상', '중상'];
    let crewRows = '', lastUnit = null;
    for (const m of r.crew) {
      if (m.unitId !== lastUnit) {
        lastUnit = m.unitId;
        const tr = r.trust[m.unitId];
        const d = tr ? tr[1] - tr[0] : 0;
        crewRows += '<li class="c-crew-head team-' + (m.unitId <= 2 ? 1 : 2) + '">' + m.unitId + '호차' +
          (tr ? ' · 신뢰도 ' + tr[0] + ' → <b class="' + (d > 0 ? 'ok' : d < 0 ? 'bad' : '') + '">' + tr[1] + '</b> (' + (d >= 0 ? '+' : '') + d + ', ' + TMM.Crew.trustLabel(tr[1]) + ')' : ' · 소대장차') +
          (m.alive ? '' : ' · <span class="bad">전차 격파, 후송</span>') + '</li>';
      }
      const bits = [];
      if (m.injBefore) bits.push(m.injAfter < m.injBefore ? '<span class="ok">' + INJ[m.injBefore] + ' → 치료</span>' : '<span class="bad">' + INJ[m.injAfter] + '</span>');
      bits.push('피로 ' + m.fatBefore + (m.fatAfter !== m.fatBefore ? ' → ' + m.fatAfter : ''));
      bits.push('사기 ' + m.morale);
      bits.push('숙련 ' + m.skill + (m.skillGain > 0 ? ' <span class="ok">(+' + m.skillGain + ')</span>' : ''));
      crewRows += '<li class="team-' + (m.unitId <= 2 ? 1 : 2) + (m.injAfter >= 2 ? ' hurt' : '') + (m.alive ? '' : ' dead') + '"><span class="c-role">' + ROLE[m.role].name + '</span> <b>' + esc(m.name) + '</b> ' + m.rank + ' — ' + bits.join(' · ') + '</li>';
    }
    open(
      '<div class="s-kicker">재정비 · 작전 ' + last.no + ' 결과</div>' +
      '<div class="c-res ' + res + '">작전 ' + last.no + ' ' + esc(last.name) + ' — ' + RESULT_NAME[res] + '</div>' +
      '<p class="s-brief">' + esc(last.reason) + ' 적 격파 ' + last.kills + '대' + (last.abandoned ? ' · 유기 ' + last.abandoned : '') + (last.fled ? ' · 퇴각 ' + last.fled : '') + ' / ' + last.enemyTotal + '대, 아군 손실 ' + last.lost.length + '대, ' + last.minutes + '분.' + (last.ff ? ' 오인사격 ' + last.ff + '회.' : '') + '</p>' +
      '<div class="c-sec">전차 <span class="sub">— 자동 재정비: 탄약 보급' + (r.failed ? ' (작전 실패로 보급 차질 — ' + r.cap + '발까지)' : ' (32발까지)') + ', 가벼운 손상(주포·사격통제장치·무전기) 수리. 궤도·엔진 손상은 그대로.</span></div>' +
      '<ul class="c-list">' + tankRows + '</ul>' +
      '<div class="c-sec">승무원 <span class="sub">— 경상 치료, 피로 조금 회복(−20). 중상자는 그대로 근무 (교대·후송 선택은 다음 단계에서).</span></div>' +
      '<ul class="c-list crew">' + crewRows + '</ul>' +
      '<div class="c-nav"><span class="c-gap">자동 저장됨</span><button type="button" class="r-btn" data-next data-focus>작전 ' + (s.op + 1) + ' 명령 받기 ▸</button></div>',
      'refit'
    );
    on('[data-next]', () => { s.refitPending = false; C().save(s); orders(s); });
  }

  // ---------------------------------------------------------------- 엔딩
  function ending(s) {
    const E = D().ENDINGS[s.ending];
    const hist = s.history.map((x) => '<tr class="' + x.result + '"><td>' + x.no + '</td><td>' + esc(x.name) + '</td><td>' + RESULT_NAME[x.result] + '</td><td class="mono">' + x.kills + '/' + x.enemyTotal + '</td><td class="mono">' + x.lost.length + '</td></tr>').join('');
    const alive = C().aliveIds(s);
    open(
      '<div class="s-kicker">엔딩 · 개전 첫 72시간</div>' +
      '<div class="c-end ' + s.ending + '">' + esc(E.title) + '</div>' +
      '<p class="s-brief">' + esc(E.sub) + '</p>' +
      '<table class="c-hist"><thead><tr><th>작전</th><th></th><th>결과</th><th>격파</th><th>손실</th></tr></thead><tbody>' + hist + '</tbody></table>' +
      '<p class="s-brief">살아남은 전차 ' + alive.length + '대 (' + alive.map((i) => i + '호차').join(', ') + ').</p>' +
      '<div class="c-sec">에필로그</div>' +
      linesHtml(C().epilogue(s)) +
      '<div class="c-nav"><button type="button" class="c-btn dim" data-title>처음 화면</button><span class="c-gap"></span><button type="button" class="r-btn" data-new data-focus>새 캠페인</button></div>',
      'ending'
    );
    on('[data-title]', title);
    on('[data-new]', () => { const n = C().newState(); C().save(n); route(n); });
  }

  return { init, title, route, close };
})();
