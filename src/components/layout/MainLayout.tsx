import { API_BASE_URL } from '../../services/apiBase';

export const THERMAL_THRESHOLDS = {
  LOW: { min: 0, max: 29.99, color: '#2e9b4b' },
  MODERATE: { min: 30, max: 49.99, color: '#eab308' },
  HIGH: { min: 50, max: 69.99, color: '#f97316' },
  EXTREME: { min: 70, max: 100, color: '#ef4444' }
} as const;

export const appConfig = {
  apiBaseUrl: API_BASE_URL,
  cityName: 'Bengaluru',
  timeOfDayDefault: 12.5
};
