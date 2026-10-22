import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { detectDrift, generateReport, manageSchedule } from '../services/api';
import ComplianceDashboard from '../components/ComplianceDashboard';
import toast from 'react-hot-toast';
import {
  ChartBarIcon,
  ClockIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  TrashIcon,
  EyeIcon,
  ArrowTrendingUpIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  DocumentArrowDownIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  PencilSquareIcon,
  PlayIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { formatScanTime } from '../utils/formatDate';

interface DriftSummary {
  added_count: number;
  removed_count: number;
  changed_count: number;
  baseline_total: number;
  current_total: number;
  net_change: number;
  drift_detected: boolean;
}
interface ScheduleItem {
  scheduleId: string;
  accountId: string;
  region: string;
  frequency: 'once' | 'daily' | 'weekly';
  runAt?: string;
  dailyTime?: string;
  dayOfWeek?: string;
  timezone?: string;
  label?: string;
  enabled: boolean;
  status?: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

interface DriftResult {
  drift: {
    added: { id: string; type: string; name?: string }[];
    removed: { id: string; type: string; name?: string }[];
    changed: { id: string; type: string; name?: string; changed_fields: string[] }[];
    summary: DriftSummary;
  } | null;
  message?: string;
  baseline?: { scanId: string; timestamp: string };
  current?: { scanId: string; timestamp: string };
}

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST · UTC+05:30)' },
  { value: 'UTC', label: 'UTC (Universal Coordinated Time · UTC+00:00)' },
  { value: 'America/New_York', label: 'America/New_York (US Eastern · UTC-05:00 / -04:00)' },
  { value: 'America/Chicago', label: 'America/Chicago (US Central · UTC-06:00 / -05:00)' },
  { value: 'America/Denver', label: 'America/Denver (US Mountain · UTC-07:00 / -06:00)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (US Pacific · UTC-08:00 / -07:00)' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (Brazil · UTC-03:00)' },
  { value: 'Europe/London', label: 'Europe/London (GMT / BST · UTC+00:00 / +01:00)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET / CEST · UTC+01:00 / +02:00)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (Frankfurt / Berlin · UTC+01:00 / +02:00)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST · UTC+04:00)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT · UTC+08:00)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST · UTC+09:00)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (HKT · UTC+08:00)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST / AEDT · UTC+10:00 / +11:00)' },
];

function getUtcDateFromZonedTime(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
  });
  const parts = fmt.formatToParts(guess);
  const val: Record<string, string> = {};
  parts.forEach(p => { val[p.type] = p.value; });
  let fH = Number(val.hour);
  if (fH === 24) fH = 0;
  const formattedAsUtc = Date.UTC(Number(val.year), Number(val.month) - 1, Number(val.day), fH, Number(val.minute), 0);
  const diff = guess.getTime() - formattedAsUtc;
  return new Date(guess.getTime() + diff);
}

