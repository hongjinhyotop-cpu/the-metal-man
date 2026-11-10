/*
 * 매 프레임 그리기: 지형 레이어 + 이동 경로 + 전차 기호 + 커서 표시.
 * view: 지도 칸 좌표 ↔ 화면 픽셀 변환 정보.
 */
TMM.Renderer = (function () {
  const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

  function createView() {
    return {
      scale: 1, // 화면 px / 칸
      ox: 0,
      oy: 0,
      dpr: 1,
      toScreen(x, y) {
        return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
      },
      toMap(sx, sy) {
        return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
      },
    };
  }

  // 캔버스 크기에 맞춰 지도 전체가 보이도록 배율 계산
  function fit(view, canvas, map) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    view.dpr = dpr;
    const pad = 12;
    view.scale = Math.min((rect.width - pad * 2) / map.cols, (rect.height - pad * 2) / map.rows);
    view.ox = (rect.width - map.cols * view.scale) / 2;
    view.oy = (rect.height - map.rows * view.scale) / 2;
  }

  function drawPath(ctx, view, unit, selected) {
    if (unit.state !== 'moving' || !unit.path.length) return;
    const color = TMM.TEAMS[unit.team].color;
    ctx.save();
    ctx.globalAlpha = selected ? 0.95 : 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    let p = view.toScreen(unit.x, unit.y);
    ctx.moveTo(p.x, p.y);
    for (const pt of unit.path) {
      p = view.toScreen(pt.x, pt.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 목적지 표시 (원 + 십자)
    const d = view.toScreen(unit.dest.x, unit.dest.y);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 7, 0, Math.PI * 2);
    ctx.moveTo(d.x - 11, d.y); ctx.lineTo(d.x - 3, d.y);
    ctx.moveTo(d.x + 3, d.y); ctx.lineTo(d.x + 11, d.y);
    ctx.moveTo(d.x, d.y - 11); ctx.lineTo(d.x, d.y - 3);
    ctx.moveTo(d.x, d.y + 3); ctx.lineTo(d.x, d.y + 11);
    ctx.stroke();
    ctx.font = '600 11px ' + FONT_MONO;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(unit.id), d.x + 8, d.y - 6);
    ctx.restore();
  }

  // 전차 기호: 아군 기갑 부대 기호(사각형 + 타원) + 진행 방향 + 호차 번호
  function drawUnit(ctx, view, unit, selected, time) {
    const team = TMM.TEAMS[unit.team];
    const p = view.toScreen(unit.x, unit.y);
    const W = 26, H = 17;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));

    // 진행 방향 막대
    ctx.strokeStyle = team.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const hx = Math.cos(unit.heading), hy = Math.sin(unit.heading);
    ctx.moveTo(hx * 9, hy * 9);
    ctx.lineTo(hx * 22, hy * 22);
    ctx.stroke();

    // 선택 표시: 모서리 괄호
    if (selected) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.strokeStyle = 'rgba(245, 235, 190,' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 2;
      const bx = W / 2 + 6, by = H / 2 + 6, L = 6;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(sx * bx, sy * (by - L));
        ctx.lineTo(sx * bx, sy * by);
        ctx.lineTo(sx * (bx - L), sy * by);
      }
      ctx.stroke();
    }

    // 본체
    ctx.fillStyle = 'rgba(18, 22, 12, 0.88)';
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.strokeStyle = team.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(-W / 2, -H / 2, W, H);
    ctx.beginPath();
    ctx.ellipse(0, 0, W / 2 - 5, H / 2 - 4.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 호차 번호 꼬리표
    ctx.fillStyle = team.color;
    ctx.fillRect(W / 2 - 1, -H / 2 - 9, 13, 13);
    ctx.fillStyle = '#12160c';
    ctx.font = '700 11px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(unit.id), W / 2 + 5.5, -H / 2 - 2.2);

    // 지휘 차량 표시 (소대장차 깃대, 부소대장차 짧은 깃대)
    if (unit.role === '소대장차' || unit.role === '부소대장차') {
      ctx.strokeStyle = team.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-W / 2, -H / 2);
      ctx.lineTo(-W / 2, -H / 2 - (unit.role === '소대장차' ? 10 : 6));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCursor(ctx, view, game) {
    const h = game.hover;
    if (!h || !game.selectedId) return;
    const info = game.map.infoAt(h.x, h.y);
    if (!info) return;
    const p = view.toScreen(h.x, h.y);
    ctx.save();
    if (info.speed) {
      ctx.strokeStyle = 'rgba(240, 230, 180, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(230, 110, 80, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6);
      ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFrame(ctx, view, game, terrain, time) {
    const { map } = game;
    const dpr = view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#12160d';
    ctx.fillRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

    // 지형
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(terrain, view.ox, view.oy, map.cols * view.scale, map.rows * view.scale);

    // 지도 테두리
    ctx.strokeStyle = 'rgba(200, 200, 150, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, map.cols * view.scale + 1, map.rows * view.scale + 1);

    // 방위 표시
    const nx = view.ox + map.cols * view.scale - 22, ny = view.oy + 30;
    ctx.fillStyle = 'rgba(230, 225, 190, 0.85)';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 16); ctx.lineTo(nx + 7, ny + 4); ctx.lineTo(nx, ny); ctx.lineTo(nx - 7, ny + 4);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 11px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', nx, ny + 7);

    // 축척 막대 (1km)
    const px1km = (1000 / map.metersPerCell) * view.scale;
    const sx = view.ox + 14, sy = view.oy + map.rows * view.scale - 16;
    ctx.fillStyle = 'rgba(15, 20, 10, 0.7)';
    ctx.fillRect(sx - 6, sy - 16, px1km + 40, 24);
    ctx.strokeStyle = 'rgba(230, 225, 190, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy); ctx.lineTo(sx + px1km, sy); ctx.lineTo(sx + px1km, sy - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(230, 225, 190, 0.9)';
    ctx.font = '600 10px ' + FONT_MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('1 km', sx + px1km + 6, sy + 3);

    for (const u of game.units) drawPath(ctx, view, u, u.id === game.selectedId);
    for (const u of game.units) if (u.id !== game.selectedId) drawUnit(ctx, view, u, false, time);
    const sel = game.units.find((u) => u.id === game.selectedId);
    if (sel) drawUnit(ctx, view, sel, true, time);
    drawCursor(ctx, view, game);
  }

  // 화면 좌표에서 가장 가까운 전차 (반경 안)
  function hitUnit(view, units, sx, sy) {
    let best = null, bestD = TMM.CONFIG.UNIT_HIT_RADIUS;
    for (const u of units) {
      const p = view.toScreen(u.x, u.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  return { createView, fit, drawFrame, hitUnit };
})();
