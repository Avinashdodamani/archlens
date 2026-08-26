import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { discoverResources } from '../services/api';
import { AWS_REGIONS, ALL_REGIONS_OPTION } from '../config/aws-regions';
import { RESOURCE_TYPE_COLORS } from '../config/constants';
import ArchitectureDiagram from '../components/ArchitectureDiagram';
import toast from 'react-hot-toast';
import { exportAsDrawioXml } from '../utils/exportDiagram';
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  InformationCircleIcon,
  GlobeAltIcon,
  MapIcon,
  TableCellsIcon,
  PlusIcon,
  TrashIcon,
  ClockIcon,
  FunnelIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';

export default function YourArchPage() {
  const navigate = useNavigate();
  const diagramRef = useRef<HTMLDivElement>(null);
  const {
    roleArn, setRoleArn,
    selectedRegion, setSelectedRegion,
    scanResult, setScanResult,
    setCurrentStep, setLoading, isLoading,
    connectedAccounts, addConnectedAccount, removeConnectedAccount,
    savedScans, saveScan, deleteScan, loadScan,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    diagramViewMode, setDiagramViewMode,
    darkMode,
  } = useAppStore();

  const [externalId, setExternalId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewMode, setViewMode] = useState<'diagram' | 'table'>('diagram');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newRoleArn, setNewRoleArn] = useState('');
  const [showScanHistory, setShowScanHistory] = useState(false);

  async function handleDiscover() {
    if (!roleArn) {
      toast.error('Please enter the IAM Role ARN');
      return;
    }

    if (!roleArn.startsWith('arn:aws:iam::') || !roleArn.includes(':role/')) {
      toast.error('Invalid Role ARN format. Expected: arn:aws:iam::<account-id>:role/<role-name>');
      return;
    }

    setLoading(true);
    setCurrentStep('discovering');

    try {
      const regions = selectedRegion === 'all'
        ? AWS_REGIONS.map(r => r.code)
        : [selectedRegion];

      const response = await discoverResources({
        roleArn,
        region: selectedRegion === 'all' ? 'us-east-1' : selectedRegion,
        regions,
        ...(externalId && { externalId }),
      });

      if (response.error) {
        toast.error(response.error);
        setCurrentStep('idle');
      } else {
        const data = response.data as any;
        setScanResult(data);
        setCurrentStep('discovered');

        // Auto-save scan to history
        const accountName = connectedAccounts.find(a => a.roleArn === roleArn)?.accountName || 'My Account';
        saveScan({
          scanId: data.scanId,
          accountName,
          accountId: data.accountId,
          region: selectedRegion,
          timestamp: data.timestamp,
          resourceCount: data.summary.total_resources,
          scanResult: data,
        });

        toast.success(`Scan #${savedScans.length + 1}: Discovered ${data.summary.total_resources} resources!`);
      }
    } catch (error) {
      toast.error('Discovery failed. Check the Role ARN and permissions.');
      setCurrentStep('idle');
    } finally {
      setLoading(false);
    }
  }

  function handleAddAccount() {
    if (!newRoleArn || !newAccountName) {
      toast.error('Account name and Role ARN are required');
      return;
    }
    addConnectedAccount({
      accountName: newAccountName,
      accountId: newAccountId || newRoleArn.split(':')[4] || '',
      roleArn: newRoleArn,
      externalId: externalId || undefined,
    });
    setRoleArn(newRoleArn);
    setNewAccountName('');
    setNewAccountId('');
    setNewRoleArn('');
    setShowAddAccount(false);
    toast.success('Account connected!');
  }

  function handleSelectAccount(account: typeof connectedAccounts[0]) {
    setRoleArn(account.roleArn);
    if (account.externalId) setExternalId(account.externalId);
  }

  async function handleDownloadDiagram(format: 'png' | 'svg' | 'pdf' | 'drawio') {
    if (format === 'drawio' && scanResult) {
      exportAsDrawioXml(scanResult.resources, scanResult.relationships, `archlens-architecture-${scanResult.scanId}.drawio.xml`);
      toast.success('draw.io XML downloaded! Open it at app.diagrams.net');
      return;
    }

    const element = diagramRef.current;
    if (!element) {
      toast.error('No diagram to download');
      return;
    }

    try {
      const scanId = scanResult?.scanId || 'diagram';

      const viewport = element.querySelector('.react-flow__viewport') as HTMLElement;
      if (!viewport) {
        toast.error('Diagram not ready');
        return;
      }

      const { toPng, toSvg } = await import('html-to-image');
      const exportBg = darkMode ? '#0d1117' : '#FFFFFF';

      // Compute the bounding box of all nodes (in flow coordinates) so we can
      // export the entire graph regardless of current zoom/pan.
      const nodeEls = Array.from(element.querySelectorAll('.react-flow__node')) as HTMLElement[];
      if (nodeEls.length === 0) {
        toast.error('Diagram not ready');
        return;
      }

      // Read current viewport transform (scale) to convert offsets to flow coords.
      const transform = window.getComputedStyle(viewport).transform;
      let scale = 1;
      if (transform && transform !== 'none') {
        const m = new DOMMatrixReadOnly(transform);
        scale = m.a || 1;
      }

      // Node offsetLeft/Top are in flow coordinate space (unscaled).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodeEls.forEach((n) => {
        const left = n.offsetLeft;
        const top = n.offsetTop;
        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + n.offsetWidth);
        maxY = Math.max(maxY, top + n.offsetHeight);
      });

      const pad = 60;
      const graphW = Math.ceil(maxX - minX + pad * 2);
      const graphH = Math.ceil(maxY - minY + pad * 2);

      const opts = {
        backgroundColor: exportBg,
        pixelRatio: 2,
        cacheBust: true,
        width: graphW,
        height: graphH,
        style: {
          // Shift the viewport so the top-left node aligns to the export origin,
          // and neutralize zoom so nothing is clipped.
          transform: `translate(${pad - minX}px, ${pad - minY}px) scale(1)`,
          transformOrigin: 'top left',
        },
      };

      if (format === 'png') {
        const dataUrl = await toPng(viewport, opts);
        triggerDownload(dataUrl, `archlens-architecture-${scanId}.png`);
        toast.success('PNG downloaded!');
      } else if (format === 'svg') {
        const dataUrl = await toSvg(viewport, opts);
        triggerDownload(dataUrl, `archlens-architecture-${scanId}.svg`);
        toast.success('SVG downloaded!');
      } else if (format === 'pdf') {
        const dataUrl = await toPng(viewport, opts);
        const { jsPDF } = await import('jspdf');
        const img = new Image();
        img.src = dataUrl;
        await new Promise((resolve) => { img.onload = resolve; });
        const pdf = new jsPDF({
          orientation: img.width > img.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [img.width / 2, img.height / 2],
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, img.width / 2, img.height / 2);
        pdf.save(`archlens-architecture-${scanId}.pdf`);
        toast.success('PDF downloaded!');
      }

      // ignore scale — kept for potential future use
      void scale;
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Download failed. Try draw.io export instead.');
    }
  }

  function triggerDownload(dataUrl: string, filename: string) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleDownloadData(format: 'json' | 'csv') {
    if (!scanResult) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = JSON.stringify(scanResult, null, 2);
      filename = `archlens-architecture-${scanResult.scanId}.json`;
      mimeType = 'application/json';
    } else {
      const headers = ['Type', 'ID', 'Name', 'Region', 'Status'];
      const rows = scanResult.resources.map(r => [
        r.type, r.id, r.name || '', r.region || '', (r as any).state || (r as any).status || ''
      ]);
      content = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
      filename = `archlens-resources-${scanResult.scanId}.csv`;
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }

  // Filter resources based on search and type
  const filteredResources = scanResult?.resources.filter(r => {
    const matchesSearch = !searchQuery ||
      r.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || r.type === filterType;
    return matchesSearch && matchesType;
  }) || [];

  const resourceTypes = [...new Set(scanResult?.resources.map(r => r.type) || [])].sort();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">YourArch</h1>
          <p className="text-gray-400 text-sm mt-1">Discover and visualize your current AWS architecture</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowScanHistory(!showScanHistory)}
            className="btn-secondary flex items-center gap-1 text-sm"
          >
            <ClockIcon className="w-4 h-4" /> Scan History ({savedScans.length})
          </button>
        </div>
      </div>

      {/* Scan History Panel */}
      {showScanHistory && savedScans.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-3">Previous Scans</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {savedScans.map((scan) => (
              <div key={scan.scanNumber} className="flex items-center justify-between p-3 bg-dark-900 rounded-lg border border-dark-700 hover:border-primary-500/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-primary-400">#{scan.scanNumber}</span>
                  <div>
                    <p className="text-sm text-white">{scan.accountName} ({scan.accountId})</p>
                    <p className="text-xs text-gray-500">{new Date(scan.timestamp).toLocaleString()} • {scan.resourceCount} resources • {scan.region}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { loadScan(scan.scanNumber); setShowScanHistory(false); }}
                    className="p-1.5 text-primary-400 hover:bg-primary-500/10 rounded transition-colors"
                    title="Load this scan"
                  >
                    <EyeIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { deleteScan(scan.scanNumber); toast.success(`Scan #${scan.scanNumber} deleted`); }}
                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    title="Delete this scan"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connected Accounts + Connection Card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-primary-400" />
            Connect AWS Account
          </h2>
          <button onClick={() => setShowAddAccount(!showAddAccount)} className="btn-secondary text-sm flex items-center gap-1">
            <PlusIcon className="w-4 h-4" /> Save Account
          </button>
        </div>

        {/* Saved Accounts */}
        {connectedAccounts.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2">Saved Accounts (click to select)</p>
            <div className="flex flex-wrap gap-2">
              {connectedAccounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => handleSelectAccount(account)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors flex items-center gap-2 ${
                    roleArn === account.roleArn
                      ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                      : 'border-dark-600 bg-dark-900 text-gray-300 hover:border-dark-500'
                  }`}
                >
                  <span className="font-medium">{account.accountName}</span>
                  <span className="text-xs text-gray-500">{account.accountId}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeConnectedAccount(account.id); }}
                    className="text-red-400 hover:text-red-300 ml-1"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add New Account Form */}
        {showAddAccount && (
          <div className="mb-4 p-4 bg-dark-900 rounded-lg border border-dark-700">
            <h4 className="text-sm font-medium text-white mb-3">Add New Account</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Account Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="input-field text-sm"
                  placeholder="e.g., Production, Staging"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Account ID</label>
                <input
                  type="text"
                  value={newAccountId}
                  onChange={(e) => setNewAccountId(e.target.value)}
                  className="input-field text-sm"
                  placeholder="123456789012"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Role ARN <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={newRoleArn}
                  onChange={(e) => setNewRoleArn(e.target.value)}
                  className="input-field text-sm font-mono"
                  placeholder="arn:aws:iam::...:role/..."
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={handleAddAccount} className="btn-primary text-sm">Save Account</button>
              <button onClick={() => setShowAddAccount(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Security Notice */}
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-start gap-3">
          <ShieldCheckIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-blue-300 font-medium">Read-Only Access — Safe to Preview</p>
            <p className="text-blue-400/80 mt-1">
              Provide a <strong>read-only IAM Role ARN</strong> to safely preview your architecture.
              ArchLens will only call Describe, List, and Get APIs — no modifications will be made.
              Write access is only needed later if you choose to apply changes.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Role ARN Input */}
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              IAM Role ARN <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              className="input-field font-mono text-sm"
              placeholder="arn:aws:iam::123456789012:role/ArchLens-ReadOnly-Role"
            />
          </div>

          {/* Region Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Region</label>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="select-field"
            >
              <option value={ALL_REGIONS_OPTION.code}>{ALL_REGIONS_OPTION.displayName}</option>
              <optgroup label="Americas">
                {AWS_REGIONS.filter(r => r.code.startsWith('us-') || r.code.startsWith('ca-') || r.code.startsWith('sa-')).map(r => (
                  <option key={r.code} value={r.code}>{r.displayName}</option>
                ))}
              </optgroup>
              <optgroup label="Europe">
                {AWS_REGIONS.filter(r => r.code.startsWith('eu-')).map(r => (
                  <option key={r.code} value={r.code}>{r.displayName}</option>
                ))}
              </optgroup>
              <optgroup label="Asia Pacific">
                {AWS_REGIONS.filter(r => r.code.startsWith('ap-')).map(r => (
                  <option key={r.code} value={r.code}>{r.displayName}</option>
                ))}
              </optgroup>
              <optgroup label="Middle East & Africa">
                {AWS_REGIONS.filter(r => r.code.startsWith('me-') || r.code.startsWith('af-') || r.code.startsWith('il-')).map(r => (
                  <option key={r.code} value={r.code}>{r.displayName}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* Discover Button */}
        <div className="mt-6">
          <button
            onClick={handleDiscover}
            disabled={isLoading || !roleArn}
            className="btn-primary px-8 py-3 flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Discovering Resources...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="w-5 h-5" />
                Discover Architecture
              </>
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {scanResult && (
        <>
          {/* Summary Bar */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Current Architecture</h2>
                <p className="text-sm text-gray-400">
                  Account: {scanResult.accountId} | Scanned: {new Date(scanResult.timestamp).toLocaleString()} | Resources: {scanResult.summary.total_resources}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/redefine')} className="btn-primary flex items-center gap-1 text-sm">
                  Analyze with WAF →
                </button>
              </div>
            </div>

            {/* Resource Type Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Object.entries(scanResult.summary.by_type)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([type, count]) => (
                  <div
                    key={type}
                    className="bg-dark-900 rounded-lg p-3 border border-dark-700 text-center hover:border-primary-500/50 transition-colors cursor-pointer"
                    onClick={() => setFilterType(filterType === type ? 'all' : type)}
                  >
                    <div
                      className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: RESOURCE_TYPE_COLORS[type] || '#6B7280' }}
                    >
                      {type.slice(0, 2)}
                    </div>
                    <p className="text-xl font-bold text-white">{count as number}</p>
                    <p className="text-xs text-gray-400">{type}</p>
                  </div>
                ))}
            </div>
          </div>

          {/* Diagram / Table Section */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                {viewMode === 'diagram' ? 'Architecture Diagram' : `Resources (${filteredResources.length})`}
              </h3>
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <button
                  onClick={() => setViewMode('diagram')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
                    viewMode === 'diagram' ? 'bg-primary-500 text-white' : 'bg-dark-700 text-gray-400 hover:text-white'
                  }`}
                >
                  <MapIcon className="w-4 h-4" /> Diagram
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
                    viewMode === 'table' ? 'bg-primary-500 text-white' : 'bg-dark-700 text-gray-400 hover:text-white'
                  }`}
                >
                  <TableCellsIcon className="w-4 h-4" /> Table
                </button>

                {/* Download Options */}
                {viewMode === 'diagram' && (
                  <>
                    <button onClick={() => handleDownloadDiagram('png')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> PNG
                    </button>
                    <button onClick={() => handleDownloadDiagram('svg')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> SVG
                    </button>
                    <button onClick={() => handleDownloadDiagram('pdf')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button onClick={() => handleDownloadDiagram('drawio')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> draw.io
                    </button>
                  </>
                )}
                {viewMode === 'table' && (
                  <>
                    <button onClick={() => handleDownloadData('json')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> JSON
                    </button>
                    <button onClick={() => handleDownloadData('csv')} className="btn-secondary text-xs flex items-center gap-1">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Diagram View Mode Selector */}
            {viewMode === 'diagram' && (
              <div className="mb-4 flex items-center gap-2">
                <span className="text-xs text-gray-500">View:</span>
                {(['logical', 'network', 'security'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setDiagramViewMode(mode)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      diagramViewMode === mode ? 'bg-primary-500/20 text-primary-400' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            )}

            {/* Architecture Diagram */}
            {viewMode === 'diagram' && (
              <div ref={diagramRef} key={`diagram-${darkMode}`} className="h-[650px] w-full rounded-xl overflow-hidden border border-dark-700/50">
                <ArchitectureDiagram
                  resources={scanResult.resources}
                  relationships={scanResult.relationships}
                />
              </div>
            )}

            {/* Table View */}
            {viewMode === 'table' && (
              <>
                {/* Search and Filter */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 relative">
                    <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="input-field pl-9 text-sm"
                      placeholder="Search by name, ID, or type..."
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <FunnelIcon className="w-4 h-4 text-gray-500" />
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="select-field text-sm w-auto"
                    >
                      <option value="all">All Types</option>
                      {resourceTypes.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Resource Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-dark-700">
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Type</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Name / ID</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Region</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResources.slice(0, 100).map((resource, idx) => (
                        <tr key={`${resource.id}-${idx}`} className="border-b border-dark-800 hover:bg-dark-800/50">
                          <td className="py-3 px-4">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white"
                              style={{ backgroundColor: RESOURCE_TYPE_COLORS[resource.type] || '#6B7280' }}
                            >
                              {resource.type}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-white font-medium">{resource.name || resource.id}</p>
                            {resource.name && <p className="text-xs text-gray-500 font-mono">{resource.id}</p>}
                          </td>
                          <td className="py-3 px-4 text-gray-400">{resource.region || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredResources.length > 100 && (
                    <p className="text-center text-gray-500 text-sm py-3">
                      Showing 100 of {filteredResources.length} resources. Use search to filter.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
