import { useAppStore } from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheckIcon,
  CpuChipIcon,
  BoltIcon,
  ClockIcon,
  ArrowPathIcon,
  SparklesIcon,
  DocumentArrowDownIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  ServerStackIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { WAF_PILLARS } from '../config/constants';
import { getServiceIconPath } from '../config/aws-icon-map';

export default function DashboardPage() {
  const { scanResult, analysisResult, savedScans, connectedAccounts, activeAccountId, darkMode } = useAppStore();
  const navigate = useNavigate();

  const overallScore = analysisResult?.analysis?.overall_score || 0;
  const pillarScores = analysisResult?.analysis?.pillar_scores || {};
  const totalResources = scanResult?.summary?.total_resources || 0;
  const totalRecommendations = analysisResult?.analysis?.recommendations?.length || 0;
  const riskSummary = analysisResult?.analysis?.risk_summary;

  // Onboarding progress
  const steps = [
    { label: 'Connect', done: connectedAccounts.length > 0 || !!scanResult },
    { label: 'Discover', done: savedScans.length > 0 },
    { label: 'Analyze', done: !!analysisResult },
    { label: 'Remediate', done: false },
    { label: 'Monitor', done: false },
  ];
  const completedSteps = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Your cloud architecture intelligence at a glance</p>
        </div>
        <button
          onClick={() => navigate('/your-arch')}
          className="btn-primary flex items-center gap-2 shadow-lg shadow-primary-500/20"
        >
          <ArrowPathIcon className="w-4 h-4" />
          New Scan
        </button>
      </div>

      {/* Hero Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health Score — Large Gauge */}
        <div className="card bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border-dark-600/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary-500/5 to-transparent rounded-full -mr-10 -mt-10" />
          <div className="flex items-center gap-5">
            <div className="relative w-[72px] h-[72px] flex-shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" strokeWidth="7" className="text-dark-700" stroke="currentColor" />
                <circle cx="50" cy="50" r="42" fill="none" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={`${overallScore * 2.64} 264`}
                  className={`transition-all duration-1000 ease-out ${
                    overallScore >= 70 ? 'text-green-400' : overallScore >= 40 ? 'text-yellow-400' : overallScore > 0 ? 'text-red-400' : 'text-dark-600'
                  }`}
                  stroke="currentColor"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-lg font-bold ${
                  overallScore >= 70 ? 'text-green-400' : overallScore >= 40 ? 'text-yellow-400' : overallScore > 0 ? 'text-red-400' : 'text-gray-600'
                }`}>
                  {overallScore || '—'}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Health Score</p>
              <p className="text-sm text-gray-300 mt-1">
                {overallScore >= 70 ? 'Well-Architected' : overallScore >= 40 ? 'Needs Improvement' : overallScore > 0 ? 'Critical Issues' : 'Not analyzed yet'}
              </p>
            </div>
          </div>
        </div>

        {/* Resources Discovered */}
        <div className="card bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border-dark-600/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-blue-500/5 to-transparent rounded-full -mr-10 -mt-10 group-hover:from-blue-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/20">
              <ServerStackIcon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Resources</p>
              <p className={`text-2xl font-bold mt-0.5 ${totalResources > 0 ? 'text-white' : 'text-gray-600'}`}>
                {totalResources || '—'}
              </p>
              {totalResources > 0 && (
                <p className="text-[10px] text-gray-500 mt-0.5">{Object.keys(scanResult?.summary?.by_type || {}).length} service types</p>
              )}
            </div>
          </div>
        </div>

        {/* Recommendations */}
        <div className="card bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border-dark-600/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-purple-500/5 to-transparent rounded-full -mr-10 -mt-10 group-hover:from-purple-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/20">
              <BoltIcon className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Recommendations</p>
              <p className={`text-2xl font-bold mt-0.5 ${totalRecommendations > 0 ? 'text-white' : 'text-gray-600'}`}>
                {totalRecommendations || '—'}
              </p>
              {riskSummary && (
                <p className="text-[10px] text-red-400 mt-0.5">{riskSummary.critical_findings} critical</p>
              )}
            </div>
          </div>
        </div>

        {/* Total Scans */}
        <div className="card bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border-dark-600/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-500/5 to-transparent rounded-full -mr-10 -mt-10 group-hover:from-cyan-500/10 transition-colors" />
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 rounded-xl border border-cyan-500/20">
              <ClockIcon className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Total Scans</p>
              <p className="text-2xl font-bold mt-0.5 text-white">{savedScans.length}</p>
              {savedScans.length > 0 && (
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Last: {new Date(savedScans[0]?.timestamp).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Progress + Connected Account */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Progress Stepper */}
        <div className="lg:col-span-2 card bg-gradient-to-r from-dark-800 to-dark-900 border-dark-600/50">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white">Getting Started</p>
            <span className="text-xs text-primary-400 font-bold bg-primary-500/10 px-2.5 py-1 rounded-full">
              {completedSteps}/{steps.length}
            </span>
          </div>
          <div className="flex items-center">
            {steps.map((step, idx) => (
              <div key={step.label} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                    step.done
                      ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25'
                      : 'bg-dark-700 text-gray-500 border border-dark-600'
                  }`}>
                    {step.done ? <CheckCircleIcon className="w-5 h-5" /> : idx + 1}
                  </div>
                  <span className={`text-[11px] mt-2 font-medium ${step.done ? 'text-green-400' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`h-0.5 w-full mx-2 rounded-full transition-all duration-500 ${
                    step.done ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-dark-700'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Connected Account */}
        <div className="card bg-gradient-to-br from-dark-800 to-dark-900 border-dark-600/50">
          {(connectedAccounts.length > 0 || scanResult) ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Connected Account</p>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Active
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-blue-500/20 to-cyan-500/10 rounded-xl border border-blue-500/20">
                  <GlobeAltIcon className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {connectedAccounts.find(a => a.id === activeAccountId)?.accountName || 'AWS Account'}
                  </p>
                  <p className="text-xs text-gray-500">{scanResult?.accountId || ''}</p>
                </div>
              </div>
              {scanResult && (
                <p className="text-[10px] text-gray-500 mt-3 pt-3 border-t border-dark-700">
                  Scanned: {new Date(scanResult.timestamp).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <GlobeAltIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No account connected</p>
              <button onClick={() => navigate('/your-arch')} className="text-xs text-primary-400 hover:text-primary-300 mt-1 font-medium">
                Connect now →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WAF Scores + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* WAF Pillar Scores */}
        {Object.keys(pillarScores).length > 0 ? (
          <div className="lg:col-span-2 card">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5 text-primary-400" />
                Well-Architected Framework
              </h2>
              <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">6 pillars</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {WAF_PILLARS.map((pillar) => {
                const score = pillarScores[pillar.key]?.score || 0;
                const topRisk = pillarScores[pillar.key]?.top_risk;
                return (
                  <div key={pillar.key} className="bg-dark-900/70 rounded-xl p-4 border border-dark-700/50 hover:border-dark-600 transition-colors">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-sm font-medium text-gray-200 flex items-center gap-2">
                        <span className="text-base">{pillar.icon}</span>
                        <span>{pillar.name}</span>
                      </span>
                      <span className={`text-sm font-bold ${
                        score >= 70 ? 'text-green-400' : score >= 40 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{score}%</span>
                    </div>
                    <div className="w-full bg-dark-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-1000 ease-out ${
                          score >= 70 ? 'bg-gradient-to-r from-green-600 to-green-400'
                          : score >= 40 ? 'bg-gradient-to-r from-yellow-600 to-yellow-400'
                          : 'bg-gradient-to-r from-red-600 to-red-400'
                        }`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    {topRisk && (
                      <p className="text-[10px] text-gray-500 mt-2 flex items-start gap-1">
                        <ExclamationTriangleIcon className="w-3 h-3 text-yellow-500 flex-shrink-0 mt-px" />
                        {topRisk}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 card bg-gradient-to-br from-primary-900/10 via-dark-800 to-dark-900 border-primary-800/20">
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gradient-to-br from-primary-500/20 to-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-primary-500/20">
                <ShieldCheckIcon className="w-8 h-8 text-primary-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">Welcome to ArchLens</h2>
              <p className="text-gray-400 text-sm max-w-md mx-auto mb-6 leading-relaxed">
                Connect your AWS account to discover your architecture, get AI-powered optimization
                recommendations aligned with the Well-Architected Framework, and implement changes safely.
              </p>
              <button
                onClick={() => navigate('/your-arch')}
                className="btn-primary px-6 py-2.5 shadow-lg shadow-primary-500/20"
              >
                Connect AWS Account & Discover Architecture
              </button>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <BoltIcon className="w-4 h-4 text-yellow-400" />
            Quick Actions
          </h2>
          <div className="space-y-2.5">
            <button
              onClick={() => navigate('/your-arch')}
              className="w-full flex items-center gap-3 p-3.5 bg-dark-900/70 rounded-xl border border-dark-700/50 hover:border-blue-500/30 hover:bg-dark-800 transition-all text-left group"
            >
              <div className="p-2.5 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/20 group-hover:shadow-lg group-hover:shadow-blue-500/10 transition-all">
                <ArrowPathIcon className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Scan Architecture</p>
                <p className="text-[11px] text-gray-500">Discover latest resources</p>
              </div>
              <ArrowTrendingUpIcon className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
            </button>

            <button
              onClick={() => navigate('/redefine')}
              className="w-full flex items-center gap-3 p-3.5 bg-dark-900/70 rounded-xl border border-dark-700/50 hover:border-purple-500/30 hover:bg-dark-800 transition-all text-left group"
            >
              <div className="p-2.5 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/20 group-hover:shadow-lg group-hover:shadow-purple-500/10 transition-all">
                <SparklesIcon className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Analyze with WAF</p>
                <p className="text-[11px] text-gray-500">AI-powered optimization</p>
              </div>
              <ArrowTrendingUpIcon className="w-4 h-4 text-gray-600 group-hover:text-purple-400 transition-colors" />
            </button>

            <button
              onClick={() => navigate('/insights')}
              className="w-full flex items-center gap-3 p-3.5 bg-dark-900/70 rounded-xl border border-dark-700/50 hover:border-emerald-500/30 hover:bg-dark-800 transition-all text-left group"
            >
              <div className="p-2.5 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/20 group-hover:shadow-lg group-hover:shadow-emerald-500/10 transition-all">
                <DocumentArrowDownIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">View Insights</p>
                <p className="text-[11px] text-gray-500">History & reports</p>
              </div>
              <ArrowTrendingUpIcon className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition-colors" />
            </button>
          </div>
        </div>
      </div>

      {/* Resource Distribution */}
      {scanResult && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <CpuChipIcon className="w-5 h-5 text-gray-400" />
              Resource Distribution
            </h2>
            <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">
              {totalResources} total
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(scanResult.summary.by_type)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([type, count]) => (
                <div
                  key={type}
                  className="bg-dark-900/70 rounded-xl p-4 border border-dark-700/50 text-center hover:border-primary-500/30 hover:bg-dark-800/50 transition-all cursor-default"
                >
                  <img
                    src={getServiceIconPath(type, darkMode)}
                    alt={type}
                    className="w-9 h-9 mx-auto mb-2"
                  />
                  <p className="text-2xl font-bold text-white">{count as number}</p>
                  <p className="text-xs text-gray-500 mt-1 font-medium">{type}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Scans Table */}
      {savedScans.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-gray-400" />
              Recent Scans
            </h2>
            <button onClick={() => navigate('/insights')} className="text-xs text-primary-400 hover:text-primary-300 font-medium">
              View all →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Sl. No.</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Region</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Resources</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {savedScans.slice(0, 5).map((scan, idx) => (
                  <tr key={scan.scanNumber} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">
                    <td className="py-3 px-4 text-primary-400 font-bold">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <p className="text-white font-medium">{scan.accountName}</p>
                      <p className="text-[10px] text-gray-500">{scan.accountId}</p>
                    </td>
                    <td className="py-3 px-4 text-gray-300 font-medium">{scan.region}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">
                        {scan.resourceCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{new Date(scan.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
