import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { discoverResources, workflow, getScanStatus, getScan } from '../services/api';
import { AWS_REGIONS, ALL_REGIONS_OPTION } from '../config/aws-regions';
import { RESOURCE_TYPE_COLORS } from '../config/constants';
import { getServiceIconPath } from '../config/aws-icon-map';
import ArchitectureDiagram from '../components/ArchitectureDiagram';
import ProgressBarModal from '../components/ProgressBarModal';
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
  Cog6ToothIcon,
  DocumentDuplicateIcon,
  CheckIcon,
  XMarkIcon,
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';

const TRUST_POLICY_JSON = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::338920687491:role/archlens-lambda-execution-role"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}`;

const CLIENT_CFT_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Description: 'ArchLens - Read-Only Cross-Account Role for Architecture Discovery'

Parameters:
  ArchLensAccountId:
    Type: String
    Default: '338920687491'
    Description: 'AWS Account ID of the ArchLens platform'

  ExternalId:
    Type: String
    Default: ''
    Description: 'Optional External ID for confused-deputy protection'

Conditions:
  HasExternalId: !Not [!Equals [!Ref ExternalId, '']]

Resources:
  ArchLensClientRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: ArchLens-Client-Scan-Role
      Description: 'Allows ArchLens to discover and visualize architecture in this account (read-only)'
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Sub 'arn:aws:iam::\${ArchLensAccountId}:role/archlens-lambda-execution-role'
            Action: 'sts:AssumeRole'
            Condition: !If
              - HasExternalId
              - StringEquals:
                  sts:ExternalId: !Ref ExternalId
              - !Ref 'AWS::NoValue'
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/SecurityAudit'
        - 'arn:aws:iam::aws:policy/ReadOnlyAccess'

Outputs:
  RoleArn:
    Description: 'Enter this Role ARN in the ArchLens dashboard'
    Value: !GetAtt ArchLensClientRole.Arn`;

const TERRAFORM_TEMPLATE = `# ArchLens - Read-Only Cross-Account Role for Architecture Discovery
variable "archlens_account_id" {
  type        = string
  default     = "338920687491"
  description = "AWS Account ID of the ArchLens platform"
}

variable "external_id" {
  type        = string
  default     = ""
  description = "Optional External ID for confused-deputy protection"
}

data "aws_iam_policy_document" "archlens_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [
        "arn:aws:iam::\${var.archlens_account_id}:role/archlens-lambda-execution-role"
      ]
    }

    dynamic "condition" {
      for_each = var.external_id != "" ? [1] : []
      content {
        test     = "StringEquals"
        variable = "sts:ExternalId"
        values   = [var.external_id]
      }
    }
  }
}

resource "aws_iam_role" "archlens_role" {
  name               = "ArchLens-Client-Scan-Role"
  description        = "Allows ArchLens to discover and visualize architecture in this account (read-only)"
  assume_role_policy = data.aws_iam_policy_document.archlens_trust.json
}

resource "aws_iam_role_policy_attachment" "security_audit" {
  role       = aws_iam_role.archlens_role.name
  policy_arn = "arn:aws:iam::aws:policy/SecurityAudit"
}

