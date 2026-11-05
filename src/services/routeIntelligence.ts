import type { RealRoute, TransportMode } from '../types/navigation';
import { API_BASE_URL } from './apiBase';

export type HeatProfile = 'adult' | 'elderly' | 'child' | 'asthma' | 'outdoor_worker' | 'cyclist' | 'pedestrian';

export interface RouteSampleAnalysis {
  sample_index: number;
  latitude: number;
  longitude: number;
  distance_from_start_m: number;
  elapsed_minutes: number;
  predicted_arrival_at: string;
  forecast_time: { weather: string | null; air_quality: string | null };
  temperature_c: number | null;
  apparent_temperature_c: number | null;
  uv_index: number | null;
  us_aqi: number | null;
  pm2_5: number | null;
  precipitation_probability: number | null;
  precipitation_mm: number | null;
  wind_speed_kmh: number | null;
  solar_azimuth_deg: number;
  solar_elevation_deg: number;
  shade_estimated: boolean | null;
  shade_source: string;
  building_shadow_polygons?: Array<Array<[number, number]>>;
  mapped_feature_count: number;
  building_count: number;
  buildings_with_height: number;
  buildings_with_footprints: number;
  tree_count: number;
  trees_with_canopy_data: number;
  segment_distance_m: number;
  segment_duration_seconds: number;
  segment_shade_percentage: number | null;
  waterlogging_risk: string;
  route_exposure_score: number | null;
  provenance: { weather: string; air_quality: string; shade: string };
}

export interface DepartureCandidate {
  departure_at: string;
  exposure_score: number | null;
  route_id: string | null;
  journey_duration_minutes: number | null;
  extra_travel_time_minutes: number | null;
  wait_minutes: number;
  expected_arrival_at: string | null;
}

export interface RouteOptionInput {
  id: string;
  geometry: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  turnCount: number;
}

export interface RouteComparison {
  route_id: string;
  distance_m: number;
  duration_seconds: number;
  turn_count: number;
  route_exposure_score: number | null;
  heat_exposure_score: number | null;
  aqi_exposure_score: number | null;
  mean_apparent_temperature_c: number | null;
  mean_us_aqi: number | null;
  mean_pm2_5: number | null;
  route_shade_percentage: number | null;
  direct_sun_exposure_percentage: number | null;
  evaluated_shade_length_m: number;
  building_height_data_coverage_percentage: number | null;
  tree_data_coverage_percentage: number | null;
  shade_confidence: string;
  normalized_score: number | null;
  environmental_score: number | null;
  pareto_dominated: boolean;
  rank: number;
  samples: RouteSampleAnalysis[];
}

export interface RouteIntelligenceResult {
  status: 'success' | 'partial';
  mode: TransportMode;
  profile: HeatProfile;
  distance_m: number;
  duration_seconds: number;
  sample_count: number;
  segment_duration_sum_seconds: number;
  route_exposure_score: number | null;
  route_id: string;
  sample_spacing_m: number;
  samples: RouteSampleAnalysis[];
  route_shade_percentage: number | null;
  direct_sun_exposure_percentage: number | null;
  evaluated_shade_length_m: number;
  shade_segments: Array<{ segment_index: number; distance_m: number; shade_percentage: number | null }>;
  building_height_data_coverage_percentage: number | null;
  building_counts: { mapped: number; tagged_height: number; levels_estimated_height: number; unknown_height: number };
  tree_data_coverage_percentage: number | null;
  tree_counts: { mapped: number; with_height_and_canopy: number };
  green_cover_feature_count?: number;
  shade_confidence: string;
  solar_daylight: { sunrise: string | null; sunset: string | null };
  solar_position: { azimuth_deg: number; elevation_deg: number; sampled_at: string };
  route_comparison: RouteComparison[];
  strategy: string;
  environmental_weight: number;
  route_recommendation: { route_id: string; reason: string } | null;
  departure_recommendation: DepartureCandidate | null;
  departure_message: string | null;
  departure_candidates: DepartureCandidate[];
  closest_alternatives: Array<DepartureCandidate & { eligible: boolean }>;
  immediate_reference: (DepartureCandidate & { eligible: boolean }) | null;
  max_extra_time_minutes: number;
  search_window_hours: number;
  analyzed_at: string;
  co2_tailpipe_estimate_g: number | null;
  co2_method: string;
  data_status: { weather: string; air_quality: string; osm_shade: string };
  limitations: string[];
}

function bengaluruDepartureIso(value: string): string {
  const parsed = new Date(`${value}:00+05:30`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Enter a valid Bengaluru departure date and time.');
  return parsed.toISOString();
}

export async function analyzeRouteIntelligence(
  route: RealRoute,
  mode: TransportMode,
  profile: HeatProfile,
  departureAt: string,
  options: {
    routeOptions?: RouteOptionInput[];
    strategy?: 'fastest' | 'shortest' | 'coolest' | 'cleanest' | 'balanced';
    environmentalWeight?: number;
    maxExtraTimeMinutes?: number;
    searchWindowHours?: number;
    sampleSpacingM?: number;
  } = {},
): Promise<RouteIntelligenceResult> {
  const response = await fetch(`${API_BASE_URL}/api/route-intelligence/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      route_geometry: route.geometry.map(([latitude, longitude]) => ({ latitude, longitude })),
      distance_m: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      turn_count: route.steps.filter((step) => ['turn', 'fork', 'roundabout', 'rotary', 'merge', 'on ramp', 'off ramp', 'end of road'].includes(step.maneuverType)).length,
      route_id: route.id,
      route_options: (options.routeOptions ?? []).map((candidate) => ({
        route_id: candidate.id,
        route_geometry: candidate.geometry.map(([latitude, longitude]) => ({ latitude, longitude })),
        distance_m: candidate.distanceMeters,
        duration_seconds: candidate.durationSeconds,
        turn_count: candidate.turnCount,
      })),
      mode,
      profile,
      departure_at: bengaluruDepartureIso(departureAt),
      strategy: options.strategy ?? 'balanced',
      environmental_weight: options.environmentalWeight ?? 0.5,
      max_extra_time_minutes: options.maxExtraTimeMinutes ?? 10,
      search_window_hours: options.searchWindowHours ?? 6,
      sample_spacing_m: options.sampleSpacingM ?? 400,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Route intelligence API responded with ${response.status}.`);
  }
  return await response.json() as RouteIntelligenceResult;
}
