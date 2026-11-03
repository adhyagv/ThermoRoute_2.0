import { useState } from 'react';
import { Search, Sun, Moon, Settings2 } from 'lucide-react';
import appVersion from '../../../VERSION.json';

export type WorkspacePage = 'Overview' | 'Navigation' | 'Environment' | 'Mobility' | 'Civic' | 'AI Insights' | 'Simulation' | 'City Planner';

interface HeaderProps {
  activePage: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  lightMode: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

const pages: WorkspacePage[] = ['Overview', 'Navigation', 'Environment', 'Mobility', 'Civic', 'AI Insights', 'Simulation', 'City Planner'];

export function Header({ activePage, onNavigate, lightMode, onToggleTheme, onOpenSettings }: HeaderProps) {
  const [query, setQuery] = useState('');
  const submitSearch = () => {
    const normalized = query.trim().toLowerCase();
    const match = pages.find((page) => page.toLowerCase().includes(normalized));
    if (match) onNavigate(match);
    else if (normalized) onNavigate('Navigation');
    setQuery('');
  };

  return (
    <header className="topbar">
      <div>
        <div className="breadcrumb">CITY INTELLIGENCE / {activePage.toUpperCase()}</div>
        <h1>{activePage}</h1>
      </div>
      <div className="top-actions">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
          <Search size={15} aria-hidden="true" />
          <input aria-label="Search workspace" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules..." />
          <kbd>Enter</kbd>
        </form>
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={lightMode ? 'Switch to dark theme' : 'Switch to light theme'} title="Toggle theme">
          {lightMode ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <button className="icon-button" type="button" onClick={onOpenSettings} aria-label="Open settings" title="Settings"><Settings2 size={16} /></button>
        <div className="profile" title={`ThermoRoute ${appVersion.version}`}>AG</div>
      </div>
    </header>
  );
}
