import { useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { queryKeys } from '../hooks/queryKeys'
import { getErrorMessage } from '../services/client'
import { createProject, listProjects } from '../services/projects'
import { createRepository, ingestZip, listRepositories } from '../services/repositories'
import { ErrorMessage } from './ErrorMessage'
import { useToast } from './Toaster'

/** The bundled demo repository, served with the app (frontend/public/samples). */
export const SAMPLE = {
  url: '/samples/shop-api.zip',
  file: 'shop-api.zip',
  project: 'Samples',
  repository: 'shop-api (sample)',
} as const

const LOAD_FAILED = 'The sample archive could not be loaded; try again in a moment'

/**
 * A real analysis without bringing an archive: one click imports shop-api, a small Python and
 * JavaScript shop with planted problems (every key and password in it is fake), through the
 * same validated upload as the form. Later clicks reuse the Samples project and the sample
 * repository and import it again, which also restores its files after the host's disk is reset.
 */
export function SampleImport({ disabled = false }: { disabled?: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function importSample() {
    setError(null)
    setStep('Loading the sample…')
    let file: File
    try {
      const response = await fetch(SAMPLE.url)
      if (!response.ok) throw new Error(LOAD_FAILED)
      file = new File([await response.arrayBuffer()], SAMPLE.file, { type: 'application/zip' })
    } catch {
      setStep(null)
      setError(LOAD_FAILED)
      return
    }
    try {
      setStep('Preparing the Samples project…')
      let project = (await listProjects()).find((item) => item.name === SAMPLE.project)
      if (!project) {
        project = await createProject({ name: SAMPLE.project })
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true })
      }
      let repository = (await listRepositories(project.id)).find(
        (item) => item.name === SAMPLE.repository && item.source_type === 'zip',
      )
      if (!repository) {
        repository = await createRepository(project.id, { name: SAMPLE.repository, source_type: 'zip' })
        void queryClient.invalidateQueries({ queryKey: queryKeys.repositories(project.id), exact: true })
      }
      // An import already under way is simply opened; otherwise the sample is uploaded again.
      if (repository.status !== 'processing') {
        setStep('Uploading the sample…')
        await ingestZip(project.id, repository.id, file)
      }
      toast({
        title: 'Sample imported',
        description: 'shop-api: files are being checked and stored. Run a full analysis once it is ready.',
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true })
      navigate(`/projects/${project.id}/repositories/${repository.id}`)
    } catch (err) {
      setStep(null)
      setError(getErrorMessage(err, 'Could not import the sample'))
    }
  }

  const busy = step !== null
  return (
    <section aria-labelledby="sample-title" className="pcb-card max-w-2xl animate-pop-in p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span aria-hidden="true" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-500/50 bg-indigo-500/10 text-indigo-300">
          <FlaskConical className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="sample-title" className="font-semibold text-slate-100">
            No archive at hand? Try the sample
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            shop-api: a small Python and JavaScript shop with planted security problems and outdated
            packages. Every key and password in it is fake.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void importSample()}
          disabled={busy || disabled}
          className="whitespace-nowrap rounded-xl border border-indigo-500/60 px-4 py-2.5 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Importing…' : 'Import the sample'}
        </button>
      </div>
      {step && (
        <p role="status" className="mt-3 text-xs text-slate-400">
          {step}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      )}
    </section>
  )
}
