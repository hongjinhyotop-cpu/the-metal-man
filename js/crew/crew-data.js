/*
 * 승무원 명단·성격·말투 (M5 승무원과 신뢰도).
 * 이름과 인물은 모두 가상이다. 숫자는 모두 게임용 추정치이며, 승무원 균형은 이 파일과 crew.js 위쪽의 TMM.CREW 만 고치면 된다.
 *
 * 승무원 한 명: { key, name, rank, role('cmdr'|'gunner'|'loader'|'driver'), skill(숙련도 0~100), morale(사기), fatigue(피로), traits, about }
 * traits (성격이 게임에 주는 효과):
 *   hitMul 명중 배수 · longHitMul 1.5km 밖 명중 배수 · aimMul 조준 시간 배수 · reloadMul 장전 시간 배수
 *   slip 탄종 실수 경향(숙련도가 오르면 줄어듦) · growth 성장 속도 배수 · speedMul 기동 속도 배수 · breakdownMul 고장 확률 배수
 *   fatigueMul 피로 쌓이는 속도 · grumble 투덜거림 · asksBack 예상 밖 명령을 되물음 · jumpy 긴장(빠르지만 오인 보고·조기 사격)
 *   friction 전차장과 갈등 · moraleGuard 같은 전차 사기 하락 배수 · veteran 자율 판단 최강·명령 해석 · bond 함께 있으면 효율↑ · fears 그 사람이 다치면 흔들림
 */
TMM.CREW_ROLES = {
  cmdr: { name: '전차장', effect: '명령 반응 속도 · 식별 속도 · 자율 판단' },
  gunner: { name: '포수', effect: '명중률 · 조준 시간' },
  loader: { name: '탄약수', effect: '장전 시간 · 탄종 실수' },
  driver: { name: '조종수', effect: '기동 속도 · 엄폐 진입 · 고장' },
};
TMM.CREW_ROLE_ORDER = ['cmdr', 'gunner', 'loader', 'driver'];

TMM.CREW_ROSTER = {
  1: [
    { key: 'player', name: '소대장', rank: '소위', role: 'cmdr', skill: 55, morale: 65, player: true, about: '소대장 겸 전차장 · 직접 조작' },
    { key: 'kty', name: '김태윤', rank: '상병', role: 'gunner', skill: 80, morale: 60, traits: { hitMul: 1.08, aimMul: 0.9 }, about: '탄약수 출신 실력파. 말수 적고 후임을 묵묵히 가르침' },
    { key: 'ldh', name: '이도현', rank: '이병', role: 'loader', skill: 22, morale: 70, traits: { reloadMul: 1.05, slip: 0.17, growth: 3 }, about: '전입 2주차. 열심인데 자꾸 헷갈림' },
    { key: 'psh', name: '박성훈', rank: '병장', role: 'driver', skill: 85, morale: 45, traits: { speedMul: 1.1, grumble: true }, about: '전역 D-30 말년 병장. 입만 살았고 운전은 최고' },
  ],
  2: [
    { key: 'cms', name: '최민수', rank: '중사', role: 'cmdr', skill: 65, morale: 60, traits: { asksBack: true }, about: '원칙주의자. 교범대로, 보고 정확' },
    { key: 'jwj', name: '정우진', rank: '상병', role: 'gunner', skill: 68, morale: 55, traits: { longHitMul: 1.18 }, about: '조용한 저격수형' },
    { key: 'hjm', name: '한재민', rank: '일병', role: 'loader', skill: 50, morale: 55, traits: { fatigueMul: 0.5 }, about: '체력 좋은 무덤덤 타입' },
    { key: 'osh', name: '오세훈', rank: '상병', role: 'driver', skill: 55, morale: 55, about: '무난함' },
  ],
  3: [
    { key: 'yjh', name: '윤지호', rank: '하사', role: 'cmdr', skill: 38, morale: 70, traits: { jumpy: true, growth: 2 }, about: '초임 하사. 의욕 넘치는데 긴장을 잘함' },
    { key: 'smh', name: '송민혁', rank: '병장', role: 'gunner', skill: 70, morale: 45, traits: { friction: true }, about: '전차장보다 군생활 오래 한 병장. 하사를 은근 무시' },
    { key: 'icu', name: '임채운', rank: '일병', role: 'loader', skill: 48, morale: 80, traits: { moraleGuard: 0.55 }, about: '분위기 메이커' },
    { key: 'sjh', name: '서준호', rank: '상병', role: 'driver', skill: 58, morale: 55, traits: { speedMul: 0.9, breakdownMul: 0.2 }, about: '신중함' },
  ],
  4: [
    { key: 'jms', name: '장만석', rank: '상사', role: 'cmdr', skill: 92, morale: 60, traits: { veteran: true }, about: '20년차 부소대장, 소대의 실세. 새 소위를 시험하는 중' },
    { key: 'chs', name: '조현석', rank: '하사', role: 'gunner', skill: 72, morale: 60, traits: { bond: 'jms' }, about: '장 상사가 직접 키운 부하' },
    { key: 'msb', name: '문성빈', rank: '상병', role: 'loader', skill: 62, morale: 60, traits: { reloadMul: 0.85 }, about: '능청맞고 요령 좋음' },
    { key: 'rgh', name: '류경호', rank: '일병', role: 'driver', skill: 50, morale: 55, traits: { fears: 'jms' }, about: '장 상사를 제일 무서워함' },
  ],
};

