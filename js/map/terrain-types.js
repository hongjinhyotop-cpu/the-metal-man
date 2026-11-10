/*
 * 지형 종류와 기동 속도.
 * speed: K1A2 전차의 해당 지형 기동 속도(km/h). 0 이면 통행 불가.
 * 속도를 조정하고 싶으면 이 표만 고치면 된다.
 */
TMM.T = {
  OPEN: 0,
  PADDY: 1,
  FOREST: 2,
  RIDGE: 3,
  ROAD: 4,
  BRIDGE: 5,
  RIVER: 6,
  RESERVOIR: 7,
  TOWN: 8,
  BASE: 9,
};

TMM.TERRAIN_INFO = [
  { name: '개활지', speed: 25, color: '#56603a', desc: '평탄한 밭과 초지' },
  { name: '논', speed: 8, color: '#4d5e3c', desc: '물을 댄 논, 무른 땅' },
  { name: '숲', speed: 8, color: '#2c3a22', desc: '수목 밀집 지역' },
  { name: '능선', speed: 12, color: '#6b6040', desc: '경사가 급한 고지대' },
  { name: '도로', speed: 45, color: '#b3a77a', desc: '포장 도로' },
  { name: '다리', speed: 20, color: '#c9bd8d', desc: '하천을 건너는 교량' },
  { name: '하천', speed: 0, color: '#36525a', desc: '전차 도하 불가' },
  { name: '저수지', speed: 0, color: '#2f4a52', desc: '전차 진입 불가' },
  { name: '시가지', speed: 15, color: '#5b5a4a', desc: '건물 밀집, 좁은 골목' },
  { name: '주둔지', speed: 25, color: '#4f4b38', desc: '아군 기지 내부' },
];

/*
 * 시야 관련 지형 수치 (M3). 모두 게임용 추정치.
 *   h:       시선을 가리는 높이(m). 지면 + h 아래로 지나가는 시선만 가려진다 (언덕 위에서 내려다보면 숲 너머가 보임).
 *   obs:     시선이 이 지형 1칸(50m)을 지날 때 쌓이는 가림 정도. 합이 1 이상이면 완전히 가려진다.
 *   conceal: 표적이 이 지형 안에 있을 때 탐지 거리 배수 (작을수록 잘 숨음).
 *   idObs:   표적이 이 지형 안에 있을 때 더해지는 가림 정도 (식별이 느려지고 명중률이 줄어듦).
 * 순서는 TMM.T 와 같다.
 */
TMM.TERRAIN_SIGHT = [
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 개활지
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 논
  { h: 14, obs: 0.34, conceal: 0.3, idObs: 0.35 }, // 숲: 약 3칸(150m)이면 완전히 가림
  { h: 0, obs: 0, conceal: 0.9, idObs: 0.05 }, // 능선: 지형 높이 자체로 가림
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 도로
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 다리
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 하천
  { h: 0, obs: 0, conceal: 1, idObs: 0 }, // 저수지
  { h: 9, obs: 0.5, conceal: 0.55, idObs: 0.3 }, // 시가지: 약 2칸(100m)이면 완전히 가림
  { h: 4, obs: 0.03, conceal: 0.9, idObs: 0.05 }, // 주둔지: 낮은 건물·방벽
];

TMM.MAX_SPEED_KMH = TMM.TERRAIN_INFO.reduce((m, t) => Math.max(m, t.speed), 0);

// 속도를 짧은 한국어 평가로
TMM.speedGrade = function (kmh) {
  if (!kmh) return '통행 불가';
  if (kmh >= 40) return '매우 빠름';
  if (kmh >= 20) return '보통';
  if (kmh >= 12) return '다소 느림';
  return '느림';
};
