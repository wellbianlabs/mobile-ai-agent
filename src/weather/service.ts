import { getKWeather } from './kweather.js';
import { getKWeather30d } from './kweather30d.js';
import { getKWeatherWorld } from './kweatherWorld.js';
import { openMeteoByCoords, openMeteoDaily, openMeteoHourly } from './openMeteo.js';
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
  // 케이웨더 국내(현재·오늘)와 Open-Meteo 시간별·주간, 케이웨더 30일 전망을 병렬 조회.
  const [kw, omHourly, daily, monthly30] = await Promise.all([
    getKWeather(lat, lon),
    openMeteoHourly(lat, lon),
    openMeteoDaily(lat, lon, 7),
    getKWeather30d(lat, lon),
  ]);
  const monthly = monthly30?.days ?? [];
  const monthlyRegion = monthly30?.region ?? null;

  // 1) 케이웨더 — 한국(좌표 정밀). 시간별은 Open-Meteo 보강(국내 단기예보 근시간 공백 회피).
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
      hourly: omHourly,
      daily,
      monthly,
      monthlyRegion,
      summary: buildSummary(current, kw.today),
    };
  }

  // 2) 케이웨더 세계 — 해외(최근접 도시 + kw-world 실황/시간별). 현재·오늘·시간별 모두 케이웨더.
  const world = await getKWeatherWorld(lat, lon);
  if (world) {
    return {
      source: 'KWeather',
      place: placeHint || world.place,
      current: world.current,
      today: world.today,
      hourly: world.hourly.length ? world.hourly : omHourly,
      daily,
      monthly, // 해외는 [](30일은 국내만)
      monthlyRegion,
      summary: buildSummary(world.current, world.today),
    };
  }

  // 3) Open-Meteo 폴백(케이웨더 국내·세계 모두 실패 시).
  const om = await openMeteoByCoords(lat, lon);
  if (om) {
    return {
      source: 'Open-Meteo',
      place: placeHint || '현재 위치',
      current: om.current,
      today: om.today,
      hourly: omHourly,
      daily,
      monthly,
      monthlyRegion,
      summary: buildSummary(om.current, om.today),
    };
  }

  return null;
}
