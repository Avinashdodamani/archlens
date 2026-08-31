import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ServerStackIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

/**
 * Command Palette (Cmd+K / Ctrl+K) — SOW Section 4.2 "Search & Filter":
 * quick jump to any screen, resource, or past scan by typing.
 */

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  group: 'Navigate' | 'Resources' | 'Scans';
  action: () => void;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { scanResult, savedScans, loadScan } = useAppStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Global hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: 'nav-dashboard', label: 'Dashboard', sublabel: 'Overview and health', group: 'Navigate', action: () => navigate('/') },
      { id: 'nav-yourarch', label: 'Architecture Discovery', sublabel: 'Scan and visualize your account', group: 'Navigate', action: () => navigate('/your-arch') },
      { id: 'nav-redefine', label: 'AI Optimization', sublabel: 'Well-Architected analysis', group: 'Navigate', action: () => navigate('/redefine') },
      { id: 'nav-auto', label: 'Auto Remediation', sublabel: 'Backup, deploy, and roll back', group: 'Navigate', action: () => navigate('/auto-remediate') },
      { id: 'nav-insights', label: 'Insights and Reports', sublabel: 'History, drift, and analytics', group: 'Navigate', action: () => navigate('/insights') },
    ];

    // Resources from the current scan
    for (const r of scanResult?.resources || []) {
      items.push({
        id: `res-${r.id}`,
        label: r.name || r.id,
        sublabel: `${r.type}${r.region ? ' · ' + r.region : ''}`,
        group: 'Resources',
        action: () => navigate('/your-arch'),
      });
    }

    // Past scans
    for (const s of savedScans) {
      items.push({
        id: `scan-${s.scanNumber}`,
        label: `Scan #${s.scanNumber} — ${s.accountName}`,
        sublabel: `${s.region} · ${s.resourceCount} resources`,
        group: 'Scans',
        action: () => { loadScan(s.scanNumber); navigate('/your-arch'); },
      });
    }
    return items;
  }, [scanResult, savedScans, navigate, loadScan]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 30);
    return allItems
      .filter((i) => i.label.toLowerCase().includes(q) || (i.sublabel || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [query, allItems]);

  function run(item: CommandItem) {
    item.action();
    setOpen(false);
  }

  if (!open) return null;

  const groupIcon = (g: CommandItem['group']) =>
    g === 'Navigate' ? <Squares2X2Icon className="w-4 h-4" />
    : g === 'Resources' ? <ServerStackIcon className="w-4 h-4" />
    : <ClockIcon className="w-4 h-4" />;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-700">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && filtered[activeIndex]) run(filtered[activeIndex]);
            }}
            placeholder="Jump to a screen, resource, or scan…"
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
          <kbd className="text-[10px] text-gray-500 bg-dark-900 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No matches</p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => run(item)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  idx === activeIndex ? 'bg-primary-500/15' : 'hover:bg-dark-700/50'
                }`}
              >
                <span className="text-gray-500">{groupIcon(item.group)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-gray-200 truncate">{item.label}</span>
                  {item.sublabel && <span className="block text-[11px] text-gray-500 truncate">{item.sublabel}</span>}
                </span>
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">{item.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
