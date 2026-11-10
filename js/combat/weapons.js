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
    // M7a: 숲·건물 사이로 일부만 보이는 표적이나 차체 엄폐 표적에 강하다 — 가지·벽·흙둑에 걸려도 폭발 효과가 남는다 (게임용 추정치).
    // 그래서 개활지 원거리 전차전은 철갑탄, 시가지·숲·진지 공격은 고폭탄이 낫다 → 작전 명령 화면의 탄종 배분이 의미가 있다.
    obsPenaltyMul: 0.4, // 가림 정도에 따른 명중 감소를 이만큼만 받는다 (철갑탄 1)
    hullDownHit: 0.7, // 차체 엄폐 표적 명중 배수 (철갑탄 TMM.VISION.HULL_DOWN_HIT 0.5)
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
  // ---- M8a 새 적의 무기 ----
  // 125mm 활강포: 폭풍호·천마-20 (공개 자료: 폭풍호는 125mm 포와 개량된 사격통제장치를 갖춘 것으로 알려짐).
  // 명중 곡선은 천마호 115mm 보다 원거리에서 낫게 — 게임용 추정치.
  E125: {
    id: 'E125',
    name: '125mm 날개안정분리철갑탄',
    short: '125mm',
    use: '전차용',
    caliber: '125mm',
    rangeM: 3000,
    hit: [[0, 0.9], [500, 0.86], [1000, 0.78], [1500, 0.66], [2000, 0.42], [2500, 0.19], [3000, 0.08]], // 게임용 추정치 (천마호 115mm 보다 2km 밖에서 낫다)
    externalDamage: 0.3,
    killMul: 1.0,
  },
  // 불새-3 대전차미사일 (천마-20). 공개 자료: 북한의 레이저·유선 유도 계열 장거리 대전차미사일로 알려짐.
  // 사거리·속도·명중은 모두 게임용 추정치. 날아가는 동안 쏜 쪽이 표적을 계속 봐야 한다(연막·엄폐물에 숨으면 빗나감).
  ATGM: {
    id: 'ATGM',
    name: '불새-3 대전차미사일',
    short: '미사일',
    use: '전차용',
    caliber: '미사일',
    rangeM: 4500, // 게임용 추정치
    minM: 1200, // 이보다 가까우면 쏘지 않는다 (포를 쓴다)
    speedMs: 120, // 비행 속도 m/s — 1.5km 를 약 13초, 3km 를 약 25초 (게임용 추정치: 피할 틈을 주려고 느리게)
    hit: [[0, 0.9], [4500, 0.85]], // 끝까지 유도되면 (게임용 추정치)
    hullDownHit: 0.75, // 차체 엄폐 표적: 포탑만 보여도 유도로 꽤 맞힌다
    externalDamage: 0.4,
    killMul: 1.0,
  },
  // 대전차 로켓 (보병 대전차조의 휴대용 로켓·무반동총 계열) — 게임용 추정치
  ATR: {
    id: 'ATR',
    name: '대전차 로켓',
    short: '대전차 로켓',
    use: '전차용',
    caliber: '로켓',
    rangeM: 500,
    hit: [[0, 0.8], [150, 0.7], [300, 0.45], [450, 0.25], [500, 0.18]],
    externalDamage: 0.35,
    killMul: 0.7,
  },
  // 표시용 이름 (직접 쏘는 탄이 아님): 공동축 기관총, 포병 포탄, 자폭 드론
  MG: { id: 'MG', name: '공축 기관총', short: '기관총', caliber: '7.62mm', rangeM: 800, hit: [[0, 1]], externalDamage: 0, killMul: 1 },
  ARTY: { id: 'ARTY', name: '적 포병 포탄', short: '포탄', caliber: '포병', rangeM: 0, hit: [[0, 1]], externalDamage: 0, killMul: 1 },
  DRONE: { id: 'DRONE', name: '자폭 드론', short: '자폭 드론', caliber: '드론', rangeM: 0, hit: [[0, 1]], externalDamage: 0, killMul: 0.6 },
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
    POKPUNG: { front: [0.9, 0.75], side: [0.98, 0.95], rear: [0.99, 0.98] }, // M8a 폭풍호: 천마호보다 조금 단단함
    CHONMA20: { front: [0.72, 0.48], side: [0.96, 0.9], rear: [0.98, 0.95] }, // M8a 천마-20: 정면 복합장갑 (철갑탄도 가까울수록)
    K1A2: { front: [0.25, 0.1], side: [0.85, 0.7], rear: [0.95, 0.9] },
    K2: { front: [0.15, 0.05], side: [0.75, 0.6], rear: [0.9, 0.85] }, // 오인사격용
  },
  K277: {
    CHONMA: { front: [0.8, 0.8], side: [0.93, 0.93], rear: [0.96, 0.96] },
    POKPUNG: { front: [0.6, 0.6], side: [0.9, 0.9], rear: [0.95, 0.95] },
    CHONMA20: { front: [0.25, 0.25], side: [0.82, 0.82], rear: [0.94, 0.94] }, // 정면은 고폭탄이 잘 안 먹힌다 (능동방어체계는 별도)
    K1A2: { front: [0.05, 0.05], side: [0.5, 0.5], rear: [0.8, 0.8] },
    K2: { front: [0.03, 0.03], side: [0.4, 0.4], rear: [0.75, 0.75] },
  },
  E115: {
    K1A2: { front: [0.12, 0.05], side: [0.9, 0.75], rear: [0.95, 0.9] }, // M4: 측면·후면을 더 아프게 (엄호 방향 지휘의 가치)
    K2: { front: [0.06, 0.02], side: [0.5, 0.35], rear: [0.8, 0.65] },
    CHONMA: { front: [0.6, 0.4], side: [0.9, 0.8], rear: [0.95, 0.9] },
  },
  // ---- M8a (모두 게임용 추정치) ----
  E125: {
    K1A2: { front: [0.13, 0.05], side: [0.92, 0.8], rear: [0.96, 0.92] }, // 125mm: 정면은 K1A2 복합장갑이 대개 막는다
    K2: { front: [0.12, 0.05], side: [0.7, 0.55], rear: [0.9, 0.8] },
  },
  ATGM: { // 탠덤 성형작약: 거리와 상관없음
    K1A2: { front: [0.25, 0.25], side: [0.92, 0.92], rear: [0.97, 0.97] },
    K2: { front: [0.18, 0.18], side: [0.88, 0.88], rear: [0.96, 0.96] },
  },
  ATR: { // 정면은 거의 못 뚫고, 옆·뒤를 노린다
    K1A2: { front: [0.07, 0.07], side: [0.5, 0.5], rear: [0.8, 0.8] },
    K2: { front: [0.05, 0.05], side: [0.42, 0.42], rear: [0.75, 0.75] },
  },
};

