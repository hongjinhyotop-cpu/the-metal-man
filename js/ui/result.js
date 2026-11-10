/*
 * 승패 결과 화면 (간단판).
 *   승리: 적 천마호 소대를 모두 격파했거나, 전투력을 잃은 적이 북쪽 끝 밖으로 퇴각 / 패배: 아군 3대 이상 격파 (M4)
 */
TMM.Result = (function () {
  let el = null;
  let next = 'training';

  // 한 페이지에서 전투는 한 번만 돈다 → 다음 화면을 정해 두고 페이지를 다시 연다 (main.js showEntry)
  function init() {
    el = document.getElementById('result');
    el.querySelector('[data-restart]').addEventListener('click', () => {
      try { sessionStorage.setItem('tmm.next', next); } catch (e) { /* 저장소 없음 → 처음 화면 */ }
      window.location.reload();
    });
  }

  // M6: 조준 화면에서 직접 쏜 결과와 조준 화면에 있던 시간
  function manualText(game) {
    // M7b: 소대장이 옮겨 탄 전차에서 쏜 것까지 합친다
    let m = null;
    for (const u of game.units) {
      const x = u.stats.manual;
      if (!x) continue;
      m = m || { shots: 0, hits: 0, kills: 0 };
      m.shots += x.shots; m.hits += x.hits; m.kills += x.kills;
    }
    const sec = game.scope ? Math.round(game.scope.time) : 0;
    const t = sec >= 60 ? Math.floor(sec / 60) + '분 ' + (sec % 60) + '초' : sec + '초';
    if (!m || !m.shots) return game.scope && game.scope.opens ? '쏘지 않음 · 조준 화면 ' + t : '쓰지 않음 (포수가 알아서 사격)';
    return m.shots + '발 · 명중 ' + m.hits + ' · 격파 ' + m.kills + ' · 조준 화면 ' + t + ' (실제 시간)';
  }

  // opts.campaign: M7a 캠페인 상태 (이미 결과가 이월·저장됨)
  function show(game, opts) {
    const win = game.over.win;
    const camp = opts && opts.campaign;
    next = camp ? 'campaign' : 'training';
    const lost = game.units.filter((u) => u.destroyed).length;
    // M8a: 전차와 보병 대전차조를 나눠 센다
    const tanks = game.enemies.filter((e) => TMM.VEHICLES[e.model].cls === 'tank');
    const teams = game.enemies.filter((e) => e.model === 'ATINF');
    const kills = tanks.filter((e) => e.destroyed && !e.abandoned).length;
    const aband = tanks.filter((e) => e.abandoned).length;
    const gone = tanks.filter((e) => e.exited && !(e.ai && e.ai.pending)).length;
    const allyLost = game.allies.filter((a) => a.destroyed).length;
    let shots = 0, hits = 0;
    for (const u of game.units) { shots += u.stats.shots; hits += u.stats.hits; }
    const elapsed = game.over.at - game.startSeconds;

    el.classList.toggle('win', win);
    el.classList.toggle('lose', !win);
    const res = game.over.result;
    el.querySelector('.r-title').textContent = camp ? (res === 'success' ? '작전 성공' : res === 'collapse' ? '소대 붕괴' : '작전 실패') : win ? '작전 성공' : '작전 실패';
    el.querySelector('[data-restart]').textContent = !camp ? '다시 하기' : camp.phase === 'ending' ? '엔딩 보기 ▸' : '재정비 ▸';
    el.querySelector('.r-sub').textContent = camp
      ? '작전 ' + game.op.no + ' · ' + game.op.name + ' — ' + game.over.reason + (camp.phase === 'ending' ? '' : ' (자동 저장됨)')
      : !win
      ? '소대 전차 ' + lost + '대가 격파되어 소대가 전투력을 잃었습니다.'
      : gone || aband
        ? '적 전차 소대가 전투력을 잃고 북쪽으로 퇴각했습니다.'
        : '적 전차 소대를 격멸했습니다.';

    const rows = [
      ['적 전차 격파', kills + ' / ' + tanks.length + ' 대' + (aband ? ' (유기 ' + aband + '대 별도)' : '') + (gone ? ' · 퇴각 ' + gone + '대' : '')],
      ...(teams.length ? [['보병 대전차조', '제압 ' + teams.filter((e) => e.destroyed).length + ' · 흩어짐 ' + teams.filter((e) => e.exited).length + ' / ' + teams.length + ' 조']] : []),
      ...(game.missileStats && game.missileStats.n ? [['날아온 미사일', game.missileStats.n + ' 발 (연막·엄폐로 유도가 끊김 ' + game.missileStats.lost + ')']] : []),
      ...(game.indirect && game.indirect.nStrikes ? [['적 포격', game.indirect.nStrikes + ' 회']] : []),
      ['아군 손실', lost + ' / ' + game.units.length + ' 대'],
      ['사용 탄약', shots + ' 발 (명중 ' + hits + ' 발' + (shots ? ', ' + Math.round((hits / shots) * 100) + '%' : '') + ')'],
      ['1호차 직접 조준', manualText(game)],
      ['오인사격', game.ffCount ? game.ffCount + ' 회 — 아군 피해 주의' : '없음'],
      ['비지휘 아군 손실', allyLost ? allyLost + ' (' + game.allies.filter((a) => a.destroyed).map((a) => a.callsign).join(', ') + ')' : '없음'],
      ['작전 시간', camp ? game.op.when : TMM.LIGHT[game.light].name],
      ['작전 경과', TMM.Clock.duration(elapsed) + ' (' + TMM.Clock.format(game.over.at) + ')'],
    ];
    const dl = el.querySelector('.r-stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }

    const ul = el.querySelector('.r-units');
    ul.innerHTML = '';
    for (const u of game.units) {
      const li = document.createElement('li');
      li.className = 'team-' + u.team + (u.destroyed ? ' dead' : '');
      li.textContent = u.callsign + ' — ' + TMM.Damage.summary(u) + ' · 잔탄 ' + TMM.Damage.totalAmmo(u) + '발 · 적 격파 ' + u.stats.kills + '대';
      ul.appendChild(li);
    }

    // M5: 승무원별 한 줄 요약
    const cu = el.querySelector('.r-crew');
    cu.innerHTML = '';
    if (TMM.Crew) {
      let lastUnit = null;
      for (const s of TMM.Crew.summaries(game)) {
        if (s.unit !== lastUnit) {
          lastUnit = s.unit;
          const h = document.createElement('li');
          h.className = 'r-crew-head team-' + s.unit.team;
          h.textContent = s.unit.callsign + (s.unit.crew.trust != null ? ' · 신뢰도 ' + Math.round(s.unit.crew.trust) + ' (' + TMM.Crew.trustLabel(s.unit.crew.trust) + ')' : ' · 소대장차');
          cu.appendChild(h);
        }
        const li = document.createElement('li');
        li.className = 'team-' + s.unit.team + (s.member.injury >= 2 ? ' hurt' : '');
        li.textContent = s.text;
        cu.appendChild(li);
      }
    }
    el.hidden = false;
  }

  return { init, show };
})();
