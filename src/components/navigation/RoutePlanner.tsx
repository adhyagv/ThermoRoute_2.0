import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Bike,
  Check,
  Clock3,
  Download,
  ExternalLink,
  Footprints,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  Play,
  Route as RouteIcon,
  Save,
  Share2,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Car,
  RefreshCw,
} from 'lucide-react';
import RealRouteMap from './RealRouteMap';
import { describeAqi, describeWeatherCode, fetchLocalConditions, type LocalConditions } from '../../services/localConditions';
import { fetchRealRoutes, fetchThermalAnalysis, geocodePlace, toGoogleMapsUrl } from '../../services/realRouting';
import { fetchTrafficControls } from '../../services/trafficControls';
import { preferenceDescription, rankRoutes } from '../../services/routeScoring';
import type { LivePosition, Place, RealRoute, RoutePreference, ThermalAnalysisResponse, ThermalJourneySeed, TrafficControl, TransportMode } from '../../types/navigation';

const modeOptions: Array<{ value: TransportMode; label: string; icon: typeof Car }> = [
  { value: 'driving', label: 'Drive', icon: Car },
  { value: 'cycling', label: 'Cycle', icon: Bike },
  { value: 'walking', label: 'Walk', icon: Footprints },
];

const bangaloreExamples = [
  { from: 'PES University, Banashankari, Bengaluru', to: 'Lalbagh Botanical Garden, Bengaluru' },
  { from: 'Vidhana Soudha, Bengaluru', to: 'Cubbon Park, Bengaluru' },
  { from: 'Indiranagar Metro Station, Bengaluru', to: 'MG Road Metro Station, Bengaluru' },
];

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

