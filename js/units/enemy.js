/*
 * 적 부대: 북한군 천마호 전차 1개 소대(4대).
 * 북쪽 매봉 능선 고갯길과 새터읍에서 출발해 두 갈래로 남하해 주둔지를 양쪽에서 협공한다 (M3).
 *   서쪽 조(1·2): 북부 도로 다리로 덕천을 건너 서쪽 기슭으로 내려온 뒤, 서부 도로 다리로 다시 건너 주둔지 남서쪽 숲 언덕으로.
 *   동쪽 조(3·4): 읍내 동쪽 길로 빠져 들말 평야 동쪽 끝을 돌아 주둔지 남동쪽 숲 언덕으로.
 * 두 경로는 주둔지에서 대부분 보이지 않는 곳(능선 그늘·숲 뒤)을 지나도록 골랐다.
 * 각 전차는 경유지(route)를 차례로 지나고, 집결지(stage 번째 경유지)에서 소대 전원이 모일 때까지 기다렸다가
 * 동시에 사격 진지(마지막 경유지, 숲 가장자리)로 나온다.
 */
TMM.Enemy = (function () {
  const ROSTER = [
    // x, y: 출발 위치 / route: 경유지 (stage 번째가 집결지, 마지막이 사격 진지)
    // gx, gy: 사격 진지에서 오래 아무것도 안 보이면 밀고 들어갈 곳 / lane: 교전 시 횡대 위치
    { id: 101, n: 1, x: 106.5, y: 9, route: [[96, 30], [70, 36], [36, 41], [18, 48], [15, 64], [20, 74], [36, 78.5], [32, 88], [42, 98], [50, 100]], stage: 8, gx: 72, gy: 100, lane: 0 },
    { id: 102, n: 2, x: 100, y: 15, route: [[92, 30], [68, 37], [36, 41], [16, 50], [13, 66], [18, 75], [36, 78.5], [31, 90], [41, 101.5], [49, 102.5]], stage: 8, gx: 70, gy: 106, lane: 0 },
    { id: 103, n: 3, x: 111, y: 22, route: [[126, 30], [142, 46], [146, 66], [140, 84], [134, 96], [121, 100]], stage: 4, gx: 96, gy: 102, lane: 0 },
    { id: 104, n: 4, x: 119, y: 26, route: [[130, 30], [150, 48], [150, 68], [144, 86], [136, 102], [121.5, 104.5]], stage: 4, gx: 96, gy: 108, lane: 0 },
  ];

  // 개별 후퇴 집결지: 매봉 능선 고갯길 북쪽
  const RALLY = { x: 106.5, y: 6 };
  // 소대가 전투력을 잃으면 빠져나가는 곳: 지도 북쪽 끝 국도
  const EXIT = { x: 108, y: 0.6 };

  // spec (M7a 캠페인): 같은 모양의 목록. 더한 필드 —
  //   static: 진지 방어 (움직이지 않고 보이는 아군과 싸움, 손상되면 후퇴) · delay: 작전 개시 후 이만큼(게임 초) 뒤에 움직임
  //   engageM: 교전 거리 (집결·진지 도착과 상관없이 이 거리) · fireM: 이 거리 안의 표적만 쏨(매복) · stage: -1 이면 집결하지 않음 · heading
  function create(spec) {
    return (spec || ROSTER).map((d) => TMM.Damage.initCombat({
      id: d.id,
      num: d.n,
      side: 'enemy',
      callsign: '적 전차 ' + d.n,
      role: '천마호 소대',
      team: 0,
      x: d.x,
      y: d.y,
      heading: d.heading != null ? d.heading : Math.PI / 2, // 남쪽을 향함
      path: [],
      dest: null,
      state: 'idle',
      speedKmh: 0,
      ai: {
        mode: d.static ? 'defend' : 'advance',
        route: (d.route || []).map(([x, y]) => ({ x, y })).concat(d.gx != null ? [{ x: d.gx, y: d.gy }] : []),
        wp: 0,
        stage: d.stage,
        staged: false,
        wait: 0,
        repath: 0,
        lane: d.lane,
        deployed: false,
        lastThreatAt: -1e9,
        static: !!d.static,
        delay: d.delay || 0,
        pending: !!d.delay, // 아직 도착 전 (지도 밖에 있는 것으로 친다 — exited 와 같이 쓴다)
        engageM: d.engageM || null,
        fireM: d.fireM || null, // 이 거리 안에 들어온 표적만 쏜다 (진지 매복)
        tag: d.tag || null, // 작전 목표용 표시 (교량 사수: 'west' 하천 서쪽에서 오는 적)
      },
    }, 'CHONMA')).map((e) => {
      if (e.ai.pending) e.exited = true; // 늦게 오는 적: 도착할 때까지 보이지도, 쏘지도 않는다
      return e;
    });
  }

  return { create, RALLY, EXIT, ROSTER };
})();
