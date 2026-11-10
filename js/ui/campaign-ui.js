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
    const hurt = sv ? sv.members.filter((m) => m.injury >= 2).map((m) => C().crewName(m.key, s).name) : [];
    const fat = sv ? Math.round(sv.members.reduce((a, m) => a + m.fatigue, 0) / sv.members.length) : null;
    const parts = [modelTag(t) + (dmg.length ? ' <span class="bad">' + dmg.join('·') + ' 손상</span>' : ' <span class="ok">차량 정상</span>')];
    if (sv && t.model !== 'K2' && !sv.members.some((m) => m.role === 'loader')) parts.push('<span class="warn">탄약수 없음</span>');
    if (C().leaderTank(s) === id && id !== 1) parts.push('<span class="ok">소대장 동승</span>');
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

  // ---------------------------------------------------------------- 재정비 (M7b)
  // 순서: ① 작전 결과·대대 소식 → ② 승무원 이벤트(1~2개) → ③ 재정비 고르기(시간 나눠 쓰기) → ④ 재정비 결과 → 작전 명령
  let refitStep = null; // 'news' | 'plan' (이벤트는 refitInfo.eventsDone 으로 판단)
  let plan = null;
  const INJ = ['', '경상', '중상'];
  const ROLE_NAME = (r) => TMM.CREW_ROLES[r].name;
  const modelTag = (t) => (t.model === 'K2' ? '<span class="c-k2">K2</span>' : '<span class="c-k1">K1A2</span>');
  const hrs = (h) => (Math.round(h * 10) / 10).toString().replace(/\.0$/, '') + '시간';

  function refitScreen(s) {
    const info = s.refitInfo;
    if (!info) { s.refitPending = false; C().save(s); return orders(s); } // 옛 저장
    if (refitStep !== 'plan') return refitNews(s);
    const ev = (info.events || []).find((id) => !info.eventsDone[id]);
    if (ev) return eventScreen(s, ev);
    return planScreen(s);
  }

  function resultHead(s) {
    const last = s.history[s.history.length - 1];
    const res = last.result;
    return '<div class="c-res ' + res + '">작전 ' + last.no + ' ' + esc(last.name) + ' — ' + RESULT_NAME[res] + '</div>' +
      '<p class="s-brief">' + esc(last.reason) + ' 적 격파 ' + last.kills + '대' + (last.abandoned ? ' · 유기 ' + last.abandoned : '') + (last.fled ? ' · 퇴각 ' + last.fled : '') + ' / ' + last.enemyTotal + '대, 아군 손실 ' + last.lost.length + '대, ' + last.minutes + '분.' + (last.ff ? ' 오인사격 ' + last.ff + '회.' : '') + '</p>';
  }

  // ① 작전 결과와 대대 소식
  function refitNews(s) {
    const info = s.refitInfo;
    const last = s.history[s.history.length - 1];
    const P = PART_NAMES();
    const news = [];
    const lv = s.supply;
    news.push('<li><b>대대 보급 상황: <span class="' + (lv === 2 ? 'ok' : lv === 0 ? 'bad' : '') + '">' + C().K.SUPPLY_NAME[lv] + '</span></b> — 요청하면 소대에 탄 ' + C().K.SUPPLY_POOL[lv] + '발까지' + (lv > 0 ? ' (추가 요청 시 +' + Math.round(C().K.SUPPLY_POOL[lv] * C().K.SUPPLY_EXTRA_MUL) + '발)' : ' (추가 요청 불가)') + '. ' + (last.result === 'fail' ? '작전 실패로 보급이 줄었다.' : last.result === 'success' && lv === 2 ? '' : '작전에 성공하면 나아진다.') + '</li>');
    if (info.k2) {
      news.push('<li class="good"><b>대대가 K2 전차 1대를 보충했다 → 새 ' + info.k2 + '호차.</b> 자동장전(승무원 3명: 전차장·포수·조종수), 120mm 55구경장, 더 빠른 기동과 기동 간 사격. 능동방호장치 없는 기존 양산형.' +
        (info.k2 === 1 ? ' 소대장은 새 1호차에 탄다.' : '') + (info.spare ? ' 남는 탄약수 <b>' + esc(C().crewName(info.spare).name) + ' ' + C().crewName(info.spare).rank + '</b>는 후방 대기 — 아래 배치에서 다른 전차 빈자리에 넣을 수 있다.' : '') + '</li>');
    } else if (info.lostNow && info.lostNow.length || C().IDS.some((id) => !s.tanks[id].alive)) {
      const done = s.history[s.history.length - 1].no;
      news.push('<li>' + (done < C().K.K2_FROM_OP ? '잃은 전차 보충은 작전 2 이후부터 대대가 검토한다.' : s.k2Count >= C().K.K2_MAX ? '대대의 K2 보충은 이미 다 받았다 (캠페인 최대 ' + C().K.K2_MAX + '대).' : '대대에 전차 보충을 요청했지만 이번에는 오지 않았다 (가능성 약 ' + info.k2Chance + '%). 작전 성과가 좋을수록 잘 온다.') + '</li>');
    }
    for (const id in info.light) news.push('<li>' + id + '호차 승무원이 ' + info.light[id].map((k) => P[k]).join('·') + ' 손상을 자체 정비로 고쳤다.</li>');
    for (const k of info.returned) news.push('<li class="good">' + esc(C().crewName(k).name) + ' ' + C().crewName(k).rank + ' — 치료를 마치고 복귀 (후방 대기).</li>');
    const lost = C().IDS.filter((id) => !s.tanks[id].alive);
    if (lost.length) news.push('<li class="bad">잃은 전차: ' + lost.map((id) => id + '호차').join(', ') + ' — 승무원은 후방 대기' + (lost.includes(1) && !info.k2 ? '. 소대장은 ' + C().leaderTank(s) + '호차에 동승해 지휘한다' : '') + '.</li>');
    const tr = info.trust || {};
    const trustRow = [2, 3, 4].filter((id) => tr[id] && s.tanks[id].alive).map((id) => { const d = tr[id][1] - tr[id][0]; return id + '호차 ' + tr[id][0] + ' → <b class="' + (d > 0 ? 'ok' : d < 0 ? 'bad' : '') + '">' + tr[id][1] + '</b>'; }).join(' · ');
    if (trustRow) news.push('<li>신뢰도: ' + trustRow + '</li>');
    open(
      '<div class="s-kicker">재정비 · 작전 ' + last.no + ' 결과</div>' + resultHead(s) +
      '<div class="c-sec">대대 소식</div><ul class="c-news">' + news.join('') + '</ul>' +
      '<p class="c-ammo-help">다음 작전(작전 ' + (s.op + 1) + ')까지 <b>' + info.hours + '시간</b>. 정비·보급·휴식·부상자 처리에 시간이 든다 — 다 할 수는 없으니 우선순위를 고른다.</p>' +
      '<div class="c-nav"><span class="c-gap">자동 저장됨</span><button type="button" class="r-btn" data-next data-focus>재정비 시작 ▸</button></div>',
      'refit'
    );
    on('[data-next]', () => { refitStep = 'plan'; plan = null; refitScreen(s); });
  }

  // ② 승무원 이벤트
  function eventScreen(s, id) {
    const ev = TMM.CREW_EVENTS.find((e) => e.id === id);
    const info = s.refitInfo;
    const idx = info.events.indexOf(id);
    const choices = C().eventChoices(s, ev);
    const lines = ev.lines.map(([k, t]) => [k === 'recruit' ? recruitKey(s) : k, t]);
    open(
      '<div class="s-kicker">재정비 · 승무원 ' + (idx + 1) + ' / ' + info.events.length + '</div>' +
      '<div class="c-scene"><span class="mono">' + esc(ev.title) + '</span> ' + esc(ev.place) + '</div>' +
      linesHtml(lines) +
      '<div class="c-choices">' + choices.map(({ c, i }) => '<button type="button" class="c-choice" data-choice="' + i + '"' + (i === choices[0].i ? ' data-focus' : '') + '>' + esc(c.label) + '</button>').join('') + '</div>',
      'refit event'
    );
    el.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => {
      const r = C().chooseEvent(s, id, Number(b.dataset.choice));
      C().save(s);
      const fx = r.changes.map((x) => '<span class="' + (x.what === '피로' ? (x.d < 0 ? 'ok' : 'bad') : x.d > 0 ? 'ok' : 'bad') + '">' + esc(x.who) + ' ' + x.what + ' ' + (x.d > 0 ? '+' : '') + x.d + '</span>').join(' · ');
      open(
        '<div class="s-kicker">재정비 · 승무원 ' + (idx + 1) + ' / ' + info.events.length + '</div>' +
        '<div class="c-scene"><span class="mono">' + esc(ev.title) + '</span> ' + esc(ev.place) + '</div>' +
        linesHtml(lines) + '<p class="c-picked">▸ ' + esc(ev.choices[Number(b.dataset.choice)].label) + '</p>' + linesHtml(r.lines) +
        (fx ? '<p class="c-fx">' + fx + '</p>' : '') +
        '<div class="c-nav"><span class="c-gap"></span><button type="button" class="r-btn" data-next data-focus>계속 ▸</button></div>',
        'refit event'
      );
      on('[data-next]', () => refitScreen(s));
    }));
  }
  function recruitKey(s) {
    const r = C().present(s).find((x) => { const d = C().crewName(x.m.key, s); return d && d.recruit; });
    return r ? r.m.key : 'note';
  }

  // ③ 재정비 고르기
  function personLabel(s, key, role) {
    if (key === 'NEW') return '대대 보충병 (새 신병)';
    const p = C().personInfo(s, key);
    if (!p) return key;
    const bits = [p.name + ' ' + p.rank, ROLE_NAME(p.trained) + (role && p.trained !== role ? ' 출신' : ''), '숙련 ' + Math.round(p.m.skill)];
    if (p.m.injury) bits.push(INJ[p.m.injury]);
    return bits.join(' · ');
  }
  function seatOptions(s, id, role) {
    const cur = plan.seats[id][role];
    const opts = [];
    const add = (v, label, group) => opts.push({ v, label, group });
    if (cur && cur !== 'NEW') add(cur, personLabel(s, cur, role), '지금');
    for (const x of C().present(s)) {
      const k = x.m.key;
      if (k === cur || C().personInfo(s, k).player || plan.wounded[k] === 'evac') continue;
      const at = C().seatOf(plan, k);
      // 다른 전차 사람은 같은 보직만 (목록이 너무 길어지지 않게). 후방 대기는 모두.
      if (at) { if (C().personInfo(s, k).trained === role) add(k, personLabel(s, k, role) + ' — ' + at.id + '호차 ' + ROLE_NAME(at.role) + ' 자리와 맞바꿈', '다른 전차'); }
      else add(k, personLabel(s, k, role), '후방 대기');
    }
    add('NEW', '대대 보충병 (새 신병, 숙련 20~32)', '보충');
    if (!C().REQUIRED.includes(role)) add('', '비워 둠 — 포수가 대신 장전 (장전 느림)', '보충');
    return opts;
  }

  function planScreen(s) {
    const info = s.refitInfo;
    if (!plan) plan = C().recommend(s);
    const cost = C().planCost(s, plan);
    const P = PART_NAMES();
    const alive = C().aliveIds(s);
    const over = cost.left < -1e-6;
    const pct = Math.min(100, (cost.used / cost.hours) * 100);
    // 시간 막대
    const timeBar = '<div class="c-time' + (over ? ' over' : '') + '"><div class="c-time-h"><b>재정비 시간</b> <span class="mono">' + hrs(cost.used) + ' / ' + hrs(cost.hours) + '</span> <span class="' + (over ? 'bad' : 'sub') + '">' + (over ? '· ' + hrs(-cost.left) + ' 초과 — 줄여야 확정할 수 있다' : '· 남은 ' + hrs(cost.left)) + '</span></div>' +
      '<div class="c-time-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="c-time-items">' + (cost.items.length ? cost.items.map((x) => '<span>' + esc(x.what) + ' <b class="mono">' + hrs(x.h) + '</b></span>').join('') : '<span class="sub">아직 아무것도 고르지 않음</span>') + '</div></div>';
    // 정비
    const repairRows = alive.map((id) => {
      const t = s.tanks[id];
      const heavy = C().K.HEAVY_PARTS.filter((k) => t.damage[k]);
      const team = id <= 2 ? 1 : 2;
      const bits = heavy.length ? heavy.map((k) => '<label class="c-chk"><input type="checkbox" data-repair="' + id + ':' + k + '"' + (plan.repair[id][k] ? ' checked' : '') + '> ' + P[k] + ' 수리 <span class="mono">' + C().K.REPAIR_H[k] + '시간</span> <span class="sub">— 안 고치면 ' + (k === 'track' ? '움직일 수 없음' : '속도 절반') + '</span></label>').join('') : '<span class="ok">큰 손상 없음</span>';
      return '<div class="c-row team-' + team + '"><b>' + id + '호차</b> ' + modelTag(t) + (t.isNew ? ' <span class="ok">새 전차</span>' : '') + ' ' + bits + '</div>';
    }).join('');
    // 보급
    const pv = C().supplyPreview(s, plan);
    const lv = s.supply;
    const supBtn = (v, label, h, dis) => '<button type="button" class="c-seg' + (plan.supply === v ? ' on' : '') + '" data-supply="' + v + '"' + (dis ? ' disabled' : '') + '>' + label + (h ? ' <span class="mono">' + h + '</span>' : '') + '</button>';
    const ammoRows = alive.map((id) => { const t = s.tanks[id]; const now = C().total(t.ammo); const mx = C().ammoMax(t); const after = pv.after[id]; return '<span class="c-ammo-t"><b>' + id + '호차</b> <span class="mono">' + now + (after > now ? ' → <b class="ok">' + after + '</b>' : '') + ' / ' + mx + '</span></span>'; }).join('');
    // 휴식
    const fatAvg = Math.round(avg(C().present(s).filter((x) => x.tank).map((x) => x.m.fatigue)));
    const fatAfter = Math.max(C().K.FATIGUE_MIN, fatAvg - C().K.BASE_FATIGUE - C().K.REST_FATIGUE * plan.rest);
    // 부상자
    const wounded = C().woundedList(s);
    const woundRows = wounded.length ? wounded.map((x) => {
      const k = x.m.key, p = C().personInfo(s, k), v = plan.wounded[k];
      const heavy = x.m.injury >= 2;
      const at = C().seatOf(plan, k) || plan.prevSeat[k];
      return '<div class="c-row' + (heavy ? ' hurt' : '') + '"><b>' + esc(p.name) + '</b> ' + p.rank + ' <span class="sub">' + ROLE_NAME(p.trained) + (at ? ' · ' + at.id + '호차' : ' · 후방 대기') + '</span> <span class="' + (heavy ? 'bad' : 'warn') + '">' + INJ[x.m.injury] + '</span>' +
        '<span class="c-segs">' +
        '<button type="button" class="c-seg' + (v === 'evac' ? ' on' : '') + '" data-wound="' + k + ':evac">후송 <span class="mono">' + hrs(C().K.EVAC_H) + '</span></button>' +
        '<button type="button" class="c-seg' + (v === 'keep' ? ' on' : '') + '" data-wound="' + k + ':keep">' + (heavy ? '데리고 감' : '남겨서 싸움') + '</button></span>' +
        '<span class="c-row-note sub">' + (heavy ? (v === 'evac' ? '72시간 안에 돌아오지 못한다.' : '실력 절반으로 계속 근무. 낫지 않는다.') : v === 'evac' ? '1~2작전 뒤 복귀.' : '실력 ×0.85. ' + C().K.HEAL_REST_H + '시간 이상 쉬면 낫는다.') + '</span></div>';
    }).join('') : '<p class="sub c-none">부상자 없음.</p>';
    // 승무원 배치
    const seatCards = alive.map((id) => {
      const t = s.tanks[id];
      const team = id <= 2 ? 1 : 2;
      const rows = C().seatRoles(t).map((role) => {
        const cur = plan.seats[id][role];
        const p = cur && cur !== 'NEW' ? C().personInfo(s, cur) : null;
        if (p && p.player) return '<div class="c-seat"><span class="c-role">' + ROLE_NAME(role) + '</span><span class="c-seat-fixed">소대장 (나)</span></div>';
        const opts = seatOptions(s, id, role);
        let html = '<select data-seat="' + id + ':' + role + '" aria-label="' + id + '호차 ' + ROLE_NAME(role) + '">';
        if (!cur) html += '<option value="" selected>— 빈자리 —</option>';
        let grp = null;
        for (const o of opts) {
          if (o.group !== grp) { if (grp) html += '</optgroup>'; grp = o.group; html += '<optgroup label="' + esc(grp) + '">'; }
          if (o.v === '' && !cur) continue;
          html += '<option value="' + esc(o.v) + '"' + ((o.v || '') === (cur || '') ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }
        html += '</optgroup></select>';
        const warn = !cur ? '<span class="bad">비었음' + (role === 'loader' ? ' — 포수가 장전 (느림)' : '') + '</span>' : cur === 'NEW' ? '<span class="sub">신병 — 숙련 낮음</span>' : p.trained !== role ? '<span class="warn">' + ROLE_NAME(p.trained) + ' 출신 — 실력 ×0.85</span>' : '<span class="sub">피로 ' + Math.round(p.m.fatigue) + ' · 사기 ' + Math.round(p.m.morale) + '</span>';
        return '<div class="c-seat"><span class="c-role">' + ROLE_NAME(role) + '</span>' + html + warn + '</div>';
      }).join('');
      return '<div class="c-crewcard team-' + team + '"><div class="c-tank-h"><b>' + id + '호차</b> ' + modelTag(t) + (t.model === 'K2' ? ' <span class="sub">자동장전 · 3명</span>' : '') + '</div>' + rows + '</div>';
    }).join('');
    const reserve = C().present(s).filter((x) => !C().seatOf(plan, x.m.key) && !C().personInfo(s, x.m.key).player && plan.wounded[x.m.key] !== 'evac');
    const reserveHtml = reserve.length ? '<p class="c-reserve"><b>후방 대기:</b> ' + reserve.map((x) => { const p = C().personInfo(s, x.m.key); return esc(p.name + ' ' + p.rank) + ' <span class="sub">(' + ROLE_NAME(p.trained) + (x.m.injury ? ', ' + INJ[x.m.injury] : '') + (x.m.spare ? ', K2 보충으로 남음' : '') + ')</span>'; }).join(' · ') + '</p>' : '';
    const leaderNote = !s.tanks[1].alive ? '<p class="c-ammo-help">1호차가 없어 소대장은 ' + C().leaderTank(s) + '호차에 동승해 지휘한다 (조준 화면도 그 전차 기준).</p>' : '';

    const st = el.scrollTop;
    open(
      '<div class="c-order-head"><div><div class="s-kicker">재정비 · 작전 ' + (s.op + 1) + ' 준비</div><div class="c-op">재정비 <span>/ 작전 ' + (s.op + 1) + ' ' + esc(D().OPS[s.op].name) + ' 앞</span></div></div>' +
      '<button type="button" class="c-btn" data-rec title="M7a 의 자동 재정비처럼: 보급 → 중상자 후송 → 궤도·엔진 → 남은 시간 휴식, 빈자리는 후방 대기·보충병">추천대로 하기</button></div>' +
      timeBar +
      '<div class="c-sec">정비 <span class="sub">— 궤도·엔진 같은 큰 손상은 오래 걸린다. 주포·사통·무전기는 승무원이 이미 자체 정비했다.</span></div>' + repairRows +
      '<div class="c-sec">보급 <span class="sub">— 대대 보급 상황 <b class="' + (lv === 2 ? 'ok' : lv === 0 ? 'bad' : '') + '">' + C().K.SUPPLY_NAME[lv] + '</b>: 요청하면 ' + C().K.SUPPLY_POOL[lv] + '발, 탄이 적은 전차부터 채운다.</span></div>' +
      '<div class="c-segs">' + supBtn(0, '안 받음', '') + supBtn(1, '탄약 요청', '1시간') + supBtn(2, '추가 요청까지', '2시간', !pv.extraOk) + '</div>' +
      '<div class="c-ammo-list">' + ammoRows + (plan.supply ? ' <span class="sub">받는 탄 ' + pv.used + '발</span>' : '') + '</div>' +
      '<div class="c-sec">휴식 <span class="sub">— 1시간마다 피로 −' + C().K.REST_FATIGUE + ', 사기 +' + C().K.REST_MORALE + '. ' + C().K.HEAL_REST_H + '시간 이상 쉬면 남긴 경상자가 낫는다.</span></div>' +
      '<div class="c-segs"><button type="button" class="c-seg" data-rest="-1" aria-label="휴식 줄이기">−</button><span class="c-rest mono">' + plan.rest + '시간</span><button type="button" class="c-seg" data-rest="1" aria-label="휴식 늘리기">+</button>' +
      '<span class="sub">전차 승무원 평균 피로 ' + fatAvg + ' → <b class="' + (fatAfter <= 20 ? 'ok' : fatAfter >= 50 ? 'bad' : '') + '">' + fatAfter + '</b> <span class="sub">(20 넘으면 실력이 떨어지기 시작)</span></span></div>' +
      '<div class="c-sec">부상자 처리</div>' + woundRows +
      '<div class="c-sec">승무원 배치 <span class="sub">— 빈자리는 대대 보충병(능력 낮은 신병)이나 다른 전차·후방 대기 승무원으로. 다른 전차 사람을 고르면 서로 자리를 바꾼다. 전차장·포수·조종수는 비울 수 없다.</span></div>' +
      leaderNote + '<div class="c-crewcards">' + seatCards + '</div>' + reserveHtml +
      '<div class="c-nav"><span class="c-gap">' + (over ? '<span class="bad">시간이 모자란다 — 무엇을 뺄지 고르십시오.</span>' : '남은 시간은 그냥 흘러간다 (휴식에 넣는 게 좋다).') + '</span>' +
      '<button type="button" class="r-btn" data-ok data-focus' + (over ? ' disabled' : '') + '>재정비 확정 ▸</button></div>',
      'refit plan'
    );
    el.scrollTop = st;
    const again = () => planScreen(s);
    on('[data-rec]', () => { plan = C().recommend(s); again(); });
    el.querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('change', () => { const [id, k] = b.dataset.repair.split(':'); plan.repair[id][k] = b.checked; again(); }));
    el.querySelectorAll('[data-supply]').forEach((b) => b.addEventListener('click', () => { plan.supply = Number(b.dataset.supply); again(); }));
    el.querySelectorAll('[data-rest]').forEach((b) => b.addEventListener('click', () => { plan.rest = Math.max(0, Math.min(8, plan.rest + Number(b.dataset.rest))); again(); }));
    el.querySelectorAll('[data-wound]').forEach((b) => b.addEventListener('click', () => { const [k, v] = b.dataset.wound.split(':'); C().setWounded(s, plan, k, v); again(); }));
    el.querySelectorAll('[data-seat]').forEach((sel) => sel.addEventListener('change', () => {
      const [id, role] = sel.dataset.seat.split(':');
      if (!C().assign(s, plan, Number(id), role, sel.value || null)) window.alert('그 자리에는 배치할 수 없습니다' + (sel.value === 'NEW' ? ' (보충병은 한 번에 ' + C().K.RECRUITS_PER_REFIT + '명까지).' : '.'));
      again();
    }));
    on('[data-ok]', () => {
      if (C().planCost(s, plan).left < -1e-6) return;
      const rep = C().applyRefit(s, plan);
      C().save(s);
      plan = null;
      refitStep = null;
      refitReport(s, rep);
    });
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  // ④ 재정비 결과
  function refitReport(s, rep) {
    const P = PART_NAMES();
    const nm = (k) => { const d = C().crewName(k, s); return d ? (d.player ? '소대장' : d.name + ' ' + d.rank) : k; };
    const li = [];
    for (const id in rep.repaired) li.push('<li class="good">' + id + '호차 ' + rep.repaired[id].map((k) => P[k]).join('·') + ' 수리 완료.</li>');
    for (const id of C().aliveIds(s)) {
      const left = C().K.HEAVY_PARTS.filter((k) => s.tanks[id].damage[k]);
      if (left.length) li.push('<li class="bad">' + id + '호차 ' + left.map((k) => P[k]).join('·') + ' 손상 남음 — ' + (left.includes('track') ? '이번 작전에서 움직일 수 없다.' : '속도 절반.') + '</li>');
    }
    if (rep.supply.requested) li.push('<li>탄약 ' + Object.values(rep.supply.add).reduce((a, b) => a + b, 0) + '발 받음: ' + Object.keys(rep.supply.after).map((id) => id + '호차 ' + rep.supply.after[id] + '발').join(' · ') + '</li>');
    else li.push('<li class="bad">탄약 보급을 받지 않았다: ' + C().aliveIds(s).map((id) => id + '호차 ' + C().total(s.tanks[id].ammo) + '발').join(' · ') + '</li>');
    li.push('<li>휴식 ' + rep.rest + '시간.' + (rep.healed.length ? ' <span class="ok">경상 회복: ' + rep.healed.map(nm).join(', ') + '</span>' : '') + '</li>');
    for (const e of rep.evac) li.push('<li>' + nm(e.key) + ' 후송 — ' + (e.heavy ? '72시간 안에 돌아오지 못한다.' : '작전 ' + (e.back + 1) + ' 앞 재정비에서 복귀 예정.') + '</li>');
    for (const k of rep.kept) li.push('<li class="warn">' + nm(k.key) + ' — ' + INJ[k.injury] + ' 상태로 계속 근무.</li>');
    for (const r of rep.recruits) { const d = C().crewName(r.key, s); li.push('<li>보충병 <b>' + esc(d.name) + ' ' + d.rank + '</b> → ' + r.tank + '호차 ' + ROLE_NAME(r.role) + ' <span class="sub">(' + esc(d.type) + ' · ' + esc(d.about.split(' — ')[1] || '') + ')</span></li>'); }
    for (const m of rep.moved) li.push('<li>' + nm(m.key) + ' → ' + m.to + '호차 ' + ROLE_NAME(m.role) + (m.from ? ' (' + m.from + '호차에서)' : ' (후방 대기에서)') + '</li>');
    if (rep.autoFilled.length) li.push('<li class="warn">빈 필수 자리를 보충병으로 채움: ' + rep.autoFilled.join(', ') + '</li>');
    const threeMan = C().aliveIds(s).filter((id) => s.tanks[id].model !== 'K2' && !s.crew[id].members.some((m) => m.role === 'loader'));
    if (threeMan.length) li.push('<li class="warn">' + threeMan.map((id) => id + '호차').join('·') + ' — 탄약수 없이 3명. 포수가 장전하므로 장전이 느리다.</li>');
    open(
      '<div class="s-kicker">재정비 완료 · ' + hrs(rep.used) + ' / ' + hrs(rep.hours) + ' 사용</div>' +
      '<div class="c-res success">작전 ' + (s.op + 1) + ' 준비 완료</div>' +
      '<ul class="c-news">' + li.join('') + '</ul>' +
      '<div class="c-nav"><span class="c-gap">자동 저장됨</span><button type="button" class="r-btn" data-next data-focus>작전 ' + (s.op + 1) + ' 명령 받기 ▸</button></div>',
      'refit'
    );
    on('[data-next]', () => orders(s));
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
