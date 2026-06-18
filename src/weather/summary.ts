/**
 * 제공자(케이웨더/Open-Meteo) 공통 정규화 + 한국어 요약(헤드라인/조언/이모지).
 * 앱 히어로와 에이전트 응답이 같은 형태를 쓰도록 한다.
 */

export interface NormalizedCurrent {
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  windMs: number;
  condition: string; // 한국어 상태(맑음/비/흐림 등)
  isDay: boolean;
  raining: boolean;
}

export interface NormalizedToday {
  maxC: number | null;
  minC: number | null;
  precipProbabilityPct: number | null;
}

/** 주간(일별) 예보 한 포인트. */
export interface DayPoint {
  /** 로컬 날짜(YYYY-MM-DD). */
  date: string;
  maxC: number | null;
  minC: number | null;
  popPct: number | null;
  /** 한국어 상태(맑음/비 등). */
  condition: string;
}

/** 시간별 예보 한 포인트(Open-Meteo hourly 기반). */
export interface HourPoint {
  /** 로컬 ISO 시각(예: "2026-06-18T15:00"). */
  time: string;
  tempC: number;
  /** 강수확률(%) — 없으면 null. */
  popPct: number | null;
  /** 한국어 상태(맑음/비 등). */
  condition: string;
  isDay: boolean;
}

export interface WeatherSummary {
  headline: string;
  advice: string;
  condition: string;
  tempC: number;
  emoji: string;
  isDay: boolean;
}

export interface WeatherDTO {
  source: 'KWeather' | 'Open-Meteo';
  place: string;
  current: NormalizedCurrent;
  today: NormalizedToday;
  /** 시간별 예보(현재 시각부터, Open-Meteo). 없으면 빈 배열. */
  hourly: HourPoint[];
  /** 주간(일별) 예보. 없으면 빈 배열. */
  daily: DayPoint[];
  /** 30일 장기전망(케이웨더, 국내 권역 단위). 없으면 빈 배열. */
  monthly: DayPoint[];
  /** 30일 전망의 권역명(예: "수도권"). 해외/미지원 시 null. */
  monthlyRegion: string | null;
  summary: WeatherSummary;
}

function emojiFor(condition: string, isDay: boolean, raining: boolean): string {
  const c = condition;
  if (raining || c.includes('비')) return c.includes('눈') ? '🌨️' : '🌧️';
  if (c.includes('눈')) return '❄️';
  if (c.includes('뇌우') || c.includes('번개')) return '⛈️';
  if (c.includes('소나기')) return '🌦️';
  if (c.includes('안개')) return '🌫️';
  if (c.includes('흐림') || c.includes('흐')) return '☁️';
  if (c.includes('구름') || c.includes('부분')) return '⛅';
  if (c.includes('맑')) return isDay ? '☀️' : '🌙';
  return isDay ? '🌤️' : '☁️';
}

export function buildSummary(current: NormalizedCurrent, today: NormalizedToday): WeatherSummary {
  const temp = Math.round(current.temperatureC);
  const pop = today.precipProbabilityPct ?? 0;
  const rainSoon = pop >= 60;

  let headline: string;
  let advice: string;

  if (current.raining) {
    headline = `지금 ${current.condition || '비'}가 내리고 있어요.`;
    advice = '우산을 챙기세요.';
  } else if (rainSoon) {
    headline = `오늘 비 소식이 있어요 (강수확률 ${pop}%).`;
    advice = '우산을 챙기세요.';
  } else {
    headline = `지금은 ${current.condition}, ${temp}°C.`;
    if (temp >= 30) advice = '한낮 더위, 수분 보충 잊지 마세요.';
    else if (temp <= 2) advice = '쌀쌀해요, 따뜻하게 입으세요.';
    else if (current.condition.includes('맑')) advice = '나들이 좋은 날이에요.';
    else advice = '좋은 하루 보내세요.';
  }

  return {
    headline,
    advice,
    condition: current.condition,
    tempC: temp,
    emoji: emojiFor(current.condition, current.isDay, current.raining),
    isDay: current.isDay,
  };
}
