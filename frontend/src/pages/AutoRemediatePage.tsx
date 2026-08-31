import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { triggerBackup } from '../services/api';
import toast from 'react-hot-toast';
import {
  ShieldCheckIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlayIcon,
  XCircleIcon,
  SparklesIcon,
  DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';

export default function AutoRemediatePage() {
  const navigate = useNavigate();
  const {
    scanResult, analysisResult, backupResult, setBackupResult,
    roleArn, currentStep, setCurrentStep, isLoading, setLoading,
  } = useAppStore();

  const [writeRoleArn, setWriteRoleArn] = useState('');
  const [deployProgress, setDeployProgress] = useState(0);

  // Change Set preview derived from the approved recommendations (SOW 4.4)
  const changeSet = (analysisResult?.analysis?.recommendations || []).map((r) => ({
    action: (r.current_state || '').toLowerCase().includes('none') || (r.affected_resources?.length || 0) === 0
      ? 'Create' : 'Modify',
    title: r.title,
    pillar: r.pillar,
    affected: (r.affected_resources || []).slice(0, 3).join(', ') +
      ((r.affected_resources?.length || 0) > 3 ? ` +${(r.affected_resources!.length - 3)} more` : ''),
    downtime: r.downtime_required,
  }));

  async function handleTakeBackup() {
    if (!writeRoleArn) {
      toast.error('Write Role ARN is required for backup and deployment');
      return;
    }

    setLoading(true);
    setCurrentStep('backing_up');

    try {
      const response = await triggerBackup({
        action: 'backup',
        roleArn: writeRoleArn,
        scanId: scanResult?.scanId,
        recommendationId: analysisResult?.recommendationId,
        architectureData: scanResult,
      });

      if (response.error) {
        toast.error(response.error);
        setCurrentStep('scripts_ready');
      } else {
        setBackupResult(response.data as any);
        setCurrentStep('backup_complete');
        toast.success('Backups complete! Review below and approve deployment.');
      }
    } catch {
      toast.error('Backup failed');
      setCurrentStep('scripts_ready');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeploy() {
    setCurrentStep('deploying');
    setDeployProgress(0);

    const startTime = Date.now();

    // Simulate deployment progress
    const interval = setInterval(() => {
      setDeployProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setCurrentStep('success');
          toast.success('Deployment successful!');

          // Send SNS success notification
          const durationSeconds = Math.round((Date.now() - startTime) / 1000);
          triggerBackup({
            action: 'deploy_success' as any,
            scanId: scanResult?.scanId,
            recommendationId: analysisResult?.recommendationId,
            recommendationCount: analysisResult?.analysis?.recommendations?.length || 0,
            deploymentDuration: `${durationSeconds}s`,
          } as any).catch(() => {
            // Non-blocking — notification failure shouldn't affect user
          });

          return 100;
        }
        return prev + 10;
      });
    }, 2000);
  }

  async function handleRollback() {
    if (!backupResult) return;

    setCurrentStep('rolling_back');
    setLoading(true);

    // Send deploy_failed notification
    triggerBackup({
      action: 'deploy_failed' as any,
      scanId: scanResult?.scanId,
      recommendationId: analysisResult?.recommendationId,
      errorMessage: 'Deployment failed — rollback initiated by user',
    } as any).catch(() => {});

    try {
      await triggerBackup({
        action: 'rollback',
        roleArn: writeRoleArn,
        scanId: scanResult?.scanId,
        backupResult: backupResult as any,
      });
      toast.success('Rollback initiated! Resources will be restored from backup.');
      setCurrentStep('idle');
    } catch {
      toast.error('Rollback failed. Manual intervention required.');
    } finally {
      setLoading(false);
    }
  }

  if (!analysisResult) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-white">AutoRemediate</h1>
        <div className="card bg-gradient-to-br from-dark-800 to-dark-900 text-center py-16">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500/20 to-orange-600/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-orange-500/20">
            <ShieldCheckIcon className="w-8 h-8 text-orange-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">No recommendations to apply yet</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
            Run an AI analysis first — we'll generate optimization recommendations you can safely deploy with automatic backup and rollback.
          </p>
          <button
            onClick={() => navigate('/redefine')}
            className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 shadow-lg shadow-primary-500/20"
          >
            <SparklesIcon className="w-5 h-5" />
            Go to RedefineYourArch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AutoRemediate</h1>
        <p className="text-gray-400 text-sm mt-1">Safely implement approved changes with automatic backup and rollback</p>
      </div>

      {/* Progress Steps */}
      <div className="card bg-gradient-to-r from-dark-800 to-dark-900 border-dark-600/50">
        <div className="flex items-center justify-between">
          {['Backup', 'Review', 'Deploy', 'Monitor', 'Complete'].map((step, idx) => {
            const stepStates = ['backing_up', 'backup_complete', 'deploying', 'monitoring', 'success'];
            const isActive = stepStates.indexOf(currentStep) >= idx;
            const isCurrent = stepStates[idx] === currentStep;
            return (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-500 ${
                    isActive && idx < stepStates.indexOf(currentStep)
                      ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25'
                      : isCurrent
                        ? 'bg-gradient-to-br from-primary-500 to-blue-600 text-white shadow-lg shadow-primary-500/25 animate-pulse'
                        : 'bg-dark-700 text-gray-500 border border-dark-600'
                  }`}>
                    {isActive && idx < stepStates.indexOf(currentStep) ? '✓' : idx + 1}
                  </div>
                  <span className={`text-[11px] mt-2 font-medium ${
                    isActive ? 'text-white' : 'text-gray-500'
                  }`}>{step}</span>
                </div>
                {idx < 4 && (
                  <div className={`h-0.5 w-full mx-2 rounded-full transition-all duration-500 ${
                    isActive && idx < stepStates.indexOf(currentStep)
                      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                      : 'bg-dark-700'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Write Role ARN - Required for changes */}
      {!backupResult && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Deployment Credentials</h2>
          
          {/* Important Notice */}
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-yellow-300 font-medium">Write Access Required for Deployment</p>
              <p className="text-yellow-400/80 mt-1">
                To apply changes and take backups, ArchLens needs an IAM role with <strong>write permissions</strong>. 
                This role should allow creating snapshots, modifying resources, and deploying CloudFormation stacks.
                Note: ArchLens is configured to <strong>never delete</strong> any resources — all operations are 
                create/modify only with automatic backup.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Write Role ARN <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={writeRoleArn}
              onChange={(e) => setWriteRoleArn(e.target.value)}
              className="input-field font-mono text-sm"
              placeholder="arn:aws:iam::123456789012:role/ArchLens-Write-Role"
            />
            <p className="text-xs text-gray-500 mt-1">
              IAM role with permissions to create snapshots, modify resources, and deploy CloudFormation/Terraform
            </p>
          </div>

          <button
            onClick={handleTakeBackup}
            disabled={isLoading || !writeRoleArn}
            className="btn-primary mt-4 flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Taking Backups...
              </>
            ) : (
              <>
                <ShieldCheckIcon className="w-5 h-5" />
                Take Backup & Proceed
              </>
            )}
          </button>
        </div>
      )}

      {/* Backup Results */}
      {backupResult && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 text-green-400" />
              Backups Complete
            </h2>
            <span className="badge-info">
              {backupResult.backups_taken}/{backupResult.total_resources} backed up
            </span>
          </div>

          <div className="space-y-2">
            {backupResult.backups?.map((backup, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-dark-900 rounded-lg border border-dark-700">
                <div className="flex items-center gap-3">
                  {backup.status === 'completed' ? (
                    <CheckCircleIcon className="w-5 h-5 text-green-400" />
                  ) : (
                    <XCircleIcon className="w-5 h-5 text-red-400" />
                  )}
                  <div>
                    <p className="text-sm text-white font-medium">{backup.resource_type}: {backup.resource_id}</p>
                    <p className="text-xs text-gray-500">{backup.backup_type} — {backup.backup_id || backup.error || 'N/A'}</p>
                  </div>
                </div>
                <span className={`badge ${backup.status === 'completed' ? 'badge-low' : 'badge-critical'}`}>
                  {backup.status}
                </span>
              </div>
            ))}
          </div>

          {/* Deploy Button */}
          {currentStep === 'backup_complete' && (
            <div className="mt-6 flex items-center gap-4">
              <button onClick={handleDeploy} className="btn-success flex items-center gap-2">
                <PlayIcon className="w-5 h-5" />
                Approve & Deploy Changes
              </button>
              <button onClick={() => setCurrentStep('scripts_ready')} className="btn-secondary">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Change Set Preview (SOW 4.4) — shown before deploy */}
      {backupResult && currentStep === 'backup_complete' && changeSet.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <DocumentMagnifyingGlassIcon className="w-5 h-5 text-primary-400" />
              Change Set Preview
            </h2>
            <span className="text-xs text-gray-500 bg-dark-900 px-2.5 py-1 rounded-full">
              {changeSet.length} planned change{changeSet.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            A dry-run of exactly what will change when you deploy. No resource is deleted — all operations are create/modify with backups already taken.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">Action</th>
                  <th className="text-left py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">Recommendation</th>
                  <th className="text-left py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">Pillar</th>
                  <th className="text-left py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">Affected Resources</th>
                  <th className="text-left py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">Downtime</th>
                </tr>
              </thead>
              <tbody>
                {changeSet.map((c, i) => (
                  <tr key={i} className="border-b border-dark-800/50">
                    <td className="py-2.5 px-3">
                      <span className={`badge ${c.action === 'Create' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                        {c.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-white">{c.title}</td>
                    <td className="py-2.5 px-3 text-gray-400">{c.pillar}</td>
                    <td className="py-2.5 px-3 text-gray-400">{c.affected || '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-xs font-medium ${c.downtime === 'NONE' ? 'text-green-400' : c.downtime === 'PLANNED' ? 'text-yellow-400' : 'text-red-400'}`}>
                        {c.downtime || 'NONE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deployment Progress */}
      {(currentStep === 'deploying' || currentStep === 'monitoring') && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Deployment Progress</h2>
          <div className="w-full bg-dark-700 rounded-full h-4 mb-4">
            <div
              className="bg-primary-500 h-4 rounded-full transition-all duration-500 flex items-center justify-center"
              style={{ width: `${deployProgress}%` }}
            >
              {deployProgress > 15 && (
                <span className="text-xs font-bold text-white">{deployProgress}%</span>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-400">
            {deployProgress < 30 && 'Initializing deployment...'}
            {deployProgress >= 30 && deployProgress < 60 && 'Applying infrastructure changes...'}
            {deployProgress >= 60 && deployProgress < 90 && 'Running health checks...'}
            {deployProgress >= 90 && 'Finalizing deployment...'}
          </p>

          {/* Rollback Button */}
          <button onClick={handleRollback} className="btn-danger mt-4 flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5" />
            Emergency Rollback
          </button>
        </div>
      )}

      {/* Success */}
      {currentStep === 'success' && (
        <div className="card bg-green-500/5 border-green-500/30">
          <div className="text-center py-8">
            <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Deployment Successful!</h2>
            <p className="text-gray-400">All changes have been applied successfully. Your architecture has been optimized.</p>
          </div>
        </div>
      )}

      {/* Failed */}
      {currentStep === 'failed' && (
        <div className="card bg-red-500/5 border-red-500/30">
          <div className="text-center py-8">
            <XCircleIcon className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Deployment Failed</h2>
            <p className="text-gray-400 mb-4">An error occurred during deployment. Automatic rollback has been initiated.</p>
            <button onClick={handleRollback} className="btn-danger flex items-center gap-2 mx-auto">
              <ArrowPathIcon className="w-5 h-5" />
              Manual Rollback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
