/*
 * 1호차 조준 화면 그리기 (M6). 규칙은 js/combat/scope.js (TMM.Scope).
 *
 * 2D 로 충분한 '가짜 3D': 화면 세로 줄마다 포탑 방향으로 지도를 앞에서부터 훑어
 * 땅·숲·건물이 보이는 높이 각도를 구하고, 앞의 것이 뒤의 것을 가리도록 칠한다 (높이 버퍼 방식).
 * 그 위에 1호차가 '직접' 보는 표적만 실루엣으로 그린다 (Intel 시야와 같음).
 *
 *   주간: 일반 조준경 (녹색·올리브 땅, 뿌연 하늘, 거리가 멀수록 흐려짐)
 *   야간: 열상 조준경 (흑백, 뜨거운 것이 밝음 — 엔진·포구 섬광·불타는 잔해)
 *
 * 화면 좌표: 가운데 가로 = 포탑 방향(scope.az), 가운데 세로 = scope.pitch. 1 라디안 = 화면 너비 / 시야각 픽셀.
 */
TMM.ScopeView = (function () {
  const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
  const FONT_SANS = '"IBM Plex Sans KR", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const S = () => TMM.Scope;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const BIN_M = 50; // 지형 가림 기록 간격 (m)
  const MAX_M = 6500;
  const NB = Math.ceil(MAX_M / BIN_M) + 1;

  // 위치 기반 결정적 잡음 0~1
  function hash(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---- 색 ----
  // 주간 (r,g,b) / 야간 열상 밝기 0~1
  const DAY = [
    [96, 104, 66], // 개활지
    [82, 100, 66], // 논
    [44, 60, 34], // 숲
    [104, 96, 66], // 능선
    [150, 142, 112], // 도로
    [160, 152, 120], // 다리
    [90, 112, 118], // 하천
    [84, 106, 114], // 저수지
    [100, 98, 86], // 시가지
    [92, 88, 66], // 주둔지
  ];
  const THERM = [0.3, 0.24, 0.4, 0.33, 0.37, 0.36, 0.12, 0.1, 0.46, 0.42];
  const SKY_DAY = [196, 202, 196];
  const SKY_NIGHT = 0.1;

  function shade(night, type, d, n) {
    if (night) {
      let v = THERM[type] * (0.88 + 0.24 * n);
      const f = 1 - Math.exp(-d / 5200);
      v = v + (SKY_NIGHT + 0.06 - v) * f;
      const g = Math.round(clamp(v, 0, 1) * 255);
      return 'rgb(' + g + ',' + g + ',' + g + ')';
    }
    const c = DAY[type];
    const k = 0.86 + 0.28 * n;
    const f = 1 - Math.exp(-d / 5200);
    const r = c[0] * k + (SKY_DAY[0] - c[0] * k) * f;
    const g = c[1] * k + (SKY_DAY[1] - c[1] * k) * f;
    const b = c[2] * k + (SKY_DAY[2] - c[2] * k) * f;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  const groundSmooth = (map, x, y) => S().ground(map, x, y);

  // ---- 지형 (오프스크린에 그려 두고, 시점이 바뀔 때만 다시) ----
  const cache = { key: '', canvas: null, occ: null, colW: 3, ncol: 0 };

  function terrainKey(game, u, W, H, dpr) {
    const s = game.scope;
    return [s.az.toFixed(4), s.pitch.toFixed(4), s.zoom, u.x.toFixed(2), u.y.toFixed(2), W, H, dpr, game.light].join('|');
  }

  function buildTerrain(game, u, W, H, dpr, night) {
    const s = game.scope, map = game.map, mpc = map.metersPerCell;
    const key = terrainKey(game, u, W, H, dpr);
    if (cache.key === key) return cache;
    if (!cache.canvas) cache.canvas = document.createElement('canvas');
    const cv = cache.canvas;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = S().fov(game);
    const ppr = W / f;
    const y0 = H / 2 + s.pitch * ppr; // 앙각 0 의 화면 높이
    TMM.Sight.groundAt(map, u.x, u.y); // 시야 격자가 없으면 만든다
    const eye = S().eyeAlt(game, u);

    // 하늘
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(10, y0));
    if (night) { sky.addColorStop(0, '#0d0d0d'); sky.addColorStop(1, '#262626'); }
    else { sky.addColorStop(0, '#9fadb3'); sky.addColorStop(1, '#cfd4cc'); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const colW = W > 1000 ? 3 : 2;
    const ncol = Math.ceil(W / colW);
    const occ = cache.occ && cache.occ.length === ncol * NB ? cache.occ : new Float32Array(ncol * NB);
    const TS = TMM.TERRAIN_SIGHT;
    for (let c = 0; c < ncol; c++) {
      const sx = c * colW;
      const az = s.az + (sx + colW / 2 - W / 2) / ppr;
      const ca = Math.cos(az), sa = Math.sin(az);
      let curY = H; // 지금까지 칠한 가장 높은 곳 (아래부터)
      let groundY = H; // 땅만 (숲·건물 빼고) — 표적 가림용
      let bin = 0;
      let d = 12;
      let out = false;
      const ux = Math.floor(u.x), uy = Math.floor(u.y);
      while (d < MAX_M) {
        const x = u.x + (ca * d) / mpc, y = u.y + (sa * d) / mpc;
        const type = map.typeAt(x, y);
        if (type < 0) { out = true; break; }
        const g = groundSmooth(map, x, y);
        const n = TMM.Noise.value(x * 3, y * 3, 3);
        let top = g;
        // 서 있는 칸과 바로 앞(60m)의 숲·건물은 그리지 않는다 (시선 규칙과 같음: 숲 가장자리에서는 밖이 보임)
        const own = d < 60 || (Math.floor(x) === ux && Math.floor(y) === uy);
        // 주둔지는 낮은 방벽·건물 (가림 정도가 아주 작다) → 낮게 그린다
        const ch = own ? 0 : type === 9 ? TS[type].h * 0.35 : TS[type].h;
        if (ch) {
          // 숲은 들쭉날쭉한 나무 윗선, 시가지는 건물마다 다른 높이
          const k = type === 2 ? 0.65 + 0.55 * TMM.Noise.value(x * 4, y * 4, 7) : 0.55 + 0.7 * hash(Math.floor(x * 2.5), Math.floor(y * 2.5));
          top = g + ch * k;
        }
        const yG = y0 - Math.atan2(g - eye, d) * ppr;
        if (yG < groundY) groundY = yG;
        const yT = ch ? y0 - Math.atan2(top - eye, d) * ppr : yG;
        if (yT < curY) {
          ctx.fillStyle = shade(night, type, d, n);
          ctx.fillRect(sx, yT, colW, curY - yT + 0.6);
          curY = yT;
        }
        const nb = Math.min(NB - 1, Math.floor(d / BIN_M));
        while (bin <= nb) occ[c * NB + bin++] = groundY;
        d += Math.max(7, d * 0.017);
      }
      while (bin < NB) occ[c * NB + bin++] = groundY;
      // 지도 밖: 먼 산 (아주 흐림)
      const far = 9000;
      const ridge = 150 + 110 * (0.5 + 0.5 * Math.sin(az * 7.1) * Math.cos(az * 3.3)) + 25 * Math.sin(az * 31);
      const yF = y0 - Math.atan2(ridge - eye, far) * ppr;
      if (yF < curY) {
        ctx.fillStyle = night ? 'rgb(44,44,44)' : 'rgb(164,172,170)';
        ctx.fillRect(sx, yF, colW, curY - yF + 0.6);
      }
      if (out && curY >= H) {
        ctx.fillStyle = night ? 'rgb(40,40,40)' : 'rgb(150,156,140)';
        ctx.fillRect(sx, y0, colW, H - y0);
      }
    }
    cache.key = key;
    cache.occ = occ;
    cache.colW = colW;
    cache.ncol = ncol;
    cache.y0 = y0;
    cache.ppr = ppr;
    return cache;
  }

  // 표적 거리 d 앞의 땅이 가리는 높이 (화면 y). 이 값보다 위만 보인다.
  function clipToGround(ctx, T, x0, x1, distM, H) {
    const c0 = Math.max(0, Math.floor(x0 / T.colW) - 1), c1 = Math.min(T.ncol - 1, Math.ceil(x1 / T.colW) + 1);
    const b = clamp(Math.floor(distM / BIN_M) - 2, 0, NB - 1);
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) ctx.rect(c * T.colW, -10, T.colW + 0.5, T.occ[c * NB + b] + 10);
    ctx.clip();
  }

  // ---- 표적 실루엣 ----
  // (cx, by) 아래 가운데, w 너비, h 높이 픽셀. front: 앞쪽 방향 화면 부호(+1 오른쪽), side: 옆모습 정도 0~1
  function tankShape(ctx, t, cx, by, w, h, side, front, gunDir, gunSide, col, hot, night) {
    const hullH = h * 0.5;
    const L = cx - w / 2, R = cx + w / 2;
    ctx.fillStyle = col;
    ctx.beginPath();
    // 차체: 앞쪽이 비스듬함
    const slope = side * w * 0.08;
    ctx.moveTo(L + (front < 0 ? slope : 0), by - hullH);
    ctx.lineTo(R - (front > 0 ? slope : 0), by - hullH);
    ctx.lineTo(R, by - hullH * 0.45);
    ctx.lineTo(R - w * 0.03, by);
    ctx.lineTo(L + w * 0.03, by);
    ctx.lineTo(L, by - hullH * 0.45);
    ctx.closePath();
    ctx.fill();
    // 포탑
    const tw = w * (0.38 + 0.22 * (1 - side)), th = h * 0.36;
    const tcx = cx - front * side * w * 0.04;
    const ty = by - hullH - th;
    if (t.model === 'CHONMA') {
      ctx.beginPath();
      ctx.ellipse(tcx, by - hullH, tw / 2, th, 0, Math.PI, 0);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(tcx - tw / 2, by - hullH);
      ctx.lineTo(tcx - tw / 2 + tw * 0.08, ty);
      ctx.lineTo(tcx + tw / 2 - tw * 0.08, ty);
      ctx.lineTo(tcx + tw / 2, by - hullH);
      ctx.closePath();
      ctx.fill();
    }
    // 포신
    const gy = by - hullH - th * 0.45;
    const gl = w * 0.62 * gunSide;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, h * 0.08);
    ctx.beginPath();
    ctx.moveTo(tcx, gy);
    ctx.lineTo(tcx + gunDir * gl, gy - h * 0.02);
    ctx.stroke();
    if (gunSide < 0.35) {
      // 포구가 이쪽을 향함
      ctx.fillStyle = night ? '#111' : '#15180f';
      ctx.beginPath();
      ctx.arc(tcx + gunDir * gl, gy, Math.max(0.8, h * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    // 궤도·바퀴 띠
    ctx.fillStyle = night ? hot(0.78) : 'rgba(10,12,6,0.55)';
    ctx.fillRect(L + w * 0.04, by - hullH * 0.38, w * 0.92, hullH * 0.38);
    if (night) {
      // 엔진(뒤쪽)이 가장 뜨겁다
      const rear = -front;
      const ex = side > 0.3 ? cx + rear * w * 0.3 : cx;
      ctx.fillStyle = hot(0.97);
      ctx.fillRect(ex - w * 0.12, by - hullH * 0.95, w * 0.24, hullH * 0.5);
    }
  }

  function truckShape(ctx, cx, by, w, h, side, front, col, hot, night) {
    const L = cx - w / 2;
    ctx.fillStyle = col;
    const cabW = w * (0.28 + 0.4 * (1 - side));
    const cabX = front > 0 ? cx + w / 2 - cabW : L;
    ctx.fillRect(cabX, by - h * 0.8, cabW, h * 0.62);
    ctx.fillRect(L, by - h * 0.95 * (side > 0.3 ? 1 : 0.9), w - (side > 0.3 ? cabW * 0.95 : 0) , h * 0.75);
    ctx.fillStyle = night ? hot(0.8) : 'rgba(8,8,6,0.8)';
    const r = Math.max(1, h * 0.14);
    for (const k of side > 0.3 ? [0.15, 0.4, 0.85] : [0.2, 0.8]) {
      ctx.beginPath();
      ctx.arc(L + w * k, by - r, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (night) {
      ctx.fillStyle = hot(0.95);
      ctx.fillRect(cabX + cabW * 0.2, by - h * 0.5, cabW * 0.5, h * 0.25);
    }
  }

  function infantryShape(ctx, t, cx, by, w, h, col) {
    ctx.fillStyle = col;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const px = cx - w / 2 + (w * (i + 0.5)) / n + (hash(t.id * 7, i) - 0.5) * (w / n) * 0.8;
      const ph = h * (0.75 + 0.3 * hash(i, t.id));
      const pw = Math.max(1, h * 0.28);
      ctx.fillRect(px - pw / 2, by - ph, pw, ph);
      ctx.beginPath();
      ctx.arc(px, by - ph, pw * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 식별 전 먼 표적: 형체만 (덩어리)
  function blobShape(ctx, cx, by, w, h, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, by);
    ctx.quadraticCurveTo(cx - w / 2, by - h * 0.7, cx - w * 0.15, by - h * 0.85);
    ctx.quadraticCurveTo(cx, by - h * 1.05, cx + w * 0.15, by - h * 0.85);
    ctx.quadraticCurveTo(cx + w / 2, by - h * 0.7, cx + w / 2, by);
    ctx.closePath();
    ctx.fill();
  }

  function heatFn(v0) {
    return (v) => {
      const g = Math.round(clamp(v * v0, 0, 1) * 255);
      return 'rgb(' + g + ',' + g + ',' + g + ')';
    };
  }

  function contactOf(game, t) {
    return TMM.Intel.contact(game, 'friend', t.id);
  }

  // 표적 하나 그리기. 반환: 화면 상자 (이름표용)
  function drawTarget(ctx, game, u, T, t, pv, W, H, night, now, wreck) {
    const s = game.scope;
    const b = S().project(game, u, t);
    const ppr = T.ppr;
    const cx = W / 2 + b.daz * ppr;
    const halfW = Math.max(1.2, b.halfW * ppr);
    if (cx + halfW < -20 || cx - halfW > W + 20) return null;
    const by = T.y0 - b.el0 * ppr;
    const top = T.y0 - b.el1 * ppr;
    const h = Math.max(1.5, by - top);
    const w = halfW * 2;
    const side = Math.abs(Math.sin(b.rel));
    const front = Math.sin(b.rel) >= 0 ? 1 : -1;
    // 포탑 방향: 쏘는 표적 쪽
    let gunAng = t.heading;
    const ft = t.fire && t.fire.targetId != null ? TMM.Gunnery.findUnit(game, t.fire.targetId) : null;
    if (ft) gunAng = Math.atan2(ft.y - t.y, ft.x - t.x);
    const grel = wrap(gunAng - b.az);
    const gunDir = Math.sin(grel) >= 0 ? 1 : -1;
    const gunSide = Math.abs(Math.sin(grel));

    const c = contactOf(game, t);
    const moving = t.state === 'moving';
    const hot = heatFn(wreck ? 1.1 : moving ? 1.05 : 0.95);
    let col;
    if (night) col = wreck ? 'rgb(170,170,170)' : moving ? 'rgb(190,190,190)' : 'rgb(165,165,165)';
    else {
      const f = 1 - Math.exp(-b.distM / 4500);
      const base = wreck ? [34, 32, 28] : [38, 42, 30];
      col = 'rgb(' + [0, 1, 2].map((i) => Math.round(base[i] + (SKY_DAY[i] - base[i]) * f * 0.55)).join(',') + ')';
    }

    ctx.save();
    clipToGround(ctx, T, cx - w, cx + w, b.distM, H);
    const cls = TMM.VEHICLES[t.model].cls;
    const clear = b.distM < 1100 || (c && (c.identified || c.idProg >= 0.5)) || wreck;
    if (!clear) blobShape(ctx, cx, by, w, h, col);
    else if (cls === 'tank') {
      if (wreck) { ctx.translate(cx, by); ctx.rotate(0.06 * front); ctx.translate(-cx, -by); }
      tankShape(ctx, t, cx, by, w, h, side, front, gunDir, wreck ? 0.6 : gunSide, col, hot, night);
    } else if (cls === 'truck') truckShape(ctx, cx, by, w, h, side, front, col, hot, night);
    else infantryShape(ctx, t, cx, by, w, h, night ? hot(0.9) : col);

    // 숲·건물 사이로 일부만 보임: 잎·벽 무늬를 덧칠
    const obs = pv ? pv.obs : 0;
    if (obs > 0.05 && !wreck) {
      const n = Math.min(60, Math.ceil(w * h / 6));
      ctx.fillStyle = night ? 'rgba(95,95,95,' + Math.min(0.85, obs).toFixed(2) + ')' : 'rgba(40,58,32,' + Math.min(0.85, obs).toFixed(2) + ')';
      for (let i = 0; i < n; i++) {
        const px = cx - w / 2 + hash(t.id * 13, i) * w;
        const py = by - hash(i, t.id * 17) * h;
        const r = Math.max(1, h * 0.12) * (0.6 + hash(i * 3, t.id));
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (wreck) drawSmoke(ctx, cx, top, h, w, t.id, now, night, true);
    return { cx, by, top, w, h, c, dist: b.distM };
  }

  // 연기 기둥 (격파된 전차), 시간에 따라 피어오름
  function drawSmoke(ctx, cx, top, h, w, seed, now, night, fire) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ph = ((now * 0.25 + i / n + hash(seed, i)) % 1);
      const rise = ph * h * 5;
      const r = Math.max(2, h * (0.35 + ph * 1.1));
      const drift = ph * w * 0.6;
      const a = (1 - ph) * 0.5;
      ctx.fillStyle = night ? 'rgba(120,120,120,' + (a * 0.6).toFixed(2) + ')' : 'rgba(40,38,34,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx + drift, top - rise, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (fire) {
      const fl = 0.7 + 0.3 * Math.sin(now * 13 + seed);
      ctx.fillStyle = night ? 'rgba(255,255,255,' + (0.8 * fl).toFixed(2) + ')' : 'rgba(255,150,50,' + (0.75 * fl).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(cx, top + h * 0.2, Math.max(1.5, w * 0.12), Math.max(1.5, h * 0.35 * fl), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 효과 (main.js 의 game.scopeFx: 세계 좌표) ----
  function projectPoint(game, u, T, W, x, y, hM) {
    const mpc = game.map.metersPerCell;
    const d = Math.max(20, Math.hypot(x - u.x, y - u.y) * mpc);
    const az = Math.atan2(y - u.y, x - u.x);
    const g = groundSmooth(game.map, x, y);
    const el = Math.atan2(g + (hM || 0) - S().eyeAlt(game, u), d);
    return { x: W / 2 + wrap(az - game.scope.az) * T.ppr, y: T.y0 - el * T.ppr, px: T.ppr / d, d };
  }

  function drawFx(ctx, game, u, T, W, H, now, night) {
    for (const fx of game.scopeFx) {
      const age = now - fx.t;
      if (age < 0) continue;
      const p = projectPoint(game, u, T, W, fx.x, fx.y, 1.2);
      if (p.x < -50 || p.x > W + 50) continue;
      const m = p.px; // 1m 당 픽셀
      if (fx.kind === 'flash') {
        // 적 포구 섬광
        const a = 1 - age / 0.35;
        if (a <= 0) continue;
        ctx.fillStyle = night ? 'rgba(255,255,255,' + a.toFixed(2) + ')' : 'rgba(255,220,140,' + a.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y - m * 1.2, Math.max(3, m * 4), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,170,150,' + (a * 0.5).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y - m, Math.max(4, m * 9 * (1 - a + 0.3)), 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'impact') {
        const dur = fx.kill ? 2.2 : 1.4;
        if (age > dur) continue;
        const k = age / dur;
        let ix = p.x, iy = p.y;
        if (!fx.hit) { ix += fx.ox * m; iy -= 0; }
        if (!fx.hit) {
          // 빗나감: 흙먼지 기둥
          const r = Math.max(3, m * (3 + 9 * k));
          ctx.fillStyle = night ? 'rgba(150,150,150,' + (0.7 * (1 - k)).toFixed(2) + ')' : 'rgba(120,104,80,' + (0.75 * (1 - k)).toFixed(2) + ')';
          ctx.beginPath();
          ctx.ellipse(ix, iy - r * 0.6, r * 0.7, r, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const big = fx.kill ? 3 : fx.pen ? 1.6 : 1;
          if (k < 0.25) {
            const a = 1 - k / 0.25;
            ctx.fillStyle = night ? 'rgba(255,255,255,' + a.toFixed(2) + ')' : (fx.pen ? 'rgba(255,190,90,' : 'rgba(255,245,200,') + a.toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(ix, iy - m * 1.4, Math.max(3, m * 2.5 * big), 0, Math.PI * 2);
            ctx.fill();
          }
          if (fx.pen || fx.kill) {
            const r = Math.max(3, m * (2 + 6 * k) * big * 0.6);
            ctx.fillStyle = night ? 'rgba(200,200,200,' + (0.6 * (1 - k)).toFixed(2) + ')' : 'rgba(46,42,36,' + (0.7 * (1 - k)).toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(ix, iy - m * 2 - r * k * 1.5, r, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // 튕겨 나감: 불꽃
            ctx.strokeStyle = night ? 'rgba(255,255,255,' + (1 - k).toFixed(2) + ')' : 'rgba(255,230,160,' + (1 - k).toFixed(2) + ')';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
              const ang = -Math.PI / 2 + (i - 2) * 0.5;
              ctx.moveTo(ix, iy - m * 1.4);
              ctx.lineTo(ix + Math.cos(ang) * m * 6 * (0.3 + k), iy - m * 1.4 + Math.sin(ang) * m * 6 * (0.3 + k));
            }
            ctx.stroke();
          }
        }
      } else if (fx.kind === 'tracer') {
        // 내 탄의 예광: 조준선에서 표적까지 빠르게
        if (age > fx.dur) continue;
        const k = age / fx.dur;
        const sx = fx.sx, sy = fx.sy;
        const tx = p.x + (fx.hit ? 0 : fx.ox * m), ty = p.y - m * 1.2;
        const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 6;
        ctx.fillStyle = night ? '#fff' : 'rgba(255,90,60,0.95)';
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- 조준선 ----
  function drawReticle(ctx, game, x, y, night, prev, now) {
    const s = game.scope;
    const ink = night ? 'rgba(235,245,235,0.95)' : 'rgba(18,18,14,0.92)';
    const hiCol = night ? '#ffffff' : '#d8261b';
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const g = 9;
    ctx.moveTo(x - 90, y); ctx.lineTo(x - g, y);
    ctx.moveTo(x + g, y); ctx.lineTo(x + 90, y);
    ctx.moveTo(x, y + g); ctx.lineTo(x, y + 70);
    ctx.moveTo(x, y - g); ctx.lineTo(x, y - 26);
    // 눈금 (밀)
    for (let i = 1; i <= 4; i++) {
      const k = g + i * 18;
      ctx.moveTo(x - k, y - 4); ctx.lineTo(x - k, y + 4);
      ctx.moveTo(x + k, y - 4); ctx.lineTo(x + k, y + 4);
      ctx.moveTo(x - 4, y + g + i * 14); ctx.lineTo(x + 4, y + g + i * 14);
    }
    ctx.stroke();
    // 가운데 갈매기 표시
    ctx.strokeStyle = hiCol;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6); ctx.lineTo(x, y); ctx.lineTo(x + 6, y + 6);
    ctx.stroke();
    // 조준 안정 고리
    if (prev && prev.hit) {
      const q = prev.q;
      const on = prev.hit.on;
      ctx.strokeStyle = on ? (q.settle >= 1 ? (night ? '#fff' : '#2b8a3e') : hiCol) : 'rgba(200,160,40,0.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (on ? Math.max(0.04, q.settle) : 0.08));
      ctx.stroke();
    }
    // 레이저 거리
    const L = s.laser;
    if (L && L.distM != null) {
      const fresh = game.gameSeconds - L.at < TMM.SCOPE.LASER_VALID_SEC;
      ctx.fillStyle = fresh ? hiCol : 'rgba(140,140,120,0.8)';
      ctx.font = '700 13px ' + FONT_MONO;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(L.distM).padStart(4, '0'), x + 22, y - 6);
    }
    ctx.restore();
  }

  // ---- 나침반 띠 ----
  function drawCompass(ctx, game, u, W, night, T) {
    const s = game.scope;
    const f = S().fov(game);
    const cx = W / 2, top = 8, hgt = 26;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,6,0.55)';
    ctx.fillRect(cx - W * 0.32, top, W * 0.64, hgt);
    ctx.beginPath();
    ctx.rect(cx - W * 0.32, top, W * 0.64, hgt);
    ctx.clip();
    const step = s.zoom ? 1 : 2, label = s.zoom ? 5 : 10;
    const c0 = S().compassDeg(s.az);
    const span = (f * 180) / Math.PI;
    const pxPerDeg = W / span;
    ctx.strokeStyle = 'rgba(220,226,200,0.8)';
    ctx.fillStyle = 'rgba(220,226,200,0.9)';
    ctx.font = '600 10px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    const startDeg = Math.floor((c0 - span) / step) * step;
    ctx.beginPath();
    for (let dg = startDeg; dg <= c0 + span; dg += step) {
      const x = cx + (dg - c0) * pxPerDeg;
      const major = ((dg % label) + label) % label === 0;
      ctx.moveTo(x, top + hgt);
      ctx.lineTo(x, top + hgt - (major ? 9 : 4));
      if (major) {
        const v = ((dg % 360) + 360) % 360;
        const name = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v];
        ctx.fillText(name || String(v).padStart(3, '0'), x, top + 2);
      }
    }
    ctx.stroke();
    // 아는 접촉의 방위 (전장관리체계)
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.known || c.wreck) continue;
      const px = c.visible ? c.unit.x : c.lastX, py = c.visible ? c.unit.y : c.lastY;
      const deg = S().compassDeg(Math.atan2(py - u.y, px - u.x));
      let dd = deg - c0;
      dd = ((dd + 540) % 360) - 180;
      const x = cx + dd * pxPerDeg;
      ctx.fillStyle = !c.identified ? '#e8cf4a' : c.kind === 'friendly' ? '#7fb6e8' : '#e0563f';
      ctx.globalAlpha = c.visible ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(x, top + hgt - 1); ctx.lineTo(x - 4, top + hgt - 8); ctx.lineTo(x + 4, top + hgt - 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // 가운데 표시와 현재 방위
    ctx.fillStyle = night ? '#fff' : '#e2c35a';
    ctx.beginPath();
    ctx.moveTo(cx, top + hgt + 1); ctx.lineTo(cx - 5, top + hgt + 8); ctx.lineTo(cx + 5, top + hgt + 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 11px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('방위 ' + String(Math.round(c0) % 360).padStart(3, '0') + '°', cx, top + hgt + 10);
    // 화면 밖 접촉 방향 화살표
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.known || c.wreck || !c.visible || c.kind === 'friendly') continue;
      const deg = S().compassDeg(Math.atan2(c.unit.y - u.y, c.unit.x - u.x));
      let dd = ((deg - c0 + 540) % 360) - 180;
      if (Math.abs(dd) * pxPerDeg < W * 0.32) continue;
      const left = dd < 0;
      ctx.fillStyle = !c.identified ? 'rgba(232,207,74,0.8)' : 'rgba(224,86,63,0.85)';
      const ax = left ? cx - W * 0.32 - 10 : cx + W * 0.32 + 10;
      ctx.beginPath();
      ctx.moveTo(ax + (left ? -6 : 6), top + hgt / 2);
      ctx.lineTo(ax + (left ? 4 : -4), top + 5);
      ctx.lineTo(ax + (left ? 4 : -4), top + hgt - 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- 아래 정보 띠 ----
  function drawHud(ctx, game, u, W, H, night, prev, now) {
    const s = game.scope;
    const hH = 58;
    const y = H - hH;
    ctx.fillStyle = 'rgba(6,8,5,0.82)';
    ctx.fillRect(0, y, W, hH);
    ctx.strokeStyle = 'rgba(160,170,120,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5);
    ctx.stroke();
    const amber = '#e2c35a', dim = '#8f9873', txt = '#d4d9b8', red = '#e0805a', ok = '#9cc46a';
    const cols = [];
    // 거리
    const L = s.laser;
    const tgt = prev && prev.hit ? prev.hit.t : null;
    const lv = tgt && S().laserValid(game, tgt);
    cols.push({ k: '거리 (L 레이저)', v: L && L.distM != null ? L.distM + ' m' : '---- m', c: lv ? ok : L ? txt : dim, sub: u.damage.fcs ? '사통 손상 — 레이저 고장' : lv ? (TMM.Ballistics.isMoving(tgt) ? '측정 · 리드 계산 완료' : '측정 완료') : tgt ? '이 표적은 미측정' : '' });
    // 탄종
    const am = TMM.AMMO[u.ammoType];
    cols.push({ k: '탄종 (Q)', v: am.short + ' ' + am.id, c: amber, sub: '철갑 ' + u.ammo.K276 + ' · 고폭 ' + u.ammo.K277 + '발' });
    // 장전
    let ld, lc = txt, lsub = '';
    const total = TMM.Damage.totalAmmo(u);
    if (u.destroyed) { ld = '격파됨'; lc = red; }
    else if (u.damage.gun) { ld = '주포 손상'; lc = red; lsub = '사격 불가'; }
    else if (total <= 0) { ld = '탄약 없음'; lc = red; }
    else if (u.fire.reload > 0) {
      ld = '장전 중 ' + Math.ceil(u.fire.reload) + '초';
      lc = amber;
      const loader = u.crew && u.crew.byRole.loader;
      lsub = loader ? '탄약수 ' + loader.name + ' ' + loader.rank : '';
    } else { ld = '장전 완료'; lc = ok; lsub = '좌클릭 발사'; }
    cols.push({ k: '장전', v: ld, c: lc, sub: lsub });
    // 명중 예상
    if (prev && prev.hit) {
      const c = contactOf(game, prev.hit.t);
      const name = c ? TMM.Intel.displayName(c) : '표적';
      cols.push({
        k: '명중 예상', v: prev.inRange ? Math.round(prev.pHit * 100) + '%' : '사거리 밖', c: !prev.inRange ? red : prev.hit.on ? txt : amber,
        sub: (prev.hit.on ? name : name + ' 가장자리') + ' · 안정 ' + Math.round(prev.q.settle * 100) + '%' + (prev.q.laser ? '' : ' · 거리 눈대중'),
      });
    } else cols.push({ k: '명중 예상', v: '--', c: dim, sub: '조준선을 표적에 올리십시오' });
    // 배율·상태
    const st = [];
    if (u.state === 'moving') st.push('1호차 이동 중');
    const dmg = TMM.PART_KEYS.filter((k) => u.damage[k]).map((k) => TMM.PARTS[k].name);
    if (dmg.length) st.push(dmg.join('·') + ' 손상');
    cols.push({ k: '배율 (휠 · Z)', v: TMM.SCOPE.ZOOMS[s.zoom].name, c: txt, sub: st.join(' · ') || (night ? '열상 · 백열' : '주간 조준경') });

    const cw = W / cols.length;
    cols.forEach((col, i) => {
      const x = i * cw + 12;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dim;
      ctx.font = '600 10px ' + FONT_SANS;
      ctx.fillText(col.k, x, y + 6);
      ctx.fillStyle = col.c;
      ctx.font = '700 16px ' + FONT_MONO;
      ctx.fillText(col.v, x, y + 19);
      ctx.fillStyle = dim;
      ctx.font = '500 10px ' + FONT_SANS;
      ctx.fillText(fitText(ctx, col.sub || '', cw - 16), x, y + 40);
    });
    // 장전 막대
    if (!u.damage.gun && total > 0 && u.fire.reload > 0) {
      const full = TMM.VEHICLES[u.model].reloadSec * TMM.Crew.reloadMul(u);
      const k = clamp(1 - u.fire.reload / Math.max(1, full), 0, 1);
      ctx.fillStyle = 'rgba(226,195,90,0.85)';
      ctx.fillRect(2 * cw + 12, y + 37, (cw - 30) * k, 2);
    }
  }

  function fitText(ctx, t, w) {
    if (ctx.measureText(t).width <= w) return t;
    while (t.length > 2 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
  }

  // 차체·포탑 방향 (오른쪽 아래 작은 그림): 포탑은 늘 위, 차체가 돌아가 보인다
  function drawHullIcon(ctx, game, u, W, H, night) {
    const x = W - 46, y = H - 58 - 46;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(6,8,5,0.6)';
    ctx.fillRect(-34, -34, 68, 68);
    ctx.rotate(u.heading - game.scope.az);
    ctx.strokeStyle = night ? '#ddd' : '#e2c35a';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-12, -8, 24, 16); // 차체 (앞 = 오른쪽 → 회전 후)
    ctx.beginPath();
    ctx.moveTo(12, -8); ctx.lineTo(17, 0); ctx.lineTo(12, 8);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = night ? '#fff' : '#d4d9b8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.moveTo(0, -6); ctx.lineTo(0, -26);
    ctx.stroke();
    ctx.fillStyle = '#8f9873';
    ctx.font = '600 9px ' + FONT_SANS;
    ctx.textAlign = 'center';
    let rel = Math.round((wrap(game.scope.az - u.heading) * 180) / Math.PI);
    ctx.fillText('차체 ' + (rel === 0 ? '정면' : (rel > 0 ? '우 ' : '좌 ') + Math.abs(rel) + '°'), 0, 31);
    ctx.restore();
  }

  // 무전 기록 짧게 (왼쪽)
  function drawMiniLog(ctx, game, W, H) {
    const lines = TMM.RadioLog.recent ? TMM.RadioLog.recent(6) : [];
    if (!lines.length) return;
    const x = 12, w = Math.min(380, W * 0.42);
    let y = H - 58 - 12;
    ctx.save();
    ctx.font = '500 11px ' + FONT_SANS;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const KC = { order: '#e2c35a', warn: '#e0805a', ff: '#ff6b55', loss: '#ff6b55', kill: '#9cc46a', crew: '#c9c2a0', system: '#a7b48a', 'trust-up': '#9cc46a', 'trust-down': '#e0805a' };
    const now = performance.now() / 1000;
    for (const l of lines) {
      const age = now - l.real;
      const a = clamp(1.25 - age / 14, 0.35, 1);
      const text = fitText(ctx, l.from + ': ' + l.text, w - 12);
      ctx.fillStyle = 'rgba(6,8,5,' + (0.55 * a).toFixed(2) + ')';
      ctx.fillRect(x - 4, y - 16, w, 16);
      ctx.globalAlpha = a;
      ctx.fillStyle = KC[l.kind] || '#d4d9b8';
      ctx.fillText(text, x, y - 2);
      ctx.globalAlpha = 1;
      y -= 17;
    }
    ctx.fillStyle = 'rgba(143,152,115,0.85)';
    ctx.font = '600 10px ' + FONT_SANS;
    ctx.fillText('무전 기록', x, y - 2);
    ctx.restore();
  }

  function drawVoice(ctx, ui, W, H, now) {
    if (!ui.voice || now > ui.voice.until) return;
    const a = clamp((ui.voice.until - now) / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 14px ' + FONT_SANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const text = ui.voice.who + ' — ' + ui.voice.text;
    const tw = ctx.measureText(text).width + 24;
    ctx.fillStyle = 'rgba(6,8,5,0.72)';
    ctx.fillRect(W / 2 - tw / 2, H - 58 - 44, tw, 26);
    ctx.fillStyle = ui.voice.kind === 'warn' ? '#e0805a' : '#e8e2bf';
    ctx.fillText(text, W / 2, H - 58 - 24);
    ctx.restore();
  }

  // 중요 경고: 테두리 깜빡임 + 위쪽 문구 (자동으로 지도로 빼지 않는다)
  function drawAlert(ctx, ui, W, H, now) {
    const al = ui.alert;
    if (!al || now > al.until) return;
    const on = Math.floor((now - al.t) * 4) % 2 === 0;
    const col = al.level === 'loss' ? '255,70,50' : '240,150,60';
    ctx.save();
    ctx.strokeStyle = 'rgba(' + col + ',' + (on ? 0.95 : 0.35) + ')';
    ctx.lineWidth = on ? 10 : 6;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.font = '700 14px ' + FONT_SANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = '⚠ ' + al.text + ' — Tab 으로 지도 확인';
    const tw = ctx.measureText(text).width + 26;
    ctx.fillStyle = 'rgba(30,6,4,0.82)';
    ctx.fillRect(W / 2 - tw / 2, 62, tw, 26);
    ctx.fillStyle = 'rgb(' + col + ')';
    ctx.fillText(text, W / 2, 67);
    ctx.restore();
  }

  function drawGuide(ctx, W, H) {
    const lines = [
      ['마우스', '조준선 이동 · 화면 가장자리로 가져가면 포탑이 그쪽으로 회전 (A·D / W·S 키도 됨)'],
      ['휠 · Z', '배율 전환 (광각 ×3 ↔ 협각 ×10). 멀리 있는 표적은 협각으로'],
      ['L · 오른쪽 클릭', '레이저 거리측정 — 표적에 대고 재면 사격통제장치가 리드까지 계산'],
      ['좌클릭', '발사. 조준선을 표적에 잠깐 유지하면(고리가 다 차면) 더 잘 맞음'],
      ['Q', '탄종 전환 (철갑탄 ↔ 고폭탄)'],
      ['8 · 9 · 0 · R', '소대 전체 사격 통제 · 상황 보고 요구 (다른 무전 명령은 지도에서만)'],
      ['Tab · Esc', '지도로 돌아가기. 지도에 있는 동안은 김태윤 상병이 알아서 쏩니다 (조금 느리고 덜 정확)'],
    ];
    const bw = Math.min(620, W - 40), bh = 70 + lines.length * 34;
    const x = (W - bw) / 2, y = Math.max(50, (H - 58 - bh) / 2);
    ctx.save();
    ctx.fillStyle = 'rgba(14,18,10,0.94)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = '#e2c35a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = '#e2c35a';
    ctx.font = '700 16px ' + FONT_SANS;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('1호차 조준 화면', x + 18, y + 14);
    ctx.fillStyle = '#8f9873';
    ctx.font = '500 11px ' + FONT_SANS;
    ctx.fillText('조준 중에는 무전 지휘가 막히고, 1호차는 조준경 밖을 잘 못 봅니다. 소대에 큰일이 나면 테두리가 깜빡입니다.', x + 18, y + 38);
    lines.forEach(([k, v], i) => {
      const ly = y + 62 + i * 34;
      ctx.fillStyle = '#d4d9b8';
      ctx.font = '700 12px ' + FONT_MONO;
      ctx.fillText(k, x + 18, ly);
      ctx.fillStyle = '#c3c8a6';
      ctx.font = '500 12px ' + FONT_SANS;
      ctx.fillText(fitText(ctx, v, bw - 170), x + 150, ly);
    });
    ctx.fillStyle = '#e2c35a';
    ctx.font = '600 11px ' + FONT_SANS;
    ctx.textAlign = 'right';
    ctx.fillText('아무 곳이나 클릭하거나 키를 누르면 닫힘', x + bw - 16, y + bh - 20);
    ctx.restore();
  }

  // 열상 화면 잡음 무늬
  let grain = null;
  function grainPattern(ctx) {
    if (grain) return grain;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = Math.random() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 22;
    }
    g.putImageData(img, 0, 0);
    grain = ctx.createPattern(c, 'repeat');
    return grain;
  }

  /**
   * 한 프레임. ui: main.js 의 game.scopeUi { alert, voice, guide, recoil }
   */
  function draw(ctx, canvas, game, now) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(50, rect.width), H = Math.max(50, rect.height);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const s = game.scope;
    s.aspect = (H - 58) / W;
    const u = S().unit(game);
    const night = game.light === 'night';
    const ui = game.scopeUi;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!u) return;

    // 사격 반동: 화면 흔들림
    const rk = ui.recoil ? clamp(1 - (now - ui.recoil) / 0.6, 0, 1) : 0;
    const shake = rk > 0 ? rk * 6 : ui.hitShake && now - ui.hitShake < 0.5 ? (1 - (now - ui.hitShake) / 0.5) * 9 : 0;
    const shx = shake ? (Math.random() - 0.5) * shake : 0, shy = shake ? (Math.random() - 0.5) * shake : 0;

    const T = buildTerrain(game, u, W, H - 58, dpr, night);
    ctx.save();
    ctx.translate(shx, shy);
    ctx.drawImage(T.canvas, 0, 0, W, H - 58);
    const ppr = T.ppr;

    // 표적: 먼 것부터
    const list = S().visibleTargets(game, u).map((x) => Object.assign(x, { d: TMM.Ballistics.distanceM(game.map, u, x.t) }));
    const wrecks = [];
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.wreck) continue;
      const t = c.unit;
      const d = TMM.Ballistics.distanceM(game.map, u, t);
      if (d > 4500 || !TMM.Sight.line(game.map, u, t).clear) continue;
      wrecks.push({ t, pv: null, d, wreck: true });
    }
    const all = list.concat(wrecks).sort((a, b) => b.d - a.d);
    const tags = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H - 58);
    ctx.clip();
    for (const it of all) {
      const box = drawTarget(ctx, game, u, T, it.t, it.pv, W, H - 58, night, now, it.wreck);
      if (box && !it.wreck) tags.push(box);
    }
    drawFx(ctx, game, u, T, W, H - 58, now, night);
    ctx.restore();

    // 표적 이름표
    ctx.font = '600 10px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const b of tags) {
      const c = b.c;
      if (!c) continue;
      let text, col;
      if (!c.identified) { text = '? ' + c.label + ' ' + Math.round(c.idProg * 100) + '%'; col = '#e8cf4a'; }
      else if (c.kind === 'friendly') { text = c.unit.callsign + ' (아군)'; col = '#7fb6e8'; }
      else { text = c.unit.callsign; col = '#ff7a5f'; }
      const ty = Math.max(14, b.top - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const tw = ctx.measureText(text).width + 6;
      ctx.fillRect(b.cx - tw / 2, ty - 12, tw, 12);
      ctx.fillStyle = col;
      ctx.fillText(text, b.cx, ty);
    }

    // 열상: 주사선·잡음 / 주간: 렌즈 색조
    if (night) {
      ctx.fillStyle = grainPattern(ctx);
      ctx.save();
      ctx.translate((Math.random() * 128) | 0, (Math.random() * 128) | 0);
      ctx.fillRect(-128, -128, W + 256, H + 128);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < H - 58; y += 3) ctx.fillRect(0, y, W, 1);
    } else {
      ctx.fillStyle = 'rgba(40,60,30,0.06)';
      ctx.fillRect(0, 0, W, H - 58);
    }
    // 가장자리 어둡게
    const vg = ctx.createRadialGradient(W / 2, (H - 58) / 2, Math.min(W, H) * 0.35, W / 2, (H - 58) / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H - 58);

    // 내 포구 섬광·먼지 (발사 직후 잠깐 앞이 안 보임)
    if (rk > 0) {
      const fl = clamp((rk - 0.75) / 0.25, 0, 1);
      if (fl > 0) { ctx.fillStyle = night ? 'rgba(255,255,255,' + (0.9 * fl).toFixed(2) + ')' : 'rgba(255,236,190,' + (0.8 * fl).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H - 58); }
      ctx.fillStyle = night ? 'rgba(130,130,130,' + (0.55 * rk).toFixed(2) + ')' : 'rgba(150,132,100,' + (0.6 * rk).toFixed(2) + ')';
      ctx.fillRect(0, (H - 58) * (0.35 - 0.2 * rk), W, H);
    }

    const prev = S().preview(game);
    const rxp = W / 2 + s.rx * W, ryp = (H - 58) / 2 - s.ry * W;
    drawReticle(ctx, game, rxp, ryp, night, prev, now);
    ctx.restore();

    drawCompass(ctx, game, u, W, night, T);
    // 왼쪽 위·오른쪽 위 글자
    ctx.fillStyle = 'rgba(6,8,5,0.6)';
    ctx.fillRect(4, 6, Math.min(240, W * 0.2), 36);
    ctx.fillRect(W - Math.min(300, W * 0.2) - 4, 6, Math.min(300, W * 0.2), 36);
    ctx.font = '700 11px ' + FONT_SANS;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = night ? '#e8e8e8' : '#e2c35a';
    ctx.fillText(night ? '1호차 열상 조준경 · 백열' : '1호차 조준경 · 주간', 12, 12);
    ctx.fillStyle = '#c3c8a6';
    ctx.font = '500 10px ' + FONT_SANS;
    ctx.fillText(fitText(ctx, '포수 김태윤 상병 · 탄약수 이도현 이병', Math.min(240, W * 0.2) - 12), 12, 28);
    ctx.textAlign = 'right';
    ctx.font = '700 11px ' + FONT_SANS;
    ctx.fillStyle = night ? '#e8e8e8' : '#e2c35a';
    ctx.fillText('Tab 지도로', W - 12, 12);
    ctx.font = '500 10px ' + FONT_SANS;
    ctx.fillStyle = '#c3c8a6';
    ctx.fillText(fitText(ctx, '무전 명령 불가 · 8·9·0 사격 통제 · R 보고', Math.min(290, W * 0.2) - 8), W - 12, 28);

    drawHullIcon(ctx, game, u, W, H, night);
    drawMiniLog(ctx, game, W, H);
    drawVoice(ctx, ui, W, H, now);
    drawHud(ctx, game, u, W, H, night, prev, now);
    drawAlert(ctx, ui, W, H, now);

    if (game.paused && !game.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H - 58);
      ctx.fillStyle = '#e2c35a';
      ctx.font = '700 18px ' + FONT_SANS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(game.started ? '일시정지 — 조준·사격 불가' : '작전 대기 — 조준·사격 불가', W / 2, (H - 58) * 0.36);
      ctx.font = '500 12px ' + FONT_SANS;
      ctx.fillStyle = '#d4d9b8';
      ctx.fillText('스페이스바로 ' + (game.started ? '재개' : '작전 개시') + '. 멈춰 놓고 조준할 수는 없습니다.', W / 2, (H - 58) * 0.36 + 24);
    }
    if (ui.guide) drawGuide(ctx, W, H);
  }

  // 화면 좌표 → 조준선 위치 (scope.rx, ry)
  function setReticle(game, canvas, sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, Hv = rect.height - 58;
    const s = game.scope;
    s.rx = clamp((sx - W / 2) / W, -0.5, 0.5);
    s.ry = clamp(((Hv / 2) - clamp(sy, 0, Hv)) / W, -s.aspect / 2, s.aspect / 2);
  }

  // 지금 조준선의 화면 위치 (예광 효과 시작점)
  function reticleScreen(game, canvas) {
    const rect = canvas.getBoundingClientRect();
    const s = game.scope;
    return { x: rect.width / 2 + s.rx * rect.width, y: (rect.height - 58) / 2 - s.ry * rect.width };
  }

  return { draw, setReticle, reticleScreen };
})();
