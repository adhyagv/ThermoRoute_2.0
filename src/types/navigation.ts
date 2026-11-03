export type TransportMode = 'driving' | 'cycling' | 'walking';

export type RoutePreference = 'balanced' | 'fastest' | 'shortest' | 'fewest-turns' | 'heat-smart' | 'coolest' | 'cleanest';

export type TrafficControlKind = 'traffic-signal' | 'stop' | 'give-way' | 'crossing' | 'speed-camera' | 'level-crossing' | 'traffic-sign';

export interface TrafficControl {
  id: string;
  kind: TrafficControlKind;
  label: string;
  detail: string;
  latitude: number;
  longitude: number;
}

export interface Place {
  label: string;
  displayName: string;
  latitude: number;
  longitude: number;
}

export interface NavigationStep {
  instruction: string;
  roadName: string;
  maneuverType: string;
  modifier?: string;
  distanceMeters: number;
  durationSeconds: number;
  cumulativeDistanceMeters: number;
  location: [number, number];
}

export interface RealRoute {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Array<[number, number]>;
  steps: NavigationStep[];
  weight: number;
  thermalExposure?: number;
  thermalLevel?: string;
  thermalExplanation?: string;
  isThermalRecommended?: boolean;
}

export interface ThermalJourneySeed {
  from: string;
  to: string;
  mode: TransportMode;
  routes: RealRoute[];
  selectedRouteId: string;
  departureTime: string;
  origin: Place;
  destination: Place;
}

export interface LivePosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface ThermalAnalysisResponse {
  status?: string;
  message?: string;
  recommendation?: {
    found?: boolean;
    best_journey?: {
      route_id?: string;
      travel_time_min?: number;
      distance_km?: number;
      thermal_exposure?: number;
      thermal_level?: string;
      thermal_explanation?: string;
      heat_intelligence?: {
        api_data?: {
          source?: string;
          source_note?: string;
          temperature_c_avg?: number;
          heat_index_c_avg?: number;
        };
      };
    };
    all_routes?: Array<{
      route_id?: string;
      travel_time_min?: number;
      distance_km?: number;
      thermal_exposure?: number;
      thermal_level?: string;
      thermal_explanation?: string;
      recommended?: boolean;
    }>;
    message?: string;
  };
}
