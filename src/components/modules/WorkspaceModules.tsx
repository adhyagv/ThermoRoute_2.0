import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Bike, Building2, CheckCircle2, CloudRain,
  Compass, ExternalLink, Leaf, Loader2, MapPin, Navigation, RefreshCw,
  Route as RouteIcon, Send, Sun, ThermometerSun, Wind, X, Pause, Play,
  SkipBack, SkipForward,
} from 'lucide-react';
import CityDigitalTwin from '../scene/CityDigitalTwin';
import RealRouteMap from '../navigation/RealRouteMap';
import { fetchLocalConditions, describeAqi, describeWeatherCode, type LocalConditions } from '../../services/localConditions';
import { fetchRealRoutes, geocodePlace } from '../../services/realRouting';
import { analyzeRouteIntelligence, type HeatProfile, type RouteIntelligenceResult } from '../../services/routeIntelligence';
import { rankRoutes, preferenceDescription } from '../../services/routeScoring';
import type { LivePosition, Place, RealRoute, RoutePreference, ThermalJourneySeed, TrafficControl, TransportMode } from '../../types/navigation';

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

function formatModelNumber(value: number | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function bengaluruDate(value: string): Date {
  const zonedValue = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}:00+05:30`;
  return new Date(zonedValue);
}

function formatBengaluruTime(value: string): string {
  return bengaluruDate(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function Provenance({ kind, source, time }: { kind: 'Live' | 'Forecast' | 'Estimated' | 'Fallback' | 'Demo'; source: string; time?: string }) {
  return <span className={`provenance provenance-${kind.toLowerCase()}`} title={`${kind} · ${source}${time ? ` · ${time}` : ''}`}>{kind.toUpperCase()} · {source}{time ? ` · ${bengaluruDate(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}</span>;
}

function ModuleHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="module-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function Metric({ label, value, sub, icon: Icon, provenance }: { label: string; value: string; sub: string; icon: typeof Activity; provenance?: ReactNode }) {
  return <article className="module-metric"><div className="module-metric-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{sub}</small>{provenance}</article>;
}

interface HealthData {
  status?: string;
  version?: string;
  integrations?: { fortyguard?: { configured?: boolean; reachable?: boolean | null; reachability_status?: string; fallback_available?: boolean; last_sample_used_fallback?: boolean | null } };
  data_status?: string;
}

export function OverviewModule({ onNavigate, time, setTime }: { onNavigate: (page: string) => void; time: number; setTime: (value: number) => void }) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState('');
  const [conditions, setConditions] = useState<LocalConditions | null>(null);
  const [conditionsError, setConditionsError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setHealthError(''); setConditionsError('');
    const [healthResult, conditionsResult] = await Promise.allSettled([
      fetch(`${API_BASE}/api/health`, { headers: { Accept: 'application/json' } }).then(async (response) => { if (!response.ok) throw new Error(`API ${response.status}`); return await response.json() as HealthData; }),
      fetchLocalConditions({ label: 'Bengaluru city centre', displayName: 'Bengaluru city centre', ...BENGALURU }),
    ]);
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value); else { setHealth(null); setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : 'Backend unavailable'); }
    if (conditionsResult.status === 'fulfilled') setConditions(conditionsResult.value); else { setConditions(null); setConditionsError(conditionsResult.reason instanceof Error ? conditionsResult.reason.message : 'Weather unavailable'); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const fg = health?.integrations?.fortyguard;
  return <section className="module-page">
    <ModuleHeading eyebrow="BENGALURU · CITY INTELLIGENCE" title="A more informed way to move" description="A working workspace for climate-aware journeys. Each reading carries a source label; unconnected modules are no longer presented as live data." action={<button className="subtle-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/> Refresh status</button>} />
    <div className="module-grid module-grid-3">
      <Metric label="Temperature" value={conditions && Number.isFinite(conditions.temperatureC) ? `${conditions.temperatureC.toFixed(1)}°C` : '—'} sub={conditions ? `Feels like ${formatModelNumber(conditions.feelsLikeC)}°C` : (conditionsError || 'Waiting for forecast')} icon={ThermometerSun} provenance={<Provenance kind="Forecast" source="Open-Meteo model current conditions" time={conditions?.observedAt}/>} />
      <Metric label="Air quality" value={conditions?.usAqi !== undefined ? `${Math.round(conditions.usAqi)} AQI` : '—'} sub={describeAqi(conditions?.usAqi)} icon={Wind} provenance={<Provenance kind="Forecast" source="Open-Meteo Air Quality" time={conditions?.observedAt}/>} />
      <Metric label="Backend" value={health?.status === 'healthy' ? 'Connected' : 'Offline'} sub={health ? `API version ${health.version ?? 'unknown'}` : healthError || 'Start FastAPI on port 8000'} icon={Activity} provenance={<Provenance kind={health ? 'Live' : 'Fallback'} source="ThermoRoute API"/>} />
    </div>
    <div className="module-two-col">
      <section className="module-panel">
        <div className="module-panel-heading"><div><span className="eyebrow">START HERE</span><h3>Working modules</h3></div><span className="status-indicator"><i/> Connected workspace</span></div>
        <div className="quick-actions">
          {[
            { label: 'Plan a route', detail: 'Real road geometry and turn instructions', page: 'Navigation', icon: Navigation },
            { label: 'Check environment', detail: 'Current point weather and air quality', page: 'Environment', icon: Wind },
            { label: 'Compare mobility', detail: 'Drive, cycle and walk route alternatives', page: 'Mobility', icon: Bike },
            { label: 'Report a street issue', detail: 'Persist a citizen report in SQLite', page: 'Civic', icon: MapPin },
          ].map(({ label, detail, page, icon: Icon }) => <button className="quick-action" key={page} onClick={() => onNavigate(page)}><span className="quick-action-icon"><Icon size={17}/></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={15}/></button>)}
        </div>
      </section>
      <section className="module-panel">
        <div className="module-panel-heading"><div><span className="eyebrow">INTEGRATION STATUS</span><h3>Data connections</h3></div></div>
        <div className="integration-list">
          <div><span>Open-Meteo weather / air quality</span><b className={conditions ? 'text-good' : 'text-muted'}>{conditions ? 'Responding' : 'Unavailable'}</b></div>
          <div><span>ThermoRoute FastAPI</span><b className={health ? 'text-good' : 'text-warning'}>{health ? 'Responding' : 'Not connected'}</b></div>
          <div><span>FortyGuard</span><b className={fg?.configured ? (fg.reachable === false ? 'text-warning' : 'text-good') : 'text-muted'}>{fg?.configured ? (fg.reachability_status ?? 'Configured') : 'Not configured'}</b></div>
          <div><span>Fallback availability</span><b>{fg?.fallback_available ? 'Available' : 'Unknown'}</b></div>
        </div>
        <p className="module-footnote">A healthy API response does not imply that every external integration has been probed. Reachability reflects the last real request.</p>
        {healthError && <div className="inline-error">{healthError}</div>}
      </section>
    </div>
    <section className="module-panel overview-city-panel">
      <div className="module-panel-heading"><div><span className="eyebrow">CONCEPT VISUALIZATION</span><h3>Bengaluru digital twin concept</h3><p>This Three.js scene is synthetic and is not georeferenced or measured.</p></div><Provenance kind="Demo" source="Procedural 3D concept scene"/></div>
      <div className="overview-city-scene"><CityDigitalTwin time={time}/></div>
      <div className="timeline-control"><label htmlFor="overview-time">Illustrative time of day <strong>{String(time).padStart(2,'0')}:00</strong></label><input id="overview-time" type="range" min="6" max="19" value={time} onChange={(event) => setTime(Number(event.target.value))}/></div>
    </section>
  </section>;
}

export function EnvironmentModule() {
  const [query, setQuery] = useState('Bengaluru city centre');
  const [place, setPlace] = useState<Place | null>({ label: 'Bengaluru city centre', displayName: 'Bengaluru city centre', ...BENGALURU });
  const [conditions, setConditions] = useState<LocalConditions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError(''); setConditions(null);
    try {
      const resolved = place && query.trim() === place.label ? place : await geocodePlace(query);
      setPlace(resolved);
      const result = await fetchLocalConditions(resolved);
      setConditions(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load environmental conditions.'); }
    finally { setBusy(false); }
  }, [place, query]);
  useEffect(() => { void load(); }, []);
  return <section className="module-page">
    <ModuleHeading eyebrow="ENVIRONMENTAL INTELLIGENCE" title="Conditions around a place" description="Current model-derived point conditions from Open-Meteo. These are not street-by-street measurements or a citywide sensor network." />
    <form className="module-search-form" onSubmit={(event) => { event.preventDefault(); void load(); }}><MapPin size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an address or Bengaluru landmark"/><button className="primary-button" disabled={busy}>{busy ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>} Refresh conditions</button></form>
    {busy && <div className="module-loading"><Loader2 className="spin"/> Fetching current model data…</div>}
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}<button onClick={() => void load()}>Retry</button></div>}
    {conditions && place && <>
      <div className="conditions-location"><strong>{place.displayName}</strong><span>{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span><Provenance kind="Forecast" source="Open-Meteo model current conditions" time={conditions.observedAt}/></div>
      <div className="module-grid module-grid-4">
        <Metric label="Air temperature" value={`${formatModelNumber(conditions.temperatureC)}°C`} sub={Number.isFinite(conditions.weatherCode) && conditions.weatherCode >= 0 ? describeWeatherCode(conditions.weatherCode) : 'Weather code unavailable'} icon={ThermometerSun} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model" time={conditions.observedAt}/>} />
        <Metric label="Feels like" value={`${formatModelNumber(conditions.feelsLikeC)}°C`} sub="Apparent temperature" icon={Sun} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model" time={conditions.observedAt}/>} />
        <Metric label="UV index" value={formatModelNumber(conditions.uvIndex)} sub="Point forecast" icon={Sun} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model" time={conditions.observedAt}/>} />
        <Metric label="US AQI" value={conditions.usAqi !== undefined ? String(Math.round(conditions.usAqi)) : '—'} sub={describeAqi(conditions.usAqi)} icon={Wind} provenance={<Provenance kind="Forecast" source="CAMS via Open-Meteo" time={conditions.observedAt}/>} />
        <Metric label="Humidity" value={`${formatModelNumber(conditions.humidityPercent, 0)}%`} sub="Relative humidity" icon={CloudRain} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model"/>} />
        <Metric label="Precipitation" value={`${formatModelNumber(conditions.precipitationMm)} mm`} sub="Current interval" icon={CloudRain} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model"/>} />
        <Metric label="Wind" value={`${formatModelNumber(conditions.windKmh)} km/h`} sub="10 m wind speed" icon={Wind} provenance={<Provenance kind="Forecast" source="Open-Meteo weather model"/>} />
        <Metric label="PM2.5" value={`${formatModelNumber(conditions.pm25)} µg/m³`} sub="Fine particulate matter" icon={Activity} provenance={<Provenance kind="Forecast" source="CAMS via Open-Meteo"/>} />
      </div>
    </>}
    <p className="module-footnote"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> weather and CAMS air-quality data attribution. Forecast model grid cells may not exactly match the entered coordinates.</p>
  </section>;
}

