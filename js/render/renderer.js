/*
 * 매 프레임 그리기: 지형 레이어 + (야간 어둠) + (시야 표시) + 이동 경로 + 사격선 + 전차 기호 + 접촉 기호 + 사격 효과 + 커서 표시.
 * view: 지도 칸 좌표 ↔ 화면 픽셀 변환 정보.
 *
 * M3: 적과 비지휘 아군(보병·트럭·K2)은 실제 위치가 아니라 '아군 편 접촉 표'(game.intel.friend)로만 그린다.
 *   보이는 접촉: 지금 위치 / 놓친 접촉: 마지막 위치를 흐리게 / 격파 확인: 잔해 위치.
 *   미상 표적은 노란 '?' 기호, 적으로 식별되면 붉은 마름모, 아군으로 식별되면 푸른 사각형.
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
    if (unit.hullDown && !unit.destroyed) {
      // 차체 엄폐: 기호 아래에 둔덕 모양 (녹색 반원)
      ctx.strokeStyle = '#9cc46a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, H / 2 + 12, W / 2 + 2, Math.PI * 1.15, Math.PI * 1.85);
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
  // pos: 그릴 위치 (접촉의 현재/마지막 위치), ghost: 놓친 접촉(흐리게, 점선)
  function drawEnemy(ctx, view, e, hovered, targeted, pos, ghost) {
    const p = view.toScreen(pos ? pos.x : e.x, pos ? pos.y : e.y);
    const R = 13;
    const dead = e.destroyed;
    const color = dead ? DEAD_TEAM.color : ENEMY_COLOR;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    if (ghost) {
      ctx.globalAlpha = ghost;
      ctx.setLineDash([3, 3]);
    }

    if (!dead && !ghost) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
      ctx.moveTo(hx * 12, hy * 12);
      ctx.lineTo(hx * 22, hy * 22);
      ctx.stroke();
    }

    ctx.fillStyle = dead ? 'rgba(30, 28, 24, 0.85)' : ghost ? 'rgba(40, 12, 8, 0.4)' : 'rgba(40, 12, 8, 0.88)';
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

    ctx.setLineDash([]);
    drawReticle(ctx, R, hovered, targeted);
    if (!ghost) drawDamageMarks(ctx, e, 20, 20);
    if (e.abandoned) {
      ctx.fillStyle = DEAD_TEAM.color;
      ctx.font = '600 10px ' + FONT_MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('유기', 0, R + 3);
    }
    ctx.restore();
  }

  // 조준 표시 (커서가 올라감 / 사격 목표)
  function drawReticle(ctx, R, hovered, targeted) {
    if (!targeted && !hovered) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = targeted ? 'rgba(255, 120, 90, 0.95)' : 'rgba(245, 235, 190, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(dx * (R + 3), dy * (R + 3));
      ctx.lineTo(dx * (R + 10), dy * (R + 10));
    }
    ctx.stroke();
    ctx.restore();
  }

  const UNKNOWN_COLOR = '#e8cf4a';
  const ALLY_COLOR = '#7fb6e8';

  // 미상 표적: 노란 사엽 기호(미상 부대 기호) + '?' + 꼬리표 글자 + 식별 진행 막대
  function drawUnknown(ctx, view, c, pos, hovered, targeted, ghost) {
    const p = view.toScreen(pos.x, pos.y);
    const R = 12;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    if (ghost) {
      ctx.globalAlpha = ghost;
      ctx.setLineDash([3, 3]);
    }
    ctx.fillStyle = ghost ? 'rgba(40, 36, 10, 0.4)' : 'rgba(40, 36, 10, 0.88)';
    ctx.strokeStyle = UNKNOWN_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const r = R * 0.55;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) ctx.moveTo(dx * r + r, dy * r), ctx.arc(dx * r, dy * r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      ctx.moveTo(dx * r + r, dy * r);
      ctx.arc(dx * r, dy * r, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(40, 36, 10, 0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([]);
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.font = '700 12px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 0.5);
    // 꼬리표
    ctx.fillRect(R - 1, -R - 3, 13, 13);
    ctx.fillStyle = '#1a1604';
    ctx.font = '700 10px ' + FONT_MONO;
    ctx.fillText(c.label, R + 5.5, -R + 3.6);
    // 식별 진행 막대
    if (!ghost && c.idProg > 0) {
      ctx.fillStyle = 'rgba(20, 18, 6, 0.85)';
      ctx.fillRect(-R, R + 4, R * 2, 4);
      ctx.fillStyle = UNKNOWN_COLOR;
      ctx.fillRect(-R, R + 4, R * 2 * c.idProg, 4);
    }
    drawReticle(ctx, R, hovered, targeted);
    ctx.restore();
  }

  // 아군으로 식별된 비지휘 부대: 푸른 사각형 + 병과 기호 (보병 X, 트럭 바퀴, 전차 타원)
  function drawAlly(ctx, view, c, pos, hovered, ghost) {
    const u = c.unit;
    const p = view.toScreen(pos.x, pos.y);
    const W = 22, H = 15;
    const dead = u.destroyed;
    const color = dead ? DEAD_TEAM.color : ALLY_COLOR;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    if (ghost) {
      ctx.globalAlpha = ghost;
      ctx.setLineDash([3, 3]);
    }
    ctx.fillStyle = 'rgba(10, 20, 30, 0.85)';
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(-W / 2, -H / 2, W, H);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (c.cls === 'infantry') {
      ctx.moveTo(-W / 2, -H / 2); ctx.lineTo(W / 2, H / 2);
      ctx.moveTo(W / 2, -H / 2); ctx.lineTo(-W / 2, H / 2);
    } else if (c.cls === 'truck') {
      ctx.moveTo(-W / 2 + 3, 0); ctx.lineTo(W / 2 - 3, 0);
      ctx.moveTo(-3, 4); ctx.arc(-5, 4, 2, 0, Math.PI * 2);
      ctx.moveTo(7, 4); ctx.arc(5, 4, 2, 0, Math.PI * 2);
    } else {
      ctx.ellipse(0, 0, W / 2 - 4, H / 2 - 4, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
    // 꼬리표
    const tag = c.cls === 'infantry' ? '보' : c.cls === 'truck' ? '트' : 'K2';
    ctx.font = '700 10px ' + FONT_MONO;
    const tw = Math.max(13, ctx.measureText(tag).width + 5);
    ctx.fillStyle = color;
    ctx.fillRect(W / 2 - 1, -H / 2 - 9, tw, 13);
    ctx.fillStyle = '#081420';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, W / 2 - 1 + tw / 2, -H / 2 - 2.4);
    if (dead || u.hurt) {
      ctx.strokeStyle = '#e8573f';
      ctx.lineWidth = dead ? 3 : 2;
      ctx.beginPath();
      if (dead) {
        ctx.moveTo(-W / 2 - 2, -H / 2 - 2); ctx.lineTo(W / 2 + 2, H / 2 + 2);
        ctx.moveTo(W / 2 + 2, -H / 2 - 2); ctx.lineTo(-W / 2 - 2, H / 2 + 2);
      } else {
        ctx.moveTo(-W / 2, H / 2 + 4); ctx.lineTo(W / 2, H / 2 + 4);
      }
      ctx.stroke();
    }
    drawReticle(ctx, 11, hovered, false);
    ctx.restore();
  }

  // 아군 편이 아는 접촉 하나를 그린다
  function drawContact(ctx, view, game, c, sel) {
    const now = game.gameSeconds;
    const pos = c.visible ? { x: c.unit.x, y: c.unit.y } : { x: c.lastX, y: c.lastY };
    let ghost = 0;
    if (!c.visible && !c.wreck) {
      const age = now - c.lastSeen;
      ghost = Math.max(0.15, 0.55 * (1 - age / TMM.VISION.MEMORY_SEC));
    }
    const hovered = c.id === game.hoverContactId;
    const targeted = !!sel && sel.targetId === c.id;
    if (!c.identified) drawUnknown(ctx, view, c, pos, hovered, targeted, ghost);
    else if (c.kind === 'friendly') drawAlly(ctx, view, c, pos, hovered, ghost);
    else drawEnemy(ctx, view, c.unit, hovered, targeted, pos, ghost);
  }

  // 지도에 그려지는 접촉 목록 (클릭 판정용): [{ id, x, y, contact }]
  function contactMarks(game) {
    const out = [];
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.known) continue; // 무전기 손상 전차만 본 것은 소대 지도에 없다 (M4)
      const x = c.visible ? c.unit.x : c.lastX, y = c.visible ? c.unit.y : c.lastY;
      out.push({ id: c.id, x, y, contact: c, destroyed: c.wreck });
    }
    return out;
  }

  // 선택 전차의 사격선: 지정 목표는 실선, 자동 교전은 점선
  function drawFireLine(ctx, view, game, unit) {
    if (!unit || unit.destroyed) return;
    const tid = unit.fire.targetId != null ? unit.fire.targetId : unit.targetId;
    if (tid == null) return;
    const c = TMM.Intel.contact(game, 'friend', tid);
    if (!c || c.wreck) return;
    const tx = c.visible ? c.unit.x : c.lastX, ty = c.visible ? c.unit.y : c.lastY;
    const a = view.toScreen(unit.x, unit.y), b = view.toScreen(tx, ty);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 120, 90, 0.75)';
    ctx.lineWidth = 1.5;
    if (unit.targetId !== tid || !c.visible) ctx.setLineDash([3, 5]);
    if (!c.identified) ctx.strokeStyle = 'rgba(232, 207, 74, 0.85)'; // 미식별 표적 사격: 노란 선
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

  // ---- M4 무전 지휘 표시 ----
  // 엄호 중인 전차의 감시 부채꼴, 엄호 이동 목표 지점
  function drawOrders(ctx, view, game) {
    const half = (TMM.RADIO.WATCH_HALF_DEG * Math.PI) / 180;
    for (const u of game.units) {
      if (u.destroyed || u.watch == null || u.state === 'moving') continue;
      const p = view.toScreen(u.x, u.y);
      const r = Math.max(34, view.scale * 9);
      const color = TMM.TEAMS[u.team].color;
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, r, u.watch - half, u.watch + half);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, u.watch - half, u.watch + half);
      ctx.stroke();
      ctx.restore();
    }
    const b = game.bound;
    if (b) {
      const p = view.toScreen(b.P.x, b.P.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 225, 160, 0.85)';
      ctx.fillStyle = 'rgba(240, 225, 160, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 8); ctx.lineTo(p.x, p.y - 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x + 11, p.y - 10); ctx.lineTo(p.x, p.y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = '600 10px ' + FONT_MONO;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('엄호 이동 목표 · ' + b.moving + '조 ' + (b.phase === 'moving' ? '전진' : '보고'), p.x + 14, p.y - 10);
      ctx.restore();
    }
  }

  // 전차 위 무전 표시: 명령 전달 중 ((·)), 교신 두절 '무전✕'
  function drawBadges(ctx, view, game, time) {
    const ctrl = TMM.Radio.controlUnit(game);
    for (const u of game.units) {
      if (u.destroyed) continue;
      const p = view.toScreen(u.x, u.y);
      ctx.save();
      ctx.font = '700 10px ' + FONT_MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const pend = TMM.Radio.pendingFor(game, u.id);
      if (pend.length) {
        const st = pend.some((q) => q.state === 'garble' || q.state === 'noack') ? 'garble' : pend[0].state;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 8);
        ctx.fillStyle = st === 'garble' || st === 'noack' ? '#e0805a' : '#f0e6b0';
        ctx.fillText('((·))', p.x - 4, p.y - 15);
      } else if (u !== ctrl && TMM.Radio.linkState(game, u).code === 'dead') {
        ctx.fillStyle = '#ff7a60';
        ctx.fillText('무전✕', p.x - 4, p.y - 15);
      }
      ctx.restore();
    }
  }

  // 명령을 고른 뒤 지도 위에서: 받는 전차들에서 커서까지 미리보기
  const PREVIEW_NAME = { move: '이동', cover: '엄호 방향', bound: '엄호 이동 목표', withdraw: '철수 위치', target: '목표 지정' };
  function drawPreview(ctx, view, game) {
    const mode = game.cmd.mode;
    const h = game.hover;
    if (!mode || !h) return;
    const units = TMM.Command.recipients(game, mode === 'bound' ? 'ALL' : game.cmd.to);
    const hp = view.toScreen(h.x, h.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 230, 180, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash(mode === 'withdraw' ? [2, 4] : [7, 5]);
    if (mode !== 'target') {
      for (const u of units) {
        const p = view.toScreen(u.x, u.y);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(18, 22, 13, 0.85)';
    const label = TMM.Command.specName(game, mode === 'bound' ? 'ALL' : game.cmd.to) + ' · ' + PREVIEW_NAME[mode];
    ctx.font = '600 11px ' + FONT_MONO;
    const w = ctx.measureText(label).width + 10;
    ctx.fillRect(hp.x + 12, hp.y + 8, w, 17);
    ctx.fillStyle = '#f0e6b0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, hp.x + 17, hp.y + 16.5);
    ctx.restore();
  }

  function drawCursor(ctx, view, game) {
    const h = game.hover;
    if (!h || !game.selectedId || game.hoverContactId != null) return;
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

  // M7a 작전 지도 표시: 사수 구역·목표(구역), 저지선·하천선(선), 다리(지점). 작전 명령 화면의 요약 지도도 같이 쓴다.
  //   v: { ox, oy, scale } · marks: game.op.marks · alpha: 진하기
  function drawMarks(ctx, v, marks, alpha) {
    if (!marks || !marks.length) return;
    const P = (x, y) => ({ x: v.ox + x * v.scale, y: v.oy + y * v.scale });
    const small = v.scale < 4;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 0.85 : alpha;
    ctx.font = '700 ' + (small ? 9 : 11) + 'px ' + FONT_MONO;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    const label = (text, x, y, col) => {
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10, 14, 8, 0.75)';
      ctx.fillRect(x - 2, y - (small ? 11 : 14), w + 4, small ? 11 : 14);
      ctx.fillStyle = col;
      ctx.fillText(text, x, y);
    };
    for (const m of marks) {
      const col = m.enemy ? '#ff8a70' : '#9fd0ff';
      ctx.strokeStyle = col;
      ctx.lineWidth = small ? 1.5 : 2;
      ctx.setLineDash(small ? [4, 3] : [8, 5]);
      if (m.type === 'zone') {
        const a = P(m.x0, m.y0), b = P(m.x1, m.y1);
        ctx.fillStyle = m.enemy ? 'rgba(255, 110, 80, 0.07)' : 'rgba(150, 200, 255, 0.06)';
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.setLineDash([]);
        if (m.label) label(m.label, a.x + 3, a.y - 2, col);
      } else if (m.type === 'line') {
        ctx.beginPath();
        m.pts.forEach(([x, y], i) => { const p = P(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        const p0 = P(m.pts[0][0], m.pts[0][1]);
        if (m.label) label(m.label, p0.x + 3, p0.y - 3, col);
      } else if (m.type === 'point') {
        const p = P(m.x, m.y);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, small ? 6 : 12, 0, Math.PI * 2);
        ctx.stroke();
        if (m.label) label(m.label, p.x + (small ? 8 : 15), p.y - (small ? 4 : 8), col);
      }
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

    // 야간: 지도를 어둡게
    if (game.light === 'night') {
      ctx.fillStyle = 'rgba(4, 10, 26, 0.5)';
      ctx.fillRect(view.ox, view.oy, map.cols * view.scale, map.rows * view.scale);
    }

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

    if (game.op) drawMarks(ctx, view, game.op.marks, 0.8); // M7a 작전 목표·저지선

    const sel = game.units.find((u) => u.id === game.selectedId);
    if (sel && game.showSight && !sel.destroyed) drawSight(ctx, view, game, sel);
    drawRange(ctx, view, game, sel);
    drawOrders(ctx, view, game);
    for (const u of game.units) drawPath(ctx, view, u, u.id === game.selectedId);
    drawFireLine(ctx, view, game, sel);
    const contacts = Array.from(game.intel.friend.contacts.values()).filter((c) => c.known);
    // 잔해 → 마지막 위치 → 보이는 접촉 순서로 (보이는 것이 위에)
    for (const c of contacts) if (c.wreck) drawContact(ctx, view, game, c, sel);
    for (const u of game.units) if (u.destroyed && u.id !== game.selectedId) drawUnit(ctx, view, u, false, time);
    for (const c of contacts) if (!c.wreck && !c.visible) drawContact(ctx, view, game, c, sel);
    for (const c of contacts) if (!c.wreck && c.visible) drawContact(ctx, view, game, c, sel);
    for (const u of game.units) if (!u.destroyed && u.id !== game.selectedId) drawUnit(ctx, view, u, false, time);
    if (sel) drawUnit(ctx, view, sel, true, time);
    drawBadges(ctx, view, game, time);
    drawFx(ctx, view, game, time);
    drawPreview(ctx, view, game);
    drawCursor(ctx, view, game);
  }

  // 선택 전차의 시야 표시: 안 보이는 곳을 어둡게, 부분적으로 보이는 곳(숲 사이)은 옅게
  const sightCache = { key: '', canvas: null };
  function drawSight(ctx, view, game, u) {
    const sens = TMM.SENSORS[u.model][game.light];
    const maxCells = (sens.detect * TMM.VISION.MOVING_MUL) / game.map.metersPerCell;
    const key = u.id + ':' + Math.round(u.x * 2) + ':' + Math.round(u.y * 2) + ':' + game.light;
    if (sightCache.key !== key) {
      const vs = TMM.Sight.viewshed(game.map, u, maxCells, 2);
      const cv = sightCache.canvas || document.createElement('canvas');
      cv.width = vs.w;
      cv.height = vs.h;
      const c2 = cv.getContext('2d');
      const img = c2.createImageData(vs.w, vs.h);
      for (let i = 0; i < vs.data.length; i++) {
        const v = vs.data[i];
        img.data[i * 4] = 6;
        img.data[i * 4 + 1] = 8;
        img.data[i * 4 + 2] = 4;
        img.data[i * 4 + 3] = v === 2 ? 0 : v === 1 ? 70 : 150;
      }
      c2.putImageData(img, 0, 0);
      sightCache.key = key;
      sightCache.canvas = cv;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sightCache.canvas, view.ox, view.oy, game.map.cols * view.scale, game.map.rows * view.scale);
    // 탐지 거리 원
    const p = view.toScreen(u.x, u.y);
    ctx.strokeStyle = 'rgba(156, 196, 106, 0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (sens.detect / game.map.metersPerCell) * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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

  return { createView, fit, drawFrame, hitUnit, contactMarks, drawMarks };
})();
