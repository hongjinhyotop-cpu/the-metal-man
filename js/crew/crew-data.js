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
};