// 2·3·4호차가 소대장을 믿는 정도 (0~100). 장만석 상사의 4호차는 낮게 시작한다.
TMM.CREW_TRUST_START = { 2: 60, 3: 55, 4: 30 };

/*
 * 대사. {rb} 는 복창 내용, {grid} 격자, {dir} 방향, {ammo}/{other} 탄종.
 * 유머 대사(banter·grumble·slip 의 긴 말투 등)는 교전이 조용할 때만, 같은 사람이 너무 자주 말하지 않게 crew.js 가 횟수를 제한한다.
 * 교전이 격할 때는 '짧은' 쪽만 쓴다.
 */
TMM.CREW_VOICE = {
  // 수신 복창 (조용할 때). 격할 때는 모두 '수신. {rb}.' 로 짧게.
  ack: {
    cms: ['수신. 교범대로 {rb} 하겠습니다.', '수신. {rb}. 교범대로 하겠습니다.'],
    cmsCover: ['수신. 교범대로 엄호 위치 점령하겠습니다. {rb}.'],
    yjh: ['수신! {rb}! 바로 하겠습니다!', '수신! {rb}, 알겠습니다!'],
    jmsLow: ['…알겠습니다. {rb}.', '수신. {rb}. 일단 그렇게 하죠.'],
    jmsMid: ['수신. {rb}.'],
    jmsHigh: ['수신. {rb}. 좋은 판단입니다, 소대장님.', '수신. {rb}. 그쪽이 맞습니다.'],
  },
  // 최민수: 예상 밖 명령을 되묻는다 (그만큼 늦어진다)
  askBack: {
    withdraw: '확인한다. 철수 맞습니까? 교범상 엄호 조 지정이 먼저입니다.',
    bound: '확인한다. 엄호 이동, 우리 조 순서 맞습니까?',
    target: '확인한다. 미식별 표적에 사격 맞습니까?',
    flip: '확인한다. 앞 명령 취소하고 새 명령 맞습니까?',
    roe: '확인한다. 자유 사격 맞습니까? 전방에 아군 있습니다.',
    short: '확인 바람.',
  },
  // 신뢰가 낮을 때 머뭇거림
  doubt: ['…다시 확인 바란다. {rb} 맞습니까?', '소대장님, {rb} 확실합니까?'],
  // 명령을 자주 뒤집을 때
  flip: {
    cms: '강철 1, 명령이 계속 바뀝니다. 하나로 정해 주십시오.',
    yjh: '아, 예! …어느 쪽으로 가면 됩니까?',
    jms: '소대장님, 하나만 정하시죠. 애들 헷갈립니다.',
  },
  // 장만석: 신뢰가 낮을 때 이동 위치를 근처 더 나은 엄폐물로 바꾸고 통보
  reinterpret: [
    '소대장님, 저기보다 여기가 낫습니다. {dir}쪽 {m}m, 격자 {grid} 로 갑니다.',
    '소대장님, 거기는 훤히 보입니다. 옆에 격자 {grid} 엄폐물 뒤로 들어가겠습니다.',
  ],
  // 장만석: 신뢰가 높을 때 먼저 의견을 낸다
  suggest: [
    '소대장님, 의견입니다. {dir}쪽 {m}m, 격자 {grid} 가 차체 엄폐됩니다. 옮길까요?',
    '소대장님, 여기보다 격자 {grid} 가 낫겠습니다. 명령 주시면 바로 갑니다.',
  ],
  // 송민혁 (3호차 내부 갈등, 무전 너머로 들림)
  friction: [
    ['smh', '네, 전차장님. 근데 그거 제가 일병 때 해봤는데 안 됩니다.'],
    ['smh', '전차장님, 그거 교육대에서 배운 대로 하시는 겁니까?'],
    ['smh', '…예, 예. 하라면 해야죠.'],
  ],
  frictionReply: ['…일단 하자, 송 병장.', '송민혁 병장, 지금 그럴 때 아니다!', '알아, 알아. 그래도 해.'],
  frictionShort: ['smh', '…알겠습니다.'],
  // 박성훈: 이동 명령에 투덜거림 (사기가 낮을수록 잦음)
  grumble: [
    '소대장님, 저 전역 30일 남았는데 이 길 말고 저 길로 가면 안 됩니까.',
    '네네, 갑니다. 말년한테 논두렁이라니요.',
    '소대장님, 이 길 승차감은 제가 보장합니다. 포탄만 안 날아오면요.',
    '아… 이럴 줄 알았으면 말년 휴가를 미리 썼어야 했는데.',
  ],
  // 이도현 탄종 실수
  slip: { line: '{ammo}… 아니 {other} 장전 완료!', reply: '…다시.', short: '탄종 착오! 다시 넣습니다!' },
  // 윤지호 오인 보고
  earlyReport: '적 전차 발견! …아, 정정. 미상 표적.',
  // 조용할 때 잡담 (여러 사람이 주고받는 것은 배열 순서대로)
  banter: [
    { tank: 1, lines: [['ldh', '상병님, 철갑탄이 어느 칸이었습니까?'], ['kty', '…왼쪽. 어제도 말했다.']] },
    { tank: 1, lines: [['psh', '소대장님, 전역 30일 남았습니다. 오늘이 29일인지 30일인지 같이 세 주실 수 있습니까?']] },
    { tank: 1, lines: [['ldh', '김 상병님은 이병 때 안 헷갈리셨습니까?'], ['kty', '…헷갈렸다. 그러니까 지금 외워.']] },
    { tank: 1, lines: [['psh', '도현아, 너 전역하면 뭐 할 거냐.'], ['ldh', '예? 저 아직 전입 2주차입니다…'], ['psh', '그래, 그게 문제다.']] },
    { tank: 2, lines: [['cms', '강철 2 승무원, 사거리표 확인. 정우진.'], ['jwj', '예. 외웠습니다.'], ['hjm', '…저는 안 피곤합니다. 물어보실 것 같아서.']] },
    { tank: 2, lines: [['osh', '중사님, 교범에 간식 시간은 없습니까?'], ['cms', '없다. 앞 봐라.']] },
    { tank: 3, lines: [['icu', '전차장님, 끝나고 PX 가면 냉동 제가 쏘겠습니다!'], ['smh', '너 월급날 아직 멀었잖아.'], ['icu', '그러니까 전차장님이 쏘시는 겁니다!']] },
    { tank: 3, lines: [['yjh', '다들 긴장 풀지 마! …나도 안 풀었다!'], ['icu', '전차장님, 숨은 쉬십시오.']] },
    { tank: 3, lines: [['sjh', '천천히 가겠습니다. 궤도 벗겨지면 다 같이 고생입니다.']] },
    { tank: 4, lines: [['msb', '부소대장님, 커피 한 잔 타 드릴까요? 포탑 안에서도 됩니다.'], ['jms', '됐다. 앞이나 봐.']] },
    { tank: 4, lines: [['jms', '경호야, 브레이크 살살 밟아라.'], ['rgh', '예, 예! 알겠습니다!']] },
    { tank: 4, lines: [['chs', '부소대장님, 신임 소대장님은 어떻습니까?'], ['jms', '…두고 보자.']] },
  ],
  // 격파했을 때 (조용할 때만, 횟수 제한)
  cheer: {
    1: [['ldh', '마, 맞았습니까? 맞았습니까?!'], ['kty', '…다음 탄.']],
    2: [['jwj', '…격파 확인.']],
    3: [['icu', '우와! 3호차 최고!'], ['smh', '…쟤 오늘 처음 맞힌 거 아니다.']],
    4: [['msb', '역시 부소대장님 팀입니다.']],
  },
  // 다쳤을 때
  hurtLight: '{who} 부상, 경상. 계속 임무 수행.',
  hurtHeavy: '{who} 중상! 응급처치 중. {role} 성능 저하.',
  // 류경호: 장만석이 다쳤을 때
  scared: ['rgh', '부, 부소대장님! 괜찮으십니까?! 어, 어떻게 합니까?!'],
  // 철수시켜 살렸을 때 (신뢰 상승)
  saved: {
    cms: '강철 1, 철수 완료. 판단 정확했습니다.',
    yjh: '강철 1, 철수 완료! 살았습니다, 소대장님!',
    jms: '강철 1, 철수 완료. …잘 빼 주셨습니다.',
  },
  // 고장 (조종수)
  breakdown: '궤도 장력 이상, 정비 조치 중. {sec}초.',
  // M6 1호차 조준 화면 (화면 자막. 무전 기록에는 남기지 않는다)
  scope: {
    // 탄약수 (1호차는 이도현 이병). 숙련도가 낮을 때 / 높아졌을 때
    loaded: ['장전 완료!', '장전 완료!', '장, 장전 완료!', '{ammo} 장전 완료! …맞습니다!', '장전 완료입니다!'],
    loadedSure: ['장전 완료.', '{ammo} 장전 완료.'],
    loadedHurt: ['…장전… 완료…!'],
    busy: ['아직입니다! 장전 중입니다!', '자, 잠깐만요! 넣고 있습니다!'],
    busySure: ['장전 중.'],
    // 포수 김태윤 상병
    lase: '거리 {d}.',
    laseMoving: '거리 {d}. 이동 표적, 리드 계산 완료.',
    laseNone: '측정 안 됩니다. 하늘입니다.',
    laseGround: '거리 {d}. 표적 아닙니다.',
    noFcs: '사통 나갔습니다. 레이저 안 됩니다. 눈대중으로 쏘셔야 합니다.',
    wild: '…표적 없습니다, 소대장님.',
    kill: ['표적 격파.', '격파 확인. 다음 표적.'],
    killCheer: ['ldh', '마, 맞았습니까?!'],
    pen: '명중, 관통.',
    hit: '명중. 관통 실패.',
    miss: ['빗나감. 재조준.', '근탄. 다시.'],
    ff: '사격 중지! 아군입니다!',
    range: '사거리 밖입니다.',
  },
};

