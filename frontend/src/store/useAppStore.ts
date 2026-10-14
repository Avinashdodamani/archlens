/**
 * Global application state management using Zustand with persistence.
 * Scan history persists across sessions using localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listScans, getScan, deleteScanRecord } from '../services/api';

interface Resource {
  type: string;
  id: string;
  name: string;
  region?: string;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

interface Relationship {
  source: string;
  source_type: string;
  target: string;
  target_type: string;
  relationship: string;
}

interface ScanResult {
  scanId: string;
  accountId: string;
  regions: string[];
  timestamp: string;
  resources: Resource[];
  relationships: Relationship[];
  costTrend?: { month: string; cost_usd: number }[];
  servicesFootprint?: { service: string; monthly_cost_usd: number }[];
  summary: {
    total_resources: number;
    total_relationships: number;
    by_type: Record<string, number>;
    regions_scanned: string[];
  };
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  pillar: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  effort_hours: number;
  risk_score: number;
  downtime_required: string;
  monthly_cost_impact: number;
  confidence: number;
  current_state: string;
  proposed_state: string;
  implementation_steps: string[];
  rollback_plan: string;
  affected_resources: string[];
  aws_services_involved?: string[];
  waf_question?: string;
}

interface AnalysisResult {
  recommendationId: string;
  scanId: string;
  pillars: string[];
  timestamp: string;
  analysis: {
    summary: string;
    overall_score: number;
    pillar_scores: Record<string, { score: number; status: string; top_risk?: string }>;
    recommendations: Recommendation[];
    architecture_changes: Array<{
      action: string;
      resource_type: string;
      resource_name: string;
      description: string;
      connects_to?: string[];
      pillar?: string;
    }>;
    cost_analysis?: {
      current_estimated_monthly_usd: number;
      projected_monthly_usd: number;
      net_monthly_impact_usd: number;
      roi_timeline_months: number;
    };
    risk_summary?: {
      critical_findings: number;
      high_findings: number;
      medium_findings: number;
      low_findings: number;
      immediate_actions_required: string[];
    };
  };
}

interface BackupResult {
  scanId: string;
  timestamp: string;
  total_resources: number;
  backups_taken: number;
  backups_failed: number;
  backups: Array<{
    resource_type: string;
    resource_id: string;
    backup_type: string;
    status: string;
    backup_id?: string;
    restore_info?: string;
    error?: string;
  }>;
}

interface ScriptResult {
  status: string;
  template?: string;
  files?: Record<string, string>;
  downloadUrl?: string;
  downloadUrls?: Record<string, string>;
  s3Key?: string;
  s3Keys?: Record<string, string>;
  templateType: string;
  format: string;
}

// Connected AWS account record
interface ConnectedAccount {
  id: string;
  accountName: string;
  accountId: string;
  roleArn: string;
  externalId?: string;
  addedAt: string;
  lastScanned?: string;
}

// Saved scan record
interface SavedScan {
  scanNumber: number;
  scanId: string;
  accountName: string;
  accountId: string;
  region: string;
  timestamp: string;
  resourceCount: number;
  scanResult: ScanResult;
}

type WorkflowStep =
  | 'idle'
  | 'discovering'
  | 'discovered'
  | 'analyzing'
  | 'analyzed'
  | 'generating_scripts'
  | 'scripts_ready'
  | 'backing_up'
  | 'backup_complete'
  | 'deploying'
  | 'monitoring'
  | 'success'
  | 'failed'
  | 'rolling_back';

type DiagramViewMode = 'logical' | 'network' | 'dataflow' | 'cost' | 'security';

interface AppState {
  // Authentication
  isAuthenticated: boolean;
  user: { email: string; name: string } | null;

  // Connected accounts
  connectedAccounts: ConnectedAccount[];
  activeAccountId: string;

  // Connection
  roleArn: string;
  selectedRegion: string;
  selectedRegions: string[];
  accountId: string;

  // Workflow state
  currentStep: WorkflowStep;
  isLoading: boolean;
  error: string | null;

  // Data
  scanResult: ScanResult | null;
  analysisResult: AnalysisResult | null;
  cftResult: ScriptResult | null;
  terraformResult: ScriptResult | null;
  backupResult: BackupResult | null;
  selectedPillars: string[];

  // UI
  activeTab: string;
  darkMode: boolean;
  sidebarCollapsed: boolean;
  diagramViewMode: DiagramViewMode;
  searchQuery: string;
  filterType: string;

  // Scan history (persisted)
  savedScans: SavedScan[];
  nextScanNumber: number;

  // Actions
  setAuth: (isAuthenticated: boolean, user: { email: string; name: string } | null) => void;
  setRoleArn: (arn: string) => void;
  setSelectedRegion: (region: string) => void;
  setSelectedRegions: (regions: string[]) => void;
  setAccountId: (id: string) => void;
  setCurrentStep: (step: WorkflowStep) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setScanResult: (result: ScanResult | null) => void;
  setAnalysisResult: (result: AnalysisResult | null) => void;
  setCftResult: (result: ScriptResult | null) => void;
  setTerraformResult: (result: ScriptResult | null) => void;
  setBackupResult: (result: BackupResult | null) => void;
  setSelectedPillars: (pillars: string[]) => void;
  setActiveTab: (tab: string) => void;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
  setDiagramViewMode: (mode: DiagramViewMode) => void;
  setSearchQuery: (query: string) => void;
  setFilterType: (type: string) => void;

  // Account management
  addConnectedAccount: (account: Omit<ConnectedAccount, 'id' | 'addedAt'>) => void;
  removeConnectedAccount: (id: string) => void;
  setActiveAccount: (id: string) => void;

  // Scan management
  saveScan: (scan: Omit<SavedScan, 'scanNumber'>) => void;
  deleteScan: (scanNumber: number) => Promise<void> | void;
  loadScan: (scanNumber: number) => Promise<void> | void;
  syncScansFromBackend: () => Promise<void>;

  reset: () => void;
}

const initialState = {
  isAuthenticated: false,
  user: null,
  connectedAccounts: [] as ConnectedAccount[],
  activeAccountId: '',
  roleArn: '',
  selectedRegion: 'ap-south-1',
  selectedRegions: [],
  accountId: '',
  currentStep: 'idle' as WorkflowStep,
  isLoading: false,
  error: null,
  scanResult: null,
  analysisResult: null,
  cftResult: null,
  terraformResult: null,
  backupResult: null,
  selectedPillars: [],
  activeTab: 'dashboard',
  darkMode: true,
  sidebarCollapsed: false,
  diagramViewMode: 'logical' as DiagramViewMode,
  searchQuery: '',
  filterType: 'all',
  savedScans: [] as SavedScan[],
  nextScanNumber: 1,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setAuth: (isAuthenticated, user) => set({ isAuthenticated, user }),
      setRoleArn: (roleArn) => {
        const cleaned = (roleArn || '').replace('arn:aws:iam://', 'arn:aws:iam::').trim();
        set({ roleArn: cleaned });
      },
      setSelectedRegion: (selectedRegion) => set({ selectedRegion }),
      setSelectedRegions: (selectedRegions) => set({ selectedRegions }),
      setAccountId: (accountId) => set({ accountId }),
      setCurrentStep: (currentStep) => set({ currentStep }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setScanResult: (scanResult) => set({ scanResult }),
      setAnalysisResult: (analysisResult) => set({ analysisResult }),
      setCftResult: (cftResult) => set({ cftResult }),
      setTerraformResult: (terraformResult) => set({ terraformResult }),
      setBackupResult: (backupResult) => set({ backupResult }),
      setSelectedPillars: (selectedPillars) => set({ selectedPillars }),
      setActiveTab: (activeTab) => set({ activeTab }),
      toggleDarkMode: () => {
        const newMode = !get().darkMode;
        if (newMode) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        set({ darkMode: newMode });
      },
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setDiagramViewMode: (diagramViewMode) => set({ diagramViewMode }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setFilterType: (filterType) => set({ filterType }),

      // Account management
      addConnectedAccount: (account) => set((state) => ({
        connectedAccounts: [
          ...state.connectedAccounts,
          {
            ...account,
            id: `acc-${Date.now()}`,
            addedAt: new Date().toISOString(),
          },
        ],
      })),
      removeConnectedAccount: (id) => set((state) => ({
        connectedAccounts: state.connectedAccounts.filter(a => a.id !== id),
      })),
      setActiveAccount: (id) => {
        const account = get().connectedAccounts.find(a => a.id === id);
        if (account) {
          set({
            activeAccountId: id,
            roleArn: account.roleArn,
            accountId: account.accountId,
          });
        }
      },

      // Scan management — backed by AWS DynamoDB + S3, cached in store.
      syncScansFromBackend: async () => {
        try {
          const res = await listScans();
          if (res.data?.scans && Array.isArray(res.data.scans) && res.data.scans.length > 0) {
            const rawScans = res.data.scans;
            const total = rawScans.length;
            const mapped: SavedScan[] = rawScans.map((s, idx) => {
              let parsedSummary: Record<string, number> = {};
              try {
                if (typeof s.summary === 'string') {
                  parsedSummary = JSON.parse(s.summary);
                } else if (s.summary && typeof s.summary === 'object') {
                  parsedSummary = s.summary as Record<string, number>;
                }
              } catch {
                parsedSummary = {};
              }

              const resCount = Number(s.resourceCount || 0);
              const regionsList = Array.isArray(s.regions) ? s.regions : [String(s.regions || 'ap-south-1')];

              return {
                scanNumber: total - idx,
                scanId: s.scanId,
                accountName: get().connectedAccounts.find((a) => a.accountId === s.accountId)?.accountName || 'AWS Account',
                accountId: s.accountId,
                region: regionsList[0] || 'ap-south-1',
                timestamp: s.timestamp,
                resourceCount: resCount,
                scanResult: {
                  scanId: s.scanId,
                  accountId: s.accountId,
                  regions: regionsList,
                  timestamp: s.timestamp,
                  resources: [],
                  relationships: [],
                  summary: {
                    total_resources: resCount,
                    total_relationships: Number(s.relationshipCount || 0),
                    by_type: parsedSummary,
                    regions_scanned: regionsList,
                  },
                },
              };
            });

            // Ensure connected accounts and roleArn are populated
            const currentConnected = get().connectedAccounts;
            const primaryAccountId = mapped[0]?.accountId || get().accountId || '338920687491';
            const defaultRole = `arn:aws:iam::${primaryAccountId}:role/archlens-client-readonly-role`;

            let updatedAccounts = currentConnected.map(acc => ({
              ...acc,
              roleArn: (acc.roleArn || '').replace('arn:aws:iam://', 'arn:aws:iam::'),
            }));
            if (primaryAccountId && !updatedAccounts.some((a) => a.accountId === primaryAccountId)) {
              updatedAccounts.push({
                id: `acc-${primaryAccountId}`,
                accountName: 'Production AWS Account',
                accountId: primaryAccountId,
                roleArn: defaultRole,
                addedAt: mapped[0]?.timestamp || new Date().toISOString(),
              });
            }

            const rawRole = get().roleArn || updatedAccounts[0]?.roleArn || defaultRole;
            const currentRole = rawRole.replace('arn:aws:iam://', 'arn:aws:iam::');

            set({
              savedScans: mapped,
              nextScanNumber: total + 1,
              connectedAccounts: updatedAccounts,
              roleArn: currentRole,
              accountId: get().accountId || primaryAccountId,
              activeAccountId: get().activeAccountId || updatedAccounts[0]?.id,
            });

            // Automatically load the latest scan if scanResult is currently empty
            if (!get().scanResult && mapped.length > 0) {
              get().loadScan(mapped[0].scanNumber);
            }
          }
        } catch (e) {
          console.warn('Could not sync scans from AWS DynamoDB:', e);
        }
      },

      saveScan: (scan) => set((state) => {
        const issued = Math.max(
          state.nextScanNumber || 1,
          ...state.savedScans.map(s => s.scanNumber + 1),
          1,
        );
        return {
          savedScans: [
            { ...scan, scanNumber: issued },
            ...state.savedScans,
          ].slice(0, 100),
          nextScanNumber: issued + 1,
        };
      }),

      deleteScan: async (scanNumber) => {
        const target = get().savedScans.find((s) => s.scanNumber === scanNumber);
        if (target) {
          deleteScanRecord(target.scanId, target.accountId).catch((e) =>
            console.warn('Could not delete scan from DynamoDB:', e)
          );
        }
        set((state) => ({
          savedScans: state.savedScans.filter((s) => s.scanNumber !== scanNumber),
        }));
      },

      loadScan: async (scanNumber) => {
        const scan = get().savedScans.find((s) => s.scanNumber === scanNumber);
        if (!scan) return;

        const rawRole = get().roleArn || `arn:aws:iam::${scan.accountId}:role/archlens-client-readonly-role`;
        const targetRole = rawRole.replace('arn:aws:iam://', 'arn:aws:iam::');
        const existingAccounts = get().connectedAccounts.map(acc => ({
          ...acc,
          roleArn: (acc.roleArn || '').replace('arn:aws:iam://', 'arn:aws:iam::'),
        }));
        let updatedAccounts = [...existingAccounts];
        if (scan.accountId && !existingAccounts.some((a) => a.accountId === scan.accountId)) {
          updatedAccounts.push({
            id: `acc-${scan.accountId}`,
            accountName: scan.accountName || 'AWS Account',
            accountId: scan.accountId,
            roleArn: targetRole,
            addedAt: scan.timestamp,
          });
        }
        const activeAccId = updatedAccounts.find((a) => a.accountId === scan.accountId)?.id || updatedAccounts[0]?.id || `acc-${scan.accountId}`;

        // If full resources are already loaded into memory:
        if (scan.scanResult && scan.scanResult.resources && scan.scanResult.resources.length > 0) {
          set({
            scanResult: scan.scanResult,
            currentStep: 'discovered',
            accountId: scan.accountId,
            roleArn: targetRole,
            connectedAccounts: updatedAccounts,
            activeAccountId: activeAccId,
          });
          return;
        }

        // Otherwise, fetch the full scan details from S3:
        try {
          const res = await getScan(scan.scanId);
          if (res.data && Array.isArray((res.data as any).resources)) {
            const fullScan = res.data as ScanResult;
            set((state) => ({
              scanResult: fullScan,
              currentStep: 'discovered',
              accountId: scan.accountId,
              roleArn: targetRole,
              connectedAccounts: updatedAccounts,
              activeAccountId: activeAccId,
              savedScans: state.savedScans.map((s) =>
                s.scanNumber === scanNumber ? { ...s, scanResult: fullScan } : s
              ),
            }));
          } else {
            set({
              scanResult: scan.scanResult,
              currentStep: 'discovered',
              accountId: scan.accountId,
              roleArn: targetRole,
              connectedAccounts: updatedAccounts,
              activeAccountId: activeAccId,
            });
          }
        } catch {
          set({
            scanResult: scan.scanResult,
            currentStep: 'discovered',
            accountId: scan.accountId,
            roleArn: targetRole,
            connectedAccounts: updatedAccounts,
            activeAccountId: activeAccId,
          });
        }
      },

      reset: () => set({ ...initialState, savedScans: get().savedScans, nextScanNumber: get().nextScanNumber, connectedAccounts: get().connectedAccounts }),
    }),
    {
      name: 'archlens-storage',
      partialize: (state) => ({
        savedScans: state.savedScans,
        nextScanNumber: state.nextScanNumber,
        connectedAccounts: state.connectedAccounts,
        activeAccountId: state.activeAccountId,
        roleArn: state.roleArn,
        accountId: state.accountId,
        selectedRegion: state.selectedRegion,
        darkMode: state.darkMode,
      }),
    }
  )
);

export type { Resource, Relationship, ScanResult, Recommendation, AnalysisResult, BackupResult, ScriptResult, WorkflowStep, DiagramViewMode, ConnectedAccount, SavedScan };
