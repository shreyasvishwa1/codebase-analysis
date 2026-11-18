import { useQueryClient } from '@tanstack/react-query'
import { Check, FileArchive, Github, UploadCloud } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { useToast } from '../components/Toaster'
import { ZipSocket } from '../components/ZipSocket'
import { queryKeys } from '../hooks/queryKeys'
import { useProjects } from '../hooks/useProjects'
import { getErrorMessage } from '../services/client'
import { createProject } from '../services/projects'
import { createRepository, ingestGithub, ingestZip } from '../services/repositories'
import type { RepositoryCreate, RepositorySourceType } from '../types/api'

const NEW_PROJECT = '__new__'
const INPUT =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500'
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/

type Phase = 'project' | 'repository' | 'upload' | 'queue' | 'open'

/** A pad on the step track: dark, then lit gold once its part of the form is done. */
function TrackPad({ label, done, last }: { label: string; done: boolean; last: boolean }) {
  return (
    <li className={`flex items-center gap-2 ${last ? '' : 'flex-1'}`}>
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition duration-300 ${
          done
            ? 'border-indigo-400 bg-indigo-500 text-[rgb(var(--on-accent))] shadow-[0_0_12px_rgb(var(--indigo-500)/0.55)]'
            : 'border-slate-700 bg-slate-950 text-slate-600'
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className={`whitespace-nowrap text-xs font-medium ${done ? 'text-slate-100' : 'text-slate-500'}`}>
        {label}
        <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
      </span>
      {!last && (
        <span aria-hidden="true" className="relative mx-1 h-0.5 min-w-4 flex-1 overflow-hidden rounded bg-slate-800">
          <span className={`absolute inset-y-0 left-0 bg-indigo-400 transition-all duration-500 ${done ? 'w-full' : 'w-0'}`} />
        </span>
      )}
    </li>
  )
}

/** The import as it happens: each stage lights up in turn, and the upload stage carries a
 * trace that fills with the real upload percentage. */
function ImportProgress({ phases, phase, percent }: { phases: { key: Phase; label: string }[]; phase: Phase; percent: number }) {
  const at = phases.findIndex((item) => item.key === phase)
  return (
    <ol aria-label="Import progress" className="animate-fade-in space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      {phases.map((item, index) => {
        const done = index < at
        const active = index === at
        const shown = done ? 100 : percent
        return (
          <li key={item.key} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className={`led ${done ? 'text-indigo-400' : active ? 'animate-pulse text-amber-300' : 'text-slate-700'}`} />
            <span className={done ? 'text-slate-300' : active ? 'font-medium text-slate-50' : 'text-slate-500'}>{item.label}</span>
            {item.key === 'upload' && (active || done) && (
              <span className="flex flex-1 items-center gap-3">
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgb(var(--indigo-400)/0.8)] transition-[width] duration-300"
                    style={{ width: `${shown}%` }}
                  />
                </span>
                <span className="w-10 text-right font-mono text-xs text-indigo-300">{shown}%</span>
              </span>
            )}
            {done && item.key !== 'upload' && <Check className="ml-auto h-4 w-4 text-indigo-400" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * One form for the whole import: the project (existing or new), the repository and its source.
 * It creates what is needed, starts ingestion and opens the repository, where progress shows.
 */
export function UploadPage() {
  const projects = useProjects()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [projectChoice, setProjectChoice] = useState('')
  const [projectName, setProjectName] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState<RepositorySourceType>('zip')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [step, setStep] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const list = projects.data ?? []
  const choice = projectChoice || (list.length > 0 ? list[0].id : NEW_PROJECT)

  function validate(): string | null {
    if (choice === NEW_PROJECT && !projectName.trim()) return 'Project name is required'
    if (!name.trim()) return 'Repository name is required'
    if (source === 'zip') {
      if (!file) return 'Choose a ZIP file to upload'
      if (!file.name.toLowerCase().endsWith('.zip')) return 'The file must be a .zip archive'
    } else if (!GITHUB_URL.test(url.trim())) {
      return 'Enter a public repository URL like https://github.com/owner/repository'
    }
    return null
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = validate()
    setError(problem)
    if (problem) return
    try {
      let projectId = choice
      if (choice === NEW_PROJECT) {
        setPhase('project')
        setStep('Creating project…')
        projectId = (await createProject({ name: projectName.trim() })).id
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true })
      }
      setPhase('repository')
      setStep('Creating repository…')
      const body: RepositoryCreate = { name: name.trim(), source_type: source }
      if (source === 'github') {
        body.source_url = url.trim().replace(/\/$/, '')
        if (branch.trim()) body.default_branch = branch.trim()
      }
      const repository = await createRepository(projectId, body)
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories(projectId), exact: true })
      if (source === 'zip' && file) {
        setPhase('upload')
        setPercent(0)
        setStep('Uploading… 0%')
        await ingestZip(projectId, repository.id, file, (value) => {
          setPercent(value)
          setStep(`Uploading… ${value}%`)
        })
      } else {
        setPhase('queue')
        setStep('Starting the GitHub import…')
        await ingestGithub(projectId, repository.id)
      }
      setPhase('open')
      toast({
        title: 'Import started',
        description: `${repository.name}: files are being checked and stored. Run a full analysis once it is ready.`,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true })
      navigate(`/projects/${projectId}/repositories/${repository.id}`)
    } catch (err) {
      setStep(null)
      setPhase(null)
      setError(getErrorMessage(err, 'Could not import the repository'))
    }
  }

  const busy = step !== null
  const urlValid = GITHUB_URL.test(url.trim())
  const zipReady = file !== null && file.name.toLowerCase().endsWith('.zip')
  const track = [
    { label: 'Project', done: choice !== NEW_PROJECT || projectName.trim() !== '' },
    { label: 'Repository', done: name.trim() !== '' },
    { label: source === 'zip' ? 'Archive' : 'GitHub link', done: source === 'zip' ? zipReady : urlValid },
    { label: 'Import', done: phase === 'open' },
  ]
  const phases: { key: Phase; label: string }[] = [
    ...(choice === NEW_PROJECT ? [{ key: 'project' as const, label: 'Create the project' }] : []),
    { key: 'repository', label: 'Create the repository' },
    source === 'zip' ? { key: 'upload', label: 'Upload the archive' } : { key: 'queue', label: 'Queue the GitHub import' },
    { key: 'open', label: 'Open the repository' },
  ]
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Import</p>
        <h1 className="page-title">Upload repository</h1>
        <p className="page-lede">
          Upload a ZIP archive or import a public GitHub repository. Files are validated and stored
          for analysis; repository code is never executed.
        </p>
      </div>

      <form
        onSubmit={(event) => void onSubmit(event)}
        aria-label="Upload repository"
        className="pcb-card max-w-2xl animate-pop-in space-y-6 p-6 sm:p-8"
      >
        <ol aria-label="Form progress" className="flex items-center">
          {track.map((item, index) => (
            <TrackPad key={item.label} label={item.label} done={item.done} last={index === track.length - 1} />
          ))}
        </ol>

        <label className="block text-sm">
          <span className="font-medium text-slate-300">Project</span>
          <select
            className={INPUT}
            value={choice}
            onChange={(event) => setProjectChoice(event.target.value)}
            disabled={busy || projects.isPending}
          >
            {list.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            <option value={NEW_PROJECT}>+ New project</option>
          </select>
        </label>
        {projects.isError && (
          <ErrorMessage message={getErrorMessage(projects.error, 'Could not load projects')} />
        )}
        {choice === NEW_PROJECT && (
          <label className="block animate-fade-in text-sm">
            <span className="font-medium text-slate-300">New project name</span>
            <input className={INPUT} value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={busy} maxLength={100} />
          </label>
        )}
        <label className="block text-sm">
          <span className="font-medium text-slate-300">Repository name</span>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={255} />
        </label>

        <fieldset className="text-sm">
          <legend className="font-medium text-slate-300">Source</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {([
              ['zip', 'ZIP upload', FileArchive],
              ['github', 'Public GitHub repository', Github],
            ] as const).map(([value, label, Icon]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3.5 transition duration-200 hover:-translate-y-0.5 ${
                  source === value
                    ? 'border-indigo-500/70 bg-indigo-500/10 shadow-[0_0_20px_rgb(var(--indigo-500)/0.15)]'
                    : 'border-slate-700 hover:border-slate-500'
                }`}
              >
                <input type="radio" name="source" value={value} checked={source === value} onChange={() => setSource(value)} disabled={busy} />
                <Icon className={`h-4 w-4 transition ${source === value ? 'text-indigo-300' : 'text-slate-500'}`} aria-hidden="true" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {source === 'zip' ? (
          <div className="animate-fade-in">
            <ZipSocket file={file} onFile={setFile} disabled={busy} />
          </div>
        ) : (
          <div className="animate-fade-in space-y-5">
            <label className="block text-sm">
              <span className="font-medium text-slate-300">GitHub repository URL</span>
              <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repository" disabled={busy} />
            </label>
            {url.trim() !== '' && (
              <p className={`-mt-3 flex items-center gap-2 text-xs ${urlValid ? 'text-emerald-300' : 'text-slate-500'}`}>
                <span aria-hidden="true" className={`led ${urlValid ? 'text-emerald-400' : 'text-slate-600'}`} />
                {urlValid ? 'Looks like a public GitHub repository' : 'Format: https://github.com/owner/repository'}
              </p>
            )}
            <label className="block text-sm">
              <span className="font-medium text-slate-300">Branch (optional)</span>
              <input className={INPUT} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" disabled={busy} />
            </label>
          </div>
        )}

        <ErrorMessage message={error} />
        {phase && <ImportProgress phases={phases} phase={phase} percent={percent} />}
        {step && (
          <p role="status" className="sr-only">
            {step}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="group inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 font-semibold shadow-[0_0_20px_rgb(var(--indigo-500)/0.25)] hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UploadCloud className={`h-4 w-4 transition ${busy ? 'animate-bounce' : 'group-hover:-translate-y-0.5'}`} aria-hidden="true" />
          {busy ? 'Importing…' : 'Import repository'}
        </button>
      </form>
    </div>
  )
}
