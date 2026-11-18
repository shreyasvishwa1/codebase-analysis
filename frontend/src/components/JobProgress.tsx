import { useState } from 'react'

import { useCancelJob } from '../hooks/useCancelJob'
import { useJobs } from '../hooks/useJobs'
import { getErrorMessage } from '../services/client'
import type { AnalysisJob, AnalysisJobType } from '../types/api'
import { formatDateTime } from '../utils/format'
import { JOB_POLL_INTERVAL_MS } from '../utils/jobs'
import { ErrorMessage } from './ErrorMessage'
import { StatusBadge } from './StatusBadge'
import { useToast } from './Toaster'

const JOB_TYPE_LABELS: Record<AnalysisJobType, string> = {
  ingestion: 'Ingestion',
  code_metrics: 'Code analysis',
  full_analysis: 'Full analysis',
}

interface CancelButtonProps {
  projectId: string
  repositoryId: string
  job: AnalysisJob
  onError: (message: string | null) => void
}

/** Cancel one pending job; only this row's button is disabled while its request runs. */
function CancelButton({ projectId, repositoryId, job, onError }: CancelButtonProps) {
  const cancel = useCancelJob(projectId, repositoryId)
  const toast = useToast()
  const label = (JOB_TYPE_LABELS[job.job_type] ?? job.job_type).toLowerCase()
  return (
    <button
      type="button"
      aria-label={`Cancel ${label} job`}
      disabled={cancel.isPending}
      onClick={() => {
        onError(null)
        cancel.mutate(job.id, {
          onSuccess: () => toast({ title: 'Job cancelled', tone: 'info' }),
          onError: (error) => onError(getErrorMessage(error, 'Could not cancel the job')),
        })
      }}
      className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Cancel
    </button>
  )
}

const STAGES = [
  { label: 'Queued', reached: () => true },
  { label: 'Processing', reached: (job: AnalysisJob) => job.status !== 'pending' },
  { label: 'Done', reached: (job: AnalysisJob) => job.status === 'completed' },
] as const

/** The job as a trace: three pads that light up as it moves on, joined by a bar that fills
 * with the job's progress and carries a moving pulse while it runs. */
function JobStages({ job }: { job: AnalysisJob }) {
  const running = job.status === 'pending' || job.status === 'processing'
  const failed = job.status === 'failed'
  return (
    <div className="space-y-2">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${failed ? 'bg-red-400' : 'bg-indigo-400 shadow-[0_0_10px_rgb(var(--indigo-400)/0.7)]'}`}
          style={{ width: `${job.progress}%` }}
        >
          {running && <span aria-hidden="true" className="absolute inset-0 animate-[shimmer_1.4s_linear_infinite] bg-gradient-to-r from-transparent via-white/50 to-transparent" style={{ transform: 'translateX(-100%)' }} />}
        </div>
      </div>
      <ol aria-hidden="true" className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
        {STAGES.map(({ label, reached }) => {
          const lit = reached(job) && !(failed && label === 'Done')
          return (
            <li key={label} className={`flex items-center gap-1.5 ${lit ? 'text-indigo-300' : 'text-slate-600'}`}>
              <span className={`led ${lit ? 'text-indigo-400' : 'text-slate-700'} ${lit && running && label === 'Processing' ? 'animate-pulse' : ''}`} />
              {label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

interface JobProgressProps {
  projectId: string
  repositoryId: string
  pollIntervalMs?: number
}

export function JobProgress({
  projectId,
  repositoryId,
  pollIntervalMs = JOB_POLL_INTERVAL_MS,
}: JobProgressProps) {
  const jobs = useJobs(projectId, repositoryId, pollIntervalMs)
  // Kept here, not in the row: the row disappears once the refreshed job is no longer pending.
  const [cancelError, setCancelError] = useState<string | null>(null)
  if (jobs.isPending) {
    return <p className="text-sm text-slate-400">Loading jobs…</p>
  }
  if (jobs.isError) {
    return <ErrorMessage message={getErrorMessage(jobs.error, 'Could not load jobs')} />
  }
  const [latest, ...older] = jobs.data
  if (!latest) {
    return <p className="text-sm text-slate-400">No ingestion jobs yet.</p>
  }
  return (
    <section className="space-y-3" aria-label="Ingestion progress">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Latest job</h2>
        <span className="text-xs text-slate-400" data-testid="job-type">
          {JOB_TYPE_LABELS[latest.job_type] ?? latest.job_type}
        </span>
        <StatusBadge status={latest.status} />
        <span className="text-xs text-slate-400" data-testid="job-progress">
          {latest.progress}%
        </span>
        {latest.status === 'pending' && (
          <CancelButton
            projectId={projectId}
            repositoryId={repositoryId}
            job={latest}
            onError={setCancelError}
          />
        )}
      </div>
      {cancelError && <ErrorMessage message={cancelError} />}
      <JobStages job={latest} />
      {latest.error_message && <ErrorMessage message={latest.error_message} />}
      <p className="text-xs text-slate-500">
        Created {formatDateTime(latest.created_at)} · Finished {formatDateTime(latest.completed_at)}
      </p>
      {older.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-400" aria-label="Recent jobs">
          {older.slice(0, 5).map((job) => (
            <li key={job.id} className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              <span>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</span>
              <span>{formatDateTime(job.created_at)}</span>
              {job.error_message && <span className="text-red-300">{job.error_message}</span>}
              {job.status === 'pending' && (
                <CancelButton
                  projectId={projectId}
                  repositoryId={repositoryId}
                  job={job}
                  onError={setCancelError}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
