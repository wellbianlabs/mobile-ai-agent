import { getKWeather } from './kweather.js';
import { openMeteoByCoords } from './openMeteo.js';
import { buildSummary, type WeatherDTO } from './summary.js';

/**
 * 좌표 기반 통합 날씨: 케이웨더(한국·정밀) 우선, 실패/해외는 Open-Meteo 폴백.
 * 앱 히어로(/v1/weather)와 에이전트 get_weather(좌표 경로)가 공유한다.
 */
export async function weatherByCoords(
  lat: number,
  lon: number,
  placeHint?: string,
): Promise<WeatherDTO | null> {
  // 1) 케이웨더(키 있고 한국이면).
  const kw = await getKWeather(lat, lon);
  if (kw) {
    const current = {
      temperatureC: kw.current.temperatureC,
      feelsLikeC: kw.current.feelsLikeC,
      humidityPct: kw.current.humidityPct,
      windMs: kw.current.windMs,
      condition: kw.current.condition,
      isDay: kw.current.isDay,
      raining: kw.current.pty > 0 || kw.current.rain1hMm > 0,
    };
    return {
      source: 'KWeather',
      place: placeHint || kw.place,
      current,
      today: kw.today,
      summary: buildSummary(current, kw.today),
    };
  }

  // 2) Open-Meteo 폴백.
  const om = await openMeteoByCoords(lat, lon);
  if (om) {
    return {
      source: 'Open-Meteo',
      place: placeHint || '현재 위치',
      current: om.current,
      today: om.today,
      summary: buildSummary(om.current, om.today),
    };
  }

  return null;
}
