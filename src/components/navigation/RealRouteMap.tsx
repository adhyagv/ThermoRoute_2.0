import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Building2, Compass, LocateFixed, Map as MapIcon, AlertTriangle } from 'lucide-react';
import type { LivePosition, Place, RealRoute, TrafficControl } from '../../types/navigation';

setWorkerUrl(workerUrl);

const ROUTE_SOURCE_ID = 'thermoroute-live-routes';
const REPLAY_SOURCE_ID = 'thermoroute-replay-segment';
const SHADE_SOURCE_ID = 'thermoroute-route-shade';
const SHADOW_SOURCE_ID = 'thermoroute-building-shadows';
const BUILDINGS_LAYER_ID = 'thermoroute-3d-buildings';
const DEFAULT_CENTER: [number, number] = [77.5946, 12.9716];

interface RealRouteMapProps {
  routes: RealRoute[];
  selectedRouteId: string | null;
  origin: Place | null;
  destination: Place | null;
  currentPosition: LivePosition | null;
  replayPosition?: [number, number] | null;
  activeSegment?: Array<[number, number]> | null;
  shadeSegments?: Array<{ start: [number, number]; end: [number, number]; shadePercentage: number | null }>;
  shadowPolygons?: Array<Array<[number, number]>>;
  trafficControls: TrafficControl[];
  onSelectRoute: (routeId: string) => void;
  onCenterCurrent: () => void;
}

function makeEndpointElement(kind: 'start' | 'end') {
  const element = document.createElement('div');
  element.className = `thermo-3d-endpoint thermo-3d-endpoint-${kind}`;
  const pin = document.createElement('span');
  pin.className = 'thermo-3d-endpoint-pin';
  const letter = document.createElement('span');
  letter.textContent = kind === 'start' ? 'A' : 'B';
  pin.append(letter);
  const label = document.createElement('span');
  label.className = 'thermo-3d-endpoint-label';
  label.textContent = kind === 'start' ? 'START' : 'DESTINATION';
  element.append(pin, label);
  return element;
}

function makeCurrentLocationElement() {
  const element = document.createElement('div');
  element.className = 'thermo-3d-current-location';
  element.title = 'Your current GPS position';
  element.setAttribute('aria-label', 'Your current GPS position');
  const pulse = document.createElement('span');
  pulse.className = 'thermo-3d-current-pulse';
  const dot = document.createElement('span');
  dot.className = 'thermo-3d-current-dot';
  element.append(pulse, dot);
  return element;
}

function makeReplayPositionElement() {
  const element = document.createElement('div');
  element.className = 'thermo-replay-marker';
  element.setAttribute('aria-label', 'Thermal journey position');
  return element;
}


function trafficControlIcon(kind: TrafficControl['kind']): string {
  switch (kind) {
    case 'traffic-signal': return '🚦';
    case 'stop': return '🛑';
    case 'give-way': return '🔻';
    case 'crossing': return '🚸';
    case 'speed-camera': return '📷';
    case 'level-crossing': return '🚆';
    default: return '⚠';
  }
}

function makeTrafficControlElement(control: TrafficControl): HTMLDivElement {
  const element = document.createElement('div');
  element.className = `traffic-control-marker traffic-control-marker-${control.kind}`;
  element.textContent = trafficControlIcon(control.kind);
  element.title = `${control.label}: ${control.detail}`;
  element.setAttribute('aria-label', element.title);
  return element;
}

function routeFeatureCollection(routes: RealRoute[], selectedRouteId: string | null) {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.geometry.length >= 2)
      .map((route) => ({
        type: 'Feature' as const,
        properties: {
          routeId: route.id,
          selected: route.id === selectedRouteId,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.geometry.map(([latitude, longitude]) => [longitude, latitude]),
        },
      })),
  };
}

function add3DBuildings(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? [];
  const existingExtrusion = layers.some((layer) => layer.id === BUILDINGS_LAYER_ID);
  if (existingExtrusion) return;

  // Reuse the vector source that the OpenFreeMap style already loaded.
  const buildingStyleLayer = layers.find((layer) =>
    'source' in layer && 'source-layer' in layer && layer['source-layer'] === 'building'
  );
  let buildingSourceId: string | undefined = buildingStyleLayer && 'source' in buildingStyleLayer
    ? buildingStyleLayer.source
    : undefined;

  // A fallback source is useful if the selected style has no building layer of its own.
  if (!buildingSourceId || !map.getSource(buildingSourceId)) {
    buildingSourceId = 'thermoroute-openfreemap-buildings';
    if (!map.getSource(buildingSourceId)) {
      map.addSource(buildingSourceId, {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      });
    }
  }

  const firstSymbolLayer = layers.find((layer) => layer.type === 'symbol')?.id;
  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    source: buildingSourceId,
    'source-layer': 'building',
    type: 'fill-extrusion',
    minzoom: 13,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': [
        'interpolate', ['linear'],
        ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
        0, '#284c49',
        18, '#38665e',
        55, '#568879',
        120, '#82b9a1',
      ],
      'fill-extrusion-height': [
        'interpolate', ['linear'], ['zoom'],
        13, 0,
        15.2, ['coalesce', ['get', 'render_height'], ['get', 'height'], 9],
      ],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  }, firstSymbolLayer);
}