export function MobilityModule() {
  const [from, setFrom] = useState('PES University, Banashankari, Bengaluru');
  const [to, setTo] = useState('Lalbagh Botanical Garden, Bengaluru');
  const [mode, setMode] = useState<TransportMode>('driving');
  const [preference, setPreference] = useState<RoutePreference>('balanced');
  const [environmentalWeight, setEnvironmentalWeight] = useState(50);
  const [routes, setRoutes] = useState<RealRoute[]>([]);
  const [routeAnalysis, setRouteAnalysis] = useState<RouteIntelligenceResult | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const ranked = useMemo(() => {
    if (routeAnalysis) {
      return routeAnalysis.route_comparison
        .map((comparison) => {
          const route = routes.find((candidate) => candidate.id === comparison.route_id);
          return route ? {
            route,
            score: comparison.normalized_score ?? 0,
            complexityTurns: comparison.turn_count,
            rank: comparison.rank,
          } : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }
    return rankRoutes(routes, preference);
  }, [routes, preference, routeAnalysis]);
  const search = async () => {
    setBusy(true); setError(''); setRoutes([]); setRouteAnalysis(null); setAnalysisError('');
    try {
      const [a, b] = await Promise.all([geocodePlace(from), geocodePlace(to)]);
      const found = await fetchRealRoutes(a, b, mode);
      setOrigin(a); setDestination(b); setRoutes(found); setSelected(found[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Route comparison failed.'); }
    finally { setBusy(false); }
  };
  const analyzeAlternatives = async () => {
    const route = routes.find((candidate) => candidate.id === selected) ?? routes[0];
    if (!route) return;
    setAnalysisBusy(true); setAnalysisError('');
    try {
      const options = routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({
        id: candidate.id,
        geometry: candidate.geometry,
        distanceMeters: candidate.distanceMeters,
        durationSeconds: candidate.durationSeconds,
        turnCount: countRouteTurns(candidate),
      }));
      const result = await analyzeRouteIntelligence(
        route,
        mode,
        mode === 'walking' ? 'pedestrian' : mode === 'cycling' ? 'cyclist' : 'adult',
        localDateTimeInput(),
        {
          routeOptions: options,
          strategy: preference === 'fewest-turns' || preference === 'heat-smart' ? 'balanced' : preference,
          environmentalWeight: environmentalWeight / 100,
        },
      );
      setRouteAnalysis(result);
      if (result.route_recommendation) setSelected(result.route_recommendation.route_id);
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : 'Environmental comparison failed.');
    } finally { setAnalysisBusy(false); }
  };
  return <section className="module-page">
    <ModuleHeading eyebrow="MULTI-MODAL MOBILITY" title="Compare ways to travel" description="Compare actual road-network alternatives for driving, cycling or walking, then connect route ranking to the shared environmental exposure analysis. No live traffic data is included." />
    <form className="mobility-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <label>Origin<input value={from} onChange={(event) => { setFrom(event.target.value); setRoutes([]); setRouteAnalysis(null); }}/></label><label>Destination<input value={to} onChange={(event) => { setTo(event.target.value); setRoutes([]); setRouteAnalysis(null); }}/></label>
      <label>Travel mode<select value={mode} onChange={(event) => { setMode(event.target.value as TransportMode); setRoutes([]); setRouteAnalysis(null); }}><option value="driving">Drive</option><option value="cycling">Cycle</option><option value="walking">Walk</option></select></label>
      <button className="primary-button" disabled={busy}>{busy ? <Loader2 className="spin" size={15}/> : <RouteIcon size={15}/>} Compare routes</button>
    </form>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
    {busy && <div className="module-loading"><Loader2 className="spin"/> Querying geocoding and road-routing services…</div>}
    {routes.length > 0 && origin && destination && <>
      <div className="mobility-results-heading"><div><strong>{routes.length} route alternatives returned</strong><small>Candidate set from the public routing engine</small></div><select value={preference} onChange={(event) => { setPreference(event.target.value as RoutePreference); setRouteAnalysis(null); }}><option value="balanced">Balanced</option><option value="fastest">Fastest</option><option value="shortest">Shortest</option><option value="fewest-turns">Fewest turns</option><option value="coolest">Coolest</option><option value="cleanest">Cleanest air</option></select></div>
      <p className="module-footnote">{preferenceDescription(preference, Boolean(routeAnalysis))} Scores are relative to the returned provider candidates, not a guarantee of actual travel conditions.</p>
      <div className="preference-slider"><div><strong>Fast vs. environmental</strong><small>Balanced strategy weights time against available route heat/AQI. Missing values are excluded.</small></div><label><span>FASTEST</span><input type="range" min="0" max="100" step="5" value={environmentalWeight} onChange={(event) => { setEnvironmentalWeight(Number(event.target.value)); setRouteAnalysis(null); }}/><span>COOLER / CLEANER</span></label><output>{environmentalWeight}% environmental</output></div>
      <button className="primary-button" disabled={analysisBusy} onClick={() => void analyzeAlternatives()}>{analysisBusy ? <Loader2 className="spin" size={15}/> : <Activity size={15}/>} Analyze route environments</button>
      {analysisError && <div className="inline-error"><AlertTriangle size={15}/>{analysisError}</div>}
      {routeAnalysis?.route_recommendation && <div className="departure-explanation">Recommended route: {routeAnalysis.route_recommendation.route_id}. {routeAnalysis.route_recommendation.reason}</div>}
      <div className="mobility-layout"><div className="mobility-route-list">{ranked.map(({ route, score, complexityTurns, rank }) => {
        const environmental = routeAnalysis?.route_comparison.find((candidate) => candidate.route_id === route.id);
        return <button key={route.id} onClick={() => { setSelected(route.id); setRouteAnalysis(null); }} className={`mobility-route-card ${selected === route.id ? 'selected' : ''}`}><div><strong>Route {rank} {rank === 1 ? '· top ranked' : ''}</strong><span>{(route.distanceMeters / 1000).toFixed(1)} km · {Math.max(1, Math.round(route.durationSeconds / 60))} min · {complexityTurns} decision turns</span>{environmental && <small>Exposure {environmental.route_exposure_score?.toFixed(1) ?? 'Unavailable'} · shade {environmental.route_shade_percentage === null ? 'Unavailable' : `${environmental.route_shade_percentage.toFixed(0)}%`} · AQI {environmental.mean_us_aqi?.toFixed(0) ?? 'Unavailable'} · {environmental.pareto_dominated ? 'dominated' : 'not dominated'}</small>}</div><b>{score}/100</b></button>;
      })}</div><div className="mobility-map"><RealRouteMap routes={routes} selectedRouteId={selected} origin={origin} destination={destination} currentPosition={null} trafficControls={[]} onSelectRoute={(routeId) => { setSelected(routeId); setRouteAnalysis(null); }} onCenterCurrent={() => undefined}/></div></div>
      <p className="module-footnote">Changing route, strategy, or preference clears the previous environmental comparison. Choose “Analyze route environments” again to recalculate.</p>
      <div className="module-footnote">Source: OpenStreetMap-based OSRM public routing service. Route times are routing estimates without live congestion.</div>
    </>}
  </section>;
}

export type CivicCategory = 'too_hot' | 'no_shade' | 'waterlogged' | 'broken_signal' | 'poor_air_quality' | 'damaged_pedestrian_infrastructure' | 'unsafe_crossing' | 'other';
export interface CivicReport { id: number; category: CivicCategory; note: string; latitude: number; longitude: number; created_at: string; status: 'unverified' | 'reviewed' | 'resolved'; anonymous: boolean; }
const civicLabels: Record<CivicCategory, string> = {
  too_hot: 'Excessive heat',
  no_shade: 'No shade',
  waterlogged: 'Waterlogging',
  broken_signal: 'Broken traffic signal',
  poor_air_quality: 'Poor air quality',
  damaged_pedestrian_infrastructure: 'Damaged pedestrian infrastructure',
  unsafe_crossing: 'Unsafe crossing',
  other: 'Other issue',
};

export function CivicModule() {
  const [category, setCategory] = useState<CivicCategory>('too_hot');
  const [note, setNote] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [latitude, setLatitude] = useState(String(BENGALURU.latitude));
  const [longitude, setLongitude] = useState(String(BENGALURU.longitude));
  const [reports, setReports] = useState<CivicReport[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [summary, setSummary] = useState<{ reports_by_category?: Record<string, number>; reports_by_neighbourhood_cell?: Array<{ cell: string; count: number }>; seven_day_trend?: Array<{ date: string; count: number }>; thirty_day_trend?: Array<{ month: string; count: number }>; density_note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('from_date', bengaluruDate(`${dateFrom}T00:00`).toISOString());
      if (dateTo) params.set('to_date', bengaluruDate(`${dateTo}T23:59`).toISOString());
      const [reportResponse, summaryResponse] = await Promise.all([
        fetch(`${API_BASE}/api/civic/reports?${params}`),
        fetch(`${API_BASE}/api/civic/hotspots?days=30`),
      ]);
      if (!reportResponse.ok || !summaryResponse.ok) throw new Error(`Civic API returned ${reportResponse.status}/${summaryResponse.status}`);
      const body = await reportResponse.json() as { reports?: CivicReport[] };
      setReports(body.reports ?? []);
      setSummary(await summaryResponse.json());
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load civic reports. Start the backend and retry.'); }
    finally { setLoading(false); }
  }, [categoryFilter, statusFilter, dateFrom, dateTo]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/civic/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, note, anonymous, latitude: Number(latitude), longitude: Number(longitude) }) });
      const body = await response.json() as { message?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail ?? body.message ?? `Civic API returned ${response.status}`);
      setNote(''); setMessage('Report saved as unverified. Community reports are not automatically validated.'); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save report.'); }
    finally { setBusy(false); }
  };
  const useLocation = () => { if (!navigator.geolocation) { setError('Geolocation is not supported by this browser.'); return; } navigator.geolocation.getCurrentPosition((position) => { setLatitude(position.coords.latitude.toFixed(6)); setLongitude(position.coords.longitude.toFixed(6)); setError(''); }, (reason) => setError(reason.message), { enableHighAccuracy: true, timeout: 12000 }); };
  const reportClusters = useMemo(() => {
    const groups = new Map<string, CivicReport[]>();
    reports.forEach((report) => {
      const key = `${Math.round(report.latitude * 300) / 300},${Math.round(report.longitude * 300) / 300}`;
      groups.set(key, [...(groups.get(key) ?? []), report]);
    });
    return [...groups.entries()].map(([key, group]) => {
      const [lat, lon] = key.split(',').map(Number);
      const categories = [...new Set(group.map((report) => report.category))];
      return {
        id: `civic-cluster-${key}`,
        kind: 'traffic-sign' as const,
        label: group.length > 1 ? `${group.length} community reports` : civicLabels[group[0].category],
        detail: `${categories.map((item) => civicLabels[item]).join(', ')} · reports, not measured heat`,
        latitude: lat,
        longitude: lon,
      };
    });
  }, [reports]);
  const updateStatus = async (report: CivicReport, status: CivicReport['status']) => {
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/civic/reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(`Status update failed (${response.status}).`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update report status.'); }
  };
  const deleteReport = async (report: CivicReport) => {
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/civic/reports/${report.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Report deletion failed (${response.status}).`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete report.'); }
  };
  const categoryCounts = summary?.reports_by_category ?? {};
  return <section className="module-page">
    <ModuleHeading eyebrow="COMMUNITY HEAT INTELLIGENCE" title="Civic heat & street observations" description="Submit a time-stamped observation, inspect recent community hotspots and follow report status. Community density reflects submissions—not scientifically measured heat." action={<button className="subtle-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh reports</button>} />
    <div className="civic-layout"><form className="module-panel civic-form" onSubmit={(event) => void submit(event)}><div className="module-panel-heading"><div><span className="eyebrow">NEW OBSERVATION</span><h3>Report an issue</h3></div><MapPin size={18}/></div>
      <label>Issue category<select value={category} onChange={(event) => setCategory(event.target.value as CivicCategory)}>{Object.entries(civicLabels).filter(([value]) => !['unsafe_crossing', 'other'].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Latitude<input type="number" min="-90" max="90" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)}/></label>
      <label>Longitude<input type="number" min="-180" max="180" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)}/></label>
      <button type="button" className="subtle-button" onClick={useLocation}><LocateFixedFallback/> Use my current location</button>
      <label>Optional note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Describe what you observed (max 500 characters)"/></label>
      <label className="civic-anonymous"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)}/> Submit anonymously</label>
      <button className="primary-button" disabled={busy}>{busy ? <Loader2 className="spin" size={15}/> : <Send size={15}/>} Submit civic report</button>
      {message && <div className="inline-success"><CheckCircle2 size={15}/>{message}</div>}{error && <div className="inline-error">{error}</div>}
      <p className="module-footnote">Reports are public within this local app database. Do not include personal or sensitive information.</p>
    </form><div className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">COMMUNITY SIGNAL</span><h3>Reported hotspots</h3></div><strong>{reports.length} shown</strong></div>
      <div className="civic-filters">
        <label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{Object.entries(civicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="unverified">Unverified</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label>
        <label>From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label>To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label>
      </div>
      {loading ? <div className="module-loading"><Loader2 className="spin"/>Loading stored reports…</div> : reports.length === 0 ? <div className="empty-state"><MapPin size={25}/><strong>No reports stored yet</strong><span>Submit a street observation to create the first record.</span></div> : <>
        <div className="hotspot-list">{Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([key, count]) => <div key={key}><span>{civicLabels[key as CivicCategory] ?? key}</span><strong>{count}</strong></div>)}</div>
        <p className="module-footnote">{summary?.density_note}</p>
        <div className="civic-report-list">{reports.map((report) => <article key={report.id} className="civic-report"><div><strong>{civicLabels[report.category] ?? report.category}</strong><small>{report.latitude.toFixed(4)}, {report.longitude.toFixed(4)} · {new Date(report.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {report.anonymous ? 'Anonymous' : 'Not anonymous'}</small>{report.note && <p>{report.note}</p>}<label className="civic-status-control">Status<select value={report.status} onChange={(event) => void updateStatus(report, event.target.value as CivicReport['status'])}><option value="unverified">Unverified</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label></div><div className="civic-report-actions"><a href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`} target="_blank" rel="noreferrer" aria-label="Open report on OpenStreetMap"><ExternalLink size={14}/></a><button type="button" className="icon-button" aria-label="Delete civic report" onClick={() => void deleteReport(report)}><X size={14}/></button></div></article>)}</div>
      </>}
    </div></div>
    {summary && <section className="module-panel civic-trends"><div className="module-panel-heading"><div><span className="eyebrow">SUBMISSION TRENDS</span><h3>Seven-day and thirty-day activity</h3></div></div><div className="civic-trend-grid"><div><strong>Last 7 days</strong>{(summary.seven_day_trend ?? []).map((item) => <span key={item.date}>{item.date}: {item.count}</span>)}</div><div><strong>Last 30 days by month</strong>{(summary.thirty_day_trend ?? []).map((item) => <span key={item.month}>{item.month}: {item.count}</span>)}</div><div><strong>Approximate area cells</strong>{(summary.reports_by_neighbourhood_cell ?? []).slice(0, 5).map((item) => <span key={item.cell}>{item.cell}: {item.count}</span>)}</div></div></section>}
    <section className="module-panel civic-map-panel"><div className="module-panel-heading"><div><span className="eyebrow">FILTERED REPORT MAP</span><h3>Community submission clusters</h3></div><span>{reportClusters.length} approximate map cells</span></div><div className="city-planner-map"><RealRouteMap routes={[]} selectedRouteId={null} origin={null} destination={null} currentPosition={null} trafficControls={reportClusters} onSelectRoute={() => undefined} onCenterCurrent={() => undefined}/></div></section>
  </section>;
}

