import type { Place } from '../types/navigation';

export interface LocalConditions {
  observedAt: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  precipitationMm: number;
  windKmh: number;
  weatherCode: number;
  usAqi?: number;
  pm25?: number;
  pm10?: number;
  uvIndex?: number;
}

interface WeatherResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    uv_index?: number;
  };
}

interface AirResponse {
  current?: {
    us_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    uv_index?: number;
  };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Conditions service responded with ${response.status}.`);
  return await response.json() as T;
}

/** Fetches current point conditions for the route's start area, not a route-wide forecast. */
export async function fetchLocalConditions(place: Place): Promise<LocalConditions> {
  const coordinates = `latitude=${encodeURIComponent(place.latitude)}&longitude=${encodeURIComponent(place.longitude)}`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?${coordinates}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,uv_index&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinates}&current=us_aqi,pm2_5,pm10&timezone=auto`;

  const [weatherResult, airResult] = await Promise.allSettled([
    readJson<WeatherResponse>(weatherUrl),
    readJson<AirResponse>(airUrl),
  ]);

  if (weatherResult.status === 'rejected' && airResult.status === 'rejected') {
    throw new Error('Open-Meteo model weather and air-quality data are temporarily unavailable.');
  }

  const current = weatherResult.status === 'fulfilled' ? weatherResult.value.current : undefined;
  const air = airResult.status === 'fulfilled' ? airResult.value.current : undefined;

  if (!current && !air) throw new Error('No current conditions were returned for this location.');

  return {
    observedAt: current?.time ?? new Date().toISOString(),
    temperatureC: Number(current?.temperature_2m ?? Number.NaN),
    feelsLikeC: Number(current?.apparent_temperature ?? Number.NaN),
    humidityPercent: Number(current?.relative_humidity_2m ?? Number.NaN),
    precipitationMm: Number(current?.precipitation ?? Number.NaN),
    windKmh: Number(current?.wind_speed_10m ?? Number.NaN),
    weatherCode: Number(current?.weather_code ?? -1),
    usAqi: Number.isFinite(air?.us_aqi) ? Number(air?.us_aqi) : undefined,
    pm25: Number.isFinite(air?.pm2_5) ? Number(air?.pm2_5) : undefined,
    pm10: Number.isFinite(air?.pm10) ? Number(air?.pm10) : undefined,
    uvIndex: Number.isFinite(current?.uv_index) ? Number(current?.uv_index) : undefined,
  };
}

export function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Rain showers';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Conditions reported';
}

export function describeAqi(value?: number): string {
  if (value === undefined) return 'Unavailable';
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Moderate';
  if (value <= 150) return 'Sensitive groups';
  if (value <= 200) return 'Unhealthy';
  if (value <= 300) return 'Very unhealthy';
  return 'Hazardous';
}