/*
 * M7b 대대 보충병 (가상 인물). 재정비에서 빈자리를 채울 때 하나씩 만든다 (TMM.Campaign).
 * 능력은 낮은 신병(숙련도 22~34), 성격은 간단한 것 하나. 숫자는 모두 게임용 추정치.
 */
TMM.CREW_RECRUITS = {
  FAMILY: ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍'],
  GIVEN: ['민재', '준서', '지훈', '서진', '하람', '도윤', '윤성', '승우', '태민', '동하', '준영', '시우', '현우', '건희', '재원', '유찬', '성민', '다온', '우성', '지강'],
  RANKS: ['이병', '이병', '일병'],
  // 성격: 이름 · 설명 · 효과(traits)
  TYPES: [
    { name: '성실함', about: '시키는 건 끝까지 한다. 빨리 배운다', traits: { growth: 1.6 } },
    { name: '체력 좋음', about: '농구부 출신. 잘 안 지친다', traits: { fatigueMul: 0.7 } },
    { name: '손이 빠름', about: '정비병 출신. 손이 빠르다', traits: { reloadMul: 0.94 } },
    { name: '눈이 좋음', about: '시력 2.0 이 자랑', traits: { hitMul: 1.03 } },
    { name: '긴장을 잘함', about: '첫 실전이 무섭다. 그래도 도망은 안 간다', traits: { growth: 1.2 }, morale: -10 },
    { name: '말이 많음', about: '조용하면 불안하다. 분위기는 산다', traits: { moraleGuard: 0.85 } },
    { name: '무덤덤함', about: '무슨 일이 있어도 표정이 같다', traits: {} },
  ],
};

