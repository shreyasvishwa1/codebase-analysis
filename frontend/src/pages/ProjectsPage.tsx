import { FolderGit2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CreateProjectForm } from '../components/CreateProjectForm'
import { ErrorMessage } from '../components/ErrorMessage'
import { useProjects } from '../hooks/useProjects'
import { getErrorMessage } from '../services/client'

export function ProjectsPage() {
  const projects = useProjects()
  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" aria-hidden="true" />
        <p className="page-eyebrow">Workspace</p>
        <h1 className="page-title">Projects</h1>
        <p className="page-lede">
          Group repositories into projects, import code from a ZIP or GitHub, and explore it with
          cross-file navigation, diagnostics and repository insights.
        </p>
      </div>
      <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
        <section className="space-y-3">
          {projects.isPending && <p className="text-sm text-slate-400">Loading projects…</p>}
          {projects.isError && (
            <ErrorMessage message={getErrorMessage(projects.error, 'Could not load projects')} />
          )}
          {projects.data?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
              <FolderGit2 className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-400">No projects yet. Create your first one.</p>
            </div>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.data?.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="group flex h-full gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:-translate-y-0.5 hover:border-indigo-500/50 hover:shadow-glow"
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 font-mono text-sm font-semibold uppercase text-indigo-300`}
                  >
                    <FolderGit2 className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold group-hover:text-indigo-200">{project.name}</span>
                    {project.description && (
                      <span className="mt-1 block text-sm text-slate-400">{project.description}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <aside className="glass-card h-fit p-5">
          <CreateProjectForm />
        </aside>
      </div>
    </div>
  )
}