// M8a: 위에서 맞는 공격(자폭 드론·포병 직격)의 관통 확률 — 전차 윗면은 얇다 (게임용 추정치)
TMM.TOP_PEN = { K1A2: 0.7, K2: 0.65 };

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
    ammoMax: 32,
    ammoTypes: ['K276', 'K277'],
    crewRoles: ['cmdr', 'gunner', 'loader', 'driver'], // M7b: 좌석 (탄약수가 비면 포수가 장전 — 느려짐)
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
  // ---- K2 ----
  // M3: 인접 중대 K2 (지나가기만 함, 사격 안 함). M7b: 대대가 보충해 주는 소대 K2 와 이웃 중대 '흑표' 지원 K2 가 같은 수치를 쓴다.
  // 공개 자료: 120mm 55구경장 활강포, 자동장전장치(승무원 3명: 전차장·포수·조종수), 기동 간 사격 능력 우수, 기동력 향상.
  // 이 게임의 K2 는 능동방호장치가 없는 기존 양산형으로 가정한다. 숫자는 모두 게임용 추정치.
  K2: {
    id: 'K2',
    name: 'K2',
    cls: 'tank',
    iff: true, // 피아식별장치 → 탐지 즉시 아군으로 표시
    size: 1,
    gun: '120mm 55구경장 활강포',
    ammoLoad: { K276: 24, K277: 16 }, // 합계 40발 (게임용 추정치)
    ammoMax: 40,
    ammoTypes: ['K276', 'K277'],
    reloadSec: 4.5, // 자동장전: 탄약수가 없고 장전 속도가 일정하다 (게임용 추정치)
    autoloader: true,
    aimSec: 3.5,
    hitMul: 1.08, // 55구경장: 원거리 탄도가 곧다 (게임용 추정치)
    moveFireMul: 0.92, // 기동 간 사격 우수
    targetMoveMul: 0.75,
    canFireOnMove: true,
    speedMul: 1.18, // 지형별 K1A2 속도 대비 (게임용 추정치)
    killOnPen: 0.5,
    turnDegPerSec: 30,
    crewRoles: ['cmdr', 'gunner', 'driver'],
  },
  // ---- M8a 새 적 (근거 없는 수치는 모두 게임용 추정치) ----
  // 폭풍호: 공개 자료상 천마호 다음 세대 북한 전차, 125mm 활강포·개량된 사격통제장치로 알려짐. 수가 적은 선발 부대.
  POKPUNG: {
    id: 'POKPUNG',
    name: '폭풍호',
    cls: 'tank',
    iff: false,
    size: 1,
    roundTurret: true,
    gun: '125mm 활강포',
    ammoLoad: { E125: 30 },
    ammoTypes: ['E125'],
    reloadSec: 7.5,
    aimSec: 4,
    moveFireMul: 0.35, // 안정화 장치가 있어 움직이며 쏘기도 한다 (천마호는 못 함) — 그래도 잘 안 맞음
    targetMoveMul: 0.62,
    canFireOnMove: true,
    killOnPen: 0.62,
    turnDegPerSec: 22,
  },
  // 천마-20: 가상의 최신 개량형. 하드킬 능동방어체계(날아오는 고폭탄을 일정 확률로 요격, 횟수 제한, 철갑탄은 못 막음),
  // 정면 복합장갑, 불새-3 대전차미사일. 숨어서 장거리 미사일을 쏜다 (js/game/missiles.js).
  CHONMA20: {
    id: 'CHONMA20',
    name: '천마-20',
    cls: 'tank',
    iff: false,
    size: 1,
    roundTurret: true,
    gun: '125mm 활강포 + 불새-3',
    ammoLoad: { E125: 28 },
    ammoTypes: ['E125'],
    missiles: 2, // 불새-3 (게임용 추정치)
    aps: { charges: 2, p: 0.75, vs: ['K277'] }, // 능동방어체계: 고폭탄 요격 확률·횟수 (게임용 추정치)
    reloadSec: 8.5, // 미사일 장비로 포탑이 좁다 (게임용 추정치)
    aimSec: 4,
    moveFireMul: 0.55,
    targetMoveMul: 0.62,
    canFireOnMove: true,
    killOnPen: 0.55,
    turnDegPerSec: 22,
  },
  // 보병 대전차조: 숲·시가지에 숨어 있다가 가까이 온 전차의 옆·뒤를 노린다. 고폭탄과 기관총이 잘 듣는다.
  ATINF: {
    id: 'ATINF',
    name: '대전차조',
    cls: 'infantry',
    iff: false,
    soft: true,
    size: 0.45, // 흩어져 엎드린 3~4명 (게임용 추정치)
    ammoLoad: { ATR: 3 },
    ammoTypes: ['ATR'],
    reloadSec: 22, // 로켓 재장전·자리 옮기기 (게임용 추정치)
    aimSec: 4,
    moveFireMul: 0,
    targetMoveMul: 0.65,
    canFireOnMove: false,
    killOnPen: 0.6, // 고폭탄이 맞으면 조가 전투력을 잃을 확률, 아니면 사상자 (게임용 추정치)
    turnDegPerSec: 120,
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