function LocateFixedFallback() { return <MapPin size={14}/>; }

function localDateTimeInput() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

function countRouteTurns(route: RealRoute): number {
  return route.steps.filter((step) => ['turn', 'fork', 'roundabout', 'rotary', 'merge', 'on ramp', 'off ramp', 'end of road'].includes(step.maneuverType)).length;
}

export function InsightsModule({ initialJourney }: { initialJourney: ThermalJourneySeed | null }) {
  const [from, setFrom] = useState(initialJourney?.from ?? 'PES University, Banashankari, Bengaluru');
  const [to, setTo] = useState(initialJourney?.to ?? 'Lalbagh Botanical Garden, Bengaluru');
  const [mode, setMode] = useState<TransportMode>(initialJourney?.mode ?? 'walking');
  const [profile, setProfile] = useState<HeatProfile>(initialJourney?.mode === 'walking' ? 'pedestrian' : initialJourney?.mode === 'cycling' ? 'cyclist' : 'adult');
  const [departureAt, setDepartureAt] = useState(() => {
    const current = localDateTimeInput();
    return initialJourney?.departureTime ? `${current.slice(0, 10)}T${initialJourney.departureTime}` : current;
  });
  const [routes, setRoutes] = useState<RealRoute[]>(initialJourney?.routes ?? []);
  const [origin, setOrigin] = useState<Place | null>(initialJourney?.origin ?? null);
  const [destination, setDestination] = useState<Place | null>(initialJourney?.destination ?? null);
  const [selectedRouteId, setSelectedRouteId] = useState(initialJourney?.selectedRouteId ?? '');
  const [analysis, setAnalysis] = useState<RouteIntelligenceResult | null>(null);
  const [strategy, setStrategy] = useState<'fastest' | 'shortest' | 'coolest' | 'cleanest' | 'balanced'>('balanced');
  const [environmentalWeight, setEnvironmentalWeight] = useState(50);
  const [maxExtraTime, setMaxExtraTime] = useState(10);
  const [searchWindowHours, setSearchWindowHours] = useState(6);
  const [solarHour, setSolarHour] = useState(() => Number(localDateTimeInput().slice(11, 13)));
  const [solarSnapshots, setSolarSnapshots] = useState<Array<{ label: string; departureAt: string; shade: number | null; sunlight: number | null; elevation: number; exposure: number | null }>>([]);
  const [activeSampleIndex, setActiveSampleIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [routeNotice, setRouteNotice] = useState('');
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? routes[0];

  const discoverRoutes = async () => {
    setBusy(true); setError(''); setAnalysis(null); setRouteNotice('');
    try {
      const [origin, destination] = await Promise.all([geocodePlace(from), geocodePlace(to)]);
      const found = await fetchRealRoutes(origin, destination, mode);
      setOrigin(origin);
      setDestination(destination);
      setRoutes(found);
      setSelectedRouteId(found[0]?.id ?? '');
      if (!found.length) throw new Error('The routing provider returned no usable route geometry.');
      setRouteNotice(`${found.length} mapped alternatives loaded. Explore a thermal journey to compare forecasts, estimated shade and departure windows.`);
    } catch (reason) {
      setRoutes([]);
      setError(reason instanceof Error ? reason.message : 'Could not retrieve route alternatives.');
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!selectedRoute) {
      await discoverRoutes();
      return;
    }
    setBusy(true); setError(''); setAnalysis(null);
    try {
      const options = routes
        .filter((route) => route.id !== selectedRoute.id)
        .map((route) => ({
          id: route.id,
          geometry: route.geometry,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          turnCount: countRouteTurns(route),
        }));
      const result = await analyzeRouteIntelligence(selectedRoute, mode, profile, departureAt, {
        routeOptions: options,
        strategy,
        environmentalWeight: environmentalWeight / 100,
        maxExtraTimeMinutes: maxExtraTime,
        searchWindowHours,
      });
      setAnalysis(result);
      const presetLabel = solarHour < 11 ? 'Morning' : solarHour < 15 ? 'Midday' : solarHour < 18 ? 'Afternoon' : 'Evening';
      setSolarSnapshots((current) => [
        ...current.filter((snapshot) => snapshot.label !== presetLabel),
        {
          label: presetLabel,
          departureAt,
          shade: result.route_shade_percentage,
          sunlight: result.direct_sun_exposure_percentage,
          elevation: result.solar_position.elevation_deg,
          exposure: result.route_exposure_score,
        },
      ].slice(-4));
      setActiveSampleIndex(0);
      setPlaying(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Route-wide analysis failed.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!playing || !analysis?.samples.length) return undefined;
    const timer = window.setInterval(() => {
      setActiveSampleIndex((current) => {
        if (current >= analysis.samples.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1000 / playbackSpeed);
    return () => window.clearInterval(timer);
  }, [analysis, playbackSpeed, playing]);

  const bestDeparture = analysis?.departure_recommendation;
  const validDepartureScores = (analysis?.departure_candidates ?? []).map((item) => item.exposure_score).filter((value): value is number => value !== null);
  const maxDepartureScore = Math.max(1, ...validDepartureScores);
  const currentDepartureScore = analysis?.departure_candidates[0]?.exposure_score;
  const departureReduction = bestDeparture?.exposure_score !== null && bestDeparture?.exposure_score !== undefined && currentDepartureScore !== null && currentDepartureScore !== undefined
    ? Math.max(0, currentDepartureScore - bestDeparture.exposure_score)
    : null;
  const riskLevel = (score: number | null) => score === null ? 'Unavailable' : score < 30 ? 'Lower index' : score < 50 ? 'Moderate index' : score < 70 ? 'High index' : 'Very high index';
  const meanAvailable = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  };
  const meanApparentTemperature = analysis ? meanAvailable(analysis.samples.map((sample) => sample.apparent_temperature_c)) : null;
  const meanAqi = analysis ? meanAvailable(analysis.samples.map((sample) => sample.us_aqi)) : null;
  const shadeCandidates = analysis?.samples.filter((sample) => sample.shade_estimated === true).length ?? 0;
  const shadeUnknown = analysis?.samples.filter((sample) => sample.shade_estimated === null).length ?? 0;
  const waterloggingWatches = analysis?.samples.filter((sample) => sample.waterlogging_risk === 'waterlogging_watch_estimate').length ?? 0;
  const activeSample = analysis?.samples[Math.min(activeSampleIndex, Math.max(0, (analysis?.samples.length ?? 1) - 1))];
  const activeNextSample = analysis?.samples[activeSampleIndex + 1];
  const shadeSegments = useMemo(() => analysis
    ? analysis.samples.slice(0, -1).map((sample, index) => ({
      start: [sample.latitude, sample.longitude] as [number, number],
      end: [analysis.samples[index + 1].latitude, analysis.samples[index + 1].longitude] as [number, number],
      shadePercentage: sample.segment_shade_percentage,
    }))
    : [], [analysis]);
  const setSolarTime = (hour: number) => {
    setSolarHour(hour);
    const [datePart] = departureAt.split('T');
    setDepartureAt(`${datePart}T${String(hour).padStart(2, '0')}:00`);
    setAnalysis(null);
  };

  return <section className="module-page">
    <ModuleHeading eyebrow="ROUTE-WIDE THERMAL INTELLIGENCE" title="Understand the exposure along your journey" description="Samples weather and air-quality forecasts at predicted route arrival times, estimates sun position and mapped shade, and compares departure windows. Scores are transparent decision-support estimates, not medical safety advice." />
    <div className="mobility-search insight-search">
      <label>Origin<input value={from} onChange={(event) => setFrom(event.target.value)}/></label>
      <label>Destination<input value={to} onChange={(event) => setTo(event.target.value)}/></label>
      <label>Mode<select value={mode} onChange={(event) => { setMode(event.target.value as TransportMode); setRoutes([]); setAnalysis(null); }}><option value="driving">Drive</option><option value="cycling">Cycle</option><option value="walking">Walk</option></select></label>
      <label>Heat profile<select value={profile} onChange={(event) => { setProfile(event.target.value as HeatProfile); setAnalysis(null); }}><option value="adult">Adult</option><option value="elderly">Elderly</option><option value="child">Child</option><option value="asthma">Asthma-sensitive</option><option value="outdoor_worker">Outdoor worker</option><option value="cyclist">Cyclist</option><option value="pedestrian">Pedestrian</option></select></label>
      <label>Departure time<input type="datetime-local" value={departureAt} onChange={(event) => { setDepartureAt(event.target.value); setSolarHour(Number(event.target.value.slice(11, 13)) || 0); setAnalysis(null); }}/></label>
      <button className="primary-button" onClick={() => void discoverRoutes()} disabled={busy}><RouteIcon size={15}/> Find routes</button>
    </div>
    {routes.length > 0 && <div className="analysis-route-select"><label>Route alternative<select value={selectedRouteId} onChange={(event) => { setSelectedRouteId(event.target.value); setAnalysis(null); }}>{routes.map((route, index) => <option key={route.id} value={route.id}>Route {index + 1} · {(route.distanceMeters / 1000).toFixed(1)} km · {Math.round(route.durationSeconds / 60)} min</option>)}</select></label><label>Decision strategy<select value={strategy} onChange={(event) => { setStrategy(event.target.value as typeof strategy); setAnalysis(null); }}><option value="balanced">Balanced</option><option value="fastest">Fastest</option><option value="shortest">Shortest</option><option value="coolest">Coolest</option><option value="cleanest">Cleanest air</option></select></label><label>Max extra time<input type="number" min="0" max="180" value={maxExtraTime} onChange={(event) => { setMaxExtraTime(Number(event.target.value)); setAnalysis(null); }}/></label><label>Search window<select value={searchWindowHours} onChange={(event) => { setSearchWindowHours(Number(event.target.value)); setAnalysis(null); }}><option value={6}>6 hours</option><option value={9}>9 hours</option><option value={12}>12 hours</option></select></label><button className="primary-button" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 className="spin" size={15}/> : <Activity size={15}/>} Explore Thermal Journey</button></div>}
    {routes.length > 1 && <div className="preference-slider"><div><strong>Route trade-off</strong><small>Balanced strategy: this slider trades normalized travel time against available route heat/AQI. Choose another strategy above for a fixed objective.</small></div><label><span>FASTEST</span><input type="range" min="0" max="100" step="5" value={environmentalWeight} onChange={(event) => { setEnvironmentalWeight(Number(event.target.value)); setStrategy('balanced'); setAnalysis(null); }}/><span>COOLEST / CLEANEST</span></label><output>{environmentalWeight}% environmental preference</output></div>}
    {routes.length > 0 && <p className="module-footnote">Changing route, strategy, departure, or preference clears the previous result. Select your settings, then choose “Explore Thermal Journey” to recalculate.</p>}
    {routes.length > 0 && <section className="module-panel solar-controls"><div className="module-panel-heading"><div><span className="eyebrow">SOLAR SHADOW SIMULATOR · ESTIMATED</span><h3>Compare the same road at different times</h3><p>Solar position uses Astral. Shade uses mapped building footprints and tagged heights; unknown heights and incomplete OSM coverage reduce confidence.</p></div><Sun size={18}/></div><label className="solar-hour-control">Time of day · {String(solarHour).padStart(2, '0')}:00<input type="range" min="5" max="20" step="1" value={solarHour} onChange={(event) => setSolarTime(Number(event.target.value))}/></label><div className="solar-preset-row">{[{ label: 'Morning', hour: 8 }, { label: 'Midday', hour: 12 }, { label: 'Afternoon', hour: 16 }, { label: 'Evening', hour: 18 }].map((preset) => <button type="button" className="subtle-button" key={preset.label} onClick={() => setSolarTime(preset.hour)}>{preset.label} · {preset.hour}:00</button>)}</div><p className="module-footnote">Changing time re-evaluates solar position and mapped shadows when you run “Explore Thermal Journey”. Past or out-of-horizon forecast readings remain unavailable; solar estimates do not require forecast values.</p></section>}
    {!routes.length && <button className="primary-button" onClick={() => void discoverRoutes()} disabled={busy}>{busy ? <Loader2 className="spin" size={15}/> : <RouteIcon size={15}/>} Find route candidates</button>}
    {routeNotice && <div className="inline-success"><CheckCircle2 size={15}/>{routeNotice}</div>}
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}<button onClick={() => selectedRoute ? void run() : void discoverRoutes()}>Retry</button></div>}
    {busy && <div className="module-loading"><Loader2 className="spin"/> Sampling route alternatives, requesting hourly forecasts and checking mapped shade geometry…</div>}
    {analysis && <>
      <section className="module-panel replay-panel">
        <div className="module-panel-heading"><div><span className="eyebrow">ESTIMATED · THERMAL ROUTE REPLAY</span><h3>Explore Thermal Journey</h3><p>Move through forecast arrival samples; the marker and active segment follow the selected OSRM route. Route coloring reflects mapped-shade estimates.</p></div><Provenance kind="Forecast" source="Open-Meteo / CAMS" time={analysis.analyzed_at}/></div>
        <div className="replay-map"><RealRouteMap routes={routes} selectedRouteId={selectedRoute?.id ?? null} origin={origin} destination={destination} currentPosition={null} replayPosition={activeSample ? [activeSample.latitude, activeSample.longitude] : null} activeSegment={activeSample && activeNextSample ? [[activeSample.latitude, activeSample.longitude], [activeNextSample.latitude, activeNextSample.longitude]] : null} shadeSegments={shadeSegments} shadowPolygons={activeSample?.building_shadow_polygons ?? []} trafficControls={[]} onSelectRoute={(routeId) => { setSelectedRouteId(routeId); setAnalysis(null); }} onCenterCurrent={() => undefined}/></div>
        <div className="replay-shade-legend"><span><i className="shade-legend-building"/> Estimated mapped building shadows</span><span><i className="shade-legend-shaded"/> Estimated shaded route segment</span><span><i className="shade-legend-sun"/> No mapped shade identified</span><span><i className="shade-legend-unknown"/> Unavailable</span></div>
        {activeSample && <div className="replay-controls">
          <div className="replay-toolbar">
            <div className="replay-buttons">
              <button type="button" className="icon-button" aria-label="Previous route segment" onClick={() => { setPlaying(false); setActiveSampleIndex((index) => Math.max(0, index - 1)); }}><SkipBack size={15}/></button>
              <button type="button" className="primary-button replay-play" onClick={() => { if (activeSampleIndex >= analysis.samples.length - 1) setActiveSampleIndex(0); setPlaying((value) => !value); }} aria-label={playing ? 'Pause thermal replay' : 'Play thermal replay'}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Play'}</button>
              <button type="button" className="icon-button" aria-label="Next route segment" onClick={() => { setPlaying(false); setActiveSampleIndex((index) => Math.min(analysis.samples.length - 1, index + 1)); }}><SkipForward size={15}/></button>
              <label>Playback<select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
            </div>
            <div className="replay-current"><span>{activeSample.elapsed_minutes.toFixed(1)} min into journey</span><strong>{activeSample.distance_from_start_m >= 1000 ? `${(activeSample.distance_from_start_m / 1000).toFixed(2)} km` : `${Math.round(activeSample.distance_from_start_m)} m`}</strong><small>Predicted {formatBengaluruTime(activeSample.predicted_arrival_at)}</small></div>
          </div>
          <input className="replay-range" type="range" min="0" max={analysis.samples.length - 1} step="1" value={activeSampleIndex} aria-label="Thermal journey timeline" onChange={(event) => { setPlaying(false); setActiveSampleIndex(Number(event.target.value)); }}/>
          <div className="replay-timeline-labels"><span>Departure · {formatBengaluruTime(departureAt)}</span><span>Arrival · {formatBengaluruTime(analysis.samples[analysis.samples.length - 1].predicted_arrival_at)}</span></div>
          <div className="module-grid module-grid-4 replay-metrics">
            <Metric label="Temperature / feels like" value={`${activeSample.temperature_c?.toFixed(1) ?? 'Unavailable'}° / ${activeSample.apparent_temperature_c?.toFixed(1) ?? 'Unavailable'}°C`} sub="At predicted segment arrival" icon={ThermometerSun} provenance={<Provenance kind="Forecast" source={`Open-Meteo · ${activeSample.forecast_time.weather ?? 'Unavailable'}`}/>}/>
            <Metric label="UV index" value={activeSample.uv_index?.toFixed(1) ?? 'Unavailable'} sub="Hourly forecast" icon={Sun} provenance={<Provenance kind="Forecast" source={`Open-Meteo · ${activeSample.forecast_time.weather ?? 'Unavailable'}`}/>}/>
            <Metric label="Air quality / PM2.5" value={`${activeSample.us_aqi === null ? 'Unavailable' : Math.round(activeSample.us_aqi)} / ${activeSample.pm2_5?.toFixed(1) ?? 'Unavailable'}`} sub="US AQI / µg/m³" icon={Wind} provenance={<Provenance kind="Forecast" source={`CAMS · ${activeSample.forecast_time.air_quality ?? 'Unavailable'}`}/>}/>
            <Metric label="Shade / segment risk" value={`${activeSample.segment_shade_percentage === null ? 'Unavailable' : `${activeSample.segment_shade_percentage.toFixed(0)}%`} · ${riskLevel(activeSample.route_exposure_score)}`} sub={`${activeSample.shade_source.replace(/_/g, ' ')} · estimated`} icon={Leaf} provenance={<Provenance kind="Estimated" source="OSM geometry + solar position"/>}/>
          </div>
          <p className="module-footnote">Forecast timestamps identify exact hourly observations or the adjacent observations used for interpolation: weather {activeSample.forecast_time.weather ?? 'Unavailable'}; air quality {activeSample.forecast_time.air_quality ?? 'Unavailable'}. Source retrieval time: {bengaluruDate(analysis.analyzed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.</p>
        </div>}
      </section>
      <div className="analysis-result-banner"><div><span className="eyebrow">PROFILE: {analysis.profile.replace('_', ' ').toUpperCase()}</span><h3>{analysis.route_exposure_score !== null ? `${analysis.route_exposure_score.toFixed(1)} / 100 · ${riskLevel(analysis.route_exposure_score)}` : 'Exposure score unavailable'}</h3><p>{analysis.route_exposure_score !== null ? `The weighted exposure index uses the available heat, UV, AQI and mapped-shade inputs for ${analysis.sample_count} route samples. Missing inputs are excluded and the remaining weights are renormalized.` : 'Weather and air-quality samples were unavailable. No substitute temperature or AQI values were invented.'}</p></div><Provenance kind={analysis.route_exposure_score === null ? 'Fallback' : 'Estimated'} source="Route-wide model + OSM shade estimate"/></div>
      <div className="module-grid module-grid-4">
        <Metric label="Route distance" value={`${(analysis.distance_m / 1000).toFixed(2)} km`} sub={`${analysis.sample_count} spatial sample points`} icon={RouteIcon} provenance={<Provenance kind="Estimated" source="OSRM geometry"/>}/>
        <Metric label="Journey duration" value={`${(analysis.duration_seconds / 60).toFixed(1)} min`} sub="OSRM route-time estimate" icon={Activity} provenance={<Provenance kind="Estimated" source="OSRM"/>}/>
        <Metric label="CO₂ tailpipe" value={analysis.co2_tailpipe_estimate_g === null ? '—' : `${analysis.co2_tailpipe_estimate_g.toFixed(0)} g`} sub="Assumption-based, not measured" icon={Wind} provenance={<Provenance kind="Estimated" source="Default mode factor"/>}/>
        <Metric label="Departure suggestion" value={bestDeparture ? formatBengaluruTime(bestDeparture.departure_at) : 'Unavailable'} sub={bestDeparture ? `${bestDeparture.wait_minutes} min wait · ${bestDeparture.journey_duration_minutes} min journey` : 'No valid time-constrained forecast'} icon={Sun} provenance={<Provenance kind="Forecast" source={`${analysis.departure_candidates.length} departure candidates`} time={analysis.analyzed_at}/>}/>
      </div>
      <div className="module-grid module-grid-3">
        <Metric label="Estimated route shade" value={analysis.route_shade_percentage === null ? 'Unavailable' : `${analysis.route_shade_percentage.toFixed(1)}%`} sub={`${analysis.shade_confidence} confidence · ${analysis.evaluated_shade_length_m.toFixed(0)} m evaluated`} icon={Leaf} provenance={<Provenance kind="Estimated" source="Length-weighted mapped shadow geometry"/>}/>
        <Metric label="Direct sun exposure" value={analysis.direct_sun_exposure_percentage === null ? 'Unavailable' : `${analysis.direct_sun_exposure_percentage.toFixed(1)}%`} sub="Evaluated route length only" icon={Sun} provenance={<Provenance kind="Estimated" source="Complement of estimated shade"/>}/>
        <Metric label="Solar position" value={`${analysis.solar_position.elevation_deg.toFixed(1)}° elevation`} sub={`Azimuth ${analysis.solar_position.azimuth_deg.toFixed(1)}° · sunrise ${analysis.solar_daylight.sunrise ? formatBengaluruTime(analysis.solar_daylight.sunrise) : 'Unavailable'} · sunset ${analysis.solar_daylight.sunset ? formatBengaluruTime(analysis.solar_daylight.sunset) : 'Unavailable'}`} icon={Compass} provenance={<Provenance kind="Estimated" source="Astral solar position"/>}/>
      </div>
      {solarSnapshots.length > 1 && <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">SAME ROUTE · DIFFERENT SUN POSITION</span><h3>Time-of-day shadow comparison</h3></div><span>ESTIMATED</span></div><div className="solar-comparison-grid">{solarSnapshots.map((snapshot) => <article key={snapshot.label}><strong>{snapshot.label} · {formatBengaluruTime(snapshot.departureAt)}</strong><span>Shade {snapshot.shade === null ? 'Unavailable' : `${snapshot.shade.toFixed(1)}%`}</span><span>Direct sun {snapshot.sunlight === null ? 'Unavailable' : `${snapshot.sunlight.toFixed(1)}%`}</span><span>Solar elevation {snapshot.elevation.toFixed(1)}°</span><span>Exposure {snapshot.exposure === null ? 'Unavailable' : snapshot.exposure.toFixed(1)}</span></article>)}</div></section>}
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">SMART ROUTE DECISION ENGINE</span><h3>Compare returned route alternatives</h3><p>Scores are normalized within this provider response. A dominated route is no better on the metrics available for the pair and worse on at least one.</p></div><span>{analysis.route_comparison.length} candidates</span></div>
        {analysis.route_recommendation && <div className="departure-explanation">Recommended: Route {analysis.route_comparison.find((route) => route.route_id === analysis.route_recommendation?.route_id)?.rank ?? '—'} ({analysis.route_recommendation.route_id}). {analysis.route_recommendation.reason}</div>}
        <div className="route-sample-table"><div className="route-comparison-row route-comparison-head"><span>Route / rank</span><span>Time</span><span>Distance</span><span>Heat</span><span>Shade</span><span>AQI</span><span>Turns</span><span>Decision</span></div>
          {analysis.route_comparison.map((route) => <div className="route-comparison-row" key={route.route_id}><span>{route.route_id}<small>Rank {route.rank} · score {route.normalized_score?.toFixed(0) ?? '—'}</small></span><span>{(route.duration_seconds / 60).toFixed(1)} min</span><span>{(route.distance_m / 1000).toFixed(2)} km</span><span>{route.route_exposure_score?.toFixed(1) ?? 'Unavailable'}</span><span>{route.route_shade_percentage === null ? 'Unavailable' : `${route.route_shade_percentage.toFixed(0)}%`}</span><span>{route.mean_us_aqi?.toFixed(0) ?? 'Unavailable'}</span><span>{route.turn_count}</span><span>{route.pareto_dominated ? 'Dominated' : 'Not dominated'}</span></div>)}
        </div>
        <p className="module-footnote">Route comparison covers only the alternatives returned by the public routing provider, not every possible path through Bengaluru’s road network. Missing metrics are displayed as unavailable and excluded from pairwise dominance checks.</p>
      </section>
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">GROUNDED EXPLANATION</span><h3>What influenced this result?</h3></div><Provenance kind="Estimated" source="Template generated from computed samples"/></div>
        <p className="module-footnote">This explanation is generated from the analysis response only; it does not introduce independent measurements or new numeric claims.</p>
        <ul className="limitation-list">
          <li>{meanApparentTemperature !== null ? `The average apparent temperature across samples with a forecast value is ${meanApparentTemperature.toFixed(1)}°C.` : 'Apparent-temperature forecasts were unavailable for the sampled route.'}</li>
          <li>{meanAqi !== null ? `The average US AQI across samples with an air-quality forecast is ${meanAqi.toFixed(0)}.` : 'Air-quality values were unavailable, so the AQI component was excluded.'}</li>
          <li>{shadeCandidates} of ${analysis.sample_count} sampled points had a mapped feature suggesting possible shade; ${shadeUnknown} points had insufficient mapped evidence. This is not a route-wide shade percentage.</li>
          <li>Mapped building height coverage: {analysis.building_counts.tagged_height} tagged heights and {analysis.building_counts.levels_estimated_height} level-based estimates among {analysis.building_counts.mapped} buildings; {analysis.building_counts.unknown_height} have unknown height. Tree canopy geometry is usable for {analysis.tree_counts.with_height_and_canopy} of {analysis.tree_counts.mapped} mapped tree features. Green-cover polygons found: {analysis.green_cover_feature_count ?? 'Unavailable'}.</li>
          <li>{waterloggingWatches > 0 ? `${waterloggingWatches} sample points are flagged for a waterlogging watch estimate because precipitation probability and a mapped tunnel/ford coincide.` : 'No sampled point met the prototype waterlogging-watch rule; this does not prove that flooding is impossible.'}</li>
        </ul>
      </section>
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">BEST TIME TO TRAVEL</span><h3>Departure windows · {analysis.search_window_hours} hours</h3><p>Thirty-minute candidate steps. Waiting time is separate from route duration; OSRM journey duration is held constant across departures.</p></div>{bestDeparture && <span className="status-indicator"><i/> Lowest valid exposure within limit</span>}</div>
        <div className="departure-chart">{analysis.departure_candidates.map((candidate) => <div className={`departure-column ${bestDeparture?.departure_at === candidate.departure_at ? 'best' : ''}`} key={candidate.departure_at}><span>{candidate.exposure_score?.toFixed(0) ?? '—'}</span><i style={{ height: candidate.exposure_score === null ? '4px' : `${Math.max(6, (candidate.exposure_score / maxDepartureScore) * 120)}px` }}/><small>{formatBengaluruTime(candidate.departure_at)}</small></div>)}</div>
        {bestDeparture && <div className="departure-explanation"><strong>Recommended departure {formatBengaluruTime(bestDeparture.departure_at)} · arrival {bestDeparture.expected_arrival_at ? formatBengaluruTime(bestDeparture.expected_arrival_at) : 'Unavailable'}</strong><br/>Wait {bestDeparture.wait_minutes} min from now · journey {bestDeparture.journey_duration_minutes} min · extra journey time {bestDeparture.extra_travel_time_minutes} min · exposure {bestDeparture.exposure_score?.toFixed(1) ?? 'Unavailable'} / 100. {departureReduction !== null && departureReduction > 0.1 ? `This is ${departureReduction.toFixed(1)} index points below the best valid option for leaving immediately.` : 'No lower-index improvement over the best valid option for leaving immediately was established.'}</div>}
        {!bestDeparture && <div className="inline-error">{analysis.departure_message ?? 'No suitable departure time found within your selected time limit.'} Increase the extra-time allowance or extend the search window above; no recommendation is forced when forecast inputs are unavailable.</div>}
        {!bestDeparture && analysis.closest_alternatives.length > 0 && <div className="civic-report-list">{analysis.closest_alternatives.map((alternative) => <article className="civic-report" key={`${alternative.departure_at}-${alternative.route_id}`}><div><strong>{formatBengaluruTime(alternative.departure_at)} · {alternative.route_id}</strong><small>{alternative.extra_travel_time_minutes} min extra journey · exposure {alternative.exposure_score?.toFixed(1) ?? 'Unavailable'} · {alternative.journey_duration_minutes} min journey</small></div></article>)}</div>}
        <p className="module-footnote">Departure candidates are evaluated only within the returned forecast horizon. A recommendation is made only when exposure is valid and additional journey time is within the configured maximum ({analysis.max_extra_time_minutes} min).</p>
      </section>
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">ROUTE-WIDE SAMPLES</span><h3>What conditions are expected along the way?</h3></div><span>{analysis.samples.length} samples</span></div>
        <div className="route-sample-table"><div className="route-sample-row route-sample-head"><span>Arrive / elapsed</span><span>Temp / feels</span><span>UV</span><span>AQI</span><span>PM2.5</span><span>Shade</span><span>Exposure</span><span>Other risk</span></div>
          {analysis.samples.map((sample) => <div className="route-sample-row" key={sample.sample_index}><span>{formatBengaluruTime(sample.predicted_arrival_at)}<small>{sample.elapsed_minutes.toFixed(1)} min · {sample.forecast_time.weather ?? 'weather unavailable'}</small></span><span>{sample.temperature_c?.toFixed(1) ?? 'Unavailable'}° / {sample.apparent_temperature_c?.toFixed(1) ?? 'Unavailable'}°</span><span>{sample.uv_index?.toFixed(1) ?? 'Unavailable'}</span><span>{sample.us_aqi !== null ? Math.round(sample.us_aqi) : 'Unavailable'}</span><span>{sample.pm2_5?.toFixed(1) ?? 'Unavailable'}</span><span>{sample.segment_shade_percentage === null ? 'Unavailable' : `${sample.segment_shade_percentage.toFixed(0)}%`}<small>{sample.shade_source.replace(/_/g, ' ')}</small></span><span>{sample.route_exposure_score?.toFixed(1) ?? 'Unavailable'}<small>{sample.segment_duration_seconds.toFixed(0)} sec segment</small></span><span>{sample.waterlogging_risk.replace(/_/g, ' ')}</span></div>)}
        </div>
      </section>
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">DATA PROVENANCE</span><h3>External source status</h3></div></div><div className="integration-list"><div><span>Open-Meteo hourly weather</span><b>{analysis.data_status.weather}</b></div><div><span>Open-Meteo / CAMS air quality</span><b>{analysis.data_status.air_quality}</b></div><div><span>OpenStreetMap shade features</span><b>{analysis.data_status.osm_shade}</b></div></div><ul className="limitation-list">{analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section>
    </>}
  </section>;
}

interface ForecastRow { time: string; temperature_2m?: number; apparent_temperature?: number; uv_index?: number; precipitation_probability?: number; precipitation?: number; wind_speed_10m?: number; us_aqi?: number; pm2_5?: number; }
interface HourlyResponse { hourly?: Record<string, Array<string | number>>; }

export function SimulationModule() {
  const [latitude, setLatitude] = useState(String(BENGALURU.latitude));
  const [longitude, setLongitude] = useState(String(BENGALURU.longitude));
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const coordinateQuery = `latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`;
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?${coordinateQuery}&hourly=temperature_2m,apparent_temperature,uv_index,precipitation_probability,precipitation,wind_speed_10m&forecast_days=2&timezone=Asia%2FKolkata`;
      const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinateQuery}&hourly=us_aqi,pm2_5&forecast_days=2&timezone=Asia%2FKolkata`;
      const [weatherResponse, airResponse] = await Promise.all([fetch(weatherUrl), fetch(airUrl)]);
      if (!weatherResponse.ok || !airResponse.ok) throw new Error(`Forecast service unavailable (weather ${weatherResponse.status}, air ${airResponse.status}).`);
      const weather = await weatherResponse.json() as HourlyResponse; const air = await airResponse.json() as HourlyResponse;
      const w = weather.hourly ?? {}; const a = air.hourly ?? {};
      const times = (w.time ?? []) as string[];
      const now = Date.now(); const indices = times.map((time, index) => ({ time, index })).filter((item) => bengaluruDate(item.time).getTime() >= now).slice(0, 18);
      const make = (key: string, index: number) => { const value = w[key]?.[index]; return typeof value === 'number' ? value : undefined; };
      const makeAir = (key: string, index: number) => { const value = a[key]?.[index]; return typeof value === 'number' ? value : undefined; };
      const nextRows = indices.map(({ time, index }) => ({ time, temperature_2m: make('temperature_2m', index), apparent_temperature: make('apparent_temperature', index), uv_index: make('uv_index', index), precipitation_probability: make('precipitation_probability', index), precipitation: make('precipitation', index), wind_speed_10m: make('wind_speed_10m', index), us_aqi: makeAir('us_aqi', index), pm2_5: makeAir('pm2_5', index) }));
      if (!nextRows.length) throw new Error('No future hourly forecast was returned.');
      setRows(nextRows); setSelected(0);
    } catch (reason) { setRows([]); setError(reason instanceof Error ? reason.message : 'Could not load forecast.'); }
    finally { setBusy(false); }
  }, [latitude, longitude]);
  useEffect(() => { void load(); }, []);
  const active = rows[selected];
  const maxTemp = Math.max(1, ...rows.map((row) => row.temperature_2m ?? 0));
  return <section className="module-page">
    <ModuleHeading eyebrow="FORECAST SIMULATOR" title="Explore the next hours" description="Move the time cursor to inspect hourly weather and air-quality forecasts for one selected coordinate. The chart is model forecast data, not a simulation of measured city conditions." />
    <form className="module-search-form" onSubmit={(event) => { event.preventDefault(); void load(); }}><label>Latitude<input type="number" min="-90" max="90" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)}/></label><label>Longitude<input type="number" min="-180" max="180" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)}/></label><button className="primary-button" disabled={busy}>{busy ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>} Load forecast</button></form>
    {busy && <div className="module-loading"><Loader2 className="spin"/> Loading hourly model forecasts…</div>}{error && <div className="inline-error"><AlertTriangle size={16}/>{error}<button onClick={() => void load()}>Retry</button></div>}
    {active && <><div className="forecast-selected"><div><span className="eyebrow">SELECTED FORECAST HOUR</span><h3>{bengaluruDate(active.time).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</h3></div><Provenance kind="Forecast" source="Open-Meteo weather + CAMS air quality" time={active.time}/></div>
      <div className="module-grid module-grid-4">      <Metric label="Temperature" value={`${active.temperature_2m?.toFixed(1) ?? '—'}°C`} sub={`Feels ${active.apparent_temperature?.toFixed(1) ?? '—'}°C`} icon={ThermometerSun} provenance={<Provenance kind="Forecast" source="Open-Meteo"/>}/><Metric label="UV index" value={active.uv_index?.toFixed(1) ?? '—'} sub="Hourly UV forecast" icon={Sun} provenance={<Provenance kind="Forecast" source="Open-Meteo"/>}/><Metric label="Rain probability" value={active.precipitation_probability === undefined ? 'Unavailable' : `${Math.round(active.precipitation_probability)}%`} sub={`${active.precipitation?.toFixed(1) ?? '—'} mm hourly rain`} icon={CloudRain} provenance={<Provenance kind="Forecast" source="Open-Meteo"/>}/><Metric label="US AQI" value={active.us_aqi !== undefined ? String(Math.round(active.us_aqi)) : '—'} sub={active.pm2_5 !== undefined ? `PM2.5 ${active.pm2_5.toFixed(1)} µg/m³` : 'AQI unavailable'} icon={Wind} provenance={<Provenance kind="Forecast" source="CAMS / Open-Meteo"/>}/></div>
      <section className="module-panel"><div className="module-panel-heading"><div><span className="eyebrow">HOURLY TEMPERATURE</span><h3>Choose a forecast hour</h3></div><span>{rows.length} forecast points</span></div><div className="forecast-chart">{rows.map((row, index) => <button type="button" key={row.time} className={`forecast-bar ${selected === index ? 'active' : ''}`} onClick={() => setSelected(index)} title={`${bengaluruDate(row.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}: ${row.temperature_2m ?? 'Unavailable'}°C`}><span className="forecast-bar-value">{row.temperature_2m?.toFixed(0) ?? '—'}°</span><i style={{ height: `${Math.max(8, ((row.temperature_2m ?? 0) / maxTemp) * 135)}px` }}/><small>{bengaluruDate(row.time).toLocaleTimeString('en-IN', { hour: '2-digit', timeZone: 'Asia/Kolkata' })}</small></button>)}</div><input className="forecast-range" type="range" min="0" max={rows.length - 1} value={selected} onChange={(event) => setSelected(Number(event.target.value))}/></section>
    </>}
    <p className="module-footnote">Forecasts are grid-cell model outputs. They do not represent exact street-level measurements. Attribution: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> and CAMS.</p>
  </section>;
}

