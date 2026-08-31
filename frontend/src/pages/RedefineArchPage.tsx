import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { analyzeArchitecture, generateCFT, generateTerraform } from '../services/api';
import { WAF_PILLARS } from '../config/constants';
import { scoreTextClass, PRIORITY_BADGE } from '../config/theme';
import toast from 'react-hot-toast';
import ArchitectureDiagram from '../components/ArchitectureDiagram';
import {
  SparklesIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ShieldCheckIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';

export default function RedefineArchPage() {
  const {
    scanResult, analysisResult, setAnalysisResult,
    cftResult, setCftResult, terraformResult, setTerraformResult,
    selectedPillars, setSelectedPillars,
    setCurrentStep, isLoading, setLoading,
  } = useAppStore();

  const [activeScriptTab, setActiveScriptTab] = useState<'cft' | 'terraform'>('cft');
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  function togglePillar(pillarKey: string) {
    if (selectedPillars.includes(pillarKey)) {
      setSelectedPillars(selectedPillars.filter(p => p !== pillarKey));
    } else {
      setSelectedPillars([...selectedPillars, pillarKey]);
    }
  }

  function selectAllPillars() {
    setSelectedPillars(WAF_PILLARS.map(p => p.key));
  }

  async function handleAnalyze() {
    if (selectedPillars.length === 0) {
      toast.error('Select at least one WAF pillar');
      return;
    }
    if (!scanResult) {
      toast.error('No architecture data. Run discovery first from YourArch tab.');
      return;
    }

    setLoading(true);
    setCurrentStep('analyzing');

    try {
      const response = await analyzeArchitecture({
        scanId: scanResult.scanId,
        pillars: selectedPillars,
      });

      if (response.error) {
        toast.error(response.error);
        setCurrentStep('discovered');
      } else {
        setAnalysisResult(response.data as any);
        setCurrentStep('analyzed');
        toast.success('Analysis complete! Review recommendations below.');
        
        // Auto-generate scripts
        await handleGenerateScripts((response.data as any).recommendationId);
      }
    } catch {
      toast.error('Analysis failed. Please try again.');
      setCurrentStep('discovered');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateScripts(recommendationId: string) {
    setCurrentStep('generating_scripts');

    try {
      const [cftRes, tfRes] = await Promise.all([
        generateCFT({ recommendationId, scanId: scanResult?.scanId }),
        generateTerraform({ recommendationId, scanId: scanResult?.scanId }),
      ]);

      if (!cftRes.error) setCftResult(cftRes.data as any);
      if (!tfRes.error) setTerraformResult(tfRes.data as any);
      setCurrentStep('scripts_ready');
    } catch {
      setCurrentStep('analyzed');
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  }

  if (!scanResult) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-white">RedefineYourArch</h1>
        <div className="card bg-gradient-to-br from-dark-800 to-dark-900 text-center py-16">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-purple-500/20">
            <SparklesIcon className="w-8 h-8 text-purple-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">No Architecture Data</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto">Run a discovery scan first from the YourArch tab to analyze your architecture.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">RedefineYourArch</h1>
        <p className="text-gray-400 text-sm mt-1">AI-powered architecture optimization based on AWS Well-Architected Framework</p>
      </div>

      {/* Pillar Selection */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShieldCheckIcon className="w-5 h-5 text-primary-400" />
            Select Optimization Pillars
          </h2>
          <button onClick={selectAllPillars} className="text-sm text-primary-400 hover:text-primary-300 font-medium">
            Select All
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {WAF_PILLARS.map((pillar) => (
            <button
              key={pillar.key}
              onClick={() => togglePillar(pillar.key)}
              className={`relative p-4 rounded-xl border text-left transition-all duration-200 group ${
                selectedPillars.includes(pillar.key)
                  ? 'border-primary-500 bg-gradient-to-br from-primary-500/10 to-primary-600/5 shadow-lg shadow-primary-500/10'
                  : 'border-dark-600/50 bg-dark-900/70 hover:border-dark-500 hover:bg-dark-800/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg text-xl ${
                  selectedPillars.includes(pillar.key) ? 'bg-primary-500/20' : 'bg-dark-800'
                }`}>
                  {pillar.icon}
                </div>
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${selectedPillars.includes(pillar.key) ? 'text-primary-300' : 'text-white'}`}>
                    {pillar.name}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{pillar.description}</p>
                </div>
              </div>
              {selectedPillars.includes(pillar.key) && (
                <div className="absolute top-3 right-3">
                  <CheckCircleIcon className="w-5 h-5 text-primary-400" />
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between pt-4 border-t border-dark-700/50">
          <p className="text-sm text-gray-400">
            <span className="text-primary-400 font-semibold">{selectedPillars.length}</span> of {WAF_PILLARS.length} pillars selected
          </p>
          <button
            onClick={handleAnalyze}
            disabled={isLoading || selectedPillars.length === 0}
            className="btn-primary px-6 py-2.5 flex items-center gap-2 shadow-lg shadow-primary-500/20"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <SparklesIcon className="w-5 h-5" />
                Analyze Architecture
              </>
            )}
          </button>
        </div>
      </div>

      {/* Analysis Results */}
      {analysisResult && (
        <>
          {/* Summary */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Analysis Summary</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Overall Score:</span>
                <span className={`text-2xl font-medium ${scoreTextClass(analysisResult.analysis.overall_score || 0)}`}>
                  {analysisResult.analysis.overall_score || 0}/100
                </span>
              </div>
            </div>
            <p className="text-gray-300">{analysisResult.analysis.summary}</p>

            {/* Cost Analysis from Bedrock */}
            {analysisResult.analysis.cost_analysis && (
              <div className="mt-4 p-4 bg-dark-900 rounded-lg border border-dark-700">
                <h4 className="text-sm font-medium text-gray-300 mb-3">💰 Cost Analysis</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Current Monthly</p>
                    <p className="text-lg font-bold text-white">
                      ${analysisResult.analysis.cost_analysis.current_estimated_monthly_usd?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Projected Monthly</p>
                    <p className="text-lg font-bold text-green-400">
                      ${analysisResult.analysis.cost_analysis.projected_monthly_usd?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Net Monthly Impact</p>
                    <p className="text-lg font-bold text-green-400">
                      ${analysisResult.analysis.cost_analysis.net_monthly_impact_usd?.toFixed(2) || '0.00'}/mo
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">ROI Timeline</p>
                    <p className="text-lg font-bold text-primary-400">
                      {analysisResult.analysis.cost_analysis.roi_timeline_months || 'N/A'} months
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Architecture Comparison — current vs proposed (SOW 4.3) */}
          {scanResult && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <ArrowsRightLeftIcon className="w-5 h-5 text-primary-400" />
                Architecture Comparison
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Current */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-sm font-medium text-gray-300">Current Architecture</span>
                  </div>
                  <div className="h-[420px] rounded-xl overflow-hidden border border-dark-700/50">
                    <ArchitectureDiagram
                      resources={scanResult.resources}
                      relationships={scanResult.relationships}
                      servicesFootprint={scanResult.servicesFootprint}
                    />
                  </div>
                </div>
                {/* Proposed changes */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-sm font-medium text-gray-300">Proposed Changes</span>
                  </div>
                  <div className="h-[420px] rounded-xl border border-purple-500/20 bg-dark-900/50 p-4 overflow-y-auto space-y-2">
                    {(analysisResult.analysis.recommendations || []).map((rec) => (
                      <div key={rec.id} className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`badge ${(PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM).bg} ${(PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM).text}`}>
                            {rec.priority}
                          </span>
                          <span className="text-xs text-gray-500">{rec.pillar}</span>
                        </div>
                        <p className="text-sm text-white">{rec.title}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="text-gray-400 line-through truncate max-w-[45%]">{rec.current_state}</span>
                          <ArrowsRightLeftIcon className="w-3 h-3 text-purple-400 flex-shrink-0" />
                          <span className="text-green-300 truncate max-w-[45%]">{rec.proposed_state}</span>
                        </div>
                      </div>
                    ))}
                    {(analysisResult.analysis.recommendations || []).length === 0 && (
                      <p className="text-sm text-gray-500 text-center pt-16">No proposed changes.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">
              Recommendations ({analysisResult.analysis.recommendations?.length || 0})
            </h2>
            <div className="space-y-3">
              {analysisResult.analysis.recommendations?.map((rec) => {
                const priorityConfig = PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM;
                const isExpanded = expandedRec === rec.id;
                return (
                  <div
                    key={rec.id}
                    className="bg-dark-900 border border-dark-700 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedRec(isExpanded ? null : rec.id)}
                      className="w-full p-4 text-left flex items-start justify-between gap-4 hover:bg-dark-800/50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`badge ${priorityConfig.bg} ${priorityConfig.text}`}>
                            {rec.priority}
                          </span>
                          <span className="text-xs text-gray-500">{rec.pillar}</span>
                          <span className="text-xs text-gray-600">|</span>
                          <span className="text-xs text-gray-500">Confidence: {rec.confidence}%</span>
                        </div>
                        <p className="text-white font-medium">{rec.title}</p>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{rec.description}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {rec.monthly_cost_impact > 0 && (
                          <p className="text-sm text-green-400 font-medium">
                            Save ${rec.monthly_cost_impact}/mo
                          </p>
                        )}
                        <p className="text-xs text-gray-500">{rec.effort_hours}h effort</p>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-dark-700 pt-4 space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Current State</p>
                            <p className="text-sm text-gray-300 bg-dark-800 p-2 rounded">{rec.current_state}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Proposed State</p>
                            <p className="text-sm text-green-300 bg-dark-800 p-2 rounded">{rec.proposed_state}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Implementation Steps</p>
                          <ol className="list-decimal list-inside text-sm text-gray-300 space-y-1">
                            {rec.implementation_steps?.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Rollback Plan</p>
                          <p className="text-sm text-gray-300 bg-dark-800 p-2 rounded flex items-start gap-2">
                            <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                            {rec.rollback_plan}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Risk: {rec.risk_score}/10</span>
                          <span>Downtime: {rec.downtime_required}</span>
                          <span>Resources affected: {rec.affected_resources?.length || 0}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Generated Scripts */}
          {(cftResult || terraformResult) && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5 text-primary-400" />
                  Generated Scripts
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveScriptTab('cft')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeScriptTab === 'cft' ? 'bg-primary-500 text-white' : 'bg-dark-700 text-gray-400'
                    }`}
                  >
                    CloudFormation
                  </button>
                  <button
                    onClick={() => setActiveScriptTab('terraform')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeScriptTab === 'terraform' ? 'bg-primary-500 text-white' : 'bg-dark-700 text-gray-400'
                    }`}
                  >
                    Terraform
                  </button>
                </div>
              </div>

              {/* Script Content */}
              {activeScriptTab === 'cft' && cftResult?.template && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">CloudFormation YAML</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(cftResult.template!, 'CloudFormation template')}
                        className="btn-secondary text-xs flex items-center gap-1"
                      >
                        <ClipboardDocumentIcon className="w-3.5 h-3.5" /> Copy
                      </button>
                      {cftResult.downloadUrl && (
                        <a href={cftResult.downloadUrl} className="btn-secondary text-xs flex items-center gap-1">
                          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                  <pre className="bg-dark-950 border border-dark-700 rounded-lg p-4 overflow-x-auto text-xs text-gray-300 font-mono max-h-96 overflow-y-auto">
                    {cftResult.template}
                  </pre>
                </div>
              )}

              {activeScriptTab === 'terraform' && terraformResult?.files && (
                <div className="space-y-4">
                  {Object.entries(terraformResult.files).map(([filename, content]) => (
                    <div key={filename}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-300 font-mono">{filename}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => copyToClipboard(content, filename)}
                            className="btn-secondary text-xs flex items-center gap-1"
                          >
                            <ClipboardDocumentIcon className="w-3.5 h-3.5" /> Copy
                          </button>
                          {terraformResult.downloadUrls?.[filename] && (
                            <a href={terraformResult.downloadUrls[filename]} className="btn-secondary text-xs flex items-center gap-1">
                              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Download
                            </a>
                          )}
                        </div>
                      </div>
                      <pre className="bg-dark-950 border border-dark-700 rounded-lg p-4 overflow-x-auto text-xs text-gray-300 font-mono max-h-64 overflow-y-auto">
                        {content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {/* Proceed to Apply */}
              <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-yellow-300 font-medium">Ready to Apply Changes?</p>
                    <p className="text-yellow-400/80 text-sm mt-1">
                      Review the scripts above carefully. When you proceed, ArchLens will first take backups of all
                      affected resources, then show you a backup confirmation before making any changes.
                    </p>
                    <a href="/auto-remediate" className="btn-success mt-3 inline-flex items-center gap-2 text-sm">
                      Proceed to AutoRemediate →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