resource "aws_iam_role_policy_attachment" "read_only" {
  role       = aws_iam_role.archlens_role.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

output "archlens_role_arn" {
  description = "Enter this Role ARN in the ArchLens dashboard"
  value       = aws_iam_role.archlens_role.arn
}`;

export default function YourArchPage() {
  const navigate = useNavigate();
  const diagramRef = useRef<HTMLDivElement>(null);
  const {
    roleArn, setRoleArn,
    selectedRegion, setSelectedRegion,
    scanResult, setScanResult,
    currentStep, setCurrentStep, setLoading, isLoading,
    connectedAccounts, addConnectedAccount, removeConnectedAccount,
    savedScans, saveScan, deleteScan, loadScan, syncScansFromBackend,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    diagramViewMode, setDiagramViewMode,
    darkMode,
    user,
  } = useAppStore();

  useEffect(() => {
    syncScansFromBackend();
  }, []);

  // Ensure roleArn is always filled if an account exists or scanResult is loaded
  useEffect(() => {
    let activeRole = roleArn;
    if (!activeRole) {
      if (connectedAccounts.length > 0 && connectedAccounts[0].roleArn) {
        activeRole = connectedAccounts[0].roleArn;
      } else if (scanResult?.accountId) {
        activeRole = `arn:aws:iam::${scanResult.accountId}:role/archlens-client-readonly-role`;
      }
    }
    if (activeRole && activeRole.includes('arn:aws:iam://')) {
      activeRole = activeRole.replace('arn:aws:iam://', 'arn:aws:iam::');
    }
    if (activeRole && activeRole !== roleArn) {
      setRoleArn(activeRole);
    }
  }, [roleArn, connectedAccounts, scanResult, setRoleArn]);

  const [externalId, setExternalId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewMode, setViewMode] = useState<'diagram' | 'table'>('diagram');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [onboardingTab, setOnboardingTab] = useState<'trust' | 'cft' | 'terraform'>('trust');
  const [copiedTrust, setCopiedTrust] = useState(false);
  const [copiedCft, setCopiedCft] = useState(false);
  const [copiedTf, setCopiedTf] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newRoleArn, setNewRoleArn] = useState('');
  const [showScanHistory, setShowScanHistory] = useState(false);

  // Step Functions orchestration (SOW Section 6) — manual approval at each gate
  const [wfArn, setWfArn] = useState('');
  const [wfStatus, setWfStatus] = useState('');
  const [wfRunning, setWfRunning] = useState(false);
  const [wfPending, setWfPending] = useState<{ token: string; receiptHandle?: string; message?: string } | null>(null);

  // Discovery error state (shows the real failure reason, not a dummy value)
  const [scanError, setScanError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const discoveryCancelledRef = useRef(false);

  function handleCancelDiscovery() {
    discoveryCancelledRef.current = true;
    setLoading(false);
    setCurrentStep('idle');
    toast('Architecture discovery cancelled', { icon: 'ℹ️' });
  }

  // Tag-based grouping (SOW Section 4.2)
  const [groupByTag, setGroupByTag] = useState('');

  // Diagram annotations / notes (SOW Section 4.2) — persisted per scan
  const notesKey = scanResult ? `archlens-notes-${scanResult.scanId}` : '';
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    if (notesKey) setNotes(localStorage.getItem(notesKey) || '');
  }, [notesKey]);
  function saveNotes(v: string) {
    setNotes(v);
    if (notesKey) localStorage.setItem(notesKey, v);
  }

  // Available tag keys across discovered resources
  const tagKeys = (() => {
    const keys = new Set<string>();
    for (const r of scanResult?.resources || []) {
      const tags = (r as unknown as { tags?: Record<string, string> }).tags || {};
      Object.keys(tags).forEach((k) => keys.add(k));
    }
    return Array.from(keys).sort();
  })();

  // Group resources by the selected tag value
  const tagGroups = (() => {
    if (!groupByTag) return null;
    const groups: Record<string, number> = {};
    for (const r of scanResult?.resources || []) {
      const tags = (r as unknown as { tags?: Record<string, string> }).tags || {};
      const val = tags[groupByTag] || '(untagged)';
      groups[val] = (groups[val] || 0) + 1;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  })();

  function copyToClipboard(text: string, type: 'trust' | 'cft' | 'tf') {
    navigator.clipboard.writeText(text);
    if (type === 'trust') {
      setCopiedTrust(true);
      setTimeout(() => setCopiedTrust(false), 2000);
    } else if (type === 'cft') {
      setCopiedCft(true);
      setTimeout(() => setCopiedCft(false), 2000);
    } else {
      setCopiedTf(true);
      setTimeout(() => setCopiedTf(false), 2000);
    }
    toast.success('Copied to clipboard!');
  }

  function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }

  async function handleRunWorkflow() {
    let targetArn = (roleArn || '').trim();
    if (targetArn.startsWith('arn:aws:iam://')) {
      targetArn = targetArn.replace('arn:aws:iam://', 'arn:aws:iam::');
      setRoleArn(targetArn);
    }
    if (!targetArn) {
      toast.error('Please enter the IAM Role ARN');
      return;
    }
    setWfRunning(true);
    setWfStatus('STARTING');
    try {
      const res = await workflow({
        action: 'start',
        roleArn: targetArn,
        region: selectedRegion === 'all' ? 'us-east-1' : selectedRegion,
        regions: selectedRegion === 'all' ? undefined : [selectedRegion],
        accountId: newAccountId || undefined,
        externalId: externalId || undefined,
      });
      if (res.error) {
        toast.error(res.error);
        setWfStatus('FAILED');
        setWfRunning(false);
        return;
      }
      const arn = (res.data as { executionArn: string }).executionArn;
      setWfArn(arn);
      setWfStatus('RUNNING');
      toast.success('Workflow started — orchestrating Discover → Analyze → Deploy.');
      pollWorkflow(arn);
    } catch {
      toast.error('Failed to start workflow.');
      setWfStatus('FAILED');
      setWfRunning(false);
    }
  }

  async function pollWorkflow(arn: string) {
    // Poll status. The workflow PAUSES at each human-approval gate and never
    // proceeds automatically — the user must approve each step (production-safe).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await workflow({ action: 'status', executionArn: arn });
      if (res.error) break;
      const d = res.data as {
        status: string;
        awaitingApproval?: boolean;
        pendingApproval?: { message?: string; taskToken?: string; receiptHandle?: string };
      };
      if (d.status === 'SUCCEEDED') {
        setWfStatus('Completed — all approved stages finished successfully.');
        setWfPending(null);
        toast.success('Workflow completed successfully.');
        break;
      }
      if (d.status === 'FAILED' || d.status === 'ABORTED') {
        setWfStatus(d.status === 'FAILED' ? 'Failed' : 'Stopped');
        setWfPending(null);
        break;
      }
      if (d.awaitingApproval && d.pendingApproval?.taskToken) {
        // Populate the UI immediately so the user can inspect their architecture while approving
        const disc = (d.pendingApproval as any).discoveryResult;
        if (disc) {
          try {
            const parsed = typeof disc.body === 'string' ? JSON.parse(disc.body) : (disc.body || disc);
            if (parsed && (parsed.resources || parsed.scanId)) {
              finalizeDiscovery(parsed);
            }
          } catch (e) {
            console.warn('Could not parse discoveryResult from workflow approval:', e);
          }
        }

        // Pause for manual approval — stop polling and wait for the user.
        setWfStatus(`Awaiting your approval — ${d.pendingApproval.message || 'review and continue'}`);
        setWfPending({ token: d.pendingApproval.taskToken, receiptHandle: d.pendingApproval.receiptHandle, message: d.pendingApproval.message });
        setWfRunning(false);
        return;
      }
      setWfStatus('Running — please wait…');
    }
    setWfRunning(false);
  }

  async function handleApproveWorkflowStep() {
    if (!wfPending) return;
    setWfRunning(true);
    setWfStatus('Approved — continuing…');
    const res = await workflow({
      action: 'resume',
      taskToken: wfPending.token,
      receiptHandle: wfPending.receiptHandle,
      output: {
        approved: true,
        pillars: [
          'operational_excellence',
          'security',
          'reliability',
          'performance_efficiency',
          'cost_optimization',
          'sustainability',
        ],
      },
    });
    setWfPending(null);
    if (res.error) {
      toast.error(res.error);
      setWfRunning(false);
      return;
    }
    pollWorkflow(wfArn);
  }

  // Persist a completed discovery result to the UI + scan history.
  function finalizeDiscovery(rawData: any) {
    if (!rawData) return;
    let data = rawData;
    if (data && typeof data === 'object' && 'body' in data) {
      try {
        data = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
      } catch (e) {
        console.warn('Could not parse body in finalizeDiscovery:', e);
      }
    }

    const safeResources = Array.isArray(data?.resources) ? data.resources : [];
    const safeRelationships = Array.isArray(data?.relationships) ? data.relationships : [];
    const safeSummary = data?.summary || {
      total_resources: safeResources.length,
      total_relationships: safeRelationships.length,
      by_type: {},
      regions_scanned: Array.isArray(data?.regions) ? data.regions : [selectedRegion],
    };
    if (!safeSummary.by_type) safeSummary.by_type = {};
    if (safeSummary.total_resources === undefined) safeSummary.total_resources = safeResources.length;

    const normalizedScanResult = {
      ...data,
      scanId: data?.scanId || `scan-${Date.now()}`,
      accountId: data?.accountId || '',
      timestamp: data?.timestamp || new Date().toISOString(),
      resources: safeResources,
      relationships: safeRelationships,
      summary: safeSummary,
    };

    setScanResult(normalizedScanResult);
    setCurrentStep('discovered');
    const accountName = connectedAccounts.find((a) => a.roleArn === roleArn)?.accountName || 'My Account';
    const totalCount = safeSummary.total_resources ?? safeResources.length;

    saveScan({
      scanId: normalizedScanResult.scanId,
      accountName,
      accountId: normalizedScanResult.accountId,
      region: selectedRegion,
      timestamp: normalizedScanResult.timestamp,
      resourceCount: totalCount,
      scanResult: normalizedScanResult,
    });

    if (normalizedScanResult.accountId && !connectedAccounts.some((a) => a.accountId === normalizedScanResult.accountId)) {
      addConnectedAccount({
        accountName,
        accountId: normalizedScanResult.accountId,
        roleArn,
        externalId: externalId || undefined,
      });
    }
    toast.success(`Discovered ${totalCount} resources.`);
  }

  async function handleDiscover() {
    let targetArn = (roleArn || '').trim();
    if (targetArn.startsWith('arn:aws:iam://')) {
      targetArn = targetArn.replace('arn:aws:iam://', 'arn:aws:iam::');
      setRoleArn(targetArn);
    }

    if (!targetArn) {
      toast.error('Please enter the IAM Role ARN');
      return;
    }

    if (!targetArn.startsWith('arn:aws:iam::') || !targetArn.includes(':role/')) {
      toast.error('Invalid Role ARN format. Expected: arn:aws:iam::<account-id>:role/<role-name>');
      return;
    }

    setLoading(true);
    setCurrentStep('discovering');
    setScanError(null);
    useAppStore.getState().setAnalysisResult(null);
    discoveryCancelledRef.current = false;

    try {
      const regions = selectedRegion === 'all'
        ? AWS_REGIONS.map(r => r.code)
        : [selectedRegion];

      const response = await discoverResources({
        roleArn: targetArn,
        region: selectedRegion === 'all' ? 'us-east-1' : selectedRegion,
        regions,
        ...(externalId && { externalId }),
        ...(user?.email && { userEmail: user.email }),
      });

      if (discoveryCancelledRef.current) return;

      if (response.error) {
        // Show the actual backend error (never a dummy/sample message).
        setScanError(response.error);
        toast.error('Architecture discovery failed.');
        setCurrentStep('idle');
      } else {
        const data = response.data as any;
        // If the scan was handed off asynchronously via SQS
        if (data.status === 'in_progress' && data.scanId) {
          const scanId = data.scanId;
          const accountId = data.accountId;
          const intervalMs = Number(data.pollIntervalSeconds) * 1000;
          let done = false;

          // Poll every 5s for up to 60 attempts (300 seconds max)
          for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
            if (discoveryCancelledRef.current) return;
            const statusRes = await getScanStatus(scanId, accountId);
            if (statusRes.data?.status === 'completed') {
              const fullScan = await getScan(scanId);
              if (fullScan.data && !fullScan.error) {
                finalizeDiscovery(fullScan.data);
                done = true;
                break;
              }
            } else if (statusRes.data?.status === 'failed') {
              setScanError(statusRes.data?.error || 'Multi-region discovery encountered an error.');
              toast.error('Architecture discovery failed.');
              setCurrentStep('idle');
              done = true;
              break;
            }
          }
          if (!done) {
            // Check one last time before stopping
            const finalCheck = await getScan(scanId);
            if (finalCheck.data && !finalCheck.error) {
              finalizeDiscovery(finalCheck.data);
            } else {
              setScanError('Discovery is still processing in the background. Please refresh in a moment.');
              setCurrentStep('idle');
            }
          }
        } else {
          finalizeDiscovery(data);
        }
      }
    } catch (error) {
      // Capture the real error message for troubleshooting.
      const msg = error instanceof Error ? error.message : 'Network error while contacting the discovery service.';
      setScanError(msg);
      toast.error('Architecture discovery failed.');
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

  function handleSelectAccount(account: { roleArn: string; externalId?: string }) {
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
      const exportBg = darkMode ? '#0b1120' : '#FFFFFF';

      const nodeEls = Array.from(element.querySelectorAll('.react-flow__node')) as HTMLElement[];
      if (nodeEls.length === 0) {
        toast.error('Diagram not ready');
        return;
      }

      // Read current viewport transform (scale) accurately
      const viewRect = viewport.getBoundingClientRect();
      const transform = window.getComputedStyle(viewport).transform;
      let scale = 1;
      if (transform && transform !== 'none') {
        const m = new DOMMatrixReadOnly(transform);
        scale = m.a || 1;
      }

      // Compute exact node bounds in unscaled flow coordinates using getBoundingClientRect
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodeEls.forEach((n) => {
        const r = n.getBoundingClientRect();
        const left = (r.left - viewRect.left) / scale;
        const top = (r.top - viewRect.top) / scale;
        const right = left + r.width / scale;
        const bottom = top + r.height / scale;

        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, right);
        maxY = Math.max(maxY, bottom);
      });

      const pad = 60;
      const graphW = Math.max(Math.ceil(maxX - minX + pad * 2), 800);
      const graphH = Math.max(Math.ceil(maxY - minY + pad * 2), 600);

      const opts = {
        backgroundColor: exportBg,
        pixelRatio: 2,
        cacheBust: true,
        width: graphW,
        height: graphH,
        style: {
          transform: `translate(${pad - minX}px, ${pad - minY}px) scale(1)`,
          transformOrigin: 'top left',
          width: `${graphW}px`,
          height: `${graphH}px`,
        },
      };

      if (format === 'png') {
        const dataUrl = await toPng(viewport, opts);
        triggerDownload(dataUrl, `archlens-architecture-${scanId}.png`);
        toast.success('PNG downloaded successfully!');
      } else if (format === 'svg') {
        const dataUrl = await toSvg(viewport, opts);
        triggerDownload(dataUrl, `archlens-architecture-${scanId}.svg`);
        toast.success('SVG downloaded successfully!');
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
        toast.success('PDF downloaded successfully!');
      }
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
      const rows = (scanResult.resources || []).map(r => [
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

  const [filterRegion, setFilterRegion] = useState('all');

  const discoveredRegions = [...new Set((scanResult?.resources || []).map(r => r.region).filter(Boolean))].sort();

  // Filter resources based on search, type, and region
  const filteredResources = (scanResult?.resources || []).filter(r => {
    const matchesSearch = !searchQuery ||
      r.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.type?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || r.type === filterType;
    const matchesRegion = filterRegion === 'all' || r.region === filterRegion;
    return matchesSearch && matchesType && matchesRegion;
  });

  const resourceTypes = [...new Set((scanResult?.resources || []).map(r => r.type) || [])].sort();

  const effectiveAccounts = connectedAccounts.length > 0 ? connectedAccounts.map(a => ({
    ...a,
    roleArn: (a.roleArn || '').replace('arn:aws:iam://', 'arn:aws:iam::'),
  })) : (scanResult?.accountId ? [{
    id: `acc-${scanResult.accountId}`,
    accountName: 'Production AWS Account',
    accountId: scanResult.accountId,
    roleArn: (roleArn || `arn:aws:iam::${scanResult.accountId}:role/archlens-client-readonly-role`).replace('arn:aws:iam://', 'arn:aws:iam::'),
    addedAt: scanResult.timestamp || new Date().toISOString(),
  }] : []);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Enterprise Clean Progress Modal */}
      <ProgressBarModal
        isOpen={isLoading && currentStep === 'discovering'}
        title="Discovering Cloud Architecture..."
        subtitle="Scanning connected AWS account resources, please wait..."
        onCancel={handleCancelDiscovery}
      />

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOnboardingModal(true)}
              className="btn-secondary text-sm flex items-center gap-1.5 text-primary-400 border-primary-500/30 hover:border-primary-500/60"
            >
              <BookOpenIcon className="w-4 h-4" /> Client Setup Guide (CFT &amp; Trust Policy)
            </button>
            <button onClick={() => setShowAddAccount(!showAddAccount)} className="btn-secondary text-sm flex items-center gap-1">
              <PlusIcon className="w-4 h-4" /> Save Account
            </button>
          </div>
        </div>

        {/* Active Connected Account Banner (In sync with Executive Dashboard) */}
        {(effectiveAccounts.length > 0 || scanResult) && (
          <div className="mb-5 p-3.5 bg-gradient-to-r from-emerald-500/10 via-dark-800 to-dark-900 border border-emerald-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Connected AWS Account:</span>
                  <span className="text-sm font-mono font-bold text-white">
                    {scanResult?.accountId || effectiveAccounts[0]?.accountId || 'Not Connected'}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Synchronized with Executive Dashboard • {scanResult ? `${scanResult.resources?.length || scanResult.summary?.total_resources || 0} resources discovered in ${scanResult.regions?.[0] || selectedRegion}` : 'Ready for architecture discovery'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-xs text-gray-400">Active IAM Role:</span>
              <code className="text-xs text-primary-300 bg-dark-900/90 px-2.5 py-1 rounded-md border border-dark-700 font-mono" title={roleArn || effectiveAccounts[0]?.roleArn}>
                {((roleArn || effectiveAccounts[0]?.roleArn || (scanResult?.accountId ? `arn:aws:iam::${scanResult.accountId}:role/archlens-client-readonly-role` : 'None')).split('/').pop())}
              </code>
            </div>
          </div>
        )}

        {/* Saved Accounts */}
        {effectiveAccounts.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saved AWS Accounts ({effectiveAccounts.length})</p>
              <span className="text-[11px] text-gray-500">Click any account to auto-fill</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {effectiveAccounts.map((account) => {
                const isSelected = (roleArn && account.roleArn && (roleArn === account.roleArn || roleArn.includes(account.accountId))) || (effectiveAccounts.length === 1);
                return (
                  <div
                    key={account.id}
                    onClick={() => handleSelectAccount(account)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between group relative ${
                      isSelected
                        ? 'border-primary-500 bg-primary-500/10 shadow-sm shadow-primary-500/20 ring-1 ring-primary-500/30'
                        : 'border-dark-700 bg-dark-900/80 hover:border-dark-600 hover:bg-dark-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-semibold text-sm text-white truncate group-hover:text-primary-300 transition-colors">
                        {account.accountName}
                      </span>
                      {connectedAccounts.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeConnectedAccount(account.id); }}
                          className="text-gray-500 hover:text-red-400 p-1 rounded-md transition-colors"
                          title="Remove saved account"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="text-xs font-mono text-gray-400 space-y-0.5">
                      <p className="flex items-center justify-between">
                        <span className="text-gray-500 font-sans text-[11px]">ID:</span>
                        <span>{account.accountId || '—'}</span>
                      </p>
                      <p className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500 font-sans">Role:</span>
                        <span className="truncate max-w-[150px] text-gray-300" title={account.roleArn}>
                          {account.roleArn.split('/').pop() || account.roleArn}
                        </span>
                      </p>
                    </div>
                    {isSelected && (
                      <span className="absolute top-2 right-8 text-[10px] font-bold uppercase tracking-wider text-primary-400 bg-primary-500/20 px-1.5 py-0.5 rounded">
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Role ARN Input */}
          <div className="lg:col-span-6">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              IAM Role ARN <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              className="input-field font-mono text-sm"
              placeholder="arn:aws:iam::123456789012:role/ArchLens-Client-Scan-Role"
            />
          </div>

          {/* External ID Input */}
          <div className="lg:col-span-3">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              External ID <span className="text-gray-500 text-xs font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              className="input-field font-mono text-sm"
              placeholder="e.g., client-secret-id"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Protects against AWS Confused Deputy. Use if your role requires sts:ExternalId.
            </p>
          </div>

          {/* Region Selector */}
          <div className="lg:col-span-3">
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
        <div className="mt-6 flex flex-wrap items-center gap-3">
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

          {/* Run via Step Functions workflow (SOW Section 6 orchestration) */}
          <button
            onClick={handleRunWorkflow}
            disabled={wfRunning || !roleArn}
            className="btn-secondary px-6 py-3 flex items-center gap-2"
            title="Run the full lifecycle (Discover → Analyze → Generate → Backup → Deploy) as an orchestrated Step Functions workflow"
          >
            {wfRunning ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Orchestrating…
              </>
            ) : (
              <>
                <Cog6ToothIcon className="w-5 h-5" />
                Run via Workflow
              </>
            )}
          </button>
        </div>

        {/* Workflow status strip */}
        {wfStatus && (
          <div className="mt-4 p-3 bg-dark-900/70 border border-dark-700/50 rounded-lg flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${
              wfStatus.startsWith('Completed') ? 'bg-green-400'
              : wfStatus === 'Failed' || wfStatus === 'Stopped' ? 'bg-red-400'
              : 'bg-blue-400 animate-pulse'
            }`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-200">Guided workflow: <span className="font-medium">{wfStatus}</span></p>
              <p className="text-[11px] text-gray-500">
                Each stage — discovery, Well-Architected analysis, script generation, backup, and deployment — pauses for your explicit approval. No change is applied automatically.
              </p>
            </div>
            {wfPending && (
              <button onClick={handleApproveWorkflowStep} className="btn-primary text-sm flex-shrink-0">
                Review &amp; Approve
              </button>
            )}
          </div>
        )}

        {/* Discovery error state (shows the real failure reason) */}
        {scanError && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg flex-shrink-0">
                <InformationCircleIcon className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-300">
                  {scanError.includes('sts:AssumeRole')
                    ? 'Scan Failed: STS AssumeRole Access Denied (Trust Relationship Required)'
                    : 'Architecture Discovery Failed'}
                </p>
                <p className="text-sm text-gray-300 mt-1">
                  {scanError.includes('sts:AssumeRole') ? (
                    <>
                      Cross-Account Access Denied: The target role must add ArchLens account{' '}
                      <code className="px-1.5 py-0.5 bg-dark-900 rounded text-primary-300 font-mono text-xs">338920687491</code>{' '}
                      to its <strong>Trust Relationship</strong>.
                    </>
                  ) : (
                    scanError
                  )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {scanError.includes('sts:AssumeRole') && (
                    <button
                      onClick={() => setShowOnboardingModal(true)}
                      className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                    >
                      <BookOpenIcon className="w-3.5 h-3.5" />
                      View IAM Trust Setup Guide
                    </button>
                  )}
                  <button onClick={handleDiscover} className="btn-secondary text-xs flex items-center gap-1 py-1 px-3">
                    Retry Scan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
                  Account: {scanResult.accountId} | Scanned: {new Date(scanResult.timestamp).toLocaleString()} | Resources: {scanResult.summary?.total_resources ?? scanResult.resources?.length ?? 0}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/redefine')} className="btn-primary flex items-center gap-1 text-sm">
                  Analyze with AWS Well-Architected Framework →
                </button>
              </div>
            </div>

            {/* Resource Type Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Object.entries(scanResult.summary?.by_type || {})
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([type, count]) => (
                  <div
                    key={type}
                    className="bg-dark-900 rounded-lg p-3 border border-dark-700 text-center hover:border-primary-500/50 transition-colors cursor-pointer"
                    onClick={() => setFilterType(filterType === type ? 'all' : type)}
                  >
                    <img
                      src={getServiceIconPath(type, darkMode)}
                      alt=""
                      aria-hidden="true"
                      className="w-9 h-9 mx-auto mb-2 object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                    <p className="text-xl font-bold text-white">{count as number}</p>
                    <p className="text-xs text-gray-400">{type}</p>
                  </div>
                ))}
            </div>

            {/* Multi-Region Footprint Breakdown */}
            {discoveredRegions.length > 1 && (
              <div className="mt-4 pt-3 border-t border-dark-700/60">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2.5">
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <GlobeAltIcon className="w-3.5 h-3.5 text-primary-400" />
                    Discovered Regions ({discoveredRegions.length})
                  </span>
                  <span className="text-[11px] text-gray-500">Click a region to filter resources in table or view below</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {discoveredRegions.map((reg) => {
                    const count = (scanResult.resources || []).filter((r) => r.region === reg).length;
                    const isSelected = filterRegion === reg;
                    return (
                      <button
                        key={reg}
                        onClick={() => {
                          setFilterRegion(filterRegion === reg ? 'all' : reg);
                          setViewMode('table');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-primary-500/20 border-primary-500 text-primary-300 shadow-sm'
                            : 'bg-dark-900 border-dark-700 text-gray-300 hover:border-dark-600 hover:text-white'
                        }`}
                        title={`Filter to ${reg}`}
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="font-mono">{reg}</span>
                        <span className="px-1.5 py-0.2 rounded bg-dark-800 text-[10px] text-gray-400 font-bold">{count}</span>
                      </button>
                    );
                  })}
                  {filterRegion !== 'all' && (
                    <button
                      onClick={() => setFilterRegion('all')}
                      className="text-xs text-primary-400 hover:text-primary-300 underline ml-1 self-center"
                    >
                      Show All Regions
                    </button>
                  )}
                </div>
              </div>
            )}
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
                {(['logical', 'network', 'dataflow', 'cost', 'security'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => {
                      setDiagramViewMode(mode);
                      useAppStore.getState().setDiagramViewMode(mode);
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      diagramViewMode === mode
                        ? 'bg-primary-500 text-white shadow-sm font-semibold'
                        : 'text-gray-400 hover:text-white hover:bg-dark-700/60'
                    }`}
                  >
                    {mode === 'dataflow' ? 'Data Flow' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}

                {/* Tag-Based Grouping (SOW 4.2) */}
                {tagKeys.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-dark-700">
                    <span className="text-xs text-gray-500">Group by tag:</span>
                    <select
                      value={groupByTag}
                      onChange={(e) => setGroupByTag(e.target.value)}
                      className="bg-dark-900 border border-dark-600 rounded px-2 py-1 text-xs text-gray-200"
                    >
                      <option value="">None</option>
                      {tagKeys.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Tag group summary */}
            {viewMode === 'diagram' && tagGroups && (
              <div className="mb-4 flex flex-wrap gap-2">
                {tagGroups.map(([val, count]) => (
                  <span key={val} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-dark-900 border border-dark-700/50 text-gray-300">
                    <span className="font-medium text-primary-400">{val}</span>
                    <span className="text-gray-500">{count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Architecture Diagram */}
            {viewMode === 'diagram' && (
              <div ref={diagramRef} key={`diagram-${darkMode}-${diagramViewMode}`} className="h-[650px] w-full rounded-xl overflow-hidden border border-dark-700/50">
                <ArchitectureDiagram
                  resources={scanResult.resources || []}
                  relationships={scanResult.relationships || []}
                  servicesFootprint={scanResult.servicesFootprint || []}
                  viewMode={diagramViewMode}
                  accountId={scanResult.accountId}
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
                  {discoveredRegions.length > 1 && (
                    <div className="flex items-center gap-1">
                      <GlobeAltIcon className="w-4 h-4 text-gray-500" />
                      <select
                        value={filterRegion}
                        onChange={(e) => setFilterRegion(e.target.value)}
                        className="select-field text-sm w-auto"
                      >
                        <option value="all">All Regions ({discoveredRegions.length})</option>
                        {discoveredRegions.map(reg => (
                          <option key={reg} value={reg}>{reg}</option>
                        ))}
                      </select>
                    </div>
                  )}
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
      {/* Client Account Onboarding Guide Modal */}
      {showOnboardingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border-primary-500/40">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-dark-700">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="w-6 h-6 text-primary-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Client Account Setup Guide</h3>
                  <p className="text-xs text-gray-400">Grant read-only discovery permissions to ArchLens</p>
                </div>
              </div>
              <button
                onClick={() => setShowOnboardingModal(false)}
                className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="p-4 bg-primary-500/10 border border-primary-500/20 rounded-xl text-xs text-primary-200">
                <strong className="text-white block mb-2 text-sm font-semibold">How to Create the Read-Only IAM Role</strong>
                <ol className="list-decimal list-inside space-y-2 text-gray-200">
                  <li>Open the <strong>AWS IAM Console</strong> in your target AWS account.</li>
                  <li>Navigate to <strong>Roles</strong> &rarr; Click <strong>Create role</strong>.</li>
                  <li>Select <strong>AWS account</strong> &rarr; Choose <strong>Another AWS account</strong> &rarr; Enter ArchLens Account ID: <code className="px-2 py-0.5 bg-dark-950 rounded text-primary-300 font-mono font-bold">338920687491</code>.</li>
                  <li>In permissions, attach the official AWS managed policy: <code className="font-mono text-emerald-300 font-semibold">ReadOnlyAccess</code>.</li>
                  <li>Name the role <code className="font-mono text-emerald-300 font-semibold">ArchLensCrossAccountRole</code> and click <strong>Create role</strong>.</li>
                  <li>Copy the generated Role ARN and paste it into the ArchLens scan input field above.</li>
                </ol>
              </div>

              <div className="p-4 bg-dark-900 border border-dark-700/60 rounded-xl text-xs text-gray-300">
                <strong className="text-white block mb-1 font-semibold">For an Existing IAM Role</strong>
                <p className="mb-2 text-gray-300">If you already have a designated read-only role, simply add ArchLens to its Trust Relationship policy:</p>
                <div className="relative mt-2">
                  <div className="flex items-center justify-between bg-dark-950 px-3 py-1.5 rounded-t-lg border-t border-x border-dark-700">
                    <span className="text-xs font-mono text-gray-400">TrustRelationship.json</span>
                    <button
                      onClick={() => copyToClipboard(TRUST_POLICY_JSON, 'trust')}
                      className="btn-secondary text-xs flex items-center gap-1 py-1 px-2.5"
                    >
                      {copiedTrust ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <DocumentDuplicateIcon className="w-3.5 h-3.5" />}
                      {copiedTrust ? 'Copied!' : 'Copy Policy'}
                    </button>
                  </div>
                  <pre className="p-4 bg-dark-950 border border-dark-700 rounded-b-lg font-mono text-xs text-green-400 overflow-x-auto">
                    {TRUST_POLICY_JSON}
                  </pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-dark-700 flex justify-end">
              <button
                onClick={() => setShowOnboardingModal(false)}
                className="btn-secondary text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
