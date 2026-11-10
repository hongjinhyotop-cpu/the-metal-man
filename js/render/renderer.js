/*
 * 매 프레임 그리기: 지형 레이어 + 이동 경로 + 사격선 + 전차 기호(아군·적) + 사격 효과 + 커서 표시.
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
    const team = unit.destroyed ? DEAD_TEAM : TMM.TEAMS[unit.team];
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
    drawDamageMarks(ctx, unit, W, H);
    ctx.restore();
  }

  const DEAD_TEAM = { color: '#7d7a6a', dark: '#2a2a22' };
  const ENEMY_COLOR = '#e0563f';

  // 격파: 굵은 X / 손상: 기호 아래 작은 칸 (궤도·엔진·주포·사통·무전)
  function drawDamageMarks(ctx, unit, W, H) {
    if (unit.destroyed) {
      ctx.strokeStyle = '#e8573f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-W / 2 - 2, -H / 2 - 2); ctx.lineTo(W / 2 + 2, H / 2 + 2);
      ctx.moveTo(W / 2 + 2, -H / 2 - 2); ctx.lineTo(-W / 2 - 2, H / 2 + 2);
      ctx.stroke();
      return;
    }
    const keys = TMM.PART_KEYS;
    if (!keys.some((k) => unit.damage[k])) return;
    const s = 4, gap = 1.5, total = keys.length * s + (keys.length - 1) * gap;
    let x = -total / 2;
    const y = H / 2 + 4;
    for (const k of keys) {
      ctx.fillStyle = unit.damage[k] ? '#e8573f' : 'rgba(150, 160, 120, 0.55)';
      ctx.fillRect(x, y, s, s);
      x += s + gap;
    }
  }

  // 적 전차 기호: 적대 부대 기호(마름모) + 기갑 타원 + 번호
  function drawEnemy(ctx, view, e, hovered, targeted) {
    const p = view.toScreen(e.x, e.y);
    const R = 13;
    const color = e.destroyed ? DEAD_TEAM.color : ENEMY_COLOR;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));

    if (!e.destroyed) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
      ctx.moveTo(hx * 12, hy * 12);
      ctx.lineTo(hx * 22, hy * 22);
      ctx.stroke();
    }

    ctx.fillStyle = e.destroyed ? 'rgba(30, 28, 24, 0.85)' : 'rgba(40, 12, 8, 0.88)';
    ctx.beginPath();
    ctx.moveTo(0, -R); ctx.lineTo(R, 0); ctx.lineTo(0, R); ctx.lineTo(-R, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.5, 3.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 번호 꼬리표
    ctx.fillStyle = color;
    ctx.fillRect(R - 2, -R - 1, 13, 13);
    ctx.fillStyle = '#1a0a06';
    ctx.font = '700 11px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(e.num), R + 4.5, -R + 5.8);

    if (targeted || hovered) {
      ctx.strokeStyle = targeted ? 'rgba(255, 120, 90, 0.95)' : 'rgba(245, 235, 190, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(dx * (R + 3), dy * (R + 3));
        ctx.lineTo(dx * (R + 10), dy * (R + 10));
      }
      ctx.stroke();
    }
    drawDamageMarks(ctx, e, 20, 20);
    ctx.restore();
  }

  // 선택 전차의 사격선: 지정 목표는 실선, 자동 교전은 점선
  function drawFireLine(ctx, view, game, unit) {
    if (!unit || unit.destroyed) return;
    const tid = unit.fire.targetId != null ? unit.fire.targetId : unit.targetId;
    const t = game.enemies.find((e) => e.id === tid && !e.destroyed);
    if (!t) return;
    const a = view.toScreen(unit.x, unit.y), b = view.toScreen(t.x, t.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 120, 90, 0.75)';
    ctx.lineWidth = 1.5;
    if (unit.targetId !== t.id) ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // 사거리 원 (선택 전차, 현재 탄종)
  function drawRange(ctx, view, game, unit) {
    if (!unit || unit.destroyed) return;
    const p = view.toScreen(unit.x, unit.y);
    const r = (TMM.AMMO[unit.ammoType].rangeM / game.map.metersPerCell) * view.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 225, 160, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 사격 효과: 예광탄 궤적 + 맞은 곳 섬광
  function drawFx(ctx, view, game, now) {
    const life = TMM.CONFIG.FX_SECONDS;
    for (const f of game.fx) {
      const k = (now - f.t) / life;
      if (k < 0 || k > 1) continue;
      const a = view.toScreen(f.x0, f.y0), b = view.toScreen(f.x1, f.y1);
      let ex = b.x, ey = b.y;
      if (!f.hit) {
        // 빗나간 탄은 표적 옆으로 지나간다
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        ex = b.x + (dx / L) * 14 - (dy / L) * 9;
        ey = b.y + (dy / L) * 14 + (dx / L) * 9;
      }
      const head = Math.min(1, k * 4); // 예광탄이 날아가는 정도
      const tail = Math.max(0, head - 0.35);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.side === 'friend' ? '#ffe08a' : '#ff8a6a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x + (ex - a.x) * tail, a.y + (ey - a.y) * tail);
      ctx.lineTo(a.x + (ex - a.x) * head, a.y + (ey - a.y) * head);
      ctx.stroke();
      // 포구 섬광
      if (k < 0.25) {
        ctx.fillStyle = '#fff2c0';
        ctx.beginPath();
        ctx.arc(a.x, a.y, 5 * (1 - k * 4), 0, Math.PI * 2);
        ctx.fill();
      }
      // 피탄
      if (head >= 1 && f.hit) {
        const r = f.kill ? 16 : f.pen ? 10 : 6;
        ctx.fillStyle = f.kill ? '#ff6a2a' : f.pen ? '#ffb347' : '#e8e0c0';
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.beginPath();
        ctx.arc(ex, ey, r * (0.6 + k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawCursor(ctx, view, game) {
    const h = game.hover;
    if (!h || !game.selectedId || game.hoverEnemyId != null) return;
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

    const sel = game.units.find((u) => u.id === game.selectedId);
    drawRange(ctx, view, game, sel);
    for (const u of game.units) drawPath(ctx, view, u, u.id === game.selectedId);
    drawFireLine(ctx, view, game, sel);
    for (const e of game.enemies) if (e.destroyed) drawEnemy(ctx, view, e, e.id === game.hoverEnemyId, false);
    for (const u of game.units) if (u.destroyed && u.id !== game.selectedId) drawUnit(ctx, view, u, false, time);
    for (const e of game.enemies) if (!e.destroyed) drawEnemy(ctx, view, e, e.id === game.hoverEnemyId, !!sel && sel.targetId === e.id);
    for (const u of game.units) if (!u.destroyed && u.id !== game.selectedId) drawUnit(ctx, view, u, false, time);
    if (sel) drawUnit(ctx, view, sel, true, time);
    drawFx(ctx, view, game, time);
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