export function CityPlannerModule() {
  const [reports, setReports] = useState<CivicReport[]>([]);
  const [currentPosition, setCurrentPosition] = useState<LivePosition | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { fetch(`${API_BASE}/api/civic/reports?limit=100`).then(async (response) => { if (!response.ok) throw new Error(`Civic API ${response.status}`); return await response.json() as { reports?: CivicReport[] }; }).then((body) => setReports(body.reports ?? [])).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Civic reports are unavailable.')); }, []);
  const markers: TrafficControl[] = reports.map((report) => ({ id: `civic-${report.id}`, kind: 'traffic-sign', label: civicLabels[report.category] ?? report.category, detail: `${report.status} · ${report.note || 'Community submission; not scientifically measured'}`, latitude: report.latitude, longitude: report.longitude }));
  const center = () => { if (!navigator.geolocation) { setError('Geolocation is not supported.'); return; } navigator.geolocation.getCurrentPosition((position) => setCurrentPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }), (reason) => setError(reason.message), { enableHighAccuracy: true, timeout: 12000 }); };
  return <section className="module-page">
    <ModuleHeading eyebrow="GEOSPATIAL CITY PLANNER" title="Explore the mapped city" description="This map uses real map tiles and available OpenStreetMap building geometry. Civic pins are community reports from your local database; heat and shade overlays are not inferred without their required data." action={<button className="subtle-button" onClick={center}><LocateFixedFallback/> Center on me</button>} />
    <div className="city-planner-map"><RealRouteMap routes={[]} selectedRouteId={null} origin={null} destination={null} currentPosition={currentPosition} trafficControls={markers} onSelectRoute={() => undefined} onCenterCurrent={center}/></div>
    <div className="module-grid module-grid-3"><Metric label="Mapped civic reports" value={String(reports.length)} sub="Stored observations" icon={MapPin} provenance={<Provenance kind="Live" source="Local SQLite citizen submissions"/>}/><Metric label="3D buildings" value="Map coverage" sub="OSM footprints + available heights" icon={Building2} provenance={<Provenance kind="Estimated" source="OpenFreeMap / OSM"/>}/><Metric label="Heat / shade layers" value="Not computed" sub="Awaiting route-wide model" icon={ThermometerSun} provenance={<Provenance kind="Demo" source="No geospatial heat layer"/>}/></div>
    {error && <div className="inline-warning"><AlertTriangle size={15}/>{error} · The basemap can still be explored without civic pins.</div>}
    <div className="module-footnote">Map data: OpenFreeMap and OpenStreetMap contributors. Building coverage, height tags and civic report density vary by area. Use the Civic module to submit observations.</div>
  </section>;
}
