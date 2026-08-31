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
} from '@heroicons/react/24/outline';

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
  frequency: 'once' | 'daily';
  runAt?: string;
  dailyTime?: string;
  label?: string;
  enabled: boolean;
  status?: string;
  lastRunAt?: string;
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

export default function InsightHubPage() {
  const navigate = useNavigate();
  const { savedScans, deleteScan, loadScan, analysisResult, scanResult, roleArn, selectedRegion, selectedRegions } = useAppStore();

  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [schedFreq, setSchedFreq] = useState<'once' | 'daily'>('daily');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');

  // Scan comparison state
  const [scanA, setScanA] = useState<number | ''>('');
  const [scanB, setScanB] = useState<number | ''>('');

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
    if (schedFreq === 'daily' && !schedTime) {
      toast.error('Select a time for the daily scan.');
      return;
    }
    setScheduleLoading(true);
    try {
      const runAt = schedFreq === 'once' ? new Date(`${schedDate}T${schedTime}`).toISOString() : undefined;
      const dailyTime = schedFreq === 'daily' ? schedTime : undefined; // HH:MM (local → treated as UTC by backend)
      const res = await manageSchedule({
        action: 'create',
        accountId: scheduleAccountId,
        roleArn,
        region: selectedRegion,
        regions: selectedRegions.length ? selectedRegions : [selectedRegion],
        frequency: schedFreq,
        runAt,
        dailyTime,
        label: schedFreq === 'once'
          ? `One-time scan on ${new Date(`${schedDate}T${schedTime}`).toLocaleString()}`
          : `Daily scan at ${schedTime}`,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success('Scan scheduled.');
      setSchedDate(''); setSchedTime('');
      loadSchedules();
    } catch {
      toast.error('Failed to create schedule.');
    } finally {
      setScheduleLoading(false);
    }
  }

  async function handleScheduleAction(scheduleId: string, action: 'enable' | 'disable' | 'delete') {
    const res = await manageSchedule({ action, scheduleId });
    if (res.error) { toast.error(res.error); return; }
    toast.success(action === 'delete' ? 'Schedule deleted.' : action === 'enable' ? 'Schedule enabled.' : 'Schedule disabled.');
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

        <div className="card relative overflow-hidden group hover:border-purple-500/30 transition-colors">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-purple-500/5 rounded-full group-hover:bg-purple-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 rounded-xl">
              <CurrencyDollarIcon className="w-6 h-6 text-purple-400" />
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
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Resources Tracked</p>
              <p className="text-2xl font-bold text-white">{totalResources || '--'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Dashboard (CIS / NIST) */}
      <ComplianceDashboard />

      {/* Drift Detection */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5 text-gray-400" />
            Drift Detection
          </h2>
          <button
            onClick={handleDetectDrift}
            disabled={driftLoading}
            className="btn-secondary text-xs flex items-center gap-1.5"
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
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-gray-400" />
            Scheduled Scans
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Schedule automatic discovery and drift detection. Choose a one-time date and time, or a daily time. Drift alerts are emailed automatically.
          </p>
        </div>

        {/* Create schedule */}
        <div className="flex flex-wrap items-end gap-3 p-4 bg-dark-900/70 border border-dark-700/50 rounded-lg mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Frequency</label>
            <select
              className="select-field w-36"
              value={schedFreq}
              onChange={(e) => setSchedFreq(e.target.value as 'once' | 'daily')}
            >
              <option value="daily">Daily</option>
              <option value="once">One time</option>
            </select>
          </div>
          {schedFreq === 'once' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" className="input-field w-40" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Time (UTC)</label>
            <input type="time" className="input-field w-32" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
          </div>
          <button onClick={handleCreateSchedule} disabled={scheduleLoading} className="btn-primary flex items-center gap-2">
            {scheduleLoading ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            ) : 'Add schedule'}
          </button>
        </div>

        {/* Schedule list */}
        {schedules.length === 0 ? (
          <p className="text-sm text-gray-500">No schedules yet. Add one above.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.scheduleId} className="flex items-center gap-3 bg-dark-900/50 border border-dark-700/50 rounded-lg px-4 py-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  s.status === 'completed' ? 'bg-gray-500' : s.enabled ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">
                    {s.frequency === 'once'
                      ? `One-time scan · ${s.runAt ? new Date(s.runAt).toLocaleString() : ''}`
                      : `Daily scan · ${s.dailyTime || 'any time'} UTC`}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {s.region} · {s.status === 'completed' ? 'Completed' : s.enabled ? 'Active' : 'Disabled'}
                    {s.lastRunAt ? ` · Last run ${new Date(s.lastRunAt).toLocaleString()}` : ''}
                  </p>
                </div>
                {s.status !== 'completed' && (
                  <button
                    onClick={() => handleScheduleAction(s.scheduleId, s.enabled ? 'disable' : 'enable')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors"
                  >
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
                <button
                  onClick={() => handleScheduleAction(s.scheduleId, 'delete')}
                  className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Delete schedule"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
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
                <option key={s.scanNumber} value={s.scanNumber}>
                  Scan {s.scanNumber} · {s.region} · {s.resourceCount} resources
                </option>
              ))}
            </select>
            <ArrowsRightLeftIcon className="w-5 h-5 text-gray-500" />
            <select className="select-field max-w-[240px]" value={scanB} onChange={(e) => setScanB(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select second scan</option>
              {savedScans.map((s) => (
                <option key={s.scanNumber} value={s.scanNumber}>
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
                <p className="text-[11px] text-gray-500">{new Date(compare.a.timestamp).toLocaleString()}</p>
              </div>
              <div className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-4">
                <p className="text-xs text-gray-500">Scan {compare.b.scanNumber}</p>
                <p className="text-2xl font-medium text-white">{compare.b.resourceCount}</p>
                <p className="text-[11px] text-gray-500">{new Date(compare.b.timestamp).toLocaleString()}</p>
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
          <span className="text-xs text-gray-500 bg-dark-900 px-3 py-1 rounded-full">
            {savedScans.length} {savedScans.length === 1 ? 'scan' : 'scans'}
          </span>
        </div>

        {savedScans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Sl. No.</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Region</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Resources</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Date</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...savedScans].sort((a, b) => a.scanNumber - b.scanNumber).map((scan) => (
                  <tr key={scan.scanNumber} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">
                    <td className="py-3 px-4 text-primary-400 font-bold">{scan.scanNumber}</td>
                    <td className="py-3 px-4">
                      <p className="text-white font-medium">{scan.accountName}</p>
                      <p className="text-xs text-gray-500">{scan.accountId}</p>
                    </td>
                    <td className="py-3 px-4 text-gray-300 font-medium">{scan.region}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">
                        {scan.resourceCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{new Date(scan.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleViewScan(scan.scanNumber)}
                          className="p-2 text-primary-400 hover:bg-primary-500/10 rounded-lg transition-colors"
                          title="View scan"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteScan(scan.scanNumber)}
                          className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete scan"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}
