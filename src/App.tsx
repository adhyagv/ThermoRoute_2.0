import { useState } from 'react';
import { X } from 'lucide-react';
import appVersion from '../VERSION.json';
import { Header, type WorkspacePage } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import RoutePlanner from './components/navigation/RoutePlanner';
import {
  CityPlannerModule,
  CivicModule,
  EnvironmentModule,
  InsightsModule,
  MobilityModule,
  OverviewModule,
  SimulationModule,
} from './components/modules/WorkspaceModules';
import type { ThermalJourneySeed } from './types/navigation';

function SettingsDialog({ onClose }: { onClose: () => void }) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-dialog-heading"><div><span className="eyebrow">PROJECT SETTINGS</span><h2 id="settings-title">ThermoRoute {appVersion.version}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={16}/></button></div>
      <div className="settings-detail"><strong>Default city</strong><span>Bengaluru, Karnataka, India</span></div>
      <div className="settings-detail"><strong>Data handling</strong><span>Live, forecast, estimated, fallback and demo values are identified separately.</span></div>
      <div className="settings-detail"><strong>External services</strong><span>OpenStreetMap / OSRM, Nominatim, OpenFreeMap, Open-Meteo and optional FortyGuard.</span></div>
      <div className="settings-detail"><strong>Privacy</strong><span>GPS is requested only after you choose a location-related action. Civic reports are stored in the local backend SQLite database.</span></div>
      <p className="module-footnote">Public map and weather services have usage policies and availability limits. This is a research prototype, not an emergency-navigation or medical device.</p>
      <button className="primary-button" onClick={onClose}>Done</button>
    </section>
  </div>;
}

function App() {
  const [active, setActive] = useState<WorkspacePage>('Overview');
  const [time, setTime] = useState(12);
  const [lightMode, setLightMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thermalJourney, setThermalJourney] = useState<ThermalJourneySeed | null>(null);

  return (
    <div className={`app-shell ${lightMode ? 'theme-light' : ''}`}>
      <Sidebar activePage={active} onNavigate={setActive}/>
      <main className="main-content">
        <Header activePage={active} onNavigate={setActive} lightMode={lightMode} onToggleTheme={() => setLightMode((value) => !value)} onOpenSettings={() => setSettingsOpen(true)}/>
        {active === 'Overview' && <OverviewModule onNavigate={(page) => setActive(page as WorkspacePage)} time={time} setTime={setTime}/>}
        {active === 'Navigation' && <RoutePlanner onExploreThermalJourney={(journey) => { setThermalJourney(journey); setActive('AI Insights'); }}/>}
        {active === 'Environment' && <EnvironmentModule/>}
        {active === 'Mobility' && <MobilityModule/>}
        {active === 'Civic' && <CivicModule/>}
        {active === 'AI Insights' && <InsightsModule initialJourney={thermalJourney}/>}
        {active === 'Simulation' && <SimulationModule/>}
        {active === 'City Planner' && <CityPlannerModule/>}
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}/>}
    </div>
  );
}

export default App;
