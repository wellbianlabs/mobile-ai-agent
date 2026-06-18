import type { HourPoint, NormalizedCurrent, NormalizedToday } from './summary.js';

/** Open-Meteo(무료·전지구) 좌표 기반 정규화 — 케이웨더 폴백/해외용. */

const WMO: Record<number, string> = {
  0: '맑음', 1: '대체로 맑음', 2: '부분적으로 흐림', 3: '흐림',
  45: '안개', 48: '서리 안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비',
  61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '강한 어는 비',
  71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈',
  80: '소나기', 81: '강한 소나기', 82: '매우 강한 소나기', 85: '약한 눈소나기', 86: '강한 눈소나기',
  95: '뇌우', 96: '우박 동반 뇌우', 99: '강한 우박 뇌우',
};

function describe(code: number | undefined): string {
  return WMO[code ?? 0] ?? '흐림';
}

function isRainCode(code: number | undefined): boolean {
  if (code == null) return false;
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

export interface OpenMeteoNormalized {
  current: NormalizedCurrent;
  today: NormalizedToday;
}

/**
 * 시간별 예보(현재 시각부터 maxHours개). Open-Meteo hourly 사용 — 명시적 타임스탬프라
 * 케이웨더(좌표→케이웨더)와 무관하게 한국/해외 모두 일관되게 시간별을 제공한다.
 * 현재 시각 컷오프는 응답의 current.time(로컬)을 기준으로 해 타임존 안전.
 */
export async function openMeteoHourly(
  lat: number,
  lon: number,
  maxHours = 24,
): Promise<HourPoint[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m'); // current.time(컷오프 기준)만 필요
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code,is_day');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '2');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      current?: { time?: string };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        weather_code?: number[];
        is_day?: number[];
      };
    };
    const h = data.hourly ?? {};
    const times = h.time ?? [];
    const temps = h.temperature_2m ?? [];
    const pops = h.precipitation_probability ?? [];
    const codes = h.weather_code ?? [];
    const days = h.is_day ?? [];
    // 현재 시각 이후(현재 '시'각 포함)부터.
    const cutoffHour = (data.current?.time ?? times[0] ?? '').slice(0, 13);

    const out: HourPoint[] = [];
    for (let i = 0; i < times.length && out.length < maxHours; i++) {
      const t = times[i];
      const temp = temps[i];
      if (!t || t.slice(0, 13) < cutoffHour) continue;
      if (typeof temp !== 'number' || !Number.isFinite(temp)) continue;
      const pop = pops[i];
      out.push({
        time: t,
        tempC: Math.round(temp),
        popPct: typeof pop === 'number' ? pop : null,
        condition: describe(codes[i]),
        isDay: days[i] !== 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function openMeteoByCoords(lat: number, lon: number): Promise<OpenMeteoNormalized | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation',
  );
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: Record<string, number>;
      daily?: Record<string, number[]>;
    };
    const cur = data.current ?? {};
    const daily = data.daily ?? {};
    const code = Number(cur.weather_code);
    const tempC = Number(cur.temperature_2m);
    if (!Number.isFinite(tempC)) return null;

    return {
      current: {
        temperatureC: tempC,
        feelsLikeC: Number(cur.apparent_temperature ?? tempC),
        humidityPct: Number(cur.relative_humidity_2m ?? 0),
        windMs: Math.round(((cur.wind_speed_10m ?? 0) / 3.6) * 10) / 10, // km/h → m/s
        condition: describe(code),
        isDay: cur.is_day !== 0,
        raining: (cur.precipitation ?? 0) > 0 || isRainCode(code),
      },
      today: {
        maxC: daily.temperature_2m_max?.[0] ?? null,
        minC: daily.temperature_2m_min?.[0] ?? null,
        precipProbabilityPct: daily.precipitation_probability_max?.[0] ?? null,
      },
    };
  } catch {
    return null;
  }
}