function estimateArrival(seconds: number, departureTime: string): string {
  const [hours, minutes] = departureTime.split(':').map(Number);
  const departure = new Date();
  if (Number.isFinite(hours) && Number.isFinite(minutes)) departure.setHours(hours, minutes, 0, 0);
  const now = new Date();
  if (departure.getTime() < now.getTime() - 15 * 60_000) {
    departure.setDate(departure.getDate() + 1);
  } else if (departure.getTime() < now.getTime()) {
    departure.setTime(now.getTime());
  }
  const arrival = new Date(departure.getTime() + seconds * 1000);
  const time = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return arrival.getDate() !== departure.getDate() ? `${time} (+1 day)` : time;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const lat1 = radians(a[0]);
  const lat2 = radians(b[0]);
  const deltaLat = radians(b[0] - a[0]);
  const deltaLon = radians(b[1] - a[1]);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function getRouteProgress(route: RealRoute | undefined, position: LivePosition | null) {
  if (!route || !position || route.geometry.length < 2) return { progressMeters: 0, distanceToRoute: Infinity };
  let bestDistance = Infinity;
  let bestIndex = 0;
  for (let index = 0; index < route.geometry.length; index += 1) {
    const distance = haversineMeters([position.latitude, position.longitude], route.geometry[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  let progressMeters = 0;
  for (let index = 1; index <= bestIndex; index += 1) {
    progressMeters += haversineMeters(route.geometry[index - 1], route.geometry[index]);
  }
  return { progressMeters, distanceToRoute: bestDistance };
}

function getManeuverIcon(type: string, modifier?: string) {
  if (type === 'arrive') return <MapPin size={15} />;
  if (modifier?.includes('left')) return <ArrowDownRight size={15} className="turn-left-icon" />;
  if (modifier?.includes('right')) return <ArrowUpRight size={15} />;
  if (type === 'depart') return <Navigation size={15} />;
  if (type.includes('roundabout')) return <RefreshCw size={15} />;
  return <ArrowUpRight size={15} />;
}

function currentLocalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export default function RoutePlanner({ onExploreThermalJourney }: { onExploreThermalJourney: (journey: ThermalJourneySeed) => void }) {
  const [originText, setOriginText] = useState('PES University, Banashankari, Bengaluru');
  const [destinationText, setDestinationText] = useState('Lalbagh Botanical Garden, Bengaluru');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<TransportMode>('driving');
  const [departureTime, setDepartureTime] = useState(currentLocalTime());
  const [routes, setRoutes] = useState<RealRoute[]>([]);
  const [routePreference, setRoutePreference] = useState<RoutePreference>('balanced');
  const [trafficControls, setTrafficControls] = useState<TrafficControl[]>([]);
  const [trafficControlsLoading, setTrafficControlsLoading] = useState(false);
  const [trafficControlsError, setTrafficControlsError] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [thermalAnalysis, setThermalAnalysis] = useState<ThermalAnalysisResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [thermalError, setThermalError] = useState('');
  const [thermalNote, setThermalNote] = useState('');
  const [thermalSource, setThermalSource] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [voiceGuidance, setVoiceGuidance] = useState(false);
  const [gpsPosition, setGpsPosition] = useState<LivePosition | null>(null);
  const [notice, setNotice] = useState('');
  const [savedRoute, setSavedRoute] = useState(false);
  const [localConditions, setLocalConditions] = useState<LocalConditions | null>(null);
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [conditionsError, setConditionsError] = useState('');
  const watchIdRef = useRef<number | null>(null);
  const spokenStepRef = useRef(-1);
  const conditionsRequestRef = useRef(0);
  const trafficRequestRef = useRef(0);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? routes[0],
    [routes, selectedRouteId],
  );

  const hasThermalScores = useMemo(() => routes.length > 0 && routes.every((route) => Number.isFinite(route.thermalExposure)), [routes]);
  const rankedRoutes = useMemo(() => rankRoutes(routes, routePreference), [routes, routePreference]);

  const routeProgress = useMemo(
    () => getRouteProgress(selectedRoute, gpsPosition),
    [selectedRoute, gpsPosition],
  );

  const activeStepIndex = useMemo(() => {
    if (!selectedRoute?.steps.length || !gpsPosition) return 0;
    let active = 0;
    selectedRoute.steps.forEach((step, index) => {
      if (routeProgress.progressMeters >= step.cumulativeDistanceMeters) active = index;
    });
    return Math.min(active, selectedRoute.steps.length - 1);
  }, [selectedRoute, gpsPosition, routeProgress.progressMeters]);

  const activeStep = selectedRoute?.steps[activeStepIndex];
  const offRoute = Boolean(gpsPosition && selectedRoute && routeProgress.distanceToRoute > Math.max(100, gpsPosition.accuracy * 2));

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  }, []);

  const getCurrentPosition = useCallback((): Promise<LivePosition> => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      (error) => reject(new Error(error.message || 'Location permission was denied.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }), []);

  const loadConditions = useCallback(async (place: Place) => {
    const requestId = ++conditionsRequestRef.current;
    setConditionsLoading(true);
    setConditionsError('');
    setLocalConditions(null);
    try {
      const result = await fetchLocalConditions(place);
      if (requestId === conditionsRequestRef.current) setLocalConditions(result);
    } catch (error) {
      if (requestId === conditionsRequestRef.current) {
        setLocalConditions(null);
        setConditionsError(error instanceof Error ? error.message : 'Could not load local conditions.');
      }
    } finally {
      if (requestId === conditionsRequestRef.current) setConditionsLoading(false);
    }
  }, []);

  const locateUser = useCallback(async () => {
    setIsLocating(true);
    setGpsError('');
    try {
      const position = await getCurrentPosition();
      setGpsPosition(position);
      const place: Place = {
        label: 'My current location',
        displayName: 'My current location',
        latitude: position.latitude,
        longitude: position.longitude,
      };
      setOrigin(place);
      void loadConditions(place);
      setOriginText('My current location');
      showNotice('Current location added as the starting point.');
    } catch (error) {
      setGpsError(error instanceof Error ? error.message : 'Unable to read your location.');
    } finally {
      setIsLocating(false);
    }
  }, [getCurrentPosition, loadConditions, showNotice]);

  const resolveOrigin = useCallback(async () => {
    if (origin && originText === origin.label) return origin;
    return await geocodePlace(originText);
  }, [origin, originText]);

  const resolveDestination = useCallback(async () => {
    if (destination && destinationText === destination.label) return destination;
    return await geocodePlace(destinationText);
  }, [destination, destinationText]);

  const loadTrafficControls = useCallback(async (candidateRoutes: RealRoute[], requestId: number) => {
    setTrafficControlsLoading(true);
    setTrafficControlsError('');
    try {
      const result = await fetchTrafficControls(candidateRoutes);
      if (requestId !== trafficRequestRef.current) return;
      setTrafficControls(result.controls);
      if (result.cacheStatus === 'stale-cache') {
        setTrafficControlsError(`Overpass is unavailable; showing cached OSM controls from ${new Date(result.fetchedAt).toLocaleTimeString()}.`);
      }
    } catch (error) {
      if (requestId === trafficRequestRef.current) {
        setTrafficControlsError(error instanceof Error ? error.message : 'Mapped traffic-control data could not be loaded.');
      }
    } finally {
      if (requestId === trafficRequestRef.current) setTrafficControlsLoading(false);
    }
  }, []);

  const findRoute = useCallback(async (providedOrigin?: Place, keepNavigation = false) => {
    setIsSearching(true);
    setRouteError('');
    setThermalError('');
    setThermalNote('');
    setThermalSource('');
    setThermalAnalysis(null);
    setSavedRoute(false);
    setTrafficControls([]);
    setTrafficControlsError('');
    setTrafficControlsLoading(false);
    setRoutePreference('balanced');
    trafficRequestRef.current += 1;
    if (!keepNavigation) setIsNavigating(false);
    try {
      const resolvedOrigin = providedOrigin ?? await resolveOrigin();
      const resolvedDestination = await resolveDestination();
      setOrigin(resolvedOrigin);
      setDestination(resolvedDestination);
      void loadConditions(resolvedOrigin);
      const foundRoutes = await fetchRealRoutes(resolvedOrigin, resolvedDestination, mode);
      setRoutes(foundRoutes);
      setSelectedRouteId(foundRoutes[0]?.id ?? null);
      const trafficRequestId = ++trafficRequestRef.current;
      void loadTrafficControls(foundRoutes, trafficRequestId);
      showNotice(`${foundRoutes.length} available route option${foundRoutes.length === 1 ? '' : 's'} returned by the road network.`);
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Route planning failed. Please try again.');
      setRoutes([]);
      setSelectedRouteId(null);
      setTrafficControls([]);
    } finally {
      setIsSearching(false);
    }
  }, [mode, resolveOrigin, resolveDestination, loadConditions, loadTrafficControls, showNotice]);

  const runHeatAnalysis = useCallback(async () => {
    if (!origin || !destination) {
      showNotice('Plan a route first, then run the heat analysis.');
      return;
    }
    if (mode !== 'driving') {
      setThermalError('The existing ThermoRoute backend optimizer currently evaluates driving routes.');
      return;
    }
    setIsAnalyzing(true);
    setThermalError('');
    try {
      const analysis = await fetchThermalAnalysis(origin, destination, departureTime);
      if (analysis.status !== 'success' || !analysis.recommendation) {
        throw new Error(analysis.message ?? 'The ThermoRoute API did not return a heat analysis.');
      }
      const allRoutes = analysis.recommendation.all_routes ?? [];
      const recommendedId = analysis.recommendation.best_journey?.route_id;
      setRoutes((current) => current.map((route) => {
        const match = allRoutes.find((candidate) => candidate.route_id === route.id);
        return match ? {
          ...route,
          thermalExposure: match.thermal_exposure,
          thermalLevel: match.thermal_level,
          thermalExplanation: match.thermal_explanation,
          isThermalRecommended: Boolean(match.recommended || match.route_id === recommendedId),
        } : route;
      }));
      if (recommendedId && allRoutes.some((item) => item.route_id === recommendedId)) {
        setSelectedRouteId(recommendedId);
      }
      const source = analysis.recommendation.best_journey?.heat_intelligence?.api_data;
      setThermalSource(source?.source ?? 'unknown');
      setThermalNote(source?.source_note ?? analysis.recommendation.message ?? 'The backend returned a route exposure estimate.');
      setThermalAnalysis(analysis);
      showNotice('ThermoRoute heat analysis completed.');
    } catch (error) {
      setThermalError(error instanceof Error
        ? `${error.message} Start the ThermoRoute backend to enable this analysis.`
        : 'ThermoRoute backend is unavailable. Start it and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [origin, destination, mode, departureTime, showNotice]);

  const startNavigation = useCallback(async () => {
    if (!selectedRoute) {
      showNotice('Plan a route before starting navigation.');
      return;
    }
    setGpsError('');
    setIsNavigating(true);
    spokenStepRef.current = -1;
    try {
      const position = await getCurrentPosition();
      setGpsPosition(position);
    } catch (error) {
      setGpsError(error instanceof Error ? error.message : 'Location access is unavailable.');
      showNotice('Navigation preview started, but GPS location is unavailable.');
    }
  }, [selectedRoute, getCurrentPosition, showNotice]);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (!isNavigating || !navigator.geolocation) return undefined;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setGpsPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setGpsError('');
      },
      (error) => setGpsError(error.message || 'GPS signal lost. Check location permissions.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [isNavigating]);

  useEffect(() => {
    if (!isNavigating || !voiceGuidance || !activeStep || !('speechSynthesis' in window)) return;
    if (activeStepIndex === spokenStepRef.current) return;
    spokenStepRef.current = activeStepIndex;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(activeStep.instruction);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [isNavigating, voiceGuidance, activeStep, activeStepIndex]);

  useEffect(() => () => {
    if (watchIdRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const centerOnCurrent = useCallback(() => {
    if (!gpsPosition) {
      void locateUser();
      return;
    }
    // Updating the position triggers the map to redraw around the latest fix.
    setGpsPosition({ ...gpsPosition });
  }, [gpsPosition, locateUser]);

  const shareRoute = useCallback(async () => {
    if (!origin || !destination) return;
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('from', `${origin.latitude},${origin.longitude}`);
    shareUrl.searchParams.set('to', `${destination.latitude},${destination.longitude}`);
    shareUrl.searchParams.set('mode', mode);
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      showNotice('Shareable route link copied.');
    } catch {
      showNotice('Clipboard access is blocked in this browser.');
    }
  }, [origin, destination, mode, showNotice]);

  const exportRoute = useCallback(() => {
    if (!selectedRoute) return;
    const feature = {
      type: 'Feature',
      properties: {
        name: `${origin?.label ?? 'Origin'} to ${destination?.label ?? 'Destination'}`,
        distance_m: selectedRoute.distanceMeters,
        duration_s: selectedRoute.durationSeconds,
        route_source: 'OpenStreetMap / OSRM',
      },
      geometry: {
        type: 'LineString',
        coordinates: selectedRoute.geometry.map(([latitude, longitude]) => [longitude, latitude]),
      },
    };
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [feature] }, null, 2)], { type: 'application/geo+json' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'thermoroute-route.geojson';
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    showNotice('Route exported as GeoJSON.');
  }, [selectedRoute, origin, destination, showNotice]);

  const saveRoute = useCallback(() => {
    if (!selectedRoute || !origin || !destination) return;
    const record = {
      origin,
      destination,
      mode,
      route: {
        distanceMeters: selectedRoute.distanceMeters,
        durationSeconds: selectedRoute.durationSeconds,
        geometry: selectedRoute.geometry,
      },
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem('thermoroute:last-saved-route', JSON.stringify(record));
    setSavedRoute(true);
    showNotice('Route saved in this browser.');
  }, [selectedRoute, origin, destination, mode, showNotice]);

  const reverseLocations = useCallback(() => {
    setOriginText(destinationText);
    setDestinationText(originText);
    setOrigin(destination);
    setDestination(origin);
    setRoutes([]);
    setSelectedRouteId(null);
  }, [originText, destinationText, origin, destination]);

  const rerouteFromCurrentLocation = useCallback(async () => {
    if (!gpsPosition || !destination) {
      showNotice('A current GPS position and destination are required to reroute.');
      return;
    }
    const current: Place = {
      label: 'Current GPS location',
      displayName: 'Current GPS location',
      latitude: gpsPosition.latitude,
      longitude: gpsPosition.longitude,
    };
    setOrigin(current);
    setOriginText(current.label);
    await findRoute(current, true);
    showNotice('Route recalculated from your current GPS position.');
  }, [gpsPosition, destination, findRoute, showNotice]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from')?.split(',').map(Number);
    const to = params.get('to')?.split(',').map(Number);
    const validPair = (value: number[] | undefined): value is [number, number] => Boolean(value && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180);
    if (!validPair(from) || !validPair(to)) return;
    const sharedOrigin: Place = { label: 'Shared start point', displayName: 'Shared start point', latitude: from[0], longitude: from[1] };
    const sharedDestination: Place = { label: 'Shared destination', displayName: 'Shared destination', latitude: to[0], longitude: to[1] };
    const sharedMode = params.get('mode');
    if (sharedMode === 'driving' || sharedMode === 'cycling' || sharedMode === 'walking') setMode(sharedMode);
    setOrigin(sharedOrigin);
    setDestination(sharedDestination);
    void loadConditions(sharedOrigin);
    setOriginText('Shared start point');
    setDestinationText('Shared destination');
    void fetchRealRoutes(sharedOrigin, sharedDestination, sharedMode === 'cycling' || sharedMode === 'walking' ? sharedMode : 'driving')
      .then((sharedRoutes) => { setRoutes(sharedRoutes); setSelectedRouteId(sharedRoutes[0]?.id ?? null); })
      .catch((error: unknown) => setRouteError(error instanceof Error ? error.message : 'Could not load the shared route.'));
  }, []);

  const routeRecommendation = thermalAnalysis?.recommendation?.best_journey;
  const thermalReady = routes.some((route) => typeof route.thermalExposure === 'number');

  return (
    <section className="route-planner-page">
      <div className="route-page-heading">
        <div>
          <div className="route-kicker"><span className="route-kicker-dot" /> REAL-WORLD ROUTE ENGINE</div>
          <h2>Climate-aware navigation</h2>
          <p>Plan on actual mapped roads, compare travel modes, and navigate with GPS turn guidance.</p>
        </div>
        <div className="route-heading-badges">
          <span className="data-pill"><span /> OSM ROAD DATA</span>
          <span className="data-pill data-pill-muted">Traffic sign data · OSM</span><span className="data-pill data-pill-muted">Live traffic not connected</span>
        </div>
      </div>

      <div className="local-conditions-card">
        <div className="conditions-title">
          <div><span className="route-card-kicker">CURRENT START-AREA CONDITIONS</span><strong>{origin?.label ?? 'Plan a route to load local conditions'}</strong></div>
          <span className="conditions-source">OPEN-METEO</span>
        </div>
        {conditionsLoading ? (
          <div className="conditions-loading"><Loader2 size={15} className="spin" /> Checking current weather and air quality…</div>
        ) : localConditions ? (
          <div className="conditions-metrics">
            <div className="condition-primary"><span>☀</span><strong>{Number.isFinite(localConditions.temperatureC) ? `${Math.round(localConditions.temperatureC)}°C` : '—'}</strong><small>{describeWeatherCode(localConditions.weatherCode)}{Number.isFinite(localConditions.feelsLikeC) ? ` · feels ${Math.round(localConditions.feelsLikeC)}°` : ''}</small></div>
            <div><small>US AQI</small><strong>{localConditions.usAqi ?? '—'}</strong><em>{describeAqi(localConditions.usAqi)}</em></div>
            <div><small>HUMIDITY</small><strong>{Number.isFinite(localConditions.humidityPercent) ? `${Math.round(localConditions.humidityPercent)}%` : '—'}</strong></div>
            <div><small>WIND</small><strong>{Number.isFinite(localConditions.windKmh) ? `${Math.round(localConditions.windKmh)} km/h` : '—'}</strong></div>
            <div><small>UV INDEX</small><strong>{localConditions.uvIndex ?? '—'}</strong></div>
            <div><small>PM2.5</small><strong>{localConditions.pm25 !== undefined ? `${Math.round(localConditions.pm25)} µg/m³` : '—'}</strong></div>
          </div>
        ) : conditionsError ? (
          <div className="conditions-error">{conditionsError}</div>
        ) : (
          <div className="conditions-empty">Live weather and air-quality conditions appear here after you plan a route. These readings describe the start area, not every point along the route.</div>
        )}
        <div className="conditions-footnote">Model-based point estimate · {localConditions?.observedAt ? `updated ${new Date(localConditions.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'waiting for location'} · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo attribution</a></div>
      </div>

      <div className="route-planner-grid">
        <aside className="route-control-column">
          <div className="route-form-card">
            <div className="route-card-heading">
              <div><span className="route-card-kicker">YOUR JOURNEY</span><h3>Where to?</h3></div>
              <span className="route-card-icon"><RouteIcon size={17} /></span>
            </div>

            <div className="transport-switch" role="group" aria-label="Travel mode">
              {modeOptions.map(({ value, label, icon: Icon }) => (
                <button key={value} className={mode === value ? 'transport-option is-selected' : 'transport-option'} onClick={() => { trafficRequestRef.current += 1; setMode(value); setRoutes([]); setTrafficControls([]); setTrafficControlsLoading(false); setTrafficControlsError(''); setSelectedRouteId(null); setRoutePreference('balanced'); }}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>

            <div className="location-input-row">
              <span className="location-node location-node-start" />
              <label className="location-field">
                <small>STARTING POINT</small>
                <input value={originText} onChange={(event) => { setOriginText(event.target.value); setOrigin(null); }} onKeyDown={(event) => { if (event.key === 'Enter') void findRoute(); }} placeholder="Search a place or address" />
              </label>
              <button className="field-side-action" onClick={() => void locateUser()} disabled={isLocating} title="Use my current location">
                {isLocating ? <Loader2 size={16} className="spin" /> : <LocateFixed size={16} />}
              </button>
            </div>
            <div className="location-connector" />
            <div className="location-input-row">
              <span className="location-node location-node-end" />
              <label className="location-field">
                <small>DESTINATION</small>
                <input value={destinationText} onChange={(event) => { setDestinationText(event.target.value); setDestination(null); }} onKeyDown={(event) => { if (event.key === 'Enter') void findRoute(); }} placeholder="Search destination" />
              </label>
              <button className="field-side-action swap-action" onClick={reverseLocations} title="Swap start and destination"><ArrowLeftRight size={16} /></button>
            </div>

            <div className="route-time-row">
              <label><Clock3 size={14} /><span>Depart at</span><input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} /></label>
              <span className="route-time-hint">Local time</span>
            </div>

            <button className="route-search-button" onClick={() => void findRoute()} disabled={isSearching || !originText.trim() || !destinationText.trim()}>
              {isSearching ? <><Loader2 size={17} className="spin" /> Finding real routes…</> : <><RouteIcon size={17} /> Find climate-smart routes <ArrowUpRight size={16} /></>}
            </button>

            {routeError && <div className="route-error"><AlertTriangle size={16} /><span>{routeError}</span></div>}
            {gpsError && <div className="route-warning"><MapPin size={15} /><span>{gpsError}</span></div>}

            <div className="quick-routes">
              <small>TRY A BENGALURU ROUTE</small>
              {bangaloreExamples.map((example) => (
                <button key={`${example.from}-${example.to}`} onClick={() => {
                  setOriginText(example.from); setDestinationText(example.to); setOrigin(null); setDestination(null); setRouteError('');
                }}>
                  <span>{example.from.split(',')[0]} <ArrowUpRight size={11} /> {example.to.split(',')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {routes.length > 0 && (
            <div className="route-results-card">
              <div className="route-card-heading route-results-title">
                <div><span className="route-card-kicker">AVAILABLE ROAD-NETWORK OPTIONS</span><h3>{routes.length} candidate path{routes.length === 1 ? '' : 's'}</h3></div>
                <span className="route-result-count">{mode}</span>
              </div>
              <div className="route-preference-control">
                <label htmlFor="route-preference">RANK ROUTES BY</label>
                <select id="route-preference" value={routePreference} onChange={(event) => setRoutePreference(event.target.value as RoutePreference)}>
                  <option value="balanced">Best overall balance</option>
                  <option value="fastest">Fastest estimated time</option>
                  <option value="shortest">Shortest distance</option>
                  <option value="fewest-turns">Fewest turns</option>
                  <option value="heat-smart" disabled={!hasThermalScores}>Heat-smart (run AI analysis first)</option>
                </select>
                <p>{preferenceDescription(routePreference, hasThermalScores)} Scores compare only the returned candidates; they are not live-traffic predictions.</p>
              </div>
              <div className="traffic-controls-summary">
                <span className="traffic-controls-summary-icon">🚦</span>
                <span><strong>Mapped signs & road controls</strong><small>{trafficControlsLoading ? 'Loading OpenStreetMap controls… (automatic retry on temporary errors)' : trafficControlsError || (trafficControls.length ? `${trafficControls.length} mapped feature${trafficControls.length === 1 ? '' : 's'} found near these routes` : 'No mapped features found near this route; map coverage may be incomplete.')}</small></span>
                <span className="traffic-controls-summary-state">{trafficControlsLoading ? 'LOADING' : trafficControlsError ? 'RETRY / CACHE' : trafficControls.length ? 'OSM DATA' : 'MAP COVERAGE'}</span>
              </div>
              {trafficControlsError && !trafficControlsLoading && (
                <button className="traffic-retry-button" onClick={() => {
                  const requestId = ++trafficRequestRef.current;
                  void loadTrafficControls(routes, requestId);
                }}>Retry mapped traffic data</button>
              )}
              <div className="route-option-list">
                {rankedRoutes.map(({ route, score, complexityTurns, rank }) => {
                  return (
                    <button key={route.id} className={`route-option-card ${route.id === selectedRouteId ? 'route-option-selected' : ''}`} onClick={() => setSelectedRouteId(route.id)}>
                      <span className="route-option-radio">{route.id === selectedRouteId && <Check size={12} />}</span>
                      <span className="route-option-main">
                        <strong>{`Route ${rank}${rank === 1 ? ' · BEST MATCH' : ''}`}</strong>
                        <small>{formatDistance(route.distanceMeters)} · {complexityTurns} decision turns · {route.steps.length} steps</small>
                        <em className="route-math-score">{score}/100 MULTI-CRITERIA SCORE</em>
                        {route.durationSeconds === Math.min(...routes.map((item) => item.durationSeconds)) && <em className="route-tag-fast">FASTEST</em>}
                        {route.distanceMeters === Math.min(...routes.map((item) => item.distanceMeters)) && <em className="route-tag-short">SHORTEST</em>}
                        {route.thermalExposure !== undefined && <em className="thermal-mini">Thermal exposure {Math.round(route.thermalExposure)}/100 · {route.thermalLevel ?? 'ASSESSED'}</em>}
                        {route.isThermalRecommended && <em className="thermal-best"><Sparkles size={11} /> AI heat-aware pick</em>}
                      </span>
                      <span className="route-option-time"><strong>{formatDuration(route.durationSeconds)}</strong><small>EST.</small></span>
                    </button>
                  );
                })}
              </div>
              {selectedRoute && origin && destination && <button className="primary-button route-thermal-journey-button" type="button" onClick={() => onExploreThermalJourney({
                from: originText,
                to: destinationText,
                mode,
                routes,
                selectedRouteId: selectedRoute.id,
                departureTime,
                origin,
                destination,
              })}><Sparkles size={15}/> Explore Thermal Journey</button>}
              <p className="route-candidate-note">The routing service is asked for the primary path plus up to 3 alternatives. It may return fewer when the road network has no sufficiently distinct alternatives; this is not an exhaustive enumeration of every possible road path.</p>
            </div>
          )}

          <div className="route-disclaimer-card">
            <Sparkles size={15} />
            <span>Road geometry and turn instructions come from mapped road data. Traffic signs are OpenStreetMap features where mapped; live traffic, signal phases and congestion are not connected.</span>
          </div>
        </aside>

        <div className="route-map-column">
          <div className="route-map-card">
            <div className="route-map-header">
              <div><span className="route-card-kicker">INTERACTIVE 3D CITY MAP</span><h3>{origin && destination ? `${origin.label.split(',')[0]} → ${destination.label.split(',')[0]}` : 'Explore the road network'}</h3></div>
              <span className="map-source-label"><span /> REAL ROAD GEOMETRY</span>
            </div>
            <RealRouteMap
              routes={routes}
              selectedRouteId={selectedRouteId}
              origin={origin}
              destination={destination}
              currentPosition={gpsPosition}
              trafficControls={trafficControls}
              onSelectRoute={setSelectedRouteId}
              onCenterCurrent={centerOnCurrent}
            />
            <div className="traffic-sign-legend" aria-label="Traffic-control marker legend">
              <span>🚦 Signal</span><span>🛑 Stop</span><span>🔻 Give way</span><span>🚸 Crossing</span><span>📷 Speed camera</span>
            </div>
            {selectedRoute && (
              <div className="map-bottom-stats">
                <div><small>DISTANCE</small><strong>{formatDistance(selectedRoute.distanceMeters)}</strong></div>
                <div><small>ESTIMATED TIME</small><strong>{formatDuration(selectedRoute.durationSeconds)}</strong></div>
                <div><small>ARRIVAL ESTIMATE</small><strong>{estimateArrival(selectedRoute.durationSeconds, departureTime)}</strong></div>
                <div className="map-stat-eta"><small>ROUTE DATA</small><strong>OpenStreetMap</strong></div>
              </div>
            )}
          </div>

          {selectedRoute && (
            <>
              <div className="route-action-bar">
                <button className="route-start-nav" onClick={() => isNavigating ? stopNavigation() : void startNavigation()}>
                  {isNavigating ? <><Square size={15} /> End navigation</> : <><Play size={15} fill="currentColor" /> Start GPS navigation</>}
                </button>
                <button onClick={() => setVoiceGuidance((value) => !value)} className={voiceGuidance ? 'route-action-active' : ''} title="Toggle spoken turn guidance">
                  {voiceGuidance ? <Volume2 size={15} /> : <VolumeX size={15} />} <span>Voice</span>
                </button>
                <button onClick={() => void shareRoute()} title="Copy share link"><Share2 size={15} /><span>Share</span></button>
                <button onClick={exportRoute} title="Export route as GeoJSON"><Download size={15} /><span>Export</span></button>
                <button onClick={saveRoute} className={savedRoute ? 'route-action-active' : ''} title="Save route in this browser"><Save size={15} /><span>{savedRoute ? 'Saved' : 'Save'}</span></button>
                <a href={origin && destination ? toGoogleMapsUrl(origin, destination, mode) : '#'} target="_blank" rel="noreferrer" className="route-google-link"><ExternalLink size={14} /><span>Google Maps</span></a>
              </div>

              {isNavigating && (
                <div className="navigation-live-card">
                  <div className="navigation-live-top">
                    <div><span className="route-card-kicker"><span className="map-live-dot" /> GPS NAVIGATION ACTIVE</span><h3>{offRoute ? 'You may be off route' : activeStep?.instruction ?? 'Follow the highlighted route'}</h3></div>
                    <span className="gps-accuracy">{gpsPosition ? `GPS ±${Math.round(gpsPosition.accuracy)} m` : 'Waiting for GPS'}</span>
                  </div>
                  {offRoute && <div className="off-route-alert"><AlertTriangle size={15} /> You appear outside the route corridor after accounting for GPS accuracy. Check your location or recalculate.</div>}
                  <div className="navigation-progress-track"><span style={{ width: `${Math.min(100, selectedRoute.distanceMeters ? routeProgress.progressMeters / selectedRoute.distanceMeters * 100 : 0)}%` }} /></div>
                  <div className="navigation-progress-meta"><span>{formatDistance(routeProgress.progressMeters)} travelled</span><span>{formatDistance(Math.max(0, selectedRoute.distanceMeters - routeProgress.progressMeters))} remaining</span></div>
                  {offRoute && gpsPosition && <button className="reroute-button" onClick={() => void rerouteFromCurrentLocation()}><RefreshCw size={14} /> Recalculate from current location</button>}
                </div>
              )}

              <div className="turn-list-card">
                <div className="turn-list-heading"><div><span className="route-card-kicker">TURN-BY-TURN</span><h3>Route instructions</h3></div><span>{selectedRoute.steps.length} steps</span></div>
                <div className="turn-list-scroll">
                  {selectedRoute.steps.slice(0, 18).map((step, index) => (
                    <div key={`${step.instruction}-${index}`} className={`turn-step ${isNavigating && gpsPosition && index === activeStepIndex ? 'turn-step-active' : ''}`}>
                      <span className="turn-step-icon">{getManeuverIcon(step.maneuverType, step.modifier)}</span>
                      <span className="turn-step-copy"><strong>{step.instruction}</strong><small>{step.roadName || 'Unnamed road'}</small></span>
                      <span className="turn-step-distance">{formatDistance(step.distanceMeters)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <section className="heat-intelligence-section">
        <div className="heat-intelligence-heading">
          <div><span className="route-card-kicker">THERMOROUTE INTELLIGENCE</span><h3>Heat-aware route analysis</h3><p>Run your existing backend optimizer to score actual route alternatives using its environmental sampling pipeline.</p></div>
          <button className="heat-analysis-button" onClick={() => void runHeatAnalysis()} disabled={isAnalyzing || !routes.length || mode !== 'driving'}>
            {isAnalyzing ? <><Loader2 size={15} className="spin" /> Analyzing route…</> : <><Sparkles size={15} /> Analyze with ThermoRoute AI</>}
          </button>
        </div>
        {mode !== 'driving' && <div className="heat-status-note"><AlertTriangle size={15} /> The current backend optimizer is configured for driving routes. Switch to Drive to run its heat analysis.</div>}
        {thermalError && <div className="heat-status-error"><AlertTriangle size={15} /> {thermalError}</div>}
        {thermalReady && (
          <div className="heat-analysis-result">
            <div className="heat-result-score"><strong>{selectedRoute?.thermalExposure !== undefined ? Math.round(selectedRoute.thermalExposure) : Math.round(routeRecommendation?.thermal_exposure ?? 0)}</strong><small>EXPOSURE<br />/ 100</small></div>
            <div className="heat-result-copy"><span className="heat-result-level">{selectedRoute?.thermalLevel ?? routeRecommendation?.thermal_level ?? 'ASSESSED'}</span><strong>{selectedRoute?.thermalExplanation ?? routeRecommendation?.thermal_explanation ?? 'Thermal route analysis is available.'}</strong><small>Data source: {thermalSource || 'ThermoRoute backend'}</small><p>{thermalNote || 'Values are generated by the existing ThermoRoute environmental pipeline.'}</p></div>
            <div className="heat-result-stamp"><Check size={15} /> BACKEND RESPONSE RECEIVED</div>
          </div>
        )}
        {!thermalReady && !thermalError && mode === 'driving' && (
          <div className="heat-not-connected"><span className="heat-not-connected-icon"><Sparkles size={17} /></span><div><strong>Heat scoring is ready to connect</strong><p>Start the ThermoRoute FastAPI backend on port 8000, then run the analysis. If FortyGuard is not configured, the backend will label fallback samples clearly.</p></div></div>
        )}
        <div className="route-service-footnote">Routes are calculated from OpenStreetMap data through the public FOSSGIS OSRM demo service. The service is best-effort, logs route requests, and is not a guaranteed live-navigation or traffic service. <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">Routing service details</a> · <a href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noreferrer">Map tile policy</a> · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">Geocoding policy</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report map issue</a> · <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">Weather data terms</a></div>
      </section>

      {notice && <div className="route-toast"><Check size={15} /> {notice}</div>}
    </section>
  );
}
