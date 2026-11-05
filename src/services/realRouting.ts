import type { NavigationStep, Place, RealRoute, TransportMode } from '../types/navigation';
import { API_BASE_URL } from './apiBase';

const NOMINATIM_URL = import.meta.env.VITE_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const ROUTING_BASE: Record<TransportMode, string> = {
  driving: import.meta.env.VITE_ROUTE_DRIVING_URL ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  cycling: import.meta.env.VITE_ROUTE_CYCLING_URL ?? 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  walking: import.meta.env.VITE_ROUTE_WALKING_URL ?? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
};

const geocodeCache = new Map<string, Place>();
let geocodeQueue: Promise<unknown> = Promise.resolve();
let lastGeocodeAt = 0;
let routeQueue: Promise<unknown> = Promise.resolve();
let lastRouteAt = 0;
const routeCache = new Map<string, RealRoute[]>();

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Uses the public Nominatim geocoder sparingly. Requests are serialized and
 * spaced to remain within its one-request-per-second public-service policy.
 * For a production deployment, replace this with a contracted geocoding API.
 */
export function geocodePlace(query: string): Promise<Place> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return Promise.reject(new Error('Enter a place or address first.'));
  const cached = geocodeCache.get(normalized);
  if (cached) return Promise.resolve(cached);

  const task = geocodeQueue.then(async () => {
    const remaining = 1100 - (Date.now() - lastGeocodeAt);
    if (remaining > 0) await wait(remaining);

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    lastGeocodeAt = Date.now();
    if (!response.ok) throw new Error(`Location search failed (${response.status}). Please try again.`);
    const results = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = results[0];
    if (!first?.lat || !first.lon) throw new Error(`Couldn't find “${query.trim()}”. Try a nearby landmark or full address.`);

    const result: Place = {
      label: query.trim(),
      displayName: first.display_name ?? query.trim(),
      latitude: Number(first.lat),
      longitude: Number(first.lon),
    };
    geocodeCache.set(normalized, result);
    return result;
  });

  geocodeQueue = task.then(() => undefined, () => undefined);
  return task;
}

function formatRoadName(name: string | undefined): string {
  return name?.trim() ? ` onto ${name.trim()}` : '';
}

function buildInstruction(step: Record<string, unknown>): string {
  const maneuver = (step.maneuver ?? {}) as { type?: string; modifier?: string; exit?: number };
  const type = maneuver.type ?? 'continue';
  const modifier = maneuver.modifier?.replace(/_/g, ' ') ?? '';
  const name = formatRoadName(typeof step.name === 'string' ? step.name : undefined);
  const exit = maneuver.exit ? ` and take exit ${maneuver.exit}` : '';

  if (type === 'depart') return `Head ${modifier || 'ahead'}${name}`;
  if (type === 'arrive') return 'You have arrived at your destination';
  if (type === 'roundabout' || type === 'rotary') return `Enter the roundabout${exit}${name}`;
  if (type === 'exit roundabout') return `Exit the roundabout${name}`;
  if (type === 'merge') return `Merge ${modifier}${name}`.replace(/ {2}/g, ' ');
  if (type === 'on ramp') return `Take the ramp${name}`;
  if (type === 'off ramp') return `Take the exit ramp${name}`;
  if (type === 'fork') return `Keep ${modifier || 'straight'}${name}`;
  if (type === 'end of road') return `At the end of the road, turn ${modifier || 'ahead'}${name}`;
  if (type === 'turn' || type === 'continue' || type === 'new name' || type === 'notification') {
    if (modifier) return `${modifier[0].toUpperCase()}${modifier.slice(1)}${name}`;
    return `Continue${name}`;
  }
  return `Continue${name}`;
}

function parseSteps(legs: Array<Record<string, unknown>>): NavigationStep[] {
  const parsed: NavigationStep[] = [];
  let cumulativeDistanceMeters = 0;

  for (const leg of legs) {
    const rawSteps = Array.isArray(leg.steps) ? leg.steps as Array<Record<string, unknown>> : [];
    for (const step of rawSteps) {
      const maneuver = (step.maneuver ?? {}) as { location?: [number, number]; type?: string; modifier?: string };
      const location = maneuver.location ?? [0, 0];
      const distanceMeters = Number(step.distance ?? 0);
      const durationSeconds = Number(step.duration ?? 0);
      parsed.push({
        instruction: buildInstruction(step),
        roadName: typeof step.name === 'string' ? step.name : '',
        maneuverType: maneuver.type ?? 'continue',
        modifier: maneuver.modifier,
        distanceMeters,
        durationSeconds,
        cumulativeDistanceMeters,
        location: [Number(location[1]), Number(location[0])],
      });
      cumulativeDistanceMeters += distanceMeters;
    }
  }
  return parsed;
}

export function fetchRealRoutes(
  origin: Place,
  destination: Place,
  mode: TransportMode,
): Promise<RealRoute[]> {
  const cacheKey = `${mode}:${origin.latitude.toFixed(6)},${origin.longitude.toFixed(6)}>${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const task = routeQueue.then(async () => {
    const remaining = 1100 - (Date.now() - lastRouteAt);
    if (remaining > 0) await wait(remaining);
    // Throttle request start times as well as successes so repeated failures
    // cannot accidentally hammer the shared public routing service.
    lastRouteAt = Date.now();
    const routes = await requestRealRoutes(origin, destination, mode);
    routeCache.set(cacheKey, routes);
    return routes;
  });
  routeQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function requestRealRoutes(
  origin: Place,
  destination: Place,
  mode: TransportMode,
): Promise<RealRoute[]> {
  const coordinatePair = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `${ROUTING_BASE[mode]}/${coordinatePair}`;
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    alternatives: '3',
    annotations: 'false',
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`The road-routing service is unavailable (${response.status}). Please retry in a moment.`);

  const data = (await response.json()) as {
    code?: string;
    message?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      weight?: number;
      geometry?: { coordinates?: Array<[number, number]> };
      legs?: Array<Record<string, unknown>>;
    }>;
  };

  if (data.code !== 'Ok' || !data.routes?.length) {
    if (data.code === 'NoRoute' || data.code === 'NoSegment') {
      throw new Error('No routable path was found between these locations for this travel mode. Try different nearby points.');
    }
    throw new Error(data.message ?? 'The routing service could not build this route.');
  }

  return data.routes.map((route, index) => ({
    id: `osrm_${index + 1}`,
    distanceMeters: Number(route.distance ?? 0),
    durationSeconds: Number(route.duration ?? 0),
    weight: Number(route.weight ?? route.duration ?? 0),
    geometry: (route.geometry?.coordinates ?? []).map(([longitude, latitude]) => [latitude, longitude] as [number, number]),
    steps: parseSteps(route.legs ?? []),
  })).filter((route) => route.geometry.length > 1);
}

export async function fetchThermalAnalysis(
  origin: Place,
  destination: Place,
  departureTime: string,
): Promise<import('../types/navigation').ThermalAnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      from_location: origin.displayName,
      destination: destination.displayName,
      departure_time: departureTime,
      max_extra_time_percent: 25,
      thermal_exposure_budget: 65,
    }),
  });
  if (!response.ok) throw new Error(`ThermoRoute API responded with ${response.status}.`);
  return await response.json() as import('../types/navigation').ThermalAnalysisResponse;
}

export function toGoogleMapsUrl(origin: Place, destination: Place, mode: TransportMode): string {
  const travelMode = mode === 'driving' ? 'driving' : mode === 'cycling' ? 'bicycling' : 'walking';
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: travelMode,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
