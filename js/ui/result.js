/*
 * 승패 결과 화면 (간단판).
 *   승리: 적 천마호 소대 4대 모두 격파 / 패배: 아군 4대 모두 격파
 */
TMM.Result = (function () {
  let el = null;

  function init() {
    el = document.getElementById('result');
    el.querySelector('[data-restart]').addEventListener('click', () => window.location.reload());
  }

  function show(game) {
    const win = game.over.win;
    const lost = game.units.filter((u) => u.destroyed).length;
    const kills = game.enemies.filter((e) => e.destroyed).length;
    let shots = 0, hits = 0;
    for (const u of game.units) { shots += u.stats.shots; hits += u.stats.hits; }
    const elapsed = game.over.at - TMM.CONFIG.START_SECONDS;

    el.classList.toggle('win', win);
    el.classList.toggle('lose', !win);
    el.querySelector('.r-title').textContent = win ? '작전 성공' : '작전 실패';
    el.querySelector('.r-sub').textContent = win ? '적 천마호 전차 소대를 격멸했습니다.' : '소대의 전차가 모두 격파되었습니다.';

    const rows = [
      ['적 전차 격파', kills + ' / ' + game.enemies.length + ' 대'],
      ['아군 손실', lost + ' / ' + game.units.length + ' 대'],
      ['사용 탄약', shots + ' 발 (명중 ' + hits + ' 발' + (shots ? ', ' + Math.round((hits / shots) * 100) + '%' : '') + ')'],
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
    el.hidden = false;
  }

  return { init, show };
})();
