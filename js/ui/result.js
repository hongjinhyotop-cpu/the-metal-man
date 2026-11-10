/*
 * 승패 결과 화면 (간단판).
 *   승리: 적 천마호 소대를 모두 격파했거나, 전투력을 잃은 적이 북쪽 끝 밖으로 퇴각 / 패배: 아군 3대 이상 격파 (M4)
 */
TMM.Result = (function () {
  let el = null;

  function init() {
    el = document.getElementById('result');
    el.querySelector('[data-restart]').addEventListener('click', () => window.location.reload());
  }

  // M6: 조준 화면에서 직접 쏜 결과와 조준 화면에 있던 시간
  function manualText(game) {
    const u = game.units.find((x) => x.id === 1);
    const m = u && u.stats.manual;
    const sec = game.scope ? Math.round(game.scope.time) : 0;
    const t = sec >= 60 ? Math.floor(sec / 60) + '분 ' + (sec % 60) + '초' : sec + '초';
    if (!m || !m.shots) return game.scope && game.scope.opens ? '쏘지 않음 · 조준 화면 ' + t : '쓰지 않음 (포수 김태윤 상병이 사격)';
    return m.shots + '발 · 명중 ' + m.hits + ' · 격파 ' + m.kills + ' · 조준 화면 ' + t + ' (실제 시간)';
  }

  function show(game) {
    const win = game.over.win;
    const lost = game.units.filter((u) => u.destroyed).length;
    const kills = game.enemies.filter((e) => e.destroyed && !e.abandoned).length;
    const aband = game.enemies.filter((e) => e.abandoned).length;
    const gone = game.enemies.filter((e) => e.exited).length;
    const allyLost = game.allies.filter((a) => a.destroyed).length;
    let shots = 0, hits = 0;
    for (const u of game.units) { shots += u.stats.shots; hits += u.stats.hits; }
    const elapsed = game.over.at - game.startSeconds;

    el.classList.toggle('win', win);
    el.classList.toggle('lose', !win);
    el.querySelector('.r-title').textContent = win ? '작전 성공' : '작전 실패';
    el.querySelector('.r-sub').textContent = !win
      ? '소대 전차 ' + lost + '대가 격파되어 소대가 전투력을 잃었습니다.'
      : gone || aband
        ? '적 천마호 소대가 전투력을 잃고 북쪽으로 퇴각했습니다.'
        : '적 천마호 전차 소대를 격멸했습니다.';

    const rows = [
      ['적 전차 격파', kills + ' / ' + game.enemies.length + ' 대' + (aband ? ' (유기 ' + aband + '대 별도)' : '') + (gone ? ' · 퇴각 ' + gone + '대' : '')],
      ['아군 손실', lost + ' / ' + game.units.length + ' 대'],
      ['사용 탄약', shots + ' 발 (명중 ' + hits + ' 발' + (shots ? ', ' + Math.round((hits / shots) * 100) + '%' : '') + ')'],
      ['1호차 직접 조준', manualText(game)],
      ['오인사격', game.ffCount ? game.ffCount + ' 회 — 아군 피해 주의' : '없음'],
      ['비지휘 아군 손실', allyLost ? allyLost + ' (' + game.allies.filter((a) => a.destroyed).map((a) => a.callsign).join(', ') + ')' : '없음'],
      ['작전 시간', TMM.LIGHT[game.light].name],
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
