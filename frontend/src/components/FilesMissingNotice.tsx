import { AlertTriangle } from 'lucide-react'

import type { Repository } from '../types/api'

export const INGESTION_ANCHOR = 'ingestion'

/**
 * Shown only when a repository's files are gone from the server and cannot be restored: it
 * was imported before file contents were kept in the database, and the server's disk has
 * been reset since. One more import fixes it for good; later imports survive every reset.
 */
export function FilesMissingNotice({ repository }: { repository: Repository }) {
  const github = repository.source_type === 'github'
  return (
    <section
      aria-labelledby="files-missing-title"
      className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="space-y-2 text-sm">
          <h2 id="files-missing-title" className="font-semibold text-amber-100">
            This repository’s files are no longer on the server
          </h2>
          <p className="text-amber-100/80">
            It was imported before files were kept permanently, and the server has restarted since.
            {github
              ? ' Import it again from GitHub below; no upload is needed.'
              : ' Upload its ZIP once more below.'}{' '}
            From then on its files survive every restart, so it never has to be imported again.
          </p>
          <a
            href={`#${INGESTION_ANCHOR}`}
            className="inline-block font-semibold text-amber-200 underline-offset-2 hover:underline"
          >
            Go to Ingestion
          </a>
        </div>
      </div>
    </section>
  )
}
