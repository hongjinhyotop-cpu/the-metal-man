/*
 * 탄종·차종 수치표 (M2 사격과 피해).
 *
 * 공개 자료에서 확인되는 것:
 *   - K1A2: 120mm 44구경장 활강포, 120mm 탄 32발 적재, 포수·전차장 조준경 분리(헌터킬러),
 *           2축 안정화로 기동 간 사격 가능, 수동 장전(장전수).
 *   - K276 날개안정분리철갑탄(APFSDS-T), K277 고폭다목적탄(HEAT-MP-T): K1A1/K1A2 120mm 주력 탄종.
 *   - 천마호: 북한이 T-62 를 바탕으로 개량한 전차. 115mm 활강포(일부 개량형은 125mm), 수동 장전.
 *     여기서는 '115mm 활강포 탑재형'으로 가정한다.
 *
 * 그 밖의 확률·시간 숫자는 모두 "게임용 추정치"이다. 실제 성능을 뜻하지 않으며,
 * 게임 균형을 위해 이 파일만 고치면 된다.
 *
 * 거리는 m. 확률 곡선은 [[거리, 확률], ...] 을 직선 보간한다.
 */
TMM.AMMO = {
  K276: {
    id: 'K276',
    name: 'K276 날개안정분리철갑탄',
    short: '철갑탄',
    use: '전차용',
    caliber: '120mm',
    rangeM: 3000, // 게임용 추정치: 최대 교전 거리
    // 게임용 추정치: 정지 사수 → 정지 표적 명중 확률
    hit: [[0, 0.95], [1000, 0.85], [2000, 0.45], [2500, 0.25], [3000, 0.12]], // M3 에서 원거리 명중을 낮춤 (2km 밖은 표적이 작고 신기루·먼지)
    // 게임용 추정치: 관통하지 못해도 외부 장비(궤도·조준경 등)가 손상될 확률
    externalDamage: 0.2,
    killMul: 1.0, // 관통 시 격파 확률 배수
  },
  K277: {
    id: 'K277',
    name: 'K277 고폭다목적탄',
    short: '고폭탄',
    use: '장갑차·건물·보병용',
    caliber: '120mm',
    rangeM: 2500, // 게임용 추정치: 철갑탄보다 탄속이 느려 유효 거리가 짧다
    hit: [[0, 0.92], [1000, 0.8], [2000, 0.35], [2500, 0.15]],
    externalDamage: 0.45, // 폭발 효과로 외부 장비 손상이 잦다 (게임용 추정치)
    killMul: 0.9,
  },
  E115: {
    id: 'E115',
    name: '115mm 날개안정분리철갑탄',
    short: '115mm',
    use: '전차용',
    caliber: '115mm',
    rangeM: 3000, // 게임용 추정치: 구형 사격통제장치라 2km 밖은 명중을 기대하기 어렵지만, 보이면 사격은 한다
    hit: [[0, 0.9], [500, 0.86], [1000, 0.78], [1500, 0.65], [2000, 0.38], [2500, 0.15], [3000, 0.06]], // M4 에서 올림 (무전 지휘가 생겨 플레이어가 강해짐)
    externalDamage: 0.25,
    killMul: 1.0,
  },
};

/*
 * 관통 확률: [탄종][표적 차종][부위] = [500m 이내, 최대 사거리]  — 모두 게임용 추정치.
 * 고폭다목적탄(성형작약)은 거리에 따라 관통력이 줄지 않는다.
 * 천마호는 T-62 계열이라 120mm 탄에 대해 대부분 관통되고,
 * K1A2 정면 복합장갑은 115mm 철갑탄을 거의 막는다는 공개 평가를 반영했다.
 */
TMM.PENETRATION = {
  K276: {
    CHONMA: { front: [0.97, 0.9], side: [0.99, 0.97], rear: [0.99, 0.98] },
    K1A2: { front: [0.25, 0.1], side: [0.85, 0.7], rear: [0.95, 0.9] },
    K2: { front: [0.15, 0.05], side: [0.75, 0.6], rear: [0.9, 0.85] }, // 오인사격용
  },
  K277: {
    CHONMA: { front: [0.8, 0.8], side: [0.93, 0.93], rear: [0.96, 0.96] },
    K1A2: { front: [0.05, 0.05], side: [0.5, 0.5], rear: [0.8, 0.8] },
    K2: { front: [0.03, 0.03], side: [0.4, 0.4], rear: [0.75, 0.75] },
  },
  E115: {
    K1A2: { front: [0.12, 0.05], side: [0.9, 0.75], rear: [0.95, 0.9] }, // M4: 측면·후면을 더 아프게 (엄호 방향 지휘의 가치)
    K2: { front: [0.06, 0.02], side: [0.5, 0.35], rear: [0.8, 0.65] },
    CHONMA: { front: [0.6, 0.4], side: [0.9, 0.8], rear: [0.95, 0.9] },
  },
};