function addReplayLayer(map: MapLibreMap) {
  if (!map.getSource(SHADOW_SOURCE_ID)) {
    map.addSource(SHADOW_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('thermoroute-building-shadow-fill')) {
    map.addLayer({
      id: 'thermoroute-building-shadow-fill',
      type: 'fill',
      source: SHADOW_SOURCE_ID,
      paint: {
        'fill-color': '#23333a',
        'fill-opacity': 0.42,
        'fill-outline-color': '#d49b5b',
      },
    });
  }
  if (!map.getSource(SHADE_SOURCE_ID)) {
    map.addSource(SHADE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('thermoroute-route-shade-line')) {
    map.addLayer({
      id: 'thermoroute-route-shade-line',
      type: 'line',
      source: SHADE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'shade'], null], '#9aa59f', ['>=', ['get', 'shade'], 50], '#39d98a', '#ff9e59'],
        'line-width': 7,
        'line-opacity': 0.9,
      },
    });
  }
  if (!map.getSource(REPLAY_SOURCE_ID)) {
    map.addSource(REPLAY_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('thermoroute-replay-segment-line')) {
    map.addLayer({
      id: 'thermoroute-replay-segment-line',
      type: 'line',
      source: REPLAY_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffbd69', 'line-width': 8, 'line-opacity': 0.95 },
    });
  }
}

function addRouteLayers(map: MapLibreMap, onSelectRoute: (routeId: string) => void) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      lineMetrics: true,
    });
  }

  if (!map.getLayer('thermoroute-route-alternatives')) {
    map.addLayer({
      id: 'thermoroute-route-alternatives',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['!=', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#93a9a0',
        'line-width': 4,
        'line-opacity': 0.62,
        'line-dasharray': [2, 1.8],
      },
    });
  }

  if (!map.getLayer('thermoroute-route-glow')) {
    map.addLayer({
      id: 'thermoroute-route-glow',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#43f5a5',
        'line-width': 15,
        'line-blur': 7,
        'line-opacity': 0.34,
      },
    });
  }

  if (!map.getLayer('thermoroute-route-casing')) {
    map.addLayer({
      id: 'thermoroute-route-casing',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#073d2e', 'line-width': 9, 'line-opacity': 0.98 },
    });
  }

  if (!map.getLayer('thermoroute-route-selected')) {
    map.addLayer({
      id: 'thermoroute-route-selected',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#70ffb5', 'line-width': 5, 'line-opacity': 1 },
    });
  }

  const handleRouteClick = (event: maplibregl.MapLayerMouseEvent) => {
    const routeId = event.features?.[0]?.properties?.routeId;
    if (typeof routeId === 'string') onSelectRoute(routeId);
  };
  // The layer listeners are installed once when the route layers are first created.
  map.on('click', 'thermoroute-route-alternatives', handleRouteClick);
  map.on('click', 'thermoroute-route-selected', handleRouteClick);
  map.on('mouseenter', 'thermoroute-route-alternatives', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'thermoroute-route-alternatives', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'thermoroute-route-selected', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'thermoroute-route-selected', () => { map.getCanvas().style.cursor = ''; });
}

