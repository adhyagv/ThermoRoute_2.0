import type { RealRoute, TrafficControl, TrafficControlKind } from '../types/navigation';

const OVERPASS_URL = import.meta.env.VITE_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;

type CacheEntry = { controls: TrafficControl[]; fetchedAt: number };
const trafficCache = new Map<string, CacheEntry>();

export interface TrafficControlsResult {
  controls: TrafficControl[];
  cacheStatus: 'network' | 'fresh-cache' | 'stale-cache';
  fetchedAt: string;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  center?: { lat?: number; lon?: number };
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(a[0]);
  const lat2 = radians(b[0]);
  const deltaLat = radians(b[0] - a[0]);
  const deltaLon = radians(b[1] - a[1]);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function classify(tags: Record<string, string>): { kind: TrafficControlKind; label: string; detail: string } | null {
  const highway = tags.highway;
  const railway = tags.railway;
  const sign = tags.traffic_sign ?? tags['traffic_sign:forward'] ?? tags['traffic_sign:backward'];
  if (highway === 'traffic_signals') return { kind: 'traffic-signal', label: 'Traffic signal', detail: tags.traffic_signals || 'Mapped traffic-light control' };
  if (highway === 'stop' || sign?.includes('stop')) return { kind: 'stop', label: 'Stop sign', detail: tags.stop || 'Mapped stop control' };
  if (highway === 'give_way' || sign?.includes('give_way')) return { kind: 'give-way', label: 'Give-way sign', detail: 'Yield to priority traffic' };
  if (highway === 'crossing') return { kind: 'crossing', label: 'Pedestrian crossing', detail: tags.crossing || 'Mapped pedestrian crossing' };
  if (highway === 'speed_camera') return { kind: 'speed-camera', label: 'Speed camera', detail: tags.maxspeed ? `Max speed ${tags.maxspeed}` : 'Mapped speed enforcement point' };
  if (railway === 'level_crossing') return { kind: 'level-crossing', label: 'Railway crossing', detail: 'Railway level crossing' };
  if (sign) return { kind: 'traffic-sign', label: 'Traffic sign', detail: sign.replace(/_/g, ' ') + (tags.maxspeed ? ` · ${tags.maxspeed}` : '') };
  return null;
}

function nearestRouteDistance(point: [number, number], routes: RealRoute[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const route of routes) {
    for (let index = 0; index < route.geometry.length; index += 3) {
      nearest = Math.min(nearest, distanceMeters(point, route.geometry[index]));
      if (nearest < 12) return nearest;
    }
  }
  return nearest;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestOverpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: Error = new Error('OpenStreetMap traffic-control data could not be loaded.');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = [429, 502, 503, 504].includes(response.status);
        lastError = new Error(`OpenStreetMap traffic-control data is temporarily unavailable (HTTP ${response.status}).`);
        if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
      } else {
        return await response.json() as { elements?: OverpassElement[] };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown Overpass request error.');
      if (attempt === MAX_ATTEMPTS) break;
      // HTTP errors other than temporary capacity/gateway failures are not retried.
      if (lastError.message.includes('(HTTP ') && !/HTTP (429|502|503|504)/.test(lastError.message)) break;
    } finally {
      window.clearTimeout(timeout);
    }
    await sleep(500 * attempt);
  }
  throw lastError;
}

/** Fetches OSM-mapped controls around candidate routes. This is not a live signal feed. */
export async function fetchTrafficControls(routes: RealRoute[]): Promise<TrafficControlsResult> {
  const coordinates = routes.flatMap((route) => route.geometry);
  if (!coordinates.length) return { controls: [], cacheStatus: 'network', fetchedAt: new Date().toISOString() };

  const latitudes = coordinates.map(([lat]) => lat);
  const longitudes = coordinates.map(([, lon]) => lon);
  const south = Math.min(...latitudes) - 0.002;
  const west = Math.min(...longitudes) - 0.002;
  const north = Math.max(...latitudes) + 0.002;
  const east = Math.max(...longitudes) + 0.002;
  if (north - south > 0.7 || east - west > 0.7) return { controls: [], cacheStatus: 'network', fetchedAt: new Date().toISOString() };

  const cacheKey = [south, west, north, east].map((value) => value.toFixed(3)).join(':');
  const cached = trafficCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { controls: cached.controls, cacheStatus: 'fresh-cache', fetchedAt: new Date(cached.fetchedAt).toISOString() };
  }

  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(node["highway"~"^(traffic_signals|stop|give_way|crossing|speed_camera)$"](${bbox});node["traffic_sign"](${bbox});node["traffic_sign:forward"](${bbox});node["traffic_sign:backward"](${bbox});way["traffic_sign"](${bbox});way["traffic_sign:forward"](${bbox});way["traffic_sign:backward"](${bbox});node["railway"="level_crossing"](${bbox}););out center;`;

  try {
    const payload = await requestOverpass(query);
    const controls = (payload.elements ?? [])
      .filter((element) => (element.type === 'node' || element.type === 'way')
        && Number.isFinite(element.lat ?? element.center?.lat)
        && Number.isFinite(element.lon ?? element.center?.lon))
      .map((element): TrafficControl | null => {
        const tags = element.tags ?? {};
        const classified = classify(tags);
        const latitude = element.lat ?? element.center?.lat;
        const longitude = element.lon ?? element.center?.lon;
        if (!classified || latitude === undefined || longitude === undefined) return null;
        const point: [number, number] = [latitude, longitude];
        if (nearestRouteDistance(point, routes) > 85) return null;
        return {
          id: `osm-${element.id ?? `${element.lat}-${element.lon}`}`,
          kind: classified.kind,
          label: classified.label,
          detail: element.type === 'way' ? `Road-section tag · ${classified.detail}` : classified.detail,
          latitude,
          longitude,
        };
      })
      .filter((item): item is TrafficControl => item !== null)
      .slice(0, 180);
    const fetchedAt = Date.now();
    trafficCache.set(cacheKey, { controls, fetchedAt });
    return { controls, cacheStatus: 'network', fetchedAt: new Date(fetchedAt).toISOString() };
  } catch (error) {
    if (cached) {
      return { controls: cached.controls, cacheStatus: 'stale-cache', fetchedAt: new Date(cached.fetchedAt).toISOString() };
    }
    throw error;
  }
}