/*
 * 차종. M3 에서 더한 필드:
 *   cls:  'tank' | 'truck' | 'infantry' (지도 기호·표적 우선순위)
 *   iff:  피아식별장치 (아군이 탐지하면 곧바로 '아군'으로 식별됨). K1A2·K2 에 있음.
 *   soft: 장갑이 없는 표적 (트럭·보병). 맞으면 관통 판정 없이 피해를 입는다.
 *   size: 표적 크기에 따른 명중 배수 (보병 분대는 흩어져 있어 맞히기 어려움)
 */
TMM.VEHICLES = {
  K1A2: {
    id: 'K1A2',
    name: 'K1A2',
    cls: 'tank',
    iff: true,
    size: 1,
    gun: '120mm 활강포',
    ammoLoad: { K276: 20, K277: 12 }, // 합계 32발. 탄종 배분은 게임용 추정치
    ammoTypes: ['K276', 'K277'],
    reloadSec: 7, // 게임용 추정치: 수동 장전 약 7초
    aimSec: 4, // 게임용 추정치: 새 표적 조준·거리 측정
    moveFireMul: 0.8, // 기동 간 사격 시 명중 배수 (2축 안정화)
    targetMoveMul: 0.7, // 움직이는 표적 명중 배수 (사격통제장치가 리드 계산해도 원거리에선 오차)
    canFireOnMove: true,
    killOnPen: 0.6, // 관통 시 격파 확률 (탄약 분리 보관) — 게임용 추정치 (M3 0.3 → 0.5, M4 0.6)
    turnDegPerSec: 25, // 정지 중 차체를 표적 쪽으로 돌리는 속도
  },
  CHONMA: {
    id: 'CHONMA',
    name: '천마호',
    cls: 'tank',
    iff: false,
    size: 1,
    gun: '115mm 활강포',
    ammoLoad: { E115: 40 }, // T-62 계열 적재량 기준 (게임용 추정치)
    ammoTypes: ['E115'],
    reloadSec: 8, // 게임용 추정치: 좁은 포탑, 수동 장전 (M3 12 → 10, M4 8)
    aimSec: 5, // M4 6 → 5
    moveFireMul: 0.35,
    targetMoveMul: 0.6,
    canFireOnMove: false,
    killOnPen: 0.65, // 포탑 바닥·차체 안 탄약 적재로 유폭 위험 큼 — 게임용 추정치
    turnDegPerSec: 20,
  },
  // ---- M3: 플레이어가 지휘하지 않는 아군 (사격하지 않음) ----
  K2: {
    id: 'K2',
    name: 'K2',
    cls: 'tank',
    iff: true, // 피아식별장치 → 탐지 즉시 아군으로 표시
    size: 1,
    gun: '120mm 55구경장 활강포',
    ammoLoad: {},
    ammoTypes: [],
    reloadSec: 5,
    aimSec: 3,
    moveFireMul: 0.85,
    targetMoveMul: 0.75,
    canFireOnMove: true,
    killOnPen: 0.25,
    turnDegPerSec: 30,
  },
  TRUCK: {
    id: 'TRUCK',
    name: '보급 트럭',
    cls: 'truck',
    iff: false, // 피아식별장치 없음 → 식별 전에는 미상 표적
    soft: true,
    size: 0.9,
    ammoLoad: {},
    ammoTypes: [],
    killOnPen: 0.85, // 맞으면 대개 파괴 (게임용 추정치)
  },
  INF: {
    id: 'INF',
    name: '보병 분대',
    cls: 'infantry',
    iff: false,
    soft: true,
    size: 0.5, // 흩어진 보병은 전차포로 맞히기 어려움 (게임용 추정치)
    ammoLoad: {},
    ammoTypes: [],
    killOnPen: 0.55, // 명중 시 분대 전투력 상실 확률, 아니면 사상자 발생 (게임용 추정치)
  },
};

// 손상 부위
TMM.PARTS = {
  track: { name: '궤도', effect: '이동 불가' },
  engine: { name: '엔진', effect: '속도 저하' },
  gun: { name: '주포', effect: '사격 불가' },
  fcs: { name: '사격통제장치', effect: '명중률 저하' },
  radio: { name: '무전기', effect: '명령을 못 받고, 본 것을 소대에 공유하지 못함' },
};
TMM.PART_KEYS = ['track', 'engine', 'gun', 'fcs', 'radio'];

// 손상 효과 크기 (게임용 추정치)
TMM.DAMAGE_EFFECT = {
  engineSpeedMul: 0.5, // 엔진 손상 시 속도 절반
  fcsHitMul: 0.5, // 사격통제장치 손상 시 명중률 절반
};
