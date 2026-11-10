/*
 * 탐지와 식별 (M3). 아군·적 모두 같은 규칙을 쓴다.
 *
 * 편(side)마다 '접촉(contact)' 표를 가진다. 접촉 = 그 편이 알고 있는 상대 하나.
 *   - 탐지: 관측자(전차)에서 시선이 통하고 탐지 거리 안이면 보인다 → 접촉이 생기고 '미상 표적'.
 *   - 식별: 보이는 동안 식별 진행도가 쌓인다. 다 차면 '적 전차' / '아군 보병' 등으로 식별.
 *           식별 시간은 거리·가림 정도·관측 장비·낮밤에 따라 다르다 (TMM.SENSORS).
 *   - 피아식별장치(IFF): K1A2·K2 는 아군이 탐지하는 즉시 아군으로 식별된다.
 *   - 시야 공유: 같은 편 전차 한 대가 본 접촉은 편 전체가 공유한다 (K1A2 전장관리체계, 적은 무전).
 *     단, '사격'은 그 전차가 직접 볼 때만 할 수 있다.
 *   - 안개 전쟁: 아무도 못 보면 접촉은 '마지막 위치'만 남고, MEMORY_SEC 이 지나면 지워진다.
 *
 * 관측자는 각 편의 전차 (아군: 소대 K1A2 4대, 적: 천마호). 플레이어가 지휘하지 않는 아군(보병·트럭·K2)은
 * 전장관리체계에 연결되지 않은 것으로 보고 관측자에서 뺀다.
 *
 * 결과:
 *   game.vis: Map(관측자 id → Map(표적 id → { d, obs, hullDown, idTime })) — 이번 시야 계산에서 보이는 쌍
 *   game.intel.friend / game.intel.enemy: { contacts: Map(표적 id → contact), next }
 *   contact: { id, label, unit, visible, seenBy[], lastX, lastY, lastSeen, firstSeen, idProg, identified,
 *              kind('hostile'|'friendly'|null), cls, wreck, dist, obs }
 * 사건: contact-new, contact-id
 */