export default function RealRouteMap({
  routes,
  selectedRouteId,
  origin,
  destination,
  currentPosition,
  replayPosition = null,
  activeSegment = null,
  shadeSegments = [],
  shadowPolygons = [],
  trafficControls,
  onSelectRoute,
  onCenterCurrent,
}: RealRouteMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const endpointMarkersRef = useRef<Marker[]>([]);
  const currentMarkerRef = useRef<Marker | null>(null);
  const replayMarkerRef = useRef<Marker | null>(null);
  const trafficMarkersRef = useRef<Marker[]>([]);
  const latestPropsRef = useRef<RealRouteMapProps>({ routes, selectedRouteId, origin, destination, currentPosition, replayPosition, activeSegment, shadeSegments, shadowPolygons, trafficControls, onSelectRoute, onCenterCurrent });
  const [mapReady, setMapReady] = useState(false);
  const [is3D, setIs3D] = useState(true);
  const [buildingsVisible, setBuildingsVisible] = useState(true);
  const [trafficSignsVisible, setTrafficSignsVisible] = useState(true);
  const [mapError, setMapError] = useState('');

  latestPropsRef.current = { routes, selectedRouteId, origin, destination, currentPosition, replayPosition, activeSegment, shadeSegments, shadowPolygons, trafficControls, onSelectRoute, onCenterCurrent };

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return undefined;
    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';
    const map = new MapLibreMap({
      container: mapElement.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: 13.4,
      pitch: 64,
      bearing: -20,
      maxPitch: 76,
      minZoom: 3,
      maxZoom: 19,
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');
    map.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      try {
        add3DBuildings(map);
        addRouteLayers(map, (routeId) => latestPropsRef.current.onSelectRoute(routeId));
        addReplayLayer(map);
        setMapError('');
        setMapReady(true);
      } catch (error) {
        setMapError(error instanceof Error ? error.message : 'The 3D map could not be initialized.');
      }
    });
    map.on('error', (event) => {
      // Tile 404s can occur outside coverage; keep the rest of the map usable.
      if (!map.isStyleLoaded() && event.error) {
        setMapError('The 3D map style is still loading. Check your internet connection and refresh if it remains blank.');
      }
    });

    return () => {
      endpointMarkersRef.current.forEach((marker) => marker.remove());
      endpointMarkersRef.current = [];
      trafficMarkersRef.current.forEach((marker) => marker.remove());
      trafficMarkersRef.current = [];
      currentMarkerRef.current?.remove();
      currentMarkerRef.current = null;
      replayMarkerRef.current?.remove();
      replayMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(routeFeatureCollection(routes, selectedRouteId));

    endpointMarkersRef.current.forEach((marker) => marker.remove());
    endpointMarkersRef.current = [];
    const bounds: Array<[number, number]> = [];

    if (origin) {
      endpointMarkersRef.current.push(new Marker({ element: makeEndpointElement('start'), anchor: 'bottom' })
        .setLngLat([origin.longitude, origin.latitude])
        .setPopup(new maplibregl.Popup({ offset: 26, closeButton: false }).setText(`Start · ${origin.label}`))
        .addTo(map));
      bounds.push([origin.longitude, origin.latitude]);
    }

    if (destination) {
      endpointMarkersRef.current.push(new Marker({ element: makeEndpointElement('end'), anchor: 'bottom' })
        .setLngLat([destination.longitude, destination.latitude])
        .setPopup(new maplibregl.Popup({ offset: 26, closeButton: false }).setText(`Destination · ${destination.label}`))
        .addTo(map));
      bounds.push([destination.longitude, destination.latitude]);
    }

    routes.forEach((route) => route.geometry.forEach(([latitude, longitude]) => bounds.push([longitude, latitude])));
    if (bounds.length > 1) {
      const southWest: [number, number] = [
        Math.min(...bounds.map((point) => point[0])),
        Math.min(...bounds.map((point) => point[1])),
      ];
      const northEast: [number, number] = [
        Math.max(...bounds.map((point) => point[0])),
        Math.max(...bounds.map((point) => point[1])),
      ];
      map.fitBounds(new maplibregl.LngLatBounds(southWest, northEast), {
        padding: { top: 74, right: 92, bottom: 74, left: 64 },
        maxZoom: 14.8,
        duration: 1100,
        pitch: is3D ? 64 : 0,
        bearing: is3D ? -20 : 0,
      });
    } else if (bounds.length === 1) {
      map.flyTo({ center: bounds[0], zoom: 15.2, pitch: is3D ? 64 : 0, bearing: is3D ? -20 : 0, duration: 900 });
    }
  }, [mapReady, routes, selectedRouteId, origin, destination, is3D]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    currentMarkerRef.current?.remove();
    currentMarkerRef.current = null;
    if (currentPosition) {
      currentMarkerRef.current = new Marker({ element: makeCurrentLocationElement(), anchor: 'center' })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setText(`Your location · ±${Math.round(currentPosition.accuracy)} m`))
        .addTo(map);
    }
  }, [mapReady, currentPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    replayMarkerRef.current?.remove();
    replayMarkerRef.current = null;
    if (replayPosition) {
      replayMarkerRef.current = new Marker({ element: makeReplayPositionElement(), anchor: 'center' })
        .setLngLat([replayPosition[1], replayPosition[0]])
        .setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setText('Predicted thermal journey position'))
        .addTo(map);
    }
  }, [mapReady, replayPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource(REPLAY_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: activeSegment && activeSegment.length >= 2 ? [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: activeSegment.map(([latitude, longitude]) => [longitude, latitude]),
        },
      }] : [],
    });
  }, [mapReady, activeSegment]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource(SHADE_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: shadeSegments.map((segment) => ({
        type: 'Feature',
        properties: { shade: segment.shadePercentage },
        geometry: {
          type: 'LineString',
          coordinates: [segment.start, segment.end].map(([latitude, longitude]) => [longitude, latitude]),
        },
      })),
    });
  }, [mapReady, shadeSegments]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource(SHADOW_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: shadowPolygons.map((polygon) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [polygon.map(([latitude, longitude]) => [longitude, latitude])],
        },
      })),
    });
  }, [mapReady, shadowPolygons]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    trafficMarkersRef.current.forEach((marker) => marker.remove());
    trafficMarkersRef.current = [];
    if (!trafficSignsVisible) return;
    trafficControls.forEach((control) => {
      const marker = new Marker({ element: makeTrafficControlElement(control), anchor: 'center' })
        .setLngLat([control.longitude, control.latitude])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(`${control.label} · ${control.detail} · OpenStreetMap mapped feature`))
        .addTo(map);
      trafficMarkersRef.current.push(marker);
    });
  }, [mapReady, trafficControls, trafficSignsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getLayer(BUILDINGS_LAYER_ID)) return;
    map.setLayoutProperty(BUILDINGS_LAYER_ID, 'visibility', buildingsVisible ? 'visible' : 'none');
  }, [mapReady, buildingsVisible]);

  const switchTo3D = () => {
    const map = mapRef.current;
    setIs3D(true);
    map?.easeTo({ pitch: 64, bearing: -20, duration: 850 });
  };

  const switchTo2D = () => {
    const map = mapRef.current;
    setIs3D(false);
    map?.easeTo({ pitch: 0, bearing: 0, duration: 850 });
  };

  const centerOnCurrent = () => {
    onCenterCurrent();
    if (currentPosition && mapRef.current) {
      mapRef.current.flyTo({ center: [currentPosition.longitude, currentPosition.latitude], zoom: 17, pitch: is3D ? 64 : 0, bearing: is3D ? -20 : 0, duration: 900 });
    }
  };

  const resetCamera = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: is3D ? 64 : 0, bearing: is3D ? -20 : 0, duration: 700 });
  };

  return (
    <div className="real-map-wrap real-map-wrap-3d">
      <div ref={mapElement} className="real-route-map real-route-map-3d" aria-label="Interactive 3D OpenStreetMap with extruded buildings and real route geometry" />
      <div className="map-live-tag map-live-tag-3d"><span className="map-live-dot" /> 3D CITY NAVIGATION <small>OPEN MAP DATA</small></div>
      <div className="map-3d-toolbox" aria-label="3D map controls">
        <div className="map-3d-mode-group">
          <button className={is3D ? 'map-3d-mode-active' : ''} onClick={switchTo3D} title="Tilt map and show 3D buildings"><Box size={13} /> 3D</button>
          <button className={!is3D ? 'map-3d-mode-active' : ''} onClick={switchTo2D} title="Switch to flat map"><MapIcon size={13} /> 2D</button>
        </div>
        <button className={buildingsVisible ? 'map-3d-tool-active' : ''} onClick={() => setBuildingsVisible((visible) => !visible)} title="Show or hide 3D buildings"><Building2 size={14} /><span>Buildings</span></button>
        <button className={trafficSignsVisible ? 'map-3d-tool-active' : ''} onClick={() => setTrafficSignsVisible((visible) => !visible)} title="Show or hide OpenStreetMap traffic controls"><AlertTriangle size={14} /><span>Signs {trafficControls.length ? `(${trafficControls.length})` : ''}</span></button>
        <button onClick={resetCamera} title="Reset camera angle"><Compass size={14} /><span>Reset angle</span></button>
        <button onClick={centerOnCurrent} title="Center on your current location"><LocateFixed size={14} /><span>My location</span></button>
      </div>
      <div className="map-3d-caption"><span className="map-live-dot" /> REAL ROAD ROUTE <b>•</b> 3D BUILDINGS <b>•</b> MAPPED SIGNS & SIGNALS <b>•</b> DRAG TO ORBIT</div>
      {mapError && <div className="map-3d-error" role="status">{mapError}</div>}
      <div className="map-attribution-note">Building heights depend on OpenStreetMap coverage. © OpenStreetMap · © OpenFreeMap</div>
    </div>
  );
}
