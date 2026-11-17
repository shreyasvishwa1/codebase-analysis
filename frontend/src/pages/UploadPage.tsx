import { useQueryClient } from '@tanstack/react-query'
import { FileArchive, Github, UploadCloud } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
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

/**
 * One form for the whole import: the project (existing or new), the repository and its source.
 * It creates what is needed, starts ingestion and opens the repository, where progress shows.
 */
export function UploadPage() {
  const projects = useProjects()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [projectChoice, setProjectChoice] = useState('')
  const [projectName, setProjectName] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState<RepositorySourceType>('zip')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [step, setStep] = useState<string | null>(null)
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
        setStep('Creating project…')
        projectId = (await createProject({ name: projectName.trim() })).id
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true })
      }
      setStep('Creating repository…')
      const body: RepositoryCreate = { name: name.trim(), source_type: source }
      if (source === 'github') {
        body.source_url = url.trim().replace(/\/$/, '')
        if (branch.trim()) body.default_branch = branch.trim()
      }
      const repository = await createRepository(projectId, body)
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories(projectId), exact: true })
      if (source === 'zip' && file) {
        setStep('Uploading… 0%')
        await ingestZip(projectId, repository.id, file, (percent) => setStep(`Uploading… ${percent}%`))
      } else {
        setStep('Starting the GitHub import…')
        await ingestGithub(projectId, repository.id)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true })
      navigate(`/projects/${projectId}/repositories/${repository.id}`)
    } catch (err) {
      setStep(null)
      setError(getErrorMessage(err, 'Could not import the repository'))
    }
  }

  const busy = step !== null
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-indigo-600/25 via-violet-600/15 to-cyan-500/10 p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Import</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Upload repository</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Upload a ZIP archive or import a public GitHub repository. Files are validated and stored
          for analysis; repository code is never executed.
        </p>
      </div>

      <form onSubmit={(event) => void onSubmit(event)} aria-label="Upload repository" className="glass-card max-w-2xl space-y-5 p-6">
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
          <label className="block text-sm">
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
                className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 ${source === value ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-slate-700'}`}
              >
                <input type="radio" name="source" value={value} checked={source === value} onChange={() => setSource(value)} disabled={busy} />
                <Icon className="h-4 w-4 text-indigo-300" aria-hidden="true" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {source === 'zip' ? (
          <label className="block text-sm">
            <span className="font-medium text-slate-300">ZIP archive</span>
            <input
              className="mt-1.5 block w-full text-sm text-slate-300"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </label>
        ) : (
          <>
            <label className="block text-sm">
              <span className="font-medium text-slate-300">GitHub repository URL</span>
              <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repository" disabled={busy} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-300">Branch (optional)</span>
              <input className={INPUT} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" disabled={busy} />
            </label>
          </>
        )}

        <ErrorMessage message={error} />
        {step && (
          <p role="status" className="text-sm text-amber-300">
            {step}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UploadCloud className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Importing…' : 'Import repository'}
        </button>
      </form>
    </div>
  )
}