TMM.Intel = (function () {
  const V = () => TMM.VISION;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  function init(game) {
    game.vis = new Map();
    game.intel = { friend: { contacts: new Map(), next: 0 }, enemy: { contacts: new Map(), next: 0 } };
    game.visAcc = 0;
    game.visReady = false;
  }

  function observers(game, side) {
    const list = side === 'friend' ? game.units : game.enemies;
    return list.filter((u) => !u.destroyed && !u.exited && TMM.SENSORS[u.model]);
  }

  function targets(game, side) {
    return side === 'friend' ? game.enemies.concat(game.allies) : game.units.concat(game.allies);
  }

  const moving = (u) => u.state === 'moving';

  function terrainSight(map, u) {
    const t = map.typeAt(u.x, u.y);
    return t < 0 ? TMM.TERRAIN_SIGHT[0] : TMM.TERRAIN_SIGHT[t];
  }

  // 관측자 o 가 표적 t 를 보는가. 보이면 { d, obs, hullDown, idTime }, 아니면 null
  function pairVis(game, o, t) {
    const map = game.map;
    const sens = TMM.SENSORS[o.model][game.light];
    const sig = TMM.SIGNATURE[t.model];
    const d = TMM.Ballistics.distanceM(map, o, t);
    const ts = terrainSight(map, t);
    const flash = t.lastFiredAt != null && game.gameSeconds - t.lastFiredAt < V().FLASH_SEC;

    let r = sens.detect * sig.sig * ts.conceal;
    let idObs = ts.idObs;
    if (moving(t)) r *= V().MOVING_MUL;
    if (flash) {
      r = Math.max(r, sens.detect * V().FLASH_MUL[game.light]);
      idObs *= 0.5;
    }
    if (d > r) return null;
    const los = TMM.Sight.line(map, o, t);
    if (!los.clear) return null;
    if (d > r * (1 - 0.5 * los.obs)) return null; // 숲 사이로 희미하게 보이면 탐지 거리가 줄어든다
    const obs = los.obs + idObs;
    const idTime = sens.idBase * (0.4 + d / 1000) * (1 + 2 * obs) * sig.id;
    return { d, obs, hullDown: los.hullDown && !moving(t) && TMM.VEHICLES[t.model].cls === 'tank', idTime };
  }

  function identify(game, side, c, t, events, how) {
    c.identified = true;
    c.idProg = 1;
    c.kind = t.side === side ? 'friendly' : 'hostile';
    c.cls = TMM.VEHICLES[t.model].cls;
    if (events) events.push({ type: 'contact-id', side, contact: c, unit: t, how: how || 'sight' });
  }

  function newContact(S, t, now) {
    const label = LETTERS[S.next % LETTERS.length] + (S.next >= LETTERS.length ? Math.floor(S.next / LETTERS.length) : '');
    S.next += 1;
    return {
      id: t.id, label, unit: t, visible: false, seenBy: [], lastX: t.x, lastY: t.y, lastSeen: now, firstSeen: now,
      idProg: 0, identified: false, kind: null, cls: null, wreck: false, dist: 0, obs: 0,
    };
  }

  function updateSide(game, side, dt, events) {
    const S = game.intel[side];
    const obsList = observers(game, side);
    const now = game.gameSeconds;
    for (const t of targets(game, side)) {
      let c = S.contacts.get(t.id);
      if (t.exited) {
        if (c) S.contacts.delete(t.id);
        continue;
      }
      if (t.destroyed) {
        if (c && !c.wreck) {
          if (now - c.lastSeen <= V().UPDATE_SEC * 2) {
            // 보는 앞에서 격파됨 → 잔해 위치는 계속 표시, 정체도 확인됨
            c.wreck = true;
            c.visible = false;
            c.lastX = t.x;
            c.lastY = t.y;
            if (!c.identified) identify(game, side, c, t, null);
          } else if (now - c.lastSeen > V().MEMORY_SEC) S.contacts.delete(t.id);
          else c.visible = false;
        }
        continue;
      }

      let best = null;
      const seenBy = [];
      for (const o of obsList) {
        const pv = pairVis(game, o, t);
        if (!pv) continue;
        let m = game.vis.get(o.id);
        if (!m) game.vis.set(o.id, (m = new Map()));
        m.set(t.id, pv);
        seenBy.push(o.id);
        if (!best || pv.idTime < best.idTime) best = pv;
      }

      if (best) {
        const fresh = !c;
        if (fresh) {
          c = newContact(S, t, now);
          S.contacts.set(t.id, c);
        }
        c.visible = true;
        c.seenBy = seenBy;
        c.lastX = t.x;
        c.lastY = t.y;
        c.lastSeen = now;
        c.dist = best.d;
        c.obs = best.obs;
        if (fresh) events.push({ type: 'contact-new', side, contact: c, unit: t, by: seenBy[0] });
        if (!c.identified) {
          if (side === t.side && TMM.VEHICLES[t.model].iff) identify(game, side, c, t, events, 'iff');
          else {
            c.idProg = Math.min(1, c.idProg + dt / best.idTime);
            if (c.idProg >= 1) identify(game, side, c, t, events, 'sight');
          }
        }
      } else if (c) {
        c.visible = false;
        c.seenBy = [];
        if (now - c.lastSeen > V().MEMORY_SEC) S.contacts.delete(t.id);
      }
    }
  }

  function update(game, gdt, events) {
    game.visAcc += gdt;
    if (game.visReady && game.visAcc < V().UPDATE_SEC) return;
    const dt = game.visReady ? game.visAcc : 0;
    game.visAcc = 0;
    game.visReady = true;
    game.vis = new Map();
    updateSide(game, 'friend', dt, events);
    updateSide(game, 'enemy', dt, events);
    // 소대 전차의 차체 엄폐 상태 (지도 기호·정보 창 표시용)
    for (const u of game.units) {
      if (u.destroyed) { u.hullDown = false; u.cover = null; continue; }
      u.cover = coverStatus(game, u);
      u.hullDown = u.cover.list.some((x) => x.hullDown);
    }
  }

  // ---- 조회 ----
  function sees(game, o, t) {
    const m = game.vis.get(o.id);
    return (m && m.get(t.id)) || null;
  }

  function contact(game, side, id) {
    return game.intel[side].contacts.get(id) || null;
  }

  // 사격 명중 배수용
  function fireMods(game, shooter, target) {
    const pv = sees(game, shooter, target);
    return { obs: pv ? pv.obs : 0, hullDown: pv ? pv.hullDown : false, light: game.light };
  }

  // 오인사격·격파 등으로 정체가 드러남
  function reveal(game, side, t, events, how) {
    let c = contact(game, side, t.id);
    if (!c) {
      const S = game.intel[side];
      c = newContact(S, t, game.gameSeconds);
      S.contacts.set(t.id, c);
    }
    if (!c.identified) identify(game, side, c, t, events, how);
    return c;
  }

  // 지도 표시 이름
  function displayName(c) {
    if (!c.identified) return '미상 표적 ' + c.label;
    return c.unit.callsign;
  }

  const isHostile = (c) => !!c && c.identified && c.kind === 'hostile';

  /**
   * 아군 전차 u 의 차체 엄폐 상태 (정보 창용): 지금 보이는 적대 접촉 각각에서 볼 때 엄폐인가.
   * 반환: { moving, list: [{ contact, hullDown, sees }] }
   */
  function coverStatus(game, u) {
    const out = { moving: moving(u), list: [] };
    for (const c of game.intel.friend.contacts.values()) {
      if (!c.visible || c.wreck || c.kind === 'friendly') continue;
      if (c.unit.model === 'INF' || c.unit.model === 'TRUCK') continue;
      const los = TMM.Sight.line(game.map, c.unit, u);
      out.list.push({ contact: c, hullDown: los.clear && los.hullDown && !out.moving, sees: los.clear });
    }
    return out;
  }

  return { init, update, sees, contact, fireMods, reveal, displayName, isHostile, coverStatus, pairVis };
})();
