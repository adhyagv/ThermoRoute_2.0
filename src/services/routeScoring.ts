import type { RealRoute, RoutePreference } from '../types/navigation';

export interface RankedRoute {
  route: RealRoute;
  score: number;
  complexityTurns: number;
  rank: number;
}

function lowerIsBetterScore(value: number, values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0.5;
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (maximum - minimum < 0.0001) return 1;
  return 1 - (value - minimum) / (maximum - minimum);
}

function countDecisionManeuvers(route: RealRoute): number {
  const decisionTypes = new Set(['turn', 'fork', 'roundabout', 'rotary', 'merge', 'on ramp', 'off ramp', 'end of road']);
  return route.steps.filter((step) => decisionTypes.has(step.maneuverType)).length;
}

/**
 * Scores only the alternatives returned by the routing provider. Scores are
 * relative to this result set; they are not a prediction of live traffic.
 */
export function rankRoutes(routes: RealRoute[], preference: RoutePreference): RankedRoute[] {
  if (!routes.length) return [];
  const turns = routes.map(countDecisionManeuvers);
  const durations = routes.map((route) => route.durationSeconds);
  const distances = routes.map((route) => route.distanceMeters);
  const hasThermal = routes.length > 0 && routes.every((route) => Number.isFinite(route.thermalExposure));
  const heatValues = routes.map((route) => route.thermalExposure ?? Number.NaN);
  const safeHeatValues = heatValues.filter(Number.isFinite);
  const heatFallback = safeHeatValues.length ? Math.max(...safeHeatValues) + 10 : 0;

  const scored = routes.map((route, index) => {
    const timeScore = lowerIsBetterScore(route.durationSeconds, durations);
    const distanceScore = lowerIsBetterScore(route.distanceMeters, distances);
    const turnScore = lowerIsBetterScore(turns[index], turns);
    const heatScore = hasThermal
      ? lowerIsBetterScore(route.thermalExposure ?? heatFallback, heatValues.map((value) => Number.isFinite(value) ? value : heatFallback))
      : undefined;

    let value = 0;
    if (preference === 'fastest') value = timeScore * 0.78 + distanceScore * 0.22;
    else if (preference === 'shortest') value = distanceScore * 0.82 + timeScore * 0.18;
    else if (preference === 'fewest-turns') value = turnScore * 0.72 + timeScore * 0.18 + distanceScore * 0.10;
    else if (preference === 'heat-smart' && heatScore !== undefined) value = heatScore * 0.68 + timeScore * 0.20 + distanceScore * 0.12;
    else if (preference === 'coolest' && heatScore !== undefined) value = heatScore * 0.8 + timeScore * 0.2;
    else if (preference === 'cleanest') value = timeScore * 0.5 + distanceScore * 0.5;
    else if (hasThermal && heatScore !== undefined) value = timeScore * 0.38 + distanceScore * 0.25 + turnScore * 0.12 + heatScore * 0.25;
    else value = timeScore * 0.52 + distanceScore * 0.30 + turnScore * 0.18;

    return { route, score: Math.round(value * 100), complexityTurns: turns[index], rank: 0 };
  }).sort((a, b) => b.score - a.score || a.route.durationSeconds - b.route.durationSeconds);

  return scored.map((item, index) => ({ ...item, rank: index + 1 }));
}

export function preferenceDescription(preference: RoutePreference, hasThermal: boolean): string {
  if (preference === 'fastest') return 'Score = 78% normalized travel time + 22% normalized distance.';
  if (preference === 'shortest') return 'Score = 82% normalized distance + 18% normalized travel time.';
  if (preference === 'fewest-turns') return 'Score = 72% normalized decision-turn count + 18% time + 10% distance.';
  if (preference === 'heat-smart' && hasThermal) return 'Score = 68% lower thermal exposure + 20% time + 12% distance.';
  if (preference === 'heat-smart') return 'Run ThermoRoute AI heat analysis to unlock heat-smart ranking.';
  if (preference === 'coolest' && hasThermal) return 'Score = 80% lower route exposure + 20% normalized travel time.';
  if (preference === 'coolest') return 'Run route-wide environmental analysis to unlock coolest-route ranking.';
  if (preference === 'cleanest') return 'Clean-air ranking requires route-wide forecast analysis; otherwise routes are ordered by normalized time and distance.';
  return hasThermal
    ? 'Score = 38% time + 25% distance + 12% turn complexity + 25% lower thermal exposure.'
    : 'Score = 52% time + 30% distance + 18% turn complexity; heat is added after AI analysis.';
}
