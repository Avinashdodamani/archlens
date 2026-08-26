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

    const data = await response.json();

    if (!response.ok) {
      return {
        data: data as T,
        status: response.status,
        error: data.error || `Request failed with status ${response.status}`,
      };
    }

    return { data: data as T, status: response.status };
  } catch (error) {
    return {
      data: {} as T,
      status: 500,
      error: error instanceof Error ? error.message : 'Network error',
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

export default {
  discoverResources,
  analyzeArchitecture,
  generateCFT,
  generateTerraform,
  triggerBackup,
};
