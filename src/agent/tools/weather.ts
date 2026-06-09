import type Anthropic from '@anthropic-ai/sdk';

import { weatherByCoords } from '../../weather/service.js';

/**
 * 날씨 도구.
 *   - 좌표(latitude/longitude)가 오면: 케이웨더(한국·정밀) 우선, 폴백 Open-Meteo.
 *   - 지명만 오면: Open-Meteo Geocoding → Forecast(현재 + 일별 예보).
 *
 * 모델이 호출하면 구조화 JSON 을 돌려주고, 모델이 자연어로 풀어 답한다.
 */

export const weatherToolSpec: Anthropic.Tool = {
  name: 'get_weather',
  description:
    '특정 도시/지역의 현재 날씨와 향후 며칠 예보를 조회한다. 사용자가 날씨, 기온, 비/눈, ' +
    '우산, 외출 채비 등을 물을 때 사용한다. location 은 "서울", "Busan", "Tokyo" 같은 지명.',
  input_schema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description:
          '도시 또는 지역 이름(예: "서울", "제주", "Tokyo"). 현재 위치 기준이면 컨텍스트의 지명을 쓴다.',
      },
      latitude: {
        type: 'number',
        description: '위도. 현재 위치 좌표가 있으면 함께 전달하면 지오코딩을 생략해 정밀 조회한다.',
      },
      longitude: {
        type: 'number',
        description: '경도. latitude 와 쌍으로 전달.',
      },
      days: {
        type: 'integer',
        description: '예보 일수(1~7). 기본 3.',
      },
    },
    required: ['location'],
  },
};

interface GeoResult {
  name: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

// WMO weather code → 한국어 설명.
const WMO: Record<number, string> = {
  0: '맑음',
  1: '대체로 맑음',
  2: '부분적으로 흐림',
  3: '흐림',
  45: '안개',
  48: '서리 안개',
  51: '약한 이슬비',
  53: '이슬비',
  55: '강한 이슬비',
  61: '약한 비',
  63: '비',
  65: '강한 비',
  66: '어는 비',
  67: '강한 어는 비',
  71: '약한 눈',
  73: '눈',
  75: '강한 눈',
  77: '싸락눈',
  80: '소나기',
  81: '강한 소나기',
  82: '매우 강한 소나기',
  85: '약한 눈소나기',
  86: '강한 눈소나기',
  95: '뇌우',
  96: '우박 동반 뇌우',
  99: '강한 우박 뇌우',
};

function describe(code: number): string {
  return WMO[code] ?? `코드 ${code}`;
}

async function geocode(location: string): Promise<GeoResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', location);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'ko');
  url.searchParams.set('format', 'json');

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

export async function runWeather(input: {
  location?: string;
  latitude?: number;
  longitude?: number;
  days?: number;
}): Promise<unknown> {
  const location = (input.location ?? '').trim();

  const days = Math.min(Math.max(Math.round(input.days ?? 3), 1), 7);

  // 현재 위치(좌표) → 케이웨더 우선 통합 조회.
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    const dto = await weatherByCoords(input.latitude, input.longitude, location || undefined);
    if (dto) {
      return {
        source: dto.source, // "KWeather" | "Open-Meteo"
        resolvedLocation: dto.place,
        current: {
          temperatureC: dto.current.temperatureC,
          feelsLikeC: dto.current.feelsLikeC,
          humidityPct: dto.current.humidityPct,
          windMs: dto.current.windMs,
          condition: dto.current.condition,
          raining: dto.current.raining,
        },
        today: {
          maxC: dto.today.maxC,
          minC: dto.today.minC,
          precipProbabilityPct: dto.today.precipProbabilityPct,
        },
        advice: dto.summary.advice,
      };
    }
    // 통합 조회 실패 시 아래 Open-Meteo 좌표 경로로 폴백.
  }

  // 좌표가 직접 주어지면 지오코딩 생략(현재 위치 정밀 조회).
  let geo: GeoResult | null;
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    geo = { name: location || '현재 위치', latitude: input.latitude, longitude: input.longitude };
  } else {
    if (!location) return { error: 'location 또는 좌표(latitude/longitude)가 필요합니다.' };
    geo = await geocode(location);
    if (!geo) return { error: `"${location}" 위치를 찾지 못했습니다.` };
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(geo.latitude));
  url.searchParams.set('longitude', String(geo.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
  );
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', String(days));

  const res = await fetch(url);
  if (!res.ok) return { error: `날씨 조회 실패(HTTP ${res.status}).` };
  const data = (await res.json()) as {
    current?: Record<string, number>;
    daily?: Record<string, number[] | string[]>;
  };

  const cur = data.current ?? {};
  const daily = data.daily ?? {};
  const dates = (daily.time as string[]) ?? [];

  return {
    resolvedLocation: [geo.name, geo.country].filter(Boolean).join(', '),
    current: {
      temperatureC: cur.temperature_2m,
      feelsLikeC: cur.apparent_temperature,
      humidityPct: cur.relative_humidity_2m,
      windKph: cur.wind_speed_10m,
      condition: describe(Number(cur.weather_code)),
    },
    daily: dates.map((date, i) => ({
      date,
      condition: describe(Number((daily.weather_code as number[])?.[i])),
      maxC: (daily.temperature_2m_max as number[])?.[i],
      minC: (daily.temperature_2m_min as number[])?.[i],
      precipitationProbabilityPct: (daily.precipitation_probability_max as number[])?.[i],
    })),
  };
}
