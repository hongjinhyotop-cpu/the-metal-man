/*
 * 전역 설정값
 * 모든 스크립트는 TMM(The Metal Man) 이름공간 하나만 사용한다.
 * (빌드 과정 없이 index.html 을 바로 열어도 동작하도록 ES 모듈 대신 일반 스크립트를 쓴다.)
 */
window.TMM = window.TMM || {};

TMM.CONFIG = {
  // 지도 격자: 1칸 = 50m, 160 x 120칸 = 8km x 6km
  COLS: 160,
  ROWS: 120,
  METERS_PER_CELL: 50,

  // 지형 레이어를 미리 그려둘 때 1칸당 픽셀 수
  TERRAIN_PX_PER_CELL: 16,

  // 시간: 실제 1초 = 게임 10초 (배속 버튼으로 추가 가속)
  TIME_SCALE: 10,
  SPEED_OPTIONS: [1, 2, 4],

  // 작전 시작 시각(D+0 05:00)과 작전 기간(72시간)
  START_SECONDS: 5 * 3600,
  OPERATION_HOURS: 72,

  // 화면에서 전차 기호를 클릭으로 잡는 반경(화면 픽셀)
  UNIT_HIT_RADIUS: 18,

  // 무전 기록 최대 줄 수
  LOG_MAX: 80,

  // ---- M2 사격과 피해 ----
  // 교전 중 시간 흐름: 실제 1초 = 게임 3초 (평소 10초).
  // 장전 7초가 실제 0.7초로 지나가 버리면 전투를 따라갈 수 없어서 교전 중에만 느리게 한다.
  COMBAT_TIME_SCALE: 3,
  // 적이 아군과 이 거리(m) 안에 있거나, 최근 이 시간(게임 초) 안에 사격이 있었으면 '교전 중'
  COMBAT_RANGE_M: 3500,
  COMBAT_LINGER_SEC: 30,
  // 사격 궤적·피탄 표시가 화면에 남는 시간(실제 초)
  FX_SECONDS: 0.9,
};
