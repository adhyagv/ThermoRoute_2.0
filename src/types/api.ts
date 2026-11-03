export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteRequest {
  origin: Coordinates;
  destination: Coordinates;
  mode: 'walking' | 'cycling' | 'driving';
  time_of_day: number;
  avoid_heat: boolean;
}

export interface Segment {
  latitude: number;
  longitude: number;
  temperature: number;
  heat_index: number;
  duration_minutes: number;
  environment_source: string;
}

export interface HeatIntelligence {
  api_data: {
    source: string;
    temperature_c_avg: number;
    heat_index_c_avg: number;
    ghi_avg: number;
  };
  calculated: {
    thermal_exposure: number;
    thermal_level: RiskLevel;
  };
}

export interface Journey {
  route_id: string;
  travel_time_min: number;
  distance_km: number;
  thermal_exposure: number;
  thermal_level: RiskLevel;
  thermal_explanation: string;
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  origin_lat: number;
  origin_lon: number;
  destination_lat: number;
  destination_lon: number;
  segments: Segment[];
  heat_intelligence: HeatIntelligence;
}

export interface Recommendation {
  found: boolean;
  best_journey: Journey;
  options: Journey[];
  all_routes: Journey[];
}

export interface OptimizeResponse {
  status: 'success' | 'error';
  recommendation: Recommendation;
}