/*
 * M7b 재정비 중 승무원 이벤트. 재정비마다 1~2개, 같은 이벤트는 캠페인에서 한 번만.
 *   need: 모두 소대에 있어야(후송 안 됨) 나오는 사람 · minOp: 이 작전 번호(1~5) 앞의 재정비부터
 *   lines: [말하는 사람 key | 'me' | 'note', 대사] · choices: [{ label, lines, fx }]
 *   fx: [['morale', key, ±], ['trust', key(그 사람이 탄 전차), ±], ['skill', key, ±], ['fatigue', key, ±], ['mod', key, {성격 바꿈}],
 *        ['moraleTank', key(그 사람이 탄 전차 전원), ±], ['moraleAll', ±]]
 *   key 'recruit' 는 소대에 있는 보충병 한 명.
 */
TMM.CREW_EVENTS = [
  {
    id: 'smh_yjh', need: ['smh', 'yjh'], minOp: 2, title: '3호차의 말다툼', place: '정비 중인 3호차 옆',
    lines: [
      ['smh', '전차장님, 아까 그 사격 진지는 제가 말씀드린 데가 맞았습니다.'],
      ['yjh', '송 병장, 그 얘기 지금 해야겠어? 다들 듣는데!'],
      ['smh', '듣는 데서 해야 다음엔 안 틀리죠.'],
      ['icu', '(소대장님을 쳐다본다) …소대장님.'],
    ],
    choices: [
      { label: '윤지호 하사 편: "전차장은 윤 하사다."', lines: [['yjh', '…감사합니다, 소대장님.'], ['smh', '예. 알겠습니다.']], fx: [['morale', 'yjh', 12], ['morale', 'smh', -10], ['skill', 'yjh', 2]] },
      { label: '송민혁 병장 편: "송 병장 말도 일리가 있다."', lines: [['smh', '…그렇게 말씀해 주시니 고맙습니다.'], ['yjh', '(얼굴이 빨개진다) 알겠습니다.']], fx: [['morale', 'smh', 12], ['morale', 'yjh', -12], ['trust', 'yjh', -3]] },
      { label: '중재: "둘 다 맞다. 다음 진지는 둘이 같이 정해서 보고해."', lines: [['yjh', '…송 병장, 같이 지도 보자.'], ['smh', '예. …제가 펜 가져오겠습니다.'], ['note', '3호차의 무전이 조금 조용해졌다.']], fx: [['morale', 'smh', 4], ['morale', 'yjh', 4], ['mod', 'smh', { frictionMul: 0.45 }], ['trust', 'yjh', 5]] },
    ],
  },
  {
    id: 'ldh_slip', need: ['ldh'], minOp: 2, title: '이도현 이병의 자책', place: '1호차 포탑 위',
    lines: [
      ['ldh', '소대장님… 아까 제가 탄을 또 잘못 넣었습니다. 저 때문에 늦었습니다.'],
      ['ldh', '저 그냥 다른 데로 보내 주시면 안 됩니까…'],
    ],
    choices: [
      { label: '위로: "넌 잘하고 있다. 아무도 처음부터 안 틀리진 않아."', lines: [['ldh', '…예! 다음엔 안 틀리겠습니다!']], fx: [['morale', 'ldh', 15]] },
      { label: '따끔하게: "전쟁 중이다. 틀리면 다 죽는다. 다시 외워."', lines: [['ldh', '…예. 알겠습니다.'], ['note', '이도현 이병은 밤새 탄 자리를 손으로 짚으며 외웠다.']], fx: [['morale', 'ldh', -8], ['skill', 'ldh', 5], ['mod', 'ldh', { slip: 0.11 }]] },
      { label: '김태윤 상병에게 맡긴다: "김 상병, 네가 좀 봐 줘라."', need: ['kty'], lines: [['kty', '…예. 도현아, 이리 와. 왼쪽이 철갑, 오른쪽이 고폭. 다시.'], ['ldh', '예! 왼쪽 철갑!']], fx: [['morale', 'ldh', 6], ['skill', 'ldh', 3], ['morale', 'kty', 3], ['mod', 'ldh', { slip: 0.12 }]] },
    ],
  },
  {
    id: 'jms_plan', need: ['jms'], minOp: 3, title: '장만석 상사의 이견', place: '소대 지휘 천막',
    lines: [
      ['jms', '소대장님, 다음 작전 계획 봤습니다. 정면으로 붙는 건 반대입니다.'],
      ['jms', '저라면 한 조를 옆으로 돌려 엄호시키고, 나머지가 천천히 들어가겠습니다. 결정은 소대장님이 하십시오.'],
    ],
    choices: [
      { label: '받아들인다: "상사님 말이 맞습니다. 그렇게 하죠."', lines: [['jms', '…좋습니다. 제가 4호차 애들한테 그렇게 설명하겠습니다.']], fx: [['trust', 'jms', 10], ['morale', 'jms', 6]] },
      { label: '내 계획을 고수한다: "이번엔 제 계획대로 갑니다."', lines: [['jms', '…알겠습니다. 소대장님 계획대로 하죠.'], ['note', '장만석 상사는 더 말하지 않았다. 1호차 승무원들은 소대장의 결단에 고개를 끄덕였다.']], fx: [['trust', 'jms', -6], ['moraleTank', 'kty', 5]] },
      { label: '절충: "엄호 조는 상사님 안대로, 진입은 제 계획대로."', lines: [['jms', '흠. 나쁘지 않습니다. 그렇게 갑시다.']], fx: [['trust', 'jms', 4]] },
    ],
  },
  {
    id: 'psh_discharge', need: ['psh'], minOp: 2, title: '박성훈 병장의 전역 날짜', place: '1호차 옆 매트 위',
    lines: [
      ['psh', '소대장님, 진지하게 여쭙겠습니다. 전쟁 중에도 전역 날짜는 그대로입니까?'],
      ['psh', '제 달력에 동그라미가 스물 몇 개 남았는데, 이게 유효한 동그라미인지 궁금해서 말입니다.'],
    ],
    choices: [
      { label: '"살아서 돌아가면 그날 꼭 전역시켜 준다. 약속."', lines: [['psh', '…녹음했습니다, 소대장님. 농담입니다. 감사합니다.']], fx: [['morale', 'psh', 12]] },
      { label: '"전쟁 중엔 다 같이 연장이다."', lines: [['psh', '아…. (하늘을 본다)'], ['ldh', '(웃음을 참는다)'], ['note', '1호차가 오랜만에 다 같이 웃었다. 박성훈 병장만 빼고.']], fx: [['morale', 'psh', -6], ['moraleTank', 'psh', 5]] },
      { label: '"달력 가져와. 내가 동그라미 하나 지워 주지."', lines: [['psh', '진짜 지우셨습니다! 도현아, 봤지? 하루 줄었다!'], ['ldh', '…그거 그냥 펜으로 지우신 겁니다, 병장님.']], fx: [['morale', 'psh', 8], ['morale', 'ldh', 3]] },
    ],
  },
  {
    id: 'msb_bulgogi', need: ['msb'], minOp: 2, title: '아껴 둔 불고기', place: '4호차 엔진 덮개 위',
    lines: [
      ['msb', '소대장님, 불고기 전투식량 말입니다. 지금 딱 한 봉지 남았습니다.'],
      ['msb', '오늘 다 같이 나눠 먹을까요, 아니면 끝까지 아껴 둘까요?'],
    ],
    choices: [
      { label: '"오늘 다 같이 나눠 먹자."', lines: [['msb', '한 사람에 한 숟갈씩입니다! 줄 서십시오!'], ['note', '소대원 전원이 반합 뚜껑을 들고 줄을 섰다.']], fx: [['moraleAll', 4]] },
      { label: '"끝까지 아껴 둬라. 다 끝나면 같이 먹자."', lines: [['msb', '알겠습니다. 이건 승리 기념 불고기로 하겠습니다.']], fx: [['morale', 'msb', 6]] },
    ],
  },
  {
    id: 'cms_checklist', need: ['cms'], minOp: 3, title: '체크리스트 48번', place: '2호차 앞',
    lines: [
      ['cms', '소대장님, 체크리스트에 48번을 추가했습니다. "출동 전 탄 위치 재확인". 소대 전체에 돌리겠습니다.'],
      ['osh', '(작게) 47개도 다 못 하는데…'],
    ],
    choices: [
      { label: '"좋습니다. 소대 전체가 따르게 하죠."', lines: [['cms', '감사합니다. 교범은 피로 쓰인 겁니다.']], fx: [['trust', 'cms', 6], ['moraleAll', -1]] },
      { label: '"중요한 열 개만 추려 주십시오. 다들 지쳤습니다."', lines: [['cms', '…열 개. 알겠습니다. 어렵지만 해 보겠습니다.'], ['osh', '(안도의 한숨)']], fx: [['trust', 'cms', -2], ['morale', 'osh', 6], ['morale', 'cms', -4]] },
    ],
  },
  {
    id: 'rgh_fear', need: ['rgh', 'jms'], minOp: 2, title: '류경호 일병의 손떨림', place: '4호차 조종수 해치',
    lines: [
      ['rgh', '(손이 떨린다) 괘, 괜찮습니다. 진짜 괜찮습니다.'],
      ['msb', '소대장님, 경호가 아까부터 저렇습니다.'],
    ],
    choices: [
      { label: '장만석 상사에게 부탁한다', lines: [['jms', '경호야. 떨려도 된다. 나도 떨린다. 브레이크만 살살 밟아.'], ['rgh', '…부소대장님도 떨리십니까? …예. 살살 밟겠습니다.']], fx: [['morale', 'rgh', 12], ['mod', 'rgh', { fears: null }]] },
      { label: '직접 다독인다', lines: [['me', '류 일병, 너 운전 잘한다. 내가 봤다.'], ['rgh', '…예! 감사합니다!']], fx: [['morale', 'rgh', 8], ['trust', 'rgh', 3]] },
    ],
  },
  {
    id: 'icu_cheer', need: ['icu'], minOp: 2, title: '임채운 일병의 "파이팅"', place: '3호차 옆',
    lines: [
      ['icu', '소대장님! 분위기가 너무 무겁습니다. 제가 소대 구호 하나 만들었습니다. "강철은 녹슬지 않는다!"'],
      ['sjh', '…그거 녹스는데.'],
    ],
    choices: [
      { label: '같이 외친다: "강철은 녹슬지 않는다!"', lines: [['icu', '역시 소대장님! 다 같이!'], ['note', '어색했지만, 몇 명은 웃었다.']], fx: [['moraleAll', 3], ['morale', 'icu', 6]] },
      { label: '"지금은 쉬어라. 구호는 이기고 나서."', lines: [['icu', '…예! 이기고 나서 하겠습니다!']], fx: [['morale', 'icu', -4], ['fatigue', 'icu', -8]] },
    ],
  },
  {
    id: 'kty_teach', need: ['kty'], minOp: 3, title: '김태윤 상병의 야간 교육', place: '1호차 포탑 안',
    lines: [
      ['kty', '소대장님. 쉬는 시간에 후임들 조준 연습을 좀 시키고 싶습니다. 한 시간이면 됩니다.'],
    ],
    choices: [
      { label: '허락한다: "좋다. 대신 너도 좀 쉬어."', lines: [['kty', '…예.'], ['note', '조준경 앞에 신병들이 줄을 섰다.']], fx: [['skill', 'kty', 1], ['skill', 'ldh', 3], ['skill', 'recruit', 4], ['fatigue', 'kty', 8], ['fatigue', 'ldh', 6]] },
      { label: '"오늘은 다 같이 잔다. 그것도 명령이다."', lines: [['kty', '…알겠습니다. 쉬겠습니다.']], fx: [['fatigue', 'kty', -8], ['fatigue', 'ldh', -6]] },
    ],
  },
  {
    id: 'recruit_day', need: ['recruit'], minOp: 2, title: '보충병의 첫날', place: '소대 집결지',
    lines: [
      ['recruit', '(경례) 대대에서 왔습니다! …실전은 처음입니다.'],
      ['note', '소대원 몇이 새 얼굴을 힐끔 쳐다본다.'],
    ],
    choices: [
      { label: '선임에게 붙여 준다: "같은 전차 선임 따라다니면서 배워."', lines: [['recruit', '예! 따라다니겠습니다!']], fx: [['skill', 'recruit', 5]] },
      { label: '직접 말을 건다: "잘 왔다. 여기 사람들 다 처음엔 그랬다."', lines: [['recruit', '…예. 감사합니다, 소대장님.']], fx: [['morale', 'recruit', 14]] },
    ],
  },
];
