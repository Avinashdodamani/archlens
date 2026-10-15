/**
 * ArchLens API Service
 * Handles all communication with the backend API Gateway.
 * Authentication tokens are attached automatically.
 */

import { fetchAuthSession } from 'aws-amplify/auth';
import { APP_CONFIG } from '../config/constants';

interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  error?: string;
}

async function getAuthToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || '';
  } catch {
    return '';
  }
}

async function apiRequest<T>(
  endpoint: string,
  method: string = 'POST',
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const token = await getAuthToken();
  const url = `${APP_CONFIG.apiBaseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: token }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      let errorMsg = data?.error || data?.message;
      if (!errorMsg) {
        if (response.status === 504) {
          errorMsg = 'AWS API Gateway timed out (504). Bedrock model took longer than 29 seconds to respond.';
        } else if (response.status === 502) {
          errorMsg = 'Bad Gateway (502): The backend Lambda or Bedrock service encountered an error.';
        } else {
          errorMsg = `Request failed with status ${response.status}`;
        }
      }
      return {
        data: data as T,
        status: response.status,
        error: errorMsg,
      };
    }

    return { data: data as T, status: response.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    return {
      data: {} as T,
      status: 500,
      error: msg.includes('Failed to fetch')
        ? 'Network request failed (API Gateway 504 or CORS error). Bedrock took longer than 29 seconds to respond.'
        : msg,
    };
  }
}

/**
 * Discover resources in a client AWS account.
 */
export async function discoverResources(params: {
  roleArn: string;
  region: string;
  regions?: string[];
  accountId?: string;
  externalId?: string;
}) {
  return apiRequest('/discover', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * List all saved scans from DynamoDB.
 */
export async function listScans(params?: { accountId?: string }) {
  return apiRequest<{
    scans: Array<{
      scanId: string;
      accountId: string;
      regions: string[];
      timestamp: string;
      resourceCount: number | string;
      relationshipCount?: number | string;
      status: string;
      summary?: string;
      s3Key?: string;
    }>;
    count: number;
  }>('/discover', 'POST', { action: 'list_scans', ...params });
}

/**
 * Fetch full scan details JSON from S3.
 */
export async function getScan(scanId: string) {
  return apiRequest<Record<string, unknown>>('/discover', 'POST', { action: 'get_scan', scanId });
}

/**
 * Get current scan status from DynamoDB.
 */
export async function getScanStatus(scanId: string, accountId?: string) {
  return apiRequest<{
    scanId: string;
    accountId: string;
    status: 'in_progress' | 'completed' | 'failed';
    resourceCount?: number;
    error?: string;
  }>('/discover', 'POST', { action: 'get_scan_status', scanId, accountId });
}

/**
 * Delete a scan record from DynamoDB.
 */
export async function deleteScanRecord(scanId: string, accountId: string) {
  return apiRequest<{ message: string }>('/discover', 'POST', { action: 'delete_scan', scanId, accountId });
}

/**
 * Analyze architecture against selected WAF pillars.
 */
export async function analyzeArchitecture(params: {
  scanId: string;
  pillars: string[];
  architectureData?: unknown;
}) {
  return apiRequest('/analyze', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Interactive AI Chatbot powered by Amazon Bedrock (Nova Pro).
 */
export async function chatWithAI(params: {
  question: string;
  scanId?: string;
  scanTimestamp?: string;
  recentScans?: unknown[];
  architectureData?: unknown;
  analysisData?: unknown;
  remediationStatus?: unknown;
  activeSection?: string;
  chatHistory?: Array<{ role: string; text: string }>;
}) {
  return apiRequest<{ reply: string; timestamp: string; model_used: string }>(
    '/analyze',
    'POST',
    { action: 'chat', ...params } as Record<string, unknown>
  );
}

/**
 * Generate CloudFormation template from recommendations.
 */
export async function generateCFT(params: {
  recommendationId: string;
  scanId?: string;
  recommendations?: unknown[];
  architectureData?: unknown;
}) {
  return apiRequest('/generate-cft', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Generate Terraform scripts from recommendations.
 */
export async function generateTerraform(params: {
  recommendationId: string;
  scanId?: string;
  recommendations?: unknown[];
  architectureData?: unknown;
}) {
  return apiRequest('/generate-terraform', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Trigger backup of affected resources.
 */
export async function triggerBackup(params: {
  action: 'backup' | 'rollback' | 'status';
  roleArn?: string;
  scanId?: string;
  recommendationId?: string;
  recommendations?: unknown[];
  architectureData?: unknown;
  backupResult?: unknown;
}) {
  return apiRequest('/backup', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Detect drift between the two most recent scans for an account (SOW 4.5).
 */
export async function detectDrift(params: {
  accountId: string;
  baselineScanId?: string;
  currentScanId?: string;
  sendAlert?: boolean;
}) {
  return apiRequest('/detect-drift', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Generate an executive-summary report for leadership (SOW 4.5).
 */
export async function generateReport(params: {
  scanId: string;
  recommendationId?: string;
}) {
  return apiRequest('/generate-report', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Manage scheduled scans (SOW 4.2): create | update | list | enable | disable | delete | run.
 */
export async function manageSchedule(params: {
  action: 'create' | 'update' | 'list' | 'enable' | 'disable' | 'delete' | 'run';
  accountId?: string;
  scheduleId?: string;
  roleArn?: string;
  region?: string;
  regions?: string[];
  externalId?: string;
  frequency?: 'once' | 'daily' | 'weekly';
  runAt?: string;
  dailyTime?: string;
  dayOfWeek?: string;
  timezone?: string;
  label?: string;
}) {
  return apiRequest('/schedule', 'POST', params as unknown as Record<string, unknown>);
}

/**
 * Orchestrate the full lifecycle via Step Functions (SOW Section 6).
 * actions: start | status | resume | stop
 */
export async function workflow(params: {
  action: 'start' | 'status' | 'resume' | 'stop';
  roleArn?: string;
  region?: string;
  regions?: string[];
  accountId?: string;
  externalId?: string;
  executionArn?: string;
  taskToken?: string;
  receiptHandle?: string;
  output?: Record<string, unknown>;
}) {
  return apiRequest('/workflow', 'POST', params as unknown as Record<string, unknown>);
}

export default {
  discoverResources,
  analyzeArchitecture,
  chatWithAI,
  generateCFT,
  generateTerraform,
  triggerBackup,
  detectDrift,
  generateReport,
  manageSchedule,
  workflow,
};
