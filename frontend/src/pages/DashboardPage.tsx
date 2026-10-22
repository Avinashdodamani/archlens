import { useEffect } from 'react';
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

  ArrowTrendingUpIcon,

  ServerStackIcon,

  ArrowUpIcon,

  ArrowDownIcon,

  CurrencyDollarIcon,

} from '@heroicons/react/24/outline';

import { WAF_PILLARS } from '../config/constants';

import { getServiceIconPath } from '../config/aws-icon-map';

import WafRadarChart from '../components/WafRadarChart';

import { scoreTextClass, scoreBarClass } from '../config/theme';

import { formatScanTime } from '../utils/formatDate';



export default function DashboardPage() {

  const { scanResult, analysisResult, savedScans, connectedAccounts, activeAccountId, darkMode, currentStep, syncScansFromBackend } = useAppStore();

  useEffect(() => {
    syncScansFromBackend();
  }, []);

  const navigate = useNavigate();



  // AWS Well-Architected Framework Official Risk Penalty Formula:
  // Pillar Score = 100 - (Critical Risks * 20) - (High Risks * 10) - (Medium Risks * 5)
  // Overall Health Score = Average of all evaluated Pillar Scores
  const overallScore = (() => {
    if (!analysisResult?.analysis) return 0;
    const recs = analysisResult.analysis.recommendations || [];
    if (recs.length === 0 && !analysisResult.analysis.pillar_scores) return 0;
    const pillarKeys = WAF_PILLARS.map(p => p.key);
    const pillarScoresList: number[] = [];

    pillarKeys.forEach((key) => {
      const pRecs = recs.filter((r: any) => (r.pillar || '').toLowerCase() === key.toLowerCase());
      const critical = pRecs.filter((r: any) => r.priority === 'CRITICAL' || (r.risk_score && r.risk_score >= 8)).length;
      const high = pRecs.filter((r: any) => r.priority === 'HIGH' || (r.risk_score && r.risk_score >= 5 && r.risk_score < 8)).length;
      const medium = pRecs.filter((r: any) => r.priority === 'MEDIUM' || (r.risk_score && r.risk_score >= 2 && r.risk_score < 5)).length;

      const score = Math.max(0, Math.min(100, 100 - (critical * 20) - (high * 10) - (medium * 5)));
      pillarScoresList.push(score);
    });

    if (pillarScoresList.length === 0) return 100;
    return Math.round(pillarScoresList.reduce((a, b) => a + b, 0) / pillarScoresList.length);
  })();

  const pillarScores = analysisResult?.analysis?.pillar_scores || {};

  const totalResources = scanResult?.summary?.total_resources || 0;

  const totalRecommendations = analysisResult?.analysis?.recommendations?.length || 0;

  const riskSummary = analysisResult?.analysis?.risk_summary;





  // Cost trend (from Cost Explorer, via discovery — real per-account values)

  const costTrend = scanResult?.costTrend || [];



  return (

    <div className="space-y-6 animate-fade-in">

      {/* Page Header */}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

        <div>

          <h1 className="text-2xl font-bold text-white tracking-tight">Executive Dashboard</h1>

          <p className="text-gray-400 text-sm mt-0.5">Real-time cloud architecture health, AWS Well-Architected Framework compliance, and AI optimization metrics</p>

        </div>

        <div className="flex items-center gap-2.5">

          <button

            onClick={() => navigate('/redefine')}

            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 border border-purple-500/30 transition-all shadow-sm"

          >

            <SparklesIcon className="w-4 h-4 text-purple-400" />

            AI Optimization

          </button>

          <button

            onClick={() => navigate('/your-arch')}

            className="btn-primary flex items-center gap-2 shadow-lg shadow-primary-500/20 text-xs py-2 px-4"

          >

            <ArrowPathIcon className="w-4 h-4" />

            New Scan

          </button>

        </div>

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

                  className={`transition-all duration-1000 ease-out ${scoreTextClass(overallScore)}`}

                  stroke="currentColor"

                />

              </svg>

              <div className="absolute inset-0 flex items-center justify-center">

                <span className={`text-lg font-medium ${scoreTextClass(overallScore)}`}>

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

              <p className={`text-2xl font-medium mt-0.5 ${totalRecommendations > 0 ? 'text-white' : 'text-gray-600'}`}>

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



      {/* AI Executive Intelligence Briefing */}

      {analysisResult && (

        <div className="card bg-gradient-to-r from-purple-950/40 via-dark-800 to-dark-900 border-purple-500/30 p-5 relative overflow-hidden shadow-xl">

          <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-purple-500/10 to-transparent pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">

            <div className="space-y-1.5 max-w-3xl">

              <div className="flex items-center gap-2">

                <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">

                  <SparklesIcon className="w-4 h-4" />

                </span>

                <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">

                  Amazon Bedrock · Architecture Intelligence Briefing

                </span>

              </div>

              <p className="text-sm text-gray-200 leading-relaxed">

                ArchLens analyzed your deployed architecture against all 6 AWS Well-Architected Framework pillars.

                {riskSummary?.critical_findings ? (

                  <> Identified <strong className="text-red-400">{riskSummary.critical_findings} critical security & resilience risks</strong> requiring immediate remediation.</>

                ) : (

                  <> Your cloud architecture exhibits strong overall baseline alignment with AWS best practices.</>

                )}

                {totalRecommendations > 0 && (

                  <> A prioritized catalog of <strong>{totalRecommendations} actionable optimizations</strong> is available with ready-to-deploy CloudFormation & Terraform templates.</>

                )}

              </p>

            </div>

            <button

              onClick={() => navigate('/redefine')}

              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 text-white font-medium text-xs hover:bg-purple-500 transition-colors shadow-lg shadow-purple-600/20 self-start md:self-center"

            >

              <span>Review Recommendations</span>

              <ArrowTrendingUpIcon className="w-4 h-4" />

            </button>

          </div>

        </div>

      )}



      {/* Cost Trend & Connected Account */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Cost Trend */}

      <div className="lg:col-span-2 card">

        <div className="flex items-center justify-between mb-4">

          <h2 className="text-base font-semibold text-white flex items-center gap-2">

            <CurrencyDollarIcon className="w-5 h-5 text-gray-400" />

            Cost Trend

          </h2>

          <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">Last 3 months</span>

        </div>

        {costTrend.length > 0 ? (

          <div className="flex items-end gap-4 h-40 px-2">

            {costTrend.map((m) => {

              const maxCost = Math.max(...costTrend.map((c) => c.cost_usd), 1);

              const heightPct = Math.max((m.cost_usd / maxCost) * 100, 3);

              const label = new Date(m.month + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

              return (

                <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full">

                  <span className="text-sm text-gray-200 font-medium mb-1">${m.cost_usd.toFixed(2)}</span>

                  <div

                    className="w-full max-w-[80px] bg-gradient-to-t from-primary-600 to-primary-400 rounded-t-lg transition-all duration-700"

                    style={{ height: `${heightPct}%` }}

                  />

                  <span className="text-xs text-gray-500 mt-2">{label}</span>

                </div>

              );

            })}

          </div>

        ) : (

          <div className="text-center py-10">

            <CurrencyDollarIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />

            <p className="text-sm text-gray-500">

              No cost data available yet. Run a scan on an account with Cost Explorer access to see monthly spend.

            </p>

          </div>

        )}

      </div>



        {/* Connected Account — detailed */}

        <div className="card bg-gradient-to-br from-dark-800 to-dark-900 border-dark-600/50">

          {(connectedAccounts.length > 0 || scanResult) ? (

            <div>

              <div className="flex items-center justify-between mb-4">

                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Connected Account</p>

                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-semibold">

                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />

                  Active

                </span>

              </div>

              <dl className="space-y-2.5 text-sm">

                <div className="flex justify-between gap-2">

                  <dt className="text-gray-500">Account Name</dt>

                  <dd className="text-white font-medium text-right truncate">

                    {connectedAccounts.find(a => a.id === activeAccountId)?.accountName || connectedAccounts[0]?.accountName || 'AWS Account'}

                  </dd>

                </div>

                <div className="flex justify-between gap-2">

                  <dt className="text-gray-500">Account ID</dt>

                  <dd className="text-gray-300 text-right">{scanResult?.accountId || connectedAccounts[0]?.accountId || '—'}</dd>

                </div>

                <div className="flex justify-between gap-2">

                  <dt className="text-gray-500">Region</dt>

                  <dd className="text-gray-300 text-right">

                    {scanResult

                      ? (scanResult.regions && scanResult.regions.length > 1

                          ? `Multi-region (${scanResult.regions.length})`

                          : (scanResult.regions?.[0] || '—'))

                      : '—'}

                  </dd>

                </div>

                <div className="flex justify-between gap-2">

                  <dt className="text-gray-500">Last Scan</dt>

                  <dd className="text-gray-300 text-right text-xs">

                    {scanResult ? new Date(scanResult.timestamp).toLocaleString() : 'Not scanned yet'}

                  </dd>

                </div>

              </dl>

              <button

                onClick={() => navigate('/your-arch')}

                className="w-full mt-4 text-xs text-primary-400 hover:text-primary-300 font-medium border border-dark-700 rounded-lg py-2 transition-colors hover:bg-dark-800"

              >

                View Account

              </button>

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



      {/* AWS Well-Architected Framework Scores + Quick Actions */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* AWS Well-Architected Framework Pillar Scores */}

        {Object.keys(pillarScores).length > 0 ? (

          <div className="lg:col-span-2 card">

            <div className="flex items-center justify-between mb-5">

              <h2 className="text-lg font-semibold text-white flex items-center gap-2">

                <ShieldCheckIcon className="w-5 h-5 text-primary-400" />

                Well-Architected Framework

              </h2>

              <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">6 pillars</span>

            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Radar chart */}

              <div className="bg-dark-900/50 rounded-xl p-3 border border-dark-700/50 flex items-center justify-center">

                <WafRadarChart pillarScores={pillarScores} isDark={darkMode} />

              </div>

              {/* Pillar bars */}

              <div className="space-y-2.5">

                {WAF_PILLARS.map((pillar) => {

                  const score = pillarScores[pillar.key]?.score || 0;

                  return (

                    <div key={pillar.key} className="bg-dark-900/70 rounded-lg p-2.5 border border-dark-700/50">

                      <div className="flex items-center justify-between mb-1.5">

                        <span className="text-xs font-medium text-gray-200 flex items-center gap-1.5">

                          <span>{pillar.icon}</span>

                          <span>{pillar.name}</span>

                        </span>

                        <span className={`text-xs font-medium ${scoreTextClass(score)}`}>{score}%</span>

                      </div>

                      <div className="w-full bg-dark-700 rounded-full h-1.5">

                        <div

                          className={`h-1.5 rounded-full transition-all duration-1000 ease-out ${scoreBarClass(score)}`}

                          style={{ width: `${score}%` }}

                        />

                      </div>

                    </div>

                  );

                })}

              </div>

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

                <p className="text-sm font-medium text-white">Analyze with AWS Well-Architected Framework</p>

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
            {Object.entries(scanResult.summary?.by_type || {})
              .sort(([, a], [, b]) => (b as number) - (a as number))

              .map(([type, count]) => (

                <div

                  key={type}

                  className="bg-dark-900/70 rounded-xl p-4 border border-dark-700/50 text-center hover:border-primary-500/30 hover:bg-dark-800/50 transition-all cursor-default"

                >

                  <img

                    src={getServiceIconPath(type, darkMode)}

                    alt=""

                    aria-hidden="true"

                    className="w-9 h-9 mx-auto mb-2 object-contain"

                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}

                  />

                  <p className="text-2xl font-bold text-white">{count as number}</p>

                  <p className="text-xs text-gray-500 mt-1 font-medium">{type}</p>

                </div>

              ))}

          </div>

        </div>

      )}



      {/* Top Priority Recommendations */}

      {analysisResult?.analysis?.recommendations && analysisResult.analysis.recommendations.length > 0 && (

        <div className="card bg-gradient-to-br from-dark-800 to-dark-900 border-dark-700/60">

          <div className="flex items-center justify-between mb-4">

            <div>

              <h2 className="text-base font-semibold text-white flex items-center gap-2">

                <SparklesIcon className="w-5 h-5 text-purple-400" />

                Priority Recommendations

              </h2>

              <p className="text-xs text-gray-400 mt-0.5">Top AI-identified optimization opportunities requiring engineering attention</p>

            </div>

            <button

              onClick={() => navigate('/redefine')}

              className="text-xs text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1"

            >

              View all ({analysisResult.analysis.recommendations.length}) →

            </button>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">

            {analysisResult.analysis.recommendations.slice(0, 3).map((rec) => {

              const isCrit = rec.priority === 'CRITICAL' || rec.priority === 'HIGH';

              return (

                <div

                  key={rec.id}

                  onClick={() => navigate('/redefine')}

                  className="p-4 rounded-xl bg-dark-900/80 border border-dark-700/70 hover:border-purple-500/40 hover:bg-dark-800/60 transition-all cursor-pointer group flex flex-col justify-between"

                >

                  <div>

                    <div className="flex items-center justify-between gap-2 mb-2">

                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${

                        rec.priority === 'CRITICAL'

                          ? 'bg-red-500/10 text-red-400 border-red-500/30'

                          : rec.priority === 'HIGH'

                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'

                          : 'bg-blue-500/10 text-blue-400 border-blue-500/30'

                      }`}>

                        {rec.priority}

                      </span>

                      <span className="text-[11px] text-gray-400 font-medium truncate">{rec.pillar}</span>

                    </div>

                    <h3 className="text-sm font-semibold text-white group-hover:text-purple-300 transition-colors line-clamp-1 mb-1">

                      {rec.title}

                    </h3>

                    <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">

                      {rec.description}

                    </p>

                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-dark-700/50 text-[11px]">

                    {rec.monthly_cost_impact > 0 ? (

                      <span className="text-emerald-400 font-medium">Save ${rec.monthly_cost_impact}/mo</span>

                    ) : (

                      <span className="text-gray-400">{rec.effort_hours || 2}h effort</span>

                    )}

                    <span className="text-purple-400 font-medium group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">

                      Review <ArrowTrendingUpIcon className="w-3 h-3" />

                    </span>

                  </div>

                </div>

              );

            })}

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

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Scan ID</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account Name</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Account ID</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Region</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Resources</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Date &amp; Time</th>

                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Status</th>

                </tr>

              </thead>

              <tbody>

                {[...savedScans].sort((a, b) => b.scanNumber - a.scanNumber).slice(0, 5).map((scan) => {

                  // Trend vs the immediately-previous scan number

                  const prev = savedScans.find((s) => s.scanNumber === scan.scanNumber - 1);

                  const delta = prev ? scan.resourceCount - prev.resourceCount : null;

                  return (

                  <tr key={scan.scanNumber} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">

                    <td className="py-3 px-4 text-primary-400 font-bold whitespace-nowrap">{scan.scanNumber}</td>

                    <td className="py-3 px-4 text-white font-medium whitespace-nowrap">{scan.accountName}</td>

                    <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{scan.accountId}</td>

                    <td className="py-3 px-4 text-gray-300 font-medium whitespace-nowrap">{scan.region}</td>

                    <td className="py-3 px-4 whitespace-nowrap">

                      <span className="inline-flex items-center gap-2">

                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">

                          {scan.resourceCount}

                        </span>

                        {delta !== null && delta !== 0 && (

                          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>

                            {delta > 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}

                            {Math.abs(delta)}

                          </span>

                        )}

                      </span>

                    </td>

                    <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{formatScanTime(scan.timestamp)}</td>

                    <td className="py-3 px-4 whitespace-nowrap">

                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">

                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />

                        Completed

                      </span>

                    </td>

                  </tr>

                  );

                })}

              </tbody>

            </table>

          </div>

        </div>

      )}

    </div>

  );

}

