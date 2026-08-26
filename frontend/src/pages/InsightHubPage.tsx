import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  ChartBarIcon,
  ClockIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  TrashIcon,
  EyeIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';

export default function InsightHubPage() {
  const navigate = useNavigate();
  const { savedScans, deleteScan, loadScan, analysisResult } = useAppStore();

  function handleViewScan(scanNumber: number) {
    loadScan(scanNumber);
    navigate('/your-arch');
  }

  const totalResources = savedScans.reduce((sum, s) => sum + s.resourceCount, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">InsightHub</h1>
        <p className="text-gray-400 text-sm mt-1">Analytics, scan history, and optimization intelligence</p>
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
                {savedScans.map((scan, idx) => (
                  <tr key={scan.scanNumber} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">
                    <td className="py-3 px-4 text-primary-400 font-bold">{idx + 1}</td>
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
