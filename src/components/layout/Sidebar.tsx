import appVersion from '../../../VERSION.json';
import type { WorkspacePage } from './Header';

const menu: Array<{ icon: string; label: WorkspacePage }> = [
  { icon: '⌂', label: 'Overview' },
  { icon: '➤', label: 'Navigation' },
  { icon: '◉', label: 'Environment' },
  { icon: '♧', label: 'Mobility' },
  { icon: '▣', label: 'Civic' },
  { icon: '✦', label: 'AI Insights' },
  { icon: '◌', label: 'Simulation' },
  { icon: '⌘', label: 'City Planner' },
];

interface SidebarProps {
  activePage: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div><div className="brand-name">ThermoRoute</div><div className="brand-version">INTELLIGENCE {appVersion.version}</div></div>
      </div>
      <div className="section-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {menu.map((item) => (
          <button key={item.label} className={`nav-item ${activePage === item.label ? 'active' : ''}`} onClick={() => onNavigate(item.label)} type="button" aria-current={activePage === item.label ? 'page' : undefined}>
            <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
            {item.label === 'AI Insights' && <span className="ai-dot">RULES</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="system-card">
          <div className="system-header"><span className="status-dot" />DATA HONESTY MODE</div>
          <div className="system-text">Numbers are labelled as live, forecast, estimated, fallback or demo.</div>
        </div>
        <div className="settings static-settings">ThermoRoute {appVersion.version}</div>
      </div>
    </aside>
  );
}
