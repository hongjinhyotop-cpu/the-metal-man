/*
 * 작전 시계. 게임 시간은 "작전 개시 당일 00:00 부터 흐른 초"로 저장한다.
 */
TMM.Clock = (function () {
  const pad = (v) => String(v).padStart(2, '0');

  // "D+0 05:00"
  function format(sec) {
    const s = Math.floor(sec);
    const day = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return 'D+' + day + ' ' + pad(h) + ':' + pad(m);
  }

  // 짧은 시각 "05:00"
  function short(sec) {
    const s = Math.floor(sec);
    return pad(Math.floor((s % 86400) / 3600)) + ':' + pad(Math.floor((s % 3600) / 60));
  }

  // 작전 종료(72시간)까지 남은 시간 "71:59"
  function remaining(sec) {
    const end = TMM.CONFIG.START_SECONDS + TMM.CONFIG.OPERATION_HOURS * 3600;
    const left = Math.max(0, Math.floor(end - sec));
    return pad(Math.floor(left / 3600)) + ':' + pad(Math.floor((left % 3600) / 60));
  }

  // 게임 시간(초) 길이를 "약 6분" 처럼
  function duration(sec) {
    const m = Math.round(sec / 60);
    if (m < 1) return '1분 미만';
    if (m < 60) return '약 ' + m + '분';
    return '약 ' + Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
  }

  return { format, short, remaining, duration };
})();
