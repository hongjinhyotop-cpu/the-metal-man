/*
 * M8a 지도 위 새 위협 그리기: 연막 구름, 포격 경고 원(남은 초), 포탄 폭발, 날아오는 미사일, 드론.
 * M7.5 간단 보기 원칙: 꼭 필요한 것만 — 경고 원과 위협 기호만 그리고, 글자는 짧게.
 *   - 미사일·드론은 우리 편이 알아챈 것(경고가 뜬 것·보이는 것)만 그린다 (몰래 보지 않음).
 */
TMM.ThreatLayer = (function () {
  const FONT = '"IBM Plex Mono", monospace';
  const ORANGE = '#ff9a3c';

  function drawSmoke(ctx, view, game) {
    if (!game.smoke || !game.smoke.length) return;
    const now = game.gameSeconds;
    for (const c of game.smoke) {
      const left = c.until - now;
      const a = Math.min(1, left / TMM.SMOKE.FADE_SEC) * 0.62;
      const p = view.toScreen(c.x, c.y);
      const r = TMM.Smoke.radius(game, c) * view.scale;
      ctx.save();
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.15, p.x, p.y, r);
      g.addColorStop(0, 'rgba(205, 205, 195,' + (a * 0.95).toFixed(3) + ')');
      g.addColorStop(0.75, 'rgba(185, 185, 175,' + (a * 0.75).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(170, 170, 160, 0)');
      ctx.fillStyle = g;
      // 몽글몽글한 구름: 겹친 원 몇 개
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + c.born;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(ang) * r * 0.28, p.y + Math.sin(ang) * r * 0.28, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawStrikes(ctx, view, game, time) {
    const now = game.gameSeconds;
    for (const s of TMM.Indirect.warnings(game)) {
      const p = view.toScreen(s.x, s.y);
      const r = s.r * view.scale;
      const left = Math.max(0, s.fireAt - now);
      const blink = left > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 4)) : 1;
      ctx.save();
      ctx.fillStyle = 'rgba(220, 60, 30,' + (0.13 * blink).toFixed(3) + ')';
      ctx.strokeStyle = 'rgba(255, 110, 70,' + (0.9 * blink).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 12px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = left > 0 ? '포격 ' + Math.ceil(left) + '초' : '포격 중';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(40, 8, 4, 0.85)';
      ctx.fillRect(p.x - w / 2, p.y - r - 18, w, 16);
      ctx.fillStyle = '#ffb08a';
      ctx.fillText(label, p.x, p.y - r - 10);
      ctx.restore();
    }
  }

  function drawBooms(ctx, view, game) {
    const ind = game.indirect;
    if (!ind || !ind.booms.length) return;
    const now = game.gameSeconds;
    for (const b of ind.booms) {
      const age = now - b.t;
      if (age < 0 || age > 12) continue;
      const p = view.toScreen(b.x, b.y);
      const k = age / 12;
      ctx.save();
      if (age < 1.5) {
        ctx.fillStyle = b.air ? 'rgba(255, 220, 140, 0.9)' : 'rgba(255, 170, 70,' + (0.9 * (1 - age / 1.5)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, (b.big ? 11 : 7) * (0.6 + age), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!b.air) {
        ctx.fillStyle = 'rgba(60, 55, 45,' + (0.45 * (1 - k)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + k * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawMissiles(ctx, view, game, time) {
    if (!game.missiles) return;
    for (const m of game.missiles) {
      if (m.done || !m.warned) continue; // 우리가 알아챈 미사일만
      const a = view.toScreen(m.sx, m.sy), b = view.toScreen(m.x, m.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 154, 60, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // 미사일 머리 + 노리는 전차 쪽 점선
      if (!m.lost) {
        const t = view.toScreen(m.target.x, m.target.y);
        ctx.strokeStyle = 'rgba(255, 90, 60, 0.5)';
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // 노린 전차 둘레 깜빡이는 고리
        ctx.strokeStyle = 'rgba(255, 110, 70,' + (0.5 + 0.5 * Math.abs(Math.sin(time * 6))).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffe2a0';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = ORANGE;
      ctx.fillText(m.lost ? '유도 끊김' : '미사일 ' + Math.ceil(TMM.Missiles.eta(game, m)) + '초', b.x + 6, b.y - 3);
      ctx.restore();
    }
  }

  function drawDrones(ctx, view, game, time) {
    const ind = game.indirect;
    if (!ind) return;
    for (const d of ind.drones) {
      if (d.gone || !d.seen) continue; // 우리가 알아챈 드론만
      const p = view.toScreen(d.x, d.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = d.kind === 'kami' ? '#ff6a50' : ORANGE;
      ctx.fillStyle = 'rgba(40, 12, 8, 0.85)';
      ctx.lineWidth = 2;
      // 항공 기호: 위가 둥근 반원 + 날개
      ctx.beginPath();
      ctx.moveTo(-9, 3); ctx.lineTo(9, 3); ctx.arc(0, 3, 9, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, -1); ctx.lineTo(5, -1); ctx.moveTo(0, -4); ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(d.kind === 'kami' ? '자폭 드론' : '정찰 드론', 0, 6);
      if (d.kind === 'kami' && d.target && !d.target.destroyed) {
        // 노리는 전차 쪽 짧은 화살
        const t = view.toScreen(d.target.x, d.target.y);
        const ang = Math.atan2(t.y - p.y, t.x - p.x);
        ctx.strokeStyle = 'rgba(255, 106, 80,' + (0.5 + 0.5 * Math.abs(Math.sin(time * 6))).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 12, Math.sin(ang) * 12);
        ctx.lineTo(Math.cos(ang) * 26, Math.sin(ang) * 26);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function draw(ctx, view, game, time) {
    drawStrikes(ctx, view, game, time);
    drawBooms(ctx, view, game);
    drawSmoke(ctx, view, game);
    drawMissiles(ctx, view, game, time);
    drawDrones(ctx, view, game, time);
  }

  return { draw };
})();
