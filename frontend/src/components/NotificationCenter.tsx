import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  BellIcon,
  ShieldExclamationIcon,
  SparklesIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

/**
 * Notification Center (SOW Section 4.1) — alerts for security findings,
 * new recommendations, and scan/drift activity. Derived from real state.
 * Read/unread state is tracked per notification signature so the badge
 * reflects only unseen notifications and clears once viewed.
 */

const SEEN_KEY = 'archlens-seen-notifications';

interface Notice {
  id: string;
  sig: string; // content signature — changes when the underlying data changes
  icon: JSX.Element;
  title: string;
  detail: string;
  tone: 'danger' | 'warning' | 'info' | 'ai';
  onClick?: () => void;
}

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const { scanResult, analysisResult, savedScans } = useAppStore();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen());

  const notices = useMemo<Notice[]>(() => {
    const out: Notice[] = [];

    // Security findings from the current scan
    if (scanResult) {
      const resources = scanResult.resources || [];
      let publicFacing = 0;
      let openSg = 0;
      for (const r of resources) {
        const rr = r as Record<string, unknown>;
        if (rr.public_ip || rr.publicly_accessible === true) publicFacing++;
        if (r.type === 'SecurityGroup') {
          const inbound = (rr.inbound_rules as { IpRanges?: { CidrIp?: string }[] }[]) || [];
          if (inbound.some((rule) => (rule.IpRanges || []).some((ip) => ip.CidrIp === '0.0.0.0/0'))) openSg++;
        }
      }
      if (publicFacing > 0) {
        out.push({
          id: 'sec-public', sig: `sec-public:${publicFacing}`, tone: 'danger',
          icon: <ShieldExclamationIcon className="w-4 h-4" />,
          title: `${publicFacing} public-facing resource${publicFacing > 1 ? 's' : ''}`,
          detail: 'Review exposure in the security view.',
          onClick: () => navigate('/your-arch'),
        });
      }
      if (openSg > 0) {
        out.push({
          id: 'sec-sg', sig: `sec-sg:${openSg}`, tone: 'danger',
          icon: <ShieldExclamationIcon className="w-4 h-4" />,
          title: `${openSg} open security group${openSg > 1 ? 's' : ''}`,
          detail: 'Inbound access from 0.0.0.0/0 detected.',
          onClick: () => navigate('/your-arch'),
        });
      }
    }

    // New recommendations
    const recCount = analysisResult?.analysis?.recommendations?.length || 0;
    if (recCount > 0) {
      out.push({
        id: 'recs', sig: `recs:${analysisResult?.recommendationId || recCount}`, tone: 'ai',
        icon: <SparklesIcon className="w-4 h-4" />,
        title: `${recCount} optimization recommendation${recCount > 1 ? 's' : ''}`,
        detail: 'AI analysis is ready to review.',
        onClick: () => navigate('/redefine'),
      });
    }

    // Latest scan
    if (savedScans.length > 0) {
      const latest = [...savedScans].sort((a, b) => b.scanNumber - a.scanNumber)[0];
      out.push({
        id: 'scan', sig: `scan:${latest.scanNumber}`, tone: 'info',
        icon: <ArrowPathIcon className="w-4 h-4" />,
        title: `Scan ${latest.scanNumber} completed`,
        detail: `${latest.resourceCount} resources in ${latest.region}`,
        onClick: () => navigate('/insights'),
      });
    }

    return out;
  }, [scanResult, analysisResult, savedScans, navigate]);

  const unseenCount = notices.filter((n) => !seen.has(n.sig)).length;

  // When the panel opens, mark all current notifications as seen.
  useEffect(() => {
    if (open && notices.length > 0) {
      const next = new Set(seen);
      notices.forEach((n) => next.add(n.sig));
      setSeen(next);
      localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(next)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toneClass = (t: Notice['tone']) =>
    t === 'danger' ? 'text-red-400 bg-red-500/10'
    : t === 'warning' ? 'text-yellow-400 bg-yellow-500/10'
    : t === 'ai' ? 'text-purple-400 bg-purple-500/10'
    : 'text-blue-400 bg-blue-500/10';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 text-gray-400 hover:text-white rounded-lg hover:bg-dark-800 transition-all duration-200"
        title="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {unseenCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-dark-800 border border-dark-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <span className="text-xs text-gray-500">{notices.length}</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notices.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">You are all caught up.</p>
              ) : (
                notices.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => { n.onClick?.(); setOpen(false); }}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-dark-700/50 transition-colors text-left border-b border-dark-800/50 last:border-0"
                  >
                    <span className={`p-1.5 rounded-lg ${toneClass(n.tone)}`}>{n.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-200">{n.title}</span>
                      <span className="block text-[11px] text-gray-500">{n.detail}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
