import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ShieldCheckIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { scoreTextClass, scoreBarClass } from '../config/theme';

/**
 * Compliance Dashboard (SOW Section 4.5) — real-time scoring against
 * CIS AWS Foundations Benchmark checks, computed from discovered resources.
 * No Bedrock required — deterministic rule checks.
 */

interface Check {
  id: string;
  framework: 'CIS' | 'NIST';
  title: string;
  passed: boolean;
  detail: string;
}

export default function ComplianceDashboard() {
  const { scanResult } = useAppStore();

  const checks = useMemo<Check[]>(() => {
    const resources = scanResult?.resources || [];
    const out: Check[] = [];
    const byType = (t: string) => resources.filter((r) => r.type === t);

    // CIS 2.x — CloudTrail enabled
    const trails = byType('CloudTrail');
    out.push({
      id: 'cis-3.1', framework: 'CIS', title: 'CloudTrail enabled',
      passed: trails.length > 0,
      detail: trails.length > 0 ? `${trails.length} trail(s) found` : 'No CloudTrail detected',
    });

    // CIS 4.x — no security group open to 0.0.0.0/0 on sensitive ports
    const sgs = byType('SecurityGroup');
    let openSg = 0;
    for (const sg of sgs) {
      const inbound = (sg as Record<string, unknown>).inbound_rules as { IpRanges?: { CidrIp?: string }[] }[] | undefined;
      if ((inbound || []).some((rule) => (rule.IpRanges || []).some((ip) => ip.CidrIp === '0.0.0.0/0'))) openSg++;
    }
    out.push({
      id: 'cis-5.2', framework: 'CIS', title: 'No SG open to 0.0.0.0/0',
      passed: openSg === 0,
      detail: openSg === 0 ? 'No overly-permissive security groups' : `${openSg} security group(s) open to the world`,
    });

    // CIS — RDS encryption at rest
    const rds = [...byType('RDS'), ...byType('Aurora')];
    const rdsUnenc = rds.filter((r) => (r as Record<string, unknown>).storage_encrypted === false).length;
    out.push({
      id: 'cis-2.3', framework: 'CIS', title: 'RDS encrypted at rest',
      passed: rds.length === 0 || rdsUnenc === 0,
      detail: rds.length === 0 ? 'No RDS instances' : rdsUnenc === 0 ? 'All RDS encrypted' : `${rdsUnenc} unencrypted RDS`,
    });

    // CIS — S3 public access blocked
    const s3 = byType('S3');
    const s3Public = s3.filter((r) => (r as Record<string, unknown>).public_access_blocked === false).length;
    out.push({
      id: 'cis-2.1', framework: 'CIS', title: 'S3 public access blocked',
      passed: s3.length === 0 || s3Public === 0,
      detail: s3.length === 0 ? 'No S3 buckets' : s3Public === 0 ? 'All buckets block public access' : `${s3Public} public bucket(s)`,
    });

    // CIS — GuardDuty enabled
    const gd = byType('GuardDuty');
    out.push({
      id: 'cis-4.1', framework: 'CIS', title: 'GuardDuty enabled',
      passed: gd.length > 0,
      detail: gd.length > 0 ? 'Threat detection active' : 'GuardDuty not detected',
    });

    // NIST-aligned — encryption key management (KMS present)
    const kms = byType('KMS');
    out.push({
      id: 'nist-sc-12', framework: 'NIST', title: 'KMS key management in use',
      passed: kms.length > 0,
      detail: kms.length > 0 ? `${kms.length} KMS key(s)` : 'No customer-managed keys detected',
    });

    // NIST-aligned — logging/monitoring (CloudWatch present)
    const cw = byType('CloudWatch');
    out.push({
      id: 'nist-au-2', framework: 'NIST', title: 'Monitoring configured',
      passed: cw.length > 0,
      detail: cw.length > 0 ? 'CloudWatch alarms present' : 'No CloudWatch alarms detected',
    });

    return out;
  }, [scanResult]);

  const cis = checks.filter((c) => c.framework === 'CIS');
  const nist = checks.filter((c) => c.framework === 'NIST');
  const score = (arr: Check[]) => (arr.length ? Math.round((arr.filter((c) => c.passed).length / arr.length) * 100) : 0);
  const cisScore = score(cis);
  const nistScore = score(nist);

  if (!scanResult) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-gray-400" />
          Compliance Dashboard
        </h2>
        <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">CIS · NIST</span>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {[{ label: 'CIS AWS Foundations', s: cisScore, arr: cis }, { label: 'NIST-aligned', s: nistScore, arr: nist }].map((f) => (
          <div key={f.label} className="bg-dark-900/70 border border-dark-700/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">{f.label}</span>
              <span className={`text-sm font-medium ${scoreTextClass(f.s)}`}>{f.s}%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full transition-all duration-700 ${scoreBarClass(f.s)}`} style={{ width: `${f.s}%` }} />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">{f.arr.filter((c) => c.passed).length}/{f.arr.length} checks passed</p>
          </div>
        ))}
      </div>

      {/* Checks */}
      <div className="space-y-1.5">
        {checks.map((c) => (
          <div key={c.id} className="flex items-center gap-3 bg-dark-900/50 rounded-lg px-3 py-2">
            {c.passed
              ? <CheckCircleIcon className="w-4 h-4 text-green-400 flex-shrink-0" />
              : <XCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />}
            <span className="text-xs text-gray-300 flex-1">{c.title}</span>
            <span className="text-[10px] text-gray-500">{c.detail}</span>
            <span className="text-[9px] text-gray-600 uppercase w-8 text-right">{c.framework}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