function timeUntil(isoStr?: string): string {
  if (!isoStr) return '';
  const diffMs = new Date(isoStr).getTime() - Date.now();
  if (diffMs <= 0) return 'due shortly';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function InsightHubPage() {
  const navigate = useNavigate();
  const { savedScans, deleteScan, loadScan, analysisResult, scanResult, roleArn, selectedRegion, selectedRegions, syncScansFromBackend } = useAppStore();

  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [schedFreq, setSchedFreq] = useState<'once' | 'daily' | 'weekly'>('daily');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('02:00');
  const [schedDay, setSchedDay] = useState('Monday');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Auto-detect browser timezone
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const [schedTimezone, setSchedTimezone] = useState<string>(() => browserTz);

  // Live preview of scheduled time in UTC and browser local time
  const livePreview = (() => {
    if (!schedTime) return null;
    const refDate = schedDate || new Date().toISOString().slice(0, 10);
    try {
      const utcDate = getUtcDateFromZonedTime(refDate, schedTime, schedTimezone);
      const utcHours = String(utcDate.getUTCHours()).padStart(2, '0');
      const utcMins = String(utcDate.getUTCMinutes()).padStart(2, '0');
      const utcStr = `${utcHours}:${utcMins} UTC`;
      const isLocal = browserTz === schedTimezone;
      const localFmt = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short'
      }).format(utcDate);

      return {
        utcStr,
        isLocal,
        localFmt,
      };
    } catch {
      return null;
    }
  })();

  // Scan comparison state
  const [scanA, setScanA] = useState<number | ''>('');
  const [scanB, setScanB] = useState<number | ''>('');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Scan history: sort option + delete confirmation
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'most' | 'least'>('newest');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const sortedScans = (() => {
    const arr = [...savedScans];
    switch (sortBy) {
      case 'newest': return arr.sort((a, b) => b.scanNumber - a.scanNumber);
      case 'oldest': return arr.sort((a, b) => a.scanNumber - b.scanNumber);
      case 'most': return arr.sort((a, b) => b.resourceCount - a.resourceCount);
      case 'least': return arr.sort((a, b) => a.resourceCount - b.resourceCount);
    }
  })();

  const totalPages = Math.ceil(sortedScans.length / pageSize) || 1;
  const paginatedScans = sortedScans.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleViewScan(scanNumber: number) {
    loadScan(scanNumber);
    navigate('/your-arch');
  }

  async function handleDetectDrift() {
    const accountId = scanResult?.accountId || savedScans[0]?.accountId;
    if (!accountId) {
      toast.error('No account available. Run a scan first.');
      return;
    }
    setDriftLoading(true);
    try {
      const res = await detectDrift({ accountId });
      if (res.error) {
        toast.error(res.error);
      } else {
        setDrift(res.data as DriftResult);
        const d = (res.data as DriftResult).drift;
        if (d?.summary.drift_detected) {
          toast.success('Drift detected — review changes below.');
        } else if (d) {
          toast.success('No drift — infrastructure matches baseline.');
        } else {
          toast('Need at least two scans to detect drift.');
        }
      }
    } catch {
      toast.error('Drift detection failed.');
    } finally {
      setDriftLoading(false);
    }
  }

  async function handleExecutiveReport() {
    const scanId = scanResult?.scanId;
    if (!scanId) {
      toast.error('No active scan. Load or run a scan first.');
      return;
    }
    setReportLoading(true);
    try {
      const res = await generateReport({
        scanId,
        recommendationId: analysisResult?.recommendationId,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const report = (res.data as { report: Record<string, any> }).report;
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const M = 40;
      let y = 50;
      doc.setFontSize(20); doc.setFont('helvetica', 'bold');
      doc.text('ArchLens Executive Summary', M, y); y += 24;
      doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
      doc.text(`Account ${report.account.accountId}  •  ${(report.account.regions || []).join(', ')}  •  ${new Date(report.generatedAt).toLocaleString()}`, M, y);
      y += 28; doc.setTextColor(20);
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Overview', M, y); y += 18;
      doc.setFontSize(11); doc.setFont('helvetica', 'normal');
      doc.text(`Total resources: ${report.overview.total_resources}`, M, y); y += 15;
      doc.text(`Service types: ${report.overview.service_types}`, M, y); y += 15;
      doc.text(`Health score: ${report.overview.health_score ?? 'Not analyzed'}`, M, y); y += 15;
      doc.text(`Recommendations: ${report.recommendation_count}`, M, y); y += 24;
      if ((report.top_recommendations || []).length) {
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Top Recommendations', M, y); y += 18;
        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        report.top_recommendations.forEach((r: any, i: number) => {
          doc.text(`${i + 1}. [${r.priority}] ${r.title}  (${r.pillar})`, M, y); y += 14;
          if (y > 780) { doc.addPage(); y = 50; }
        });
      }
      doc.save(`archlens-executive-summary-${report.account.accountId}.pdf`);
      toast.success('Executive report downloaded.');
    } catch {
      toast.error('Report generation failed.');
    } finally {
      setReportLoading(false);
    }
  }

  const scheduleAccountId = scanResult?.accountId || savedScans[0]?.accountId;

  async function loadSchedules() {
    if (!scheduleAccountId) return;
    const res = await manageSchedule({ action: 'list', accountId: scheduleAccountId });
    if (!res.error) setSchedules((res.data as { schedules: ScheduleItem[] }).schedules || []);
  }

  useEffect(() => {
    syncScansFromBackend();
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleAccountId]);

  async function handleCreateSchedule() {
    if (!scheduleAccountId || !roleArn) {
      toast.error('Connect an account with a role ARN before scheduling scans.');
      return;
    }
    if (schedFreq === 'once' && (!schedDate || !schedTime)) {
      toast.error('Select a date and time for a one-time scan.');
      return;
    }
    if ((schedFreq === 'daily' || schedFreq === 'weekly') && !schedTime) {
      toast.error('Select a time for the scan.');
      return;
    }
    setScheduleLoading(true);
    try {
      const runAt = schedFreq === 'once'
        ? `${schedDate}T${schedTime}:00`
        : undefined;
      const dailyTime = schedFreq !== 'once' ? schedTime : undefined;
      const label = schedFreq === 'once'
        ? `One-time scan on ${schedDate} at ${schedTime} (${schedTimezone})`
        : schedFreq === 'weekly'
        ? `Weekly scan on ${schedDay} at ${schedTime} (${schedTimezone})`
        : `Daily scan at ${schedTime} (${schedTimezone})`;

      const res = await manageSchedule({
        action: editingId ? 'update' : 'create',
        ...(editingId ? { scheduleId: editingId } : {}),
        accountId: scheduleAccountId,
        roleArn,
        region: selectedRegion,
        regions: selectedRegions.length ? selectedRegions : [selectedRegion],
        frequency: schedFreq,
        runAt,
        dailyTime,
        dayOfWeek: schedFreq === 'weekly' ? schedDay.toLowerCase() : undefined,
        timezone: schedTimezone,
        label,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(editingId ? 'Schedule updated.' : 'Scan scheduled.');
      setSchedDate('');
      setEditingId(null);
      loadSchedules();
    } catch {
      toast.error(editingId ? 'Failed to update schedule.' : 'Failed to create schedule.');
    } finally {
      setScheduleLoading(false);
    }
  }

  // Populate the form for editing an existing schedule.
  function handleEditSchedule(s: ScheduleItem) {
    setEditingId(s.scheduleId);
    setSchedFreq(s.frequency);
    if (s.timezone) setSchedTimezone(s.timezone);

    if (s.frequency === 'once' && s.runAt) {
      const parts = s.runAt.split('T');
      setSchedDate(parts[0] || '');
      setSchedTime((parts[1] || '').slice(0, 5));
    } else if (s.dailyTime) {
      setSchedTime(s.dailyTime);
      if (s.frequency === 'weekly' && s.dayOfWeek) {
        const d = s.dayOfWeek.charAt(0).toUpperCase() + s.dayOfWeek.slice(1).toLowerCase();
        setSchedDay(d);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setSchedDate('');
    setSchedTime('02:00');
  }

  async function handleRunScheduleNow(scheduleId: string) {
    setRunningScheduleId(scheduleId);
    try {
      const res = await manageSchedule({ action: 'run', scheduleId });
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success('Scheduled scan initiated! Resource discovery and drift analysis are running in AWS.');
        loadSchedules();
      }
    } catch {
      toast.error('Failed to trigger scan execution.');
    } finally {
      setRunningScheduleId(null);
    }
  }

  async function handleScheduleAction(scheduleId: string, action: 'enable' | 'disable' | 'delete') {
    if (action === 'delete' && !window.confirm('Delete this schedule? This also removes its trigger in AWS EventBridge Scheduler.')) {
      return;
    }
    const res = await manageSchedule({ action, scheduleId });
    if (res.error) { toast.error(res.error); return; }
    toast.success(action === 'delete' ? 'Schedule deleted (AWS trigger removed).' : action === 'enable' ? 'Schedule enabled.' : 'Schedule disabled.');
    loadSchedules();
  }

  const compare = (() => {
    if (scanA === '' || scanB === '' || scanA === scanB) return null;
    const a = savedScans.find((s) => s.scanNumber === scanA);
    const b = savedScans.find((s) => s.scanNumber === scanB);
    if (!a || !b) return null;
    return {
      a, b,
      resourceDelta: b.resourceCount - a.resourceCount,
    };
  })();

  const totalResources = savedScans.reduce((sum, s) => sum + s.resourceCount, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">InsightHub</h1>
          <p className="text-gray-400 text-sm mt-1">Analytics, scan history, and optimization intelligence</p>
        </div>
        <button
          onClick={handleExecutiveReport}
          disabled={reportLoading}
          className="btn-primary flex items-center gap-2"
        >
          {reportLoading ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
          ) : (
            <><DocumentArrowDownIcon className="w-4 h-4" /> Executive Report (PDF)</>
          )}
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card relative overflow-hidden group hover:border-blue-500/30 transition-colors">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-blue-500/5 rounded-full group-hover:bg-blue-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <ChartBarIcon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Scans</p>
              <p className="text-2xl font-bold text-white">{savedScans.length}</p>
            </div>
          </div>
        </div>

        <div className="card relative overflow-hidden group hover:border-green-500/30 transition-colors">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-green-500/5 rounded-full group-hover:bg-green-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-xl">
              <ShieldCheckIcon className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Health Score</p>
              <p className="text-2xl font-bold text-white">
                {analysisResult?.analysis?.overall_score || '--'}
              </p>
            </div>
          </div>
        </div>

        <div className="card relative overflow-hidden group hover:border-primary-500/30 transition-colors">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-primary-500/5 rounded-full group-hover:bg-primary-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-500/10 rounded-xl">
              <CurrencyDollarIcon className="w-6 h-6 text-primary-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Cost Savings</p>
              <p className="text-2xl font-bold text-white">
                {analysisResult?.analysis?.cost_analysis?.net_monthly_impact_usd
                  ? `$${analysisResult.analysis.cost_analysis.net_monthly_impact_usd}`
                  : '--'}
              </p>
            </div>
          </div>
        </div>

        <div className="card relative overflow-hidden group hover:border-amber-500/30 transition-colors">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-amber-500/5 rounded-full group-hover:bg-amber-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 rounded-xl">
              <ArrowTrendingUpIcon className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Current Resources</p>
              <p className="text-2xl font-bold text-white">{scanResult?.summary?.total_resources ?? '--'}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{totalResources || 0} across all scans</p>
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Dashboard (CIS / NIST) */}
      <ComplianceDashboard />

      {/* Drift Detection */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ArrowPathIcon className="w-5 h-5 text-gray-400" />
                Drift Detection
              </h2>
              <span className="text-[11px] font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                Interactive On-Screen Analysis
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Compare your two most recent scans on-screen to inspect resource additions, deletions, or configuration changes. This is an interactive visual audit that displays results directly in the console without triggering email notifications.
            </p>
          <button
            onClick={handleDetectDrift}
            disabled={driftLoading}
            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap"
          >
            {driftLoading ? (
              <><div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Checking…</>
            ) : (
              <><ArrowPathIcon className="w-3.5 h-3.5" /> Detect drift now</>
            )}
          </button>
        </div>

        {!drift ? (
          <p className="text-sm text-gray-500">
            Compares your two most recent scans and flags resources added, removed, or changed since the baseline.
          </p>
        ) : !drift.drift ? (
          <p className="text-sm text-gray-400">{drift.message || 'Not enough scans to compare.'}</p>
        ) : (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                <p className="text-2xl font-medium text-green-400">{drift.drift.summary.added_count}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1"><PlusCircleIcon className="w-3.5 h-3.5" />Added</p>
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                <p className="text-2xl font-medium text-red-400">{drift.drift.summary.removed_count}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1"><MinusCircleIcon className="w-3.5 h-3.5" />Removed</p>
              </div>
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-2xl font-medium text-yellow-400">{drift.drift.summary.changed_count}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1"><PencilSquareIcon className="w-3.5 h-3.5" />Changed</p>
              </div>
              <div className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-3">
                <p className={`text-2xl font-medium ${drift.drift.summary.net_change > 0 ? 'text-green-400' : drift.drift.summary.net_change < 0 ? 'text-red-400' : 'text-white'}`}>
                  {drift.drift.summary.net_change > 0 ? '+' : ''}{drift.drift.summary.net_change}
                </p>
                <p className="text-xs text-gray-500">Net change</p>
              </div>
            </div>
            {(drift.drift.added.length > 0 || drift.drift.removed.length > 0 || drift.drift.changed.length > 0) && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {drift.drift.added.map((r) => (
                  <div key={`a-${r.id}`} className="flex items-center gap-2 text-xs text-gray-300 bg-dark-900/50 rounded px-3 py-2">
                    <PlusCircleIcon className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <span className="text-green-400 font-medium">Added</span>
                    <span className="text-gray-400">{r.type}</span>
                    <span className="truncate">{r.name || r.id}</span>
                  </div>
                ))}
                {drift.drift.removed.map((r) => (
                  <div key={`r-${r.id}`} className="flex items-center gap-2 text-xs text-gray-300 bg-dark-900/50 rounded px-3 py-2">
                    <MinusCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-red-400 font-medium">Removed</span>
                    <span className="text-gray-400">{r.type}</span>
                    <span className="truncate">{r.name || r.id}</span>
                  </div>
                ))}
                {drift.drift.changed.map((r) => (
                  <div key={`c-${r.id}`} className="flex items-center gap-2 text-xs text-gray-300 bg-dark-900/50 rounded px-3 py-2">
                    <PencilSquareIcon className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <span className="text-yellow-400 font-medium">Changed</span>
                    <span className="text-gray-400">{r.type}</span>
                    <span className="truncate">{r.name || r.id}</span>
                    <span className="text-gray-600">({r.changed_fields.join(', ')})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scheduled Scans */}
      <div className="card">
        <div className="mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-gray-400" />
              Scheduled Scans
            </h2>
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 w-fit">
              📧 Automated Email Reports: Sent exclusively for scheduled scans
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Automate architecture discovery with scheduled scans. Upon completion of each scheduled scan, an automated email report with execution status (successful or failed), resource metrics, and drift analysis is delivered to your registered notifications email.
          </p>
        </div>

        {/* Create / Edit schedule form */}
        <div className="p-4 bg-dark-900/70 border border-dark-700/50 rounded-lg mb-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Frequency</label>
              <select
                className="select-field w-36"
                value={schedFreq}
                onChange={(e) => setSchedFreq(e.target.value as 'once' | 'daily' | 'weekly')}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="once">One time</option>
              </select>
            </div>

            {schedFreq === 'once' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  className="input-field w-40"
                  value={schedDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setSchedDate(e.target.value)}
                />
              </div>
            )}

            {schedFreq === 'weekly' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Day of Week</label>
                <select className="select-field w-36" value={schedDay} onChange={(e) => setSchedDay(e.target.value)}>
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">Schedule Time</label>
              <input
                type="time"
                className="input-field w-32"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1">
                <GlobeAltIcon className="w-3.5 h-3.5 text-brand-400" />
                Timezone
              </label>
              <select
                className="select-field min-w-[260px]"
                value={schedTimezone}
                onChange={(e) => setSchedTimezone(e.target.value)}
              >
                {!TIMEZONE_OPTIONS.some((o) => o.value === browserTz) && (
                  <option value={browserTz}>{browserTz} (Browser Local)</option>
                )}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label} {tz.value === browserTz ? ' ★ (Your Local Time)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateSchedule}
                disabled={scheduleLoading}
                className="btn-primary flex items-center gap-2"
              >
                {scheduleLoading ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                ) : editingId ? 'Save changes' : 'Add schedule'}
              </button>
              {editingId && (
                <button
                  onClick={handleCancelEdit}
                  className="text-xs px-3 py-2 rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Live Timezone & UTC Conversion Preview */}
          {livePreview && (
            <div className="flex items-center gap-2 text-xs text-brand-300 bg-brand-500/10 border border-brand-500/20 px-3 py-2 rounded-md">
              <ClockIcon className="w-4 h-4 text-brand-400 shrink-0" />
              <span>
                Schedule will run at <strong>{schedTime}</strong> ({schedTimezone})
                {' · '}
                <span className="text-gray-300 font-mono">({livePreview.utcStr})</span>
                {!livePreview.isLocal && (
                  <> · <span className="text-gray-400">{livePreview.localFmt} your local time</span></>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Schedule list */}
        {schedules.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500 border border-dashed border-dark-700 rounded-lg">
            No automated scan schedules yet. Configure a daily, weekly, or one-time scan above.
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => {
              const tz = s.timezone || 'UTC';
              const timeDisplay = s.dailyTime || (s.runAt ? s.runAt.slice(11, 16) : '02:00');
              const nextRunFormatted = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '';
              const nextRunRel = s.nextRunAt ? timeUntil(s.nextRunAt) : '';

              return (
                <div
                  key={s.scheduleId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-dark-900/50 border border-dark-700/50 hover:border-dark-600 rounded-lg px-4 py-3 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                        s.status === 'completed'
                          ? 'bg-gray-500'
                          : s.enabled
                          ? 'bg-emerald-400 animate-pulse'
                          : 'bg-amber-400'
                      }`}
                      title={s.status === 'completed' ? 'Completed' : s.enabled ? 'Active' : 'Paused'}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-gray-200">
                          {s.frequency === 'once'
                            ? `One-time scan · ${s.runAt ? s.runAt.slice(0, 10) : ''} at ${timeDisplay}`
                            : s.frequency === 'weekly'
                            ? `Weekly scan · ${s.dayOfWeek ? (s.dayOfWeek.charAt(0).toUpperCase() + s.dayOfWeek.slice(1).toLowerCase()) : 'Monday'} at ${timeDisplay}`
                            : `Daily scan · Every day at ${timeDisplay}`}
                        </p>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                          {tz}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                            s.status === 'completed'
                              ? 'bg-gray-800 text-gray-400'
                              : s.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {s.status === 'completed' ? 'Completed' : s.enabled ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 flex flex-wrap items-center gap-x-2">
                        <span>Target: <strong>{s.region}</strong></span>
                        {nextRunFormatted && s.status !== 'completed' && s.enabled && (
                          <span>· Next run: <strong className="text-gray-300">{nextRunFormatted}</strong> ({nextRunRel})</span>
                        )}
                        {s.lastRunAt && (
                          <span>· Last run: {formatScanTime(s.lastRunAt)}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {s.status !== 'completed' && (
                      <>
                        <button
                          onClick={() => handleRunScheduleNow(s.scheduleId)}
                          disabled={runningScheduleId === s.scheduleId}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 transition-colors"
                          title="Trigger scan immediately (test run)"
                        >
                          {runningScheduleId === s.scheduleId ? (
                            <><div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /> Running…</>
                          ) : (
                            <><PlayIcon className="w-3.5 h-3.5" /> Run Now</>
                          )}
                        </button>
                        <button
                          onClick={() => handleEditSchedule(s)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors flex items-center gap-1"
                          title="Edit schedule timing or timezone"
                        >
                          <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          onClick={() => handleScheduleAction(s.scheduleId, s.enabled ? 'disable' : 'enable')}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors"
                        >
                          {s.enabled ? 'Pause' : 'Resume'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleScheduleAction(s.scheduleId, 'delete')}
                      className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete schedule (removes EventBridge trigger)"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scan Comparison */}
      {savedScans.length >= 2 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-5">
            <ArrowsRightLeftIcon className="w-5 h-5 text-gray-400" />
            Scan Comparison
          </h2>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select className="select-field max-w-[240px]" value={scanA} onChange={(e) => setScanA(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select first scan</option>
              {savedScans.map((s) => (
                <option key={s.scanNumber} value={s.scanNumber} disabled={s.scanNumber === scanB}>
                  Scan {s.scanNumber} · {s.region} · {s.resourceCount} resources
                </option>
              ))}
            </select>
            <ArrowsRightLeftIcon className="w-5 h-5 text-gray-500" />
            <select className="select-field max-w-[240px]" value={scanB} onChange={(e) => setScanB(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select second scan</option>
              {savedScans.map((s) => (
                <option key={s.scanNumber} value={s.scanNumber} disabled={s.scanNumber === scanA}>
                  Scan {s.scanNumber} · {s.region} · {s.resourceCount} resources
                </option>
              ))}
            </select>
          </div>
          {compare && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-4">
                <p className="text-xs text-gray-500">Scan {compare.a.scanNumber}</p>
                <p className="text-2xl font-medium text-white">{compare.a.resourceCount}</p>
                <p className="text-[11px] text-gray-500">{formatScanTime(compare.a.timestamp)}</p>
              </div>
              <div className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-4">
                <p className="text-xs text-gray-500">Scan {compare.b.scanNumber}</p>
                <p className="text-2xl font-medium text-white">{compare.b.resourceCount}</p>
                <p className="text-[11px] text-gray-500">{formatScanTime(compare.b.timestamp)}</p>
              </div>
              <div className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-4">
                <p className="text-xs text-gray-500">Resource change</p>
                <p className={`text-2xl font-medium ${compare.resourceDelta > 0 ? 'text-green-400' : compare.resourceDelta < 0 ? 'text-red-400' : 'text-white'}`}>
                  {compare.resourceDelta > 0 ? '+' : ''}{compare.resourceDelta}
                </p>
                <p className="text-[11px] text-gray-500">Second scan vs first scan</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scan History */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-gray-400" />
            Scan History
          </h2>
          <div className="flex items-center gap-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-1.5 text-xs text-gray-200"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most">Most resources</option>
              <option value="least">Least resources</option>
            </select>
            <span className="text-xs text-gray-500 bg-dark-900 px-3 py-1 rounded-full">
              {savedScans.length} {savedScans.length === 1 ? 'scan' : 'scans'}
            </span>
          </div>
        </div>

        {savedScans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Scan ID</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account Name</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account ID</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Region</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Resources</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Date &amp; Time</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedScans.map((scan) => (
                  <tr key={scan.scanNumber} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">
                    <td className="py-3 px-4 text-primary-400 font-bold whitespace-nowrap">{scan.scanNumber}</td>
                    <td className="py-3 px-4 text-white font-medium whitespace-nowrap">{scan.accountName}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{scan.accountId}</td>
                    <td className="py-3 px-4 text-gray-300 font-medium whitespace-nowrap">{scan.region}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">
                        {scan.resourceCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{formatScanTime(scan.timestamp)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        Completed
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleViewScan(scan.scanNumber)}
                          className="p-2 text-primary-400 hover:bg-primary-500/10 rounded-lg transition-colors"
                          title="View scan"
                          aria-label={`View scan ${scan.scanNumber}`}
                        >
                          <EyeIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(scan.scanNumber)}
                          className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete scan"
                          aria-label={`Delete scan ${scan.scanNumber}`}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-dark-700/60 bg-dark-900/40">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-gray-200"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                  <span className="ml-2">
                    Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, sortedScans.length)} of {sortedScans.length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 text-xs rounded border border-dark-700 bg-dark-800 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-dark-700 transition-colors"
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-7 h-7 text-xs rounded font-medium transition-colors ${
                        p === currentPage
                          ? 'bg-primary-500 text-white font-bold shadow-sm'
                          : 'border border-dark-700 bg-dark-800 text-gray-300 hover:bg-dark-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 text-xs rounded border border-dark-700 bg-dark-800 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-dark-700 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-dark-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ClockIcon className="w-8 h-8 text-gray-600" />
            </div>
            <p className="text-gray-300 font-medium">No scan history yet</p>
            <p className="text-gray-500 text-sm mt-1">Run your first scan from the YourArch tab</p>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {pendingDelete !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Delete Scan {pendingDelete}?</h3>
            <p className="text-sm text-gray-400 mb-6">
              This will permanently remove this scan and its associated analysis data. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setPendingDelete(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => { deleteScan(pendingDelete); toast.success(`Scan ${pendingDelete} deleted`); setPendingDelete(null); }}
                className="btn-danger"
              >
                Delete Scan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
