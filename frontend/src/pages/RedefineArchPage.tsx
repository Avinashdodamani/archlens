import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  MagnifyingGlassIcon,
  CpuChipIcon,
  LockClosedIcon,
  ArrowRightIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

export default function RedefineArchPage() {
  const navigate = useNavigate();
  const {
    scanResult, analysisResult, setAnalysisResult,
    cftResult, setCftResult, terraformResult, setTerraformResult,
    selectedPillars, setSelectedPillars,
    setCurrentStep, isLoading, setLoading,
  } = useAppStore();

  const [activeScriptTab, setActiveScriptTab] = useState<'cft' | 'terraform'>('cft');
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [recSearch, setRecSearch] = useState('');
  const [recPillarFilter, setRecPillarFilter] = useState('all');
  const [recPriorityFilter, setRecPriorityFilter] = useState('all');

  // Derive proposed architecture by synthesizing current architecture + WAF recommendations/changes
  const proposedArchitecture = (() => {
    if (!scanResult) return null;
    const resources = scanResult.resources.map((r) => ({ ...r }));
    const relationships = scanResult.relationships.map((rel) => ({ ...rel }));

    const changes = (analysisResult as any)?.analysis?.architecture_changes || [];
    const recs = analysisResult?.analysis?.recommendations || [];

    if (changes.length > 0) {
      changes.forEach((ch: any, idx: number) => {
        if (ch.action === 'ADD' || ch.action === 'CREATE') {
          const newId = `proposed-${(ch.resource_type || 'service').toLowerCase()}-${idx}`;
          const existingVpc = resources.find((r) => r.type === 'VPC');
          const existingSubnet = resources.find((r) => r.type === 'Subnet');
          resources.push({
            type: ch.resource_type,
            id: newId,
            name: ch.resource_name || `${ch.resource_type} (Recommended)`,
            region: scanResult.regions?.[0] || 'ap-south-1',
            vpc_id: existingVpc?.id,
            subnet_id: existingSubnet?.id,
            isRecommended: true,
          });

          if (ch.connects_to && Array.isArray(ch.connects_to)) {
            ch.connects_to.forEach((targetId: string) => {
              relationships.push({
                source: newId,
                source_type: ch.resource_type,
                target: targetId,
                target_type: 'Unknown',
                relationship: 'recommended_connection',
              });
            });
          }
        }
      });
    } else if (recs.length > 0) {
      // Synthesize best-practice additions from recommendations
      recs.forEach((rec, idx) => {
        const text = `${rec.title} ${rec.description}`.toLowerCase();
        let addedType = '';
        if (text.includes('waf') && !resources.some((r) => r.type === 'WAF')) {
          addedType = 'WAF';
        } else if ((text.includes('elasticache') || text.includes('redis')) && !resources.some((r) => r.type === 'ElastiCache')) {
          addedType = 'ElastiCache';
        } else if ((text.includes('auto scaling') || text.includes('asg')) && !resources.some((r) => r.type === 'AutoScaling')) {
          addedType = 'AutoScaling';
        } else if (text.includes('cloudfront') && !resources.some((r) => r.type === 'CloudFront')) {
          addedType = 'CloudFront';
        } else if (text.includes('multi-az') && !resources.some((r) => r.name?.includes('Standby'))) {
          addedType = 'RDS';
        }

        if (addedType) {
          const newId = `proposed-${addedType.toLowerCase()}-${idx}`;
          const existingVpc = resources.find((r) => r.type === 'VPC');
          const existingSubnet = resources.find((r) => r.type === 'Subnet');
          resources.push({
            type: addedType,
            id: newId,
            name: addedType === 'RDS' ? 'RDS (Multi-AZ Standby)' : `${addedType} (WAF)`,
            region: scanResult.regions?.[0] || 'ap-south-1',
            vpc_id: existingVpc?.id,
            subnet_id: existingSubnet?.id,
            isRecommended: true,
          });
        }
      });
    }

    return { resources, relationships };
  })();

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">RedefineYourArch</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30 flex items-center gap-1 shadow-sm">
              <CpuChipIcon className="w-3 h-3 text-purple-400" />
              Amazon Bedrock
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shadow-sm">
              <LockClosedIcon className="w-3 h-3 text-emerald-400" />
              archlens-guardrail Active
            </span>
          </div>
          <p className="text-gray-400 text-sm">AI-powered architecture optimization based on the AWS Well-Architected Framework</p>
        </div>
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
            <div className="card space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <ArrowsRightLeftIcon className="w-5 h-5 text-primary-400" />
                    Architecture Comparison
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Compare current topology with Bedrock WAF-recommended target architecture
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5 text-gray-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                    Current: <strong className="text-white">{scanResult.resources.length}</strong> resources
                  </span>
                  <span className="flex items-center gap-1.5 text-green-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    Proposed: <strong className="text-white">{proposedArchitecture?.resources.length || scanResult.resources.length}</strong> resources
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Current Architecture Diagram */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      <span className="text-sm font-medium text-gray-200">Current Architecture</span>
                    </div>
                    <span className="text-[11px] text-gray-400 bg-dark-800/80 px-2 py-0.5 rounded border border-dark-700">
                      As-Is AWS State
                    </span>
                  </div>
                  <div className="h-[480px] rounded-xl overflow-hidden border border-dark-700/60 bg-dark-950/80">
                    <ArchitectureDiagram
                      resources={scanResult.resources}
                      relationships={scanResult.relationships}
                      servicesFootprint={scanResult.servicesFootprint}
                    />
                  </div>
                </div>

                {/* Proposed WAF Architecture Diagram */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-sm font-medium text-green-300">Proposed Architecture (WAF Optimized)</span>
                    </div>
                    <span className="text-[11px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/30">
                      +{Math.max(0, (proposedArchitecture?.resources.length || scanResult.resources.length) - scanResult.resources.length)} Recommended Components
                    </span>
                  </div>
                  <div className="h-[480px] rounded-xl overflow-hidden border border-green-500/30 bg-dark-950/80 ring-1 ring-green-500/20">
                    <ArchitectureDiagram
                      resources={proposedArchitecture?.resources || scanResult.resources}
                      relationships={proposedArchitecture?.relationships || scanResult.relationships}
                      servicesFootprint={scanResult.servicesFootprint}
                    />
                  </div>
                </div>
              </div>

              {/* Proposed Deltas & Transition Summary */}
              <div className="pt-3 border-t border-dark-700/50">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Optimization Deltas & Transitions
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[190px] overflow-y-auto pr-1">
                  {(analysisResult.analysis.recommendations || []).map((rec) => (
                    <div key={rec.id} className="bg-dark-900/80 border border-dark-700/60 rounded-lg p-2.5 text-xs hover:border-dark-600 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`badge ${(PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM).bg} ${(PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM).text}`}>
                          {rec.priority}
                        </span>
                        <span className="text-[10px] text-gray-500">{rec.pillar}</span>
                      </div>
                      <p className="font-medium text-white truncate">{rec.title}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[11px]">
                        <span className="text-gray-400 line-through truncate max-w-[42%]">{rec.current_state}</span>
                        <ArrowsRightLeftIcon className="w-3 h-3 text-green-400 flex-shrink-0" />
                        <span className="text-green-300 truncate max-w-[42%] font-medium">{rec.proposed_state}</span>
                      </div>
                    </div>
                  ))}
                  {(analysisResult.analysis.recommendations || []).length === 0 && (
                    <p className="text-xs text-gray-500 col-span-full py-4 text-center">No specific deltas generated.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Recommendations with Filter & Search */}
          <div className="card space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <SparklesIcon className="w-5 h-5 text-purple-400" />
                  Recommendations ({analysisResult.analysis.recommendations?.length || 0})
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  AI-prioritized remediations aligned with AWS Well-Architected Framework best practices
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={recSearch}
                    onChange={(e) => setRecSearch(e.target.value)}
                    placeholder="Search recommendations..."
                    className="bg-dark-900 border border-dark-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 w-52"
                  />
                </div>

                {/* Priority Filter */}
                <select
                  value={recPriorityFilter}
                  onChange={(e) => setRecPriorityFilter(e.target.value)}
                  className="bg-dark-900 border border-dark-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500"
                >
                  <option value="all">All Priorities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
            </div>

            {/* Pillar Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setRecPillarFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  recPillarFilter === 'all'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-dark-900 text-gray-400 hover:text-white border border-dark-700/60'
                }`}
              >
                All Pillars
              </button>
              {WAF_PILLARS.map((p) => {
                const count = (analysisResult.analysis.recommendations || []).filter((r) =>
                  r.pillar?.toLowerCase().includes(p.key.toLowerCase())
                ).length;
                return (
                  <button
                    key={p.key}
                    onClick={() => setRecPillarFilter(recPillarFilter === p.key ? 'all' : p.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1 ${
                      recPillarFilter === p.key
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-dark-900 text-gray-400 hover:text-white border border-dark-700/60'
                    }`}
                  >
                    <span>{p.icon}</span>
                    <span>{p.name}</span>
                    <span className="text-[10px] opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Recommendations List */}
            <div className="space-y-3">
              {(analysisResult.analysis.recommendations || [])
                .filter((rec) => {
                  const matchesPillar = recPillarFilter === 'all' || rec.pillar?.toLowerCase().includes(recPillarFilter.toLowerCase());
                  const matchesPriority = recPriorityFilter === 'all' || rec.priority?.toUpperCase() === recPriorityFilter.toUpperCase();
                  const matchesSearch = !recSearch ||
                    rec.title?.toLowerCase().includes(recSearch.toLowerCase()) ||
                    rec.description?.toLowerCase().includes(recSearch.toLowerCase()) ||
                    rec.pillar?.toLowerCase().includes(recSearch.toLowerCase());
                  return matchesPillar && matchesPriority && matchesSearch;
                })
                .map((rec) => {
                  const priorityConfig = PRIORITY_BADGE[rec.priority] || PRIORITY_BADGE.MEDIUM;
                  const isExpanded = expandedRec === rec.id;
                  return (
                    <div
                      key={rec.id}
                      className="bg-dark-900 border border-dark-700/80 rounded-xl overflow-hidden hover:border-dark-600 transition-all shadow-sm"
                    >
                      <button
                        onClick={() => setExpandedRec(isExpanded ? null : rec.id)}
                        className="w-full p-4 text-left flex items-start justify-between gap-4 hover:bg-dark-800/40 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className={`badge ${priorityConfig.bg} ${priorityConfig.text} font-bold`}>
                              {rec.priority}
                            </span>
                            <span className="text-xs text-gray-300 font-medium">{rec.pillar}</span>
                            <span className="text-xs text-gray-600">•</span>
                            <span className="text-xs text-gray-400">Confidence: {rec.confidence}%</span>
                            {rec.downtime_required && (
                              <span className="text-[10px] text-gray-500 bg-dark-950 px-2 py-0.5 rounded border border-dark-800">
                                Downtime: {rec.downtime_required}
                              </span>
                            )}
                          </div>
                          <p className="text-white font-semibold text-sm leading-snug">{rec.title}</p>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{rec.description}</p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {rec.monthly_cost_impact > 0 && (
                            <p className="text-sm text-emerald-400 font-bold">
                              Save ${rec.monthly_cost_impact}/mo
                            </p>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">{rec.effort_hours || 2}h effort</p>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-dark-700/60 pt-4 space-y-4 bg-dark-950/40">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            <div className="bg-dark-900 p-3 rounded-lg border border-dark-800">
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Current As-Is State</p>
                              <p className="text-xs text-gray-300 font-mono leading-relaxed">{rec.current_state}</p>
                            </div>
                            <div className="bg-dark-900 p-3 rounded-lg border border-emerald-500/20">
                              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">Target Well-Architected State</p>
                              <p className="text-xs text-emerald-300 font-mono leading-relaxed">{rec.proposed_state}</p>
                            </div>
                          </div>

                          {rec.affected_resources && rec.affected_resources.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Affected Cloud Resources</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rec.affected_resources.map((resId: string, idx: number) => (
                                  <span key={idx} className="px-2 py-0.5 rounded bg-dark-900 border border-dark-700 text-[11px] font-mono text-gray-300">
                                    {resId}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {rec.implementation_steps && rec.implementation_steps.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Execution &amp; Implementation Steps</p>
                              <ol className="list-decimal list-inside text-xs text-gray-300 space-y-1.5 bg-dark-900 p-3 rounded-lg border border-dark-800">
                                {rec.implementation_steps.map((step: string, i: number) => (
                                  <li key={i} className="leading-relaxed">{step}</li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {rec.rollback_plan && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Automated Rollback Strategy</p>
                              <div className="p-3 bg-dark-900 rounded-lg border border-amber-500/20 flex items-start gap-2.5">
                                <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-200/90 leading-relaxed">{rec.rollback_plan}</p>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-dark-800 text-xs text-gray-500">
                            <div className="flex items-center gap-3">
                              <span>Risk Score: <strong className="text-gray-300">{rec.risk_score || 3}/10</strong></span>
                              <span>•</span>
                              <span>Downtime: <strong className="text-gray-300">{rec.downtime_required || 'None'}</strong></span>
                            </div>
                            <button
                              onClick={() => navigate('/auto-remediate')}
                              className="text-xs font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1"
                            >
                              Remediate in AutoRemediate <ArrowRightIcon className="w-3.5 h-3.5" />
                            </button>
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

              {/* Enterprise Safety Stack Banner */}
              <div className="mt-6 p-5 bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 border border-emerald-500/30 rounded-2xl shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <ShieldCheckIcon className="w-5 h-5" />
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Enterprise 7-Layer Safety Stack Active
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 leading-relaxed">
                      Deployments are protected by automatic pre-change snapshots, zero deletion policy, automated rollback triggers, and human-in-the-loop approval. No resource will ever be deleted without explicit confirmation.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/auto-remediate')}
                    className="flex-shrink-0 flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/30 transition-all transform hover:scale-[1.02]"
                  >
                    <span>Proceed to AutoRemediate</span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
