/*
 * 지형 레이어: 지도 바탕을 한 번만 그려 두는 오프스크린 캔버스.
 * 매 프레임에는 이 그림을 복사하고 그 위에 전차만 그린다.
 */
TMM.TerrainLayer = (function () {
  const T = TMM.T;
  const Geo = TMM.Geo;
  const FONT = '"IBM Plex Sans KR", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // 1) 고도에 따른 바탕색 + 음영 (작은 캔버스를 부드럽게 확대)
  function drawRelief(ctx, map, P) {
    const { cols, rows, elev } = map;
    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(cols, rows);
    const low = hexToRgb('#56603a');
    const mid = hexToRgb('#5f6340');
    const high = hexToRgb('#76694a');
    const E = (c, r) => elev[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = E(c, r);
        let col = e < 0.25 ? mix(low, mid, e / 0.25) : mix(mid, high, Math.min(1, (e - 0.25) / 0.45));
        // 북서쪽에서 빛이 비치는 음영
        const dzx = (E(c + 1, r) - E(c - 1, r)) * 6;
        const dzy = (E(c, r + 1) - E(c, r - 1)) * 6;
        const shade = Math.max(-0.35, Math.min(0.3, -(dzx + dzy) * 0.7));
        col = col.map((v) => v * (1 + shade));
        const i = (r * cols + c) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, cols * P, rows * P);
  }

  // 2) 논: 칸을 채우고 논둑 선
  function drawPaddies(ctx, map, P) {
    const { cols, rows, type } = map;
    ctx.fillStyle = '#4a5f45';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (type[r * cols + c] === T.PADDY) ctx.fillRect(c * P, r * P, P + 0.5, P + 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(170, 185, 125, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (type[r * cols + c] !== T.PADDY) continue;
        if (r % 3 === 0) { ctx.moveTo(c * P, r * P + 0.5); ctx.lineTo((c + 1) * P, r * P + 0.5); }
        if (c % 4 === 0) { ctx.moveTo(c * P + 0.5, r * P); ctx.lineTo(c * P + 0.5, (r + 1) * P); }
      }
    }
    ctx.stroke();
    // 물 댄 논 표시 (짧은 가로줄)
    ctx.strokeStyle = 'rgba(120, 160, 150, 0.22)';
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (type[r * cols + c] !== T.PADDY || (c * 7 + r * 3) % 5) continue;
        const x = c * P + P * 0.25, y = r * P + P * 0.6;
        ctx.moveTo(x, y);
        ctx.lineTo(x + P * 0.5, y);
      }
    }
    ctx.stroke();
  }

  // 3) 숲: 칸마다 둥근 수관을 겹쳐 그려 가장자리를 자연스럽게
  function drawForests(ctx, map, P) {
    const { cols, rows, type } = map;
    const rand = TMM.Noise.rng(77);
    ctx.fillStyle = '#2f3d24';
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (type[r * cols + c] !== T.FOREST) continue;
        const cx = (c + 0.5) * P, cy = (r + 0.5) * P;
        ctx.moveTo(cx + P * 0.8, cy);
        ctx.arc(cx, cy, P * 0.8, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    // 나무 기호
    ctx.fillStyle = 'rgba(20, 30, 14, 0.75)';
    ctx.strokeStyle = 'rgba(120, 140, 80, 0.35)';
    ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (type[r * cols + c] !== T.FOREST) continue;
        if (rand() < 0.45) continue;
        const x = (c + 0.2 + rand() * 0.6) * P, y = (r + 0.2 + rand() * 0.6) * P;
        ctx.beginPath();
        ctx.arc(x, y, P * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 4) 등고선 (marching squares)
  function drawContours(ctx, map, P) {
    const { cols, rows, elev } = map;
    const E = (c, r) => elev[r * cols + c];
    for (let k = 1; k <= 9; k++) {
      const level = k * 0.1;
      const index = k % 4 === 0;
      ctx.strokeStyle = index ? 'rgba(170, 140, 90, 0.55)' : 'rgba(150, 125, 85, 0.3)';
      ctx.lineWidth = index ? 1.6 : 1;
      ctx.beginPath();
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = E(c, r), b = E(c + 1, r), d = E(c, r + 1), e = E(c + 1, r + 1);
          const pts = [];
          const edge = (v1, v2, x1, y1, x2, y2) => {
            if ((v1 < level) !== (v2 < level)) {
              const t = (level - v1) / (v2 - v1);
              pts.push([(x1 + (x2 - x1) * t + 0.5) * P, (y1 + (y2 - y1) * t + 0.5) * P]);
            }
          };
          edge(a, b, c, r, c + 1, r);
          edge(b, e, c + 1, r, c + 1, r + 1);
          edge(d, e, c, r + 1, c + 1, r + 1);
          edge(a, d, c, r, c, r + 1);
          if (pts.length >= 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); }
          if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
        }
      }
      ctx.stroke();
    }
  }

  // 5) 저수지
  function drawReservoir(ctx, P) {
    const R = Geo.reservoir;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const th = (i / 120) * Math.PI * 2;
      const k = Geo.reservoirRadius(th);
      const x = (R.cx + Math.cos(th) * R.rx * k) * P;
      const y = (R.cy + Math.sin(th) * R.ry * k) * P;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = TMM.TERRAIN_INFO[T.RESERVOIR].color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 180, 175, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 수면 결
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(140, 180, 175, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = (R.cy - R.ry * 1.4) * P; y < (R.cy + R.ry * 1.4) * P; y += P * 1.2) {
      ctx.moveTo((R.cx - R.rx * 1.4) * P, y);
      ctx.lineTo((R.cx + R.rx * 1.4) * P, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 6) 하천
  function riverPath(ctx, rows, P) {
    ctx.beginPath();
    for (let y = -1; y <= rows + 1; y += 0.5) {
      const x = Geo.riverX(y) * P;
      if (y === -1) ctx.moveTo(x, y * P); else ctx.lineTo(x, y * P);
    }
  }
  function drawRiver(ctx, map, P) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    riverPath(ctx, map.rows, P);
    ctx.strokeStyle = 'rgba(30, 40, 30, 0.6)';
    ctx.lineWidth = (Geo.RIVER_HALF * 2 + 0.7) * P;
    ctx.stroke();
    riverPath(ctx, map.rows, P);
    ctx.strokeStyle = TMM.TERRAIN_INFO[T.RIVER].color;
    ctx.lineWidth = Geo.RIVER_HALF * 2 * P;
    ctx.stroke();
    riverPath(ctx, map.rows, P);
    ctx.strokeStyle = 'rgba(150, 190, 185, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([P * 0.8, P * 0.8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 7) 시가지: 건물 블록
  function drawTown(ctx, map, P) {
    const t = Geo.town;
    ctx.fillStyle = 'rgba(70, 70, 58, 0.85)';
    ctx.fillRect(t.x0 * P, t.y0 * P, (t.x1 - t.x0) * P, (t.y1 - t.y0) * P);
    const rand = TMM.Noise.rng(301);
    ctx.fillStyle = '#8b8670';
    ctx.strokeStyle = 'rgba(25, 25, 18, 0.8)';
    ctx.lineWidth = 1;
    for (let y = t.y0 + 0.4; y < t.y1 - 0.8; y += 1.5) {
      for (let x = t.x0 + 0.4; x < t.x1 - 0.8; x += 1.5) {
        if (rand() < 0.22) continue;
        const w = 0.7 + rand() * 0.6, h = 0.6 + rand() * 0.6;
        const cx = x + w / 2, cy = y + h / 2;
        if (map.typeAt(cx, cy) !== T.TOWN) continue;
        ctx.fillRect(x * P, y * P, w * P, h * P);
        ctx.strokeRect(x * P + 0.5, y * P + 0.5, w * P, h * P);
      }
    }
    ctx.strokeStyle = 'rgba(200, 190, 150, 0.5)';
    ctx.setLineDash([P * 0.6, P * 0.3]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(t.x0 * P, t.y0 * P, (t.x1 - t.x0) * P, (t.y1 - t.y0) * P);
    ctx.setLineDash([]);
  }

  // 8) 주둔지
  function drawBase(ctx, P) {
    const b = Geo.base;
    ctx.fillStyle = TMM.TERRAIN_INFO[T.BASE].color;
    ctx.fillRect(b.x0 * P, b.y0 * P, (b.x1 - b.x0) * P, (b.y1 - b.y0) * P);
    // 정비고·막사
    ctx.fillStyle = '#6d6650';
    ctx.strokeStyle = 'rgba(20, 20, 12, 0.8)';
    const sheds = [[71, 104, 5, 2], [71, 107.5, 5, 2], [87, 104, 6, 2.2], [88, 112.5, 5, 2.4], [71, 112.5, 4, 2.5]];
    for (const [x, y, w, h] of sheds) {
      ctx.fillRect(x * P, y * P, w * P, h * P);
      ctx.strokeRect(x * P + 0.5, y * P + 0.5, w * P, h * P);
    }
    // 철책
    ctx.strokeStyle = '#c9bd8d';
    ctx.lineWidth = 2;
    ctx.setLineDash([P * 0.5, P * 0.25]);
    ctx.strokeRect(b.x0 * P, b.y0 * P, (b.x1 - b.x0) * P, (b.y1 - b.y0) * P);
    ctx.setLineDash([]);
  }

  // 9) 도로와 다리
  function drawRoads(ctx, map, P) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const road of Geo.roads) {
      ctx.beginPath();
      road.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * P, y * P) : ctx.moveTo(x * P, y * P)));
      ctx.strokeStyle = 'rgba(25, 25, 15, 0.85)';
      ctx.lineWidth = (road.half * 2 * 0.75 + 0.35) * P;
      ctx.stroke();
    }
    for (const road of Geo.roads) {
      ctx.beginPath();
      road.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * P, y * P) : ctx.moveTo(x * P, y * P)));
      ctx.strokeStyle = road.half >= 1 ? TMM.TERRAIN_INFO[T.ROAD].color : '#9c9370';
      ctx.lineWidth = road.half * 2 * 0.75 * P;
      ctx.stroke();
      if (road.half >= 1) {
        ctx.strokeStyle = 'rgba(60, 55, 35, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([P * 0.6, P * 0.6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // 다리: 다리 칸 덩어리마다 상판과 난간
    const { cols, rows, type } = map;
    const seen = new Uint8Array(cols * rows);
    for (let i = 0; i < type.length; i++) {
      if (type[i] !== T.BRIDGE || seen[i]) continue;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        const c = j % cols, r = (j / cols) | 0;
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (!map.inBounds(nc, nr)) continue;
          const k = nr * cols + nc;
          if (!seen[k] && type[k] === T.BRIDGE) { seen[k] = 1; stack.push(k); }
        }
      }
      const x = (minC - 0.3) * P, y = minR * P + P * 0.15;
      const w = (maxC - minC + 1.6) * P, h = (maxR - minR + 1) * P - P * 0.3;
      ctx.fillStyle = TMM.TERRAIN_INFO[T.BRIDGE].color;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#1a1a10';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - P * 0.3, y); ctx.lineTo(x + w + P * 0.3, y);
      ctx.moveTo(x - P * 0.3, y + h); ctx.lineTo(x + w + P * 0.3, y + h);
      ctx.stroke();
    }
  }

  // 10) 1km 격자와 좌표 숫자
  function drawGrid(ctx, map, P) {
    const step = 1000 / map.metersPerCell; // 20칸
    ctx.strokeStyle = 'rgba(210, 220, 170, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = step; c < map.cols; c += step) {
      ctx.moveTo(c * P + 0.5, 0);
      ctx.lineTo(c * P + 0.5, map.rows * P);
    }
    for (let r = map.rows - step; r > 0; r -= step) {
      ctx.moveTo(0, r * P + 0.5);
      ctx.lineTo(map.cols * P, r * P + 0.5);
    }
    ctx.stroke();
    ctx.font = '600 ' + P * 1.6 + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(220, 225, 185, 0.55)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let c = 0; c < map.cols; c += step) {
      ctx.fillText(String(c / step).padStart(2, '0'), c * P + P * 0.3, P * 0.3);
    }
    ctx.textBaseline = 'bottom';
    for (let r = map.rows; r > 0; r -= step) {
      ctx.fillText(String((map.rows - r) / step).padStart(2, '0'), P * 0.3, r * P - P * 0.2);
    }
  }

  // 11) 지명
  function drawLabels(ctx, P) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of Geo.labels) {
      let size = P * 2.1, color = 'rgba(230, 225, 190, 0.85)', weight = 600;
      if (l.kind === 'area') { size = P * 2.4; color = 'rgba(225, 215, 170, 0.6)'; }
      if (l.kind === 'water') color = 'rgba(175, 215, 215, 0.9)';
      if (l.kind === 'town') { size = P * 2.6; weight = 700; }
      if (l.kind === 'peak') { size = P * 1.8; color = 'rgba(235, 210, 160, 0.9)'; }
      if (l.kind === 'base') { color = 'rgba(240, 220, 150, 0.95)'; weight = 700; }
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      ctx.lineWidth = P * 0.45;
      ctx.strokeStyle = 'rgba(15, 20, 10, 0.8)';
      ctx.strokeText(l.text, l.x * P, l.y * P);
      ctx.fillStyle = color;
      ctx.fillText(l.text, l.x * P, l.y * P);
      if (l.kind === 'peak') {
        ctx.beginPath();
        ctx.moveTo(l.x * P, l.y * P + size * 0.75);
        ctx.lineTo(l.x * P - size * 0.35, l.y * P + size * 1.3);
        ctx.lineTo(l.x * P + size * 0.35, l.y * P + size * 1.3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function build(map) {
    const P = TMM.CONFIG.TERRAIN_PX_PER_CELL;
    const canvas = document.createElement('canvas');
    canvas.width = map.cols * P;
    canvas.height = map.rows * P;
    const ctx = canvas.getContext('2d');
    drawRelief(ctx, map, P);
    drawPaddies(ctx, map, P);
    drawForests(ctx, map, P);
    drawContours(ctx, map, P);
    drawReservoir(ctx, P);
    drawRiver(ctx, map, P);
    drawTown(ctx, map, P);
    drawBase(ctx, P);
    drawRoads(ctx, map, P);
    drawGrid(ctx, map, P);
    drawLabels(ctx, P);
    return canvas;
  }

  return { build };
})();
